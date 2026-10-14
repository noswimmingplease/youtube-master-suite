import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

const SOURCE = readFileSync(new URL(
  "../sources/modules/youtube-player-preferences-lite.user.js", import.meta.url,
), "utf8");
const VIDEO_ID = "Zav47j1vbw4";
const CLEAN_URL = `https://youtu.be/${VIDEO_ID}`;
const QUEUE_URL = `${CLEAN_URL}?list=TLPQMDkxMDIwMjalXyU8MG5exA`;

function extractFunction(name) {
  const start = SOURCE.indexOf(`  function ${name}(`);
  assert.notEqual(start, -1, `Missing ${name}`);
  const end = SOURCE.indexOf("\n  function ", start + 1);
  assert.notEqual(end, -1, `Missing boundary after ${name}`);
  return SOURCE.slice(start, end);
}

function createHarness({ enabled = true } = {}) {
  const counts = { queries: 0, closest: 0, timers: 0 };
  const timers = new Map();
  let nextTimer = 1;
  class Element {
    constructor(tagName, className = "") {
      this.nodeType = 1;
      this.tagName = tagName.toUpperCase();
      this.className = className;
      this.parentElement = null;
      this.children = [];
      this.textContent = "";
      this.value = "";
      this.selectionStart = 0;
      this.selectionEnd = 0;
      this.readOnly = false;
      this.disabled = false;
    }
    get isConnected() {
      return this === document.body || Boolean(this.parentElement?.isConnected);
    }
    appendChild(child) {
      child.parentElement = this;
      this.children.push(child);
      return child;
    }
    contains(node) {
      for (let current = node; current; current = current.parentElement) {
        if (current === this) return true;
      }
      return false;
    }
    matches(selector) {
      return selector.split(",").some((part) => {
        const parts = part.trim().split(/\s+/);
        const matchSingle = (element, simple) => {
          const tag = simple.match(/^[\w-]+/)?.[0];
          const classes = [...simple.matchAll(/\.([\w-]+)/g)].map((match) => match[1]);
          return (!tag || element.tagName.toLowerCase() === tag.toLowerCase()) &&
            classes.every((name) => element.className.split(/\s+/).includes(name));
        };
        if (!matchSingle(this, parts.pop())) return false;
        let ancestor = this.parentElement;
        while (parts.length) {
          const simple = parts.pop();
          while (ancestor && !matchSingle(ancestor, simple)) ancestor = ancestor.parentElement;
          if (!ancestor) return false;
          ancestor = ancestor.parentElement;
        }
        return true;
      });
    }
    closest(selector) {
      counts.closest++;
      for (let current = this; current; current = current.parentElement) {
        if (current.matches(selector)) return current;
      }
      return null;
    }
    querySelector(selector) {
      counts.queries++;
      for (const child of this.children) {
        if (child.matches(selector)) return child;
        const descendant = child.querySelector(selector);
        if (descendant) return descendant;
      }
      return null;
    }
  }
  const document = {
    body: null, activeElement: null,
    querySelector(selector) { return this.body.querySelector(selector); },
  };
  document.body = new Element("body");
  const menu = document.body.appendChild(new Element("div", "ytp-contextmenu"));
  const item = menu.appendChild(new Element("div", "ytp-menuitem"));
  const label = item.appendChild(new Element("div", "ytp-menuitem-label"));
  label.textContent = "Copy video URL";
  const icon = item.appendChild(new Element("svg", "ytp-menuitem-icon"));
  const clipboard = menu.appendChild(new Element("textarea", "ytp-html5-clipboard"));
  clipboard.readOnly = true;
  const context = vm.createContext({
    URL, Node: { ELEMENT_NODE: 1 }, document, Element, HTMLTextAreaElement: Element,
    location: { href: "https://www.youtube.com/watch?v=bbbbbbbbbbb" },
    CONFIG: { enableCleanVideoUrlCopy: enabled },
    setTimeout(callback, delay) {
      assert.equal(delay, 0, "The arm must expire after the current event task");
      counts.timers++;
      const id = nextTimer++;
      timers.set(id, callback);
      return id;
    },
    clearTimeout(id) { timers.delete(id); },
  });
  vm.runInContext(`let cleanVideoUrlCopyMenu = null;
    let cleanVideoUrlCopyTimer = 0;
    ${["closestElement", "getCleanVideoUrl", "clearCleanVideoUrlCopy",
      "handleCleanVideoUrlSelection", "handleCleanVideoUrlCopy"].map(extractFunction).join("\n")}`, context);
  function event(type, properties = {}) {
    return {
      type, isTrusted: true, button: 0, cancelable: true, defaultPrevented: false,
      prevented: false, stopped: false,
      preventDefault() { this.defaultPrevented = this.prevented = true; },
      stopPropagation() { this.stopped = true; },
      stopImmediatePropagation() { this.stopped = true; },
      ...properties,
    };
  }
  function select(properties = {}) {
    const selection = event("click", { target: label, ...properties });
    context.handleCleanVideoUrlSelection(selection);
    return selection;
  }
  function copy(rawUrl = QUEUE_URL, properties = {}) {
    clipboard.value = rawUrl;
    clipboard.selectionStart = 0;
    clipboard.selectionEnd = rawUrl.length;
    document.activeElement = clipboard;
    const writes = [];
    const copyEvent = event("copy", {
      target: clipboard,
      clipboardData: { setData(type, value) { writes.push([type, value]); } },
      ...properties,
    });
    context.handleCleanVideoUrlCopy(copyEvent);
    return { event: copyEvent, writes };
  }
  function runTimers() {
    const callbacks = [...timers.values()];
    timers.clear();
    for (const callback of callbacks) callback();
  }
  return { context, counts, timers, document, menu, item, label, icon, clipboard,
    Element, event, select, copy, runTimers };
}

test("plain copy normalises recognised video URLs without retaining any query or fragment", () => {
  const { context } = createHarness();
  for (const rawUrl of [
    QUEUE_URL,
    `${CLEAN_URL}?list=queue&index=3&t=120&si=tracking#fragment`,
    `https://www.youtube.com/watch?v=${VIDEO_ID}&list=queue&index=3&t=120#fragment`,
    `https://youtube.com/watch?v=${VIDEO_ID}`,
    `https://m.youtube.com/watch?v=${VIDEO_ID}`,
    `http://youtu.be/${VIDEO_ID}?list=queue`,
    `https://youtu.be:443/${VIDEO_ID}`,
  ]) assert.equal(context.getCleanVideoUrl(rawUrl), CLEAN_URL, rawUrl);
  assert.equal(context.getCleanVideoUrl("https://youtu.be/a_b-cD0eF12"),
    "https://youtu.be/a_b-cD0eF12");
});

test("unrecognised, ambiguous and malformed URLs fail open", () => {
  const { context } = createHarness();
  for (const rawUrl of [
    "", "not a url", `//youtu.be/${VIDEO_ID}`, `javascript:${CLEAN_URL}`,
    `ftp://youtu.be/${VIDEO_ID}`, `https://youtu.be.example.com/${VIDEO_ID}`,
    `https://notyoutube.com/watch?v=${VIDEO_ID}`, `https://youtube.com.evil/watch?v=${VIDEO_ID}`,
    `https://user:password@youtu.be/${VIDEO_ID}`, `https://youtu.be:8080/${VIDEO_ID}`,
    `https://youtu.be/${VIDEO_ID}/extra`, "https://youtu.be/short", "https://youtu.be/abcdefghijkl",
    "https://youtu.be/aaaaaaaaaa!", `https://www.youtube.com/shorts/${VIDEO_ID}`,
    `https://www.youtube.com/embed/${VIDEO_ID}`, "https://www.youtube.com/watch?list=queue",
    `https://www.youtube.com/watch?v=${VIDEO_ID}&v=bbbbbbbbbbb`,
  ]) assert.ok(!context.getCleanVideoUrl(rawUrl), rawUrl);
});

test("native plain-copy selection keeps the native action and copies its fresh payload", () => {
  const harness = createHarness();
  const selection = harness.select({ target: harness.icon });
  assert.equal(selection.prevented, false);
  assert.equal(selection.stopped, false);
  const copied = harness.copy();
  assert.deepEqual(copied.writes, [["text/plain", CLEAN_URL]]);
  assert.equal(copied.event.prevented, true);
  assert.equal(copied.event.stopped, false);
  assert.equal(harness.timers.size, 0, "Successful copy must discard its one-shot arm");
  assert.deepEqual(harness.copy().writes, [], "A second native or manual copy is not armed");
});

test("the native target handler can finish copying and dismiss its menu", () => {
  const harness = createHarness();
  const selection = harness.select();
  let nativeHandlerRan = false;
  let menuDismissed = false;
  // Simulate the existing native target handler and its successful execCommand callback.
  if (!selection.defaultPrevented && !selection.stopped) {
    nativeHandlerRan = true;
    const copied = harness.copy();
    if (copied.event.defaultPrevented && copied.writes.length === 1) {
      menuDismissed = true;
      harness.menu.parentElement = null;
    }
  }
  assert.equal(nativeHandlerRan, true);
  assert.equal(menuDismissed, true);
  assert.equal(harness.menu.isConnected, false);
});

test("current-time, embed, debug and unrelated menu items retain native clipboard behaviour", () => {
  for (const label of ["Copy video URL at current time", "Copy embed code", "Copy debug info",
    "Copy video URL (other action)", "copy video URL", "Loop", "Miniplayer"]) {
    const harness = createHarness();
    harness.label.textContent = label;
    harness.select();
    const copied = harness.copy(`${QUEUE_URL}&t=120`);
    assert.deepEqual(copied.writes, [], label);
    assert.equal(copied.event.prevented, false, label);
  }
  const harness = createHarness();
  harness.menu.className = "other-contextmenu";
  harness.select();
  assert.deepEqual(harness.copy().writes, []);
});

test("label whitespace and text-node targets remain compatible with the native menu", () => {
  const harness = createHarness();
  harness.label.textContent = " \n Copy video URL \n ";
  harness.select({ target: { nodeType: 3, parentElement: harness.label } });
  assert.deepEqual(harness.copy().writes, [["text/plain", CLEAN_URL]]);
});

test("disabled and irrelevant input performs no menu queries or timer work", () => {
  const harness = createHarness({ enabled: false });
  harness.select();
  harness.copy();
  assert.deepEqual(harness.counts, { queries: 0, closest: 0, timers: 0 });
  for (const properties of [
    { isTrusted: false }, { button: 1 }, { button: 2 }, { defaultPrevented: true },
    { type: "keydown", key: "Enter", ctrlKey: true },
    { type: "keydown", key: "Enter", altKey: true },
    { type: "keydown", key: "Enter", metaKey: true },
    { type: "keydown", key: "a" }, { type: "keydown", key: "Enter", repeat: true },
    { type: "keydown", key: "Enter", isComposing: true },
  ]) {
    const enabledHarness = createHarness();
    enabledHarness.select(properties);
    assert.deepEqual(enabledHarness.counts, { queries: 0, closest: 0, timers: 0 },
      JSON.stringify(properties));
    assert.deepEqual(enabledHarness.copy().writes, []);
  }
});

test("trusted native keyboard activation tolerates the native synthetic click", () => {
  for (const key of ["Enter", " ", "ArrowRight"]) {
    const harness = createHarness();
    const selection = harness.select({ type: "keydown", key });
    assert.equal(selection.prevented, false, key);
    assert.equal(selection.stopped, false, key);
    harness.select({ isTrusted: false });
    assert.deepEqual(harness.copy().writes, [["text/plain", CLEAN_URL]], key);
  }
});

test("synthetic copy events cannot write clipboard data or consume a native action arm", () => {
  const harness = createHarness();
  harness.select();
  const synthetic = harness.copy(QUEUE_URL, { isTrusted: false });
  assert.deepEqual(synthetic.writes, []);
  assert.equal(synthetic.event.prevented, false);
  assert.equal(harness.timers.size, 1);
  assert.deepEqual(harness.copy().writes, [["text/plain", CLEAN_URL]]);
});

test("copy ownership requires the armed native textarea and full selection", () => {
  for (const mutation of [
    (harness, copyEvent) => { copyEvent.target = harness.document.body; harness.document.activeElement = harness.document.body; },
    (harness) => { harness.clipboard.selectionStart = 1; },
    (harness) => { harness.clipboard.selectionEnd--; },
    (harness) => { harness.menu.parentElement = null; },
    (harness) => { harness.clipboard.className = "other-clipboard"; },
    (harness, copyEvent) => { copyEvent.cancelable = false; },
    (harness, copyEvent) => { copyEvent.defaultPrevented = true; },
    (_harness, copyEvent) => { copyEvent.clipboardData = null; },
  ]) {
    const harness = createHarness();
    harness.select();
    harness.clipboard.value = QUEUE_URL;
    harness.clipboard.selectionStart = 0;
    harness.clipboard.selectionEnd = QUEUE_URL.length;
    harness.document.activeElement = harness.clipboard;
    const writes = [];
    const copyEvent = harness.event("copy", {
      target: harness.clipboard,
      clipboardData: { setData(type, value) { writes.push([type, value]); } },
    });
    mutation(harness, copyEvent);
    harness.context.handleCleanVideoUrlCopy(copyEvent);
    assert.deepEqual(writes, []);
    assert.equal(copyEvent.prevented, false);
  }
});

test("active native textarea ownership handles clipboard events targeting the body", () => {
  const harness = createHarness();
  harness.select();
  assert.deepEqual(harness.copy(QUEUE_URL, { target: harness.document.body }).writes,
    [["text/plain", CLEAN_URL]]);
});

test("a different menu or clipboard must not inherit the armed copy action", () => {
  const harness = createHarness();
  harness.select();
  const otherMenu = harness.document.body.appendChild(new harness.Element("div", "ytp-contextmenu"));
  const otherClipboard = otherMenu.appendChild(new harness.Element("textarea", "ytp-html5-clipboard"));
  otherClipboard.value = QUEUE_URL;
  otherClipboard.selectionStart = 0;
  otherClipboard.selectionEnd = QUEUE_URL.length;
  harness.document.activeElement = otherClipboard;
  const writes = [];
  const copyEvent = harness.event("copy", {
    target: otherClipboard,
    clipboardData: { setData(type, value) { writes.push([type, value]); } },
  });
  harness.context.handleCleanVideoUrlCopy(copyEvent);
  assert.deepEqual(writes, []);
  assert.equal(copyEvent.prevented, false);
});

test("malformed native payload and clipboard write failure leave native copy untouched", () => {
  const malformed = createHarness();
  malformed.select();
  const copied = malformed.copy("https://example.com/not-a-youtube-video");
  assert.deepEqual(copied.writes, []);
  assert.equal(copied.event.prevented, false);
  const failure = createHarness();
  failure.select();
  const failed = failure.copy(QUEUE_URL, {
    clipboardData: { setData() { throw new Error("Clipboard unavailable"); } },
  });
  assert.equal(failed.event.prevented, false);
  assert.equal(failed.event.stopped, false);
});

test("the arm survives listener boundaries, expires after the task and clears on cleanup", () => {
  const harness = createHarness();
  harness.select();
  assert.equal(harness.timers.size, 1);
  assert.deepEqual(harness.copy().writes, [["text/plain", CLEAN_URL]]);
  harness.select();
  harness.runTimers();
  assert.deepEqual(harness.copy().writes, []);
  harness.select();
  harness.context.clearCleanVideoUrlCopy();
  assert.equal(harness.timers.size, 0);
  assert.deepEqual(harness.copy().writes, []);
});

test("re-arming retains only one expiry timer and unarmed copy has no DOM work", () => {
  const harness = createHarness();
  harness.copy();
  assert.deepEqual(harness.counts, { queries: 0, closest: 0, timers: 0 });
  harness.select();
  harness.select();
  assert.equal(harness.counts.timers, 2);
  assert.equal(harness.timers.size, 1);
  harness.runTimers();
  assert.deepEqual(harness.copy().writes, []);
});

test("selection of another trusted menu action cancels a previous unconsumed arm", () => {
  const harness = createHarness();
  harness.select();
  harness.label.textContent = "Copy video URL at current time";
  harness.select();
  assert.deepEqual(harness.copy(`${QUEUE_URL}&t=120`).writes, []);
});

test("copy interception is wired once and cleaned up on navigation and page suspension", () => {
  assert.equal((SOURCE.match(/document\.addEventListener\("copy",\s*handleCleanVideoUrlCopy,\s*true\)/g) || []).length, 1);
  assert.match(SOURCE, /document\.addEventListener\("click",\s*handleCleanVideoUrlSelection,\s*true\)/);
  assert.match(SOURCE, /document\.addEventListener\("keydown",\s*handleCleanVideoUrlSelection,\s*true\)/);
  assert.match(extractFunction("handleNavigateStart"), /clearCleanVideoUrlCopy\(\)/);
  const pageHide = SOURCE.match(/window\.addEventListener\(\s*"pagehide"[\s\S]*?(?=window\.addEventListener\(\s*"pageshow")/)?.[0];
  assert.match(pageHide, /clearCleanVideoUrlCopy\(\)/);
  const implementation = ["getCleanVideoUrl", "clearCleanVideoUrlCopy",
    "handleCleanVideoUrlSelection", "handleCleanVideoUrlCopy"].map(extractFunction).join("\n");
  assert.doesNotMatch(implementation, /MutationObserver|setInterval|queueMicrotask|navigator\.clipboard|location\./);
});
