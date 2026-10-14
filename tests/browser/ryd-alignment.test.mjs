import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { after, before, test } from "node:test";
import vm from "node:vm";
import { launchFixtureBrowser } from "./fixture-browser.mjs";

const SOURCE = readFileSync(new URL(
  "../../sources/modules/youtube-player-preferences-lite.user.js", import.meta.url,
), "utf8");
const START = SOURCE.indexOf("  function buildWatchCleanupCss() {");
const END = SOURCE.indexOf("  function buildWatchLayoutCss() {", START);
assert.ok(START >= 0 && END > START, "The canonical watch-cleanup CSS must exist");
const CSS = vm.runInNewContext(`${SOURCE.slice(START, END)}\nbuildWatchCleanupCss();`, {
  CONFIG: {},
  WATCH_ACTION_HIDDEN_SELECTOR: '[data-fixture-hidden="1"]',
  EMPTY_RYD_ICON_ATTRIBUTE: "data-ytppl-empty-ryd-icon",
  RESTORED_LIKE_ICON_CLASS: "ytppl-ryd-like-icon",
  RESTORED_DISLIKE_ICON_CLASS: "ytppl-ryd-dislike-icon",
  WATCH_INFO_STATIC_TEXT_CLASS: "fixture-static-info",
  WATCH_INFO_NATIVE_CONTAINER_SELECTOR: "#fixture-native-info",
  WATCH_INFO_NATIVE_HIDDEN_ATTRIBUTE: "data-fixture-native-info-hidden",
});

let browser;
before(async () => { browser = await launchFixtureBrowser(); }, { timeout: 30000 });
after(async () => { await browser?.close(); }, { timeout: 10000 });

const WRAPPERS = [
  { name: "legacy segmented IDs", like: '<div id="segmented-like-button">', dislike: '<div id="segmented-dislike-button">', end: "</div>" },
  { name: "legacy plain IDs", like: '<div id="like-button">', dislike: '<div id="dislike-button">', end: "</div>" },
  { name: "modern view models", like: "<like-button-view-model>", dislike: "<dislike-button-view-model>", likeEnd: "</like-button-view-model>", end: "</dislike-button-view-model>" },
];
const TEXT_CLASSES = [
  "ytSpecButtonShapeNextButtonTextContent",
  "yt-spec-button-shape-next__button-text-content",
];

for (const wrapper of WRAPPERS) {
  for (const textClass of TEXT_CLASSES) {
    test(`RYD alignment: ${wrapper.name}, ${textClass}`, { timeout: 10000 }, async t => {
      const context = await browser.newContext();
      t.after(async () => { await context.close(); });
      await context.route("**/*", route => route.abort());
      const page = await context.newPage();
      await page.setContent(`<!doctype html><html><head><style>
        body { margin: 0; font: 14px Arial, sans-serif; }
        ytd-watch-flexy, ytd-menu-renderer { display: block; }
        ytd-menu-renderer { display: flex; }
        button { display: flex; align-items: center; height: 36px; padding: 0 12px;
          color: white; background: #272727; border: none; font: inherit; }
        .fixture-icon { display: block; width: 24px; height: 24px; margin-right: 6px; }
        .${textClass} { display: inline-block; height: 18px; line-height: 18px; }
        #fixture-dislike .${textClass}, .outside-count { transform: translateY(5px); }
      </style></head><body>
        <ytd-watch-flexy><ytd-menu-renderer>
          ${wrapper.like}<button id="fixture-like" aria-pressed="false"><span class="fixture-icon"></span><div class="${textClass}"><span role="text">206</span></div></button>${wrapper.likeEnd || wrapper.end}
          ${wrapper.dislike}<button id="fixture-dislike" aria-pressed="false"><span class="fixture-icon"></span><div class="${textClass}"><span role="text">2</span></div></button>${wrapper.end}
          <button id="fixture-share"><span class="${textClass} outside-count">Share</span></button>
        </ytd-menu-renderer>
          <ytd-comment-renderer><div id="dislike-button"><button id="fixture-comment"><span class="${textClass} outside-count">4</span></button></div></ytd-comment-renderer>
        </ytd-watch-flexy>
        <div id="dislike-button"><button id="fixture-offwatch"><span class="${textClass} outside-count">7</span></button></div>
      </body></html>`);
      await page.addStyleTag({ content: CSS });

      async function measure(buttonId) {
        return page.locator(`#${buttonId} .${textClass}`).evaluate(count => {
          const bounds = count.getBoundingClientRect();
          const buttonBounds = count.closest("button").getBoundingClientRect();
          const style = getComputedStyle(count);
          return {
            value: count.textContent,
            centreDifference: bounds.top + bounds.height / 2 - buttonBounds.top - buttonBounds.height / 2,
            height: bounds.height, lineHeight: style.lineHeight,
            display: style.display, transform: style.transform,
          };
        });
      }

      for (const [id, value] of [["fixture-like", "206"], ["fixture-dislike", "2"]]) {
        const count = await measure(id);
        assert.equal(count.value, value, "Alignment must not rewrite a count");
        assert.equal(count.height, 24);
        assert.equal(count.lineHeight, "24px");
        // Native button flex layout blockifies inline-flex flex items.
        assert.equal(count.display, "flex");
        assert.equal(count.transform, "none");
        assert.ok(Math.abs(count.centreDifference) <= 0.5, JSON.stringify(count));
      }

      await page.locator(`#fixture-dislike .${textClass} span`).evaluate(count => {
        count.textContent = "314";
      });
      const updated = await measure("fixture-dislike");
      assert.equal(updated.value, "314", "Later RYD updates must remain untouched");
      assert.ok(Math.abs(updated.centreDifference) <= 0.5, JSON.stringify(updated));
      assert.equal(await page.locator("#fixture-dislike").getAttribute("aria-pressed"), "false");

      for (const id of ["fixture-share", "fixture-comment", "fixture-offwatch"]) {
        const count = await measure(id);
        assert.equal(count.height, 18, `${id} must retain its native sizing`);
        assert.equal(count.lineHeight, "18px");
        assert.notEqual(count.transform, "none", `${id} is outside watch-action alignment scope`);
      }
    });
  }
}
