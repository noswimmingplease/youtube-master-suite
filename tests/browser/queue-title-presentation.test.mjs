import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { after, before, test } from 'node:test';
import { launchFixtureBrowser, waitForSuiteHealth } from './fixture-browser.mjs';

const SOURCE = readFileSync(new URL('../../sources/modules/youtube-watch-layout-cleaner.user.js', import.meta.url), 'utf8');
const SUITE = readFileSync(new URL('../../youtube-master-suite.user.js', import.meta.url), 'utf8');
const MANIFEST = JSON.parse(readFileSync(new URL('../../release-manifest.json', import.meta.url), 'utf8'));
const start = SOURCE.indexOf('  function installQueueStepControls(');
const end = SOURCE.indexOf('\n  function installQueueDragAssistance(', start);
assert.ok(start >= 0 && end > start, 'Canonical source must retain the scoped queue installer');
const INSTALLER = SOURCE.slice(start, end);
const TOOLTIP = '[data-ywlc-queue-title-tooltip][role="tooltip"]';
const SHORT = 'A short queue title';
const LONG = 'A substantially longer queue video title which spans several native lines and must remain fully readable in a floating tooltip without expanding the row or moving the neighbouring thumbnail';
const CURRENT = 'aaaaaaaaaaa';
const LONG_ID = 'queue000001';
const WATCH_URL = `https://www.youtube.com/watch?v=${CURRENT}&list=TLPQfixture`;
const HOME_URL = 'https://www.youtube.com/';

// Independent native-contract fixture. Its model commits belong to the native
// owner; it does not reproduce the Suite's title, tooltip or positioning logic.
const NATIVE_CONTRACT = String.raw`
(() => {
  const f = fixture, items = f.items, player = document.getElementById('movie_player');
  f.dropCalls = []; f.titleClicks = []; f.mediaCalls = { pause: 0, play: 0, seek: 0, load: 0 };
  const video = f.originalVideo = player.querySelector('video');
  for (const method of ['pause', 'play', 'load']) video[method] = () => { f.mediaCalls[method]++; };
  Object.defineProperty(video, 'currentTime', { configurable: true, get: () => 42, set: () => { f.mediaCalls.seek++; } });
  if (document.body.dataset.queueView === 'miniplayer') {
    document.getElementById('queue-host').prepend(player);
    document.getElementById('queue-host').style.top = '90px';
    player.style.cssText = 'width:374px;height:80px'; video.style.cssText = 'width:374px;height:40px';
  }
  f.notifyQueue = () => window.dispatchEvent(new CustomEvent('yt-playlist-data-updated'));
  f.owner = f.panel.polymerController = { canReorder: true, ytReorderableController: f.controller,
    data: { playlistId: 'TLPQfixture', currentIndex: 0, totalVideos: f.originalIds.length,
      contents: [...items.children].map(row => ({ playlistPanelVideoRenderer: {
        videoId: row.dataset.videoId, playlistSetVideoId: 'set-' + row.dataset.videoId,
        title: { simpleText: row.querySelector('#video-title').textContent }, selected: row.hasAttribute('selected'),
      } })) } };
  player.getPlaylistId = () => f.owner.data.playlistId;
  player.getPlaylist = () => f.owner.data.contents.map(item => item.playlistPanelVideoRenderer.videoId);
  f.owner.handleDrop = ({ currDragItem }) => {
    f.dropCalls.push(currDragItem.dataset.videoId);
    const byId = new Map(f.owner.data.contents.map(item => [item.playlistPanelVideoRenderer.videoId, item]));
    f.owner.data = { ...f.owner.data, contents: f.order().map(id => byId.get(id)), currentIndex: f.order().indexOf(f.selectedVideoId) };
    f.notifyQueue();
  };
  for (const row of items.children) {
    row.data = f.owner.data.contents.find(item => item.playlistPanelVideoRenderer.videoId === row.dataset.videoId).playlistPanelVideoRenderer;
    const handle = row.querySelector('.playlist-drag-handle');
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('data-native-queue-grip', ''); svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('width', '24'); svg.setAttribute('height', '24'); svg.setAttribute('aria-hidden', 'true');
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', 'M4 9h16v2H4z M4 13h16v2H4z'); path.setAttribute('fill', 'currentColor');
    svg.append(path); handle.replaceChildren(svg);
    handle.style.cssText = 'color:rgb(170,170,170);width:24px;height:24px;align-self:start';
    const title = row.querySelector('#video-title');
    title.textContent = row === items.children[1] ? ${JSON.stringify(LONG)} : ${JSON.stringify(SHORT)};
    title.setAttribute('title', 'Native tooltip ' + title.textContent); title.setAttribute('aria-describedby', 'native-help');
  }
  items.addEventListener('click', event => {
    if (!event.target.closest('#video-title')) return;
    f.titleClicks.push({ prevented: event.defaultPrevented, button: event.button }); event.preventDefault();
  });
  f.restampRows = () => {
    for (const row of [...items.children]) { const next = row.cloneNode(true); next.data = row.data; row.replaceWith(next); }
    f.notifyQueue();
  };
})();`;
const FIXTURE = readFileSync(new URL('./queue-drag-page.html', import.meta.url), 'utf8')
  .replace('<html lang="en" dark>', '<html lang="en-GB" dark>')
  .replace('</head>', `<style>
    ytd-playlist-panel-video-renderer { height:auto; min-height:76px; }
    #container { height:auto; min-height:76px; align-items:flex-start; }
    #thumbnail { align-self:start; }
    #meta { flex:1; min-width:0; gap:4px; }
    #video-title { display:block; font-size:14px; line-height:20px; white-space:normal; }
    #byline { line-height:16px; }
  </style></head>`)
  .replace('</body>', `<script>${NATIVE_CONTRACT}</script></body>`);
let browser;
before(async () => { browser = await launchFixtureBrowser(); }, { timeout: 30000 });
after(async () => { await browser?.close(); }, { timeout: 10000 });

async function open(t, { view = 'desktop', suite = false, configure = null } = {}) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, serviceWorkers: 'block' });
  const url = view === 'desktop' ? WATCH_URL : HOME_URL;
  await context.route('**/*', route => route.request().url() === url ? route.fulfill({ contentType: 'text/html', body: FIXTURE }) : route.abort());
  if (suite) await context.addInitScript({ content: SUITE });
  const page = await context.newPage(); page.setDefaultTimeout(6000);
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  t.after(async () => {
    try {
      assert.deepEqual(errors, []);
      assert.deepEqual(await page.evaluate(() => fixture.mediaCalls), { pause: 0, play: 0, seek: 0, load: 0 });
      assert.equal(await page.evaluate(() => document.querySelector('#movie_player video') === fixture.originalVideo), true);
      assert.equal(await page.evaluate(() => fixture.selectedVideoId), CURRENT);
      assert.equal(await page.evaluate(() => fixture.dropCalls.length), 0);
    } finally { await context.close(); }
  });
  await page.goto(url);
  if (configure) await page.evaluate(configure);
  if (suite) await waitForSuiteHealth(page, MANIFEST.registeredModules, { timeoutMs: 10000, requireReady: true, errors });
  else await page.addScriptTag({ content: `(() => { ${INSTALLER}\nfixture.disposeSteps=installQueueStepControls(); })();` });
  return page;
}
const row = (page, id = LONG_ID) => page.locator(`#items > ytd-playlist-panel-video-renderer[data-video-id="${id}"]`);
const title = (page, id = LONG_ID) => row(page, id).locator('[id="video-title"]').filter({ visible: true }).last();
async function ready(page) { await page.locator('#items [data-ywlc-queue-title="1"]').first().waitFor({ state: 'attached' }); }
async function tooltip(page, { keyboard = false, id = LONG_ID } = {}) {
  const target = title(page, id);
  if (keyboard) {
    await page.locator('#ordinary-control').focus(); await page.keyboard.press('Tab');
    const immediate = await target.evaluate(node => { node.focus(); return Boolean(document.querySelector('[data-ywlc-queue-title-tooltip][role="tooltip"]')); });
    assert.equal(immediate, true, 'Keyboard focus must reveal the full title without the pointer dwell delay');
  }
  else await target.hover();
  await page.locator(TOOLTIP).waitFor({ state: 'visible', timeout: 3000 });
  return page.locator(TOOLTIP);
}
async function assertNoTooltip(page) { await page.locator(TOOLTIP).waitFor({ state: 'detached' }); }
async function presentation(page, id = LONG_ID) {
  return row(page, id).evaluate(row => {
    const box = node => { const rect = node.getBoundingClientRect(); return { x: rect.x, y: rect.y, width: rect.width, height: rect.height,
      centreX: rect.x + rect.width / 2, centreY: rect.y + rect.height / 2 }; };
    const title = [...row.querySelectorAll('[id="video-title"]')].find(node => getComputedStyle(node).display !== 'none');
    const style = getComputedStyle(title);
    return { row: box(row), title: box(title), thumbnail: box(row.querySelector('#thumbnail')),
      grip: box(row.querySelector('[data-native-queue-grip]')), up: box(row.querySelector('[data-ywlc-queue-step="up"]')),
      down: box(row.querySelector('[data-ywlc-queue-step="down"]')), lineHeight: parseFloat(style.lineHeight),
      clamp: style.webkitLineClamp, display: style.display, overflow: style.overflow, ellipsis: style.textOverflow, text: title.textContent };
  });
}

for (const view of ['desktop', 'miniplayer']) {
  test(`queue titles clamp to two lines and keep the fixed controls beside the thumbnail (${view})`, async t => {
    const page = await open(t, { view }); await ready(page);
    const geometry = await presentation(page);
    assert.equal(geometry.clamp, '2');
    assert.ok(['-webkit-box', 'flow-root'].includes(geometry.display), 'The native display rule must not defeat multi-line ellipsis');
    assert.equal(geometry.overflow, 'hidden');
    assert.equal(geometry.ellipsis, 'ellipsis');
    assert.ok(geometry.title.height > geometry.lineHeight && geometry.title.height <= geometry.lineHeight * 2 + 0.5);
    assert.equal(geometry.text, LONG);
    assert.equal(geometry.grip.width, 24); assert.equal(geometry.grip.height, 24);
    assert.ok(Math.abs(geometry.grip.centreY - geometry.thumbnail.centreY) <= 0.5, 'The native grip is centred beside the thumbnail');
    assert.ok(Math.abs(geometry.up.centreY - geometry.grip.centreY + 18) <= 0.5);
    assert.ok(Math.abs(geometry.down.centreY - geometry.grip.centreY - 18) <= 0.5);
    const before = geometry.row;
    const tip = await tooltip(page);
    assert.equal(await tip.textContent(), LONG);
    assert.deepEqual((await presentation(page)).row, before, 'A full title must float without expanding its queue row');
    await page.mouse.move(10, 10); await assertNoTooltip(page);
    assert.deepEqual((await presentation(page)).row, before);
  });
}

test('a native three-line rule cannot replace the two-line ellipsis with hard clipping', async t => {
  const page = await open(t, { configure: () => {
    const nativeStyle = document.createElement('style');
    nativeStyle.textContent = '#video-title { -webkit-line-clamp: 3 !important; line-clamp: 3 !important; }';
    document.head.append(nativeStyle);
  } }); await ready(page);
  const geometry = await presentation(page);
  assert.equal(geometry.clamp, '2', 'The actual line clamp, not a height cap, must truncate at two lines');
  assert.ok(geometry.title.height > geometry.lineHeight && geometry.title.height <= geometry.lineHeight * 2 + 0.5);
  assert.equal(await title(page).evaluate(node => getComputedStyle(node).maxBlockSize), 'none',
    'A hard height cap must not cut off the line-clamp ellipsis');
  assert.equal(await (await tooltip(page)).textContent(), LONG);
});

for (const theme of ['light', 'dark']) {
  test(`queue title, controls and opaque tooltip remain readable in ${theme} mode`, async t => {
    const page = await open(t);
    await page.evaluate(theme => {
      document.documentElement.toggleAttribute('dark', theme === 'dark');
      document.documentElement.style.setProperty('--yt-spec-text-primary', theme === 'dark' ? '#f1f1f1' : '#0f0f0f');
      document.documentElement.style.setProperty('--yt-spec-text-secondary', theme === 'dark' ? '#aaa' : '#606060');
      document.documentElement.style.setProperty('--yt-spec-icon-inactive', theme === 'dark' ? '#aaa' : '#606060');
      const nativeStyle = document.createElement('style');
      nativeStyle.textContent = `body, ytd-playlist-panel-renderer { background: ${theme === 'dark' ? '#0f0f0f' : '#fff'}; color: var(--yt-spec-text-primary); }
        #video-title { color: var(--yt-spec-text-primary); } #byline { color: var(--yt-spec-text-secondary); }
        ytd-playlist-panel-video-renderer[selected] { background: ${theme === 'dark' ? '#272727' : '#eee'}; }`;
      document.head.append(nativeStyle);
      for (const handle of fixture.items.querySelectorAll('.playlist-drag-handle')) handle.style.color = 'var(--yt-spec-icon-inactive)';
    }, theme);
    await ready(page);
    const before = (await presentation(page)).row;
    const tip = await tooltip(page);
    const colours = await tip.evaluate(node => ({ background: getComputedStyle(node).backgroundColor,
      foreground: getComputedStyle(node).color, pointerEvents: getComputedStyle(node).pointerEvents }));
    assert.equal(colours.background, 'rgb(33, 33, 33)', 'Opaque dark fill must prevent underlying queue text showing through');
    assert.equal(colours.foreground, 'rgb(255, 255, 255)');
    assert.equal(colours.pointerEvents, 'none');
    assert.equal(await title(page).evaluate(node => getComputedStyle(node).color), theme === 'dark' ? 'rgb(241, 241, 241)' : 'rgb(15, 15, 15)');
    assert.equal(await row(page).locator('[data-ywlc-queue-step="up"]').evaluate(node => getComputedStyle(node).color),
      theme === 'dark' ? 'rgb(170, 170, 170)' : 'rgb(96, 96, 96)');
    assert.equal(await row(page, CURRENT).evaluate(node => getComputedStyle(node).backgroundColor),
      theme === 'dark' ? 'rgb(39, 39, 39)' : 'rgb(238, 238, 238)');
    assert.equal(await row(page).locator('.playlist-drag-handle').evaluate(node => getComputedStyle(node).color),
      theme === 'dark' ? 'rgb(170, 170, 170)' : 'rgb(96, 96, 96)');
    assert.deepEqual((await presentation(page)).row, before);
  });
}

test('short titles show no floating tooltip and pointer dwell is delayed for truncated titles', async t => {
  const page = await open(t); await ready(page);
  await title(page, CURRENT).hover(); await page.waitForTimeout(650);
  assert.equal(await page.locator(TOOLTIP).count(), 0);
  assert.equal(await title(page, CURRENT).getAttribute('title'), '', 'Fully visible titles must suppress the browser tooltip too');
  await page.mouse.move(10, 10);
  assert.equal(await title(page, CURRENT).getAttribute('title'), 'Native tooltip ' + SHORT);
  await title(page).hover(); await page.waitForTimeout(200);
  assert.equal(await page.locator(TOOLTIP).count(), 0, 'Pointer hover must not immediately cover adjacent content');
  const tip = page.locator(TOOLTIP); await tip.waitFor({ state: 'visible', timeout: 1500 });
  assert.equal(await tip.textContent(), LONG);
});

test('a fully visible two-line title suppresses native hover text without showing the styled tooltip', async t => {
  const full = "Ethan Klein's Most Sus Moments Exposed by Kino Casino";
  const page = await open(t, { configure: () => {
    const title = fixture.items.children[0].querySelector('#video-title');
    title.textContent = "Ethan Klein's Most Sus Moments Exposed by Kino Casino";
    title.setAttribute('title', title.textContent);
  } }); await ready(page);
  const geometry = await presentation(page, CURRENT);
  assert.ok(geometry.title.height > geometry.lineHeight && geometry.title.height <= geometry.lineHeight * 2 + 0.5);
  assert.equal(await title(page, CURRENT).evaluate(node => node.scrollHeight === node.clientHeight), true);
  await title(page, CURRENT).hover(); await page.waitForTimeout(650);
  assert.equal(await page.locator(TOOLTIP).count(), 0);
  assert.equal(await title(page, CURRENT).getAttribute('title'), '');
  await page.mouse.move(10, 10);
  assert.equal(await title(page, CURRENT).getAttribute('title'), full);
});

test('clicking a fully visible title does not re-enable a native tooltip while still hovered', async t => {
  const page = await open(t); await ready(page);
  await title(page, CURRENT).hover(); await title(page, CURRENT).click();
  await page.waitForTimeout(650);
  assert.equal(await page.locator(TOOLTIP).count(), 0);
  assert.equal(await title(page, CURRENT).getAttribute('title'), '');
  assert.deepEqual(await page.evaluate(() => fixture.titleClicks), [{ prevented: false, button: 0 }]);
  await page.mouse.move(10, 10);
  assert.equal(await title(page, CURRENT).getAttribute('title'), 'Native tooltip ' + SHORT);
});

test('keyboard focus on a fully visible title adds no tooltip or description and restores its native title on blur', async t => {
  const page = await open(t); await ready(page);
  await page.locator('#ordinary-control').focus(); await page.keyboard.press('Tab');
  await title(page, CURRENT).focus();
  assert.equal(await title(page, CURRENT).evaluate(node => node.matches(':focus-visible')), true);
  assert.equal(await title(page, CURRENT).getAttribute('title'), '');
  assert.equal(await page.locator(TOOLTIP).count(), 0);
  assert.equal(await title(page, CURRENT).getAttribute('aria-describedby'), 'native-help');
  await page.locator('#ordinary-control').focus();
  assert.equal(await title(page, CURRENT).getAttribute('title'), 'Native tooltip ' + SHORT);
});

test('a hovered title can become truncated and fully visible again without a native-tooltip leak', async t => {
  const page = await open(t); await ready(page);
  await title(page, CURRENT).hover(); await page.waitForTimeout(650);
  await title(page, CURRENT).evaluate((node, text) => { node.textContent = text; }, LONG);
  await page.locator(TOOLTIP).waitFor({ state: 'visible' });
  assert.equal(await page.locator(TOOLTIP).textContent(), LONG);
  await title(page, CURRENT).evaluate((node, text) => { node.textContent = text; }, SHORT);
  await assertNoTooltip(page);
  assert.equal(await title(page, CURRENT).getAttribute('title'), '');
  assert.equal(await title(page, CURRENT).getAttribute('aria-describedby'), 'native-help');
  await page.mouse.move(10, 10);
  assert.equal(await title(page, CURRENT).getAttribute('title'), 'Native tooltip ' + SHORT);
});

test('Escape cancels a hovered tooltip without restoring native hover text or reopening the styled tooltip', async t => {
  const page = await open(t); await ready(page); await tooltip(page);
  await page.keyboard.press('Escape'); await assertNoTooltip(page);
  assert.equal(await title(page).getAttribute('title'), '');
  await page.waitForTimeout(650);
  assert.equal(await page.locator(TOOLTIP).count(), 0);
  assert.equal(await title(page).getAttribute('title'), '');
  await page.mouse.move(10, 10);
  assert.equal(await title(page).getAttribute('title'), 'Native tooltip ' + LONG);
});

test('synthetic pointer entry outside a real hover cannot create a title tooltip', async t => {
  const page = await open(t); await ready(page); await page.mouse.move(10, 10);
  await title(page).evaluate(node => node.dispatchEvent(new PointerEvent('pointerover', { bubbles: true, composed: true })));
  await page.waitForTimeout(650);
  assert.equal(await page.locator(TOOLTIP).count(), 0);
  assert.equal(await title(page).getAttribute('title'), 'Native tooltip ' + LONG);
});

test('a pending tooltip does not appear after its title moves away and hover-exit delivery is missed', async t => {
  const page = await open(t, { configure: () => {
    fixture.suppressHoverExit = false;
    for (const type of ['pointerleave', 'pointerout', 'pointermove', 'mouseleave', 'mouseout', 'mousemove']) {
      document.addEventListener(type, event => { if (fixture.suppressHoverExit) event.stopImmediatePropagation(); }, true);
    }
  } }); await ready(page);
  await title(page).hover();
  const pending = await title(page).evaluate(node => {
    const pending = !document.querySelector('[data-ywlc-queue-title-tooltip]');
    fixture.suppressHoverExit = true; node.style.transform = 'translateX(-300px)'; return pending;
  });
  assert.equal(pending, true, 'The title moves before its pointer dwell timer completes');
  await page.waitForTimeout(650);
  assert.equal(await title(page).evaluate(node => node.matches(':hover')), false);
  assert.equal(await page.locator(TOOLTIP).count(), 0);
  assert.equal(await title(page).getAttribute('title'), 'Native tooltip ' + LONG);
});

test('an already visible tooltip closes when its title moves away without a delivered hover exit', async t => {
  const page = await open(t, { configure: () => {
    fixture.suppressHoverExit = false;
    for (const type of ['pointerleave', 'pointerout', 'pointermove', 'mouseleave', 'mouseout', 'mousemove']) {
      document.addEventListener(type, event => { if (fixture.suppressHoverExit) event.stopImmediatePropagation(); }, true);
    }
  } }); await ready(page); await tooltip(page);
  await title(page).evaluate(node => { fixture.suppressHoverExit = true; node.style.transform = 'translateX(-300px)'; });
  await assertNoTooltip(page);
  assert.equal(await title(page).getAttribute('title'), 'Native tooltip ' + LONG);
});

test('same-size synthetic layout hints retain the tooltip but actual viewport resizing dismisses it', async t => {
  const page = await open(t); await ready(page); await title(page).hover();
  const pending = await page.evaluate(() => {
    const pending = !document.querySelector('[data-ywlc-queue-title-tooltip]'); window.dispatchEvent(new Event('resize')); return pending;
  });
  assert.equal(pending, true);
  const tip = page.locator(TOOLTIP); await tip.waitFor({ state: 'visible', timeout: 2000 });
  assert.equal(await tip.textContent(), LONG);
  await page.evaluate(() => window.dispatchEvent(new Event('resize'))); await page.waitForTimeout(100);
  assert.equal(await tip.textContent(), LONG);
  await page.setViewportSize({ width: 1200, height: 800 }); await assertNoTooltip(page);
});

test('keyboard focus reveals a readable tooltip immediately and preserves existing description IDs', async t => {
  const page = await open(t); await ready(page);
  const tip = await tooltip(page, { keyboard: true });
  const id = await tip.getAttribute('id'); assert.ok(id);
  const descriptions = (await title(page).getAttribute('aria-describedby')).split(/\s+/);
  assert.ok(descriptions.includes('native-help') && descriptions.includes(id));
  const style = await tip.evaluate(node => {
    const css = getComputedStyle(node), box = node.getBoundingClientRect();
    return { pointerEvents: css.pointerEvents, position: css.position, fontSize: parseFloat(css.fontSize),
      colour: css.color, background: css.backgroundColor, radius: parseFloat(css.borderRadius),
      inside: box.left >= 0 && box.top >= 0 && box.right <= innerWidth && box.bottom <= innerHeight };
  });
  assert.equal(style.pointerEvents, 'none'); assert.equal(style.position, 'fixed');
  assert.ok(style.fontSize >= 12 && style.fontSize <= 16 && style.radius > 0);
  assert.notEqual(style.colour, style.background); assert.notEqual(style.background, 'rgba(0, 0, 0, 0)'); assert.equal(style.inside, true);
  await page.keyboard.press('Escape'); await assertNoTooltip(page);
  assert.equal(await title(page).getAttribute('aria-describedby'), 'native-help');
});

test('the full-title tooltip stays inside a narrow viewport without intercepting native title clicks', async t => {
  const page = await open(t, { view: 'miniplayer' }); await ready(page);
  await page.setViewportSize({ width: 420, height: 800 });
  await page.evaluate(() => { document.getElementById('queue-host').style.right = '4px'; });
  const tip = await tooltip(page);
  assert.equal(await tip.evaluate(node => { const box = node.getBoundingClientRect();
    return box.left >= 0 && box.right <= innerWidth && box.top >= 0 && box.bottom <= innerHeight; }), true);
  await title(page).click();
  assert.deepEqual(await page.evaluate(() => fixture.titleClicks), [{ prevented: false, button: 0 }]);
  await assertNoTooltip(page);
});

test('tooltip text follows rendered title changes rather than stale native model data', async t => {
  const page = await open(t); await ready(page); const tip = await tooltip(page);
  const before = (await presentation(page)).row;
  const changed = 'An updated rendered video title from a title extension which is long enough to remain clamped to two lines and is different from the stale native response';
  await title(page).evaluate((node, text) => { node.textContent = text; }, changed);
  await page.waitForFunction(text => document.querySelector('[data-ywlc-queue-title-tooltip]')?.textContent === text, changed);
  assert.equal(await tip.textContent(), changed);
  assert.deepEqual((await presentation(page)).row, before);
  assert.notEqual(await page.evaluate(() => fixture.owner.data.contents[1].playlistPanelVideoRenderer.title.simpleText), changed);
  await title(page).evaluate((node, text) => { node.textContent = text; }, SHORT);
  await assertNoTooltip(page);
});

test('repeated native updates keep presentation markers idempotent and preserve native title children', async t => {
  const page = await open(t, { configure: () => {
    const title = fixture.items.children[1].querySelector('#video-title'), full = title.textContent;
    const prefix = document.createElement('span'); prefix.textContent = full.slice(0, 40);
    title.replaceChildren(prefix, document.createTextNode(full.slice(40)));
    fixture.nativeTitle = title; fixture.nativeTitleParent = title.parentElement; fixture.nativeTitleChildren = [...title.childNodes];
  } }); await ready(page);
  await page.evaluate(() => { for (let index = 0; index < 10; index++) fixture.notifyQueue(); });
  await page.waitForTimeout(150);
  assert.equal(await page.evaluate(() => fixture.nativeTitle.parentElement === fixture.nativeTitleParent &&
    fixture.nativeTitleChildren.every((child, index) => fixture.nativeTitle.childNodes[index] === child)), true);
  assert.equal(await page.locator('[data-ywlc-queue-title="1"]').count(), 18);
  assert.equal(await page.locator('[data-ywlc-queue-presentation="1"]').count(), 18);
  assert.equal(await page.locator('[data-ywlc-queue-step]').count(), 36);
  const tip = await tooltip(page); assert.equal(await tip.textContent(), LONG);
  assert.equal(await title(page).getAttribute('title'), '', 'An owned empty title suppresses inherited native tooltip text');
  await page.mouse.move(10, 10); await assertNoTooltip(page);
  assert.equal(await title(page).getAttribute('title'), 'Native tooltip ' + LONG);
  await page.evaluate(() => fixture.restampRows());
  await page.waitForTimeout(100);
  assert.equal(await page.locator('[data-ywlc-queue-title="1"]').count(), 18);
  await page.evaluate(() => fixture.disposeSteps());
  assert.equal(await page.locator('[data-ywlc-queue-title],[data-ywlc-queue-presentation]').count(), 0,
    'Restamped copies of owned markers must not become permanent native attributes');
});

test('a title-only native clone restores temporary description and title ownership before reusing the clamp', async t => {
  const page = await open(t); await ready(page); await tooltip(page);
  await title(page).evaluate(node => { const replacement = node.cloneNode(true); node.replaceWith(replacement); });
  await page.mouse.move(10, 10);
  await assertNoTooltip(page);
  await row(page).locator('#video-title[data-ywlc-queue-title="1"]').waitFor();
  assert.equal(await title(page).getAttribute('aria-describedby'), 'native-help');
  assert.equal(await title(page).getAttribute('title'), 'Native tooltip ' + LONG);
  assert.equal(await (await tooltip(page)).textContent(), LONG);
});

test('DeArrow-style visible replacement titles remain clamped without revealing hidden originals', async t => {
  const page = await open(t, { configure: () => {
    const nativeRow = fixture.items.children[1], original = nativeRow.querySelector('#video-title');
    original.style.display = 'none'; original.className = 'native-original-title';
    const important = original.cloneNode(true); important.className = 'native-important-title'; important.style.display = 'block';
    const hiding = document.createElement('style'); hiding.textContent = '.native-important-title{display:none!important}'; document.head.append(hiding);
    const custom = original.cloneNode(true); custom.style.display = ''; custom.className = 'cbCustomTitle';
    custom.textContent = 'A visible DeArrow replacement title which is long enough to wrap over two lines and should appear in its own full-title tooltip instead of revealing the original hidden title';
    original.after(important, custom);
  } }); await ready(page);
  assert.equal(await row(page).locator('.native-original-title').isVisible(), false);
  assert.equal(await row(page).locator('.native-important-title').isVisible(), false);
  const custom = row(page).locator('.cbCustomTitle');
  assert.equal(await custom.isVisible(), true);
  assert.equal(await custom.evaluate(node => getComputedStyle(node).webkitLineClamp), '2');
  const tip = await tooltip(page); assert.equal(await tip.textContent(), await custom.textContent());
  await page.evaluate(() => {
    const previous = fixture.items.children[1].querySelector('.cbCustomTitle');
    const replacement = document.createElement('a'); replacement.id = 'video-title'; replacement.className = 'cbCustomTitle';
    replacement.href = previous.href; replacement.textContent = 'Another replaced extension title, with enough words to need the same two-line clamp after the native renderer swaps its title node';
    previous.replaceWith(replacement);
  });
  await assertNoTooltip(page); await page.mouse.move(10, 10);
  assert.equal(await (await tooltip(page)).textContent(), await custom.textContent());
});

for (const hidden of ['visibility', 'opacity']) {
  test(`keyboard focus on a native enclosing link skips an original hidden by ${hidden}`, async t => {
    const page = await open(t);
    await page.evaluate(hidden => {
      const previous = fixture.items.children[1].querySelector('#video-title');
      const link = document.createElement('a'); link.id = 'native-row-link'; link.href = previous.href;
      link.setAttribute('title', 'Native enclosing link tooltip'); link.setAttribute('aria-describedby', 'native-link-help');
      const original = document.createElement('span'); original.id = 'video-title'; original.className = 'hidden-native-original';
      original.textContent = 'The hidden original title must never be the tooltip candidate';
      original.style[hidden] = hidden === 'visibility' ? 'hidden' : '0';
      const custom = document.createElement('span'); custom.id = 'video-title'; custom.className = 'cbCustomTitle';
      custom.textContent = previous.textContent;
      link.append(original, custom); previous.replaceWith(link);
    }, hidden);
    await ready(page); await row(page).locator('.cbCustomTitle[data-ywlc-queue-title="1"]').waitFor();
    await page.locator('#ordinary-control').focus(); await page.keyboard.press('Tab');
    const immediate = await row(page).locator('#native-row-link').evaluate(node => {
      node.focus(); return document.querySelector('[data-ywlc-queue-title-tooltip]')?.textContent;
    });
    assert.equal(immediate, LONG);
    const original = row(page).locator('.hidden-native-original');
    assert.equal(await original.evaluate((node, hidden) => getComputedStyle(node)[hidden], hidden), hidden === 'visibility' ? 'hidden' : '0');
    assert.equal(await row(page).locator('#native-row-link').getAttribute('title'), '');
    await page.keyboard.press('Escape'); await assertNoTooltip(page);
    assert.equal(await row(page).locator('#native-row-link').getAttribute('title'), '',
      'Escape must not reactivate native tooltip text while the enclosing link remains focused');
    assert.equal(await row(page).locator('#native-row-link').getAttribute('aria-describedby'), 'native-link-help');
    await page.locator('#ordinary-control').focus();
    assert.equal(await row(page).locator('#native-row-link').getAttribute('title'), 'Native enclosing link tooltip');
  });
}

test('title tooltips treat markup-looking text as plain text', async t => {
  const page = await open(t); await ready(page);
  const literal = '<img src="missing" onerror="window.queueTitleInjected=true"> & <script>window.queueTitleInjected=true</script> This remains a literal long video title, never executable tooltip markup';
  await title(page).evaluate((node, value) => { node.textContent = value; }, literal);
  const tip = await tooltip(page);
  assert.equal(await tip.textContent(), literal);
  assert.equal(await tip.locator('img,script').count(), 0);
  assert.equal(await page.evaluate(() => window.queueTitleInjected), undefined);
});

for (const reason of ['scroll', 'navigation', 'pagehide', 'hidden', 'row-hidden', 'ancestor-hidden', 'owner-change', 'native-restamp']) {
  test(`an open title tooltip releases on ${reason}`, async t => {
    const page = await open(t); await ready(page); await tooltip(page);
    await page.evaluate(reason => {
      if (reason === 'scroll') fixture.items.scrollTop = 24;
      if (reason === 'navigation') window.dispatchEvent(new Event('yt-navigate-start'));
      if (reason === 'pagehide') window.dispatchEvent(new Event('pagehide'));
      if (reason === 'hidden') {
        Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
        Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
        document.dispatchEvent(new Event('visibilitychange'));
      }
      if (reason === 'row-hidden') fixture.items.children[1].hidden = true;
      if (reason === 'ancestor-hidden') fixture.panel.parentElement.style.display = 'none';
      if (reason === 'owner-change') { fixture.owner = { ...fixture.owner }; fixture.panel.polymerController = fixture.owner; fixture.notifyQueue(); }
      if (reason === 'native-restamp') fixture.restampRows();
    }, reason);
    await assertNoTooltip(page);
    if (reason === 'navigation' || reason === 'pagehide') assert.equal(await page.locator('[data-ywlc-queue-title]').count(), 0);
    if (reason === 'native-restamp') {
      await page.mouse.move(10, 10); await assertNoTooltip(page);
      assert.equal(await title(page).getAttribute('aria-describedby'), 'native-help', 'A native clone must not retain a reference to the removed owned tooltip');
      assert.equal(await title(page).getAttribute('title'), 'Native tooltip ' + LONG, 'An identical native row clone recovers temporary title suppression');
    }
  });
}

test('native dragging dismisses a focused title tooltip without consuming the grip gesture', async t => {
  const page = await open(t); await ready(page); await tooltip(page, { keyboard: true });
  const grip = await row(page).locator('[data-native-queue-grip] path').boundingBox(); assert.ok(grip);
  await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2); await page.mouse.down();
  await page.mouse.move(grip.x + grip.width / 2 + 4, grip.y + grip.height / 2 + 8);
  await page.waitForFunction(() => fixture.nativeMouseStarts === 1); await assertNoTooltip(page);
  await page.mouse.up();
});

test('disposal removes only owned presentation state and preserves third-party title attributes', async t => {
  const page = await open(t); await ready(page); await tooltip(page, { keyboard: true });
  await title(page).evaluate(node => { node.setAttribute('title', 'A newer third-party native tooltip'); node.setAttribute('aria-describedby', 'native-help extension-help'); });
  await page.evaluate(() => fixture.disposeSteps());
  await assertNoTooltip(page);
  assert.equal(await page.locator('[data-ywlc-queue-title],[data-ywlc-queue-presentation]').count(), 0);
  assert.equal(await title(page).getAttribute('title'), 'A newer third-party native tooltip');
  assert.equal(await title(page).getAttribute('aria-describedby'), 'native-help extension-help');
  assert.equal(await row(page, CURRENT).locator('#video-title').getAttribute('title'), 'Native tooltip ' + SHORT);
});

test('ordinary saved playlists retain native titles and receive no owned presentation', async t => {
  const page = await open(t, { configure: () => { fixture.owner.data.playlistId = 'PLsavedplaylist'; } });
  await page.waitForTimeout(150);
  assert.equal(await page.locator('[data-ywlc-queue-title],[data-ywlc-queue-presentation]').count(), 0);
  assert.notEqual(await title(page).evaluate(node => getComputedStyle(node).webkitLineClamp), '2');
  await title(page).hover(); await page.waitForTimeout(650);
  assert.equal(await page.locator(TOOLTIP).count(), 0);
  assert.equal(await title(page).getAttribute('title'), 'Native tooltip ' + LONG);
});

test('title presentation does no idle polling before, during or after a tooltip', async t => {
  const page = await open(t, { configure: () => {
    const nativeFrame = window.requestAnimationFrame.bind(window); fixture.scheduledFrames = 0;
    window.requestAnimationFrame = callback => { fixture.scheduledFrames++; return nativeFrame(callback); };
  } }); await ready(page);
  await page.waitForTimeout(150);
  const idle = await page.evaluate(() => fixture.scheduledFrames); await page.waitForTimeout(650);
  assert.equal(await page.evaluate(() => fixture.scheduledFrames), idle);
  await tooltip(page); await page.waitForTimeout(150);
  const showing = await page.evaluate(() => fixture.scheduledFrames); await page.waitForTimeout(300);
  assert.equal(await page.evaluate(() => fixture.scheduledFrames), showing);
  await page.mouse.move(10, 10); await assertNoTooltip(page); await page.waitForTimeout(150);
  const closed = await page.evaluate(() => fixture.scheduledFrames); await page.waitForTimeout(650);
  assert.equal(await page.evaluate(() => fixture.scheduledFrames), closed);
  assert.deepEqual(await page.evaluate(() => fixture.intervalRequests), []);
});

test('the generated Suite applies queue title presentation in watch and miniplayer views', { timeout: 20000 }, async t => {
  for (const view of ['desktop', 'miniplayer']) {
    const page = await open(t, { view, suite: true }); await ready(page);
    assert.equal((await presentation(page)).clamp, '2');
    assert.equal(await (await tooltip(page)).textContent(), LONG);
  }
});
