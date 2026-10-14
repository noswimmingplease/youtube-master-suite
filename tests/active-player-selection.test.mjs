import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

const MODULES = [
  {
    name: "Scroll Miniplayer",
    filename: "youtube-scroll-miniplayer.user.js",
    renderFunction: "isRenderedWatchRoot",
    selectFunction: "getWatchRoot",
  },
  {
    name: "Player Preferences Lite",
    filename: "youtube-player-preferences-lite.user.js",
    renderFunction: "isRenderedWatchFlexy",
    selectFunction: "getWatchFlexy",
  },
  {
    name: "Miniplayer Button Restorer",
    filename: "youtube-miniplayer-button-restorer.user.js",
    renderFunction: "isRenderedWatchFlexy",
    selectFunction: "getActiveWatchFlexy",
  },
].map((module) => ({
  ...module,
  source: readFileSync(
    new URL(`../sources/modules/${module.filename}`, import.meta.url),
    "utf8",
  ),
}));

function extractFunction(source, name) {
  const start = source.indexOf(`  function ${name}(`);
  assert.notEqual(start, -1, `Missing ${name}`);
  const end = source.indexOf("\n  function ", start + 1);
  assert.notEqual(end, -1, `Missing boundary after ${name}`);
  return source.slice(start, end);
}

function createWatchRoot(overrides = {}) {
  return {
    isConnected: true,
    hidden: false,
    ariaHidden: null,
    display: "block",
    visibility: "visible",
    hasRect: true,
    getAttribute(name) {
      return name === "aria-hidden" ? this.ariaHidden : null;
    },
    getClientRects() {
      return this.hasRect ? [{}] : [];
    },
    ...overrides,
  };
}

function createHarness(module, { roots, playerRoot = null, placeholderRoot = null }) {
  const context = vm.createContext({
    MOVIE_PLAYER_ID: "movie_player",
    PLACEHOLDER_ID: "ytsmp-player-placeholder",
    WATCH_ROOT_SELECTOR: "ytd-watch-flexy",
    getComputedStyle: (root) => root,
    document: {
      querySelector(selector) {
        const root = selector === "#movie_player"
          ? playerRoot
          : selector === "#ytsmp-player-placeholder"
            ? placeholderRoot
            : null;
        return root ? { closest: () => root } : null;
      },
      querySelectorAll(selector) {
        assert.equal(selector, "ytd-watch-flexy");
        return roots;
      },
    },
  });
  vm.runInContext(
    [module.renderFunction, module.selectFunction]
      .map((name) => extractFunction(module.source, name))
      .join("\n"),
    context,
  );
  return () => context[module.selectFunction]();
}

for (const module of MODULES) {
  test(`${module.name}: hidden duplicate player cannot outrank the rendered watch root`, () => {
    for (const hiddenState of [
      { hidden: true },
      { ariaHidden: "true" },
      { display: "none" },
      { visibility: "hidden" },
      { visibility: "collapse" },
      { hasRect: false },
      { isConnected: false },
    ]) {
      const stale = createWatchRoot(hiddenState);
      const active = createWatchRoot();
      const select = createHarness(module, {
        roots: [stale, active],
        playerRoot: stale,
      });
      assert.equal(select(), active, JSON.stringify(hiddenState));
    }
  });

  test(`${module.name}: rendered player owner retains precedence over earlier containers`, () => {
    const other = createWatchRoot();
    const active = createWatchRoot();
    const select = createHarness(module, {
      roots: [other, active],
      playerRoot: active,
      placeholderRoot: other,
    });
    assert.equal(select(), active);
  });

  test(`${module.name}: floating player retains its rendered placeholder owner`, () => {
    const earlier = createWatchRoot();
    const active = createWatchRoot();
    const select = createHarness(module, {
      roots: [earlier, active],
      placeholderRoot: active,
    });
    assert.equal(select(), active);
  });

  test(`${module.name}: hidden duplicate player cannot displace the floating placeholder owner`, () => {
    const stale = createWatchRoot({ hidden: true });
    const earlier = createWatchRoot();
    const active = createWatchRoot();
    const select = createHarness(module, {
      roots: [stale, earlier, active],
      playerRoot: stale,
      placeholderRoot: active,
    });
    assert.equal(select(), active);
  });

  test(`${module.name}: hidden stale placeholder cannot outrank a rendered watch root`, () => {
    const stale = createWatchRoot({ hidden: true });
    const active = createWatchRoot();
    const select = createHarness(module, {
      roots: [stale, active],
      placeholderRoot: stale,
    });
    assert.equal(select(), active);
  });

  test(`${module.name}: preserves connected fallback while watch containers are not rendered`, () => {
    const disconnected = createWatchRoot({ isConnected: false });
    const loading = createWatchRoot({ hasRect: false });
    const select = createHarness(module, {
      roots: [disconnected, loading],
      playerRoot: disconnected,
    });
    assert.equal(select(), loading);
  });

  test(`${module.name}: returns null when no watch owner remains connected`, () => {
    const disconnected = createWatchRoot({ isConnected: false });
    const select = createHarness(module, {
      roots: [disconnected],
      playerRoot: disconnected,
      placeholderRoot: disconnected,
    });
    assert.equal(select(), null);
  });
}
