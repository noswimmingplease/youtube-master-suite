import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

const SOURCE = readFileSync(
  new URL("../sources/modules/youtube-comment-cleaner.user.js", import.meta.url),
  "utf8",
);

function declaration(name) {
  const start = SOURCE.indexOf(`  const ${name} = `);
  assert.notEqual(start, -1, `Missing ${name}`);
  const end = SOURCE.indexOf("\n  const ", start + 1);
  assert.notEqual(end, -1, `Missing end of ${name}`);
  return SOURCE.slice(start, end);
}

function createScope(counts, descendants = [], results = {}, matches = []) {
  return {
    querySelectorAll(selector) {
      if (selector !== "*") return results[selector] || [];
      counts.traversals++;
      counts.visited += descendants.length;
      return descendants;
    },
    matches: selector => matches.includes(selector),
  };
}

function createHarness({ hide = true, colour = true, ready = true } = {}) {
  const calls = [];
  const document = { querySelector: () => null };
  const context = {
    document,
    CONFIG: { hideCommentControls: hide, colourCommenters: colour },
    uploaderPathsReadyVideoKey: ready ? "current" : "previous",
    getVideoKey: () => "current",
    isWatchPath: () => true,
    hideCommentControls(root, scopes) {
      calls.push(...context.queryAllDeep("controls", root, scopes));
      calls.push(...context.queryAllDeep("overflow", root, scopes));
    },
    colourCommentAuthorLinks(root, scopes) {
      if (context.uploaderPathsReadyVideoKey !== "current") return;
      calls.push(...context.queryAllDeep("authors", root, scopes));
    },
  };
  vm.runInNewContext([
    declaration("collectDeepQueryScopes"),
    declaration("queryAllDeep"),
    declaration("applyAll"),
    "this.queryAllDeep = queryAllDeep; this.applyAll = applyAll;",
  ].join("\n"), context);
  return { context, calls, document };
}

function legacyQueryAllDeep(selector, root) {
  const out = [];
  const crawl = node => {
    if (!node?.querySelectorAll) return;
    if (node.matches?.(selector)) out.push(node);
    node.querySelectorAll(selector).forEach(element => out.push(element));
    node.querySelectorAll("*").forEach(element => {
      if (element.shadowRoot) crawl(element.shadowRoot);
    });
  };
  crawl(root);
  return out;
}

test("one comment pass replaces three full descendant traversals with one", () => {
  const counts = { traversals: 0, visited: 0 };
  const controls = Array.from({ length: 100 }, () => ({}));
  const overflow = Array.from({ length: 100 }, () => ({}));
  const authors = Array.from({ length: 100 }, () => ({}));
  const root = createScope(counts, Array.from({ length: 900 }, () => ({})), {
    controls, overflow, authors,
  });
  const expected = ["controls", "overflow", "authors"]
    .flatMap(selector => legacyQueryAllDeep(selector, root));
  assert.deepEqual(counts, { traversals: 3, visited: 2700 });
  counts.traversals = 0;
  counts.visited = 0;

  const harness = createHarness();
  harness.context.applyAll(root);
  assert.deepEqual(harness.calls, expected);
  assert.deepEqual(counts, { traversals: 1, visited: 900 });

  harness.calls.length = 0;
  harness.context.applyAll(root);
  assert.deepEqual(harness.calls, expected);
  assert.deepEqual(counts, { traversals: 2, visited: 1800 },
    "Each later pass must discover its own scopes");
});

test("deep queries retain root matching and nested open-shadow scope order", () => {
  const counts = { traversals: 0, visited: 0 };
  const nestedMatch = {};
  const siblingMatch = {};
  const nestedShadow = createScope(counts, [{}], { authors: [nestedMatch] });
  const shadow = createScope(counts, [{ shadowRoot: nestedShadow }], {}, ["authors"]);
  const siblingShadow = createScope(counts, [], { authors: [siblingMatch] });
  const root = createScope(counts, [
    { shadowRoot: shadow }, { shadowRoot: siblingShadow },
  ], { authors: [{}] }, ["authors"]);
  const harness = createHarness();
  const expected = legacyQueryAllDeep("authors", root);
  const actual = harness.context.queryAllDeep("authors", root);
  assert.deepEqual([...actual], expected);
  assert.equal(actual[0], root);
  assert.equal(actual[2], shadow);
  assert.equal(actual[3], nestedMatch);
  assert.equal(actual[4], siblingMatch);
});

test("newly inserted comment and open shadow root are discovered by the next pass", () => {
  const counts = { traversals: 0, visited: 0 };
  const descendants = [];
  const authors = [{}];
  const root = createScope(counts, descendants, { authors });
  const harness = createHarness();
  harness.context.applyAll(root);
  const insertedAuthor = {};
  const shadowAuthor = {};
  authors.push(insertedAuthor);
  descendants.push({ shadowRoot: createScope(counts, [], { authors: [shadowAuthor] }) });
  harness.calls.length = 0;
  harness.context.applyAll(root);
  assert.deepEqual(harness.calls, [...authors, shadowAuthor]);
  assert.equal(counts.traversals, 3, "The second pass discovers both root and new shadow scope");
});

test("disabled styling and uploader waiting perform no descendant discovery", () => {
  for (const options of [
    { hide: false, colour: false },
    { hide: false, colour: true, ready: false },
  ]) {
    const counts = { traversals: 0, visited: 0 };
    const harness = createHarness(options);
    harness.context.applyAll(createScope(counts, [{}]));
    assert.deepEqual(counts, { traversals: 0, visited: 0 });
    assert.deepEqual(harness.calls, []);
  }
});

test("leaving the watch route prevents pending styling and scope discovery", () => {
  const counts = { traversals: 0, visited: 0 };
  const harness = createHarness();
  harness.context.isWatchPath = () => false;
  harness.context.applyAll(createScope(counts, [{}]));
  assert.deepEqual(counts, { traversals: 0, visited: 0 });
  assert.deepEqual(harness.calls, []);
});

const LEGACY_PENDING_QUEUE = `
  const addPendingApplyRoot = (root) => {
    if (!root || !root.querySelectorAll) return;
    for (const pendingRoot of Array.from(pendingApplyRoots)) {
      if (pendingRoot === root || pendingRoot.contains(root)) return;
      if (root.contains(pendingRoot)) pendingApplyRoots.delete(pendingRoot);
    }
    pendingApplyRoots.add(root);
  };
`;

function createQueueHarness({ legacy = false } = {}) {
  const counts = { containsCalls: 0, parentReads: 0 };
  const applied = [];
  const frames = [];
  let watchRoute = true;
  let onApply = () => {};
  function root(id, parent = null, connected = true) {
    let parentNode = parent;
    return {
      id, isConnected: connected, querySelectorAll() { return []; },
      get parentNode() { counts.parentReads++; return parentNode; },
      set parentNode(value) { parentNode = value; },
      contains(other) {
        counts.containsCalls++;
        for (let current = other; current; current = current.parentNode) {
          if (current === this) return true;
        }
        return false;
      },
    };
  }
  const document = root("#document");
  const pendingApplyRoots = new Set();
  const context = {
    document, pendingApplyRoots, scheduled: false,
    isWatchPath: () => watchRoute,
    requestAnimationFrame(callback) { frames.push(callback); return frames.length; },
    applyAll(node) { applied.push(node.id); onApply(node); },
  };
  vm.runInNewContext([
    legacy ? LEGACY_PENDING_QUEUE : declaration("addPendingApplyRoot"),
    declaration("scheduleApply"),
    "this.scheduleApply = scheduleApply;",
  ].join("\n"), context);
  return {
    counts, applied, frames, root, document, pendingApplyRoots,
    schedule: context.scheduleApply,
    flush() { assert.ok(frames.length, "Expected queued animation work"); frames.shift()(); },
    setWatchRoute(value) { watchRoute = value; },
    onApply(callback) { onApply = callback; },
  };
}

test("500 sibling comment roots replace 249500 pairwise checks with 2000 current-parent reads", () => {
  const before = createQueueHarness({ legacy: true });
  const after = createQueueHarness();
  for (const harness of [before, after]) {
    const body = harness.root("body", harness.document);
    const comments = harness.root("comments", body);
    for (let index = 0; index < 500; index++) {
      harness.schedule(harness.root(`comment-${index}`, comments));
    }
  }
  assert.equal(before.counts.containsCalls, 249500,
    "The v1.25 enqueue function performs N × (N − 1) sibling containment checks");
  assert.equal(after.counts.containsCalls, 0);
  assert.equal(after.counts.parentReads, 0, "Enqueue does not walk the DOM");
  after.flush();
  assert.equal(after.applied.length, 500);
  assert.deepEqual(after.counts, { containsCalls: 0, parentReads: 2000 });
});

test("duplicate and invalid roots do not create repeated comment passes", () => {
  const harness = createQueueHarness();
  harness.schedule(null);
  harness.schedule({});
  assert.equal(harness.frames.length, 0);
  const comment = harness.root("comment", harness.document);
  harness.schedule(comment);
  harness.schedule(comment);
  assert.equal(harness.frames.length, 1);
  harness.flush();
  assert.deepEqual(harness.applied, ["comment"]);
});

test("nested comment roots are subsumed while surviving roots retain insertion order", () => {
  const harness = createQueueHarness();
  const ancestor = harness.root("ancestor", harness.document);
  const child = harness.root("child", ancestor);
  const sibling = harness.root("sibling", harness.document);
  harness.schedule(child);
  harness.schedule(sibling);
  harness.schedule(ancestor);
  harness.flush();
  assert.deepEqual(harness.applied, ["sibling", "ancestor"]);
});

for (const moveInside of [false, true]) {
  test(`queued comment ancestry is evaluated after moving ${moveInside ? "inside" : "outside"} an ancestor`, () => {
    const harness = createQueueHarness();
    const ancestor = harness.root("ancestor", harness.document);
    const child = harness.root("child", moveInside ? harness.document : ancestor);
    harness.schedule(child);
    harness.schedule(ancestor);
    child.parentNode = moveInside ? ancestor : harness.document;
    harness.flush();
    assert.deepEqual(harness.applied, moveInside ? ["ancestor"] : ["child", "ancestor"]);
  });
}

test("a connected comment moved out of a detached queued ancestor is retained", () => {
  const harness = createQueueHarness();
  const ancestor = harness.root("ancestor", harness.document);
  const child = harness.root("child", ancestor);
  const sibling = harness.root("sibling", harness.document);
  harness.schedule(ancestor);
  harness.schedule(child);
  harness.schedule(sibling);
  ancestor.isConnected = false;
  ancestor.parentNode = null;
  child.parentNode = harness.document;
  harness.flush();
  assert.deepEqual(harness.applied, ["child", "sibling"]);
});

test("comment queue parent walks preserve document and shadow-root boundaries", () => {
  const harness = createQueueHarness();
  const host = harness.root("host", harness.document);
  const shadow = harness.root("shadow");
  shadow.host = host;
  const child = harness.root("shadow-child", shadow);
  harness.schedule(host);
  harness.schedule(child);
  harness.schedule(harness.document);
  harness.flush();
  assert.deepEqual(harness.applied, ["shadow-child", "#document"],
    "A queued document subsumes light DOM, not separate shadow-tree roots");
  harness.applied.length = 0;
  harness.schedule(child);
  harness.schedule(shadow);
  harness.flush();
  assert.deepEqual(harness.applied, ["shadow"], "A ShadowRoot is an actual DOM ancestor");
});

test("comment work scheduled during a pass remains queued for the next frame", () => {
  const harness = createQueueHarness();
  const first = harness.root("first", harness.document);
  const later = harness.root("later", harness.document);
  harness.onApply(node => { if (node === first) harness.schedule(later); });
  harness.schedule(first);
  harness.flush();
  assert.deepEqual(harness.applied, ["first"]);
  assert.equal(harness.frames.length, 1);
  assert.equal(harness.pendingApplyRoots.size, 1);
  harness.flush();
  assert.deepEqual(harness.applied, ["first", "later"]);
});

test("off-route calls do not enqueue comment work", () => {
  const harness = createQueueHarness();
  harness.setWatchRoute(false);
  harness.schedule(harness.root("off-route", harness.document));
  assert.equal(harness.frames.length, 0);
  assert.equal(harness.pendingApplyRoots.size, 0);
});
