import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

const WATCH_LAYOUT_SOURCE = readFileSync(
  new URL(
    "../sources/modules/youtube-watch-layout-cleaner.user.js",
    import.meta.url,
  ),
  "utf8",
);

function extractFunction(source, functionName) {
  const marker = `function ${functionName}(`;
  const start = source.indexOf(marker);
  assert.notEqual(start, -1, `Missing ${functionName}`);

  const bodyStart = source.indexOf("{", start);
  let depth = 0;
  for (let index = bodyStart; index < source.length; index += 1) {
    if (source[index] === "{") depth += 1;
    if (source[index] !== "}") continue;
    depth -= 1;
    if (depth === 0) return source.slice(start, index + 1);
  }

  assert.fail(`Unterminated ${functionName}`);
}

function createHarness() {
  const attributes = new Map();
  const attributeWrites = [];
  const dispatchedEvents = [];
  const resizeSnapshots = [];
  const engagementPanels = [];
  const chatSurfaces = [];
  const queuePanels = [];
  const secondary = {
    hidden: false,
    isConnected: true,
    parentElement: null,
    getAttribute: () => null,
  };
  const visiblePopup = {
    hidden: false,
    isConnected: true,
    parentElement: null,
    getAttribute: () => null,
    getBoundingClientRect: () => ({ height: 0, width: 0 }),
  };
  const visiblePopupFrame = {
    hidden: false,
    isConnected: true,
    parentElement: visiblePopup,
    getAttribute: () => null,
    getBoundingClientRect: () => ({ height: 500, width: 374 }),
  };
  const hiddenRelated = {
    hidden: true,
    isConnected: true,
    parentElement: null,
    getAttribute: () => null,
  };
  const watchFlexy = {
    hidden: false,
    isConnected: true,
    parentElement: null,
    twoColumn: true,
    getAttribute: (name) => attributes.get(name) ?? null,
    hasAttribute: (name) => attributes.has(name),
    matches: (selector) => selector === "ytd-watch-flexy" || (selector === "watch" && watchFlexy.twoColumn),
    querySelector: (selector) => {
      if (selector === "#related") return hiddenRelated;
      for (const surface of [...chatSurfaces, ...queuePanels, ...engagementPanels]) {
        if (surface.matches(selector)) return surface;
        const match = surface.querySelector(selector);
        if (match) return match;
      }
      return null;
    },
    querySelectorAll: (selector) => {
      if (
        selector === "#sponsorBlockPopupContainer,#sponsorBlockPopupContainer iframe"
      ) {
        return [visiblePopup, visiblePopupFrame];
      }
      if (selector === "#secondary ytd-engagement-panel-section-list-renderer") {
        return engagementPanels.filter(
          (panel) => panel.parentElement === secondary,
        );
      }
      if (selector === "chat") return chatSurfaces;
      if (selector === "queue") return queuePanels;
      return [];
    },
    removeAttribute: (name) => {
      attributeWrites.push(["remove", name]);
      attributes.delete(name);
    },
    setAttribute: (name, value) => {
      attributeWrites.push(["set", name, value]);
      attributes.set(name, String(value));
    },
  };
  hiddenRelated.parentElement = watchFlexy;
  secondary.parentElement = watchFlexy;
  visiblePopup.parentElement = watchFlexy;
  visiblePopup.closest = () => watchFlexy;
  visiblePopupFrame.closest = () => watchFlexy;

  const context = {
    AUXILIARY_RAIL_SURFACE_SELECTOR:
      "#sponsorBlockPopupContainer,#sponsorBlockPopupContainer iframe",
    CHAT_SURFACE_SELECTOR: "chat",
    ENGAGEMENT_PANEL_SELECTOR: "ytd-engagement-panel-section-list-renderer",
    EMPTY_SECONDARY_RAIL_ATTRIBUTE: "data-ywlc-empty-secondary-rail",
    MANAGED_LIVE_CHAT_ATTRIBUTE: "data-ywlc-managed-chat",
    PLAYLIST_PANEL_SELECTOR: "queue",
    QUEUE_ITEM_SELECTOR: "queue-item",
    TWO_COLUMN_WATCH_FLEXY_SELECTOR: "watch",
    document: {
      querySelectorAll: () => [watchFlexy],
    },
    Event: class {
      constructor(type) { this.type = type; }
    },
    window: {
      dispatchEvent: (event) => {
        dispatchedEvents.push(event);
        if (event.type === "resize") resizeSnapshots.push(new Map(attributes));
        return true;
      },
    },
    getComputedStyle: (element) => ({
      display: element.hidden ? "none" : "block",
      visibility: element.cssVisibility || "visible",
    }),
    isWatchPath: () => true,
    railStateReconciliationFrame: 1,
  };

  for (const functionName of [
    "canRenderSurface",
    "isElementOrAncestorHidden",
    "isFloatingChatSurface",
    "getManagedLiveChatState",
    "isActiveChatSurface",
    "isActiveQueuePanel",
    "isActiveEngagementPanel",
    "isActiveAuxiliaryRailSurface",
    "reconcileSecondaryRailState",
  ]) {
    vm.runInNewContext(extractFunction(WATCH_LAYOUT_SOURCE, functionName), context);
  }

  return {
    attributes,
    attributeWrites,
    context,
    chatSurfaces,
    dispatchedEvents,
    engagementPanels,
    queuePanels,
    resizeSnapshots,
    secondary,
    visiblePopupFrame,
    watchFlexy,
  };
}

function createRailSurface(harness, tagName, options = {}) {
  const attributes = new Map();
  const classes = new Set();
  const surface = {
    tagName,
    id: "",
    hidden: false,
    isConnected: true,
    parentElement: harness.secondary,
    children: [],
    collapsed: false,
    popoverOpen: false,
    chatSurface: tagName === "ytd-live-chat-frame",
    classList: {
      add: (...names) => names.forEach((name) => classes.add(name)),
      remove: (...names) => names.forEach((name) => classes.delete(name)),
      contains: (name) => classes.has(name),
    },
    getAttribute(name) {
      if (name === "visibility") return this.visibility ?? null;
      if (name === "collapsed") return this.collapsed ? "" : null;
      if (name === "id") return this.id || null;
      return attributes.get(name) ?? null;
    },
    hasAttribute(name) { return this.getAttribute(name) !== null; },
    setAttribute(name, value) { attributes.set(name, String(value)); },
    removeAttribute(name) { attributes.delete(name); },
    matches(selector) {
      return selector.split(",").some((part) => {
        part = part.trim();
        if (part === "chat") return this.chatSurface;
        if (part === "queue") return this.tagName === "ytd-playlist-panel-renderer";
        if (part === "queue-item") return this.tagName === "ytd-playlist-panel-video-renderer";
        if (part === ":popover-open") return this.popoverOpen;
        const tag = part.match(/^[a-z][a-z\d-]*/i)?.[0];
        if (tag && tag !== this.tagName) return false;
        const id = part.match(/#([\w-]+)/)?.[1];
        if (id && id !== this.id) return false;
        for (const match of part.matchAll(/\.([\w-]+)/g)) {
          if (!this.classList.contains(match[1])) return false;
        }
        if (part.includes(":popover-open") && !this.popoverOpen) return false;
        for (const match of part.matchAll(/\[([\w-]+)(?:=["']?([^\]"']+)["']?)?\]/g)) {
          if (!this.hasAttribute(match[1])) return false;
          if (match[2] !== undefined && this.getAttribute(match[1]) !== match[2]) return false;
        }
        return Boolean(tag || id || part.startsWith("[") || part.startsWith("."));
      });
    },
    querySelector(selector) {
      for (const child of this.children) {
        if (child.matches(selector)) return child;
        const match = child.querySelector(selector);
        if (match) return match;
      }
      return null;
    },
    closest(selector) {
      for (let node = this; node; node = node.parentElement) {
        if (node.matches?.(selector)) return node;
      }
      return null;
    },
    getBoundingClientRect: () => ({ height: 500, width: 374 }),
    ...options,
  };
  return surface;
}

function addChatFrame(harness, options = {}) {
  const frame = createRailSurface(harness, "ytd-live-chat-frame", { id: "chat", ...options });
  harness.chatSurfaces.push(frame);
  if (Array.isArray(frame.parentElement?.children)) frame.parentElement.children.push(frame);
  harness.visiblePopupFrame.getBoundingClientRect = () => ({ height: 0, width: 0 });
  return frame;
}

function addFloatingChatFrame(harness, options = {}) {
  const frame = addChatFrame(harness, { popoverOpen: true, ...options });
  frame.setAttribute("data-ytppl-live-chat-panel", "1");
  frame.setAttribute("popover", "manual");
  return frame;
}

function addQueuePanel(harness) {
  const panel = createRailSurface(harness, "ytd-playlist-panel-renderer");
  const item = createRailSurface(harness, "ytd-playlist-panel-video-renderer", { parentElement: panel });
  panel.children.push(item);
  harness.queuePanels.push(panel);
  return panel;
}

function addEngagementPanel(harness, options = {}) {
  const panel = createRailSurface(harness, "ytd-engagement-panel-section-list-renderer", {
    visibility: "ENGAGEMENT_PANEL_VISIBILITY_EXPANDED",
    getBoundingClientRect: () => ({ height: 500, width: 0 }),
    ...options,
  });
  harness.engagementPanels.push(panel);
  harness.visiblePopupFrame.getBoundingClientRect = () => ({
    height: 0,
    width: 0,
  });
  return panel;
}

function getMutationConstants() {
  const start = WATCH_LAYOUT_SOURCE.indexOf("  const CONFIG = {");
  const end = WATCH_LAYOUT_SOURCE.indexOf("  function px(");
  return vm.runInNewContext(`${WATCH_LAYOUT_SOURCE.slice(start, end)}\n({
    AUXILIARY_RAIL_SURFACE_SELECTOR,
    CHAT_SURFACE_SELECTOR,
    DISCOVERY_MUTATION_ATTRIBUTES,
    ENGAGEMENT_PANEL_SELECTOR,
    PANEL_MUTATION_ATTRIBUTES,
    PLAYLIST_PANEL_SELECTOR,
    QUEUE_ITEM_MUTATION_ATTRIBUTES,
    QUEUE_ITEM_SELECTOR,
    RAIL_MUTATION_TARGET_SELECTOR,
    SURFACE_STATE_MUTATION_ATTRIBUTES,
  })`);
}

function createThumbnailHarness() {
  const observed = new Set();
  const applied = [];
  const pendingQueueThumbnailItems = new Set();
  let callback;
  const context = {
    ...getMutationConstants(),
    Node: { ELEMENT_NODE: 1 },
    QUEUE_THUMBNAIL_FALLBACK_ROOT_MARGIN: "200px 0px",
    queueThumbnailFallbackObserver: null,
    pendingQueueThumbnailItems,
    IntersectionObserver: class {
      constructor(handler) {
        callback = handler;
      }
      observe(item) {
        observed.add(item);
      }
      unobserve(item) {
        observed.delete(item);
      }
    },
    isWatchPath: () => true,
    applyQueueThumbnailFallback: (item) => applied.push(item),
  };
  for (const name of [
    "getQueueThumbnailFallbackObserver",
    "unobserveRemovedQueueItems",
  ]) {
    vm.runInNewContext(extractFunction(WATCH_LAYOUT_SOURCE, name), context);
  }
  const observer = context.getQueueThumbnailFallbackObserver();
  const createItem = (connected = true) => ({
    nodeType: 1,
    isConnected: connected,
    closest: () => connected ? {} : null,
    matches: (selector) => selector === context.QUEUE_ITEM_SELECTOR,
    querySelectorAll: () => [],
  });
  return {
    applied,
    context,
    createItem,
    observed,
    observer,
    pendingQueueThumbnailItems,
    deliver: (entries) => callback(entries, observer),
  };
}

test("a visible SponsorBlock iframe prevents collapse from a zero-width rail", () => {
  const { attributes, context } = createHarness();
  context.reconcileSecondaryRailState();
  assert.equal(attributes.has(context.EMPTY_SECONDARY_RAIL_ATTRIBUTE), false);
});

test("a zero-sized SponsorBlock iframe still permits empty-rail collapse", () => {
  const { attributes, context, visiblePopupFrame } = createHarness();
  visiblePopupFrame.getBoundingClientRect = () => ({ height: 0, width: 0 });
  context.reconcileSecondaryRailState();
  assert.equal(attributes.has(context.EMPTY_SECONDARY_RAIL_ATTRIBUTE), true);
});

test("an owned open chat popover does not reserve an otherwise empty sidebar", () => {
  const harness = createHarness();
  addFloatingChatFrame(harness);
  harness.context.reconcileSecondaryRailState();
  assert.equal(harness.attributes.has(harness.context.EMPTY_SECONDARY_RAIL_ATTRIBUTE), true);
});

test("a dedicated native chat wrapper does not reserve width around its floating frame", () => {
  const harness = createHarness();
  const wrapper = addEngagementPanel(harness, { chatSurface: true });
  wrapper.setAttribute("target-id", "engagement-panel-live-chat");
  harness.chatSurfaces.push(wrapper);
  addFloatingChatFrame(harness, { parentElement: wrapper });
  harness.context.reconcileSecondaryRailState();
  assert.equal(harness.attributes.has(harness.context.EMPTY_SECONDARY_RAIL_ATTRIBUTE), true);
});

test("native in-flow chat, stale markers and unowned popovers still reserve sidebar width", () => {
  for (const mode of ["native", "stale-marker", "unowned-popover", "foreign-marker"]) {
    const harness = createHarness();
    const frame = addChatFrame(harness, { popoverOpen: mode.endsWith("popover") || mode === "foreign-marker" });
    if (mode === "stale-marker") frame.setAttribute("data-ytppl-live-chat-panel", "1");
    if (mode === "foreign-marker") frame.setAttribute("data-ytppl-live-chat-panel", "0");
    if (frame.popoverOpen) frame.setAttribute("popover", "manual");
    harness.context.reconcileSecondaryRailState();
    assert.equal(harness.attributes.has(harness.context.EMPTY_SECONDARY_RAIL_ATTRIBUTE), false, mode);
  }
});

test("a closed owned popover follows ordinary visibility rules rather than its stale marker", () => {
  const harness = createHarness();
  const frame = addFloatingChatFrame(harness, { popoverOpen: false, hidden: true });
  assert.equal(harness.context.isFloatingChatSurface(frame), false);
  harness.context.reconcileSecondaryRailState();
  assert.equal(harness.attributes.has(harness.context.EMPTY_SECONDARY_RAIL_ATTRIBUTE), true);
  frame.hidden = false;
  frame.removeAttribute("popover");
  harness.context.reconcileSecondaryRailState();
  assert.equal(harness.attributes.has(harness.context.EMPTY_SECONDARY_RAIL_ATTRIBUTE), false);
});

test("unsupported popover selectors fail open and retain usable native chat's rail", () => {
  const harness = createHarness();
  const frame = addFloatingChatFrame(harness);
  const matches = frame.matches;
  frame.matches = function (selector) {
    if (selector === ":popover-open") throw new SyntaxError("Unsupported pseudo-class");
    return matches.call(this, selector);
  };
  assert.equal(harness.context.isFloatingChatSurface(frame), false);
  harness.context.reconcileSecondaryRailState();
  assert.equal(harness.attributes.has(harness.context.EMPTY_SECONDARY_RAIL_ATTRIBUTE), false);
});

test("floating chat does not release a visible SponsorBlock iframe's required rail", () => {
  const harness = createHarness();
  addFloatingChatFrame(harness);
  harness.visiblePopupFrame.getBoundingClientRect = () => ({ height: 500, width: 374 });
  harness.context.reconcileSecondaryRailState();
  assert.equal(harness.attributes.has(harness.context.EMPTY_SECONDARY_RAIL_ATTRIBUTE), false);
  harness.visiblePopupFrame.getBoundingClientRect = () => ({ height: 0, width: 0 });
  harness.context.reconcileSecondaryRailState();
  assert.equal(harness.attributes.has(harness.context.EMPTY_SECONDARY_RAIL_ATTRIBUTE), true);
});

test("floating chat does not release an active queue but permits collapse after it empties", () => {
  const harness = createHarness();
  addFloatingChatFrame(harness);
  const queue = addQueuePanel(harness);
  harness.context.reconcileSecondaryRailState();
  assert.equal(harness.attributes.has(harness.context.EMPTY_SECONDARY_RAIL_ATTRIBUTE), false);
  queue.children.length = 0;
  harness.context.reconcileSecondaryRailState();
  assert.equal(harness.attributes.has(harness.context.EMPTY_SECONDARY_RAIL_ATTRIBUTE), true);
});

test("an unrelated expanded engagement panel keeps its rail even when it contains floating chat", () => {
  const harness = createHarness();
  const panel = addEngagementPanel(harness);
  panel.setAttribute("target-id", "engagement-panel-transcript");
  addFloatingChatFrame(harness, { parentElement: panel });
  harness.context.reconcileSecondaryRailState();
  assert.equal(harness.attributes.has(harness.context.EMPTY_SECONDARY_RAIL_ATTRIBUTE), false);
});

test("SponsorBlock popup changes are part of rail mutation tracking", () => {
  assert.match(
    WATCH_LAYOUT_SOURCE,
    /RAIL_MUTATION_TARGET_SELECTOR = \[[\s\S]+?AUXILIARY_RAIL_SURFACE_SELECTOR/,
  );
  assert.match(
    WATCH_LAYOUT_SOURCE,
    /isAuxiliaryRailSurface[\s\S]+?childList: true,[\s\S]+?subtree: true/,
  );
});

test("floating-chat ownership changes are part of the existing rail mutation tracking", () => {
  assert.ok(getMutationConstants().SURFACE_STATE_MUTATION_ATTRIBUTES.includes("data-ytppl-live-chat-panel"));
});

test("unchanged rail reconciliation does not rewrite its owned state marker", () => {
  const harness = createHarness();
  const { context, attributeWrites, dispatchedEvents } = harness;
  for (let index = 0; index < 3; index++) context.reconcileSecondaryRailState();
  assert.deepEqual(attributeWrites, [], "A visible SponsorBlock panel must not repeatedly remove an absent marker");
  assert.deepEqual(dispatchedEvents, [], "Stable checks must not dispatch player resize events");
  harness.visiblePopupFrame.getBoundingClientRect = () => ({ height: 0, width: 0 });
  for (let index = 0; index < 3; index++) context.reconcileSecondaryRailState();
  assert.deepEqual(attributeWrites, [["set", context.EMPTY_SECONDARY_RAIL_ATTRIBUTE, "1"]]);
  assert.equal(dispatchedEvents.length, 1);
  harness.visiblePopupFrame.getBoundingClientRect = () => ({ height: 500, width: 374 });
  for (let index = 0; index < 3; index++) context.reconcileSecondaryRailState();
  assert.deepEqual(attributeWrites, [
    ["set", context.EMPTY_SECONDARY_RAIL_ATTRIBUTE, "1"],
    ["remove", context.EMPTY_SECONDARY_RAIL_ATTRIBUTE],
  ]);
  assert.deepEqual(dispatchedEvents.map((event) => event.type), ["resize", "resize"]);
});

test("owned open floating chat releases an empty below-player rail on narrow layouts", () => {
  const harness = createHarness();
  const { context, attributes, attributeWrites, resizeSnapshots } = harness;
  harness.watchFlexy.twoColumn = false;
  addFloatingChatFrame(harness);

  context.reconcileSecondaryRailState();

  assert.equal(attributes.get(context.MANAGED_LIVE_CHAT_ATTRIBUTE), "open");
  assert.equal(attributes.get(context.EMPTY_SECONDARY_RAIL_ATTRIBUTE), "1");
  assert.equal(resizeSnapshots.length, 1, "Both state changes require only one player resize");
  assert.equal(resizeSnapshots[0].get(context.MANAGED_LIVE_CHAT_ATTRIBUTE), "open");
  assert.equal(resizeSnapshots[0].get(context.EMPTY_SECONDARY_RAIL_ATTRIBUTE), "1");
  assert.equal(attributeWrites.length, 2);

  for (let index = 0; index < 3; index++) context.reconcileSecondaryRailState();
  assert.equal(attributeWrites.length, 2, "Stable checks must not rewrite either state marker");
  assert.equal(resizeSnapshots.length, 1, "Stable checks must not dispatch further resize events");
});

test("a Suite-hidden native chat frame also releases an empty rail on narrow layouts", () => {
  const harness = createHarness();
  const { context, attributes, resizeSnapshots } = harness;
  harness.watchFlexy.twoColumn = false;
  const frame = addChatFrame(harness, { hidden: true });
  frame.classList.add("ytppl-live-chat-hidden");

  context.reconcileSecondaryRailState();

  assert.equal(attributes.get(context.MANAGED_LIVE_CHAT_ATTRIBUTE), "hidden");
  assert.equal(attributes.get(context.EMPTY_SECONDARY_RAIL_ATTRIBUTE), "1");
  assert.equal(resizeSnapshots.length, 1);
  assert.equal(resizeSnapshots[0].get(context.MANAGED_LIVE_CHAT_ATTRIBUTE), "hidden");
  assert.equal(resizeSnapshots[0].get(context.EMPTY_SECONDARY_RAIL_ATTRIBUTE), "1");
});

test("managed narrow chat does not collapse visible queue, SponsorBlock or unrelated panel content", () => {
  for (const chatState of ["open", "hidden"]) {
    for (const content of ["queue", "SponsorBlock", "engagement-panel"]) {
      const harness = createHarness();
      const { context, attributes, resizeSnapshots } = harness;
      harness.watchFlexy.twoColumn = false;
      if (chatState === "open") addFloatingChatFrame(harness);
      else {
        const frame = addChatFrame(harness, { hidden: true });
        frame.classList.add("ytppl-live-chat-hidden");
      }
      if (content === "queue") addQueuePanel(harness);
      if (content === "SponsorBlock") {
        harness.visiblePopupFrame.getBoundingClientRect = () => ({ height: 500, width: 374 });
      }
      if (content === "engagement-panel") addEngagementPanel(harness);

      context.reconcileSecondaryRailState();

      const description = `${chatState} chat with ${content}`;
      assert.equal(attributes.get(context.MANAGED_LIVE_CHAT_ATTRIBUTE), chatState, description);
      assert.equal(attributes.has(context.EMPTY_SECONDARY_RAIL_ATTRIBUTE), false, description);
      assert.equal(resizeSnapshots.length, 1, description);
      assert.equal(resizeSnapshots[0].has(context.EMPTY_SECONDARY_RAIL_ATTRIBUTE), false, description);
    }
  }
});

test("unmanaged narrow native layouts receive no owned layout markers or resize events", () => {
  for (const mode of ["no-chat", "native", "native-hidden", "stale-marker", "unowned-popover", "foreign-marker"]) {
    const harness = createHarness();
    const { context, attributes, attributeWrites, dispatchedEvents } = harness;
    harness.watchFlexy.twoColumn = false;
    if (mode !== "no-chat") {
      const frame = addChatFrame(harness, {
        hidden: mode === "native-hidden",
        popoverOpen: mode === "unowned-popover" || mode === "foreign-marker",
      });
      if (mode === "stale-marker") frame.setAttribute("data-ytppl-live-chat-panel", "1");
      if (mode === "foreign-marker") frame.setAttribute("data-ytppl-live-chat-panel", "0");
      if (frame.popoverOpen) frame.setAttribute("popover", "manual");
    }

    context.reconcileSecondaryRailState();

    assert.equal(attributes.has(context.MANAGED_LIVE_CHAT_ATTRIBUTE), false, mode);
    assert.equal(attributes.has(context.EMPTY_SECONDARY_RAIL_ATTRIBUTE), false, mode);
    assert.deepEqual(attributeWrites, [], mode);
    assert.deepEqual(dispatchedEvents, [], mode);
  }
});

test("the hidden-chat class only manages the recognised native chat frame", () => {
  for (const kind of ["other-id", "other-element", "dedicated-wrapper"]) {
    const harness = createHarness();
    const { context, attributes, dispatchedEvents } = harness;
    harness.watchFlexy.twoColumn = false;
    let surface;
    if (kind === "other-id") surface = addChatFrame(harness, { id: "other-chat", hidden: true });
    if (kind === "other-element") {
      surface = createRailSurface(harness, "div", { id: "chat", hidden: true });
      harness.chatSurfaces.push(surface);
    }
    if (kind === "dedicated-wrapper") {
      surface = addEngagementPanel(harness, { chatSurface: true, hidden: true });
      harness.chatSurfaces.push(surface);
    }
    surface.classList.add("ytppl-live-chat-hidden");

    context.reconcileSecondaryRailState();

    assert.equal(attributes.has(context.MANAGED_LIVE_CHAT_ATTRIBUTE), false, kind);
    assert.equal(attributes.has(context.EMPTY_SECONDARY_RAIL_ATTRIBUTE), false, kind);
    assert.deepEqual(dispatchedEvents, [], kind);
  }
});

test("open-to-hidden managed chat changes resize once even when rail emptiness is unchanged", () => {
  const harness = createHarness();
  const { context, attributes, attributeWrites, resizeSnapshots } = harness;
  const frame = addFloatingChatFrame(harness);
  context.reconcileSecondaryRailState();
  attributeWrites.length = 0;
  resizeSnapshots.length = 0;

  frame.popoverOpen = false;
  frame.hidden = true;
  frame.classList.add("ytppl-live-chat-hidden");
  context.reconcileSecondaryRailState();

  assert.equal(attributes.get(context.MANAGED_LIVE_CHAT_ATTRIBUTE), "hidden");
  assert.equal(attributes.get(context.EMPTY_SECONDARY_RAIL_ATTRIBUTE), "1");
  assert.deepEqual(attributeWrites, [["set", context.MANAGED_LIVE_CHAT_ATTRIBUTE, "hidden"]]);
  assert.equal(resizeSnapshots.length, 1);
  assert.equal(resizeSnapshots[0].get(context.MANAGED_LIVE_CHAT_ATTRIBUTE), "hidden");
});

test("restoring unmanaged narrow chat removes both stale owned states before one resize", () => {
  const harness = createHarness();
  const { context, attributes, attributeWrites, resizeSnapshots } = harness;
  harness.watchFlexy.twoColumn = false;
  addChatFrame(harness);
  attributes.set(context.MANAGED_LIVE_CHAT_ATTRIBUTE, "open");
  attributes.set(context.EMPTY_SECONDARY_RAIL_ATTRIBUTE, "1");

  context.reconcileSecondaryRailState();

  assert.equal(attributes.has(context.MANAGED_LIVE_CHAT_ATTRIBUTE), false);
  assert.equal(attributes.has(context.EMPTY_SECONDARY_RAIL_ATTRIBUTE), false);
  assert.equal(attributeWrites.length, 2);
  assert.equal(resizeSnapshots.length, 1);
  assert.equal(resizeSnapshots[0].size, 0, "The player must only see the completed layout state");

  context.reconcileSecondaryRailState();
  assert.equal(attributeWrites.length, 2);
  assert.equal(resizeSnapshots.length, 1);
});

test("one reconciliation batches resize for state changes on multiple native watch roots", () => {
  const first = createHarness();
  const second = createHarness();
  addFloatingChatFrame(first);
  addFloatingChatFrame(second);
  first.context.document.querySelectorAll = () => [first.watchFlexy, second.watchFlexy];

  first.context.reconcileSecondaryRailState();

  for (const harness of [first, second]) {
    assert.equal(harness.attributes.get(first.context.MANAGED_LIVE_CHAT_ATTRIBUTE), "open");
    assert.equal(harness.attributes.get(first.context.EMPTY_SECONDARY_RAIL_ATTRIBUTE), "1");
  }
  assert.equal(first.dispatchedEvents.length, 1);
  assert.equal(first.dispatchedEvents[0].type, "resize");
});

test("an expanded engagement panel reopens a collapsed rail without relying on its width", () => {
  const harness = createHarness();
  addEngagementPanel(harness);
  harness.attributes.set(harness.context.EMPTY_SECONDARY_RAIL_ATTRIBUTE, "1");
  harness.context.reconcileSecondaryRailState();
  assert.equal(harness.attributes.has(harness.context.EMPTY_SECONDARY_RAIL_ATTRIBUTE), false);
});

test("hidden, collapsed and off-rail engagement panels do not reserve rail width", () => {
  for (const options of [
    { visibility: "ENGAGEMENT_PANEL_VISIBILITY_HIDDEN" },
    { visibility: "ENGAGEMENT_PANEL_VISIBILITY_COLLAPSED" },
    { hidden: true },
    { collapsed: true },
    { cssVisibility: "hidden" },
    { isConnected: false },
    { parentElement: {} },
  ]) {
    const harness = createHarness();
    addEngagementPanel(harness, options);
    harness.context.reconcileSecondaryRailState();
    assert.equal(harness.attributes.has(harness.context.EMPTY_SECONDARY_RAIL_ATTRIBUTE), true);
  }
});

test("engagement panels respect hidden ancestors and collapse after their state changes", () => {
  const harness = createHarness();
  const panel = addEngagementPanel(harness, { visibility: null });
  harness.context.reconcileSecondaryRailState();
  assert.equal(harness.attributes.has(harness.context.EMPTY_SECONDARY_RAIL_ATTRIBUTE), false);
  harness.secondary.hidden = true;
  harness.context.reconcileSecondaryRailState();
  assert.equal(harness.attributes.has(harness.context.EMPTY_SECONDARY_RAIL_ATTRIBUTE), true);
  harness.secondary.hidden = false;
  panel.visibility = "ENGAGEMENT_PANEL_VISIBILITY_HIDDEN";
  harness.context.reconcileSecondaryRailState();
  assert.equal(harness.attributes.has(harness.context.EMPTY_SECONDARY_RAIL_ATTRIBUTE), true);
});

test("engagement panel visibility and insertion/removal trigger rail reconciliation", () => {
  const context = { ...getMutationConstants(), Node: { ELEMENT_NODE: 1 } };
  for (const name of [
    "getNodeElement",
    "nodeContainsRailMutationTarget",
    "nodeContainsQueueItem",
    "isDiscoveryMutationTarget",
    "mutationAffectsRailState",
  ]) {
    vm.runInNewContext(extractFunction(WATCH_LAYOUT_SOURCE, name), context);
  }
  const panel = {
    nodeType: 1,
    matches: (selector) => selector.split(",").includes(context.ENGAGEMENT_PANEL_SELECTOR),
    closest: () => null,
    querySelector: () => null,
  };
  assert.ok(context.DISCOVERY_MUTATION_ATTRIBUTES.includes("visibility"));
  assert.ok(context.PANEL_MUTATION_ATTRIBUTES.includes("visibility"));
  assert.equal(context.mutationAffectsRailState({
    type: "attributes",
    attributeName: "visibility",
    target: panel,
  }), true);
  for (const changed of ["addedNodes", "removedNodes"]) {
    assert.equal(context.mutationAffectsRailState({
      type: "childList",
      target: { nodeType: 1, closest: () => null },
      addedNodes: [],
      removedNodes: [],
      [changed]: [panel],
    }), true);
  }
});

test("detached non-intersecting queue rows are unobserved without loading thumbnails", () => {
  const harness = createThumbnailHarness();
  const item = harness.createItem(false);
  harness.observer.observe(item);
  harness.pendingQueueThumbnailItems.add(item);
  harness.deliver([{ target: item, isIntersecting: false }]);
  assert.equal(harness.observed.size, 0);
  assert.equal(harness.pendingQueueThumbnailItems.size, 0);
  assert.equal(harness.applied.length, 0);
});

test("connected offscreen rows remain observed and visible rows receive one fallback", () => {
  const harness = createThumbnailHarness();
  const item = harness.createItem();
  harness.observer.observe(item);
  harness.deliver([{ target: item, isIntersecting: false }]);
  assert.equal(harness.observed.has(item), true);
  harness.deliver([{ target: item, isIntersecting: true }]);
  assert.equal(harness.observed.size, 0);
  assert.deepEqual(harness.applied, [item]);
});

test("removed rows and removed panels release observed and pending queue items", () => {
  const harness = createThumbnailHarness();
  const removedRow = harness.createItem(false);
  const nestedRow = harness.createItem(false);
  const movedRow = harness.createItem(true);
  for (const row of [removedRow, nestedRow, movedRow]) {
    harness.observer.observe(row);
    harness.pendingQueueThumbnailItems.add(row);
  }
  harness.context.unobserveRemovedQueueItems(removedRow);
  harness.context.unobserveRemovedQueueItems({
    nodeType: 1,
    matches: () => false,
    querySelectorAll: () => [nestedRow, movedRow],
  });
  assert.deepEqual([...harness.observed], [movedRow]);
  assert.deepEqual([...harness.pendingQueueThumbnailItems], [movedRow]);
});

test("the rail mutation callback unregisters removed offscreen queue rows", () => {
  const harness = createThumbnailHarness();
  const item = harness.createItem(false);
  harness.observer.observe(item);
  harness.pendingQueueThumbnailItems.add(item);
  let callback;
  Object.assign(harness.context, {
    MutationObserver: class {
      constructor(handler) {
        callback = handler;
      }
    },
    mutationAffectsRailState: () => false,
    addQueueItemsFromNode: () => {},
    nodeContainsRailMutationTarget: () => false,
    scheduleQueueThumbnailItems: () => {},
  });
  const start = WATCH_LAYOUT_SOURCE.indexOf("  const railMutationObserver = new MutationObserver(");
  const end = WATCH_LAYOUT_SOURCE.indexOf("  function applyQueueThumbnailFallbacks(", start);
  vm.runInNewContext(WATCH_LAYOUT_SOURCE.slice(start, end), harness.context);
  callback([{ type: "childList", target: {}, addedNodes: [], removedNodes: [item] }]);
  assert.equal(harness.observed.size, 0);
  assert.equal(harness.pendingQueueThumbnailItems.size, 0);
});
