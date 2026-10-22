import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
const PAGE_COHERENCE_SOURCE = readFileSync(
  new URL("../sources/modules/youtube-page-coherence.user.js", import.meta.url),
  "utf8",
);
const COMMENT_CLEANER_SOURCE = readFileSync(
  new URL("../sources/modules/youtube-comment-cleaner.user.js", import.meta.url),
  "utf8",
);

const VIDEO_A = "aaaaaaaaaaa";
const VIDEO_B = "bbbbbbbbbbb";
const VIDEO_C = "ccccccccccc";

class FakeClock {
  #now = 0;
  #nextId = 1;
  #timers = new Map();

  get now() { return this.#now; }

  setTimeout = (callback, delay = 0) => {
    const id = this.#nextId++;
    this.#timers.set(id, {
      callback,
      due: this.#now + Math.max(0, Number(delay) || 0),
      order: id,
    });
    return id;
  };

  clearTimeout = (id) => {
    this.#timers.delete(id);
  };

  requestAnimationFrame = (callback) =>
    this.setTimeout(() => callback(this.#now), 16);

  cancelAnimationFrame = (id) => {
    this.clearTimeout(id);
  };

  tick(milliseconds) {
    const target = this.#now + milliseconds;
    for (;;) {
      const next = [...this.#timers.entries()]
        .filter(([, timer]) => timer.due <= target)
        .sort(
          ([, left], [, right]) =>
            left.due - right.due || left.order - right.order,
        )[0];
      if (!next) break;

      const [id, timer] = next;
      this.#timers.delete(id);
      this.#now = timer.due;
      timer.callback();
    }
    this.#now = target;
  }

  get pendingCount() {
    return this.#timers.size;
  }
}

class FakeEventTarget {
  #listeners = new Map();

  addEventListener(type, listener, options = {}) {
    const listeners = this.#listeners.get(type) || [];
    listeners.push({ listener, once: Boolean(options?.once) });
    this.#listeners.set(type, listeners);
  }

  removeEventListener(type, listener) {
    this.#listeners.set(
      type,
      (this.#listeners.get(type) || []).filter(
        (entry) => entry.listener !== listener,
      ),
    );
  }

  dispatchEvent(event) {
    event.target ??= this;
    const listeners = [...(this.#listeners.get(event.type) || [])];
    for (const entry of listeners) {
      if (typeof entry.listener === "function") {
        entry.listener.call(this, event);
      } else {
        entry.listener?.handleEvent?.(event);
      }
      if (entry.once) this.removeEventListener(event.type, entry.listener);
    }
    return true;
  }
}

class FakeStyle {
  #properties = new Map();

  setProperty(name, value) {
    this.#properties.set(name, String(value));
  }

  removeProperty(name) {
    const previous = this.#properties.get(name) || "";
    this.#properties.delete(name);
    return previous;
  }

  getPropertyValue(name) {
    return this.#properties.get(name) || "";
  }
}

function splitSelectorList(selector) {
  const selectors = [];
  let current = "";
  let quote = "";
  let brackets = 0;
  let parentheses = 0;
  for (const character of String(selector)) {
    if (quote) {
      current += character;
      if (character === quote) quote = "";
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      current += character;
      continue;
    }
    if (character === "[") brackets += 1;
    if (character === "]") brackets -= 1;
    if (character === "(") parentheses += 1;
    if (character === ")") parentheses -= 1;
    if (character === "," && brackets === 0 && parentheses === 0) {
      selectors.push(current.trim());
      current = "";
    } else {
      current += character;
    }
  }
  if (current.trim()) selectors.push(current.trim());
  return selectors;
}

function lastCompoundSelector(selector) {
  let quote = "";
  let brackets = 0;
  let parentheses = 0;
  let lastBoundary = -1;
  for (let index = 0; index < selector.length; index += 1) {
    const character = selector[index];
    if (quote) {
      if (character === quote) quote = "";
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      continue;
    }
    if (character === "[") brackets += 1;
    else if (character === "]") brackets -= 1;
    else if (character === "(") parentheses += 1;
    else if (character === ")") parentheses -= 1;
    else if (
      brackets === 0 &&
      parentheses === 0 &&
      (character === ">" || character === "+" || character === "~" || /\s/.test(character))
    ) {
      lastBoundary = index;
    }
  }
  return selector.slice(lastBoundary + 1).trim().replace(/^:scope$/, "*");
}

function matchesCompound(element, compound) {
  if (!compound || compound === "*") return true;
  if (compound.includes(":has(")) return false;
  compound = compound.replace(/:scope/g, "").replace(/:not\([^)]*\)/g, "");

  const tag = compound.match(/^[A-Za-z][\w-]*/)?.[0];
  if (tag && element.localName !== tag.toLowerCase()) return false;

  for (const [, id] of compound.matchAll(/#([\w-]+)/g)) {
    if (element.id !== id) return false;
  }
  for (const [, className] of compound.matchAll(/\.([\w-]+)/g)) {
    if (!element.classList.contains(className)) return false;
  }
  for (const match of compound.matchAll(
    /\[([^\]\s~|^$*!=]+)(?:\s*([*^$]?=)\s*["']?([^"'\]\s]*?)["']?\s*(i)?\s*)?\]/g,
  )) {
    const [, name, operator, expected = "", insensitive] = match;
    if (!element.hasAttribute(name)) return false;
    if (!operator) continue;
    let actual = element.getAttribute(name) || "";
    let wanted = expected;
    if (insensitive) {
      actual = actual.toLowerCase();
      wanted = wanted.toLowerCase();
    }
    if (operator === "=" && actual !== wanted) return false;
    if (operator === "*=" && !actual.includes(wanted)) return false;
    if (operator === "^=" && !actual.startsWith(wanted)) return false;
    if (operator === "$=" && !actual.endsWith(wanted)) return false;
  }
  return true;
}

class FakeElement extends FakeEventTarget {
  constructor(localName, attributes = {}) {
    super();
    this.nodeType = 1;
    this.localName = localName.toLowerCase();
    this.tagName = this.localName.toUpperCase();
    this.parentElement = null;
    this.children = [];
    this.childNodes = this.children;
    this.attributes = new Map();
    this.style = new FakeStyle();
    this.dataset = {};
    this.data = undefined;
    this.textContent = "";
    this.hidden = false;
    this.disabled = false;
    this.isConnected = false;
    this.shadowRoot = null;
    this.rect = { top: 0, bottom: 100, left: 0, right: 100, width: 100, height: 100 };
    this.classList = {
      contains: (name) =>
        (this.getAttribute("class") || "").split(/\s+/).includes(name),
      add: (...names) => {
        const next = new Set((this.getAttribute("class") || "").split(/\s+/).filter(Boolean));
        names.forEach((name) => next.add(name));
        this.setAttribute("class", [...next].join(" "));
      },
      remove: (...names) => {
        const removed = new Set(names);
        const next = (this.getAttribute("class") || "")
          .split(/\s+/)
          .filter((name) => name && !removed.has(name));
        this.setAttribute("class", next.join(" "));
      },
    };
    for (const [name, value] of Object.entries(attributes)) {
      this.setAttribute(name, value);
    }
  }

  get id() {
    return this.getAttribute("id") || "";
  }

  set id(value) {
    this.setAttribute("id", value);
  }

  get href() {
    return this.getAttribute("href") || "";
  }

  set href(value) {
    this.setAttribute("href", value);
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
    if (name === "hidden") this.hidden = true;
  }

  getAttribute(name) {
    return this.attributes.get(name) ?? null;
  }

  hasAttribute(name) {
    return this.attributes.has(name);
  }

  removeAttribute(name) {
    this.attributes.delete(name);
    if (name === "hidden") this.hidden = false;
  }

  toggleAttribute(name, force) {
    const enable = force === undefined ? !this.hasAttribute(name) : Boolean(force);
    if (enable) this.setAttribute(name, "");
    else this.removeAttribute(name);
    return enable;
  }

  appendChild(child) {
    child.remove?.();
    child.parentElement = this;
    this.children.push(child);
    child.#setConnected(this.isConnected);
    return child;
  }

  insertBefore(child, reference) {
    child.remove?.();
    const index = reference ? this.children.indexOf(reference) : -1;
    child.parentElement = this;
    if (index >= 0) this.children.splice(index, 0, child);
    else this.children.push(child);
    child.#setConnected(this.isConnected);
    return child;
  }

  remove() {
    if (this.parentElement) {
      const index = this.parentElement.children.indexOf(this);
      if (index >= 0) this.parentElement.children.splice(index, 1);
    }
    this.parentElement = null;
    this.#setConnected(false);
  }

  #setConnected(connected) {
    this.isConnected = connected;
    this.children.forEach((child) => child.#setConnected(connected));
  }

  connectTree() {
    this.#setConnected(true);
  }

  contains(candidate) {
    for (let current = candidate; current; current = current.parentElement) {
      if (current === this) return true;
    }
    return false;
  }

  matches(selector) {
    return splitSelectorList(selector).some((part) =>
      matchesCompound(this, lastCompoundSelector(part)),
    );
  }

  closest(selector) {
    for (let current = this; current; current = current.parentElement) {
      if (current.matches(selector)) return current;
    }
    return null;
  }

  querySelectorAll(selector) {
    const matches = [];
    const visit = (node) => {
      for (const child of node.children) {
        if (child.matches(selector)) matches.push(child);
        visit(child);
      }
    };
    visit(this);
    return matches;
  }

  querySelector(selector) {
    return this.querySelectorAll(selector)[0] || null;
  }

  getBoundingClientRect() {
    return { ...this.rect };
  }

  getRootNode() {
    let current = this;
    while (current.parentElement) current = current.parentElement;
    return current;
  }
}

class FakeDocument extends FakeEventTarget {
  constructor() {
    super();
    this.nodeType = 9;
    this.documentElement = new FakeElement("html");
    this.head = new FakeElement("head");
    this.body = new FakeElement("body");
    this.documentElement.appendChild(this.head);
    this.documentElement.appendChild(this.body);
    this.documentElement.connectTree();
    this.visibilityState = "visible";
    this.readyState = "complete";
  }

  querySelectorAll(selector) {
    const matches = [];
    if (this.documentElement.matches(selector)) matches.push(this.documentElement);
    return matches.concat(this.documentElement.querySelectorAll(selector));
  }

  querySelector(selector) {
    return this.querySelectorAll(selector)[0] || null;
  }

  getElementById(id) {
    return this.querySelector(`#${id}`);
  }

  createElement(localName) {
    return new FakeElement(localName);
  }
}

function createLocation(initialUrl) {
  let current = new URL(initialUrl);
  return {
    get href() {
      return current.href;
    },
    set href(value) {
      current = new URL(value, current.origin);
    },
    get origin() {
      return current.origin;
    },
    get pathname() {
      return current.pathname;
    },
    get search() {
      return current.search;
    },
    setUrl(value) {
      current = new URL(value, current.origin);
    },
  };
}

function createHarness(source, initialUrl = "https://www.youtube.com/") {
  const clock = new FakeClock();
  const windowTarget = new FakeEventTarget();
  const document = new FakeDocument();
  const location = createLocation(initialUrl);
  const mutationObservers = [];

  class FakeMutationObserver {
    constructor(callback) {
      this.callback = callback;
      this.active = false;
      this.registrations = [];
      mutationObservers.push(this);
    }

    observe(target, options) {
      this.active = true;
      this.registrations.push([target, options]);
    }

    disconnect() {
      this.active = false;
      this.registrations = [];
    }

    takeRecords() {
      return [];
    }
  }

  const context = vm.createContext({
    console: { log() {}, warn() {}, error() {}, table() {} },
    document,
    location,
    window: windowTarget,
    MutationObserver: FakeMutationObserver,
    Node: Object.freeze({
      ELEMENT_NODE: 1,
      TEXT_NODE: 3,
      COMMENT_NODE: 8,
      DOCUMENT_NODE: 9,
    }),
    Event: class {
      constructor(type) {
        this.type = type;
        this.target = null;
      }
    },
    URL,
    URLSearchParams,
    Date: class extends Date {
      static now() { return clock.now; }
    },
    setTimeout: clock.setTimeout,
    clearTimeout: clock.clearTimeout,
    requestAnimationFrame: clock.requestAnimationFrame,
    cancelAnimationFrame: clock.cancelAnimationFrame,
    GM_addStyle() {},
    getComputedStyle(element) {
      return {
        display: element.hidden ? "none" : element.style.getPropertyValue("display") || "block",
        visibility: element.style.getPropertyValue("visibility") || "visible",
        opacity: element.style.getPropertyValue("opacity") || "1",
        pointerEvents: element.style.getPropertyValue("pointer-events") || "auto",
      };
    },
  });
  vm.runInContext(source, context, { filename: "canonical-userscript.user.js" });

  return {
    clock,
    context,
    document,
    location,
    dispatchWindow(type) {
      windowTarget.dispatchEvent({ type, target: windowTarget });
    },
    dispatchDocument(type, target = document) {
      document.dispatchEvent({ type, target });
    },
    emitMutations(mutations) {
      for (const observer of mutationObservers) {
        if (observer.active) observer.callback(mutations, observer);
      }
    },
  };
}

function createWatchDom(harness, videoId = VIDEO_A) {
  const flexy = new FakeElement("ytd-watch-flexy", { "video-id": videoId });
  flexy.data = { playerResponse: { videoDetails: { videoId } } };
  const player = new FakeElement("div", { id: "movie_player" });
  player.videoId = videoId;
  player.title = `Video ${videoId}`;
  player.getVideoData = () => ({ video_id: player.videoId, title: player.title });
  const video = new FakeElement("video", { class: "html5-main-video" });
  const metadataHeading = new FakeElement("h1");
  const metadataTitle = new FakeElement("yt-formatted-string");
  metadataTitle.textContent = player.title;
  metadataHeading.appendChild(metadataTitle);
  const metadata = new FakeElement("ytd-watch-metadata");
  metadata.appendChild(metadataHeading);
  player.appendChild(video);
  flexy.appendChild(player);
  flexy.appendChild(metadata);
  harness.document.body.appendChild(flexy);

  return {
    flexy,
    metadataTitle,
    player,
    video,
    setIdentity(nextVideoId) {
      player.videoId = nextVideoId;
      player.title = `Video ${nextVideoId}`;
      metadataTitle.textContent = player.title;
    },
    setFlexyIdentity(nextVideoId) {
      flexy.setAttribute("video-id", nextVideoId);
      flexy.data = { playerResponse: { videoDetails: { videoId: nextVideoId } } };
    },
  };
}

function readJsonAttribute(element, name) {
  const value = element.getAttribute(name);
  return value ? JSON.parse(value) : null;
}

function setWatchUrl(harness, videoId) {
  harness.location.setUrl(`https://www.youtube.com/watch?v=${videoId}`);
}

function createCommentsContainer({ permalinkVideoId = "", rendererCount = 1 } = {}) {
  const comments = new FakeElement("ytd-comments");
  const renderers = [];
  for (let index = 0; index < rendererCount; index += 1) {
    const renderer = new FakeElement("ytd-comment-thread-renderer");
    if (permalinkVideoId) {
      const publishedTime = new FakeElement("span", {
        id: "published-time-text",
      });
      publishedTime.appendChild(
        new FakeElement("a", {
          href: `https://www.youtube.com/watch?v=${permalinkVideoId}&lc=comment-${index}`,
        }),
      );
      renderer.appendChild(publishedTime);
    }
    comments.appendChild(renderer);
    renderers.push(renderer);
  }
  return { comments, renderers };
}

function initialiseCommentCleanerWatch() {
  const harness = createHarness(COMMENT_CLEANER_SOURCE);
  const watch = createWatchDom(harness, VIDEO_A);
  setWatchUrl(harness, VIDEO_A);
  harness.dispatchWindow("pageshow");
  harness.clock.tick(20);
  return { harness, watch };
}

function createStalledHomeNavigation({ finishNavigation = true } = {}) {
  const harness = createHarness(PAGE_COHERENCE_SOURCE);
  const watch = createWatchDom(harness, VIDEO_A);
  const app = new FakeElement("ytd-app");
  harness.document.body.appendChild(app);
  harness.dispatchWindow("yt-navigate-start");
  setWatchUrl(harness, VIDEO_B);
  watch.setIdentity(VIDEO_B);
  const response = {
    currentVideoEndpoint: { watchEndpoint: { videoId: VIDEO_B } },
    contents: { twoColumnWatchNextResults: {} },
  };
  app.data = { page: "watch", url: `/watch?v=${VIDEO_B}`, response };
  watch.flexy.data = response;
  watch.flexy.loading = true;
  watch.flexy.videoId = VIDEO_B;
  let attempts = 0;
  watch.flexy.updatePageData_ = function (value) {
    assert.equal(this, watch.flexy);
    assert.equal(value, response);
    attempts++;
    this.loading = false;
  };
  if (finishNavigation) harness.dispatchWindow("yt-navigate-finish");
  return { harness, watch, app, response, attempts: () => attempts };
}

function createStalledQueueControllerNavigation(options) {
  const fixture = createStalledHomeNavigation(options);
  const { watch, response } = fixture;
  watch.flexy.loading = false;
  watch.flexy.watchController = {
    watchNextResponse: {
      currentVideoEndpoint: { watchEndpoint: { videoId: VIDEO_A } },
    },
  };
  watch.metadataTitle.textContent = `Video ${VIDEO_A}`;
  let attempts = 0;
  watch.flexy.updatePageData_ = function (value) {
    assert.equal(this, watch.flexy);
    assert.equal(value, response);
    attempts++;
    this.watchController.watchNextResponse = value;
    watch.metadataTitle.textContent = watch.player.title;
  };
  return { ...fixture, attempts: () => attempts };
}

function createStalledCommentsNavigation({ finishNavigation = true } = {}) {
  const fixture = createStalledHomeNavigation({ finishNavigation: false });
  const { harness, watch, response } = fixture;
  const retainedComments = createCommentsContainer({ permalinkVideoId: VIDEO_A });
  watch.flexy.appendChild(retainedComments.comments);
  watch.flexy.loading = false;
  watch.flexy.setAttribute("video-id", VIDEO_B);
  watch.flexy.watchController = { watchNextResponse: response };
  let attempts = 0;
  watch.flexy.updatePageData_ = function (value) {
    assert.equal(this, watch.flexy);
    assert.equal(value, response, "recovery must use the exact already accepted response");
    attempts++;
    retainedComments.comments.remove();
    watch.flexy.appendChild(createCommentsContainer({ permalinkVideoId: VIDEO_B }).comments);
  };
  if (finishNavigation) harness.dispatchWindow("yt-navigate-finish");
  return { ...fixture, retainedComments, attempts: () => attempts };
}

test("Page Coherence completes an accepted Home-to-watch response once after grace", () => {
  const { harness, watch, attempts } = createStalledHomeNavigation();
  harness.clock.tick(3199);
  assert.equal(attempts(), 0);
  harness.clock.tick(1);
  assert.equal(attempts(), 1);
  assert.equal(watch.flexy.loading, false);
  // The native attribute can lag even after native properties are current.
  assert.equal(watch.flexy.getAttribute("video-id"), VIDEO_A);
  const state = harness.context.__YT_MASTER_STATE__.snapshot();
  assert.equal(state.confirmedCoherent, true);
  assert.equal(state.loadingRecoveryStatus, "completed");
  watch.flexy.loading = true;
  for (let i = 0; i < 10; i++) harness.context.__YT_MASTER_STATE__.check();
  harness.clock.tick(60000);
  assert.equal(attempts(), 1);
  assert.equal(harness.clock.pendingCount, 0);
});

test("Page Coherence completes a stale queue controller even when native loading is false", () => {
  const { harness, watch, attempts } = createStalledQueueControllerNavigation();
  harness.clock.tick(3199);
  assert.equal(attempts(), 0);
  const stalled = harness.context.__YT_MASTER_STATE__.snapshot();
  assert.equal(stalled.urlVideoId, VIDEO_B);
  assert.equal(stalled.playerVideoId, VIDEO_B);
  assert.equal(stalled.flexyVideoId, VIDEO_B);
  assert.equal(stalled.watchControllerVideoId, VIDEO_A);
  assert.equal(stalled.metadataTitle, `Video ${VIDEO_A}`);
  assert.equal(stalled.identityComparisons.urlController, false);
  assert.equal(stalled.identityComparisons.playerController, false);
  assert.equal(stalled.confirmedMismatch, true);
  assert.equal(stalled.confirmedCoherent, false);

  harness.clock.tick(1);
  assert.equal(attempts(), 1);
  assert.equal(watch.flexy.loading, false);
  const recovered = harness.context.__YT_MASTER_STATE__.snapshot();
  assert.equal(recovered.watchControllerVideoId, VIDEO_B);
  assert.equal(recovered.metadataTitle, watch.player.title);
  assert.equal(recovered.confirmedMismatch, false);
  assert.equal(recovered.confirmedCoherent, true);
  assert.equal(recovered.loadingRecoveryStatus, "completed");
  assert.equal(watch.flexy.getAttribute("video-id"), VIDEO_A);

  watch.flexy.watchController.watchNextResponse = {
    currentVideoEndpoint: { watchEndpoint: { videoId: VIDEO_A } },
  };
  for (let i = 0; i < 10; i++) harness.context.__YT_MASTER_STATE__.check();
  harness.clock.tick(60000);
  assert.equal(attempts(), 1, "a controller relapse cannot repeat native completion in one navigation");
  assert.equal(harness.clock.pendingCount, 0);
});

test("Page Coherence tolerates a current or unidentified controller with an old attribute and rewritten title", () => {
  const cases = [
    ["current", ({ watch, response }) => { watch.flexy.watchController.watchNextResponse = response; }],
    ["missing", ({ watch }) => { delete watch.flexy.watchController; }],
    ["unidentified", ({ watch }) => { watch.flexy.watchController.watchNextResponse = {}; }],
  ];
  for (const [name, configure] of cases) {
    const fixture = createStalledQueueControllerNavigation();
    configure(fixture);
    fixture.watch.metadataTitle.textContent = "A custom DeArrow title";
    fixture.harness.clock.tick(60000);
    assert.equal(fixture.attempts(), 0, name);
    const state = fixture.harness.context.__YT_MASTER_STATE__.snapshot();
    assert.equal(state.confirmedMismatch, false, name);
    assert.equal(state.confirmedCoherent, true, name);
    assert.equal(state.loadingRecoveryStatus, "not-attempted", name);
    assert.equal(fixture.watch.flexy.getAttribute("video-id"), VIDEO_A, name);
    assert.equal(fixture.watch.metadataTitle.textContent, "A custom DeArrow title", name);
    assert.equal(fixture.harness.clock.pendingCount, 0, name);
  }
});

test("Page Coherence completes an accepted response for positively stale comments with current title and controller", () => {
  const { harness, watch, retainedComments, attempts } = createStalledCommentsNavigation();
  harness.clock.tick(3199);
  assert.equal(attempts(), 0, "comments-only recovery must retain the ordinary grace period");
  const stalled = harness.context.__YT_MASTER_STATE__.snapshot();
  assert.equal(stalled.urlVideoId, VIDEO_B);
  assert.equal(stalled.playerVideoId, VIDEO_B);
  assert.equal(stalled.flexyVideoId, VIDEO_B);
  assert.equal(stalled.watchControllerVideoId, VIDEO_B);
  assert.equal(stalled.metadataTitle, watch.player.title);
  assert.equal(stalled.nativeLoading, false);
  assert.deepEqual(Array.from(stalled.commentVideoIds), [VIDEO_A]);

  harness.clock.tick(1);
  assert.equal(attempts(), 1, "positively old comment provenance must not depend on controller staleness");
  assert.equal(retainedComments.comments.isConnected, false);
  const recovered = harness.context.__YT_MASTER_STATE__.snapshot();
  assert.deepEqual(Array.from(recovered.commentVideoIds), [VIDEO_B]);
  assert.equal(recovered.loadingRecoveryStatus, "completed");
  assert.equal(watch.metadataTitle.textContent, watch.player.title);
  for (let index = 0; index < 10; index++) harness.context.__YT_MASTER_STATE__.check();
  harness.clock.tick(60000);
  assert.equal(attempts(), 1, "comments recovery remains one attempt per navigation");
  assert.equal(harness.clock.pendingCount, 0);
});

test("Page Coherence leaves current, mixed, absent and unidentified comment provenance alone", () => {
  const cases = [
    ["current comments", ({ retainedComments }) => {
      retainedComments.comments.querySelector('a[href*="lc="]').setAttribute(
        "href", `https://www.youtube.com/watch?v=${VIDEO_B}&lc=current`,
      );
    }],
    ["mixed current and old comments", ({ retainedComments }) => {
      retainedComments.comments.appendChild(
        createCommentsContainer({ permalinkVideoId: VIDEO_B }).renderers[0],
      );
    }],
    ["no comment permalinks", ({ retainedComments }) => {
      retainedComments.comments.querySelector('a[href*="lc="]').remove();
    }],
    ["no comment container", ({ retainedComments }) => { retainedComments.comments.remove(); }],
    ["comment body video link", ({ retainedComments }) => {
      const link = retainedComments.comments.querySelector('a[href*="lc="]');
      link.closest("#published-time-text").remove();
      retainedComments.renderers[0].appendChild(link);
    }],
    ["unidentified controller", ({ watch }) => { watch.flexy.watchController.watchNextResponse = {}; }],
    ["missing controller", ({ watch }) => { delete watch.flexy.watchController; }],
  ];
  for (const [name, configure] of cases) {
    const fixture = createStalledCommentsNavigation();
    configure(fixture);
    fixture.watch.metadataTitle.textContent = "A custom DeArrow title";
    fixture.harness.clock.tick(60000);
    assert.equal(fixture.attempts(), 0, name);
    assert.equal(fixture.watch.metadataTitle.textContent, "A custom DeArrow title", name);
    assert.equal(fixture.harness.context.__YT_MASTER_STATE__.snapshot().loadingRecoveryStatus, "not-attempted", name);
    assert.equal(fixture.harness.clock.pendingCount, 0, name);
  }
});

test("Page Coherence reads comment provenance only from the active watch component", () => {
  const { harness, watch, retainedComments, attempts } = createStalledCommentsNavigation();
  retainedComments.comments.querySelector('a[href*="lc="]').setAttribute(
    "href", `https://www.youtube.com/watch?v=${VIDEO_B}&lc=current`,
  );
  const inactiveWatch = createWatchDom(harness, VIDEO_A);
  inactiveWatch.flexy.hidden = true;
  inactiveWatch.flexy.appendChild(createCommentsContainer({ permalinkVideoId: VIDEO_A }).comments);
  watch.flexy.remove();
  harness.document.body.appendChild(watch.flexy);
  assert.equal(harness.document.querySelector("ytd-comments").closest("ytd-watch-flexy"), inactiveWatch.flexy);
  harness.clock.tick(60000);
  assert.equal(attempts(), 0, "inactive comments must not trigger completion on the active watch");
  const state = harness.context.__YT_MASTER_STATE__.snapshot();
  assert.equal(state.urlVideoId, VIDEO_B);
  assert.equal(state.playerVideoId, VIDEO_B);
  assert.deepEqual(Array.from(state.commentVideoIds), [VIDEO_B]);
  assert.equal(harness.clock.pendingCount, 0);
});

test("Page Coherence preserves accepted-response ownership and lifecycle guards for comments-only recovery", () => {
  const cases = [
    ["unaccepted response", ({ app }) => { app.data.response = { ...app.data.response }; }],
    ["wrong page", ({ app }) => { app.data.page = "browse"; }],
    ["stale response URL", ({ app }) => { app.data.url = `/watch?v=${VIDEO_A}`; }],
    ["wrong response identity", ({ response }) => { response.currentVideoEndpoint.watchEndpoint.videoId = VIDEO_A; }],
    ["missing watch contents", ({ response }) => { delete response.contents; }],
    ["wrong player identity", ({ watch }) => { watch.player.videoId = VIDEO_A; }],
    ["hidden flexy", ({ watch }) => { watch.flexy.hidden = true; }],
    ["missing native API", ({ watch }) => { delete watch.flexy.updatePageData_; }],
    ["hidden document", ({ harness }) => { harness.document.visibilityState = "hidden"; }],
    ["same-video in-flight navigation", ({ harness }) => { harness.dispatchWindow("yt-navigate-start"); }],
    ["suspended page", ({ harness }) => { harness.dispatchWindow("pagehide"); }],
    ["non-watch route", ({ harness }) => { harness.location.setUrl("https://www.youtube.com/"); }],
  ];
  for (const [name, configure] of cases) {
    const fixture = createStalledCommentsNavigation();
    configure(fixture);
    fixture.harness.clock.tick(60000);
    assert.equal(fixture.attempts(), 0, name);
    assert.equal(fixture.harness.clock.pendingCount, 0, name);
  }
});

test("Page Coherence gives comments-only recovery a bounded late-acceptance budget", () => {
  const { harness, app, response, attempts } = createStalledCommentsNavigation();
  app.data.response = { ...response };
  harness.clock.tick(4000);
  assert.equal(attempts(), 0);
  app.data.response = response;
  harness.clock.tick(60000);
  assert.equal(attempts(), 1, "later exact response acceptance must be rechecked within the existing bounded budget");
  assert.equal(harness.context.__YT_MASTER_STATE__.snapshot().loadingRecoveryStatus, "completed");
  assert.equal(harness.clock.pendingCount, 0);
});

test("Page Coherence cannot retry ineffective or throwing comments-only completion", () => {
  for (const [name, expectedStatus, complete] of [
    ["ineffective", "pending", () => {}],
    ["throwing", "failed", () => { throw new Error("changed native comments API"); }],
  ]) {
    const { harness, watch } = createStalledCommentsNavigation();
    let attempts = 0;
    watch.flexy.updatePageData_ = () => { attempts++; complete(); };
    harness.clock.tick(3200);
    assert.equal(attempts, 1, name);
    assert.equal(harness.context.__YT_MASTER_STATE__.snapshot().loadingRecoveryStatus, expectedStatus, name);
    for (let index = 0; index < 10; index++) harness.context.__YT_MASTER_STATE__.check();
    harness.clock.tick(60000);
    assert.equal(attempts, 1, `${name}: a stale permalink cannot re-arm completion in one navigation`);
    assert.equal(harness.clock.pendingCount, 0, name);
  }
});

test("Page Coherence observes delayed native comments completion without another replay or timer batch", () => {
  const { harness, watch, retainedComments, response } = createStalledCommentsNavigation();
  let attempts = 0;
  watch.flexy.updatePageData_ = function (value) {
    assert.equal(this, watch.flexy);
    assert.equal(value, response);
    attempts++;
    // Native WATCH_NEXT_RESPONSE_RELOADED schedules comment data one second later.
    harness.clock.setTimeout(() => {
      retainedComments.comments.remove();
      watch.flexy.appendChild(createCommentsContainer({ permalinkVideoId: VIDEO_B }).comments);
      harness.context.window.dispatchEvent({ type: "yt-watch-comments-ready", target: watch.flexy });
    }, 1000);
  };
  harness.clock.tick(3200);
  assert.equal(attempts, 1);
  assert.equal(harness.context.__YT_MASTER_STATE__.snapshot().loadingRecoveryStatus, "pending");
  harness.clock.tick(999);
  assert.equal(harness.context.__YT_MASTER_STATE__.snapshot().loadingRecoveryStatus, "pending");
  harness.clock.tick(1);
  const published = readJsonAttribute(harness.document.documentElement, "data-yt-master-state");
  assert.equal(published.loadingRecoveryStatus, "completed", "native readiness must reconcile the pending attempt");
  assert.deepEqual(Array.from(published.commentVideoIds), [VIDEO_B]);
  assert.equal(harness.clock.pendingCount, 0, "observing readiness must not allocate another timer batch");
  for (let index = 0; index < 5; index++) {
    harness.context.window.dispatchEvent({ type: "yt-watch-comments-ready", target: watch.flexy });
    harness.context.__YT_MASTER_STATE__.check();
  }
  harness.clock.tick(60000);
  assert.equal(attempts, 1);
  assert.equal(harness.clock.pendingCount, 0);
});

test("Page Coherence only observes ready comments from the rendered coherent active watch", () => {
  const cases = [
    ["hidden document", ({ harness }) => { harness.document.visibilityState = "hidden"; }],
    ["hidden watch", ({ watch }) => { watch.flexy.hidden = true; }],
    ["native loading", ({ watch }) => { watch.flexy.loading = true; }],
    ["wrong player", ({ watch }) => { watch.player.videoId = VIDEO_A; }],
    ["stale controller", ({ watch }) => {
      watch.flexy.watchController.watchNextResponse = {
        currentVideoEndpoint: { watchEndpoint: { videoId: VIDEO_A } },
      };
    }],
    ["mixed comment provenance", ({ freshComments }) => {
      freshComments.comments.appendChild(createCommentsContainer({ permalinkVideoId: VIDEO_A }).renderers[0]);
    }],
    ["missing current permalink", ({ freshComments }) => {
      freshComments.comments.querySelector('a[href*="lc="]').remove();
    }],
    ["inactive watch event", ({ harness }) => {
      const inactiveWatch = createWatchDom(harness, VIDEO_A);
      inactiveWatch.flexy.hidden = true;
      return inactiveWatch.flexy;
    }],
    ["window event", ({ harness }) => harness.context.window],
    ["suspended page", ({ harness }) => { harness.dispatchWindow("pagehide"); }],
  ];
  for (const [name, configure] of cases) {
    const fixture = createStalledCommentsNavigation();
    const { harness, watch, retainedComments } = fixture;
    let attempts = 0;
    watch.flexy.updatePageData_ = () => { attempts++; };
    harness.clock.tick(3200);
    assert.equal(attempts, 1, name);
    assert.equal(harness.context.__YT_MASTER_STATE__.snapshot().loadingRecoveryStatus, "pending", name);
    retainedComments.comments.remove();
    const freshComments = createCommentsContainer({ permalinkVideoId: VIDEO_B });
    watch.flexy.appendChild(freshComments.comments);
    const target = configure({ ...fixture, freshComments }) || watch.flexy;
    const statusBeforeReady = harness.context.__YT_MASTER_STATE__.snapshot().loadingRecoveryStatus;
    harness.context.window.dispatchEvent({ type: "yt-watch-comments-ready", target });
    assert.equal(harness.context.__YT_MASTER_STATE__.snapshot().loadingRecoveryStatus, statusBeforeReady, name);
    assert.equal(attempts, 1, `${name}: observing readiness cannot replay native completion`);
    assert.equal(harness.clock.pendingCount, 0, `${name}: observing readiness cannot allocate a timer batch`);
  }
});

test("Page Coherence permits comments-only recovery without navigate-finish only after current-video progress", () => {
  for (const progress of ["yt-page-data-updated", "loadedmetadata", "no progress evidence"]) {
    const { harness, watch, attempts } = createStalledCommentsNavigation({ finishNavigation: false });
    if (progress === "loadedmetadata") harness.dispatchDocument(progress, watch.video);
    else if (progress === "yt-page-data-updated") harness.dispatchWindow(progress);
    harness.clock.tick(60000);
    assert.equal(attempts(), progress === "no progress evidence" ? 0 : 1, progress);
    assert.equal(harness.clock.pendingCount, 0, progress);
  }
});

test("Page Coherence preserves response ownership and lifecycle guards for a stale completed queue controller", () => {
  const cases = [
    ["unaccepted response", ({ app }) => { app.data.response = { ...app.data.response }; }],
    ["wrong page", ({ app }) => { app.data.page = "browse"; }],
    ["stale response URL", ({ app }) => { app.data.url = `/watch?v=${VIDEO_A}`; }],
    ["wrong response identity", ({ response }) => { response.currentVideoEndpoint.watchEndpoint.videoId = VIDEO_A; }],
    ["missing watch contents", ({ response }) => { delete response.contents; }],
    ["wrong player identity", ({ watch }) => { watch.player.videoId = VIDEO_A; }],
    ["hidden flexy", ({ watch }) => { watch.flexy.hidden = true; }],
    ["missing native API", ({ watch }) => { delete watch.flexy.updatePageData_; }],
    ["hidden document", ({ harness }) => { harness.document.visibilityState = "hidden"; }],
    ["in-flight navigation", ({ harness }) => { harness.dispatchWindow("yt-navigate-start"); }],
    ["suspended page", ({ harness }) => { harness.dispatchWindow("pagehide"); }],
    ["non-watch route", ({ harness }) => { harness.location.setUrl("https://www.youtube.com/"); }],
  ];
  for (const [name, configure] of cases) {
    const fixture = createStalledQueueControllerNavigation();
    configure(fixture);
    fixture.harness.clock.tick(60000);
    assert.equal(fixture.attempts(), 0, name);
    assert.equal(fixture.harness.clock.pendingCount, 0, name);
  }
});

test("Page Coherence rechecks stale controller data accepted after the ordinary grace checks", () => {
  const { harness, watch, app, response, attempts } = createStalledQueueControllerNavigation();
  app.data.response = { ...response };
  harness.clock.tick(4000);
  assert.equal(attempts(), 0);
  assert.equal(harness.context.__YT_MASTER_STATE__.snapshot().watchControllerVideoId, VIDEO_A);

  // Acceptance can arrive without another navigation or identity-attribute event.
  app.data.response = response;
  harness.clock.tick(2599);
  assert.equal(attempts(), 0);
  harness.clock.tick(1);
  assert.equal(attempts(), 1);
  assert.equal(watch.flexy.watchController.watchNextResponse, response);
  assert.equal(harness.context.__YT_MASTER_STATE__.snapshot().loadingRecoveryStatus, "completed");
  harness.clock.tick(60000);
  assert.equal(attempts(), 1);
  assert.equal(harness.clock.pendingCount, 0);
});

test("Page Coherence keeps ineffective or throwing queue-controller completion to one attempt", () => {
  const cases = [
    ["ineffective", "pending", VIDEO_A, () => {}],
    ["disappearing controller", "pending", "", (watch) => { delete watch.flexy.watchController; }],
    ["throwing", "failed", VIDEO_A, () => { throw new Error("changed native queue API"); }],
  ];
  for (const [name, expectedStatus, expectedControllerVideoId, complete] of cases) {
    const { harness, watch } = createStalledQueueControllerNavigation();
    let attempts = 0;
    watch.flexy.updatePageData_ = () => { attempts++; complete(watch); };
    harness.clock.tick(3200);
    assert.equal(attempts, 1, name);
    let state = harness.context.__YT_MASTER_STATE__.snapshot();
    assert.equal(state.loadingRecoveryStatus, expectedStatus, name);
    assert.equal(state.watchControllerVideoId, expectedControllerVideoId, name);
    if (expectedControllerVideoId) assert.equal(state.confirmedCoherent, false, name);
    for (let i = 0; i < 10; i++) harness.context.__YT_MASTER_STATE__.check();
    harness.clock.tick(60000);
    state = harness.context.__YT_MASTER_STATE__.snapshot();
    assert.equal(attempts, 1, name);
    assert.equal(state.loadingRecoveryStatus, expectedStatus, name);
    assert.equal(harness.clock.pendingCount, 0, name);
  }
});

test("Page Coherence recovers accepted responses when current-video progress has no navigate-finish", () => {
  for (const progress of ["yt-page-data-updated", "loadedmetadata"]) {
    for (const makeFixture of [createStalledHomeNavigation, createStalledQueueControllerNavigation]) {
      const { harness, watch, attempts } = makeFixture({ finishNavigation: false });
      if (progress === "loadedmetadata") {
        harness.dispatchDocument(progress, watch.video);
      } else {
        harness.dispatchWindow(progress);
      }
      harness.clock.tick(3199);
      assert.equal(attempts(), 0, `${progress}: retain the grace period`);
      harness.clock.tick(1);
      assert.equal(attempts(), 1, progress);
      assert.equal(harness.context.__YT_MASTER_STATE__.snapshot().loadingRecoveryStatus, "completed");
      harness.clock.tick(60000);
      assert.equal(attempts(), 1, `${progress}: retain the one-attempt limit`);
      assert.equal(harness.clock.pendingCount, 0);
    }
  }
});

test("Page Coherence does not infer completion for same-video, hidden, suspended or unaccepted navigation", () => {
  const cases = [
    ["no progress evidence", () => {}, false],
    ["same-video start", ({ harness }) => harness.dispatchWindow("yt-navigate-start"), true],
    ["hidden document", ({ harness }) => { harness.document.visibilityState = "hidden"; }, true],
    ["suspended page", ({ harness }) => harness.dispatchWindow("pagehide"), true],
    ["unaccepted response", ({ app }) => { app.data.response = { ...app.data.response }; }, true],
    ["wrong player", ({ watch }) => { watch.player.videoId = VIDEO_A; }, true],
  ];
  for (const [name, configure, sendProgress] of cases) {
    const fixture = createStalledQueueControllerNavigation({ finishNavigation: false });
    configure(fixture);
    if (sendProgress) {
      fixture.harness.dispatchWindow("yt-page-data-updated");
      fixture.harness.dispatchDocument("loadedmetadata", fixture.watch.video);
    }
    fixture.harness.clock.tick(60000);
    assert.equal(fixture.attempts(), 0, name);
    assert.equal(fixture.harness.clock.pendingCount, 0, name);
  }
});

test("Page Coherence rejects previous progress evidence after a rapid navigation", () => {
  const { harness, watch, app, attempts } = createStalledHomeNavigation({ finishNavigation: false });
  harness.dispatchWindow("yt-page-data-updated");
  harness.clock.tick(100);
  harness.dispatchWindow("yt-navigate-start");
  setWatchUrl(harness, VIDEO_C);
  watch.setIdentity(VIDEO_C);
  watch.flexy.videoId = VIDEO_C;
  const response = {
    currentVideoEndpoint: { watchEndpoint: { videoId: VIDEO_C } },
    contents: { twoColumnWatchNextResults: {} },
  };
  watch.flexy.data = response;
  app.data = { page: "watch", url: `/watch?v=${VIDEO_C}`, response };
  harness.emitMutations([{ type: "attributes", attributeName: "video-id", target: watch.flexy }]);
  harness.clock.tick(60000);
  assert.equal(attempts(), 0, "old destination evidence cannot certify the new navigation");
  assert.equal(harness.clock.pendingCount, 0);
});

test("Page Coherence gives coherent but still-loading responses a bounded late-acceptance budget", () => {
  for (const finishNavigation of [true, false]) {
    const { harness, watch, app, response, attempts } = createStalledHomeNavigation({ finishNavigation });
    watch.flexy.setAttribute("video-id", VIDEO_B);
    app.data.response = { ...response };
    if (!finishNavigation) harness.dispatchWindow("yt-page-data-updated");
    harness.clock.tick(4000);
    assert.equal(attempts(), 0);
    assert.equal(harness.context.__YT_MASTER_STATE__.snapshot().confirmedCoherent, true);
    assert.equal(harness.context.__YT_MASTER_STATE__.snapshot().nativeLoading, true);

    app.data.response = response;
    harness.clock.tick(1599);
    assert.equal(attempts(), 0);
    harness.clock.tick(1);
    assert.equal(attempts(), 1);
    assert.equal(watch.flexy.loading, false);
    harness.clock.tick(60000);
    assert.equal(attempts(), 1);
    assert.equal(harness.clock.pendingCount, 0);
  }
});

test("Page Coherence exhausts unresolved loading checks without polling or stealing an unaccepted response", () => {
  const { harness, watch, app, attempts } = createStalledHomeNavigation();
  watch.flexy.setAttribute("video-id", VIDEO_B);
  app.data.response = { ...app.data.response };
  harness.clock.tick(60000);
  assert.equal(attempts(), 0);
  assert.equal(watch.flexy.loading, true);
  assert.equal(harness.clock.pendingCount, 0);
  for (let index = 0; index < 5; index++) harness.context.__YT_MASTER_STATE__.check();
  assert.equal(harness.clock.pendingCount, 0, "manual checks do not renew the bounded recovery budget");
});

test("Page Coherence does not replay missing, stale, unaccepted, hidden or in-flight data", () => {
  const cases = [
    ({ app }) => { app.data.response = { ...app.data.response }; },
    ({ app }) => { app.data.page = "browse"; },
    ({ app }) => { app.data.url = `/watch?v=${VIDEO_A}`; },
    ({ response }) => { response.currentVideoEndpoint.watchEndpoint.videoId = VIDEO_A; },
    ({ response }) => { delete response.contents; },
    ({ watch }) => { watch.player.videoId = VIDEO_A; },
    ({ watch }) => { watch.flexy.hidden = true; },
    ({ watch }) => { watch.flexy.loading = false; },
    ({ watch }) => { delete watch.flexy.updatePageData_; },
    ({ harness }) => { harness.document.visibilityState = "hidden"; },
    ({ harness }) => { harness.dispatchWindow("yt-navigate-start"); },
    ({ harness }) => { harness.dispatchWindow("pagehide"); },
    ({ harness }) => { harness.location.setUrl("https://www.youtube.com/"); },
  ];
  for (const change of cases) {
    const fixture = createStalledHomeNavigation();
    change(fixture);
    fixture.harness.clock.tick(60000);
    assert.equal(fixture.attempts(), 0);
  }
});

test("Page Coherence does not repeatedly call a throwing native completion API", () => {
  const { harness, watch } = createStalledHomeNavigation();
  let attempts = 0;
  watch.flexy.updatePageData_ = () => { attempts++; throw new Error("changed native API"); };
  harness.clock.tick(60000);
  assert.equal(attempts, 1);
  assert.equal(harness.context.__YT_MASTER_STATE__.snapshot().loadingRecoveryStatus, "failed");
  assert.equal(harness.clock.pendingCount, 0);
});

test("Page Coherence resets the completion budget only for a new navigation", () => {
  const { harness, watch, app, attempts } = createStalledHomeNavigation();
  harness.clock.tick(3300);
  assert.equal(attempts(), 1);
  harness.dispatchWindow("yt-navigate-start");
  setWatchUrl(harness, VIDEO_C);
  watch.setIdentity(VIDEO_C);
  watch.flexy.loading = true;
  watch.flexy.videoId = VIDEO_C;
  let nextAttempts = 0;
  const response = { currentVideoEndpoint: { watchEndpoint: { videoId: VIDEO_C } }, contents: { twoColumnWatchNextResults: {} } };
  watch.flexy.data = response;
  app.data = { page: "watch", url: `/watch?v=${VIDEO_C}`, response };
  watch.flexy.updatePageData_ = () => { nextAttempts++; watch.flexy.loading = false; };
  harness.dispatchWindow("yt-navigate-finish");
  harness.clock.tick(3199);
  assert.equal(nextAttempts, 0);
  harness.clock.tick(20000);
  assert.equal(nextAttempts, 1);
});

test("Page Coherence diagnoses mismatches without hiding native page content", () => {
  assert.doesNotMatch(
    PAGE_COHERENCE_SOURCE,
    /:root\[\$\{STALE_ATTRIBUTE\}\]/,
    "the diagnostic stale marker must not drive visual hiding",
  );
  assert.doesNotMatch(
    PAGE_COHERENCE_SOURCE,
    /GM_addStyle\(buildCss\(\)\)/,
    "the diagnostic module must not install a stale-content stylesheet",
  );
});

test("Page Coherence clears a stale guard when the active flexy recovers late", () => {
  const harness = createHarness(
    PAGE_COHERENCE_SOURCE,
    `https://www.youtube.com/watch?v=${VIDEO_A}`,
  );
  const watch = createWatchDom(harness, VIDEO_A);

  setWatchUrl(harness, VIDEO_B);
  watch.setIdentity(VIDEO_B);
  harness.dispatchWindow("yt-navigate-start");
  harness.dispatchWindow("yt-navigate-finish");
  harness.clock.tick(1_700);
  assert.equal(
    harness.document.documentElement.hasAttribute("data-yt-master-page-stale"),
    true,
    "two confirmed mismatch checks should enter the stale guard",
  );

  harness.clock.tick(1_600);
  assert.equal(
    harness.document.documentElement.hasAttribute("data-yt-master-page-stale"),
    true,
    "the normal 3.2-second check must not clear a still-mismatched page",
  );

  watch.setFlexyIdentity(VIDEO_B);
  harness.clock.tick(400);
  assert.equal(
    harness.document.documentElement.hasAttribute("data-yt-master-page-stale"),
    false,
    "the first bounded stale-recovery check should reveal coherent page data",
  );
});

test("Page Coherence retains a stale guard across a missed navigation start", () => {
  const harness = createHarness(
    PAGE_COHERENCE_SOURCE,
    `https://www.youtube.com/watch?v=${VIDEO_A}`,
  );
  const watch = createWatchDom(harness, VIDEO_A);

  setWatchUrl(harness, VIDEO_B);
  watch.setIdentity(VIDEO_B);
  harness.dispatchWindow("yt-navigate-start");
  harness.dispatchWindow("yt-navigate-finish");
  harness.clock.tick(1_700);
  assert.equal(
    harness.document.documentElement.hasAttribute("data-yt-master-page-stale"),
    true,
  );

  setWatchUrl(harness, VIDEO_C);
  watch.setIdentity(VIDEO_C);
  harness.dispatchWindow("yt-navigate-finish");
  assert.equal(
    harness.document.documentElement.hasAttribute("data-yt-master-page-stale"),
    true,
    "a missed yt-navigate-start must not reveal the previous video's hidden data",
  );

  harness.clock.tick(3_300);
  watch.setFlexyIdentity(VIDEO_C);
  harness.clock.tick(2_400);
  assert.equal(
    harness.document.documentElement.hasAttribute("data-yt-master-page-stale"),
    false,
    "the new generation should still recover after the flexy catches up",
  );
});

test("Page Coherence guards a URL that advances while player and flexy remain stale after grace", () => {
  const harness = createHarness(
    PAGE_COHERENCE_SOURCE,
    `https://www.youtube.com/watch?v=${VIDEO_A}`,
  );
  const watch = createWatchDom(harness, VIDEO_A);

  harness.dispatchWindow("yt-navigate-start");
  setWatchUrl(harness, VIDEO_B);
  harness.dispatchWindow("yt-navigate-finish");
  assert.equal(
    harness.document.documentElement.hasAttribute("data-yt-master-page-stale"),
    false,
    "an ordinary in-flight navigation must not flicker-hide immediately",
  );

  harness.clock.tick(700);
  assert.equal(
    harness.document.documentElement.hasAttribute("data-yt-master-page-stale"),
    false,
    "the first mismatch check is the bounded transition grace period",
  );

  harness.clock.tick(1_000);
  assert.equal(
    harness.document.documentElement.hasAttribute("data-yt-master-page-stale"),
    true,
    "two checks must guard URL B when both rendered identities still belong to A",
  );

  watch.setIdentity(VIDEO_B);
  watch.setFlexyIdentity(VIDEO_B);
  harness.clock.tick(1_600);
  assert.equal(
    harness.document.documentElement.hasAttribute("data-yt-master-page-stale"),
    false,
    "the existing bounded checks must reveal the page once all identities converge",
  );
});

test("Page Coherence retains a known-stale guard across a navigation retry", () => {
  const harness = createHarness(
    PAGE_COHERENCE_SOURCE,
    `https://www.youtube.com/watch?v=${VIDEO_A}`,
  );
  const watch = createWatchDom(harness, VIDEO_A);

  setWatchUrl(harness, VIDEO_B);
  watch.setIdentity(VIDEO_B);
  harness.dispatchWindow("yt-navigate-start");
  harness.dispatchWindow("yt-navigate-finish");
  harness.clock.tick(1_700);
  assert.equal(
    harness.document.documentElement.hasAttribute("data-yt-master-page-stale"),
    true,
  );

  harness.dispatchWindow("yt-navigate-start");
  setWatchUrl(harness, VIDEO_C);
  watch.setIdentity(VIDEO_C);
  harness.dispatchWindow("yt-navigate-finish");
  assert.equal(
    harness.document.documentElement.hasAttribute("data-yt-master-page-stale"),
    true,
    "retrying navigation must not expose content already known to be stale",
  );

  watch.setFlexyIdentity(VIDEO_C);
  harness.clock.tick(700);
  assert.equal(
    harness.document.documentElement.hasAttribute("data-yt-master-page-stale"),
    false,
  );
});

test("Page Coherence cancels recovery across pagehide and verifies pageshow", () => {
  const harness = createHarness(
    PAGE_COHERENCE_SOURCE,
    `https://www.youtube.com/watch?v=${VIDEO_A}`,
  );
  const watch = createWatchDom(harness, VIDEO_A);

  setWatchUrl(harness, VIDEO_B);
  watch.setIdentity(VIDEO_B);
  harness.dispatchWindow("yt-navigate-start");
  harness.dispatchWindow("yt-navigate-finish");
  harness.clock.tick(1_700);
  assert.equal(
    harness.document.documentElement.hasAttribute("data-yt-master-page-stale"),
    true,
  );

  harness.dispatchWindow("pagehide");
  assert.equal(harness.clock.pendingCount, 0, "pagehide must cancel every check");
  watch.setFlexyIdentity(VIDEO_B);
  harness.dispatchWindow("pageshow");
  assert.equal(
    harness.document.documentElement.hasAttribute("data-yt-master-page-stale"),
    true,
    "pageshow must retain the guard until identities are checked",
  );
  harness.clock.tick(700);
  assert.equal(
    harness.document.documentElement.hasAttribute("data-yt-master-page-stale"),
    false,
  );
});

test("Page Coherence gives each navigation only one bounded recovery budget", () => {
  const harness = createHarness(
    PAGE_COHERENCE_SOURCE,
    `https://www.youtube.com/watch?v=${VIDEO_A}`,
  );
  const watch = createWatchDom(harness, VIDEO_A);

  setWatchUrl(harness, VIDEO_B);
  watch.setIdentity(VIDEO_B);
  harness.dispatchWindow("yt-navigate-start");
  harness.dispatchWindow("yt-navigate-finish");
  harness.clock.tick(3_300);
  watch.setFlexyIdentity(VIDEO_B);
  harness.clock.tick(400);
  assert.equal(
    harness.document.documentElement.hasAttribute("data-yt-master-page-stale"),
    false,
  );

  watch.setFlexyIdentity(VIDEO_A);
  harness.dispatchWindow("yt-page-data-updated");
  harness.clock.tick(3_500);
  assert.equal(
    harness.document.documentElement.hasAttribute("data-yt-master-page-stale"),
    true,
    "a later mismatch in the same generation remains protected",
  );
  assert.equal(
    harness.clock.pendingCount,
    0,
    "coherent/mismatched oscillation must not allocate another recovery batch",
  );
});

test("Page Coherence selects the active player once per snapshot, with no cross-snapshot cache", () => {
  const harness = createHarness(PAGE_COHERENCE_SOURCE,
    `https://www.youtube.com/watch?v=${VIDEO_A}`);
  const watch = createWatchDom(harness, VIDEO_A);
  let scans = 0;
  let reads = 0;
  const queryAll = harness.document.querySelectorAll.bind(harness.document);
  harness.document.querySelectorAll = selector => {
    if (selector === '[id="movie_player"]') scans++;
    return queryAll(selector);
  };
  const read = watch.player.getVideoData.bind(watch.player);
  watch.player.getVideoData = () => { reads++; return read(); };
  for (let index = 0; index < 1000; index++) {
    assert.equal(harness.context.__YT_MASTER_STATE__.snapshot().playerVideoId, VIDEO_A);
  }
  assert.deepEqual({ scans, reads }, { scans: 1000, reads: 2000 });

  watch.flexy.hidden = true;
  const next = createWatchDom(harness, VIDEO_B);
  setWatchUrl(harness, VIDEO_B);
  scans = 0;
  const snapshot = harness.context.__YT_MASTER_STATE__.snapshot();
  assert.equal(scans, 1);
  assert.equal(snapshot.playerVideoId, VIDEO_B);
  assert.equal(snapshot.flexyVideoId, VIDEO_B);
  assert.equal(snapshot.confirmedCoherent, true);

  harness.document.body.appendChild(next.player);
  next.flexy.appendChild(new FakeElement("div", { id: "ytsmp-player-placeholder" }));
  scans = 0;
  const floated = harness.context.__YT_MASTER_STATE__.snapshot();
  assert.equal(scans, 1);
  assert.equal(floated.playerVideoId, VIDEO_B);
  assert.equal(floated.flexyVideoId, VIDEO_B);
});

for (const eventType of ["yt-page-data-updated", "yt-navigate-finish", "pageshow"]) {
  test(`Page Coherence reuses one off-watch snapshot for ${eventType} without caching later reads`, () => {
    const harness = createHarness(PAGE_COHERENCE_SOURCE);
    harness.document.title = "Home fixture";
    const watch = createWatchDom(harness, VIDEO_A);
    watch.flexy.hidden = true;
    const { comments } = createCommentsContainer({ permalinkVideoId: VIDEO_A, rendererCount: 100 });
    watch.flexy.appendChild(comments);
    const links = comments.querySelectorAll('a[href*="lc="]');
    const queryAll = comments.querySelectorAll.bind(comments);
    let scans = 0;
    let linksRead = 0;
    comments.querySelectorAll = selector => {
      const result = queryAll(selector);
      scans++;
      linksRead += result.length;
      return result;
    };
    const freshSnapshot = harness.context.__YT_MASTER_STATE__.snapshot;
    const keys = Object.keys(freshSnapshot()).sort();
    scans = linksRead = 0;

    harness.dispatchWindow(eventType);
    assert.deepEqual({ scans, linksRead }, { scans: 1, linksRead: 100 });
    const first = readJsonAttribute(harness.document.documentElement, "data-yt-master-state");
    assert.deepEqual(Object.keys(first).sort(), keys, "same-stack reuse must retain every diagnostic field");
    assert.deepEqual(first.commentVideoIds, [VIDEO_A]);
    assert.equal(first.identityStatus, "not-watch-page");
    assert.equal(harness.clock.pendingCount, 0, "off-watch events must not create check timers");

    const replaceIds = videoId => links.forEach(link => {
      link.href = `https://www.youtube.com/watch?v=${videoId}&lc=current`;
    });
    replaceIds(VIDEO_B);
    scans = linksRead = 0;
    harness.dispatchWindow(eventType);
    assert.deepEqual({ scans, linksRead }, { scans: 1, linksRead: 100 });
    const second = readJsonAttribute(harness.document.documentElement, "data-yt-master-state");
    assert.deepEqual(second.commentVideoIds, [VIDEO_B], "the next event must reread current comment provenance");

    replaceIds(VIDEO_C);
    scans = linksRead = 0;
    assert.deepEqual(Array.from(freshSnapshot().commentVideoIds), [VIDEO_C]);
    assert.deepEqual({ scans, linksRead }, { scans: 1, linksRead: 100 });
    replaceIds(VIDEO_A);
    scans = linksRead = 0;
    const checked = harness.context.__YT_MASTER_STATE__.check({ commentVideoIds: [VIDEO_C] });
    assert.deepEqual(Array.from(checked.commentVideoIds), [VIDEO_A], "public checks must obtain a fresh snapshot");
    assert.deepEqual({ scans, linksRead }, { scans: 1, linksRead: 100 });
  });
}

test("Page Coherence selects the player-owned or placeholder-owned active flexy", () => {
  const harness = createHarness(PAGE_COHERENCE_SOURCE);
  const staleFlexy = new FakeElement("ytd-watch-flexy", {
    "video-id": VIDEO_A,
  });
  staleFlexy.data = {
    playerResponse: { videoDetails: { videoId: VIDEO_A } },
  };
  harness.document.body.appendChild(staleFlexy);
  const activeFlexy = createWatchDom(harness, VIDEO_B);
  setWatchUrl(harness, VIDEO_B);
  harness.dispatchWindow("pageshow");

  let state = readJsonAttribute(
    harness.document.documentElement,
    "data-yt-master-state",
  );
  assert.equal(state.flexyVideoId, VIDEO_B, "the flexy owning the player wins");

  harness.document.body.appendChild(activeFlexy.player);
  const placeholder = new FakeElement("div", { id: "ytsmp-player-placeholder" });
  activeFlexy.flexy.appendChild(placeholder);
  harness.dispatchWindow("yt-page-data-updated");
  state = readJsonAttribute(
    harness.document.documentElement,
    "data-yt-master-state",
  );
  assert.equal(
    state.flexyVideoId,
    VIDEO_B,
    "the placeholder-owned flexy wins while Scroll Miniplayer reparents the player",
  );
  assert.equal(staleFlexy.isConnected, true);
});

test("Page Coherence ignores a retained ended-video playerResponse once live identities agree", () => {
  const harness = createHarness(
    PAGE_COHERENCE_SOURCE,
    `https://www.youtube.com/watch?v=${VIDEO_A}`,
  );
  const watch = createWatchDom(harness, VIDEO_A);

  harness.dispatchWindow("yt-navigate-start");
  setWatchUrl(harness, VIDEO_B);
  watch.setIdentity(VIDEO_B);
  watch.flexy.setAttribute("video-id", VIDEO_B);
  // YouTube can retain the ended video's Polymer playerResponse after the
  // live watch attribute and active player have moved to the clicked video.
  watch.flexy.data = {
    playerResponse: { videoDetails: { videoId: VIDEO_A } },
  };
  harness.dispatchWindow("yt-navigate-finish");
  harness.clock.tick(3_300);

  const state = readJsonAttribute(
    harness.document.documentElement,
    "data-yt-master-state",
  );
  assert.equal(state.urlVideoId, VIDEO_B);
  assert.equal(state.playerVideoId, VIDEO_B);
  assert.equal(
    state.flexyVideoId,
    VIDEO_B,
    "the current live attribute must win when URL and active player confirm it",
  );
  assert.equal(
    harness.document.documentElement.hasAttribute("data-yt-master-page-stale"),
    false,
    "a retained ended-video data object must not leave current metadata hidden",
  );
});

test("Page Coherence rechecks a late live video-id change after its timer budget", () => {
  const harness = createHarness(
    PAGE_COHERENCE_SOURCE,
    `https://www.youtube.com/watch?v=${VIDEO_A}`,
  );
  const watch = createWatchDom(harness, VIDEO_A);

  harness.dispatchWindow("yt-navigate-start");
  setWatchUrl(harness, VIDEO_B);
  watch.setIdentity(VIDEO_B);
  harness.dispatchWindow("yt-navigate-finish");
  harness.clock.tick(20_000);
  assert.equal(
    harness.document.documentElement.hasAttribute("data-yt-master-page-stale"),
    true,
  );
  assert.equal(harness.clock.pendingCount, 0);

  watch.flexy.setAttribute("video-id", VIDEO_B);
  harness.emitMutations([
    {
      type: "attributes",
      attributeName: "video-id",
      target: watch.flexy,
      addedNodes: [],
      removedNodes: [],
    },
  ]);

  assert.equal(
    harness.document.documentElement.hasAttribute("data-yt-master-page-stale"),
    false,
    "a late current identity signal must release an otherwise permanent blank page",
  );
});

test("Page Coherence ignores a retained hidden player when a current player exists", () => {
  const harness = createHarness(
    PAGE_COHERENCE_SOURCE,
    `https://www.youtube.com/watch?v=${VIDEO_B}`,
  );
  const ended = createWatchDom(harness, VIDEO_A);
  ended.flexy.hidden = true;
  createWatchDom(harness, VIDEO_B);

  harness.dispatchWindow("pageshow");
  harness.clock.tick(1_700);

  const state = readJsonAttribute(
    harness.document.documentElement,
    "data-yt-master-state",
  );
  assert.equal(
    state.playerVideoId,
    VIDEO_B,
    "duplicate player IDs must resolve to the rendered current watch player",
  );
  assert.equal(
    harness.document.documentElement.hasAttribute("data-yt-master-page-stale"),
    false,
  );
});

test("Page Coherence cancels old recovery work but retains a permanent mismatch", () => {
  const harness = createHarness(
    PAGE_COHERENCE_SOURCE,
    `https://www.youtube.com/watch?v=${VIDEO_A}`,
  );
  const watch = createWatchDom(harness, VIDEO_A);

  harness.dispatchWindow("yt-navigate-start");
  harness.dispatchWindow("yt-navigate-finish");
  harness.clock.tick(12_000);
  assert.equal(
    harness.document.documentElement.hasAttribute("data-yt-master-page-stale"),
    false,
    "a cancelled navigation must not hide the unchanged coherent page",
  );

  setWatchUrl(harness, VIDEO_B);
  watch.setIdentity(VIDEO_B);
  harness.dispatchWindow("yt-navigate-start");
  harness.dispatchWindow("yt-navigate-finish");
  harness.clock.tick(20_000);
  assert.equal(
    harness.document.documentElement.hasAttribute("data-yt-master-page-stale"),
    true,
    "a permanent active-flexy disagreement must remain hidden",
  );
  assert.equal(harness.clock.pendingCount, 0, "recovery polling must be bounded");

  setWatchUrl(harness, VIDEO_C);
  watch.setIdentity(VIDEO_C);
  watch.setFlexyIdentity(VIDEO_C);
  harness.dispatchWindow("yt-navigate-start");
  harness.dispatchWindow("yt-navigate-finish");
  harness.clock.tick(3_500);
  assert.equal(
    harness.document.documentElement.hasAttribute("data-yt-master-page-stale"),
    false,
    "a new coherent generation must cancel the old mismatch state",
  );
});

test("Comment Cleaner releases a new no-permalink container after coherent autoplay", () => {
  const { harness, watch } = initialiseCommentCleanerWatch();
  const old = createCommentsContainer({ permalinkVideoId: VIDEO_A });
  harness.document.body.appendChild(old.comments);

  harness.dispatchWindow("yt-navigate-start");
  old.comments.remove();
  const fresh = createCommentsContainer();
  harness.document.body.appendChild(fresh.comments);
  setWatchUrl(harness, VIDEO_B);
  watch.setIdentity(VIDEO_B);
  watch.setFlexyIdentity(VIDEO_B);
  harness.dispatchWindow("yt-navigate-finish");
  harness.clock.tick(700);

  assert.equal(
    fresh.comments.hasAttribute("data-iow-stale-video"),
    false,
    "a new renderer tree can be accepted without a comment permalink once page identity is coherent",
  );
});

test("Comment Cleaner accepts current comments when ended-video playerResponse is retained", () => {
  const { harness, watch } = initialiseCommentCleanerWatch();
  const old = createCommentsContainer({ permalinkVideoId: VIDEO_A });
  harness.document.body.appendChild(old.comments);

  harness.dispatchWindow("yt-navigate-start");
  old.comments.remove();
  const fresh = createCommentsContainer();
  harness.document.body.appendChild(fresh.comments);
  setWatchUrl(harness, VIDEO_B);
  watch.setIdentity(VIDEO_B);
  watch.flexy.setAttribute("video-id", VIDEO_B);
  watch.flexy.data = {
    playerResponse: { videoDetails: { videoId: VIDEO_A } },
  };
  harness.dispatchWindow("yt-navigate-finish");
  harness.clock.tick(700);

  assert.equal(
    fresh.comments.hasAttribute("data-iow-stale-video"),
    false,
    "current replacement comments must not remain hidden behind retained ended-video data",
  );
});

test("Comment Cleaner accepts completed native watch data despite a retained video-id attribute", () => {
  const { harness, watch } = initialiseCommentCleanerWatch();
  const old = createCommentsContainer({ permalinkVideoId: VIDEO_A });
  harness.document.body.appendChild(old.comments);
  harness.dispatchWindow("yt-navigate-start");
  old.comments.remove();
  const fresh = createCommentsContainer();
  harness.document.body.appendChild(fresh.comments);
  setWatchUrl(harness, VIDEO_B);
  watch.setIdentity(VIDEO_B);
  watch.flexy.data = { currentVideoEndpoint: { watchEndpoint: { videoId: VIDEO_B } } };
  watch.flexy.videoId = VIDEO_B;
  watch.flexy.loading = false;
  harness.dispatchWindow("yt-navigate-finish");
  harness.clock.tick(700);
  assert.equal(fresh.comments.hasAttribute("data-iow-stale-video"), false);
  assert.equal(watch.flexy.getAttribute("video-id"), VIDEO_A);
});

test("Comment Cleaner does not trust a watch response still loading", () => {
  const { harness, watch } = initialiseCommentCleanerWatch();
  const old = createCommentsContainer({ permalinkVideoId: VIDEO_A });
  harness.document.body.appendChild(old.comments);
  harness.dispatchWindow("yt-navigate-start");
  setWatchUrl(harness, VIDEO_B);
  watch.setIdentity(VIDEO_B);
  watch.flexy.data = { currentVideoEndpoint: { watchEndpoint: { videoId: VIDEO_B } } };
  watch.flexy.videoId = VIDEO_B;
  watch.flexy.loading = true;
  harness.dispatchWindow("yt-navigate-finish");
  harness.clock.tick(700);
  assert.equal(old.comments.hasAttribute("data-iow-stale-video"), true);
});

test("Comment Cleaner does not snapshot a destination container that appears early", () => {
  const { harness, watch } = initialiseCommentCleanerWatch();
  const old = createCommentsContainer({ permalinkVideoId: VIDEO_A });
  harness.document.body.appendChild(old.comments);

  harness.dispatchWindow("yt-navigate-start");
  old.comments.remove();
  setWatchUrl(harness, VIDEO_B);
  watch.setIdentity(VIDEO_B);
  const fresh = createCommentsContainer();
  harness.document.body.appendChild(fresh.comments);
  harness.emitMutations([
    {
      type: "childList",
      target: harness.document.body,
      addedNodes: [fresh.comments],
      removedNodes: [old.comments],
    },
  ]);
  assert.equal(
    fresh.comments.getAttribute("data-iow-stale-video"),
    "1",
    "an early destination surface stays hidden until page identity catches up",
  );

  watch.setFlexyIdentity(VIDEO_B);
  harness.dispatchWindow("yt-navigate-finish");
  harness.clock.tick(700);
  assert.equal(
    fresh.comments.hasAttribute("data-iow-stale-video"),
    false,
    "new destination renderers must not be mistaken for pre-navigation nodes",
  );
});

test("Comment Cleaner keeps reused no-permalink nodes stale until old renderers detach", () => {
  const { harness, watch } = initialiseCommentCleanerWatch();
  const reused = createCommentsContainer();
  harness.document.body.appendChild(reused.comments);
  harness.dispatchWindow("yt-navigate-start");

  setWatchUrl(harness, VIDEO_B);
  watch.setIdentity(VIDEO_B);
  watch.setFlexyIdentity(VIDEO_B);
  harness.dispatchWindow("yt-navigate-finish");
  harness.clock.tick(700);
  assert.equal(reused.comments.getAttribute("data-iow-stale-video"), "1");

  const oldRenderer = reused.renderers[0];
  oldRenderer.remove();
  const newRenderer = new FakeElement("ytd-comment-thread-renderer");
  reused.comments.appendChild(newRenderer);
  harness.emitMutations([
    {
      type: "childList",
      target: reused.comments,
      addedNodes: [newRenderer],
      removedNodes: [oldRenderer],
    },
  ]);
  harness.clock.tick(700);
  assert.equal(
    reused.comments.hasAttribute("data-iow-stale-video"),
    false,
    "detaching every snapshotted renderer releases a reused coherent container",
  );
});

test("Comment Cleaner fails open after a bounded wait for coherent recycled comments", () => {
  const { harness, watch } = initialiseCommentCleanerWatch();
  const reused = createCommentsContainer();
  harness.document.body.appendChild(reused.comments);
  harness.dispatchWindow("yt-navigate-start");

  setWatchUrl(harness, VIDEO_B);
  watch.setIdentity(VIDEO_B);
  watch.setFlexyIdentity(VIDEO_B);
  harness.dispatchWindow("yt-navigate-finish");
  harness.clock.tick(6_500);
  assert.equal(
    reused.comments.getAttribute("data-iow-stale-video"),
    "1",
    "the ordinary recovery window must still protect ambiguous recycled nodes",
  );

  harness.clock.tick(1_600);
  assert.equal(
    reused.comments.hasAttribute("data-iow-stale-video"),
    false,
    "a coherent destination must not remain blank after the hard timeout",
  );

  harness.emitMutations([
    {
      type: "childList",
      target: reused.comments,
      addedNodes: [],
      removedNodes: [],
    },
  ]);
  assert.equal(
    reused.comments.hasAttribute("data-iow-stale-video"),
    false,
    "later mutations must not re-latch a destination released by the hard timeout",
  );
});

test("Comment Cleaner never hides a coherent page indefinitely for an old permalink", () => {
  const { harness, watch } = initialiseCommentCleanerWatch();
  const reused = createCommentsContainer({ permalinkVideoId: VIDEO_A });
  harness.document.body.appendChild(reused.comments);
  harness.dispatchWindow("yt-navigate-start");

  setWatchUrl(harness, VIDEO_B);
  watch.setIdentity(VIDEO_B);
  watch.setFlexyIdentity(VIDEO_B);
  harness.dispatchWindow("yt-navigate-finish");
  harness.clock.tick(8_100);
  assert.equal(
    reused.comments.hasAttribute("data-iow-stale-video"),
    false,
    "availability must win after the bounded stale-content protection window",
  );

  harness.emitMutations([
    {
      type: "attributes",
      attributeName: "href",
      target: reused.comments.querySelector('a[href*="lc="]'),
      addedNodes: [],
      removedNodes: [],
    },
  ]);
  assert.equal(
    reused.comments.hasAttribute("data-iow-stale-video"),
    false,
    "a released destination must stay available until the next navigation",
  );
});

test("Comment Cleaner reconciles multiple comment containers independently", () => {
  const { harness, watch } = initialiseCommentCleanerWatch();
  const first = createCommentsContainer();
  const second = createCommentsContainer();
  harness.document.body.appendChild(first.comments);
  harness.document.body.appendChild(second.comments);
  harness.dispatchWindow("yt-navigate-start");

  setWatchUrl(harness, VIDEO_B);
  watch.setIdentity(VIDEO_B);
  watch.setFlexyIdentity(VIDEO_B);
  first.renderers[0].remove();
  first.comments.appendChild(new FakeElement("ytd-comment-thread-renderer"));
  harness.dispatchWindow("yt-navigate-finish");
  harness.clock.tick(700);

  assert.equal(first.comments.hasAttribute("data-iow-stale-video"), false);
  assert.equal(
    second.comments.getAttribute("data-iow-stale-video"),
    "1",
    "one recovered container must not clear a separate reused stale container",
  );

  second.renderers[0].remove();
  second.comments.appendChild(new FakeElement("ytd-comment-thread-renderer"));
  harness.clock.tick(1_000);
  assert.equal(second.comments.hasAttribute("data-iow-stale-video"), false);
});

test("Comment Cleaner follows old renderers moved into a new container", () => {
  const { harness, watch } = initialiseCommentCleanerWatch();
  const old = createCommentsContainer();
  harness.document.body.appendChild(old.comments);
  harness.dispatchWindow("yt-navigate-start");

  const movedRenderer = old.renderers[0];
  const fresh = createCommentsContainer({ rendererCount: 0 });
  fresh.comments.appendChild(movedRenderer);
  old.comments.remove();
  harness.document.body.appendChild(fresh.comments);
  setWatchUrl(harness, VIDEO_B);
  watch.setIdentity(VIDEO_B);
  watch.setFlexyIdentity(VIDEO_B);
  harness.dispatchWindow("yt-navigate-finish");
  harness.clock.tick(700);
  assert.equal(
    fresh.comments.getAttribute("data-iow-stale-video"),
    "1",
    "moving an old renderer must not turn it into trusted destination content",
  );

  movedRenderer.remove();
  const replacement = new FakeElement("ytd-comment-thread-renderer");
  fresh.comments.appendChild(replacement);
  harness.emitMutations([
    {
      type: "childList",
      target: fresh.comments,
      addedNodes: [replacement],
      removedNodes: [movedRenderer],
    },
  ]);
  harness.clock.tick(20);
  assert.equal(fresh.comments.hasAttribute("data-iow-stale-video"), false);
});

test("Comment Cleaner rejects mixed old and current permalink identities", () => {
  const { harness, watch } = initialiseCommentCleanerWatch();
  const old = createCommentsContainer({ permalinkVideoId: VIDEO_A });
  harness.document.body.appendChild(old.comments);
  harness.dispatchWindow("yt-navigate-start");
  old.comments.remove();

  const fresh = createCommentsContainer({ permalinkVideoId: VIDEO_B });
  const staleRenderer = new FakeElement("ytd-comment-thread-renderer");
  const stalePublishedTime = new FakeElement("span", {
    id: "published-time-text",
  });
  stalePublishedTime.appendChild(
    new FakeElement("a", {
      href: `https://www.youtube.com/watch?v=${VIDEO_A}&lc=old-comment`,
    }),
  );
  staleRenderer.appendChild(stalePublishedTime);
  fresh.comments.appendChild(staleRenderer);
  harness.document.body.appendChild(fresh.comments);
  setWatchUrl(harness, VIDEO_B);
  watch.setIdentity(VIDEO_B);
  watch.setFlexyIdentity(VIDEO_B);
  harness.dispatchWindow("yt-navigate-finish");
  harness.clock.tick(700);
  assert.equal(
    fresh.comments.getAttribute("data-iow-stale-video"),
    "1",
    "one current permalink must not mask another stale permalink",
  );

  staleRenderer.remove();
  harness.emitMutations([
    {
      type: "childList",
      target: fresh.comments,
      addedNodes: [],
      removedNodes: [staleRenderer],
    },
  ]);
  harness.clock.tick(20);
  assert.equal(fresh.comments.hasAttribute("data-iow-stale-video"), false);
});

test("Comment Cleaner does not let a current permalink certify a retained no-permalink renderer", () => {
  const { harness, watch } = initialiseCommentCleanerWatch();
  const reused = createCommentsContainer();
  harness.document.body.appendChild(reused.comments);
  harness.dispatchWindow("yt-navigate-start");

  const fresh = createCommentsContainer({ permalinkVideoId: VIDEO_B });
  const freshRenderer = fresh.renderers[0];
  reused.comments.appendChild(freshRenderer);
  setWatchUrl(harness, VIDEO_B);
  watch.setIdentity(VIDEO_B);
  watch.setFlexyIdentity(VIDEO_B);
  harness.dispatchWindow("yt-navigate-finish");
  harness.clock.tick(700);

  const oldRenderer = reused.renderers[0];
  assert.equal(oldRenderer.isConnected, true);
  assert.equal(
    reused.comments.getAttribute("data-iow-stale-video"),
    "1",
    "a sibling current permalink must not reveal a connected pre-navigation renderer without provenance",
  );

  oldRenderer.remove();
  harness.emitMutations([
    {
      type: "childList",
      target: reused.comments,
      addedNodes: [],
      removedNodes: [oldRenderer],
    },
  ]);
  harness.clock.tick(20);
  assert.equal(
    reused.comments.hasAttribute("data-iow-stale-video"),
    false,
    "the current renderer is revealed as soon as the retained stale renderer detaches",
  );
});

test("Comment Cleaner ignores comment links that are not timestamp permalinks", () => {
  const { harness, watch } = initialiseCommentCleanerWatch();
  const old = createCommentsContainer({ permalinkVideoId: VIDEO_A });
  harness.document.body.appendChild(old.comments);
  harness.dispatchWindow("yt-navigate-start");
  old.comments.remove();

  const fresh = createCommentsContainer({ permalinkVideoId: VIDEO_B });
  const bodyLink = new FakeElement("a", {
    href: `https://www.youtube.com/watch?v=${VIDEO_A}&lc=linked-comment`,
  });
  fresh.renderers[0].appendChild(bodyLink);
  harness.document.body.appendChild(fresh.comments);
  setWatchUrl(harness, VIDEO_B);
  watch.setIdentity(VIDEO_B);
  watch.setFlexyIdentity(VIDEO_B);
  harness.dispatchWindow("yt-navigate-finish");
  harness.clock.tick(700);

  assert.equal(
    fresh.comments.hasAttribute("data-iow-stale-video"),
    false,
    "a comment-body link must not be mistaken for the renderer's own identity",
  );
});

test("Comment Cleaner invalidates recovery work across rapid autoplay navigation", () => {
  const { harness, watch } = initialiseCommentCleanerWatch();
  const comments = createCommentsContainer();
  harness.document.body.appendChild(comments.comments);

  harness.dispatchWindow("yt-navigate-start");
  setWatchUrl(harness, VIDEO_B);
  watch.setIdentity(VIDEO_B);
  harness.dispatchWindow("yt-navigate-finish");
  harness.clock.tick(100);
  assert.equal(comments.comments.getAttribute("data-iow-stale-video"), "1");

  harness.dispatchWindow("yt-navigate-start");
  setWatchUrl(harness, VIDEO_C);
  watch.setIdentity(VIDEO_C);
  watch.setFlexyIdentity(VIDEO_C);
  const oldRenderer = comments.renderers[0];
  oldRenderer.remove();
  comments.comments.appendChild(new FakeElement("ytd-comment-thread-renderer"));
  harness.dispatchWindow("yt-navigate-finish");
  harness.clock.tick(700);
  assert.equal(comments.comments.hasAttribute("data-iow-stale-video"), false);

  harness.clock.tick(10_000);
  assert.equal(
    comments.comments.hasAttribute("data-iow-stale-video"),
    false,
    "timers from the abandoned destination must not re-hide current comments",
  );
});

test("Comment Cleaner cancels a stale guard when the page is hidden or leaves watch", () => {
  const { harness } = initialiseCommentCleanerWatch();
  const comments = createCommentsContainer();
  harness.document.body.appendChild(comments.comments);
  harness.dispatchWindow("yt-navigate-start");
  assert.equal(comments.comments.getAttribute("data-iow-stale-video"), "1");

  harness.dispatchWindow("pagehide");
  assert.equal(comments.comments.hasAttribute("data-iow-stale-video"), false);
  harness.clock.tick(7_000);
  assert.equal(comments.comments.hasAttribute("data-iow-stale-video"), false);

  harness.dispatchWindow("yt-navigate-start");
  harness.location.setUrl("https://www.youtube.com/");
  harness.dispatchWindow("yt-navigate-finish");
  assert.equal(comments.comments.hasAttribute("data-iow-stale-video"), false);
});

test("Comment Cleaner recovers when YouTube omits navigate-start", () => {
  const { harness, watch } = initialiseCommentCleanerWatch();
  const old = createCommentsContainer({ permalinkVideoId: VIDEO_A });
  harness.document.body.appendChild(old.comments);

  setWatchUrl(harness, VIDEO_B);
  watch.setIdentity(VIDEO_B);
  watch.setFlexyIdentity(VIDEO_B);
  harness.dispatchWindow("yt-navigate-finish");
  assert.equal(
    old.comments.getAttribute("data-iow-stale-video"),
    "1",
    "a missed start must still detect and hide the previous video's comments",
  );

  old.comments.remove();
  const fresh = createCommentsContainer();
  harness.document.body.appendChild(fresh.comments);
  harness.emitMutations([
    {
      type: "childList",
      target: harness.document.body,
      addedNodes: [fresh.comments],
      removedNodes: [old.comments],
    },
  ]);
  harness.clock.tick(700);
  assert.equal(
    fresh.comments.hasAttribute("data-iow-stale-video"),
    false,
    "the discovered destination must be bound and recover without another lifecycle event",
  );
});

test("Comment Cleaner releases a cancelled same-video navigation", () => {
  const { harness } = initialiseCommentCleanerWatch();
  const comments = createCommentsContainer();
  harness.document.body.appendChild(comments.comments);

  harness.dispatchWindow("yt-navigate-start");
  assert.equal(comments.comments.getAttribute("data-iow-stale-video"), "1");
  harness.dispatchWindow("yt-navigate-finish");
  harness.clock.tick(20);
  assert.equal(
    comments.comments.hasAttribute("data-iow-stale-video"),
    false,
    "a cancelled navigation cannot make same-video no-permalink comments stay hidden",
  );
});

test("Comment Cleaner releases a cancelled same-video navigation even when finish is missing", () => {
  for (const permalinkVideoId of ["", VIDEO_A]) {
    const { harness } = initialiseCommentCleanerWatch();
    const { comments } = createCommentsContainer({ permalinkVideoId });
    harness.document.body.appendChild(comments);
    harness.dispatchWindow("yt-navigate-start");
    harness.clock.tick(7999);
    assert.equal(comments.getAttribute("data-iow-stale-video"), "1");
    harness.clock.tick(1);
    assert.equal(comments.hasAttribute("data-iow-stale-video"), false);
    assert.equal(harness.clock.pendingCount, 0);
  }
});

test("Comment Cleaner releases an unbound destination after the original hiding deadline", () => {
  const { harness, watch } = initialiseCommentCleanerWatch();
  const { comments } = createCommentsContainer({ permalinkVideoId: VIDEO_A });
  harness.document.body.appendChild(comments);
  harness.dispatchWindow("yt-navigate-start");
  setWatchUrl(harness, VIDEO_B);
  watch.setIdentity(VIDEO_B);
  watch.setFlexyIdentity(VIDEO_B);
  harness.clock.tick(7999);
  assert.equal(comments.getAttribute("data-iow-stale-video"), "1");
  harness.clock.tick(1);
  assert.equal(comments.hasAttribute("data-iow-stale-video"), false);
  harness.emitMutations([{ type: "childList", target: comments, addedNodes: [], removedNodes: [] }]);
  assert.equal(comments.hasAttribute("data-iow-stale-video"), false, "later mutations cannot re-latch the fail-open destination");
  assert.equal(harness.clock.pendingCount, 0);
});

test("Comment Cleaner does not extend the hiding deadline when destination binding is late", () => {
  const { harness, watch } = initialiseCommentCleanerWatch();
  const { comments } = createCommentsContainer();
  harness.document.body.appendChild(comments);
  harness.dispatchWindow("yt-navigate-start");
  harness.clock.tick(5000);
  setWatchUrl(harness, VIDEO_B);
  watch.setIdentity(VIDEO_B);
  watch.setFlexyIdentity(VIDEO_B);
  harness.dispatchWindow("yt-navigate-finish");
  harness.clock.tick(2999);
  assert.equal(comments.getAttribute("data-iow-stale-video"), "1");
  harness.clock.tick(1);
  assert.equal(comments.hasAttribute("data-iow-stale-video"), false);
});

test("Comment Cleaner invalidates an unbound deadline across rapid navigation and route exit", () => {
  const { harness, watch } = initialiseCommentCleanerWatch();
  const { comments } = createCommentsContainer();
  harness.document.body.appendChild(comments);
  harness.dispatchWindow("yt-navigate-start");
  harness.clock.tick(4000);
  setWatchUrl(harness, VIDEO_B);
  watch.setIdentity(VIDEO_B);
  watch.setFlexyIdentity(VIDEO_B);
  harness.dispatchWindow("yt-navigate-start");
  harness.clock.tick(4000);
  assert.equal(comments.getAttribute("data-iow-stale-video"), "1", "the first navigation deadline is cancelled");
  harness.clock.tick(3999);
  assert.equal(comments.getAttribute("data-iow-stale-video"), "1");
  harness.clock.tick(1);
  assert.equal(comments.hasAttribute("data-iow-stale-video"), false);

  harness.dispatchWindow("yt-navigate-start");
  harness.location.setUrl("https://www.youtube.com/");
  harness.clock.tick(8000);
  assert.equal(comments.hasAttribute("data-iow-stale-video"), false, "route exit without finish clears the pending guard");
  assert.equal(harness.clock.pendingCount, 0);
});

test("Comment Cleaner does not apply an old destination deadline to a silently advanced URL", () => {
  const { harness, watch } = initialiseCommentCleanerWatch();
  const { comments } = createCommentsContainer();
  harness.document.body.appendChild(comments);
  harness.dispatchWindow("yt-navigate-start");
  setWatchUrl(harness, VIDEO_B);
  watch.setIdentity(VIDEO_B);
  watch.setFlexyIdentity(VIDEO_B);
  harness.dispatchWindow("yt-navigate-finish");
  harness.clock.tick(7000);
  setWatchUrl(harness, VIDEO_C);
  watch.setIdentity(VIDEO_C);
  watch.setFlexyIdentity(VIDEO_C);
  harness.clock.tick(1000);
  assert.equal(comments.getAttribute("data-iow-stale-video"), "1", "the B deadline must not release newly discovered C");
  harness.clock.tick(7999);
  assert.equal(comments.getAttribute("data-iow-stale-video"), "1");
  harness.clock.tick(1);
  assert.equal(comments.hasAttribute("data-iow-stale-video"), false);
  assert.equal(harness.clock.pendingCount, 0);
});

test("Comment Cleaner treats a fresh watch page after route exit as current", () => {
  const { harness, watch } = initialiseCommentCleanerWatch();
  const old = createCommentsContainer({ permalinkVideoId: VIDEO_A });
  harness.document.body.appendChild(old.comments);

  harness.dispatchWindow("yt-navigate-start");
  harness.location.setUrl("https://www.youtube.com/");
  harness.dispatchWindow("yt-navigate-finish");
  old.comments.remove();

  harness.dispatchWindow("yt-navigate-start");
  const fresh = createCommentsContainer();
  harness.document.body.appendChild(fresh.comments);
  setWatchUrl(harness, VIDEO_B);
  watch.setIdentity(VIDEO_B);
  watch.setFlexyIdentity(VIDEO_B);
  harness.dispatchWindow("yt-navigate-finish");
  harness.clock.tick(700);
  assert.equal(
    fresh.comments.hasAttribute("data-iow-stale-video"),
    false,
    "a prior watch ID must not make a newly rendered destination tree look stale",
  );
});

test("Comment Cleaner never treats an unverified destination as settled", () => {
  const { harness, watch } = initialiseCommentCleanerWatch();
  const old = createCommentsContainer();
  harness.document.body.appendChild(old.comments);

  harness.dispatchWindow("yt-navigate-start");
  setWatchUrl(harness, VIDEO_B);
  watch.setIdentity(VIDEO_B);
  watch.setFlexyIdentity(VIDEO_B);
  harness.dispatchWindow("yt-navigate-finish");
  harness.clock.tick(700);
  assert.equal(old.comments.getAttribute("data-iow-stale-video"), "1");

  harness.dispatchWindow("yt-navigate-start");
  harness.dispatchWindow("yt-navigate-finish");
  harness.clock.tick(700);
  assert.equal(
    old.comments.getAttribute("data-iow-stale-video"),
    "1",
    "a repeated destination event must not reveal comments that never became fresh",
  );
});
