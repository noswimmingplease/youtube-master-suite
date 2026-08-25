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
    querySelectorAll: (selector) =>
      selector ===
      "#sponsorBlockPopupContainer,#sponsorBlockPopupContainer iframe"
        ? [visiblePopup, visiblePopupFrame]
        : [],
    removeAttribute: (name) => attributes.delete(name),
    setAttribute: (name) => attributes.add(name),
  };
  hiddenRelated.parentElement = watchFlexy;
  visiblePopup.parentElement = watchFlexy;
  visiblePopup.closest = () => watchFlexy;
  visiblePopupFrame.closest = () => watchFlexy;

  const context = {
    AUXILIARY_RAIL_SURFACE_SELECTOR:
      "#sponsorBlockPopupContainer,#sponsorBlockPopupContainer iframe",
    CHAT_SURFACE_SELECTOR: "chat",
    EMPTY_SECONDARY_RAIL_ATTRIBUTE: "data-ywlc-empty-secondary-rail",
    PLAYLIST_PANEL_SELECTOR: "queue",
    TWO_COLUMN_WATCH_FLEXY_SELECTOR: "watch",
    document: {
      querySelectorAll: () => [watchFlexy],
    },
    getComputedStyle: (element) => ({
      display: element.hidden ? "none" : "block",
      visibility: "visible",
    }),
    isWatchPath: () => true,
    railStateReconciliationFrame: 1,
  };

  for (const functionName of [
    "canRenderSurface",
    "isElementOrAncestorHidden",
    "isActiveChatSurface",
    "isActiveQueuePanel",
    "isActiveAuxiliaryRailSurface",
    "reconcileSecondaryRailState",
  ]) {
    vm.runInNewContext(extractFunction(WATCH_LAYOUT_SOURCE, functionName), context);
  }

  return { attributes, context, visiblePopupFrame };
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
