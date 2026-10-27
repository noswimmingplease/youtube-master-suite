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
const PREVIOUS_DEFAULT_MENU_ORDER = ['playNext', 'addToQueue', 'watchLater', 'savePlaylist', 'download', 'share',
  'notInterested', 'dontRecommend', 'report', 'channelAge', 'channelTools'];

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
  assert.equal(JSON.parse(result.text).settings.hideFullscreenQuickActions, false);
  assert.deepEqual(f.writes, []);
});

test('export migrates an exact former default menu order from valid saved records without writing storage', () => {
  const f = fixture({ [SETTINGS]: JSON.stringify({ version: 1, values: {
    menuItemOrder: PREVIOUS_DEFAULT_MENU_ORDER, hideChat: false, watchedThreshold: '95',
  } }) });
  const exported = f.backup.exportData();
  assert.equal(exported.ok, true, exported.error);
  const values = JSON.parse(exported.text).settings;
  assert.deepEqual(values.menuItemOrder, f.settings.defaults.menuItemOrder);
  assert.equal(values.hideChat, false);
  assert.equal(values.watchedThreshold, '95');
  assert.deepEqual(f.writes, []);
});

test('older backups with the exact former default menu order can be previewed and restored', () => {
  const f = fixture();
  const older = documentFor(f, { menuItemOrder: PREVIOUS_DEFAULT_MENU_ORDER, hideChat: false });
  const preview = f.backup.preview(JSON.stringify(older));
  assert.equal(preview.ok, true, preview.error);
  assert.deepEqual(preview.summary.settingChanges, [{ name: 'hideChat', before: true, after: false }]);
  assert.equal(f.backup.restore(preview.preview).ok, true);
  assert.deepEqual(f.settings.read().menuItemOrder, f.settings.defaults.menuItemOrder);
  assert.equal(f.settings.read().hideChat, false);
  for (const invalid of [PREVIOUS_DEFAULT_MENU_ORDER.slice(1),
    [...PREVIOUS_DEFAULT_MENU_ORDER, 'unknown'], PREVIOUS_DEFAULT_MENU_ORDER.map(() => 'share')]) {
    assert.equal(f.backup.preview(JSON.stringify(documentFor(f, { menuItemOrder: invalid }))).ok, false,
      'Only the exact known default migration is accepted');
  }
});

test('fullscreen action-strip preference round-trips through exported backups without changing the running snapshot', () => {
  const f = fixture();
  assert.equal(f.settings.save({ ...f.settings.defaults, hideFullscreenQuickActions: true }).ok, true);
  const exported = f.backup.exportData();
  assert.equal(exported.ok, true, exported.error);
  assert.equal(JSON.parse(exported.text).settings.hideFullscreenQuickActions, true);
  assert.equal(f.settings.save(f.settings.defaults).ok, true);
  const preview = f.backup.preview(exported.text);
  assert.equal(preview.ok, true, preview.error);
  assert.deepEqual(preview.summary.settingChanges, [{ name: 'hideFullscreenQuickActions', before: false, after: true }]);
  assert.equal(f.backup.restore(preview.preview).ok, true);
  assert.equal(f.settings.read().hideFullscreenQuickActions, true);
  assert.equal(f.settings.initial.hideFullscreenQuickActions, false);
});

test('live chat button preference round-trips independently of the saved chat visibility default', () => {
  const f = fixture();
  assert.equal(f.settings.save({ ...f.settings.defaults, liveChatButton: false, hideChat: false }).ok, true);
  const exported = f.backup.exportData();
  assert.equal(exported.ok, true, exported.error);
  assert.equal(JSON.parse(exported.text).settings.liveChatButton, false);
  assert.equal(JSON.parse(exported.text).settings.hideChat, false);
  assert.equal(f.settings.save(f.settings.defaults).ok, true);
  const preview = f.backup.preview(exported.text);
  assert.equal(preview.ok, true, preview.error);
  assert.deepEqual(preview.summary.settingChanges, [
    { name: 'liveChatButton', before: true, after: false },
    { name: 'hideChat', before: true, after: false },
  ]);
  assert.equal(f.backup.restore(preview.preview).ok, true);
  assert.equal(f.settings.read().liveChatButton, false);
  assert.equal(f.settings.read().hideChat, false);
  assert.equal(f.settings.initial.liveChatButton, true);
  assert.equal(f.settings.initial.hideChat, true);
});

test('live and upcoming card preferences round-trip independently without changing the running snapshot', () => {
  const f = fixture();
  assert.equal(f.settings.save({ ...f.settings.defaults, hideLiveVideos: true, hideUpcomingStreams: false }).ok, true);
  const exported = f.backup.exportData();
  assert.equal(exported.ok, true, exported.error);
  assert.equal(JSON.parse(exported.text).settings.hideLiveVideos, true);
  assert.equal(JSON.parse(exported.text).settings.hideUpcomingStreams, false);
  assert.equal(f.settings.save(f.settings.defaults).ok, true);
  const preview = f.backup.preview(exported.text);
  assert.equal(preview.ok, true, preview.error);
  assert.deepEqual(preview.summary.settingChanges, [
    { name: 'hideLiveVideos', before: false, after: true },
    { name: 'hideUpcomingStreams', before: true, after: false },
  ]);
  assert.equal(f.backup.restore(preview.preview).ok, true);
  assert.equal(f.settings.read().hideLiveVideos, true);
  assert.equal(f.settings.read().hideUpcomingStreams, false);
  assert.equal(f.settings.initial.hideLiveVideos, false);
  assert.equal(f.settings.initial.hideUpcomingStreams, true);
});

test('older backups gain only missing live-card defaults and retain strict validation', () => {
  const f = fixture({ [SETTINGS]: JSON.stringify({ version: 1, values: {
    hideLiveVideos: true, hideUpcomingStreams: false, hideChat: false,
  } }) });
  const legacy = documentFor(f, { hideChat: false });
  delete legacy.settings.hideLiveVideos;
  delete legacy.settings.hideUpcomingStreams;
  const preview = f.backup.preview(JSON.stringify(legacy));
  assert.equal(preview.ok, true, preview.error);
  assert.deepEqual(preview.summary.settingChanges, [
    { name: 'hideLiveVideos', before: true, after: false },
    { name: 'hideUpcomingStreams', before: false, after: true },
  ]);
  assert.equal(f.backup.restore(preview.preview).ok, true);
  assert.equal(f.settings.read().hideLiveVideos, false);
  assert.equal(f.settings.read().hideUpcomingStreams, true);
  assert.equal(f.settings.read().hideChat, false);
  for (const key of ['hideLiveVideos', 'hideUpcomingStreams']) {
    for (const value of ['true', 'false', 0, 1, null, [], {}]) {
      assert.equal(f.backup.preview(JSON.stringify(documentFor(f, { [key]: value }))).ok, false, key);
    }
  }
  delete legacy.settings.hideShorts;
  assert.equal(f.backup.preview(JSON.stringify(legacy)).ok, false, 'Pre-existing required fields remain required');
});

test('older backups gain the live chat button default without relaxing existing required fields or validation', () => {
  const f = fixture({ [SETTINGS]: JSON.stringify({ version: 1, values: {
    liveChatButton: false, hideFullscreenQuickActions: true, hideChat: false,
  } }) });
  const legacy = documentFor(f, { hideChat: false, hideFullscreenQuickActions: true });
  delete legacy.settings.liveChatButton;
  const recentPreview = f.backup.preview(JSON.stringify(legacy));
  assert.equal(recentPreview.ok, true, recentPreview.error);
  assert.deepEqual(recentPreview.summary.settingChanges, [
    { name: 'liveChatButton', before: false, after: true },
  ], 'A v1.2.19 backup retains its existing fullscreen-strip preference');
  delete legacy.settings.hideFullscreenQuickActions;
  const preview = f.backup.preview(JSON.stringify(legacy));
  assert.equal(preview.ok, true, preview.error);
  assert.deepEqual(preview.summary.settingChanges, [
    { name: 'liveChatButton', before: false, after: true },
    { name: 'hideFullscreenQuickActions', before: true, after: false },
  ]);
  assert.equal(f.backup.restore(preview.preview).ok, true);
  assert.equal(f.settings.read().liveChatButton, true);
  assert.equal(f.settings.read().hideFullscreenQuickActions, false);
  assert.equal(f.settings.read().hideChat, false);
  for (const value of ['true', 'false', 0, 1, null, [], {}]) {
    assert.equal(f.backup.preview(JSON.stringify(documentFor(f, { liveChatButton: value }))).ok, false);
  }
  delete legacy.settings.hideChat;
  assert.equal(f.backup.preview(JSON.stringify(legacy)).ok, false, 'Pre-existing chat visibility remains required');
  legacy.settings.hideChat = false;
  legacy.settings.unknownChatOption = true;
  assert.equal(f.backup.preview(JSON.stringify(legacy)).ok, false, 'Unknown fields remain rejected');
});

test('preference-less v1.2.18 backups default the fullscreen action strip to visible without relaxing other required fields', () => {
  const f = fixture({ [SETTINGS]: JSON.stringify({ version: 1, values: { hideFullscreenQuickActions: true } }) });
  const legacy = documentFor(f);
  delete legacy.settings.hideFullscreenQuickActions;
  const preview = f.backup.preview(JSON.stringify(legacy));
  assert.equal(preview.ok, true, preview.error);
  assert.deepEqual(preview.summary.settingChanges, [{ name: 'hideFullscreenQuickActions', before: true, after: false }]);
  assert.equal(f.backup.restore(preview.preview).ok, true);
  assert.equal(f.settings.read().hideFullscreenQuickActions, false);
  for (const value of ['true', 'false', 0, 1, null, [], {}]) {
    assert.equal(f.backup.preview(JSON.stringify(documentFor(f, { hideFullscreenQuickActions: value }))).ok, false);
  }
  delete legacy.settings.hideChat;
  assert.equal(f.backup.preview(JSON.stringify(legacy)).ok, false, 'All pre-existing settings remain required');
});

test('pre-timeline backups restore the automatic preview default while preserving legacy settings and channel filters', () => {
  const f = fixture({ [SETTINGS]: JSON.stringify({ version: 1, values: { timelinePreviewSize: 'large', hideChat: false } }),
    [FILTERS]: rawRules([rule()]) });
  const legacy = documentFor(f, { hideChat: false }, [rule()]);
  for (const name of ['timelinePreviewSize', 'liveChatButton', 'hideLiveVideos', 'hideUpcomingStreams', 'timeDisplayMode', 'keepHoverPreviews']) delete legacy.settings[name];
  const preview = f.backup.preview(JSON.stringify(legacy));
  assert.equal(preview.ok, true, preview.error);
  assert.deepEqual(preview.summary.settingChanges, [{ name: 'timelinePreviewSize', before: 'large', after: 'auto' }]);
  assert.deepEqual(f.writes, [], 'Preview must remain read-only');
  assert.equal(f.backup.restore(preview.preview).ok, true);
  assert.equal(f.settings.read().timelinePreviewSize, 'auto');
  assert.equal(f.settings.read().timeDisplayMode, 'native');
  assert.equal(f.settings.read().keepHoverPreviews, false);
  assert.equal(f.settings.read().hideChat, false);
  assert.deepEqual(f.channelAge.getRules(), [rule()]);
  for (const value of ['huge', '480', 480, null, false, [], {}]) {
    assert.equal(f.backup.preview(JSON.stringify(documentFor(f, { timelinePreviewSize: value }))).ok, false);
  }
  delete legacy.settings.hideChat;
  assert.equal(f.backup.preview(JSON.stringify(legacy)).ok, false, 'Existing required settings remain required');
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

const channelDocument = rules => ({ format: 'youtube-master-suite-channel-filters', version: 1,
  language: 'en-GB', channelFilters: rules });
function stagedChannels(f, rules = [rule()], mode = 'merge') {
  const result = f.backup.previewChannels(JSON.stringify(channelDocument(rules)), mode);
  assert.equal(result.ok, true, result.error);
  return result;
}

test('channel-only export contains saved names, limits and flags without reading preferences', () => {
  const saved = [rule(ID, { name: 'Daily news', maxAge: 2, unit: 'days' }),
    rule(OTHER, { name: 'Archive', maxAge: 3, unit: 'years', enabled: false, blocked: true })];
  const f = fixture({ [FILTERS]: rawRules(saved), [SETTINGS]: 'corrupt unrelated settings', [CORNER]: 'private', unrelated: 'private' });
  f.hooks.get = (key, value) => { assert.equal(key, FILTERS, 'Channel exports do not read preferences'); return value; };
  const exported = f.backup.exportChannels();
  assert.equal(exported.ok, true, exported.error);
  assert.equal(exported.count, 2);
  assert.deepEqual(JSON.parse(exported.text), channelDocument(saved));
  assert.doesNotMatch(exported.text, /corrupt|unrelated|private|settings/);
  assert.deepEqual(f.writes, []);
  assert.equal(f.refreshes(), 0);
});

test('empty and legacy saved channel exports gain safe defaults without writing storage', () => {
  const empty = fixture();
  assert.deepEqual(JSON.parse(empty.backup.exportChannels().text), channelDocument([]));
  const f = fixture({ [FILTERS]: rawRules([{ channelId: ID, maxAge: 3, unit: 'months' }]) });
  assert.deepEqual(JSON.parse(f.backup.exportChannels().text).channelFilters,
    [rule(ID, { name: '', maxAge: 3, unit: 'months' })]);
  assert.deepEqual(f.writes, []);
});

test('channel import defaults to merge and preserves unlisted channels and saved order', () => {
  const f = fixture({ [FILTERS]: rawRules([rule(ID), rule(OTHER)]) });
  const changed = rule(OTHER, { name: 'Updated', maxAge: 7, unit: 'days', blocked: true });
  const imported = [rule(THIRD), changed];
  const result = stagedChannels(f, imported);
  assert.equal(result.summary.mode, 'merge');
  assert.deepEqual(result.summary.filters, { added: 1, changed: 1, removed: 0, unchanged: 1, total: 3 });
  assert.match(result.summary.warning, /Other saved channels and all Suite preferences are kept/);
  assert.deepEqual(f.writes, []);
  assert.equal(f.refreshes(), 0);
  const restored = f.backup.restoreChannels(result.preview);
  assert.equal(restored.ok, true, restored.error);
  assert.deepEqual(restored.rules, [rule(ID), changed, rule(THIRD)]);
  assert.deepEqual(f.channelAge.getRules(), restored.rules);
  assert.deepEqual(f.writes.map(entry => entry.slice(0, 2)), [['set', FILTERS]]);
  assert.equal(f.refreshes(), 1);
});

test('replace mode explicitly removes unlisted channels and can restore an empty list', () => {
  const f = fixture({ [FILTERS]: rawRules([rule(ID), rule(OTHER)]) });
  const preview = stagedChannels(f, [rule(OTHER)], 'replace');
  assert.deepEqual(preview.summary.filters, { added: 0, changed: 0, removed: 1, unchanged: 1, total: 1 });
  assert.match(preview.summary.warning, /replaces the complete saved channel-filter list/);
  assert.equal(f.backup.restoreChannels(preview.preview).ok, true);
  const empty = stagedChannels(f, [], 'replace');
  assert.equal(empty.summary.filters.removed, 1);
  assert.equal(f.backup.restoreChannels(empty.preview).ok, true);
  assert.deepEqual(f.channelAge.getRules(), []);
  assert.equal(f.data.has(SETTINGS), false);
  assert.equal(f.data.has(CORNER), false);
});

test('replace can restore saved channel order without changing any rule fields', () => {
  const original = [rule(ID), rule(OTHER)];
  const f = fixture({ [FILTERS]: rawRules(original) });
  const imported = [original[1], original[0]];
  const preview = stagedChannels(f, imported, 'replace');
  assert.equal(preview.summary.orderChanged, true);
  assert.deepEqual(preview.summary.filters, { added: 0, changed: 0, removed: 0, unchanged: 2, total: 2 });
  assert.deepEqual(f.writes, []);
  const restored = f.backup.restoreChannels(preview.preview);
  assert.equal(restored.ok, true, restored.error);
  assert.deepEqual(restored.rules, imported);
  assert.deepEqual(JSON.parse(f.data.get(FILTERS)).rules, imported);
  assert.deepEqual(f.channelAge.getRules(), imported);
});

test('merging the same rules in a different order keeps the existing saved order', () => {
  const original = [rule(ID), rule(OTHER)];
  const f = fixture({ [FILTERS]: rawRules(original) });
  const preview = stagedChannels(f, [original[1], original[0]]);
  assert.equal(preview.summary.orderChanged, false);
  assert.deepEqual(preview.summary.filters, { added: 0, changed: 0, removed: 0, unchanged: 2, total: 2 });
  const restored = f.backup.restoreChannels(preview.preview);
  assert.equal(restored.ok, true, restored.error);
  assert.deepEqual(restored.rules, original);
  assert.deepEqual(f.writes, []);
});

test('merge of an empty channel export leaves existing channels unchanged', () => {
  const f = fixture({ [FILTERS]: rawRules([rule()]) });
  const result = stagedChannels(f, []);
  assert.deepEqual(result.summary.filters, { added: 0, changed: 0, removed: 0, unchanged: 1, total: 1 });
  assert.equal(f.backup.restoreChannels(result.preview).ok, true);
  assert.deepEqual(f.writes, []);
  assert.deepEqual(f.channelAge.getRules(), [rule()]);
});

test('channel preview tokens are immutable, single use and isolated from full-backup tokens', () => {
  const f = fixture();
  const channels = stagedChannels(f);
  const full = staged(f);
  assert.ok(Object.isFrozen(channels.preview));
  assert.ok(Object.isFrozen(channels.summary));
  assert.ok(Object.isFrozen(channels.summary.filters));
  assert.throws(() => { channels.summary.filters.total = 99; }, TypeError);
  for (const token of [null, {}, { ...channels.preview }, full.preview]) assert.equal(f.backup.restoreChannels(token).ok, false);
  assert.equal(f.backup.restore(channels.preview).ok, false);
  const restored = f.backup.restoreChannels(channels.preview);
  assert.equal(restored.ok, true, restored.error);
  assert.equal(f.backup.restoreChannels(channels.preview).ok, false);
  restored.rules[0].maxAge = 999;
  assert.equal(f.channelAge.getRules()[0].maxAge, 1);
});

test('channel-only imports validate envelope, language, version, mode and byte limits strictly', () => {
  const f = fixture();
  for (const text of [null, {}, '', '{', 'null', '[]', ' '.repeat(131073),
    JSON.stringify(channelDocument([])) + '\u2003'.repeat(50000), JSON.stringify(documentFor(f))]) {
    assert.equal(f.backup.previewChannels(text).ok, false);
  }
  for (const mode of ['', 'MERGE', 'append', null, {}, []]) assert.equal(f.backup.previewChannels(JSON.stringify(channelDocument([])), mode).ok, false);
  for (const change of [
    record => { record.format = 'other'; }, record => { record.version = 2; }, record => { record.version = '1'; },
    record => { record.language = 'en-US'; }, record => { delete record.language; },
    record => { record.settings = {}; }, record => { delete record.channelFilters; },
  ]) {
    const record = channelDocument([]); change(record);
    assert.equal(f.backup.previewChannels(JSON.stringify(record)).ok, false);
  }
  assert.deepEqual(f.writes, []);
  assert.equal(f.refreshes(), 0);
});

test('channel-only imports reject invalid, duplicate and normalised rule payloads', () => {
  const f = fixture();
  for (const rules of [null, {}, [rule(), rule()], Array(101).fill(rule()),
    [rule(ID, { maxAge: 0 })], [rule(ID, { maxAge: 1.5 })], [rule(ID, { unit: 'fortnights' })],
    [rule('@fixture')], [rule(ID, { enabled: 'false' })], [rule(ID, { blocked: null })],
    [rule(ID, { name: '<script>alert(1)</script>' })], [rule(ID, { name: 'Too long '.repeat(20) })],
    [rule(ID, { extra: true })], [{ channelId: ID, maxAge: 1, unit: 'days' }]]) {
    assert.equal(f.backup.previewChannels(JSON.stringify(channelDocument(rules))).ok, false);
  }
  const text = JSON.stringify(channelDocument([rule()]));
  for (const payload of [
    text.replace('"channelFilters":[{', '"channelFilters":[{"__proto__":{"polluted":true},'),
    text.replace('"channelFilters":[{', '"channelFilters":[{"constructor":{"prototype":{"polluted":true}},'),
    text.replace('"language":"en-GB"', '"language":"<img src=x onerror=alert(1)>"'),
  ]) assert.equal(f.backup.previewChannels(payload).ok, false);
  assert.equal({}.polluted, undefined);
  assert.deepEqual(f.writes, []);
});

test('channel merge respects the maximum combined list and replace remains available', () => {
  const rules = Array.from({ length: 100 }, (_, index) => rule(`UC${String(index).padStart(22, '0')}`));
  const f = fixture({ [FILTERS]: rawRules(rules) });
  const text = JSON.stringify(channelDocument([rule()]));
  const merge = f.backup.previewChannels(text);
  assert.equal(merge.ok, false);
  assert.match(merge.error, /exceed 100/);
  assert.equal(f.backup.previewChannels(text, 'replace').ok, true);
  assert.deepEqual(f.writes, []);
});

test('malformed saved channels cannot silently become empty during export or import preview', () => {
  for (const raw of ['{', JSON.stringify({ version: 2, rules: [] }), rawRules([rule(), rule()]),
    JSON.stringify({ version: 1, rules: [], extra: true }), ' '.repeat(65537)]) {
    const f = fixture({ [FILTERS]: raw });
    assert.equal(f.backup.exportChannels().ok, false);
    assert.equal(f.backup.previewChannels(JSON.stringify(channelDocument([])), 'replace').ok, false);
    assert.deepEqual(f.writes, []);
  }
});

test('channel changes during export or preview are detected without writes', () => {
  for (const operation of ['exportChannels', 'previewChannels']) {
    const f = fixture();
    let once = true;
    f.hooks.get = (key, value) => {
      if (key === FILTERS && once) { once = false; f.data.set(FILTERS, rawRules([rule(OTHER)])); }
      return value;
    };
    const result = f.backup[operation](JSON.stringify(channelDocument([rule()])));
    assert.equal(result.ok, false);
    assert.match(result.error, /changed while preparing/);
    assert.deepEqual(f.writes, []);
  }
});

test('channel import rejects a stale raw preview and refreshes current filter cache', () => {
  const f = fixture({ [FILTERS]: rawRules([rule()]) });
  const result = stagedChannels(f, [rule(OTHER)]);
  const changed = rawRules([rule(THIRD)]);
  f.data.set(FILTERS, changed);
  const restored = f.backup.restoreChannels(result.preview);
  assert.equal(restored.ok, false);
  assert.equal(restored.conflict, true);
  assert.equal(f.data.get(FILTERS), changed);
  assert.deepEqual(f.writes, []);
  assert.deepEqual(f.channelAge.getRules(), [rule(THIRD)]);
});

test('channel changes between preflight reads prevent any import write', () => {
  const f = fixture();
  const result = stagedChannels(f);
  let reads = 0;
  f.hooks.get = (key, value) => {
    if (key === FILTERS && ++reads === 2) { f.data.set(FILTERS, rawRules([rule(THIRD)])); return f.data.get(FILTERS); }
    return value;
  };
  const restored = f.backup.restoreChannels(result.preview);
  assert.equal(restored.conflict, true);
  assert.deepEqual(f.writes, []);
  assert.deepEqual(f.channelAge.getRules(), [rule(THIRD)]);
});

test('independent preference changes neither invalidate nor get overwritten by channel imports', () => {
  const f = fixture({ [SETTINGS]: 'original preferences', [CORNER]: 'top-left', unrelated: 'keep' });
  const result = stagedChannels(f);
  f.data.set(SETTINGS, 'new preferences'); f.data.set(CORNER, 'bottom-right');
  f.hooks.get = (key, value) => { assert.equal(key, FILTERS); return value; };
  const restored = f.backup.restoreChannels(result.preview);
  assert.equal(restored.ok, true, restored.error);
  assert.equal(f.data.get(SETTINGS), 'new preferences');
  assert.equal(f.data.get(CORNER), 'bottom-right');
  assert.equal(f.data.get('unrelated'), 'keep');
  assert.deepEqual(f.writes.map(entry => entry.slice(0, 2)), [['set', FILTERS]]);
});

for (const existing of [false, true]) {
  for (const failure of ['quota', 'dropped', 'write-then-throw']) test(`channel ${failure} failure preserves ${existing ? 'existing filters' : 'absent filters'}`, () => {
    const f = fixture(existing ? { [FILTERS]: rawRules([rule(OTHER)]) } : {});
    const before = new Map(f.data);
    const result = stagedChannels(f, [rule()], 'replace');
    let once = true;
    if (failure === 'quota') f.hooks.beforeSet = () => { throw new Error('quota'); };
    if (failure === 'dropped') f.hooks.beforeSet = () => false;
    if (failure === 'write-then-throw') f.hooks.afterSet = () => { if (once) { once = false; throw new Error('commit interrupted'); } };
    const restored = f.backup.restoreChannels(result.preview);
    assert.equal(restored.ok, false);
    assert.equal(restored.rollbackComplete, true);
    assert.equal(restored.reloadRequired, false);
    assert.deepEqual(f.data, before);
    assert.deepEqual(f.channelAge.getRules(), existing ? [rule(OTHER)] : []);
    assert.ok(f.writes.every(entry => entry[1] === FILTERS));
  });
}

test('a one-off channel readback mismatch rolls back the owned value', () => {
  const f = fixture({ [FILTERS]: rawRules([rule(OTHER)]) });
  const before = f.data.get(FILTERS), result = stagedChannels(f, [rule()], 'replace');
  let mismatch = false, once = true;
  f.hooks.afterSet = () => { if (once) { once = false; mismatch = true; } };
  f.hooks.get = (key, value) => { if (key === FILTERS && mismatch) { mismatch = false; return 'mismatch'; } return value; };
  const restored = f.backup.restoreChannels(result.preview);
  assert.equal(restored.ok, false);
  assert.equal(restored.rollbackComplete, true);
  assert.equal(restored.reloadRequired, false);
  assert.equal(f.data.get(FILTERS), before);
  assert.ok(f.writes.every(entry => entry[1] === FILTERS));
});

test('channel imports retain a concurrent third-party write rather than rolling over it', () => {
  const f = fixture({ [FILTERS]: rawRules([rule(OTHER)]) });
  const result = stagedChannels(f, [rule()], 'replace');
  f.hooks.afterSet = () => f.data.set(FILTERS, rawRules([rule(THIRD)]));
  const restored = f.backup.restoreChannels(result.preview);
  assert.equal(restored.ok, false);
  assert.equal(restored.rollbackComplete, false);
  assert.equal(restored.reloadRequired, true);
  assert.deepEqual(f.channelAge.getRules(), [rule(THIRD)]);
  assert.deepEqual(f.writes.map(entry => entry.slice(0, 2)), [['set', FILTERS]]);
});

test('channel rollback failures are explicit and cannot claim recovery succeeded', () => {
  for (const existing of [false, true]) {
    const f = fixture(existing ? { [FILTERS]: rawRules([rule(OTHER)]) } : {});
    const result = stagedChannels(f, [rule()], 'replace');
    let written = false;
    f.hooks.beforeSet = () => { if (written) throw new Error('rollback unavailable'); };
    f.hooks.afterSet = () => { written = true; throw new Error('write completion failed'); };
    f.hooks.beforeRemove = () => { throw new Error('rollback unavailable'); };
    const restored = f.backup.restoreChannels(result.preview);
    assert.equal(restored.ok, false);
    assert.equal(restored.rollbackComplete, false);
    assert.equal(restored.reloadRequired, true);
    assert.match(restored.error, /could not be fully restored/);
    assert.deepEqual(f.channelAge.getRules(), [rule()]);
  }
});

test('unavailable channel storage prevents export, preview and commit without writes', () => {
  const f = fixture();
  const result = stagedChannels(f);
  f.hooks.get = () => { throw new Error('denied'); };
  assert.equal(f.backup.exportChannels().ok, false);
  assert.equal(f.backup.previewChannels(JSON.stringify(channelDocument([]))).ok, false);
  assert.equal(f.backup.restoreChannels(result.preview).ok, false);
  assert.deepEqual(f.writes, []);
});

test('already-identical channel imports avoid writes and still refresh the live cache', () => {
  const f = fixture();
  f.data.set(FILTERS, rawRules([rule()]));
  const result = stagedChannels(f);
  assert.equal(result.summary.filters.unchanged, 1);
  assert.equal(f.backup.restoreChannels(result.preview).ok, true);
  assert.deepEqual(f.writes, []);
  assert.deepEqual(f.channelAge.getRules(), [rule()]);
  assert.equal(f.refreshes(), 1);
});
