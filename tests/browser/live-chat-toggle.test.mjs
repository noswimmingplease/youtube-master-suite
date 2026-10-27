import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { after, before, test } from "node:test";
import { launchFixtureBrowser, waitForSuiteHealth } from "./fixture-browser.mjs";

const SUITE = readFileSync(new URL("../../youtube-master-suite.user.js", import.meta.url), "utf8");
const MANIFEST = JSON.parse(readFileSync(new URL("../../release-manifest.json", import.meta.url), "utf8"));
const FIXTURE = readFileSync(new URL("./watch-page.html", import.meta.url), "utf8")
  .replace('lang="en"', 'lang="en-GB"');
const WATCH_URL = "https://www.youtube.com/watch?v=aaaaaaaaaaa&list=fixture-queue";
const SETTINGS_KEY = "yt-master-suite.settings.v1";
const BUTTON = "#ytppl-live-chat-button";
const PANEL = 'ytd-live-chat-frame#chat';
const CLOSE = "#ytppl-live-chat-close";
const ANCESTOR = "data-ytppl-live-chat-ancestor";
const SIBLING = "data-ytppl-live-chat-sibling-hidden";
let browser;

before(async () => { browser = await launchFixtureBrowser(); }, { timeout: 30000 });
after(async () => { await browser?.close(); }, { timeout: 10000 });

// Only the native chat/frame contracts are modelled. The iframe has a real,
// locally intercepted browsing context; popovers, focus, input and fullscreen
// use browser APIs rather than replacements. No signed-in session is contacted.
function installNativeChat({ collapsed = false, hiddenAncestors = false, chatEngagement = false } = {}) {
  const secondary = document.getElementById("secondary");
  let container = secondary.querySelector("#chat-container");
  if (!container) {
    container = document.createElement(chatEngagement ? "ytd-engagement-panel-section-list-renderer" : "div");
    container.id = "chat-container";
    if (chatEngagement) {
      container.setAttribute("target-id", "engagement-panel-live-chat");
      container.setAttribute("visibility", "ENGAGEMENT_PANEL_VISIBILITY_EXPANDED");
    }
    secondary.append(container);
  }
  container.replaceChildren();
  if (!document.getElementById("fixture-chat-style")) {
    const style = document.createElement("style");
    style.id = "fixture-chat-style";
    style.textContent = `
      #chat-container, ytd-live-chat-frame#chat { display: block; }
      ytd-live-chat-frame#chat { width: 374px; height: 420px; background: #222; color: white; }
      ytd-live-chat-frame#chat #chatframe { display: block; width: 100%; height: 360px; border: 0; }
      ytd-live-chat-frame#chat[collapsed] { height: 40px; }
      ytd-live-chat-frame#chat[collapsed] #chatframe { display: none; }
      #fixture-private-sibling, #fixture-queue-action { display: block; min-height: 32px; }
    `;
    document.head.append(style);
  }
  const frame = document.createElement("ytd-live-chat-frame");
  frame.id = "chat";
  frame.videoId = fixture.playerId;
  frame.data = { videoId: fixture.playerId };
  Object.defineProperty(frame, "collapsed", {
    configurable: true,
    get() { return this.hasAttribute("collapsed"); },
    set(value) { this.toggleAttribute("collapsed", Boolean(value)); },
  });
  frame.collapsed = collapsed;
  const showHide = document.createElement("div");
  showHide.id = "show-hide-button";
  const nativeToggle = document.createElement("button");
  nativeToggle.id = "button";
  nativeToggle.type = "button";
  const syncLabel = () => {
    nativeToggle.textContent = frame.collapsed ? "Show chat" : "Hide chat";
    nativeToggle.setAttribute("aria-expanded", String(!frame.collapsed));
  };
  syncLabel();
  showHide.append(nativeToggle);
  const iframe = document.createElement("iframe");
  iframe.id = "chatframe";
  iframe.title = "Live chat";
  iframe.src = `/live_chat?v=${fixture.playerId}&fixture=live-chat-toggle`;
  frame.append(showHide, iframe);
  const state = window.liveChatFixture = {
    frame, iframe, originalParent: container, originalIframeParent: frame,
    originalWindow: null, loads: 0, nativeToggles: 0,
    secondaryStyle: secondary.getAttribute("style"),
    containerHidden: container.hidden,
  };
  iframe.addEventListener("load", () => {
    state.loads++;
    state.originalWindow ||= iframe.contentWindow;
  });
  nativeToggle.addEventListener("click", () => {
    state.nativeToggles++;
    frame.collapsed = !frame.collapsed;
    syncLabel();
  });
  if (hiddenAncestors) {
    secondary.style.display = "none";
    container.hidden = true;
    container.style.display = "none";
    state.secondaryStyle = secondary.getAttribute("style");
    state.containerHidden = container.hidden;
    if (!secondary.querySelector("#fixture-private-sibling")) {
      const sibling = document.createElement("div");
      sibling.id = "fixture-private-sibling";
      sibling.textContent = "Unrelated engagement content";
      secondary.prepend(sibling);
      const queueAction = document.createElement("button");
      queueAction.id = "fixture-queue-action";
      queueAction.textContent = "Unrelated queue action";
      secondary.querySelector("ytd-playlist-panel-renderer").append(queueAction);
    }
  }
  container.append(frame);
}

function installChatRafCounter() {
  if (location.origin !== "https://www.youtube.com" || location.pathname !== "/watch") return;
  const nativeRequestAnimationFrame = window.requestAnimationFrame.bind(window);
  window.liveChatRafFixture = { syncCallbacks: 0 };
  window.requestAnimationFrame = function (callback) {
    if (typeof callback !== "function") return nativeRequestAnimationFrame(callback);
    return nativeRequestAnimationFrame(function (timestamp) {
      if (callback.name === "syncLiveChat") liveChatRafFixture.syncCallbacks++;
      return callback.call(this, timestamp);
    });
  };
}

function installNativeVideoLayout(mode) {
  const flexy = document.querySelector("ytd-watch-flexy");
  const playerHost = document.getElementById("player");
  const player = document.getElementById("movie_player");
  const primary = document.getElementById("primary");
  flexy.setAttribute("flexy", "");
  flexy.style.setProperty("--ytd-watch-flexy-sidebar-width", "402px");
  const syncColumns = () => {
    const twoColumns = innerWidth > 1000;
    if (flexy.hasAttribute("is-two-columns") !== twoColumns) flexy.toggleAttribute("is-two-columns", twoColumns);
  };
  syncColumns();
  window.addEventListener("resize", syncColumns);
  for (const id of ["columns", "primary", "primary-inner", "secondary", "player"]) {
    document.getElementById(id).classList.add("ytd-watch-flexy");
  }
  primary.prepend(playerHost);
  if (mode === "fullbleed") {
    flexy.setAttribute("theater", "");
    const fullBleed = document.createElement("div");
    fullBleed.id = "full-bleed-container";
    const container = document.createElement("div");
    container.id = "container";
    container.append(player);
    fullBleed.append(container);
    flexy.insertBefore(fullBleed, document.getElementById("columns"));
    playerHost.style.display = "none";
  }
  const description = document.createElement("div");
  description.id = "description";
  description.textContent = "Native video description";
  document.querySelector("ytd-watch-metadata").append(description);
  const style = document.createElement("style");
  style.id = "fixture-native-video-layout";
  // Native chat and the content columns deliberately consume the same inherited
  // variable. A fixed640px player cannot reveal the production overlap bug.
  style.textContent = `
    ytd-watch-flexy { width: 100%; }
    #full-bleed-container { display: flex; width: 100%; height: 523px; }
    #full-bleed-container > #container { display: block; width: 100%; height: 100%; }
    #full-bleed-container #movie_player {
      width: 100%; height: 523px;
    }
    ytd-watch-flexy:has(ytd-live-chat-frame#chat:not([collapsed])) #full-bleed-container #movie_player {
      width: calc(100% - var(--ytd-watch-flexy-sidebar-width, 402px));
    }
    #player.ytd-watch-flexy { margin: 0; }
    #player.ytd-watch-flexy #movie_player { width: 100%; }
    #movie_player video { width: 100%; height: calc(100% - 40px); }
    #columns.ytd-watch-flexy {
      display: flex; position: relative; width: 100%; gap: 0;
      padding-inline-end: var(--ytd-watch-flexy-sidebar-width, 402px);
    }
    #columns.ytd-watch-flexy > #primary.ytd-watch-flexy {
      width: 0; padding: 0; margin: 0 0 0 16px;
    }
    #columns.ytd-watch-flexy > #secondary.ytd-watch-flexy {
      position: absolute; top: 0; right: 0;
      width: var(--ytd-watch-flexy-sidebar-width, 402px);
    }
    #primary-inner.ytd-watch-flexy, ytd-watch-metadata, #description, ytd-comments {
      display: block; width: 100%;
    }
    @media (max-width: 1000px) { #secondary.ytd-watch-flexy { display: none; } }
  `;
  document.head.append(style);
}

async function openFixture(t, {
  values = {}, nativeChat = true, collapsed = false, hiddenAncestors = false,
  chatEngagement = false, popoverApi = true, countChatRaf = false, nativeVideoLayout = null,
  viewport = { width: 1280, height: 900 },
} = {}) {
  const chatSetup = `<script>window.installNativeChat = ${installNativeChat.toString()};` +
    (nativeChat ? `installNativeChat(${JSON.stringify({ collapsed, hiddenAncestors, chatEngagement })});` : "") +
    (nativeVideoLayout ? `(${installNativeVideoLayout.toString()})(${JSON.stringify(nativeVideoLayout)});` : "") + "</script>";
  const context = await browser.newContext({ viewport, serviceWorkers: "block" });
  await context.route("**/*", route => {
    const url = new URL(route.request().url());
    if (url.href === WATCH_URL) return route.fulfill({
      contentType: "text/html", body: FIXTURE.replace("</body>", `${chatSetup}</body>`),
    });
    if (url.origin === "https://www.youtube.com" && url.pathname === "/live_chat") {
      return route.fulfill({ contentType: "text/html", body: `<!doctype html>
        <html lang="en-GB"><head><meta charset="utf-8"><title>Fixture live chat</title></head>
        <body><label for="message">Message</label><input id="message" autocomplete="off"></body></html>` });
    }
    return route.abort();
  });
  await context.addInitScript(({ key, values, popoverApi }) => {
    if (location.origin !== "https://www.youtube.com" || location.pathname !== "/watch") return;
    localStorage.setItem(key, JSON.stringify({ version: 1, values }));
    if (!popoverApi) {
      for (const name of ["showPopover", "hidePopover", "togglePopover"]) {
        Object.defineProperty(HTMLElement.prototype, name, { configurable: true, value: undefined });
      }
    }
  }, { key: SETTINGS_KEY, values: { theatreMode: false, ...values }, popoverApi });
  await context.addInitScript({ content: countChatRaf ? `(${installChatRafCounter.toString()})();\n${SUITE}` : SUITE });
  const page = await context.newPage();
  page.setDefaultTimeout(8000);
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  t.after(async () => {
    try {
      assert.deepEqual(errors, [], "Integrated live-chat fixture must not produce page errors");
      const runtime = await page.getAttribute("html", "data-yt-master-runtime-errors");
      assert.ok(!runtime || runtime === "[]", `Suite runtime errors: ${runtime}`);
    } finally { await context.close(); }
  });
  await page.goto(WATCH_URL);
  await waitForSuiteHealth(page, MANIFEST.registeredModules, { timeoutMs: 10000, requireReady: true, errors });
  if (nativeChat) await waitForChatDocument(page);
  return page;
}

async function settle(page) {
  await page.evaluate(async () => { await new Promise(requestAnimationFrame); await new Promise(requestAnimationFrame); });
}

async function waitForChatDocument(page) {
  await page.waitForFunction(() => liveChatFixture.loads === 1 &&
    Boolean(liveChatFixture.iframe.contentDocument?.getElementById("message")));
}

async function assertButton(page, expanded) {
  await page.waitForFunction(({ selector, expanded }) => {
    const button = document.querySelector(selector);
    return button?.getAttribute("aria-pressed") === String(expanded) &&
      button.getAttribute("aria-expanded") === String(expanded);
  }, { selector: BUTTON, expanded });
  assert.equal(await page.locator(BUTTON).getAttribute("aria-label"), expanded ? "Hide live chat" : "Show live chat");
}

async function assertOpen(page) {
  await page.locator(PANEL).waitFor({ state: "visible" });
  await page.waitForFunction(() => document.querySelector("ytd-live-chat-frame#chat")?.matches(":popover-open"));
  assert.equal(await page.locator(PANEL).getAttribute("popover"), "manual");
  assert.equal(await page.locator(PANEL).getAttribute("data-ytppl-live-chat-panel"), "1");
  assert.equal(await page.locator("#chatframe").isVisible(), true);
  await assertButton(page, true);
}

async function assertClosed(page) {
  await page.waitForFunction(() => !document.querySelector("ytd-live-chat-frame#chat")?.matches(":popover-open"));
  await assertButton(page, false);
}

async function assertPreservedChat(page, message = "Unsent live-chat message") {
  assert.deepEqual(await page.evaluate(() => {
    const state = liveChatFixture;
    return {
      frame: document.querySelector("ytd-live-chat-frame#chat") === state.frame,
      iframe: state.frame.querySelector("#chatframe") === state.iframe,
      frameParent: state.frame.parentNode === state.originalParent,
      iframeParent: state.iframe.parentNode === state.originalIframeParent,
      window: state.iframe.contentWindow === state.originalWindow,
      loads: state.loads,
      input: state.iframe.contentDocument.getElementById("message").value,
    };
  }), { frame: true, iframe: true, frameParent: true, iframeParent: true, window: true, loads: 1, input: message });
}

async function nativeVideoAndContentGeometry(page) {
  return page.evaluate(() => {
    const box = element => {
      const r = element.getBoundingClientRect();
      return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, height: r.height };
    };
    const flexy = document.querySelector("ytd-watch-flexy");
    return {
      viewport: innerWidth,
      player: box(document.getElementById("movie_player")),
      chat: box(document.querySelector("ytd-live-chat-frame#chat")),
      columns: box(document.getElementById("columns")),
      metadata: box(document.querySelector("ytd-watch-metadata")),
      description: box(document.getElementById("description")),
      comments: box(document.querySelector("ytd-comments")),
      rootSidebar: getComputedStyle(flexy).getPropertyValue("--ytd-watch-flexy-sidebar-width").trim(),
      columnSidebar: getComputedStyle(document.getElementById("columns")).getPropertyValue("--ytd-watch-flexy-sidebar-width").trim(),
    };
  });
}

for (const mode of ["fullbleed", "default"]) {
  for (const width of [1280, 930]) {
    test(`native shared-sidebar ${mode} layout at ${width}px keeps video beside chat and content full width`, async t => {
      const page = await openFixture(t, {
        nativeVideoLayout: mode, viewport: { width, height: 1100 },
      });
      await page.locator(BUTTON).click();
      await assertOpen(page);
      await page.frameLocator("#chatframe").locator("#message").fill("Unsent live-chat message");
      await settle(page);
      const geometry = await nativeVideoAndContentGeometry(page);
      assert.ok(geometry.player.right <= geometry.chat.left + .5,
        `The chat must not cover the native video: ${JSON.stringify(geometry)}`);
      for (const name of ["metadata", "description", "comments"]) {
        assert.ok(Math.abs(geometry[name].width - (geometry.columns.width - 16)) <= 1,
          `${name} must span the available column below the video: ${JSON.stringify(geometry)}`);
      }
      await assertPreservedChat(page);
      await page.locator(BUTTON).click();
      await assertClosed(page);
      await settle(page);
      const closed = await nativeVideoAndContentGeometry(page);
      assert.ok(Math.abs(closed.metadata.width - (closed.columns.width - 16)) <= 1,
        `Closing chat must not leave a dead content column: ${JSON.stringify(closed)}`);
      assert.ok(Math.abs(closed.player.right - closed.columns.right) <= 1,
        `Closing chat must restore the full video width: ${JSON.stringify(closed)}`);
      await page.locator(BUTTON).click();
      await assertOpen(page);
      await assertPreservedChat(page);
    });
  }
}

test("native fullbleed chat stays beside the video when the available width crosses the two-column breakpoint", async t => {
  const page = await openFixture(t, {
    nativeVideoLayout: "fullbleed", viewport: { width: 1280, height: 1100 },
  });
  await page.locator(BUTTON).click();
  await assertOpen(page);
  await page.frameLocator("#chatframe").locator("#message").fill("Unsent live-chat message");
  for (const width of [930, 1600, 930]) {
    await page.setViewportSize({ width, height: 1100 });
    await settle(page);
    const geometry = await nativeVideoAndContentGeometry(page);
    assert.ok(geometry.player.right <= geometry.chat.left + .5,
      `Chat must remain beside the resized native player: ${JSON.stringify(geometry)}`);
    assert.ok(Math.abs(geometry.comments.width - geometry.columns.width + 16) <= 1,
      `Content width must not inherit the video's chat reservation: ${JSON.stringify(geometry)}`);
    await assertPreservedChat(page);
  }
  await page.locator(BUTTON).click();
  await assertClosed(page);
  await settle(page);
  const closed = await nativeVideoAndContentGeometry(page);
  assert.ok(Math.abs(closed.player.width - 930) <= 1, JSON.stringify(closed));
  assert.ok(Math.abs(closed.comments.width - 914) <= 1, JSON.stringify(closed));
  await page.locator(BUTTON).click();
  await assertOpen(page);
  await assertPreservedChat(page);
});

test("returning from the native narrow layout does not leave a newly populated queue masked", async t => {
  const page = await openFixture(t, {
    nativeVideoLayout: "fullbleed", viewport: { width: 1280, height: 1100 },
  });
  await page.locator(BUTTON).click();
  await assertOpen(page);
  await page.frameLocator("#chatframe").locator("#message").fill("Unsent live-chat message");
  for (const width of [930, 1600]) {
    await page.setViewportSize({ width, height: 1100 });
    await settle(page);
    await assertOpen(page);
  }
  await page.evaluate(() => {
    const item = document.createElement("ytd-playlist-panel-video-renderer");
    item.id = "fixture-native-late-queue";
    item.textContent = "Native queued video";
    document.querySelector("#secondary ytd-playlist-panel-renderer").append(item);
  });
  await settle(page);
  assert.equal(await page.locator("#fixture-native-late-queue").isVisible(), true,
    "A native queue must not retain the Suite's obsolete narrow-layout sibling mask");
  assert.equal(await page.locator("ytd-watch-flexy").getAttribute("data-ywlc-empty-secondary-rail"), null);
  await assertOpen(page);
  await assertPreservedChat(page);
});

async function installNativeRailLayout(page, { hideEmptySecondary = false } = {}) {
  await page.evaluate(hideEmptySecondary => {
    const flexy = document.querySelector("ytd-watch-flexy");
    flexy.setAttribute("is-two-columns", "");
    flexy.classList.toggle("fixture-hide-empty-secondary", hideEmptySecondary);
    for (const id of ["columns", "primary", "primary-inner", "secondary"]) {
      document.getElementById(id).classList.add("ytd-watch-flexy");
    }
    const description = document.createElement("div");
    description.id = "description";
    description.textContent = "Native video description";
    document.querySelector("ytd-watch-metadata").append(description);
  }, hideEmptySecondary);
  await page.addStyleTag({ content: `
    #columns.ytd-watch-flexy { display: flex; width: 1200px; max-width: 100%; gap: 0; }
    #columns.ytd-watch-flexy > #primary.ytd-watch-flexy { flex: 1 1 0 !important; width: 0; padding: 0; }
    #columns.ytd-watch-flexy > #secondary.ytd-watch-flexy {
      flex: 0 0 var(--ytd-watch-flexy-sidebar-width, 374px);
      width: var(--ytd-watch-flexy-sidebar-width, 374px); margin-inline-start: 24px;
    }
    ytd-watch-flexy[data-ywlc-empty-secondary-rail="1"] #secondary.ytd-watch-flexy { margin-inline-start: 0 !important; }
    ytd-watch-flexy.fixture-hide-empty-secondary[data-ywlc-empty-secondary-rail="1"] #secondary { display: none; }
    #primary-inner.ytd-watch-flexy, ytd-watch-metadata, #description, ytd-comments { display: block; width: 100%; }
  ` });
  await settle(page);
}

async function assertNativeRailWidth(page, occupied) {
  await page.waitForFunction(occupied => {
    const flexy = document.querySelector("ytd-watch-flexy");
    return flexy.getAttribute("data-ywlc-empty-secondary-rail") === (occupied ? null : "1");
  }, occupied).catch(async error => {
    const actual = await page.evaluate(() => Object.fromEntries(["columns", "primary", "secondary"].map(id => {
      const element = document.getElementById(id), style = getComputedStyle(element);
      return [id, { width: element.getBoundingClientRect().width, flex: style.flex, display: style.display, sidebar: style.getPropertyValue("--ytd-watch-flexy-sidebar-width") }];
    })));
    throw new Error(`${error.message}; rail geometry ${JSON.stringify(actual)}`);
  });
  await page.waitForFunction(occupied => {
    const columns = document.getElementById("columns").getBoundingClientRect();
    const primary = document.getElementById("primary").getBoundingClientRect();
    const expected = columns.width - (occupied ? 398 : 0);
    return Math.abs(primary.width - expected) < 1;
  }, occupied).catch(async error => {
    const actual = await page.evaluate(() => Object.fromEntries(["columns", "primary", "secondary"].map(id => {
      const element = document.getElementById(id), style = getComputedStyle(element);
      return [id, { width: element.getBoundingClientRect().width, flex: style.flex, display: style.display, sidebar: style.getPropertyValue("--ytd-watch-flexy-sidebar-width") }];
    })));
    throw new Error(`${error.message}; rail geometry ${JSON.stringify(actual)}`);
  });
  const widths = await page.evaluate(() => {
    const width = selector => document.querySelector(selector).getBoundingClientRect().width;
    return { columns: width("#columns"), primary: width("#primary"), metadata: width("ytd-watch-metadata"),
      description: width("#description"), comments: width("ytd-comments") };
  });
  assert.ok(Math.abs(widths.primary - widths.columns + (occupied ? 398 : 0)) < 1, JSON.stringify(widths));
  for (const surface of ["metadata", "description", "comments"]) {
    assert.ok(Math.abs(widths[surface] - widths.primary) < 1, `${surface} must fill the available main column: ${JSON.stringify(widths)}`);
  }
}

for (const chatEngagement of [false, true]) {
  test(`floating chat${chatEngagement ? " inside its dedicated engagement wrapper" : ""} does not reserve a blank metadata or comments column`, async t => {
    const page = await openFixture(t, { chatEngagement });
    await installNativeRailLayout(page);
    await assertNativeRailWidth(page, false);
    await page.locator(BUTTON).click();
    await assertOpen(page);
    await page.frameLocator("#chatframe").locator("#message").fill("Unsent live-chat message");
    await assertNativeRailWidth(page, false);
    await assertPreservedChat(page);
    await page.setViewportSize({ width: 1600, height: 900 });
    await settle(page);
    await assertNativeRailWidth(page, false);
    await assertPreservedChat(page);
    await page.locator(BUTTON).click();
    await assertClosed(page);
    await assertNativeRailWidth(page, false);
    await page.locator(BUTTON).click();
    await assertOpen(page);
    await assertNativeRailWidth(page, false);
    await assertPreservedChat(page);
    await page.locator("#next-video").click();
    await page.waitForFunction(() => fixture.playerId === "bbbbbbbbbbb" && !document.querySelector("#ytppl-live-chat-button"));
    await assertNativeRailWidth(page, false);
  });
}

for (const content of ["queue", "SponsorBlock popup", "SponsorBlock iframe", "engagement panel"]) {
  test(`floating chat retains a real ${content} rail and releases it when that content disappears`, async t => {
    const page = await openFixture(t);
    await installNativeRailLayout(page);
    await assertNativeRailWidth(page, false);
    await page.evaluate(content => {
      const secondary = document.getElementById("secondary");
      if (content === "queue") {
        const item = document.createElement("ytd-playlist-panel-video-renderer");
        item.id = "fixture-real-rail-content";
        item.textContent = "Native queued video";
        secondary.querySelector("ytd-playlist-panel-renderer").append(item);
      } else if (content === "engagement panel") {
        const panel = document.createElement("ytd-engagement-panel-section-list-renderer");
        panel.id = "fixture-real-rail-content";
        panel.setAttribute("target-id", "engagement-panel-transcript");
        panel.setAttribute("visibility", "ENGAGEMENT_PANEL_VISIBILITY_EXPANDED");
        panel.textContent = "Native transcript";
        secondary.append(panel);
      } else {
        const popup = document.createElement("div");
        popup.id = "sponsorBlockPopupContainer";
        popup.style.cssText = content === "SponsorBlock iframe" ? "width:0;height:0" : "width:374px;height:120px";
        if (content === "SponsorBlock iframe") {
          const iframe = document.createElement("iframe");
          iframe.title = "SponsorBlock fixture";
          iframe.style.cssText = "display:block;width:374px;height:120px;border:0";
          popup.append(iframe);
        } else popup.textContent = "SponsorBlock controls";
        secondary.append(popup);
      }
    }, content);
    await assertNativeRailWidth(page, true);
    await page.locator(BUTTON).click();
    await assertOpen(page);
    await page.frameLocator("#chatframe").locator("#message").fill("Unsent live-chat message");
    await assertNativeRailWidth(page, true);
    assert.equal(await page.locator(content.startsWith("SponsorBlock") ?
      content === "SponsorBlock iframe" ? "#sponsorBlockPopupContainer iframe" : "#sponsorBlockPopupContainer" :
      "#fixture-real-rail-content").isVisible(), true);
    await page.evaluate(() => (document.getElementById("fixture-real-rail-content") ||
      document.getElementById("sponsorBlockPopupContainer")).remove());
    await assertNativeRailWidth(page, false);
    await assertOpen(page);
    await assertPreservedChat(page);
  });
}

test("empty or hidden SponsorBlock content does not reserve a column beneath floating chat", async t => {
  const page = await openFixture(t);
  await installNativeRailLayout(page);
  await page.locator(BUTTON).click();
  await assertOpen(page);
  await page.evaluate(() => {
    const popup = document.createElement("div");
    popup.id = "sponsorBlockPopupContainer";
    popup.style.cssText = "width:0;height:0";
    document.getElementById("secondary").append(popup);
  });
  await assertNativeRailWidth(page, false);
  await page.evaluate(() => {
    const popup = document.getElementById("sponsorBlockPopupContainer");
    popup.hidden = true;
    const iframe = document.createElement("iframe");
    iframe.title = "Hidden SponsorBlock fixture";
    iframe.style.cssText = "width:374px;height:120px;border:0";
    popup.append(iframe);
  });
  await assertNativeRailWidth(page, false);
  await assertOpen(page);
});

test("native in-flow chat still keeps its rail before an explicit player toggle", async t => {
  const page = await openFixture(t, { values: { hideChat: false } });
  await installNativeRailLayout(page);
  await assertNativeRailWidth(page, true);
  assert.equal(await page.locator(PANEL).getAttribute("popover"), null);
  await page.locator(BUTTON).click();
  await assertClosed(page);
  await assertNativeRailWidth(page, false);
  await page.locator(BUTTON).click();
  await assertOpen(page);
  await assertNativeRailWidth(page, false);
});

test("floating chat survives a native empty-rail display-none transition without an update loop", async t => {
  const page = await openFixture(t, { countChatRaf: true });
  await installNativeRailLayout(page);
  await page.evaluate(() => {
    const panel = document.createElement("ytd-engagement-panel-section-list-renderer");
    panel.id = "fixture-transient-transcript";
    panel.setAttribute("target-id", "engagement-panel-transcript");
    panel.setAttribute("visibility", "ENGAGEMENT_PANEL_VISIBILITY_EXPANDED");
    panel.textContent = "Visible transcript";
    document.getElementById("secondary").append(panel);
  });
  await assertNativeRailWidth(page, true);
  await page.locator("ytd-watch-flexy").evaluate(flexy => flexy.classList.add("fixture-hide-empty-secondary"));
  await page.locator(BUTTON).click();
  await assertOpen(page);
  await page.frameLocator("#chatframe").locator("#message").fill("Unsent live-chat message");
  await page.locator("#fixture-transient-transcript").evaluate(panel => panel.remove());
  await assertNativeRailWidth(page, false);
  await assertOpen(page);
  await assertPreservedChat(page);
  await settle(page);
  await page.evaluate(() => { liveChatRafFixture.syncCallbacks = 0; });
  await page.waitForTimeout(150);
  assert.equal(await page.evaluate(() => liveChatRafFixture.syncCallbacks), 0,
    "An empty-rail notification must settle rather than continually rescheduling chat");
});

test("default player chat control is available only when a native live-chat frame exists", async t => {
  const page = await openFixture(t);
  await page.locator(BUTTON).waitFor();
  assert.equal(await page.locator(BUTTON).count(), 1);
  assert.equal(await page.locator(BUTTON).evaluate(button => button.closest(".ytp-right-controls") !== null), true);
  assert.equal(await page.locator(BUTTON).isEnabled(), true);
  await page.locator(PANEL).waitFor({ state: "hidden" });
  await assertButton(page, false);
  assert.equal(await page.locator("#movie_player .ytp-settings-button").isVisible(), true);
});

test("chat icon keeps native-sized artwork centred inside normal and compact control hitboxes", async t => {
  const page = await openFixture(t);
  await page.locator(BUTTON).waitFor();
  await page.addStyleTag({ content: `
    #movie_player .ytp-button > svg { min-width: 0; max-width: 100%; flex-shrink: 1; }
    #movie_player.fixture-compact-controls .ytp-button { width: 24px !important; height: 32px !important; flex: 0 0 24px; }
  ` });
  async function assertIcon(compact) {
    const metrics = await page.locator(BUTTON).evaluate(button => {
      const svg = button.querySelector("svg"), path = svg.querySelector("path");
      const hitbox = button.getBoundingClientRect(), box = svg.getBoundingClientRect();
      const artwork = path.getBBox(), viewBox = svg.viewBox.baseVal;
      const scale = Math.min(box.width / viewBox.width, box.height / viewBox.height);
      return { hitWidth: hitbox.width, hitHeight: hitbox.height, width: box.width, height: box.height,
        centreX: box.left + box.width / 2 - hitbox.left - hitbox.width / 2,
        centreY: box.top + box.height / 2 - hitbox.top - hitbox.height / 2,
        artworkWidth: artwork.width * scale, artworkHeight: artwork.height * scale };
    });
    assert.equal(metrics.hitWidth, compact ? 24 : 40, "Artwork sizing must not widen the native button hitbox");
    assert.equal(metrics.hitHeight, compact ? 32 : 40, "Artwork sizing must not enlarge the native button hitbox");
    assert.equal(metrics.width, 36, `Chat SVG must not shrink under host max-width/flex rules: ${JSON.stringify(metrics)}`);
    assert.equal(metrics.height, 36);
    assert.equal(metrics.artworkWidth, 24);
    assert.equal(metrics.artworkHeight, 23);
    assert.ok(Math.abs(metrics.centreX) <= 0.5 && Math.abs(metrics.centreY) <= 0.5,
      `Chat artwork must stay centred: ${JSON.stringify(metrics)}`);
  }
  await assertIcon(false);
  await page.locator("#movie_player").evaluate(player => player.classList.add("fixture-compact-controls"));
  await assertIcon(true);
  await page.locator(BUTTON).click();
  await assertOpen(page);
  assert.equal(await page.locator(`${BUTTON} .ytp-svg-fill`).evaluate(path => getComputedStyle(path).fill), "rgb(255, 0, 51)");
  await page.locator("#page-fullscreen").click();
  await page.waitForFunction(() => document.fullscreenElement === document.documentElement);
  await assertIcon(true);
  await assertOpen(page);
  await page.evaluate(() => document.exitFullscreen());
  await page.waitForFunction(() => !document.fullscreenElement);
  await page.locator(CLOSE).click();
  await assertClosed(page);
});

test("a video without native chat does not gain an active or duplicate chat control", async t => {
  const page = await openFixture(t, { nativeChat: false });
  await settle(page);
  assert.equal(await page.locator(BUTTON).count(), 0);
  assert.equal(await page.locator(CLOSE).count(), 0);
});

test("the player-button preference can disable the control without hiding enabled native chat", async t => {
  const page = await openFixture(t, { values: { liveChatButton: false, hideChat: false } });
  await settle(page);
  assert.equal(await page.locator(BUTTON).count(), 0);
  assert.equal(await page.locator(PANEL).isVisible(), true);
  assert.equal(await page.locator(PANEL).getAttribute("popover"), null);
});

test("showing and hiding chat preserves its original iframe and does not save temporary choices", async t => {
  const page = await openFixture(t);
  const saved = await page.evaluate(key => localStorage.getItem(key), SETTINGS_KEY);
  await page.locator(BUTTON).click();
  await assertOpen(page);
  await page.frameLocator("#chatframe").locator("#message").fill("Unsent live-chat message");
  await assertPreservedChat(page);
  for (let index = 0; index < 3; index++) {
    await page.locator(BUTTON).click();
    await assertClosed(page);
    await page.locator(BUTTON).click();
    await assertOpen(page);
    await assertPreservedChat(page);
  }
  assert.equal(await page.evaluate(key => localStorage.getItem(key), SETTINGS_KEY), saved);
});

test("explicitly opened chat stays open beyond every existing delayed native-collapse attempt", { timeout: 20000 }, async t => {
  const page = await openFixture(t);
  await page.locator(BUTTON).click();
  await assertOpen(page);
  const toggles = await page.evaluate(() => liveChatFixture.nativeToggles);
  await page.waitForTimeout(6300);
  await assertOpen(page);
  assert.equal(await page.evaluate(() => liveChatFixture.nativeToggles), toggles);
});

test("native-visible chat remains visible until explicitly hidden and can then be reopened", async t => {
  const page = await openFixture(t, { values: { hideChat: false } });
  await page.locator(BUTTON).waitFor();
  assert.equal(await page.locator(PANEL).isVisible(), true);
  await assertButton(page, true);
  await page.locator(BUTTON).click();
  await page.locator(PANEL).waitFor({ state: "hidden" });
  await assertClosed(page);
  await page.locator(BUTTON).click();
  await assertOpen(page);
});

test("Enter and Space activate the chat control once and the close button returns focus", async t => {
  const page = await openFixture(t);
  for (const key of ["Enter", "Space"]) {
    await page.locator(BUTTON).focus();
    await page.keyboard.press(key);
    await assertOpen(page);
    await page.locator(CLOSE).click();
    await assertClosed(page);
    assert.equal(await page.locator(BUTTON).evaluate(button => button === document.activeElement), true);
  }
  await page.locator(BUTTON).click();
  await assertOpen(page);
  await page.locator(CLOSE).focus();
  await page.keyboard.press("Escape");
  await assertClosed(page);
  assert.equal(await page.locator(BUTTON).evaluate(button => button === document.activeElement), true);
});

test("the native Hide chat action closes the popover and reconciles its player toggle", async t => {
  const page = await openFixture(t);
  await page.locator(BUTTON).click();
  await assertOpen(page);
  // The owned popover hides the native outer header. Model its native collapse
  // command directly; users dismiss the popover through the visible close UI.
  await page.locator(`${PANEL} #show-hide-button button`).evaluate(button => button.click());
  await assertClosed(page);
  await page.locator(PANEL).waitFor({ state: "hidden" });
});

test("opening chat selectively reveals hidden ancestors without exposing queue or engagement siblings", async t => {
  const page = await openFixture(t, { hiddenAncestors: true });
  const before = await page.evaluate(() => ({ style: liveChatFixture.secondaryStyle, hidden: liveChatFixture.containerHidden }));
  await page.locator(BUTTON).click();
  await assertOpen(page);
  for (const selector of ["#fixture-private-sibling", "#fixture-queue-action"])
    assert.equal(await page.locator(selector).isVisible(), false, `${selector} must stay hidden`);
  await page.locator(CLOSE).click();
  await assertClosed(page);
  assert.deepEqual(await page.evaluate(() => ({
    style: document.getElementById("secondary").getAttribute("style"),
    hidden: document.getElementById("chat-container").hidden,
  })), before, "Native ancestor state must be restored, not replaced permanently");
});

test("page-root fullscreen preserves the open native chat document and its unsent input", { timeout: 20000 }, async t => {
  const page = await openFixture(t);
  await page.locator(BUTTON).click();
  await assertOpen(page);
  await page.frameLocator("#chatframe").locator("#message").fill("Unsent live-chat message");
  await page.locator("#page-fullscreen").click();
  await page.waitForFunction(() => document.fullscreenElement === document.documentElement);
  if (!(await page.locator(PANEL).evaluate(frame => frame.matches(":popover-open")))) await page.locator(BUTTON).click();
  await assertOpen(page);
  await assertPreservedChat(page);
  await page.evaluate(() => document.exitFullscreen());
  await page.waitForFunction(() => !document.fullscreenElement);
  await assertPreservedChat(page);
  assert.equal(await page.locator(".ytp-fullscreen-button").isVisible(), true);
});

test("player-only fullscreen disables external chat without replacing native fullscreen behaviour", async t => {
  const page = await openFixture(t);
  await page.locator(BUTTON).waitFor();
  await page.locator(".ytp-fullscreen-button").click();
  await page.waitForFunction(() => document.fullscreenElement?.id === "movie_player");
  await page.waitForFunction(selector => document.querySelector(selector)?.disabled === true, BUTTON);
  assert.equal(await page.locator(PANEL).evaluate(frame => frame.matches(":popover-open")), false);
  assert.equal(await page.locator(".ytp-fullscreen-button").isVisible(), true);
  await page.evaluate(() => document.exitFullscreen());
  await page.waitForFunction(selector => !document.fullscreenElement && document.querySelector(selector)?.disabled === false, BUTTON);
  await page.locator(BUTTON).click();
  await assertOpen(page);
});

test("chat fits a narrow viewport without moving the native iframe", async t => {
  const page = await openFixture(t, { viewport: { width: 375, height: 720 } });
  await page.locator(BUTTON).click();
  await assertOpen(page);
  const bounds = await page.locator(PANEL).boundingBox();
  assert.ok(bounds && bounds.x >= 0 && bounds.y >= 0 && bounds.x + bounds.width <= 376 && bounds.y + bounds.height <= 721,
    `Chat must stay inside its viewport: ${JSON.stringify(bounds)}`);
  const close = await page.locator(CLOSE).boundingBox();
  assert.ok(close && close.x >= 0 && close.y >= 0 && close.x + close.width <= 376 && close.y + close.height <= 721);
  await page.frameLocator("#chatframe").locator("#message").fill("Unsent live-chat message");
  await assertPreservedChat(page);
});

async function assertChatMatchesPlayer(page) {
  await settle(page);
  const geometry = await page.locator(PANEL).evaluate(frame => {
    const panel = frame.getBoundingClientRect();
    const iframe = frame.querySelector("#chatframe").getBoundingClientRect();
    const player = document.getElementById("movie_player").getBoundingClientRect();
    const controls = [".ytp-chrome-bottom", ".ytp-chrome-controls", ".ytp-right-controls"]
      .map(selector => document.querySelector(`#movie_player ${selector}`)?.getBoundingClientRect())
      .find(rect => rect?.width > 0 && rect.height > 0);
    const unclippedHeight = Math.min(player.height, innerHeight);
    const expectedTop = Math.max(0, Math.min(player.top, innerHeight - unclippedHeight));
    let expectedBottom = expectedTop + unclippedHeight;
    const overlapsControls = Boolean(controls && panel.right > controls.left && panel.left < controls.right &&
      controls.top > expectedTop && controls.top < expectedBottom);
    if (overlapsControls) expectedBottom = Math.min(expectedBottom, controls.top - 8);
    return { top: panel.top, bottom: panel.bottom, height: panel.height, width: panel.width,
      iframeTop: iframe.top, iframeBottom: iframe.bottom, viewportHeight: innerHeight,
      expectedTop, expectedHeight: Math.max(0, expectedBottom - expectedTop), overlapsControls };
  });
  assert.ok(Math.abs(geometry.height - geometry.expectedHeight) <= 1,
    `Chat should match the visible player height while clearing overlaid controls: ${JSON.stringify(geometry)}`);
  assert.ok(Math.abs(geometry.top - geometry.expectedTop) <= 1,
    `Chat should align with the player inside the viewport: ${JSON.stringify(geometry)}`);
  assert.ok(geometry.top >= -1 && geometry.bottom <= geometry.viewportHeight + 1,
    `Chat should stay inside the viewport: ${JSON.stringify(geometry)}`);
  assert.ok(geometry.iframeTop >= geometry.top + 40 && geometry.iframeBottom <= geometry.bottom + 1,
    `Native chat content must stay inside the taller panel: ${JSON.stringify(geometry)}`);
  assert.equal(await page.locator(CLOSE).isVisible(), true);
  return geometry;
}

test("chat follows player height and position through resizing and scrolling without reloading its draft", async t => {
  const page = await openFixture(t, { viewport: { width: 1280, height: 1440 } });
  await page.locator(BUTTON).click();
  await assertOpen(page);
  await page.frameLocator("#chatframe").locator("#message").fill("Unsent live-chat message");
  assert.equal((await assertChatMatchesPlayer(page)).height, 360);
  await page.locator("#movie_player").evaluate(player => {
    player.style.height = "960px";
    player.querySelector("video").style.height = "920px";
  });
  await settle(page);
  assert.equal((await assertChatMatchesPlayer(page)).height, 960,
    "A player resize without a window resize must release the old 640px chat cap");
  for (const height of [900, 480, 1440]) {
    await page.setViewportSize({ width: 1280, height });
    await assertChatMatchesPlayer(page);
    await assertPreservedChat(page);
  }
  await page.locator("#movie_player").evaluate(player => {
    player.style.height = "240px";
    player.querySelector("video").style.height = "200px";
  });
  await settle(page);
  assert.equal((await assertChatMatchesPlayer(page)).height, 240);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.evaluate(() => window.scrollTo(0, 30));
  const scrolled = await assertChatMatchesPlayer(page);
  assert.ok(scrolled.top < 80, "Passive scroll should update the panel's player alignment");
  assert.equal(scrolled.width, 360, "Changing chat height must not change its normal width");
  await assertPreservedChat(page);
  await page.locator(CLOSE).click();
  await assertClosed(page);
  assert.deepEqual(await page.locator(PANEL).evaluate(frame => [
    frame.style.getPropertyValue("--ytppl-live-chat-top"),
    frame.style.getPropertyValue("--ytppl-live-chat-height"),
  ]), ["", ""], "Closing chat must remove its owned geometry overrides");
});

test("chat follows page-fullscreen player bounds and leaves overlaid playback controls clear", async t => {
  const page = await openFixture(t, { viewport: { width: 1280, height: 1440 } });
  await page.locator(BUTTON).click();
  await assertOpen(page);
  await page.frameLocator("#chatframe").locator("#message").fill("Unsent live-chat message");
  await assertChatMatchesPlayer(page);
  await page.locator("#page-fullscreen").click();
  await page.waitForFunction(() => document.fullscreenElement === document.documentElement);
  await assertOpen(page);
  assert.equal((await assertChatMatchesPlayer(page)).overlapsControls, true);
  await assertPreservedChat(page);
  await page.evaluate(() => document.exitFullscreen());
  await page.waitForFunction(() => !document.fullscreenElement);
  await assertOpen(page);
  await assertChatMatchesPlayer(page);
  await assertPreservedChat(page);
});

test("late chat insertion and replaced playback controls install exactly one working toggle", async t => {
  const page = await openFixture(t, { nativeChat: false });
  await page.evaluate(() => installNativeChat());
  await waitForChatDocument(page);
  await page.locator(BUTTON).waitFor();
  await page.evaluate(() => {
    const controls = document.querySelector("#movie_player .ytp-right-controls");
    const replacement = controls.cloneNode(true);
    replacement.querySelector("#ytppl-live-chat-button")?.remove();
    controls.replaceWith(replacement);
  });
  await page.locator(BUTTON).waitFor();
  for (let count = 0; count < 6; count++) await page.evaluate(() => window.dispatchEvent(new Event("yt-page-data-updated")));
  await settle(page);
  assert.equal(await page.locator(BUTTON).count(), 1);
  await page.locator(BUTTON).click();
  await assertOpen(page);
});

test("navigation closes old chat and clears the temporary override before another live video", async t => {
  const page = await openFixture(t);
  await page.locator(BUTTON).click();
  await assertOpen(page);
  await page.evaluate(() => {
    window.oldChatFrame = liveChatFixture.frame;
    document.getElementById("next-video").click();
    oldChatFrame.remove();
  });
  await page.waitForFunction(() => fixture.playerId === "bbbbbbbbbbb" && !document.querySelector("#ytppl-live-chat-button"));
  assert.equal(await page.evaluate(() => oldChatFrame.matches(":popover-open")), false);
  assert.equal(await page.locator(CLOSE).count(), 0);
  await page.evaluate(() => installNativeChat());
  await waitForChatDocument(page);
  await page.locator(BUTTON).waitFor();
  await page.locator(PANEL).waitFor({ state: "hidden" });
  await assertButton(page, false);
  await page.locator(BUTTON).click();
  await assertOpen(page);
});

test("replacement chat frames cannot inherit stale popover ownership or duplicate close controls", async t => {
  const page = await openFixture(t);
  await page.locator(BUTTON).click();
  await assertOpen(page);
  await page.evaluate(() => {
    window.oldChatFrame = liveChatFixture.frame;
    installNativeChat();
  });
  await waitForChatDocument(page);
  await settle(page);
  assert.equal(await page.evaluate(() => oldChatFrame.matches(":popover-open")), false);
  assert.equal(await page.locator(BUTTON).count(), 1);
  assert.ok(await page.locator(CLOSE).count() <= 1);
  if (await page.locator(BUTTON).getAttribute("aria-pressed") === "false") await page.locator(BUTTON).click();
  await assertOpen(page);
  assert.equal(await page.locator(CLOSE).count(), 1);
});

test("BFCache suspension closes chat and restores a single working player control", async t => {
  const page = await openFixture(t);
  await page.locator(BUTTON).click();
  await assertOpen(page);
  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent("pagehide", { persisted: true })));
  await page.waitForFunction(() => !document.querySelector("ytd-live-chat-frame#chat").matches(":popover-open"));
  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true })));
  await page.locator(BUTTON).waitFor();
  await settle(page);
  assert.equal(await page.locator(BUTTON).count(), 1);
  if (await page.locator(BUTTON).getAttribute("aria-pressed") === "true") await page.locator(BUTTON).click();
  await page.locator(BUTTON).click();
  await assertOpen(page);
  assert.equal(await page.locator(CLOSE).count(), 1);
});

test("missing Popover API fails safely without moving chat or changing playback controls", async t => {
  const page = await openFixture(t, { popoverApi: false });
  await settle(page);
  const button = page.locator(BUTTON);
  assert.ok(await button.count() === 0 || !(await button.isEnabled()), "Unsupported popovers must not expose an active toggle");
  assert.equal(await page.locator(PANEL).getAttribute("popover"), null);
  assert.equal(await page.locator(".ytp-fullscreen-button").isVisible(), true);
  assert.equal(await page.evaluate(() => liveChatFixture.frame.parentNode === liveChatFixture.originalParent), true);
  assert.equal(await page.evaluate(() => liveChatFixture.loads), 1);
});

for (const moving of ["frame", "wrapper"]) {
  test(`a native ${moving} reparent releases the old hidden branch and watches the new one`, async t => {
    const page = await openFixture(t, { hiddenAncestors: true });
    await page.locator(BUTTON).click();
    await assertOpen(page);
    assert.equal(await page.locator("#secondary").getAttribute(ANCESTOR), "1");
    await page.evaluate(({ moving }) => {
      const outer = document.createElement("div");
      outer.id = "fixture-new-chat-branch";
      outer.style.display = "none";
      const inner = document.createElement("div");
      inner.id = "fixture-new-chat-inner";
      const unrelated = document.createElement("button");
      unrelated.id = "fixture-new-chat-sibling";
      unrelated.textContent = "Unrelated newly adjacent content";
      outer.append(unrelated, inner);
      document.querySelector("ytd-watch-flexy").append(outer);
      // This is a simulated native YouTube DOM move, not an operation performed
      // by the Suite. Browsers may reload an iframe moved by the native page.
      inner.append(moving === "frame" ? liveChatFixture.frame : document.getElementById("chat-container"));
    }, { moving });
    await assertOpen(page);
    await page.waitForFunction(({ ancestor, sibling }) =>
      !document.getElementById("secondary").hasAttribute(ancestor) &&
      !document.getElementById("fixture-private-sibling").hasAttribute(sibling) &&
      document.getElementById("fixture-new-chat-branch").getAttribute(ancestor) === "1" &&
      document.getElementById("fixture-new-chat-sibling").getAttribute(sibling) === "1",
    { ancestor: ANCESTOR, sibling: SIBLING });
    assert.equal(await page.locator("#fixture-new-chat-sibling").isVisible(), false);
    if (moving === "frame") assert.equal(await page.locator("#chat-container").getAttribute(ANCESTOR), null);
    assert.equal(await page.locator(BUTTON).count(), 1);
    assert.equal(await page.locator(CLOSE).count(), 1);
    // Attribute changes on the new ancestor chain must still be observed.
    await page.locator("#fixture-new-chat-branch").evaluate(branch => { branch.inert = true; });
    await page.waitForFunction(() => !document.querySelector("ytd-live-chat-frame#chat").matches(":popover-open"));
    assert.equal(await page.locator("#fixture-new-chat-branch").getAttribute(ANCESTOR), null);
    assert.equal(await page.locator("#fixture-new-chat-sibling").getAttribute(SIBLING), null);
    await page.locator("#fixture-new-chat-branch").evaluate(branch => { branch.inert = false; });
    await page.locator(BUTTON).click();
    await assertOpen(page);
  });
}

test("same-iframe video-source changes close stale chat and recover without page events", async t => {
  const page = await openFixture(t);
  await page.locator(BUTTON).click();
  await assertOpen(page);
  await page.locator("#chatframe").evaluate(iframe => {
    iframe.src = "/live_chat?v=bbbbbbbbbbb&fixture=stale-live-chat";
  });
  await page.waitForFunction(() => !document.querySelector("#ytppl-live-chat-button") &&
    !document.querySelector("ytd-live-chat-frame#chat").matches(":popover-open"));
  assert.equal(await page.locator(PANEL).getAttribute("data-ytppl-live-chat-panel"), null);
  assert.equal(await page.locator(PANEL).getAttribute("popover"), null);
  assert.equal(await page.locator(CLOSE).count(), 0);
  assert.equal(await page.evaluate(() => fixture.playerId), "aaaaaaaaaaa");
  assert.equal(await page.locator(PANEL).isVisible(), false,
    "A rejected stale frame must not retain the temporary override of default chat hiding");
  assert.equal(await page.locator("html").getAttribute("data-ytppl-live-chat-visibility"), null);
  await page.locator("#chatframe").evaluate(iframe => {
    iframe.src = "/live_chat?v=aaaaaaaaaaa&fixture=recovered-live-chat";
  });
  await page.locator(BUTTON).waitFor();
  await assertOpen(page);
  assert.equal(await page.evaluate(() => document.querySelector("ytd-live-chat-frame#chat") === liveChatFixture.frame), true);
  assert.equal(await page.evaluate(() => document.querySelector("#chatframe") === liveChatFixture.iframe), true);
  assert.equal(await page.locator(BUTTON).count(), 1);
  assert.equal(await page.locator(CLOSE).count(), 1);
});

test("the first close of natively visible chat releases an otherwise empty secondary rail", async t => {
  const page = await openFixture(t, { values: { hideChat: false, hideRelated: true } });
  await page.evaluate(() => {
    document.querySelector("ytd-watch-flexy").setAttribute("is-two-columns", "");
    window.dispatchEvent(new Event("resize"));
  });
  await settle(page);
  assert.equal(await page.locator(PANEL).isVisible(), true);
  assert.equal(await page.locator("ytd-watch-flexy").getAttribute("data-ywlc-empty-secondary-rail"), null);
  await page.locator(BUTTON).click();
  await assertClosed(page);
  await page.waitForFunction(() => document.querySelector("ytd-watch-flexy")
    .getAttribute("data-ywlc-empty-secondary-rail") === "1");
  assert.equal(await page.locator(PANEL).evaluate(frame => frame.classList.contains("ytppl-live-chat-hidden")), true);
  assert.equal(await page.locator("ytd-watch-flexy").evaluate(flexy =>
    getComputedStyle(flexy).getPropertyValue("--ytd-watch-flexy-sidebar-width").trim()), "0px");
});

test("late unrelated siblings remain hidden under selectively revealed chat ancestors", async t => {
  const page = await openFixture(t, { hiddenAncestors: true });
  await page.locator(BUTTON).click();
  await assertOpen(page);
  await page.evaluate(() => {
    for (const parentId of ["secondary", "chat-container"]) {
      const sibling = document.createElement("button");
      sibling.id = `fixture-late-${parentId}`;
      sibling.textContent = "Late unrelated action";
      document.getElementById(parentId).append(sibling);
    }
  });
  for (const selector of ["#fixture-late-secondary", "#fixture-late-chat-container"]) {
    await page.waitForFunction(({ selector, attribute }) =>
      document.querySelector(selector)?.getAttribute(attribute) === "1", { selector, attribute: SIBLING });
    assert.equal(await page.locator(selector).isVisible(), false);
  }
  await assertOpen(page);
  await page.locator(CLOSE).click();
  await assertClosed(page);
  for (const selector of ["#fixture-late-secondary", "#fixture-late-chat-container"])
    assert.equal(await page.locator(selector).getAttribute(SIBLING), null);
});

for (const failure of ["disabled", "aria-disabled", "throws", "timeout"]) {
  test(`a native expand action that is ${failure} offers an explicit retry without opening chat`, async t => {
    const page = await openFixture(t, { collapsed: true });
    const saved = await page.evaluate(key => localStorage.getItem(key), SETTINGS_KEY);
    await page.locator(`${PANEL} #show-hide-button button`).evaluate((button, failure) => {
      if (failure === "disabled") button.disabled = true;
      if (failure === "aria-disabled") button.setAttribute("aria-disabled", "true");
      if (failure === "throws") button.click = () => { throw new Error("Fixture native expansion unavailable"); };
      if (failure === "timeout") button.click = () => { liveChatFixture.nativeToggles++; };
    }, failure);
    await page.locator(BUTTON).click();
    await page.waitForFunction(selector => {
      const button = document.querySelector(selector);
      return button?.getAttribute("aria-label") === "Live chat is still loading. Try again." &&
        button.getAttribute("aria-busy") === "false";
    }, BUTTON);
    assert.equal(await page.locator(BUTTON).getAttribute("aria-pressed"), "false");
    assert.equal(await page.locator(BUTTON).getAttribute("aria-expanded"), "false");
    assert.equal(await page.locator(PANEL).evaluate(frame => frame.matches(":popover-open")), false);
    assert.equal(await page.locator(PANEL).isVisible(), false);
    const attempts = await page.evaluate(() => liveChatFixture.nativeToggles);
    await page.waitForTimeout(900);
    assert.equal(await page.evaluate(() => liveChatFixture.nativeToggles), attempts,
      "A failed native expansion must not repeat automatically");
    await page.locator(`${PANEL} #show-hide-button button`).evaluate(button => {
      button.disabled = false;
      button.removeAttribute("aria-disabled");
      delete button.click;
    });
    await page.locator(BUTTON).click();
    await assertOpen(page);
    assert.equal(await page.evaluate(key => localStorage.getItem(key), SETTINGS_KEY), saved);
  });
}

test("unrelated comment, caption and progress mutations schedule no chat reconciliation", async t => {
  const page = await openFixture(t, { countChatRaf: true });
  await page.locator(BUTTON).click();
  await assertOpen(page);
  await page.evaluate(() => {
    const progress = document.createElement("div");
    progress.className = "ytp-progress-bar-container";
    document.getElementById("movie_player").append(progress);
  });
  await settle(page);
  assert.ok(await page.evaluate(() => liveChatRafFixture.syncCallbacks > 0),
    "The transparent native RAF wrapper must observe actual chat sync callbacks before measuring exclusions");
  const counts = await page.evaluate(async () => {
    const result = {};
    for (const [name, selector] of Object.entries({
      comments: "ytd-comments",
      captions: ".ytp-caption-window-container",
      progress: ".ytp-progress-bar-container",
    })) {
      const surface = document.querySelector(selector);
      liveChatRafFixture.syncCallbacks = 0;
      for (let index = 0; index < 100; index++) {
        const child = document.createElement("span");
        child.textContent = `Unrelated ${name} update ${index}`;
        surface.append(child);
        await Promise.resolve();
        child.append(document.createTextNode(" updated"));
        await Promise.resolve();
        child.remove();
        await Promise.resolve();
      }
      await new Promise(requestAnimationFrame);
      await new Promise(requestAnimationFrame);
      result[name] = liveChatRafFixture.syncCallbacks;
    }
    return result;
  });
  assert.deepEqual(counts, { comments: 0, captions: 0, progress: 0 });
  await assertOpen(page);
});

test("chat show, resize and hide preserve a genuinely advancing media clock", { timeout: 20000 }, async t => {
  const page = await openFixture(t, {
    collapsed: true, nativeVideoLayout: "fullbleed", values: { miniplayerEnabled: false },
  });
  // A small generated PCM stream exercises the browser's actual media clock,
  // without external media, sound output or replacing the native video node.
  const sampleRate = 8000, samples = sampleRate * 20;
  const wav = Buffer.alloc(44 + samples, 128);
  wav.write("RIFF", 0, "ascii"); wav.writeUInt32LE(36 + samples, 4);
  wav.write("WAVEfmt ", 8, "ascii"); wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(sampleRate, 24); wav.writeUInt32LE(sampleRate, 28);
  wav.writeUInt16LE(1, 32); wav.writeUInt16LE(8, 34);
  wav.write("data", 36, "ascii"); wav.writeUInt32LE(samples, 40);
  await page.evaluate(async source => {
    const video = document.querySelector("#movie_player video");
    window.playbackClockFixture = { video, source, events: [] };
    video.muted = true; video.src = source;
    await video.play();
  }, `data:audio/wav;base64,${wav.toString("base64")}`);
  await page.waitForFunction(() => playbackClockFixture.video.currentTime > .15);
  await page.evaluate(() => {
    for (const type of ["pause", "seeking", "emptied", "loadstart"]) {
      playbackClockFixture.video.addEventListener(type, () => playbackClockFixture.events.push(type));
    }
  });
  const saved = await page.evaluate(key => localStorage.getItem(key), SETTINGS_KEY);
  const sample = () => page.evaluate(() => {
    const state = playbackClockFixture, video = document.querySelector("#movie_player video");
    return { sameNode: video === state.video, sameSource: video.getAttribute("src") === state.source,
      paused: video.paused, ended: video.ended, time: video.currentTime, wall: performance.now() };
  });
  async function advanceThrough(action) {
    const before = await sample();
    await action();
    const immediate = await sample();
    assert.equal(immediate.sameNode, true);
    assert.equal(immediate.sameSource, true);
    assert.equal(immediate.paused, false);
    assert.equal(immediate.ended, false);
    assert.ok(immediate.time >= before.time - .05, "Chat must not reset the playback position");
    await page.waitForFunction(time => playbackClockFixture.video.currentTime > time + .15, before.time);
    const after = await sample();
    assert.ok(Math.abs((after.time - before.time) - (after.wall - before.wall) / 1000) < .75,
      "The media clock should advance with real time, not seek elsewhere");
    assert.deepEqual(await page.evaluate(() => playbackClockFixture.events), []);
    assert.equal(await page.evaluate(key => localStorage.getItem(key), SETTINGS_KEY), saved);
  }
  await advanceThrough(async () => { await page.locator(BUTTON).click(); await assertOpen(page); });
  await advanceThrough(async () => { await page.setViewportSize({ width: 1100, height: 900 }); await settle(page); await assertOpen(page); });
  await advanceThrough(async () => { await page.locator(CLOSE).click(); await assertClosed(page); });
});
