import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { after, before, test } from "node:test";
import { launchFixtureBrowser, waitForSuiteHealth } from "./fixture-browser.mjs";

const SOURCE = readFileSync(new URL("../../sources/modules/youtube-watch-layout-cleaner.user.js", import.meta.url), "utf8");
const SUITE = readFileSync(new URL("../../youtube-master-suite.user.js", import.meta.url), "utf8");
const MANIFEST = JSON.parse(readFileSync(new URL("../../release-manifest.json", import.meta.url), "utf8"));
const FIXTURE = readFileSync(new URL("./queue-drag-page.html", import.meta.url), "utf8");
const WATCH_URL = "https://www.youtube.com/watch?v=aaaaaaaaaaa&list=fixture-queue";
const HOME_URL = "https://www.youtube.com/";
const start = SOURCE.indexOf("  function installQueueDragAssistance(");
const end = SOURCE.indexOf("\n  installQueueDragAssistance();", start);
assert.ok(start >= 0 && end > start, "Canonical source must expose its self-contained queue drag installer");
const INSTALLER = SOURCE.slice(start, end);
let browser;

before(async () => { browser = await launchFixtureBrowser(); }, { timeout: 30000 });
after(async () => { await browser?.close(); }, { timeout: 10000 });

async function openFixture(t, view, { suite = false, reducedMotion = "no-preference" } = {}) {
  const url = view === "desktop" ? WATCH_URL : HOME_URL;
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 }, reducedMotion, serviceWorkers: "block" });
  await context.route("**/*", route => route.request().url() === url
    ? route.fulfill({ contentType: "text/html", body: FIXTURE }) : route.abort());
  if (suite) await context.addInitScript({ content: SUITE });
  const page = await context.newPage();
  page.setDefaultTimeout(8000);
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  t.after(async () => {
    try {
      assert.deepEqual(errors, [], "Queue contract fixtures must not produce uncaught errors");
      const runtimeErrors = await page.getAttribute("html", "data-yt-master-runtime-errors");
      assert.ok(!runtimeErrors || runtimeErrors === "[]", `Suite runtime errors: ${runtimeErrors}`);
    } finally { await context.close(); }
  });
  await page.goto(url);
  if (suite) await waitForSuiteHealth(page, MANIFEST.registeredModules, { timeoutMs: 10000, requireReady: true, errors });
  else await page.addScriptTag({ content: `(() => { ${INSTALLER}\n window.fixture.disposeAssistance = installQueueDragAssistance(); })();` });
  return page;
}

async function beginDrag(page, index) {
  const handle = page.locator(`#items > ytd-playlist-panel-video-renderer:nth-child(${index + 1}) .playlist-drag-handle`);
  await handle.scrollIntoViewIfNeeded();
  const box = await handle.boundingBox();
  assert.ok(box, "Native drag handle must be rendered");
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 4, y);
  const state = await page.evaluate(({ x, y }) => ({
    dragging: fixture.group.isDragging(), down: fixture.lastNativeDown,
    hit: document.elementFromPoint(x, y)?.outerHTML.slice(0, 240),
    scrollTop: fixture.items.scrollTop, pageScroll: scrollY,
  }), { x, y });
  assert.equal(state.dragging, true, `Trusted input must start native dragging: ${JSON.stringify(state)}`);
}

async function edgePosition(page, direction) {
  const box = await page.locator("#items").boundingBox();
  assert.ok(box);
  return { x: box.x + 12, y: direction === "down" ? Math.min(box.y + box.height, 720) - 4 : Math.max(box.y, 0) + 4 };
}

async function assertIdle(page) {
  const state = await page.evaluate(() => ({
    activeTimers: fixture.activeNativeTimers,
    restored: fixture.lastSupport?.calculateScrollDelta === fixture.nativeCalculateScrollDelta,
    listeners: [...fixture.group.listeners.values()].reduce((total, listeners) => total + listeners.size, 0),
    placeholders: document.querySelectorAll('[data-ywlc-drag-placeholder]').length,
    clones: document.querySelectorAll('.dragging').length,
    ticks: fixture.nativeTicks,
  }));
  assert.equal(state.activeTimers, 0, "The native owner disposes its sole scroll timer after drag completion");
  assert.equal(state.restored, true, "Assistance restores the native calculateScrollDelta method");
  assert.equal(state.listeners, 0, "Gesture-scoped native group callbacks must be released");
  assert.equal(state.placeholders, 0);
  assert.equal(state.clones, 0);
  await page.waitForTimeout(120);
  assert.equal(await page.evaluate(() => fixture.nativeTicks), state.ticks, "No drag work continues after the gesture");
}

async function moveToEnd(page, direction) {
  const position = await edgePosition(page, direction);
  const initialScroll = await page.evaluate(() => fixture.items.scrollTop);
  await page.mouse.move(position.x, position.y, { steps: 3 });
  await page.waitForFunction(({ initial, direction }) => direction === "down"
    ? fixture.items.scrollTop > initial : fixture.items.scrollTop < initial,
  { initial: initialScroll, direction });
  await page.waitForFunction(direction => direction === "down"
    ? fixture.items.scrollTop >= fixture.items.scrollHeight - fixture.items.clientHeight - 1
    : fixture.items.scrollTop <= 1, direction);
  await page.evaluate(() => { fixture.scrollBeforeFinalDrop = fixture.items.scrollTop; });
  // A real pointer move after the dwell lets the native dragger select the final
  // candidate using the bounds refreshed by its own scroll listener.
  await page.mouse.move(position.x + 1, position.y);
  await page.mouse.up();
}

for (const view of ["desktop", "miniplayer"]) {
  test(`${view} queue edge dwell moves first to last and last to first without changing the playing video`, { timeout: 30000 }, async t => {
    const page = await openFixture(t, view);
    const ids = await page.evaluate(() => fixture.originalIds);
    const originalUrl = page.url();
    await beginDrag(page, 0);
    await moveToEnd(page, "down");
    assert.deepEqual(await page.evaluate(() => fixture.order()), [...ids.slice(1), ids[0]]);
    assert.deepEqual(await page.evaluate(() => fixture.commits.at(-1)), [...ids.slice(1), ids[0]]);
    assert.equal(await page.evaluate(() => fixture.items.querySelector('[selected]').dataset.videoId), ids[0]);
    assert.equal(await page.evaluate(() => fixture.selectedVideoId), ids[0]);
    assert.equal(page.url(), originalUrl);
    await assertIdle(page);
    const lowerEdge = await page.evaluate(() => ({
      before: fixture.scrollBeforeFinalDrop, after: fixture.items.scrollTop,
      last: fixture.items.lastElementChild.getBoundingClientRect().bottom,
      viewport: fixture.items.getBoundingClientRect().bottom,
      anchor: fixture.items.style.getPropertyValue('overflow-anchor'),
    }));
    assert.ok(Math.abs(lowerEdge.before - lowerEdge.after) <= 1, "Native row insertion must not produce an anchoring-driven scroll jump");
    assert.ok(lowerEdge.last <= lowerEdge.viewport + 1, "The final row must remain visible after native drop");
    assert.equal(lowerEdge.anchor, "", "Gesture-only anchoring overrides must be removed afterwards");
    await beginDrag(page, ids.length - 1);
    await moveToEnd(page, "up");
    assert.deepEqual(await page.evaluate(() => fixture.order()), ids);
    assert.equal(await page.evaluate(() => fixture.commits.length), 2);
    assert.equal(await page.evaluate(() => fixture.intervalRequests.filter(delay => delay === 50).length),
      await page.evaluate(() => fixture.nativeTimerStarts), "Assistance must not add a second 50 ms auto-scroll timer");
    await assertIdle(page);
  });

  test(`${view} queue animates inner visuals without translating native sortable row geometry`, { timeout: 15000 }, async t => {
    const page = await openFixture(t, view);
    await beginDrag(page, 0);
    const box = await page.locator("#items").boundingBox();
    await page.mouse.move(box.x + 12, box.y + 76 * 2 + 38, { steps: 2 });
    const state = await page.evaluate(() => ({
      animations: fixture.animationCalls,
      rowGeometry: [...fixture.items.children].map((row, index) => ({
        top: row.getBoundingClientRect().top,
        expected: fixture.items.getBoundingClientRect().top + index * 76 - fixture.items.scrollTop,
        transform: getComputedStyle(row).transform,
      })),
      cloneTransform: getComputedStyle(fixture.group.draggerEl_).transform,
      placeholder: fixture.group.currDragItem_.querySelector('#container').getAttribute('data-ywlc-drag-placeholder'),
    }));
    assert.ok(state.animations.length > 0, "Native placeholder movement should smoothly move neighbouring visuals");
    assert.ok(state.animations.every(animation => animation.id === "container" && !animation.sortableHost && animation.duration <= 150));
    assert.ok(state.rowGeometry.every(row => Math.abs(row.top - row.expected) < 1 && row.transform === "none"));
    assert.equal(state.cloneTransform, "none");
    assert.equal(state.placeholder, "1");
    await page.mouse.up();
    await assertIdle(page);
  });
}

test("fresh native scroll calculation follows a scrollport moved after native bounds capture", { timeout: 20000 }, async t => {
  const page = await openFixture(t, "desktop");
  await page.evaluate(() => fixture.prepareShiftedScrollport());
  await beginDrag(page, 0);
  const position = await edgePosition(page, "down");
  await page.mouse.move(position.x, position.y);
  const state = await page.evaluate(() => {
    const support = fixture.lastSupport;
    const cursor = fixture.items.getBoundingClientRect().bottom - 4 + scrollY;
    return {
      nativeDelta: fixture.nativeCalculateScrollDelta.call(support, cursor, support.scrollBounds_.top, support.scrollBounds_.height),
      assistedDelta: support.calculateScrollDelta(cursor, support.scrollBounds_.top, support.scrollBounds_.height),
      capturedBottom: support.containerBounds_.top + support.containerBounds_.height,
      currentBottom: fixture.items.getBoundingClientRect().bottom,
    };
  });
  assert.ok(state.capturedBottom > 720 && state.currentBottom < 720);
  assert.ok(state.nativeDelta <= 0, "The stale captured native bounds cannot scroll towards the new lower edge");
  assert.ok(state.assistedDelta > 0, "Current visible bounds must control the existing native scroll timer");
  await moveToEnd(page, "down");
  const ids = await page.evaluate(() => fixture.originalIds);
  assert.deepEqual(await page.evaluate(() => fixture.order()), [...ids.slice(1), ids[0]]);
  await assertIdle(page);
});

test("a partly offscreen scrollport scrolls at its visible lower edge without claiming its final row is exposed", { timeout: 15000 }, async t => {
  const page = await openFixture(t, "desktop");
  await page.evaluate(() => { fixture.items.style.height = '620px'; });
  await beginDrag(page, 0);
  const position = await edgePosition(page, "down");
  await page.mouse.move(position.x, position.y);
  await page.waitForFunction(() => fixture.items.scrollTop > 0);
  assert.ok(await page.locator("#items").evaluate(items => items.getBoundingClientRect().bottom > innerHeight));
  await page.mouse.up();
  await assertIdle(page);
});

test("reduced-motion queues retain edge scrolling but do not animate neighbouring rows", { timeout: 15000 }, async t => {
  const page = await openFixture(t, "desktop", { reducedMotion: "reduce" });
  await beginDrag(page, 0);
  const box = await page.locator("#items").boundingBox();
  await page.mouse.move(box.x + 12, box.y + 190);
  const position = await edgePosition(page, "down");
  await page.mouse.move(position.x, position.y);
  await page.waitForFunction(() => fixture.items.scrollTop > 0);
  assert.equal(await page.evaluate(() => fixture.animationCalls.length), 0);
  await page.mouse.up();
  await assertIdle(page);
});

test("ordinary clicks and synthetic pointer events do not arm queue assistance", { timeout: 15000 }, async t => {
  const page = await openFixture(t, "desktop");
  await page.locator("#ordinary-control").click();
  await page.evaluate(() => {
    const handle = fixture.items.querySelector('.playlist-drag-handle');
    handle.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0, buttons: 1, clientX: 700, clientY: 270 }));
    document.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, buttons: 1, clientX: 700, clientY: 620 }));
    document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, button: 0 }));
  });
  const state = await page.evaluate(() => ({
    ordinary: fixture.ordinaryClicks, started: fixture.nativeMouseStarts, timers: fixture.nativeTimerStarts,
    callbacks: [...fixture.group.listeners.values()].reduce((total, listeners) => total + listeners.size, 0),
    animations: fixture.animationCalls.length,
  }));
  assert.deepEqual(state, { ordinary: 1, started: 0, timers: 0, callbacks: 0, animations: 0 });
});

test("a non-reorderable native panel ignores trusted queue handle gestures", { timeout: 15000 }, async t => {
  const page = await openFixture(t, "desktop");
  await page.evaluate(() => { fixture.panel.canReorder = false; });
  const box = await page.locator('.playlist-drag-handle').first().boundingBox();
  await page.mouse.move(box.x + 9, box.y + 30);
  await page.mouse.down();
  await page.mouse.move(box.x + 13, box.y + 80);
  await page.mouse.up();
  assert.equal(await page.evaluate(() => fixture.nativeMouseStarts), 0);
  assert.equal(await page.evaluate(() => [...fixture.group.listeners.values()].reduce((total, listeners) => total + listeners.size, 0)), 0);
  assert.equal(await page.evaluate(() => fixture.items.style.getPropertyValue('overflow-anchor')), "");
});

test("changing the motion preference during a gesture cancels owned row animations", { timeout: 15000 }, async t => {
  const page = await openFixture(t, "desktop");
  await beginDrag(page, 0);
  const box = await page.locator("#items").boundingBox();
  await page.mouse.move(box.x + 12, box.y + 190);
  assert.ok(await page.evaluate(() => fixture.animationCalls.length > 0));
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.waitForFunction(() => [...fixture.items.querySelectorAll('#container')].every(inner => !inner.getAnimations().length));
  await page.mouse.up();
  await assertIdle(page);
});

test("native scroll anchoring property and priority are restored after a gesture", { timeout: 15000 }, async t => {
  const page = await openFixture(t, "desktop");
  await page.evaluate(() => fixture.items.style.setProperty('overflow-anchor', 'auto', 'important'));
  await beginDrag(page, 0);
  assert.equal(await page.evaluate(() => fixture.items.style.getPropertyValue('overflow-anchor')), "none");
  await page.mouse.up();
  assert.deepEqual(await page.evaluate(() => ({
    value: fixture.items.style.getPropertyValue('overflow-anchor'),
    priority: fixture.items.style.getPropertyPriority('overflow-anchor'),
  })), { value: "auto", priority: "important" });
  await assertIdle(page);
});

test("Escape cancellation restores native methods and leaves Escape unconsumed", { timeout: 15000 }, async t => {
  const page = await openFixture(t, "desktop");
  await beginDrag(page, 0);
  const position = await edgePosition(page, "down");
  await page.mouse.move(position.x, position.y);
  await page.waitForFunction(() => fixture.items.scrollTop > 0);
  await page.evaluate(() => document.addEventListener('keydown', event => {
    if (event.key === 'Escape') fixture.escapePrevented = event.defaultPrevented;
  }));
  await page.keyboard.press("Escape");
  await page.mouse.up();
  assert.equal(await page.evaluate(() => fixture.escapePrevented), false);
  assert.equal(await page.evaluate(() => fixture.nativeCancelled), 1);
  assert.equal(await page.evaluate(() => fixture.commits.length), 0);
  assert.deepEqual(await page.evaluate(() => fixture.order()), await page.evaluate(() => fixture.originalIds));
  await assertIdle(page);
});

for (const lifecycle of ["blur", "yt-navigate-start", "pagehide", "pointercancel", "visibilitychange", "resize", "detach", "dispose"]) {
  test(`queue assistance releases its gesture on ${lifecycle}`, { timeout: 15000 }, async t => {
    const page = await openFixture(t, "desktop");
    await beginDrag(page, 0);
    if (lifecycle === "resize") {
      await page.setViewportSize({ width: 1240, height: 700 });
    } else await page.evaluate(lifecycle => {
      if (lifecycle === 'detach') fixture.panel.remove();
      else if (lifecycle === 'dispose') fixture.disposeAssistance();
      else if (lifecycle === 'pointercancel') document.dispatchEvent(new Event(lifecycle));
      else if (lifecycle === 'visibilitychange') {
        Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
        document.dispatchEvent(new Event(lifecycle));
      }
      else window.dispatchEvent(new Event(lifecycle));
    }, lifecycle);
    await page.waitForFunction(() => fixture.lastSupport.calculateScrollDelta === fixture.nativeCalculateScrollDelta);
    assert.equal(await page.evaluate(() => [...fixture.group.listeners.values()].reduce((total, listeners) => total + listeners.size, 0)), 0);
    await page.evaluate(() => fixture.cancelNativeDrag());
    await page.mouse.up();
    await assertIdle(page);
  });
}

test("same-size synthetic resize hints preserve native queue assistance and row motion", { timeout: 20000 }, async t => {
  for (const view of ["desktop", "miniplayer"]) {
    const page = await openFixture(t, view);
    const ids = await page.evaluate(() => fixture.originalIds);
    await beginDrag(page, 0);
    await page.evaluate(() => window.dispatchEvent(new Event('resize')));
    const state = await page.evaluate(() => ({
      assisted: fixture.lastSupport.calculateScrollDelta !== fixture.nativeCalculateScrollDelta,
      resize: fixture.lifecycleEvents.at(-1),
    }));
    assert.equal(state.resize.type, "resize");
    assert.equal(state.resize.trusted, false);
    assert.equal(state.resize.dragging, true);
    assert.equal(state.assisted, true, "An unchanged-viewport Suite layout hint must not cancel the active drag");
    const scroller = await page.locator("#items").boundingBox();
    const destination = await page.locator("#items > ytd-playlist-panel-video-renderer:nth-child(4)").boundingBox();
    await page.mouse.move(scroller.x + 12, destination.y + destination.height / 2, { steps: 3 });
    await page.waitForFunction(() => fixture.movements.length > 0);
    assert.ok(await page.evaluate(() => fixture.animationCalls.length > 0), "Native movement must still animate neighbouring visuals after the layout hint");
    await page.mouse.up();
    assert.deepEqual(await page.evaluate(() => fixture.order()), [...ids.slice(1, 4), ids[0], ...ids.slice(4)]);
    assert.equal(await page.evaluate(() => fixture.selectedVideoId), ids[0]);
    await assertIdle(page);
  }
});

async function dragDiagnostic(page) {
  return page.evaluate(() => {
    const rect = element => {
      if (!element) return null;
      const { x, y, width, height } = element.getBoundingClientRect();
      return { x, y, width, height };
    };
    const animationState = inner => (inner.getAnimations?.() || []).slice(0, 2).map(animation => ({
      playState: animation.playState, currentTime: animation.currentTime,
      keyframes: animation.effect?.getKeyframes().map(frame => ({ offset: frame.offset, transform: frame.transform })),
    }));
    return {
      order: fixture.order(), movements: fixture.movements.length, animationCount: fixture.animationCalls.length,
      motionReduced: matchMedia('(prefers-reduced-motion: reduce)').matches,
      hidden: document.hidden, nativeInput: fixture.lastNativeMove, lifecycle: fixture.lifecycleEvents,
      nativeGroup: {
        active: fixture.group.isDragging(), currentRow: fixture.group.currDragItem_?.dataset.videoId,
        clone: rect(fixture.group.draggerEl_), cloneTransform: fixture.group.draggerEl_ && getComputedStyle(fixture.group.draggerEl_).transform,
        callbacks: [...fixture.group.listeners].map(([type, listeners]) => ({ type, count: listeners.size })),
        events: fixture.groupEvents,
      },
      scroller: { rect: rect(fixture.items), scrollTop: fixture.items.scrollTop },
      rows: [...fixture.items.children].slice(0, 6).map(row => {
        const inner = row.querySelector('#container');
        const rowStyle = getComputedStyle(row);
        const innerStyle = getComputedStyle(inner);
        return {
          id: row.dataset.videoId, row: rect(row), inner: rect(inner),
          rowTransform: rowStyle.transform, innerTransform: innerStyle.transform,
          rowVisibility: rowStyle.visibility, innerVisibility: innerStyle.visibility,
          animations: animationState(inner),
        };
      }),
    };
  });
}

test("the generated Suite installs drag assistance in both native queue views", { timeout: 30000 }, async t => {
  for (const view of ["desktop", "miniplayer"]) {
    const page = await openFixture(t, view, { suite: true });
    await beginDrag(page, 0);
    assert.equal(await page.evaluate(() => fixture.lastSupport.calculateScrollDelta === fixture.nativeCalculateScrollDelta), false);
    const before = await dragDiagnostic(page);
    try {
      const scroller = await page.locator("#items").boundingBox();
      const destination = await page.locator("#items > ytd-playlist-panel-video-renderer:nth-child(4)").boundingBox();
      assert.ok(scroller && destination, "A different native queue row must be rendered as the drag destination");
      await page.mouse.move(scroller.x + 12, destination.y + destination.height / 2, { steps: 3 });
      // Input dispatch acknowledgement need not mean Firefox has processed the
      // event. Wait for native displacement rather than assuming a coordinate
      // change has already moved the placeholder. The animation remains required.
      await page.waitForFunction(previous => fixture.movements.length > previous, before.movements);
      const after = await dragDiagnostic(page);
      assert.notDeepEqual(after.order, before.order, "The trusted gesture must actually displace a native queue row");
      assert.ok(after.animationCount > before.animationCount,
        `Real native displacement must animate neighbouring visuals: ${JSON.stringify({ view, before, after })}`);
    } catch (error) {
      const after = await dragDiagnostic(page);
      throw new Error(`Generated ${view} queue drag integration failed: ${JSON.stringify({ before, after })}`, { cause: error });
    }
    assert.equal(await page.evaluate(() => fixture.selectedVideoId), "aaaaaaaaaaa");
    await page.mouse.up();
    await assertIdle(page);
  }
});
