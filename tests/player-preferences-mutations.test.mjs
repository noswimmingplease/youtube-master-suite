import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

const PLAYER_PREFERENCES_SOURCE = readFileSync(
  new URL(
    "../sources/modules/youtube-player-preferences-lite.user.js",
    import.meta.url,
  ),
  "utf8",
);

function extractFunction(source, functionName) {
  const marker = `function ${functionName}(`;
  const start = source.indexOf(marker);
  assert.notEqual(start, -1, `Missing ${functionName}`);

  const bodyStart = source.indexOf("{", start);
  assert.notEqual(bodyStart, -1, `Missing ${functionName} body`);

  let depth = 0;
  let quote = "";
  let escaped = false;
  let lineComment = false;
  let blockComment = false;

  for (let index = bodyStart; index < source.length; index += 1) {
    const character = source[index];
    const nextCharacter = source[index + 1];

    if (lineComment) {
      if (character === "\n") lineComment = false;
      continue;
    }
    if (blockComment) {
      if (character === "*" && nextCharacter === "/") {
        blockComment = false;
        index += 1;
      }
      continue;
    }
    if (quote) {
      if (escaped) {
        escaped = false;
      } else if (character === "\\") {
        escaped = true;
      } else if (character === quote) {
        quote = "";
      }
      continue;
    }
    if (character === "/" && nextCharacter === "/") {
      lineComment = true;
      index += 1;
      continue;
    }
    if (character === "/" && nextCharacter === "*") {
      blockComment = true;
      index += 1;
      continue;
    }
    if (character === '"' || character === "'" || character === "`") {
      quote = character;
      continue;
    }
    if (character === "{") depth += 1;
    if (character !== "}") continue;

    depth -= 1;
    if (depth === 0) {
      return source.slice(start, index + 1);
    }
  }

  assert.fail(`Unterminated ${functionName}`);
}

class CountingClassList {
  constructor(classNames) {
    this.classNames = new Set(classNames);
    this.addCalls = 0;
    this.removeCalls = 0;
  }

  contains(className) {
    return this.classNames.has(className);
  }

  add(...classNames) {
    this.addCalls += 1;
    classNames.forEach((className) => this.classNames.add(className));
  }

  remove(...classNames) {
    this.removeCalls += 1;
    classNames.forEach((className) => this.classNames.delete(className));
  }
}

test("RYD class normalisation makes no writes once the button is stable", () => {
  const context = {};
  vm.runInNewContext(
    `${extractFunction(
      PLAYER_PREFERENCES_SOURCE,
      "applyRydIconLeadingClasses",
    )}; this.applyRydIconLeadingClasses = applyRydIconLeadingClasses;`,
    context,
  );

  const stableClassList = new CountingClassList([
    "ytSpecButtonShapeNextIconLeading",
    "yt-spec-button-shape-next--icon-leading",
  ]);
  const stableButton = { classList: stableClassList };

  context.applyRydIconLeadingClasses(stableButton);
  context.applyRydIconLeadingClasses(stableButton);

  assert.equal(stableClassList.removeCalls, 0);
  assert.equal(stableClassList.addCalls, 0);

  const oldClassList = new CountingClassList([
    "ytSpecButtonShapeNextIconButton",
    "yt-spec-button-shape-next--icon-button",
  ]);
  const oldButton = { classList: oldClassList };

  context.applyRydIconLeadingClasses(oldButton);
  context.applyRydIconLeadingClasses(oldButton);

  assert.equal(oldClassList.removeCalls, 1);
  assert.equal(oldClassList.addCalls, 1);
});

function createSurfaceRoot({ matches = [], contains = [], closest = {} } = {}) {
  const matchingSelectors = new Set(matches);
  const containedSelectors = new Set(contains);
  const closestSelectors = new Map(Object.entries(closest));
  const root = {
    nodeType: 1,
    matches: (selector) => matchingSelectors.has(selector),
    closest: (selector) =>
      matchingSelectors.has(selector) ? root : closestSelectors.get(selector),
    querySelector: (selector) =>
      containedSelectors.has(selector) ? { nodeType: 1 } : null,
  };
  return root;
}

function createDynamicApplyHarness() {
  const calls = [];
  const callRoots = new Map();
  const document = { nodeType: 9 };
  const context = {
    document,
    Node: { DOCUMENT_NODE: 9 },
    getApplyRoot: (root) => root,
    closestElement: (target, selector) => target?.closest?.(selector) || null,
    UPCOMING_STREAM_SCAN_SELECTOR: "feed-card",
    TOPBAR_DYNAMIC_MUTATION_SURFACE_SELECTOR: "topbar",
    SHORTS_DYNAMIC_MUTATION_SURFACE_SELECTOR: "shorts",
    FEED_DYNAMIC_MUTATION_SURFACE_SELECTOR: "feed",
    WATCH_PRIMARY_ACTION_MUTATION_SURFACE_SELECTOR: "primary-actions",
    WATCH_PRIMARY_ACTION_CONTAINER_SELECTOR: "primary-action-container",
    DYNAMIC_MUTATION_SURFACE_SELECTOR: "dynamic-surface",
    WATCH_ACTION_BUTTON_SELECTOR: "watch-action",
    WATCH_INFO_TEXT_SELECTOR: "watch-info",
    WATCH_DESCRIPTION_MUTATION_SURFACE_SELECTOR: "description",
    WATCH_ACTION_MENU_MUTATION_SURFACE_SELECTOR: "action-menu",
  };

  for (const functionName of [
    "useStandardMastheadLogo",
    "clearLegacyHiddenWatchActionButtons",
    "rewriteShortsLinks",
    "hideUpcomingStreams",
    "hidePayToWatchCards",
    "hideWatchedVideos",
    "normaliseReturnYoutubeLikeButtons",
    "normaliseReturnYoutubeDislikeButtons",
    "normaliseWatchInfoText",
    "runDescriptionCleanup",
    "hideWatchActionMenuItems",
  ]) {
    context[functionName] = (root) => {
      calls.push(functionName);
      callRoots.set(functionName, root);
    };
  }

  context.collectMatchingElements = (root) => root?.watchActions || [];
  context.isPreservedWatchActionButton = (actionElement) =>
    actionElement?.isLike === true;
  context.setWatchActionHidden = (actionElement, hidden) => {
    actionElement.hidden = hidden;
  };
  context.isConfiguredWatchActionMatch = () => false;
  context.isConfiguredInlineWatchActionMatch = () => false;

  vm.runInNewContext(
    `${extractFunction(
      PLAYER_PREFERENCES_SOURCE,
      "hideWatchActionButtons",
    )}; this.sourceHideWatchActionButtons = hideWatchActionButtons;`,
    context,
  );
  context.hideWatchActionButtons = (root) => {
    calls.push("hideWatchActionButtons");
    callRoots.set("hideWatchActionButtons", root);
    context.sourceHideWatchActionButtons(root);
  };

  vm.runInNewContext(
    `${extractFunction(
      PLAYER_PREFERENCES_SOURCE,
      "rootIntersectsSurface",
    )}\n${extractFunction(
      PLAYER_PREFERENCES_SOURCE,
      "getFeedApplyRoot",
    )}\n${extractFunction(
      PLAYER_PREFERENCES_SOURCE,
      "getWatchPrimaryActionApplyRoot",
    )}\n${extractFunction(
      PLAYER_PREFERENCES_SOURCE,
      "applyDynamicPreferences",
    )}\n${extractFunction(
      PLAYER_PREFERENCES_SOURCE,
      "getScopedMutationRoot",
    )}\nthis.applyDynamicPreferences = applyDynamicPreferences;\nthis.getScopedMutationRoot = getScopedMutationRoot;`,
    context,
  );

  return {
    apply: context.applyDynamicPreferences,
    scope: context.getScopedMutationRoot,
    calls,
    callRoots,
    document,
  };
}

test("description mutations run only description cleanup", () => {
  const harness = createDynamicApplyHarness();

  harness.apply(createSurfaceRoot({ matches: ["description"] }));

  assert.deepEqual(harness.calls, ["runDescriptionCleanup"]);
});

test("feed-card mutations do not run watch-page handlers", () => {
  const harness = createDynamicApplyHarness();
  const enclosingCard = { nodeType: 1 };
  const nestedFeedSurface = createSurfaceRoot({
    matches: ["feed"],
    closest: { "feed-card": enclosingCard },
  });

  harness.apply(nestedFeedSurface);

  assert.deepEqual(harness.calls, [
    "hideUpcomingStreams",
    "hidePayToWatchCards",
    "hideWatchedVideos",
  ]);
  for (const handler of harness.calls) {
    assert.equal(harness.callRoots.get(handler), enclosingCard);
  }
});

test("the primary-action surface retains late standalone RYD controls", () => {
  const definition = PLAYER_PREFERENCES_SOURCE.match(
    /const WATCH_PRIMARY_ACTION_MUTATION_SURFACE_SELECTOR = \[[\s\S]+?\]\.join\(","\);/,
  )?.[0];

  assert.ok(definition, "Missing primary-action mutation surface");
  assert.match(definition, /RYD_LIKE_BUTTON_SELECTOR/);
  assert.match(definition, /RYD_DISLIKE_BUTTON_SELECTOR/);
});

test("a late RYD mutation clears a recycled hidden action through its enclosing menu", () => {
  const harness = createDynamicApplyHarness();
  const recycledLikeAction = { hidden: true, isLike: true };
  const enclosingMenu = {
    nodeType: 1,
    watchActions: [recycledLikeAction],
  };
  const rydButton = createSurfaceRoot({
    matches: ["dynamic-surface", "primary-actions"],
    closest: { "primary-action-container": enclosingMenu },
  });

  const scopedRoot = harness.scope(rydButton);
  assert.equal(scopedRoot, rydButton);

  harness.apply(scopedRoot);

  assert.equal(harness.callRoots.get("hideWatchActionButtons"), enclosingMenu);
  assert.equal(recycledLikeAction.hidden, false);
});

test("an inserted wrapper runs only handlers for surfaces it contains", () => {
  const harness = createDynamicApplyHarness();

  harness.apply(
    createSurfaceRoot({ contains: ["primary-actions", "description"] }),
  );

  assert.deepEqual(harness.calls, [
    "normaliseReturnYoutubeLikeButtons",
    "normaliseReturnYoutubeDislikeButtons",
    "hideWatchActionButtons",
    "runDescriptionCleanup",
  ]);
});

test("a full document reconciliation retains every dynamic preference", () => {
  const harness = createDynamicApplyHarness();

  harness.apply(harness.document);

  assert.deepEqual(harness.calls, [
    "useStandardMastheadLogo",
    "clearLegacyHiddenWatchActionButtons",
    "rewriteShortsLinks",
    "hideUpcomingStreams",
    "hidePayToWatchCards",
    "hideWatchedVideos",
    "normaliseReturnYoutubeLikeButtons",
    "normaliseReturnYoutubeDislikeButtons",
    "hideWatchActionButtons",
    "normaliseWatchInfoText",
    "runDescriptionCleanup",
    "hideWatchActionMenuItems",
  ]);
});
