import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const catalogue = JSON.parse(readFileSync(new URL("../assets/recommended-extensions.json", import.meta.url), "utf8"));
const moduleSource = readFileSync(new URL("../sources/modules/youtube-suite-settings.user.js", import.meta.url), "utf8");

test("recommendations contain exactly the four requested projects with official HTTPS links", () => {
  assert.deepEqual(catalogue.map(({ id, name, url }) => [id, name, url]), [
    ["ryd", "Return YouTube Dislike", "https://returnyoutubedislike.com/install"],
    ["sponsorblock", "SponsorBlock", "https://sponsor.ajay.app/"],
    ["dearrow", "DeArrow", "https://dearrow.ajay.app/"],
    ["ublock", "uBlock Origin", "https://github.com/gorhill/uBlock"],
  ]);
  for (const extension of catalogue) {
    assert.ok(extension.description.length > 20);
    assert.ok(extension.note.length > 20);
    const url = new URL(extension.url);
    assert.equal(url.protocol, "https:");
    assert.equal(url.username + url.password + url.search + url.hash, "");
  }
});

test("extension logos are embedded, bounded and passive, without private profile data", () => {
  for (const { logo } of catalogue) {
    const match = logo.match(/^data:(image\/(?:png|svg\+xml));base64,([A-Za-z0-9+/]+={0,2})$/);
    assert.ok(match);
    const content = Buffer.from(match[2], "base64");
    assert.ok(content.length > 0 && content.length <= 32768);
    assert.equal(content.toString("base64"), match[2]);
    if (match[1] === "image/png") {
      assert.deepEqual([...content.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
    } else {
      assert.match(content.toString("utf8"), /<svg\b/);
      assert.doesNotMatch(content.toString("utf8"), /<(?:script|image|foreignObject)\b|\bon\w+\s*=|\b(?:href|src)\s*=|<!DOCTYPE|<!ENTITY|url\s*\(|@import/i);
    }
  }
  assert.doesNotMatch(JSON.stringify(catalogue), /(?:[A-Za-z]:\\|moz-extension:|chrome-extension:|YouTubeSSB|extensions\.json|profiles\.ini)/i);
});

test("recommendation notes distinguish dislike estimates and uBlock Origin browser support", () => {
  assert.match(catalogue[0].description, /estimated dislike counts/);
  assert.match(catalogue[0].note, /not an official live YouTube count/);
  assert.match(catalogue[3].note, /no longer available in Chrome/);
  assert.match(catalogue[3].note, /Origin Lite is a separate project/);
});

test("extension cards use native DOM only and add no installation probes or background work", () => {
  const start = moduleSource.indexOf("    const extensionsHeading =");
  const end = moduleSource.indexOf("    const credits =", start);
  assert.ok(start > 0 && end > start);
  const cards = moduleSource.slice(start, end);
  assert.match(cards, /suite\.settingsAssets\.recommendedExtensions/);
  assert.match(cards, /noopener noreferrer/);
  assert.doesNotMatch(cards, /innerHTML|outerHTML|insertAdjacentHTML|addEventListener|MutationObserver|setInterval|setTimeout|fetch\s*\(|XMLHttpRequest|GM_|localStorage|127\.0\.0\.1|localhost/);
});
