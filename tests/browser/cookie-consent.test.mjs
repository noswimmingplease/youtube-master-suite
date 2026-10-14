import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { after, before, test } from "node:test";
import { launchFixtureBrowser } from "./fixture-browser.mjs";
import { rejectYouTubeOptionalCookies } from "../../sources/youtube-cookie-consent.mjs";

const HELPER = rejectYouTubeOptionalCookies.toString();
const WATCH_URL = "https://www.youtube.com/watch?v=aaaaaaaaaaa";
const CONSENT_URL = "https://consent.youtube.com/fixture";
const OPTIONS = { timeoutMs: 220, intervalMs: 20 };
let browser;

before(async () => {
  browser = await launchFixtureBrowser();
}, { timeout: 30000 });
after(async () => { await browser?.close(); }, { timeout: 10000 });

// Instrument only disposable fixture pages. This makes timer/listener cleanup
// observable without relying solely on a delayed assertion that no click occurred.
function installProbe() {
  const probe = window.consentFixture = {
    clicks: {}, pendingTimers: new Set(), listeners: new Set(), mutationObservers: 0,
    appExecutionDepth: 0,
  };
  probe.runApp = callback => {
    probe.appExecutionDepth++;
    try { return callback(); }
    finally { probe.appExecutionDepth--; }
  };
  const nativeTimeout = window.setTimeout.bind(window);
  const nativeClearTimeout = window.clearTimeout.bind(window);
  window.setTimeout = (callback, delay, ...args) => {
    if (typeof callback !== "function") return nativeTimeout(callback, delay, ...args);
    const owned = probe.appExecutionDepth > 0;
    const id = nativeTimeout(() => {
      probe.pendingTimers.delete(id);
      if (owned) probe.runApp(() => Reflect.apply(callback, window, args));
      else Reflect.apply(callback, window, args);
    }, delay);
    if (owned) probe.pendingTimers.add(id);
    return id;
  };
  window.clearTimeout = id => {
    probe.pendingTimers.delete(id);
    nativeClearTimeout(id);
  };
  for (const [target, type] of [[window, "pagehide"], [document, "DOMContentLoaded"]]) {
    const nativeAdd = target.addEventListener.bind(target);
    const nativeRemove = target.removeEventListener.bind(target);
    const wrappedListeners = new Map();
    target.addEventListener = (eventType, listener, options) => {
      if (eventType !== type || probe.appExecutionDepth === 0) {
        nativeAdd(eventType, listener, options);
        return;
      }
      const wrapped = event => {
        if (options?.once) probe.listeners.delete(listener);
        probe.runApp(() => Reflect.apply(listener, target, [event]));
      };
      wrappedListeners.set(listener, wrapped);
      probe.listeners.add(listener);
      nativeAdd(eventType, wrapped, options);
    };
    target.removeEventListener = (eventType, listener, options) => {
      if (eventType === type) probe.listeners.delete(listener);
      nativeRemove(eventType, eventType === type && wrappedListeners.has(listener)
        ? wrappedListeners.get(listener) : listener, options);
      if (eventType === type) wrappedListeners.delete(listener);
    };
  }
  const NativeMutationObserver = window.MutationObserver;
  window.MutationObserver = class extends NativeMutationObserver {
    constructor(callback) {
      super(callback);
      if (probe.appExecutionDepth > 0) probe.mutationObservers++;
    }
  };
  document.addEventListener("click", event => {
    const button = event.target.closest?.("button");
    if (!button) return;
    const key = button.id || button.textContent.trim();
    probe.clicks[key] = (probe.clicks[key] || 0) + 1;
  }, true);
}

function fixture(body) {
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    body { color: #eee; background: #111; }
    ytd-consent-bump-v2-lightbox, ytd-consent-bump-lightbox { display: block; padding: 16px; }
    button { padding: 8px; }
  </style></head><body>${body}</body></html>`;
}

const buttons = '<button id="reject">Reject all</button><button id="accept">Accept all</button>';
const lightbox = (contents = buttons, tag = "ytd-consent-bump-v2-lightbox") =>
  `<${tag}>${contents}</${tag}>`;

async function openFixture(t, body, { url = WATCH_URL, integrated = false, routes = {} } = {}) {
  const context = await browser.newContext({
    viewport: { width: 1000, height: 700 }, serviceWorkers: "block",
  });
  const pages = new Map([[url, fixture(body)], ...Object.entries(routes)]);
  await context.route("**/*", route => pages.has(route.request().url())
    ? route.fulfill({ contentType: "text/html", body: pages.get(route.request().url()) })
    : route.abort());
  const suite = integrated
    ? readFileSync(new URL("../../youtube-master-suite.user.js", import.meta.url), "utf8")
    : "";
  // One init script guarantees instrumentation precedes the real generated Suite.
  await context.addInitScript({ content: `(${installProbe.toString()})();\nwindow.consentFixture.runApp(() => {\n${suite}\n});` });
  const page = await context.newPage();
  page.setDefaultTimeout(5000);
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  t.after(async () => {
    try { assert.deepEqual(errors, [], "Fixture must have no uncaught page errors"); }
    finally { await context.close(); }
  });
  await page.goto(url);
  return page;
}

async function start(page, options = OPTIONS) {
  return page.evaluate(({ source, options }) => {
    window.fixtureConsentController = window.consentFixture.runApp(() =>
      eval(`(${source})`)(window, document, options));
    return window.fixtureConsentController.status;
  }, { source: HELPER, options });
}

async function snapshot(page) {
  return page.evaluate(() => ({
    status: window.fixtureConsentController?.status,
    clicks: window.consentFixture.clicks,
    pendingTimers: window.consentFixture.pendingTimers.size,
    listeners: window.consentFixture.listeners.size,
    mutationObservers: window.consentFixture.mutationObservers,
  }));
}

async function waitForStatus(page, status) {
  await page.waitForFunction(expected => window.fixtureConsentController.status === expected, status);
}

function assertStopped(state, status, clicks = {}) {
  assert.equal(state.status, status);
  assert.deepEqual(state.clicks, clicks, "Only the intended rejection action may be clicked");
  assert.equal(state.pendingTimers, 0, "All discovery and deadline timers must be cleared");
  assert.equal(state.listeners, 0, "Lifecycle listeners must be removed on completion");
  assert.equal(state.mutationObservers, 0, "Consent discovery must not install a persistent observer");
}

for (const tag of ["ytd-consent-bump-v2-lightbox", "ytd-consent-bump-lightbox"]) {
  test(`exact visible Reject all inside ${tag} is clicked once, never Accept all`, async t => {
    const page = await openFixture(t, lightbox(buttons, tag));
    assert.equal(await start(page), "rejection-requested");
    await page.waitForTimeout(80);
    assertStopped(await snapshot(page), "rejection-requested", { reject: 1 });
  });
}

test("nested recognised scopes deduplicate the same rejection button", async t => {
  const page = await openFixture(t, lightbox(lightbox(buttons, "ytd-consent-bump-lightbox")));
  await start(page);
  assertStopped(await snapshot(page), "rejection-requested", { reject: 1 });
});

test("a native zero-area inline lightbox still exposes its visible positioned buttons", async t => {
  const page = await openFixture(t,
    '<ytd-consent-bump-v2-lightbox style="display:inline;padding:0">' +
    `<div style="position:fixed;left:40px;top:40px">${buttons}</div>` +
    '</ytd-consent-bump-v2-lightbox>');
  assert.equal(await page.locator("ytd-consent-bump-v2-lightbox").evaluate(scope =>
    [...scope.getClientRects()].every(rect => rect.width === 0 || rect.height === 0)), true);
  assert.equal(await page.locator("#reject").isVisible(), true);
  await start(page);
  assertStopped(await snapshot(page), "rejection-requested", { reject: 1 });
});

test("YouTube's verified descriptive rejection aria label is recognised", async t => {
  const page = await openFixture(t, lightbox(
    '<button id="reject" aria-label="Reject the use of cookies and other data for the purposes described">Reject all</button>' +
    '<button id="accept" aria-label="Accept the use of cookies and other data for the purposes described">Accept all</button>'));
  await start(page);
  assertStopped(await snapshot(page), "rejection-requested", { reject: 1 });
});

for (const [name, body] of [
  ["an ordinary page", buttons],
  ["an unrelated dialog", `<section role="dialog">${buttons}</section>`],
]) {
  test(`Reject all on ${name} is ignored`, async t => {
    const page = await openFixture(t, body);
    assert.equal(await start(page), "waiting");
    await waitForStatus(page, "timed-out");
    assertStopped(await snapshot(page), "timed-out");
  });
}

for (const [name, reject] of [
  ["hidden", '<button id="reject" hidden>Reject all</button>'],
  ["hidden ancestor", '<div hidden><button id="reject">Reject all</button></div>'],
  ["inert ancestor", '<div inert><button id="reject">Reject all</button></div>'],
  ["display none", '<button id="reject" style="display:none">Reject all</button>'],
  ["visibility hidden", '<button id="reject" style="visibility:hidden">Reject all</button>'],
  ["transparent", '<button id="reject" style="opacity:0">Reject all</button>'],
  ["disabled", '<button id="reject" disabled>Reject all</button>'],
  ["aria-disabled", '<button id="reject" aria-disabled="true">Reject all</button>'],
  ["wrong aria label", '<button id="reject" aria-label="Accept all">Reject all</button>'],
  ["conflicting descriptive acceptance label", '<button id="reject" aria-label="Accept the use of cookies and other data for the purposes described">Reject all</button>'],
  ["rejection aria label with acceptance text", '<button id="reject" aria-label="Reject all">Accept all</button>'],
  ["partial label", '<button id="reject">Reject all other settings</button>'],
]) {
  test(`${name} rejection candidate is ignored`, async t => {
    const page = await openFixture(t, lightbox(`${reject}<button id="accept">Accept all</button>`));
    await start(page);
    await waitForStatus(page, "timed-out");
    assertStopped(await snapshot(page), "timed-out");
  });
}

test("exact accessible label and whitespace-normalised text are recognised", async t => {
  const page = await openFixture(t, lightbox(
    '<button id="reject" aria-label="  Reject   all  "><span>Reject all</span></button>' +
    '<button id="accept">Accept all</button>'));
  await start(page);
  assertStopped(await snapshot(page), "rejection-requested", { reject: 1 });
});

test("duplicate visible rejection candidates fail closed without clicking either", async t => {
  const page = await openFixture(t, lightbox(
    '<button id="reject">Reject all</button><button id="duplicate">Reject all</button>' +
    '<button id="accept">Accept all</button>'));
  assert.equal(await start(page), "ambiguous");
  await page.locator("#duplicate").evaluate(button => button.remove());
  await page.waitForTimeout(80);
  assertStopped(await snapshot(page), "ambiguous");
});

test("a consent scope inserted after initial discovery is rejected once", async t => {
  const page = await openFixture(t, "<main>Waiting for YouTube consent</main>");
  assert.equal(await start(page, { timeoutMs: 1500, intervalMs: 20 }), "waiting");
  await page.evaluate(markup => document.body.insertAdjacentHTML("beforeend", markup), lightbox());
  await waitForStatus(page, "rejection-requested");
  assertStopped(await snapshot(page), "rejection-requested", { reject: 1 });
});

test("a rejection button revealed during bounded discovery is found", async t => {
  const page = await openFixture(t, lightbox(
    '<button id="reject" hidden>Reject all</button><button id="accept">Accept all</button>'));
  await start(page, { timeoutMs: 1500, intervalMs: 20 });
  await page.locator("#reject").evaluate(button => button.hidden = false);
  await waitForStatus(page, "rejection-requested");
  assertStopped(await snapshot(page), "rejection-requested", { reject: 1 });
});

test("deadline clears discovery; a later consent button and DOMContentLoaded cannot restart it", async t => {
  const page = await openFixture(t, "<main>No consent dialog yet</main>");
  await start(page);
  await waitForStatus(page, "timed-out");
  assertStopped(await snapshot(page), "timed-out");
  await page.evaluate(markup => {
    document.body.insertAdjacentHTML("beforeend", markup);
    document.dispatchEvent(new Event("DOMContentLoaded"));
  }, lightbox());
  await page.waitForTimeout(100);
  assertStopped(await snapshot(page), "timed-out");
});

test("pagehide cancels timers and lifecycle listeners; later buttons remain untouched", async t => {
  const page = await openFixture(t, "<main>No consent dialog yet</main>");
  await start(page, { timeoutMs: 1500, intervalMs: 20 });
  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent("pagehide")));
  assertStopped(await snapshot(page), "stopped");
  await page.evaluate(markup => {
    document.body.insertAdjacentHTML("beforeend", markup);
    document.dispatchEvent(new Event("DOMContentLoaded"));
  }, lightbox());
  await page.waitForTimeout(100);
  assertStopped(await snapshot(page), "stopped");
});

test("explicit stop is idempotent and cannot restart discovery", async t => {
  const page = await openFixture(t, lightbox(""));
  await start(page, { timeoutMs: 1500, intervalMs: 20 });
  await page.evaluate(() => {
    window.fixtureConsentController.stop();
    window.fixtureConsentController.stop();
  });
  assertStopped(await snapshot(page), "stopped");
});

test("a failed native rejection click is reported without retrying", async t => {
  const page = await openFixture(t, lightbox());
  await page.locator("#reject").evaluate(button => {
    button.click = () => { throw new Error("Fixture rejection failure"); };
  });
  assert.equal(await start(page), "action-failed");
  await page.waitForTimeout(80);
  assertStopped(await snapshot(page), "action-failed");
});

test("consent.youtube.com requires the visible English YouTube heading", async t => {
  const page = await openFixture(t, `<h1>Before you continue to YouTube</h1>${buttons}`,
    { url: CONSENT_URL });
  await start(page);
  assertStopped(await snapshot(page), "rejection-requested", { reject: 1 });
});

for (const [name, heading] of [
  ["Google heading", "<h1>Before you continue to Google</h1>"],
  ["hidden YouTube heading", "<h1 hidden>Before you continue to YouTube</h1>"],
  ["missing heading", "<h1>Cookie settings</h1>"],
]) {
  test(`consent.youtube.com with ${name} is ignored`, async t => {
    const page = await openFixture(t, `${heading}${buttons}`, { url: CONSENT_URL });
    await start(page);
    await waitForStatus(page, "timed-out");
    assertStopped(await snapshot(page), "timed-out");
  });
}

for (const url of [
  "https://example.test/fixture",
  "https://www.youtube.com.example.test/fixture",
  "https://youtube.com/fixture",
]) {
  test(`unsupported origin ${url} is ignored without registering any work`, async t => {
    const page = await openFixture(t, lightbox(), { url });
    assert.equal(await start(page), "not-applicable");
    assertStopped(await snapshot(page), "not-applicable");
  });
}

test("the helper refuses insecure HTTP without relying on YouTube HSTS navigation", async t => {
  const page = await openFixture(t, lightbox());
  await page.evaluate(source => {
    const insecureWindow = { location: { protocol: "http:", hostname: "www.youtube.com" } };
    insecureWindow.top = insecureWindow;
    window.fixtureConsentController = window.consentFixture.runApp(() =>
      eval(`(${source})`)(insecureWindow, document));
  }, HELPER);
  assertStopped(await snapshot(page), "not-applicable");
});

test("a same-origin iframe is ignored even with a recognised consent scope", async t => {
  const frameUrl = "https://www.youtube.com/fixture-frame";
  const page = await openFixture(t, `<iframe src="${frameUrl}"></iframe>`, {
    routes: { [frameUrl]: fixture(lightbox()) },
  });
  const frame = page.frames().find(candidate => candidate.url() === frameUrl);
  assert.ok(frame, "The isolated same-origin iframe must load");
  assert.equal(await start(frame), "not-applicable");
  assertStopped(await snapshot(frame), "not-applicable");
  assert.deepEqual((await snapshot(page)).clicks, {});
});

test("the integrated Suite runs only consent rejection on consent.youtube.com", async t => {
  const page = await openFixture(t, `<h1>Before you continue to YouTube</h1>${buttons}`,
    { url: CONSENT_URL, integrated: true });
  await page.waitForFunction(() => window.consentFixture.clicks.reject === 1);
  await page.waitForTimeout(80);
  const state = await snapshot(page);
  assert.deepEqual(state.clicks, { reject: 1 });
  assert.equal(state.pendingTimers, 0, "The generated handler clears its production timeout");
  assert.equal(state.listeners, 0);
  assert.equal(state.mutationObservers, 0, "Player and feed modules must not start on consent pages");
  assert.equal(await page.getAttribute("html", "data-yt-master-suite"), null);
  assert.equal(await page.getAttribute("html", "data-yt-master-runtime-errors"), null);
  assert.equal(await page.locator("#ytms-settings-button, #ytms-player-settings-button, #ytms-settings-dialog, #ytppl-video-mirror-button").count(), 0);
  assert.equal(await page.locator("style").count(), 1, "Only the fixture stylesheet may exist");
});
