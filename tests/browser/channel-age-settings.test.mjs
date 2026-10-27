import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { after, before, test } from 'node:test';
import { createChannelAgeDialog } from '../../sources/channel-age-dialog.mjs';
import { createChannelAgeService } from '../../sources/channel-age.mjs';
import { createSuiteSettings } from '../../sources/suite-settings.mjs';
import { launchFixtureBrowser, waitForSuiteHealth } from './fixture-browser.mjs';

const CSS = readFileSync(new URL('../../assets/settings-panel.css', import.meta.url), 'utf8');
const SUITE = readFileSync(new URL('../../youtube-master-suite.user.js', import.meta.url), 'utf8');
const MANIFEST = JSON.parse(readFileSync(new URL('../../release-manifest.json', import.meta.url), 'utf8'));
const WATCH_FIXTURE = readFileSync(new URL('./watch-page.html', import.meta.url), 'utf8');
const WATCH_URL = 'https://www.youtube.com/watch?v=aaaaaaaaaaa';
const KEY = 'yt-master-suite.channel-age.v1';
const SETTINGS_KEY = 'yt-master-suite.settings.v1';
const CORNER_KEY = 'yt-master-suite.scroll-miniplayer.corner.v1';
const CHANNEL_FORMAT = 'youtube-master-suite-channel-filters';
const FIRST = `UC${'a'.repeat(22)}`;
const SECOND = `UC${'b'.repeat(22)}`;
let browser;
before(async () => { browser = await launchFixtureBrowser(); }, { timeout: 30000 });
after(async () => { await browser?.close(); }, { timeout: 10000 });

async function openFixture(t, rules = [], viewport = { width: 1280, height: 900 }, integrated = false, exposeChannelLauncher = false) {
  const context = await browser.newContext({ viewport, serviceWorkers: 'block', acceptDownloads: true });
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
  if (integrated) {
    const marker = 'suite.installVideoMenu(suite);';
    if (exposeChannelLauncher) assert.equal(SUITE.split(marker).length - 1, 1);
    await context.addInitScript({ content: exposeChannelLauncher ? SUITE.replace(marker,
      `${marker}\nwindow.fixtureOpenChannels = (channel, origin) => suite.openChannelAgeSettings(channel, origin);`) : SUITE });
  }
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
const field = (page, name, index = 0) => page.locator('#ytms-age-list, #ytms-channel-filter-list').getByLabel(name, { exact: true }).nth(index);
async function addRule(page, channelId = FIRST, age = '1', unit = 'weeks', name = 'Daily news') {
  await page.locator('#ytms-age-add').click();
  const index = await page.locator('.ytms-age-rule').count() - 1;
  await field(page, 'Channel name', index).fill(name);
  await field(page, 'Channel ID or channel URL', index).fill(channelId);
  await field(page, 'Maximum age', index).fill(age);
  await field(page, 'Unit', index).selectOption(unit);
}
async function openChannels(page) {
  await page.locator('#ytms-settings-button').click();
  await page.getByRole('tab', { name: 'Channels', exact: true }).click();
  await page.locator('#ytms-channel-search').waitFor();
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

test('Add filter collapses a staged rule and Edit filter restores its values without saving', async t => {
  const page = await openFixture(t);
  assert.equal(await page.locator('#ytms-age-add').textContent(), 'Add another channel');
  await addRule(page, FIRST, '3', 'months', 'Daily news');
  assert.equal(await page.getByRole('button', { name: 'Remove filter for Daily news', exact: true }).textContent(), 'Remove');
  assert.equal(await page.locator('.ytms-age-rule h3').textContent(), 'Daily news');
  await field(page, 'Enabled').uncheck();
  await page.getByRole('button', { name: 'Add filter', exact: true }).click();
  const card = page.locator('.ytms-age-rule').first();
  assert.equal(await card.locator('.ytms-age-fields').isVisible(), false);
  assert.equal(await card.locator('.channel-filter-age').isVisible(), true);
  assert.equal(await card.locator('.channel-filter-age .channel-filter-value').textContent(), 'Up to 3 months');
  assert.equal(await card.locator('.channel-filter-status .channel-filter-value').textContent(), 'Disabled');
  assert.equal(await page.evaluate(key => localStorage.getItem(key), KEY), null);
  assert.equal(await page.evaluate(() => ageChanged), 0);
  assert.match(await page.locator('#ytms-age-status').textContent(), /added to this draft/);
  const edit = page.getByRole('button', { name: 'Edit filter for Daily news', exact: true });
  assert.equal(await edit.getAttribute('aria-expanded'), 'false');
  assert.equal(await edit.evaluate(node => node === document.activeElement), true);
  await edit.click();
  assert.equal(await field(page, 'Channel name').inputValue(), 'Daily news');
  assert.equal(await field(page, 'Channel ID or channel URL').inputValue(), FIRST);
  assert.equal(await field(page, 'Maximum age').inputValue(), '3');
  assert.equal(await field(page, 'Unit').inputValue(), 'months');
  assert.equal(await field(page, 'Enabled').isChecked(), false);
  assert.equal(await page.getByRole('button', { name: 'Update filter', exact: true }).isVisible(), true);
  assert.equal(await field(page, 'Channel ID or channel URL').evaluate(node => node === document.activeElement), true);
  await field(page, 'Maximum age').fill('4');
  await page.getByRole('button', { name: 'Update filter', exact: true }).click();
  assert.equal(await card.locator('.channel-filter-age .channel-filter-value').textContent(), 'Up to 4 months');
  await page.locator('#ytms-age-cancel').click();
  await page.locator('#open').click();
  assert.equal(await page.locator('.ytms-age-rule').count(), 0);
});

test('Add another channel collapses the previous editor and keeps one editable channel visible', async t => {
  const page = await openFixture(t);
  await addRule(page, FIRST, '2', 'weeks');
  await addRule(page, SECOND, '1', 'years', 'Documentaries');
  assert.equal(await page.locator('.ytms-age-fields:visible').count(), 1);
  assert.equal(await page.locator('.ytms-age-rule').first().locator('.channel-filter-age').isVisible(), true);
  assert.equal(await page.locator('.ytms-age-rule').nth(1).locator('.ytms-age-fields').isVisible(), true);
  await page.getByRole('button', { name: 'Edit filter for Daily news', exact: true }).click();
  assert.equal(await page.locator('.ytms-age-fields:visible').count(), 1);
  assert.equal(await field(page, 'Maximum age').inputValue(), '2');
  assert.equal(await field(page, 'Maximum age', 1).inputValue(), '1');
  assert.equal(await page.locator('.ytms-age-rule').nth(1).locator('.channel-filter-age').isVisible(), true);
  assert.equal(await page.evaluate(key => localStorage.getItem(key), KEY), null);
});

test('adding another channel refuses invalid drafts and saving reopens an invalid collapsed editor', async t => {
  const page = await openFixture(t);
  await addRule(page, FIRST);
  await field(page, 'Channel ID or channel URL').fill('@not-a-channel-id');
  await page.locator('#ytms-age-add').click();
  assert.equal(await page.locator('.ytms-age-rule').count(), 1);
  assert.equal(await page.locator('#ytms-age-dialog').isVisible(), true);
  assert.equal(await field(page, 'Channel ID or channel URL').evaluate(node => node === document.activeElement), true);
  assert.match(await page.locator('#ytms-age-status').textContent(), /Rule 1/);
  await field(page, 'Channel ID or channel URL').fill(FIRST);
  await addRule(page, SECOND, '1', 'years', 'Documentaries');
  // A hidden control still cannot bypass final draft validation.
  await field(page, 'Maximum age').evaluate(node => {
    node.value = '0'; node.dispatchEvent(new Event('input', { bubbles: true }));
  });
  assert.equal(await page.locator('.ytms-age-rule').first().locator('.ytms-age-fields').isVisible(), false);
  await page.locator('#ytms-age-save').click();
  assert.equal(await page.locator('#ytms-age-dialog').isVisible(), true);
  assert.equal(await page.locator('.ytms-age-rule').first().locator('.ytms-age-fields').isVisible(), true);
  assert.equal(await page.locator('.ytms-age-fields:visible').count(), 1);
  assert.match(await page.locator('#ytms-age-status').textContent(), /Rule 1/);
  assert.equal(await page.evaluate(key => localStorage.getItem(key), KEY), null);
  assert.equal(await page.evaluate(() => ageChanged), 0);
});

test('channel filter buttons are bordered and Save filters has white text on accessible red in both themes', async t => {
  const page = await openFixture(t);
  await addRule(page);
  const dialog = page.locator('#ytms-age-dialog');
  const save = page.locator('#ytms-age-save');
  for (const dark of [true, false]) {
    await page.evaluate(dark => document.documentElement.toggleAttribute('dark', dark), dark);
    assert.equal(await save.evaluate(node => getComputedStyle(node).backgroundColor), 'rgb(204, 0, 0)');
    assert.equal(await save.evaluate(node => getComputedStyle(node).color), 'rgb(255, 255, 255)');
    const contrast = await save.evaluate(node => {
      const luminance = colour => colour.match(/[\d.]+/g).slice(0, 3).map(Number).map(value => {
        const channel = value / 255;
        return channel <= .04045 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4;
      }).reduce((sum, channel, index) => sum + channel * [.2126, .7152, .0722][index], 0);
      const style = getComputedStyle(node), foreground = luminance(style.color), background = luminance(style.backgroundColor);
      return (Math.max(foreground, background) + .05) / (Math.min(foreground, background) + .05);
    });
    assert.ok(contrast >= 4.5, `Save filters text contrast: ${contrast}`);
    for (const action of [page.locator('#ytms-age-add'), page.getByRole('button', { name: 'Add filter', exact: true }),
      page.getByRole('button', { name: 'Remove filter for Daily news', exact: true })]) {
      assert.equal(await action.evaluate(node => getComputedStyle(node).borderTopStyle), 'solid');
      assert.equal(await action.evaluate(node => getComputedStyle(node).borderTopWidth), '1px');
    }
    assert.equal(await page.locator('.ytms-age-rule').evaluate(node => getComputedStyle(node).borderBottomStyle), 'solid');
    assert.equal(await page.locator('.ytms-age-rule').evaluate(node => getComputedStyle(node).borderBottomWidth), '1px');
  }
  for (const width of [360, 320]) {
    await page.setViewportSize({ width, height: 600 });
    for (const target of [dialog, dialog.locator('.ytms-age-content'), dialog.locator('.ytms-age-edit-actions'), dialog.locator('footer')]) {
      assert.equal(await target.evaluate(node => node.scrollWidth <= node.clientWidth), true);
    }
    assert.equal(await page.getByRole('button', { name: 'Remove filter for Daily news', exact: true }).textContent(), 'Remove');
  }
});

test('channel rules save distinct age units and enabled state without changing main preferences or navigation', async t => {
  const page = await openFixture(t);
  await addRule(page, `https://www.youtube.com/channel/${FIRST}`, '2', 'weeks');
  await addRule(page, SECOND, '1', 'years', 'Documentaries');
  await field(page, 'Enabled', 1).uncheck();
  await page.locator('#ytms-age-save').click();
  assert.equal(await page.locator('#ytms-age-dialog').isVisible(), false);
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
  await page.getByRole('button', { name: 'Remove filter for News', exact: true }).click();
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
  assert.equal(await page.locator('#ytms-age-dialog').isVisible(), true);
  assert.equal(await field(page, 'Maximum age').inputValue(), '2');
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
  assert.equal(await page.locator('#ytms-age-dialog').isVisible(), false);
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
  assert.equal(await page.locator('#ytms-age-dialog').isVisible(), true);
  assert.equal(await page.locator('#ytms-age-dialog').evaluate(node => node.localName), 'section');
  assert.equal(await page.locator('dialog[open]').count(), 1);
  await addRule(page);
  await page.locator('#ytms-age-save').click();
  assert.equal(await page.evaluate(key => localStorage.getItem(key), SETTINGS_KEY), null);
  assert.equal(await page.locator('#ytms-age-dialog').isVisible(), true);
  assert.equal(await page.locator('#ytms-settings-dialog').isVisible(), true);
  assert.equal(await page.locator('.ytms-age-fields:visible').count(), 0);
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
  assert.equal(await dialog.locator('.panel > footer').evaluate(node => node.scrollWidth <= node.clientWidth), true);
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
  assert.equal(await page.locator('#ytms-age-dialog').isVisible(), false);
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
  assert.equal(await page.locator('#ytms-age-add').textContent(), 'Add another channel');
  assert.deepEqual(await list.getByRole('listitem').first().locator('.channel-filter-actions > button:visible').allTextContents(), ['Edit', 'Remove']);
  for (const action of [page.locator('#ytms-age-add'), ...await list.locator('.channel-filter-actions > button:visible').all()]) {
    assert.equal(await action.evaluate(node => getComputedStyle(node).borderTopStyle), 'solid');
    assert.equal(await action.evaluate(node => getComputedStyle(node).borderTopWidth), '1px');
  }
  assert.deepEqual(await list.locator('h3').allTextContents(), ['Daily news', 'Documentaries']);
  assert.deepEqual(await list.locator('.channel-filter-id').allTextContents(), [FIRST, SECOND]);
  assert.deepEqual(await list.locator('.channel-filter-age .channel-filter-value').allTextContents(), ['No uploads', 'Up to 1 year']);
  assert.deepEqual(await list.locator('.channel-filter-status .channel-filter-value').allTextContents(), ['Enabled', 'Disabled']);
  assert.equal(await page.locator('#ytms-restore-section-defaults').isDisabled(), true);
  const help = page.locator('#ytms-section-channels .channel-filter-help');
  assert.equal(await help.getAttribute('href'), 'https://support.google.com/youtube/answer/6342839?hl=en&co=GENIE.Platform%3DDesktop');
  assert.equal(await help.getAttribute('rel'), 'noopener noreferrer');
  assert.match(await page.locator('#ytms-section-channels').textContent(), /YouTube’s own Don’t recommend channel choices are separate/);
  await page.getByRole('button', { name: 'Edit filter for Daily news', exact: true }).focus();
  await page.keyboard.press('Enter');
  await field(page, 'Hide this channel — all uploads').first().uncheck();
  await field(page, 'Maximum age').first().fill('3');
  await page.locator('#ytms-age-save').click();
  assert.equal(await page.locator('#ytms-age-dialog').isVisible(), true);
  assert.equal(await page.locator('#ytms-settings-dialog').isVisible(), true);
  assert.equal(await page.locator('.ytms-age-fields:visible').count(), 0);
  assert.equal(await list.getByRole('listitem').first().locator('.channel-filter-age .channel-filter-value').textContent(), 'Up to 3 weeks');
  await page.getByRole('button', { name: 'Remove filter for Documentaries', exact: true }).focus();
  await page.keyboard.press('Enter');
  assert.match(await page.locator('#ytms-age-status').textContent(), /removed from this draft/);
  assert.equal(await page.locator('.ytms-age-rule').count(), 1);
  assert.equal(await page.evaluate(key => JSON.parse(localStorage.getItem(key)).rules.length, KEY), 2);
  await page.locator('#ytms-age-cancel').click();
  assert.equal(await list.getByRole('listitem').count(), 2);
  await page.getByRole('button', { name: 'Remove filter for Documentaries', exact: true }).click();
  await page.locator('#ytms-age-save').click();
  assert.equal(await page.locator('#ytms-age-dialog').isVisible(), true);
  assert.equal(await page.locator('#ytms-settings-dialog').isVisible(), true);
  assert.equal(await list.getByRole('listitem').count(), 1);
  assert.equal(await page.evaluate(key => JSON.parse(localStorage.getItem(key)).rules.length, KEY), 1);
  await page.setViewportSize({ width: 360, height: 600 });
  assert.equal(await page.locator('#ytms-settings-dialog .content').evaluate(node => node.scrollWidth <= node.clientWidth), true);
});

test('saved channel filters use aligned details and stacked action columns, retain IDs below names and fit narrow windows', async t => {
  const third = `UC${'c'.repeat(22)}`;
  const rules = [
    { channelId: FIRST, name: 'LongChannelDisplayNameWithoutSpaces'.repeat(3), maxAge: 1000, unit: 'years', enabled: true, blocked: false },
    { channelId: SECOND, name: 'Daily news', maxAge: 1, unit: 'weeks', enabled: true, blocked: true },
    { channelId: third, name: 'Documentaries', maxAge: 2, unit: 'months', enabled: false, blocked: false },
  ];
  const page = await openFixture(t, rules, { width: 1280, height: 900 }, true);
  await page.locator('#ytms-settings-button').click();
  await page.getByRole('tab', { name: 'Channels', exact: true }).click();
  const list = page.locator('#ytms-channel-filter-list');
  const header = page.locator('#ytms-section-channels .channel-filter-columns');
  assert.deepEqual(await header.locator('span').allTextContents(), ['Channel', 'Allowed upload age', 'Status', 'Actions']);
  assert.equal(await list.getByRole('listitem').count(), 3);
  assert.equal(await header.getAttribute('role'), null);
  assert.deepEqual(await list.locator('.channel-filter-age .channel-filter-value').allTextContents(), ['Up to 1000 years', 'No uploads', 'Up to 2 months']);
  assert.deepEqual(await list.locator('.channel-filter-status .channel-filter-value').allTextContents(), ['Enabled', 'Enabled', 'Disabled']);
  assert.equal(await page.evaluate(key => localStorage.getItem(key), SETTINGS_KEY), null);

  for (const dark of [true, false]) {
    await page.evaluate(dark => document.documentElement.toggleAttribute('dark', dark), dark);
    for (const width of [760, 520, 360]) {
      await page.setViewportSize({ width, height: 700 });
      const stacked = width <= 520;
      assert.equal(await header.isVisible(), !stacked);
      assert.equal(await page.locator('#ytms-settings-dialog .content').evaluate(node => node.scrollWidth <= node.clientWidth), true);
      assert.equal(await list.evaluate(node => node.scrollWidth <= node.clientWidth), true);
      const columns = !stacked ? await header.locator('span').evaluateAll(nodes => nodes.map(node => node.getBoundingClientRect().x)) : null;
      for (const card of await list.getByRole('listitem').all()) {
        const geometry = await card.evaluate(node => {
          const box = selector => {
            const rect = node.querySelector(selector).getBoundingClientRect();
            return { x: rect.x, y: rect.y, right: rect.right, bottom: rect.bottom, width: rect.width };
          };
          const rect = node.getBoundingClientRect();
          return {
            card: { x: rect.x, right: rect.right },
            identity: box('.channel-filter-identity'), title: box('h3'), id: box('.channel-filter-id'),
            age: box('.channel-filter-age'), status: box('.channel-filter-status'), actions: box('.channel-filter-actions'),
          };
        });
        assert.ok(geometry.id.y >= geometry.title.bottom - 1, 'Channel ID remains beneath the channel name');
        assert.ok(geometry.actions.right <= geometry.card.right + 1, 'Actions stay inside their card');
        for (const label of await card.locator('.channel-filter-field-label').all()) {
          const clipped = await label.evaluate(node => {
            const style = getComputedStyle(node), bounds = node.getBoundingClientRect();
            return style.clipPath !== 'none' && bounds.width <= 1 && bounds.height <= 1;
          });
          assert.equal(clipped, !stacked, 'Field labels remain accessible but are only visually expanded on narrow screens');
        }
        if (stacked) {
          assert.ok(Math.abs(geometry.identity.x - geometry.card.x) <= 1);
          assert.ok(geometry.identity.right <= geometry.actions.x - 1, 'Actions retain their own right-hand column');
          assert.ok(Math.abs(geometry.age.x - geometry.identity.x) <= 1);
          assert.ok(Math.abs(geometry.status.x - geometry.identity.x) <= 1);
          assert.ok(geometry.age.y >= geometry.identity.bottom - 1, 'Narrow layout places details below identity');
          assert.ok(geometry.status.y >= geometry.age.bottom - 1, 'Narrow layout stacks status below allowed age');
          assert.ok(Math.abs(geometry.actions.y - geometry.identity.y) <= 1, 'Actions start alongside the channel identity');
        } else {
          assert.ok(geometry.age.x < geometry.status.x && geometry.status.x < geometry.actions.x, 'Allowed age, status and actions remain in their own ordered columns');
          for (const [index, column] of [geometry.identity, geometry.age, geometry.status, geometry.actions].entries()) {
            assert.ok(Math.abs(column.x - columns[index]) <= 1, 'Each card aligns with the shared column header');
          }
        }
        const actions = card.locator('.channel-filter-actions button:visible');
        assert.deepEqual(await actions.allTextContents(), ['Edit', 'Remove']);
        const buttons = await actions.evaluateAll(nodes => nodes.map(node => {
          const rect = node.getBoundingClientRect();
          return { x: rect.x, y: rect.y, bottom: rect.bottom, width: rect.width, height: rect.height };
        }));
        assert.ok(Math.abs(buttons[0].x - buttons[1].x) <= 1, 'Action buttons share one horizontal alignment');
        assert.ok(Math.abs(buttons[0].width - buttons[1].width) <= 1, 'Action buttons use equal widths');
        assert.ok(buttons[1].y >= buttons[0].bottom, 'Remove is stacked below Edit');
        assert.ok(buttons.every(button => button.height >= 32), 'Compact action hitboxes remain at least 32px tall');
      }
      for (const action of await list.locator('button:visible').all()) {
        assert.equal(await action.isEnabled(), true);
        assert.equal(await action.evaluate(node => node.scrollWidth <= node.clientWidth), true);
      }
    }
  }
  assert.equal(await page.evaluate(key => localStorage.getItem(key), SETTINGS_KEY), null);
  assert.equal(await page.locator('#ytms-save-preview').isDisabled(), true);
});

test('saved channel column headers appear only when filters exist and do not count as a saved rule', async t => {
  const page = await openFixture(t, [], { width: 1280, height: 900 }, true);
  await page.locator('#ytms-settings-button').click();
  await page.getByRole('tab', { name: 'Channels', exact: true }).click();
  const header = page.locator('#ytms-section-channels .channel-filter-columns');
  const list = page.locator('#ytms-channel-filter-list');
  assert.equal(await header.count(), 1);
  assert.equal(await header.isVisible(), false);
  assert.equal(await list.getByRole('listitem').count(), 0);
  await addRule(page);
  await page.locator('#ytms-age-save').click();
  assert.equal(await header.isVisible(), true);
  assert.equal(await list.getByRole('listitem').count(), 1);
  await page.getByRole('button', { name: 'Remove filter for Daily news', exact: true }).click();
  await page.locator('#ytms-age-save').click();
  assert.equal(await header.isVisible(), false);
  assert.equal(await list.getByRole('listitem').count(), 0);
  assert.equal(await page.getByText('No channel upload filters saved.', { exact: true }).isVisible(), true);
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
  assert.equal(await page.locator('#ytms-age-dialog').isVisible(), true);
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

test('a 30-channel table searches names and IDs literally without reading or writing storage per keystroke', async t => {
  const rules = Array.from({ length: 30 }, (_, index) => ({
    channelId: `UC${String(index).padStart(22, '0')}`, name: `Channel ${String(index + 1).padStart(2, '0')}`,
    maxAge: index + 1, unit: 'days', enabled: index % 2 === 0, blocked: false,
  }));
  rules[7].name = 'Daily Alpha News';
  const page = await openFixture(t, rules, { width: 1280, height: 900 }, true);
  await openChannels(page);
  const list = page.locator('#ytms-channel-filter-list');
  const search = page.locator('#ytms-channel-search');
  const count = page.locator('#ytms-channel-count');
  assert.equal(await list.getByRole('listitem').count(), 30);
  assert.match(await count.textContent(), /Showing 30 of 30 channels/);
  assert.equal(await search.getAttribute('maxlength'), '120');
  const before = await page.evaluate(({ key, settings }) => ({ filters: localStorage.getItem(key), settings: localStorage.getItem(settings) }), { key: KEY, settings: SETTINGS_KEY });
  await page.evaluate(key => {
    const get = Storage.prototype.getItem, set = Storage.prototype.setItem;
    window.channelViewAudit = { reads: 0, writes: 0 };
    Storage.prototype.getItem = function(name) { if (name === key) channelViewAudit.reads++; return get.call(this, name); };
    Storage.prototype.setItem = function(name, value) { if (name === key) channelViewAudit.writes++; return set.call(this, name, value); };
    window.restoreChannelViewAudit = () => { Storage.prototype.getItem = get; Storage.prototype.setItem = set; return { ...channelViewAudit }; };
  }, KEY);
  await search.fill('  aLpHa  ');
  assert.deepEqual(await list.locator('h3').allTextContents(), ['Daily Alpha News']);
  assert.match(await count.textContent(), /Showing 1 of 30 channels/);
  await search.fill(rules[21].channelId.toLowerCase());
  assert.deepEqual(await list.locator('.channel-filter-id').allTextContents(), [rules[21].channelId]);
  await search.fill('[.*]');
  assert.equal(await list.getByRole('listitem').count(), 0);
  assert.match(await count.textContent(), /Showing 0 of 30 channels/);
  assert.equal(await page.locator('#ytms-age-empty').isVisible(), true);
  assert.match(await page.locator('#ytms-age-empty').textContent(), /No channels match/);
  await page.locator('#ytms-channel-search-clear').click();
  assert.equal(await search.inputValue(), '');
  assert.equal(await list.getByRole('listitem').count(), 30);
  assert.equal(await search.evaluate(node => node === document.activeElement), true);
  await page.locator('#ytms-channel-sort').selectOption('name-desc');
  const audit = await page.evaluate(() => restoreChannelViewAudit());
  assert.deepEqual(audit, { reads: 0, writes: 0 });
  assert.deepEqual(await page.evaluate(({ key, settings }) => ({ filters: localStorage.getItem(key), settings: localStorage.getItem(settings) }), { key: KEY, settings: SETTINGS_KEY }), before);
  assert.equal(await page.locator('#ytms-save-preview').isDisabled(), true);
  assert.equal(await page.locator('#ytms-settings-status').isVisible(), false);
  for (const dark of [true, false]) {
    await page.evaluate(dark => document.documentElement.toggleAttribute('dark', dark), dark);
    await page.setViewportSize({ width: 360, height: 600 });
    assert.equal(await page.locator('#ytms-settings-dialog .content').evaluate(node => node.scrollWidth <= node.clientWidth), true);
    assert.equal(await search.evaluate(node => node.scrollWidth <= node.clientWidth), true);
    assert.equal(await page.locator('#ytms-channel-sort').evaluate(node => node.scrollWidth <= node.clientWidth), true);
  }
});

test('channel sorting is view-only and orders names, real age units and enabled status independently', async t => {
  const rules = [
    { channelId: FIRST, name: 'Year', maxAge: 1, unit: 'years', enabled: true, blocked: false },
    { channelId: SECOND, name: 'Week', maxAge: 2, unit: 'weeks', enabled: false, blocked: false },
    { channelId: `UC${'c'.repeat(22)}`, name: 'Block', maxAge: 1, unit: 'years', enabled: true, blocked: true },
    { channelId: `UC${'d'.repeat(22)}`, name: 'Month', maxAge: 1, unit: 'months', enabled: true, blocked: false },
    { channelId: `UC${'e'.repeat(22)}`, name: 'Day', maxAge: 3, unit: 'days', enabled: false, blocked: false },
  ];
  const page = await openFixture(t, rules, { width: 1280, height: 900 }, true);
  await openChannels(page);
  const list = page.locator('#ytms-channel-filter-list');
  const sort = page.locator('#ytms-channel-sort');
  const before = await page.evaluate(key => localStorage.getItem(key), KEY);
  for (const [value, names] of [
    ['name-asc', ['Block', 'Day', 'Month', 'Week', 'Year']],
    ['name-desc', ['Year', 'Week', 'Month', 'Day', 'Block']],
    ['age-asc', ['Block', 'Day', 'Week', 'Month', 'Year']],
    ['age-desc', ['Year', 'Month', 'Week', 'Day', 'Block']],
    ['saved', ['Year', 'Week', 'Block', 'Month', 'Day']],
  ]) {
    await sort.selectOption(value);
    assert.deepEqual(await list.locator('h3').allTextContents(), names, value);
  }
  await sort.selectOption('status-enabled');
  assert.deepEqual(await list.locator('.channel-filter-status .channel-filter-value').allTextContents(), ['Enabled', 'Enabled', 'Enabled', 'Disabled', 'Disabled']);
  await sort.selectOption('status-disabled');
  assert.deepEqual(await list.locator('.channel-filter-status .channel-filter-value').allTextContents(), ['Disabled', 'Disabled', 'Enabled', 'Enabled', 'Enabled']);
  assert.equal(await page.evaluate(key => localStorage.getItem(key), KEY), before);
  assert.equal(await page.evaluate(key => localStorage.getItem(key), SETTINGS_KEY), null);
  assert.equal(await page.locator('#ytms-save-preview').isDisabled(), true);
});

test('settings-origin channel saves return to the table and preserve unrelated main-preference drafts', async t => {
  const rule = { channelId: FIRST, name: 'News', maxAge: 1, unit: 'days', enabled: true, blocked: false };
  const page = await openFixture(t, [rule], { width: 1280, height: 900 }, true);
  await page.locator('#ytms-settings-button').click();
  await page.getByRole('tab', { name: 'Feed', exact: true }).click();
  await page.locator('#ytms-hideShorts').uncheck();
  await page.getByRole('tab', { name: 'Channels', exact: true }).click();
  await page.getByRole('button', { name: 'Edit filter for News', exact: true }).click();
  await field(page, 'Maximum age').fill('2');
  await page.locator('#ytms-age-save').click();
  assert.equal(await page.locator('#ytms-settings-dialog').isVisible(), true);
  assert.equal(await page.locator('#ytms-tab-channels').getAttribute('aria-selected'), 'true');
  assert.equal(await page.locator('.ytms-age-fields:visible').count(), 0);
  assert.equal(await page.locator('#ytms-channel-filter-list .channel-filter-age .channel-filter-value').textContent(), 'Up to 2 days');
  assert.equal(await page.evaluate(key => localStorage.getItem(key), SETTINGS_KEY), null);
  await page.getByRole('tab', { name: 'Feed', exact: true }).click();
  assert.equal(await page.locator('#ytms-hideShorts').isChecked(), false);
  assert.equal(await page.locator('#ytms-save-preview').isDisabled(), false);
});

test('context-origin saves retain an already-open main-preference draft rather than closing and discarding it', async t => {
  const rule = { channelId: FIRST, name: 'News', maxAge: 1, unit: 'days', enabled: true, blocked: false };
  const page = await openFixture(t, [rule], { width: 1280, height: 900 }, true, true);
  await page.locator('#ytms-settings-button').click();
  await page.getByRole('tab', { name: 'Feed', exact: true }).click();
  await page.locator('#ytms-hideShorts').uncheck();
  await page.evaluate(channelId => {
    const card = document.createElement('ytd-video-renderer');
    card.id = 'context-draft-card'; document.body.append(card);
    fixtureOpenChannels({ channelId, name: 'News' }, { card, videoId: 'bbbbbbbbbbb' });
  }, FIRST);
  await field(page, 'Maximum age').fill('2');
  await page.locator('#ytms-age-save').click();
  assert.equal(await page.locator('#ytms-settings-dialog').isVisible(), true);
  assert.match(await page.locator('#ytms-channel-entry-notice').textContent(), /Other settings still have unsaved changes/);
  assert.equal(await page.locator('#ytms-channel-entry-notice').isVisible(), true);
  assert.equal(await page.evaluate(key => JSON.parse(localStorage.getItem(key)).rules[0].maxAge, KEY), 2);
  assert.equal(await page.evaluate(key => localStorage.getItem(key), SETTINGS_KEY), null);
  await page.getByRole('tab', { name: 'Feed', exact: true }).click();
  assert.equal(await page.locator('#ytms-hideShorts').isChecked(), false);
  assert.equal(await page.locator('#ytms-save-preview').isDisabled(), false);
});

test('an embedded dirty channel draft survives external saves and rejects overwrite until Cancel', async t => {
  const original = { channelId: FIRST, name: 'News', maxAge: 1, unit: 'days', enabled: true, blocked: false };
  const page = await openFixture(t, [original], { width: 1280, height: 900 }, true);
  await openChannels(page);
  await page.getByRole('button', { name: 'Edit filter for News', exact: true }).click();
  await field(page, 'Maximum age').fill('2');
  const other = await page.context().newPage();
  await other.goto(WATCH_URL);
  await other.evaluate(({ key, rule }) => localStorage.setItem(key, JSON.stringify({ version: 1, rules: [rule] })), { key: KEY, rule: { ...original, maxAge: 3 } });
  await page.waitForTimeout(100);
  assert.equal(await field(page, 'Maximum age').inputValue(), '2');
  await page.locator('#ytms-age-save').click();
  assert.match(await page.locator('#ytms-age-status').textContent(), /changed in another window/);
  assert.equal(await page.locator('#ytms-settings-dialog').isVisible(), true);
  assert.equal(await field(page, 'Maximum age').inputValue(), '2');
  assert.equal(await page.evaluate(key => JSON.parse(localStorage.getItem(key)).rules[0].maxAge, KEY), 3);
  await page.locator('#ytms-age-cancel').click();
  assert.equal(await page.locator('#ytms-settings-dialog').isVisible(), true);
  assert.equal(await page.locator('.ytms-age-fields:visible').count(), 0);
  assert.equal(await page.locator('#ytms-channel-filter-list .channel-filter-age .channel-filter-value').textContent(), 'Up to 3 days');
});

test('an embedded storage failure keeps its draft open and can be retried without changing main preferences', async t => {
  const original = { channelId: FIRST, name: 'News', maxAge: 1, unit: 'days', enabled: true, blocked: false };
  const page = await openFixture(t, [original], { width: 1280, height: 900 }, true);
  await openChannels(page);
  await page.getByRole('button', { name: 'Edit filter for News', exact: true }).click();
  await field(page, 'Maximum age').fill('2');
  await page.evaluate(key => {
    const native = Storage.prototype.setItem;
    Storage.prototype.setItem = function(name, value) { if (name === key) throw new Error('Fixture quota failure'); return native.call(this, name, value); };
    window.restoreChannelStorage = () => { Storage.prototype.setItem = native; };
  }, KEY);
  await page.locator('#ytms-age-save').click();
  assert.equal(await page.locator('#ytms-settings-dialog').isVisible(), true);
  assert.equal(await field(page, 'Maximum age').inputValue(), '2');
  assert.match(await page.locator('#ytms-age-status').textContent(), /could not be saved/);
  assert.equal(await page.evaluate(key => JSON.parse(localStorage.getItem(key)).rules[0].maxAge, KEY), 1);
  await page.evaluate(() => restoreChannelStorage());
  await page.locator('#ytms-age-save').click();
  assert.equal(await page.locator('#ytms-settings-dialog').isVisible(), true);
  assert.equal(await page.locator('.ytms-age-fields:visible').count(), 0);
  assert.equal(await page.evaluate(key => JSON.parse(localStorage.getItem(key)).rules[0].maxAge, KEY), 2);
  assert.equal(await page.evaluate(key => localStorage.getItem(key), SETTINGS_KEY), null);
});

test('unsaved channel edits block backup restore until they are explicitly discarded', async t => {
  const page = await openFixture(t, [], { width: 1280, height: 900 }, true);
  await openChannels(page);
  await addRule(page);
  await page.getByRole('tab', { name: 'Support', exact: true }).click();
  const backup = {
    format: 'youtube-master-suite-backup', version: 1, language: 'en-GB',
    settings: { ...createSuiteSettings(() => ({ getItem: () => null }), () => true).read(), hideShorts: false }, channelFilters: [],
  };
  await page.locator('#ytms-import-backup').setInputFiles({
    name: 'backup.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(backup)),
  });
  await page.locator('#ytms-backup-preview').waitFor();
  await page.locator('#ytms-confirm-restore').check();
  assert.equal(await page.locator('#ytms-restore-backup').isDisabled(), true);
  assert.match(await page.locator('#ytms-backup-status').textContent(), /Save or discard/);
  assert.equal(await page.evaluate(key => localStorage.getItem(key), KEY), null);
  await page.getByRole('tab', { name: 'Channels', exact: true }).click();
  assert.equal(await field(page, 'Channel ID or channel URL').inputValue(), FIRST);
  await page.locator('#ytms-age-cancel').click();
  await page.getByRole('tab', { name: 'Support', exact: true }).click();
  assert.equal(await page.locator('#ytms-restore-backup').isEnabled(), true);
  assert.equal(await page.evaluate(key => localStorage.getItem(key), KEY), null);
});

test('returning from Channels restores main footer visibility without revealing an empty status', async t => {
  const page = await openFixture(t, [], { width: 1280, height: 900 }, true);
  await openChannels(page);
  assert.equal(await page.locator('#ytms-channel-footer').isVisible(), true);
  assert.equal(await page.locator('#ytms-save-preview').isVisible(), false);
  await page.getByRole('tab', { name: 'Feed', exact: true }).click();
  assert.equal(await page.locator('#ytms-channel-footer').isVisible(), false);
  assert.equal(await page.locator('#ytms-save-preview').isVisible(), true);
  assert.equal(await page.locator('#ytms-settings-status').isVisible(), false);
  assert.equal(await page.locator('#ytms-save-preview').isDisabled(), true);
});

test('Reload now warns about an unsaved channel draft and dismissal preserves it', async t => {
  const page = await openFixture(t, [], { width: 1280, height: 900 }, true);
  await openChannels(page);
  await addRule(page);
  await page.getByRole('tab', { name: 'Feed', exact: true }).click();
  await page.locator('#ytms-hideShorts').uncheck();
  await page.locator('#ytms-save-preview').click();
  assert.equal(await page.locator('#ytms-save-preview').textContent(), 'Reload now');
  const confirmations = [];
  page.on('dialog', async dialog => { confirmations.push(dialog.message()); await dialog.dismiss(); });
  await page.locator('#ytms-save-preview').click();
  assert.equal(confirmations.length, 1);
  assert.match(confirmations[0], /channel/i);
  assert.match(confirmations[0], /unsaved|discard/i);
  assert.equal(await page.locator('#ytms-settings-dialog').isVisible(), true);
  await page.getByRole('tab', { name: 'Channels', exact: true }).click();
  assert.equal(await field(page, 'Channel ID or channel URL').inputValue(), FIRST);
  assert.equal(await page.evaluate(key => localStorage.getItem(key), KEY), null);
});

const transferRule = (channelId = FIRST, values = {}) => ({
  channelId, name: channelId === FIRST ? 'News' : 'Documentaries', maxAge: 1, unit: 'weeks', enabled: true, blocked: false, ...values,
});
const channelFile = rules => ({ format: CHANNEL_FORMAT, version: 1, language: 'en-GB', channelFilters: rules });
async function channelTransferRaw(page) {
  return page.evaluate(keys => keys.map(key => localStorage.getItem(key)), [SETTINGS_KEY, CORNER_KEY, KEY]);
}
async function transferFixture(t, rules = [transferRule()], exposeChannelLauncher = false) {
  const page = await openFixture(t, rules, { width: 1280, height: 900 }, true, exposeChannelLauncher);
  const values = createSuiteSettings(() => ({ getItem: () => null }), () => true).read();
  await page.evaluate(({ settings, corner, values }) => {
    localStorage.setItem(settings, JSON.stringify({ version: 1, values: { ...values, hideShorts: false } }));
    localStorage.setItem(corner, 'bottom-left');
  }, { settings: SETTINGS_KEY, corner: CORNER_KEY, values });
  await openChannels(page);
  await openTransferDetails(page);
  return page;
}
async function openTransferDetails(page) {
  if (!await page.locator('#ytms-channel-transfer').evaluate(node => node.open)) {
    await page.locator('#ytms-channel-transfer > summary').click();
  }
}
async function importChannels(page, value, name = 'channels.json') {
  await page.locator('#ytms-import-channels').setInputFiles({
    name, mimeType: 'application/json', buffer: Buffer.from(typeof value === 'string' ? value : JSON.stringify(value)),
  });
}
async function transferPreview(page) {
  await page.locator('#ytms-channel-import-preview').waitFor({ state: 'visible' });
}
async function confirmChannelImport(page) {
  await page.locator('#ytms-confirm-channel-import').check();
  await page.locator('#ytms-apply-channel-import').click();
}

test('alternating saved-channel rows stay subtle and readable in both themes and narrow layouts', async t => {
  const rules = [transferRule(), transferRule(SECOND), transferRule(`UC${'c'.repeat(22)}`)];
  const page = await openFixture(t, rules, { width: 1280, height: 900 }, true);
  await openChannels(page);
  for (const dark of [true, false]) {
    await page.evaluate(value => document.documentElement.toggleAttribute('dark', value), dark);
    const styles = await page.locator('#ytms-channel-filter-list > article').evaluateAll(rows => rows.map(row => {
      const style = getComputedStyle(row);
      return { background: style.backgroundColor, colour: style.color };
    }));
    assert.notEqual(styles[0].background, styles[1].background, 'Adjacent rows have distinct backgrounds');
    assert.equal(styles[0].background, styles[2].background, 'Alternation follows visible row positions');
    assert.equal(styles[0].colour, styles[1].colour, 'Row shading does not change readable text colour');
    for (const width of [760, 360]) {
      await page.setViewportSize({ width, height: 700 });
      assert.equal(await page.locator('#ytms-settings-dialog .content').evaluate(node => node.scrollWidth <= node.clientWidth), true);
      const row = page.locator('#ytms-channel-filter-list > article').first();
      await row.getByRole('button', { name: 'Edit filter for News', exact: true }).focus();
      await page.keyboard.press('Tab');
      const remove = row.getByRole('button', { name: 'Remove filter for News', exact: true });
      assert.equal(await remove.evaluate(node => node === document.activeElement), true);
      assert.equal(await remove.evaluate(node => getComputedStyle(node).outlineStyle), 'solid');
    }
  }
});

test('channel-only export downloads all saved rule fields without preferences, corner or unsaved edits', async t => {
  const rules = [transferRule(FIRST, { maxAge: 2, unit: 'months' }),
    transferRule(SECOND, { enabled: false, blocked: true, maxAge: 3, unit: 'years' })];
  const page = await transferFixture(t, rules);
  assert.equal(await page.locator('#ytms-channel-transfer').evaluate(node => node.open), true);
  const before = await channelTransferRaw(page);
  await addRule(page, `UC${'c'.repeat(22)}`, '4', 'days', 'Unsaved channel');
  const event = page.waitForEvent('download');
  await page.locator('#ytms-export-channels').click();
  const download = await event;
  assert.equal(download.suggestedFilename(), 'youtube-master-suite-channels.json');
  const stream = await download.createReadStream(), chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  const exported = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  assert.deepEqual(exported, channelFile(rules));
  assert.deepEqual(Object.keys(exported), ['format', 'version', 'language', 'channelFilters']);
  assert.deepEqual(await channelTransferRaw(page), before);
  assert.match(await page.locator('#ytms-channel-transfer-status').textContent(), /saved|unsaved/i);
  assert.equal(await field(page, 'Channel name', 2).inputValue(), 'Unsaved channel');
});

test('channel import previews a merge by default, preserves unlisted channels and never changes settings or corner', async t => {
  const original = [transferRule(), transferRule(SECOND, { maxAge: 2, unit: 'years' })];
  const third = `UC${'c'.repeat(22)}`;
  const updated = transferRule(FIRST, { name: 'Updated news', maxAge: 3, unit: 'days' });
  const added = transferRule(third, { name: 'New channel', enabled: false, blocked: true });
  const page = await transferFixture(t, original);
  await page.getByRole('tab', { name: 'Feed', exact: true }).click();
  await page.locator('#ytms-hideMixes').uncheck();
  await page.getByRole('tab', { name: 'Channels', exact: true }).click();
  await openTransferDetails(page);
  const before = await channelTransferRaw(page), url = page.url();
  await page.evaluate(() => { window.channelTransferSentinel = true; window.channelTransferVideo = document.querySelector('video'); });
  assert.equal(await page.locator('#ytms-channel-import-mode').inputValue(), 'merge');
  await importChannels(page, channelFile([updated, added]));
  await transferPreview(page);
  assert.match(await page.locator('#ytms-channel-import-preview').textContent(), /1 added.*1 updated.*0 removed.*1 unchanged.*3 after import/s);
  assert.deepEqual(await channelTransferRaw(page), before, 'Preview is read-only');
  assert.equal(await page.locator('#ytms-apply-channel-import').isDisabled(), true);
  await confirmChannelImport(page);
  const after = await channelTransferRaw(page);
  assert.deepEqual(after.slice(0, 2), before.slice(0, 2), 'Main settings and corner retain exact raw bytes');
  assert.deepEqual(JSON.parse(after[2]).rules, [updated, original[1], added]);
  assert.equal(await page.locator('#ytms-settings-dialog').isVisible(), true);
  assert.equal(await page.locator('.ytms-age-fields:visible').count(), 0);
  assert.equal(await page.locator('#ytms-tab-channels').getAttribute('aria-selected'), 'true');
  assert.equal(await page.evaluate(() => channelTransferSentinel && channelTransferVideo === document.querySelector('video')), true);
  assert.equal(page.url(), url);
  await page.getByRole('tab', { name: 'Feed', exact: true }).click();
  assert.equal(await page.locator('#ytms-hideMixes').isChecked(), false);
  assert.equal(await page.locator('#ytms-save-preview').isEnabled(), true, 'Unrelated unsaved preferences remain available');
});

test('replacement import requires explicit mode and renewed acknowledgement before removing channels', async t => {
  const original = [transferRule(), transferRule(SECOND)];
  const page = await transferFixture(t, original);
  const before = await channelTransferRaw(page);
  const changed = transferRule(FIRST, { maxAge: 2, unit: 'months' });
  await importChannels(page, channelFile([changed]));
  await transferPreview(page);
  await page.locator('#ytms-confirm-channel-import').check();
  await page.locator('#ytms-channel-import-mode').selectOption('replace');
  assert.equal(await page.locator('#ytms-confirm-channel-import').isChecked(), false);
  assert.equal(await page.locator('#ytms-apply-channel-import').isDisabled(), true);
  assert.match(await page.locator('#ytms-channel-import-preview').textContent(), /1 updated.*1 removed.*1 after import/s);
  assert.deepEqual(await channelTransferRaw(page), before);
  await confirmChannelImport(page);
  const after = await channelTransferRaw(page);
  assert.deepEqual(after.slice(0, 2), before.slice(0, 2));
  assert.deepEqual(JSON.parse(after[2]).rules, [changed]);
  await importChannels(page, channelFile([]));
  await transferPreview(page);
  await page.locator('#ytms-channel-import-mode').selectOption('replace');
  assert.match(await page.locator('#ytms-channel-import-preview').textContent(), /1 removed.*0 after import/s);
  await confirmChannelImport(page);
  assert.deepEqual(JSON.parse((await channelTransferRaw(page))[2]).rules, []);
});

test('order-only replacement requires acknowledgement and updates the saved-order table', async t => {
  const original = [transferRule(), transferRule(SECOND)];
  const imported = [original[1], original[0]];
  const page = await transferFixture(t, original);
  const before = await channelTransferRaw(page);
  await importChannels(page, channelFile(imported));
  await transferPreview(page);
  await page.locator('#ytms-confirm-channel-import').check();
  assert.equal(await page.locator('#ytms-apply-channel-import').isDisabled(), true, 'Merge keeps the existing order');
  await page.locator('#ytms-channel-import-mode').selectOption('replace');
  assert.equal(await page.locator('#ytms-confirm-channel-import').isChecked(), false);
  assert.equal(await page.locator('#ytms-apply-channel-import').isDisabled(), true);
  assert.match(await page.locator('#ytms-channel-import-preview').textContent(), /0 added.*0 updated.*0 removed.*2 unchanged/s);
  assert.match(await page.locator('#ytms-channel-import-preview').textContent(), /saved channel order will change/i);
  assert.deepEqual(await channelTransferRaw(page), before, 'Order-only preview is read-only');
  await page.locator('#ytms-confirm-channel-import').check();
  assert.equal(await page.locator('#ytms-apply-channel-import').isEnabled(), true);
  await page.locator('#ytms-apply-channel-import').click();
  const after = await channelTransferRaw(page);
  assert.deepEqual(after.slice(0, 2), before.slice(0, 2));
  assert.deepEqual(JSON.parse(after[2]).rules, imported);
  assert.equal(await page.locator('#ytms-channel-sort').inputValue(), 'saved');
  assert.deepEqual(await page.locator('#ytms-channel-filter-list .channel-filter-identity h3').allTextContents(), ['Documentaries', 'News']);
});

test('changing or cancelling an import file clears prior acknowledgement and does not write storage', async t => {
  const page = await transferFixture(t);
  const before = await channelTransferRaw(page);
  await importChannels(page, channelFile([transferRule(SECOND)]));
  await transferPreview(page);
  await page.locator('#ytms-confirm-channel-import').check();
  await importChannels(page, channelFile([transferRule(FIRST, { maxAge: 2 })]), 'different.json');
  await transferPreview(page);
  assert.equal(await page.locator('#ytms-confirm-channel-import').isChecked(), false);
  await page.locator('#ytms-cancel-channel-import').click();
  assert.equal(await page.locator('#ytms-channel-import-preview').isVisible(), false);
  assert.deepEqual(await channelTransferRaw(page), before);
  await importChannels(page, channelFile([transferRule(SECOND)]));
  await transferPreview(page);
  await page.locator('#ytms-import-channels').setInputFiles([]);
  assert.equal(await page.locator('#ytms-channel-import-preview').isVisible(), false);
  assert.deepEqual(await channelTransferRaw(page), before);
});

test('malformed, oversized, unsupported and invalid channel files cannot change saved data', async t => {
  const page = await transferFixture(t);
  const before = await channelTransferRaw(page);
  const tooMany = Array.from({ length: 101 }, (_, index) => transferRule(`UC${String(index).padStart(22, '0')}`));
  const cases = ['{broken', 'x'.repeat(131073),
    { ...channelFile([]), version: 99 }, { ...channelFile([]), language: 'en-US' },
    { ...channelFile([]), unknown: 'no' }, channelFile([transferRule(), transferRule()]),
    channelFile([{ ...transferRule(), channelId: '@not-a-stable-channel' }]), channelFile(tooMany),
    channelFile([{ ...transferRule(), maxAge: 0 }]), channelFile([{ ...transferRule(), enabled: 'true' }]),
    '{"format":"youtube-master-suite-channel-filters","version":1,"language":"en-GB","channelFilters":[],"__proto__":{"polluted":true}}'];
  for (const value of cases) {
    await importChannels(page, value);
    await page.waitForFunction(() => !document.getElementById('ytms-channel-transfer-status').textContent.includes('Reading'));
    assert.equal(await page.locator('#ytms-channel-import-preview').isVisible(), false);
    assert.deepEqual(await channelTransferRaw(page), before);
  }
  assert.equal(await page.evaluate(() => ({}).polluted), undefined);
});

test('channel import cannot discard an unsaved inline editor draft', async t => {
  const page = await transferFixture(t);
  const before = await channelTransferRaw(page);
  await page.getByRole('button', { name: 'Edit filter for News', exact: true }).click();
  await field(page, 'Maximum age').fill('7');
  await importChannels(page, channelFile([transferRule(SECOND)]));
  await transferPreview(page);
  await page.locator('#ytms-confirm-channel-import').check();
  assert.equal(await page.locator('#ytms-apply-channel-import').isDisabled(), true);
  assert.match(await page.locator('#ytms-channel-transfer-status').textContent(), /save|discard/i);
  assert.equal(await field(page, 'Maximum age').inputValue(), '7');
  assert.deepEqual(await channelTransferRaw(page), before);
  await page.locator('#ytms-age-cancel').click();
  assert.equal(await page.locator('#ytms-settings-dialog').isVisible(), true);
  await openTransferDetails(page);
  await importChannels(page, channelFile([transferRule(SECOND)]));
  await transferPreview(page);
  await confirmChannelImport(page);
  assert.equal(JSON.parse((await channelTransferRaw(page))[2]).rules.length, 2);
});

test('a channel write made after preview is preserved and import requires a fresh preview', async t => {
  const page = await transferFixture(t);
  const before = await channelTransferRaw(page);
  await importChannels(page, channelFile([transferRule(SECOND)]));
  await transferPreview(page);
  const concurrent = transferRule(FIRST, { maxAge: 9, unit: 'months' });
  await page.evaluate(({ key, rule }) => localStorage.setItem(key, JSON.stringify({ version: 1, rules: [rule] })), { key: KEY, rule: concurrent });
  await confirmChannelImport(page);
  assert.match(await page.locator('#ytms-channel-transfer-status').textContent(), /changed|preview/i);
  const after = await channelTransferRaw(page);
  assert.deepEqual(after.slice(0, 2), before.slice(0, 2));
  assert.deepEqual(JSON.parse(after[2]).rules, [concurrent]);
});

test('storage failure during channel import leaves prior channels and unrelated settings intact', async t => {
  const page = await transferFixture(t);
  const before = await channelTransferRaw(page);
  await importChannels(page, channelFile([transferRule(SECOND)]));
  await transferPreview(page);
  await page.evaluate(key => {
    const native = Storage.prototype.setItem;
    Storage.prototype.setItem = function(name, value) { if (name === key) throw new Error('Fixture quota failure'); return native.call(this, name, value); };
    window.restoreTransferStorage = () => { Storage.prototype.setItem = native; };
  }, KEY);
  await confirmChannelImport(page);
  assert.deepEqual(await channelTransferRaw(page), before);
  assert.match(await page.locator('#ytms-channel-transfer-status').textContent(), /could not|failed|unavailable/i);
  assert.equal(await page.locator('#ytms-settings-dialog').isVisible(), true);
  await page.evaluate(() => restoreTransferStorage());
});

test('stale asynchronous file reads cannot replace a newer preview or update reopened settings', async t => {
  const page = await transferFixture(t);
  const before = await channelTransferRaw(page);
  await page.evaluate(() => {
    const native = File.prototype.text;
    File.prototype.text = function() {
      if (this.name.startsWith('delayed')) {
        const file = this;
        return new Promise(resolve => { window.finishDelayedChannelRead = () => native.call(file).then(resolve); });
      }
      return native.call(this);
    };
  });
  await importChannels(page, channelFile([transferRule(SECOND)]), 'delayed-old.json');
  await importChannels(page, channelFile([transferRule(FIRST, { maxAge: 5 })]), 'newer.json');
  await transferPreview(page);
  const preview = await page.locator('#ytms-channel-import-preview').textContent();
  await page.evaluate(() => finishDelayedChannelRead());
  await page.waitForTimeout(100);
  assert.equal(await page.locator('#ytms-channel-import-preview').textContent(), preview);
  await importChannels(page, channelFile([transferRule(SECOND)]), 'delayed-reopen.json');
  await page.locator('#ytms-close-panel').click();
  await openChannels(page);
  await openTransferDetails(page);
  await page.evaluate(() => finishDelayedChannelRead());
  await page.waitForTimeout(100);
  assert.equal(await page.locator('#ytms-channel-import-preview').isVisible(), false);
  assert.deepEqual(await channelTransferRaw(page), before);
});

test('an import from a context-opened Channels screen stays on the table without applying unrelated preferences', async t => {
  const page = await transferFixture(t, [transferRule()], true);
  const before = await channelTransferRaw(page);
  await page.evaluate(channelId => {
    const card = document.createElement('ytd-video-renderer'); document.body.append(card);
    fixtureOpenChannels({ channelId, name: 'News' }, { card, videoId: 'bbbbbbbbbbb' });
  }, FIRST);
  // Merely opening an unchanged editor is not an unsaved draft.
  await openTransferDetails(page);
  await importChannels(page, channelFile([transferRule(SECOND)]));
  await transferPreview(page);
  await confirmChannelImport(page);
  assert.equal(await page.locator('#ytms-settings-dialog').isVisible(), true);
  assert.equal(await page.locator('#ytms-tab-channels').getAttribute('aria-selected'), 'true');
  assert.equal(await page.locator('.ytms-age-fields:visible').count(), 0);
  assert.deepEqual((await channelTransferRaw(page)).slice(0, 2), before.slice(0, 2));
});

test('channel transfer previews fit narrow light and dark panels and require keyboard acknowledgement', async t => {
  const page = await transferFixture(t);
  const before = await channelTransferRaw(page);
  await importChannels(page, channelFile([transferRule(SECOND)]), 'a-very-long-channel-limits-backup-file-name-for-a-narrow-window.json');
  await transferPreview(page);
  for (const dark of [true, false]) {
    await page.evaluate(value => document.documentElement.toggleAttribute('dark', value), dark);
    for (const width of [760, 360]) {
      await page.setViewportSize({ width, height: 700 });
      assert.equal(await page.locator('#ytms-settings-dialog .content').evaluate(node => node.scrollWidth <= node.clientWidth), true);
      assert.equal(await page.locator('#ytms-channel-transfer').evaluate(node => node.scrollWidth <= node.clientWidth), true);
      const check = page.locator('#ytms-confirm-channel-import');
      await check.uncheck(); await check.focus(); await page.keyboard.press('Space');
      assert.equal(await check.isChecked(), true);
      await page.keyboard.press('Tab');
      assert.equal(await page.locator('#ytms-apply-channel-import').evaluate(node => node === document.activeElement), true);
    }
  }
  assert.deepEqual(await channelTransferRaw(page), before);
});
