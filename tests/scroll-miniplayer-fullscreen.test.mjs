import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

const SOURCE = readFileSync(
  new URL("../sources/modules/youtube-scroll-miniplayer.user.js", import.meta.url),
  "utf8",
);

function extractFunction(name) {
  const start = SOURCE.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `Missing ${name}`);
  const bodyStart = SOURCE.indexOf("{", start);
  let depth = 0;
  for (let index = bodyStart; index < SOURCE.length; index += 1) {
    if (SOURCE[index] === "{") depth += 1;
    if (SOURCE[index] !== "}") continue;
    depth -= 1;
    if (depth === 0) return SOURCE.slice(start, index + 1);
  }
  assert.fail(`Unterminated ${name}`);
}

function createHarness() {
  const classes = new Set(["active"]);
  const body = {
    classList: {
      contains: (name) => classes.has(name),
      add: (...names) => names.forEach((name) => classes.add(name)),
      remove: (...names) => names.forEach((name) => classes.delete(name)),
    },
  };
  const counts = {
    insertions: 0,
    removals: 0,
    placeholdersRemoved: 0,
    routeSyncs: 0,
    recoveryMoves: 0,
    controlsRemoved: 0,
    adoptionChecks: 0,
  };
  const timers = new Map();
  let nextTimer = 1;
  const video = {};
  const player = {
    isConnected: true,
    parentElement: body,
    contains: (node) => node === video || node === player,
    closest: (selector) => {
      if (selector === "#recovery") {
        return player.parentElement === recoveryHost ? recoveryHost : null;
      }
      return null;
    },
    remove: () => {
      counts.removals += 1;
      player.isConnected = false;
      player.parentElement = null;
    },
  };
  const restoreParent = {
    isConnected: true,
    insertBefore: (child) => {
      counts.insertions += 1;
      child.parentElement = restoreParent;
    },
  };
  const recoveryHost = {
    isConnected: true,
    appendChild: (child) => {
      counts.recoveryMoves += 1;
      child.parentElement = recoveryHost;
    },
  };
  const context = {
    ACTIVE_CLASS: "active",
    EXITING_CLASS: "exiting",
    CONFIG: { exitTransitionMs: 0 },
    PLAYER_RECOVERY_HOST_ID: "recovery",
    NATIVE_MINIPLAYER_SELECTOR: "ytd-miniplayer",
    PLAYER_ORPHAN_FINALISE_GRACE_MS: 20000,
    PLAYER_RESTORE_RETRY_DELAYS_MS: [50, 250, 1000, 3000, 8000, 15000],
    document: { body, fullscreenElement: null },
    floatedPlayer: player,
    playerPlaceholder: {},
    restoreParent,
    restoreNextSibling: null,
    playerOrphanFinaliseTimer: 0,
    playerRestoreRetryTimers: new Set(),
    navigationInProgress: false,
    fadeOutTimer: 0,
    eligible: true,
    replacement: null,
    discardable: false,
    setTimeout: (callback) => {
      const id = nextTimer++;
      timers.set(id, callback);
      return id;
    },
    clearTimeout: (id) => timers.delete(id),
    getSafeRestoreParent: () => context.restoreParent,
    getAuthoritativeReplacementPlayer: () => context.replacement,
    isEligiblePath: () => context.eligible,
    canDiscardOffRouteOrphan: () => context.discardable,
    canFloatPlayer: () => false,
    removePlayerPlaceholder: () => {
      if (context.playerPlaceholder) counts.placeholdersRemoved += 1;
      context.playerPlaceholder = null;
    },
    ensurePlayerRecoveryHost: () => recoveryHost,
    removePlayerRecoveryHostIfEmpty: () => {},
    startPlayerAdoptionObservation: () => { counts.adoptionChecks += 1; },
    stopPlayerAdoptionObservation: () => {},
    clearBodyBoxVars: () => {},
    removeCloseButton: () => { counts.controlsRemoved += 1; },
    removeCornerButton: () => {},
    removeCompactQueueInfo: () => {},
    dispatchResize: () => {},
    scheduleScrollSync: () => {},
    scheduleRouteSync: () => { counts.routeSyncs += 1; },
  };
  for (const name of [
    "isBodyActive",
    "isBodyFloating",
    "isPlayerInFullscreen",
    "clearPlayerRestoreRetries",
    "clearPlayerOrphanFinaliseTimer",
    "isPlayerAdoptedByConnectedHost",
    "finishPlayerRestore",
    "recoverReplacedFloatedPlayer",
    "reconcileTrackedPlayer",
    "finaliseOffRouteOrphanIfSafe",
    "scheduleOffRouteOrphanFinalisation",
    "schedulePlayerRestoreRetries",
    "restorePlayer",
    "setActive",
    "deactivateImmediately",
    "handleFullscreenChange",
  ]) {
    vm.runInNewContext(extractFunction(name), context);
  }
  return {
    classes,
    context,
    counts,
    player,
    restoreParent,
    timers,
    video,
    runTimers: () => {
      for (const [id, callback] of [...timers]) {
        timers.delete(id);
        callback();
      }
    },
  };
}

test("fullscreen entry removes floating UI without moving its fullscreen player", () => {
  const { classes, context, counts, player, timers } = createHarness();
  context.document.fullscreenElement = player;
  context.handleFullscreenChange();
  assert.equal(classes.size, 0);
  assert.equal(counts.controlsRemoved, 1);
  assert.equal(counts.insertions, 0);
  assert.equal(counts.removals, 0);
  assert.equal(counts.placeholdersRemoved, 0);
  assert.equal(context.floatedPlayer, player);
  assert.equal(player.parentElement, context.document.body);
  assert.equal(timers.size, 0);
});

test("a fullscreen video child also defers restoration until exit", () => {
  const { context, counts, player, restoreParent, video } = createHarness();
  context.document.fullscreenElement = video;
  context.handleFullscreenChange();
  assert.equal(counts.insertions, 0);
  assert.equal(context.floatedPlayer, player);

  context.document.fullscreenElement = null;
  context.handleFullscreenChange();
  assert.equal(counts.insertions, 1);
  assert.equal(counts.placeholdersRemoved, 1);
  assert.equal(player.parentElement, restoreParent);
  assert.equal(context.floatedPlayer, null);
  assert.equal(counts.routeSyncs, 1);
  context.handleFullscreenChange();
  assert.equal(counts.insertions, 1);
});

test("unrelated fullscreen content does not defer restoring the floated player", () => {
  const { context, counts } = createHarness();
  context.document.fullscreenElement = {};
  context.handleFullscreenChange();
  assert.equal(counts.insertions, 1);
  assert.equal(context.floatedPlayer, null);
});

test("navigation deactivation and existing retries cannot reparent a fullscreen player", () => {
  const { context, counts, player, timers } = createHarness();
  context.schedulePlayerRestoreRetries();
  assert.equal(timers.size, 6);
  context.navigationInProgress = true;
  context.document.fullscreenElement = player;
  context.deactivateImmediately();
  assert.equal(counts.insertions, 0);
  assert.equal(context.playerRestoreRetryTimers.size, 0);
  assert.equal(timers.size, 0);
  assert.equal(context.restorePlayer(false), false);
  assert.equal(context.floatedPlayer, player);
});

test("native adoption may release tracking during fullscreen without touching the player", () => {
  const { context, counts, player } = createHarness();
  context.document.fullscreenElement = player;
  player.parentElement = { isConnected: true };
  context.handleFullscreenChange();
  assert.equal(context.floatedPlayer, null);
  assert.equal(counts.insertions, 0);
  assert.equal(counts.removals, 0);
  assert.equal(counts.placeholdersRemoved, 1);
});

test("an authoritative replacement cannot dispose of the old player until fullscreen exits", () => {
  const { context, counts, player } = createHarness();
  context.document.fullscreenElement = player;
  context.replacement = {};
  context.handleFullscreenChange();
  assert.equal(context.reconcileTrackedPlayer(), false);
  assert.equal(context.floatedPlayer, player);
  assert.equal(counts.removals, 0);

  context.document.fullscreenElement = null;
  context.handleFullscreenChange();
  assert.equal(counts.removals, 1);
  assert.equal(counts.insertions, 0);
  assert.equal(context.floatedPlayer, null);
  assert.equal(counts.routeSyncs, 1);
});

test("off-route orphan disposal and recovery-host moves wait for fullscreen exit", () => {
  const harness = createHarness();
  const { classes, context, counts, player, timers } = harness;
  classes.clear();
  context.eligible = false;
  context.restoreParent = null;
  context.scheduleOffRouteOrphanFinalisation();
  assert.equal(timers.size, 1);
  context.document.fullscreenElement = player;
  context.discardable = true;
  assert.equal(context.finaliseOffRouteOrphanIfSafe(), false);
  harness.runTimers();
  assert.equal(counts.recoveryMoves, 0);
  assert.equal(counts.removals, 0);
  context.scheduleOffRouteOrphanFinalisation();
  assert.equal(timers.size, 0);
  assert.equal(counts.adoptionChecks, 2);

  context.document.fullscreenElement = null;
  assert.equal(context.finaliseOffRouteOrphanIfSafe(), true);
  assert.equal(counts.removals, 1);
  assert.equal(context.floatedPlayer, null);
});

test("missing restore hosts resume the existing bounded retry path after exit", () => {
  const { context, player, timers } = createHarness();
  context.restoreParent = null;
  context.document.fullscreenElement = player;
  context.handleFullscreenChange();
  assert.equal(timers.size, 0);
  context.document.fullscreenElement = null;
  context.handleFullscreenChange();
  assert.equal(timers.size, 6);
  assert.equal(context.floatedPlayer, player);
});

test("fullscreen exit reconciliation does not depend on lagging YouTube fullscreen flags", () => {
  const { context, counts, player } = createHarness();
  context.isFullscreen = () => true;
  context.document.fullscreenElement = player;
  context.handleFullscreenChange();
  context.document.fullscreenElement = null;
  context.handleFullscreenChange();
  assert.equal(counts.insertions, 1);
  assert.equal(counts.routeSyncs, 1);
});
