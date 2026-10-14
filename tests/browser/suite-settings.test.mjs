import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { after, before, test } from "node:test";
import { launchFixtureBrowser, waitForSuiteHealth } from "./fixture-browser.mjs";

const SUITE = readFileSync(new URL("../../youtube-master-suite.user.js", import.meta.url), "utf8");
const MANIFEST = JSON.parse(readFileSync(new URL("../../release-manifest.json", import.meta.url), "utf8"));
const FIXTURE = readFileSync(new URL("./watch-page.html", import.meta.url), "utf8");
const WATCH_URL = "https://www.youtube.com/watch?v=aaaaaaaaaaa&list=fixture-queue";
const KEY = "yt-master-suite.settings.v1";
let browser;
before(async () => { browser = await launchFixtureBrowser(); }, { timeout: 30000 });
after(async () => { await browser?.close(); }, { timeout: 10000 });

async function openFixture(t, seed, viewport = { width: 1280, height: 900 }, strictTrustedTypes = false) {
  const context = await browser.newContext({ viewport, serviceWorkers: "block" });
  await context.route("**/*", route => route.request().url().startsWith("https://www.youtube.com/watch?")
    ? route.fulfill({ contentType: "text/html", body: FIXTURE,
      headers: strictTrustedTypes ? { 'Content-Security-Policy': "require-trusted-types-for 'script'; trusted-types 'none'" } : {},
    }) : route.abort());
  if (seed !== undefined) await context.addInitScript(({ key, raw }) => {
    if (window.location.origin !== "https://www.youtube.com") return;
    if (!sessionStorage.getItem("seeded")) {
      localStorage.setItem(key, raw); sessionStorage.setItem("seeded", "1");
    }
  }, { key: KEY, raw: typeof seed === "string" ? seed : JSON.stringify({ version: 1, values: seed }) });
  await context.addInitScript({ content: SUITE });
  const page = await context.newPage();
  page.setDefaultTimeout(7000);
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  t.after(async () => {
    try {
      assert.deepEqual(errors, []);
      const runtime = await page.getAttribute("html", "data-yt-master-runtime-errors");
      assert.ok(!runtime || runtime === "[]", runtime);
    } finally { await context.close(); }
  });
  await page.goto(WATCH_URL);
  await healthy(page, errors);
  return page;
}
async function healthy(page, errors = []) {
  await waitForSuiteHealth(page, MANIFEST.registeredModules, { timeoutMs: 7000, errors });
}
async function openPanel(page) { await page.locator("#ytms-settings-button").click(); }
async function colour(page, selector) { return page.locator(selector).evaluate(el => getComputedStyle(el).color); }

test("integrated logo is embedded, correctly sized and adjacent to the profile; panel is lazy", async t => {
  const page = await openFixture(t);
  assert.equal(await page.locator("#ytms-settings-dialog").count(), 0);
  const img = page.locator("#ytms-settings-button img");
  await img.evaluate(async image => image.decode());
  assert.ok((await img.getAttribute("src")).startsWith("data:image/svg+xml;base64,"));
  const imageBox = await img.boundingBox(), buttonBox = await page.locator("#ytms-settings-button").boundingBox();
  assert.equal(imageBox.width, 32); assert.equal(imageBox.height, 32);
  assert.equal(buttonBox.width, 40); assert.equal(buttonBox.height, 40);
  assert.equal(imageBox.x - buttonBox.x, 4); assert.equal(imageBox.y - buttonBox.y, 4);
  assert.equal(await page.locator("#ytms-settings-button").evaluate(el => el.nextElementSibling.id), "avatar-btn");
  await openPanel(page);
  assert.equal(await colour(page, "#ytms-comment-preview .viewer"), "rgb(130, 163, 230)");
  assert.equal(await colour(page, "#ytms-comment-preview .owner"), "rgb(255, 159, 28)");
  assert.equal(await page.locator("#ytms-settings-dialog").evaluate(el => getComputedStyle(el).backgroundColor), "rgb(33, 33, 33)");
});

test("monochrome player shortcut sits before Mirror and opens the same panel without claiming playback clicks", async t => {
  // Isolate the shortcut from the separate preference's synthetic theatre-button click.
  const page = await openFixture(t, { theatreMode: false });
  const button = page.locator('#ytms-player-settings-button');
  await button.waitFor();
  assert.equal(await button.evaluate(el => el.nextElementSibling.id), 'ytppl-video-mirror-button');
  assert.equal(await button.evaluate(el => el.previousElementSibling.className), 'ytp-settings-button ytp-button');
  assert.equal(await button.getAttribute('title'), null);
  const image = button.locator('img');
  await image.evaluate(img => img.decode());
  assert.ok((await image.getAttribute('src')).startsWith('data:image/svg+xml;base64,'));
  const imageBox = await image.boundingBox(), mirrorBox = await page.locator('#ytppl-video-mirror-button svg').boundingBox();
  assert.equal(imageBox.width, mirrorBox.width); assert.equal(imageBox.height, mirrorBox.height);
  const before = await page.evaluate(() => {
    window.playerSettingsClicks = [];
    document.querySelector('#movie_player').addEventListener('click', event => window.playerSettingsClicks.push({ id: event.target.id, className: event.target.className, trusted: event.isTrusted }));
    const video = document.querySelector('video');
    return [video.currentTime, video.paused, video.volume];
  });
  await button.hover();
  const tooltip = page.locator('#ytms-player-settings-tooltip');
  await tooltip.waitFor({ state: 'visible' });
  assert.deepEqual(await tooltip.evaluate(el => ({
    text: el.textContent,
    background: getComputedStyle(el).backgroundColor,
    shortcuts: el.querySelectorAll('kbd').length,
  })), { text: 'Suite settings', background: 'rgba(0, 0, 0, 0.9)', shortcuts: 0 });
  await button.click();
  assert.equal(await page.locator('#ytms-settings-dialog').isVisible(), true);
  assert.equal(await tooltip.count(), 0);
  assert.deepEqual(await page.evaluate(() => window.playerSettingsClicks), []);
  assert.deepEqual(await page.evaluate(() => { const video = document.querySelector('video'); return [video.currentTime, video.paused, video.volume]; }), before);
  await page.locator('#ytms-cancel-panel').click();
  await openPanel(page);
  assert.equal(await page.locator('#ytms-settings-dialog').count(), 1);
  assert.equal(await page.locator('#ytms-settings-button').count(), 1);
});

test("player tooltip remains visible and repositions on synthetic resize without reopening after dismissal", async t => {
  const page = await openFixture(t, { theatreMode: false });
  const button = page.locator('#ytms-player-settings-button');
  await button.hover();
  const hover = await button.evaluate(button => {
    // Pair creation and resize synchronously: startup layout refreshes must not
    // race the observation being tested. The pointer is genuinely over the button.
    button.dispatchEvent(new MouseEvent('mouseenter'));
    const initial = document.getElementById('ytms-player-settings-tooltip');
    const initiallyVisible = Boolean(initial?.isConnected && getComputedStyle(initial).display !== 'none');
    const beforeLeft = initial ? Number.parseFloat(initial.style.left) : null;
    const hovered = button.matches(':hover');
    button.style.transform = 'translateX(-8px)';
    window.dispatchEvent(new Event('resize'));
    const refreshed = document.getElementById('ytms-player-settings-tooltip');
    const result = {
      hovered,
      initiallyVisible,
      remainsVisible: Boolean(refreshed?.isConnected && getComputedStyle(refreshed).display !== 'none'),
      leftChange: refreshed ? Number.parseFloat(refreshed.style.left) - beforeLeft : null,
      described: button.getAttribute('aria-describedby'),
    };
    button.style.transform = '';
    return result;
  });
  assert.deepEqual(hover, {
    hovered: true, initiallyVisible: true, remainsVisible: true,
    leftChange: -8, described: 'ytms-player-settings-tooltip',
  });

  await page.mouse.move(0, 0);
  await page.keyboard.press('Tab');
  const focus = await button.evaluate(button => {
    button.focus();
    const initial = document.getElementById('ytms-player-settings-tooltip');
    const initiallyVisible = Boolean(initial?.isConnected && getComputedStyle(initial).display !== 'none');
    const beforeTop = initial ? Number.parseFloat(initial.style.top) : null;
    const focused = document.activeElement === button;
    const hovered = button.matches(':hover');
    button.style.transform = 'translateY(-8px)';
    window.dispatchEvent(new Event('resize'));
    const refreshed = document.getElementById('ytms-player-settings-tooltip');
    const result = {
      focused, hovered,
      initiallyVisible,
      remainsVisible: Boolean(refreshed?.isConnected && getComputedStyle(refreshed).display !== 'none'),
      topChange: refreshed ? Number.parseFloat(refreshed.style.top) - beforeTop : null,
    };
    // Window blur dismisses the tooltip without changing the DOM's focused
    // element. A later resize must not reopen it merely because focus remains.
    window.dispatchEvent(new Event('blur'));
    result.dismissed = !document.getElementById('ytms-player-settings-tooltip');
    window.dispatchEvent(new Event('resize'));
    result.staysDismissed = !document.getElementById('ytms-player-settings-tooltip');
    result.described = button.getAttribute('aria-describedby');
    button.style.transform = '';
    return result;
  });
  assert.deepEqual(focus, {
    focused: true, hovered: false, initiallyVisible: true, remainsVisible: true,
    topChange: -8, dismissed: true, staysDismissed: true, described: null,
  });
});

test("player settings tooltip dismisses on missed pointer exit, hidden controls and modal return focus", async t => {
  const page = await openFixture(t, { theatreMode: false });
  const button = page.locator('#ytms-player-settings-button');
  const tooltip = page.locator('#ytms-player-settings-tooltip');
  await button.hover();
  await tooltip.waitFor({ state: 'visible' });
  await page.evaluate(() => document.body.dispatchEvent(new PointerEvent('pointermove', { bubbles: true })));
  assert.equal(await tooltip.count(), 0, 'outside movement must dismiss even without mouseleave');
  assert.equal(await button.getAttribute('aria-describedby'), null);

  for (const name of ['pointerdown', 'pointercancel', 'scroll']) {
    await button.evaluate(button => button.dispatchEvent(new MouseEvent('mouseenter')));
    await tooltip.waitFor({ state: 'visible' });
    await page.evaluate(name => document.dispatchEvent(new Event(name)), name);
    assert.equal(await tooltip.count(), 0, name);
  }
  await button.evaluate(button => button.dispatchEvent(new MouseEvent('mouseenter')));
  await tooltip.waitFor({ state: 'visible' });
  await page.locator('#movie_player').evaluate(player => player.classList.add('ytp-autohide'));
  await tooltip.waitFor({ state: 'detached' });
  await button.evaluate(button => button.dispatchEvent(new MouseEvent('mouseenter')));
  assert.equal(await tooltip.count(), 0, 'autohidden controls must not open tooltips');
  await page.locator('#movie_player').evaluate(player => player.classList.remove('ytp-autohide'));

  for (const property of ['opacity', 'visibility', 'display']) {
    await button.evaluate(button => button.dispatchEvent(new MouseEvent('mouseenter')));
    await tooltip.waitFor({ state: 'visible' });
    await page.locator('.ytp-right-controls').evaluate((controls, property) => {
      controls.style[property] = property === 'opacity' ? '0' : property === 'visibility' ? 'hidden' : 'none';
    }, property);
    await tooltip.waitFor({ state: 'detached' });
    await page.locator('.ytp-right-controls').evaluate((controls, property) => { controls.style[property] = ''; }, property);
  }

  await button.click();
  await page.locator('#ytms-settings-dialog').waitFor({ state: 'visible' });
  await page.mouse.move(0, 0);
  await page.locator('#ytms-settings-dialog').evaluate(dialog => dialog.close());
  assert.equal(await page.evaluate(() => document.activeElement.id), 'ytms-player-settings-button');
  assert.equal(await button.evaluate(button => button.matches(':focus-visible')), false);
  assert.equal(await tooltip.count(), 0, 'pointer-origin modal focus return must not reopen hover text');
  await page.keyboard.press('Tab');
  await button.focus();
  await tooltip.waitFor({ state: 'visible' });
  await page.keyboard.press('Escape');
  assert.equal(await tooltip.count(), 0);
  await page.evaluate(() => window.dispatchEvent(new Event('resize')));
  assert.equal(await tooltip.count(), 0, 'resize must not revive a dismissed focused tooltip');
});

for (const [name, buttonId, tooltipId] of [
  ['Suite settings', 'ytms-player-settings-button', 'ytms-player-settings-tooltip'],
  ['Mirror video', 'ytppl-video-mirror-button', 'ytppl-video-mirror-tooltip'],
  ['restored Miniplayer', 'tmk-miniplayer-button', 'tmk-miniplayer-tooltip'],
]) {
  test(`${name} tooltip follows pointer, keyboard and hidden-control lifecycle in the integrated suite`, async t => {
    const page = await openFixture(t, { theatreMode: false });
    if (buttonId === 'tmk-miniplayer-button') {
      await page.locator('.ytp-miniplayer-button').evaluate(button => button.remove());
    }
    const button = page.locator(`#${buttonId}`), tooltip = page.locator(`#${tooltipId}`);
    await button.waitFor();
    for (let repeat = 0; repeat < 3; repeat++) {
      await page.mouse.move(0, 0);
      await button.hover();
      await tooltip.waitFor({ state: 'visible' });
      assert.equal(await tooltip.count(), 1);
      const resize = await button.evaluate((button, tooltipId) => {
        const initial = document.getElementById(tooltipId);
        const left = Number.parseFloat(initial.style.left);
        button.style.transform = 'translateX(-8px)';
        window.dispatchEvent(new Event('resize'));
        const current = document.getElementById(tooltipId);
        const result = { sameNode: initial === current,
          leftChange: current ? Number.parseFloat(current.style.left) - left : null };
        button.style.transform = '';
        window.dispatchEvent(new Event('resize'));
        return result;
      }, tooltipId);
      assert.deepEqual(resize, { sameNode: true, leftChange: -8 });
      const box = await button.boundingBox();
      await button.locator('svg, img').evaluate((icon, box) => icon.dispatchEvent(new PointerEvent('pointermove', {
        bubbles: true, clientX: box.x + box.width / 2, clientY: box.y + box.height / 2,
      })), box);
      assert.equal(await tooltip.count(), 1, 'moving between icon parts must not dismiss');
      await page.evaluate(() => document.body.dispatchEvent(new PointerEvent('pointermove', { bubbles: true })));
      assert.equal(await tooltip.count(), 0, 'missed mouseleave must not retain hover text');
      assert.equal(await button.getAttribute('aria-describedby'), null);
    }
    for (const type of ['pointercancel', 'pointerdown', 'scroll']) {
      await page.mouse.move(0, 0); await button.hover();
      await tooltip.waitFor({ state: 'visible' });
      await page.evaluate(type => document.dispatchEvent(new Event(type)), type);
      assert.equal(await tooltip.count(), 0, type);
    }
    await page.mouse.move(0, 0); await button.hover();
    await tooltip.waitFor({ state: 'visible' });
    await page.locator('#movie_player').evaluate(player => player.classList.add('ytp-autohide'));
    await tooltip.waitFor({ state: 'detached' });
    await page.locator('#movie_player').evaluate(player => player.classList.remove('ytp-autohide'));
    assert.equal(await tooltip.count(), 0, 'revealing controls must not reopen dismissed text');
    await page.mouse.move(0, 0);
    await page.keyboard.press('Tab'); await button.focus();
    await tooltip.waitFor({ state: 'visible' });
    assert.equal(await button.evaluate(button => button.matches(':focus-visible')), true);
    await page.keyboard.press('Escape');
    assert.equal(await tooltip.count(), 0);
    await page.evaluate(() => window.dispatchEvent(new Event('resize')));
    assert.equal(await tooltip.count(), 0, 'resize must not reopen focused but dismissed text');
  });
}

test("player shortcut ordering settles after control replacement and mirror recreation", async t => {
  const page = await openFixture(t);
  await page.locator('#ytms-player-settings-button').waitFor();
  await page.evaluate(() => {
    const old = document.querySelector('.ytp-right-controls'), next = old.cloneNode(true);
    next.querySelector('#ytms-player-settings-button').remove();
    next.querySelector('#ytppl-video-mirror-button').remove();
    old.replaceWith(next);
  });
  await page.waitForFunction(() => document.querySelector('#ytms-player-settings-button')?.nextElementSibling?.id === 'ytppl-video-mirror-button');
  await page.evaluate(async () => {
    const controls = document.querySelector('.ytp-right-controls');
    window.settingsControlMutations = 0;
    const observer = new MutationObserver(records => window.settingsControlMutations += records.length);
    observer.observe(controls, { childList: true, subtree: true });
    for (let count = 0; count < 12; count++) await new Promise(requestAnimationFrame);
    observer.disconnect();
  });
  assert.equal(await page.evaluate(() => window.settingsControlMutations), 0, 'The two modules must not continuously reorder their controls');
  assert.equal(await page.locator('#ytms-player-settings-button').count(), 1);
  assert.equal(await page.locator('#ytppl-video-mirror-button').count(), 1);
  await page.locator('#ytms-player-settings-button').focus();
  await page.keyboard.press('Enter');
  assert.equal(await page.locator('#ytms-settings-dialog').isVisible(), true);
  await page.locator('#ytms-cancel-panel').click();
  await page.locator('#next-video').click();
  await page.waitForFunction(() => document.querySelector('#ytms-player-settings-button')?.nextElementSibling?.id === 'ytppl-video-mirror-button');
});

test("player shortcut remains available with Mirror disabled and the masthead removed", async t => {
  const page = await openFixture(t, { mirrorButton: false });
  await page.locator('#ytms-player-settings-button').waitFor();
  await page.evaluate(() => document.querySelector('ytd-masthead').remove());
  const button = page.locator('#ytms-player-settings-button');
  assert.equal(await button.evaluate(el => el.nextElementSibling.className), 'ytp-size-button ytp-button');
  await button.focus(); await page.keyboard.press('Space');
  assert.equal(await page.locator('#ytms-settings-dialog').isVisible(), true);
  assert.equal(await page.locator('#ytppl-video-mirror-button').count(), 0);
});

test("player shortcut opens its modal without leaving native page or player fullscreen", async t => {
  const page = await openFixture(t);
  for (const selector of ['#page-fullscreen', '.ytp-fullscreen-button']) {
    await page.locator(selector).click();
    await page.waitForFunction(() => Boolean(document.fullscreenElement));
    await page.locator('#ytms-player-settings-button').click();
    assert.equal(await page.locator('#ytms-settings-dialog').isVisible(), true);
    assert.equal(await page.evaluate(() => Boolean(document.fullscreenElement)), true);
    await page.locator('#ytms-cancel-panel').click();
    await page.evaluate(() => document.exitFullscreen());
  }
});

test("Save persists validated custom colours but applies them only after reload", async t => {
  const page = await openFixture(t);
  await openPanel(page);
  await page.locator("#ytms-colour-mode").selectOption("custom");
  await page.locator("#ytms-viewer-hex").fill("abcdef");
  await page.locator("#ytms-owner-hex").fill("#FEDCBA");
  await page.locator("#ytms-save-preview").click();
  assert.equal(await page.locator("#ytms-reload-now").isVisible(), true);
  assert.equal(await colour(page, ".fixture-viewer"), "rgb(130, 163, 230)");
  assert.equal(await page.evaluate(key => JSON.parse(localStorage.getItem(key)).values.viewerColour, KEY), "#ABCDEF");
  await page.locator("#ytms-cancel-panel").click();
  await page.reload(); await healthy(page);
  await page.waitForFunction(() => getComputedStyle(document.querySelector(".fixture-owner")).color === "rgb(254, 220, 186)");
  assert.equal(await colour(page, ".fixture-viewer"), "rgb(171, 205, 239)");
  assert.equal(await colour(page, "ytd-author-comment-badge-renderer"), "rgb(254, 220, 186)");
  assert.equal(await colour(page, "ytd-pinned-comment-badge-renderer"), "rgb(254, 220, 186)");
  assert.equal(await colour(page, ".comment-message"), "rgb(255, 255, 255)");
  await openPanel(page);
  assert.equal(await page.locator("#ytms-viewer-hex").inputValue(), "#ABCDEF");
});

test("Interface controls persist both icon styles, remove either button and prevent settings lockout", async t => {
  const page = await openFixture(t);
  const colourLogo = await page.locator('#ytms-settings-button img').getAttribute('src');
  const monochromeLogo = await page.locator('#ytms-player-settings-button img').getAttribute('src');
  await openPanel(page);
  await page.getByRole('tab', { name: 'Interface', exact: true }).click();
  await page.locator('#ytms-headerSettingsIcon').selectOption('off');
  await page.locator('#ytms-playerSettingsIcon').selectOption('colour');
  await page.locator('#ytms-save-preview').click();
  assert.equal(await page.locator('#ytms-settings-button').count(), 1, 'Saved choices do not change the current page until reload');
  await page.reload(); await healthy(page);
  await page.locator('#ytms-player-settings-button').waitFor();
  assert.equal(await page.locator('#ytms-settings-button').count(), 0);
  assert.equal(await page.locator('#ytms-player-settings-button img').getAttribute('src'), colourLogo);
  await page.locator('#ytms-player-settings-button').click();
  await page.getByRole('tab', { name: 'Interface', exact: true }).click();
  await page.locator('#ytms-playerSettingsIcon').selectOption('off');
  assert.equal(await page.locator('#ytms-save-preview').isDisabled(), true);
  assert.equal(await page.locator('#ytms-button-access-error').isVisible(), true);
  await page.locator('#ytms-headerSettingsIcon').selectOption('monochrome');
  assert.equal(await page.locator('#ytms-save-preview').isEnabled(), true);
  await page.locator('#ytms-save-preview').click();
  await page.reload(); await healthy(page);
  await page.locator('#ytms-settings-button').waitFor();
  assert.equal(await page.locator('#ytms-player-settings-button').count(), 0);
  assert.equal(await page.locator('#ytms-settings-button img').getAttribute('src'), monochromeLogo);
  assert.equal(await page.locator('#ytms-settings-button').getAttribute('data-icon'), 'monochrome');
  await page.evaluate(() => document.documentElement.removeAttribute('dark'));
  assert.equal(await page.locator('#ytms-settings-button img').evaluate(el => getComputedStyle(el).filter), 'brightness(0)');
  await page.evaluate(() => document.documentElement.setAttribute('dark', ''));
  assert.equal(await page.locator('#ytms-settings-button img').evaluate(el => getComputedStyle(el).filter), 'none');
  await openPanel(page);
  await page.getByRole('tab', { name: 'Interface', exact: true }).click();
  await page.locator('#ytms-restore-defaults').click();
  assert.equal(await page.locator('#ytms-headerSettingsIcon').inputValue(), 'colour');
  assert.equal(await page.locator('#ytms-playerSettingsIcon').inputValue(), 'monochrome');
  assert.equal(await page.locator('#ytms-player-settings-button').count(), 0, 'Restore defaults remains draft-only');
});

test("panel dimensions stay fixed across every tab, colour picker, field errors and Save status", async t => {
  const page = await openFixture(t);
  await openPanel(page);
  const dialog = page.locator('#ytms-settings-dialog');
  const bounds = await dialog.boundingBox();
  assert.equal(bounds.width, 640); assert.equal(bounds.height, 720);
  for (const name of ['Feed', 'Player', 'Layout', 'Miniplayer', 'Interface', 'Extensions', 'Credits', 'Comments']) {
    await page.getByRole('tab', { name, exact: true }).click();
    assert.deepEqual(await dialog.boundingBox(), bounds, name);
  }
  await page.locator('#ytms-colour-mode').selectOption('custom');
  await page.locator('#ytms-viewer-swatch').click();
  assert.deepEqual(await dialog.boundingBox(), bounds);
  await page.locator('#ytms-viewer-hex').fill('#bad');
  assert.equal(await page.locator('#ytms-viewer-error').isVisible(), true);
  assert.deepEqual(await dialog.boundingBox(), bounds);
  await page.locator('#ytms-viewer-hex').fill('#82A3E6');
  await page.locator('#ytms-save-preview').click();
  assert.equal(await page.locator('#ytms-settings-status').isVisible(), true);
  assert.deepEqual(await dialog.boundingBox(), bounds);
  assert.equal(await page.locator('#ytms-section-player .row .description').count(), 6);
  assert.equal(await page.locator('#ytms-section-interface .row .description').count(), 3);
});

test("Credits uses the bundled coloured logo and a safe GitHub profile link", async t => {
  const page = await openFixture(t, undefined, undefined, true);
  await openPanel(page);
  await page.getByRole('tab', { name: 'Credits', exact: true }).click();
  const logo = page.locator('#ytms-credits-logo');
  await logo.evaluate(image => image.decode());
  assert.equal(await logo.getAttribute('src'), await page.locator('#ytms-settings-button img').getAttribute('src'));
  const github = page.locator('#ytms-credits-github');
  assert.equal(await github.getAttribute('href'), 'https://github.com/noswimmingplease');
  assert.equal(await github.getAttribute('target'), '_blank');
  assert.equal(await github.getAttribute('rel'), 'noopener noreferrer');
  assert.ok((await page.locator('#ytms-section-credits').innerText()).includes(`Version ${MANIFEST.version}`));
});

test("Extensions lists only four requested companions with embedded logos and safe official links", async t => {
  const page = await openFixture(t, { theatreMode: false }, undefined, true);
  const before = await page.evaluate(() => ({
    storage: { ...localStorage }, playerId: fixture.playerId,
    time: document.querySelector('video').currentTime, paused: document.querySelector('video').paused,
  }));
  const requests = []; page.on('request', request => requests.push(request.url()));
  await openPanel(page);
  const dialog = page.locator('#ytms-settings-dialog'), bounds = await dialog.boundingBox();
  await page.getByRole('tab', { name: 'Extensions', exact: true }).click();
  const section = page.locator('#ytms-section-extensions');
  assert.equal(await section.isVisible(), true);
  assert.deepEqual(await section.locator('h4').allTextContents(), ['Return YouTube Dislike', 'SponsorBlock', 'DeArrow', 'uBlock Origin']);
  const expectedLinks = ['https://returnyoutubedislike.com/install', 'https://sponsor.ajay.app/', 'https://dearrow.ajay.app/', 'https://github.com/gorhill/uBlock'];
  assert.equal(await section.locator('.extension-card').count(), 4);
  assert.equal(await section.locator('input, select, button').count(), 0, 'Recommendations have no install, enable or status controls');
  for (let index = 0; index < 4; index++) {
    const card = section.locator('.extension-card').nth(index);
    const image = card.locator('img');
    await image.evaluate(image => image.decode());
    assert.ok((await image.getAttribute('src')).startsWith('data:image/'));
    assert.equal(await image.evaluate(image => image.naturalWidth > 0), true);
    const imageBounds = await image.boundingBox();
    assert.equal(imageBounds.width, 40); assert.equal(imageBounds.height, 40);
    assert.ok((await card.locator('.extension-details > p').first().textContent()).length > 20);
    const link = card.locator('a');
    assert.equal(await link.getAttribute('href'), expectedLinks[index]);
    assert.equal(await link.getAttribute('target'), '_blank');
    assert.equal(await link.getAttribute('rel'), 'noopener noreferrer');
    assert.ok((await link.getAttribute('aria-label')).includes('opens in a new tab'));
  }
  assert.ok((await section.textContent()).includes('does not check installation status'));
  assert.ok((await section.locator('#ytms-extension-ublock').textContent()).includes('Origin Lite is a separate project'));
  assert.deepEqual(await dialog.boundingBox(), bounds);
  assert.deepEqual(requests, [], 'Opening recommendations must not make external requests');
  assert.deepEqual(await page.evaluate(() => ({
    storage: { ...localStorage }, playerId: fixture.playerId,
    time: document.querySelector('video').currentTime, paused: document.querySelector('video').paused,
  })), before);
});

test("Extensions remains theme-adaptive, keyboard-accessible and contained in a narrow viewport", async t => {
  const page = await openFixture(t, { theatreMode: false }, { width: 360, height: 600 });
  await openPanel(page);
  const dialog = page.locator('#ytms-settings-dialog'), bounds = await dialog.boundingBox();
  await page.getByRole('tab', { name: 'Interface', exact: true }).click();
  await page.keyboard.press('ArrowRight');
  assert.equal(await page.evaluate(() => document.activeElement.id), 'ytms-tab-extensions');
  assert.equal(await page.locator('#ytms-section-extensions').isVisible(), true);
  const content = page.locator('#ytms-settings-dialog .content');
  for (const dark of [true, false]) {
    await page.evaluate(dark => document.documentElement.toggleAttribute('dark', dark), dark);
    assert.equal(await page.locator('#ytms-extension-ryd .extension-note').evaluate(element => getComputedStyle(element).color), dark ? 'rgb(170, 170, 170)' : 'rgb(96, 96, 96)');
    assert.equal(await page.locator('#ytms-extension-ryd a').evaluate(element => getComputedStyle(element).color), dark ? 'rgb(62, 166, 255)' : 'rgb(6, 95, 212)');
    assert.equal(await content.evaluate(element => element.scrollWidth <= element.clientWidth), true);
    assert.deepEqual(await dialog.boundingBox(), bounds);
  }
  assert.equal(await content.evaluate(element => element.scrollHeight > element.clientHeight), true);
  await content.evaluate(element => element.scrollTop = element.scrollHeight);
  const footer = await dialog.locator('footer').boundingBox();
  assert.ok(footer.y >= bounds.y && footer.y + footer.height <= bounds.y + bounds.height);
  await page.keyboard.press('ArrowRight');
  assert.equal(await page.evaluate(() => document.activeElement.id), 'ytms-tab-credits');
  await page.getByRole('tab', { name: 'Extensions', exact: true }).click();
  assert.equal(await page.locator('#ytms-section-extensions .extension-card').count(), 4);
});

test("fixed panel stays inside a short viewport and scrolls content independently of its footer", async t => {
  const page = await openFixture(t, undefined, { width: 640, height: 400 });
  await openPanel(page);
  const dialog = page.locator('#ytms-settings-dialog'), bounds = await dialog.boundingBox();
  assert.ok(bounds.x >= 0 && bounds.y >= 0 && bounds.x + bounds.width <= 640 && bounds.y + bounds.height <= 400);
  await page.getByRole('tab', { name: 'Feed', exact: true }).click();
  const content = page.locator('#ytms-settings-dialog .content');
  assert.equal(await content.evaluate(el => el.scrollHeight > el.clientHeight), true);
  await content.evaluate(el => el.scrollTop = el.scrollHeight);
  const footer = await page.locator('#ytms-settings-dialog footer').boundingBox();
  assert.ok(footer.y >= bounds.y && footer.y + footer.height <= bounds.y + bounds.height);
  assert.equal(await content.evaluate(el => el.scrollWidth <= el.clientWidth), true);
  assert.deepEqual(await dialog.boundingBox(), bounds);
});

test("Off restores native author styling while queue navigation and comment safeguards remain working", async t => {
  const page = await openFixture(t, { colourMode: "off", hideCommentControls: false, compactComments: false });
  assert.equal(await page.locator(".fixture-viewer").getAttribute("data-iow-colour"), null);
  assert.equal(await page.locator(".fixture-owner").getAttribute("data-iow-colour"), null);
  assert.equal(await page.locator("ytd-comments #like-button").isVisible(), true);
  assert.equal(await page.locator("ytd-comments").isVisible(), true);
  await page.locator("#next-video").click();
  await page.waitForFunction(() => document.querySelector("h1").textContent === "Video B" && !document.querySelector("ytd-comments").hasAttribute("data-iow-stale-video"));
  assert.equal(await page.locator(".comment-message").innerText(), "Comment for Video B");
  assert.equal(await page.locator("ytd-comments").isVisible(), true);
});

test("in-panel dark picker validates hex input and does not leak H to the player's mirror shortcut", async t => {
  const page = await openFixture(t);
  await openPanel(page);
  await page.keyboard.press("h");
  assert.equal(await page.locator("video").getAttribute("data-ytppl-video-mirrored"), null);
  await page.locator("#ytms-colour-mode").selectOption("custom");
  await page.locator("#ytms-viewer-hex").fill("#zzzzzz");
  assert.equal(await page.locator("#ytms-save-preview").isDisabled(), true);
  await page.locator("#ytms-viewer-swatch").click();
  assert.equal(await page.locator("#ytms-colour-picker").evaluate(el => getComputedStyle(el).backgroundColor), "rgb(24, 24, 24)");
  assert.equal(await page.locator("#ytms-red").evaluate(el => getComputedStyle(el).colorScheme), "dark");
  assert.equal(await page.locator('input[type="color"]').count(), 0);
  await page.keyboard.press("ArrowRight");
  assert.equal(await page.locator("#ytms-viewer-hex").inputValue(), "#83A3E6");
  assert.equal(await page.locator("#ytms-save-preview").isDisabled(), false);
  await page.keyboard.press("Escape");
  assert.equal(await page.locator("#ytms-colour-picker").isVisible(), false);
  assert.equal(await page.locator("#ytms-settings-dialog").isVisible(), true);
  await page.keyboard.press("Escape");
  assert.equal(await page.locator("#ytms-settings-dialog").isVisible(), false);
});

test("presets and modal follow live YouTube theme changes without reload", async t => {
  const page = await openFixture(t, { colourMode: "preset", palette: "teal-coral" });
  await page.waitForFunction(() => getComputedStyle(document.querySelector(".fixture-viewer")).color === "rgb(128, 203, 196)");
  await openPanel(page);
  await page.evaluate(() => document.documentElement.removeAttribute("dark"));
  await page.waitForFunction(() => getComputedStyle(document.querySelector(".fixture-viewer")).color === "rgb(0, 105, 92)");
  assert.equal(await colour(page, "#ytms-comment-preview .viewer"), "rgb(0, 105, 92)");
  assert.equal(await page.locator("#ytms-settings-dialog").evaluate(el => getComputedStyle(el).backgroundColor), "rgb(255, 255, 255)");
  assert.equal(await page.locator("#ytms-contrast-warning").isVisible(), false);
});

test("Cancel and Restore defaults are draft-only, and invalid storage does not prevent startup", async t => {
  const page = await openFixture(t, "{");
  await openPanel(page);
  await page.keyboard.press("ArrowRight");
  assert.equal(await page.evaluate(() => document.activeElement.id), "ytms-tab-feed");
  await page.locator("#ytms-hideShorts").uncheck();
  await page.locator("#ytms-cancel-panel").click();
  await openPanel(page);
  await page.getByRole("tab", { name: "Feed", exact: true }).click();
  assert.equal(await page.locator("#ytms-hideShorts").isChecked(), true);
  await page.locator("#ytms-hideShorts").uncheck();
  await page.locator("#ytms-restore-defaults").click();
  assert.equal(await page.locator("#ytms-hideShorts").isChecked(), true);
  assert.equal(await page.evaluate(key => localStorage.getItem(key), KEY), "{");
});

test("settings disabling mirror, theatre and miniplayer apply after reload without removing safeguards", async t => {
  const page = await openFixture(t, { mirrorButton: false, theatreMode: false, miniplayerEnabled: false });
  assert.equal(await page.locator("#ytppl-video-mirror-button").count(), 0);
  assert.equal(await page.locator("ytd-watch-flexy").getAttribute("theater"), null);
  await page.evaluate(() => window.scrollTo(0, 900));
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  assert.equal(await page.locator("body").evaluate(el => el.classList.contains("ytsmp-scroll-miniplayer-active")), false);
  await page.locator("#stalled-next-video").click();
  await page.waitForFunction(() => document.querySelector("h1").textContent === "Video B");
  assert.equal(await page.locator(".comment-message").innerText(), "Comment for Video B");
});

test("masthead replacement, button deletion and suspension restore exactly one settings button", async t => {
  const page = await openFixture(t);
  await page.evaluate(() => {
    const old = document.querySelector("ytd-masthead");
    const next = old.cloneNode(true); next.querySelector("#ytms-settings-button").remove(); old.replaceWith(next);
  });
  await page.locator("#ytms-settings-button").waitFor();
  await page.evaluate(() => document.querySelector("#ytms-settings-button").remove());
  await page.locator("#ytms-settings-button").waitFor();
  await openPanel(page);
  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent("pagehide", { persisted: true })));
  assert.equal(await page.locator("#ytms-settings-dialog").isVisible(), false);
  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true })));
  await openPanel(page);
  assert.equal(await page.locator("#ytms-settings-button").count(), 1);
  assert.equal(await page.locator("#ytms-settings-dialog").count(), 1);
});

test("production panel and picker fit a narrow app window without horizontal content overflow", async t => {
  const page = await openFixture(t, undefined, { width: 375, height: 720 });
  await openPanel(page);
  await page.locator("#ytms-colour-mode").selectOption("custom");
  await page.locator("#ytms-owner-swatch").click();
  const box = await page.locator("#ytms-settings-dialog").boundingBox();
  assert.ok(box && box.x >= 0 && box.y >= 0 && box.x + box.width <= 375 && box.y + box.height <= 720);
  assert.equal(await page.locator("#ytms-settings-dialog .content").evaluate(el => el.scrollWidth <= el.clientWidth), true);
});

test("layout switches restore native related, chat, info-card and end-screen surfaces", async t => {
  const page = await openFixture(t, { hideRelated: false, hideChat: false, hideInfoCards: false, hideEndScreens: false });
  await page.evaluate(() => {
    document.querySelector('#secondary').insertAdjacentHTML('beforeend', '<div id="related">Related content</div><div id="chat-container"><ytd-live-chat-frame id="chat">Chat</ytd-live-chat-frame></div>');
    document.querySelector('#movie_player').insertAdjacentHTML('beforeend', '<button class="ytp-cards-button">Info</button><div class="ytp-ce-element">End-screen tile</div>');
  });
  assert.equal(await page.locator('#related').isVisible(), true);
  assert.equal(await page.locator('#chat').isVisible(), true);
  assert.equal(await page.locator('.ytp-cards-button').isVisible(), true);
  assert.equal(await page.locator('.ytp-ce-element').evaluate(el => getComputedStyle(el).opacity), '1');
});

test("delayed app/masthead discovery works even when neither exists during settings initialisation", async t => {
  const page = await openFixture(t);
  await page.evaluate(() => {
    window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true }));
    const app = document.querySelector('ytd-app'); app.remove();
    window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }));
    document.body.append(app);
  });
  await page.locator('#ytms-settings-button').waitFor();
  await openPanel(page);
  assert.equal(await page.locator('#ytms-settings-dialog').isVisible(), true);
});

test("repeated opens and native navigation events retain one button and one lazily built panel", async t => {
  const page = await openFixture(t);
  await openPanel(page);
  await page.locator('#ytms-cancel-panel').click();
  await page.evaluate(() => {
    for (let count = 0; count < 50; count++) {
      document.querySelector('#ytms-settings-button').click();
      document.querySelector('#ytms-settings-dialog').close();
      window.dispatchEvent(new Event('yt-navigate-finish'));
    }
  });
  assert.equal(await page.locator('#ytms-settings-button').count(), 1);
  assert.equal(await page.locator('#ytms-settings-dialog').count(), 1);
  assert.equal(await page.locator('#ytms-settings-dialog [role="tab"]').count(), 8);
  assert.equal(await page.evaluate(key => localStorage.getItem(key), KEY), null);
});

test("settings open under enforced Trusted Types without a default HTML policy", async t => {
  const page = await openFixture(t, undefined, undefined, true);
  // BiDi reports even a caught CSP violation as pageerror. Keep this deliberate
  // rejection on a separate page under the same policy, without suppressing any
  // errors from the Suite page exercised below.
  const probe = await page.context().newPage();
  try {
    await probe.goto(WATCH_URL);
    assert.equal(await probe.evaluate(() => {
      try { document.createElement('template').innerHTML = '<p>Probe</p>'; return false; }
      catch (error) { return error instanceof TypeError; }
    }), true, 'The fixture must genuinely reject raw HTML assignment');
  } finally { await probe.close(); }
  await page.locator('#ytms-player-settings-button').click();
  assert.equal(await page.locator('#ytms-settings-dialog').isVisible(), true);
  await page.locator('#ytms-colour-mode').selectOption('custom');
  await page.locator('#ytms-viewer-swatch').click();
  assert.equal(await page.locator('#ytms-colour-picker').isVisible(), true);
  await page.locator('#ytms-cancel-panel').click();
  await page.evaluate(() => {
    const player = document.getElementById('player');
    const anchor = document.createElement('div'); anchor.id = 'single-column-container';
    player.before(anchor); anchor.append(player);
    const panel = document.querySelector('ytd-playlist-panel-renderer');
    for (const id of ['aaaaaaaaaaa', 'bbbbbbbbbbb']) {
      const item = document.createElement('ytd-playlist-panel-video-renderer');
      const link = document.createElement('a'); link.href = `/watch?v=${id}`;
      const title = document.createElement('span'); title.id = 'video-title'; title.textContent = id === 'aaaaaaaaaaa' ? 'Video A' : 'Video B';
      link.append(title); item.append(link); panel.append(item);
    }
    window.scrollTo(0, 800);
  });
  await page.locator('video').hover();
  await page.mouse.wheel(0, 900);
  await page.locator('#ytsmp-compact-queue-info').waitFor({ state: 'visible' });
  assert.equal(await page.locator('.ytsmp-queue-position').textContent(), 'Queue 1 / 2');
  assert.equal(await page.locator('.ytsmp-queue-title').textContent(), 'Video A');
  await page.locator('#ytms-player-settings-button').click();
  assert.equal(await page.locator('#ytms-settings-dialog').isVisible(), true);
});
