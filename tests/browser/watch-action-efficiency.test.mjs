import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { after, before, test } from "node:test";
import { launchFixtureBrowser } from "./fixture-browser.mjs";

const SOURCE = readFileSync(new URL("../../sources/modules/youtube-player-preferences-lite.user.js", import.meta.url), "utf8");
const WATCH_URL = "https://www.youtube.com/watch?v=aaaaaaaaaaa";
let browser;
before(async () => { browser = await launchFixtureBrowser(); }, { timeout: 30000 });
after(async () => { await browser?.close(); }, { timeout: 10000 });

async function open(t, { disabled = false } = {}) {
  const context = await browser.newContext({ serviceWorkers: "block" });
  await context.route("**/*", route => route.request().url() === WATCH_URL ? route.fulfill({
    contentType: "text/html", body: `<!doctype html><html lang="en-GB"><style>
      ytd-watch-flexy,ytd-watch-metadata,ytd-menu-renderer,ytd-popup-container,
      tp-yt-iron-dropdown,yt-sheet-view-model,yt-list-item-view-model,button-view-model{display:block}
      [hidden]{display:none!important}button{min-width:120px;min-height:32px}
      </style><body><ytd-watch-flexy video-id="aaaaaaaaaaa"><ytd-watch-metadata>
      <ytd-menu-renderer id="inline-actions">
      <button-view-model id="inline-unknown"><button>Bookmark</button></button-view-model>
      <button-view-model id="inline-save"><button>Save</button></button-view-model>
      <div id="like-button"><button-view-model id="inline-preserved"><button>Share</button></button-view-model></div>
      </ytd-menu-renderer></ytd-watch-metadata></ytd-watch-flexy>
      <ytd-popup-container><tp-yt-iron-dropdown><yt-sheet-view-model id="menu-actions">
      <yt-list-item-view-model id="menu-unknown"><button role="menuitem">Bookmark</button></yt-list-item-view-model>
      <yt-list-item-view-model id="menu-save"><button role="menuitem">Save</button></yt-list-item-view-model>
      </yt-sheet-view-model></tp-yt-iron-dropdown></ytd-popup-container></body></html>`,
  }) : route.abort());
  const page = await context.newPage();
  page.setDefaultTimeout(5000);
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  t.after(async () => { try { assert.deepEqual(errors, []); } finally { await context.close(); } });
  await page.goto(WATCH_URL);
  await page.evaluate(() => {
    window.fixture = { labelReads: [], nativeCalls: [] };
    const innerText = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "innerText");
    for (const row of document.querySelectorAll('[id^="inline-"],[id^="menu-"]')) {
      if (row.id.endsWith("actions")) continue;
      Object.defineProperty(row, "innerText", {
        get() { fixture.innerTextReads.push(row.id); return innerText.get.call(row); },
      });
      row.querySelector("button").onclick = () => fixture.nativeCalls.push(row.id);
    }
    fixture.innerTextReads = [];
    window.GM_addStyle = css => { const style = document.createElement("style"); style.textContent = css; document.head.append(style); };
  });
  let source = SOURCE.replace("    hideInlineSaveButton: false,", "    hideInlineSaveButton: true,");
  if (disabled) {
    for (const key of ["hideAskButton", "hideThanksButton", "hideShareButton", "hideInlineSaveButton"]) {
      source = source.replace(`    ${key}: true,`, `    ${key}: false,`);
    }
  }
  const labelMarker = "  function getWatchActionLabels(actionElement) {";
  assert.ok(source.includes(labelMarker));
  source = source.replace(labelMarker, `${labelMarker}\n    fixture.labelReads.push(actionElement.id);`);
  const observationMarker = /  applyRoutePreferences\(\);\r?\n\r?\n  const observer =/;
  assert.match(source, observationMarker);
  source = source.replace(observationMarker, `
  window.watchActionAudit = { inline: hideWatchActionButtons, menu: hideWatchActionMenuItems, pause: () => observer.disconnect() };
  applyRoutePreferences();

  const observer =`);
  await page.evaluate(source => (0, eval)(source), source);
  await page.evaluate(() => { watchActionAudit.pause(); fixture.labelReads = []; fixture.innerTextReads = []; });
  return page;
}

for (const mode of ["menu", "inline"]) {
  test(`${mode} watch-action reconciliation reads each row once and retains native handlers`, async t => {
    const page = await open(t);
    await page.evaluate(mode => watchActionAudit[mode](document.getElementById(`${mode}-actions`)), mode);
    assert.deepEqual(await page.evaluate(({ mode }) => ({
      labelReads: fixture.labelReads.filter(id => id === `${mode}-unknown`),
      innerTextReads: fixture.innerTextReads.filter(id => id === `${mode}-unknown`),
      hidden: document.getElementById(`${mode}-unknown`).hidden,
      saveHidden: document.getElementById(`${mode}-save`).hidden,
    }), { mode }), {
      labelReads: [`${mode}-unknown`], innerTextReads: [`${mode}-unknown`], hidden: false, saveHidden: mode === "inline",
    });
    if (mode === "inline") {
      assert.deepEqual(await page.evaluate(() => fixture.labelReads.filter(id => id === "inline-preserved")), []);
      assert.equal(await page.locator("#inline-preserved").isVisible(), true);
    } else {
      assert.equal(await page.locator("#menu-save button").getAttribute("role"), "menuitem");
    }
    await page.locator(`#${mode}-unknown button`).click();
    assert.deepEqual(await page.evaluate(() => fixture.nativeCalls), [`${mode}-unknown`]);
  });

  test(`${mode} watch-action reconciliation rereads native text and ARIA after reuse`, async t => {
    const page = await open(t);
    const inspect = () => page.evaluate(mode => ({
      hidden: document.getElementById(`${mode}-unknown`).hidden,
      marker: document.getElementById(`${mode}-unknown`).dataset.ytpplActionHidden,
      reads: fixture.labelReads.filter(id => id === `${mode}-unknown`).length,
    }), mode);
    await page.evaluate(mode => {
      document.querySelector(`#${mode}-unknown button`).textContent = "Share video";
      watchActionAudit[mode](document.getElementById(`${mode}-actions`));
    }, mode);
    assert.deepEqual(await inspect(), { hidden: true, marker: "1", reads: 1 });
    await page.evaluate(mode => {
      fixture.labelReads = [];
      document.querySelector(`#${mode}-unknown button`).textContent = "Bookmark";
      watchActionAudit[mode](document.getElementById(`${mode}-actions`));
    }, mode);
    assert.deepEqual(await inspect(), { hidden: false, marker: undefined, reads: 1 });
    await page.evaluate(mode => {
      fixture.labelReads = [];
      document.querySelector(`#${mode}-unknown button`).setAttribute("aria-label", "Thanks");
      watchActionAudit[mode](document.getElementById(`${mode}-actions`));
    }, mode);
    assert.deepEqual(await inspect(), { hidden: true, marker: "1", reads: 1 });
  });

  test(`${mode} watch-action reconciliation remains lazy when all label rules are off`, async t => {
    const page = await open(t, { disabled: true });
    await page.evaluate(mode => watchActionAudit[mode](document.getElementById(`${mode}-actions`)), mode);
    assert.deepEqual(await page.evaluate(() => ({ labels: fixture.labelReads, text: fixture.innerTextReads })), { labels: [], text: [] });
    assert.equal(await page.locator(`#${mode}-save`).isVisible(), true);
  });
}
