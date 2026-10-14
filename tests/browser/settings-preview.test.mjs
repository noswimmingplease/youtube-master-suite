import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { after, before, test } from "node:test";
import { launchFixtureBrowser } from "./fixture-browser.mjs";

const PREVIEW = readFileSync(new URL("../../examples/settings-preview.html", import.meta.url), "utf8");
const LOGO = readFileSync(new URL("../../assets/YouTube_Master_Suite_Logo.svg", import.meta.url), "utf8");
const PREVIEW_URL = "https://www.youtube.com/suite-settings-preview";
const LOGO_URL = "https://www.youtube.com/assets/YouTube_Master_Suite_Logo.svg";
let browser;
before(async () => { browser = await launchFixtureBrowser(); }, { timeout: 30000 });
after(async () => { await browser?.close(); }, { timeout: 10000 });

async function openPreview(t, viewport = { width: 1280, height: 900 }) {
  const context = await browser.newContext({ viewport, serviceWorkers: "block" });
  await context.route("**/*", route => {
    const url = route.request().url();
    if (url === PREVIEW_URL) return route.fulfill({ contentType: "text/html", body: PREVIEW });
    if (url === LOGO_URL) return route.fulfill({ contentType: "image/svg+xml", body: LOGO });
    return route.abort();
  });
  const page = await context.newPage();
  page.setDefaultTimeout(5000);
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  t.after(async () => { try { assert.deepEqual(errors, []); } finally { await context.close(); } });
  await page.goto(PREVIEW_URL);
  await page.getByRole("button", { name: "Suite settings", exact: true }).click();
  return page;
}

test("supplied vector logo renders at 32px inside the 40px profile-adjacent button", async t => {
  const page = await openPreview(t);
  await page.locator("#cancel-panel").click();
  const img = page.locator("#suite-settings img");
  await img.evaluate(async image => { await image.decode(); });
  const imageBox = await img.boundingBox();
  const buttonBox = await page.locator("#suite-settings").boundingBox();
  assert.equal(imageBox.width, 32);
  assert.equal(imageBox.height, 32);
  assert.equal(buttonBox.width, 40);
  assert.equal(buttonBox.height, 40);
  assert.equal(imageBox.x - buttonBox.x, 4);
  assert.equal(imageBox.y - buttonBox.y, 4);
  assert.equal(await page.locator("#suite-settings").evaluate(button => button.nextElementSibling.classList.contains("avatar")), true);
  assert.equal(/<image\b/.test(LOGO), false, "Use vector paths, not an embedded bitmap");
});

test("settings preview preserves existing default comment colours", async t => {
  const page = await openPreview(t);
  assert.equal(await page.locator("#colour-mode").inputValue(), "default");
  assert.equal(await page.locator(".viewer").evaluate(el => getComputedStyle(el).color), "rgb(130, 163, 230)");
  assert.equal(await page.locator(".owner").evaluate(el => getComputedStyle(el).color), "rgb(255, 159, 28)");
  assert.equal(await page.locator("#compactComments").isChecked(), true);
  assert.equal(await page.locator("#hideCommentControls").isChecked(), true);
  assert.equal(await page.locator("#custom-colours").isVisible(), false);
});

test("in-panel picker is dark, uses native keyboard sliders and has no system colour popup", async t => {
  const page = await openPreview(t);
  await page.locator("#colour-mode").selectOption("custom");
  await page.locator("#viewer-swatch").click();
  assert.equal(await page.locator("#colour-picker").evaluate(el => getComputedStyle(el).backgroundColor), "rgb(24, 24, 24)");
  assert.equal(await page.locator("#red").evaluate(el => getComputedStyle(el).colorScheme), "dark");
  assert.equal(await page.locator('input[type="color"]').count(), 0);
  await page.keyboard.press("ArrowRight");
  assert.equal(await page.locator("#viewer-hex").inputValue(), "#83A3E6");
  await page.keyboard.press("Escape");
  assert.equal(await page.locator("#colour-picker").isVisible(), false);
  assert.equal(await page.locator("#settings-dialog").isVisible(), true);
  assert.equal(await page.evaluate(() => document.activeElement.id), "viewer-swatch");
});

test("hex validation rejects invalid input and picker edits safely replace it", async t => {
  const page = await openPreview(t);
  await page.locator("#colour-mode").selectOption("custom");
  await page.locator("#viewer-hex").fill("#zzzzzz");
  assert.equal(await page.locator("#viewer-error").isVisible(), true);
  assert.equal(await page.locator("#save-preview").isDisabled(), true);
  assert.equal(await page.locator(".viewer").evaluate(el => getComputedStyle(el).color), "rgb(130, 163, 230)");
  await page.locator("#viewer-swatch").click();
  await page.keyboard.press("ArrowRight");
  assert.equal(await page.locator("#viewer-error").isVisible(), false);
  assert.equal(await page.locator("#save-preview").isDisabled(), false);
  await page.locator("#owner-hex").fill("00695c");
  assert.equal(await page.locator(".owner").evaluate(el => getComputedStyle(el).color), "rgb(0, 105, 92)");
});

test("preview Save is memory-only and page reload restores original defaults", async t => {
  const page = await openPreview(t);
  await page.locator("#colour-mode").selectOption("custom");
  await page.locator("#viewer-hex").fill("#ABCDEF");
  await page.locator("#save-preview").click();
  await page.locator("#suite-settings").click();
  assert.equal(await page.locator("#viewer-hex").inputValue(), "#ABCDEF");
  assert.equal(await page.evaluate(() => localStorage.length), 0);
  await page.reload();
  assert.equal(await page.locator("#settings-dialog").isVisible(), false);
  await page.locator("#suite-settings").click();
  assert.equal(await page.locator("#colour-mode").inputValue(), "default");
  assert.equal(await page.locator("#viewer-hex").inputValue(), "#82A3E6");
});

test("Off removes preview name and badge overrides without changing other settings", async t => {
  const page = await openPreview(t);
  await page.locator("#colour-mode").selectOption("off");
  assert.equal(await page.locator(".viewer").evaluate(el => getComputedStyle(el).color), "rgb(241, 241, 241)");
  assert.equal(await page.locator(".owner").evaluate(el => getComputedStyle(el).color), "rgb(241, 241, 241)");
  assert.equal(await page.locator(".pin").evaluate(el => getComputedStyle(el).color), "rgb(170, 170, 170)");
  assert.equal(await page.locator("#compactComments").isChecked(), true);
  assert.equal(await page.locator("#hideCommentControls").isChecked(), true);
});

test("preset palettes adapt to light theme while default colours stay exact", async t => {
  const page = await openPreview(t);
  await page.locator("#cancel-panel").click();
  await page.locator("#theme-toggle").click();
  await page.locator("#suite-settings").click();
  assert.equal(await page.locator(".viewer").evaluate(el => getComputedStyle(el).color), "rgb(130, 163, 230)");
  assert.equal(await page.locator("#contrast-warning").isVisible(), true);
  await page.locator("#colour-mode").selectOption("preset");
  for (const palette of ["teal-coral", "lavender-gold", "cyan-rose"]) {
    await page.locator("#palette").selectOption(palette);
    assert.equal(await page.locator("#contrast-warning").isVisible(), false);
  }
  assert.equal(await page.locator("#settings-dialog").evaluate(el => getComputedStyle(el).backgroundColor), "rgb(255, 255, 255)");
});

test("keyboard sections, Cancel and Restore defaults do not commit unintended changes", async t => {
  const page = await openPreview(t);
  await page.keyboard.press("ArrowRight");
  assert.equal(await page.evaluate(() => document.activeElement.id), "tab-feed");
  await page.locator("#hideShorts").uncheck();
  await page.locator("#cancel-panel").click();
  await page.locator("#suite-settings").click();
  await page.getByRole("tab", { name: "Feed", exact: true }).click();
  assert.equal(await page.locator("#hideShorts").isChecked(), true);
  await page.getByRole("tab", { name: "Comments", exact: true }).click();
  await page.locator("#colour-mode").selectOption("custom");
  await page.locator("#owner-hex").fill("#112233");
  await page.locator("#restore-defaults").click();
  assert.equal(await page.locator("#colour-mode").inputValue(), "default");
  assert.equal(await page.locator("#owner-hex").inputValue(), "#FF9F1C");
  await page.keyboard.press("Escape");
  assert.equal(await page.locator("#settings-dialog").isVisible(), false);
});

test("settings and in-panel picker stay within a narrow window", async t => {
  const page = await openPreview(t, { width: 375, height: 720 });
  await page.locator("#colour-mode").selectOption("custom");
  await page.locator("#owner-swatch").click();
  const box = await page.locator("#settings-dialog").boundingBox();
  assert.ok(box && box.x >= 0 && box.y >= 0 && box.x + box.width <= 375 && box.y + box.height <= 720);
  assert.equal(await page.locator(".content").evaluate(el => el.scrollWidth <= el.clientWidth), true);
  await page.locator("#save-preview").click();
  assert.equal(await page.locator("#settings-dialog").isVisible(), false);
});
