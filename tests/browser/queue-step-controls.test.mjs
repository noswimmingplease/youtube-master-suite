import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { after, before, test } from 'node:test';
import { launchFixtureBrowser, waitForSuiteHealth } from './fixture-browser.mjs';

const SOURCE = readFileSync(new URL('../../sources/modules/youtube-watch-layout-cleaner.user.js', import.meta.url), 'utf8');
const SUITE = readFileSync(new URL('../../youtube-master-suite.user.js', import.meta.url), 'utf8');
const MANIFEST = JSON.parse(readFileSync(new URL('../../release-manifest.json', import.meta.url), 'utf8'));
const start = SOURCE.indexOf('  function installQueueStepControls(');
const end = SOURCE.indexOf('\n  function installQueueDragAssistance(', start);
assert.ok(start >= 0 && end > start, 'Canonical source must expose the queue step installer');
const INSTALLER = SOURCE.slice(start, end);
const dragStart = end + 1;
const dragEnd = SOURCE.indexOf('\n  const scheduleQueuePlayingMarkerReconciliation =', dragStart);
assert.ok(dragEnd > dragStart);
const DRAG_INSTALLER = SOURCE.slice(dragStart, dragEnd);
const WATCH_URL = 'https://www.youtube.com/watch?v=aaaaaaaaaaa&list=TLPQfixture';
const HOME_URL = 'https://www.youtube.com/';

// The pre-existing fixture supplies native pointer dragging. This separate
// contract adds native queue data/handleDrop, not a copy of the Suite's logic.
// It establishes fixture behaviour only, not YouTube's private live APIs.
const NATIVE_CONTRACT = String.raw`
(() => {
  const f = window.fixture, panel = f.panel, items = f.items;
  const player = document.getElementById('movie_player');
  f.dropCalls = []; f.dropMode = 'normal'; f.dropDelay = 100; f.nativeRowActivations = 0;
  f.mediaCalls = { pause: 0, play: 0, seek: 0, load: 0 };
  const video = player.querySelector('video');
  for (const method of ['pause', 'play', 'load']) video[method] = () => { f.mediaCalls[method]++; };
  Object.defineProperty(video, 'currentTime', { configurable: true, get: () => 42, set: () => { f.mediaCalls.seek++; } });
  f.originalVideo = video;
  if (document.body.dataset.queueView === 'miniplayer') {
    document.getElementById('queue-host').prepend(player);
    document.getElementById('queue-host').style.top = '90px';
    player.style.cssText = 'width:374px;height:80px';
    video.style.cssText = 'width:374px;height:40px';
  }
  const dataFor = id => ({ videoId: id, playlistSetVideoId: 'set-' + id,
    title: { simpleText: id }, selected: id === f.selectedVideoId });
  const owner = f.owner = panel.polymerController = {
    canReorder: true, ytReorderableController: f.controller,
    data: { playlistId: 'TLPQfixture', currentIndex: 0, totalVideos: f.originalIds.length,
      contents: f.originalIds.map(id => ({ playlistPanelVideoRenderer: dataFor(id) })) },
  };
  player.getPlaylistId = () => owner.data.playlistId;
  player.getPlaylist = () => owner.data.contents.map(item => item.playlistPanelVideoRenderer.videoId);
  const gripStyle = document.createElement('style');
  gripStyle.textContent = '.playlist-drag-handle > svg[data-native-queue-grip]{opacity:0}' +
    'ytd-playlist-panel-video-renderer:hover .playlist-drag-handle > svg[data-native-queue-grip],' +
    'yt-playlist-panel-video-renderer:hover .playlist-drag-handle > svg[data-native-queue-grip]{opacity:1}';
  document.head.append(gripStyle);
  for (const row of items.children) {
    row.data = owner.data.contents.find(item => item.playlistPanelVideoRenderer.videoId === row.dataset.videoId).playlistPanelVideoRenderer;
    const handle = row.querySelector('.playlist-drag-handle');
    const grip = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    grip.setAttribute('data-native-queue-grip', ''); grip.setAttribute('viewBox', '0 0 24 24');
    grip.setAttribute('width', '24'); grip.setAttribute('height', '24'); grip.setAttribute('aria-hidden', 'true');
    const lines = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    lines.setAttribute('d', 'M4 9h16v2H4z M4 13h16v2H4z'); lines.setAttribute('fill', 'currentColor');
    grip.append(lines); handle.replaceChildren(grip);
    handle.style.cssText = 'color:rgb(170, 170, 170);width:24px;height:24px';
    row.addEventListener('click', () => { if (!f.suppressNativeClick) f.nativeRowActivations++; });
  }
  f.notifyQueue = () => window.dispatchEvent(new CustomEvent('yt-playlist-data-updated'));
  f.commitNativeOrder = ids => {
    const records = new Map(owner.data.contents.map(item => [item.playlistPanelVideoRenderer.playlistSetVideoId, item]));
    const rowById = new Map([...items.children].map(row => [row.dataset.videoId, row]));
    const contents = ids.map(id => records.get(rowById.get(id)?.data?.playlistSetVideoId));
    if (contents.some(item => !item)) throw new Error('Native fixture cannot bind unknown queue rows');
    owner.data = { ...owner.data, contents, currentIndex: ids.indexOf(f.selectedVideoId), totalVideos: contents.length };
    f.notifyQueue();
  };
  owner.handleDrop = ({ currDragItem }) => {
    if (currDragItem.parentElement !== items) throw new Error('Native drop target is detached');
    const ids = f.order();
    f.dropCalls.push({ id: currDragItem.dataset.videoId, ids, previous: player.getPlaylist(), current: f.selectedVideoId });
    if (f.dropMode === 'throw') throw new Error('Native fixture refused the drop');
    if (f.dropMode === 'ignore') return;
    if (f.dropMode === 'third-party-throw') {
      const third = [...ids]; [third[1], third[2]] = [third[2], third[1]];
      for (const id of third) items.append([...items.children].find(row => row.dataset.videoId === id));
      f.commitNativeOrder(third);
      throw new Error('Native fixture changed concurrently');
    }
    if (f.dropMode === 'delay') setTimeout(() => { f.commitNativeOrder(ids); f.commits.push(ids); }, f.dropDelay);
    else { f.commitNativeOrder(ids); f.commits.push(ids); }
  };
  f.group.addEventListener('dragend', () => {
    f.commitNativeOrder(f.order());
    f.suppressNativeClick = true;
    setTimeout(() => { f.suppressNativeClick = false; }, 0);
  });
  f.restamp = (keepOwned = true) => {
    for (const row of [...items.children]) {
      const next = row.cloneNode(true);
      if (!keepOwned) {
        next.querySelectorAll('[data-ywlc-queue-step]').forEach(button => button.remove());
        next.querySelector('[data-ywlc-queue-step-controls]')?.removeAttribute('data-ywlc-queue-step-controls');
      }
      next.data = row.data; row.replaceWith(next);
    }
    f.notifyQueue();
  };
})();`;
const FIXTURE = readFileSync(new URL('./queue-drag-page.html', import.meta.url), 'utf8')
  .replace('<html lang="en" dark>', '<html lang="en-GB" dark>')
  .replace('</body>', `<script>${NATIVE_CONTRACT}</script></body>`);
let browser;
before(async () => { browser = await launchFixtureBrowser(); }, { timeout: 30000 });
after(async () => { await browser?.close(); }, { timeout: 10000 });

async function open(t, { view = 'desktop', suite = false, configure = null, configureArgs = null } = {}) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, serviceWorkers: 'block' });
  const url = view === 'desktop' ? WATCH_URL : HOME_URL;
  await context.route('**/*', route => route.request().url() === url
    ? route.fulfill({ contentType: 'text/html', body: FIXTURE }) : route.abort());
  if (suite) await context.addInitScript({ content: SUITE });
  const page = await context.newPage(); page.setDefaultTimeout(6000);
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  t.after(async () => { try { assert.deepEqual(errors, []); } finally { await context.close(); } });
  await page.goto(url);
  if (configure) await page.evaluate(configure, configureArgs);
  if (suite) await waitForSuiteHealth(page, MANIFEST.registeredModules, { timeoutMs: 10000, requireReady: true, errors });
  else await page.addScriptTag({ content: `(() => { ${INSTALLER}\n${DRAG_INSTALLER}\n fixture.disposeSteps=installQueueStepControls(); fixture.disposeDrag=installQueueDragAssistance(); })();` });
  return page;
}
const row = (page, id) => page.locator(`#items > ytd-playlist-panel-video-renderer[data-video-id="${id}"]`);
const arrow = (page, id, direction) => row(page, id).locator(`[data-ywlc-queue-step="${direction}"]`);
async function ready(page) { await page.locator('#items [data-ywlc-queue-step="down"]').first().waitFor(); }
async function clickArrow(page, id, direction) {
  await row(page, id).hover();
  await arrow(page, id, direction).click();
}
async function unchangedPlayback(page) {
  assert.deepEqual(await page.evaluate(() => fixture.mediaCalls), { pause: 0, play: 0, seek: 0, load: 0 });
  assert.equal(await page.evaluate(() => document.querySelector('#movie_player video') === fixture.originalVideo), true);
  assert.equal(await page.evaluate(() => fixture.selectedVideoId), 'aaaaaaaaaaa');
  assert.equal(await page.evaluate(() => fixture.owner.data.contents[fixture.owner.data.currentIndex].playlistPanelVideoRenderer.videoId), 'aaaaaaaaaaa');
  assert.equal(await page.evaluate(() => fixture.nativeRowActivations), 0);
}
async function arrowPresentation(locator) {
  return locator.evaluate(button => ({
    opacity: Number(getComputedStyle(button).opacity), pointerEvents: getComputedStyle(button).pointerEvents,
    keyboardFocus: button.matches(':focus-visible'),
  }));
}
async function stepGeometry(page, id) {
  return row(page, id).evaluate(row => {
    const rect = node => { const box = node.getBoundingClientRect(); return {
      x: box.x + box.width / 2, y: box.y + box.height / 2, top: box.top, bottom: box.bottom, width: box.width, height: box.height,
    }; };
    const child = selector => rect(row.querySelector(selector));
    return { row: rect(row), up: child('[data-ywlc-queue-step="up"]'), handle: child('.playlist-drag-handle'), down: child('[data-ywlc-queue-step="down"]'),
      upInk: child('[data-ywlc-queue-step="up"] path'), gripInk: child('[data-native-queue-grip] path'), downInk: child('[data-ywlc-queue-step="down"] path'),
      colour: getComputedStyle(row.querySelector('[data-ywlc-queue-step="up"]')).color,
      nativeColour: getComputedStyle(row.querySelector('.playlist-drag-handle')).color };
  });
}
function assertFixedGapGeometry(geometry) {
  const upperCentre = geometry.gripInk.y - 18;
  const lowerCentre = geometry.gripInk.y + 18;
  assert.ok(Math.abs(geometry.up.y - upperCentre) <= 0.5, 'Upper target stays 18px above the native grip centre');
  assert.ok(Math.abs(geometry.down.y - lowerCentre) <= 0.5, 'Lower target stays 18px below the native grip centre');
  assert.ok(Math.abs(geometry.upInk.y - upperCentre) <= 0.5 && Math.abs(geometry.downInk.y - lowerCentre) <= 0.5);
  for (const ink of [geometry.upInk, geometry.downInk]) {
    assert.equal(ink.width, 14);
    assert.equal(ink.height, 14);
    assert.ok(Math.abs(ink.x - geometry.gripInk.x) <= 0.5, 'Triangles stay aligned with the native grip');
  }
  assert.equal(geometry.gripInk.width, 16);
  assert.equal(geometry.gripInk.height, 6);
  for (const target of [geometry.up, geometry.down]) {
    assert.ok(target.width >= 24 && target.height >= 24, 'Pointer targets remain at least 24×24px');
    assert.ok(target.top >= geometry.row.top && target.bottom <= geometry.row.bottom, 'Targets stay inside their native row');
  }
  assert.ok(geometry.up.bottom <= geometry.gripInk.top && geometry.down.top >= geometry.gripInk.bottom,
    'Both targets leave the native central drag lines unobstructed');
  assert.equal(geometry.colour, geometry.nativeColour);
}

for (const view of ['desktop', 'miniplayer']) {
  test(`arrows appear on row hover, clear after pointer use and remain keyboard accessible (${view})`, async t => {
    const page = await open(t, { view }); await ready(page);
    await page.mouse.move(10, 10);
    const up = arrow(page, 'queue000001', 'up');
    assert.deepEqual(await arrowPresentation(up), { opacity: 0, pointerEvents: 'none', keyboardFocus: false });
    assert.equal((await arrowPresentation(arrow(page, 'aaaaaaaaaaa', 'up'))).opacity, 0, 'Disabled boundary arrows stay hidden too');
    assert.equal(await row(page, 'queue000001').locator('[data-native-queue-grip]').evaluate(svg => Number(getComputedStyle(svg).opacity)), 0);
    await row(page, 'queue000001').hover();
    assert.deepEqual(await arrowPresentation(up), { opacity: 1, pointerEvents: 'auto', keyboardFocus: false });
    assert.equal(await row(page, 'queue000001').locator('[data-native-queue-grip]').evaluate(svg => Number(getComputedStyle(svg).opacity)), 1);
    await up.click();
    await page.waitForFunction(() => fixture.owner.data.currentIndex === 1);
    await page.mouse.move(10, 10);
    const down = arrow(page, 'queue000001', 'down');
    assert.deepEqual(await arrowPresentation(down), { opacity: 0, pointerEvents: 'none', keyboardFocus: false },
      'Mouse focus must not keep the arrows visible after the pointer leaves');
    assert.equal((await arrowPresentation(up)).opacity, 0, 'A now-disabled arrow must not leak through the hover guard');
    await page.locator('#ordinary-control').focus();
    for (let index = 0; index < 16; index++) {
      await page.keyboard.press('Tab');
      if (await down.evaluate(button => button === document.activeElement)) break;
    }
    assert.deepEqual(await arrowPresentation(down), { opacity: 1, pointerEvents: 'auto', keyboardFocus: true },
      'Tab navigation can reveal and reach an otherwise transparent queue control');
    assert.equal((await arrowPresentation(up)).opacity, 1, 'Keyboard focus reveals both controls for that grip');
    await page.keyboard.press('Space');
    await page.waitForFunction(() => fixture.dropCalls.length === 2);
    assert.deepEqual(await page.evaluate(() => fixture.order()), await page.evaluate(() => fixture.originalIds));
    await unchangedPlayback(page);
  });
}

for (const view of ['desktop', 'miniplayer']) {
  test(`one-step arrows move adjacent rows once and preserve the playing video (${view})`, async t => {
    const page = await open(t, { view }); await ready(page);
    const ids = await page.evaluate(() => fixture.originalIds);
    assert.equal(await arrow(page, ids[0], 'up').isDisabled(), true);
    assert.equal(await arrow(page, ids.at(-1), 'down').isDisabled(), true);
    await clickArrow(page, ids[1], 'up');
    await page.waitForFunction(() => fixture.owner.data.currentIndex === 1);
    assert.deepEqual(await page.evaluate(() => fixture.order()), [ids[1], ids[0], ...ids.slice(2)]);
    assert.equal(await page.evaluate(() => fixture.dropCalls.length), 1);
    await clickArrow(page, ids[1], 'down');
    await page.waitForFunction(() => fixture.owner.data.currentIndex === 0);
    assert.deepEqual(await page.evaluate(() => fixture.order()), ids);
    assert.equal(await page.evaluate(() => fixture.dropCalls.length), 2);
    assert.equal(await page.evaluate(() => fixture.nativeMouseStarts), 0);
    await unchangedPlayback(page);
  });
}

test('a miniplayer without a queue ID still requires and preserves the exact native playlist binding', async t => {
  const page = await open(t, { view: 'miniplayer', configure: () => {
    document.getElementById('movie_player').getPlaylistId = () => '';
  } }); await ready(page);
  await clickArrow(page, 'queue000001', 'up');
  await page.waitForFunction(() => fixture.owner.data.currentIndex === 1);
  const committed = await page.evaluate(() => fixture.order());
  await page.evaluate(() => { fixture.dropMode = 'throw'; });
  await clickArrow(page, 'queue000001', 'down');
  await page.waitForFunction(committed => JSON.stringify(fixture.order()) === JSON.stringify(committed), committed);
  assert.equal(await page.evaluate(() => fixture.dropCalls.length), 2);
  assert.deepEqual(await page.evaluate(() => document.getElementById('movie_player').getPlaylist()), committed);
  await unchangedPlayback(page);
});

test('an absent optional player playlist remains compatible with a matching known queue ID', async t => {
  const page = await open(t, { configure: () => {
    document.getElementById('movie_player').getPlaylist = () => undefined;
  } }); await ready(page);
  await clickArrow(page, 'queue000001', 'up');
  await page.waitForFunction(() => fixture.owner.data.currentIndex === 1);
  const committed = await page.evaluate(() => fixture.order());
  await page.evaluate(() => { fixture.dropMode = 'throw'; });
  await clickArrow(page, 'queue000001', 'down');
  await page.waitForFunction(committed => JSON.stringify(fixture.order()) === JSON.stringify(committed), committed);
  assert.equal(await page.evaluate(() => fixture.dropCalls.length), 2);
  await unchangedPlayback(page);
});

test('arrow geometry brackets the original grey handle and provides visible keyboard focus', async t => {
  const page = await open(t); await ready(page);
  await row(page, 'queue000001').hover();
  assertFixedGapGeometry(await stepGeometry(page, 'queue000001'));
  await page.mouse.move(10, 10);
  await page.locator('#ordinary-control').focus();
  await page.keyboard.press('Tab');
  await arrow(page, 'queue000001', 'up').focus();
  const focus = await arrow(page, 'queue000001', 'up').evaluate(button => ({
    visible: button.matches(':focus-visible'), outline: getComputedStyle(button).outlineStyle,
    width: parseFloat(getComputedStyle(button).outlineWidth),
  }));
  assert.equal(focus.visible, true);
  assert.ok(focus.outline !== 'none' && focus.width > 0, 'Keyboard focus remains visible');
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => fixture.dropCalls.length === 1);
  await arrow(page, 'queue000001', 'down').focus();
  await page.keyboard.press('Space');
  await page.waitForFunction(() => fixture.dropCalls.length === 2);
  assert.equal(await page.evaluate(() => fixture.nativeMouseStarts), 0);
  await unchangedPlayback(page);
});

test('compact miniplayer arrows follow the native grey theme without crowding the centre handle', async t => {
  const page = await open(t, { view: 'miniplayer' }); await ready(page);
  await page.setViewportSize({ width: 420, height: 800 });
  await page.evaluate(() => {
    document.documentElement.removeAttribute('dark');
    document.documentElement.style.setProperty('--yt-spec-icon-inactive', '#606060');
    document.getElementById('queue-host').style.width = '320px';
    fixture.panel.style.width = '320px';
    for (const handle of fixture.items.querySelectorAll('.playlist-drag-handle')) handle.style.color = 'var(--yt-spec-icon-inactive)';
  });
  const metrics = await arrow(page, 'queue000001', 'up').evaluate(button => {
    const arrow = button.getBoundingClientRect(), row = button.closest('ytd-playlist-panel-video-renderer').getBoundingClientRect();
    return { colour: getComputedStyle(button).color, nativeColour: getComputedStyle(button.parentElement).color,
      inside: arrow.left >= row.left && arrow.right <= row.right, width: arrow.width, height: arrow.height };
  });
  assert.equal(metrics.colour, 'rgb(96, 96, 96)');
  assert.equal(metrics.colour, metrics.nativeColour);
  assert.ok(metrics.inside && metrics.width >= 24 && metrics.height >= 24);
  await clickArrow(page, 'queue000001', 'up');
  await page.waitForFunction(() => fixture.owner.data.currentIndex === 1);
  assert.equal(await page.evaluate(() => fixture.dropCalls.length), 1);
  await unchangedPlayback(page);
});

for (const view of ['desktop', 'miniplayer']) {
  for (const variant of [{ height: 60, padding: '2px 4px' }, { height: 76, padding: '7px 4px' },
    { height: 88, padding: '5px 4px 13px' }, { height: 96, padding: '14px 4px' }]) {
    test(`fixed arrow gaps preserve native geometry and centre dragging at ${variant.height}px with ${variant.padding} padding (${view})`, async t => {
      const page = await open(t, { view, configureArgs: variant, configure: variant => {
        for (const nativeRow of fixture.items.children) {
          nativeRow.style.height = `${variant.height}px`;
          const container = nativeRow.querySelector('#container');
          container.style.height = '100%'; container.style.padding = variant.padding;
        }
        const target = fixture.items.children[1];
        const copy = node => { const rect = node.getBoundingClientRect(); return {
          top: rect.top, left: rect.left, width: rect.width, height: rect.height,
        }; };
        fixture.nativeGeometry = { row: copy(target), grip: copy(target.querySelector('[data-native-queue-grip] path')) };
      } }); await ready(page);
      await row(page, 'queue000001').hover();
      const geometry = await stepGeometry(page, 'queue000001');
      assertFixedGapGeometry(geometry);
      const native = await page.evaluate(() => fixture.nativeGeometry);
      assert.equal(geometry.row.height, variant.height);
      assert.equal(geometry.row.height, native.row.height);
      assert.equal(geometry.row.width, native.row.width);
      assert.equal(geometry.row.top, native.row.top);
      assert.equal(geometry.gripInk.top, native.grip.top, 'Native grip position must not move to make room for arrows');
      assert.equal(geometry.gripInk.width, native.grip.width);
      assert.equal(geometry.gripInk.height, native.grip.height);
      await page.evaluate(height => {
        for (const nativeRow of fixture.items.children) {
          nativeRow.style.height = `${height}px`;
          nativeRow.querySelector('#container').style.padding = '11px 4px 3px';
          nativeRow.querySelector('#meta').style.minWidth = '0';
          const title = nativeRow.querySelector('#video-title');
          title.textContent = 'A much longer queue title which wraps across multiple lines without stretching the arrow spacing';
          title.style.overflowWrap = 'anywhere';
        }
        const target = fixture.items.children[1];
        const box = target.querySelector('[data-native-queue-grip] path').getBoundingClientRect();
        fixture.resizedNativeGrip = { top: box.top, width: box.width, height: box.height };
      }, variant.height + 16);
      const resized = await stepGeometry(page, 'queue000001');
      assertFixedGapGeometry(resized);
      assert.equal(resized.row.height, variant.height + 16);
      assert.deepEqual({ top: resized.gripInk.top, width: resized.gripInk.width, height: resized.gripInk.height },
        await page.evaluate(() => fixture.resizedNativeGrip), 'Fixed spacing must not rewrite native grip geometry');
      await page.setViewportSize({ width: 1200, height: 800 });
      assertFixedGapGeometry(await stepGeometry(page, 'queue000001'));
      await clickArrow(page, 'queue000001', 'up');
      await page.waitForFunction(() => fixture.owner.data.currentIndex === 1);
      assert.equal(await page.evaluate(() => fixture.dropCalls.length), 1);
      const grip = await row(page, 'queue000001').locator('[data-native-queue-grip] path').boundingBox();
      assert.ok(grip);
      await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2);
      await page.mouse.down();
      await page.mouse.move(grip.x + grip.width / 2 + 4, grip.y + grip.height / 2 + 8);
      await page.waitForFunction(() => fixture.nativeMouseStarts === 1);
      await page.mouse.up();
      assert.equal(await page.evaluate(() => fixture.dropCalls.length), 1, 'Native dragging must not issue a second step command');
      await unchangedPlayback(page);
    });
  }
}

test('fixed CSS spacing adds no resize observer or idle animation-frame loop', async t => {
  const page = await open(t, { configure: () => {
    const NativeResizeObserver = window.ResizeObserver;
    fixture.resizeObserverConstructions = 0; fixture.scheduledFrames = 0;
    window.ResizeObserver = class extends NativeResizeObserver {
      constructor(callback) { super(callback); fixture.resizeObserverConstructions++; }
    };
    const nativeFrame = window.requestAnimationFrame.bind(window);
    window.requestAnimationFrame = callback => { fixture.scheduledFrames++; return nativeFrame(callback); };
  } }); await ready(page);
  await page.waitForTimeout(150);
  assert.equal(await page.evaluate(() => fixture.resizeObserverConstructions), 0);
  const before = await page.evaluate(() => fixture.scheduledFrames);
  await page.waitForTimeout(250);
  assert.equal(await page.evaluate(() => fixture.scheduledFrames), before, 'Unchanged geometry must not schedule frames continuously');
  await page.evaluate(() => { fixture.items.children[1].style.height = '96px'; window.dispatchEvent(new Event('resize')); });
  await page.waitForTimeout(150);
  assert.equal(await page.evaluate(() => fixture.scheduledFrames), before, 'CSS-only spacing must not schedule measurement work on resize');
  assertFixedGapGeometry(await stepGeometry(page, 'queue000001'));
  await page.evaluate(() => fixture.restamp(true));
  await page.waitForTimeout(150);
  assert.equal(await page.locator('#items [data-ywlc-queue-step]').count(), 36);
  assert.equal(await page.evaluate(() => fixture.resizeObserverConstructions), 0);
  const restampedFrames = await page.evaluate(() => fixture.scheduledFrames);
  await page.waitForTimeout(150);
  assert.equal(await page.evaluate(() => fixture.scheduledFrames), restampedFrames, 'Native restamping must settle without a frame loop');
  await page.evaluate(() => fixture.disposeSteps());
  assert.equal(await page.locator('#items [data-ywlc-queue-step]').count(), 0);
  const disposedFrames = await page.evaluate(() => fixture.scheduledFrames);
  await page.evaluate(() => { fixture.items.children[0].style.height = '96px'; window.dispatchEvent(new Event('resize')); });
  await page.waitForTimeout(150);
  assert.equal(await page.evaluate(() => fixture.scheduledFrames), disposedFrames, 'Disposed controls must not retain resize scheduling');
  await unchangedPlayback(page);
});

test('busy delayed native commits cannot be submitted twice', async t => {
  const page = await open(t, { configure: () => { fixture.dropMode = 'delay'; fixture.dropDelay = 250; } }); await ready(page);
  await clickArrow(page, 'queue000001', 'up');
  assert.equal(await arrow(page, 'queue000001', 'up').isDisabled(), true);
  assert.equal(await arrow(page, 'aaaaaaaaaaa', 'down').isDisabled(), true);
  await page.waitForFunction(() => fixture.owner.data.currentIndex === 1);
  await page.waitForFunction(() => [...fixture.items.querySelectorAll('[data-ywlc-queue-step="down"]')].some(button => !button.disabled));
  assert.equal(await page.evaluate(() => fixture.dropCalls.length), 1);
  await unchangedPlayback(page);
});

test('synthetic arrow clicks do not issue native queue commands', async t => {
  const page = await open(t); await ready(page);
  await arrow(page, 'queue000001', 'up').evaluate(button => button.click());
  assert.equal(await page.evaluate(() => fixture.dropCalls.length), 0);
  assert.deepEqual(await page.evaluate(() => fixture.order()), await page.evaluate(() => fixture.originalIds));
});

for (const unsafe of ['saved-playlist', 'missing-handler', 'cannot-reorder', 'incomplete', 'duplicate-set-id', 'row-mismatch', 'player-mismatch', 'malformed-player-playlist-string', 'malformed-player-playlist-object', 'current-index', 'dragging', 'advertisement', 'ambiguous-player']) {
  test(`unsafe ${unsafe} snapshots do not expose an enabled queue action`, async t => {
    const page = await open(t);
    await page.evaluate(unsafe => {
      const f = fixture;
      if (unsafe === 'saved-playlist') f.owner.data.playlistId = 'PLsavedplaylist';
      if (unsafe === 'missing-handler') f.owner.handleDrop = undefined;
      if (unsafe === 'cannot-reorder') f.owner.canReorder = false;
      if (unsafe === 'incomplete') f.owner.data.totalVideos++;
      if (unsafe === 'duplicate-set-id') f.owner.data.contents[1].playlistPanelVideoRenderer.playlistSetVideoId = f.owner.data.contents[0].playlistPanelVideoRenderer.playlistSetVideoId;
      if (unsafe === 'row-mismatch') f.items.children[1].data = { ...f.items.children[1].data, videoId: 'zzzzzzzzzzz' };
      if (unsafe === 'player-mismatch') document.getElementById('movie_player').getPlaylistId = () => 'TLPQanother';
      if (unsafe === 'malformed-player-playlist-string') document.getElementById('movie_player').getPlaylist = () => 'not-an-array';
      if (unsafe === 'malformed-player-playlist-object') document.getElementById('movie_player').getPlaylist = () => ({ videoIds: [...f.originalIds] });
      if (unsafe === 'current-index') f.owner.data.currentIndex = 1;
      if (unsafe === 'dragging') f.group.dragger_ = {};
      if (unsafe === 'advertisement') document.getElementById('movie_player').classList.add('ad-showing');
      if (unsafe === 'ambiguous-player') document.body.append(document.getElementById('movie_player').cloneNode(true));
      f.notifyQueue();
    }, unsafe);
    await page.waitForTimeout(100);
    assert.equal(await page.locator('#items [data-ywlc-queue-step]:enabled').count(), 0);
    assert.equal(await page.evaluate(() => fixture.dropCalls.length), 0);
    assert.deepEqual(await page.evaluate(() => fixture.order()), await page.evaluate(() => fixture.originalIds));
  });
}

test('native drop throws restore the owned DOM move without changing queue data', async t => {
  const page = await open(t, { configure: () => { fixture.dropMode = 'throw'; } }); await ready(page);
  await clickArrow(page, 'queue000001', 'up');
  await page.waitForFunction(() => JSON.stringify(fixture.order()) === JSON.stringify(fixture.originalIds));
  assert.equal(await page.evaluate(() => fixture.dropCalls.length), 1);
  assert.deepEqual(await page.evaluate(() => document.getElementById('movie_player').getPlaylist()), await page.evaluate(() => fixture.originalIds));
  await unchangedPlayback(page);
});

test('an unconfirmed native move times out once and restores its owned DOM order', { timeout: 10000 }, async t => {
  const page = await open(t, { configure: () => { fixture.dropMode = 'ignore'; } }); await ready(page);
  await clickArrow(page, 'queue000001', 'up');
  await page.waitForFunction(() => JSON.stringify(fixture.order()) === JSON.stringify(fixture.originalIds), null, { timeout: 5000 });
  assert.equal(await page.evaluate(() => fixture.dropCalls.length), 1);
  await unchangedPlayback(page);
});

test('rollback does not overwrite a concurrent native reorder', async t => {
  const page = await open(t, { configure: () => { fixture.dropMode = 'third-party-throw'; } }); await ready(page);
  await clickArrow(page, 'queue000001', 'up');
  const state = await page.evaluate(() => ({ dom: fixture.order(), native: document.getElementById('movie_player').getPlaylist(), original: fixture.originalIds }));
  assert.notDeepEqual(state.dom, state.original);
  assert.deepEqual(state.dom, state.native);
  assert.equal(await page.evaluate(() => fixture.dropCalls.length), 1);
  await unchangedPlayback(page);
});

for (const changed of ['queue-id', 'queue-order']) {
  test(`rollback does not touch a player whose ${changed} changed during native refusal`, async t => {
    const page = await open(t); await ready(page);
    await page.evaluate(changed => {
      fixture.dropMode = 'ignore';
      const nativeDrop = fixture.owner.handleDrop;
      fixture.owner.handleDrop = event => {
        nativeDrop(event);
        const player = document.getElementById('movie_player');
        if (changed === 'queue-id') player.getPlaylistId = () => 'TLPQanother';
        else player.getPlaylist = () => {
          const ids = [...fixture.originalIds]; [ids[2], ids[3]] = [ids[3], ids[2]]; return ids;
        };
        throw new Error('The native player changed queues before refusing the move');
      };
    }, changed);
    const original = await page.evaluate(() => fixture.originalIds);
    await clickArrow(page, 'queue000001', 'up');
    assert.deepEqual(await page.evaluate(() => fixture.order()), [original[1], original[0], ...original.slice(2)],
      'A previous queue operation must not roll back DOM after player ownership changes');
    assert.equal(await page.evaluate(() => fixture.dropCalls.length), 1);
    assert.deepEqual(await page.evaluate(() => fixture.owner.data.contents.map(item => item.playlistPanelVideoRenderer.videoId)), original);
    await unchangedPlayback(page);
  });
}

for (const keepOwned of [false, true]) {
 test(`native restamping ${keepOwned ? 'with cloned' : 'without'} arrows replaces stale nodes without duplication`, async t => {
  const page = await open(t); await ready(page);
  await page.evaluate(keepOwned => { fixture.oldArrow = fixture.items.querySelector('[data-ywlc-queue-step="down"]'); fixture.restamp(keepOwned); }, keepOwned);
  await page.waitForFunction(() => fixture.items.querySelectorAll('[data-ywlc-queue-step-controls]').length === fixture.originalIds.length);
  assert.equal(await page.evaluate(() => fixture.oldArrow.isConnected), false);
  assert.equal(await page.locator('#items [data-ywlc-queue-step]').count(), 36);
  await clickArrow(page, 'queue000001', 'up');
  assert.equal(await page.evaluate(() => fixture.dropCalls.length), 1);
  await unchangedPlayback(page);
 });
}

for (const view of ['desktop', 'miniplayer']) {
  for (const damage of ['handle-contents', 'one-arrow', 'marker', 'button-marker', 'glyph', 'glyph-path', 'moved-arrow', 'nested-clone']) {
    test(`queue arrows recover ${damage} while hovered without replacing the native handle (${view})`, async t => {
      const page = await open(t, { view }); await ready(page);
      await row(page, 'queue000001').hover();
      await page.evaluate(damage => {
        const item = fixture.items.querySelector('[data-video-id="queue000001"]');
        const handle = item.querySelector('.playlist-drag-handle');
        fixture.recoveryHandle = handle;
        fixture.recoveryGrip = handle.querySelector('[data-native-queue-grip]');
        fixture.recoveryUp = handle.querySelector('[data-ywlc-queue-step="up"]');
        if (damage === 'handle-contents') handle.replaceChildren(fixture.recoveryGrip);
        if (damage === 'one-arrow') fixture.recoveryUp.remove();
        if (damage === 'marker') handle.removeAttribute('data-ywlc-queue-step-controls');
        if (damage === 'button-marker') fixture.recoveryUp.removeAttribute('data-ywlc-queue-step');
        if (damage === 'glyph') fixture.recoveryUp.replaceChildren();
        if (damage === 'glyph-path') fixture.recoveryUp.querySelector('path').setAttribute('d','');
        if (damage === 'moved-arrow') document.body.append(fixture.recoveryUp);
        if (damage === 'nested-clone') {
          const wrapper = document.createElement('span');
          wrapper.append(fixture.recoveryUp.cloneNode(true)); handle.append(wrapper);
        }
      }, damage);
      await page.waitForFunction(() => {
        const handle = fixture.recoveryHandle, up = handle.querySelector('[data-ywlc-queue-step="up"]');
        return up && up !== fixture.recoveryUp && up.parentElement === handle &&
          handle.hasAttribute('data-ywlc-queue-step-controls') &&
          handle.querySelectorAll('[data-ywlc-queue-step]').length === 2 && Boolean(up.querySelector('svg path'));
      });
      assert.equal(await row(page, 'queue000001').locator('.playlist-drag-handle').evaluate(h => h === fixture.recoveryHandle), true);
      assert.equal(await row(page, 'queue000001').locator('[data-native-queue-grip]').evaluate(h => h === fixture.recoveryGrip), true);
      assert.equal((await arrowPresentation(arrow(page, 'queue000001', 'up'))).opacity, 1);
      await arrow(page, 'queue000001', 'up').click();
      await page.waitForFunction(() => fixture.owner.data.currentIndex === 1);
      assert.equal(await page.evaluate(() => fixture.dropCalls.length), 1);
      assert.equal(await page.locator('#items [data-ywlc-queue-step]').count(), 36);
      await unchangedPlayback(page);
    });
  }
}

test('repairing handle contents settles without polling and native grip glyph changes do not rescan the queue', async t => {
  const page = await open(t); await ready(page);
  await page.evaluate(() => {
    fixture.recoveryFrames=0;
    const original=requestAnimationFrame;
    window.requestAnimationFrame=callback=>{ fixture.recoveryFrames++; return original(callback); };
    const handle=fixture.items.querySelector('[data-video-id="queue000001"] .playlist-drag-handle');
    fixture.recoveryHandle=handle; handle.replaceChildren(handle.querySelector('[data-native-queue-grip]'));
  });
  await page.waitForFunction(()=>fixture.recoveryHandle.querySelectorAll('[data-ywlc-queue-step]').length===2);
  await page.waitForTimeout(120);
  const settled=await page.evaluate(()=>fixture.recoveryFrames);
  await page.waitForTimeout(160);
  assert.equal(await page.evaluate(()=>fixture.recoveryFrames),settled);
  await page.evaluate(()=>fixture.recoveryHandle.querySelector('[data-native-queue-grip] path').setAttribute('d','M4 9h16v2H4z'));
  await page.waitForTimeout(100);
  assert.equal(await page.evaluate(()=>fixture.recoveryFrames),settled,'Unrelated native SVG updates remain outside recovery');
});

test('a direction changed immediately before a trusted click cannot dispatch a wrong-way move',async t=>{
  const page=await open(t); await ready(page); await row(page,'queue000001').hover();
  await page.evaluate(()=>{
    window.addEventListener('click',event=>{
      const button=event.target.closest('[data-ywlc-queue-step="up"]');
      if(button){ fixture.corruptedArrow=button; button.setAttribute('data-ywlc-queue-step','down'); }
    },{capture:true,once:true});
  });
  await arrow(page,'queue000001','up').click();
  await page.waitForFunction(()=>{
    const up=fixture.items.querySelector('[data-video-id="queue000001"] [data-ywlc-queue-step="up"]');
    return up && up!==fixture.corruptedArrow;
  });
  assert.equal(await page.evaluate(()=>fixture.dropCalls.length),0);
  assert.deepEqual(await page.evaluate(()=>fixture.order()),await page.evaluate(()=>fixture.originalIds));
  await unchangedPlayback(page);
});

test('a tracked queue recovers native row restamping without a global queue event', async t => {
  const page = await open(t); await ready(page);
  await page.evaluate(() => {
    fixture.notifyQueue = () => {};
    fixture.oldArrow = fixture.items.querySelector('[data-ywlc-queue-step="down"]');
    fixture.restamp(true);
  });
  await page.waitForFunction(() => fixture.items.querySelectorAll('[data-ywlc-queue-step-controls]').length === fixture.originalIds.length);
  assert.equal(await page.evaluate(() => fixture.oldArrow.isConnected), false);
  assert.equal(await page.locator('#items [data-ywlc-queue-step]').count(), 36);
  await clickArrow(page, 'queue000001', 'up');
  await page.waitForFunction(() => fixture.owner.data.currentIndex === 1);
  assert.equal(await page.evaluate(() => fixture.dropCalls.length), 1);
  await unchangedPlayback(page);
});

test('native restamping during confirmation restores keyboard focus to the same queue item', async t => {
  const page = await open(t, { configure: () => {
    const nativeDrop = fixture.owner.handleDrop;
    fixture.owner.handleDrop = event => { nativeDrop(event); fixture.restamp(true); };
  } }); await ready(page);
  await arrow(page, 'queue000001', 'up').focus();
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => document.activeElement?.getAttribute('data-ywlc-queue-step') === 'down' &&
    document.activeElement.closest('ytd-playlist-panel-video-renderer')?.dataset.videoId === 'queue000001');
  assert.equal(await page.locator('#items [data-ywlc-queue-step]').count(), 36);
  assert.equal(await page.evaluate(() => fixture.dropCalls.length), 1);
  await page.keyboard.press('Space');
  await page.waitForFunction(() => fixture.dropCalls.length === 2);
  assert.deepEqual(await page.evaluate(() => fixture.order()), await page.evaluate(() => fixture.originalIds));
  await unchangedPlayback(page);
});

test('current yt playlist-panel hosts use the same bound one-step native path', async t => {
  const page = await open(t); await ready(page);
  await page.evaluate(() => {
    const old = fixture.panel;
    const panel = document.createElement('yt-playlist-panel-renderer');
    panel.style.cssText = 'display:block;width:374px';
    panel.setAttribute('can-reorder', ''); panel.canReorder = true; panel.polymerController = fixture.owner;
    panel.append(...old.childNodes); old.replaceWith(panel); fixture.panel = panel;
    for (const previous of [...fixture.items.children]) {
      const current = document.createElement('yt-playlist-panel-video-renderer');
      current.style.cssText = 'display:block;height:76px;width:100%';
      current.dataset.videoId = previous.dataset.videoId; current.data = previous.data;
      if (previous.hasAttribute('selected')) current.setAttribute('selected', '');
      current.append(...previous.childNodes); previous.replaceWith(current);
    }
    fixture.notifyQueue();
  });
  const target = page.locator('#items > yt-playlist-panel-video-renderer[data-video-id="queue000001"] [data-ywlc-queue-step="up"]');
  await target.waitFor(); await target.locator('xpath=ancestor::yt-playlist-panel-video-renderer').hover(); await target.click();
  await page.waitForFunction(() => fixture.owner.data.currentIndex === 1);
  assert.equal(await page.evaluate(() => fixture.dropCalls.length), 1);
  await unchangedPlayback(page);
});

test('the untouched centre handle still starts native dragging', async t => {
  const page = await open(t); await ready(page);
  const handle = row(page, 'queue000001').locator('.playlist-drag-handle');
  const before = await handle.boundingBox(); assert.ok(before);
  await page.mouse.move(before.x + before.width / 2, before.y + before.height / 2);
  await page.mouse.down();
  await page.mouse.move(before.x + before.width / 2 + 4, before.y + before.height / 2 + 8);
  await page.waitForFunction(() => fixture.nativeMouseStarts === 1);
  assert.equal(await page.evaluate(() => fixture.group.isDragging()), true);
  assert.equal(await page.locator('.dragging [data-ywlc-queue-step]').filter({ visible: true }).count(), 0);
  await page.mouse.up();
  assert.equal(await page.evaluate(() => fixture.dropCalls.length), 0);
  await unchangedPlayback(page);
});

for (const lifecycle of ['yt-navigate-start', 'pagehide', 'dispose']) {
  test(`step controls release on ${lifecycle}`, async t => {
    const page = await open(t); await ready(page);
    await page.evaluate(lifecycle => lifecycle === 'dispose' ? fixture.disposeSteps() : window.dispatchEvent(new Event(lifecycle)), lifecycle);
    await page.waitForFunction(() => document.querySelectorAll('[data-ywlc-queue-step-controls]').length === 0);
    assert.equal(await page.locator('#items .playlist-drag-handle').count(), 18, 'Native handles survive Suite cleanup');
    assert.equal(await page.evaluate(() => fixture.dropCalls.length), 0);
  });
}

for (const [suspend, resume] of [['yt-navigate-start', 'yt-navigate-finish'], ['pagehide', 'pageshow']]) {
  test(`step controls rebind once after ${suspend} and ${resume}`, async t => {
    const page = await open(t); await ready(page);
    await page.evaluate(([suspend, resume]) => {
      window.dispatchEvent(new Event(suspend));
      fixture.restamp(true);
      window.dispatchEvent(new Event(resume));
    }, [suspend, resume]);
    await ready(page);
    assert.equal(await page.locator('#items [data-ywlc-queue-step]').count(), 36);
    await clickArrow(page, 'queue000001', 'up');
    await page.waitForFunction(() => fixture.owner.data.currentIndex === 1);
    assert.equal(await page.evaluate(() => fixture.dropCalls.length), 1);
    await unchangedPlayback(page);
  });
}

test('navigation abandons an unconfirmed move and restores only its owned DOM change', async t => {
  const page = await open(t, { configure: () => { fixture.dropMode = 'ignore'; } }); await ready(page);
  await clickArrow(page, 'queue000001', 'up');
  assert.notDeepEqual(await page.evaluate(() => fixture.order()), await page.evaluate(() => fixture.originalIds));
  await page.evaluate(() => window.dispatchEvent(new Event('yt-navigate-start')));
  assert.deepEqual(await page.evaluate(() => fixture.order()), await page.evaluate(() => fixture.originalIds));
  assert.equal(await page.locator('#items [data-ywlc-queue-step]').count(), 0);
  assert.equal(await page.evaluate(() => fixture.dropCalls.length), 1);
  await unchangedPlayback(page);
});

test('the generated Suite installs one-step controls in both queue views', { timeout: 20000 }, async t => {
  for (const view of ['desktop', 'miniplayer']) {
    const page = await open(t, { view, suite: true }); await ready(page);
    await clickArrow(page, 'queue000001', 'up');
    await page.waitForFunction(() => fixture.owner.data.currentIndex === 1);
    assert.equal(await page.evaluate(() => fixture.dropCalls.length), 1);
    await unchangedPlayback(page);
  }
});
