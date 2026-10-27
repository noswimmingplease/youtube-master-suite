import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

const SOURCE = readFileSync(
  new URL("../youtube-master-suite.user.js", import.meta.url),
  "utf8",
);

function extractBlock(startMarker, endMarker) {
  const start = SOURCE.indexOf(startMarker);
  const end = SOURCE.indexOf(endMarker, start + startMarker.length);
  assert.notEqual(start, -1, `Missing generated runtime marker: ${startMarker}`);
  assert.ok(end > start, `Missing or misplaced generated runtime boundary: ${endMarker}`);
  return SOURCE.slice(start, end);
}

const STYLE_ORDER_SOURCE = extractBlock("  const STYLE_ORDER = [", "\n  const sharedWindowListeners");
const BATCH_SOURCE = extractBlock("  function beginBatch() {", "\n  function getCapture(");
const STYLE_SOURCE = extractBlock("  function getCombinedCss() {", "\n  function executeModule(");
const STARTUP_SOURCE = extractBlock("  function executeModule(", "\n  function publishHealthMarker() {");

function createHarness({ root = false, head = false, readyState = "loading" } = {}) {
  const createdStyles = [];
  const registrations = [];
  const listeners = new Map();
  const microtasks = [];
  const moduleErrors = [];
  const stats = { healthPublications: 0, mutationRefreshes: 0, textWrites: 0 };

  function createParent(name) {
    return {
      name,
      isConnected: true,
      children: [],
      appendChild(element) {
        element.remove();
        this.children.push(element);
        element.parentNode = this;
        return element;
      },
    };
  }

  const document = {
    head: head ? createParent("head") : null,
    documentElement: root ? createParent("html") : null,
    readyState,
    createElement(tag) {
      assert.equal(tag, "style");
      let textContent = "";
      const element = {
        id: "",
        parentNode: null,
        get isConnected() { return Boolean(this.parentNode?.isConnected); },
        get textContent() { return textContent; },
        set textContent(value) { textContent = String(value); stats.textWrites += 1; },
        remove() {
          if (!this.parentNode) return;
          const siblings = this.parentNode.children;
          siblings.splice(siblings.indexOf(this), 1);
          this.parentNode = null;
        },
      };
      createdStyles.push(element);
      return element;
    },
    addEventListener(type, listener, options) {
      assert.equal(type, "DOMContentLoaded", "Only the existing startup listener is permitted");
      assert.equal(options?.once, true);
      const registration = { type, listener, once: options.once };
      registrations.push(registration);
      const entries = listeners.get(type) || [];
      entries.push(registration);
      listeners.set(type, entries);
    },
  };

  const forbidScheduling = () => { throw new Error("Style recovery must not add polling or observers"); };
  const context = vm.createContext({
    document,
    styleParts: new Map(),
    styleElement: null,
    styleRenderPending: false,
    batchDepth: 0,
    mutationRefreshPending: false,
    idleModules: [],
    registeredModuleIds: new Set(),
    moduleStates: new Map(),
    activeModuleId: "suite",
    ENABLED_MODULES: { watchLayoutCleaner: true, commentCleaner: true, suiteSettings: true },
    runWithDiagnostics(id, operation, count, callback) {
      assert.equal(operation, "initialise");
      assert.equal(count, 1);
      return callback();
    },
    reportModuleError(id, label, error) { moduleErrors.push({ id, label, error }); },
    publishHealthMarker() { stats.healthPublications += 1; },
    refreshNativeMutationObserver() { stats.mutationRefreshes += 1; },
    queueMicrotask(callback) { microtasks.push(callback); },
    setTimeout: forbidScheduling,
    setInterval: forbidScheduling,
    requestAnimationFrame: forbidScheduling,
    MutationObserver: class { constructor() { forbidScheduling(); } },
  });
  vm.runInContext([STYLE_ORDER_SOURCE, BATCH_SOURCE, STYLE_SOURCE, STARTUP_SOURCE].join("\n"), context);

  return {
    context, document, createdStyles, registrations, microtasks, moduleErrors, stats,
    addRoot() { document.documentElement = createParent("html"); return document.documentElement; },
    addHead() { document.head = createParent("head"); return document.head; },
    domContentLoaded() {
      document.readyState = "interactive";
      const entries = [...(listeners.get("DOMContentLoaded") || [])];
      for (const entry of entries) {
        if (entry.once) {
          listeners.set("DOMContentLoaded", (listeners.get("DOMContentLoaded") || []).filter(item => item !== entry));
        }
        entry.listener();
      }
    },
    flushMicrotasks() { while (microtasks.length) microtasks.shift()(); },
  };
}

test("generated document-start style queues before the HTML root without failing its module or creating a detached style", () => {
  const harness = createHarness();
  const { context } = harness;
  context.registerModule("watchLayoutCleaner", "Watch Layout Cleaner", "document-start", () => {
    context.setStyle("watchLayoutCleaner", ".watch { color: red; }");
  });

  assert.equal(context.moduleStates.get("watchLayoutCleaner").status, "initialised");
  assert.equal(harness.moduleErrors.length, 0);
  assert.equal(context.styleParts.get("watchLayoutCleaner"), ".watch { color: red; }");
  assert.equal(context.styleRenderPending, true);
  assert.equal(context.styleElement, null);
  assert.equal(harness.createdStyles.length, 0);
  assert.equal(harness.registrations.length, 0);
  assert.equal(harness.microtasks.length, 0);
});

test("repeated early updates flush the latest combined CSS once in the existing DOMContentLoaded module batch", () => {
  const harness = createHarness();
  const { context } = harness;
  assert.doesNotThrow(() => context.setStyle("watchLayoutCleaner", ".watch { color: red; }"));
  context.setStyle("watchLayoutCleaner", ".watch { color: green; }");
  context.setStyle("watchLayoutCleaner", ".watch { color: green; }");
  context.setStyle("commentCleaner", ".comments { color: blue; }");
  context.registerModule("suiteSettings", "Suite Settings", "document-idle", () => {
    assert.equal(context.batchDepth, 1);
    context.setStyle("suiteSettings", ".settings { display: block; }");
    context.setStyle("commentCleaner", ".comments { color: gold; }");
  });
  context.startIdleModules();

  assert.equal(harness.createdStyles.length, 0);
  assert.equal(harness.registrations.length, 1);
  assert.equal(harness.microtasks.length, 0);
  harness.addRoot();
  const head = harness.addHead();
  harness.domContentLoaded();

  assert.equal(harness.createdStyles.length, 1);
  assert.equal(head.children.length, 1);
  assert.equal(context.styleElement, head.children[0]);
  assert.equal(context.styleElement.id, "yt-master-suite-style");
  assert.equal(context.styleElement.textContent,
    "/* commentCleaner */\n.comments { color: gold; }\n\n" +
    "/* watchLayoutCleaner */\n.watch { color: green; }\n\n" +
    "/* suiteSettings */\n.settings { display: block; }");
  assert.equal(context.styleRenderPending, false);
  assert.equal(context.batchDepth, 0);
  assert.equal(harness.stats.textWrites, 1);
  assert.equal(harness.stats.healthPublications, 1);
  assert.equal(harness.stats.mutationRefreshes, 0);
  assert.equal(harness.moduleErrors.length, 0);
  harness.domContentLoaded();
  assert.equal(harness.stats.healthPublications, 1, "Startup listener remains one-shot");
  assert.equal(harness.createdStyles.length, 1);
});

test("removing all CSS queued before the root is safe and does not create an empty style at startup", () => {
  const harness = createHarness();
  const { context } = harness;
  assert.doesNotThrow(() => context.setStyle("watchLayoutCleaner", ".watch { color: red; }"));
  context.setStyle("commentCleaner", ".comments { color: blue; }");
  assert.equal(context.removeStyle("watchLayoutCleaner"), true);
  assert.equal(context.removeStyle("commentCleaner"), true);
  assert.equal(context.removeStyle("commentCleaner"), false);
  assert.equal(context.styleParts.size, 0);
  assert.equal(context.styleRenderPending, false);
  assert.equal(context.styleElement, null);
  assert.equal(harness.createdStyles.length, 0);

  context.startIdleModules();
  harness.addRoot();
  harness.addHead();
  harness.domContentLoaded();
  assert.equal(harness.createdStyles.length, 0);
  assert.equal(context.styleElement, null);
  assert.equal(context.styleRenderPending, false);
});

test("connected styles prefer the head, skip unchanged writes and are removed when their final part is removed", () => {
  const harness = createHarness({ root: true, head: true });
  const { context, document } = harness;
  assert.equal(context.setStyle("watchLayoutCleaner", ".watch { color: red; }"), true);
  assert.equal(context.styleElement.parentNode, document.head);
  assert.equal(document.documentElement.children.length, 0);
  assert.equal(context.setStyle("watchLayoutCleaner", ".watch { color: red; }"), false);
  assert.equal(harness.createdStyles.length, 1);
  assert.equal(harness.stats.textWrites, 1);
  assert.equal(context.removeStyle("watchLayoutCleaner"), true);
  assert.equal(document.head.children.length, 0);
  assert.equal(context.styleElement, null);
});

test("root fallback and reconnection retain exactly one connected stylesheet with the latest CSS", () => {
  const harness = createHarness({ root: true });
  const { context, document } = harness;
  context.setStyle("watchLayoutCleaner", ".watch { color: red; }");
  const original = context.styleElement;
  assert.equal(original.parentNode, document.documentElement);

  const head = harness.addHead();
  assert.equal(context.setStyle("watchLayoutCleaner", ".watch { color: red; }"), false);
  assert.equal(context.styleElement, original, "A connected fallback style is not needlessly moved");
  original.remove();
  assert.equal(context.setStyle("watchLayoutCleaner", ".watch { color: red; }"), true);
  assert.notEqual(context.styleElement, original);
  assert.equal(context.styleElement.parentNode, head);
  assert.equal(context.styleElement.textContent, "/* watchLayoutCleaner */\n.watch { color: red; }");
  assert.equal(harness.createdStyles.filter(style => style.isConnected).length, 1);
  assert.equal(document.documentElement.children.length, 0);

  context.styleElement.remove();
  document.head = null;
  document.documentElement = null;
  const creationsBeforeRecovery = harness.createdStyles.length;
  assert.doesNotThrow(() => context.setStyle("watchLayoutCleaner", ".watch { color: green; }"));
  assert.equal(harness.createdStyles.length, creationsBeforeRecovery);
  assert.equal(context.styleRenderPending, true);
  const root = harness.addRoot();
  context.beginBatch();
  context.endBatch();
  assert.equal(context.styleElement.parentNode, root);
  assert.equal(context.styleElement.textContent, "/* watchLayoutCleaner */\n.watch { color: green; }");
  assert.equal(context.styleRenderPending, false);
  assert.equal(harness.createdStyles.filter(style => style.isConnected).length, 1);
});

test("queue drag and step styles render in the shared sheet and dispose independently", () => {
  const harness = createHarness({ root: true, head: true });
  const { context } = harness;
  context.beginBatch();
  context.setStyle("watchLayoutCleanerQueueSteps", ".step { color: grey; }");
  context.setStyle("watchLayoutCleanerDrag", ".drag { cursor: grab; }");
  context.setStyle("watchLayoutCleaner", ".watch { display: block; }");
  context.endBatch();
  assert.equal(harness.createdStyles.length, 1);
  assert.equal(harness.stats.textWrites, 1);
  assert.equal(context.styleElement.textContent,
    "/* watchLayoutCleaner */\n.watch { display: block; }\n\n" +
    "/* watchLayoutCleanerDrag */\n.drag { cursor: grab; }\n\n" +
    "/* watchLayoutCleanerQueueSteps */\n.step { color: grey; }");
  context.removeStyle("watchLayoutCleanerDrag");
  assert.doesNotMatch(context.styleElement.textContent, /cursor: grab/);
  assert.match(context.styleElement.textContent, /color: grey/);
  context.removeStyle("watchLayoutCleanerQueueSteps");
  assert.equal(context.styleElement.textContent, "/* watchLayoutCleaner */\n.watch { display: block; }");
  assert.equal(harness.createdStyles.length, 1);
  context.removeStyle("watchLayoutCleaner");
  assert.equal(context.styleElement, null);
});

test("style recovery adds no polling or listeners and preserves the already-ready startup microtask", () => {
  assert.doesNotMatch(STYLE_SOURCE, /\b(?:setTimeout|setInterval|requestAnimationFrame|MutationObserver|addEventListener|queueMicrotask)\b/);
  assert.doesNotMatch(BATCH_SOURCE + STARTUP_SOURCE, /\b(?:setTimeout|setInterval|requestAnimationFrame|MutationObserver)\b/);
  assert.equal((STARTUP_SOURCE.match(/\.addEventListener\(/g) || []).length, 1);
  const harness = createHarness({ root: true, head: true, readyState: "complete" });
  const { context, document } = harness;
  context.registerModule("suiteSettings", "Suite Settings", "document-idle", () => {
    context.setStyle("suiteSettings", ".settings { display: block; }");
  });
  context.startIdleModules();
  assert.equal(harness.registrations.length, 0);
  assert.equal(harness.microtasks.length, 1);
  assert.equal(harness.createdStyles.length, 0);
  harness.flushMicrotasks();
  assert.equal(harness.createdStyles.length, 1);
  assert.equal(context.styleElement.parentNode, document.head);
  assert.equal(harness.stats.healthPublications, 1);
  assert.equal(harness.moduleErrors.length, 0);
  assert.equal(context.batchDepth, 0);
});
