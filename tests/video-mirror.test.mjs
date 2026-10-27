import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

const SOURCE = readFileSync(new URL(
  "../sources/modules/youtube-player-preferences-lite.user.js", import.meta.url,
), "utf8");
const ATTRIBUTE = "data-ytppl-video-mirrored";
const BUTTON_ID = "ytppl-video-mirror-button";
const TOOLTIP_ID = "ytppl-video-mirror-tooltip";
const VIDEO_A = "aaaaaaaaaaa";
const VIDEO_B = "bbbbbbbbbbb";

function extractFunction(name) {
  const start = SOURCE.indexOf(`  function ${name}(`);
  assert.notEqual(start, -1, `Missing ${name}`);
  const end = SOURCE.indexOf("\n  function ", start + 1);
  assert.notEqual(end, -1, `Missing boundary after ${name}`);
  return SOURCE.slice(start, end);
}

function createHarness({ enabled = true } = {}) {
  const records = [];
  const frames = new Map();
  const counts = { queries: 0, writes: 0, frames: 0, documentApplies: 0 };
  let nextFrame = 1;
  let observerCallback;
  const tooltipObservers = [];
  const windowListeners = new Map();
  const documentListeners = new Map();
  const register = (map) => (type, callback, options) => {
    const callbacks = map.get(type) || [];
    callbacks.push({ callback, options });
    map.set(type, callbacks);
  };
  const unregister = (map) => (type, callback) => {
    map.set(type, (map.get(type) || []).filter((entry) => entry.callback !== callback));
  };
  function makeEvent(type, properties = {}) {
    return {
      type, defaultPrevented: false, prevented: false, stopped: false,
      preventDefault() { this.defaultPrevented = this.prevented = true; },
      stopPropagation() { this.stopped = true; },
      ...properties,
    };
  }
  class Element {
    constructor(tagName) {
      this.tagName = tagName;
      this.nodeType = 1;
      this.parentElement = null;
      this.children = [];
      this.attributes = new Map();
      this.listeners = new Map();
      this.style = new Proxy({ transform: "", scale: "" }, {
        set(style, name, value) { style[name] = value; counts.writes++; return true; },
      });
      this.bounds = null;
      this.layoutWidth = null;
      this.layoutHeight = null;
      this.focusVisible = false;
      this.hovered = false;
      this._textContent = "";
    }
    get id() { return this.getAttribute("id") || ""; }
    set id(value) { this.setAttribute("id", value); }
    get className() { return this.getAttribute("class") || ""; }
    set className(value) { this.setAttribute("class", value); }
    get title() { return this.getAttribute("title") || ""; }
    set title(value) { this.setAttribute("title", value); }
    get firstElementChild() { return this.children[0] || null; }
    get textContent() { return this._textContent + this.children.map((child) => child.textContent).join(""); }
    set textContent(value) {
      this._textContent = String(value);
      counts.writes++;
      records.push({ type: "childList", target: this, addedNodes: [], removedNodes: [] });
    }
    get isContentEditable() {
      const editable = this.closest("[contenteditable]");
      return Boolean(editable && editable.getAttribute("contenteditable") !== "false");
    }
    get hidden() { return this.hasAttribute("hidden"); }
    set hidden(value) {
      if (value) this.setAttribute("hidden", "");
      else this.removeAttribute("hidden");
    }
    get isConnected() {
      return this === document.documentElement || Boolean(this.parentElement?.isConnected);
    }
    get nextSibling() {
      const siblings = this.parentElement?.children || [];
      return siblings[siblings.indexOf(this) + 1] || null;
    }
    compareDocumentPosition(other) {
      if (other === this) return 0;
      const nodes = document.documentElement.querySelectorAll("*");
      return nodes.indexOf(this) < nodes.indexOf(other) ? 4 : 2;
    }
    getAttribute(name) { return this.attributes.get(name) ?? null; }
    hasAttribute(name) { return this.attributes.has(name); }
    setAttribute(name, value) {
      this.attributes.set(name, String(value));
      counts.writes++;
      records.push({ type: "attributes", target: this, attributeName: name });
    }
    removeAttribute(name) {
      if (this.attributes.delete(name)) counts.writes++;
    }
    matches(selector) {
      return selector.split(",").some((part) => {
        part = part.trim();
        if (part === ":focus-visible") return this.focusVisible;
        if (part === ":hover") return this.hovered;
        const tag = part.match(/^[\w-]+/)?.[0];
        const id = part.match(/#([\w-]+)/)?.[1];
        const classes = [...part.matchAll(/\.([\w-]+)/g)].map((match) => match[1]);
        const attributes = [...part.matchAll(/\[([\w-]+)(?:=["']?([^\]"']+)["']?)?\]/g)];
        return (!tag || this.tagName === tag) && (!id || this.id === id) &&
          classes.every((name) => this.className.split(/\s+/).includes(name)) &&
          attributes.every(([, name, value]) => this.hasAttribute(name) &&
            (value === undefined || this.getAttribute(name) === value));
      });
    }
    contains(node) {
      for (let element = node; element; element = element.parentElement) {
        if (element === this) return true;
      }
      return false;
    }
    closest(selector) {
      for (let element = this; element; element = element.parentElement) {
        if (element.matches(selector)) return element;
      }
      return null;
    }
    querySelectorAll(selector) {
      counts.queries++;
      const result = [];
      for (const child of this.children) {
        if (child.matches(selector)) result.push(child);
        result.push(...child.querySelectorAll(selector));
      }
      return result;
    }
    querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
    insertBefore(child, sibling) {
      child.remove();
      const index = sibling ? this.children.indexOf(sibling) : this.children.length;
      assert.ok(index >= 0);
      this.children.splice(index, 0, child);
      child.parentElement = this;
      counts.writes++;
      records.push({ type: "childList", target: this, addedNodes: [child], removedNodes: [] });
      return child;
    }
    appendChild(child) { return this.insertBefore(child, null); }
    remove() {
      const parent = this.parentElement;
      if (!parent) return;
      parent.children.splice(parent.children.indexOf(this), 1);
      this.parentElement = null;
      counts.writes++;
      records.push({ type: "childList", target: parent, addedNodes: [], removedNodes: [this] });
    }
    getClientRects() {
      if (!this.isConnected) return [];
      for (let element = this; element; element = element.parentElement) {
        if (element.hidden || element.style.display === "none") return [];
      }
      return [{}];
    }
    getBoundingClientRect() {
      const fallback = this.id === TOOLTIP_ID
        ? { left: 0, top: 0, width: 168, height: 26 }
        : { left: 676, top: 374, width: 36, height: 36 };
      const bounds = this.getClientRects().length ? this.bounds || fallback
        : { left: 0, top: 0, width: 0, height: 0 };
      return { ...bounds, right: bounds.left + bounds.width, bottom: bounds.top + bounds.height };
    }
    get offsetWidth() { return this.layoutWidth ?? this.getBoundingClientRect().width; }
    get offsetHeight() { return this.layoutHeight ?? this.getBoundingClientRect().height; }
    addEventListener(type, callback, options) { register(this.listeners)(type, callback, options); }
    removeEventListener(type, callback) { unregister(this.listeners)(type, callback); }
    dispatch(type, properties = {}) {
      if (type === "mouseenter") this.hovered = true;
      else if (type === "mouseleave") this.hovered = false;
      const event = makeEvent(type, { currentTarget: this, target: this, ...properties });
      for (const { callback } of this.listeners.get(type) || []) callback(event);
      return event;
    }
    click() { return this.dispatch("click"); }
    focus({ visible = true } = {}) {
      this.focusVisible = visible;
      document.activeElement = this;
      return this.dispatch("focus");
    }
    blur() { document.activeElement = document.body; return this.dispatch("blur"); }
  }
  const document = {
    nodeType: 9,
    createElement: (tag) => new Element(tag),
    createElementNS: (_, tag) => new Element(tag),
    querySelectorAll: (selector) => document.documentElement.querySelectorAll(selector),
    querySelector: (selector) => document.querySelectorAll(selector)[0] || null,
    addEventListener: register(documentListeners),
    removeEventListener: unregister(documentListeners),
  };
  document.documentElement = new Element("html");
  document.body = document.documentElement.appendChild(new Element("body"));
  function makeVideo(player) {
    const video = player.appendChild(new Element("video"));
    video.className = "html5-main-video";
    video.style.transform = "translate(13px, 9px) rotate(2deg)";
    for (const [property, value] of Object.entries({ currentTime: 277.909568, paused: true, volume: 0.45, playbackRate: 1.25 })) {
      Object.defineProperty(video, property, {
        get: () => value,
        set() { assert.fail(`Mirror must not write ${property}`); },
      });
    }
    video.play = () => assert.fail("Mirror must not play media");
    video.pause = () => assert.fail("Mirror must not pause media");
    return video;
  }
  function makeControls(player) {
    const controls = player.appendChild(new Element("div"));
    controls.className = "ytp-right-controls";
    const fullscreen = controls.appendChild(new Element("button"));
    fullscreen.className = "ytp-fullscreen-button";
    return controls;
  }
  function makeWatch(videoId = VIDEO_A, parent = document.body) {
    const watch = parent.appendChild(new Element("ytd-watch-flexy"));
    const player = watch.appendChild(new Element("div"));
    player.id = "movie_player";
    player.bounds = { left: 100, top: 50, width: 640, height: 360 };
    player.videoId = videoId;
    player.getVideoData = () => ({ video_id: player.videoId });
    const video = makeVideo(player);
    const captions = player.appendChild(new Element("div"));
    captions.className = "ytp-caption-window-container";
    const controls = makeControls(player);
    return { watch, player, video, captions, controls };
  }
  const active = makeWatch();
  document.activeElement = active.player;
  records.length = 0;
  const context = vm.createContext({
    CONFIG: { enableVideoMirrorButton: enabled },
    WATCH_PATHS: ["/watch", "/live/"],
    VIDEO_MIRROR_BUTTON_ID: BUTTON_ID,
    VIDEO_MIRROR_TOOLTIP_ID: TOOLTIP_ID,
    VIDEO_MIRROR_ATTRIBUTE: ATTRIBUTE,
    VIDEO_MIRROR_ANCHOR_SELECTOR: ".ytp-settings-button,.ytp-size-button,.ytp-fullscreen-button,.ytp-miniplayer-button,#tmk-miniplayer-button",
    VIDEO_MIRROR_SURFACE_SELECTOR: `#movie_player,video.html5-main-video,.ytp-right-controls,#ytsmp-player-placeholder,#${BUTTON_ID},.ytp-settings-button,.ytp-size-button,.ytp-fullscreen-button,.ytp-miniplayer-button,#tmk-miniplayer-button`,
    FULLSCREEN_COMMENTS_ATTRIBUTE: "data-ytppl-fullscreen-comments",
    Node: { ELEMENT_NODE: 1, DOCUMENT_POSITION_FOLLOWING: 4 }, URLSearchParams,
    document, window: {
      addEventListener: register(windowListeners),
      removeEventListener: unregister(windowListeners),
    },
    location: { pathname: "/watch", search: `?v=${VIDEO_A}` },
    getComputedStyle: (element) => ({
      display: element.style.display || "block", visibility: element.style.visibility || "visible",
      opacity: element.style.opacity ?? "1",
    }),
    videoMirrorFrame: 0, videoMirrorVideoId: "", videoMirrorEnabled: false,
    videoMirrorVideo: null, videoMirrorButton: null, videoMirrorTooltip: null, videoMirrorPlayer: null,
    videoMirrorControls: null, videoMirrorPageSuspended: false,
    videoMirrorTooltipObserver: null,
    applyFrame: 0, playerLayoutRefreshFrame: 0, pendingApplyRoots: new Set(),
    liveChatSyncFrame: 0, liveChatNavigationPending: false,
    mutationAffectsLiveChat: () => false,
    requestAnimationFrame(callback) {
      const id = nextFrame++;
      frames.set(id, callback);
      return id;
    },
    cancelAnimationFrame: (id) => frames.delete(id),
    setTimeout() { assert.fail("Mirror must not schedule a timer"); },
    setInterval() { assert.fail("Mirror must not poll"); },
    MutationObserver: class {
      constructor(callback) {
        this.callback = callback;
        this.registrations = [];
        if (!observerCallback) observerCallback = callback;
        else tooltipObservers.push(this);
      }
      observe(target, options) { this.registrations.push({ target, options }); }
      disconnect() { this.registrations = []; }
    },
    addMutationApplyRoots() {}, mutationChangesWatchDynamicRoots: () => false,
    nodeContainsLiveChatFrame: () => false,
    scheduleApply() { counts.documentApplies++; },
  });
  for (const name of [
    "ensureStyles", "syncFullscreenComments", "configureDynamicMutationObserver",
    "scheduleLiveChatCollapseAttempts", "schedulePlayerLayoutRefreshAttempts",
    "clearLiveChatCollapseAttempts", "clearPlayerLayoutRefreshAttempts",
    "clearContextMenuSuppression", "convertCurrentShortsPage", "applyDynamicPreferences",
    "schedulePreferredQualityAttempts", "clearPreferredQualityAttempts", "scheduleTheaterModeAttempts", "handleShortsClick",
    "handleManualQualitySelection", "handlePreferredQualityMetadata",
    "handleTheaterModeToggle", "handleDescriptionClick", "handleWheelVolume",
    "handleFullscreenCommentsWheel", "handleMouseDown", "handleMouseUp", "handleContextMenu", "handleWindowBlur",
    "handleCleanVideoUrlSelection", "handleCleanVideoUrlCopy", "clearCleanVideoUrlCopy",
    "scheduleLiveChatSync", "resetLiveChat",
  ]) context[name] = () => {};
  const names = [
    "isWatchPath", "isRenderedWatchFlexy", "getWatchFlexy", "buildVideoMirrorCss",
    "getVideoMirrorRouteId", "getVideoMirrorTarget", "clearVideoMirrorElements",
    "resetVideoMirror", "handleVideoMirrorClick", "createVideoMirrorButton",
    "getVideoMirrorLabel", "hideVideoMirrorTooltip", "positionVideoMirrorTooltip",
    "refreshVideoMirrorTooltip",
    "isVideoMirrorTooltipOwnerVisible", "handleVideoMirrorTooltipPointerMove", "handleVideoMirrorTooltipVisibility",
    "handleVideoMirrorTooltipDocumentLeave",
    "showVideoMirrorTooltip", "handleVideoMirrorKeyDown", "replaceObserverRegistrations",
    "placeVideoMirrorButton", "syncVideoMirror", "scheduleVideoMirrorSync", "mutationAffectsVideoMirror",
    "handleVideoMirrorMetadata", "handleNavigateStart", "handleNavigateFinish",
    "applyRoutePreferences", "cancelScheduledAnimationWork",
  ];
  vm.runInContext(names.map(extractFunction).join("\n"), context);
  const observerStart = SOURCE.indexOf("  const observer = new MutationObserver((mutations) => {");
  const observerEnd = SOURCE.indexOf("\n\n  configureDynamicMutationObserver();", observerStart);
  vm.runInContext(SOURCE.slice(observerStart, observerEnd), context);
  const listenerStart = SOURCE.indexOf('  document.addEventListener("click", handleShortsClick, true);');
  vm.runInContext(SOURCE.slice(listenerStart, SOURCE.lastIndexOf("})();")), context);
  function deliver() {
    if (!records.length) return;
    const mutations = records.splice(0);
    observerCallback(mutations);
    for (const observer of tooltipObservers) {
      const relevant = mutations.filter((mutation) => observer.registrations.some(({ target, options }) =>
        mutation.type === "attributes" && mutation.target === target && options.attributes &&
        (!options.attributeFilter || options.attributeFilter.includes(mutation.attributeName)),
      ));
      if (relevant.length) observer.callback(relevant);
    }
  }
  function settle() {
    let turns = 0;
    while (records.length || frames.size) {
      assert.ok(turns++ < 10, "mirror mutations must drain without a loop");
      deliver();
      for (const [id, callback] of [...frames]) {
        frames.delete(id);
        counts.frames++;
        callback();
      }
    }
  }
  context.applyRoutePreferences();
  settle();
  return {
    ...active, context, document, counts, frames, records, makeWatch, makeControls, makeVideo,
    documentListeners, tooltipObservers,
    deliver, settle,
    button: () => document.querySelector(`#${BUTTON_ID}`),
    tooltip: () => document.querySelector(`#${TOOLTIP_ID}`),
    dispatch(type, target = "window", eventTarget = null, properties = {}) {
      const listeners = target === "document" ? documentListeners : windowListeners;
      const event = makeEvent(type, { target: eventTarget, ...properties });
      for (const { callback } of listeners.get(type) || []) callback(event);
      return event;
    },
    key(properties = {}) {
      return this.dispatch("keydown", "document", active.video, {
        key: "h", repeat: false, isComposing: false,
        ctrlKey: false, altKey: false, metaKey: false, shiftKey: false,
        ...properties,
      });
    },
  };
}

test("mirror toggle targets only the main video and never writes playback or native transforms", () => {
  const h = createHarness();
  const button = h.button();
  assert.equal(button.getAttribute("aria-label"), "Mirror video horizontally");
  assert.equal(button.getAttribute("aria-pressed"), "false");
  assert.equal(button.getAttribute("aria-keyshortcuts"), "H");
  assert.equal(button.hasAttribute("title"), false);
  assert.equal(h.controls.children.at(-2), button);
  button.click();
  h.settle();
  assert.equal(button.getAttribute("aria-pressed"), "true");
  assert.equal(h.video.getAttribute(ATTRIBUTE), "1");
  assert.equal(h.player.hasAttribute(ATTRIBUTE), false);
  assert.equal(h.captions.hasAttribute(ATTRIBUTE), false);
  assert.equal(h.controls.hasAttribute(ATTRIBUTE), false);
  assert.equal(h.video.style.transform, "translate(13px, 9px) rotate(2deg)");
  assert.equal(h.video.currentTime, 277.909568);
  assert.equal(h.video.paused, true);
  button.click();
  h.settle();
  assert.equal(h.video.hasAttribute(ATTRIBUTE), false);
  assert.equal(button.getAttribute("aria-pressed"), "false");
  const css = h.context.buildVideoMirrorCss();
  assert.match(css, /video\.html5-main-video\[data-ytppl-video-mirrored="1"\]/);
  assert.match(css, /scale: -1 1 !important/);
  assert.doesNotMatch(css, /\btransform\s*:|caption|#movie_player/);
});

test("H uses the existing button toggle only when focus and event belong to the current player", () => {
  const h = createHarness();
  const button = h.button();
  let clicks = 0;
  const click = button.click.bind(button);
  button.click = () => { clicks++; return click(); };
  const listener = h.documentListeners.get("keydown").find(
    ({ callback }) => callback === h.context.handleVideoMirrorKeyDown,
  );
  assert.ok(listener, "mirror shortcut listener is registered");
  assert.equal(listener.options, undefined, "shortcut runs in the bubbling phase");
  const first = h.key();
  assert.equal(first.prevented, true);
  assert.equal(first.stopped, true);
  assert.equal(h.video.getAttribute(ATTRIBUTE), "1");
  assert.equal(button.getAttribute("aria-pressed"), "true");
  button.focus();
  const second = h.key({ key: "H", target: button.querySelector("path") });
  assert.equal(second.prevented, true);
  assert.equal(second.stopped, true);
  assert.equal(h.video.hasAttribute(ATTRIBUTE), false);
  assert.equal(clicks, 2, "keyboard path must reuse the click handler");
  assert.equal(h.video.currentTime, 277.909568);
  assert.equal(h.video.paused, true);
  assert.equal(h.video.volume, 0.45);
  assert.equal(h.video.playbackRate, 1.25);
  assert.equal(h.video.style.transform, "translate(13px, 9px) rotate(2deg)");
  h.settle();
  assert.equal(h.frames.size, 0);
});

test("H leaves modifiers, composition, repeats and handled keys untouched", () => {
  const h = createHarness();
  for (const properties of [
    { ctrlKey: true }, { altKey: true }, { metaKey: true }, { shiftKey: true },
    { repeat: true }, { isComposing: true }, { keyCode: 229 },
    { defaultPrevented: true }, { key: "j" }, { key: undefined },
  ]) {
    const event = h.key(properties);
    assert.equal(event.prevented, false, JSON.stringify(properties));
    assert.equal(event.stopped, false, JSON.stringify(properties));
    assert.equal(h.video.hasAttribute(ATTRIBUTE), false);
  }
  assert.equal(h.frames.size, 0);
});

test("H does not claim search, comments, page focus or another player's key events", () => {
  const h = createHarness();
  const comments = h.watch.appendChild(h.document.createElement("ytd-comments"));
  const search = h.document.body.appendChild(h.document.createElement("input"));
  const duplicate = h.makeWatch();
  duplicate.watch.hidden = true;
  h.settle();
  for (const outside of [h.document.body, comments, search, duplicate.player]) {
    for (const outsideIsFocus of [false, true]) {
      h.document.activeElement = outsideIsFocus ? outside : h.player;
      const event = h.key({ target: outsideIsFocus ? h.video : outside });
      assert.equal(event.prevented, false);
      assert.equal(event.stopped, false);
      assert.equal(h.video.hasAttribute(ATTRIBUTE), false);
      assert.equal(duplicate.video.hasAttribute(ATTRIBUTE), false);
    }
  }
  assert.equal(h.frames.size, 0);
});

test("H preserves editable fields, player menus, dialogs and role controls including their descendants", () => {
  const h = createHarness();
  const exclusions = [
    ["input"], ["textarea"], ["select"], ["dialog"],
    ["div", "contenteditable", "true"], ["div", "contenteditable", "false"],
    ...["textbox", "searchbox", "combobox", "slider", "menu", "listbox", "dialog", "alertdialog"]
      .map((role) => ["div", "role", role]),
    ["div", "aria-modal", "true"],
    ...["ytp-settings-menu", "ytp-popup", "ytp-panel", "ytp-contextmenu"]
      .map((name) => ["div", "class", name]),
  ];
  for (const [tag, attribute, value] of exclusions) {
    const wrapper = h.player.appendChild(h.document.createElement(tag));
    if (attribute) wrapper.setAttribute(attribute, value);
    const descendant = wrapper.appendChild(h.document.createElement("span"));
    h.settle();
    for (const excludedIsFocus of [false, true]) {
      h.document.activeElement = excludedIsFocus ? descendant : h.player;
      const event = h.key({ target: excludedIsFocus ? h.video : descendant });
      assert.equal(event.prevented, false, `${tag} ${attribute}=${value}`);
      assert.equal(event.stopped, false);
      assert.equal(h.video.hasAttribute(ATTRIBUTE), false);
    }
    wrapper.remove();
  }
  const ordinary = h.player.appendChild(h.document.createElement("div"));
  ordinary.setAttribute("role", "presentation");
  ordinary.setAttribute("aria-modal", "false");
  h.document.activeElement = ordinary;
  assert.equal(h.key({ target: ordinary }).prevented, true, "unrelated attributes must not exclude the player");
  assert.equal(h.video.getAttribute(ATTRIBUTE), "1");
  h.settle();
});

test("H rejects stale routes, hidden players and suspended or disabled features before reconciliation", () => {
  const changes = [
    (h) => { h.context.location.search = `?v=${VIDEO_B}`; },
    (h) => { h.context.location.pathname = "/shorts/aaaaaaaaaaa"; },
    (h) => { h.player.videoId = VIDEO_B; },
    (h) => { h.watch.hidden = true; },
    (h) => { h.player.style.display = "none"; },
    (h) => { h.player.style.visibility = "hidden"; },
    (h) => { h.context.CONFIG.enableVideoMirrorButton = false; },
    (h) => { h.context.videoMirrorPageSuspended = true; },
    (h) => { h.button().remove(); },
  ];
  for (const change of changes) {
    const h = createHarness();
    change(h);
    const event = h.key();
    assert.equal(event.prevented, false);
    assert.equal(event.stopped, false);
    assert.equal(h.video.hasAttribute(ATTRIBUTE), false);
  }
  const disabled = createHarness({ enabled: false });
  assert.equal(disabled.key().prevented, false);
});

test("hover and focus show an accessible native-style tooltip with an H key badge and no native title", () => {
  const h = createHarness();
  const button = h.button();
  button.dispatch("mouseenter");
  h.settle();
  const tooltip = h.tooltip();
  assert.equal(tooltip.parentElement, h.player);
  assert.equal(tooltip.getAttribute("role"), "tooltip");
  assert.equal(tooltip.firstElementChild.textContent, "Mirror video");
  assert.equal(tooltip.querySelector("kbd").textContent, "H");
  assert.equal(button.getAttribute("aria-describedby"), TOOLTIP_ID);
  assert.equal(button.hasAttribute("title"), false);
  assert.equal(tooltip.hasAttribute("title"), false);
  const writes = h.counts.writes;
  button.dispatch("mouseenter");
  assert.equal(h.tooltip(), tooltip);
  assert.equal(h.counts.writes, writes, "repeated hover does not rebuild the tooltip");
  tooltip.layoutWidth = 240;
  button.click();
  h.settle();
  assert.equal(tooltip.firstElementChild.textContent, "Restore original video");
  assert.equal(tooltip.style.left, "392px", "a wider toggle label is remeasured and clamped");
  button.click();
  h.settle();
  assert.equal(tooltip.firstElementChild.textContent, "Mirror video");
  button.dispatch("mouseleave");
  assert.equal(h.tooltip(), null);
  assert.equal(button.hasAttribute("aria-describedby"), false);
  button.focus();
  assert.equal(h.tooltip().firstElementChild.textContent, "Mirror video");
  assert.equal(h.document.querySelectorAll(`#${TOOLTIP_ID}`).length, 1);
  button.blur();
  assert.equal(h.tooltip(), null);
  assert.equal(h.context.videoMirrorTooltip, null);
  assert.equal(button.hasAttribute("aria-describedby"), false);
  const css = h.context.buildVideoMirrorCss();
  assert.match(css, new RegExp(`#${TOOLTIP_ID} \\{[\\s\\S]*?position: absolute !important`));
  assert.match(css, new RegExp(`#${TOOLTIP_ID} kbd \\{[\\s\\S]*?border: 1px solid`));
});

test("tooltip background and key badge use the compact dark native-style presentation", () => {
  const css = createHarness().context.buildVideoMirrorCss();
  const tooltipCss = css.match(new RegExp(`#${TOOLTIP_ID} \\{([^}]+)\\}`))[1];
  const badgeCss = css.match(new RegExp(`#${TOOLTIP_ID} kbd \\{([^}]+)\\}`))[1];
  assert.match(tooltipCss, /background: rgba\(0, 0, 0, 0\.9\) !important/);
  assert.match(badgeCss, /box-sizing: border-box !important/);
  assert.match(badgeCss, /height: 16px !important/);
  assert.match(badgeCss, /min-width: 14px !important/);
  assert.match(badgeCss, /font: 400 12px\/14px Roboto, Arial, sans-serif !important/);
  assert.match(badgeCss, /border: 1px solid #555 !important/);
  assert.match(badgeCss, /background: transparent !important/);
});

test("mouse or programmatic focus cannot reopen a dismissed mirror tooltip", () => {
  const h = createHarness();
  const button = h.button();
  button.dispatch("mouseenter");
  button.dispatch("mouseleave");
  button.focus({ visible: false });
  assert.equal(h.tooltip(), null);
  assert.equal(button.hasAttribute("aria-describedby"), false);
  button.blur();
  button.focus();
  assert.ok(h.tooltip(), "keyboard-visible focus retains the accessible tooltip");
});

test("mirror tooltip dismisses on a missed pointer exit or outside press without consuming input", () => {
  for (const exit of [
    (h) => h.dispatch("pointermove", "document", h.player, { clientX: 650, clientY: 380 }),
    (h) => h.dispatch("pointermove", "document", h.button(), { clientX: 650, clientY: 380 }),
    (h) => h.dispatch("pointerdown", "document", h.player),
    (h) => h.dispatch("pointerdown", "document", h.button()),
    (h) => h.dispatch("pointercancel", "document", h.button()),
    (h) => h.dispatch("mouseleave", "document", h.document.documentElement),
  ]) {
    const h = createHarness();
    const button = h.button();
    button.dispatch("mouseenter");
    const tooltip = h.tooltip();
    const event = exit(h);
    assert.equal(event.prevented, false);
    assert.equal(event.stopped, false);
    assert.equal(tooltip.isConnected, false);
    assert.equal(button.hasAttribute("aria-describedby"), false);
    h.settle();
    assert.equal(h.tooltip(), null);
  }
});

test("mirror tooltip ignores inside pointer movement but never reopens after a press dismisses it", () => {
  const h = createHarness();
  const button = h.button();
  button.dispatch("mouseenter");
  const tooltip = h.tooltip();
  const icon = button.firstElementChild;
  h.dispatch("pointermove", "document", icon, { clientX: 690, clientY: 390 });
  h.dispatch("mouseleave", "document", icon);
  assert.equal(h.tooltip(), tooltip);
  h.dispatch("pointerdown", "document", icon);
  assert.equal(h.tooltip(), null);
  h.dispatch("pointermove", "document", icon, { clientX: 690, clientY: 390 });
  h.context.syncVideoMirror();
  assert.equal(h.tooltip(), null);
});

test("mirror tooltip releases transient listeners and observer on scroll or document hiding", () => {
  for (const exit of [
    (h) => h.dispatch("scroll", "document", h.document.body),
    (h) => { h.document.hidden = true; return h.dispatch("visibilitychange", "document"); },
  ]) {
    const h = createHarness();
    const button = h.button();
    const baseline = new Map([...h.documentListeners].map(([type, listeners]) => [type, listeners.length]));
    button.dispatch("mouseenter");
    assert.ok(h.tooltipObservers.some((observer) => observer.registrations.length));
    const event = exit(h);
    assert.equal(event.prevented, false);
    assert.equal(h.tooltip(), null);
    for (const [type, listeners] of h.documentListeners) {
      assert.equal(listeners.length, baseline.get(type) || 0, `${type} listener is released`);
    }
    assert.ok(h.tooltipObservers.every((observer) => observer.registrations.length === 0));
    h.document.hidden = false;
    h.dispatch("visibilitychange", "document");
    h.settle();
    assert.equal(h.tooltip(), null, "foreground restoration does not reopen a dismissed tooltip");
  }
});

test("hidden, faded or auto-hidden player controls dismiss the mirror tooltip without polling", () => {
  for (const change of [
    (h) => { h.controls.style.visibility = "hidden"; h.controls.setAttribute("class", "ytp-right-controls hidden"); },
    (h) => { h.controls.style.opacity = "0"; h.controls.setAttribute("class", "ytp-right-controls faded"); },
    (h) => { h.player.setAttribute("class", "html5-video-player ytp-autohide"); },
    (h) => { h.button().hidden = true; },
    (h) => { h.button().setAttribute("aria-hidden", "true"); },
    (h) => { h.watch.hidden = true; },
  ]) {
    const h = createHarness();
    const button = h.button();
    button.dispatch("mouseenter");
    const frames = h.counts.frames;
    const documentApplies = h.counts.documentApplies;
    change(h);
    h.settle();
    assert.equal(h.tooltip(), null);
    assert.equal(button.hasAttribute("aria-describedby"), false);
    assert.equal(h.counts.frames, frames);
    assert.equal(h.counts.documentApplies, documentApplies);
    assert.ok(h.tooltipObservers.every((observer) => observer.registrations.length === 0));
  }
});

test("tooltip positioning stays above the button and clamps to ordinary and scaled player bounds", () => {
  for (const { player, button, left, top } of [
    { button: { left: 380, top: 370, width: 36, height: 36 }, left: "214px", top: "274px" },
    { button: { left: 704, top: 374, width: 36, height: 36 }, left: "464px", top: "278px" },
    { button: { left: 100, top: 82, width: 36, height: 36 }, left: "8px", top: "8px" },
    { player: { left: 100, top: 50, width: 320, height: 180 },
      button: { left: 402, top: 212, width: 18, height: 18 }, left: "464px", top: "278px" },
  ]) {
    const h = createHarness();
    h.player.layoutWidth = 640;
    h.player.layoutHeight = 360;
    if (player) h.player.bounds = player;
    h.button().bounds = button;
    h.button().dispatch("mouseenter");
    assert.equal(h.tooltip().style.left, left);
    assert.equal(h.tooltip().style.top, top);
    assert.ok(Number.parseFloat(left) + h.tooltip().offsetWidth <= h.player.offsetWidth - 8);
    h.settle();
    assert.equal(h.frames.size, 0);
  }
});

test("tooltip clears the current player's seek bar and falls back for hidden or invalid bars", () => {
  for (const scale of [1, 0.5]) {
    const h = createHarness();
    h.player.layoutWidth = 640;
    h.player.layoutHeight = 360;
    h.player.bounds = { left: 100, top: 50, width: 640 * scale, height: 360 * scale };
    h.button().bounds = { left: 100 + 576 * scale, top: 50 + 324 * scale, width: 36 * scale, height: 36 * scale };
    const progress = h.player.appendChild(h.document.createElement("div"));
    progress.className = "ytp-progress-bar-container";
    const barBounds = { left: 100 + 12 * scale, top: 50 + 308 * scale, width: 616 * scale, height: 5 * scale };
    progress.bounds = barBounds;
    h.button().dispatch("mouseenter");
    assert.equal(h.tooltip().style.top, "274px");
    assert.equal(Number.parseFloat(h.tooltip().style.top) + h.tooltip().offsetHeight, 308 - 8);
    h.button().dispatch("mouseleave");
    for (const invalidate of [
      () => { progress.hidden = true; },
      () => { progress.style.visibility = "hidden"; },
      () => { progress.bounds.width = 0; },
      () => { progress.bounds.height = 0; },
      () => { progress.bounds.top = 50 + 340 * scale; },
      () => { progress.bounds.top = 20; },
      () => { progress.bounds.left = 80; },
      () => { progress.bounds.width = 700 * scale; },
    ]) {
      progress.hidden = false;
      progress.style.visibility = "visible";
      progress.bounds = { ...barBounds };
      invalidate();
      h.button().dispatch("mouseenter");
      assert.equal(h.tooltip().style.top, "278px");
      h.button().dispatch("mouseleave");
    }
    progress.remove();
    const other = h.makeWatch();
    other.player.appendChild(progress);
    progress.bounds = barBounds;
    h.button().dispatch("mouseenter");
    assert.equal(h.tooltip().style.top, "278px", "another player's bar cannot affect placement");
    h.settle();
    assert.equal(h.frames.size, 0);
  }
});

test("tooltip hides for zero-sized controls and cannot open against a stale or hidden owner", () => {
  for (const change of [
    (h) => { h.document.hidden = true; },
    (h) => { h.button().style.display = "none"; },
    (h) => { h.button().bounds = { left: 0, top: 0, width: 0, height: 0 }; },
    (h) => { h.watch.hidden = true; },
    (h) => { h.context.location.search = `?v=${VIDEO_B}`; },
    (h) => { h.context.location.pathname = "/"; },
  ]) {
    const h = createHarness();
    const button = h.button();
    change(h);
    button.dispatch("mouseenter");
    assert.equal(h.tooltip(), null);
    assert.equal(h.context.videoMirrorTooltip, null);
    assert.equal(button.hasAttribute("aria-describedby"), false);
    assert.equal(h.video.hasAttribute(ATTRIBUTE), false);
  }
});

test("tooltip lifecycle cleanup releases its node and description without consuming Escape", () => {
  const exits = [
    (h) => h.button().dispatch("mouseleave"),
    (h) => h.button().blur(),
    (h) => h.key({ key: "Escape" }),
    (h) => h.dispatch("blur"),
    (h) => h.dispatch("fullscreenchange", "document"),
    (h) => h.dispatch("yt-navigate-start"),
    (h) => h.dispatch("pagehide"),
  ];
  for (const exit of exits) {
    const h = createHarness();
    const button = h.button();
    button.focus();
    const tooltip = h.tooltip();
    assert.ok(tooltip);
    const event = exit(h);
    assert.equal(event.prevented, false);
    assert.equal(event.stopped, false);
    assert.equal(tooltip.isConnected, false);
    assert.equal(h.context.videoMirrorTooltip, null);
    assert.equal(button.hasAttribute("aria-describedby"), false);
    h.settle();
    assert.equal(h.tooltip(), null);
    assert.equal(h.frames.size, 0);
  }
});

test("resize repositions an existing hovered or keyboard-visible tooltip without dismissing it", () => {
  for (const show of [
    (button) => button.dispatch("mouseenter"),
    (button) => button.focus(),
  ]) {
    const h = createHarness();
    const button = h.button();
    show(button);
    const tooltip = h.tooltip();
    assert.ok(tooltip);
    button.bounds = { left: 380, top: 370, width: 36, height: 36 };
    const event = h.dispatch("resize");
    assert.equal(event.prevented, false);
    assert.equal(event.stopped, false);
    assert.equal(h.tooltip(), tooltip, "resize preserves the existing engaged tooltip node");
    assert.equal(tooltip.style.left, "214px");
    assert.equal(tooltip.style.top, "274px");
    h.settle();
    assert.equal(h.frames.size, 0);
  }
});

test("resize dismisses a no-longer-hovered tooltip and never revives dismissed hover or focus text", () => {
  const h = createHarness();
  const button = h.button();
  button.dispatch("mouseenter");
  const tooltip = h.tooltip();
  button.hovered = false; // Model a missed leave event when layout moves the control.
  button.focus({ visible: false });
  h.dispatch("resize");
  assert.equal(tooltip.isConnected, false);
  assert.equal(h.tooltip(), null, "pointer-origin focus does not preserve a tooltip without hover");
  for (const show of [
    (button) => button.dispatch("mouseenter"),
    (button) => { button.hovered = false; button.focus(); },
  ]) {
    show(button);
    assert.ok(h.tooltip());
    h.key({ key: "Escape" });
    h.dispatch("resize");
    assert.equal(h.tooltip(), null, "resize cannot reopen a dismissed but still hovered or focused owner");
    assert.equal(button.hasAttribute("aria-describedby"), false);
  }
});

test("tooltip cleanup follows control, player and main-video replacement without losing same-video mirror state", () => {
  for (const replace of [
    (h) => { h.controls.remove(); h.makeControls(h.player); },
    (h) => { h.watch.remove(); h.makeWatch(); },
    (h) => { h.video.remove(); h.makeVideo(h.player); },
    (h) => h.button().remove(),
  ]) {
    const h = createHarness();
    const button = h.button();
    button.click();
    button.focus();
    const tooltip = h.tooltip();
    replace(h);
    h.settle();
    assert.equal(tooltip.isConnected, false);
    assert.equal(h.context.videoMirrorTooltip, null);
    assert.equal(button.hasAttribute("aria-describedby"), false);
    assert.equal(h.tooltip(), null);
    assert.equal(h.button().getAttribute("aria-pressed"), "true");
    assert.equal(h.frames.size, 0);
  }
});

test("tooltip insertion, text changes and removal cause no mirror frames or whole-document work", () => {
  const h = createHarness();
  const frames = h.counts.frames;
  const documentApplies = h.counts.documentApplies;
  for (let index = 0; index < 3; index++) {
    h.button().dispatch("mouseenter");
    h.button().click();
    h.settle();
    const writes = h.counts.writes;
    h.context.syncVideoMirror();
    assert.equal(h.counts.writes, writes, "stable visible tooltip reconciliation is write-free");
    h.button().dispatch("mouseleave");
    h.settle();
  }
  assert.equal(h.counts.frames, frames);
  assert.equal(h.frames.size, 0);
  assert.equal(h.counts.documentApplies, documentApplies);
  assert.equal(h.context.videoMirrorTooltip, null);
});

test("mirroring survives replacement controls, replaced main video and custom-button removal", () => {
  const h = createHarness();
  h.button().click();
  h.controls.remove();
  const controls = h.makeControls(h.player);
  h.settle();
  assert.equal(h.button().parentElement, controls);
  assert.equal(h.button().getAttribute("aria-pressed"), "true");
  const oldVideo = h.video;
  oldVideo.remove();
  const replacement = h.makeVideo(h.player);
  h.settle();
  assert.equal(oldVideo.hasAttribute(ATTRIBUTE), false);
  assert.equal(replacement.getAttribute(ATTRIBUTE), "1");
  h.button().remove();
  h.settle();
  assert.equal(h.document.querySelectorAll(`#${BUTTON_ID}`).length, 1);
  assert.equal(h.button().getAttribute("aria-pressed"), "true");
});

test("mirror stays between fullscreen and late native or restored miniplayer controls", () => {
  for (const restored of [false, true]) {
    for (const miniplayerFirst of [false, true]) {
      const h = createHarness();
      const fullscreen = h.controls.querySelector(".ytp-fullscreen-button");
      const miniplayer = h.document.createElement("button");
      if (restored) miniplayer.id = "tmk-miniplayer-button";
      else miniplayer.className = "ytp-miniplayer-button";
      h.controls.insertBefore(miniplayer, miniplayerFirst ? fullscreen : null);
      h.settle();
      const expected = miniplayerFirst
        ? [miniplayer, h.button(), fullscreen]
        : [fullscreen, h.button(), miniplayer];
      assert.deepEqual(h.controls.children, expected);
      assert.equal(h.frames.size, 0);
      miniplayer.remove();
      h.settle();
      h.controls.insertBefore(miniplayer, miniplayerFirst ? fullscreen : null);
      h.settle();
      assert.deepEqual(h.controls.children, expected, "recreated controls retain placement");
      const writes = h.counts.writes;
      h.dispatch("yt-page-data-updated");
      h.settle();
      assert.equal(h.counts.writes, writes, "correct placement must not cause repeated moves");
    }
  }
});

test("mirror preserves the suite shortcut immediately before it when reconciled or recreated", () => {
  const h = createHarness();
  const fullscreen = h.controls.querySelector('.ytp-fullscreen-button');
  const settings = h.document.createElement('button'); settings.className = 'ytp-settings-button';
  const defaultView = h.document.createElement('button'); defaultView.className = 'ytp-size-button';
  h.controls.insertBefore(settings, fullscreen); h.controls.insertBefore(defaultView, fullscreen);
  h.settle();
  const shortcut = h.document.createElement('button'); shortcut.id = 'ytms-player-settings-button';
  h.controls.insertBefore(shortcut, h.button()); h.settle();
  const expected = [settings, shortcut, h.button(), defaultView, fullscreen];
  assert.deepEqual(h.controls.children, expected);
  const writes = h.counts.writes;
  h.context.syncVideoMirror(); h.settle();
  assert.equal(h.counts.writes, writes, 'Correct suite/mirror placement requires no repeated writes');
  h.button().remove(); h.settle();
  assert.deepEqual(h.controls.children, [settings, shortcut, h.button(), defaultView, fullscreen]);
});

test("mirror follows nested fullscreen controls without moving native controls", () => {
  const h = createHarness();
  const fullscreen = h.controls.querySelector(".ytp-fullscreen-button");
  const wrapper = h.controls.appendChild(h.document.createElement("div"));
  wrapper.appendChild(fullscreen);
  const miniplayer = h.controls.appendChild(h.document.createElement("button"));
  miniplayer.id = "tmk-miniplayer-button";
  h.settle();
  assert.deepEqual(wrapper.children, [fullscreen, h.button()]);
  assert.deepEqual(h.controls.children, [wrapper, miniplayer]);
  assert.equal(h.frames.size, 0);
  h.button().click();
  h.settle();
  assert.equal(h.video.getAttribute(ATTRIBUTE), "1");
  assert.deepEqual(wrapper.children, [fullscreen, h.button()]);
});

test("mirror sizes and centres its own icon without restyling the toolbar", () => {
  const h = createHarness();
  const svg = h.button().querySelector("svg");
  assert.equal(svg.getAttribute("width"), "36");
  assert.equal(svg.getAttribute("height"), "36");
  const css = h.context.buildVideoMirrorCss();
  assert.match(css, /display: inline-flex !important/);
  assert.match(css, /align-items: center !important/);
  assert.match(css, /justify-content: center !important/);
  assert.match(css, /line-height: 0 !important/);
  for (const property of ["width", "height", "min-width", "min-height", "max-width", "max-height"]) {
    assert.ok(css.includes(`${property}: 36px !important;`));
  }
  assert.doesNotMatch(css, /\.ytp-right-controls|\.ytp-fullscreen-button|#tmk-miniplayer-button|\border:|\bfloat:/);
});

test("mirroring survives scroll reparenting and HTML/player fullscreen transitions", () => {
  const h = createHarness();
  h.button().click();
  const placeholder = h.watch.appendChild(h.document.createElement("div"));
  placeholder.id = "ytsmp-player-placeholder";
  h.document.body.appendChild(h.player);
  h.settle();
  for (const fullscreenElement of [h.document.documentElement, h.player, null]) {
    h.document.fullscreenElement = fullscreenElement;
    h.dispatch("fullscreenchange", "document");
    h.settle();
    assert.equal(h.video.getAttribute(ATTRIBUTE), "1");
    assert.equal(h.button().getAttribute("aria-pressed"), "true");
  }
  h.watch.appendChild(h.player);
  placeholder.remove();
  h.settle();
  assert.equal(h.video.getAttribute(ATTRIBUTE), "1");
});

test("hidden duplicate players and feed previews cannot steal mirror ownership", () => {
  const h = createHarness();
  const hidden = h.makeWatch(VIDEO_A);
  hidden.watch.hidden = true;
  h.document.body.insertBefore(hidden.watch, h.watch);
  const previewHost = h.document.body.appendChild(h.document.createElement("ytd-video-preview"));
  const preview = h.makeWatch(VIDEO_A, previewHost);
  h.document.body.insertBefore(previewHost, hidden.watch);
  h.dispatch("yt-page-data-updated");
  h.settle();
  h.button().click();
  assert.equal(h.video.getAttribute(ATTRIBUTE), "1");
  assert.equal(hidden.video.hasAttribute(ATTRIBUTE), false);
  assert.equal(preview.video.hasAttribute(ATTRIBUTE), false);
  assert.equal(h.button().parentElement, h.controls);
});

test("hidden stale placeholders cannot displace a floating player's rendered owner", () => {
  const h = createHarness();
  h.button().click();
  const stale = h.makeWatch(VIDEO_B);
  stale.watch.hidden = true;
  const stalePlaceholder = stale.watch.appendChild(h.document.createElement("div"));
  stalePlaceholder.id = "ytsmp-player-placeholder";
  h.document.body.insertBefore(stale.watch, h.watch);
  const activePlaceholder = h.watch.appendChild(h.document.createElement("div"));
  activePlaceholder.id = "ytsmp-player-placeholder";
  h.document.body.appendChild(h.player);
  h.settle();

  for (const event of ["yt-page-data-updated", "fullscreenchange"]) {
    h.dispatch(event, event === "fullscreenchange" ? "document" : "window");
    h.settle();
    assert.equal(h.video.getAttribute(ATTRIBUTE), "1");
    assert.equal(h.button()?.parentElement, h.controls);
    assert.equal(h.button()?.getAttribute("aria-pressed"), "true");
    assert.equal(stale.video.hasAttribute(ATTRIBUTE), false);
    assert.equal(h.document.querySelectorAll(`#${BUTTON_ID}`).length, 1);
  }
});

test("new video identities reset mirroring even without navigation events", () => {
  const h = createHarness();
  h.button().click();
  h.context.location.search = `?v=${VIDEO_B}`;
  h.dispatch("loadedmetadata", "document", h.video);
  h.settle();
  assert.equal(h.video.hasAttribute(ATTRIBUTE), false);
  assert.equal(h.button(), null, "stale player cannot claim the new route");
  h.player.videoId = VIDEO_B;
  h.dispatch("loadedmetadata", "document", h.video);
  h.settle();
  assert.equal(h.button().getAttribute("aria-pressed"), "false");
  assert.equal(h.video.hasAttribute(ATTRIBUTE), false);
});

test("navigation start and off-route native miniplayer/Shorts clear owned markers", () => {
  for (const pathname of ["/", "/shorts/aaaaaaaaaaa"]) {
    const h = createHarness();
    h.button().click();
    h.dispatch("yt-navigate-start");
    assert.equal(h.video.hasAttribute(ATTRIBUTE), false);
    assert.equal(h.button(), null);
    h.context.location.pathname = pathname;
    const miniplayer = h.document.body.appendChild(h.document.createElement("ytd-miniplayer"));
    miniplayer.appendChild(h.player);
    h.dispatch("yt-navigate-finish");
    h.settle();
    assert.equal(h.video.hasAttribute(ATTRIBUTE), false);
    assert.equal(h.button(), null);
  }
});

test("pagehide cancels frames and clears mirroring; BFCache restore starts unmirrored", () => {
  const h = createHarness();
  h.button().click();
  h.dispatch("fullscreenchange", "document");
  assert.equal(h.frames.size, 1);
  h.dispatch("pagehide");
  h.settle();
  assert.equal(h.frames.size, 0);
  assert.equal(h.video.hasAttribute(ATTRIBUTE), false);
  assert.equal(h.button(), null);
  h.dispatch("pageshow");
  h.settle();
  assert.equal(h.button().getAttribute("aria-pressed"), "false");
});

test("idle comments/captions/progress do no mirror subtree queries or frame work", () => {
  const h = createHarness();
  h.button().dispatch("mouseenter");
  const comments = h.watch.appendChild(h.document.createElement("ytd-comments"));
  h.settle();
  for (const target of [comments, h.captions, h.player]) {
    for (let index = 0; index < 30; index++) target.appendChild(h.document.createElement("span"));
  }
  const queries = h.counts.queries;
  const frames = h.counts.frames;
  const documentApplies = h.counts.documentApplies;
  h.deliver();
  assert.equal(h.counts.queries, queries);
  assert.equal(h.frames.size, 0);
  h.settle();
  assert.equal(h.counts.frames, frames);
  assert.equal(h.counts.documentApplies, documentApplies);
  const writes = h.counts.writes;
  h.context.scheduleVideoMirrorSync();
  h.context.scheduleVideoMirrorSync();
  assert.equal(h.frames.size, 1);
  h.settle();
  assert.equal(h.counts.writes, writes, "a stable reconciliation makes no DOM writes");
  assert.equal(h.frames.size, 0);
});

test("button self-mutations drain without scheduling whole-document work", () => {
  const h = createHarness();
  const documentApplies = h.counts.documentApplies;
  h.button().remove();
  const frames = h.counts.frames;
  h.settle();
  assert.equal(h.counts.frames, frames + 1);
  assert.equal(h.frames.size, 0);
  assert.equal(h.counts.documentApplies, documentApplies);
});

test("player API readiness can recover through metadata or page data without polling", () => {
  const h = createHarness();
  delete h.player.getVideoData;
  h.dispatch("loadedmetadata", "document", h.video);
  h.settle();
  assert.equal(h.button(), null);
  assert.equal(h.frames.size, 0);
  h.player.getVideoData = () => ({ video_id: VIDEO_A });
  h.dispatch("yt-page-data-updated");
  h.settle();
  assert.ok(h.button());
  assert.equal(h.frames.size, 0);
});

test("disabled mirror feature and wrong-player clicks do not alter videos", () => {
  const disabled = createHarness({ enabled: false });
  assert.equal(disabled.button(), null);
  assert.equal(disabled.context.buildVideoMirrorCss(), "");
  const h = createHarness();
  const oldButton = h.button();
  h.context.location.search = `?v=${VIDEO_B}`;
  oldButton.click();
  h.settle();
  assert.equal(h.video.hasAttribute(ATTRIBUTE), false);
  assert.equal(h.button(), null);
});

test("live routes use their video identity and ignore preview metadata", () => {
  const h = createHarness();
  h.dispatch("yt-navigate-start");
  h.context.location.pathname = `/live/${VIDEO_A}`;
  h.context.location.search = "";
  h.dispatch("yt-navigate-finish");
  h.settle();
  h.button().click();
  assert.equal(h.video.getAttribute(ATTRIBUTE), "1");
  const previewHost = h.document.body.appendChild(h.document.createElement("ytd-video-preview"));
  const preview = h.makeWatch(VIDEO_A, previewHost);
  h.settle();
  h.dispatch("loadedmetadata", "document", preview.video);
  assert.equal(h.frames.size, 0);
  assert.equal(preview.video.hasAttribute(ATTRIBUTE), false);
});
