import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { after, before, test } from 'node:test';
import { createSuiteSettings } from '../../sources/suite-settings.mjs';
import { launchFixtureBrowser, waitForSuiteHealth } from './fixture-browser.mjs';

const SUITE = readFileSync(new URL('../../youtube-master-suite.user.js', import.meta.url), 'utf8');
const FIXTURE = readFileSync(new URL('./watch-page.html', import.meta.url), 'utf8');
const MANIFEST = JSON.parse(readFileSync(new URL('../../release-manifest.json', import.meta.url), 'utf8'));
const KEY = 'yt-master-suite.settings.v1';
const FILTER_KEY = 'yt-master-suite.channel-age.v1';
const CORNER_KEY = 'yt-master-suite.scroll-miniplayer.corner.v1';
const defaults = createSuiteSettings(() => ({ getItem: () => null }), () => true).read();
const channel = { channelId: 'UC' + 'a'.repeat(22), name: 'Example channel', maxAge: 1, unit: 'weeks', enabled: true, blocked: false };
const envelope = (settings = {}, filters = [channel]) => ({
  format: 'youtube-master-suite-backup', version: 1, language: 'en-GB', settings: { ...defaults, ...settings }, channelFilters: filters,
});
let browser;
before(async () => { browser = await launchFixtureBrowser(); }, { timeout: 30000 });
after(async () => { await browser?.close(); }, { timeout: 10000 });
async function openFixture(t, viewport = { width: 1280, height: 900 }, strict = false) {
  const context = await browser.newContext({ viewport, serviceWorkers: 'block', acceptDownloads: true });
  await context.route('**/*', route => route.request().url().startsWith('https://www.youtube.com/watch?')
    ? route.fulfill({ contentType: 'text/html', body: FIXTURE,
      headers: strict ? { 'Content-Security-Policy': "require-trusted-types-for 'script'; trusted-types 'none'" } : {},
    }) : route.abort());
  await context.addInitScript({ content: SUITE });
  const page = await context.newPage(); page.setDefaultTimeout(7000);
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  t.after(async () => { try { assert.deepEqual(errors, []); } finally { await context.close(); } });
  await page.goto('https://www.youtube.com/watch?v=aaaaaaaaaaa&list=fixture-queue');
  await waitForSuiteHealth(page, MANIFEST.registeredModules, { timeoutMs: 7000, errors });
  await page.locator('#ytms-settings-button').click();
  await page.locator('#ytms-tab-support').click();
  return page;
}
async function importBackup(page, value) {
  await page.locator('#ytms-import-backup').setInputFiles({ name: 'backup.json', mimeType: 'application/json', buffer: Buffer.from(typeof value === 'string' ? value : JSON.stringify(value)) });
}
async function stored(page) {
  return page.evaluate(([a, b, c]) => [localStorage.getItem(a), localStorage.getItem(b), localStorage.getItem(c)], [KEY, FILTER_KEY, CORNER_KEY]);
}

test('backup download contains saved values only and does not save a settings draft', async t => {
  const page = await openFixture(t);
  await page.locator('#ytms-tab-layout').click();
  await page.locator('#ytms-disableTitleHashtagLinks').check();
  await page.locator('#ytms-tab-support').click();
  const before = await stored(page);
  const downloadEvent = page.waitForEvent('download');
  await page.locator('#ytms-export-backup').click();
  const download = await downloadEvent;
  assert.equal(download.suggestedFilename(), 'youtube-master-suite-backup.json');
  const stream = await download.createReadStream(); const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  const result = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  assert.deepEqual(result, envelope({}, []));
  assert.deepEqual(await stored(page), before);
  assert.equal(await page.locator('#ytms-save-preview').isEnabled(), true);
});

test('restore requires a preview and acknowledgement, updates filters, and never reloads playback', async t => {
  const page = await openFixture(t);
  const before = await page.locator('video').evaluate(video => [video.currentTime, video.paused, video.volume]);
  const url = page.url();
  await page.evaluate(() => { window.supportSentinel = true; window.channelFilterChanges = 0; window.addEventListener('yt-master-channel-age-changed', () => window.channelFilterChanges++); });
  const initial = await stored(page);
  await importBackup(page, envelope({ hideRelated: false }));
  await page.locator('#ytms-backup-preview').waitFor({ state: 'visible' });
  assert.match(await page.locator('#ytms-backup-preview').innerText(), /1 setting changed.*1 added/s);
  assert.deepEqual(await stored(page), initial);
  assert.equal(await page.locator('#ytms-restore-backup').isDisabled(), true);
  await page.locator('#ytms-confirm-restore').check();
  await page.locator('#ytms-restore-backup').click();
  const saved = await stored(page);
  assert.equal(JSON.parse(saved[0]).values.hideRelated, false);
  assert.deepEqual(JSON.parse(saved[1]).rules, [channel]);
  assert.equal(await page.locator('#ytms-backup-preview').isHidden(), true);
  assert.match(await page.locator('#ytms-backup-status').innerText(), /Backup restored/);
  assert.equal(await page.locator('#ytms-save-preview').innerText(), 'Reload now');
  assert.equal(await page.evaluate(() => window.supportSentinel), true);
  assert.equal(await page.evaluate(() => window.channelFilterChanges), 1);
  assert.equal(page.url(), url);
  assert.deepEqual(await page.locator('video').evaluate(video => [video.currentTime, video.paused, video.volume]), before);
  await page.locator('#ytms-tab-channels').click();
  assert.match(await page.locator('#ytms-channel-filter-list').innerText(), /Example channel/);
});

test('restore refuses unsaved drafts and storage changes made after preview', async t => {
  const page = await openFixture(t);
  await page.locator('#ytms-tab-layout').click(); await page.locator('#ytms-hideRelated').uncheck();
  await page.locator('#ytms-tab-support').click(); await importBackup(page, envelope());
  await page.locator('#ytms-confirm-restore').check();
  assert.equal(await page.locator('#ytms-restore-backup').isDisabled(), true);
  assert.match(await page.locator('#ytms-backup-status').innerText(), /Save or discard/);
  await page.locator('#ytms-cancel-panel').click();
  await page.locator('#ytms-settings-button').click(); await page.locator('#ytms-tab-support').click();
  assert.equal(await page.locator('#ytms-backup-preview').isHidden(), true);
  await importBackup(page, envelope()); await page.locator('#ytms-confirm-restore').check();
  await page.evaluate(key => localStorage.setItem(key, 'bottom-left'), CORNER_KEY);
  await page.locator('#ytms-restore-backup').click();
  assert.match(await page.locator('#ytms-backup-status').innerText(), /changed/i);
  assert.equal((await stored(page))[2], 'bottom-left');
  assert.equal((await stored(page))[1], null);
});

test('invalid, oversized and cancelled imports leave saved data unchanged', async t => {
  const page = await openFixture(t); const initial = await stored(page);
  await importBackup(page, '{broken');
  await page.waitForFunction(() => !document.querySelector('#ytms-backup-status').textContent.includes('Reading'));
  assert.equal(await page.locator('#ytms-backup-preview').isHidden(), true);
  await importBackup(page, 'x'.repeat(131073));
  assert.match(await page.locator('#ytms-backup-status').innerText(), /128 KiB/);
  await importBackup(page, envelope()); await page.locator('#ytms-cancel-restore').click();
  assert.equal(await page.locator('#ytms-backup-preview').isHidden(), true);
  assert.deepEqual(await stored(page), initial);
});

test('saving or reverting an unrelated draft immediately updates restore availability', async t => {
  const page = await openFixture(t);
  await page.locator('#ytms-tab-layout').click(); await page.locator('#ytms-hideRelated').uncheck();
  await page.locator('#ytms-tab-support').click(); await importBackup(page, envelope());
  await page.locator('#ytms-confirm-restore').check();
  assert.equal(await page.locator('#ytms-restore-backup').isDisabled(), true);
  await page.locator('#ytms-save-preview').click();
  assert.equal(await page.locator('#ytms-restore-backup').isEnabled(), true);
  // Saving changed the preview's storage baseline; restore must still reject it.
  await page.locator('#ytms-restore-backup').click();
  assert.match(await page.locator('#ytms-backup-status').innerText(), /changed after this preview/);
  await importBackup(page, envelope()); await page.locator('#ytms-confirm-restore').check();
  await page.locator('#ytms-tab-layout').click(); await page.locator('#ytms-hideRelated').check();
  await page.locator('#ytms-tab-support').click();
  assert.equal(await page.locator('#ytms-restore-backup').isDisabled(), true);
  await page.locator('#ytms-tab-layout').click(); await page.locator('#ytms-hideRelated').uncheck();
  await page.locator('#ytms-tab-support').click();
  assert.equal(await page.locator('#ytms-restore-backup').isEnabled(), true);
});

test('support report is local and privacy-safe with manual clipboard fallback', async t => {
  const page = await openFixture(t);
  await page.evaluate(() => {
    const secret = 'private-video-title-account@example.invalid';
    document.documentElement.setAttribute('data-yt-master-runtime-errors', JSON.stringify([{ module: 'suiteSettings', operation: secret, message: secret, timestamp: secret }]));
    document.documentElement.setAttribute('data-yt-master-state', JSON.stringify({ url: secret, urlVideoId: secret, playerVideoId: secret, nativeLoading: true }));
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: () => Promise.reject(new Error(secret)) } });
  });
  await page.locator('#ytms-copy-support').click();
  await page.waitForFunction(() => document.querySelector('#ytms-support-status').textContent.includes('manually'));
  const report = await page.locator('#ytms-support-report').inputValue();
  assert.equal(report.includes('private-video'), false);
  assert.equal(JSON.parse(report).version, MANIFEST.version);
  assert.equal(await page.locator('#ytms-support-report').evaluate(node => node.selectionStart === 0 && node.selectionEnd === node.value.length), true);
  assert.equal(await page.locator('#ytms-restore-section-defaults').isDisabled(), true);
  assert.equal(await page.locator('#ytms-save-preview').isDisabled(), true);
});

test('support tools fit narrow light/dark panels and strict Trusted Types', async t => {
  const page = await openFixture(t, { width: 1280, height: 900 }, true);
  assert.equal(await page.locator('#ytms-settings-dialog nav').evaluate(node => node.scrollWidth <= node.clientWidth), true);
  for (const width of [360, 320]) {
    await page.setViewportSize({ width, height: 600 });
    for (const dark of [false, true]) {
      await page.evaluate(dark => document.documentElement.toggleAttribute('dark', dark), dark);
      await importBackup(page, envelope({ hideRelated: false })); await page.locator('#ytms-backup-preview').waitFor({ state: 'visible' });
      assert.equal(await page.locator('#ytms-settings-dialog .content').evaluate(node => node.scrollWidth <= node.clientWidth), true);
      assert.equal(await page.locator('#ytms-support-report').evaluate(node => getComputedStyle(node).color !== getComputedStyle(node).backgroundColor), true);
      await page.locator('#ytms-confirm-restore').check();
      assert.equal(await page.locator('#ytms-restore-backup').evaluate(node => getComputedStyle(node).color), 'rgb(255, 255, 255)');
    }
  }
});

test('an old clipboard request cannot update or focus a reopened settings panel', async t => {
  const page = await openFixture(t);
  for (const reject of [false, true]) {
    await page.evaluate(() => Object.defineProperty(navigator, 'clipboard', {
      configurable: true, value: { writeText: () => new Promise((resolve, reject) => { window.finishCopy = { resolve, reject }; }) },
    }));
    await page.locator('#ytms-copy-support').click();
    await page.locator('#ytms-cancel-panel').click();
    await page.locator('#ytms-settings-button').click(); await page.locator('#ytms-tab-support').click();
    await page.evaluate(reject => reject ? window.finishCopy.reject(new Error('Denied')) : window.finishCopy.resolve(), reject);
    assert.equal(await page.locator('#ytms-support-status').innerText(), '');
    assert.notEqual(await page.evaluate(() => document.activeElement.id), 'ytms-support-report');
  }
  await page.evaluate(() => Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: value => { window.copiedReport = value; return Promise.resolve(); } } }));
  await page.locator('#ytms-copy-support').click();
  await page.waitForFunction(() => document.querySelector('#ytms-support-status').textContent.includes('Report copied'));
  assert.equal(await page.evaluate(() => window.copiedReport), await page.locator('#ytms-support-report').inputValue());
});
