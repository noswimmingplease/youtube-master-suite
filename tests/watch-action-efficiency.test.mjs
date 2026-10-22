import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

const SOURCE = readFileSync(new URL("../sources/modules/youtube-player-preferences-lite.user.js", import.meta.url), "utf8");

function declaration(name) {
  const start = SOURCE.indexOf(`  function ${name}(`);
  assert.notEqual(start, -1, `Missing ${name}`);
  const end = SOURCE.indexOf("\n  function ", start + 1);
  assert.notEqual(end, -1, `Missing end of ${name}`);
  return SOURCE.slice(start, end);
}

function harness(overrides = {}) {
  const config = { hideAskButton: true, hideThanksButton: true, hideShareButton: true, hideInlineSaveButton: true, ...overrides };
  const context = vm.createContext({
    CONFIG: config,
    WATCH_ACTION_BUTTON_RULES: [{ configKey: "hideAskButton", label: "Ask" }, { configKey: "hideThanksButton", label: "Thanks" }, { configKey: "hideShareButton", label: "Share" }],
    WATCH_ACTION_INLINE_BUTTON_RULES: [{ configKey: "hideInlineSaveButton", label: "Save" }],
    WATCH_ACTION_BUTTON_SELECTOR: "inline",
    WATCH_ACTION_MENU_ITEM_SELECTOR: "menu",
    WATCH_ACTION_HIDDEN_DATASET_KEY: "ytpplActionHidden",
    WATCH_ACTION_HIDDEN_VALUE: "1",
    document: {},
    isWatchPath: () => true,
    getElementText: element => element.textContent,
    collectMatchingElements: root => new Set(root.rows),
    isPreservedWatchActionButton: row => Boolean(row.preserved),
    getWatchActionMenuItemContainer: row => row,
  });
  vm.runInContext([
    "getNormalisedLabel", "getWatchActionLabels", "isWatchActionMatch", "setWatchActionHidden",
    "isConfiguredWatchActionMatch", "isConfiguredInlineWatchActionMatch", "hideWatchActionButtons", "hideWatchActionMenuItems",
  ].map(declaration).join("\n") + "\nthis.inline = hideWatchActionButtons; this.menu = hideWatchActionMenuItems;", context);
  return context;
}

function action(text, attributes = {}) {
  const counts = { queries: 0, innerText: 0, textContent: 0 };
  return {
    text, attributes, counts, dataset: {}, hidden: false,
    querySelectorAll() { counts.queries++; return []; },
    getAttribute(name) { return this.attributes[name] || null; },
    get innerText() { counts.innerText++; return this.hidden ? "" : this.text; },
    get textContent() { counts.textContent++; return this.text; },
    resetCounts() { counts.queries = counts.innerText = counts.textContent = 0; },
  };
}

for (const mode of ["menu", "inline"]) {
  test(`${mode} watch actions collect labels once instead of repeating each enabled rule`, () => {
    const fixture = harness();
    const row = action("Add to queue");
    fixture[mode]({ rows: [row] });
    assert.deepEqual(row.counts, { queries: 1, innerText: 1, textContent: 1 });
    assert.equal(row.hidden, false);
    assert.equal(row.dataset.ytpplActionHidden, undefined);
  });

  test(`${mode} watch actions reread changed text and ARIA on every later pass`, () => {
    const fixture = harness();
    const row = action("Add to queue");
    fixture[mode]({ rows: [row] });
    row.text = "Share video";
    row.resetCounts();
    fixture[mode]({ rows: [row] });
    assert.equal(row.hidden, true);
    assert.deepEqual(row.counts, { queries: 1, innerText: 1, textContent: 1 });
    row.text = "Add to queue";
    row.resetCounts();
    fixture[mode]({ rows: [row] });
    assert.equal(row.hidden, false);
    assert.equal(row.dataset.ytpplActionHidden, undefined);
    assert.deepEqual(row.counts, { queries: 1, innerText: 1, textContent: 1 });
    row.attributes["aria-label"] = "Thanks";
    fixture[mode]({ rows: [row] });
    assert.equal(row.hidden, true);
  });

  test(`${mode} watch actions do not extract labels when every relevant rule is disabled`, () => {
    const fixture = harness({ hideAskButton: false, hideThanksButton: false, hideShareButton: false, hideInlineSaveButton: false });
    const row = action("Share");
    fixture[mode]({ rows: [row] });
    assert.deepEqual(row.counts, { queries: 0, innerText: 0, textContent: 0 });
    assert.equal(row.hidden, false);
  });
}

test("preserved Like controls still take the zero-label-read fast path", () => {
  const fixture = harness();
  const row = action("Share");
  row.preserved = true;
  fixture.inline({ rows: [row] });
  assert.deepEqual(row.counts, { queries: 0, innerText: 0, textContent: 0 });
  assert.equal(row.hidden, false);
});

test("matching still requires the exact action or its space-delimited label and keeps menu Save native", () => {
  const fixture = harness();
  const rows = ["Shareholder", "Share video", "Ask", "Thanks", "Save"].map(label => action(label));
  fixture.menu({ rows });
  assert.deepEqual(rows.map(row => row.hidden), [false, true, true, true, false]);
  fixture.inline({ rows });
  assert.deepEqual(rows.map(row => row.hidden), [false, true, true, true, true]);
});
