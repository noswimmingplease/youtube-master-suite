import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { after, before, test } from "node:test";
import { createChannelAgeService } from "../../sources/channel-age.mjs";
import { createChannelAgeDialog } from "../../sources/channel-age-dialog.mjs";
import { launchFixtureBrowser } from "./fixture-browser.mjs";

const FEED = readFileSync(new URL("../../sources/modules/youtube-feed-ui-cleaner.user.js", import.meta.url), "utf8");
const CSS = readFileSync(new URL("../../assets/settings-panel.css", import.meta.url), "utf8");
const ID = "UCaaaaaaaaaaaaaaaaaaaaaa";
const OTHER_ID = "UCbbbbbbbbbbbbbbbbbbbbbb";
const NOW = Date.UTC(2026, 9, 20, 12);
const KEY = "yt-master-suite.channel-age.v1";
const rule = (channelId = ID, maxAge = 1, unit = "weeks") => ({ channelId, name: "Fixture channel", maxAge, unit, enabled: true });
const HTML = `<!doctype html><html lang="en-GB"><head><style>
  ytd-browse,ytd-rich-grid-renderer,ytd-rich-item-renderer,ytd-rich-grid-media,ytd-playlist-panel-renderer {display:block}
  ytd-rich-item-renderer {min-height:30px}
  #metadata-line span {display:inline}
</style></head><body><ytd-browse><ytd-rich-grid-renderer><div id="contents" class="ytd-rich-grid-renderer"></div></ytd-rich-grid-renderer></ytd-browse></body></html>`;
let browser;
before(async () => { browser = await launchFixtureBrowser(); }, { timeout: 30000 });
after(async () => { await browser?.close(); }, { timeout: 10000 });

async function open(t, { rules = [rule()], route = "/" } = {}) {
  const context = await browser.newContext({ viewport: { width: 1200, height: 900 }, serviceWorkers: "block" });
  const url = `https://www.youtube.com${route}`;
  await context.route("**/*", request => request.request().url() === url
    ? request.fulfill({ contentType: "text/html", body: HTML }) : request.abort());
  const page = await context.newPage();
  page.setDefaultTimeout(6000);
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  t.after(async () => {
    try { assert.deepEqual(errors, []); }
    finally { await context.close(); }
  });
  await page.goto(url);
  await page.addStyleTag({ content: CSS });
  await page.evaluate(({ key, rules }) => localStorage.setItem(key, JSON.stringify({ version: 1, rules })), { key: KEY, rules });
  await page.addScriptTag({ content: `const suite = { channelAge: (${createChannelAgeService.toString()})(() => localStorage, () => ${NOW}) }; window.fixtureChannelAge = suite.channelAge;
    window.fixtureSuite = suite;
    const ageDialog = (${createChannelAgeDialog.toString()})(document, suite.channelAge,
      change => suite.showChannelFilterConfirmation?.(change));
    suite.openChannelAgeSettings = (channel, context) => ageDialog.open(channel, context);
    function GM_addStyle(css) { const style = document.createElement('style'); style.textContent = css; document.head.append(style); }
    ${FEED}` });
  assert.equal(await page.locator("html").getAttribute("lang"), "en-GB");
  await page.evaluate(({ id, otherId }) => {
    window.ageFixture = {
      add(name, { channel = id, date = "2 weeks ago", live = false, ambiguous = false, queue = false } = {}) {
        const card = document.createElement("ytd-rich-item-renderer");
        card.id = name;
        const media = document.createElement("ytd-rich-grid-media");
        const link = document.createElement("a");
        link.href = "/watch?v=aaaaaaaaaaa";
        link.textContent = "Video title is not the channel identity";
        const owner = document.createElement("div");
        owner.id = "channel-name";
        const byline = document.createElement("a");
        byline.href = `/channel/${channel}`;
        byline.textContent = "Fixture channel";
        owner.append(byline);
        if (ambiguous) {
          const second = byline.cloneNode(true);
          second.href = `/channel/${otherId}`;
          owner.append(second);
        }
        const metadata = document.createElement("div");
        metadata.id = "metadata-line";
        const uploaded = document.createElement("span");
        uploaded.textContent = date;
        metadata.append(uploaded);
        media.append(link, owner, metadata);
        if (live) {
          const badge = document.createElement("ytd-thumbnail-overlay-time-status-renderer");
          badge.setAttribute("overlay-style", "LIVE");
          badge.textContent = "LIVE";
          media.append(badge);
        }
        card.append(media);
        if (queue) {
          let panel = document.querySelector("ytd-playlist-panel-renderer");
          if (!panel) {
            panel = document.createElement("ytd-playlist-panel-renderer");
            document.querySelector("#contents").append(panel);
          }
          panel.append(card);
        } else document.querySelector("#contents").append(card);
      },
      date(name, value) { document.querySelector(`#${name} #metadata-line span`).firstChild.data = value; },
      channel(name, value) { document.querySelector(`#${name} #channel-name a`).href = `/channel/${value}`; },
      save(rules) {
        const result = window.fixtureChannelAge.save(rules);
        if (result.ok) window.dispatchEvent(new CustomEvent("yt-master-channel-age-changed"));
        return result;
      },
      open(name) {
        const card = document.getElementById(name);
        suite.openChannelAgeSettings(suite.channelAge.channelFromCard(card),
          { card, videoId: suite.channelAge.videoIdFromCard(card) });
      },
    };
  }, { id: ID, otherId: OTHER_ID });
  return page;
}

async function hidden(page, id, value) {
  await page.waitForFunction(({ id, value }) => {
    const card = document.getElementById(id);
    return card && (card.getAttribute("data-clean-up-youtube-hidden") === "1") === value;
  }, { id, value });
}

test("age rules are off by default and adding one immediately reuses Filtered · Show", async t => {
  const page = await open(t, { rules: [] });
  await page.evaluate(() => window.ageFixture.add("old"));
  await hidden(page, "old", false);
  assert.equal(await page.locator("#old").isVisible(), true);
  assert.equal(await page.evaluate(rules => window.ageFixture.save(rules).ok, [rule()]), true);
  await hidden(page, "old", true);
  assert.equal(await page.locator("#old").isVisible(), false);
  const toggle = page.locator("#yt-master-filter-toggle");
  await toggle.waitFor();
  assert.equal(await toggle.getAttribute("title"), "Channel age: 1");
  await toggle.click();
  assert.equal(await page.locator("#old").isVisible(), true);
  await toggle.click();
  assert.equal(await page.locator("#old").isVisible(), false);
  await page.evaluate(() => window.ageFixture.save([]));
  await hidden(page, "old", false);
  await page.waitForFunction(() => !document.getElementById("yt-master-filter-toggle"));
});

test("each channel has an independent age limit while uncertain, live and ambiguous cards stay visible", async t => {
  const page = await open(t, { rules: [rule(), rule(OTHER_ID, 1, "years")] });
  await page.evaluate(({ other }) => {
    window.ageFixture.add("weekly", { date: "2 weeks ago" });
    window.ageFixture.add("yearly", { channel: other, date: "2 months ago" });
    window.ageFixture.add("too-old-yearly", { channel: other, date: "2 years ago" });
    window.ageFixture.add("unknown", { date: "Date unavailable" });
    window.ageFixture.add("live", { live: true });
    window.ageFixture.add("ambiguous", { ambiguous: true });
    window.ageFixture.add("handle", { channel: "@fixture" });
  }, { other: OTHER_ID });
  await hidden(page, "weekly", true);
  await hidden(page, "too-old-yearly", true);
  for (const name of ["yearly", "unknown", "live", "ambiguous", "handle"]) {
    await hidden(page, name, false);
    assert.equal(await page.locator(`#${name}`).isVisible(), true, name);
  }
});

test("recycled channel hrefs and date text nodes are reassessed in both directions", async t => {
  const page = await open(t);
  await page.evaluate(() => window.ageFixture.add("recycled"));
  await hidden(page, "recycled", true);
  await page.evaluate(() => window.ageFixture.date("recycled", "1 hour ago"));
  await hidden(page, "recycled", false);
  await page.evaluate(() => window.ageFixture.date("recycled", "3 weeks ago"));
  await hidden(page, "recycled", true);
  await page.evaluate(id => window.ageFixture.channel("recycled", id), OTHER_ID);
  await hidden(page, "recycled", false);
  await page.evaluate(id => window.ageFixture.channel("recycled", id), ID);
  await hidden(page, "recycled", true);
});

test('a one-week channel rule hides compact two-year DOM dates and follows recycled compact ages', async t => {
  const page = await open(t);
  await page.evaluate(() => window.ageFixture.add('compact-old', { date:'2 yr ago' }));
  await hidden(page, 'compact-old', true);
  assert.equal(await page.locator('#compact-old').isVisible(), false);
  await page.evaluate(() => window.ageFixture.date('compact-old', '1 hr ago'));
  await hidden(page, 'compact-old', false);
  await page.evaluate(() => window.ageFixture.date('compact-old', '2 yrs. ago'));
  await hidden(page, 'compact-old', true);
  await page.evaluate(() => window.ageFixture.date('compact-old', '1 wk ago'));
  await hidden(page, 'compact-old', false);
});

test("one feed pass evaluates each normalised age-filter card once and reads one model snapshot", async t => {
  const page = await open(t);
  await page.evaluate(id => {
    const audit = window.ageFixture.audit = { calls: 0, reads: 0 };
    const original = window.fixtureChannelAge.cardFilterReason;
    window.fixtureChannelAge.cardFilterReason = card => { audit.calls += 1; return original(card); };
    for (let index = 0; index < 100; index += 1) {
      const name = `counted-${index}`;
      window.ageFixture.add(name);
      const media = document.querySelector(`#${name} ytd-rich-grid-media`);
      media.componentProps = {
        value: { ownerText: { runs: [{ text: "Fixture channel", navigationEndpoint: { browseEndpoint: { browseId: id } } }] },
          publishedTimeText: { simpleText: "2 weeks ago" } },
        data() { audit.reads += 1; return this.value; },
      };
    }
    window.ageFixture.add("excluded-counted", { queue: true });
  }, ID);
  await hidden(page, "counted-99", true);
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  assert.deepEqual(await page.evaluate(() => window.ageFixture.audit), { calls: 100, reads: 100 });
  assert.equal(await page.locator('[data-clean-up-youtube-hidden="1"]').count(), 100);
  await hidden(page, "excluded-counted", false);

  for (const [channel, date, filtered] of [[ID, "1 hour ago", false], [OTHER_ID, "3 weeks ago", false], [ID, "3 weeks ago", true]]) {
    await page.evaluate(({ channel, date }) => {
      window.ageFixture.audit.calls = 0;
      window.ageFixture.audit.reads = 0;
      const component = document.querySelector("#counted-0 ytd-rich-grid-media").componentProps;
      component.value = { ownerText: { runs: [{ text: "Fixture channel", navigationEndpoint: { browseEndpoint: { browseId: channel } } }] },
        publishedTimeText: { simpleText: date } };
      window.ageFixture.channel("counted-0", channel);
      window.ageFixture.date("counted-0", date);
    }, { channel, date });
    await hidden(page, "counted-0", filtered);
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    assert.deepEqual(await page.evaluate(() => window.ageFixture.audit), { calls: 1, reads: 1 }, "Recycled data is re-read without revisiting other cards");
  }
});

test("age-filter deduplication retains standalone lockups and excludes popup descendants", async t => {
  const page = await open(t);
  await page.evaluate(() => {
    window.ageFixture.add("standalone");
    const wrapper = document.getElementById("standalone");
    const media = wrapper.firstElementChild;
    const lockup = document.createElement("yt-lockup-view-model");
    lockup.id = "standalone";
    lockup.style.display = "block";
    lockup.append(...media.childNodes);
    wrapper.replaceWith(lockup);

    window.ageFixture.add("popup-excluded");
    const popup = document.createElement("ytd-popup-container");
    document.querySelector("#contents").append(popup);
    popup.append(document.getElementById("popup-excluded"));
  });
  await hidden(page, "standalone", true);
  await hidden(page, "popup-excluded", false);
  assert.equal(await page.locator("#popup-excluded").isVisible(), true);
});

test("current lockup component data filters handle-only cards and follows recycled identities and dates", async t => {
  const page = await open(t);
  await page.evaluate(id => {
    window.ageFixture.add("current-lockup");
    const media = document.querySelector("#current-lockup ytd-rich-grid-media");
    const lockup = document.createElement("yt-lockup-view-model");
    lockup.style.display = "block";
    lockup.append(...media.childNodes);
    lockup.querySelector("#channel-name a").href = "/@fixture";
    const text = { content: "Fixture channel", commandRuns: [{ startIndex: 0, length: 15,
      onTap: { innertubeCommand: { browseEndpoint: { browseId: id } } } }] };
    const published = { content: "2 weeks ago" };
    Object.defineProperty(lockup, "data", { get: () => Symbol("opaque") });
    lockup.componentProps = { data: () => ({ metadata: { lockupMetadataViewModel: { metadata: {
      contentMetadataViewModel: { metadataRows: [{ metadataParts: [{ text }, { text: published }] }] },
    } } } }) };
    window.ageFixture.current = { text, published };
    media.replaceWith(lockup);
  }, ID);
  await hidden(page, "current-lockup", true);
  await page.evaluate(() => {
    window.ageFixture.current.published.content = "1 hour ago";
    window.ageFixture.date("current-lockup", "1 hour ago");
  });
  await hidden(page, "current-lockup", false);
  await page.evaluate(id => {
    window.ageFixture.current.published.content = "3 weeks ago";
    window.ageFixture.current.text.commandRuns[0].onTap.innertubeCommand.browseEndpoint.browseId = id;
    window.ageFixture.date("current-lockup", "3 weeks ago");
  }, OTHER_ID);
  await hidden(page, "current-lockup", false);
  await page.evaluate(id => {
    window.ageFixture.current.text.commandRuns[0].onTap.innertubeCommand.browseEndpoint.browseId = id;
    document.querySelector("#current-lockup #channel-name a").href = "/@updated-fixture";
  }, ID);
  await hidden(page, "current-lockup", true);
  await page.evaluate(id => window.ageFixture.channel("current-lockup", id), OTHER_ID);
  await hidden(page, "current-lockup", false);
});

for (const route of ["/feed/history", "/feed/library", "/feed/playlists", "/playlist?list=WL", "/watch?v=aaaaaaaaaaa"]) {
  for (const blocked of [false, true]) test(`channel ${blocked ? "blocks" : "age filters"} leave the ${route} surface untouched`, async t => {
    const page = await open(t, { route, rules: [{ ...rule(), blocked }] });
    await page.evaluate(() => window.ageFixture.add("excluded"));
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    await hidden(page, "excluded", false);
    assert.equal(await page.locator("#excluded").isVisible(), true);
  });
}

for (const route of ["/feed/subscriptions", "/results?search_query=news", `/channel/${ID}/videos`, "/@fixture/streams"]) {
  test(`channel age rules apply on ${route}`, async t => {
    const page = await open(t, { route });
    await page.evaluate(() => window.ageFixture.add("filtered"));
    await hidden(page, "filtered", true);
  });
}

test("queues and popups embedded in feed-shaped containers remain untouched", async t => {
  const page = await open(t);
  await page.evaluate(() => {
    window.ageFixture.add("normal");
    window.ageFixture.add("queued", { queue: true });
  });
  await hidden(page, "normal", true);
  await hidden(page, "queued", false);
  assert.equal(await page.locator("#queued").isVisible(), true);
});

test("stable filtered cards do not create an attribute-observer feedback loop", async t => {
  const page = await open(t);
  await page.evaluate(() => window.ageFixture.add("stable"));
  await hidden(page, "stable", true);
  const writes = await page.evaluate(async () => {
    let mutations = 0;
    const observer = new MutationObserver(records => { mutations += records.length; });
    observer.observe(document.getElementById("stable"), { attributes: true });
    await new Promise(resolve => {
      let frames = 0;
      function next() { if (++frames === 12) resolve(); else requestAnimationFrame(next); }
      requestAnimationFrame(next);
    });
    observer.disconnect();
    return mutations;
  });
  assert.equal(writes, 0);
});

test("Suite hidden-channel rules cover recent, undated and live cards and reuse temporary reveal", async t => {
  const page = await open(t, { rules: [{ ...rule(), blocked: true }] });
  await page.evaluate(() => {
    window.ageFixture.add("recent", { date: "1 hour ago" });
    window.ageFixture.add("undated", { date: "Date unavailable" });
    window.ageFixture.add("live-hidden", { live: true });
    window.ageFixture.add("old-hidden");
    window.ageFixture.add("queued-hidden", { queue: true });
    window.ageFixture.add("ambiguous-block", { ambiguous: true });
  });
  for (const id of ["recent", "undated", "live-hidden", "old-hidden"]) {
    await hidden(page, id, true);
    assert.equal(await page.locator(`#${id}`).getAttribute("data-clean-up-youtube-reason"), "Channel hidden");
  }
  for (const id of ["queued-hidden", "ambiguous-block"]) {
    await hidden(page, id, false);
    assert.equal(await page.locator(`#${id}`).isVisible(), true);
  }
  const toggle = page.locator("#yt-master-filter-toggle");
  await toggle.waitFor();
  assert.equal(await toggle.getAttribute("title"), "Channel hidden: 4");
  await toggle.click();
  assert.equal(await page.locator("#recent").isVisible(), true);
  assert.equal(await page.locator("#old-hidden").isVisible(), true);
  await toggle.click();
  assert.equal(await page.locator("#recent").isVisible(), false);
});

test("switching a block back to its age rule, disabling and deleting reconciles both card reasons immediately", async t => {
  const page = await open(t, { rules: [{ ...rule(), blocked: true }] });
  await page.evaluate(() => {
    window.ageFixture.add("recent", { date: "1 hour ago" });
    window.ageFixture.add("older");
  });
  await hidden(page, "recent", true);
  await hidden(page, "older", true);
  await page.evaluate(rules => window.ageFixture.save(rules), [rule()]);
  await hidden(page, "recent", false);
  await page.waitForFunction(() => document.getElementById("older").getAttribute("data-clean-up-youtube-reason") === "Channel age");
  await page.evaluate(rules => window.ageFixture.save(rules), [{ ...rule(), blocked: true, enabled: false }]);
  await hidden(page, "older", false);
  await page.evaluate(rules => window.ageFixture.save(rules), [{ ...rule(), blocked: true }]);
  await hidden(page, "recent", true);
  await page.evaluate(() => window.ageFixture.save([]));
  await hidden(page, "recent", false);
  await hidden(page, "older", false);
});

const confirmation = page => page.locator('#origin > .ytms-channel-filter-confirmation');
async function editOrigin(page, { date = '2 weeks ago', queue = false } = {}) {
  await page.evaluate(({ date, queue }) => {
    window.ageFixture.add('origin', { date, queue });
    window.ageFixture.add('sibling', { date: '3 years ago' });
    window.originalMedia = document.querySelector('#origin ytd-rich-grid-media');
    window.ageFixture.open('origin');
  }, { date, queue });
  await page.locator('#ytms-age-dialog').waitFor();
}
async function saveDialog(page) {
  await page.locator('#ytms-age-save').click();
  await page.waitForFunction(() => !document.getElementById('ytms-age-dialog').open);
}

for (const [maxAge, unit, description] of [[1, 'weeks', '1 week'], [2, 'months', '2 months'], [1, 'years', '1 year'], [3, 'days', '3 days']]) {
  test(`saving a ${description} channel filter acknowledges only its origin card`, async t => {
    const page = await open(t, { rules: [] });
    await editOrigin(page);
    await page.getByLabel('Maximum age', { exact: true }).fill(String(maxAge));
    await page.getByLabel('Unit', { exact: true }).selectOption(unit);
    await saveDialog(page);
    assert.equal(await confirmation(page).isVisible(), true);
    assert.match(await confirmation(page).textContent(), new RegExp(`Hide uploads older than ${description}\\.`));
    assert.equal(await confirmation(page).getAttribute('lang'), 'en-GB');
    assert.equal(await page.evaluate(() => originalMedia === document.querySelector('#origin ytd-rich-grid-media')), true);
    assert.equal(await page.locator('#origin ytd-rich-grid-media').isVisible(), false);
    await hidden(page, 'sibling', true);
    assert.equal(await page.locator('#sibling').isVisible(), false);
    await page.evaluate(() => {
      const audit = window.ageFixture.audit = { calls: 0 };
      const original = fixtureChannelAge.cardFilterReason;
      fixtureChannelAge.cardFilterReason = card => { audit.calls++; return original(card); };
    });
    await page.waitForTimeout(150);
    const idleCalls = await page.evaluate(() => ageFixture.audit.calls);
    await page.evaluate(() => document.querySelector('.ytms-channel-filter-confirmation strong').textContent = 'Filter saved');
    await page.waitForTimeout(150);
    assert.equal(await page.evaluate(() => ageFixture.audit.calls), idleCalls, 'Owned confirmation text does not rescan the feed');
    await confirmation(page).getByRole('button', { name: 'Undo', exact: true }).click();
    assert.equal(await confirmation(page).count(), 0);
    await hidden(page, 'sibling', false);
    assert.equal(await page.locator('#origin ytd-rich-grid-media').isVisible(), true);
    assert.deepEqual(await page.evaluate(() => fixtureChannelAge.getRules()), []);
  });
}

test('a selected fresh video states the saved rule without falsely claiming it was too old', async t => {
  const page = await open(t, { rules: [] });
  await editOrigin(page, { date: '1 hour ago' });
  await saveDialog(page);
  assert.equal(await confirmation(page).isVisible(), true);
  assert.match(await confirmation(page).textContent(), /Channel upload filter saved.*Hide uploads older than 1 week/);
  assert.doesNotMatch(await confirmation(page).textContent(), /Video removed|too old/);
  await confirmation(page).getByRole('button', { name: 'Edit filter', exact: true }).click();
  assert.equal(await page.getByLabel('Channel ID or channel URL', { exact: true }).inputValue(), ID);
  await page.getByLabel('Maximum age', { exact: true }).fill('2');
  await saveDialog(page);
  assert.equal(await confirmation(page).count(), 1);
  assert.match(await confirmation(page).textContent(), /older than 2 weeks/);
});

test('a full channel block gets an accurate confirmation and can be undone', async t => {
  const page = await open(t, { rules: [] });
  await editOrigin(page, { date: '1 hour ago' });
  await page.getByLabel('Hide this channel — all uploads', { exact: true }).check();
  await saveDialog(page);
  assert.match(await confirmation(page).textContent(), /Hide all uploads from this channel\./);
  assert.doesNotMatch(await confirmation(page).textContent(), /older than/);
  await hidden(page, 'sibling', true);
  await confirmation(page).getByRole('button', { name: 'Undo', exact: true }).click();
  await hidden(page, 'sibling', false);
});

for (const action of ['cancel', 'invalid', 'storage failure', 'storage conflict']) {
  test(`no card acknowledgement is created for ${action}`, async t => {
    const page = await open(t, { rules: [] });
    await editOrigin(page);
    if (action === 'cancel') await page.locator('#ytms-age-cancel').click();
    else {
      if (action === 'invalid') await page.getByLabel('Maximum age', { exact: true }).fill('0');
      if (action === 'storage failure') await page.evaluate(() => {
        Storage.prototype.setItem = () => { throw new Error('Fixture storage unavailable'); };
      });
      if (action === 'storage conflict') await page.evaluate(other => ageFixture.save([other]), rule(OTHER_ID));
      await page.locator('#ytms-age-save').click();
      assert.equal(await page.locator('#ytms-age-status').isVisible(), true);
      assert.equal(await page.locator('#ytms-age-dialog').evaluate(node => node.open), true);
    }
    assert.equal(await confirmation(page).count(), 0);
    assert.equal(await page.locator('#origin ytd-rich-grid-media').isVisible(), true);
  });
}

test('Undo restores only the selected channel and keeps another channel saved in the same dialogue', async t => {
  const page = await open(t, { rules: [] });
  await editOrigin(page);
  await page.locator('#ytms-age-add').click();
  await page.getByLabel('Channel ID or channel URL', { exact: true }).nth(1).fill(OTHER_ID);
  await page.getByLabel('Channel name', { exact: true }).nth(1).fill('Other channel');
  await saveDialog(page);
  await confirmation(page).getByRole('button', { name: 'Undo', exact: true }).click();
  assert.deepEqual(await page.evaluate(() => fixtureChannelAge.getRules().map(rule => rule.channelId)), [OTHER_ID]);
});

test('Undo of an edited filter restores its previous timeframe rather than removing it', async t => {
  const page = await open(t, { rules: [rule(ID, 1, 'years')] });
  await editOrigin(page, { date: '1 hour ago' });
  await page.getByLabel('Unit', { exact: true }).selectOption('weeks');
  await saveDialog(page);
  await confirmation(page).getByRole('button', { name: 'Undo', exact: true }).click();
  assert.equal(await page.evaluate(() => fixtureChannelAge.getRules()[0].unit), 'years');
});

test('Undo refuses to overwrite a concurrent edit to the same channel', async t => {
  const page = await open(t, { rules: [] });
  await editOrigin(page);
  await saveDialog(page);
  await page.evaluate(rule => fixtureChannelAge.save([rule]), rule(ID, 2, 'months'));
  await confirmation(page).getByRole('button', { name: 'Undo', exact: true }).click();
  assert.equal(await page.evaluate(() => fixtureChannelAge.getRules()[0].unit), 'months');
  assert.equal(await page.evaluate(() => fixtureChannelAge.getRules()[0].maxAge), 2);
});

for (const recycle of ['video', 'channel', 'model', 'detach', 'navigate']) {
  test(`card feedback is removed on ${recycle} changes`, async t => {
    const page = await open(t, { rules: [] });
    await editOrigin(page);
    await saveDialog(page);
    await page.evaluate(({ recycle, other }) => {
      const card = document.getElementById('origin');
      if (recycle === 'video') card.querySelector('a[href^="/watch"]').href = '/watch?v=bbbbbbbbbbb';
      if (recycle === 'channel') ageFixture.channel('origin', other);
      if (recycle === 'model') {
        card.data = { videoId: 'bbbbbbbbbbb' };
        ageFixture.date('origin', '3 weeks ago');
      }
      if (recycle === 'detach') card.remove();
      if (recycle === 'navigate') window.dispatchEvent(new Event('yt-navigate-start'));
    }, { recycle, other: OTHER_ID });
    await page.waitForFunction(() => !document.querySelector('[data-ytms-channel-filter-confirmation]'));
    assert.equal(await page.locator('.ytms-channel-filter-confirmation').count(), 0);
    if (recycle === 'video' || recycle === 'model') await hidden(page, 'origin', true);
    if (recycle === 'channel') assert.equal(await page.locator('#origin ytd-rich-grid-media').isVisible(), true);
  });
}

for (const route of ['/feed/history', '/playlist?list=PLfixture', '/watch?v=aaaaaaaaaaa']) {
  test(`saving from ${route} does not replace a library/watch card`, async t => {
    const page = await open(t, { rules: [], route });
    await editOrigin(page);
    await saveDialog(page);
    assert.equal(await confirmation(page).count(), 0);
    assert.equal(await page.locator('#origin ytd-rich-grid-media').isVisible(), true);
  });
}

test('queued cards and independent Mix filtering cannot be exposed by a filter confirmation', async t => {
  const page = await open(t, { rules: [] });
  await editOrigin(page, { queue: true });
  await saveDialog(page);
  assert.equal(await confirmation(page).count(), 0);
  await page.evaluate(() => {
    document.querySelector('#contents').append(document.getElementById('origin'));
    ageFixture.open('origin');
  });
  await page.getByLabel('Maximum age', { exact: true }).fill('2');
  await saveDialog(page);
  await confirmation(page).waitFor();
  await page.evaluate(() => {
    const badge = document.createElement('badge-shape');
    badge.textContent = 'Mix';
    document.querySelector('#origin ytd-rich-grid-media').append(badge);
  });
  await hidden(page, 'origin', true);
  assert.equal(await confirmation(page).count(), 0);
  assert.equal(await page.locator('#origin').isVisible(), false);
});

test('disabling the origin rule restores its card instead of showing an active-filter receipt', async t => {
  const page = await open(t, { rules: [] });
  await editOrigin(page);
  await saveDialog(page);
  await confirmation(page).getByRole('button', { name: 'Edit filter', exact: true }).click();
  await page.getByLabel('Enabled', { exact: true }).uncheck();
  await saveDialog(page);
  assert.equal(await confirmation(page).count(), 0);
  assert.equal(await page.locator('#origin ytd-rich-grid-media').isVisible(), true);
});

test('unchanged saves and same-page data updates retain the current confirmation', async t => {
  const page = await open(t, { rules: [] });
  await editOrigin(page);
  await saveDialog(page);
  assert.equal(await confirmation(page).getByRole('button', { name: 'Undo', exact: true }).evaluate(node => node === document.activeElement), true);
  await page.evaluate(() => window.dispatchEvent(new Event('yt-page-data-updated')));
  assert.equal(await confirmation(page).isVisible(), true);
  await confirmation(page).getByRole('button', { name: 'Edit filter', exact: true }).click();
  await saveDialog(page);
  assert.equal(await confirmation(page).count(), 1);
  await confirmation(page).getByRole('button', { name: 'Undo', exact: true }).click();
  assert.deepEqual(await page.evaluate(() => fixtureChannelAge.getRules()), []);
});

test('a moved confirmation cannot leave a blank or incorrectly exempted card', async t => {
  const page = await open(t, { rules: [] });
  await editOrigin(page);
  await saveDialog(page);
  await page.evaluate(() => document.body.append(document.querySelector('.ytms-channel-filter-confirmation')));
  await page.waitForFunction(() => !document.querySelector('[data-ytms-channel-filter-confirmation]'));
  assert.equal(await page.locator('.ytms-channel-filter-confirmation').count(), 0);
  await hidden(page, 'origin', true);
});
