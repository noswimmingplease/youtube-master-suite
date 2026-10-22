import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { after, before, test } from "node:test";
import { createChannelAgeService } from "../../sources/channel-age.mjs";
import { launchFixtureBrowser } from "./fixture-browser.mjs";

const FEED = readFileSync(new URL("../../sources/modules/youtube-feed-ui-cleaner.user.js", import.meta.url), "utf8");
const PLAYER = readFileSync(new URL("../../sources/modules/youtube-player-preferences-lite.user.js", import.meta.url), "utf8");
const ID = "UCaaaaaaaaaaaaaaaaaaaaaa";
const NOW = Date.UTC(2026, 9, 21, 12);
let browser;
before(async () => { browser = await launchFixtureBrowser(); }, { timeout: 30000 });
after(async () => { await browser?.close(); }, { timeout: 10000 });

async function settle(page, count = 4) {
  await page.evaluate(count => new Promise(resolve => {
    function next() { if (--count === 0) resolve(); else requestAnimationFrame(next); }
    requestAnimationFrame(next);
  }), count);
}

async function open(t, { count = 2, route = "/", playerQueue = false } = {}) {
  const context = await browser.newContext({ viewport: { width: 1200, height: 900 }, serviceWorkers: "block" });
  const page = await context.newPage();
  const url = `https://www.youtube.com${route}`;
  const wrapper = route.startsWith("/results")
    ? '<ytd-two-column-search-results-renderer><div id="contents"></div></ytd-two-column-search-results-renderer>'
    : '<ytd-browse><ytd-rich-grid-renderer><div id="contents"></div></ytd-rich-grid-renderer></ytd-browse>';
  await context.route("**/*", route => route.request().url() === url ? route.fulfill({ contentType: "text/html",
    body: `<!doctype html><html lang="en-GB"><style>ytd-browse,ytd-rich-grid-renderer,ytd-two-column-search-results-renderer,ytd-rich-item-renderer,ytd-rich-grid-media{display:block}ytd-rich-item-renderer{min-height:40px}</style><body>${wrapper}</body></html>` }) : route.abort());
  page.setDefaultTimeout(6000);
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  t.after(async () => {
    try { assert.deepEqual(errors, []); }
    finally { await context.close(); }
  });
  await page.goto(url);
  await page.evaluate(({ id, count }) => {
    window.feedAuditReset = () => { window.feedAudit = { cleanups: [], scans: 0, ages: 0, contains: 0 }; };
    window.feedAuditReset();
    const contains = Node.prototype.contains;
    Node.prototype.contains = function (...args) { window.feedAudit.contains += 1; return contains.apply(this, args); };
    localStorage.setItem("yt-master-suite.channel-age.v1", JSON.stringify({ version: 1,
      rules: [{ channelId: id, name: "Fixture", maxAge: 1, unit: "weeks", enabled: true }] }));
    for (let index = 0; index < count; index += 1) {
      const card = document.createElement("ytd-rich-item-renderer");
      card.id = `card-${index}`;
      card.innerHTML = `<ytd-rich-grid-media><a href="/watch?v=aaaaaaaaaaa">Video ${index}</a>
        <div id="channel-name"><a href="/channel/${id}">Fixture</a></div><div id="metadata-line"><span class="views">1K views</span><span class="date">${index % 2 ? "2 weeks ago" : "1 hour ago"}</span></div></ytd-rich-grid-media>`;
      document.querySelector("#contents").append(card);
    }
  }, { id: ID, count });
  const source = FEED
    .replace("function cleanUp(root = document) {", "function cleanUp(root = document) { window.feedAudit.cleanups.push(root.id || root.nodeName);")
    .replace("function getFilteredContainers() {", "function getFilteredContainers() { window.feedAudit.scans += 1;")
    .replace("  GM_addStyle(buildCss());", `window.feedQueueProbe = { schedule: scheduleCleanUp, pause: () => observer.disconnect() };\n  GM_addStyle(buildCss());`);
  await page.addScriptTag({ content: `const suite={channelAge:(${createChannelAgeService.toString()})(()=>localStorage,()=>${NOW})};
    const age = suite.channelAge.cardFilterReason; suite.channelAge.cardFilterReason = card => { window.feedAudit.ages += 1; return age(card); };
    function GM_addStyle(css){const style=document.createElement('style');style.textContent=css;document.head.append(style);}
    ${source}` });
  if (playerQueue) {
    const player = PLAYER
      .replace("function applyDynamicPreferences(root = document) {", "function applyDynamicPreferences(root = document) { window.playerQueueAudit.push(root.id || root.nodeName);")
      .replace("  applyRoutePreferences();\n\n  const observer", "  window.playerQueueProbe = { schedule: scheduleApply, pause: () => observer.disconnect() };\n  applyRoutePreferences();\n\n  const observer");
    await page.addScriptTag({ content: `window.playerQueueAudit=[];${player}` });
  }
  await settle(page);
  await page.evaluate(() => window.feedAuditReset());
  assert.equal(await page.locator("html").getAttribute("lang"), "en-GB");
  return page;
}

for (const route of ["/", "/results?search_query=fixture"]) {
  test(`unchanged view-count text reconciles locally without rescanning 500 feed cards on ${route}`, async t => {
    const page = await open(t, { count: 500, route });
    const before = await page.locator("#yt-master-filter-toggle").textContent();
    await page.evaluate(async () => {
      const views = document.querySelector("#card-0 .views");
      for (let index = 0; index < 30; index += 1) {
        if (index % 2) views.textContent = `${index + 2}K views`;
        else views.firstChild.data = `${index + 2}K views`;
        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      }
    });
    const audit = await page.evaluate(() => window.feedAudit);
    assert.equal(audit.cleanups.length, 30);
    assert.equal(audit.ages, 30);
    assert.equal(audit.scans, 0);
    assert.equal(await page.locator("#yt-master-filter-toggle").textContent(), before);
  });
}

test("dates and membership text still update hidden state and reason summaries", async t => {
  const page = await open(t);
  const title = () => page.locator("#yt-master-filter-toggle").getAttribute("title");
  await page.evaluate(() => { document.querySelector("#card-0 .date").firstChild.data = "3 weeks ago"; });
  await page.waitForFunction(() => document.getElementById("yt-master-filter-toggle").title === "Channel age: 2");
  await page.evaluate(() => {
    const row = document.createElement("div"); row.id = "member";
    row.className = "ytContentMetadataViewModelMetadataRow ytContentMetadataViewModelMetadataRowMetadataRowWrap";
    row.textContent = "Members only"; document.querySelector("#card-0 ytd-rich-grid-media").append(row);
  });
  await page.waitForFunction(() => document.getElementById("yt-master-filter-toggle").title.includes("Members only: 1"));
  await page.evaluate(() => { document.querySelector("#card-0 .date").textContent = "1 hour ago"; });
  await page.waitForFunction(() => document.getElementById("yt-master-filter-toggle").title === "Channel age: 1, Members only: 1");
  await page.evaluate(() => { document.getElementById("member").firstChild.data = "Public"; });
  await page.waitForFunction(() => !document.getElementById("card-0").hasAttribute("data-clean-up-youtube-hidden"));
  await page.waitForFunction(() => document.getElementById("yt-master-filter-toggle").title === "Channel age: 1");
  assert.equal(await title(), "Channel age: 1");
});

test("stable hidden-card metadata changes make no redundant filter attribute writes", async t => {
  const page = await open(t);
  const writes = await page.evaluate(async () => {
    let writes = 0;
    const card = document.getElementById("card-1");
    const observer = new MutationObserver(records => { writes += records.length; });
    observer.observe(card, { attributes: true, attributeFilter: ["data-clean-up-youtube-hidden", "data-clean-up-youtube-reason", "data-clean-up-youtube-permanent-hidden"] });
    card.querySelector(".views").textContent = "20K views";
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    observer.disconnect();
    return writes;
  });
  assert.equal(writes, 0);
  assert.equal(await page.evaluate(() => window.feedAudit.scans), 0);
});

for (const [attribute, reason] of [["data-ytppl-watched-hidden", "Watched"], ["data-ytppl-upcoming-hidden", "Upcoming"], ["data-ytppl-pay-to-watch-hidden", "Pay to watch"]]) {
  test(`external ${attribute} changes invalidate the filtered summary`, async t => {
    const page = await open(t);
    await page.evaluate(attribute => document.getElementById("card-0").setAttribute(attribute, "1"), attribute);
    await page.waitForFunction(reason => document.getElementById("yt-master-filter-toggle").title.includes(`${reason}: 1`), reason);
    await page.evaluate(attribute => document.getElementById("card-0").removeAttribute(attribute), attribute);
    await page.waitForFunction(() => document.getElementById("yt-master-filter-toggle").title === "Channel age: 1");
    assert.ok(await page.evaluate(() => window.feedAudit.scans >= 2));
  });
}

test("pre-filtered inserted cards, removed cards and a removed whole feed update the summary", async t => {
  const page = await open(t);
  await page.evaluate(() => { const card = document.getElementById("card-1").cloneNode(true); card.id = "extra"; document.querySelector("#contents").append(card); });
  await page.waitForFunction(() => document.getElementById("yt-master-filter-toggle").title === "Channel age: 2");
  await page.evaluate(() => document.getElementById("extra").remove());
  await page.waitForFunction(() => document.getElementById("yt-master-filter-toggle").title === "Channel age: 1");
  await page.evaluate(() => document.querySelector("ytd-browse").remove());
  await page.waitForFunction(() => !document.getElementById("yt-master-filter-toggle"));
});

test("reveal clicks and route reconciliation retain explicit summary refreshes", async t => {
  const page = await open(t);
  await page.locator("#yt-master-filter-toggle").click();
  await page.waitForFunction(() => document.getElementById("yt-master-filter-toggle").getAttribute("aria-pressed") === "true");
  assert.equal(await page.locator("#card-1").isVisible(), true);
  await page.evaluate(() => window.dispatchEvent(new Event("yt-navigate-finish")));
  await page.waitForFunction(() => document.getElementById("yt-master-filter-toggle").getAttribute("aria-pressed") === "false");
  assert.equal(await page.locator("#card-1").isVisible(), false);
  assert.ok(await page.evaluate(() => window.feedAudit.scans >= 2));
});

test("500 sibling roots are retained without pairwise containment checks", async t => {
  const page = await open(t, { count: 500 });
  await page.evaluate(() => {
    window.feedQueueProbe.pause(); window.feedAuditReset();
    document.querySelectorAll("ytd-rich-item-renderer").forEach(card => window.feedQueueProbe.schedule(card));
  });
  await settle(page);
  const audit = await page.evaluate(() => window.feedAudit);
  assert.equal(audit.cleanups.length, 500);
  assert.equal(audit.ages, 500);
  assert.equal(audit.contains, 0);
  assert.equal(audit.scans, 0);
});

test("a currently nested queued root is subsumed by its queued ancestor", async t => {
  const page = await open(t);
  await page.evaluate(() => {
    window.feedQueueProbe.pause();
    const contents = document.querySelector("#contents");
    window.feedQueueProbe.schedule(document.getElementById("card-0"));
    window.feedQueueProbe.schedule(contents);
    window.feedQueueProbe.schedule(document.getElementById("card-1"));
  });
  await settle(page);
  assert.deepEqual(await page.evaluate(() => window.feedAudit.cleanups), ["contents"]);
});

test("a root moved outside its queued ancestor before flush is not lost", async t => {
  const page = await open(t);
  await page.evaluate(() => {
    window.feedQueueProbe.pause();
    const contents = document.querySelector("#contents"), card = document.getElementById("card-0");
    const wrapper = document.createElement("div"); wrapper.id = "wrapper"; contents.append(wrapper); wrapper.append(card);
    window.feedQueueProbe.schedule(card); window.feedQueueProbe.schedule(wrapper);
    contents.append(card);
  });
  await settle(page);
  assert.deepEqual(await page.evaluate(() => window.feedAudit.cleanups), ["card-0", "wrapper"]);
});

test("a root moved inside another queued root before flush is reconciled only once", async t => {
  const page = await open(t);
  await page.evaluate(() => {
    window.feedQueueProbe.pause();
    const contents = document.querySelector("#contents"), card = document.getElementById("card-0");
    const wrapper = document.createElement("div"); wrapper.id = "wrapper"; contents.append(wrapper);
    window.feedQueueProbe.schedule(card); window.feedQueueProbe.schedule(wrapper); wrapper.append(card);
  });
  await settle(page);
  assert.deepEqual(await page.evaluate(() => window.feedAudit.cleanups), ["wrapper"]);
});

test("disconnected roots are skipped and surviving roots retain insertion order", async t => {
  const page = await open(t, { count: 4 });
  await page.evaluate(() => {
    window.feedQueueProbe.pause();
    for (const id of ["card-2", "card-0", "card-1"]) window.feedQueueProbe.schedule(document.getElementById(id));
    document.getElementById("card-0").remove();
  });
  await settle(page);
  assert.deepEqual(await page.evaluate(() => window.feedAudit.cleanups), ["card-2", "card-1"]);
});

test("a queued document dominates individual light-DOM roots", async t => {
  const page = await open(t);
  await page.evaluate(() => {
    window.feedQueueProbe.pause(); window.feedQueueProbe.schedule(document.getElementById("card-0"));
    window.feedQueueProbe.schedule(document); window.feedQueueProbe.schedule(document.getElementById("card-1"));
  });
  await settle(page);
  assert.deepEqual(await page.evaluate(() => window.feedAudit.cleanups), ["#document"]);
  assert.equal(await page.evaluate(() => window.feedAudit.scans), 1);
});

test("a queued document does not subsume a connected shadow-tree feed root", async t => {
  const page = await open(t);
  await page.evaluate(() => {
    window.feedQueueProbe.pause();
    const host = document.createElement("div"); document.querySelector("#contents").append(host);
    const shadow = host.attachShadow({ mode: "open" });
    const root = document.createElement("div"); root.id = "shadow-root"; shadow.append(root);
    window.feedQueueProbe.schedule(root); window.feedQueueProbe.schedule(document);
  });
  await settle(page);
  assert.deepEqual(await page.evaluate(() => window.feedAudit.cleanups), ["shadow-root", "#document"]);
});

for (const module of ["feed", "player"]) {
  test(`${module} queued ancestor checks stop at shadow boundaries`, async t => {
    const page = await open(t, { playerQueue: module === "player" });
    await page.evaluate(module => {
      window.feedQueueProbe.pause(); window.playerQueueProbe?.pause(); window.playerQueueAudit = [];
      const host = document.createElement("div"); host.id = "shadow-host"; document.querySelector("#contents").append(host);
      const shadow = host.attachShadow({ mode: "open" });
      const root = document.createElement("div"); root.id = "shadow-root"; shadow.append(root);
      const queue = module === "feed" ? window.feedQueueProbe : window.playerQueueProbe;
      queue.schedule(host); queue.schedule(root);
    }, module);
    await settle(page);
    assert.deepEqual(await page.evaluate(module => module === "feed" ? window.feedAudit.cleanups : window.playerQueueAudit, module), ["shadow-host", "shadow-root"]);
  });

  test(`${module} retains a connected descendant moved out of a detached queued ancestor`, async t => {
    const page = await open(t, { playerQueue: module === "player" });
    await page.evaluate(module => {
      window.feedQueueProbe.pause(); window.playerQueueProbe?.pause(); window.playerQueueAudit = [];
      const contents = document.querySelector("#contents"), card = document.getElementById("card-0");
      const wrapper = document.createElement("div"); wrapper.id = "wrapper"; contents.append(wrapper); wrapper.append(card);
      const queue = module === "feed" ? window.feedQueueProbe : window.playerQueueProbe;
      queue.schedule(wrapper); queue.schedule(card); wrapper.remove(); contents.append(card);
    }, module);
    await settle(page);
    assert.deepEqual(await page.evaluate(module => module === "feed" ? window.feedAudit.cleanups : window.playerQueueAudit, module), ["card-0"]);
  });
}

test("Player Preferences retains 500 sibling roots without pairwise containment checks", async t => {
  const page = await open(t, { count: 500, playerQueue: true });
  await page.evaluate(() => {
    window.feedQueueProbe.pause(); window.playerQueueProbe.pause();
    window.feedAuditReset(); window.playerQueueAudit = [];
    document.querySelectorAll("ytd-rich-item-renderer").forEach(card => window.playerQueueProbe.schedule(card));
  });
  await settle(page);
  assert.equal(await page.evaluate(() => window.playerQueueAudit.length), 500);
  assert.equal(await page.evaluate(() => window.feedAudit.contains), 0);
});

for (const moveInside of [false, true]) {
  test(`Player Preferences classifies reparented queued roots at flush: ${moveInside ? "inside" : "outside"}`, async t => {
    const page = await open(t, { playerQueue: true });
    await page.evaluate(moveInside => {
      window.feedQueueProbe.pause(); window.playerQueueProbe.pause(); window.playerQueueAudit = [];
      const contents = document.querySelector("#contents"), card = document.getElementById("card-0");
      const wrapper = document.createElement("div"); wrapper.id = "wrapper"; contents.append(wrapper);
      if (!moveInside) wrapper.append(card);
      window.playerQueueProbe.schedule(card); window.playerQueueProbe.schedule(wrapper);
      if (moveInside) wrapper.append(card); else contents.append(card);
    }, moveInside);
    await settle(page);
    assert.deepEqual(await page.evaluate(() => window.playerQueueAudit), moveInside ? ["wrapper"] : ["card-0", "wrapper"]);
  });
}
