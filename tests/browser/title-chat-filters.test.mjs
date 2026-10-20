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

// This models extension-owned DOM only: no extension, video, store or user
// profile is contacted. Native layout, computed styles and settings are real.
function installTitleFixture({ layout = "current", includeButton = true } = {}) {
  document.getElementById("fixture-title-style")?.remove();
  const style = document.createElement("style");
  style.id = "fixture-title-style";
  style.textContent = `
    ytd-video-primary-info-renderer, #fixture-queue-row, #fixture-queue-title { display: block; }
    #fixture-queue-title { width: 280px; min-height: 28px; }
    .cbTitleButtonContainer { display: inline-flex; width: 24px; height: 24px; }
    .cbTitleButtonContainer > button, #fixture-queue-button { width: 20px; height: 20px; }
    #fixture-custom-thumbnail { width: 80px; height: 45px; background: rgb(26, 67, 104); }
  `;
  document.head.append(style);
  document.getElementById("fixture-legacy-title")?.remove();
  document.getElementById("fixture-outside-title-button")?.remove();
  document.getElementById("fixture-custom-thumbnail")?.remove();
  const metadata = document.querySelector("ytd-watch-metadata");
  const title = document.createElement("h1");
  title.id = "fixture-watch-title";
  const original = document.createElement("yt-formatted-string");
  original.id = "fixture-original-title";
  original.textContent = "Original video title";
  original.style.setProperty("display", "none", "important");
  const custom = document.createElement("yt-formatted-string");
  custom.id = "fixture-custom-title";
  custom.className = "cbCustomTitle";
  custom.textContent = "DeArrow replacement title";
  custom.style.setProperty("display", "block", "important");
  title.append(original, custom);
  const addButton = () => {
    const container = document.createElement("span");
    container.id = "fixture-title-button";
    container.className = "cbTitleButtonContainer";
    const button = document.createElement("button");
    button.className = "cbButton cbShowOriginal";
    button.textContent = "D";
    button.setAttribute("aria-label", "Show original video title");
    container.append(button);
    title.append(container);
  };
  if (includeButton) addButton();
  metadata.querySelector("h1")?.remove();
  if (layout === "legacy") {
    const legacy = document.createElement("ytd-video-primary-info-renderer");
    legacy.id = "fixture-legacy-title";
    const container = document.createElement("div");
    container.id = "container";
    container.append(title);
    legacy.append(container);
    metadata.before(legacy);
  } else metadata.prepend(title);
  const thumbnail = document.createElement("div");
  thumbnail.id = "fixture-custom-thumbnail";
  thumbnail.className = "cbCustomThumbnail";
  thumbnail.setAttribute("role", "img");
  thumbnail.setAttribute("aria-label", "DeArrow replacement thumbnail");
  metadata.append(thumbnail);
  const queue = document.querySelector("ytd-playlist-panel-renderer");
  const row = document.createElement("ytd-playlist-panel-video-renderer");
  row.id = "fixture-queue-row";
  const queueTitle = document.createElement("div");
  queueTitle.id = "fixture-queue-title";
  const queueCustom = document.createElement("span");
  queueCustom.id = "video-title";
  queueCustom.className = "cbCustomTitle";
  queueCustom.textContent = "DeArrow replacement queue title";
  const queueButton = document.createElement("button");
  queueButton.id = "fixture-queue-button";
  queueButton.className = "cbButton cbShowOriginal cbDontHide";
  queueButton.textContent = "D";
  queueTitle.append(queueCustom, queueButton);
  row.append(queueTitle);
  queue.replaceChildren(row);
  const outside = document.createElement("span");
  outside.id = "fixture-outside-title-button";
  outside.className = "cbTitleButtonContainer";
  outside.textContent = "Unrelated extension container";
  document.body.append(outside);
  window.titleChatFixture = {
    insertButton: addButton,
    replaceButton() {
      document.getElementById("fixture-title-button")?.remove();
      addButton();
    },
  };
}

async function assertReplacementContent(page) {
  assert.equal(await page.locator("#fixture-original-title").isVisible(), false);
  assert.equal(await page.locator("#fixture-custom-title").isVisible(), true);
  assert.equal(await page.locator("#fixture-custom-title").textContent(), "DeArrow replacement title");
  assert.equal(await page.locator("#fixture-custom-title").getAttribute("style"), "display: block !important;");
  assert.equal(await page.locator("#fixture-original-title").getAttribute("style"), "display: none !important;");
  assert.equal(await page.locator("#fixture-custom-thumbnail").isVisible(), true);
  assert.equal(await page.locator("#fixture-custom-thumbnail").getAttribute("class"), "cbCustomThumbnail");
  assert.equal(await page.locator("#fixture-custom-thumbnail").evaluate(el => getComputedStyle(el).backgroundColor), "rgb(26, 67, 104)");
  assert.equal(await page.locator("#fixture-outside-title-button").isVisible(), true,
    "The title preference must not hide matching containers outside the watch page");
}

async function openInterface(page) {
  await page.locator("#ytms-settings-button").click();
  await page.getByRole("tab", { name: "Interface", exact: true }).click();
}

for (const layout of ["current", "legacy"]) {
  test(`default title filter hides only the DeArrow icon in the ${layout} watch layout`, async t => {
    const page = await openFixture(t);
    await page.evaluate(installTitleFixture, { layout });
    assert.equal(await page.locator("#fixture-title-button").isVisible(), false);
    assert.equal(await page.locator("#fixture-title-button").evaluate(el => getComputedStyle(el).display), "none");
    await assertReplacementContent(page);
    assert.equal(await page.locator("#fixture-queue-button").isVisible(), true);
    assert.equal(await page.locator("#fixture-queue-title").evaluate(el => getComputedStyle(el).paddingInlineEnd), "25px");
    await openInterface(page);
    assert.equal(await page.locator("#ytms-showDeArrowTitleButton").isChecked(), false);
    assert.equal(await page.locator("#ytms-showDeArrowQueueButton").isChecked(), true);
    assert.match(await page.locator("#ytms-settings-dialog").textContent(), /Hiding it does not disable DeArrow title or thumbnail replacements/);
    assert.equal(await page.locator('label[for="ytms-showDeArrowTitleButton"]').evaluate(label => label.firstChild.textContent),
      "Show DeArrow icon beside video title");
  });
}

for (const showTitle of [false, true]) {
  test(`title visibility ${showTitle} survives late insertion and current-to-legacy DOM replacement`, async t => {
    const page = await openFixture(t, { showDeArrowTitleButton: showTitle });
    for (const layout of ["current", "legacy"]) {
      await page.evaluate(installTitleFixture, { layout, includeButton: false });
      assert.equal(await page.locator("#fixture-title-button").count(), 0);
      await page.evaluate(() => titleChatFixture.insertButton());
      assert.equal(await page.locator("#fixture-title-button").isVisible(), showTitle);
      await page.evaluate(() => titleChatFixture.replaceButton());
      assert.equal(await page.locator("#fixture-title-button").isVisible(), showTitle);
      await assertReplacementContent(page);
      assert.equal(await page.locator("#fixture-queue-button").isVisible(), true);
    }
  });
}

test("title-icon setting keeps draft and Cancel changes private, and applies saved choices only after reload", { timeout: 30000 }, async t => {
  const page = await openFixture(t);
  await page.evaluate(installTitleFixture, {});
  await openInterface(page);
  const titleToggle = page.locator("#ytms-showDeArrowTitleButton");
  const originalRecord = await page.evaluate(key => localStorage.getItem(key), KEY);
  await titleToggle.check();
  assert.equal(await page.locator("#fixture-title-button").isVisible(), false, "A draft is not applied to the current page");
  assert.equal(await page.evaluate(key => localStorage.getItem(key), KEY), originalRecord);
  await page.locator("#ytms-cancel-panel").click();
  await openInterface(page);
  assert.equal(await titleToggle.isChecked(), false, "Cancel discards the draft");
  await titleToggle.check();
  await page.locator("#ytms-save-preview").click();
  assert.equal(await page.evaluate(key => JSON.parse(localStorage.getItem(key)).values.showDeArrowTitleButton, KEY), true);
  assert.equal(await page.locator("#fixture-title-button").isVisible(), false, "Save must not hot-apply module settings");
  await page.reload();
  await healthy(page);
  await page.evaluate(installTitleFixture, {});
  assert.equal(await page.locator("#fixture-title-button").isVisible(), true);
  await openInterface(page);
  assert.equal(await titleToggle.isChecked(), true);
  await page.locator("#ytms-restore-defaults").click();
  assert.equal(await titleToggle.isChecked(), false);
  assert.equal(await page.locator("#fixture-title-button").isVisible(), true, "Restore defaults is draft-only");
  await page.locator("#ytms-cancel-panel").click();
  await openInterface(page);
  assert.equal(await titleToggle.isChecked(), true);
  await titleToggle.uncheck();
  await page.locator("#ytms-save-preview").click();
  assert.equal(await page.locator("#fixture-title-button").isVisible(), true);
  await page.reload();
  await healthy(page);
  await page.evaluate(installTitleFixture, {});
  assert.equal(await page.locator("#fixture-title-button").isVisible(), false);
  await assertReplacementContent(page);
  await openInterface(page);
  assert.equal(await titleToggle.isChecked(), false);
  assert.equal(await page.locator("#ytms-showDeArrowQueueButton").isChecked(), true);
});

test("saved title visibility is independent of the existing queue-logo setting", async t => {
  const page = await openFixture(t, { showDeArrowTitleButton: true, showDeArrowQueueButton: false });
  for (const reload of [false, true]) {
    if (reload) { await page.reload(); await healthy(page); }
    await page.evaluate(installTitleFixture, {});
    assert.equal(await page.locator("#fixture-title-button").isVisible(), true);
    assert.equal(await page.locator("#fixture-queue-button").isVisible(), false);
    assert.equal(await page.locator("#fixture-queue-row .cbCustomTitle").isVisible(), true);
    assert.equal(await page.locator("#fixture-queue-title").evaluate(el => getComputedStyle(el).paddingInlineEnd), "0px");
    await assertReplacementContent(page);
  }
});

function installChatFixture() {
  document.getElementById("fixture-chat-actions")?.remove();
  const root = document.createElement("div");
  root.id = "fixture-chat-actions";
  const menu = document.createElement("ytd-menu-renderer");
  menu.id = "fixture-actions-menu";
  const button = (id, className, text, parent) => {
    const el = document.createElement("button");
    el.id = id; el.className = className; el.textContent = text;
    parent.append(el);
    return el;
  };
  button("fixture-chat-exact", "you-chat-entrypoint-button ytd-menu-renderer style-scope ytSpecButtonViewModelHost", "Ask exact classes", menu);
  button("fixture-chat-semantic", "you-chat-entrypoint-button", "Ask without decorative classes", menu);
  button("fixture-native-share", "style-scope ytd-menu-renderer ytSpecButtonViewModelHost", "Share", menu);
  root.append(menu);
  button("fixture-chat-compound", "you-chat-entrypoint-button ytd-menu-renderer", "Ask portalled menu", root);
  button("fixture-nonmenu-chat", "you-chat-entrypoint-button", "Not a menu entrypoint", root);
  const liveChat = document.createElement("ytd-live-chat-frame");
  liveChat.id = "fixture-live-chat";
  liveChat.textContent = "Live chat remains independently controlled";
  liveChat.style.display = "block";
  liveChat.style.minHeight = "24px";
  root.append(liveChat);
  document.querySelector("ytd-watch-metadata").append(root);
}

async function assertChatFilters(page) {
  for (const id of ["fixture-chat-exact", "fixture-chat-semantic", "fixture-chat-compound"]) {
    assert.equal(await page.locator(`#${id}`).isVisible(), false, id);
    assert.equal(await page.locator(`#${id}`).evaluate(el => getComputedStyle(el).display), "none", id);
  }
  for (const id of ["fixture-native-share", "fixture-nonmenu-chat", "fixture-live-chat"])
    assert.equal(await page.locator(`#${id}`).isVisible(), true, id);
}

test("Ask cleanup matches semantic menu classes without hiding unrelated buttons or enabled live chat", async t => {
  const page = await openFixture(t);
  await page.evaluate(installChatFixture);
  await assertChatFilters(page);
  await page.locator("#fixture-native-share").evaluate(button => {
    button.addEventListener("click", () => button.dataset.clicked = "true");
    button.click();
  });
  assert.equal(await page.locator("#fixture-native-share").getAttribute("data-clicked"), "true");
});

test("Ask cleanup also covers late class additions and replaced menu nodes", async t => {
  const page = await openFixture(t);
  await page.evaluate(installChatFixture);
  await page.locator("#fixture-chat-semantic").evaluate(button => { button.className = "newDecorativeClass"; });
  assert.equal(await page.locator("#fixture-chat-semantic").isVisible(), true);
  await page.locator("#fixture-chat-semantic").evaluate(button => button.classList.add("you-chat-entrypoint-button"));
  assert.equal(await page.locator("#fixture-chat-semantic").isVisible(), false);
  await page.evaluate(installChatFixture);
  await assertChatFilters(page);
});
