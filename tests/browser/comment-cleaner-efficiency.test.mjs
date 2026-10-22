import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { after, before, test } from "node:test";
import { launchFixtureBrowser } from "./fixture-browser.mjs";

const SOURCE = readFileSync(
  new URL("../../sources/modules/youtube-comment-cleaner.user.js", import.meta.url),
  "utf8",
);
const WATCH_URL = "https://www.youtube.com/watch?v=aaaaaaaaaaa";
let browser;

before(async () => { browser = await launchFixtureBrowser(); }, { timeout: 30000 });
after(async () => { await browser?.close(); }, { timeout: 10000 });

async function open(t, count = 1) {
  const context = await browser.newContext({ serviceWorkers: "block" });
  await context.route("**/*", route => route.request().url() === WATCH_URL
    ? route.fulfill({ contentType: "text/html", body: `<!doctype html>
      <html lang="en-GB"><title>Comment efficiency fixture</title><body>
      <ytd-watch-flexy video-id="aaaaaaaaaaa"><ytd-watch-metadata>
      <div id="owner"><a href="/@uploader">Uploader</a></div></ytd-watch-metadata>
      <ytd-comments></ytd-comments></ytd-watch-flexy></body></html>` })
    : route.abort());
  const page = await context.newPage();
  page.setDefaultTimeout(5000);
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  t.after(async () => {
    try { assert.deepEqual(errors, []); }
    finally { await context.close(); }
  });
  await page.goto(WATCH_URL);
  await page.evaluate(count => {
    window.fixture = {
      traversals: 0, visited: 0, containsCalls: 0, queueApplied: [],
      makeComment(handle = "viewer") {
        const comment = document.createElement("ytd-comment-renderer");
        comment.innerHTML = `<a href="/@${handle}"><span>${handle}</span></a>
          <div id="like-button"></div><div id="dislike-button"></div>
          <span id="vote-count-left"></span><yt-icon-button>
          <button id="button" aria-label="More actions"></button></yt-icon-button><p>Comment</p>`;
        return comment;
      },
      reset() {
        this.traversals = 0;
        this.visited = 0;
        this.containsCalls = 0;
        this.queueApplied.length = 0;
      },
    };
    const nativeContains = Node.prototype.contains;
    Node.prototype.contains = function (other) {
      fixture.containsCalls++;
      return nativeContains.call(this, other);
    };
    const comments = document.querySelector("ytd-comments");
    for (let index = 0; index < count; index++) {
      comments.append(fixture.makeComment(index === 0 ? "uploader" : "viewer"));
    }
    for (const prototype of [Element.prototype, ShadowRoot.prototype]) {
      const original = prototype.querySelectorAll;
      prototype.querySelectorAll = function (selector) {
        const result = original.call(this, selector);
        if (selector === "*") {
          fixture.traversals++;
          fixture.visited += result.length;
        }
        return result;
      };
    }
    window.GM_addStyle = css => {
      const style = document.createElement("style");
      style.textContent = css;
      document.head.append(style);
    };
  }, count);
  return page;
}

async function install(page, { queueProbe = false } = {}) {
  let source = SOURCE;
  if (queueProbe) {
    const applyHeader = /  const applyAll = \(root = document\) => \{\r?\n    if \(!isWatchPath\(\)\) return;/;
    assert.match(source, applyHeader);
    source = source.replace(applyHeader, `$&
    fixture.queueApplied.push(root.id || root.nodeName);
    fixture.afterQueueApply?.(root);`);
    const observingHeader = "  const startObserving = () => {";
    assert.ok(source.includes(observingHeader));
    source = source.replace(observingHeader, `
  fixture.queue = { schedule: scheduleApply, pause: () => observer.disconnect() };
${observingHeader}`);
  }
  return page.evaluate(source => {
    (0, eval)(source);
    return { traversals: fixture.traversals, visited: fixture.visited };
  }, source);
}

async function settle(page, count = 3) {
  await page.evaluate(count => new Promise(resolve => {
    function next() {
      if (--count === 0) resolve();
      else requestAnimationFrame(next);
    }
    requestAnimationFrame(next);
  }), count);
}

async function openQueue(t, count = 1) {
  const page = await open(t, count);
  await install(page, { queueProbe: true });
  await page.waitForFunction(() => fixture.traversals === 2);
  await page.evaluate(() => { fixture.queue.pause(); fixture.reset(); });
  return page;
}

async function styling(page, expression = "document.querySelector('ytd-comments')") {
  return page.evaluate(expression => {
    const root = (0, eval)(expression);
    const author = root.querySelector('a[href^="/@"]');
    const child = author.querySelector("span");
    const read = element => [
      element.style.getPropertyValue("color"),
      element.style.getPropertyPriority("color"),
      element.style.getPropertyValue("font-weight"),
    ];
    return {
      author: read(author), child: read(child),
      controlsHidden: [...root.querySelectorAll("#like-button,#dislike-button,#vote-count-left,yt-icon-button")]
        .every(element => element.hidden && element.dataset.iowHidden === "1" &&
          element.style.getPropertyValue("display") === "none"),
    };
  }, expression);
}

test("source discovers 900 comment descendants once per immediate and delayed pass", async t => {
  const page = await open(t, 100);
  const first = await install(page);
  assert.deepEqual(first, { traversals: 1, visited: 900 });
  assert.deepEqual(await styling(page), {
    author: ["rgb(255, 159, 28)", "important", "700"],
    child: ["rgb(255, 159, 28)", "important", "700"],
    controlsHidden: true,
  });
  assert.equal(await page.locator('ytd-comments a[href="/@viewer"]').first()
    .evaluate(element => element.style.getPropertyValue("color")), "rgb(130, 163, 230)");
  await page.waitForFunction(() => fixture.traversals === 2);
  assert.deepEqual(await page.evaluate(() => ({ traversals: fixture.traversals, visited: fixture.visited })),
    { traversals: 2, visited: 1800 });
});

test("subsequent source passes discover nested and newly attached open shadow roots", async t => {
  const page = await open(t);
  await page.evaluate(() => {
    const host = document.createElement("div");
    host.id = "shadow-host";
    document.querySelector("ytd-comments").append(host);
    const shadow = host.attachShadow({ mode: "open" });
    shadow.innerHTML = '<ytd-comments></ytd-comments><div id="nested-host"></div>';
    shadow.querySelector("ytd-comments").append(fixture.makeComment("uploader"));
  });
  await install(page);
  const firstShadow = "document.querySelector('#shadow-host').shadowRoot.querySelector('ytd-comments')";
  assert.deepEqual(await styling(page, firstShadow), {
    author: ["rgb(255, 159, 28)", "important", "700"],
    child: ["rgb(255, 159, 28)", "important", "700"],
    controlsHidden: true,
  });
  await page.waitForFunction(() => fixture.traversals === 4);
  await page.evaluate(() => {
    const nested = document.querySelector("#shadow-host").shadowRoot
      .querySelector("#nested-host").attachShadow({ mode: "open" });
    nested.innerHTML = "<ytd-comments></ytd-comments>";
    nested.querySelector("ytd-comments").append(fixture.makeComment("viewer"));
    fixture.reset();
    window.dispatchEvent(new Event("yt-page-data-updated"));
  });
  await page.waitForFunction(() => fixture.traversals >= 3);
  const nestedShadow = "document.querySelector('#shadow-host').shadowRoot.querySelector('#nested-host').shadowRoot.querySelector('ytd-comments')";
  assert.deepEqual(await styling(page, nestedShadow), {
    author: ["rgb(130, 163, 230)", "important", "700"],
    child: ["rgb(130, 163, 230)", "important", "700"],
    controlsHidden: true,
  });
});

test("inserted author roots are coloured and route exit prevents delayed styling", async t => {
  const page = await open(t);
  await install(page);
  await page.evaluate(() => {
    const author = document.createElement("a");
    author.id = "inserted-author";
    author.href = "/@uploader";
    author.innerHTML = "<span>Uploader</span>";
    document.querySelector("ytd-comments ytd-comment-renderer").append(author);
  });
  await page.waitForFunction(() => document.querySelector("#inserted-author")
    .style.getPropertyValue("color") === "rgb(255, 159, 28)");
  await page.evaluate(() => {
    history.replaceState(null, "", "/");
    window.dispatchEvent(new Event("yt-navigate-finish"));
    fixture.reset();
    const comment = fixture.makeComment("unprocessed");
    comment.id = "off-route-comment";
    document.querySelector("ytd-comments").append(comment);
    window.setTimeout(() => { fixture.routeDeadlinePassed = true; }, 400);
  });
  await page.waitForFunction(() => fixture.routeDeadlinePassed);
  assert.deepEqual(await page.evaluate(() => ({
    traversals: fixture.traversals,
    visited: fixture.visited,
    colour: document.querySelector('#off-route-comment a').style.getPropertyValue("color"),
    hidden: document.querySelector('#off-route-comment #like-button').hidden,
  })), { traversals: 0, visited: 0, colour: "", hidden: false });
});

test("500 native sibling comment roots queue without pairwise containment checks", async t => {
  const page = await openQueue(t, 500);
  await page.evaluate(() => {
    document.querySelectorAll("ytd-comment-renderer").forEach((comment, index) => {
      comment.id = `queued-comment-${index}`;
      fixture.queue.schedule(comment);
    });
  });
  await settle(page);
  assert.deepEqual(await page.evaluate(() => ({
    containsCalls: fixture.containsCalls,
    applied: fixture.queueApplied,
  })), {
    containsCalls: 0,
    applied: Array.from({ length: 500 }, (_, index) => `queued-comment-${index}`),
  });
  assert.deepEqual(await styling(page), {
    author: ["rgb(255, 159, 28)", "important", "700"],
    child: ["rgb(255, 159, 28)", "important", "700"],
    controlsHidden: true,
  });
});

for (const moveInside of [false, true]) {
  test(`native comment roots moved ${moveInside ? "inside" : "outside"} queued ancestors use current ancestry`, async t => {
    const page = await openQueue(t);
    await page.evaluate(moveInside => {
      const comments = document.querySelector("ytd-comments");
      const comment = comments.querySelector("ytd-comment-renderer");
      comment.id = "queued-comment";
      const wrapper = document.createElement("div");
      wrapper.id = "queued-wrapper";
      comments.append(wrapper);
      if (!moveInside) wrapper.append(comment);
      fixture.queue.schedule(comment);
      fixture.queue.schedule(wrapper);
      if (moveInside) wrapper.append(comment);
      else comments.append(comment);
    }, moveInside);
    await settle(page);
    assert.deepEqual(await page.evaluate(() => fixture.queueApplied),
      moveInside ? ["queued-wrapper"] : ["queued-comment", "queued-wrapper"]);
    assert.equal((await styling(page)).controlsHidden, true);
  });
}

test("native disconnected ancestors do not discard reattached comments or reorder surviving roots", async t => {
  const page = await openQueue(t, 2);
  await page.evaluate(() => {
    const comments = document.querySelector("ytd-comments");
    const [comment, sibling] = comments.querySelectorAll("ytd-comment-renderer");
    comment.id = "reattached-comment";
    sibling.id = "sibling-comment";
    const wrapper = document.createElement("div");
    wrapper.id = "detached-wrapper";
    comments.append(wrapper);
    wrapper.append(comment);
    fixture.queue.schedule(wrapper);
    fixture.queue.schedule(comment);
    fixture.queue.schedule(sibling);
    wrapper.remove();
    comments.append(comment);
  });
  await settle(page);
  assert.deepEqual(await page.evaluate(() => fixture.queueApplied),
    ["reattached-comment", "sibling-comment"]);
});

test("native comment queue retains document and shadow-tree containment semantics", async t => {
  const page = await openQueue(t);
  await page.evaluate(() => {
    const host = document.createElement("div");
    host.id = "queued-shadow-host";
    document.querySelector("ytd-comments").append(host);
    const shadow = host.attachShadow({ mode: "open" });
    const comments = document.createElement("ytd-comments");
    const comment = fixture.makeComment("viewer");
    comment.id = "queued-shadow-comment";
    shadow.append(comments);
    comments.append(comment);
    fixture.queue.schedule(host);
    fixture.queue.schedule(comment);
    fixture.queue.schedule(document);
  });
  await settle(page);
  assert.deepEqual(await page.evaluate(() => fixture.queueApplied),
    ["queued-shadow-comment", "#document"]);
  assert.deepEqual(await styling(page,
    "document.querySelector('#queued-shadow-host').shadowRoot"), {
    author: ["rgb(130, 163, 230)", "important", "700"],
    child: ["rgb(130, 163, 230)", "important", "700"],
    controlsHidden: true,
  });
  await page.evaluate(() => {
    fixture.reset();
    const host = document.getElementById("queued-shadow-host");
    fixture.queue.schedule(host);
    fixture.queue.schedule(host.shadowRoot.querySelector("ytd-comment-renderer"));
  });
  await settle(page);
  assert.deepEqual(await page.evaluate(() => fixture.queueApplied),
    ["queued-shadow-host", "queued-shadow-comment"]);
  await page.evaluate(() => {
    fixture.reset();
    const shadow = document.getElementById("queued-shadow-host").shadowRoot;
    fixture.queue.schedule(shadow.querySelector("ytd-comment-renderer"));
    fixture.queue.schedule(shadow);
  });
  await settle(page);
  assert.deepEqual(await page.evaluate(() => fixture.queueApplied), ["#document-fragment"]);
});

test("native comment work enqueued during a pass runs on the next frame", async t => {
  const page = await openQueue(t, 2);
  const result = await page.evaluate(() => new Promise(resolve => {
    const [first, later] = document.querySelectorAll("ytd-comment-renderer");
    first.id = "first-comment";
    later.id = "later-comment";
    fixture.afterQueueApply = root => {
      if (root === first) fixture.queue.schedule(later);
    };
    fixture.queue.schedule(first);
    requestAnimationFrame(() => {
      const firstFrame = [...fixture.queueApplied];
      requestAnimationFrame(() => {
        fixture.afterQueueApply = null;
        resolve({ firstFrame, secondFrame: [...fixture.queueApplied] });
      });
    });
  }));
  assert.deepEqual(result, {
    firstFrame: ["first-comment"], secondFrame: ["first-comment", "later-comment"],
  });
});

test("route exit discards pending comment work before the queued frame", async t => {
  const page = await openQueue(t);
  await page.evaluate(() => {
    const comment = fixture.makeComment("off-route");
    comment.id = "pending-route-comment";
    document.querySelector("ytd-comments").append(comment);
    fixture.queue.schedule(comment);
    history.replaceState(null, "", "/");
    window.dispatchEvent(new Event("yt-navigate-finish"));
    fixture.queue.schedule(comment);
  });
  await settle(page);
  assert.deepEqual(await page.evaluate(() => ({
    roots: fixture.queueApplied,
    traversals: fixture.traversals,
    colour: document.querySelector("#pending-route-comment a").style.color,
    hidden: document.querySelector("#pending-route-comment #like-button").hidden,
  })), { roots: [], traversals: 0, colour: "", hidden: false });
});
