import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { after, before, test } from 'node:test';
import { launchFixtureBrowser } from './fixture-browser.mjs';

const SOURCE = readFileSync(new URL('../../sources/modules/youtube-player-preferences-lite.user.js', import.meta.url), 'utf8');
const HTML = `<!doctype html><html lang="en-GB"><head><style>
  ytd-app,ytd-browse,ytd-rich-grid-renderer,ytd-rich-item-renderer,ytd-rich-grid-media,yt-lockup-view-model,
  ytd-playlist-panel-renderer,ytd-miniplayer,ytd-popup-container {display:block}
  ytd-rich-item-renderer,yt-lockup-view-model {min-height:60px}
</style></head><body><ytd-app><ytd-browse><ytd-rich-grid-renderer><div id="contents"></div></ytd-rich-grid-renderer></ytd-browse></ytd-app></body></html>`;
let browser;
before(async () => { browser = await launchFixtureBrowser(); }, { timeout: 30000 });
after(async () => { await browser?.close(); }, { timeout: 10000 });

async function settle(page) {
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(resolve)))));
}

async function open(t, { live = true, upcoming = true, route = '/' } = {}) {
  const context = await browser.newContext({ viewport: { width: 1200, height: 900 }, serviceWorkers: 'block' });
  const url = `https://www.youtube.com${route}`;
  await context.route('**/*', request => request.request().url() === url
    ? request.fulfill({ contentType: 'text/html', body: HTML }) : request.abort());
  const page = await context.newPage(); page.setDefaultTimeout(6000);
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  t.after(async () => { try { assert.deepEqual(errors, []); } finally { await context.close(); } });
  await page.goto(url);
  const source = SOURCE.replace('hideLiveVideos: false', `hideLiveVideos: ${live}`)
    .replace('hideUpcomingStreams: true', `hideUpcomingStreams: ${upcoming}`)
    .replace('  const STYLE_ID =', '  window.streamConfig = CONFIG;\n  const STYLE_ID =');
  await page.addScriptTag({ content: source });
  await page.evaluate(() => {
    window.streamFixture = {
      add(id, { current = false, model = null, overlay = '', badge = '', badgeClass = 'ytBadgeShapeBadgeText',
        title = 'Ordinary video', date = '2 hours ago', notify = false, surface = '' } = {}) {
        const card = document.createElement(current ? 'yt-lockup-view-model' : 'ytd-rich-item-renderer');
        card.id = id;
        const media = current ? card : document.createElement('ytd-rich-grid-media');
        const heading = document.createElement('h3'); heading.id = 'video-title'; heading.textContent = title;
        const anchor = document.createElement('a'); anchor.href = '/watch?v=aaaaaaaaaaa'; anchor.append(heading);
        const metadata = document.createElement('div'); metadata.id = 'metadata-line';
        const time = document.createElement('span'); time.textContent = date; metadata.append(time);
        media.append(anchor, metadata);
        if (overlay) {
          const overlayNode = document.createElement('ytd-thumbnail-overlay-time-status-renderer');
          overlayNode.setAttribute('overlay-style', overlay); media.append(overlayNode);
        }
        if (badge) { const label = document.createElement('span'); label.className = badgeClass; label.textContent = badge; media.append(label); }
        if (notify) { const button = document.createElement('button'); button.textContent = 'Notify me'; media.append(button); }
        if (model) {
          if (current) {
            card.componentProps = { data: () => model };
            Object.defineProperty(card, 'data', { get: () => Symbol('opaque') });
          } else media.polymerController = { data: model };
        }
        if (!current) card.append(media);
        if (surface) {
          const parent = document.createElement(surface); parent.append(card); document.querySelector('#contents').append(parent);
        } else document.querySelector('#contents').append(card);
      },
      notify() { window.dispatchEvent(new Event('yt-page-data-updated')); },
    };
  });
  return page;
}

async function marker(page, id, state = '') {
  await page.waitForFunction(({ id, state }) => {
    const card = document.getElementById(id);
    return card && (card.getAttribute('data-ytppl-live-hidden') === '1') === (state === 'live') &&
      (card.getAttribute('data-ytppl-upcoming-hidden') === '1') === (state === 'upcoming');
  }, { id, state });
  if (!state) await settle(page);
  assert.equal(await page.locator(`#${id}`).isVisible(), !state, id);
}

test('live filtering is opt-in while the existing upcoming default remains enabled', async t => {
  assert.match(SOURCE, /hideLiveVideos: false/);
  const page = await open(t, { live: false });
  await page.evaluate(() => {
    streamFixture.add('live', { overlay: 'LIVE' });
    streamFixture.add('upcoming', { overlay: 'UPCOMING' });
  });
  await marker(page, 'upcoming', 'upcoming');
  await marker(page, 'live');
});

for (const [name, options] of [
  ['legacy LIVE overlay', { overlay: 'LIVE' }],
  ['current camel-case badge', { current: true, badge: 'LIVE' }],
  ['current hyphenated badge', { current: true, badge: 'Live now', badgeClass: 'yt-badge-shape__text' }],
  ['legacy live model', { model: { isLiveNow: true } }],
  ['legacy native badge model', { model: { badges: [{ metadataBadgeRenderer: { style: 'BADGE_STYLE_TYPE_LIVE_NOW' } }] } }],
  ['legacy nested model', { model: { content: { videoRenderer: { isLiveNow: true } } } }],
  ['current component model', { current: true, model: { isLiveNow: true } }],
  ['current thumbnail model', { current: true, model: { contentImage: { thumbnailViewModel: { overlays: [{
    thumbnailOverlayBadgeViewModel: { thumbnailBadges: [{ thumbnailBadgeViewModel: { text: 'LIVE', badgeStyle: 'THUMBNAIL_BADGE_STYLE_LIVE' } }] },
  }] } } } }],
]) {
  test(`Hide live videos recognises ${name}`, async t => {
    const page = await open(t);
    await page.evaluate(options => streamFixture.add('target', options), options);
    await marker(page, 'target', 'live');
  });
}

for (const [name, options] of [
  ['native upcoming overlay', { overlay: 'UPCOMING' }],
  ['native upcoming badge', { current: true, badge: 'Upcoming' }],
  ['scheduled date', { date: 'Scheduled for 25 Oct 2026, 18:00' }],
  ['premiere date', { date: 'Premieres in 2 hours' }],
  ['waiting card with Notify me', { date: '42 waiting', notify: true }],
  ['legacy upcoming event', { model: { upcomingEventData: { startTime: '1792951200' } } }],
  ['current upcoming metadata', { current: true, model: { metadata: { lockupMetadataViewModel: { metadata: {
    contentMetadataViewModel: { metadataRows: [{ metadataParts: [{ text: { content: 'Scheduled for 25 Oct 2026, 18:00' } }] }] },
  } } } } }],
]) {
  test(`upcoming filtering recognises ${name}`, async t => {
    const page = await open(t);
    await page.evaluate(options => streamFixture.add('target', options), options);
    await marker(page, 'target', 'upcoming');
  });
}

test('live and upcoming settings are independent', async t => {
  const page = await open(t, { upcoming: false });
  await page.evaluate(() => {
    streamFixture.add('live', { overlay: 'LIVE' });
    streamFixture.add('upcoming', { overlay: 'UPCOMING' });
  });
  await marker(page, 'live', 'live');
  await marker(page, 'upcoming');
});

test('title keywords, completed archives and stale LIVE badges cannot hide ordinary videos', async t => {
  const page = await open(t);
  await page.evaluate(() => {
    streamFixture.add('title-live', { title: 'LIVE at Wembley' });
    streamFixture.add('title-scheduled', { title: 'Scheduled for disaster' });
    streamFixture.add('title-premiere', { current: true, title: 'Premieres in a new theatre' });
    streamFixture.add('archive', { date: 'Streamed 2 hours ago', model: { isLiveContent: true, isLive: true } });
    streamFixture.add('premiered', { date: 'Premiered 2 days ago' });
    streamFixture.add('recycled-overlay', { overlay: 'LIVE', date: 'Streamed 2 hours ago' });
    streamFixture.add('recycled-model', { model: { isLiveNow: true, publishedTimeText: { simpleText: 'Streamed 2 hours ago' } } });
    streamFixture.add('conflicting', { overlay: 'LIVE', badge: 'Upcoming' });
  });
  await settle(page);
  for (const id of ['title-live', 'title-scheduled', 'title-premiere', 'archive', 'premiered', 'recycled-overlay', 'recycled-model', 'conflicting']) await marker(page, id);
});

for (const archived of ['Streamed 2 hours ago', 'Premiered 2 days ago']) {
  for (const nested of [true, false]) {
    test(`modern ${nested ? 'lockup' : 'direct'} metadata marks ${archived} as an archive despite stale live state`, async t => {
      const page = await open(t);
      await page.evaluate(({ archived, nested }) => {
        const contentMetadataViewModel = { metadataRows: [{ metadataParts: [{ text: { content: archived } }] }] };
        streamFixture.add('modern-archive', { current: true, date: '', model: { isLiveNow: true,
          metadata: nested ? { lockupMetadataViewModel: { metadata: { contentMetadataViewModel } } } : { contentMetadataViewModel } } });
      }, { archived, nested });
      await settle(page); await marker(page, 'modern-archive');
    });
  }
}

test('native LIVE→UPCOMING→archive recycling clears the previous marker without extra events', async t => {
  const page = await open(t);
  await page.evaluate(() => streamFixture.add('target', { overlay: 'LIVE' }));
  await marker(page, 'target', 'live');
  await page.evaluate(() => document.querySelector('#target [overlay-style]').setAttribute('overlay-style', 'UPCOMING'));
  await marker(page, 'target', 'upcoming');
  await page.evaluate(() => {
    document.querySelector('#target #metadata-line span').textContent = 'Streamed 2 hours ago';
    document.querySelector('#target [overlay-style]').remove();
  });
  await marker(page, 'target');
});

test('disabling either filter clears its own old markers and preserves the other filter', async t => {
  const page = await open(t);
  await page.evaluate(() => {
    streamFixture.add('live', { overlay: 'LIVE' });
    streamFixture.add('upcoming', { overlay: 'UPCOMING' });
  });
  await marker(page, 'live', 'live');
  await marker(page, 'upcoming', 'upcoming');
  await page.evaluate(() => { streamConfig.hideLiveVideos = false; streamFixture.notify(); });
  await marker(page, 'live');
  await marker(page, 'upcoming', 'upcoming');
  await page.evaluate(() => { streamConfig.hideUpcomingStreams = false; streamFixture.notify(); });
  await marker(page, 'upcoming');
});

for (const route of ['/feed/history', '/playlist?list=PLfixture', '/watch?v=aaaaaaaaaaa']) {
  test(`stream filters leave ${route} unchanged`, async t => {
    const page = await open(t, { route });
    await page.evaluate(() => {
      streamFixture.add('live', { current: true, overlay: 'LIVE' });
      streamFixture.add('upcoming', { current: true, overlay: 'UPCOMING' });
    });
    await settle(page);
    await marker(page, 'live');
    await marker(page, 'upcoming');
  });
}

for (const surface of ['ytd-playlist-panel-renderer', 'ytd-miniplayer', 'ytd-popup-container', 'ytd-playlist-video-list-renderer']) {
  test(`stream filters leave ${surface} contents unchanged`, async t => {
    const page = await open(t);
    await page.evaluate(surface => {
      streamFixture.add('live', { current: true, overlay: 'LIVE', surface });
      streamFixture.add('upcoming', { current: true, overlay: 'UPCOMING', surface });
    }, surface);
    await settle(page);
    await marker(page, 'live');
    await marker(page, 'upcoming');
  });
}

test('unavailable models and malformed thumbnail records fail open without breaking native badges', async t => {
  const page = await open(t);
  await page.evaluate(() => {
    streamFixture.add('broken-model', { current: true, overlay: 'LIVE' });
    document.getElementById('broken-model').componentProps = { data() { throw new Error('Fixture private model unavailable'); } };
    streamFixture.add('malformed', { current: true, model: { contentImage: { thumbnailViewModel: { overlays: [{
      thumbnailOverlayBadgeViewModel: { thumbnailBadges: { invalid: true } },
    }] } } } });
  });
  await marker(page, 'broken-model', 'live');
  await marker(page, 'malformed');
});

test('temporary reveal shows live cards without changing the saved filter configuration', async t => {
  const page = await open(t);
  await page.evaluate(() => streamFixture.add('target', { overlay: 'LIVE' }));
  await marker(page, 'target', 'live');
  await page.evaluate(() => document.documentElement.setAttribute('data-yt-master-show-filtered', '1'));
  assert.equal(await page.locator('#target').isVisible(), true);
  assert.equal(await page.evaluate(() => streamConfig.hideLiveVideos), true);
  await page.evaluate(() => document.documentElement.removeAttribute('data-yt-master-show-filtered'));
  assert.equal(await page.locator('#target').isVisible(), false);
});
