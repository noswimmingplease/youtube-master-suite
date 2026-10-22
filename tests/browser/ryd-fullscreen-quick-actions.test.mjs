import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { after, before, test } from "node:test";
import { launchFixtureBrowser } from "./fixture-browser.mjs";

const SOURCE = readFileSync(new URL("../../sources/modules/youtube-player-preferences-lite.user.js", import.meta.url), "utf8");

function sourceRange(startMarker, endMarker) {
  const start = SOURCE.indexOf(startMarker);
  const end = SOURCE.indexOf(endMarker, start + startMarker.length);
  assert.ok(start >= 0 && end > start, `Missing source range ${startMarker}`);
  return SOURCE.slice(start, end);
}

const NORMALISERS = [
  sourceRange("  const RESTORED_LIKE_ICON_CLASS =", "  const SHORTS_LINK_SELECTOR ="),
  sourceRange("  const EXCLUDED_SURFACE_SELECTOR =", "  const CARD_HIDE_ATTRIBUTES ="),
  sourceRange("  const RYD_LIKE_BUTTON_SELECTOR =", "  const HASHTAG_LINK_SELECTOR ="),
  sourceRange("  function closestElement(", "  function getShortsIdFromUrl("),
  sourceRange("  function getNormalisedLabel(", "  function getWatchActionLabels("),
  sourceRange("  function createRestoredActionIcon(", "  function hasRydLikeButtonLabel("),
].join("\n");
let browser;
before(async () => { browser = await launchFixtureBrowser(); }, { timeout: 30000 });
after(async () => { await browser?.close(); }, { timeout: 10000 });

async function openFixture(t, surface) {
  const context = await browser.newContext({ serviceWorkers: "block" });
  await context.route("**/*", route => route.abort());
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  t.after(async () => {
    try { assert.deepEqual(errors, []); }
    finally { await context.close(); }
  });
  await page.setContent(`<!doctype html><html lang="en-GB"><head><style>
    ytd-watch-flexy,ytd-watch-metadata,ytd-menu-renderer,yt-player-quick-action-buttons,
    like-button-view-model,dislike-button-view-model{display:block}
    [hidden]{display:none!important}
    button{display:flex;align-items:center;min-height:36px}
    .ytSpecButtonShapeNextIcon,.yt-icon-shape,svg{display:block;width:24px;height:24px}
  </style></head><body><ytd-watch-flexy><div class="html5-video-player"></div>
    <ytd-watch-metadata><ytd-menu-renderer id="watch-actions"></ytd-menu-renderer></ytd-watch-metadata>
  </ytd-watch-flexy></body></html>`);
  await page.evaluate(surface => {
    const container = document.createElement("div");
    container.id = "quick-action-surface";
    if (surface === "dedicated strip") container.className = "ytp-fullscreen-quick-actions";
    container.hidden = true;
    const actions = document.createElement("yt-player-quick-action-buttons");
    actions.id = "quick-actions";
    container.append(actions);
    document.querySelector(".html5-video-player").append(container);
    window.fixture = { nativeNodes: new Map(), originalMarkup: new Map() };
    const addAction = (parent, prefix, kind, nativeIcon) => {
      const wrapper = document.createElement(`${kind}-button-view-model`);
      const button = document.createElement("button");
      button.id = `${prefix}-${kind}`;
      button.className = "ytSpecButtonShapeNextIconButton";
      button.setAttribute("aria-label", `${kind === "like" ? "Like" : "Dislike"} this video`);
      button.setAttribute("aria-pressed", "false");
      if (nativeIcon) {
        const icon = document.createElement("span");
        icon.className = "ytSpecButtonShapeNextIcon";
        const shape = document.createElement("span");
        shape.className = "yt-icon-shape";
        const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
        svg.setAttribute("viewBox", "0 0 24 24");
        const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
        path.setAttribute("d", "M2 2h20v20H2z");
        svg.append(path); shape.append(svg); icon.append(shape); button.append(icon);
        fixture.nativeNodes.set(button.id, { button, wrapper, icon, shape, svg, path });
      }
      const count = document.createElement("span");
      count.className = "ytSpecButtonShapeNextButtonTextContent";
      count.textContent = kind === "like" ? "206" : "2";
      button.append(count);
      button.addEventListener("click", () => {
        button.dataset.clicks = String(Number(button.dataset.clicks || 0) + 1);
        button.setAttribute("aria-pressed", button.getAttribute("aria-pressed") === "false" ? "true" : "false");
      });
      wrapper.append(button); parent.append(wrapper);
      fixture.originalMarkup.set(button.id, button.outerHTML);
    };
    for (const kind of ["like", "dislike"]) {
      addAction(actions, "quick", kind, true);
      addAction(document.getElementById("watch-actions"), "watch", kind, false);
    }
  }, surface);
  await page.addScriptTag({ content: `(() => {
    ${NORMALISERS}
    window.rydQuickActionAudit = () => {
      for (const button of document.querySelectorAll('like-button-view-model button')) normaliseRydLikeButton(button);
      for (const button of document.querySelectorAll('dislike-button-view-model button')) normaliseRydDislikeButton(button);
    };
  })();` });
  return page;
}

for (const surface of ["dedicated strip", "standalone quick-action component"]) {
  test(`RYD repair leaves hidden-to-visible ${surface} native artwork and handlers untouched`, async t => {
    const page = await openFixture(t, surface);
    await page.evaluate(() => { rydQuickActionAudit(); rydQuickActionAudit(); });
    for (const kind of ["like", "dislike"]) {
      assert.equal(await page.locator(`#quick-${kind}`).evaluate(button => button.outerHTML === fixture.originalMarkup.get(button.id)), true,
        "A hidden native quick-action button must not receive fallback icons, text or layout classes");
    }
    await page.evaluate(() => { document.getElementById("quick-action-surface").hidden = false; });
    await page.evaluate(() => { rydQuickActionAudit(); rydQuickActionAudit(); });
    for (const [kind, count] of [["like", "206"], ["dislike", "2"]]) {
      const button = page.locator(`#quick-${kind}`);
      assert.equal(await button.locator("svg").count(), 1, "Only the original native artwork is present");
      assert.equal(await button.locator('[data-ytppl-empty-ryd-icon], .ytppl-ryd-like-icon, .ytppl-ryd-dislike-icon').count(), 0);
      assert.equal(await button.locator(".ytSpecButtonShapeNextButtonTextContent").innerText(), count);
      assert.equal(await button.evaluate(button => {
        const nodes = fixture.nativeNodes.get(button.id);
        return nodes.button === button && nodes.wrapper === button.parentElement &&
          [nodes.icon, nodes.shape, nodes.svg, nodes.path].every(node => button.contains(node));
      }), true);
      assert.equal(await button.getAttribute("aria-pressed"), "false");
      await button.click();
      assert.equal(await button.getAttribute("aria-pressed"), "true");
      assert.equal(await button.getAttribute("data-clicks"), "1");
      await page.evaluate(() => rydQuickActionAudit());
      assert.equal(await button.getAttribute("aria-pressed"), "true");
      assert.equal(await button.locator("svg").count(), 1);
    }
  });
}

test("RYD repair still restores missing normal watch-action icons exactly once", async t => {
  const page = await openFixture(t, "dedicated strip");
  await page.evaluate(() => { rydQuickActionAudit(); rydQuickActionAudit(); });
  for (const [kind, count] of [["like", "206"], ["dislike", "2"]]) {
    const button = page.locator(`#watch-${kind}`);
    assert.equal(await button.locator(`.ytppl-ryd-${kind}-icon`).count(), 1);
    assert.equal(await button.locator("svg").count(), 1);
    assert.equal(await button.locator(".ytSpecButtonShapeNextButtonTextContent").innerText(), count);
    assert.equal(await button.getAttribute("aria-label"), `${kind === "like" ? "Like" : "Dislike"} this video`);
    await button.click();
    assert.equal(await button.getAttribute("data-clicks"), "1");
    assert.equal(await button.getAttribute("aria-pressed"), "true");
  }
});
