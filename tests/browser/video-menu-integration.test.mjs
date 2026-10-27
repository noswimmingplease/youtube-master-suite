import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { after, before, test } from 'node:test';
import { launchFixtureBrowser, waitForSuiteHealth } from './fixture-browser.mjs';

const SUITE = readFileSync(new URL('../../youtube-master-suite.user.js', import.meta.url), 'utf8');
const MANIFEST = JSON.parse(readFileSync(new URL('../../release-manifest.json', import.meta.url), 'utf8'));
const FIXTURE = readFileSync(new URL('./watch-page.html', import.meta.url), 'utf8')
  .replace('<html lang="en" dark>', '<html lang="en-GB" dark>')
  .replace('</head>', '<style>tp-yt-iron-dropdown[hidden]{display:none!important}</style></head>');
let browser;
before(async () => { browser = await launchFixtureBrowser(); }, { timeout: 30000 });
after(async () => { await browser?.close(); });

for (const sheet of [false, true]) {
 for (const eventless of [false, true]) {
  test(`complete Suite retains Play next and native actions while opening channel tools (${sheet ? 'current sheet' : 'legacy popup'}, ${eventless ? 'cached eventless reopen' : 'native open event'})`, { timeout: 20000 }, async t => {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, serviceWorkers: 'block' });
    await context.route('**/*', route => route.request().url() === 'https://www.youtube.com/watch?v=aaaaaaaaaaa'
      ? route.fulfill({ contentType: 'text/html', body: FIXTURE }) : route.abort());
    await context.addInitScript({ content: SUITE });
    const page = await context.newPage();
    page.setDefaultTimeout(5000);
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    t.after(async () => { try { assert.deepEqual(errors, []); } finally { await context.close(); } });
    await page.goto('https://www.youtube.com/watch?v=aaaaaaaaaaa');
    await waitForSuiteHealth(page, MANIFEST.registeredModules, { timeoutMs: 10000, requireReady: true });
    await page.evaluate(({ sheet, eventless }) => {
      const card = document.createElement('yt-lockup-view-model');
      card.id = 'integration-card'; card.style.cssText = 'display:block;position:fixed;top:100px;left:16px;z-index:9000;background:#222;padding:12px';
      const link = document.createElement('a'); link.href = '/watch?v=bbbbbbbbbbb'; link.textContent = 'Next video';
      const byline = document.createElement('div'); byline.id = 'channel-name';
      const owner = document.createElement('a'); owner.href = '/channel/UCabcdefghijklmnopqrstuv'; owner.textContent = 'Daily news'; byline.append(owner);
      if (sheet) {
        // Current lockups expose an opaque .data value and a handle in the DOM.
        owner.href = '/@dailynews';
        Object.defineProperty(card, 'data', { get: () => Symbol('opaque') });
        card.componentProps = { data: () => ({ metadata: { lockupMetadataViewModel: { metadata: {
          contentMetadataViewModel: { metadataRows: [{ metadataParts: [{ text: { content: 'Daily news', commandRuns: [{
            startIndex: 0, length: 10, onTap: { innertubeCommand: { browseEndpoint: { browseId: 'UCabcdefghijklmnopqrstuv' } } },
          }] } }] }] },
        } } } }) };
      }
      // Real current lockup wrapper: no legacy ytd-menu-renderer or aria-haspopup.
      const menu = document.createElement('div'); menu.className = 'ytLockupMetadataViewModelMenuButton';
      const buttonViewModel = document.createElement('button-view-model'); buttonViewModel.className = 'ytSpecButtonViewModelHost';
      const trigger = document.createElement('button'); trigger.id = 'integration-trigger';
      trigger.className = 'ytSpecButtonShapeNextHost ytSpecButtonShapeNextText ytSpecButtonShapeNextMono ytSpecButtonShapeNextSizeM ytSpecButtonShapeNextIconButton ytSpecButtonShapeNextEnableBackdropFilterExperiment ytSpecButtonShapeNextMainstageIconSize ytSpecButtonShapeNextMainstagePadding';
      trigger.setAttribute('aria-label', 'More actions'); trigger.setAttribute('aria-disabled', 'false');
      trigger.textContent = '⋮'; buttonViewModel.append(trigger); menu.append(buttonViewModel);
      card.append(link, byline, menu); document.body.append(card);
      const dropdown = document.createElement('tp-yt-iron-dropdown');
      dropdown.style.cssText = 'display:block;position:fixed;left:16px;top:180px;z-index:9001;background:#272727;color:white;width:300px';
      dropdown.hidden = true;
      const popup = document.createElement(sheet ? 'yt-sheet-view-model' : 'ytd-menu-popup-renderer');
      popup.style.display = 'block'; popup.setAttribute('role', 'menu'); dropdown.append(popup); document.body.append(dropdown);
      const fixture = window.menuIntegration = { calls: [], refits: 0, data: null };
      dropdown.refit = () => { fixture.refits++; };
      dropdown.close = () => { dropdown.hidden = true; dropdown.dispatchEvent(new CustomEvent('iron-overlay-closed', { bubbles: true })); };
      const endpoint = { signalServiceEndpoint: { signal: 'CLIENT_SIGNAL', actions: [{ addToPlaylistCommand: {
        videoId: 'bbbbbbbbbbb', videoIds: ['bbbbbbbbbbb'], listType: 'PLAYLIST_EDIT_LIST_TYPE_QUEUE',
      } }] } };
      // Exact live model variants: Download is a distinct outer view model;
      // Save to playlist and Not interested use BOOKMARK_BORDER and HIDE.
      const definitions = [['Add to queue', 'ADD_TO_QUEUE_TAIL', endpoint], ['Watch later', 'WATCH_LATER', {}],
        ['Save to playlist', 'BOOKMARK_BORDER', {}], ['Download', null, {}], ['Share', 'SHARE', {}],
        ['Not interested', 'HIDE', {}], ['Don’t recommend channel', 'REMOVE', { feedbackEndpoint: { feedbackToken: 'fixture-channel-feedback' } }], ['Report', 'FLAG', {}]];
      const items = definitions.map(([label, icon, command]) => label === 'Download'
        ? sheet ? { downloadListItemViewModel: { rendererContext: {} } }
          : { menuServiceItemDownloadRenderer: { serviceEndpoint: { offlineVideoEndpoint: {} } } }
        : sheet ? { listItemViewModel: {
        title: { content: label }, leadingImage: { sources: [{ clientResource: { imageName: icon } }] },
        rendererContext: { commandContext: { onTap: { innertubeCommand: command } } },
      } } : { menuServiceItemRenderer: { text: { simpleText: label }, icon: { iconType: icon }, serviceEndpoint: command } });
      function stamp(data) {
        fixture.data = data; popup.replaceChildren();
        const records = sheet ? data.content.listViewModel.listItems : data.items;
        const parent = sheet ? document.createElement('yt-list-view-model') : popup;
        if (sheet) { parent.style.display = 'block'; popup.append(parent); }
        for (const item of records) {
          const download = Boolean(item.downloadListItemViewModel || item.menuServiceItemDownloadRenderer);
          const model = item.listItemViewModel || item.menuServiceItemRenderer || item.menuServiceItemDownloadRenderer || item.downloadListItemViewModel;
          const label = download ? 'Download' : sheet ? model.title.content : model.text.simpleText;
          const row = document.createElement(sheet ? 'yt-list-item-view-model' : download ? 'ytd-menu-service-item-download-renderer' : 'ytd-menu-service-item-renderer');
          const host = sheet && download ? document.createElement('yt-download-list-item-view-model') : row;
          if (host !== row) { host.style.display = 'block'; host.append(row); }
          row.style.cssText = 'display:block;padding:8px 16px'; row.tabIndex = 0;
          const target = sheet ? document.createElement('button') : row;
          target.setAttribute('role', 'menuitem'); target.textContent = label;
          if (sheet) { row.setAttribute('role', 'presentation'); target.type = 'button'; row.append(target); }
          if (sheet) { if (model.targetId) row.setAttribute('data-target-id', model.targetId); }
          else row.polymerController = { data: model };
          target.addEventListener('click', () => { fixture.calls.push(label); dropdown.close(); });
          parent.append(host);
        }
      }
      if (sheet) {
        popup.componentProps = { data: () => fixture.data };
        popup.setters = { data: stamp };
        Object.defineProperty(popup, 'data', { get: () => Symbol('opaque'), set: stamp });
      } else popup.polymerController = { set: (_path, data) => stamp(data), get data() { return fixture.data; } };
      trigger.addEventListener('click', () => {
        stamp(eventless ? fixture.cachedData : sheet ? { content: { listViewModel: { listItems: items } } } : { items });
        dropdown.hidden = false;
        if (!eventless) popup.dispatchEvent(new CustomEvent('yt-popup-opened', { bubbles: true }));
      });
      if (eventless) {
        // Seed the native cached model once, as YouTube does on an earlier open.
        // Later trusted opens reuse the injected Play next model without an event.
        stamp(sheet ? { content: { listViewModel: { listItems: items } } } : { items });
        popup.dispatchEvent(new CustomEvent('yt-popup-opened', { bubbles: true }));
        fixture.cachedData = fixture.data;
      }
    }, { sheet, eventless });
    await page.locator('#integration-trigger').click();
    await page.locator('[data-ytms-video-menu="1"]').waitFor();
    // The Suite's automatic theatre-mode helper also invokes this native button.
    // Its synthetic click must not dismiss the user's separate video menu.
    await page.evaluate(() => document.querySelector('.ytp-size-button').click());
    assert.equal(await page.getByRole('menuitem', { name: 'Play next in queue', exact: true }).count(), 1);
    assert.equal(await page.getByRole('menuitem', { name: 'Play next in queue', exact: true }).isVisible(), true);
    assert.equal(await page.getByRole('menuitem', { name: 'Download', exact: true }).isVisible(), false);
    await page.getByRole('menuitem', { name: 'Channel tools', exact: true }).click();
    assert.equal(await page.getByRole('menuitem', { name: 'Report', exact: true }).isVisible(), true);
    assert.deepEqual(await page.evaluate(() => menuIntegration.calls), []);
    await page.getByRole('menuitem', { name: 'Filter channel uploads', exact: true }).click();
    await page.locator('#ytms-age-dialog').waitFor();
    assert.equal(await page.locator('#ytms-settings-dialog').isVisible(), true);
    assert.equal(await page.locator('#ytms-tab-channels').getAttribute('aria-selected'), 'true');
    assert.equal(await page.locator('#ytms-age-dialog').evaluate(node => node.localName), 'section');
    assert.equal(await page.locator('dialog[open]').count(), 1, 'Only the main settings modal is open');
    assert.equal(await page.getByLabel('Channel ID or channel URL', { exact: true }).inputValue(), 'UCabcdefghijklmnopqrstuv');
    assert.equal(await page.getByLabel('Channel name', { exact: true }).inputValue(), 'Daily news');
    assert.equal(await page.evaluate(() => localStorage.getItem('yt-master-suite.channel-age.v1')), null);
    assert.deepEqual(await page.evaluate(() => menuIntegration.calls), []);
    await page.locator('#ytms-age-cancel').click();
    assert.equal(await page.locator('#ytms-settings-dialog').isVisible(), false, 'Context-menu Cancel dismisses its settings window');
    await page.locator('#integration-trigger').click();
    await page.locator('[data-ytms-video-menu="1"]').waitFor();
    assert.equal(await page.getByRole('menuitem', { name: 'Play next in queue', exact: true }).count(), 1);
    await page.getByRole('menuitem', { name: 'Add to queue', exact: true }).click();
    assert.deepEqual(await page.evaluate(() => menuIntegration.calls), ['Add to queue']);
    for (const [tag, parentTag] of [['ytd-playlist-video-renderer', 'ytd-playlist-video-list-renderer'],
      ['ytd-playlist-panel-video-renderer', 'ytd-playlist-panel-renderer']]) {
      await page.evaluate(({ tag, parentTag }) => {
        const previous = document.getElementById('integration-card');
        const row = document.createElement(tag); row.id = previous.id; row.style.cssText = previous.style.cssText;
        row.componentProps = previous.componentProps;
        row.append(...previous.childNodes);
        const parent = document.createElement(parentTag); parent.style.display = 'block';
        previous.replaceWith(parent); parent.append(row);
      }, { tag, parentTag });
      await page.locator('#integration-trigger').click();
      await page.locator('[data-ytms-video-menu="1"]').waitFor();
      await page.getByRole('menuitem', { name: 'Channel tools', exact: true }).click();
      await page.getByRole('menuitem', { name: 'Filter channel uploads', exact: true }).click();
      await page.locator('#ytms-age-dialog').waitFor();
      assert.equal(await page.getByLabel('Channel ID or channel URL', { exact: true }).inputValue(), 'UCabcdefghijklmnopqrstuv', tag);
      await page.locator('#ytms-age-cancel').click();
      assert.deepEqual(await page.evaluate(() => menuIntegration.calls), ['Add to queue']);
      assert.equal(await page.evaluate(() => localStorage.getItem('yt-master-suite.channel-age.v1')), null);
    }
    const unrelatedRule = { channelId: 'UCABCDEFGHIJKLMNOPQRSTUV', name: 'Other channel',
      maxAge: 2, unit: 'months', enabled: true, blocked: false };
    await page.evaluate(rule => {
      document.dispatchEvent(new CustomEvent('yt-navigate-start', { bubbles: true }));
      history.pushState({}, '', '/');
      const browse = document.createElement('ytd-browse');
      const grid = document.createElement('ytd-rich-grid-renderer');
      const contents = document.createElement('div'); contents.id = 'contents'; contents.className = 'ytd-rich-grid-renderer';
      grid.append(contents); browse.append(grid); document.body.append(browse);
      const previous = document.getElementById('integration-card');
      const card = document.createElement('yt-lockup-view-model');
      card.id = previous.id; card.style.cssText = previous.style.cssText;
      card.componentProps = previous.componentProps;
      card.append(...previous.childNodes);
      const date = document.createElement('div'); date.textContent = '2 weeks ago'; card.append(date);
      const thumbnail = document.createElement('img'); thumbnail.alt = 'Native thumbnail'; card.prepend(thumbnail);
      previous.remove(); contents.append(card);
      menuIntegration.originalCardNodes = [...card.childNodes];
      menuIntegration.originalVideo = document.querySelector('#movie_player video');
      localStorage.setItem('yt-master-suite.channel-age.v1', JSON.stringify({ version: 1, rules: [rule] }));
      window.dispatchEvent(new CustomEvent('yt-master-channel-age-changed'));
      document.dispatchEvent(new CustomEvent('yt-navigate-finish', { bubbles: true }));
    }, unrelatedRule);
    await page.locator('#integration-trigger').click();
    await page.locator('[data-ytms-video-menu="1"]').waitFor();
    await page.getByRole('menuitem', { name: 'Channel tools', exact: true }).click();
    assert.deepEqual(await page.getByRole('menuitem').allTextContents(),
      ['Back', 'Filter channel uploads', 'Don’t recommend channel', 'Report']);
    await page.getByRole('menuitem', { name: 'Filter channel uploads', exact: true }).click();
    await page.locator('#ytms-age-dialog').waitFor();
    await page.locator('.ytms-age-fields:visible').getByLabel('Maximum age', { exact: true }).fill('0');
    await page.locator('#ytms-age-save').click();
    assert.equal(await page.locator('#ytms-settings-dialog').isVisible(), true, 'Validation failure keeps the contextual editor open');
    assert.equal(await page.locator('.ytms-age-fields:visible').getByLabel('Maximum age', { exact: true }).inputValue(), '0');
    assert.deepEqual(await page.evaluate(() => JSON.parse(localStorage.getItem('yt-master-suite.channel-age.v1')).rules), [unrelatedRule]);
    await page.locator('.ytms-age-fields:visible').getByLabel('Maximum age', { exact: true }).fill('1');
    await page.locator('#ytms-age-save').click();
    await page.locator('#ytms-age-dialog').waitFor({ state: 'hidden' });
    assert.equal(await page.locator('#ytms-settings-dialog').isVisible(), false, 'Successful contextual Save closes the main settings window');
    const confirmation = page.locator('#integration-card > .ytms-channel-filter-confirmation');
    await confirmation.waitFor();
    assert.match(await confirmation.textContent(), /Hide uploads older than 1 week\./);
    assert.deepEqual(await page.evaluate(() => menuIntegration.calls), ['Add to queue']);
    assert.equal(await page.evaluate(() => menuIntegration.originalCardNodes.every(node =>
      node.parentElement === document.getElementById('integration-card')) &&
      document.querySelector('#movie_player video') === menuIntegration.originalVideo), true);
    assert.equal(await page.locator('#integration-card img').isVisible(), false);
    await confirmation.getByRole('button', { name: 'Undo', exact: true }).click();
    await confirmation.waitFor({ state: 'detached' });
    await page.locator('#integration-trigger').waitFor({ state: 'visible' });
    assert.deepEqual(await page.evaluate(() => JSON.parse(localStorage.getItem('yt-master-suite.channel-age.v1')).rules), [unrelatedRule]);
    assert.equal(await page.evaluate(() => menuIntegration.originalCardNodes.every(node =>
      node.parentElement === document.getElementById('integration-card')) &&
      document.querySelector('#movie_player video') === menuIntegration.originalVideo), true);
    assert.equal(await page.locator('#integration-card').getAttribute('data-ytms-channel-filter-confirmation'), null);
    assert.deepEqual(await page.evaluate(() => menuIntegration.calls), ['Add to queue']);
    assert.equal(await page.locator('html').getAttribute('data-yt-master-runtime-errors'), null);
  });
 }
}
