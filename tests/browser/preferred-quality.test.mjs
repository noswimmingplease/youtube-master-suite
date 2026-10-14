import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { before, after, test } from 'node:test';
import { launchFixtureBrowser, waitForSuiteHealth } from './fixture-browser.mjs';

const SUITE = readFileSync(new URL('../../youtube-master-suite.user.js', import.meta.url), 'utf8');
const MANIFEST = JSON.parse(readFileSync(new URL('../../release-manifest.json', import.meta.url), 'utf8'));
const BASE = readFileSync(new URL('./watch-page.html', import.meta.url), 'utf8');
const KEY = 'yt-master-suite.settings.v1';
const SETUP = `<script>
  const nativePlayer = document.getElementById('movie_player');
  const qualityFixture = window.qualityFixture = {
    quality: 'medium', levels: ['hd2160', 'hd1080', 'hd720', 'large', 'medium', 'small', 'tiny'],
    ready: true, confirm: true, calls: [], playable: null, settingsClicks: 0, manualClicks: 0,
  };
  nativePlayer.getAvailableQualityLevels = () => qualityFixture.ready ? qualityFixture.levels : [];
  nativePlayer.getAvailableQualityData = () => qualityFixture.playable;
  nativePlayer.getPlaybackQuality = () => qualityFixture.quality;
  nativePlayer.setPlaybackQualityRange = (min, max) => {
    qualityFixture.calls.push({ videoId: fixture.playerId, min, max });
    if (qualityFixture.confirm) qualityFixture.quality = min;
  };
  nativePlayer.setPlaybackQuality = () => { throw Error('Legacy quality setter must not run'); };
  const qualityMenu = document.createElement('div'); qualityMenu.className = 'ytp-settings-menu';
  qualityMenu.style.cssText = 'display:none;position:absolute;left:0;top:0;width:180px;height:80px;background:#222;z-index:10';
  const qualityChoice = document.createElement('button'); qualityChoice.id = 'fixture-quality-choice'; qualityChoice.textContent = '480p';
  qualityChoice.className = 'ytp-menuitem'; qualityChoice.setAttribute('role', 'menuitemradio');
  qualityChoice.addEventListener('click', () => { qualityFixture.quality = 'large'; qualityFixture.manualClicks++; qualityMenu.style.display = 'none'; });
  qualityMenu.append(qualityChoice); nativePlayer.append(qualityMenu);
  nativePlayer.querySelector('.ytp-settings-button').addEventListener('click', () => {
    qualityFixture.settingsClicks++; qualityMenu.style.display = 'block';
  });
  const parameters = new URL(location.href).searchParams;
  if (parameters.has('ignored')) qualityFixture.confirm = false;
  if (parameters.has('not-ready')) qualityFixture.ready = false;
  if (parameters.has('ad')) nativePlayer.classList.add('ad-showing');
  if (parameters.has('unsupported')) nativePlayer.setPlaybackQualityRange = undefined;
</script>`;
let browser;
before(async () => { browser = await launchFixtureBrowser(); }, { timeout: 30000 });
after(async () => { await browser?.close(); }, { timeout: 10000 });

async function openFixture(t, values = {}, parameters = '', live = false) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, serviceWorkers: 'block' });
  await context.route('**/*', route => /https:\/\/www\.youtube\.com\/(watch\?|live\/)/.test(route.request().url())
    ? route.fulfill({ contentType: 'text/html', body: BASE.replace('</body>', SETUP + '</body>') }) : route.abort());
  await context.addInitScript(({ key, values }) => {
    if (location.origin === 'https://www.youtube.com' && !sessionStorage.getItem('quality-fixture-seeded')) {
      localStorage.setItem(key, JSON.stringify({ version: 1, values })); sessionStorage.setItem('quality-fixture-seeded', '1');
    }
  }, { key: KEY, values });
  await context.addInitScript({ content: SUITE });
  const page = await context.newPage(); page.setDefaultTimeout(7000);
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  t.after(async () => {
    try {
      assert.deepEqual(errors, []);
      const runtime = await page.getAttribute('html', 'data-yt-master-runtime-errors');
      assert.ok(!runtime || runtime === '[]', runtime);
    } finally { await context.close(); }
  });
  await page.goto(live ? 'https://www.youtube.com/live/aaaaaaaaaaa?' + parameters :
    'https://www.youtube.com/watch?v=aaaaaaaaaaa&list=fixture-queue' + (parameters ? '&' + parameters : ''));
  await waitForSuiteHealth(page, MANIFEST.registeredModules, { timeoutMs: 10000, errors });
  await page.waitForFunction(() => Boolean(window.qualityFixture));
  return page;
}

test('YouTube-default quality leaves the native player alone', async t => {
  const page = await openFixture(t);
  await page.waitForTimeout(400);
  assert.deepEqual(await page.evaluate(() => qualityFixture.calls), []);
  assert.equal(await page.evaluate(() => qualityFixture.quality), 'medium');
});

test('preferred quality requests one confirmed resolution without changing playback, title or comments', async t => {
  const page = await openFixture(t, { preferredVideoQuality: 'hd1080' });
  await page.waitForFunction(() => qualityFixture.quality === 'hd1080');
  assert.deepEqual(await page.evaluate(() => qualityFixture.calls), [{ videoId: 'aaaaaaaaaaa', min: 'hd1080', max: 'hd1080' }]);
  assert.deepEqual(await page.evaluate(() => ({
    paused: document.querySelector('video').paused, time: document.querySelector('video').currentTime,
    volume: document.querySelector('video').volume, title: document.querySelector('h1').textContent,
    comment: document.querySelector('.comment-message').textContent,
  })), { paused: true, time: 0, volume: 1, title: 'Video A', comment: 'Comment for Video A' });
  await page.evaluate(() => {
    for (let i = 0; i < 4; i++) {
      window.dispatchEvent(new Event('yt-page-data-updated'));
      document.querySelector('video').dispatchEvent(new Event('loadedmetadata', { bubbles: true }));
    }
  });
  await page.waitForTimeout(450);
  assert.equal(await page.evaluate(() => qualityFixture.calls.length), 1);
});

test('Highest available works on live routes and ignores preview metadata', async t => {
  const page = await openFixture(t, { preferredVideoQuality: 'highest' }, '', true);
  await page.waitForFunction(() => qualityFixture.quality === 'hd2160');
  await page.evaluate(() => {
    const preview = document.createElement('video'); document.body.append(preview);
    preview.dispatchEvent(new Event('loadedmetadata', { bubbles: true })); preview.remove();
  });
  assert.deepEqual(await page.evaluate(() => qualityFixture.calls), [{ videoId: 'aaaaaaaaaaa', min: 'hd2160', max: 'hd2160' }]);
});

test('late quality readiness selects the nearest lower playable resolution', async t => {
  const page = await openFixture(t, { preferredVideoQuality: 'hd1440' }, 'not-ready=1');
  assert.deepEqual(await page.evaluate(() => qualityFixture.calls), []);
  await page.evaluate(() => {
    qualityFixture.ready = true;
    qualityFixture.playable = [{ quality: 'hd1080', isPlayable: false }, { quality: 'hd720', isPlayable: true }];
    document.querySelector('video').dispatchEvent(new Event('loadedmetadata', { bubbles: true }));
  });
  await page.waitForFunction(() => qualityFixture.quality === 'hd720');
  assert.deepEqual(await page.evaluate(() => qualityFixture.calls), [{ videoId: 'aaaaaaaaaaa', min: 'hd720', max: 'hd720' }]);
});

test('a blocked variant does not hide a playable stream sharing its resolution ID', async t => {
  const page = await openFixture(t, { preferredVideoQuality: 'hd1080' }, 'not-ready=1');
  await page.evaluate(() => {
    qualityFixture.playable = [{ quality: 'hd1080', isPlayable: false }, { quality: 'hd1080', isPlayable: true }];
    qualityFixture.ready = true;
    document.querySelector('video').dispatchEvent(new Event('loadedmetadata', { bubbles: true }));
  });
  await page.waitForFunction(() => qualityFixture.quality === 'hd1080');
  assert.deepEqual(await page.evaluate(() => qualityFixture.calls), [{ videoId: 'aaaaaaaaaaa', min: 'hd1080', max: 'hd1080' }]);
});

for (const input of ['mouse', 'keyboard']) {
  test(`${input} native settings activation cancels retries and keeps a manual quality choice`, async t => {
    const page = await openFixture(t, { preferredVideoQuality: 'hd1080' }, 'ignored=1');
    await page.waitForFunction(() => qualityFixture.calls.length > 0);
    const button = page.locator('.ytp-settings-button');
    if (input === 'mouse') await button.click();
    else { await button.focus(); await page.keyboard.press('Enter'); }
    const count = await page.evaluate(() => qualityFixture.calls.length);
    await page.locator('#fixture-quality-choice').click();
    await page.evaluate(() => {
      window.dispatchEvent(new Event('yt-page-data-updated'));
      document.querySelector('video').dispatchEvent(new Event('loadedmetadata', { bubbles: true }));
    });
    await page.waitForTimeout(1100);
    assert.deepEqual(await page.evaluate(() => ({ quality: qualityFixture.quality, calls: qualityFixture.calls.length,
      settingsClicks: qualityFixture.settingsClicks, manualClicks: qualityFixture.manualClicks })),
    { quality: 'large', calls: count, settingsClicks: 1, manualClicks: 1 });
  });
}

test('a long preroll consumes no retries; content metadata applies the preference afterwards', async t => {
  const page = await openFixture(t, { preferredVideoQuality: 'hd1080' }, 'ad=1');
  await page.waitForTimeout(400);
  assert.deepEqual(await page.evaluate(() => qualityFixture.calls), []);
  await page.evaluate(() => {
    document.querySelector('#movie_player').classList.remove('ad-showing');
    document.querySelector('video').dispatchEvent(new Event('loadedmetadata', { bubbles: true }));
  });
  await page.waitForFunction(() => qualityFixture.quality === 'hd1080');
  assert.equal(await page.evaluate(() => qualityFixture.calls.length), 1);
});

test('queue navigation cancels previous-video retries and applies only to the coherent destination', async t => {
  const page = await openFixture(t, { preferredVideoQuality: 'hd1080' }, 'ignored=1');
  await page.waitForFunction(() => qualityFixture.calls.length > 0);
  const initial = await page.evaluate(() => qualityFixture.calls.length);
  await page.evaluate(() => { qualityFixture.confirm = true; });
  await page.locator('#next-video').click();
  await page.waitForFunction(() => qualityFixture.quality === 'hd1080');
  await page.waitForTimeout(500);
  const calls = await page.evaluate(() => qualityFixture.calls);
  assert.equal(calls.filter(call => call.videoId === 'aaaaaaaaaaa').length, initial);
  assert.deepEqual(calls.filter(call => call.videoId === 'bbbbbbbbbbb'), [{ videoId: 'bbbbbbbbbbb', min: 'hd1080', max: 'hd1080' }]);
  assert.equal(await page.locator('h1').textContent(), 'Video B');
  assert.equal(await page.locator('.comment-message').textContent(), 'Comment for Video B');
});

test('page suspension cancels retries and BFCache restore does not restart a same-video override', async t => {
  const page = await openFixture(t, { preferredVideoQuality: 'hd1080' }, 'ignored=1');
  await page.waitForFunction(() => qualityFixture.calls.length > 0);
  await page.evaluate(() => window.dispatchEvent(new Event('pagehide')));
  const count = await page.evaluate(() => qualityFixture.calls.length);
  await page.waitForTimeout(400);
  await page.evaluate(() => window.dispatchEvent(new Event('pageshow')));
  await page.waitForTimeout(900);
  assert.equal(await page.evaluate(() => qualityFixture.calls.length), count);
});

test('unsupported player contracts are left alone without errors', async t => {
  const page = await openFixture(t, { preferredVideoQuality: 'highest' }, 'unsupported=1');
  await page.waitForTimeout(1000);
  assert.deepEqual(await page.evaluate(() => qualityFixture.calls), []);
});

test('Player quality setting persists on reload and keeps the panel size and existing hashtag preference', async t => {
  const page = await openFixture(t, { disableTitleHashtagLinks: true });
  await page.locator('#ytms-settings-button').click();
  const dialog = page.locator('#ytms-settings-dialog'), bounds = await dialog.boundingBox();
  await page.getByRole('tab', { name: 'Player', exact: true }).click();
  const select = page.locator('#ytms-preferredVideoQuality');
  assert.equal(await select.inputValue(), 'off');
  assert.deepEqual(await select.locator('option').allTextContents(),
    ['YouTube default', 'Highest available', '144p', '240p', '360p', '480p', '720p', '1080p', '1440p', '2160p (4K)']);
  await select.selectOption('hd1080'); await page.locator('#ytms-save-preview').click();
  assert.deepEqual(await dialog.boundingBox(), bounds);
  assert.deepEqual(await page.evaluate(() => qualityFixture.calls), [], 'Save must not change the running video');
  assert.equal(await page.evaluate(key => JSON.parse(localStorage.getItem(key)).values.disableTitleHashtagLinks, KEY), true);
  await page.reload(); await waitForSuiteHealth(page, MANIFEST.registeredModules, { timeoutMs: 10000 });
  await page.waitForFunction(() => qualityFixture.quality === 'hd1080');
  assert.equal(await page.evaluate(key => JSON.parse(localStorage.getItem(key)).values.preferredVideoQuality, KEY), 'hd1080');
});
