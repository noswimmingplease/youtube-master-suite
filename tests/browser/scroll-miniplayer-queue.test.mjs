import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { after, before, test } from "node:test";
import { launchFixtureBrowser } from "./fixture-browser.mjs";

const MINIPLAYER = readFileSync(new URL("../../sources/modules/youtube-scroll-miniplayer.user.js", import.meta.url), "utf8");
const FIXTURE = readFileSync(new URL("./watch-page.html", import.meta.url), "utf8");
const WATCH_URL = "https://www.youtube.com/watch?v=aaaaaaaaaaa&list=fixture-queue";
let browser;

before(async () => { browser = await launchFixtureBrowser(); }, { timeout: 30000 });
after(async () => { await browser?.close(); }, { timeout: 10000 });

async function openFloatingFixture(t, viewport) {
  const context = await browser.newContext({ viewport, serviceWorkers: "block" });
  await context.route("**/*", route => route.request().url() === WATCH_URL
    ? route.fulfill({ contentType: "text/html", body: FIXTURE }) : route.abort());
  const page = await context.newPage();
  page.setDefaultTimeout(7000);
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  t.after(async () => {
    try { assert.deepEqual(errors, []); }
    finally { await context.close(); }
  });
  await page.goto(WATCH_URL);
  await page.evaluate(() => {
    const playerHost = document.getElementById("player");
    const anchor = document.createElement("div");
    anchor.id = "single-column-container";
    playerHost.before(anchor);
    anchor.append(playerHost);
    const player = document.getElementById("movie_player");
    const chrome = document.createElement("div");
    chrome.className = "ytp-chrome-bottom";
    chrome.style.cssText = "position:absolute;bottom:0;height:48px";
    const progress = document.createElement("div");
    progress.className = "ytp-progress-bar-container";
    progress.style.cssText = "position:absolute;top:0;width:100%;height:4px;background:red";
    progress.addEventListener("click", () => { window.fixture.seekClicks = (window.fixture.seekClicks || 0) + 1; });
    chrome.append(progress, player.querySelector(".ytp-right-controls"));
    player.append(chrome);
    const panel = document.querySelector("ytd-playlist-panel-renderer");
    for (const id of ["aaaaaaaaaaa", "bbbbbbbbbbb"]) {
      const item = document.createElement("ytd-playlist-panel-video-renderer");
      const link = document.createElement("a");
      link.href = `/watch?v=${id}`;
      const title = document.createElement("span");
      title.id = "video-title";
      title.textContent = id === "aaaaaaaaaaa" ? "Video A with a deliberately long queue title" : "Video B";
      link.append(title); item.append(link); panel.append(item);
    }
  });
  await page.addScriptTag({ content: MINIPLAYER });
  await page.evaluate(() => window.scrollTo(0, 800));
  await page.locator("#ytsmp-compact-queue-info").waitFor({ state: "visible" });
  return page;
}

async function assertTopStrip(page) {
  const geometry = await page.evaluate(() => {
    const player = document.getElementById("movie_player");
    const strip = document.getElementById("ytsmp-compact-queue-info");
    const corner = document.getElementById("ytsmp-corner-button");
    const bounds = element => {
      const { x, y, width, height } = element.getBoundingClientRect();
      return { x, y, width, height };
    };
    return {
      player: bounds(player), strip: bounds(strip), corner: bounds(corner),
      progress: bounds(player.querySelector(".ytp-progress-bar-container")),
      chrome: bounds(player.querySelector(".ytp-chrome-bottom")),
      pointerEvents: getComputedStyle(strip).pointerEvents,
      overflow: getComputedStyle(strip).overflow,
      role: strip.getAttribute("role"), live: strip.getAttribute("aria-live"),
      titleOverflow: getComputedStyle(strip.querySelector(".ytsmp-queue-title")).textOverflow,
    };
  });
  assert.equal(geometry.strip.y - geometry.player.y, 8, "Queue status belongs at the top of the floating player");
  assert.equal(geometry.strip.x - geometry.player.x, 12);
  assert.ok(geometry.corner.x - (geometry.strip.x + geometry.strip.width) >= 12, "Status leaves room for permanent corner and close controls");
  assert.ok(geometry.strip.y + geometry.strip.height < geometry.progress.y, "Status must not cover the native progress bar");
  assert.equal(geometry.chrome.y + geometry.chrome.height, geometry.player.y + geometry.player.height, "Native playback chrome stays at the bottom");
  assert.equal(geometry.pointerEvents, "none");
  assert.equal(geometry.overflow, "hidden", "Narrow-player labels cannot spill into the corner controls");
  assert.equal(geometry.role, "status");
  assert.equal(geometry.live, "polite");
  assert.equal(geometry.titleOverflow, "ellipsis");
  return geometry;
}

test("floating queue status remains above playback controls in all four corners", async t => {
  const page = await openFloatingFixture(t, { width: 1280, height: 900 });
  assert.equal(await page.locator(".ytsmp-queue-position").textContent(), "Queue 1 / 2");
  for (const corner of ["top-left", "top-right", "bottom-left", "bottom-right"]) {
    await page.locator("#ytsmp-corner-button").click();
    const option = page.locator(`.ytsmp-corner-option[data-corner="${corner}"]`);
    if (await option.count()) await option.click();
    else await page.locator("#ytsmp-corner-button").press("Escape");
    await assertTopStrip(page);
  }
  const { progress } = await assertTopStrip(page);
  await page.mouse.click(progress.x + progress.width / 2, progress.y + progress.height / 2);
  assert.equal(await page.evaluate(() => window.fixture.seekClicks), 1, "Native seek-bar input remains reachable");
  await page.locator("#ytsmp-close-button").click();
  await page.locator("#ytsmp-compact-queue-info").waitFor({ state: "detached" });
  assert.equal(await page.locator("#player #movie_player").count(), 1, "Closing still restores the original player host");
});

test("narrow floating miniplayer keeps its top status within the player and clear of playback controls", async t => {
  const page = await openFloatingFixture(t, { width: 375, height: 720 });
  const { player, strip } = await assertTopStrip(page);
  assert.ok(strip.width > 0 && strip.x >= player.x && strip.x + strip.width <= player.x + player.width,
    JSON.stringify({ player, strip }));
  assert.equal(await page.locator(".ytsmp-queue-title").textContent(), "Video A with a deliberately long queue title");
});
