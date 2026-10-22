import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { after, before, test } from "node:test";
import { launchFixtureBrowser } from "./fixture-browser.mjs";

const FIXTURE = readFileSync(new URL("./watch-page.html", import.meta.url), "utf8")
  .replace('lang="en"', 'lang="en-GB"');
const WATCH_URL = "https://www.youtube.com/watch?v=aaaaaaaaaaa&list=fixture-queue";
const MODULES = [
  { name: "Miniplayer Restorer", filename: "youtube-miniplayer-button-restorer.user.js" },
  { name: "Scroll Miniplayer", filename: "youtube-scroll-miniplayer.user.js" },
].map(module => ({ ...module, source: readFileSync(
  new URL(`../../sources/modules/${module.filename}`, import.meta.url), "utf8",
) }));
let browser;

before(async () => { browser = await launchFixtureBrowser(); }, { timeout: 30000 });
after(async () => { await browser?.close(); }, { timeout: 10000 });

async function open(t, module, { native = true } = {}) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, serviceWorkers: "block" });
  await context.route("**/*", route => route.request().url() === WATCH_URL
    ? route.fulfill({ contentType: "text/html", body: FIXTURE }) : route.abort());
  const page = await context.newPage(); page.setDefaultTimeout(7000);
  const errors = []; page.on("pageerror", error => errors.push(error.message));
  t.after(async () => { try { assert.deepEqual(errors, []); } finally { await context.close(); } });
  await page.goto(WATCH_URL);
  await page.evaluate(native => {
    const playerHost = document.getElementById("player");
    const anchor = document.createElement("div"); anchor.id = "single-column-container";
    playerHost.before(anchor); anchor.append(playerHost);
    if (!native) document.querySelector(".ytp-miniplayer-button")?.remove();
    window.observerFixture = {
      queries: 0, geometry: 0, styles: 0,
      reset() { this.queries = this.geometry = this.styles = 0; },
      makeDialog(id) {
        const dialog = document.createElement("dialog"); dialog.id = id;
        const field = document.createElement("p"); field.textContent = "Saved";
        dialog.append(field); document.body.append(dialog); return dialog;
      },
    };
    for (const method of ["querySelector", "querySelectorAll"]) {
      const original = document[method].bind(document);
      document[method] = selector => { observerFixture.queries++; return original(selector); };
    }
    for (const method of ["getBoundingClientRect", "getClientRects"]) {
      const original = Element.prototype[method];
      Element.prototype[method] = function (...args) {
        observerFixture.geometry++; return original.apply(this, args);
      };
    }
    const style = window.getComputedStyle;
    window.getComputedStyle = (...args) => { observerFixture.styles++; return style(...args); };
  }, native);
  await page.addScriptTag({ content: module.source });
  await page.evaluate(async () => {
    await new Promise(requestAnimationFrame); await new Promise(requestAnimationFrame);
  });
  return page;
}

for (const module of MODULES) {
  test(`${module.name}: fields and text inside both Suite dialogues trigger no watch discovery or layout reads`, async t => {
    const page = await open(t, module);
    const counts = await page.evaluate(async () => {
      const settings = observerFixture.makeDialog("ytms-settings-dialog");
      const filters = observerFixture.makeDialog("ytms-age-dialog");
      settings.show(); filters.show();
      await new Promise(requestAnimationFrame); await new Promise(requestAnimationFrame);
      observerFixture.reset();
      for (const dialog of [settings, filters]) {
        const status = dialog.firstElementChild;
        for (let index = 0; index < 100; index++) {
          status.textContent = String(index); await Promise.resolve();
          const field = document.createElement("label");
          field.append(document.createElement("input")); dialog.append(field);
          await Promise.resolve(); field.remove(); await Promise.resolve();
        }
      }
      return { queries: observerFixture.queries, geometry: observerFixture.geometry, styles: observerFixture.styles };
    });
    assert.deepEqual(counts, { queries: 0, geometry: 0, styles: 0 });
  });

  test(`${module.name}: body mounting, removal, same-ID wrappers and nested native topology retain discovery`, async t => {
    const page = await open(t, module);
    const results = await page.evaluate(async () => {
      const read = () => ({ queries: observerFixture.queries, geometry: observerFixture.geometry });
      observerFixture.reset();
      const dialog = observerFixture.makeDialog("ytms-settings-dialog");
      await Promise.resolve(); const mounting = read();
      observerFixture.reset(); dialog.remove(); await Promise.resolve(); const removal = read();
      const fake = document.createElement("div"); fake.id = "ytms-settings-dialog";
      document.body.append(fake); await Promise.resolve(); observerFixture.reset();
      fake.append(document.createElement("span")); await Promise.resolve(); const wrapper = read();
      fake.remove(); document.body.append(dialog); await Promise.resolve(); observerFixture.reset();
      const nested = document.createElement("div");
      const player = document.createElement("div"); player.id = "movie_player";
      nested.append(player); dialog.append(nested); await Promise.resolve(); const native = read();
      nested.remove();
      return { mounting, removal, wrapper, native };
    });
    for (const [name, counts] of Object.entries(results)) {
      assert.ok(counts.queries > 0 && counts.geometry > 0, `${name} must retain the existing discovery path: ${JSON.stringify(counts)}`);
    }
  });
}

test("mixed Suite text edits and native toolbar replacement still restore the miniplayer button", async t => {
  const page = await open(t, MODULES[0], { native: false });
  await page.evaluate(() => {
    observerFixture.dialog = observerFixture.makeDialog("ytms-settings-dialog");
  });
  await page.locator("#tmk-miniplayer-button").waitFor({ state: "visible" });
  await page.evaluate(() => {
    observerFixture.dialog.firstElementChild.textContent = "Changed";
    const controls = document.querySelector(".ytp-right-controls");
    observerFixture.replacement = document.createElement("div");
    observerFixture.replacement.className = "ytp-right-controls";
    controls.replaceWith(observerFixture.replacement);
  });
  await page.waitForFunction(() => document.getElementById("tmk-miniplayer-button")?.parentElement === observerFixture.replacement);
  assert.equal(await page.locator("#tmk-miniplayer-button").count(), 1);
});

test("mixed Suite edits and native player removal still recover and adopt the floated player", async t => {
  const page = await open(t, MODULES[1]);
  await page.evaluate(() => {
    observerFixture.dialog = observerFixture.makeDialog("ytms-age-dialog");
    window.scrollTo(0, 800);
  });
  await page.waitForFunction(() => document.body.classList.contains("ytsmp-scroll-miniplayer-active"));
  await page.evaluate(() => {
    const oldPlayer = document.getElementById("movie_player");
    const replacement = document.createElement("div");
    replacement.id = "movie_player"; replacement.className = "html5-video-player";
    const video = document.createElement("video"); video.className = "html5-main-video";
    replacement.append(video); replacement.getVideoData = () => ({ video_id: "aaaaaaaaaaa" });
    observerFixture.replacement = replacement;
    observerFixture.dialog.firstElementChild.textContent = "Replacement arrived";
    document.getElementById("player").append(replacement); oldPlayer.remove();
  });
  await page.waitForFunction(() => observerFixture.replacement.parentElement === document.body &&
    document.body.classList.contains("ytsmp-scroll-miniplayer-active"));
  assert.equal(await page.locator("#movie_player").count(), 1);
  await page.evaluate(() => {
    const native = document.createElement("ytd-miniplayer");
    native.style.cssText = "display:block;position:fixed;left:0;top:0;width:640px;height:360px";
    document.body.append(native);
    observerFixture.dialog.firstElementChild.textContent = "Native adoption";
    native.append(observerFixture.replacement); observerFixture.native = native;
  });
  await page.waitForFunction(() => observerFixture.replacement.parentElement === observerFixture.native &&
    !document.body.classList.contains("ytsmp-scroll-miniplayer-active"));
});
