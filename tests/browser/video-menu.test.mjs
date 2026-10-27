import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { installVideoMenu } from '../../sources/video-menu.mjs';
import { launchFixtureBrowser } from './fixture-browser.mjs';

let browser;
before(async () => { browser = await launchFixtureBrowser(); }, { timeout: 30000 });
after(async () => { await browser?.close(); });
const HTML = `<!doctype html><html lang="en-GB"><head><meta charset="utf-8"><style>
  html{color-scheme:dark;font:14px Arial;background:#101010;color:#fff}ytd-video-renderer{display:block;padding:16px}
  tp-yt-iron-dropdown{display:block;position:fixed;right:10px;top:70px;max-width:calc(100vw - 20px);max-height:calc(100vh - 90px);overflow:auto;background:#272727;min-width:260px;z-index:3}
  ytd-menu-popup-renderer,yt-sheet-view-model,yt-list-view-model{display:block}
  ytd-menu-service-item-renderer,ytd-menu-service-item-download-renderer,yt-list-item-view-model,yt-download-list-item-view-model{display:block}
  ytd-menu-service-item-renderer,yt-list-item-view-model button{box-sizing:border-box;min-height:40px;padding:10px 16px;width:100%;text-align:left;border:0;background:transparent;color:inherit;cursor:pointer}
  ytd-menu-service-item-renderer:hover,ytd-menu-service-item-renderer:focus,yt-list-item-view-model button:hover,yt-list-item-view-model button:focus{background:rgb(65,65,65)}
  /* Native modern menu states are class-driven as well as pseudo-class-driven. */
  .ytListItemViewModelHovered,.ytListItemViewModelTappable.ytListItemViewModelTappableHover:hover{background-color:rgb(65,65,65)}
  .ytListItemViewModelKeyboardFocused:focus-within{background-color:rgb(65,65,65);outline:2px solid currentColor;outline-offset:-2px}
  [hidden]{display:none!important}
  </style></head><body><ytd-video-renderer id="card"><a href="/watch?v=bbbbbbbbbbb">Video</a><ytd-menu-renderer><button id="trigger" aria-label="Video actions">⋮</button></ytd-menu-renderer></ytd-video-renderer>
  <button id="outside">Outside</button><tp-yt-iron-dropdown hidden></tp-yt-iron-dropdown></body></html>`;
// Captured from the user's real desktop YouTube lockup menu trigger. This
// current wrapper has neither ytd-menu-renderer nor aria-haspopup.
const MODERN_CARD = `<yt-lockup-view-model id="card"><a href="/watch?v=bbbbbbbbbbb">Video</a>
  <div class="ytLockupMetadataViewModelMenuButton"><button-view-model class="ytSpecButtonViewModelHost">
  <button id="trigger" class="ytSpecButtonShapeNextHost ytSpecButtonShapeNextText ytSpecButtonShapeNextMono ytSpecButtonShapeNextSizeM ytSpecButtonShapeNextIconButton ytSpecButtonShapeNextEnableBackdropFilterExperiment ytSpecButtonShapeNextMainstageIconSize ytSpecButtonShapeNextMainstagePadding" title="" style="" aria-label="More actions" aria-disabled="false">
  <div aria-hidden="true" class="ytSpecButtonShapeNextIcon ytSpecButtonShapeNextElevatedContent"><span class="ytIconWrapperHost"><span class="yt-icon-shape ytSpecIconShapeHost"><div><svg viewBox="0 0 24 24" width="24" height="24"><path d="M12 4a2 2 0 100 4 2 2 0 000-4Zm0 6a2 2 0 100 4 2 2 0 000-4Zm0 6a2 2 0 100 4 2 2 0 000-4Z"></path></svg></div></span></span></div>
  <yt-touch-feedback-shape aria-hidden="true" class="ytSpecTouchFeedbackShapeHost ytSpecTouchFeedbackShapeTouchResponse"><div class="ytSpecTouchFeedbackShapeStroke"></div><div class="ytSpecTouchFeedbackShapeFill"></div></yt-touch-feedback-shape>
  </button></button-view-model></div></yt-lockup-view-model>`;

async function open(t, options = {}) {
  const context = await browser.newContext({ viewport: { width: options.narrow ? 320 : 1000, height: 720 }, serviceWorkers: 'block' });
  const fixtureHtml = options.modernTrigger ? HTML.replace(/<ytd-video-renderer id="card">[\s\S]*?<\/ytd-video-renderer>/, MODERN_CARD)
    .replace('</style>', 'yt-lockup-view-model{display:block;padding:16px}.ytLockupMetadataViewModelMenuButton button{display:flex;align-items:center;gap:12px;padding:6px}yt-touch-feedback-shape,.ytSpecTouchFeedbackShapeFill{display:block;width:24px;height:24px}</style>') : HTML;
  const fixtureUrl = `https://www.youtube.com${options.route || '/'}`;
  await context.route('**/*', route => route.request().url() === fixtureUrl
    ? route.fulfill({ contentType: 'text/html', body: fixtureHtml }) : route.abort());
  const page = await context.newPage();
  page.setDefaultTimeout(5000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  t.after(async () => { try { assert.deepEqual(errors, []); } finally { await context.close(); } });
  await page.goto(fixtureUrl);
  await page.evaluate(({ sheet, settings, missingChannel, wrongVideo, unknown, unsupported, ambiguous, delayed, eventless, delayMs, nativeContract, unknownWrapper, cardTag, containerTag, noQueue, nativeBinding, bindingFault, libraryActions, contentType, modelVideo, nativeAutofocus, presentationRows, lateNativeLayout, nativeHover }) => {
    let card = document.getElementById('card');
    if (cardTag) {
      const replacement = document.createElement(cardTag); replacement.id = card.id;
      replacement.style.cssText = 'display:block;padding:16px'; replacement.append(...card.childNodes);
      card.replaceWith(replacement); card = replacement;
    }
    if (containerTag) { const parent = document.createElement(containerTag); card.before(parent); parent.append(card); }
    if (contentType) card.componentProps = { data: () => ({ contentType, contentId: modelVideo || 'bbbbbbbbbbb' }) };
    const dropdown = document.querySelector('tp-yt-iron-dropdown');
    const popup = document.createElement(sheet ? 'yt-sheet-view-model' : 'ytd-menu-popup-renderer');
    dropdown.append(popup);
    popup.setAttribute('role', 'menu');
    const fixture = window.menuFixture = { nativeCalls: [], refits: 0, openedSettings: [], openedContexts: [], popup, dropdown, originals: [] };
    dropdown.refit = () => {
      fixture.refits++;
      if (fixture.nativeLayoutPending) {
        fixture.layoutRefits++;
        if (fixture.layoutRefits >= 2) {
          fixture.nativeLayoutPending = false;
          for (const row of fixture.originals) row.hidden = false;
        }
      }
    };
    dropdown.close = () => { dropdown.hidden = true; dropdown.dispatchEvent(new CustomEvent('iron-overlay-closed', { bubbles: true })); };
    const queue = { signalServiceEndpoint: { actions: [{ addToPlaylistCommand: {
      videoId: wrongVideo ? 'ccccccccccc' : 'bbbbbbbbbbb', videoIds: [wrongVideo ? 'ccccccccccc' : 'bbbbbbbbbbb'],
      listType: 'PLAYLIST_EDIT_LIST_TYPE_QUEUE',
    } }] } };
    const definitions = [
      ['playNext', 'Play next in queue', 'QUEUE_PLAY_NEXT'], ['addToQueue', 'Add to queue', 'ADD_TO_QUEUE_TAIL', queue],
      ['watchLater', 'Watch later', 'WATCH_LATER'], ['savePlaylist', 'Save to playlist', 'PLAYLIST_ADD'],
      ['download', 'Download', 'OFFLINE_DOWNLOAD'], ['share', 'Share', 'SHARE'],
      ['notInterested', 'Not interested', 'NOT_INTERESTED'], ['dontRecommend', 'Do not recommend', 'REMOVE', { feedbackEndpoint: { feedbackToken: 'fixture-channel-feedback' } }], ['report', 'Report', 'FLAG'],
    ];
    if (noQueue) definitions.splice(0, 2);
    if (libraryActions) {
      definitions.splice(definitions.findIndex(entry => entry[0] === 'notInterested'), 2,
        ['remove', 'Remove native item', 'REMOVE', { playlistEditEndpoint: { playlistId: 'fixture' } }],
        ['move', 'Move to top', 'VERTICAL_ALIGN_TOP', { playlistEditEndpoint: { playlistId: 'fixture' } }]);
      definitions.push(['hideRecord', 'Hide native record', 'HIDE', { feedbackEndpoint: { feedbackToken: 'fixture-library-feedback' } }]);
    }
    if (unknown) definitions.splice(3, 0, ['unrecognised', 'Unrecognised native action', 'SOMETHING_NEW']);
    if (ambiguous) definitions.push(['duplicateReport', 'Second report', 'FLAG']);
    if (unsupported) definitions.find(entry => entry[0] === 'addToQueue')[3] = {};
    const items = definitions.map(([id, label, icon, endpoint]) => {
      if (nativeContract && id === 'download') return sheet ? {
        [unknownWrapper ? 'futureDownloadListItemViewModel' : 'downloadListItemViewModel']: { rendererContext: {} },
      } : { menuServiceItemDownloadRenderer: { serviceEndpoint: { offlineVideoEndpoint: {} } } };
      if (nativeContract && id === 'savePlaylist') icon = 'BOOKMARK_BORDER';
      if (nativeContract && id === 'notInterested') icon = 'HIDE';
      return sheet ? { listItemViewModel: {
      title: { content: label }, leadingImage: { sources: [{ clientResource: { imageName: icon } }] },
      targetId: id === 'playNext' ? 'yt-master-play-next' : id,
      rendererContext: { commandContext: { onTap: { innertubeCommand: endpoint || {} } } },
    } } : { menuServiceItemRenderer: { text: { simpleText: label }, icon: { iconType: icon }, serviceEndpoint: endpoint || {} } };
    });
    if (bindingFault === 'unknown-model') items[0] = { futureMenuItemRenderer: { title: 'Unknown native action' } };
    if (nativeBinding) {
      const nativeItems = JSON.parse(JSON.stringify(items));
      if (bindingFault === 'mismatch') nativeItems[0].unrecognisedField = true;
      if (bindingFault === 'oversized') nativeItems[0].unrecognisedField = 'x'.repeat(16385);
      card.querySelector('ytd-menu-renderer').polymerController = { data: { items: nativeItems } };
    }
    let data;
    const stamp = () => {
      popup.replaceChildren();
      const parent = sheet ? document.createElement('yt-list-view-model') : popup;
      if (sheet) popup.append(parent);
      definitions.forEach(([id, label], index) => {
        const wrapped = nativeContract && sheet && id === 'download';
        const row = document.createElement(sheet ? 'yt-list-item-view-model' : nativeContract && id === 'download' ? 'ytd-menu-service-item-download-renderer' : 'ytd-menu-service-item-renderer');
        const host = wrapped ? document.createElement(unknownWrapper ? 'yt-future-download-list-item-view-model' : 'yt-download-list-item-view-model') : row;
        host.dataset.nativeId = id;
        if (wrapped) { host.append(row); row.setAttribute('role', 'presentation'); }
        let target = row;
        if (sheet) {
          Object.defineProperty(row, 'data', { get: () => Symbol('opaque') });
          target = document.createElement('button'); target.type = 'button'; row.append(target);
          if (nativeHover) {
            const layout = document.createElement('div');
            layout.className = 'ytListItemViewModelLayoutWrapper ytListItemViewModelTappable ytListItemViewModelTappableHover';
            row.append(layout); layout.append(target);
            layout.addEventListener('mouseover', event => {
              if (!event.hoverHandled) { layout.classList.add('ytListItemViewModelHovered'); event.hoverHandled = true; }
            });
            layout.addEventListener('mouseout', () => layout.classList.remove('ytListItemViewModelHovered'));
            row.addEventListener('focusin', () => row.classList.add('ytListItemViewModelKeyboardFocused'));
            row.addEventListener('focusout', () => row.classList.remove('ytListItemViewModelKeyboardFocused'));
          }
          if (presentationRows) { row.tabIndex = 0; row.setAttribute('role', 'presentation'); }
        } else row.polymerController = { data: items[index].menuServiceItemRenderer || items[index].menuServiceItemDownloadRenderer };
        target.setAttribute('role', 'menuitem'); target.tabIndex = 0; target.textContent = label;
        target.onclick = () => { fixture.nativeCalls.push(id); dropdown.close(); };
        if (lateNativeLayout) host.hidden = true;
        parent.append(host);
      });
      fixture.originals = [...parent.children];
      fixture.nativeLayoutPending = lateNativeLayout;
      fixture.layoutRefits = 0;
    };
    fixture.focusNative = id => {
      const row = popup.querySelector(`[data-native-id="${id}"]`);
      (row?.querySelector('button') || row)?.focus();
    };
    data = sheet ? { content: { listViewModel: { listItems: items } } } : { items };
    if (sheet) popup.componentProps = { data: () => data };
    else popup.polymerController = { data };
    fixture.open = () => {
      if (delayed || fixture.delayNext) { popup.replaceChildren(); setTimeout(stamp, delayMs); }
      else stamp();
      dropdown.hidden = false;
      if (nativeAutofocus) fixture.focusNative(nativeAutofocus);
      if (!eventless) popup.dispatchEvent(new CustomEvent('yt-popup-opened', { bubbles: true }));
    };
    fixture.items = items;
    document.getElementById('trigger').addEventListener('click', fixture.open);
    document.getElementById('trigger').addEventListener('keydown', event => {
      if (event.key === 'ArrowDown') { event.preventDefault(); fixture.open(); }
    });
    window.suite = { settings: { initial: settings || {} },
      channelAge: { channelFromCard: () => missingChannel ? null : ({ channelId: 'UCabcdefghijklmnopqrstuv', name: 'News channel' }) },
      openChannelAgeSettings: (channel, context) => {
        fixture.openedSettings.push(channel);
        fixture.openedContexts.push({ cardId: context?.card?.id, videoId: context?.videoId, connected: context?.card?.isConnected });
      },
    };
  }, { sheet: Boolean(options.sheet), settings: options.settings, missingChannel: Boolean(options.missingChannel),
    wrongVideo: Boolean(options.wrongVideo), unknown: Boolean(options.unknown), unsupported: Boolean(options.unsupported), ambiguous: Boolean(options.ambiguous), delayed: Boolean(options.delayed), eventless: Boolean(options.eventless), delayMs: options.delayMs || 180, nativeContract: Boolean(options.nativeContract), unknownWrapper: Boolean(options.unknownWrapper),
    cardTag: options.cardTag, containerTag: options.containerTag, noQueue: Boolean(options.noQueue), nativeBinding: Boolean(options.nativeBinding), bindingFault: options.bindingFault,
    libraryActions: Boolean(options.libraryActions), contentType: options.contentType, modelVideo: options.modelVideo,
    nativeAutofocus: options.nativeAutofocus, presentationRows: Boolean(options.presentationRows),
    lateNativeLayout: Boolean(options.lateNativeLayout), nativeHover: Boolean(options.nativeHover) });
  await page.addScriptTag({ content: `window.disposeVideoMenu = (${installVideoMenu.toString()})(window.suite);` });
  return page;
}

async function show(page) {
  await page.locator('#trigger').click();
  await page.locator('[data-ytms-video-menu="1"]').waitFor();
}

async function visibleIds(page) {
  return page.evaluate(() => [...menuFixture.popup.querySelectorAll('[data-native-id], [data-ytms-menu-action]')]
    .filter(row => row.getClientRects().length && getComputedStyle(row).display !== 'none')
    .map(row => row.dataset.nativeId || row.dataset.ytmsMenuAction));
}

test('compatibility distinguishes an unchecked page, a non-video menu and a recognised video menu', async t => {
  const page = await open(t, { sheet: true });
  assert.equal(await page.locator('html').getAttribute('data-ytms-video-menu-compatibility'), 'not-checked');
  await page.evaluate(() => menuFixture.open());
  assert.equal(await page.locator('html').getAttribute('data-ytms-video-menu-compatibility'), 'not-applicable');
  assert.equal(await page.locator('[data-ytms-video-menu]').count(), 0);
  await page.evaluate(() => menuFixture.dropdown.close());
  await show(page);
  assert.equal(await page.locator('html').getAttribute('data-ytms-video-menu-compatibility'), 'recognised');
  await page.evaluate(() => window.dispatchEvent(new Event('yt-navigate-start')));
  assert.equal(await page.locator('html').getAttribute('data-ytms-video-menu-compatibility'), 'not-checked');
});

test('compatibility waits only for an actual trusted menu attempt and reports no menu after its bounded deadline', async t => {
  const page = await open(t, { sheet: true });
  await page.evaluate(() => document.getElementById('trigger').removeEventListener('click', menuFixture.open));
  await page.locator('#trigger').click();
  assert.equal(await page.locator('html').getAttribute('data-ytms-video-menu-compatibility'), 'awaiting-menu');
  await page.waitForFunction(() => document.documentElement.getAttribute('data-ytms-video-menu-compatibility') === 'no-menu');
  assert.equal(await page.locator('[data-ytms-video-menu]').count(), 0);
  await page.evaluate(() => menuFixture.open());
  assert.equal(await page.locator('[data-ytms-video-menu]').count(), 0, 'A late native event must not restart an expired attempt');
  assert.equal(await page.locator('html').getAttribute('data-ytms-video-menu-compatibility'), 'unsupported');
});

test('a partially stamped menu reports loading then recognised without periodic polling', async t => {
  const page = await open(t, { sheet: true });
  await page.evaluate(() => {
    const button = document.getElementById('trigger');
    button.removeEventListener('click', menuFixture.open);
    button.addEventListener('click', () => {
      menuFixture.dropdown.hidden = false;
      menuFixture.popup.dispatchEvent(new CustomEvent('yt-popup-opened', { bubbles: true }));
    });
  });
  await page.locator('#trigger').click();
  await page.waitForFunction(() => document.documentElement.getAttribute('data-ytms-video-menu-compatibility') === 'loading-menu');
  assert.equal(await page.locator('[data-ytms-video-menu]').count(), 0);
  await page.evaluate(() => menuFixture.open());
  await page.locator('[data-ytms-video-menu="1"]').waitFor();
  assert.equal(await page.locator('html').getAttribute('data-ytms-video-menu-compatibility'), 'recognised');
});

test('a changed video-menu trigger wrapper reports unsupported rather than claiming the menu is not applicable', async t => {
  const page = await open(t, { sheet: true, modernTrigger: true });
  await page.evaluate(() => { document.querySelector('.ytLockupMetadataViewModelMenuButton').className = 'futureVideoMenuButton'; });
  await page.locator('#trigger').click();
  assert.equal(await page.locator('html').getAttribute('data-ytms-video-menu-compatibility'), 'unsupported');
  assert.equal(await page.locator('[data-ytms-menu-action]').count(), 0);
  assert.equal(await page.getByRole('menuitem', { name: 'Download', exact: true }).isVisible(), true);
});

for (const sheet of [false, true]) {
  test(`unsupported ${sheet ? 'current' : 'legacy'} menu models remain entirely native and report compatibility failure`, async t => {
    const page = await open(t, { sheet });
    await page.evaluate(sheet => {
      const native = sheet ? menuFixture.popup.componentProps.data() : menuFixture.popup.polymerController.data;
      const future = sheet ? { content: { futureListViewModel: native.content.listViewModel } } : { futureItems: native.items };
      if (sheet) menuFixture.popup.componentProps = { data: () => future };
      else menuFixture.popup.polymerController.data = future;
    }, sheet);
    await page.locator('#trigger').click();
    await page.waitForFunction(() => document.documentElement.getAttribute('data-ytms-video-menu-compatibility') === 'unsupported');
    assert.equal(await page.locator('[data-ytms-video-menu]').count(), 0);
    assert.equal(await page.locator('[data-ytms-menu-action]').count(), 0);
    assert.equal(await page.getByRole('menuitem', { name: 'Download', exact: true }).isVisible(), true);
    assert.deepEqual(await page.evaluate(() => menuFixture.nativeCalls), []);
    await page.getByRole('menuitem', { name: 'Share', exact: true }).click();
    assert.deepEqual(await page.evaluate(() => menuFixture.nativeCalls), ['share']);
  });

  test(`partly recognised ${sheet ? 'current' : 'legacy'} model wrappers fail open instead of decorating only the known actions`, async t => {
    const page = await open(t, { sheet, bindingFault: 'unknown-model' });
    await page.locator('#trigger').click();
    await page.waitForFunction(() => document.documentElement.getAttribute('data-ytms-video-menu-compatibility') === 'unsupported');
    assert.equal(await page.locator('[data-ytms-menu-action]').count(), 0);
    assert.equal(await page.getByRole('menuitem', { name: 'Download', exact: true }).isVisible(), true);
    assert.deepEqual(await page.evaluate(() => menuFixture.originals.map(row => row.style.display)), Array(9).fill(''));
    assert.deepEqual(await page.evaluate(() => menuFixture.nativeCalls), []);
  });

  test(`an unknown action within a recognised ${sheet ? 'current' : 'legacy'} layout retains its native handler`, async t => {
    const page = await open(t, { sheet, unknown: true });
    const before = await page.evaluate(() => JSON.stringify(menuFixture.items));
    await show(page);
    assert.equal(await page.locator('html').getAttribute('data-ytms-video-menu-compatibility'), 'recognised');
    assert.equal(await page.evaluate(() => JSON.stringify(menuFixture.items)), before);
    await page.getByRole('menuitem', { name: 'Unrecognised native action', exact: true }).click();
    assert.deepEqual(await page.evaluate(() => menuFixture.nativeCalls), ['unrecognised']);
  });
}

for (const [surface, cardTag, containerTag, route] of [
  ['History', 'yt-lockup-view-model', null, '/feed/history'],
  ['playlist videos', 'ytd-playlist-video-renderer', 'ytd-playlist-video-list-renderer', '/playlist?list=WL'],
  ['legacy queue rows', 'ytd-playlist-panel-video-renderer', 'ytd-playlist-panel-renderer', '/watch?v=aaaaaaaaaaa'],
  ['current queue rows', 'yt-playlist-panel-video-renderer', 'yt-playlist-panel-renderer', '/watch?v=aaaaaaaaaaa'],
  ['Search', 'ytd-video-renderer', null, '/results?search_query=fixture'],
  ['Subscriptions', 'yt-lockup-view-model', null, '/feed/subscriptions'],
  ['channel videos', 'ytd-grid-video-renderer', null, '/@fixture/videos'],
]) for (const sheet of [false, true]) {
  test(`channel tools are available on ${surface} without operating the native actions (${sheet ? 'current sheet' : 'legacy popup'})`, async t => {
    const page = await open(t, { cardTag, containerTag, route, sheet, nativeContract: true });
    await show(page);
    assert.equal(await page.getByRole('menuitem', { name: 'Download', exact: true }).isVisible(), false);
    await page.getByRole('menuitem', { name: 'Channel tools', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Filter channel uploads', exact: true }).click();
    assert.equal(await page.evaluate(() => menuFixture.openedSettings[0].channelId), 'UCabcdefghijklmnopqrstuv');
    assert.deepEqual(await page.evaluate(() => menuFixture.openedContexts[0]),
      { cardId: 'card', videoId: 'bbbbbbbbbbb', connected: true });
    assert.deepEqual(await page.evaluate(() => menuFixture.nativeCalls), []);
  });
}

for (const sheet of [false, true]) {
  test(`playlist removal and movement stay native and outside Channel tools (${sheet ? 'current sheet' : 'legacy popup'})`, async t => {
    const page = await open(t, { sheet, cardTag: 'ytd-playlist-video-renderer', containerTag: 'ytd-playlist-video-list-renderer',
      route: '/playlist?list=WL', libraryActions: true, settings: { menuShowNotInterested: false, menuShowDontRecommend: false } });
    await show(page);
    for (const name of ['Remove native item', 'Move to top', 'Hide native record']) assert.equal(await page.getByRole('menuitem', { name, exact: true }).isVisible(), true);
    await page.getByRole('menuitem', { name: 'Channel tools', exact: true }).click();
    for (const name of ['Remove native item', 'Move to top', 'Hide native record']) assert.equal(await page.getByRole('menuitem', { name, exact: true }).isVisible(), false);
    await page.getByRole('menuitem', { name: 'Back', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Remove native item', exact: true }).click();
    assert.deepEqual(await page.evaluate(() => menuFixture.nativeCalls), ['remove']);
  });
  test(`queue menus without Add to queue require an exact native model and retain removal (${sheet ? 'current sheet' : 'legacy popup'})`, async t => {
    const page = await open(t, { sheet, cardTag: 'ytd-playlist-panel-video-renderer', containerTag: 'ytd-playlist-panel-renderer',
      noQueue: true, nativeBinding: true, libraryActions: true });
    await show(page);
    assert.equal(await page.getByRole('menuitem', { name: 'Remove native item', exact: true }).isVisible(), true);
    await page.getByRole('menuitem', { name: 'Channel tools', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Filter channel uploads', exact: true }).click();
    assert.deepEqual(await page.evaluate(() => menuFixture.nativeCalls), []);
  });
}

for (const fault of ['mismatch', 'oversized', 'unknown-model']) {
  test(`menus without a queue action fail open for a ${fault} native model`, async t => {
    const page = await open(t, { cardTag: 'ytd-playlist-panel-video-renderer', containerTag: 'ytd-playlist-panel-renderer',
      noQueue: true, nativeBinding: true, bindingFault: fault, libraryActions: true });
    await page.locator('#trigger').click();
    await page.waitForFunction(() => ['no-queue-action', 'row-binding'].includes(document.documentElement.getAttribute('data-ytms-video-menu-status')));
    assert.equal(await page.locator('[data-ytms-menu-action]').count(), 0);
    assert.equal(await page.getByRole('menuitem', { name: 'Download', exact: true }).isVisible(), true);
    assert.deepEqual(await page.evaluate(() => menuFixture.nativeCalls), []);
  });
}

for (const [contentType, modelVideo] of [['LOCKUP_CONTENT_TYPE_PLAYLIST', null], ['LOCKUP_CONTENT_TYPE_VIDEO', 'ccccccccccc']]) {
  test(`a non-video or recycled mismatched lockup is not mistaken for a single-video menu (${contentType})`, async t => {
    const page = await open(t, { cardTag: 'yt-lockup-view-model', contentType, modelVideo });
    await page.locator('#trigger').click();
    assert.equal(await page.locator('html').getAttribute('data-ytms-video-menu-status'), 'card-identity');
    assert.equal(await page.locator('[data-ytms-menu-action]').count(), 0);
  });
}

for (const sheet of [false, true]) {
  test(`observed native Download host and BOOKMARK_BORDER/HIDE actions retain handlers and obey preferences (${sheet ? 'current sheet' : 'legacy popup'})`, async t => {
    const page = await open(t, { sheet, nativeContract: true, settings: {
      menuShowNotInterested: false, menuItemOrder: ['savePlaylist', 'playNext', 'addToQueue'],
    } });
    await show(page);
    assert.deepEqual(await visibleIds(page), ['savePlaylist', 'playNext', 'addToQueue', 'watchLater', 'share', 'channelTools']);
    if (sheet) {
      assert.equal(await page.locator('yt-download-list-item-view-model').evaluate(row => getComputedStyle(row).display), 'none');
      assert.equal(await page.locator('yt-download-list-item-view-model yt-list-item-view-model').count(), 1);
      assert.deepEqual(await page.evaluate(() => Object.keys(menuFixture.items[4].downloadListItemViewModel)), ['rendererContext']);
    }
    await page.getByRole('menuitem', { name: 'Save to playlist', exact: true }).click();
    assert.deepEqual(await page.evaluate(() => menuFixture.nativeCalls), ['savePlaylist']);
  });
}

test('observed Download wrapper keeps its original button handler when Download is enabled', async t => {
  const page = await open(t, { sheet: true, nativeContract: true, settings: { menuShowDownload: true } });
  await show(page);
  await page.getByRole('menuitem', { name: 'Download', exact: true }).click();
  assert.deepEqual(await page.evaluate(() => menuFixture.nativeCalls), ['download']);
});

test('unknown native wrapper types fail open rather than flattening or replacing their rows', async t => {
  const page = await open(t, { sheet: true, nativeContract: true, unknownWrapper: true });
  await page.locator('#trigger').click();
  await page.waitForFunction(() => document.documentElement.getAttribute('data-ytms-video-menu-status') === 'row-parent');
  assert.equal(await page.locator('[data-ytms-menu-action]').count(), 0);
  assert.equal(await page.getByRole('menuitem', { name: 'Download', exact: true }).isVisible(), true);
});

for (const [name, dark, modern, legacy, parent, expected] of [
  ['modern dark theme with no legacy token', true, '#f1f1f1', '', '#000000', 'rgb(241, 241, 241)'],
  ['modern light theme with no legacy token', false, '#0f0f0f', '', '#ffffff', 'rgb(15, 15, 15)'],
  ['legacy dark theme without the modern token', true, '', '#e6e6e6', '#000000', 'rgb(230, 230, 230)'],
  ['legacy light theme without the modern token', false, '', '#1f1f1f', '#ffffff', 'rgb(31, 31, 31)'],
  ['modern token takes precedence over a stale legacy token', true, '#f1f1f1', '#000000', '#000000', 'rgb(241, 241, 241)'],
  ['both tokens absent preserve inherited theme colour', false, '', '', '#224466', 'rgb(34, 68, 102)'],
]) {
  test(`custom menu text and SVG use the native colour in ${name}`, async t => {
    const page = await open(t, { sheet: true, nativeContract: true });
    await page.evaluate(({ dark, modern, legacy, parent }) => {
      const root = document.documentElement;
      root.toggleAttribute('dark', dark);
      root.style.colorScheme = dark ? 'dark' : 'light';
      if (modern) root.style.setProperty('--yt-sys-color-baseline--text-primary', modern);
      if (legacy) root.style.setProperty('--yt-spec-text-primary', legacy);
      menuFixture.popup.style.color = parent;
    }, { dark, modern, legacy, parent });
    await show(page);
    const actual = await page.getByRole('menuitem', { name: 'Channel tools', exact: true }).evaluate(button => ({
      text: getComputedStyle(button).color,
      icon: getComputedStyle(button.querySelector('svg')).fill,
    }));
    assert.deepEqual(actual, { text: expected, icon: expected });
  });
}

test('current sheet custom labels share the native 52px text column and 40px row height', async t => {
  const page = await open(t, { sheet: true, nativeContract: true });
  await show(page);
  const group = page.getByRole('menuitem', { name: 'Channel tools', exact: true });
  const geometry = await group.evaluate(button => {
    const row = button.getBoundingClientRect();
    const label = button.querySelector('span').getBoundingClientRect();
    return { left: label.left - row.left, height: row.height, lineHeight: getComputedStyle(button).lineHeight };
  });
  assert.deepEqual(geometry, { left: 52, height: 40, lineHeight: '20px' });
  await group.click();
  for (const name of ['Back', 'Filter channel uploads']) {
    const offset = await page.getByRole('menuitem', { name, exact: true }).evaluate(button =>
      button.querySelector('span').getBoundingClientRect().left - button.getBoundingClientRect().left);
    assert.equal(offset, 52, name);
  }
});

test('legacy popup custom labels share its measured native 52px text column and 36px row height', async t => {
  const page = await open(t);
  await show(page);
  const geometry = await page.getByRole('menuitem', { name: 'Channel tools', exact: true }).evaluate(button => ({
    left: button.querySelector('span').getBoundingClientRect().left - button.getBoundingClientRect().left,
    height: button.getBoundingClientRect().height,
    lineHeight: getComputedStyle(button).lineHeight,
  }));
  assert.deepEqual(geometry, { left: 52, height: 36, lineHeight: '20px' });
});

test('legacy popup receives one settled native refit rather than retaining an intermediate tiny size', async t => {
  const page = await open(t);
  await page.evaluate(() => {
    let settled = false;
    menuFixture.dropdown.refit = () => {
      menuFixture.refits++;
      menuFixture.popup.style.maxHeight = settled ? '' : '56px';
      menuFixture.popup.style.maxWidth = settled ? '' : '157px';
      if (!settled) requestAnimationFrame(() => { settled = true; });
    };
  });
  await show(page);
  await page.waitForFunction(() => menuFixture.refits === 2 && menuFixture.popup.style.maxHeight === '' && menuFixture.popup.style.maxWidth === '');
});

test('disposing an open submenu cancels the pending settled refit', async t => {
  const page = await open(t);
  await show(page);
  await page.evaluate(() => {
    const frames = new Map(); let next = 0;
    window.refitFrames = frames;
    window.requestAnimationFrame = callback => { frames.set(++next, callback); return next; };
    window.cancelAnimationFrame = id => frames.delete(id);
  });
  await page.getByRole('menuitem', { name: 'Channel tools', exact: true }).click();
  assert.equal(await page.evaluate(() => refitFrames.size), 1);
  await page.evaluate(() => disposeVideoMenu());
  assert.equal(await page.evaluate(() => refitFrames.size), 0);
});

for (const sheet of [false, true]) {
  for (const [target, selector] of [['button', '#trigger'], ['SVG path', '#trigger svg path'], ['touch feedback', '#trigger .ytSpecTouchFeedbackShapeFill']]) {
    test(`real lockup More actions wrapper accepts ${target} activation (${sheet ? 'current sheet' : 'legacy popup'})`, async t => {
      const page = await open(t, { sheet, modernTrigger: true });
      await page.locator(selector).click();
      await page.locator('[data-ytms-video-menu="1"]').waitFor();
      assert.equal(await page.locator('html').getAttribute('data-ytms-video-menu-status'), 'ready');
      assert.deepEqual(await visibleIds(page), ['playNext', 'addToQueue', 'watchLater', 'savePlaylist', 'share', 'notInterested', 'channelTools']);
      await page.getByRole('menuitem', { name: 'Channel tools', exact: true }).click();
      await page.getByRole('menuitem', { name: 'Filter channel uploads', exact: true }).click();
      assert.equal(await page.evaluate(() => menuFixture.openedSettings.length), 1);
      assert.deepEqual(await page.evaluate(() => menuFixture.nativeCalls), []);
    });
  }
}

test('other buttons inside modern cards do not gain menu permissions from a generic button wrapper or English label', async t => {
  const page = await open(t, { sheet: true, modernTrigger: true });
  await page.locator('.ytLockupMetadataViewModelMenuButton').evaluate(element => element.className = 'unrecognised-card-button');
  await page.locator('#trigger').click();
  await page.waitForTimeout(80);
  assert.equal(await page.locator('html').getAttribute('data-ytms-video-menu-status'), 'unsupported-trigger');
  assert.equal(await page.locator('[data-ytms-menu-action]').count(), 0);
  assert.equal(await page.getByRole('menuitem', { name: 'Download', exact: true }).isVisible(), true);
});

for (const sheet of [false, true]) {
  const design = sheet ? 'modern' : 'legacy';
  test(`${design}: hides Download by default, groups channel actions at the bottom and preserves native nodes and handlers`, async t => {
    const page = await open(t, { sheet });
    await show(page);
    assert.deepEqual(await visibleIds(page), ['playNext', 'addToQueue', 'watchLater', 'savePlaylist', 'share', 'notInterested', 'channelTools']);
    assert.equal(await page.evaluate(() => menuFixture.nativeCalls.length), 0);
    await page.getByRole('menuitem', { name: 'Channel tools', exact: true }).click();
    assert.deepEqual(await visibleIds(page), ['back', 'channelAge', 'dontRecommend', 'report']);
    assert.equal(await page.evaluate(() => menuFixture.originals.every(row => row.isConnected)), true);
    await page.getByRole('menuitem', { name: 'Report', exact: true }).click();
    assert.deepEqual(await page.evaluate(() => menuFixture.nativeCalls), ['report']);
    assert.equal(await page.locator('[data-ytms-menu-action]').count(), 0);
  });

  test(`${design}: flat mode, individual visibility and ordered actions preserve unknown native action slots`, async t => {
    const page = await open(t, { sheet, unknown: true, settings: {
      menuGroupChannelTools: false, menuShowDownload: true, menuShowNotInterested: false, menuShowReport: false,
      menuItemOrder: ['share', 'playNext', 'addToQueue', 'watchLater', 'savePlaylist', 'download', 'notInterested', 'dontRecommend', 'report', 'channelAge', 'channelTools'],
    } });
    await show(page);
    assert.deepEqual(await visibleIds(page), ['share', 'playNext', 'addToQueue', 'unrecognised', 'watchLater', 'savePlaylist', 'download', 'dontRecommend', 'channelAge']);
    await page.getByRole('menuitem', { name: 'Filter channel uploads', exact: true }).click();
    assert.deepEqual(await page.evaluate(() => menuFixture.openedSettings), [{ channelId: 'UCabcdefghijklmnopqrstuv', name: 'News channel' }]);
    assert.deepEqual(await page.evaluate(() => menuFixture.nativeCalls), []);
  });

  test(`${design}: explicitly rearranged channel actions retain their saved submenu order`, async t => {
    const page = await open(t, { sheet, settings: { menuItemOrder: ['report', 'dontRecommend', 'channelAge'] } });
    await show(page);
    await page.getByRole('menuitem', { name: 'Channel tools', exact: true }).click();
    assert.deepEqual(await visibleIds(page), ['back', 'report', 'dontRecommend', 'channelAge']);
    await page.keyboard.press('Home');
    await page.keyboard.press('ArrowDown');
    assert.equal(await page.evaluate(() => document.activeElement.closest('[data-native-id]').dataset.nativeId), 'report');
    assert.deepEqual(await page.evaluate(() => menuFixture.nativeCalls), []);
  });
}

test('submenu supports Right/Left, Escape, arrow focus, Home and End without activating native moderation actions', async t => {
  const page = await open(t, { sheet: true });
  await show(page);
  const group = page.getByRole('menuitem', { name: 'Channel tools', exact: true });
  await page.getByRole('menuitem', { name: 'Play next in queue', exact: true }).focus();
  await page.keyboard.press('End');
  assert.equal(await page.evaluate(() => document.activeElement.dataset.ytmsMenuAction), 'channelTools');
  await group.press('ArrowRight');
  assert.equal(await page.evaluate(() => document.activeElement.dataset.ytmsMenuAction), 'back');
  await page.keyboard.press('ArrowDown');
  assert.equal(await page.evaluate(() => document.activeElement.dataset.ytmsMenuAction), 'channelAge');
  await page.keyboard.press('ArrowDown');
  assert.equal(await page.evaluate(() => document.activeElement.closest('[data-native-id]').dataset.nativeId), 'dontRecommend');
  await page.keyboard.press('End');
  assert.equal(await page.evaluate(() => document.activeElement.closest('[data-native-id]').dataset.nativeId), 'report');
  await page.keyboard.press('Home');
  assert.equal(await page.evaluate(() => document.activeElement.dataset.ytmsMenuAction), 'back');
  await page.keyboard.press('ArrowLeft');
  assert.equal(await page.evaluate(() => document.activeElement.dataset.ytmsMenuAction), 'channelTools');
  await group.press('Enter'); await page.keyboard.press('Escape');
  assert.equal(await page.evaluate(() => document.activeElement.dataset.ytmsMenuAction), 'channelTools');
  assert.deepEqual(await page.evaluate(() => menuFixture.nativeCalls), []);
});

for (const sheet of [false, true]) {
  const design = sheet ? 'modern' : 'legacy';
  test(`${design}: pointer opening clears the native Add to queue autofocus without focusing a row`, async t => {
    const page = await open(t, { sheet, nativeAutofocus: 'addToQueue' });
    await show(page);
    assert.equal(await page.evaluate(() => document.activeElement === menuFixture.popup), true);
    assert.equal(await page.locator('[role="menuitem"]:focus-visible').count(), 0);
    const nativeQueue = page.getByRole('menuitem', { name: 'Add to queue', exact: true });
    assert.equal(await nativeQueue.evaluate(row => getComputedStyle(row).backgroundColor), 'rgba(0, 0, 0, 0)');
    await nativeQueue.hover();
    assert.equal(await nativeQueue.evaluate(row => getComputedStyle(row).backgroundColor), 'rgb(65, 65, 65)');
    assert.equal(await page.evaluate(() => document.activeElement === menuFixture.popup), true,
      'Pointer hovering must remain visual and must not claim keyboard focus');
    await page.mouse.move(0, 0);
    await page.evaluate(() => menuFixture.focusNative('addToQueue'));
    assert.equal(await page.evaluate(() => document.activeElement === menuFixture.popup), true,
      'A late native autofocus must not highlight Add to queue after pointer opening');
    await page.keyboard.press('ArrowDown');
    assert.equal(await page.evaluate(() => document.activeElement.closest('[data-native-id]')?.dataset.nativeId), 'playNext');
    assert.equal(await page.locator('[role="menuitem"]:focus-visible').count(), 1);
    await page.getByRole('menuitem', { name: 'Share', exact: true }).hover();
    assert.equal(await page.evaluate(() => document.activeElement === menuFixture.popup), true,
      'Moving back to pointer input must clear the previous keyboard row selection');
    assert.equal(await page.locator('[role="menuitem"]:focus-visible').count(), 0);
    assert.deepEqual(await page.evaluate(() => menuFixture.nativeCalls), []);
  });

  for (const key of ['Enter', 'Space', 'ArrowDown']) {
    test(`${design}: ${key} opening focuses the first visible action rather than the native queue row`, async t => {
      const page = await open(t, { sheet, nativeAutofocus: 'addToQueue', settings: { menuItemOrder: ['download', 'share'] } });
      await page.locator('#trigger').focus();
      await page.keyboard.press(key);
      await page.locator('[data-ytms-video-menu="1"]').waitFor();
      assert.equal(await page.evaluate(() => document.activeElement.closest('[data-native-id]')?.dataset.nativeId), 'share');
      assert.equal(await page.locator('[role="menuitem"]:focus-visible').count(), 1);
      await page.evaluate(() => menuFixture.focusNative('addToQueue'));
      assert.equal(await page.evaluate(() => document.activeElement.closest('[data-native-id]')?.dataset.nativeId), 'share',
        'Late native autofocus must not replace the keyboard opening selection');
      assert.deepEqual(await page.evaluate(() => menuFixture.nativeCalls), []);
    });
  }

  test(`${design}: moving from a keyboard-open menu to the pointer clears focus and executes the clicked native action once`, async t => {
    const page = await open(t, { sheet, nativeAutofocus: 'addToQueue' });
    await page.locator('#trigger').focus();
    await page.keyboard.press('ArrowDown');
    await page.locator('[data-ytms-video-menu="1"]').waitFor();
    assert.equal(await page.evaluate(() => document.activeElement.closest('[data-native-id]')?.dataset.nativeId), 'playNext');
    const share = page.getByRole('menuitem', { name: 'Share', exact: true });
    await share.hover();
    assert.equal(await page.evaluate(() => document.activeElement === menuFixture.popup), true);
    assert.equal(await page.locator('[role="menuitem"]:focus-visible').count(), 0);
    await share.click();
    assert.deepEqual(await page.evaluate(() => menuFixture.nativeCalls), ['share']);
    assert.equal(await page.locator('[data-ytms-menu-action]').count(), 0);
  });

  test(`${design}: keyboard opening selects the first native action after its initial layout settles`, async t => {
    const page = await open(t, { sheet, lateNativeLayout: true });
    for (let attempt = 0; attempt < 2; attempt++) {
      await page.locator('#trigger').focus();
      await page.keyboard.press('ArrowDown');
      await page.locator('[data-ytms-video-menu="1"]').waitFor();
      await page.waitForFunction(() => menuFixture.layoutRefits >= 2 &&
        menuFixture.originals.every(row => !row.hidden));
      assert.equal(await page.evaluate(() => document.activeElement.closest('[data-native-id]')?.dataset.nativeId), 'playNext');
      assert.equal(await page.locator('[role="menuitem"]:focus-visible').count(), 1);
      assert.deepEqual(await page.evaluate(() => menuFixture.nativeCalls), []);
      await page.evaluate(() => menuFixture.dropdown.close());
    }
  });

  test(`${design}: ArrowUp from the neutral popup starts at the last row and ArrowDown wraps to the first`, async t => {
    const page = await open(t, { sheet });
    await show(page);
    // Give the old implementation a focusable container too, so this specifically
    // catches its -1 index arithmetic rather than the opening-focus behaviour.
    await page.evaluate(() => { menuFixture.popup.tabIndex = -1; menuFixture.popup.focus(); });
    await page.keyboard.press('ArrowUp');
    assert.equal(await page.evaluate(() => document.activeElement.dataset.ytmsMenuAction), 'channelTools');
    await page.keyboard.press('ArrowDown');
    assert.equal(await page.evaluate(() => document.activeElement.closest('[data-native-id]')?.dataset.nativeId), 'playNext');
  });

  for (const key of ['Enter', 'Space']) {
    test(`${design}: neutral ${key} selects the first action without executing a stale native default`, async t => {
      const page = await open(t, { sheet, nativeAutofocus: 'addToQueue' });
      await show(page);
      await page.evaluate(() => menuFixture.popup.addEventListener('keydown', event => {
        if (event.target === menuFixture.popup && ['Enter', ' '].includes(event.key)) {
          menuFixture.nativeCalls.push('stale-native-default');
        }
      }));
      await page.keyboard.press(key);
      assert.equal(await page.evaluate(() => document.activeElement.closest('[data-native-id]')?.dataset.nativeId), 'playNext');
      assert.deepEqual(await page.evaluate(() => menuFixture.nativeCalls), []);
      if (sheet) {
        await page.keyboard.press(key);
        assert.deepEqual(await page.evaluate(() => menuFixture.nativeCalls), ['playNext']);
      }
    });
  }

  test(`${design}: keyboard navigation skips native hidden, inert and unfocusable action rows`, async t => {
    const page = await open(t, { sheet });
    await show(page);
    await page.evaluate(sheet => {
      const row = id => menuFixture.popup.querySelector(`[data-native-id="${id}"]`);
      row('playNext').hidden = true;
      row('addToQueue').setAttribute('aria-hidden', 'true');
      row('watchLater').style.visibility = 'hidden';
      row('savePlaylist').inert = true;
      if (sheet) row('share').querySelector('button').disabled = true;
      else { row('share').removeAttribute('tabindex'); row('share').setAttribute('role', 'presentation'); }
      menuFixture.popup.tabIndex = -1; menuFixture.popup.focus();
    }, sheet);
    await page.keyboard.press('ArrowDown');
    assert.equal(await page.evaluate(() => document.activeElement.closest('[data-native-id]')?.dataset.nativeId), 'notInterested');
    await page.keyboard.press('ArrowDown');
    assert.equal(await page.evaluate(() => document.activeElement.dataset.ytmsMenuAction), 'channelTools');
    await page.keyboard.press('ArrowDown');
    assert.equal(await page.evaluate(() => document.activeElement.closest('[data-native-id]')?.dataset.nativeId), 'notInterested');
    await page.keyboard.press('ArrowUp');
    assert.equal(await page.evaluate(() => document.activeElement.dataset.ytmsMenuAction), 'channelTools');
    assert.deepEqual(await page.evaluate(() => menuFixture.nativeCalls), []);
  });

  test(`${design}: pointer submenu transitions stay neutral while keyboard transitions retain visible focus`, async t => {
    const page = await open(t, { sheet });
    await show(page);
    await page.getByRole('menuitem', { name: 'Channel tools', exact: true }).click();
    assert.equal(await page.evaluate(() => document.activeElement === menuFixture.popup), true);
    assert.equal(await page.locator('[role="menuitem"]:focus-visible').count(), 0);
    await page.getByRole('menuitem', { name: 'Back', exact: true }).click();
    assert.equal(await page.evaluate(() => document.activeElement === menuFixture.popup), true);
    await page.keyboard.press('End');
    await page.keyboard.press('Enter');
    assert.equal(await page.evaluate(() => document.activeElement.dataset.ytmsMenuAction), 'back');
    assert.equal(await page.locator('[data-ytms-menu-action="back"]:focus-visible').count(), 1);
    await page.keyboard.press('Escape');
    assert.equal(await page.evaluate(() => document.activeElement.dataset.ytmsMenuAction), 'channelTools');
    assert.equal(await page.locator('[data-ytms-menu-action="channelTools"]:focus-visible').count(), 1);
    assert.deepEqual(await page.evaluate(() => menuFixture.nativeCalls), []);
  });

  test(`${design}: close, reuse and disposal restore native popup tabindex and remove focus ownership`, async t => {
    const page = await open(t, { sheet });
    for (const original of [null, '4']) {
      await page.evaluate(value => {
        if (value === null) menuFixture.popup.removeAttribute('tabindex');
        else menuFixture.popup.setAttribute('tabindex', value);
      }, original);
      await show(page);
      assert.equal(await page.evaluate(() => document.activeElement === menuFixture.popup), true);
      await page.evaluate(() => menuFixture.dropdown.close());
      assert.equal(await page.evaluate(() => menuFixture.popup.getAttribute('tabindex')), original);
      assert.equal(await page.locator('[data-ytms-menu-action]').count(), 0);
    }
    await show(page);
    await page.evaluate(() => disposeVideoMenu());
    assert.equal(await page.evaluate(() => menuFixture.popup.getAttribute('tabindex')), '4');
    await page.evaluate(() => menuFixture.focusNative('addToQueue'));
    assert.equal(await page.evaluate(() => document.activeElement.closest('[data-native-id]')?.dataset.nativeId), 'addToQueue',
      'Disposal must release the popup focusin guard');
  });
}

test('modern native hover: stale Add to queue styling does not compete with the actually hovered action', async t => {
  const page = await open(t, { sheet: true, nativeHover: true, nativeAutofocus: 'addToQueue' });
  await show(page);
  const queueLayout = page.locator('[data-native-id="addToQueue"] .ytListItemViewModelLayoutWrapper');
  const interestedLayout = page.locator('[data-native-id="notInterested"] .ytListItemViewModelLayoutWrapper');
  await page.getByRole('menuitem', { name: 'Not interested', exact: true }).hover();
  // Row movement can retain this native mouseover class without actual hover.
  // Do not remove its class or alter the native action/ARIA to correct styling.
  await queueLayout.evaluate(layout => layout.classList.add('ytListItemViewModelHovered'));
  assert.equal(await queueLayout.evaluate(layout => layout.matches(':hover')), false);
  assert.equal(await queueLayout.evaluate(layout => getComputedStyle(layout).backgroundColor), 'rgba(0, 0, 0, 0)');
  assert.equal(await interestedLayout.evaluate(layout => getComputedStyle(layout).backgroundColor), 'rgb(65, 65, 65)');
  assert.equal(await page.evaluate(() => document.activeElement === menuFixture.popup), true);
  assert.equal(await queueLayout.evaluate(layout => layout.classList.contains('ytListItemViewModelHovered')), true);
  await page.mouse.move(0, 0);
  assert.equal(await interestedLayout.evaluate(layout => getComputedStyle(layout).backgroundColor), 'rgba(0, 0, 0, 0)');
  assert.equal(await queueLayout.evaluate(layout => getComputedStyle(layout).backgroundColor), 'rgba(0, 0, 0, 0)');
  await page.getByRole('menuitem', { name: 'Not interested', exact: true }).click();
  assert.deepEqual(await page.evaluate(() => menuFixture.nativeCalls), ['notInterested']);
});

test('modern native hover: descendant keyboard focus retains native row styling while stale unfocused rows stay neutral', async t => {
  const page = await open(t, { sheet: true, nativeHover: true });
  await show(page);
  await page.mouse.move(0, 0);
  const queueLayout = page.locator('[data-native-id="addToQueue"] .ytListItemViewModelLayoutWrapper');
  await queueLayout.evaluate(layout => layout.classList.add('ytListItemViewModelHovered'));
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  assert.equal(await page.evaluate(() => document.activeElement.closest('[data-native-id]')?.dataset.nativeId), 'addToQueue');
  assert.equal(await queueLayout.evaluate(layout => layout.matches(':hover')), false);
  assert.equal(await queueLayout.evaluate(layout => layout.matches(':focus-within')), true);
  assert.equal(await queueLayout.evaluate(layout => getComputedStyle(layout).backgroundColor), 'rgb(65, 65, 65)');
  assert.equal(await page.getByRole('menuitem', { name: 'Add to queue', exact: true }).evaluate(button => button.matches(':focus-visible')), true);
  await page.keyboard.press('ArrowDown');
  assert.equal(await page.evaluate(() => document.activeElement.closest('[data-native-id]')?.dataset.nativeId), 'watchLater');
  assert.equal(await queueLayout.evaluate(layout => getComputedStyle(layout).backgroundColor), 'rgba(0, 0, 0, 0)');
  assert.equal(await page.locator('[data-native-id="watchLater"]').evaluate(row => getComputedStyle(row).backgroundColor), 'rgb(65, 65, 65)');
  assert.deepEqual(await page.evaluate(() => menuFixture.nativeCalls), []);
});

test('modern native hover: channel tools and Back keep real hover without restoring stale main-menu backgrounds', async t => {
  const page = await open(t, { sheet: true, nativeHover: true });
  await show(page);
  const queueLayout = page.locator('[data-native-id="addToQueue"] .ytListItemViewModelLayoutWrapper');
  await queueLayout.evaluate(layout => layout.classList.add('ytListItemViewModelHovered'));
  await page.getByRole('menuitem', { name: 'Channel tools', exact: true }).click();
  const dontRecommendLayout = page.locator('[data-native-id="dontRecommend"] .ytListItemViewModelLayoutWrapper');
  await page.getByRole('menuitem', { name: 'Report', exact: true }).hover();
  await dontRecommendLayout.evaluate(layout => layout.classList.add('ytListItemViewModelHovered'));
  assert.equal(await dontRecommendLayout.evaluate(layout => getComputedStyle(layout).backgroundColor), 'rgba(0, 0, 0, 0)');
  assert.equal(await page.locator('[data-native-id="report"] .ytListItemViewModelLayoutWrapper').evaluate(layout => getComputedStyle(layout).backgroundColor), 'rgb(65, 65, 65)');
  await page.getByRole('menuitem', { name: 'Back', exact: true }).click();
  assert.equal(await queueLayout.evaluate(layout => getComputedStyle(layout).backgroundColor), 'rgba(0, 0, 0, 0)');
  assert.equal(await queueLayout.evaluate(layout => layout.classList.contains('ytListItemViewModelHovered')), true);
  assert.equal(await page.evaluate(() => document.activeElement === menuFixture.popup), true);
  assert.deepEqual(await page.evaluate(() => menuFixture.nativeCalls), []);
});

test('modern native hover: normalisation is scoped to managed menus and released on close or disposal', async t => {
  const page = await open(t, { sheet: true, nativeHover: true });
  await show(page);
  await page.mouse.move(0, 0);
  const queueLayout = page.locator('yt-sheet-view-model[data-ytms-video-menu="1"] [data-native-id="addToQueue"] .ytListItemViewModelLayoutWrapper');
  await queueLayout.evaluate(layout => {
    layout.classList.add('ytListItemViewModelHovered');
    const unmanaged = document.createElement('yt-sheet-view-model');
    unmanaged.id = 'unmanaged-menu';
    unmanaged.style.cssText = 'position:fixed;left:10px;top:600px';
    unmanaged.append(layout.closest('[data-native-id]').cloneNode(true));
    document.body.append(unmanaged);
  });
  assert.equal(await queueLayout.evaluate(layout => getComputedStyle(layout).backgroundColor), 'rgba(0, 0, 0, 0)');
  assert.equal(await page.locator('#unmanaged-menu .ytListItemViewModelLayoutWrapper').evaluate(layout => getComputedStyle(layout).backgroundColor), 'rgb(65, 65, 65)');
  await page.evaluate(() => menuFixture.dropdown.close());
  assert.equal(await page.evaluate(() => menuFixture.popup.hasAttribute('data-ytms-video-menu')), false);
  assert.equal(await page.evaluate(() => getComputedStyle(menuFixture.popup.querySelector('[data-native-id="addToQueue"] .ytListItemViewModelLayoutWrapper')).backgroundColor), 'rgb(65, 65, 65)');
  await show(page);
  await page.mouse.move(0, 0);
  await queueLayout.evaluate(layout => layout.classList.add('ytListItemViewModelHovered'));
  assert.equal(await queueLayout.evaluate(layout => getComputedStyle(layout).backgroundColor), 'rgba(0, 0, 0, 0)');
  await page.evaluate(() => disposeVideoMenu());
  assert.equal(await page.evaluate(() => menuFixture.popup.hasAttribute('data-ytms-video-menu')), false);
  assert.equal(await page.evaluate(() => getComputedStyle(menuFixture.popup.querySelector('[data-native-id="addToQueue"] .ytListItemViewModelLayoutWrapper')).backgroundColor), 'rgb(65, 65, 65)');
  await page.locator('yt-sheet-view-model:not(#unmanaged-menu)').getByRole('menuitem', { name: 'Add to queue', exact: true }).click();
  assert.deepEqual(await page.evaluate(() => menuFixture.nativeCalls), ['addToQueue']);
});

test('modern presentation wrappers do not receive keyboard focus instead of their native button', async t => {
  const page = await open(t, { sheet: true, presentationRows: true });
  await show(page);
  await page.evaluate(() => { menuFixture.popup.tabIndex = -1; menuFixture.popup.focus(); });
  await page.keyboard.press('ArrowDown');
  assert.deepEqual(await page.evaluate(() => ({ tag: document.activeElement.localName,
    id: document.activeElement.closest('[data-native-id]')?.dataset.nativeId })), { tag: 'button', id: 'playNext' });
});

test('aria-disabled explanatory channel actions remain keyboard discoverable but cannot activate', async t => {
  const page = await open(t, { sheet: true, missingChannel: true, settings: { menuGroupChannelTools: false } });
  await show(page);
  await page.keyboard.press('End');
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('ArrowUp');
  assert.equal(await page.evaluate(() => document.activeElement.dataset.ytmsMenuAction), 'channelAge');
  assert.match(await page.evaluate(() => document.activeElement.textContent), /Channel ID unavailable/);
  await page.keyboard.press('Enter');
  await page.keyboard.press('Space');
  assert.deepEqual(await page.evaluate(() => menuFixture.openedSettings), []);
  assert.deepEqual(await page.evaluate(() => menuFixture.nativeCalls), []);
});

for (const key of ['Enter', 'Space']) test(`modern native ${key} activation still executes the original action exactly once`, async t => {
  const page = await open(t, { sheet: true, settings: { menuItemOrder: ['share'] } });
  await show(page);
  await page.keyboard.press('ArrowDown');
  assert.equal(await page.evaluate(() => document.activeElement.closest('[data-native-id]')?.dataset.nativeId), 'share');
  await page.keyboard.press(key);
  assert.deepEqual(await page.evaluate(() => menuFixture.nativeCalls), ['share']);
  assert.equal(await page.locator('[data-ytms-menu-action]').count(), 0);
});

test('missing stable channel ID disables only the age action and explains manual settings', async t => {
  const page = await open(t, { missingChannel: true, settings: { menuGroupChannelTools: false } });
  await show(page);
  const age = page.getByRole('menuitem', { name: /Filter channel uploads/ });
  assert.equal(await age.getAttribute('aria-disabled'), 'true');
  await age.click({ force: true });
  assert.deepEqual(await page.evaluate(() => menuFixture.openedSettings), []);
  assert.match(await age.textContent(), /add it manually in Channels settings/);
});

test('all optional channel entries can be hidden without leaving an empty submenu', async t => {
  const page = await open(t, { settings: { menuShowAgeLimit: false, menuShowDontRecommend: false, menuShowReport: false } });
  await show(page);
  assert.deepEqual(await visibleIds(page), ['playNext', 'addToQueue', 'watchLater', 'savePlaylist', 'share', 'notInterested']);
  assert.equal(await page.getByRole('menuitem', { name: 'Channel tools' }).count(), 0);
});

test('wrong-card endpoints, missing queue commands, duplicated recognised actions and synthetic triggers fail open', async t => {
  for (const [options, reason] of [[{ wrongVideo: true }, 'queue-target-mismatch'], [{ unsupported: true }, 'no-queue-action'], [{ ambiguous: true }, 'duplicate-actions'], [{}, 'missing-trigger']]) {
    const page = await open(t, options);
    if (Object.keys(options).length) await page.locator('#trigger').click();
    else await page.evaluate(() => document.getElementById('trigger').click());
    await page.waitForTimeout(100);
    assert.equal(await page.locator('[data-ytms-video-menu]').count(), 0);
    assert.equal(await page.locator('html').getAttribute('data-ytms-video-menu-status'), reason);
    assert.equal(await page.getByRole('menuitem', { name: 'Download', exact: true }).isVisible(), true);
  }
});

test('outside dismissal, navigation and disposal restore original rows, styling and ordering without polling', async t => {
  const page = await open(t, { settings: { menuItemOrder: ['share', 'download', 'report'] } });
  for (const action of ['outside', 'navigate', 'dispose']) {
    await show(page);
    await page.getByRole('menuitem', { name: 'Channel tools', exact: true }).click();
    if (action === 'outside') await page.locator('#outside').click();
    else await page.evaluate(action => action === 'navigate' ? window.dispatchEvent(new Event('yt-navigate-start')) : disposeVideoMenu(), action);
    assert.equal(await page.locator('[data-ytms-menu-action]').count(), 0);
    assert.equal(await page.evaluate(() => menuFixture.originals.every(row => row.style.display === '' || row.style.display === 'block')), true);
    assert.deepEqual(await page.evaluate(() => [...menuFixture.originals[0].parentElement.children].map(row => row.dataset.nativeId)),
      ['playNext', 'addToQueue', 'watchLater', 'savePlaylist', 'download', 'share', 'notInterested', 'dontRecommend', 'report']);
  }
});

test('submenu remains within a narrow viewport and asks the native dropdown to refit', async t => {
  const page = await open(t, { sheet: true, narrow: true });
  await show(page);
  await page.getByRole('menuitem', { name: 'Channel tools', exact: true }).click();
  const bounds = await page.locator('tp-yt-iron-dropdown').boundingBox();
  assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= 320);
  assert.ok(await page.evaluate(() => menuFixture.refits >= 2));
});

test('late native row stamping and popup reuse get one set of controls without modifying source models', async t => {
  const page = await open(t, { sheet: true, delayed: true });
  for (let index = 0; index < 3; index++) {
    await show(page);
    assert.equal(await page.locator('[data-ytms-menu-action="channelTools"]').count(), 1);
    assert.deepEqual(await visibleIds(page), ['playNext', 'addToQueue', 'watchLater', 'savePlaylist', 'share', 'notInterested', 'channelTools']);
    assert.equal(await page.evaluate(() => menuFixture.items.length), 9);
    await page.evaluate(() => menuFixture.dropdown.close());
    assert.equal(await page.locator('[data-ytms-menu-action]').count(), 0);
  }
});

test('dismissal before delayed stamping cancels the bounded observer and cannot decorate a closed menu', async t => {
  const page = await open(t, { delayed: true });
  await page.locator('#trigger').click();
  await page.evaluate(() => menuFixture.dropdown.close());
  await page.waitForTimeout(250);
  assert.equal(await page.locator('[data-ytms-video-menu]').count(), 0);
  assert.equal(await page.locator('[data-ytms-menu-action]').count(), 0);
});

test('cached modern popup is discovered from a trusted trigger without a repeated popup-opened event, including delayed stamps', async t => {
  const page = await open(t, { sheet: true, modernTrigger: true, eventless: true, delayed: true });
  for (let index = 0; index < 2; index++) {
    await show(page);
    assert.equal(await page.getByRole('menuitem', { name: 'Download', exact: true }).isVisible(), false);
    assert.equal(await page.getByRole('menuitem', { name: 'Channel tools', exact: true }).isVisible(), true);
    await page.evaluate(() => menuFixture.dropdown.close());
  }
});

test('automatic synthetic clicks outside an open menu do not remove its controls or restore hidden actions', async t => {
  const page = await open(t);
  await show(page);
  await page.evaluate(() => document.getElementById('outside').click());
  assert.equal(await page.getByRole('menuitem', { name: 'Download', exact: true }).isVisible(), false);
  assert.equal(await page.getByRole('menuitem', { name: 'Channel tools', exact: true }).isVisible(), true);
  await page.locator('#outside').click();
  assert.equal(await page.locator('[data-ytms-menu-action]').count(), 0);
});

async function addCachedPopup(page, mode) {
  await page.evaluate(mode => {
    menuFixture.open();
    menuFixture.dropdown.hidden = true;
    const dropdown = document.createElement('tp-yt-iron-dropdown');
    dropdown.style.cssText = 'display:block!important;position:fixed;left:350px;top:70px;width:280px;background:#272727';
    const clone = menuFixture.popup.cloneNode(true);
    clone.setAttribute('data-cloned-popup', '1');
    const data = structuredClone(menuFixture.popup.componentProps.data());
    if (mode === 'wrong') {
      const action = data.content.listViewModel.listItems[1].listItemViewModel.rendererContext.commandContext.onTap.innertubeCommand.signalServiceEndpoint.actions[0].addToPlaylistCommand;
      action.videoId = 'ccccccccccc'; action.videoIds = ['ccccccccccc'];
    }
    clone.componentProps = { data: () => data };
    dropdown.append(clone); document.body.append(dropdown);
    if (mode === 'hidden') dropdown.hidden = true;
    if (mode === 'aria-hidden') dropdown.setAttribute('aria-hidden', 'true');
  }, mode);
}

test('eventless discovery ignores explicitly hidden and wrong-video cached sheets without altering them', async t => {
  for (const mode of ['hidden', 'aria-hidden', 'wrong']) {
    const page = await open(t, { sheet: true, modernTrigger: true, eventless: true });
    await addCachedPopup(page, mode);
    await show(page);
    assert.equal(await page.locator('[data-cloned-popup]').getAttribute('data-ytms-video-menu'), null);
    assert.equal(await page.locator('[data-ytms-video-menu="1"]').count(), 1);
  }
});

test('eventless discovery fails open when two visible native sheets match the selected video', async t => {
  const page = await open(t, { sheet: true, modernTrigger: true, eventless: true });
  await addCachedPopup(page, 'matching');
  await page.locator('#trigger').click();
  await page.waitForFunction(() => document.documentElement.getAttribute('data-ytms-video-menu-status') === 'ambiguous-popup');
  assert.equal(await page.locator('[data-ytms-video-menu]').count(), 0);
  assert.deepEqual(await page.evaluate(() => menuFixture.nativeCalls), []);
});

test('pending eventless discovery cancels on outside click, new trigger, navigation, pagehide and disposal before delayed stamping', async t => {
  for (const action of ['outside', 'new-trigger', 'navigation', 'pagehide', 'dispose']) {
    const page = await open(t, { sheet: true, modernTrigger: true, eventless: true, delayed: true });
    await page.locator('#trigger').click();
    if (action === 'outside') await page.locator('#outside').click();
    else if (action === 'new-trigger') {
      await page.evaluate(() => {
        const card = document.getElementById('card').cloneNode(true);
        card.id = 'other-card'; card.querySelector('a').href = '/watch?v=ccccccccccc';
        card.querySelector('#trigger').id = 'other-trigger'; document.body.append(card);
      });
      await page.locator('#other-trigger').click();
    }
    else await page.evaluate(action => action === 'dispose' ? disposeVideoMenu() :
      window.dispatchEvent(new Event(action === 'navigation' ? 'yt-navigate-start' : 'pagehide')), action);
    await page.waitForTimeout(250);
    assert.equal(await page.locator('[data-ytms-video-menu]').count(), 0);
    assert.equal(await page.locator('[data-ytms-menu-action]').count(), 0);
  }
});

test('eventless popup observation expires before stamps arriving after its bounded deadline', async t => {
  const page = await open(t, { sheet: true, modernTrigger: true, eventless: true, delayed: true, delayMs: 1700 });
  await page.locator('#trigger').click();
  await page.waitForTimeout(1850);
  assert.equal(await page.locator('[data-ytms-video-menu]').count(), 0);
  assert.equal(await page.locator('[data-ytms-menu-action]').count(), 0);
});

test('closing an unrelated old sheet inside the shared popup container does not cancel the newly selected menu', async t => {
  const page = await open(t, { sheet: true, modernTrigger: true, eventless: true });
  await addCachedPopup(page, 'wrong');
  await page.evaluate(() => {
    const container = document.createElement('ytd-popup-container'); document.body.append(container);
    const old = document.querySelector('[data-cloned-popup]').closest('tp-yt-iron-dropdown');
    container.append(old, menuFixture.dropdown);
    menuFixture.delayNext = true;
    document.getElementById('trigger').addEventListener('click', () => setTimeout(() => {
      old.hidden = true;
      old.dispatchEvent(new CustomEvent('iron-overlay-closed', { bubbles: true }));
    }, 60));
  });
  await show(page);
  assert.equal(await page.getByRole('menuitem', { name: 'Channel tools', exact: true }).isVisible(), true);
  assert.equal(await page.locator('[data-cloned-popup]').getAttribute('data-ytms-video-menu'), null);
});

test('expired trusted activation cannot restart discovery when a late native popup-opened event arrives', async t => {
  const page = await open(t, { sheet: true, modernTrigger: true, eventless: true, delayed: true, delayMs: 1700 });
  await page.locator('#trigger').click();
  await page.waitForTimeout(1850);
  await page.evaluate(() => menuFixture.popup.dispatchEvent(new CustomEvent('yt-popup-opened', { bubbles: true })));
  await page.waitForTimeout(120);
  assert.equal(await page.locator('[data-ytms-video-menu]').count(), 0);
  assert.equal(await page.locator('[data-ytms-menu-action]').count(), 0);
});
