import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

const SOURCE = readFileSync(
  new URL("../sources/modules/youtube-player-preferences-lite.user.js", import.meta.url),
  "utf8",
);
const ATTRIBUTE = "data-ytppl-fullscreen-comments";
const EXCLUDED_SELECTOR = SOURCE.match(
  /const FULLSCREEN_WHEEL_EXCLUDED_SELECTOR = (\[[\s\S]*?\]\.join\(","\));/,
)?.[1];
assert.ok(EXCLUDED_SELECTOR, "Missing fullscreen wheel exclusions");

function extractFunction(name) {
  const start = SOURCE.indexOf(`  function ${name}(`);
  assert.notEqual(start, -1, `Missing ${name}`);
  const end = SOURCE.indexOf("\n  function ", start + 1);
  assert.notEqual(end, -1, `Missing boundary after ${name}`);
  return SOURCE.slice(start, end);
}

class Element {
  constructor(tag, parent = null, selectors = []) {
    this.nodeType = 1;
    this.tag = tag;
    this.parentElement = parent;
    this.selectors = new Set([tag, ...selectors]);
    this.attributes = new Set();
    this.scrollTop = 0;
    this.clientHeight = 100;
    this.scrollHeight = 100;
    this.overflowY = "visible";
  }

  hasAttribute(name) { return this.attributes.has(name); }
  removeAttribute(name) { this.attributes.delete(name); }
  toggleAttribute(name, enabled) {
    if (enabled) this.attributes.add(name);
    else this.attributes.delete(name);
  }
  contains(element) {
    for (let node = element; node; node = node.parentElement) {
      if (node === this) return true;
    }
    return false;
  }
  closest(selector) {
    const selectors = selector.split(",");
    for (let node = this; node; node = node.parentElement) {
      if (selectors.some((part) => node.selectors.has(part.trim()))) return node;
    }
    return null;
  }
}

function createHarness() {
  const root = new Element("html");
  const app = new Element("ytd-app", root, ["ytd-app[fullscreen]"]);
  app.clientHeight = 1440;
  app.scrollHeight = 4463;
  const flexy = new Element("ytd-watch-flexy", app);
  const player = new Element("div", flexy, ["#movie_player", ".html5-video-player"]);
  const video = new Element("video", player);
  video.currentTime = 276.57721;
  video.paused = true;
  const comments = new Element("ytd-comments", flexy);
  const documentListeners = new Map();
  const windowListeners = new Map();
  const register = (map) => (type, handler, options) => {
    const entries = map.get(type) || [];
    entries.push({ handler, options });
    map.set(type, entries);
  };
  const document = {
    documentElement: root,
    fullscreenElement: root,
    addEventListener: register(documentListeners),
  };
  const context = vm.createContext({
    CONFIG: { enableFullscreenComments: true },
    FULLSCREEN_COMMENTS_ATTRIBUTE: ATTRIBUTE,
    Node: { ELEMENT_NODE: 1 },
    document,
    window: { addEventListener: register(windowListeners) },
    watchRoute: true,
    rightButtonHeldOnPlayer: false,
    getComputedStyle: (element) => element,
    isWatchPath: () => context.watchRoute,
    isExcludedSurface: () => false,
    getWatchFlexy: () => flexy,
  });
  const noops = [
    "ensureStyles", "convertCurrentShortsPage", "applyDynamicPreferences",
    "schedulePreferredQualityAttempts", "clearPreferredQualityAttempts", "scheduleLiveChatCollapseAttempts",
    "handleManualQualitySelection", "handlePreferredQualityMetadata",
    "scheduleTheaterModeAttempts", "configureDynamicMutationObserver",
    "schedulePlayerLayoutRefreshAttempts", "clearLiveChatCollapseAttempts",
    "clearPlayerLayoutRefreshAttempts", "cancelScheduledAnimationWork",
    "clearContextMenuSuppression", "handleShortsClick", "handleTheaterModeToggle",
    "handleDescriptionClick", "handleWheelVolume", "handleMouseDown",
    "handleMouseUp", "handleContextMenu", "handleWindowBlur", "scheduleApply",
    "scheduleVideoMirrorSync", "resetVideoMirror", "handleVideoMirrorMetadata",
    "scheduleLiveChatSync", "resetLiveChat",
    "hideVideoMirrorTooltip", "refreshVideoMirrorTooltip", "handleVideoMirrorKeyDown",
    "handleCleanVideoUrlSelection", "handleCleanVideoUrlCopy", "clearCleanVideoUrlCopy",
  ];
  noops.forEach((name) => { context[name] = () => {}; });
  vm.runInContext(
    `const FULLSCREEN_WHEEL_EXCLUDED_SELECTOR = ${EXCLUDED_SELECTOR};\n` +
      [
        "closestElement", "getPlayerFromTarget", "clamp",
        "buildFullscreenCommentsCss", "syncFullscreenComments",
        "hasNestedFullscreenWheelSurface", "handleFullscreenCommentsWheel",
        "applyRoutePreferences", "handleNavigateStart", "handleNavigateFinish",
      ].map(extractFunction).join("\n"),
    context,
  );
  const listenerStart = SOURCE.indexOf('  document.addEventListener("click", handleShortsClick, true);');
  assert.notEqual(listenerStart, -1);
  vm.runInContext(SOURCE.slice(listenerStart, SOURCE.lastIndexOf("})();")), context);
  context.applyRoutePreferences();

  return {
    context, root, app, flexy, player, video, comments, documentListeners,
    dispatch(type, target = "window") {
      const listeners = target === "document" ? documentListeners : windowListeners;
      for (const { handler } of listeners.get(type) || []) handler({ type });
    },
    wheel(overrides = {}) {
      const event = {
        target: video, deltaY: 120, deltaX: 0, deltaMode: 0,
        buttons: 0, cancelable: true, defaultPrevented: false,
        ctrlKey: false, altKey: false, metaKey: false, shiftKey: false,
        prevented: false, stopped: false,
        preventDefault() { this.prevented = true; },
        stopImmediatePropagation() { this.stopped = true; },
        ...overrides,
      };
      context.handleFullscreenCommentsWheel(event);
      return event;
    },
  };
}

test("fullscreen comments activate only for the actual HTML fullscreen watch page", () => {
  const h = createHarness();
  assert.equal(h.root.hasAttribute(ATTRIBUTE), true);
  for (const fullscreenElement of [null, h.player, h.app]) {
    h.context.document.fullscreenElement = fullscreenElement;
    h.dispatch("fullscreenchange", "document");
    assert.equal(h.root.hasAttribute(ATTRIBUTE), false);
  }
  h.context.document.fullscreenElement = h.root;
  h.context.watchRoute = false;
  h.context.syncFullscreenComments();
  assert.equal(h.root.hasAttribute(ATTRIBUTE), false);
  h.context.watchRoute = true;
  h.context.CONFIG.enableFullscreenComments = false;
  h.context.syncFullscreenComments();
  assert.equal(h.root.hasAttribute(ATTRIBUTE), false);
});

test("fullscreen comments marker follows navigation and page suspension without timers", () => {
  const h = createHarness();
  h.dispatch("yt-navigate-start");
  assert.equal(h.root.hasAttribute(ATTRIBUTE), false);
  h.dispatch("yt-navigate-finish");
  assert.equal(h.root.hasAttribute(ATTRIBUTE), true);
  h.dispatch("pagehide");
  assert.equal(h.root.hasAttribute(ATTRIBUTE), false);
  h.dispatch("pageshow");
  assert.equal(h.root.hasAttribute(ATTRIBUTE), true);
  h.context.watchRoute = false;
  h.dispatch("yt-page-data-updated");
  assert.equal(h.root.hasAttribute(ATTRIBUTE), false);
  h.context.watchRoute = true;
  h.dispatch("yt-page-data-updated");
  assert.equal(h.root.hasAttribute(ATTRIBUTE), true);
});

test("fullscreen comments CSS is scoped and does not alter native player or end-screen geometry", () => {
  const h = createHarness();
  const css = h.context.buildFullscreenCommentsCss();
  assert.match(css, /:root\[data-ytppl-fullscreen-comments\]:fullscreen ytd-app\[fullscreen\]/);
  assert.match(css, /overflow-y: auto !important/);
  assert.match(css, /overflow-x: hidden !important/);
  assert.match(css, /height: 100vh !important/);
  assert.match(css, /:root\[data-ytppl-fullscreen-comments\]:fullscreen ytd-watch-flexy\[fullscreen\] #columns/);
  assert.match(css, /display: flex !important/);
  assert.doesNotMatch(css, /movie_player|full-bleed|videowall|endscreen|body|loading/);
  h.context.CONFIG.enableFullscreenComments = false;
  assert.equal(h.context.buildFullscreenCommentsCss(), "");
});

test("ordinary fullscreen player wheel scrolls the app without exiting or moving native content", () => {
  const h = createHarness();
  const event = h.wheel();
  assert.equal(h.app.scrollTop, 120);
  assert.equal(event.prevented, true);
  assert.equal(event.stopped, true);
  assert.equal(h.context.document.fullscreenElement, h.root);
  assert.equal(h.video.parentElement, h.player);
  assert.equal(h.comments.parentElement, h.flexy);
  assert.equal(h.video.currentTime, 276.57721);
  assert.equal(h.video.paused, true);
  h.wheel({ deltaY: -1000 });
  assert.equal(h.app.scrollTop, 0);
  h.wheel({ deltaY: 10000 });
  assert.equal(h.app.scrollTop, 3023);
});

test("fullscreen player wheel handles line and page deltas and consumes boundary gestures", () => {
  const h = createHarness();
  h.wheel({ deltaY: 3, deltaMode: 1 });
  assert.equal(h.app.scrollTop, 120);
  h.wheel({ deltaY: 1, deltaMode: 2 });
  assert.equal(h.app.scrollTop, 1560);
  h.app.scrollTop = 0;
  assert.equal(h.wheel({ deltaY: -120 }).stopped, true);
  assert.equal(h.app.scrollTop, 0);
});

test("fullscreen comments preserve mouse buttons, modifiers, horizontal and already handled wheel events", () => {
  const h = createHarness();
  const excluded = [
    { buttons: 1 }, { buttons: 2 }, { buttons: 4 },
    { ctrlKey: true }, { altKey: true }, { metaKey: true }, { shiftKey: true },
    { deltaX: 200 }, { deltaY: 0 }, { deltaY: NaN },
    { cancelable: false }, { defaultPrevented: true },
  ];
  for (const overrides of excluded) {
    const event = h.wheel(overrides);
    assert.equal(event.prevented, false, JSON.stringify(overrides));
    assert.equal(event.stopped, false, JSON.stringify(overrides));
    assert.equal(h.app.scrollTop, 0);
  }
  h.context.rightButtonHeldOnPlayer = true;
  assert.equal(h.wheel().stopped, false);
  assert.equal(h.app.scrollTop, 0);
  const wheelListeners = h.documentListeners.get("wheel");
  assert.equal(wheelListeners[0].handler, h.context.handleWheelVolume);
  assert.equal(wheelListeners[1].handler, h.context.handleFullscreenCommentsWheel);
  assert.equal(wheelListeners[1].options.capture, true);
  assert.equal(wheelListeners[1].options.passive, false);
});

test("fullscreen comments preserve player menus, form controls and nested scrolling surfaces", () => {
  const h = createHarness();
  for (const selector of vm.runInContext("FULLSCREEN_WHEEL_EXCLUDED_SELECTOR", h.context).split(",")) {
    const target = new Element("div", h.player, [selector]);
    assert.equal(h.wheel({ target }).stopped, false, selector);
  }
  const nested = new Element("div", h.player);
  const target = new Element("span", nested);
  nested.scrollHeight = 300;
  for (const overflowY of ["auto", "scroll", "overlay"]) {
    nested.overflowY = overflowY;
    assert.equal(h.wheel({ target }).stopped, false, overflowY);
    nested.scrollTop = 200;
    assert.equal(h.wheel({ target }).stopped, false, "nested scroll boundary remains native");
  }
  nested.overflowY = "visible";
  assert.equal(h.wheel({ target }).stopped, true);
});

test("fullscreen comments leave comments and other page regions on native wheel handling", () => {
  const h = createHarness();
  assert.equal(h.wheel({ target: h.comments }).stopped, false);
  assert.equal(h.wheel({ target: h.app }).stopped, false);
  const otherPlayer = new Element("div", h.app, ["#movie_player"]);
  assert.equal(h.wheel({ target: otherPlayer }).stopped, false);
  h.app.scrollHeight = h.app.clientHeight;
  assert.equal(h.wheel().stopped, false);
  assert.equal(h.app.scrollTop, 0);
});

test("fullscreen comments preserve wheel events inside non-scrollable player dialogs", () => {
  const h = createHarness();
  for (const selector of ["dialog", '[role="dialog"]', '[role="alertdialog"]', '[aria-modal="true"]']) {
    const dialog = new Element("div", h.player, [selector]);
    const content = new Element("div", dialog);
    const target = new Element("span", content);
    const event = h.wheel({ target });
    assert.equal(event.prevented, false, selector);
    assert.equal(event.stopped, false, selector);
    assert.equal(h.app.scrollTop, 0, "scrolling dialog content must not move the page behind it");
  }
});

test("fullscreen comments fail closed if fullscreen or route state changes before its event arrives", () => {
  const h = createHarness();
  h.context.document.fullscreenElement = h.player;
  assert.equal(h.root.hasAttribute(ATTRIBUTE), true, "simulate stale marker before fullscreenchange");
  assert.equal(h.wheel().stopped, false);
  h.context.document.fullscreenElement = h.root;
  h.context.watchRoute = false;
  assert.equal(h.wheel().stopped, false);
  assert.equal(h.app.scrollTop, 0);
});
