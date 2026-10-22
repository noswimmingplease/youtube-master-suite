import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { after, before, test } from "node:test";
import { createChannelAgeService } from "../../sources/channel-age.mjs";
import { launchFixtureBrowser } from "./fixture-browser.mjs";

const FEED = readFileSync(new URL("../../sources/modules/youtube-feed-ui-cleaner.user.js", import.meta.url), "utf8");
const PLAYER = readFileSync(new URL("../../sources/modules/youtube-player-preferences-lite.user.js", import.meta.url), "utf8");
const ID = "UCaaaaaaaaaaaaaaaaaaaaaa";
const OTHER_ID = "UCbbbbbbbbbbbbbbbbbbbbbb";
const NOW = Date.UTC(2026, 9, 21, 12);
const HTML = `<!doctype html><html lang="en-GB"><head><style>
ytd-app,ytd-browse,ytd-rich-grid-renderer,ytd-rich-item-renderer,ytd-rich-grid-media,ytd-video-preview {display:block}
ytd-rich-item-renderer {min-height:60px}
</style></head><body><ytd-app><ytd-browse><ytd-rich-grid-renderer><div id="contents"></div></ytd-rich-grid-renderer></ytd-browse></ytd-app></body></html>`;
let browser;
before(async () => { browser = await launchFixtureBrowser(); }, { timeout: 30000 });
after(async () => { await browser?.close(); }, { timeout: 10000 });

function instrument(source, name, counter, argument = "root = document") {
  const marker = `function ${name}(${argument}) {`;
  assert.ok(source.includes(marker), `Missing ${name}`);
  return source.replace(marker, `${marker} window.previewAudit.${counter} += 1;`);
}

async function settle(page, count = 4) {
  await page.evaluate(count => new Promise(resolve => {
    function next() { if (--count === 0) resolve(); else requestAnimationFrame(next); }
    requestAnimationFrame(next);
  }), count);
}

async function open(t, { knownHost = true, nativePlayer = true } = {}) {
  const context = await browser.newContext({ viewport: { width: 1200, height: 900 }, serviceWorkers: "block" });
  const url = "https://www.youtube.com/";
  await context.route("**/*", route => route.request().url() === url
    ? route.fulfill({ contentType: "text/html", body: HTML }) : route.abort());
  const page = await context.newPage();
  page.setDefaultTimeout(6000);
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  t.after(async () => {
    try { assert.deepEqual(errors, []); }
    finally { await context.close(); }
  });
  await page.goto(url);
  await page.evaluate(({ id, knownHost, nativePlayer }) => {
    window.previewAudit = { feedCleanups: 0, toggleScans: 0, dynamic: 0, upcoming: 0, pay: 0, watched: 0 };
    localStorage.setItem("yt-master-suite.channel-age.v1", JSON.stringify({ version: 1,
      rules: [{ channelId: id, name: "Fixture channel", maxAge: 1, unit: "weeks", enabled: true }] }));
    const card = document.createElement("ytd-rich-item-renderer");
    card.id = "fixture-card";
    card.innerHTML = `<ytd-rich-grid-media><a href="/watch?v=aaaaaaaaaaa">Fixture video</a>
      <div id="channel-name"><a href="/channel/${id}">Fixture channel</a></div>
      <div id="metadata-line"><span>1 hour ago</span></div>
      <ytd-thumbnail-overlay-resume-playback-renderer><div id="progress" style="width:10%"></div></ytd-thumbnail-overlay-resume-playback-renderer>
      <${knownHost ? "ytd-video-preview" : "div"} id="preview-host"><div class="${nativePlayer ? "html5-video-player" : "ordinary-container"}">
        <div class="ytp-progress-bar-container"><div id="preview-progress" class="ytp-play-progress"></div></div>
        <div id="preview-captions" class="ytp-caption-window-container"><span class="ytp-caption-segment">Initial caption</span></div>
        <div id="preview-controls" class="ytp-chrome-controls"><button>Preview control</button></div>
      </div></${knownHost ? "ytd-video-preview" : "div"}></ytd-rich-grid-media>`;
    document.querySelector("#contents").append(card);
  }, { id: ID, knownHost, nativePlayer });
  let feed = instrument(FEED, "cleanUp", "feedCleanups");
  feed = instrument(feed, "getFilteredContainers", "toggleScans", "");
  let player = instrument(PLAYER, "applyDynamicPreferences", "dynamic");
  for (const [name, counter] of [["hideUpcomingStreams", "upcoming"], ["hidePayToWatchCards", "pay"], ["hideWatchedVideos", "watched"]]) {
    player = instrument(player, name, counter);
  }
  await page.addScriptTag({ content: `
    const suite = { channelAge: (${createChannelAgeService.toString()})(() => localStorage, () => ${NOW}) };
    function GM_addStyle(css) { const style = document.createElement('style'); style.textContent = css; document.head.append(style); }
    ${feed}
    ${player}` });
  await settle(page);
  await page.evaluate(() => { for (const name of Object.keys(window.previewAudit)) window.previewAudit[name] = 0; });
  assert.equal(await page.locator("html").getAttribute("lang"), "en-GB");
  return page;
}

test("30 native preview playback updates do no feed filtering or whole-feed toggle scans", async t => {
  const page = await open(t);
  await page.evaluate(async () => {
    for (let index = 0; index < 30; index += 1) {
      document.getElementById("preview-progress").style.transform = `scaleX(${(index + 1) / 100})`;
      document.querySelector("#preview-captions .ytp-caption-segment").textContent = `Caption ${index}`;
      document.getElementById("preview-controls").setAttribute("aria-label", `Preview controls ${index}`);
      document.querySelector("#preview-controls button").textContent = `Control ${index}`;
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    }
  });
  assert.deepEqual(await page.evaluate(() => window.previewAudit),
    { feedCleanups: 0, toggleScans: 0, dynamic: 0, upcoming: 0, pay: 0, watched: 0 });
  assert.equal(await page.locator("#fixture-card").isVisible(), true);
  assert.equal(await page.locator(".ytp-caption-segment").evaluate(node => getComputedStyle(node).color), "rgb(255, 227, 110)");
});

test("real thumbnail resume progress still filters and reveals the feed card in both directions", async t => {
  const page = await open(t);
  await page.evaluate(() => { document.querySelector("ytd-thumbnail-overlay-resume-playback-renderer #progress").style.width = "95%"; });
  await page.waitForFunction(() => document.getElementById("fixture-card").getAttribute("data-ytppl-watched-hidden") === "1");
  await page.locator("#yt-master-filter-toggle").waitFor();
  assert.match(await page.locator("#yt-master-filter-toggle").getAttribute("title"), /Watched: 1/);
  await page.evaluate(() => { document.querySelector("ytd-thumbnail-overlay-resume-playback-renderer #progress").style.width = "10%"; });
  await page.waitForFunction(() => !document.getElementById("fixture-card").hasAttribute("data-ytppl-watched-hidden"));
  assert.equal(await page.locator("#fixture-card").isVisible(), true);
  assert.ok(await page.evaluate(() => window.previewAudit.watched > 0));
});

test("channel, date and membership changes outside preview playback still reconcile", async t => {
  const page = await open(t);
  await page.evaluate(() => { document.querySelector("#metadata-line span").firstChild.data = "3 weeks ago"; });
  await page.waitForFunction(() => document.getElementById("fixture-card").getAttribute("data-clean-up-youtube-reason") === "Channel age");
  await page.evaluate(id => { document.querySelector("#channel-name a").href = `/channel/${id}`; }, OTHER_ID);
  await page.waitForFunction(() => !document.getElementById("fixture-card").hasAttribute("data-clean-up-youtube-hidden"));
  await page.evaluate(id => { document.querySelector("#channel-name a").href = `/channel/${id}`; }, ID);
  await page.waitForFunction(() => document.getElementById("fixture-card").getAttribute("data-clean-up-youtube-reason") === "Channel age");
  await page.evaluate(() => {
    document.querySelector("#metadata-line span").firstChild.data = "1 hour ago";
    const row = document.createElement("div");
    row.id = "membership-row";
    row.className = "ytContentMetadataViewModelMetadataRow ytContentMetadataViewModelMetadataRowMetadataRowWrap";
    row.textContent = "Members only";
    document.querySelector("ytd-rich-grid-media").append(row);
  });
  await page.waitForFunction(() => document.getElementById("fixture-card").getAttribute("data-clean-up-youtube-reason") === "Members only");
  await page.evaluate(() => document.getElementById("membership-row").remove());
  await page.waitForFunction(() => !document.getElementById("fixture-card").hasAttribute("data-clean-up-youtube-hidden"));
  assert.equal(await page.locator("#fixture-card").isVisible(), true);
});

test("outer card recycling and removal are processed even when the card contains a native preview", async t => {
  const page = await open(t);
  await page.evaluate(() => {
    const previous = document.getElementById("fixture-card");
    const next = previous.cloneNode(true);
    next.querySelector("#metadata-line span").textContent = "3 weeks ago";
    previous.replaceWith(next);
  });
  await page.waitForFunction(() => document.getElementById("fixture-card").getAttribute("data-clean-up-youtube-reason") === "Channel age");
  await page.evaluate(() => {
    const previous = document.getElementById("fixture-card");
    const next = previous.cloneNode(true);
    next.querySelector("#metadata-line span").textContent = "1 hour ago";
    previous.replaceWith(next);
  });
  await page.waitForFunction(() => !document.getElementById("fixture-card").hasAttribute("data-clean-up-youtube-hidden"));
  await page.evaluate(() => document.getElementById("fixture-card").remove());
  await settle(page);
  assert.equal(await page.locator("#yt-master-filter-toggle").count(), 0);
  assert.ok(await page.evaluate(() => window.previewAudit.feedCleanups > 0 && window.previewAudit.dynamic > 0));
});

for (const options of [{ knownHost: false }, { nativePlayer: false }]) {
  test(`unrecognised preview-like markup is not excluded: ${JSON.stringify(options)}`, async t => {
    const page = await open(t, options);
    await page.evaluate(() => { document.querySelector("#preview-captions .ytp-caption-segment").textContent = "Changed"; });
    await settle(page);
    const audit = await page.evaluate(() => window.previewAudit);
    assert.ok(audit.feedCleanups > 0);
    assert.equal(audit.toggleScans, 0, "Unchanged caption text still reconciles locally without refreshing the summary");
    assert.ok(audit.dynamic > 0);
    assert.ok(audit.watched > 0);
  });
}
