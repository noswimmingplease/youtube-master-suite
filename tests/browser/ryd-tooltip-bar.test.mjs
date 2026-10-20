import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { after, before, test } from "node:test";
import { launchFixtureBrowser, waitForSuiteHealth } from "./fixture-browser.mjs";

const SUITE = readFileSync(new URL("../../youtube-master-suite.user.js", import.meta.url), "utf8");
const MANIFEST = JSON.parse(readFileSync(new URL("../../release-manifest.json", import.meta.url), "utf8"));
const FIXTURE = readFileSync(new URL("./watch-page.html", import.meta.url), "utf8")
  .replace('<html lang="en" dark>', '<html lang="en-GB" dark>');
const WATCH_URL = "https://www.youtube.com/watch?v=aaaaaaaaaaa&list=fixture-queue";
const KEY = "yt-master-suite.settings.v1";
let browser;

before(async () => { browser = await launchFixtureBrowser(); }, { timeout: 30000 });
after(async () => { await browser?.close(); }, { timeout: 10000 });

async function healthy(page, errors = []) {
  await waitForSuiteHealth(page, MANIFEST.registeredModules, { timeoutMs: 10000, errors });
}

async function openFixture(t, values = {}) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, serviceWorkers: "block" });
  await context.route("**/*", route => route.request().url() === WATCH_URL
    ? route.fulfill({ contentType: "text/html", body: FIXTURE }) : route.abort());
  await context.addInitScript(({ key, values }) => {
    if (location.origin !== "https://www.youtube.com" || sessionStorage.getItem("seeded")) return;
    localStorage.setItem(key, JSON.stringify({ version: 1, values }));
    sessionStorage.setItem("seeded", "1");
  }, { key: KEY, values: { theatreMode: false, hideChat: false, ...values } });
  await context.addInitScript({ content: SUITE });
  const page = await context.newPage();
  page.setDefaultTimeout(8000);
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  t.after(async () => {
    try {
      assert.deepEqual(errors, [], "The integrated fixture must not produce uncaught errors");
      const runtime = await page.getAttribute("html", "data-yt-master-runtime-errors");
      assert.ok(!runtime || runtime === "[]", `Suite runtime errors: ${runtime}`);
    } finally { await context.close(); }
  });
  await page.goto(WATCH_URL);
  await healthy(page, errors);
  assert.equal(await page.locator("html").getAttribute("lang"), "en-GB");
  return page;
}

// These extension-owned nodes are inert fixtures. No real extension, account,
// media or external endpoint is used; styles, button clicks and storage are real.
function installRydFixture({ bars = true } = {}) {
  for (const id of ["fixture-ryd-style", "fixture-ryd-actions", "fixture-ryd-portal", "fixture-native-tooltip"])
    document.getElementById(id)?.remove();
  const style = document.createElement("style");
  style.id = "fixture-ryd-style";
  style.textContent = `
    #fixture-ryd-actions { display: flex; align-items: center; min-height: 40px; }
    #fixture-ryd-actions button { display: flex; align-items: center; height: 36px;
      padding: 0 12px; border: 0; color: white; background: #272727; font: 14px Arial; }
    #fixture-ryd-actions .fixture-ryd-count { height: 18px; line-height: 18px; transform: translateY(5px); }
    .ryd-tooltip-bar-container { display: flex; min-width: 120px; height: 12px; background: rgb(180, 30, 40); }
    #fixture-ryd-portal, #fixture-native-tooltip { display: block; min-height: 24px; }
  `;
  document.head.append(style);
  const metadata = document.querySelector("ytd-watch-metadata");
  const menu = document.createElement("ytd-menu-renderer");
  menu.id = "fixture-ryd-actions";
  const action = (kind, value) => {
    const wrapper = document.createElement(`${kind}-button-view-model`);
    const button = document.createElement("button");
    button.id = `fixture-ryd-${kind}`;
    button.setAttribute("aria-label", `${kind === "like" ? "Like" : "Dislike"} this video`);
    button.setAttribute("aria-pressed", "false");
    const count = document.createElement("span");
    count.className = "ytSpecButtonShapeNextButtonTextContent fixture-ryd-count";
    count.textContent = value;
    button.append(count);
    button.addEventListener("click", () => {
      button.setAttribute("aria-pressed", button.getAttribute("aria-pressed") === "true" ? "false" : "true");
      button.dataset.clicks = String(Number(button.dataset.clicks || 0) + 1);
    });
    wrapper.append(button);
    menu.append(wrapper);
  };
  action("like", "206");
  action("dislike", "2");
  metadata.append(menu);
  const portal = document.createElement("div");
  portal.id = "fixture-ryd-portal";
  portal.className = "ryd-tooltip";
  portal.setAttribute("role", "tooltip");
  const text = document.createElement("span");
  text.id = "fixture-ryd-ratio-text";
  text.textContent = "206 likes, 2 dislikes";
  portal.append(text);
  document.body.append(portal);
  const native = document.createElement("div");
  native.id = "fixture-native-tooltip";
  native.setAttribute("role", "tooltip");
  native.textContent = "Native playback tooltip";
  document.body.append(native);
  const addBar = (parent, id) => {
    const bar = document.createElement("div");
    bar.id = id;
    bar.className = "ryd-tooltip-bar-container";
    const fill = document.createElement("span");
    fill.className = "fixture-ryd-ratio-fill";
    fill.style.width = "99%";
    bar.append(fill);
    parent.append(bar);
    return bar;
  };
  window.rydBarFixture = {
    addBars() {
      addBar(menu, "fixture-ryd-watch-bar");
      addBar(portal, "fixture-ryd-portalled-bar");
    },
    replaceBars() {
      for (const id of ["fixture-ryd-watch-bar", "fixture-ryd-portalled-bar"])
        document.getElementById(id)?.remove();
      this.addBars();
    },
  };
  if (bars) window.rydBarFixture.addBars();
}

async function assertBars(page, visible) {
  for (const id of ["fixture-ryd-watch-bar", "fixture-ryd-portalled-bar"]) {
    assert.equal(await page.locator(`#${id}`).isVisible(), visible, id);
    assert.equal(await page.locator(`#${id}`).evaluate(el => getComputedStyle(el).display), visible ? "flex" : "none", id);
    assert.equal(await page.locator(`#${id} .fixture-ryd-ratio-fill`).getAttribute("style"), "width: 99%;",
      "The preference must not rewrite extension-owned bar content");
  }
}

async function assertNativeContent(page) {
  for (const id of ["fixture-ryd-like", "fixture-ryd-dislike"]) {
    assert.equal(await page.locator(`#${id}`).isVisible(), true, id);
    const count = await page.locator(`#${id} .fixture-ryd-count`).evaluate(el => {
      const bounds = el.getBoundingClientRect();
      const button = el.closest("button").getBoundingClientRect();
      return {
        height: bounds.height, lineHeight: getComputedStyle(el).lineHeight,
        transform: getComputedStyle(el).transform,
        centreDifference: bounds.top + bounds.height / 2 - button.top - button.height / 2,
      };
    });
    assert.equal(count.height, 24);
    assert.equal(count.lineHeight, "24px");
    assert.equal(count.transform, "none");
    assert.ok(Math.abs(count.centreDifference) <= 0.5, JSON.stringify(count));
  }
  for (const id of ["fixture-ryd-ratio-text", "fixture-native-tooltip"])
    assert.equal(await page.locator(`#${id}`).isVisible(), true, id);
  assert.equal(await page.locator("#fixture-ryd-ratio-text").textContent(), "206 likes, 2 dislikes");
}

async function openInterface(page) {
  await page.locator("#ytms-settings-button").click();
  await page.getByRole("tab", { name: "Interface", exact: true }).click();
}

test("RYD tooltip bars are off by default without hiding native counts, actions or other tooltips", async t => {
  const page = await openFixture(t);
  await page.evaluate(installRydFixture, {});
  await assertBars(page, false);
  await assertNativeContent(page);
  for (const kind of ["like", "dislike"]) {
    await page.locator(`#fixture-ryd-${kind}`).click();
    assert.equal(await page.locator(`#fixture-ryd-${kind}`).getAttribute("aria-pressed"), "true");
    assert.equal(await page.locator(`#fixture-ryd-${kind}`).getAttribute("data-clicks"), "1");
  }
  await page.locator("#fixture-ryd-dislike .fixture-ryd-count").evaluate(el => { el.textContent = "314"; });
  assert.equal(await page.locator("#fixture-ryd-like .fixture-ryd-count").textContent(), "206");
  assert.equal(await page.locator("#fixture-ryd-dislike .fixture-ryd-count").textContent(), "314");
  await assertNativeContent(page);
  await openInterface(page);
  assert.equal(await page.locator("#ytms-showRydTooltipBar").isChecked(), false);
  assert.equal(await page.locator('label[for="ytms-showRydTooltipBar"]').evaluate(label => label.firstChild.textContent),
    "Show Return YouTube Dislike tooltip bar");
});

for (const visible of [false, true]) {
  test(`RYD bar visibility ${visible} covers lazy, portalled and replaced extension nodes`, async t => {
    const page = await openFixture(t, { showRydTooltipBar: visible });
    await page.evaluate(installRydFixture, { bars: false });
    assert.equal(await page.locator(".ryd-tooltip-bar-container").count(), 0);
    await page.evaluate(() => rydBarFixture.addBars());
    await assertBars(page, visible);
    await page.evaluate(() => rydBarFixture.replaceBars());
    await assertBars(page, visible);
    await page.locator("#fixture-ryd-portalled-bar").evaluate(el => el.classList.remove("ryd-tooltip-bar-container"));
    assert.equal(await page.locator("#fixture-ryd-portalled-bar .fixture-ryd-ratio-fill").count(), 1);
    assert.notEqual(await page.locator("#fixture-ryd-portalled-bar").evaluate(el => getComputedStyle(el).display), "none",
      "Only the requested extension class is filtered");
    await page.locator("#fixture-ryd-portalled-bar").evaluate(el => el.classList.add("ryd-tooltip-bar-container"));
    await assertBars(page, visible);
    await assertNativeContent(page);
    const overrides = await page.evaluate(() => Array.from(document.querySelectorAll("style"))
      .flatMap(style => Array.from(style.sheet?.cssRules || []))
      .filter(rule => rule.selectorText?.includes(".ryd-tooltip-bar-container") &&
        rule.style?.display === "none" && rule.style.getPropertyPriority("display") === "important").length);
    assert.equal(overrides > 0, !visible, "Enabled means the Suite omits its hiding override");
  });
}

test("RYD setting keeps drafts private and applies persisted show/hide choices after reload", { timeout: 30000 }, async t => {
  const page = await openFixture(t);
  await page.evaluate(installRydFixture, {});
  await openInterface(page);
  const toggle = page.locator("#ytms-showRydTooltipBar");
  const originalRecord = await page.evaluate(key => localStorage.getItem(key), KEY);
  await toggle.check();
  await assertBars(page, false);
  assert.equal(await page.evaluate(key => localStorage.getItem(key), KEY), originalRecord);
  await page.locator("#ytms-cancel-panel").click();
  await openInterface(page);
  assert.equal(await toggle.isChecked(), false);
  await toggle.check();
  await page.locator("#ytms-save-preview").click();
  assert.equal(await page.evaluate(key => JSON.parse(localStorage.getItem(key)).values.showRydTooltipBar, KEY), true);
  await assertBars(page, false);
  await page.reload();
  await healthy(page);
  await page.evaluate(installRydFixture, {});
  await assertBars(page, true);
  await openInterface(page);
  assert.equal(await toggle.isChecked(), true);
  await page.locator("#ytms-restore-defaults").click();
  assert.equal(await toggle.isChecked(), false);
  await assertBars(page, true);
  await page.locator("#ytms-cancel-panel").click();
  await openInterface(page);
  assert.equal(await toggle.isChecked(), true);
  await toggle.uncheck();
  await page.locator("#ytms-save-preview").click();
  assert.equal(await page.evaluate(key => JSON.parse(localStorage.getItem(key)).values.showRydTooltipBar, KEY), false);
  await assertBars(page, true);
  await page.reload();
  await healthy(page);
  await page.evaluate(installRydFixture, {});
  await assertBars(page, false);
  await assertNativeContent(page);
  await openInterface(page);
  assert.equal(await toggle.isChecked(), false);
});

for (const values of [
  { showRydTooltipBar: true, showDeArrowTitleButton: false, showDeArrowQueueButton: true },
  { showRydTooltipBar: false, showDeArrowTitleButton: true, showDeArrowQueueButton: false },
]) {
  test(`RYD tooltip choice ${values.showRydTooltipBar} is independent of DeArrow title and queue choices`, async t => {
    const page = await openFixture(t, values);
    await page.evaluate(installRydFixture, {});
    await page.evaluate(() => {
      const title = document.querySelector("ytd-watch-metadata h1");
      const titleButton = document.createElement("span");
      titleButton.id = "fixture-ryd-dearrow-title";
      titleButton.className = "cbTitleButtonContainer";
      titleButton.textContent = "D";
      title.append(titleButton);
      const row = document.createElement("ytd-playlist-panel-video-renderer");
      const queueTitleContainer = document.createElement("div");
      const queueTitle = document.createElement("span");
      queueTitle.id = "video-title";
      queueTitle.className = "cbCustomTitle";
      queueTitle.textContent = "Replacement queue title";
      const queueButton = document.createElement("button");
      queueButton.id = "fixture-ryd-dearrow-queue";
      queueButton.className = "cbButton cbShowOriginal cbDontHide";
      queueButton.textContent = "D";
      queueTitleContainer.append(queueTitle, queueButton);
      row.append(queueTitleContainer);
      document.querySelector("ytd-playlist-panel-renderer").append(row);
    });
    await assertBars(page, values.showRydTooltipBar);
    assert.equal(await page.locator("#fixture-ryd-dearrow-title").isVisible(), values.showDeArrowTitleButton);
    assert.equal(await page.locator("#fixture-ryd-dearrow-queue").isVisible(), values.showDeArrowQueueButton);
    await openInterface(page);
    for (const [key, value] of Object.entries(values))
      assert.equal(await page.locator(`#ytms-${key}`).isChecked(), value, key);
  });
}
