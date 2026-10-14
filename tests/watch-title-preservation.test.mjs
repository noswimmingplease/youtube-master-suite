import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

const SOURCE = readFileSync(new URL(
  "../sources/modules/youtube-player-preferences-lite.user.js", import.meta.url,
), "utf8");

function createHarness() {
  const start = SOURCE.indexOf("  function removeHashtagLink(");
  const end = SOURCE.indexOf("\n  function ", start + 1);
  assert.ok(start >= 0 && end > start);
  const cleanupCalls = [];
  const context = vm.createContext({
    removeHashtagOnlyRowBreaks: (link) => cleanupCalls.push(["breaks", link]),
    removeEmptyHashtagWrappers: (parent) => cleanupCalls.push(["wrappers", parent]),
  });
  vm.runInContext(SOURCE.slice(start, end), context);
  return { cleanupCalls, removeHashtagLink: context.removeHashtagLink };
}

class Element {
  constructor(tagName, text = "") {
    this.tagName = tagName.toUpperCase();
    this.parentElement = null;
    this.children = [];
    this.dataset = {};
    this.ownText = text;
    this.removeCalls = 0;
  }
  get textContent() {
    return this.ownText + this.children.map((child) => child.textContent).join("");
  }
  set textContent(text) { this.ownText = text; }
  appendChild(child) {
    child.parentElement = this;
    this.children.push(child);
    return child;
  }
  closest(selector) {
    assert.equal(selector, "h1");
    for (let node = this; node; node = node.parentElement) {
      if (node.tagName === "H1") return node;
    }
    return null;
  }
  remove() {
    this.removeCalls++;
    this.parentElement.children = this.parentElement.children.filter((child) => child !== this);
    this.parentElement = null;
  }
}

test("hashtag cleanup preserves native and DeArrow title nodes in current and legacy headings", () => {
  for (const metadataTag of ["ytd-watch-metadata", "ytd-video-primary-info-renderer"]) {
    for (const titleTag of ["yt-formatted-string", "span"]) {
      const harness = createHarness();
      const metadata = new Element(metadataTag);
      const heading = metadata.appendChild(new Element("h1"));
      const title = heading.appendChild(new Element(titleTag));
      const wrapper = title.appendChild(new Element("span"));
      const anchor = wrapper.appendChild(new Element("a", "Quintessentially British Memes #102"));
      title.appendChild(new Element("span", " | Funny Fails"));

      harness.removeHashtagLink(anchor);

      assert.equal(anchor.parentElement, wrapper);
      assert.equal(anchor.removeCalls, 0);
      assert.deepEqual(anchor.dataset, {});
      assert.equal(title.textContent, "Quintessentially British Memes #102 | Funny Fails");
      assert.deepEqual(harness.cleanupCalls, []);
    }
  }
});

test("preserved native title runs can update in place when the queue advances", () => {
  const harness = createHarness();
  const heading = new Element("h1");
  const title = heading.appendChild(new Element("yt-formatted-string"));
  const anchor = title.appendChild(new Element("a", "Quintessentially British Memes #102"));
  const suffix = title.appendChild(new Element("span", " | Funny Fails"));

  harness.removeHashtagLink(anchor);
  // Model YouTube's retained run bindings rather than replacing the whole title.
  anchor.textContent = "The Worst Mother In Wife Swap UK History";
  suffix.textContent = " | Big Craig";
  harness.removeHashtagLink(anchor);

  assert.equal(title.children[0], anchor);
  assert.equal(title.children[1], suffix);
  assert.equal(title.textContent, "The Worst Mother In Wife Swap UK History | Big Craig");
  assert.equal(anchor.removeCalls, 0);
  assert.deepEqual(harness.cleanupCalls, []);
});

test("hashtag link cleanup still removes description, feed and chip links once", () => {
  const harness = createHarness();
  for (const containerTag of ["ytd-text-inline-expander", "ytd-video-renderer", "yt-chip-cloud-chip-renderer"]) {
    const container = new Element(containerTag);
    const anchor = container.appendChild(new Element("a", "#tag"));
    harness.removeHashtagLink(anchor);
    harness.removeHashtagLink(anchor);
    assert.equal(anchor.removeCalls, 1);
    assert.equal(anchor.parentElement, null);
    assert.equal(anchor.dataset.ytpplHashtagRemoved, "1");
  }
  harness.removeHashtagLink(null);
  assert.equal(harness.cleanupCalls.length, 6);
});

test("every hashtag-hiding CSS branch excludes heading descendants", () => {
  const start = SOURCE.indexOf("    if (CONFIG.hideHashtags) {");
  const end = SOURCE.indexOf("display: none !important;", start);
  assert.ok(start >= 0 && end > start);
  const selectors = SOURCE.slice(start, end).split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("ytd-watch-flexy"));
  assert.equal(selectors.length, 8);
  for (const selector of selectors) {
    assert.match(selector, /:not\(h1 \*\)(?:,| \{)$/);
  }
});

function activationHarness(enabled = true, watch = true) {
  const start = SOURCE.indexOf('  function handleTitleHashtagActivation(');
  const end = SOURCE.indexOf('\n  function ', start + 1);
  assert.ok(start >= 0 && end > start);
  const lookups = [];
  const context = vm.createContext({
    CONFIG: { disableTitleHashtagLinks: enabled },
    isWatchPath: () => watch,
    TITLE_HASHTAG_LINK_SELECTOR: 'title-hashtag-fixture-selector',
    closestElement: (target, selector) => {
      lookups.push({ target, selector });
      return target?.titleHashtag ? target : null;
    },
  });
  vm.runInContext(SOURCE.slice(start, end), context);
  return { handle: context.handleTitleHashtagActivation, lookups };
}

function activationEvent(values = {}) {
  return {
    type: 'click', button: 0, target: { titleHashtag: true }, prevented: false, stopped: false,
    preventDefault() { this.prevented = true; },
    stopImmediatePropagation() { this.stopped = true; },
    ...values,
  };
}

test("opt-in title hashtag guard prevents primary, modified, middle and Enter activation without mutating the target", () => {
  const { handle } = activationHarness();
  for (const values of [{}, { ctrlKey: true }, { metaKey: true }, { shiftKey: true },
    { type: 'auxclick', button: 1 }, { type: 'keydown', key: 'Enter' }]) {
    const event = activationEvent(values);
    const before = { ...event.target };
    handle(event);
    assert.equal(event.prevented, true);
    assert.equal(event.stopped, true);
    assert.deepEqual(event.target, before);
  }
});

test("title hashtag guard leaves other keys, IME composition, buttons and unrelated links alone", () => {
  const { handle } = activationHarness();
  for (const values of [
    { type: 'keydown', key: ' ' }, { type: 'keydown', key: 'h' }, { type: 'keydown', key: 'Escape' },
    { type: 'keydown', key: 'Enter', isComposing: true },
    { type: 'auxclick', button: 2 }, { type: 'contextmenu', button: 2 },
    { target: { titleHashtag: false } }, { target: null },
  ]) {
    const event = activationEvent(values);
    handle(event);
    assert.equal(event.prevented, false);
    assert.equal(event.stopped, false);
  }
});

test("disabled title hashtag preference and off-watch routes return before any DOM lookup", () => {
  for (const [enabled, watch] of [[false, true], [true, false]]) {
    const { handle, lookups } = activationHarness(enabled, watch);
    const event = activationEvent();
    handle(event);
    assert.equal(event.prevented, false);
    assert.deepEqual(lookups, []);
  }
});
