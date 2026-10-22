import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { after, before, test } from "node:test";
import { launchFixtureBrowser, waitForSuiteHealth } from "./fixture-browser.mjs";

const SUITE = readFileSync(new URL("../../youtube-master-suite.user.js", import.meta.url), "utf8");
const MANIFEST = JSON.parse(readFileSync(new URL("../../release-manifest.json", import.meta.url), "utf8"));
const FIXTURE = readFileSync(new URL("./watch-page.html", import.meta.url), "utf8");
const WATCH_URL = "https://www.youtube.com/watch?v=aaaaaaaaaaa&list=fixture-queue";
let browser;

before(async () => {
  assert.equal(createHash("sha256").update(SUITE).digest("hex"), MANIFEST.sha256);
  browser = await launchFixtureBrowser();
}, { timeout: 30000 });
after(async () => { await browser?.close(); }, { timeout: 10000 });

async function openFixture(t, settings) {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 720 }, serviceWorkers: "block",
  });
  // No requests reach YouTube or other services; use an isolated, disposable profile.
  await context.route("**/*", route => route.request().url() === WATCH_URL
    ? route.fulfill({ contentType: "text/html", body: FIXTURE })
    : route.abort());
  const content = settings === undefined ? SUITE :
    `localStorage.setItem("yt-master-suite.settings.v1", ${JSON.stringify(JSON.stringify({ version: 1, values: settings }))});\n${SUITE}`;
  await context.addInitScript({ content });
  const page = await context.newPage();
  page.setDefaultTimeout(10000);
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  t.after(async () => {
    try {
      assert.deepEqual(errors, [], "The complete generated suite must have no uncaught page errors");
      const runtimeErrors = await page.getAttribute("html", "data-yt-master-runtime-errors");
      assert.ok(!runtimeErrors || runtimeErrors === "[]", `Suite runtime errors: ${runtimeErrors}`);
    } finally {
      await context.close();
    }
  });
  await page.goto(WATCH_URL);
  await waitForSuiteHealth(page, MANIFEST.registeredModules, { timeoutMs: 10000, requireReady: true, errors });
  return page;
}

async function openMenu(page) {
  await page.locator("video").click({ button: "right" });
  await page.locator(".ytp-contextmenu").waitFor({ state: "visible" });
}

test("Firefox native pointer copy cleans the URL and preserves timestamp copying", { timeout: 20000 }, async t => {
  const page = await openFixture(t);
  await openMenu(page);
  await page.locator("#copy-url").click();
  assert.deepEqual(await page.evaluate(() => fixture.copies[0]), {
    trusted: true, customised: true, value: "https://youtu.be/aaaaaaaaaaa",
  });
  assert.equal(await page.evaluate(() => fixture.copyResults[0]), true);
  await page.locator(".ytp-contextmenu").waitFor({ state: "hidden" });
  await openMenu(page);
  await page.locator("#copy-time").click();
  assert.deepEqual(await page.evaluate(() => fixture.copies[1]), {
    trusted: true, customised: false,
    value: "https://youtu.be/aaaaaaaaaaa?list=fixture-queue&index=2&t=90",
  });
  assert.equal(await page.evaluate(() => fixture.copyResults[1]), true);
  await page.locator(".ytp-contextmenu").waitFor({ state: "hidden" });
});

test("Firefox trusted keyboard selection survives the native synthetic menu click", { timeout: 20000 }, async t => {
  const page = await openFixture(t);
  for (const key of ["Enter", "Space", "ArrowRight"]) {
    await openMenu(page);
    await page.locator("#copy-url").focus();
    await page.keyboard.press(key);
    await page.locator(".ytp-contextmenu").waitFor({ state: "hidden" });
  }
  const copies = await page.evaluate(() => fixture.copies);
  assert.equal(copies.length, 3);
  assert.ok(copies.every(copy => copy.trusted && copy.customised &&
    copy.value === "https://youtu.be/aaaaaaaaaaa"));
});

test("real DOM queue navigation replaces old comments and resets the mirror", { timeout: 20000 }, async t => {
  const page = await openFixture(t);
  await page.locator("#ytppl-video-mirror-button").click();
  assert.equal(await page.locator("video").evaluate(video => getComputedStyle(video).scale), "-1 1");
  assert.equal(await page.locator(".ytp-caption-window-container").evaluate(captions => getComputedStyle(captions).scale), "none");
  await page.locator("#next-video").click();
  await page.waitForFunction(() => document.querySelector("h1").textContent === "Video B" &&
    !document.querySelector("ytd-comments").hasAttribute("data-iow-stale-video"));
  assert.equal(await page.locator(".comment-message").innerText(), "Comment for Video B");
  assert.equal(await page.locator("ytd-comments").isVisible(), true);
  assert.equal(await page.locator("video").getAttribute("data-ytppl-video-mirrored"), null);
  await openMenu(page);
  await page.locator("#copy-url").click();
  assert.equal(await page.evaluate(() => fixture.copies.at(-1).value), "https://youtu.be/bbbbbbbbbbb");
});

test("a retained watch controller recovers current title and comments in the complete suite", { timeout: 20000 }, async t => {
  const page = await openFixture(t);
  await page.locator("#stalled-next-video").click();
  assert.equal(await page.locator("h1").innerText(), "Video A");
  await page.waitForFunction(() => document.querySelector("h1").textContent === "Video B" &&
    !document.querySelector("ytd-comments").hasAttribute("data-iow-stale-video"));
  assert.equal(await page.evaluate(() => fixture.completionCalls), 1);
  assert.equal(await page.locator(".comment-message").innerText(), "Comment for Video B");
  assert.equal(await page.locator("ytd-comments").evaluate(comments => getComputedStyle(comments).visibility), "visible");
});

test("clear-queue selection dispatches one accepted-response reload for retained comments", { timeout: 20000 }, async t => {
  const page = await openFixture(t);
  assert.equal(await page.locator(".comment-message").innerText(), "Comment for Video A");
  await page.evaluate(() => {
    fixture.originalCommentNodes = [...document.querySelectorAll('ytd-comment-thread-renderer')];
  });
  await page.locator("#clear-queue").click();
  assert.equal(await page.evaluate(() => fixture.queueClears), 1);
  assert.equal(new URL(page.url()).searchParams.has("list"), false);
  assert.equal(await page.locator(".comment-message").innerText(), "Comment for Video A");

  await page.locator("#select-video").click();
  const retained = await page.evaluate(() => {
    fixture.selectionObservedAt = performance.now();
    const state = globalThis.__YT_MASTER_STATE__.snapshot();
    return {
      urlVideoId: state.urlVideoId,
      playerVideoId: state.playerVideoId,
      flexyVideoId: state.flexyVideoId,
      watchControllerVideoId: state.watchControllerVideoId,
      metadataTitle: state.metadataTitle,
      nativeLoading: state.nativeLoading,
      commentVideoIds: state.commentVideoIds,
      confirmedCoherent: state.confirmedCoherent,
      completionCalls: fixture.completionCalls,
      originalNodesConnected: fixture.originalCommentNodes.every(node => node.isConnected),
    };
  });
  assert.deepEqual(retained, {
    urlVideoId: "bbbbbbbbbbb", playerVideoId: "bbbbbbbbbbb", flexyVideoId: "bbbbbbbbbbb",
    watchControllerVideoId: "bbbbbbbbbbb", metadataTitle: "Video B", nativeLoading: false,
    commentVideoIds: ["aaaaaaaaaaa"], confirmedCoherent: true,
    completionCalls: 0, originalNodesConnected: true,
  }, "coherent metadata/controller must not certify retained previous-video comments");
  assert.equal(await page.locator("ytd-comments").getAttribute("data-iow-stale-video"), "1");

  await page.waitForFunction(() => fixture.completionCalls === 1 && fixture.reloadCommentsPending);
  assert.deepEqual(await page.evaluate(() => {
    const state = globalThis.__YT_MASTER_STATE__.snapshot();
    return {
      loadingRecoveryStatus: state.loadingRecoveryStatus,
      commentVideoIds: state.commentVideoIds,
      originalNodesConnected: fixture.originalCommentNodes.every(node => node.isConnected),
      commentsReadyEvents: fixture.commentsReadyEvents,
    };
  }), {
    loadingRecoveryStatus: "pending", commentVideoIds: ["aaaaaaaaaaa"],
    originalNodesConnected: true, commentsReadyEvents: [],
  }, "native entry dispatch must remain pending until asynchronous comments are delivered");
  await page.waitForFunction(() => fixture.completionCalls === 1 &&
    document.querySelector('.comment-message').textContent === 'Comment for Video B' &&
    !document.querySelector('ytd-comments').hasAttribute('data-iow-stale-video') &&
    globalThis.__YT_MASTER_STATE__.snapshot().loadingRecoveryStatus === 'completed');
  assert.deepEqual(await page.evaluate(() => fixture.completionArguments), [true]);
  assert.deepEqual(await page.evaluate(() => fixture.responseEvents), [{
    type: "WATCH_NEXT_RESPONSE_RELOADED", videoId: "bbbbbbbbbbb", acceptedResponse: true,
  }], "same-response native entry must publish RELOADED using the exact accepted response");
  assert.equal(await page.evaluate(() => fixture.originalCommentNodes.every(node => !node.isConnected)), true);
  assert.deepEqual(await page.evaluate(() => globalThis.__YT_MASTER_STATE__.snapshot().commentVideoIds), ["bbbbbbbbbbb"]);
  assert.deepEqual(await page.evaluate(() => fixture.commentsReadyEvents), [{
    videoId: "bbbbbbbbbbb", acceptedResponse: true,
  }]);
  assert.equal(await page.locator("ytd-comments").isVisible(), true);

  // Let the former comments fail-open deadline and ordinary recovery checks
  // expire; repeat native progress without replenishing the generation budget.
  await page.waitForFunction(() => performance.now() - fixture.selectionObservedAt >= 8500);
  await page.evaluate(() => {
    window.dispatchEvent(new Event('yt-page-data-updated'));
    document.querySelector('video').dispatchEvent(new Event('loadedmetadata', { bubbles: true }));
    globalThis.__YT_MASTER_STATE__.check();
  });
  assert.equal(await page.evaluate(() => fixture.completionCalls), 1);
  assert.equal(await page.locator(".comment-message").innerText(), "Comment for Video B");
});

test("native page fullscreen scrolls to comments and releases its state on exit", { timeout: 20000 }, async t => {
  const page = await openFixture(t);
  await page.locator("#page-fullscreen").click();
  await page.waitForFunction(() => document.fullscreenElement === document.documentElement &&
    document.documentElement.hasAttribute("data-ytppl-fullscreen-comments"));
  assert.equal(await page.locator("ytd-app").evaluate(app => getComputedStyle(app).overflowY), "auto");
  const initialBounds = await page.locator(".comment-message").boundingBox();
  assert.ok(initialBounds, "The comment must have real layout geometry");
  await page.locator("video").hover();
  await page.mouse.wheel(0, Math.ceil(Math.max(200, initialBounds.y - 120)));
  await page.waitForFunction(() => {
    const bounds = document.querySelector(".comment-message").getBoundingClientRect();
    return document.querySelector("ytd-app").scrollTop > 0 &&
      bounds.bottom > 0 && bounds.top < innerHeight;
  });
  assert.equal(await page.evaluate(() => document.fullscreenElement === document.documentElement), true);
  const bounds = await page.locator(".comment-message").boundingBox();
  assert.ok(bounds && bounds.y + bounds.height > 0 && bounds.y < 720, "Comments must enter the fullscreen viewport");
  await page.evaluate(() => document.exitFullscreen());
  await page.waitForFunction(() => !document.fullscreenElement &&
    !document.documentElement.hasAttribute("data-ytppl-fullscreen-comments"));
});

test("native player-only fullscreen never enables page-comment scrolling", { timeout: 20000 }, async t => {
  const page = await openFixture(t);
  await page.locator(".ytp-fullscreen-button").click();
  await page.waitForFunction(() => document.fullscreenElement?.id === "movie_player");
  assert.equal(await page.locator("html").getAttribute("data-ytppl-fullscreen-comments"), null);
  assert.equal(await page.locator("ytd-app").getAttribute("fullscreen"), null);
  await page.evaluate(() => document.exitFullscreen());
  await page.waitForFunction(() => !document.fullscreenElement);
});

async function installQuickActionsFixture(page, { stamp = true } = {}) {
  await page.evaluate(({ stamp }) => {
    const player = document.getElementById("movie_player");
    const overlay = document.createElement("div");
    overlay.className = "ytp-overlay-bottom-right";
    player.append(overlay);
    fixture.stampQuickActions = () => {
      const strip = document.createElement("div");
      strip.id = "fixture-fullscreen-quick-actions";
      strip.className = "ytp-fullscreen-quick-actions";
      const actions = document.createElement("yt-player-quick-action-buttons");
      for (const label of ["Like", "Dislike", "Comments", "Share", "Ask", "More"]) {
        const button = document.createElement("button");
        button.textContent = label;
        actions.append(button);
      }
      strip.append(actions);
      const before = document.createElement("button");
      before.id = "fixture-quick-actions-before";
      before.textContent = "Before strip";
      const after = document.createElement("button");
      after.id = "fixture-quick-actions-after";
      after.textContent = "After strip";
      overlay.replaceChildren(before, strip, after);
    };
    if (stamp) fixture.stampQuickActions();

    const outside = document.createElement("div");
    outside.id = "fixture-quick-actions-outside-player";
    outside.className = "ytp-fullscreen-quick-actions";
    outside.textContent = "Outside-player decoy";
    document.body.append(outside);
    const title = document.createElement("div");
    title.id = "fixture-player-title";
    title.className = "ytp-title-text";
    title.textContent = "Player title";
    player.append(title);
    const chrome = document.createElement("div");
    chrome.className = "ytp-chrome-bottom";
    const progress = document.createElement("div");
    progress.id = "fixture-player-progress";
    progress.className = "ytp-progress-bar-container";
    progress.style.cssText = "height: 4px; width: 200px; background: red;";
    const play = document.createElement("button");
    play.id = "fixture-native-play";
    play.className = "ytp-play-button ytp-button";
    play.textContent = "Play";
    fixture.playClicks = 0;
    play.onclick = () => fixture.playClicks++;
    chrome.append(progress, play);
    player.append(chrome);
    for (const [id, className] of [
      ["fixture-autoplay", "ytp-autonav-endscreen-upnext-container"],
      ["fixture-endscreen", "ytp-endscreen-content"],
    ]) {
      const surface = document.createElement("div");
      surface.id = id;
      surface.className = className;
      surface.textContent = "Native playback surface";
      player.append(surface);
    }
    const like = document.createElement("button");
    like.id = "fixture-watch-like";
    like.textContent = "Like";
    document.querySelector("ytd-watch-metadata").append(like);
  }, { stamp });
}

async function assertQuickActionsScope(page) {
  assert.equal(await page.locator("#fixture-fullscreen-quick-actions").isVisible(), false,
    "The whole dedicated action strip must be removed from layout");
  assert.equal(await page.locator("#fixture-fullscreen-quick-actions").evaluate(strip => getComputedStyle(strip).display), "none");
  for (const selector of [
    "video", ".ytp-right-controls", ".ytp-settings-button", ".ytp-fullscreen-button",
    "#ytppl-video-mirror-button", "#ytms-player-settings-button", ".ytp-caption-window-container",
    "#fixture-player-title", "#fixture-player-progress", "#fixture-native-play", "#fixture-autoplay", "#fixture-endscreen",
  ]) assert.equal(await page.locator(selector).isVisible(), true, `${selector} must remain visible`);
  for (const selector of ["#fixture-watch-like", "#fixture-quick-actions-outside-player"]) {
    assert.notEqual(await page.locator(selector).evaluate(element => getComputedStyle(element).display), "none",
      `${selector} is outside the dedicated player strip`);
  }
  await page.locator("#fixture-quick-actions-before").focus();
  await page.keyboard.press("Tab");
  assert.equal(await page.locator("#fixture-quick-actions-after").evaluate(element => element === document.activeElement), true,
    "Keyboard navigation must skip every hidden quick-action button");
}

for (const mode of ["page", "player"]) {
  for (const hide of [undefined, false]) {
    test(`${mode} fullscreen keeps the native action strip visible when hiding is ${hide === undefined ? "unset" : "off"}`, { timeout: 20000 }, async t => {
      const page = await openFixture(t, hide === undefined ? undefined : { hideFullscreenQuickActions: hide });
      await installQuickActionsFixture(page);
      await page.locator(mode === "page" ? "#page-fullscreen" : ".ytp-fullscreen-button").click();
      await page.waitForFunction(mode => document.fullscreenElement ===
        (mode === "page" ? document.documentElement : document.getElementById("movie_player")), mode);
      assert.equal(await page.locator("#fixture-fullscreen-quick-actions").isVisible(), true);
      await page.locator("#fixture-quick-actions-before").focus();
      await page.keyboard.press("Tab");
      assert.equal(await page.locator("#fixture-fullscreen-quick-actions button").first().evaluate(element => element === document.activeElement), true);
      await page.evaluate(() => document.exitFullscreen());
      await page.waitForFunction(() => !document.fullscreenElement);
    });
  }

  test(`${mode} fullscreen removes only the dedicated quick-action strip and preserves playback controls`, { timeout: 20000 }, async t => {
    const page = await openFixture(t, { hideFullscreenQuickActions: true });
    await installQuickActionsFixture(page);
    await page.locator(mode === "page" ? "#page-fullscreen" : ".ytp-fullscreen-button").click();
    await page.waitForFunction(mode => document.fullscreenElement ===
      (mode === "page" ? document.documentElement : document.getElementById("movie_player")), mode);
    await assertQuickActionsScope(page);
    await page.locator("#fixture-native-play").click();
    assert.equal(await page.evaluate(() => fixture.playClicks), 1, "Native playback handler remains clickable");
    await page.locator("#ytppl-video-mirror-button").click();
    assert.equal(await page.locator("video").getAttribute("data-ytppl-video-mirrored"), "1");
    await page.evaluate(() => document.exitFullscreen());
    await page.waitForFunction(() => !document.fullscreenElement);
    assert.equal(await page.locator("#fixture-watch-like").isVisible(), true);
    assert.equal(await page.locator("#fixture-quick-actions-outside-player").isVisible(), true);
    await assertQuickActionsScope(page);
  });
}

test("late and replaced fullscreen quick actions stay hidden with fullscreen comments disabled", { timeout: 20000 }, async t => {
  const page = await openFixture(t, { fullscreenComments: false, hideFullscreenQuickActions: true });
  await installQuickActionsFixture(page, { stamp: false });
  await page.locator("#page-fullscreen").click();
  await page.waitForFunction(() => document.fullscreenElement === document.documentElement);
  assert.equal(await page.locator("html").getAttribute("data-ytppl-fullscreen-comments"), null);
  for (let pass = 0; pass < 2; pass++) {
    await page.evaluate(() => fixture.stampQuickActions());
    await assertQuickActionsScope(page);
  }
  await page.evaluate(() => document.exitFullscreen());
  await page.waitForFunction(() => !document.fullscreenElement);
  await page.evaluate(() => fixture.stampQuickActions());
  await assertQuickActionsScope(page);
});
