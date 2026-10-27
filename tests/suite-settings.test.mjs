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

test('presentation preferences preserve defaults, validate choices and map to the player', () => {
  const { settings, storage } = fixture();
  assert.equal(settings.initial.keepHoverPreviews, false);
  assert.equal(settings.initial.timeDisplayMode, 'native');
  for (const mode of ['native', 'elapsed', 'remaining']) {
    assert.equal(settings.save({ ...settings.defaults, timeDisplayMode: mode, keepHoverPreviews: true }).ok, true);
    const next = createSuiteSettings(() => storage, () => true).overrides('playerPreferencesLite', { feedFilterProfiles: {} });
    assert.equal(next.timeDisplayMode, mode); assert.equal(next.keepHoverPreviews, true);
  }
  for (const mode of ['other', null, {}, 1]) assert.equal(settings.validate({ timeDisplayMode: mode }).timeDisplayMode, 'native');
  assert.equal(settings.validate({ keepHoverPreviews: 'true' }).keepHoverPreviews, false);
});

test('timeline preview defaults to automatic and validates, saves and maps bounded choices', () => {
  const { settings, storage } = fixture();
  assert.equal(settings.initial.timelinePreviewSize, 'auto');
  for (const size of ['auto', 'small', 'medium', 'large', 'native']) {
    assert.equal(settings.validate({ timelinePreviewSize: size }).timelinePreviewSize, size);
    assert.equal(settings.save({ ...settings.defaults, timelinePreviewSize: size }).ok, true);
    const reloaded = createSuiteSettings(() => storage, () => true);
    assert.equal(reloaded.overrides('playerPreferencesLite', { feedFilterProfiles: {} }).timelinePreviewSize, size);
  }
  for (const size of ['9999', 480, null, {}, 'scale(999)', 'url(javascript:bad)']) {
    assert.equal(settings.validate({ timelinePreviewSize: size }).timelinePreviewSize, 'auto');
  }
});

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

test('live-card controls preserve older defaults and reject non-boolean settings', () => {
  const { settings } = fixture({ 'yt-master-suite.settings.v1': JSON.stringify({ version: 1,
    values: { hideWatchedVideos: false, hideChat: false } }) });
  assert.equal(settings.defaults.hideLiveVideos, false);
  assert.equal(settings.defaults.hideUpcomingStreams, true);
  assert.equal(settings.initial.hideLiveVideos, false);
  assert.equal(settings.initial.hideUpcomingStreams, true);
  assert.equal(settings.initial.hideWatchedVideos, false);
  assert.equal(settings.initial.hideChat, false);
  for (const value of ['true', 'false', 0, 1, null, [], {}]) {
    assert.equal(settings.validate({ hideLiveVideos: value }).hideLiveVideos, false);
    assert.equal(settings.validate({ hideUpcomingStreams: value }).hideUpcomingStreams, true);
  }
});

test('live and upcoming card controls save and map independently after reload', () => {
  const { settings, storage } = fixture();
  const config = { feedFilterProfiles: { home: { watchedVideos: true, upcomingStreams: true } } };
  assert.equal(settings.save({ ...settings.defaults, hideLiveVideos: true, hideUpcomingStreams: false }).ok, true);
  assert.equal(settings.initial.hideLiveVideos, false);
  assert.equal(settings.initial.hideUpcomingStreams, true);
  const reloaded = createSuiteSettings(() => storage, () => true);
  assert.equal(reloaded.read().hideLiveVideos, true);
  assert.equal(reloaded.read().hideUpcomingStreams, false);
  const mapped = reloaded.overrides('playerPreferencesLite', config);
  assert.equal(mapped.hideLiveVideos, true);
  assert.equal(mapped.hideUpcomingStreams, false);
  assert.equal(mapped.feedFilterProfiles.home.upcomingStreams, true, 'Route profiles stay independent of the global switches');
  assert.deepEqual(config, { feedFilterProfiles: { home: { watchedVideos: true, upcomingStreams: true } } });
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

test("RYD tooltip-bar visibility defaults off without changing older saved preferences", () => {
  const key = "yt-master-suite.settings.v1";
  const { settings } = fixture({ [key]: JSON.stringify({ version: 1, values: {
    showDeArrowTitleButton: true, showDeArrowQueueButton: false, hideChat: false,
  } }) });
  assert.equal(settings.defaults.showRydTooltipBar, false);
  assert.equal(settings.initial.showRydTooltipBar, false);
  assert.equal(settings.initial.showDeArrowTitleButton, true);
  assert.equal(settings.initial.showDeArrowQueueButton, false);
  assert.equal(settings.initial.hideChat, false);
  assert.equal(settings.overrides("playerPreferencesLite", { feedFilterProfiles: {} }).showRydTooltipBar, false);
});

test("menu preferences migrate without changing watched thresholds or existing choices", () => {
  const { settings } = fixture({ 'yt-master-suite.settings.v1': JSON.stringify({ version: 1, values: {
    watchedThreshold: '95', hideWatchedVideos: false, showDeArrowTitleButton: true,
  } }) });
  assert.equal(settings.initial.menuShowDownload, false);
  assert.equal(settings.initial.menuGroupChannelTools, true);
  assert.equal(settings.initial.menuShowAgeLimit, true);
  assert.equal(settings.initial.menuShowNotInterested, true);
  assert.equal(settings.initial.menuShowDontRecommend, true);
  assert.equal(settings.initial.menuShowReport, true);
  assert.equal(settings.initial.watchedThreshold, '95');
  assert.equal(settings.initial.hideWatchedVideos, false);
  assert.equal(settings.initial.showDeArrowTitleButton, true);
  assert.ok(Object.isFrozen(settings.initial.menuItemOrder));
});

test("menu order is a bounded whitelist without duplicate, unknown or executable entries", () => {
  const { settings } = fixture();
  const order = settings.validate({ menuItemOrder: ['share', 'share', 'report', '<script>', null, {}] }).menuItemOrder;
  assert.deepEqual(order.slice(0, 2), ['share', 'report']);
  assert.equal(order.length, settings.defaults.menuItemOrder.length);
  assert.equal(new Set(order).size, order.length);
  assert.ok(order.every(item => settings.defaults.menuItemOrder.includes(item)));
  for (const value of [null, {}, 'share', Array(100).fill('share')]) {
    assert.deepEqual(settings.validate({ menuItemOrder: value }).menuItemOrder, settings.defaults.menuItemOrder);
  }
  const validated = settings.validate({});
  validated.menuItemOrder.reverse();
  assert.deepEqual(settings.initial.menuItemOrder, settings.defaults.menuItemOrder);
});

test("previous default menu order adopts filter-first channel tools without changing customised orders", () => {
  const previous = ['playNext', 'addToQueue', 'watchLater', 'savePlaylist', 'download', 'share',
    'notInterested', 'dontRecommend', 'report', 'channelAge', 'channelTools'];
  const key = 'yt-master-suite.settings.v1';
  const { settings } = fixture({ [key]: JSON.stringify({ version: 1, values: {
    menuItemOrder: previous, watchedThreshold: '95', menuShowDownload: true,
  } }) });
  assert.deepEqual(settings.initial.menuItemOrder.slice(-4), ['channelAge', 'dontRecommend', 'report', 'channelTools']);
  assert.equal(settings.initial.watchedThreshold, '95');
  assert.equal(settings.initial.menuShowDownload, true);
  const customised = ['share', ...previous.filter(id => id !== 'share')];
  assert.deepEqual(settings.validate({ menuItemOrder: customised }).menuItemOrder, customised);
  assert.deepEqual(previous.slice(-4), ['dontRecommend', 'report', 'channelAge', 'channelTools']);
});

test("menu visibility and order persist for reload without modifying active preferences or module overrides", () => {
  const { settings, storage } = fixture();
  const values = { ...settings.defaults, menuShowDownload: true, menuGroupChannelTools: false,
    menuShowReport: false, menuItemOrder: ['share', ...settings.defaults.menuItemOrder.filter(item => item !== 'share')] };
  const before = settings.overrides('watchLayoutCleaner', { relatedVideosHideBreakpointPx: 1400 });
  assert.equal(settings.save(values).ok, true);
  values.menuItemOrder.reverse();
  assert.equal(settings.initial.menuShowDownload, false);
  assert.equal(settings.initial.menuItemOrder[0], 'playNext');
  const next = createSuiteSettings(() => storage, () => true);
  assert.equal(next.initial.menuShowDownload, true);
  assert.equal(next.initial.menuGroupChannelTools, false);
  assert.equal(next.initial.menuShowReport, false);
  assert.equal(next.initial.menuItemOrder[0], 'share');
  assert.deepEqual(next.overrides('watchLayoutCleaner', { relatedVideosHideBreakpointPx: 1400 }), before);
  for (const name of ['menuShowDownload', 'menuGroupChannelTools', 'menuShowAgeLimit',
    'menuShowNotInterested', 'menuShowDontRecommend', 'menuShowReport']) {
    assert.equal(settings.validate({ [name]: 'false' })[name], settings.defaults[name]);
  }
});

test("RYD tooltip-bar preference validates booleans and applies only to the reloaded player configuration", () => {
  const { settings, storage } = fixture();
  for (const value of ["true", "false", "off", 0, 1, null, [], {}, "url(javascript:bad)"]) {
    assert.equal(settings.validate({ showRydTooltipBar: value }).showRydTooltipBar, false);
  }
  assert.equal(settings.validate({ showRydTooltipBar: true }).showRydTooltipBar, true);
  assert.equal(settings.save({ ...settings.defaults, showRydTooltipBar: true }).ok, true);
  assert.equal(settings.initial.showRydTooltipBar, false);
  assert.equal(settings.read().showRydTooltipBar, true);
  const reloaded = createSuiteSettings(() => storage, () => true);
  assert.equal(reloaded.overrides("playerPreferencesLite", { feedFilterProfiles: {} }).showRydTooltipBar, true);
  assert.equal(reloaded.initial.showDeArrowTitleButton, false);
  assert.deepEqual(reloaded.overrides("watchLayoutCleaner", { relatedVideosHideBreakpointPx: 1400 }), {
    relatedVideosHideBreakpointPx: 1400, showDeArrowQueueButton: true,
  });
});

test("DeArrow title icon defaults off while older records keep queue and existing preferences", () => {
  const key = "yt-master-suite.settings.v1";
  const { settings } = fixture({ [key]: JSON.stringify({ version: 1, values: {
    showDeArrowQueueButton: false, viewerColour: "#ABCDEF", hideChat: false,
  } }) });
  assert.equal(settings.defaults.showDeArrowTitleButton, false);
  assert.equal(settings.initial.showDeArrowTitleButton, false);
  assert.equal(settings.initial.showDeArrowQueueButton, false);
  assert.equal(settings.initial.viewerColour, "#ABCDEF");
  assert.equal(settings.initial.hideChat, false);
  assert.equal(settings.overrides("playerPreferencesLite", { feedFilterProfiles: {} }).showDeArrowTitleButton, false);
});

test("DeArrow title-icon preference accepts only booleans and stays separate from its queue icon", () => {
  const { settings, storage } = fixture();
  for (const value of ["true", "false", "off", 0, 1, null, [], {}, "url(javascript:bad)"]) {
    assert.equal(settings.validate({ showDeArrowTitleButton: value }).showDeArrowTitleButton, false);
  }
  assert.equal(settings.validate({ showDeArrowTitleButton: true }).showDeArrowTitleButton, true);
  assert.equal(settings.save({ ...settings.defaults, showDeArrowTitleButton: true, showDeArrowQueueButton: false }).ok, true);
  assert.equal(settings.initial.showDeArrowTitleButton, false, "Saving must not mutate the running snapshot");
  assert.equal(settings.read().showDeArrowTitleButton, true);
  const reloaded = createSuiteSettings(() => storage, () => true);
  assert.equal(reloaded.overrides("playerPreferencesLite", { feedFilterProfiles: {} }).showDeArrowTitleButton, true);
  assert.deepEqual(reloaded.overrides("watchLayoutCleaner", { relatedVideosHideBreakpointPx: 1400 }), {
    relatedVideosHideBreakpointPx: 1400, showDeArrowQueueButton: false,
  });
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

test('live chat button defaults on in older records and accepts only boolean choices', () => {
  const { settings } = fixture({ 'yt-master-suite.settings.v1': JSON.stringify({ version: 1, values: {
    hideChat: false, mirrorButton: false, preferredVideoQuality: 'hd1080',
  } }) });
  assert.equal(settings.defaults.liveChatButton, true);
  assert.equal(settings.initial.liveChatButton, true);
  assert.equal(settings.initial.hideChat, false);
  assert.equal(settings.initial.mirrorButton, false);
  assert.equal(settings.initial.preferredVideoQuality, 'hd1080');
  for (const value of ['true', 'false', 0, 1, null, [], {}]) {
    assert.equal(settings.validate({ liveChatButton: value }).liveChatButton, true);
  }
  assert.equal(settings.validate({ liveChatButton: false }).liveChatButton, false);
  assert.equal(settings.validate({ liveChatButton: true }).liveChatButton, true);
});

test('live chat button preference persists independently of chat visibility and the running snapshot', () => {
  const { settings, storage, data } = fixture();
  const config = { feedFilterProfiles: {} };
  const original = settings.overrides('playerPreferencesLite', config);
  assert.equal(original.enableLiveChatButton, true);
  assert.equal(original.hideChat, true);
  assert.equal(settings.save({ ...settings.defaults, liveChatButton: false, hideChat: false }).ok, true);
  assert.equal(settings.read().liveChatButton, false);
  assert.equal(JSON.parse(data.get(settings.key)).values.liveChatButton, false);
  assert.deepEqual(settings.overrides('playerPreferencesLite', config), original);
  const next = createSuiteSettings(() => storage, () => true);
  assert.deepEqual(next.overrides('playerPreferencesLite', config), {
    ...original, enableLiveChatButton: false, hideChat: false,
  });
  assert.deepEqual(next.overrides('watchLayoutCleaner', { relatedVideosHideBreakpointPx: 1400 }), {
    relatedVideosHideBreakpointPx: 1400, showDeArrowQueueButton: true,
  });
  assert.deepEqual(next.overrides('pageCoherence', {}), {});
  assert.equal(next.save({ ...next.read(), liveChatButton: next.defaults.liveChatButton }).ok, true);
  const restored = createSuiteSettings(() => storage, () => true);
  assert.equal(restored.initial.liveChatButton, true);
  assert.equal(restored.initial.hideChat, false);
});

test('fullscreen action-strip hiding defaults off and migrates older records without changing existing choices', () => {
  const { settings } = fixture({ 'yt-master-suite.settings.v1': JSON.stringify({ version: 1, values: {
    hideChat: false, showRydTooltipBar: true, preferredVideoQuality: 'hd1080',
  } }) });
  assert.equal(settings.defaults.hideFullscreenQuickActions, false);
  assert.equal(settings.initial.hideFullscreenQuickActions, false);
  assert.equal(settings.initial.hideChat, false);
  assert.equal(settings.initial.showRydTooltipBar, true);
  assert.equal(settings.initial.preferredVideoQuality, 'hd1080');
  for (const value of ['true', 'false', 0, 1, null, [], {}]) {
    assert.equal(settings.validate({ hideFullscreenQuickActions: value }).hideFullscreenQuickActions, false);
  }
  assert.equal(settings.validate({ hideFullscreenQuickActions: true }).hideFullscreenQuickActions, true);
});

test('fullscreen action-strip preference saves for reload and restores to off without changing other player options', () => {
  const { settings, storage } = fixture();
  const config = { feedFilterProfiles: {} };
  const before = settings.overrides('playerPreferencesLite', config);
  assert.equal(before.hideFullscreenQuickActions, false);
  assert.equal(settings.save({ ...settings.defaults, hideFullscreenQuickActions: true, hideChat: false }).ok, true);
  assert.equal(settings.read().hideFullscreenQuickActions, true);
  assert.deepEqual(settings.overrides('playerPreferencesLite', config), before, 'Saving leaves the running snapshot unchanged');
  const next = createSuiteSettings(() => storage, () => true);
  assert.deepEqual(next.overrides('playerPreferencesLite', config), { ...before, hideFullscreenQuickActions: true, hideChat: false });
  assert.equal(next.save({ ...next.read(), hideFullscreenQuickActions: next.defaults.hideFullscreenQuickActions }).ok, true);
  const restored = createSuiteSettings(() => storage, () => true);
  assert.equal(restored.initial.hideFullscreenQuickActions, false);
  assert.equal(restored.initial.hideChat, false);
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

test('failed settings or corner writes preserve concurrent settings saves and clears', () => {
  for (const existing of [null, JSON.stringify({ version:1, values:{ hideChat:false } })]) {
    for (const stage of ['settings', 'corner']) {
      for (const concurrent of [null, JSON.stringify({ version:1, values:{ hideRelated:false } })]) {
        const key='yt-master-suite.settings.v1';
        const {settings,storage,data}=fixture(existing===null?{}:{[key]:existing});
        storage.setItem=(target,value)=>{
          if ((stage==='settings' && target===key) || (stage==='corner' && target===settings.cornerKey)) {
            if (concurrent===null) data.delete(key); else data.set(key,concurrent);
            throw Error('quota');
          }
          data.set(target,value);
        };
        assert.equal(settings.save({...settings.defaults,corner:'bottom-left'}).ok,false);
        assert.equal(data.get(key)??null,concurrent,`${stage} rollback must preserve a newer save or clear`);
      }
    }
  }
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
  for (const key of ["hideShorts", "hideWatchedVideos", "hideLiveVideos", "hideUpcomingStreams", "useReadableYellowCaptions", "enableVideoMirrorButton", "enableLiveChatButton", "enableTheaterMode", "enablePlayerWheelVolume", "hideRelatedVideos", "hideChat", "hideInfoCards", "hideEndScreenRecommendationGrid", "enableFullscreenComments"]) {
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
