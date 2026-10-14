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
  const attributes = new Set();
  const engagementPanels = [];
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
    getAttribute: () => null,
    hasAttribute: (name) => attributes.has(name),
    matches: () => true,
    querySelector: (selector) =>
      selector === "#related" ? hiddenRelated : null,
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
      return [];
    },
    removeAttribute: (name) => attributes.delete(name),
    setAttribute: (name) => attributes.add(name),
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
    PLAYLIST_PANEL_SELECTOR: "queue",
    TWO_COLUMN_WATCH_FLEXY_SELECTOR: "watch",
    document: {
      querySelectorAll: () => [watchFlexy],
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
    context,
    engagementPanels,
    secondary,
    visiblePopupFrame,
    watchFlexy,
  };
}

function addEngagementPanel(harness, options = {}) {
  const panel = {
    hidden: false,
    isConnected: true,
    parentElement: harness.secondary,
    visibility: "ENGAGEMENT_PANEL_VISIBILITY_EXPANDED",
    getAttribute(name) {
      return name === "visibility" ? this.visibility : null;
    },
    hasAttribute(name) {
      return name === "collapsed" && Boolean(this.collapsed);
    },
    closest: () => harness.watchFlexy,
    getBoundingClientRect: () => ({ height: 500, width: 0 }),
    ...options,
  };
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

test("an expanded engagement panel reopens a collapsed rail without relying on its width", () => {
  const harness = createHarness();
  addEngagementPanel(harness);
  harness.attributes.add(harness.context.EMPTY_SECONDARY_RAIL_ATTRIBUTE);
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
