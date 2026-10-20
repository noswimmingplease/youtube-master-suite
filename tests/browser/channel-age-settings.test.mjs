import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { after, before, test } from 'node:test';
import { createChannelAgeDialog } from '../../sources/channel-age-dialog.mjs';
import { createChannelAgeService } from '../../sources/channel-age.mjs';
import { launchFixtureBrowser, waitForSuiteHealth } from './fixture-browser.mjs';

const CSS = readFileSync(new URL('../../assets/settings-panel.css', import.meta.url), 'utf8');
const SUITE = readFileSync(new URL('../../youtube-master-suite.user.js', import.meta.url), 'utf8');
const MANIFEST = JSON.parse(readFileSync(new URL('../../release-manifest.json', import.meta.url), 'utf8'));
const WATCH_FIXTURE = readFileSync(new URL('./watch-page.html', import.meta.url), 'utf8');
const WATCH_URL = 'https://www.youtube.com/watch?v=aaaaaaaaaaa';
const KEY = 'yt-master-suite.channel-age.v1';
const SETTINGS_KEY = 'yt-master-suite.settings.v1';
const FIRST = `UC${'a'.repeat(22)}`;
const SECOND = `UC${'b'.repeat(22)}`;
let browser;
before(async () => { browser = await launchFixtureBrowser(); }, { timeout: 30000 });
after(async () => { await browser?.close(); }, { timeout: 10000 });

async function openFixture(t, rules = [], viewport = { width: 1280, height: 900 }, integrated = false) {
  const context = await browser.newContext({ viewport, serviceWorkers: 'block' });
  const fixture = integrated ? WATCH_FIXTURE : `<!doctype html><html lang="en-GB" dark><head><style>${CSS}</style></head><body><button id="open">Manage channel upload filters</button></body></html>`;
  await context.route('**/*', route => route.request().url().startsWith(WATCH_URL)
    ? route.fulfill({ contentType: 'text/html', body: fixture, headers: { 'Content-Security-Policy': "require-trusted-types-for 'script'; trusted-types 'none'" } })
    : route.abort());
  await context.addInitScript(({ key, rules }) => {
    if (!sessionStorage.getItem('seeded')) {
      if (rules.length) localStorage.setItem(key, JSON.stringify({ version: 1, rules }));
      sessionStorage.setItem('seeded', '1');
    }
  }, { key: KEY, rules });
  if (integrated) await context.addInitScript({ content: SUITE });
  else await context.addInitScript({ content: `document.addEventListener('DOMContentLoaded', () => {
    if (window.location.origin !== 'https://www.youtube.com') return;
    window.ageService = (${createChannelAgeService.toString()})(() => localStorage);
    window.ageDialog = (${createChannelAgeDialog.toString()})(document, ageService);
    window.ageChanged = 0;
    window.addEventListener('yt-master-channel-age-changed', () => window.ageChanged++);
    document.getElementById('open').addEventListener('click', () => ageDialog.open(window.targetChannel));
  });` });
  const page = await context.newPage(); page.setDefaultTimeout(7000);
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  t.after(async () => {
    try { assert.deepEqual(errors, []); }
    finally { await context.close(); }
  });
  await page.goto(WATCH_URL);
  if (integrated) await waitForSuiteHealth(page, MANIFEST.registeredModules, { timeoutMs: 7000, errors });
  else await page.locator('#open').click();
  return page;
}
const field = (page, name, index = 0) => page.locator('#ytms-age-list').getByLabel(name, { exact: true }).nth(index);
async function addRule(page, channelId = FIRST, age = '1', unit = 'weeks', name = 'Daily news') {
  await page.locator('#ytms-age-add').click();
  const index = await page.locator('.ytms-age-rule').count() - 1;
  await field(page, 'Channel name', index).fill(name);
  await field(page, 'Channel ID or channel URL', index).fill(channelId);
  await field(page, 'Maximum age', index).fill(age);
  await field(page, 'Unit', index).selectOption(unit);
}

test('older-video filter manager starts empty, is theme-aware and makes no persistent changes when opened', async t => {
  const page = await openFixture(t);
  assert.equal(await page.locator('#ytms-age-dialog').getAttribute('lang'), 'en-GB');
  assert.equal(await page.locator('#ytms-age-title').textContent(), 'Channel upload filters');
  assert.equal(await page.locator('#ytms-age-list').getAttribute('aria-label'), 'Channel upload filters');
  assert.equal(await page.locator('#ytms-age-empty').isVisible(), true);
  assert.equal(await page.locator('.ytms-age-rule').count(), 0);
  assert.equal(await page.evaluate(key => localStorage.getItem(key), KEY), null);
  const dialog = page.locator('#ytms-age-dialog');
  assert.equal((await dialog.boundingBox()).width, 640);
  assert.equal((await dialog.boundingBox()).height, 720);
  for (const dark of [true, false]) {
    await page.evaluate(dark => document.documentElement.toggleAttribute('dark', dark), dark);
    assert.equal(await dialog.evaluate(node => getComputedStyle(node).backgroundColor), dark ? 'rgb(33, 33, 33)' : 'rgb(255, 255, 255)');
  }
});

test('channel rules save distinct age units and enabled state without changing main preferences or navigation', async t => {
  const page = await openFixture(t);
  await addRule(page, `https://www.youtube.com/channel/${FIRST}`, '2', 'weeks');
  await addRule(page, SECOND, '1', 'years', 'Documentaries');
  await field(page, 'Enabled', 1).uncheck();
  await page.locator('#ytms-age-save').click();
  assert.equal(await page.locator('#ytms-age-status').textContent(), 'Saved. Channel upload filters now apply; no reload is needed.');
  assert.deepEqual(await page.evaluate(() => ageService.getRules()), [
    { channelId: FIRST, name: 'Daily news', maxAge: 2, unit: 'weeks', enabled: true, blocked: false },
    { channelId: SECOND, name: 'Documentaries', maxAge: 1, unit: 'years', enabled: false, blocked: false },
  ]);
  assert.equal(await page.evaluate(() => ageChanged), 1);
  assert.equal(await page.evaluate(key => localStorage.getItem(key), SETTINGS_KEY), null);
  assert.equal(page.url(), WATCH_URL);
});

test('Cancel and Escape discard row edits and removals rather than saving drafts', async t => {
  const original = { channelId: FIRST, name: 'News', maxAge: 1, unit: 'days', enabled: true, blocked: false };
  const page = await openFixture(t, [original]);
  await field(page, 'Maximum age').fill('5');
  await page.locator('#ytms-age-cancel').click();
  await page.locator('#open').click();
  assert.equal(await field(page, 'Maximum age').inputValue(), '1');
  await page.getByRole('button', { name: 'Remove News', exact: true }).click();
  await page.keyboard.press('Escape');
  await page.locator('#open').click();
  assert.equal(await page.locator('.ytms-age-rule').count(), 1);
  assert.deepEqual(await page.evaluate(() => ageService.getRules()), [original]);
  assert.equal(await page.evaluate(() => ageChanged), 0);
});

test('invalid IDs, duplicate channels, fractional or out-of-range ages cannot silently discard saved rules', async t => {
  const page = await openFixture(t);
  await addRule(page);
  await addRule(page, FIRST);
  await page.locator('#ytms-age-save').click();
  assert.ok((await page.locator('#ytms-age-status').textContent()).includes('Rule 2'));
  assert.equal(await page.evaluate(key => localStorage.getItem(key), KEY), null);
  await field(page, 'Channel ID or channel URL', 1).fill(SECOND);
  for (const age of ['0', '1.5', '1001', '']) {
    await field(page, 'Maximum age', 1).fill(age);
    await page.locator('#ytms-age-save').click();
    assert.equal(await page.locator('#ytms-age-status').isVisible(), true);
    assert.equal(await page.evaluate(() => ageChanged), 0);
    assert.equal(await page.evaluate(() => ageService.getRules().length), 0);
  }
  await field(page, 'Maximum age', 1).fill('1');
  await field(page, 'Channel ID or channel URL', 1).fill('@handle');
  await page.locator('#ytms-age-save').click();
  assert.equal(await page.evaluate(() => ageChanged), 0);
  assert.equal(await page.locator('.ytms-age-rule').count(), 2);
});

test('storage failure preserves the active rules and emits no age-change notification', async t => {
  const original = { channelId: FIRST, name: 'News', maxAge: 1, unit: 'days', enabled: true, blocked: false };
  const page = await openFixture(t, [original]);
  await field(page, 'Maximum age').fill('2');
  await page.evaluate(() => Object.defineProperty(window, 'localStorage', { configurable: true, get() { throw new Error('Unavailable'); } }));
  await page.locator('#ytms-age-save').click();
  assert.ok((await page.locator('#ytms-age-status').textContent()).includes('could not be saved'));
  assert.deepEqual(await page.evaluate(() => ageService.getRules()), [original]);
  assert.equal(await page.evaluate(() => ageChanged), 0);
});

test('menu opener selects an existing channel or drafts a new one without HTML parsing or implicit persistence', async t => {
  const page = await openFixture(t);
  await page.locator('#ytms-age-cancel').click();
  await page.evaluate(channelId => { window.targetChannel = { channelId, name: '<img src=x onerror=alert(1)> News' }; }, FIRST);
  await page.locator('#open').click();
  assert.equal(await field(page, 'Channel ID or channel URL').inputValue(), FIRST);
  assert.equal(await field(page, 'Channel name').inputValue(), '<img src=x onerror=alert(1)> News');
  assert.equal(await page.locator('#ytms-age-dialog img').count(), 0);
  assert.equal(await page.evaluate(key => localStorage.getItem(key), KEY), null);
  await page.locator('#ytms-age-save').click();
  await page.locator('#ytms-age-cancel').click();
  await page.locator('#open').click();
  assert.equal(await page.locator('.ytms-age-rule').count(), 1);
  assert.equal(await field(page, 'Channel ID or channel URL').evaluate(node => node === document.activeElement), true);
});

test('large rule lists remain bounded and scroll independently without narrow-window horizontal overflow', async t => {
  const rules = Array.from({ length: 100 }, (_, index) => ({
    channelId: `UC${String(index).padStart(22, '0')}`, name: 'Long channel display name '.repeat(3),
    maxAge: index + 1, unit: 'months', enabled: true,
  }));
  const page = await openFixture(t, rules, { width: 360, height: 600 });
  const dialog = page.locator('#ytms-age-dialog'), bounds = await dialog.boundingBox();
  assert.ok(bounds.x >= 0 && bounds.y >= 0 && bounds.x + bounds.width <= 360 && bounds.y + bounds.height <= 600);
  assert.equal(await page.locator('#ytms-age-add').isDisabled(), true);
  const content = page.locator('.ytms-age-content');
  assert.equal(await content.evaluate(node => node.scrollWidth <= node.clientWidth), true);
  assert.equal(await content.evaluate(node => node.scrollHeight > node.clientHeight), true);
  await content.evaluate(node => node.scrollTop = node.scrollHeight);
  const footer = await dialog.locator('footer').boundingBox();
  assert.ok(footer.y >= bounds.y && footer.y + footer.height <= bounds.y + bounds.height);
  assert.deepEqual(await dialog.boundingBox(), bounds);
});

test('integrated Feed manager does not save unrelated draft changes and menu order honours Cancel, Save and Restore defaults', async t => {
  const page = await openFixture(t, [], { width: 1280, height: 900 }, true);
  await page.locator('#ytms-settings-button').click();
  await page.getByRole('tab', { name: 'Feed', exact: true }).click();
  await page.locator('#ytms-hideShorts').uncheck();
  await page.getByRole('tab', { name: 'Channels', exact: true }).click();
  await page.getByRole('button', { name: 'Manage channel upload filters', exact: true }).click();
  assert.equal(await page.locator('#ytms-age-dialog').isVisible(), true);
  await addRule(page);
  await page.locator('#ytms-age-save').click();
  assert.equal(await page.evaluate(key => localStorage.getItem(key), SETTINGS_KEY), null);
  await page.locator('#ytms-age-cancel').click();
  assert.equal(await page.locator('#ytms-hideShorts').isChecked(), false);
  await page.getByRole('tab', { name: 'Interface', exact: true }).click();
  await page.locator('#ytms-video-menu-settings > summary').click();
  assert.equal(await page.getByRole('heading', { name: 'Video context menu order', exact: true }).count(), 1);
  const list = page.locator('#ytms-menu-order');
  const initial = await list.locator('li').evaluateAll(nodes => nodes.map(node => node.dataset.menuItem));
  assert.equal(await page.locator('#ytms-menuShowDownload').isChecked(), false);
  assert.equal(await page.locator('#ytms-menuGroupChannelTools').isChecked(), true);
  await page.getByRole('button', { name: 'Move Download up', exact: true }).click();
  assert.notDeepEqual(await list.locator('li').evaluateAll(nodes => nodes.map(node => node.dataset.menuItem)), initial);
  await page.locator('#ytms-cancel-panel').click();
  await page.locator('#ytms-settings-button').click();
  await page.getByRole('tab', { name: 'Interface', exact: true }).click();
  await page.locator('#ytms-video-menu-settings > summary').click();
  assert.deepEqual(await list.locator('li').evaluateAll(nodes => nodes.map(node => node.dataset.menuItem)), initial);
  await page.getByRole('button', { name: 'Move Download up', exact: true }).click();
  await page.locator('#ytms-menuShowDownload').check();
  await page.locator('#ytms-menuGroupChannelTools').uncheck();
  await page.locator('#ytms-save-preview').click();
  const saved = await page.evaluate(key => JSON.parse(localStorage.getItem(key)).values, SETTINGS_KEY);
  assert.equal(saved.menuShowDownload, true);
  assert.equal(saved.menuGroupChannelTools, false);
  assert.equal(saved.menuItemOrder[3], 'download');
  await page.locator('#ytms-restore-defaults').click();
  assert.deepEqual(await list.locator('li').evaluateAll(nodes => nodes.map(node => node.dataset.menuItem)), initial);
  assert.equal(await page.locator('#ytms-menuShowDownload').isChecked(), false);
  assert.equal(await page.locator('#ytms-menuGroupChannelTools').isChecked(), true);
  assert.equal(await page.evaluate(key => JSON.parse(localStorage.getItem(key)).values.menuShowDownload, SETTINGS_KEY), true);
  await page.setViewportSize({ width: 360, height: 600 });
  const dialog = page.locator('#ytms-settings-dialog'), bounds = await dialog.boundingBox();
  assert.ok(bounds.x >= 0 && bounds.y >= 0 && bounds.x + bounds.width <= 360 && bounds.y + bounds.height <= 600);
  assert.equal(await dialog.locator('.content').evaluate(node => node.scrollWidth <= node.clientWidth), true);
  assert.equal(await list.evaluate(node => node.scrollWidth <= node.clientWidth), true);
  assert.equal(await dialog.locator('footer').evaluate(node => node.scrollWidth <= node.clientWidth), true);
  await page.reload();
  await page.locator('#ytms-settings-button').click();
  await page.getByRole('tab', { name: 'Interface', exact: true }).click();
  await page.locator('#ytms-video-menu-settings > summary').click();
  assert.equal(await page.locator('#ytms-menuGroupChannelTools').isChecked(), false);
});

test('Hide this channel keeps the age selection but disables it and persists only after explicit Save', async t => {
  const page = await openFixture(t);
  await addRule(page, FIRST, '3', 'months');
  await field(page, 'Hide this channel — all uploads').check();
  assert.equal(await field(page, 'Maximum age').isDisabled(), true);
  assert.equal(await field(page, 'Unit').isDisabled(), true);
  assert.equal(await field(page, 'Maximum age').inputValue(), '3');
  assert.equal(await field(page, 'Unit').inputValue(), 'months');
  assert.equal(await page.evaluate(key => localStorage.getItem(key), KEY), null);
  await page.locator('#ytms-age-save').click();
  assert.deepEqual(await page.evaluate(() => ageService.getRules()), [
    { channelId: FIRST, name: 'Daily news', maxAge: 3, unit: 'months', enabled: true, blocked: true },
  ]);
  await page.locator('#ytms-age-cancel').click();
  await page.locator('#open').click();
  assert.equal(await field(page, 'Hide this channel — all uploads').isChecked(), true);
  await field(page, 'Hide this channel — all uploads').uncheck();
  assert.equal(await field(page, 'Maximum age').isEnabled(), true);
  assert.equal(await field(page, 'Maximum age').inputValue(), '3');
  assert.equal(await field(page, 'Unit').inputValue(), 'months');
  await page.locator('#ytms-age-cancel').click();
  assert.equal(await page.evaluate(() => ageService.getRules()[0].blocked), true);
  assert.equal(await page.evaluate(() => ageChanged), 1);
});

test('Channels lists only Suite-saved filters and Edit or Remove require explicit manager Save', async t => {
  const rules = [
    { channelId: FIRST, name: 'Daily news', maxAge: 2, unit: 'weeks', enabled: true, blocked: true },
    { channelId: SECOND, name: 'Documentaries', maxAge: 1, unit: 'years', enabled: false, blocked: false },
  ];
  const page = await openFixture(t, rules, { width: 1280, height: 900 }, true);
  await page.locator('#ytms-settings-button').click();
  await page.getByRole('tab', { name: 'Channels', exact: true }).click();
  const list = page.locator('#ytms-channel-filter-list');
  assert.equal(await list.getByRole('listitem').count(), 2);
  assert.deepEqual(await list.locator('h3').allTextContents(), ['Daily news', 'Documentaries']);
  assert.deepEqual(await list.locator('.channel-filter-id').allTextContents(), [FIRST, SECOND]);
  assert.equal(await list.getByRole('listitem').first().getByText('Maximum upload age: 2 weeks', { exact: true }).count(), 1);
  assert.equal(await list.getByRole('listitem').nth(1).getByText('Maximum upload age: 1 year', { exact: true }).count(), 1);
  assert.deepEqual(await list.locator('.channel-filter-status').allTextContents(), ['Status: All uploads hidden', 'Status: Disabled']);
  assert.equal(await page.locator('#ytms-restore-section-defaults').isDisabled(), true);
  const help = page.locator('#ytms-section-channels .channel-filter-help');
  assert.equal(await help.getAttribute('href'), 'https://support.google.com/youtube/answer/6342839?hl=en&co=GENIE.Platform%3DDesktop');
  assert.equal(await help.getAttribute('rel'), 'noopener noreferrer');
  assert.match(await page.locator('#ytms-section-channels').textContent(), /YouTube’s own Don’t recommend channel choices are separate/);
  await page.getByRole('button', { name: 'Edit filter for Daily news', exact: true }).click();
  await field(page, 'Hide this channel — all uploads').first().uncheck();
  await field(page, 'Maximum age').first().fill('3');
  await page.locator('#ytms-age-save').click();
  await page.locator('#ytms-age-cancel').click();
  assert.match(await list.getByRole('listitem').first().textContent(), /Maximum upload age: 3 weeks/);
  await page.getByRole('button', { name: 'Remove filter for Documentaries', exact: true }).click();
  assert.match(await page.locator('#ytms-age-status').textContent(), /removed from this draft/);
  assert.equal(await page.locator('.ytms-age-rule').count(), 1);
  assert.equal(await page.evaluate(key => JSON.parse(localStorage.getItem(key)).rules.length, KEY), 2);
  await page.locator('#ytms-age-cancel').click();
  assert.equal(await list.getByRole('listitem').count(), 2);
  await page.getByRole('button', { name: 'Remove filter for Documentaries', exact: true }).click();
  await page.locator('#ytms-age-save').click();
  await page.locator('#ytms-age-cancel').click();
  assert.equal(await list.getByRole('listitem').count(), 1);
  assert.equal(await page.evaluate(key => JSON.parse(localStorage.getItem(key)).rules.length, KEY), 1);
  await page.setViewportSize({ width: 360, height: 600 });
  assert.equal(await page.locator('#ytms-settings-dialog .content').evaluate(node => node.scrollWidth <= node.clientWidth), true);
});

test('an open channel editor preserves its draft and rejects a newer save from another window', async t => {
  const original = { channelId: FIRST, name: 'News', maxAge: 1, unit: 'days', enabled: true, blocked: false };
  const page = await openFixture(t, [original]);
  const other = await page.context().newPage();
  await other.goto(WATCH_URL);
  await other.locator('#open').click();
  await field(page, 'Maximum age').fill('2');
  await field(other, 'Maximum age').fill('3');
  await other.locator('#ytms-age-save').click();
  await page.locator('#ytms-age-save').click();
  assert.match(await page.locator('#ytms-age-status').textContent(), /changed in another window/);
  assert.equal(await field(page, 'Maximum age').inputValue(), '2');
  assert.equal(await page.evaluate(key => JSON.parse(localStorage.getItem(key)).rules[0].maxAge, KEY), 3);
  assert.equal(await page.evaluate(() => ageChanged), 0);
  await page.locator('#ytms-age-cancel').click();
  await page.locator('#open').click();
  assert.equal(await field(page, 'Maximum age').inputValue(), '3');
  await field(page, 'Maximum age').fill('4');
  await page.locator('#ytms-age-save').click();
  assert.equal(await page.evaluate(key => JSON.parse(localStorage.getItem(key)).rules[0].maxAge, KEY), 4);
});

test('cross-window rule saves and clears refresh feed filtering and the Channels list without reload', async t => {
  const page = await openFixture(t, [], { width: 1280, height: 900 }, true);
  const other = await page.context().newPage();
  await other.goto(WATCH_URL);
  await waitForSuiteHealth(other, MANIFEST.registeredModules, { timeoutMs: 7000 });
  await page.evaluate(channelId => {
    history.replaceState(null, '', '/');
    const browse = document.createElement('ytd-browse');
    const grid = document.createElement('ytd-rich-grid-renderer');
    const card = document.createElement('ytd-rich-item-renderer'); card.id = 'shared-channel-card';
    const media = document.createElement('ytd-rich-grid-media');
    const video = document.createElement('a'); video.href = '/watch?v=bbbbbbbbbbb'; video.textContent = 'Fixture video';
    const owner = document.createElement('div'); owner.id = 'channel-name';
    const link = document.createElement('a'); link.href = '/channel/' + channelId; link.textContent = 'News'; owner.append(link);
    const metadata = document.createElement('div'); metadata.id = 'metadata-line';
    const date = document.createElement('span'); date.textContent = '2 weeks ago'; metadata.append(date);
    media.append(video, owner, metadata); card.append(media); grid.append(card); browse.append(grid); document.body.append(browse);
    window.dispatchEvent(new CustomEvent('yt-navigate-finish'));
  }, FIRST);
  assert.equal(await page.locator('#shared-channel-card').getAttribute('data-clean-up-youtube-hidden'), null);
  const rule = { channelId: FIRST, name: 'News', maxAge: 1, unit: 'weeks', enabled: true, blocked: false };
  await other.evaluate(({ key, rule }) => localStorage.setItem(key, JSON.stringify({ version: 1, rules: [rule] })), { key: KEY, rule });
  await page.waitForFunction(() => document.getElementById('shared-channel-card').getAttribute('data-clean-up-youtube-hidden') === '1');
  await page.locator('#ytms-settings-button').click();
  await page.getByRole('tab', { name: 'Channels', exact: true }).click();
  assert.equal(await page.locator('#ytms-channel-filter-list > article').count(), 1);
  for (const clearAll of [false, true]) {
    if (clearAll) {
      await other.evaluate(({ key, rule }) => localStorage.setItem(key, JSON.stringify({ version: 1, rules: [rule] })), { key: KEY, rule });
      await page.waitForFunction(() => document.querySelectorAll('#ytms-channel-filter-list > article').length === 1);
    }
    await other.evaluate(({ key, clearAll }) => clearAll ? localStorage.clear() : localStorage.removeItem(key), { key: KEY, clearAll });
    await page.waitForFunction(() => !document.getElementById('shared-channel-card').hasAttribute('data-clean-up-youtube-hidden'));
    await page.waitForFunction(() => document.querySelectorAll('#ytms-channel-filter-list > article').length === 0);
  }
  assert.equal(page.url(), 'https://www.youtube.com/');
});
