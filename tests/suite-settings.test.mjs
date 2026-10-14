import assert from "node:assert/strict";
import { test } from "node:test";
import { createSuiteSettings } from "../sources/suite-settings.mjs";

function fixture(seed = {}) {
  const data = new Map(Object.entries(seed));
  const storage = {
    getItem: key => data.get(key) ?? null,
    setItem: (key, value) => data.set(key, value),
    removeItem: key => data.delete(key),
  };
  return { storage, data, settings: createSuiteSettings(() => storage, () => true) };
}

test("settings preserve current defaults and ignore unrecognised or unsafe values", () => {
  const { settings } = fixture();
  assert.equal(settings.initial.viewerColour, "#82A3E6");
  assert.equal(settings.initial.ownerColour, "#FF9F1C");
  const checked = settings.validate(JSON.parse('{"hideShorts":"false","wheelStep":"999","viewerColour":"red;display:none","ownerColour":"00695c","__proto__":{"polluted":true},"queueRecovery":false}'));
  assert.equal(checked.hideShorts, true);
  assert.equal(checked.wheelStep, "5");
  assert.equal(checked.viewerColour, "#82A3E6");
  assert.equal(checked.ownerColour, "#00695C");
  assert.equal(Object.hasOwn(checked, "queueRecovery"), false);
  assert.equal({}.polluted, undefined);
});

test("malformed, oversized and unsupported storage records safely fall back", () => {
  const key = "yt-master-suite.settings.v1";
  for (const raw of ["{", " ".repeat(8193), '{"version":2,"values":{"hideShorts":false}}', '{"version":1,"values":[]}']) {
    const { settings } = fixture({ [key]: raw });
    assert.deepEqual(settings.initial, settings.defaults);
  }
  const unavailable = createSuiteSettings(() => { throw Error("denied"); }, () => false);
  assert.deepEqual(unavailable.initial, unavailable.defaults);
  assert.equal(unavailable.save(unavailable.defaults).ok, false);
});

test("button preferences migrate older records and validate icon choices without losing existing settings", () => {
  const { settings } = fixture({ 'yt-master-suite.settings.v1': JSON.stringify({ version: 1, values: { colourMode: 'custom', viewerColour: '#ABCDEF', hideShorts: false } }) });
  assert.equal(settings.initial.headerSettingsIcon, 'colour');
  assert.equal(settings.initial.playerSettingsIcon, 'monochrome');
  assert.equal(settings.initial.viewerColour, '#ABCDEF');
  assert.equal(settings.initial.hideShorts, false);
  assert.equal(settings.validate({ headerSettingsIcon: 'url(javascript:bad)', playerSettingsIcon: false }).headerSettingsIcon, 'colour');
  assert.equal(settings.validate({ headerSettingsIcon: 'monochrome', playerSettingsIcon: 'colour' }).playerSettingsIcon, 'colour');
});

test("DeArrow queue-logo preferences default on and migrate older records without changing existing settings", () => {
  const key = "yt-master-suite.settings.v1";
  const { settings } = fixture({ [key]: JSON.stringify({ version: 1, values: {
    colourMode: "custom", viewerColour: "#ABCDEF", hideRelated: false, queueInfo: false,
  } }) });
  assert.equal(settings.key, key);
  assert.equal(settings.defaults.showDeArrowQueueButton, true);
  assert.equal(settings.initial.showDeArrowQueueButton, true);
  assert.equal(settings.initial.viewerColour, "#ABCDEF");
  assert.equal(settings.initial.hideRelated, false);
  assert.equal(settings.initial.queueInfo, false);
  assert.deepEqual(settings.overrides("watchLayoutCleaner", { relatedVideosHideBreakpointPx: 1400 }), {
    relatedVideosHideBreakpointPx: 0, showDeArrowQueueButton: true,
  });
});

test("DeArrow queue-logo preference accepts only booleans", () => {
  const { settings } = fixture();
  for (const value of ["false", "off", 0, 1, null, [], {}, "url(javascript:bad)"]) {
    assert.equal(settings.validate({ showDeArrowQueueButton: value }).showDeArrowQueueButton, true);
  }
  assert.equal(settings.validate({ showDeArrowQueueButton: false }).showDeArrowQueueButton, false);
  assert.equal(settings.validate({ showDeArrowQueueButton: true }).showDeArrowQueueButton, true);
});

test("hiding the DeArrow queue logo persists for reload and maps only to layout configuration", () => {
  const { settings, storage, data } = fixture();
  const result = settings.save({ ...settings.defaults, showDeArrowQueueButton: false });
  assert.equal(result.ok, true);
  assert.equal(result.values.showDeArrowQueueButton, false);
  assert.equal(settings.initial.showDeArrowQueueButton, true);
  assert.equal(settings.read().showDeArrowQueueButton, false);
  assert.equal(settings.overrides("watchLayoutCleaner", { relatedVideosHideBreakpointPx: 1400 }).showDeArrowQueueButton, true);
  const record = JSON.parse(data.get(settings.key));
  assert.equal(record.version, 1);
  assert.equal(record.values.showDeArrowQueueButton, false);
  const reloaded = createSuiteSettings(() => storage, () => true);
  assert.deepEqual(reloaded.overrides("watchLayoutCleaner", { relatedVideosHideBreakpointPx: 1400 }), {
    relatedVideosHideBreakpointPx: 1400, showDeArrowQueueButton: false,
  });
  assert.deepEqual(reloaded.overrides("scrollMiniplayer", {}), { enabled: true, showCompactQueueInfo: true });
  assert.deepEqual(reloaded.overrides("pageCoherence", {}), {});
  assert.deepEqual(Array.from(data.keys()), [settings.key, "yt-master-suite.scroll-miniplayer.corner.v1"]);
});

test("both settings buttons cannot be saved as Off, and a manually hidden pair recovers header access", () => {
  const { settings, data } = fixture();
  assert.equal(settings.save({ ...settings.defaults, headerSettingsIcon: 'off', playerSettingsIcon: 'colour' }).ok, true);
  const previous = data.get(settings.key);
  assert.deepEqual(settings.save({ ...settings.defaults, headerSettingsIcon: 'off', playerSettingsIcon: 'off' }), {
    ok: false, error: 'Keep at least one settings button enabled.',
  });
  assert.equal(data.get(settings.key), previous);
  data.set(settings.key, JSON.stringify({ version: 1, values: { headerSettingsIcon: 'off', playerSettingsIcon: 'off' } }));
  assert.equal(settings.read().headerSettingsIcon, 'colour');
  assert.equal(settings.read().playerSettingsIcon, 'off');
});

test('quality preference migrates as Off, validates the whitelist and preserves existing choices', () => {
  const { settings } = fixture({ 'yt-master-suite.settings.v1': JSON.stringify({ version: 1, values: {
    disableTitleHashtagLinks: true, hideShorts: false, showDeArrowQueueButton: false,
  } }) });
  assert.equal(settings.initial.preferredVideoQuality, 'off');
  assert.equal(settings.initial.disableTitleHashtagLinks, true);
  assert.equal(settings.initial.hideShorts, false);
  assert.equal(settings.initial.showDeArrowQueueButton, false);
  for (const invalid of ['auto', '1080p', 'highres', 'bad', 'hd4320', true, null, {}, ['hd1080']]) {
    assert.equal(settings.validate({ preferredVideoQuality: invalid }).preferredVideoQuality, 'off');
  }
  for (const valid of ['off', 'highest', 'tiny', 'small', 'medium', 'large', 'hd720', 'hd1080', 'hd1440', 'hd2160']) {
    assert.equal(settings.validate({ preferredVideoQuality: valid }).preferredVideoQuality, valid);
  }
});

test('saved quality preference changes only the next Player Preferences snapshot', () => {
  const { settings, storage } = fixture();
  const config = { feedFilterProfiles: {} };
  const original = settings.overrides('playerPreferencesLite', config);
  assert.equal(settings.save({ ...settings.defaults, preferredVideoQuality: 'hd1080', disableTitleHashtagLinks: true }).ok, true);
  assert.equal(settings.initial.preferredVideoQuality, 'off');
  assert.deepEqual(settings.overrides('playerPreferencesLite', config), original);
  const next = createSuiteSettings(() => storage, () => true);
  assert.deepEqual(next.overrides('playerPreferencesLite', config), {
    ...original, preferredVideoQuality: 'hd1080', disableTitleHashtagLinks: true,
  });
  assert.deepEqual(next.overrides('scrollMiniplayer', {}), { enabled: true, showCompactQueueInfo: true });
  assert.deepEqual(next.overrides('pageCoherence', {}), {});
});

test("title hashtag-link preference is opt-in, migrates older records and accepts only booleans", () => {
  const { settings } = fixture({ 'yt-master-suite.settings.v1': JSON.stringify({ version: 1, values: {
    hideShorts: false, showDeArrowQueueButton: false,
  } }) });
  assert.equal(settings.defaults.disableTitleHashtagLinks, false);
  assert.equal(settings.initial.disableTitleHashtagLinks, false);
  assert.equal(settings.initial.hideShorts, false);
  assert.equal(settings.initial.showDeArrowQueueButton, false);
  for (const value of ['true', 'false', 0, 1, null, [], {}]) {
    assert.equal(settings.validate({ disableTitleHashtagLinks: value }).disableTitleHashtagLinks, false);
  }
  assert.equal(settings.validate({ disableTitleHashtagLinks: true }).disableTitleHashtagLinks, true);
});

test("title hashtag-link choice persists for reload without changing DeArrow or recovery settings", () => {
  const { settings, storage } = fixture();
  assert.equal(settings.save({ ...settings.defaults, disableTitleHashtagLinks: true }).ok, true);
  assert.equal(settings.initial.disableTitleHashtagLinks, false);
  assert.equal(settings.read().disableTitleHashtagLinks, true);
  const config = { feedFilterProfiles: {} };
  const before = settings.overrides('playerPreferencesLite', config);
  const next = createSuiteSettings(() => storage, () => true);
  assert.deepEqual(next.overrides('playerPreferencesLite', config), { ...before, disableTitleHashtagLinks: true });
  assert.deepEqual(next.overrides('watchLayoutCleaner', { relatedVideosHideBreakpointPx: 1400 }), {
    relatedVideosHideBreakpointPx: 1400, showDeArrowQueueButton: true,
  });
  assert.deepEqual(next.overrides('pageCoherence', {}), {});
});

test("saving is persistent but does not mutate the running configuration snapshot", () => {
  const { settings, storage } = fixture();
  const result = settings.save({ ...settings.defaults, colourMode: "custom", viewerColour: "abcdef", mirrorButton: false });
  assert.equal(result.ok, true);
  assert.equal(settings.initial.mirrorButton, true);
  assert.equal(settings.read().mirrorButton, false);
  const reloaded = createSuiteSettings(() => storage, () => true);
  assert.equal(reloaded.initial.viewerColour, "#ABCDEF");
  assert.equal(reloaded.overrides("playerPreferencesLite", { feedFilterProfiles: {} }).enableVideoMirrorButton, false);
});

test("corner preferences use the existing synchronised corner, including later arrow changes", () => {
  const { settings, data } = fixture({ "yt-master-suite.scroll-miniplayer.corner.v1": "bottom-left" });
  assert.equal(settings.initial.corner, "bottom-left");
  assert.equal(settings.save({ ...settings.defaults, corner: "bottom-right" }).ok, true);
  assert.equal(data.get("yt-master-suite.scroll-miniplayer.corner.v1"), "bottom-right");
  data.set("yt-master-suite.scroll-miniplayer.corner.v1", "top-left");
  assert.equal(settings.read().corner, "top-left");
});

test("a failed corner write rolls back the settings record and reports failure", () => {
  const { settings, storage, data } = fixture();
  storage.setItem = (key, value) => {
    if (key.includes("corner")) throw Error("quota");
    data.set(key, value);
  };
  assert.equal(settings.save({ ...settings.defaults, corner: "bottom-left" }).ok, false);
  assert.equal(data.has(settings.key), false);
});

test("preset palettes adapt to theme; Off touches styling only", () => {
  const { settings } = fixture();
  const draft = { ...settings.defaults, colourMode: "preset" };
  assert.deepEqual(settings.colours(draft, true), ["#80CBC4", "#FFAB91"]);
  assert.deepEqual(settings.colours(draft, false), ["#00695C", "#A83222"]);
  assert.equal(settings.colours({ ...draft, colourMode: "off" }), null);
  const { storage } = fixture();
  const first = createSuiteSettings(() => storage, () => true);
  first.save({ ...first.defaults, colourMode: "off" });
  const reloaded = createSuiteSettings(() => storage, () => true);
  const commentOverrides = reloaded.overrides("commentCleaner", {});
  assert.equal(commentOverrides.colourCommenters, false);
  assert.equal(commentOverrides.hideCommentControls, true);
  assert.equal(Object.keys(commentOverrides).some(name => /guard|recovery|queue/i.test(name)), false);
});

test("watched-video setting preserves the Watch History exception and unrelated filters", () => {
  const { settings } = fixture();
  const config = { feedFilterProfiles: {
    home: { watchedVideos: true, upcomingStreams: true }, history: { watchedVideos: false, payToWatchCards: true },
  } };
  const result = settings.overrides("playerPreferencesLite", config);
  assert.equal(result.feedFilterProfiles.history.watchedVideos, false);
  assert.equal(result.feedFilterProfiles.home.watchedVideos, true);
  assert.equal(result.feedFilterProfiles.home.upcomingStreams, true);
  assert.equal(result.feedFilterProfiles.history.payToWatchCards, true);
  assert.equal(result.watchedVideoThresholdPercent, 90);
  assert.equal(result.wheelVolumeStep, 5);
  assert.deepEqual(config.feedFilterProfiles.home, { watchedVideos: true, upcomingStreams: true });
  assert.equal(settings.overrides("watchLayoutCleaner", { relatedVideosHideBreakpointPx: 1400 }).relatedVideosHideBreakpointPx, 1400);
});

test("every exposed feature toggle maps to existing configuration without touching recovery internals", () => {
  const { settings, storage } = fixture();
  const disabled = Object.fromEntries(Object.entries(settings.defaults).map(([key, value]) => [key, typeof value === "boolean" ? false : value]));
  settings.save({ ...disabled, watchedThreshold: "95", wheelStep: "2" });
  const next = createSuiteSettings(() => storage, () => true);
  const player = next.overrides("playerPreferencesLite", { feedFilterProfiles: { home: { watchedVideos: true }, history: { watchedVideos: false } } });
  for (const key of ["hideShorts", "hideWatchedVideos", "useReadableYellowCaptions", "enableVideoMirrorButton", "enableTheaterMode", "enablePlayerWheelVolume", "hideRelatedVideos", "hideChat", "hideInfoCards", "hideEndScreenRecommendationGrid", "enableFullscreenComments"]) {
    assert.equal(player[key], false, key);
  }
  assert.equal(player.watchedVideoThresholdPercent, 95);
  assert.equal(player.wheelVolumeStep, 2);
  assert.equal(player.feedFilterProfiles.home.watchedVideos, false);
  assert.deepEqual(next.overrides("scrollMiniplayer", {}), { enabled: false, showCompactQueueInfo: false });
  assert.deepEqual(next.overrides("feedUiCleaner", { filterProfiles: { home: { mixes: true, membersOnly: true, podcasts: true } } }), {
    filterProfiles: { home: { mixes: false, membersOnly: false, podcasts: false } },
  });
  assert.deepEqual(next.overrides("watchLayoutCleaner", { relatedVideosHideBreakpointPx: 1400 }), {
    relatedVideosHideBreakpointPx: 0, showDeArrowQueueButton: false,
  });
  assert.deepEqual(next.overrides("pageCoherence", {}), {});
});
