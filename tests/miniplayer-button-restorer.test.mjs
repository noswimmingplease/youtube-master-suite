import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

const SOURCE = readFileSync(
  new URL("../sources/modules/youtube-miniplayer-button-restorer.user.js", import.meta.url),
  "utf8",
);
const CUSTOM_ID = "tmk-miniplayer-button";
const TOOLTIP_ID = "tmk-miniplayer-tooltip";

function createHarness({ native = true, withControls = true, atomicObserver = true } = {}) {
  let now = 0;
  let nextTimerId = 1;
  const timers = new Map();
  const observers = [];
  const windowListeners = new Map();
  const documentListeners = new Map();
  const location = { pathname: "/watch", search: "?v=aaaaaaaaaaa" };

  function schedule(callback, delay, interval = 0) {
    const id = nextTimerId++;
    timers.set(id, { callback, due: now + delay, interval });
    return id;
  }

  function tick(milliseconds) {
    const target = now + milliseconds;
    let calls = 0;
    for (;;) {
      const next = [...timers.entries()]
        .filter(([, timer]) => timer.due <= target)
        .sort((left, right) => left[1].due - right[1].due || left[0] - right[0])[0];
      if (!next) break;
      assert.ok(calls++ < 1000, "timers must remain bounded");
      const [id, timer] = next;
      now = timer.due;
      if (timer.interval) timer.due += timer.interval;
      else timers.delete(id);
      timer.callback();
    }
    now = target;
  }

  function notify(record) {
    for (const observer of observers) {
      if ([...observer.registrations].some(([target, options]) => (
        (target === record.target || (options.subtree && target.contains(record.target))) &&
        (record.type === "childList"
          ? options.childList
          : options.attributes && options.attributeFilter.includes(record.attributeName))
      ))) observer.records.push(record);
    }
  }

  function flushMutations() {
    for (const observer of observers) {
      if (observer.records.length) {
        const records = observer.records.splice(0);
        observer.callback(records);
      }
    }
  }

  class Element {
    constructor(tagName) {
      this.tagName = tagName;
      this.parentElement = null;
      this.children = [];
      this.attributes = new Map();
      this.css = {};
      this.style = {};
      this.offsetWidth = 48;
      this.offsetHeight = 48;
      this.focusVisible = false;
      this.hovered = false;
      this.listeners = new Map();
      this.clicks = 0;
      this.keyEvents = [];
      this.classList = {
        contains: (name) => this.className.split(/\s+/).includes(name),
      };
    }

    get id() { return this.getAttribute("id") || ""; }
    set id(value) { this.setAttribute("id", value); }
    get className() { return this.getAttribute("class") || ""; }
    set className(value) { this.setAttribute("class", value); }
    get hidden() { return this.attributes.has("hidden"); }
    set hidden(value) {
      if (value) this.setAttribute("hidden", "");
      else this.removeAttribute("hidden");
    }
    get disabled() { return this.attributes.has("disabled"); }
    set disabled(value) {
      if (value) this.setAttribute("disabled", "");
      else this.removeAttribute("disabled");
    }
    get isConnected() {
      return this === document.documentElement || Boolean(this.parentElement?.isConnected);
    }

    getAttribute(name) { return this.attributes.get(name) ?? null; }
    setAttribute(name, value) {
      this.attributes.set(name, String(value));
      notify({ type: "attributes", target: this, attributeName: name });
    }
    removeAttribute(name) {
      if (!this.attributes.delete(name)) return;
      notify({ type: "attributes", target: this, attributeName: name });
    }
    setCss(properties) {
      Object.assign(this.css, properties);
      this.setAttribute("style", JSON.stringify(this.css));
    }
    matches(selector) {
      return selector.split(",").some((part) => {
        part = part.trim();
        if (part === ":focus-visible") return this === document.activeElement && this.focusVisible;
        if (part === ":hover") return this.hovered;
        if (part.startsWith("#")) return this.id === part.slice(1);
        if (part.startsWith(".")) return this.classList.contains(part.slice(1));
        return this.tagName === part;
      });
    }
    closest(selector) {
      for (let element = this; element; element = element.parentElement) {
        if (element.matches(selector)) return element;
      }
      return null;
    }
    contains(other) {
      for (let element = other; element; element = element.parentElement) {
        if (element === this) return true;
      }
      return false;
    }
    querySelectorAll(selector) {
      const result = [];
      for (const child of this.children) {
        if (child.matches(selector)) result.push(child);
        result.push(...child.querySelectorAll(selector));
      }
      return result;
    }
    querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
    insertBefore(child, sibling) {
      child.remove();
      const index = sibling ? this.children.indexOf(sibling) : this.children.length;
      assert.ok(index >= 0);
      this.children.splice(index, 0, child);
      child.parentElement = this;
      notify({ type: "childList", target: this, addedNodes: [child], removedNodes: [] });
      return child;
    }
    appendChild(child) { return this.insertBefore(child, null); }
    remove() {
      const parent = this.parentElement;
      if (!parent) return;
      parent.children.splice(parent.children.indexOf(this), 1);
      this.parentElement = null;
      notify({ type: "childList", target: parent, addedNodes: [], removedNodes: [this] });
    }
    getClientRects() { return this.isConnected && !this.hidden ? [{}] : []; }
    getBoundingClientRect() {
      if (this.bounds) return this.bounds;
      return this === player
        ? { left: 0, top: 0, right: 960, bottom: 540, width: 960, height: 540 }
        : { left: 850, top: 490, right: 898, bottom: 538, width: 48, height: 48 };
    }
    addEventListener(type, callback) { this.listeners.set(type, callback); }
    emit(type, extra = {}) {
      if (type === "mouseenter") this.hovered = true;
      if (type === "mouseleave") this.hovered = false;
      this.listeners.get(type)?.({ type, target: this, currentTarget: this, ...extra });
    }
    click() {
      this.clicks++;
      this.emit("click");
    }
    focus({ visible = false } = {}) {
      document.activeElement?.emit("blur");
      document.activeElement = this;
      this.focusVisible = visible;
      this.emit("focus");
    }
    dispatchEvent(event) { this.keyEvents.push(event.type); return true; }
  }

  class Observer {
    constructor(callback) {
      this.callback = callback;
      this.registrations = new Map();
      this.records = [];
      observers.push(this);
    }
    observe(target, options) { this.registrations.set(target, options); }
    disconnect() { this.registrations.clear(); this.records = []; }
    replaceRegistrations(registrations) {
      this.disconnect();
      for (const [target, options] of registrations) this.observe(target, options);
    }
  }
  if (!atomicObserver) Observer.prototype.replaceRegistrations = undefined;

  const document = {
    createElement: (tagName) => new Element(tagName),
    createElementNS: (_, tagName) => new Element(tagName),
    querySelectorAll: (selector) => document.documentElement.querySelectorAll(selector),
    querySelector: (selector) => document.querySelectorAll(selector)[0] || null,
    getElementById: (id) => document.querySelector(`#${id}`),
    visibilityState: "visible",
    activeElement: null,
    addEventListener(type, listener) {
      const listeners = documentListeners.get(type) || [];
      if (!listeners.includes(listener)) listeners.push(listener);
      documentListeners.set(type, listeners);
    },
    removeEventListener(type, listener) {
      const listeners = documentListeners.get(type) || [];
      documentListeners.set(type, listeners.filter((callback) => callback !== listener));
    },
  };
  document.documentElement = new Element("html");
  document.head = document.documentElement.appendChild(new Element("head"));
  document.body = document.documentElement.appendChild(new Element("body"));
  const watch = document.body.appendChild(new Element("ytd-watch-flexy"));
  const player = watch.appendChild(new Element("div"));
  player.id = "movie_player";
  player.className = "html5-video-player";
  player.offsetWidth = 960;
  player.offsetHeight = 540;
  const toolbar = player.appendChild(new Element("div"));
  toolbar.className = "ytp-chrome-bottom";

  function createNative(controls) {
    const button = new Element("button");
    button.className = "ytp-miniplayer-button ytp-button";
    controls.appendChild(button);
    return button;
  }

  function createControls({ withNative = false } = {}) {
    const controls = toolbar.appendChild(new Element("div"));
    controls.className = "ytp-right-controls";
    const fullscreen = controls.appendChild(new Element("button"));
    fullscreen.className = "ytp-fullscreen-button";
    if (withNative) createNative(controls);
    return controls;
  }

  const controls = withControls ? createControls({ withNative: native }) : null;
  const nativeButton = controls?.querySelector(".ytp-miniplayer-button") || null;
  function getComputedStyle(element) {
    const visibility = element.css.visibility || (
      element.parentElement ? getComputedStyle(element.parentElement).visibility : "visible"
    );
    return {
      display: element.hidden || (
        element.matches(".ytp-miniplayer-button") && player.classList.contains("hide-native")
      ) ? "none" : element.css.display || "block",
      visibility,
      opacity: element.css.opacity || "1",
    };
  }

  vm.runInNewContext(SOURCE, {
    document, location, getComputedStyle,
    window: {
      addEventListener(type, listener) {
        const listeners = windowListeners.get(type) || [];
        listeners.push(listener);
        windowListeners.set(type, listeners);
      },
    },
    MutationObserver: Observer,
    KeyboardEvent: class { constructor(type) { this.type = type; } },
    Date: { now: () => now },
    setTimeout: (callback, delay) => schedule(callback, delay),
    clearTimeout: (id) => timers.delete(id),
    setInterval: (callback, interval) => schedule(callback, interval, interval),
    clearInterval: (id) => timers.delete(id),
  });

  function settle() {
    for (let index = 0; index < 4; index++) {
      flushMutations();
      tick(200);
    }
    flushMutations();
  }
  settle();
  return {
    document, location, player, toolbar, controls, nativeButton, observers, timers, documentListeners,
    createControls, createNative, settle, tick, flushMutations,
    custom: () => document.getElementById(CUSTOM_ID),
    tooltip: () => document.getElementById(TOOLTIP_ID),
    dispatchDocument(type, extra = {}) {
      documentListeners.get(type)?.forEach((listener) => listener({ type, ...extra }));
    },
    dispatch(type) { windowListeners.get(type)?.forEach((listener) => listener({ type })); },
  };
}

test("keeps an initially available native miniplayer without adding a duplicate", () => {
  const harness = createHarness();
  assert.equal(harness.custom(), null);
  assert.equal(harness.nativeButton.isConnected, true);
  assert.equal(harness.timers.size, 0);
});

test("restores a missing control once and preserves the native shortcut fallback", () => {
  const harness = createHarness({ native: false });
  const button = harness.custom();
  assert.ok(button);
  assert.equal(button.parentElement, harness.controls);
  button.click();
  assert.deepEqual(harness.player.keyEvents, ["keydown", "keyup"]);
  harness.dispatch("yt-page-data-updated");
  harness.settle();
  assert.equal(harness.custom(), button);
  assert.equal(harness.timers.size, 0);
});

test("reconciles native controls appearing and disappearing after custom installation", () => {
  const harness = createHarness({ native: false });
  const native = harness.createNative(harness.controls);
  harness.settle();
  assert.equal(harness.custom(), null);
  native.remove();
  harness.settle();
  assert.ok(harness.custom());
  assert.equal(harness.timers.size, 0);
});

test("reconciles native disabled and aria-disabled changes without leaving duplicates", () => {
  for (const attribute of ["disabled", "aria-disabled"]) {
    const harness = createHarness();
    harness.nativeButton.setAttribute(attribute, attribute === "disabled" ? "" : "true");
    harness.settle();
    assert.ok(harness.custom(), attribute);
    harness.custom().click();
    assert.equal(harness.nativeButton.clicks, 0);
    assert.deepEqual(harness.player.keyEvents, ["keydown", "keyup"]);
    harness.nativeButton.removeAttribute(attribute);
    harness.settle();
    assert.equal(harness.custom(), null, attribute);
  }
});

test("reconciles native hidden, aria-hidden and display/visibility/opacity styling", () => {
  for (const [hide, show] of [
    [(button) => { button.hidden = true; }, (button) => { button.hidden = false; }],
    [(button) => button.setAttribute("aria-hidden", "true"), (button) => button.removeAttribute("aria-hidden")],
    [(button) => button.setCss({ display: "none" }), (button) => button.setCss({ display: "block" })],
    [(button) => button.setCss({ visibility: "hidden" }), (button) => button.setCss({ visibility: "visible" })],
    [(button) => button.setCss({ opacity: "0" }), (button) => button.setCss({ opacity: "1" })],
  ]) {
    const harness = createHarness();
    hide(harness.nativeButton);
    harness.settle();
    assert.ok(harness.custom());
    // A hidden but enabled native button remains the preferred action backend.
    harness.custom().click();
    assert.equal(harness.nativeButton.clicks, 1);
    show(harness.nativeButton);
    harness.settle();
    assert.equal(harness.custom(), null);
  }
});

test("whole-toolbar auto-hide never substitutes a custom control for native", () => {
  const harness = createHarness();
  for (const target of [harness.controls, harness.toolbar]) {
    for (const css of [
      { opacity: "0" },
      { visibility: "hidden" },
      { display: "none" },
    ]) {
      target.setCss(css);
      harness.settle();
      assert.equal(harness.custom(), null);
      target.setCss({ opacity: "1", visibility: "visible", display: "block" });
      harness.settle();
      assert.equal(harness.custom(), null);
    }
    target.hidden = true;
    target.setAttribute("aria-hidden", "true");
    harness.settle();
    assert.equal(harness.custom(), null);
    target.hidden = false;
    target.removeAttribute("aria-hidden");
    harness.settle();
    assert.equal(harness.custom(), null);
  }
});

test("native wrapper visibility is reconciled separately from whole-toolbar hiding", () => {
  const harness = createHarness();
  const wrapper = harness.controls.appendChild(harness.document.createElement("div"));
  wrapper.appendChild(harness.nativeButton);
  harness.settle();
  assert.equal(harness.custom(), null);
  wrapper.setCss({ display: "none" });
  harness.settle();
  assert.ok(harness.custom());
  wrapper.setCss({ display: "block" });
  harness.settle();
  assert.equal(harness.custom(), null);
  wrapper.setCss({ opacity: "0" });
  harness.settle();
  assert.ok(harness.custom());
  wrapper.setCss({ opacity: "1" });
  harness.settle();
  assert.equal(harness.custom(), null);
});

test("player state classes can hide native controls without observing player descendants", () => {
  const harness = createHarness();
  harness.player.className += " hide-native";
  harness.settle();
  assert.ok(harness.custom());
  harness.player.className = "html5-video-player";
  harness.settle();
  assert.equal(harness.custom(), null);
  const registrations = harness.observers.flatMap((observer) => [...observer.registrations]);
  assert.ok(registrations.some(([target, options]) => target === harness.controls && options.subtree));
  assert.ok(registrations.filter(([target]) => target === harness.player).every(([, options]) => !options.subtree));
  assert.ok(registrations.filter(([target]) => target === harness.document.documentElement).every(([, options]) => !options.attributes));
});

test("replaced controls adopt native availability and release old observer targets", () => {
  for (const withNative of [false, true]) {
    const harness = createHarness({ native: false });
    const oldControls = harness.controls;
    oldControls.remove();
    const replacement = harness.createControls({ withNative });
    harness.settle();
    if (withNative) assert.equal(harness.custom(), null);
    else assert.equal(harness.custom()?.parentElement, replacement);
    assert.ok(harness.observers.every((observer) => !observer.registrations.has(oldControls)));
    assert.equal(harness.timers.size, 0);
  }
});

test("removed custom controls reinstall without creating a second custom button", () => {
  const harness = createHarness({ native: false });
  harness.custom().remove();
  harness.settle();
  assert.equal(harness.controls.querySelectorAll(`#${CUSTOM_ID}`).length, 1);
});

test("route exit clears pending reconciliation, observers and the custom button", () => {
  const harness = createHarness({ native: false });
  harness.createNative(harness.controls);
  harness.flushMutations();
  assert.ok(harness.timers.size);
  harness.location.pathname = "/";
  harness.dispatch("yt-navigate-finish");
  harness.settle();
  assert.equal(harness.custom(), null);
  assert.equal(harness.timers.size, 0);
  assert.ok(harness.observers.every((observer) => observer.registrations.size === 0));
});

test("page suspension clears work and pageshow recovers replaced controls", () => {
  const harness = createHarness({ native: false });
  harness.dispatch("pagehide");
  assert.equal(harness.timers.size, 0);
  assert.ok(harness.observers.every((observer) => observer.registrations.size === 0));
  harness.controls.remove();
  const replacement = harness.createControls();
  harness.dispatch("pageshow");
  harness.settle();
  assert.equal(harness.custom()?.parentElement, replacement);
  assert.equal(harness.timers.size, 0);
});

test("navigation retries consume pending reconciliation before page suspension", () => {
  const harness = createHarness({ native: false });
  harness.dispatch("yt-page-data-updated");
  harness.tick(250);
  harness.createNative(harness.controls);
  harness.flushMutations();
  harness.tick(50);
  assert.equal(harness.custom(), null);
  harness.dispatch("pagehide");
  assert.equal(harness.timers.size, 0);
  harness.tick(1000);
  assert.ok(harness.observers.every((observer) => observer.registrations.size === 0));
});

test("standalone MutationObserver registrations also reconcile native availability", () => {
  const harness = createHarness({ atomicObserver: false });
  harness.nativeButton.hidden = true;
  harness.settle();
  assert.ok(harness.custom());
  harness.nativeButton.hidden = false;
  harness.settle();
  assert.equal(harness.custom(), null);
});

test("initial controls discovery remains bounded and recovers controls arriving later", () => {
  const harness = createHarness({ withControls: false });
  harness.tick(21000);
  assert.equal(harness.timers.size, 0);
  const controls = harness.createControls();
  harness.settle();
  assert.equal(harness.custom()?.parentElement, controls);
  assert.equal(harness.timers.size, 0);
});

test("miniplayer tooltip opens for hover and keyboard focus, not pointer or programmatic focus", () => {
  const harness = createHarness({ native: false });
  const button = harness.custom();
  button.focus();
  assert.equal(harness.tooltip(), null);
  button.emit("mouseenter");
  assert.ok(harness.tooltip());
  assert.equal(button.getAttribute("aria-describedby"), TOOLTIP_ID);
  button.emit("mouseleave");
  assert.equal(harness.tooltip(), null);
  assert.equal(button.getAttribute("aria-describedby"), null);
  button.focus({ visible: true });
  assert.ok(harness.tooltip());
  button.emit("blur");
  assert.equal(harness.tooltip(), null);
});

test("miniplayer tooltip is dismissed on activation, cancellation, Escape and document suspension", () => {
  for (const dismiss of [
    (harness, button) => harness.dispatchDocument("pointerdown", { target: button }),
    (harness, button) => harness.dispatchDocument("pointercancel", { target: button }),
    (harness) => harness.dispatchDocument("scroll"),
    (harness, button) => button.click(),
    (harness) => harness.dispatchDocument("keydown", { key: "Escape" }),
    (harness) => {
      harness.document.visibilityState = "hidden";
      harness.dispatchDocument("visibilitychange");
    },
    (harness) => harness.dispatch("blur"),
    (harness) => harness.dispatch("pagehide"),
    (harness) => harness.dispatch("yt-navigate-start"),
  ]) {
    const harness = createHarness({ native: false });
    const button = harness.custom();
    button.emit("mouseenter");
    assert.ok(harness.tooltip());
    dismiss(harness, button);
    assert.equal(harness.tooltip(), null);
    assert.equal(button.getAttribute("aria-describedby"), null);
  }
});

test("miniplayer tooltip is removed when controls hide and does not return when they reappear", () => {
  for (const hide of [
    (harness) => { harness.player.className += " ytp-autohide"; },
    (harness) => harness.toolbar.setCss({ opacity: "0" }),
    (harness) => harness.controls.setCss({ visibility: "hidden" }),
    (harness) => harness.controls.setCss({ display: "none" }),
    (harness) => { harness.controls.hidden = true; },
    (harness) => harness.controls.setAttribute("aria-hidden", "true"),
    (harness) => { harness.custom().disabled = true; },
  ]) {
    const harness = createHarness({ native: false });
    harness.custom().emit("mouseenter");
    assert.ok(harness.tooltip());
    hide(harness);
    harness.settle();
    assert.equal(harness.tooltip(), null);
    harness.player.className = "html5-video-player";
    harness.toolbar.setCss({ opacity: "1" });
    harness.controls.setCss({ display: "block", visibility: "visible" });
    harness.controls.hidden = false;
    harness.controls.removeAttribute("aria-hidden");
    harness.custom().disabled = false;
    harness.settle();
    assert.equal(harness.tooltip(), null);
    assert.equal(harness.timers.size, 0);
  }
});

test("miniplayer tooltip releases detached and moved owners without adding observers", () => {
  for (const detach of [
    (harness) => harness.custom().remove(),
    (harness) => harness.controls.remove(),
    (harness) => harness.document.body.appendChild(harness.player),
  ]) {
    const harness = createHarness({ native: false });
    const observerCount = harness.observers.length;
    const button = harness.custom();
    button.emit("mouseenter");
    assert.ok(harness.tooltip());
    detach(harness);
    harness.flushMutations();
    assert.equal(harness.tooltip(), null);
    assert.equal(button.getAttribute("aria-describedby"), null);
    assert.equal(harness.observers.length, observerCount);
  }
});

test("miniplayer tooltip catches missed mouseleave and releases its transient listeners", () => {
  const harness = createHarness({ native: false });
  const button = harness.custom();
  const transientEvents = ["pointermove", "pointerdown", "pointercancel", "scroll", "visibilitychange"];
  for (let index = 0; index < 3; index++) {
    button.emit("mouseenter");
    assert.ok(harness.tooltip());
    for (const type of transientEvents) {
      assert.equal(harness.documentListeners.get(type).length, 1, type);
    }
    harness.dispatchDocument("pointermove", { target: button.children[0] });
    assert.ok(harness.tooltip(), "moving over the icon retains its tooltip");
    harness.dispatchDocument("pointermove", { target: harness.player });
    assert.equal(harness.tooltip(), null);
    for (const type of transientEvents) {
      assert.equal(harness.documentListeners.get(type).length, 0, type);
    }
  }
});

test("resize repositions an existing miniplayer tooltip while genuinely hovered or keyboard focused", () => {
  for (const engage of [
    (button) => button.emit("mouseenter"),
    (button) => button.focus({ visible: true }),
  ]) {
    const harness = createHarness({ native: false });
    const button = harness.custom();
    engage(button);
    const tooltip = harness.tooltip();
    assert.ok(tooltip);
    const initialLeft = tooltip.style.left;
    button.bounds = { left: 750, top: 490, right: 798, bottom: 538, width: 48, height: 48 };
    harness.dispatch("resize");
    assert.equal(harness.tooltip(), tooltip, "resize retains the existing tooltip node");
    assert.notEqual(tooltip.style.left, initialLeft, "tooltip follows its moved owner");
  }
});

test("resize dismisses the miniplayer tooltip after missed mouseleave despite pointer focus", () => {
  const harness = createHarness({ native: false });
  const button = harness.custom();
  button.focus();
  button.emit("mouseenter");
  assert.ok(harness.tooltip());
  button.hovered = false;
  harness.dispatch("resize");
  assert.equal(harness.tooltip(), null);
  assert.equal(button.getAttribute("aria-describedby"), null);
});

test("resize never opens or revives a dismissed miniplayer tooltip", () => {
  const harness = createHarness({ native: false });
  const button = harness.custom();
  harness.dispatch("resize");
  assert.equal(harness.tooltip(), null);
  button.emit("mouseenter");
  harness.dispatchDocument("keydown", { key: "Escape" });
  assert.equal(button.matches(":hover"), true);
  harness.dispatch("resize");
  assert.equal(harness.tooltip(), null, "a hovered but dismissed tooltip stays closed");
  button.focus({ visible: true });
  harness.dispatchDocument("keydown", { key: "Escape" });
  harness.dispatch("resize");
  assert.equal(harness.tooltip(), null, "a keyboard-focused but dismissed tooltip stays closed");
});

test("resize retains hidden and disabled owner checks before repositioning miniplayer tooltip", () => {
  for (const suppress of [
    (harness) => { harness.custom().disabled = true; },
    (harness) => { harness.player.className += " ytp-autohide"; },
    (harness) => harness.toolbar.setCss({ opacity: "0" }),
  ]) {
    const harness = createHarness({ native: false });
    harness.custom().emit("mouseenter");
    assert.ok(harness.tooltip());
    suppress(harness);
    harness.dispatch("resize");
    assert.equal(harness.tooltip(), null);
  }
});
