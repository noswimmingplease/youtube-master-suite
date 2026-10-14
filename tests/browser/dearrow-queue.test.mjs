import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { after, before, test } from "node:test";
import { launchFixtureBrowser, waitForSuiteHealth } from "./fixture-browser.mjs";

const SOURCE = readFileSync(new URL("../../sources/modules/youtube-watch-layout-cleaner.user.js", import.meta.url), "utf8");
const SUITE = readFileSync(new URL("../../youtube-master-suite.user.js", import.meta.url), "utf8");
const MANIFEST = JSON.parse(readFileSync(new URL("../../release-manifest.json", import.meta.url), "utf8"));
const FIXTURE = readFileSync(new URL("./dearrow-queue-page.html", import.meta.url), "utf8");
const WATCH_URL = "https://www.youtube.com/watch?v=aaaaaaaaaaa&list=fixture-queue";
const HOME_URL = "https://www.youtube.com/";
const KEY = "yt-master-suite.settings.v1";
const start = SOURCE.indexOf("  function buildQueueCompatibilityCss()");
const end = SOURCE.indexOf("\n  function buildCss()", start);
assert.ok(start >= 0 && end > start, "The canonical compatibility CSS builder must be available");
const BUILDER = SOURCE.slice(start, end);
let browser;

before(async () => { browser = await launchFixtureBrowser(); }, { timeout: 30000 });
after(async () => { await browser?.close(); }, { timeout: 10000 });

async function openFixture(t, view, { compatibility = true, suite = false, seed, dearrow = true } = {}) {
  const url = view === "desktop" ? WATCH_URL : HOME_URL;
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, serviceWorkers: "block" });
  await context.route("**/*", route => route.request().url() === url
    ? route.fulfill({ contentType: "text/html", body: FIXTURE }) : route.abort());
  if (seed !== undefined) await context.addInitScript(({ key, values }) => {
    if (location.origin !== "https://www.youtube.com" || sessionStorage.getItem("seeded")) return;
    localStorage.setItem(key, JSON.stringify({ version: 1, values })); sessionStorage.setItem("seeded", "1");
  }, { key: KEY, values: seed });
  if (suite) await context.addInitScript({ content: SUITE });
  const page = await context.newPage(); page.setDefaultTimeout(8000);
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  t.after(async () => {
    try {
      assert.deepEqual(errors, [], "The compatibility contract fixture must not produce uncaught errors");
      const runtime = await page.getAttribute("html", "data-yt-master-runtime-errors");
      assert.ok(!runtime || runtime === "[]", `Suite runtime errors: ${runtime}`);
    } finally { await context.close(); }
  });
  await page.goto(url);
  if (suite) await waitForSuiteHealth(page, MANIFEST.registeredModules, { timeoutMs: 10000, errors });
  else await page.addScriptTag({ content: `(() => {
    const CONFIG = { showDeArrowQueueButton: true };
    ${BUILDER}
    window.fixture.applyCompatibility = enabled => {
      CONFIG.showDeArrowQueueButton = enabled;
      let style = document.getElementById('fixture-queue-compatibility');
      if (!style) { style = document.createElement('style'); style.id = 'fixture-queue-compatibility'; document.head.append(style); }
      style.textContent = buildQueueCompatibilityCss();
    };
  })();` });
  if (compatibility && !suite) await page.evaluate(() => fixture.applyCompatibility(true));
  if (dearrow) await page.evaluate(() => { fixture.installDeArrow(0); fixture.installDeArrow(1); });
  await page.mouse.move(0, 0);
  return page;
}

function assertStable(before, after, description) {
  for (const key of ["rowHeight", "titleWidth", "titleHeight", "parentWidth"])
    assert.ok(Math.abs(before[key] - after[key]) < 0.5, `${description}: ${key} changed ${before[key]} -> ${after[key]}`);
}

for (const view of ["desktop", "miniplayer"]) {
  test(`${view} dynamic queue reproduces DeArrow hover reflow before the reserved-slot fix`, { timeout: 15000 }, async t => {
    const page = await openFixture(t, view, { compatibility: false });
    // Find a natural wrapping boundary using the fixture font. Unlike fixed-height
    // rows, this must expose the upstream none -> inline width/height regression.
    const boundary = await page.evaluate(() => {
      const row = fixture.items.children[1], title = row.querySelector('.cbCustomTitle');
      const button = row.querySelector('.cbShowOriginal');
      const words = 'Debunking strange theories and explaining the evidence from a surprisingly detailed investigation today'.split(' ');
      for (let length = 5; length <= words.length; length++) {
        title.textContent = words.slice(0, length).join(' ');
        const hidden = fixture.metrics(1);
        button.classList.add('cbDontHide'); const visible = fixture.metrics(1); button.classList.remove('cbDontHide');
        if (visible.rowHeight > hidden.rowHeight + 10 && visible.titleWidth < hidden.titleWidth - 10) return { hidden, visible };
      }
      return null;
    });
    assert.ok(boundary, "The unpatched extension contract must actually change natural row height");
    const before = await page.evaluate(() => fixture.metrics(1));
    assert.equal(before.logoDisplay, "none");
    await page.locator('ytd-playlist-panel-video-renderer').nth(1).hover();
    const hovered = await page.evaluate(() => fixture.metrics(1));
    assert.notEqual(hovered.logoDisplay, "none", "The pinned DeArrow hover selector must be exercised");
    assert.ok(hovered.rowHeight > before.rowHeight + 10);
    assert.ok(hovered.titleWidth < before.titleWidth - 10);
    await page.mouse.move(0, 0);
    await page.evaluate(() => fixture.applyCompatibility(true));
    const fixed = await page.evaluate(() => fixture.metrics(1));
    await page.locator('ytd-playlist-panel-video-renderer').nth(1).hover();
    const fixedHover = await page.evaluate(() => fixture.metrics(1));
    assertStable(fixed, fixedHover, "Reserved queue slot");
    assert.equal(fixed.padding, "25px");
    assert.equal(fixed.logoDisplay, "none");
    assert.notEqual(fixedHover.logoDisplay, "none");
    assert.equal(fixedHover.originalStyle, before.originalStyle, "CSS must not rewrite extension-owned title visibility");
    assert.equal(fixedHover.customStyle, before.customStyle);
  });

  test(`${view} reserves space before late logo insertion and preserves original/custom title controls`, { timeout: 15000 }, async t => {
    const page = await openFixture(t, view, { dearrow: false });
    await page.evaluate(() => fixture.installDeArrow(0, { button: false }));
    const before = await page.evaluate(() => fixture.metrics());
    await page.evaluate(() => fixture.insertButton());
    assertStable(before, await page.evaluate(() => fixture.metrics()), "Late logo insertion");
    const row = page.locator('ytd-playlist-panel-video-renderer').first();
    await row.hover();
    const button = row.locator('.cbShowOriginal');
    await button.click();
    assert.equal(await page.evaluate(() => fixture.toggleClicks), 1);
    assert.equal(await row.locator('#video-title:not(.cbCustomTitle)').isVisible(), true);
    assert.equal(await row.locator('.cbCustomTitle').isVisible(), false);
    await row.locator('#video-title:not(.cbCustomTitle)').click();
    assert.equal(await page.evaluate(() => fixture.titleClicks), 1);
    await button.click();
    assert.equal(await row.locator('.cbCustomTitle').isVisible(), true);
    await row.locator('.cbCustomTitle').click();
    assert.equal(await page.evaluate(() => fixture.titleClicks), 2);
    await row.locator('.native-like').click();
    assert.equal(await page.evaluate(() => fixture.actionClicks), 1, "Neighbouring native controls remain clickable");
    assert.equal(await row.locator('#thumbnail').getAttribute('class'), 'cbCustomThumbnail');
    await page.mouse.move(0, 0);
    assert.equal(await button.isVisible(), false);
    await button.evaluate(button => button.classList.add('cbDontHide'));
    assert.equal(await button.isVisible(), true, "Extension-owned persistent visibility remains effective");
    const persistent = await page.evaluate(() => fixture.metrics());
    await row.hover();
    assertStable(persistent, await page.evaluate(() => fixture.metrics()), "Persistent logo hover");
  });

  test(`${view} reserved logo remains within narrow LTR/RTL titles and outside native controls`, { timeout: 15000 }, async t => {
    const page = await openFixture(t, view);
    for (const direction of ["ltr", "rtl"]) {
      await page.evaluate(direction => {
        fixture.host.style.width = '280px'; fixture.panel.dir = direction;
        fixture.items.firstElementChild.querySelector('.cbShowOriginal').classList.add('cbDontHide');
      }, direction);
      const bounds = await page.evaluate(() => {
        const row = fixture.items.firstElementChild;
        const parent = row.querySelector('.fixture-title-parent').getBoundingClientRect();
        const title = row.querySelector('.cbCustomTitle').getBoundingClientRect();
        const button = row.querySelector('.cbShowOriginal').getBoundingClientRect();
        const action = row.querySelector('.native-like').getBoundingClientRect();
        return { parent: { left: parent.left, right: parent.right }, title: { left: title.left, right: title.right },
          button: { left: button.left, right: button.right, bottom: button.bottom, width: button.width, height: button.height },
          actionTop: action.top,
          hit: document.elementFromPoint(button.x + button.width / 2, button.y + button.height / 2)?.closest('button')?.classList.contains('cbShowOriginal'),
        };
      });
      assert.equal(bounds.button.width, 20); assert.equal(bounds.button.height, 20);
      assert.ok(bounds.button.left >= bounds.parent.left - 0.5 && bounds.button.right <= bounds.parent.right + 0.5);
      assert.ok(direction === "ltr" ? bounds.title.right <= bounds.button.left - 4.5 : bounds.title.left >= bounds.button.right + 4.5,
        `Logo must occupy the reserved inline-end slot in ${direction}`);
      assert.ok(bounds.button.bottom <= bounds.actionTop, "Logo must not cover active-item controls");
      assert.equal(bounds.hit, true, "Pointer hit testing must reach the extension's actual button");
      await page.locator('.native-like').click();
    }
    assert.equal(await page.evaluate(() => fixture.actionClicks), 2);
  });

  test(`${view} native drag clone keeps the same DeArrow title width outside the queue panel`, async t => {
    const page = await openFixture(t, view);
    const before = await page.evaluate(() => {
      const row = fixture.items.firstElementChild;
      const clone = row.cloneNode(true); clone.classList.add('dragging');
      clone.style.width = row.getBoundingClientRect().width + 'px'; clone.style.left = '24px'; clone.style.top = '620px';
      clone.querySelector('.cbShowOriginal').classList.add('cbDontHide'); document.body.append(clone);
      return fixture.metrics();
    });
    const clone = await page.evaluate(() => fixture.metrics(0, true));
    assertStable(before, clone, "Native detached drag clone");
    assert.equal(clone.padding, "25px");
    assert.notEqual(clone.logoDisplay, "none");
    await page.evaluate(() => fixture.applyCompatibility(false));
    assert.equal(await page.evaluate(() => fixture.metrics(0, true).logoDisplay), "none", "Stored hide semantics must include drag clones");
  });

  test(`${view} compatibility does not alter ordinary native queue titles without DeArrow`, async t => {
    const page = await openFixture(t, view, { compatibility: false, dearrow: false });
    const before = await page.evaluate(() => fixture.metrics());
    await page.evaluate(() => fixture.applyCompatibility(true));
    assert.deepEqual(await page.evaluate(() => fixture.metrics()), before);
    await page.evaluate(() => fixture.applyCompatibility(false));
    assert.deepEqual(await page.evaluate(() => fixture.metrics()), before);
    await page.locator('ytd-playlist-panel-video-renderer').first().locator('#video-title').click();
    assert.equal(await page.evaluate(() => fixture.titleClicks), 1);
  });
}

test("the queue-logo preference leaves DeArrow controls outside queue rows untouched", async t => {
  const page = await openFixture(t, "desktop");
  const before = await page.evaluate(() => {
    const outside = document.createElement('div'); outside.id = 'fixture-outside-queue';
    const original = document.createElement('a'); original.id = 'video-title'; original.textContent = 'Original outside queue';
    original.style.setProperty('display', 'none', 'important');
    const custom = original.cloneNode(true); custom.className = 'cbCustomTitle'; custom.textContent = 'Custom outside queue';
    custom.style.setProperty('display', 'block', 'important');
    const button = document.createElement('button'); button.className = 'cbButton cbShowOriginal cbDontHide'; button.textContent = 'DeArrow';
    outside.append(original, custom, button); document.body.append(outside);
    const state = () => ({
      padding: getComputedStyle(outside).paddingInlineEnd,
      buttonDisplay: getComputedStyle(button).display, buttonPosition: getComputedStyle(button).position,
      original: getComputedStyle(original).display, custom: getComputedStyle(custom).display,
    });
    fixture.outsideState = state; return state();
  });
  await page.evaluate(() => fixture.applyCompatibility(false));
  assert.deepEqual(await page.evaluate(() => fixture.outsideState()), before);
  assert.equal(await page.locator('#fixture-outside-queue .cbShowOriginal').isVisible(), true);
  await page.evaluate(() => fixture.applyCompatibility(true));
  assert.deepEqual(await page.evaluate(() => fixture.outsideState()), before);
});

test("generated Suite defaults reserve the queue logo slot in both queue views", { timeout: 30000 }, async t => {
  for (const view of ["desktop", "miniplayer"]) {
    const page = await openFixture(t, view, { suite: true });
    const before = await page.evaluate(() => fixture.metrics());
    assert.equal(before.padding, "25px"); assert.equal(before.logoDisplay, "none");
    await page.locator('ytd-playlist-panel-video-renderer').first().hover();
    const after = await page.evaluate(() => fixture.metrics());
    assertStable(before, after, "Generated default compatibility");
    assert.notEqual(after.logoDisplay, "none");
  }
});

test("generated Suite stored false hides only queue logos and persists after reload", { timeout: 30000 }, async t => {
  for (const view of ["desktop", "miniplayer"]) {
    const page = await openFixture(t, view, { suite: true, seed: { showDeArrowQueueButton: false, theatreMode: false } });
    const row = page.locator('ytd-playlist-panel-video-renderer').first();
    await row.locator('.cbShowOriginal').evaluate(button => button.classList.add('cbDontHide'));
    await row.hover();
    assert.equal(await row.locator('.cbShowOriginal').isVisible(), false);
    assert.equal(await row.locator('.cbCustomTitle').isVisible(), true);
    assert.equal(await row.locator('#thumbnail').getAttribute('class'), 'cbCustomThumbnail');
    assert.equal(await page.evaluate(() => fixture.metrics().padding), '0px');
    await row.locator('.cbCustomTitle').click();
    assert.equal(await page.evaluate(() => fixture.titleClicks), 1);
    await page.reload();
    await waitForSuiteHealth(page, MANIFEST.registeredModules, { timeoutMs: 10000 });
    await page.evaluate(() => fixture.installDeArrow(0));
    await row.hover();
    assert.equal(await row.locator('.cbShowOriginal').isVisible(), false);
    assert.equal(await row.locator('.cbCustomTitle').isVisible(), true);
  }
});

test("Interface setting saves queue-only logo visibility without disabling DeArrow replacements", { timeout: 30000 }, async t => {
  const page = await openFixture(t, "desktop", { suite: true, seed: { theatreMode: false } });
  await page.locator('#ytms-settings-button').click();
  await page.locator('#ytms-tab-interface').click();
  const toggle = page.locator('#ytms-showDeArrowQueueButton');
  assert.equal(await toggle.isChecked(), true);
  await toggle.uncheck();
  assert.equal(await page.evaluate(key => JSON.parse(localStorage.getItem(key)).values.showDeArrowQueueButton, KEY), undefined,
    "Draft changes must not be written before Save");
  await page.locator('#ytms-save-preview').click();
  assert.equal(await page.evaluate(key => JSON.parse(localStorage.getItem(key)).values.showDeArrowQueueButton, KEY), false);
  await page.reload();
  await waitForSuiteHealth(page, MANIFEST.registeredModules, { timeoutMs: 10000 });
  await page.evaluate(() => fixture.installDeArrow());
  const row = page.locator('ytd-playlist-panel-video-renderer').first();
  await row.hover();
  assert.equal(await row.locator('.cbShowOriginal').isVisible(), false);
  assert.equal(await row.locator('.cbCustomTitle').isVisible(), true);
  assert.equal(await row.locator('#thumbnail').getAttribute('class'), 'cbCustomThumbnail');
  await page.locator('#ytms-settings-button').click();
  await page.locator('#ytms-tab-interface').click();
  assert.equal(await toggle.isChecked(), false);
  await toggle.check(); await page.locator('#ytms-save-preview').click();
  await page.reload();
  await waitForSuiteHealth(page, MANIFEST.registeredModules, { timeoutMs: 10000 });
  await page.evaluate(() => fixture.installDeArrow());
  const before = await page.evaluate(() => fixture.metrics());
  await row.hover();
  assertStable(before, await page.evaluate(() => fixture.metrics()), "Re-enabled reserved logo slot");
  assert.equal(await row.locator('.cbShowOriginal').isVisible(), true);
});
