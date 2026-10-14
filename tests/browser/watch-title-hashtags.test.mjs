import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { after, before, test } from "node:test";
import { launchFixtureBrowser, waitForSuiteHealth } from "./fixture-browser.mjs";

const SUITE = readFileSync(new URL("../../youtube-master-suite.user.js", import.meta.url), "utf8");
const MANIFEST = JSON.parse(readFileSync(new URL("../../release-manifest.json", import.meta.url), "utf8"));
const BASE = readFileSync(new URL("./watch-page.html", import.meta.url), "utf8");
const WATCH_URL = "https://www.youtube.com/watch?v=aaaaaaaaaaa&list=fixture-queue";
const KEY = 'yt-master-suite.settings.v1';
const TITLE_SETUP = `<script>
  // Model native retained title-run bindings, including a non-hashtag prefix in
  // an anchor whose endpoint happens to be /hashtag/. Do not rebuild title DOM
  // on queue advancement: a removed node must fail this contract explicitly.
  const titleFixture = window.titleFixture = { references: [], advances: 0 };
  const heading = document.querySelector('ytd-watch-metadata h1');
  if (new URL(location.href).searchParams.has('legacy')) {
    const legacy = document.createElement('ytd-video-primary-info-renderer');
    legacy.style.display = 'block'; legacy.append(heading);
    document.querySelector('ytd-watch-metadata').before(legacy);
  }
  heading.style.color = 'rgb(238, 238, 238)';
  const titleStyle = document.createElement('style');
  titleStyle.textContent = 'h1 a { color: rgb(62, 166, 255); text-decoration: underline; cursor: pointer; }';
  document.head.append(titleStyle);
  heading.replaceChildren();
  const makeTitle = custom => {
    const formatted = document.createElement(custom ? 'span' : 'yt-formatted-string');
    if (custom) { formatted.className = 'cbCustomTitle'; formatted.style.setProperty('display', 'block', 'important'); }
    else if (new URL(location.href).searchParams.has('dearrow')) formatted.style.setProperty('display', 'none', 'important');
    const wrapper = document.createElement('span');
    const link = document.createElement('a'); link.href = '/hashtag/102';
    link.textContent = (custom ? 'Rewritten ' : '') + 'Quintessentially British Memes #102';
    const suffix = document.createTextNode(' | Funny Fails 🤣');
    wrapper.append(link); formatted.append(wrapper, suffix);
    formatted.setAttribute('title', formatted.textContent); heading.append(formatted);
    titleFixture.references.push({ formatted, wrapper, link, suffix, initialStyle: formatted.getAttribute('style') });
  };
  makeTitle(false);
  if (new URL(location.href).searchParams.has('dearrow')) makeTitle(true);
  const dearrowToggle = document.createElement('button');
  dearrowToggle.id = 'fixture-dearrow-toggle'; dearrowToggle.className = 'cbShowOriginalButton';
  dearrowToggle.textContent = 'DeArrow toggle';
  dearrowToggle.addEventListener('click', () => titleFixture.toggleClicks++);
  heading.append(dearrowToggle); titleFixture.toggleClicks = 0;
  titleFixture.activations = [];
  document.addEventListener('click', event => {
    const link = event.target.closest('a');
    if (link) { titleFixture.activations.push(link.getAttribute('href')); event.preventDefault(); }
  });
  document.addEventListener('auxclick', event => {
    const link = event.target.closest('a');
    if (link) { titleFixture.activations.push(link.getAttribute('href')); event.preventDefault(); }
  });
  const description = document.createElement('div'); description.id = 'description';
  const expander = document.createElement('ytd-text-inline-expander'); expander.id = 'description-inline-expander';
  const expanded = document.createElement('div'); expanded.id = 'expanded';
  const text = document.createElement('span'); text.textContent = 'Keep this description content.';
  const descriptionWrapper = document.createElement('span');
  const descriptionLink = document.createElement('a'); descriptionLink.href = '/hashtag/description'; descriptionLink.textContent = '#description';
  descriptionWrapper.append(descriptionLink); expanded.append(text, descriptionWrapper); expander.append(expanded); description.append(expander);
  document.querySelector('ytd-watch-metadata').append(description);
  const chip = document.createElement('yt-chip-cloud-chip-renderer');
  const chipLink = document.createElement('a'); chipLink.href = 'https://www.youtube.com/hashtag/chip'; chipLink.textContent = '#chip';
  chip.append(chipLink); document.querySelector('ytd-watch-flexy').append(chip);
  titleFixture.descriptionLink = descriptionLink; titleFixture.chipLink = chipLink;
  titleFixture.advance = () => {
    window.dispatchEvent(new Event('yt-navigate-start'));
    fixture.playerId = 'bbbbbbbbbbb';
    history.pushState(null, '', '/watch?v=bbbbbbbbbbb&list=fixture-queue&index=2');
    const nextResponse = {
      playerResponse: { videoDetails: { videoId: fixture.playerId } },
      currentVideoEndpoint: { watchEndpoint: { videoId: fixture.playerId } },
      contents: { twoColumnWatchNextResults: {} },
    };
    const flexy = document.querySelector('ytd-watch-flexy');
    flexy.data = nextResponse; flexy.videoId = fixture.playerId; flexy.loading = false;
    flexy.setAttribute('video-id', fixture.playerId); flexy.watchController.watchNextResponse = nextResponse;
    document.querySelector('ytd-app').data = { page: 'watch', url: location.href, response: nextResponse };
    for (const [index, reference] of titleFixture.references.entries()) {
      reference.link.textContent = (index ? 'Rewritten ' : '') + 'Next British Memes #103';
      reference.link.href = 'https://www.youtube.com/hashtag/103';
      reference.suffix.data = ' | Fresh Funny Fails';
      reference.formatted.setAttribute('title', reference.link.textContent + reference.suffix.data);
    }
    renderComments(nextResponse);
    document.querySelector('video').dispatchEvent(new Event('loadedmetadata', { bubbles: true }));
    window.dispatchEvent(new Event('yt-navigate-finish'));
    window.dispatchEvent(new Event('yt-page-data-updated'));
    titleFixture.advances++;
  };
  titleFixture.state = () => titleFixture.references.map(reference => ({
    retained: reference.formatted.isConnected && reference.wrapper.isConnected && reference.link.isConnected && reference.suffix.isConnected &&
      reference.formatted.firstChild === reference.wrapper && reference.wrapper.firstChild === reference.link && reference.formatted.lastChild === reference.suffix,
    text: reference.formatted.textContent,
    title: reference.formatted.getAttribute('title'),
    wrapperDisplay: getComputedStyle(reference.wrapper).display,
    linkDisplay: getComputedStyle(reference.link).display,
    formattedStyle: reference.formatted.getAttribute('style'), initialStyle: reference.initialStyle,
    removedMarker: reference.link.hasAttribute('data-ytppl-hashtag-removed'),
    href: reference.link.getAttribute('href'),
  }));
</script>`;
let browser;

before(async () => { browser = await launchFixtureBrowser(); }, { timeout: 30000 });
after(async () => { await browser?.close(); }, { timeout: 10000 });

async function openFixture(t, dearrow, { enabled, legacy = false } = {}) {
  const url = WATCH_URL + (dearrow ? '&dearrow=1' : '') + (legacy ? '&legacy=1' : '');
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, serviceWorkers: 'block' });
  await context.route('**/*', route => route.request().url().startsWith('https://www.youtube.com/watch?')
    ? route.fulfill({ contentType: 'text/html', body: BASE.replace('</body>', TITLE_SETUP + '</body>') }) : route.abort());
  if (enabled !== undefined) await context.addInitScript(({ key, enabled }) => {
    if (location.origin === 'https://www.youtube.com' && !sessionStorage.getItem('title-setting-seeded')) {
      localStorage.setItem(key, JSON.stringify({ version: 1, values: { disableTitleHashtagLinks: enabled } }));
      sessionStorage.setItem('title-setting-seeded', '1');
    }
  }, { key: KEY, enabled });
  await context.addInitScript({ content: SUITE });
  const page = await context.newPage(); page.setDefaultTimeout(8000);
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  t.after(async () => {
    try {
      assert.deepEqual(errors, []);
      const runtime = await page.getAttribute('html', 'data-yt-master-runtime-errors');
      assert.ok(!runtime || runtime === '[]', runtime);
    } finally { await context.close(); }
  });
  await page.goto(url);
  await waitForSuiteHealth(page, MANIFEST.registeredModules, { timeoutMs: 10000, errors });
  await page.waitForFunction(() => document.getElementById('yt-master-suite-style') && !titleFixture.descriptionLink.isConnected);
  return page;
}

async function linkStyle(link) {
  return link.evaluate(link => ({
    colour: getComputedStyle(link).color,
    parentColour: getComputedStyle(link.parentElement).color,
    decoration: getComputedStyle(link).textDecorationLine,
    pointerEvents: getComputedStyle(link).pointerEvents,
  }));
}

for (const legacy of [false, true]) {
  for (const dearrow of [false, true]) {
    test(`disabled ${legacy ? 'legacy' : 'current'} title hashtag links preserve ${dearrow ? 'DeArrow and native' : 'native'} bindings and queue updates`, { timeout: 20000 }, async t => {
      const page = await openFixture(t, dearrow, { enabled: true, legacy });
      const link = page.locator(dearrow ? 'h1 .cbCustomTitle a' : 'h1 yt-formatted-string a');
      const expected = () => [
        'Quintessentially British Memes #102 | Funny Fails 🤣',
        ...(dearrow ? ['Rewritten Quintessentially British Memes #102 | Funny Fails 🤣'] : []),
      ];
      assertRetained(await page.evaluate(() => titleFixture.state()), expected());
      assert.equal(await link.getAttribute('href'), '/hashtag/102');
      const style = await linkStyle(link);
      assert.equal(style.colour, style.parentColour);
      assert.equal(style.decoration, 'none');
      assert.equal(style.pointerEvents, 'none');
      await link.scrollIntoViewIfNeeded();
      const rect = await link.boundingBox();
      assert.ok(rect?.width > 0 && rect.height > 0);
      const clickPoint = { x: rect.x + 8, y: rect.y + rect.height / 2 };
      for (const options of [{}, { button: 'middle' }]) {
        await page.mouse.click(clickPoint.x, clickPoint.y, options);
      }
      for (const key of ['Control', 'Shift']) {
        await page.keyboard.down(key);
        try { await page.mouse.click(clickPoint.x, clickPoint.y); }
        finally { await page.keyboard.up(key); }
      }
      // CSS hit-testing keeps the browser's context menu off the link too.
      const contextMenu = await page.evaluate(({ x, y }) => {
        const target = document.elementFromPoint(x, y);
        return Boolean(target?.closest('a'));
      }, clickPoint);
      assert.equal(contextMenu, false);
      await link.focus();
      await page.keyboard.press('Enter');
      assert.equal(await link.evaluate(link => link.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 }))), false);
      assert.equal(await link.evaluate(link => link.dispatchEvent(new MouseEvent('auxclick', { bubbles: true, cancelable: true, button: 1 }))), false);
      assert.deepEqual(await page.evaluate(() => titleFixture.activations), []);
      assert.equal(new URL(page.url()).searchParams.get('v'), 'aaaaaaaaaaa');
      await page.locator('#fixture-dearrow-toggle').click();
      assert.equal(await page.evaluate(() => titleFixture.toggleClicks), 1, 'DeArrow controls remain clickable');
      const unrelated = await page.evaluate(() => {
        const ordinary = document.createElement('a'); ordinary.href = '/watch?v=ccccccccccc'; ordinary.textContent = 'Ordinary title link';
        document.querySelector('h1').append(ordinary);
        const outside = document.createElement('a'); outside.href = '/hashtag/outside'; outside.textContent = '#outside';
        document.querySelector('#owner').append(outside);
        const other = document.createElement('h1');
        const otherLink = document.createElement('a'); otherLink.href = '/hashtag/other-heading'; otherLink.textContent = '#other';
        other.append(otherLink); document.body.append(other);
        const result = [ordinary, outside, otherLink].map(link => ({
          allowed: link.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 })),
          pointerEvents: getComputedStyle(link).pointerEvents,
        }));
        ordinary.remove(); outside.remove(); other.remove();
        // The fixture's bubble listener prevents navigation after observing it.
        return { result, activated: titleFixture.activations.splice(0) };
      });
      assert.deepEqual(unrelated.activated, ['/watch?v=ccccccccccc', '/hashtag/outside', '/hashtag/other-heading']);
      assert.ok(unrelated.result.every(result => result.pointerEvents === 'auto'));
      await page.evaluate(() => titleFixture.advance());
      await page.waitForTimeout(250);
      assertRetained(await page.evaluate(() => titleFixture.state()), [
        'Next British Memes #103 | Fresh Funny Fails',
        ...(dearrow ? ['Rewritten Next British Memes #103 | Fresh Funny Fails'] : []),
      ]);
      assert.equal(await link.getAttribute('href'), 'https://www.youtube.com/hashtag/103');
      assert.equal((await linkStyle(link)).pointerEvents, 'none');
      await link.focus(); await page.keyboard.press('Enter');
      assert.deepEqual(await page.evaluate(() => titleFixture.activations), []);
      assert.equal(new URL(page.url()).searchParams.get('v'), 'bbbbbbbbbbb');
    });
  }
}

test('title hashtag option can be saved, enabled and disabled after reload without changing title content', { timeout: 25000 }, async t => {
  const page = await openFixture(t, true);
  const link = page.locator('h1 .cbCustomTitle a');
  assert.equal((await linkStyle(link)).pointerEvents, 'auto');
  await link.click();
  assert.deepEqual(await page.evaluate(() => titleFixture.activations), ['/hashtag/102']);
  for (const enabled of [true, false]) {
    await page.locator('#ytms-settings-button').click();
    await page.getByRole('tab', { name: 'Layout', exact: true }).click();
    const toggle = page.locator('#ytms-disableTitleHashtagLinks');
    assert.equal(await toggle.isChecked(), !enabled);
    assert.ok((await page.locator('#ytms-disableTitleHashtagLinks-description').textContent()).includes('DeArrow'));
    await toggle.setChecked(enabled);
    await page.locator('#ytms-save-preview').click();
    assert.equal(await page.evaluate(key => JSON.parse(localStorage.getItem(key)).values.disableTitleHashtagLinks, KEY), enabled);
    assert.equal((await linkStyle(link)).pointerEvents, enabled ? 'auto' : 'none', 'Saved choices do not change the running page');
    await page.reload();
    await waitForSuiteHealth(page, MANIFEST.registeredModules, { timeoutMs: 10000 });
    await page.waitForFunction(() => document.getElementById('yt-master-suite-style') && !titleFixture.descriptionLink.isConnected);
    assert.equal((await linkStyle(link)).pointerEvents, enabled ? 'none' : 'auto');
    assert.equal((await linkStyle(link)).decoration, enabled ? 'none' : 'underline');
    assert.equal((await linkStyle(link)).colour, enabled ? 'rgb(238, 238, 238)' : 'rgb(62, 166, 255)');
    assertRetained(await page.evaluate(() => titleFixture.state()), [
      'Quintessentially British Memes #102 | Funny Fails 🤣',
      'Rewritten Quintessentially British Memes #102 | Funny Fails 🤣',
    ]);
  }
  await link.click();
  assert.deepEqual(await page.evaluate(() => titleFixture.activations), ['/hashtag/102']);
});

test('adjacent hashtag-only titles and late title runs keep their text and follow the title colour in both themes', { timeout: 20000 }, async t => {
  const page = await openFixture(t, true, { enabled: true });
  await page.evaluate(() => {
    for (const reference of titleFixture.references) {
      reference.link.href = '/hashtag/bestfriends'; reference.link.textContent = '#bestfriends';
      const second = document.createElement('a'); second.href = 'https://youtube.com/hashtag/meatball'; second.textContent = '#meatball';
      reference.wrapper.append(second); reference.second = second;
      reference.suffix.data = ''; reference.formatted.setAttribute('title', reference.formatted.textContent);
    }
  });
  for (const dark of [true, false]) {
    await page.evaluate(dark => {
      document.documentElement.toggleAttribute('dark', dark);
      document.querySelector('h1').style.color = dark ? '#eee' : '#0f0f0f';
    }, dark);
    const state = await page.evaluate(() => titleFixture.references.map(reference => ({
      text: reference.formatted.textContent,
      retained: reference.link.isConnected && reference.wrapper.firstChild === reference.link && reference.wrapper.lastChild === reference.second,
      links: [reference.link, reference.second].map(link => ({
        href: link.getAttribute('href'), colour: getComputedStyle(link).color,
        pointerEvents: getComputedStyle(link).pointerEvents,
        syntheticAllowed: link.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 })),
      })),
    })));
    for (const title of state) {
      assert.equal(title.text, '#bestfriends#meatball'); assert.equal(title.retained, true);
      assert.deepEqual(title.links.map(link => link.href), ['/hashtag/bestfriends', 'https://youtube.com/hashtag/meatball']);
      assert.ok(title.links.every(link => link.colour === (dark ? 'rgb(238, 238, 238)' : 'rgb(15, 15, 15)') &&
        link.pointerEvents === 'none' && link.syntheticAllowed === false));
    }
    assert.deepEqual(await page.evaluate(() => titleFixture.activations), []);
  }
});

function assertRetained(states, expectedPrefixes) {
  assert.equal(states.length, expectedPrefixes.length);
  for (const [index, state] of states.entries()) {
    assert.equal(state.retained, true, 'Hashtag cleanup must preserve the actual bound native title nodes');
    assert.equal(state.removedMarker, false, 'Title anchors must not be marked as removed');
    assert.equal(state.text, expectedPrefixes[index]);
    assert.equal(state.title, state.text);
    assert.notEqual(state.wrapperDisplay, 'none', 'Title-run wrappers must not be hidden by hashtag CSS');
    assert.notEqual(state.linkDisplay, 'none', 'Title-run links must not be hidden by hashtag CSS');
    assert.equal(state.formattedStyle, state.initialStyle, 'Extension-owned original/custom title display is unchanged');
  }
}

for (const dearrow of [false, true]) {
  test(`${dearrow ? 'native and DeArrow' : 'native'} retained title runs survive hashtag cleanup and queue advancement`, { timeout: 20000 }, async t => {
    const page = await openFixture(t, dearrow);
    assertRetained(await page.evaluate(() => titleFixture.state()), [
      'Quintessentially British Memes #102 | Funny Fails 🤣',
      ...(dearrow ? ['Rewritten Quintessentially British Memes #102 | Funny Fails 🤣'] : []),
    ]);
    const visibleTitle = page.locator(dearrow ? 'h1 .cbCustomTitle a' : 'h1 yt-formatted-string a');
    assert.equal(await visibleTitle.isVisible(), true);
    const hiddenOutside = await page.evaluate(() => ({
      descriptionRemoved: !titleFixture.descriptionLink.isConnected,
      chipHidden: !titleFixture.chipLink.isConnected || getComputedStyle(titleFixture.chipLink).display === 'none',
      descriptionText: document.getElementById('description').textContent,
    }));
    assert.equal(hiddenOutside.descriptionRemoved, true, 'Description hashtag cleanup remains effective');
    assert.equal(hiddenOutside.chipHidden, true, 'Non-title chip hashtags remain hidden');
    assert.ok(hiddenOutside.descriptionText.includes('Keep this description content.'));
    await page.evaluate(() => {
      window.dispatchEvent(new Event('yt-page-data-updated'));
      titleFixture.advance();
    });
    await page.waitForTimeout(250);
    assertRetained(await page.evaluate(() => titleFixture.state()), [
      'Next British Memes #103 | Fresh Funny Fails',
      ...(dearrow ? ['Rewritten Next British Memes #103 | Fresh Funny Fails'] : []),
    ]);
    assert.equal(await visibleTitle.isVisible(), true);
    assert.deepEqual(await page.evaluate(() => ({
      url: new URL(location.href).searchParams.get('v'), player: fixture.playerId,
      watch: document.querySelector('ytd-watch-flexy').getAttribute('video-id'),
      response: document.querySelector('ytd-app').data.response.currentVideoEndpoint.watchEndpoint.videoId,
      advances: titleFixture.advances,
    })), { url: 'bbbbbbbbbbb', player: 'bbbbbbbbbbb', watch: 'bbbbbbbbbbb', response: 'bbbbbbbbbbb', advances: 1 });
    // A new non-title hashtag is CSS-hidden immediately, before asynchronous
    // DOM cleanup; both relative and absolute title endpoints stay untouched.
    const css = await page.evaluate(() => {
      const outside = document.createElement('span');
      const anchor = document.createElement('a'); anchor.href = '/hashtag/late'; anchor.textContent = '#late'; outside.append(anchor);
      document.getElementById('description').append(outside);
      return { anchor: getComputedStyle(anchor).display, wrapper: getComputedStyle(outside).display };
    });
    assert.equal(css.anchor, 'none'); assert.equal(css.wrapper, 'none');
  });
}
