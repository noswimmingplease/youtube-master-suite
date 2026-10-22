import assert from "node:assert/strict";
import { test } from "node:test";
import vm from "node:vm";
import { createSuiteBackup } from "../sources/suite-backup.mjs";
import { createSuiteSettings } from "../sources/suite-settings.mjs";
import { createChannelAgeService } from "../sources/channel-age.mjs";

const SETTINGS = "yt-master-suite.settings.v1";
const CORNER = "yt-master-suite.scroll-miniplayer.corner.v1";
const FILTERS = "yt-master-suite.channel-age.v1";
const ID = "UCaaaaaaaaaaaaaaaaaaaaaa";
const OTHER = "UCbbbbbbbbbbbbbbbbbbbbbb";
const THIRD = "UCcccccccccccccccccccccc";
const rule = (channelId = ID, values = {}) => ({ channelId, name: "Fixture channel", maxAge: 1, unit: "weeks", enabled: true, blocked: false, ...values });
const rawRules = rules => JSON.stringify({ version: 1, rules });

function fixture(seed = {}) {
  const data = new Map(Object.entries(seed));
  const hooks = {};
  const writes = [];
  const storage = {
    getItem(key) {
      const value = data.get(key) ?? null;
      return hooks.get ? hooks.get(key, value) : value;
    },
    setItem(key, value) {
      writes.push(["set", key, value]);
      if (hooks.beforeSet?.(key, value) === false) return;
      data.set(key, value);
      hooks.afterSet?.(key, value);
    },
    removeItem(key) {
      writes.push(["remove", key]);
      hooks.beforeRemove?.(key);
      data.delete(key);
    },
  };
  const settings = createSuiteSettings(() => storage, () => true);
  const channelAge = createChannelAgeService(() => storage);
  const read = channelAge.read;
  let refreshes = 0;
  channelAge.read = () => { refreshes += 1; return read(); };
  const backup = createSuiteBackup(() => storage, settings, channelAge);
  return { data, storage, hooks, writes, settings, channelAge, backup, refreshes: () => refreshes };
}

function documentFor(f, values = {}, rules = []) {
  return { format: "youtube-master-suite-backup", version: 1, language: "en-GB",
    settings: { ...f.settings.defaults, menuItemOrder: [...f.settings.defaults.menuItemOrder], ...values }, channelFilters: rules };
}

function staged(f, values = { hideChat: false, corner: "bottom-right" }, rules = [rule()]) {
  const result = f.backup.preview(JSON.stringify(documentFor(f, values, rules)));
  assert.equal(result.ok, true, result.error);
  return result;
}

test("backup factory embeds without imports or external runtime state", () => {
  const f = fixture();
  const create = vm.runInNewContext(`(${createSuiteBackup.toString()})`, { TextEncoder });
  const service = create(() => f.storage, f.settings, f.channelAge);
  assert.equal(service.exportData().ok, true);
});

test("export includes saved values, the synchronised corner and channel names/IDs, not active or unrelated data", () => {
  const f = fixture({ unrelatedHistory: "private", account: "private" });
  f.data.set(SETTINGS, JSON.stringify({ version: 1, values: { hideChat: false, corner: "top-left" } }));
  f.data.set(CORNER, "bottom-right");
  f.data.set(FILTERS, rawRules([rule()]));
  assert.equal(f.settings.initial.hideChat, true);
  assert.deepEqual(f.channelAge.getRules(), []);
  const exported = f.backup.exportData();
  assert.equal(exported.ok, true, exported.error);
  const record = JSON.parse(exported.text);
  assert.deepEqual(Object.keys(record), ["format", "version", "language", "settings", "channelFilters"]);
  assert.equal(record.language, "en-GB");
  assert.equal(record.settings.hideChat, false);
  assert.equal(record.settings.corner, "bottom-right");
  assert.equal(Object.keys(record.settings).length, Object.keys(f.settings.defaults).length);
  assert.deepEqual(record.channelFilters, [rule()]);
  assert.doesNotMatch(exported.text, /private|account|unrelatedHistory/);
  assert.match(exported.summary.warning, /Channel names and IDs are included/);
  assert.equal(f.refreshes(), 0);
  assert.deepEqual(f.writes, []);
});

test("valid legacy saved records gain missing defaults and filter flags without writing storage", () => {
  const older = { channelId: ID, maxAge: 2, unit: "days" };
  const f = fixture({ [SETTINGS]: JSON.stringify({ version: 1, values: { hideShorts: false } }), [FILTERS]: rawRules([older]) });
  const result = f.backup.exportData();
  assert.equal(result.ok, true, result.error);
  assert.deepEqual(JSON.parse(result.text).channelFilters, [rule(ID, { name: "", maxAge: 2, unit: "days" })]);
  assert.equal(JSON.parse(result.text).settings.hideShorts, false);
  assert.deepEqual(f.writes, []);
});

test("preview summarises setting differences and filter additions, changes and removals without writing", () => {
  const f = fixture({ [FILTERS]: rawRules([rule(), rule(OTHER)]) });
  const result = staged(f, { hideChat: false, corner: "bottom-left" }, [rule(ID, { maxAge: 2 }), rule(THIRD)]);
  assert.deepEqual(result.summary.settingChanges, [
    { name: "hideChat", before: true, after: false }, { name: "corner", before: "top-right", after: "bottom-left" },
  ]);
  assert.deepEqual(result.summary.filters, { added: 1, changed: 1, removed: 1, total: 2 });
  assert.match(result.summary.warning, /replaces all saved Suite settings and channel upload filters/);
  assert.deepEqual(f.writes, []);
  assert.equal(f.refreshes(), 0);
});

test("only the immutable trusted preview can restore, and it is single use", () => {
  const f = fixture();
  const result = staged(f);
  assert.ok(Object.isFrozen(result.preview));
  assert.ok(Object.isFrozen(result.summary));
  assert.ok(Object.isFrozen(result.summary.settingChanges));
  assert.throws(() => { result.summary.settingChanges[0].after = true; }, TypeError);
  assert.equal(f.backup.restore({}).ok, false);
  assert.equal(f.backup.restore(null).ok, false);
  assert.equal(f.backup.restore({ ...result.preview }).ok, false);
  const restored = f.backup.restore(result.preview);
  assert.equal(restored.ok, true, restored.error);
  assert.equal(f.backup.restore(result.preview).ok, false);
  restored.values.hideChat = true;
  restored.rules[0].maxAge = 900;
  assert.equal(f.settings.read().hideChat, false);
  assert.equal(f.channelAge.getRules()[0].maxAge, 1);
});

test("restore writes and reads back all three saved keys without modifying the active settings baseline", () => {
  const f = fixture();
  const initial = f.settings.initial;
  const result = f.backup.restore(staged(f).preview);
  assert.equal(result.ok, true, result.error);
  assert.deepEqual([...f.data.keys()], [SETTINGS, CORNER, FILTERS]);
  assert.equal(JSON.parse(f.data.get(SETTINGS)).values.hideChat, false);
  assert.equal(f.data.get(CORNER), "bottom-right");
  assert.deepEqual(JSON.parse(f.data.get(FILTERS)).rules, [rule()]);
  assert.deepEqual(f.channelAge.getRules(), [rule()]);
  assert.equal(f.refreshes(), 1);
  assert.equal(f.settings.initial, initial);
  assert.equal(f.settings.initial.hideChat, true);
  assert.equal(f.settings.initial.corner, "top-right");
});

test("restoring empty filters clears saved and live rules while unrelated storage is preserved", () => {
  const f = fixture({ [FILTERS]: rawRules([rule(), rule(OTHER)]), unrelated: "keep" });
  const result = f.backup.restore(staged(f, {}, []).preview);
  assert.equal(result.ok, true, result.error);
  assert.deepEqual(f.channelAge.getRules(), []);
  assert.deepEqual(JSON.parse(f.data.get(FILTERS)).rules, []);
  assert.equal(f.data.get("unrelated"), "keep");
});

test("the maximum 100-filter list and reordered menu are restored without losing values", () => {
  const f = fixture();
  const rules = Array.from({ length: 100 }, (_, index) => rule(`UC${String(index).padStart(22, "0")}`));
  const menuItemOrder = [...f.settings.defaults.menuItemOrder].reverse();
  const result = staged(f, { menuItemOrder }, rules);
  const menu = result.summary.settingChanges.find(change => change.name === "menuItemOrder");
  assert.deepEqual(menu.after, menuItemOrder);
  assert.ok(Object.isFrozen(menu.after));
  assert.throws(() => menu.after.reverse(), TypeError);
  const restored = f.backup.restore(result.preview);
  assert.equal(restored.ok, true, restored.error);
  assert.deepEqual(restored.rules, rules);
  assert.deepEqual(f.settings.read().menuItemOrder, menuItemOrder);
  assert.equal(f.settings.initial.menuItemOrder[0], "playNext");
});

for (const key of [SETTINGS, CORNER, FILTERS]) test(`raw concurrent changes to ${key} invalidate the preview`, () => {
  const f = fixture();
  const result = staged(f);
  f.data.set(key, key === CORNER ? "top-left" : "changed raw record");
  const before = new Map(f.data);
  const restored = f.backup.restore(result.preview);
  assert.equal(restored.ok, false);
  assert.equal(restored.conflict, true);
  assert.deepEqual(f.data, before);
  assert.deepEqual(f.writes, []);
  assert.equal(f.refreshes(), 0);
});

test("a raw-only formatting change also invalidates the preview", () => {
  const f = fixture({ [FILTERS]: rawRules([rule()]) });
  const result = staged(f);
  f.data.set(FILTERS, JSON.stringify({ version: 1, rules: [rule()] }, null, 2));
  assert.equal(f.backup.restore(result.preview).conflict, true);
  assert.deepEqual(f.writes, []);
});

for (const initial of [false, true]) {
  for (const failedKey of [SETTINGS, CORNER, FILTERS]) test(`quota failure at ${failedKey} rolls back ${initial ? "existing raw values" : "absent keys"}`, () => {
    const seed = initial ? { [SETTINGS]: JSON.stringify({ version: 1, values: { hideWatchedVideos: false } }),
      [CORNER]: "top-left", [FILTERS]: rawRules([rule(OTHER)]) } : {};
    const f = fixture(seed);
    const before = new Map(f.data);
    const result = staged(f);
    let failed = false;
    f.hooks.beforeSet = key => { if (key === failedKey && !failed) { failed = true; throw new Error("quota"); } };
    const restored = f.backup.restore(result.preview);
    assert.equal(restored.ok, false);
    assert.equal(restored.rollbackComplete, true);
    assert.equal(restored.reloadRequired, false);
    assert.deepEqual(f.data, before);
    assert.deepEqual(f.channelAge.getRules(), initial ? [rule(OTHER)] : []);
    assert.equal(f.refreshes(), 1);
  });
}

test("a silently dropped channel write is detected and earlier keys are restored", () => {
  const f = fixture({ [FILTERS]: rawRules([rule(OTHER)]) });
  const before = new Map(f.data);
  const result = staged(f);
  f.hooks.beforeSet = key => key === FILTERS ? false : undefined;
  const restored = f.backup.restore(result.preview);
  assert.equal(restored.ok, false);
  assert.equal(restored.rollbackComplete, true);
  assert.deepEqual(f.data, before);
  assert.deepEqual(f.channelAge.getRules(), [rule(OTHER)]);
});

test("a storage setter which writes before throwing still has its attempted key rolled back", () => {
  const f = fixture();
  const result = staged(f);
  let once = true;
  f.hooks.afterSet = key => { if (key === FILTERS && once) { once = false; throw new Error("write completion failed"); } };
  const restored = f.backup.restore(result.preview);
  assert.equal(restored.ok, false);
  assert.equal(restored.rollbackComplete, true);
  assert.equal(f.data.size, 0);
  assert.deepEqual(f.channelAge.getRules(), []);
});

test("an exact readback mismatch rolls back writes rather than reporting success", () => {
  const f = fixture();
  const result = staged(f);
  let corruptRead = false;
  f.hooks.afterSet = key => { if (key === FILTERS) corruptRead = true; };
  f.hooks.get = (key, value) => {
    if (corruptRead && key === SETTINGS) { corruptRead = false; return "unexpected readback"; }
    return value;
  };
  const restored = f.backup.restore(result.preview);
  assert.equal(restored.ok, false);
  assert.equal(restored.rollbackComplete, true);
  assert.equal(f.data.size, 0);
});

test("concurrent writes during commit are retained and incomplete rollback is explicit", () => {
  const f = fixture();
  const result = staged(f);
  f.hooks.afterSet = key => { if (key === SETTINGS) f.data.set(CORNER, "bottom-left"); };
  const restored = f.backup.restore(result.preview);
  assert.equal(restored.ok, false);
  assert.equal(restored.rollbackComplete, false);
  assert.equal(restored.reloadRequired, true);
  assert.match(restored.error, /could not be fully restored/);
  assert.equal(f.data.get(CORNER), "bottom-left");
  assert.equal(f.data.has(SETTINGS), false);
  assert.equal(f.refreshes(), 1);
});

test("a conflicting channel write found at readback is not overwritten and refreshes the live filter cache", () => {
  const f = fixture({ [FILTERS]: rawRules([rule(OTHER)]) });
  const result = staged(f);
  f.hooks.afterSet = key => { if (key === FILTERS) f.data.set(FILTERS, rawRules([rule(THIRD)])); };
  const restored = f.backup.restore(result.preview);
  assert.equal(restored.ok, false);
  assert.equal(restored.rollbackComplete, false);
  assert.deepEqual(f.channelAge.getRules(), [rule(THIRD)]);
  assert.equal(f.refreshes(), 1);
});

test("rollback write and removal failures are reported without claiming prior data was restored", () => {
  for (const existing of [false, true]) {
    const seed = existing ? { [SETTINGS]: JSON.stringify({ version: 1, values: { hideChat: true } }) } : {};
    const f = fixture(seed);
    const result = staged(f);
    let mainWritten = false;
    f.hooks.beforeSet = key => {
      if (key === CORNER || (key === SETTINGS && mainWritten)) throw new Error("unavailable");
    };
    f.hooks.afterSet = key => { if (key === SETTINGS) mainWritten = true; };
    f.hooks.beforeRemove = () => { throw new Error("unavailable"); };
    const restored = f.backup.restore(result.preview);
    assert.equal(restored.ok, false);
    assert.equal(restored.rollbackComplete, false);
    assert.equal(restored.reloadRequired, true);
    assert.match(restored.error, /Reload this page/);
    assert.equal(JSON.parse(f.data.get(SETTINGS)).values.hideChat, false);
    assert.equal(f.settings.initial.hideChat, true);
    assert.equal(f.refreshes(), 1);
  }
});

test("storage access loss during rollback refreshes filters with the existing fail-open fallback", () => {
  const f = fixture({ [FILTERS]: rawRules([rule(OTHER)]) });
  const result = staged(f);
  f.hooks.afterSet = key => { if (key === FILTERS) f.hooks.get = () => { throw new Error("denied"); }; };
  const restored = f.backup.restore(result.preview);
  assert.equal(restored.ok, false);
  assert.equal(restored.rollbackComplete, false);
  assert.deepEqual(f.channelAge.getRules(), []);
  assert.equal(f.refreshes(), 1);
});

test("unavailable storage prevents export, preview and preflight restore without writes", () => {
  const f = fixture();
  const text = JSON.stringify(documentFor(f));
  const result = f.backup.preview(text);
  f.hooks.get = () => { throw new Error("denied"); };
  assert.equal(f.backup.exportData().ok, false);
  assert.equal(f.backup.preview(text).ok, false);
  assert.equal(f.backup.restore(result.preview).ok, false);
  assert.deepEqual(f.writes, []);
});

test("changes while export or preview reads the current data are rejected", () => {
  for (const operation of ["exportData", "preview"]) {
    const f = fixture();
    let once = true;
    f.hooks.get = (key, value) => {
      if (key === FILTERS && once) { once = false; f.data.set(CORNER, "bottom-left"); }
      return value;
    };
    const result = f.backup[operation](JSON.stringify(documentFor(f)));
    assert.equal(result.ok, false);
    assert.match(result.error, /changed while preparing/);
    assert.deepEqual(f.writes, []);
    assert.equal(f.refreshes(), 0);
  }
});

test("restoring already identical raw records requires no writes but still refreshes the filter cache", () => {
  const f = fixture();
  const record = documentFor(f, {}, [rule()]);
  f.data.set(SETTINGS, JSON.stringify({ version: 1, values: record.settings }));
  f.data.set(CORNER, record.settings.corner);
  f.data.set(FILTERS, rawRules(record.channelFilters));
  const preview = f.backup.preview(JSON.stringify(record));
  assert.equal(preview.ok, true, preview.error);
  assert.deepEqual(preview.summary.settingChanges, []);
  assert.deepEqual(preview.summary.filters, { added: 0, changed: 0, removed: 0, total: 1 });
  assert.equal(f.backup.restore(preview.preview).ok, true);
  assert.deepEqual(f.writes, []);
  assert.equal(f.refreshes(), 1);
  assert.deepEqual(f.channelAge.getRules(), [rule()]);
});

test("invalid, unknown and future saved records are not silently exported as defaults", () => {
  for (const seed of [
    { [SETTINGS]: "{" }, { [SETTINGS]: JSON.stringify({ version: 2, values: {} }) },
    { [SETTINGS]: JSON.stringify({ version: 1, values: { futureSetting: true } }) },
    { [SETTINGS]: JSON.stringify({ version: 1, values: { wheelStep: "999" } }) },
    { [CORNER]: "middle" }, { [FILTERS]: rawRules([rule(), rule()]) },
    { [FILTERS]: JSON.stringify({ version: 2, rules: [] }) },
  ]) {
    const f = fixture(seed);
    assert.equal(f.backup.exportData().ok, false, JSON.stringify(seed));
    assert.deepEqual(f.writes, []);
  }
});

test("malformed, oversized and non-Suite inputs are rejected before storage writes", () => {
  const f = fixture();
  for (const input of [null, {}, "", "{", "null", "[]", " ".repeat(128 * 1024 + 1), JSON.stringify(documentFor(f)) + "\u2003".repeat(50000)]) {
    assert.equal(f.backup.preview(input).ok, false);
  }
  assert.deepEqual(f.writes, []);
});

test("envelope identity, version, language and exact keys are required", () => {
  const f = fixture();
  for (const change of [
    record => { record.format = "other"; }, record => { record.version = 2; }, record => { record.version = "1"; },
    record => { record.language = "en-US"; }, record => { delete record.language; },
    record => { record.history = []; }, record => { delete record.channelFilters; },
  ]) {
    const record = documentFor(f); change(record);
    assert.equal(f.backup.preview(JSON.stringify(record)).ok, false);
  }
  assert.deepEqual(f.writes, []);
});

test("unknown, missing, invalid and silently normalised settings are rejected", () => {
  const f = fixture();
  for (const change of [
    values => { values.unknown = true; }, values => { delete values.hideChat; },
    values => { values.hideChat = "false"; }, values => { values.wheelStep = 999; },
    values => { values.preferredVideoQuality = "hd4320"; }, values => { values.viewerColour = "red;display:none"; },
    values => { values.viewerColour = "#abcdef"; }, values => { values.corner = "middle"; },
    values => { values.menuItemOrder.pop(); }, values => { values.menuItemOrder[0] = values.menuItemOrder[1]; },
    values => { values.menuItemOrder[0] = "arbitrary"; }, values => { values.headerSettingsIcon = "off"; values.playerSettingsIcon = "off"; },
  ]) {
    const record = documentFor(f); change(record.settings);
    assert.equal(f.backup.preview(JSON.stringify(record)).ok, false);
  }
  assert.deepEqual(f.writes, []);
});

test("invalid, duplicate, excessive, future and silently normalised filter records are rejected", () => {
  const f = fixture();
  for (const rules of [
    null, {}, [rule(), rule()], Array(101).fill(rule()), [rule(ID, { maxAge: 0 })], [rule(ID, { maxAge: 1.5 })],
    [rule(ID, { unit: "fortnights" })], [rule("@fixture")], [rule(ID, { enabled: "false" })],
    [rule(ID, { blocked: null })], [rule(ID, { name: "<script>bad</script>" })], [rule(ID, { extra: true })],
    [{ channelId: ID, name: "Fixture", maxAge: 1, unit: "weeks", enabled: true }],
  ]) {
    const record = documentFor(f); record.channelFilters = rules;
    assert.equal(f.backup.preview(JSON.stringify(record)).ok, false);
  }
  assert.deepEqual(f.writes, []);
});

test("prototype keys and executable-looking payloads cannot enter a restore", () => {
  const f = fixture();
  const text = JSON.stringify(documentFor(f));
  for (const payload of [
    text.replace('"settings":{', '"settings":{"__proto__":{"polluted":true},'),
    text.replace('"settings":{', '"settings":{"constructor":{"prototype":{"polluted":true}},'),
    text.replace('"channelFilters":[]', '"channelFilters":[{"__proto__":{"polluted":true}}]'),
    text.replace('"language":"en-GB"', '"language":"<img src=x onerror=alert(1)>"'),
  ]) assert.equal(f.backup.preview(payload).ok, false);
  assert.equal({}.polluted, undefined);
  assert.deepEqual(f.writes, []);
});
