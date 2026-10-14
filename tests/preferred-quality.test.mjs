import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const SOURCE = readFileSync(new URL('../sources/modules/youtube-player-preferences-lite.user.js', import.meta.url), 'utf8');
const functions = ['getPreferredQualityLevel', 'clearPreferredQualityAttempts', 'applyPreferredPlaybackQuality',
  'schedulePreferredQualityAttempts', 'handleManualQualitySelection', 'handlePreferredQualityMetadata'];
function extract(name) {
  const start = SOURCE.indexOf(`  function ${name}(`), end = SOURCE.indexOf('\n  function ', start + 1);
  assert.ok(start >= 0 && end > start, name);
  return SOURCE.slice(start, end);
}
function harness({ preference = 'hd1080', confirm = true, levels = ['hd2160', 'hd1080', 'hd720', 'medium'], quality = 'medium' } = {}) {
  const timers = new Map(), calls = [], classes = new Set();
  let nextTimer = 1, now = 0, lookups = 0;
  const video = {};
  const player = {
    id: 'aaaaaaaaaaa', quality, levels, data: null, menu: null,
    classList: { contains: name => classes.has(name) },
    querySelector: selector => { assert.equal(selector, '.ytp-settings-menu'); return player.menu; },
    getAvailableQualityLevels: () => player.levels,
    getAvailableQualityData: () => player.data,
    getPlaybackQuality: () => player.quality,
    setPlaybackQualityRange(min, max) {
      calls.push({ id: player.id, min, max });
      if (confirm) player.quality = min;
    },
    setPlaybackQuality() { assert.fail('The unsupported legacy setter must not be called'); },
  };
  const context = vm.createContext({
    CONFIG: { preferredVideoQuality: preference },
    preferredQualityVideoId: '', preferredQualityNavigationPending: false,
    preferredQualityRetryTimers: new Set(), videoMirrorPageSuspended: false,
    routeId: player.id, watch: true,
    isWatchPath: () => context.watch,
    getVideoMirrorRouteId: () => context.watch ? context.routeId : '',
    getVideoMirrorTarget(id = context.routeId) {
      lookups++;
      return id === player.id && context.targetAvailable !== false ? { player, video } : null;
    },
    isRenderedWatchFlexy: node => Boolean(node?.visible),
    closestElement: target => target?.control || null,
    setTimeout(callback, delay) { const id = nextTimer++; timers.set(id, { callback, at: now + delay }); return id; },
    clearTimeout: id => timers.delete(id),
  });
  for (const constant of ['QUALITY_LEVELS_HIGH_TO_LOW', 'PREFERRED_QUALITY_RETRY_DELAYS_MS']) {
    const definition = SOURCE.match(new RegExp(`const ${constant} = \\[[\\s\\S]*?\\];`))?.[0];
    assert.ok(definition); vm.runInContext(definition, context);
  }
  vm.runInContext(functions.map(extract).join('\n'), context);
  function advance(to) {
    while (true) {
      const next = [...timers].filter(([, value]) => value.at <= to).sort((a, b) => a[1].at - b[1].at || a[0] - b[0])[0];
      if (!next) break;
      now = next[1].at; timers.delete(next[0]); next[1].callback();
    }
    now = to;
  }
  return { context, player, video, timers, calls, classes, advance, lookups: () => lookups };
}

test('quality selection is ordered, excludes Auto/unknown IDs and never exceeds a fixed preference', () => {
  const { context: c } = harness();
  for (const [levels, preference, expected] of [
    [['medium', 'hd2160', 'hd720', 'hd1080'], 'hd1080', 'hd1080'],
    [['hd2160', 'hd720', 'large'], 'hd1080', 'hd720'],
    [['hd1080', 'hd720'], 'tiny', ''],
    [['tiny', 'hd2160', 'hd1440'], 'highest', 'hd2160'],
    [['hd4320', 'highres'], 'highest', 'highres'],
    [['auto', 'mystery'], 'highest', ''],
    [['hd1080'], 'off', ''], [['hd1080'], 'invalid', ''],
    [null, 'highest', ''], [{ hd1080: true }, 'highest', ''],
  ]) assert.equal(c.getPreferredQualityLevel(levels, preference), expected);
});

test('default Off and off-watch routes do not query a player or schedule work', () => {
  for (const options of [{ preference: 'off' }, {}]) {
    const h = harness(options);
    if (!options.preference) h.context.watch = false;
    h.context.schedulePreferredQualityAttempts(); h.advance(20000);
    assert.equal(h.lookups(), 0); assert.equal(h.timers.size, 0); assert.deepEqual(h.calls, []);
  }
});

test('one confirmed request cancels all remaining attempts and cannot restart on same-video metadata', () => {
  const h = harness();
  h.context.schedulePreferredQualityAttempts(); assert.equal(h.timers.size, 6);
  h.advance(0);
  assert.deepEqual(h.calls, [{ id: h.player.id, min: 'hd1080', max: 'hd1080' }]);
  assert.equal(h.timers.size, 0); assert.equal(h.context.preferredQualityRetryTimers.size, 0);
  h.context.schedulePreferredQualityAttempts(); h.context.handlePreferredQualityMetadata({ target: h.video });
  h.advance(20000); assert.equal(h.calls.length, 1);
});

test('already-selected quality needs no setter call', () => {
  const h = harness({ quality: 'hd1080' });
  h.context.schedulePreferredQualityAttempts(); h.advance(20000);
  assert.deepEqual(h.calls, []); assert.equal(h.timers.size, 0);
});

test('a no-op setter is not treated as success and expires after exactly six bounded attempts', () => {
  const h = harness({ confirm: false });
  h.context.schedulePreferredQualityAttempts(); h.advance(20000);
  assert.equal(h.calls.length, 6); assert.equal(h.player.quality, 'medium'); assert.equal(h.timers.size, 0);
  h.context.schedulePreferredQualityAttempts(); h.context.handlePreferredQualityMetadata({ target: h.video });
  h.advance(30000); assert.equal(h.calls.length, 6);
});

test('unavailable APIs, thrown getters/setters and malformed levels fail open', () => {
  for (const customise of [
    p => { p.setPlaybackQualityRange = null; }, p => { p.getPlaybackQuality = null; },
    p => { p.getAvailableQualityLevels = () => { throw Error('not ready'); }; },
    p => { p.getAvailableQualityData = () => { throw Error('not ready'); }; },
    p => { p.getPlaybackQuality = () => { throw Error('not ready'); }; },
    p => { p.setPlaybackQualityRange = () => { throw Error('native rejected'); }; },
    p => { p.levels = {}; }, p => { p.levels = []; },
  ]) {
    const h = harness(); customise(h.player);
    h.context.schedulePreferredQualityAttempts(); assert.doesNotThrow(() => h.advance(20000));
    assert.deepEqual(h.calls, []); assert.equal(h.timers.size, 0);
  }
});

test('unplayable streams are excluded when optional quality data is available', () => {
  const h = harness();
  h.player.data = [{ quality: 'hd1080', isPlayable: false }, { quality: 'hd720', isPlayable: true }];
  h.context.schedulePreferredQualityAttempts(); h.advance(0);
  assert.equal(h.calls[0].min, 'hd720');
});

test('one blocked stream variant cannot exclude another playable variant of the same resolution', () => {
  const h = harness();
  h.player.data = [{ quality: 'hd1080', isPlayable: false }, { quality: 'hd1080', isPlayable: true }];
  h.context.schedulePreferredQualityAttempts(); h.advance(0);
  assert.equal(h.calls[0].min, 'hd1080');
});

test('late stream/API readiness is retried within the existing deadline', () => {
  const h = harness(); h.player.levels = [];
  h.context.schedulePreferredQualityAttempts(); h.advance(300); assert.deepEqual(h.calls, []);
  h.player.levels = ['hd720']; h.advance(1000);
  assert.equal(h.calls[0].min, 'hd720'); assert.equal(h.timers.size, 0);
});

test('old player identity, pending navigation and suspended pages cannot receive quality writes', () => {
  for (const customise of [
    h => { h.player.id = 'bbbbbbbbbbb'; }, h => { h.context.routeId = 'bbbbbbbbbbb'; },
    h => { h.context.preferredQualityNavigationPending = true; }, h => { h.context.videoMirrorPageSuspended = true; },
    h => { h.context.targetAvailable = false; },
  ]) {
    const h = harness(); h.context.schedulePreferredQualityAttempts(); customise(h); h.advance(20000);
    assert.deepEqual(h.calls, []);
  }
});

test('adverts defer startup work until content metadata, without timers running throughout a long preroll', () => {
  const h = harness(); h.classes.add('ad-showing');
  h.context.schedulePreferredQualityAttempts(); assert.equal(h.timers.size, 0); assert.deepEqual(h.calls, []);
  h.classes.clear(); h.context.handlePreferredQualityMetadata({ target: h.video }); h.advance(0);
  assert.equal(h.calls.length, 1);
  const late = harness(); late.context.schedulePreferredQualityAttempts(); late.classes.add('ad-interrupting'); late.advance(0);
  assert.equal(late.timers.size, 0); assert.equal(late.context.preferredQualityVideoId, '');
  late.classes.clear(); late.context.handlePreferredQualityMetadata({ target: late.video }); late.advance(1000);
  assert.equal(late.calls.length, 1);
});

test('trusted native settings interaction yields without consuming the event or undoing a manual choice', () => {
  for (const event of [{ type: 'click' }, { type: 'keydown', key: 'Enter' }, { type: 'keydown', key: ' ' }]) {
    const h = harness({ confirm: false }); h.context.schedulePreferredQualityAttempts(); h.advance(0);
    const control = { closest: () => h.player };
    h.context.handleManualQualitySelection({ ...event, isTrusted: true, target: { control },
      preventDefault() { assert.fail('Native input must not be cancelled'); }, stopPropagation() { assert.fail('Native input must propagate'); } });
    h.player.quality = 'large'; h.context.schedulePreferredQualityAttempts(); h.context.handlePreferredQualityMetadata({ target: h.video });
    h.advance(20000); assert.equal(h.calls.length, 1); assert.equal(h.player.quality, 'large');
  }
});

test('unrelated keys, synthetic events, foreign controls and preview metadata do not interfere', () => {
  const h = harness({ confirm: false }); h.context.schedulePreferredQualityAttempts();
  for (const event of [
    { type: 'click', isTrusted: false, target: { control: { closest: () => h.player } } },
    { type: 'keydown', key: 'k', isTrusted: true, target: { control: { closest: () => h.player } } },
    { type: 'click', isTrusted: true, target: { control: { closest: () => ({}) } } },
    { type: 'click', isTrusted: true, target: null },
  ]) h.context.handleManualQualitySelection(event);
  h.context.handlePreferredQualityMetadata({ target: {} });
  assert.equal(h.timers.size, 6); h.advance(20000); assert.equal(h.calls.length, 6);
});

test('an already-open native settings menu cancels startup requests', () => {
  const h = harness(); h.player.menu = { visible: true };
  h.context.schedulePreferredQualityAttempts(); h.advance(20000);
  assert.deepEqual(h.calls, []); assert.equal(h.timers.size, 0);
});

test('cancellation clears all timer registrations; a new video gets its own bounded preference', () => {
  const h = harness({ confirm: false }); h.context.schedulePreferredQualityAttempts(); h.advance(0);
  h.context.clearPreferredQualityAttempts(); assert.equal(h.timers.size, 0); assert.equal(h.context.preferredQualityRetryTimers.size, 0);
  h.player.id = h.context.routeId = 'bbbbbbbbbbb'; h.context.schedulePreferredQualityAttempts(); h.advance(30000);
  assert.equal(h.calls.filter(call => call.id === 'aaaaaaaaaaa').length, 1);
  assert.equal(h.calls.filter(call => call.id === 'bbbbbbbbbbb').length, 6);
});

test('quality lifecycle uses existing route events, cancels on navigation/suspension and registers no observer or polling interval', () => {
  for (const name of ['handleNavigateStart']) assert.match(extract(name), /clearPreferredQualityAttempts\(\)/);
  const pagehide = SOURCE.slice(SOURCE.lastIndexOf('    "pagehide",'), SOURCE.lastIndexOf('    "pageshow",'));
  assert.match(pagehide, /clearPreferredQualityAttempts\(\)/);
  const body = functions.map(extract).join('\n');
  assert.doesNotMatch(body, /setInterval|new MutationObserver|\.play\(|\.pause\(|playVideo|pauseVideo|location\.reload/);
  assert.match(SOURCE, /if \(CONFIG\.preferredVideoQuality !== "off"\) \{/);
});
