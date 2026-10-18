import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

const source = readFileSync(
  new URL("../sources/modules/youtube-watch-layout-cleaner.user.js", import.meta.url),
  "utf8",
);

function extractFunction(name) {
  const start = source.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `${name} must exist in the canonical module`);
  const next = source.indexOf("\n  function ", start + 1);
  const end = next === -1 ? source.indexOf("\n  const scheduleQueuePlayingMarkerReconciliation =", start) : next;
  assert.notEqual(end, -1, `${name} extraction must be bounded`);
  return source.slice(start, end);
}

class FakeEventTarget {
  listeners = new Map();

  addEventListener(type, callback, options) {
    const capture = options === true || Boolean(options?.capture);
    const entries = this.listeners.get(type) || [];
    if (!entries.some((entry) => entry.callback === callback && entry.capture === capture)) {
      entries.push({ callback, capture, once: Boolean(options?.once) });
      this.listeners.set(type, entries);
    }
  }

  removeEventListener(type, callback, options) {
    const capture = options === true || Boolean(options?.capture);
    const entries = (this.listeners.get(type) || []).filter(
      (entry) => entry.callback !== callback || entry.capture !== capture,
    );
    if (entries.length) this.listeners.set(type, entries);
    else this.listeners.delete(type);
  }

  dispatchEvent(event) {
    event.target ??= this;
    event.currentTarget = this;
    event.preventDefault ??= () => { event.defaultPrevented = true; };
    event.stopPropagation ??= () => { event.propagationStopped = true; };
    for (const entry of [...(this.listeners.get(event.type) || [])]) {
      entry.callback.call(this, event);
      if (entry.once) this.removeEventListener(event.type, entry.callback, entry.capture);
    }
    return !event.defaultPrevented;
  }

  get listenerCount() {
    return [...this.listeners.values()].reduce((count, entries) => count + entries.length, 0);
  }
}

class FakeStyle {
  visibility = "";
  display = "";
  transform = "";
  translate = "";
  values = new Map();
  priorities = new Map();

  setProperty(name, value, priority = "") {
    this.values.set(name, String(value));
    this.priorities.set(name, priority);
  }

  getPropertyValue(name) { return this.values.get(name) || ""; }
  getPropertyPriority(name) { return this.priorities.get(name) || ""; }

  removeProperty(name) {
    const previous = this.getPropertyValue(name);
    this.values.delete(name);
    this.priorities.delete(name);
    return previous;
  }
}

class FakeElement extends FakeEventTarget {
  nodeType = 1;
  children = [];
  attributes = new Map();
  style = new FakeStyle();
  isConnected = true;
  scrollTop = 0;
  scrollLeft = 0;
  clientHeight = 240;
  clientWidth = 320;
  scrollHeight = 1200;
  animations = [];

  constructor(harness, tagName, id = "", classes = []) {
    super();
    this.harness = harness;
    this.tagName = tagName.toUpperCase();
    this.id = id;
    this.className = classes.join(" ");
    this.ownerDocument = harness.document;
    this.classList = {
      contains: (name) => this.className.split(/\s+/).includes(name),
      add: (name) => { if (!this.classList.contains(name)) this.className += ` ${name}`; },
      remove: (name) => { this.className = this.className.split(/\s+/).filter((entry) => entry !== name).join(" "); },
    };
  }

  appendChild(element) {
    element.parentElement?.removeChild(element);
    element.parentNode = element.parentElement = this;
    this.children.push(element);
    return element;
  }

  removeChild(element) {
    this.children.splice(this.children.indexOf(element), 1);
    element.parentNode = element.parentElement = null;
    return element;
  }

  insertBefore(element, next) {
    element.parentElement?.removeChild(element);
    element.parentNode = element.parentElement = this;
    const index = next ? this.children.indexOf(next) : -1;
    if (index < 0) this.children.push(element);
    else this.children.splice(index, 0, element);
  }

  get childNodes() { return this.children; }
  get offsetHeight() { return this.getBoundingClientRect().height; }
  get offsetWidth() { return this.getBoundingClientRect().width; }
  get parentNode() { return this.parentElement; }
  set parentNode(value) { this.parentElement = value; }

  contains(other) {
    for (let element = other; element; element = element.parentElement) {
      if (element === this) return true;
    }
    return false;
  }

  matches(selector) {
    return selector.split(",").some((part) => {
      part = part.trim().replace(/^:scope\s*>?\s*/, "");
      if (part.startsWith("[contenteditable]")) return this.isContentEditable;
      if (part === '[role="button"]') return this.getAttribute("role") === "button";
      if (part === ".playlist-drag-handle") return this.classList.contains("playlist-drag-handle");
      if (part.startsWith("#")) return this.id === part.slice(1);
      if (part === "[hidden]") return this.hasAttribute("hidden");
      if (part === '[aria-hidden="true"]') return this.getAttribute("aria-hidden") === "true";
      return this.tagName.toLowerCase() === part.toLowerCase();
    });
  }

  closest(selector) {
    for (let element = this; element; element = element.parentElement) {
      if (element.matches(selector)) return element;
    }
    return null;
  }

  querySelector(selector) {
    this.harness.reads.queries += 1;
    for (const child of this.children) {
      if (child.matches(selector)) return child;
      const match = child.querySelector(selector);
      if (match) return match;
    }
    return null;
  }

  querySelectorAll(selector) {
    this.harness.reads.queries += 1;
    return this.children.flatMap((child) => [
      ...(child.matches(selector) ? [child] : []),
      ...child.querySelectorAll(selector),
    ]);
  }

  hasAttribute(name) { return this.attributes.has(name); }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  removeAttribute(name) { this.attributes.delete(name); }

  getBoundingClientRect() {
    this.harness.reads.bounds += 1;
    const value = typeof this.rect === "function" ? this.rect() : this.rect || {
      top: 100, left: 100, width: 320, height: 72,
    };
    return { ...value, right: value.left + value.width, bottom: value.top + value.height, x: value.left, y: value.top };
  }

  getClientRects() { return this.isConnected && !this.hidden ? [this.getBoundingClientRect()] : []; }

  getAnimations() { return this.animations.filter((animation) => !animation.cancelled); }

  remove() { this.parentElement?.removeChild(this); }

  animate(keyframes, options) {
    const animation = {
      element: this, keyframes, options, cancelled: false,
      cancel() { this.cancelled = true; },
      finished: new Promise(() => {}),
    };
    this.animations.push(animation);
    this.harness.animations.push(animation);
    return animation;
  }
}

function createHarness({ reducedMotion = false, tagName = "ytd-playlist-panel-renderer" } = {}) {
  const harness = {
    document: new FakeEventTarget(), window: new FakeEventTarget(),
    reads: { bounds: 0, computed: 0, queries: 0 }, animations: [],
    timers: new Map(), frames: new Map(), nextId: 1, observerCount: 0, observers: [],
  };
  const { document, window } = harness;
  document.visibilityState = "visible";
  document.hidden = false;
  window.innerWidth = 900;
  window.innerHeight = 700;
  const media = new FakeEventTarget();
  media.matches = reducedMotion;
  window.matchMedia = () => media;
  harness.media = media;
  const createElement = (tag, id, classes) => new FakeElement(harness, tag, id, classes);
  const root = createElement("html");
  const body = root.appendChild(createElement("body"));
  const panel = body.appendChild(createElement(tagName));
  root.rect = body.rect = { top: 0, left: 0, width: 900, height: 700 };
  panel.rect = { top: 80, left: 100, width: 320, height: 280 };
  panel.canReorder = true;
  const items = panel.appendChild(createElement("div", "items"));
  items.rect = { top: 100, left: 100, width: 320, height: 240 };
  const rows = Array.from({ length: 4 }, () => {
    const row = items.appendChild(createElement("ytd-playlist-panel-video-renderer"));
    row.data = { playlistSetVideoId: String(items.children.length) };
    const content = row.appendChild(createElement("div", "container"));
    content.style.position = "relative";
    const handle = content.appendChild(createElement("div", "index-container", ["playlist-drag-handle"]));
    row.content = content;
    row.handle = handle;
    row.rect = () => ({ top: 100 + items.children.indexOf(row) * 72 - items.scrollTop, left: 100, width: 320, height: 72 });
    content.rect = row.rect;
    return row;
  });
  document.documentElement = root;
  document.body = body;
  document.defaultView = window;
  document.createElement = (tag) => createElement(tag);
  root.clientHeight = 700;
  root.clientWidth = 900;
  document.querySelector = (selector) => root.querySelector(selector);
  document.querySelectorAll = (selector) => root.querySelectorAll(selector);
  const group = new FakeEventTarget();
  group.isDragging = () => Boolean(group.currDragItem_ && group.draggerEl_);
  group.getHandleForDragItem_ = (row) => row.handle;
  const controller = { scrollElement: items, JSC$99999_dragListGroup: group, dragScrollSupport: null };
  panel.ytReorderableController = controller;
  const originalCalculate = function (...args) { harness.originalCalls = args; return 151; };
  const support = {
    containerNode_: items, horizontalScrolling_: false, calculateScrollDelta: originalCalculate,
    scrollDelta_: { x: 0, y: 0 }, scrollTimer_: { enabled: false, stop() { this.enabled = false; } },
  };
  const globals = {
    document, window, Element: FakeElement, HTMLElement: FakeElement,
    getComputedStyle(element) {
      harness.reads.computed += 1;
      return {
        display: element.hidden ? "none" : element.style.display || "block",
        visibility: element.style.visibility || "visible",
        overflowY: element.style.overflowY || (element === items ? "auto" : "visible"),
        overflowX: element.style.overflowX || (element === items ? "auto" : "visible"),
        transform: "none", opacity: "1", position: element.style.position || "static",
      };
    },
    requestAnimationFrame(callback) { const id = harness.nextId++; harness.frames.set(id, callback); return id; },
    cancelAnimationFrame(id) { harness.frames.delete(id); },
    setTimeout(callback) { const id = harness.nextId++; harness.timers.set(id, callback); return id; },
    clearTimeout(id) { harness.timers.delete(id); },
    MutationObserver: class {
      constructor(callback) { this.callback = callback; this.active = false; harness.observerCount += 1; harness.observers.push(this); }
      observe() { this.active = true; }
      disconnect() { this.active = false; }
    },
    matchMedia: window.matchMedia,
    performance: { now: () => 0 }, location: { pathname: "/watch" }, console,
  };
  window.getComputedStyle = globals.getComputedStyle;
  window.requestAnimationFrame = globals.requestAnimationFrame;
  window.cancelAnimationFrame = globals.cancelAnimationFrame;
  const context = vm.createContext(globals);
  vm.runInContext(`${extractFunction("installQueueDragAssistance")}\nthis.dispose = installQueueDragAssistance();`, context);
  Object.assign(harness, { panel, items, rows, group, controller, support, originalCalculate, root, body, context });
  harness.mouse = (type, { target = rows[0].handle, clientX = 180, clientY = 200, ...other } = {}) => {
    const event = { type, target, clientX, clientY, button: 0, buttons: type === "mouseup" ? 0 : 1, isTrusted: true, ...other };
    document.dispatchEvent(event);
    return event;
  };
  harness.start = (row = rows[0]) => {
    harness.mouse("mousedown", { target: row.handle });
    group.currDragItem_ = row;
    group.draggerEl_ = createElement(row.tagName, "", ["dragging"]);
    row.style.visibility = "hidden";
    controller.dragScrollSupport = support;
    group.dispatchEvent({ type: "dragstart", currDragItem: row, draggerEl: group.draggerEl_, event: { clientX: 180, clientY: 200 } });
  };
  harness.end = () => {
    group.dispatchEvent({ type: "dragend", currDragItem: group.currDragItem_, draggerEl: group.draggerEl_ });
    group.currDragItem_ = group.draggerEl_ = null;
    controller.dragScrollSupport = null;
    rows.forEach((row) => { row.style.visibility = ""; });
    harness.mouse("mouseup");
  };
  harness.dispose = () => context.dispose();
  harness.flushFrames = () => { for (const [id, callback] of [...harness.frames]) { harness.frames.delete(id); callback(16); } };
  harness.listenerCount = () => document.listenerCount + window.listenerCount + group.listenerCount + media.listenerCount;
  harness.readCount = () => Object.values(harness.reads).reduce((sum, count) => sum + count, 0);
  return harness;
}

test("queue drag assistance does no idle work or DOM reading for ordinary pointer motion", () => {
  const harness = createHarness();
  const reads = harness.readCount();
  for (let index = 0; index < 20; index++) harness.mouse("mousemove");
  assert.equal(harness.readCount(), reads);
  assert.equal(harness.frames.size, 0);
  assert.equal(harness.timers.size, 0);
  assert.equal(harness.observerCount, 0);
  assert.equal(harness.group.listenerCount, 0);
  harness.dispose();
  assert.equal(harness.listenerCount(), 0);
});

test("queue drag assistance ignores synthetic, non-primary and editable input", () => {
  const harness = createHarness();
  const input = harness.rows[0].content.appendChild(new FakeElement(harness, "input"));
  const editable = harness.rows[0].handle.appendChild(new FakeElement(harness, "span"));
  editable.isContentEditable = true;
  for (const options of [{ isTrusted: false }, { button: 1 }, { button: 2 }, { target: input }, { target: editable }]) {
    harness.mouse("mousedown", options);
    assert.equal(harness.group.listenerCount, 0);
    assert.equal(harness.support.calculateScrollDelta, harness.originalCalculate);
  }
  harness.dispose();
  assert.equal(harness.listenerCount(), 0);
});

test("queue drag assistance rejects non-reorderable, hidden and unsupported native panels", () => {
  for (const mutate of [
    (harness) => { harness.panel.canReorder = false; },
    (harness) => { harness.panel.hidden = true; },
    (harness) => { harness.panel.isConnected = false; },
    (harness) => { harness.group.isDragging = undefined; },
    (harness) => { harness.panel.ytReorderableController = null; },
  ]) {
    const harness = createHarness();
    mutate(harness);
    harness.mouse("mousedown");
    assert.equal(harness.group.listenerCount, 0);
    assert.equal(harness.frames.size, 0);
    assert.equal(harness.timers.size, 0);
    harness.dispose();
    assert.equal(harness.listenerCount(), 0);
  }
});

test("queue drag assistance decorates only matching native drag support and restores on end", () => {
  const harness = createHarness();
  harness.start();
  assert.notEqual(harness.support.calculateScrollDelta, harness.originalCalculate);
  assert.equal(harness.frames.size, 0, "native scrolling must not acquire another animation-frame loop");
  assert.equal(harness.timers.size, 0, "native scrolling must not acquire another timer");
  assert.equal(harness.items.children.length, 4, "native placeholder remains the only insertion-gap row");
  harness.end();
  assert.equal(harness.support.calculateScrollDelta, harness.originalCalculate);
  assert.equal(harness.group.listenerCount, 0);
  harness.dispose();
  assert.equal(harness.listenerCount(), 0);
});

test("queue drag assistance supports both native playlist panel tag variants", () => {
  for (const tagName of ["ytd-playlist-panel-renderer", "yt-playlist-panel-renderer"]) {
    const harness = createHarness({ tagName });
    harness.start();
    assert.notEqual(harness.support.calculateScrollDelta, harness.originalCalculate);
    harness.end();
    harness.dispose();
    assert.equal(harness.listenerCount(), 0);
  }
});

test("queue edge scrolling is proportional, bounded and confined to the visible queue", () => {
  const harness = createHarness();
  harness.start();
  const calculate = () => harness.support.calculateScrollDelta(9999, 8888, 7777);
  harness.mouse("mousemove", { clientX: 180, clientY: 325 });
  const nearEdge = calculate();
  harness.mouse("mousemove", { clientX: 180, clientY: 339 });
  const atEdge = calculate();
  assert(nearEdge > 0 && atEdge >= nearEdge && atEdge <= 48, "bottom movement must accelerate without native 48px jumps");
  harness.mouse("mousemove", { clientX: 180, clientY: 200 });
  assert.equal(calculate(), 0);
  harness.mouse("mousemove", { clientX: 90, clientY: 339 });
  assert.equal(calculate(), 0, "outside horizontal bounds must not scroll");
  harness.mouse("mousemove", { clientX: 180, clientY: 360 });
  assert.equal(calculate(), 0, "outside vertical bounds must not scroll");
  harness.items.scrollTop = harness.items.scrollHeight - harness.items.clientHeight;
  harness.mouse("mousemove", { clientX: 180, clientY: 339 });
  assert.equal(calculate(), 0, "bottom boundary must stop");
  harness.items.scrollTop = 150;
  harness.mouse("mousemove", { clientX: 180, clientY: 101 });
  assert(calculate() < 0);
  harness.items.scrollTop = 0;
  assert.equal(calculate(), 0, "top boundary must stop");
  harness.end();
  harness.dispose();
});

test("queue drag restoration does not overwrite an external native-method replacement", () => {
  const harness = createHarness();
  harness.start();
  const externalCalculate = () => 9;
  harness.support.calculateScrollDelta = externalCalculate;
  harness.end();
  assert.equal(harness.support.calculateScrollDelta, externalCalculate);
  harness.dispose();
});

test("queue drag assistance does not leak registrations across repeated drags", () => {
  const harness = createHarness();
  const idleListeners = harness.listenerCount();
  for (let index = 0; index < 20; index++) {
    harness.start();
    harness.end();
    assert.equal(harness.listenerCount(), idleListeners);
    assert.equal(harness.group.listenerCount, 0);
    assert.equal(harness.frames.size, 0);
    assert.equal(harness.timers.size, 0);
  }
  harness.dispose();
  assert.equal(harness.listenerCount(), 0);
});

test("queue drag assistance does not decorate support for a different native row or scroller", () => {
  for (const mismatched of ["row", "scroller", "horizontal"]) {
    const harness = createHarness();
    harness.mouse("mousedown");
    const row = mismatched === "row" ? harness.rows[1] : harness.rows[0];
    harness.group.currDragItem_ = row;
    harness.group.draggerEl_ = new FakeElement(harness, row.tagName, "", ["dragging"]);
    harness.controller.dragScrollSupport = harness.support;
    if (mismatched === "scroller") harness.support.containerNode_ = harness.body;
    if (mismatched === "horizontal") harness.support.horizontalScrolling_ = true;
    harness.group.dispatchEvent({ type: "dragstart", currDragItem: row, draggerEl: harness.group.draggerEl_, event: { clientX: 180, clientY: 200 } });
    assert.equal(harness.support.calculateScrollDelta, harness.originalCalculate);
    harness.dispose();
    assert.equal(harness.listenerCount(), 0);
  }
});

test("queue drag assistance respects the actual native handle selection", () => {
  const harness = createHarness();
  harness.mouse("mousedown", { target: harness.rows[0].content });
  assert.equal(harness.group.listenerCount, 0, "handle-only native configuration must stay handle-only");
  harness.group.getHandleForDragItem_ = (row) => row;
  harness.mouse("mousedown", { target: harness.rows[0].content });
  assert(harness.group.listenerCount > 0, "native whole-row dragging can be assisted without changing its rules");
  harness.mouse("mouseup");
  harness.dispose();
  assert.equal(harness.listenerCount(), 0);
});

test("queue edge scrolling uses clipped viewport and ancestor bounds", () => {
  const viewport = createHarness();
  viewport.items.rect = { top: 600, left: 100, width: 320, height: 240 };
  viewport.start();
  viewport.mouse("mousemove", { clientX: 180, clientY: 699 });
  assert(viewport.support.calculateScrollDelta(9999, 0, 240) > 0, "viewport-clipped lower edge must be reachable");
  viewport.mouse("mousemove", { clientX: 180, clientY: 701 });
  assert.equal(viewport.support.calculateScrollDelta(9999, 0, 240), 0);
  viewport.end();
  viewport.dispose();

  const ancestor = createHarness();
  ancestor.panel.style.overflowY = "hidden";
  ancestor.panel.rect = { top: 150, left: 100, width: 320, height: 160 };
  ancestor.start();
  ancestor.mouse("mousemove", { clientX: 180, clientY: 309 });
  assert(ancestor.support.calculateScrollDelta(9999, 0, 240) > 0, "clipping ancestor determines the usable bottom edge");
  ancestor.mouse("mousemove", { clientX: 180, clientY: 325 });
  assert.equal(ancestor.support.calculateScrollDelta(9999, 0, 240), 0);
  ancestor.end();
  ancestor.dispose();
});

test("queue movement animates only inner visuals and releases them at drag end", () => {
  const harness = createHarness();
  harness.start();
  const event = { currDragItem: harness.rows[0], draggerEl: harness.group.draggerEl_, event: { clientX: 180, clientY: 260 } };
  harness.group.dispatchEvent({ type: "beforedragmove", ...event });
  harness.items.insertBefore(harness.rows[0], harness.rows[3]);
  harness.group.dispatchEvent({ type: "dragmove", ...event });
  harness.flushFrames();
  assert(harness.animations.length > 0, "native placeholder movement should animate displaced inner visuals");
  assert(harness.animations.every((animation) => harness.rows.slice(1).some((row) => animation.element === row.content)));
  assert(harness.rows.every((row) => row.style.transform === "" && row.style.translate === ""));
  assert.equal(harness.group.draggerEl_.style.transform, "");
  harness.end();
  assert(harness.animations.every((animation) => animation.cancelled));
  assert.equal(harness.frames.size, 0);
  harness.dispose();
});

test("queue movement respects reduced motion without disabling native edge assistance", () => {
  const harness = createHarness({ reducedMotion: true });
  harness.start();
  const event = { currDragItem: harness.rows[0], draggerEl: harness.group.draggerEl_, event: { clientX: 180, clientY: 260 } };
  harness.group.dispatchEvent({ type: "beforedragmove", ...event });
  harness.items.insertBefore(harness.rows[0], harness.rows[3]);
  harness.group.dispatchEvent({ type: "dragmove", ...event });
  harness.flushFrames();
  assert.equal(harness.animations.length, 0);
  assert.notEqual(harness.support.calculateScrollDelta, harness.originalCalculate);
  harness.end();
  harness.dispose();
});

test("changing reduced motion cancels existing owned queue animations", () => {
  const harness = createHarness();
  harness.start();
  const event = { currDragItem: harness.rows[0], draggerEl: harness.group.draggerEl_, event: { clientX: 180, clientY: 260 } };
  harness.group.dispatchEvent({ type: "beforedragmove", ...event });
  harness.items.insertBefore(harness.rows[0], harness.rows[3]);
  harness.group.dispatchEvent({ type: "dragmove", ...event });
  assert(harness.animations.length > 0);
  harness.media.matches = true;
  harness.media.dispatchEvent({ type: "change", matches: true });
  assert(harness.animations.every((animation) => animation.cancelled));
  harness.end();
  harness.dispose();
});

test("an ordinary native handle click releases armed state without altering native scrolling", () => {
  const harness = createHarness();
  const idleListeners = harness.listenerCount();
  harness.mouse("mousedown");
  harness.mouse("mouseup");
  assert.equal(harness.support.calculateScrollDelta, harness.originalCalculate);
  assert.equal(harness.listenerCount(), idleListeners);
  assert(harness.observers.every((observer) => !observer.active));
  assert.equal(harness.frames.size, 0);
  assert.equal(harness.timers.size, 0);
  harness.dispose();
});

test("detaching the active queue releases all owned transient state", () => {
  const harness = createHarness();
  const idleListeners = harness.listenerCount();
  harness.start();
  harness.panel.isConnected = false;
  for (const observer of harness.observers) observer.callback([]);
  assert.equal(harness.support.calculateScrollDelta, harness.originalCalculate);
  assert.equal(harness.listenerCount(), idleListeners);
  assert(harness.observers.every((observer) => !observer.active));
  assert.equal(harness.rows[0].content.hasAttribute("data-ywlc-drag-placeholder"), false);
  harness.dispose();
});

test("queue drag assistance releases transient state on cancellation and navigation", () => {
  for (const cancel of [
    (harness) => harness.window.dispatchEvent({ type: "blur" }),
    (harness) => harness.window.dispatchEvent({ type: "pagehide" }),
    (harness) => harness.document.dispatchEvent({ type: "keydown", key: "Escape", isTrusted: true }),
    (harness) => harness.window.dispatchEvent({ type: "yt-navigate-start" }),
    (harness) => {
      harness.document.hidden = true;
      harness.document.visibilityState = "hidden";
      harness.document.dispatchEvent({ type: "visibilitychange" });
    },
  ]) {
    const harness = createHarness();
    const idleListeners = harness.listenerCount();
    harness.start();
    cancel(harness);
    assert.equal(harness.support.calculateScrollDelta, harness.originalCalculate);
    assert.equal(harness.listenerCount(), idleListeners);
    assert.equal(harness.frames.size, 0);
    assert.equal(harness.timers.size, 0);
    harness.dispose();
    assert.equal(harness.listenerCount(), 0);
  }
});

test("failed queue geometry reads do not abort native reordering", () => {
  const harness = createHarness();
  const idleListeners = harness.listenerCount();
  harness.start();
  harness.rows[1].content.rect = () => { throw new Error("renderer geometry became unavailable"); };
  const event = { currDragItem: harness.rows[0], draggerEl: harness.group.draggerEl_, event: { clientX: 180, clientY: 260 } };
  let nativeMoved = false;
  assert.doesNotThrow(() => {
    harness.group.dispatchEvent({ type: "beforedragmove", ...event });
    harness.items.insertBefore(harness.rows[0], harness.rows[3]);
    nativeMoved = true;
    harness.group.dispatchEvent({ type: "dragmove", ...event });
  });
  assert.equal(nativeMoved, true);
  assert.equal(harness.items.children[2], harness.rows[0]);
  assert.equal(harness.support.calculateScrollDelta, harness.originalCalculate);
  assert.equal(harness.listenerCount(), idleListeners);
  assert(harness.observers.every((observer) => !observer.active));
  harness.end();
  harness.dispose();
});

test("failed visual animation does not interrupt native row movement or drop", () => {
  const harness = createHarness();
  const idleListeners = harness.listenerCount();
  harness.start();
  harness.rows[1].content.animate = () => { throw new Error("animation is unavailable"); };
  const event = { currDragItem: harness.rows[0], draggerEl: harness.group.draggerEl_, event: { clientX: 180, clientY: 260 } };
  let nativeDropped = false;
  assert.doesNotThrow(() => {
    harness.group.dispatchEvent({ type: "beforedragmove", ...event });
    harness.items.insertBefore(harness.rows[0], harness.rows[3]);
    harness.group.dispatchEvent({ type: "dragmove", ...event });
    harness.group.dispatchEvent({ type: "dragend", ...event });
    nativeDropped = true;
  });
  assert.equal(nativeDropped, true);
  assert.equal(harness.items.children[2], harness.rows[0]);
  assert.equal(harness.support.calculateScrollDelta, harness.originalCalculate);
  assert.equal(harness.listenerCount(), idleListeners);
  assert(harness.observers.every((observer) => !observer.active));
  harness.end();
  harness.dispose();
});

test("queue drag temporarily disables scroll anchoring and restores an absent inline value", () => {
  const harness = createHarness();
  assert.equal(harness.items.style.getPropertyValue("overflow-anchor"), "");
  harness.start();
  assert.equal(harness.items.style.getPropertyValue("overflow-anchor"), "none");
  harness.end();
  assert.equal(harness.items.style.getPropertyValue("overflow-anchor"), "");
  assert.equal(harness.items.style.getPropertyPriority("overflow-anchor"), "");
  harness.dispose();
});

test("queue drag restores an existing scroll-anchor value and its important priority", () => {
  const harness = createHarness();
  harness.items.style.setProperty("overflow-anchor", "auto", "important");
  harness.start();
  assert.equal(harness.items.style.getPropertyValue("overflow-anchor"), "none");
  harness.end();
  assert.equal(harness.items.style.getPropertyValue("overflow-anchor"), "auto");
  assert.equal(harness.items.style.getPropertyPriority("overflow-anchor"), "important");
  harness.dispose();
});

test("queue drag does not overwrite an external scroll-anchor value or priority change", () => {
  for (const change of ["value", "priority"]) {
    const harness = createHarness();
    harness.start();
    const ownedPriority = harness.items.style.getPropertyPriority("overflow-anchor");
    const externalValue = change === "value" ? "auto" : "none";
    const externalPriority = change === "priority"
      ? ownedPriority === "important" ? "" : "important"
      : ownedPriority;
    harness.items.style.setProperty("overflow-anchor", externalValue, externalPriority);
    harness.end();
    assert.equal(harness.items.style.getPropertyValue("overflow-anchor"), externalValue);
    assert.equal(harness.items.style.getPropertyPriority("overflow-anchor"), externalPriority);
    harness.dispose();
  }
});

test("replacing the native panel owner, controller or group releases stale assistance", () => {
  for (const replacement of ["owner", "controller", "group"]) {
    const harness = createHarness();
    const idleListeners = harness.listenerCount();
    harness.start();
    if (replacement === "owner") harness.panel.polymerController = { ytReorderableController: harness.controller };
    if (replacement === "controller") harness.panel.ytReorderableController = { ...harness.controller };
    if (replacement === "group") harness.controller.JSC$99999_dragListGroup = new FakeEventTarget();
    assert.equal(harness.support.calculateScrollDelta(9999, 0, 240), 0);
    assert.equal(harness.support.calculateScrollDelta, harness.originalCalculate);
    assert.equal(harness.listenerCount(), idleListeners);
    harness.end();
    harness.dispose();
  }
});

test("failed scroll bounds fail open and restore native scrolling", () => {
  const harness = createHarness();
  const idleListeners = harness.listenerCount();
  harness.start();
  harness.items.rect = () => { throw new Error("scroll bounds unavailable"); };
  assert.doesNotThrow(() => assert.equal(harness.support.calculateScrollDelta(9999, 0, 240), 0));
  assert.equal(harness.support.calculateScrollDelta, harness.originalCalculate);
  assert.equal(harness.listenerCount(), idleListeners);
  harness.end();
  harness.dispose();
});

test("synthetic same-size resize notifications preserve active queue assistance", () => {
  const harness = createHarness();
  harness.start();
  const assistedCalculate = harness.support.calculateScrollDelta;
  const activeListeners = harness.listenerCount();
  harness.window.dispatchEvent({ type: "resize", isTrusted: false });
  assert.equal(harness.support.calculateScrollDelta, assistedCalculate);
  assert.equal(harness.listenerCount(), activeListeners);
  harness.mouse("mousemove", { clientX: 180, clientY: 339 });
  assert(harness.support.calculateScrollDelta(9999, 0, 240) > 0);
  const event = { currDragItem: harness.rows[0], draggerEl: harness.group.draggerEl_, event: { clientX: 180, clientY: 260 } };
  harness.group.dispatchEvent({ type: "beforedragmove", ...event });
  harness.items.insertBefore(harness.rows[0], harness.rows[3]);
  harness.group.dispatchEvent({ type: "dragmove", ...event });
  assert(harness.animations.length > 0, "layout notification must not remove native movement animations");
  assert.equal(harness.items.children[2], harness.rows[0]);
  harness.end();
  assert.equal(harness.support.calculateScrollDelta, harness.originalCalculate);
  harness.dispose();
});

test("trusted resize or real viewport dimension changes release active queue assistance", () => {
  for (const resize of ["trusted", "width", "height"]) {
    const harness = createHarness();
    const idleListeners = harness.listenerCount();
    harness.start();
    if (resize === "width") harness.window.innerWidth += 20;
    if (resize === "height") harness.window.innerHeight += 20;
    harness.window.dispatchEvent({ type: "resize", isTrusted: resize === "trusted" });
    assert.equal(harness.support.calculateScrollDelta, harness.originalCalculate);
    assert.equal(harness.listenerCount(), idleListeners);
    assert(harness.observers.every((observer) => !observer.active));
    assert.equal(harness.items.style.getPropertyValue("overflow-anchor"), "");
    harness.end();
    harness.dispose();
  }
});
