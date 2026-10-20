import assert from "node:assert/strict";
import { test } from "node:test";
import vm from "node:vm";
import { createChannelAgeService } from "../sources/channel-age.mjs";

const ID = "UCaaaaaaaaaaaaaaaaaaaaaa";
const OTHER_ID = "UCbbbbbbbbbbbbbbbbbbbbbb";
const NOW = Date.UTC(2026, 9, 20, 12);
const KEY = "yt-master-suite.channel-age.v1";
const rule = (values = {}) => ({ channelId: ID, name: "News", maxAge: 1, unit: "weeks", enabled: true, blocked: false, ...values });

function fixture(seed = null, clock = NOW) {
  const data = new Map(seed === null ? [] : [[KEY, seed]]);
  let writes = 0;
  const storage = {
    getItem: key => data.get(key) ?? null,
    setItem: (key, value) => { writes += 1; data.set(key, value); },
    removeItem: key => data.delete(key),
  };
  const service = createChannelAgeService(() => storage, () => clock);
  return { data, storage, service, writes: () => writes };
}

function card({ channel = ID, date = "2 weeks ago", anchors = [], data = {}, live = false } = {}) {
  const node = {
    data: { ownerText: { runs: [{ text: "News", navigationEndpoint: { browseEndpoint: { browseId: channel } } }] }, publishedTimeText: { simpleText: date }, ...data },
    querySelector: () => live ? {} : null,
    querySelectorAll: selector => selector.includes("#channel-name") ? anchors : [],
  };
  return node;
}

function ageService(values = {}, clock = NOW) {
  const { service } = fixture(null, clock);
  assert.equal(service.save([rule(values)]).ok, true);
  return service;
}

test("channel age factory is self-contained when embedded from its source", () => {
  const create = vm.runInNewContext(`(${createChannelAgeService.toString()})`);
  const storage = { getItem: () => null };
  assert.equal(create(() => storage).key, KEY);
});

test("only canonical stable channel IDs and same-host canonical channel URLs are accepted", () => {
  const { service } = fixture();
  for (const input of [ID, ` ${ID} `, `https://www.youtube.com/channel/${ID}`, `https://www.youtube.com/channel/${ID}/`]) assert.equal(service.normaliseChannelId(input), ID);
  for (const input of ["News", "@news", "https://www.youtube.com/@news", "/channel/" + ID, "https://youtube.com/channel/" + ID, "http://www.youtube.com/channel/" + ID, "https://www.youtube.com.evil/channel/" + ID, `https://www.youtube.com/channel/${ID}?foo=1`, `${ID}a`, "UCshort", null, {}, 4]) assert.equal(service.normaliseChannelId(input), null);
});

test("rules are bounded, independently cloned and sanitised without title or URL matching", () => {
  const { service } = fixture();
  const checked = service.validateRules([rule({ name: " <b>News</b>\u0000\n" }), rule(), rule({ channelId: OTHER_ID, enabled: false })]);
  assert.equal(checked.length, 2);
  assert.equal(checked[0].name, "bNews/b");
  assert.equal(checked[1].enabled, false);
  assert.equal(service.validateRules([rule({ name: "x".repeat(101) })])[0].name.length, 100);
  for (const value of [0, -1, 1001, "1", NaN, 1.5]) assert.deepEqual(service.validateRules([rule({ maxAge: value })]), []);
  for (const value of ["week", "off", "Days", null]) assert.deepEqual(service.validateRules([rule({ unit: value })]), []);
  assert.deepEqual(service.validateRules([rule({ enabled: "true" })]), []);
  assert.deepEqual(service.validateRules({}), []);
  assert.equal(service.validateRules([rule({ enabled: undefined })])[0].enabled, true);
});

test("empty and invalid stored rules fail open without writing storage", () => {
  for (const raw of [null, "{", " ".repeat(65537), '{"version":2,"rules":[]}', '{"version":1,"rules":{}}']) {
    const { service, writes } = fixture(raw);
    assert.deepEqual(service.getRules(), []);
    assert.equal(service.hasEnabledRules(), false);
    assert.equal(writes(), 0);
    assert.equal(service.isCardTooOld(card()), false);
  }
});

test("explicit saves reject invalid, duplicate and oversized lists without modifying existing rules", () => {
  const { service, data, writes } = fixture();
  assert.equal(service.save([rule()]).ok, true);
  const saved = data.get(KEY);
  const priorWrites = writes();
  for (const input of [null, {}, [rule(), rule()], [rule({ channelId: "@news" })], [rule({ maxAge: 0 })], Array(101).fill(rule())]) {
    assert.equal(service.save(input).ok, false);
    assert.equal(data.get(KEY), saved);
    assert.equal(writes(), priorWrites);
    assert.deepEqual(service.getRules(), [rule()]);
  }
});

test("successful saves update the live cache and read reloads persistent changes", () => {
  const { service, data } = fixture();
  const result = service.save([rule()]);
  assert.deepEqual(result.rules, [rule()]);
  assert.equal(service.hasEnabledRules(), true);
  result.rules[0].maxAge = 50;
  const copied = service.getRules();
  copied[0].maxAge = 60;
  assert.equal(service.getRules()[0].maxAge, 1);
  data.set(KEY, JSON.stringify({ version: 1, rules: [rule({ maxAge: 2 })] }));
  assert.equal(service.getRules()[0].maxAge, 1);
  assert.equal(service.read()[0].maxAge, 2);
  assert.equal(service.save([]).ok, true);
  assert.deepEqual(service.getRules(), []);
  assert.equal(service.hasEnabledRules(), false);
});

test("an editor snapshot cannot overwrite newer channel filters or a cleared record", () => {
  for (const next of [[rule({ maxAge: 3 })], []]) {
    const { service, data, writes } = fixture(JSON.stringify({ version: 1, rules: [rule()] }));
    const baseline = service.read();
    const concurrent = JSON.stringify({ version: 1, rules: next });
    data.set(KEY, concurrent);
    const result = service.save([rule({ maxAge: 2 })], baseline);
    assert.equal(result.ok, false);
    assert.match(result.error, /changed in another window/);
    assert.equal(data.get(KEY), concurrent);
    assert.equal(writes(), 0);
    assert.deepEqual(service.getRules(), next);
  }
});

test("editor snapshots compare validated rules, not raw serialisation or missing legacy flags", () => {
  const { service, data } = fixture(JSON.stringify({ version: 1, rules: [rule()] }));
  const baseline = service.read();
  data.set(KEY, JSON.stringify({ rules: [{ channelId: ID, name: 'News', maxAge: 1, unit: 'weeks' }], version: 1 }, null, 2));
  assert.equal(service.save([rule({ maxAge: 2 })], baseline).ok, true);
  assert.deepEqual(service.getRules(), [rule({ maxAge: 2 })]);
});

test("a failed storage write leaves the active snapshot and previous stored record unchanged", () => {
  const { service, data, storage } = fixture();
  service.save([rule()]);
  const saved = data.get(KEY);
  storage.setItem = () => { throw new Error("full"); };
  assert.equal(service.save([rule({ maxAge: 2 })]).ok, false);
  assert.deepEqual(service.getRules(), [rule()]);
  assert.equal(data.get(KEY), saved);
  const unavailable = createChannelAgeService(() => { throw new Error("blocked"); });
  assert.deepEqual(unavailable.getRules(), []);
  assert.equal(unavailable.save([rule()]).ok, false);
});

test("channel identity comes from stable byline IDs, not display names, title text or handles", () => {
  const { service } = fixture();
  assert.deepEqual(service.channelFromCard(card()), { channelId: ID, name: "News" });
  assert.equal(service.channelFromCard(card({ channel: "@News" })), null);
  assert.equal(service.channelFromCard(card({ channel: null, data: { title: { simpleText: ID }, channelId: ID } })), null);
  const anchor = { getAttribute: () => `/channel/${ID}`, textContent: "Visible name" };
  assert.deepEqual(service.channelFromCard(card({ channel: null, anchors: [anchor] })), { channelId: ID, name: "Visible name" });
  assert.equal(service.channelFromCard(card({ anchors: [{ ...anchor, getAttribute: () => `/channel/${OTHER_ID}` }] })), null);
  assert.equal(service.channelFromCard(null), null);
});

test("current lockup command runs and bounded polymer data expose channel identity", () => {
  const { service } = fixture();
  const metadata = { lockupMetadataViewModel: { metadata: { contentMetadataViewModel: { metadataRows: [{ metadataParts: [{ text: { content: "Modern channel", commandRuns: [{ onTap: { innertubeCommand: { browseEndpoint: { browseId: ID } } } }] } }] }] } } } };
  const node = card({ channel: null, data: { metadata } });
  assert.deepEqual(service.channelFromCard(node), { channelId: ID, name: "Modern channel" });
  const data = node.data;
  node.data = null;
  node.getPolymerController = () => ({ data });
  assert.equal(service.channelFromCard(node).channelId, ID);
  node.getPolymerController = () => { throw new Error("detached"); };
  assert.equal(service.channelFromCard(node), null);
});

function componentCard(channel = ID, date = "2 weeks ago") {
  const node = card({ channel: null });
  node.data = Symbol("opaque");
  node.componentProps = {
    value: { metadata: { lockupMetadataViewModel: { metadata: { contentMetadataViewModel: { metadataRows: [{ metadataParts: [
      { text: { content: "Current channel", commandRuns: [{ startIndex: 0, length: 15, onTap: { innertubeCommand: { browseEndpoint: { browseId: channel } } } }] } },
      { text: { content: date } },
    ] }] } } } } },
    data() { return this.value; },
  };
  return node;
}

test("current component-props getter supplies the permanent channel ID without resolving its handle", () => {
  const { service, writes } = fixture();
  const node = componentCard();
  assert.deepEqual(service.channelFromCard(node), { channelId: ID, name: "Current channel" });
  node.componentProps.value.metadata.lockupMetadataViewModel.metadata.contentMetadataViewModel.metadataRows[0].metadataParts[0].text.commandRuns[0].onTap.innertubeCommand.browseEndpoint.browseId = "@current";
  assert.equal(service.channelFromCard(node), null);
  assert.equal(writes(), 0);
});

test("component-props failures and non-record values retain canonical DOM identity fallback", () => {
  const { service } = fixture();
  for (const value of [null, undefined, Symbol("opaque"), "not data", 1]) {
    const node = componentCard();
    node.componentProps.value = value;
    assert.equal(service.channelFromCard(node), null);
  }
  const node = componentCard();
  node.componentProps.data = () => { throw new Error("detached"); };
  assert.equal(service.channelFromCard(node), null);
  node.querySelectorAll = selector => selector.includes("#channel-name")
    ? [{ getAttribute: () => `/channel/${ID}`, textContent: "Visible channel" }] : [];
  assert.deepEqual(service.channelFromCard(node), { channelId: ID, name: "Visible channel" });
});

test("component and canonical DOM channel identities must agree before filtering", () => {
  const service = ageService();
  const node = componentCard();
  node.querySelectorAll = selector => selector.includes("#channel-name")
    ? [{ getAttribute: () => `/channel/${OTHER_ID}`, textContent: "Other channel" }] : [];
  assert.equal(service.channelFromCard(node), null);
  assert.equal(service.cardFilterReason(node), null);
});

test("History lockups expose the channel through their native avatar endpoint even without byline links", () => {
  const { service } = fixture();
  const node = componentCard();
  const metadata = node.componentProps.value.metadata.lockupMetadataViewModel;
  metadata.metadata.contentMetadataViewModel.metadataRows[0].metadataParts[0].text.commandRuns = [];
  metadata.image = { decoratedAvatarViewModel: { rendererContext: { commandContext: { onTap: {
    innertubeCommand: { browseEndpoint: { browseId: ID } },
  } } } } };
  assert.deepEqual(service.channelFromCard(node), { channelId: ID, name: "Current channel" });
  metadata.image.decoratedAvatarViewModel.rendererContext.commandContext.onTap.innertubeCommand.browseEndpoint.browseId = "@current";
  assert.equal(service.channelFromCard(node), null);
});

test("conflicting avatar and byline channel endpoints remain ambiguous rather than selecting an owner", () => {
  const { service } = fixture();
  const node = componentCard();
  node.componentProps.value.metadata.lockupMetadataViewModel.image = { decoratedAvatarViewModel: { rendererContext: { commandContext: { onTap: {
    innertubeCommand: { browseEndpoint: { browseId: OTHER_ID } },
  } } } } };
  assert.equal(service.channelFromCard(node), null);
});

test("recycled component-props channel and publication data are read afresh without caching", () => {
  const service = ageService();
  const node = componentCard();
  assert.equal(service.cardFilterReason(node), "Channel age");
  const parts = node.componentProps.value.metadata.lockupMetadataViewModel.metadata.contentMetadataViewModel.metadataRows[0].metadataParts;
  parts[1].text.content = "1 hour ago";
  assert.equal(service.cardFilterReason(node), null);
  parts[1].text.content = "3 weeks ago";
  parts[0].text.commandRuns[0].onTap.innertubeCommand.browseEndpoint.browseId = OTHER_ID;
  assert.equal(service.cardFilterReason(node), null);
  parts[0].text.commandRuns[0].onTap.innertubeCommand.browseEndpoint.browseId = ID;
  assert.equal(service.cardFilterReason(node), "Channel age");
});

test("daily and weekly limits hide only videos definitely older than the configured cutoff", () => {
  const daily = ageService({ maxAge: 2, unit: "days" });
  assert.equal(daily.isCardTooOld(card({ date: "3 days ago" })), true);
  assert.equal(daily.isCardTooOld(card({ date: "2 days ago" })), false);
  assert.equal(daily.isCardTooOld(card({ date: "47 hours ago" })), false);
  const weekly = ageService();
  assert.equal(weekly.isCardTooOld(card({ date: "2 weeks ago" })), true);
  assert.equal(weekly.isCardTooOld(card({ date: "1 week ago" })), false);
  assert.equal(weekly.isCardTooOld(card({ date: "8 days ago" })), true);
});

test("calendar months and years handle short months and leap years conservatively", () => {
  const monthly = ageService({ unit: "months" }, Date.UTC(2026, 2, 31, 12));
  assert.equal(monthly.isCardTooOld(card({ date: "2026-02-28" })), false);
  assert.equal(monthly.isCardTooOld(card({ date: "2026-02-27" })), true);
  assert.equal(monthly.isCardTooOld(card({ date: "1 month ago" })), false);
  assert.equal(monthly.isCardTooOld(card({ date: "2 months ago" })), true);
  const yearly = ageService({ unit: "years" }, Date.UTC(2024, 1, 29, 12));
  assert.equal(yearly.isCardTooOld(card({ date: "2023-02-28" })), false);
  assert.equal(yearly.isCardTooOld(card({ date: "2023-02-27" })), true);
  assert.equal(yearly.isCardTooOld(card({ date: "1 year ago" })), false);
  assert.equal(yearly.isCardTooOld(card({ date: "2 years ago" })), true);
});

test("unknown, invalid, future, live and upcoming publication dates remain visible", () => {
  const service = ageService();
  for (const date of ["", "News from 10 years ago", "35K views", "vor 2 Jahren", "2026-02-31", "2028-01-01", "today", "yesterday", "just now"]) assert.equal(service.isCardTooOld(card({ date })), false, date);
  assert.equal(service.isCardTooOld(card({ live: true })), false);
  assert.equal(service.isCardTooOld({ ...card(), matches: () => true }), false);
  assert.equal(service.isCardTooOld(card({ data: { upcomingEventData: { startTime: "123" } } })), false);
  assert.equal(service.isCardTooOld(card({ data: { badges: [{ metadataBadgeRenderer: { style: "BADGE_STYLE_TYPE_LIVE_NOW" } }] } })), false);
});

test("absolute British and YouTube dates and streamed recordings are recognised", () => {
  const service = ageService();
  for (const date of ["2025-01-01", "2025-01-01T10:00:00Z", "1 Jan 2025", "Jan 1, 2025", "Premiered Jan 1, 2025", "Streamed 2 weeks ago"]) assert.equal(service.isCardTooOld(card({ date })), true, date);
  assert.equal(service.isCardTooOld(card({ date: "Feb 31, 2025" })), false);
});

test("disabled and unmatched channels are unaffected even when display names match", () => {
  assert.equal(ageService({ enabled: false }).isCardTooOld(card()), false);
  assert.equal(ageService().isCardTooOld(card({ channel: OTHER_ID })), false);
});

test("recycled date metadata overrides an older cached renderer date and reassesses without stale caches", () => {
  const service = ageService();
  let date = "1 hour ago";
  const node = card();
  const query = node.querySelectorAll;
  node.querySelectorAll = selector => selector.includes("#metadata-line") ? [{ textContent: date, getAttribute: () => null }] : query(selector);
  assert.equal(service.isCardTooOld(node), false);
  date = "3 weeks ago";
  assert.equal(service.isCardTooOld(node), true);
  node.data.ownerText.runs[0].navigationEndpoint.browseEndpoint.browseId = OTHER_ID;
  assert.equal(service.isCardTooOld(node), false);
});

test("older saved age rules gain blocked false without losing their saved limits or writing storage", () => {
  const older = rule({ maxAge: 6, unit: "months", enabled: false });
  delete older.blocked;
  const { service, writes } = fixture(JSON.stringify({ version: 1, rules: [older] }));
  assert.deepEqual(service.getRules(), [rule({ maxAge: 6, unit: "months", enabled: false })]);
  assert.equal(service.hasEnabledRules(), false);
  assert.equal(writes(), 0);
});

test("Suite channel blocks include recent, undated and live uploads without pretending they are old", () => {
  const service = ageService({ blocked: true, maxAge: 6, unit: "months" });
  for (const node of [card(), card({ date: "1 minute ago" }), card({ date: "Unknown" }), card({ live: true }), card({ data: { upcomingEventData: {} } })]) {
    assert.equal(service.cardFilterReason(node), "Channel hidden");
    assert.equal(service.isCardTooOld(node), false);
  }
  assert.equal(service.cardFilterReason(card({ channel: OTHER_ID })), null);
  assert.equal(service.cardFilterReason(card({ channel: null })), null);
  assert.equal(service.cardFilterReason(null), null);
  assert.deepEqual(service.getRules(), [rule({ blocked: true, maxAge: 6, unit: "months" })]);
});

test("blocks can be disabled or changed back to the preserved age limit without modifying other channels", () => {
  const { service } = fixture();
  const input = [rule({ blocked: true, maxAge: 3, unit: "months" }), rule({ channelId: OTHER_ID, maxAge: 1, unit: "years" })];
  assert.equal(service.save(input).ok, true);
  input[0].enabled = false;
  assert.equal(service.save(input).ok, true);
  assert.equal(service.cardFilterReason(card()), null);
  input[0].enabled = true;
  input[0].blocked = false;
  assert.equal(service.save(input).ok, true);
  assert.equal(service.cardFilterReason(card({ date: "2 months ago" })), null);
  assert.equal(service.cardFilterReason(card({ date: "4 months ago" })), "Channel age");
  assert.equal(service.isCardTooOld(card({ date: "4 months ago" })), true);
  assert.deepEqual(service.getRules()[1], rule({ channelId: OTHER_ID, maxAge: 1, unit: "years" }));
});

test("invalid block flags reject explicit saves without storage or cache mutation", () => {
  const { service, data, writes } = fixture();
  assert.equal(service.save([rule()]).ok, true);
  const previous = data.get(KEY);
  const priorWrites = writes();
  for (const blocked of ["false", "true", "on", 0, 1, null, {}, []]) {
    assert.deepEqual(service.validateRules([rule({ blocked })]), []);
    assert.equal(service.save([rule({ blocked })]).ok, false);
    assert.equal(data.get(KEY), previous);
    assert.equal(writes(), priorWrites);
    assert.deepEqual(service.getRules(), [rule()]);
  }
  assert.equal(service.validateRules([rule({ blocked: undefined })])[0].blocked, false);
  assert.equal(service.save([rule({ blocked: true, maxAge: 0 })]).ok, false);
  assert.equal(service.save([rule({ blocked: true, unit: "off" })]).ok, false);
});
