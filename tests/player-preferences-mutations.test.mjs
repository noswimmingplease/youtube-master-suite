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

test("restored Like button keeps an unmistakable selected state", () => {
  assert.match(
    PLAYER_PREFERENCES_SOURCE,
    /button\[aria-pressed="true"\]/,
  );
  assert.match(
    PLAYER_PREFERENCES_SOURCE,
    /button\[aria-label\^="Unlike" i\]/,
  );
  assert.match(PLAYER_PREFERENCES_SOURCE, /color: #3ea6ff !important;/);
});

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

test("volume getter falls back when the player API is unavailable", () => {
  const context = vm.createContext({ clamp: (n, low, high) => Math.max(low, Math.min(high, n)) });
  vm.runInContext(extractFunction(PLAYER_PREFERENCES_SOURCE, "getPlayerVolume"), context);
  const video = { volume: 0.15 };
  for (const unavailable of [{}, { getVolume() { throw new Error("transition"); } }, { getVolume: () => NaN }]) {
    assert.equal(context.getPlayerVolume(unavailable, video), 0.15);
  }
  assert.equal(context.getPlayerVolume({ getVolume: () => 0 }, video), 0);
});

function createWheelVolumeHarness({ player, video }) {
  const overlays = [];
  const context = vm.createContext({
    CONFIG: {
      enablePlayerWheelVolume: true,
      requireRightMouseButtonForWheelVolume: true,
      wheelVolumeStep: 5,
      contextMenuSuppressionWindowMs: 500,
    },
    rightButtonHeldOnPlayer: false,
    contextMenuSuppressionExpiresAt: 0,
    clamp: (n, low, high) => Math.max(low, Math.min(high, n)),
    getPlayerFromTarget: (target) => target,
    getPlayerVideo: () => video,
    showVolumeOverlay: (_, percent) => overlays.push(percent),
  });
  vm.runInContext(
    ["getPlayerVolume", "setPlayerVolume", "handleWheelVolume"]
      .map((name) => extractFunction(PLAYER_PREFERENCES_SOURCE, name))
      .join("\n"),
    context,
  );
  return {
    overlays,
    context,
    wheel(deltaY = -1, buttons = 2, target = player) {
      const event = {
        deltaY, buttons, target,
        prevented: false, stopped: false,
        preventDefault() { this.prevented = true; },
        stopImmediatePropagation() { this.stopped = true; },
      };
      context.handleWheelVolume(event);
      return event;
    },
  };
}

test("full wheel handler progresses beyond 20 percent despite reset media volume", () => {
  let selected = 15;
  const video = { volume: 0.15, muted: false };
  const player = { getVolume: () => selected, setVolume: (n) => { selected = n; } };
  const harness = createWheelVolumeHarness({ player, video });
  for (let i = 0; i < 20; i++) {
    video.volume = 0.15;
    const event = harness.wheel();
    assert.equal(event.prevented, true);
    assert.equal(event.stopped, true);
  }
  assert.deepEqual(harness.overlays.slice(0, 3), [20, 25, 30]);
  assert.equal(selected, 100);
  for (let i = 0; i < 25; i++) harness.wheel(1);
  assert.equal(selected, 0);
  assert.equal(video.volume, 0);
});

test("wheel handler falls back when setVolume and unMute throw", () => {
  const video = { volume: 0.15, muted: true };
  const unavailable = () => { throw new Error("player transitioning"); };
  const player = { getVolume: unavailable, setVolume: unavailable, unMute: unavailable };
  const harness = createWheelVolumeHarness({ player, video });
  const event = harness.wheel();
  assert.equal(video.volume, 0.2);
  assert.equal(video.muted, false);
  assert.deepEqual(harness.overlays, [20]);
  assert.equal(event.prevented, true);
  assert.equal(event.stopped, true);
  assert.ok(harness.context.contextMenuSuppressionExpiresAt > Date.now());
  harness.wheel();
  assert.equal(video.volume, 0.25);
});

test("wheel handler falls back without player APIs and keeps zero volume muted", () => {
  const video = { volume: 0.05, muted: true };
  const harness = createWheelVolumeHarness({ player: {}, video });
  harness.wheel(1);
  assert.equal(video.volume, 0);
  assert.equal(video.muted, true);
  harness.wheel();
  assert.equal(video.volume, 0.05);
  assert.equal(video.muted, false);
});

test("wheel handler leaves unrelated scrolling and missing players untouched", () => {
  const video = { volume: 0.5, muted: false };
  const harness = createWheelVolumeHarness({ player: {}, video });
  for (const event of [harness.wheel(-1, 0), harness.wheel(0), harness.wheel(-1, 2, null)]) {
    assert.equal(event.prevented, false);
    assert.equal(event.stopped, false);
  }
  assert.equal(video.volume, 0.5);
  assert.deepEqual(harness.overlays, []);
  const missing = createWheelVolumeHarness({ player: {}, video: null });
  assert.equal(missing.wheel().prevented, false);
});

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
