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
