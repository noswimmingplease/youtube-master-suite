import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { after, before, test } from "node:test";
import { launchFixtureBrowser, waitForSuiteHealth } from "./fixture-browser.mjs";

const SOURCE = readFileSync(new URL("../../sources/modules/youtube-watch-layout-cleaner.user.js", import.meta.url), "utf8");
const SUITE = readFileSync(new URL("../../youtube-master-suite.user.js", import.meta.url), "utf8");
const MANIFEST = JSON.parse(readFileSync(new URL("../../release-manifest.json", import.meta.url), "utf8"));
const FIXTURE = readFileSync(new URL("./watch-page.html", import.meta.url), "utf8");
const START = SOURCE.indexOf("  function installQueuePlayNext(");
const END = SOURCE.indexOf("\n  function installQueueDragAssistance(", START);
assert.ok(START >= 0 && END > START);
const INSTALLER = SOURCE.slice(START, END);
const SELECTION_INSTALLER = SOURCE.slice(SOURCE.indexOf('  function installQueuePlayingMarkerReconciliation('), START);
const A = "aaaaaaaaaaa", B = "bbbbbbbbbbb", C = "ccccccccccc", D = "ddddddddddd";
let browser;
before(async () => { browser = await launchFixtureBrowser(); }, { timeout: 30000 });
after(async () => { await browser?.close(); });

async function open(t, options = {}) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, serviceWorkers: "block" });
  await context.route("**/*", route => route.request().url().startsWith("https://www.youtube.com/watch")
    ? route.fulfill({ contentType: "text/html", body: FIXTURE }) : route.abort());
  if (options.suite) await context.addInitScript({ content: SUITE });
  const page = await context.newPage();
  page.setDefaultTimeout(4000);
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  t.after(async () => {
    try { assert.deepEqual(errors, []); }
    finally { await context.close(); }
  });
  await page.goto(`https://www.youtube.com/watch?v=${A}`);
  if (options.suite) await waitForSuiteHealth(page, MANIFEST.registeredModules, { timeoutMs: 10000, requireReady: true });
  await page.evaluate(({ ids, current, delay, unsupported, nativeNext, listId, sheet }) => {
    const f = window.queueFixture = { adds: [], moves: [], current, delay, ids: ids || [], seed: ids !== null, nativeItems: null,
      displayWrites: 0, rowWrites: 0, staleSelected: new Set(), staleRows: new Set() };
    fixture.playerId = current;
    document.getElementById('movie_player').getPlaylistId = () => listId;
    document.querySelectorAll("ytd-playlist-panel-renderer").forEach(panel => panel.remove());
    const panel = document.createElement("ytd-playlist-panel-renderer");
    panel.style.display = "block";
    const items = document.createElement("div"); items.id = "items";
    panel.append(items); document.querySelector("#secondary").append(panel);
    const owner = panel.polymerController = { canReorder: true, data: null };
    const dataFor = id => ({ videoId: id, playlistSetVideoId: `set-${id}`, selected: id === f.current || f.staleSelected.has(id) });
    const recycledRows = new Map();
    f.bind = data => {
      owner.data = data;
      const rows = [];
      for (const item of data?.contents || []) {
        const value = item.playlistPanelVideoRenderer;
        let row = recycledRows.get(value.playlistSetVideoId);
        if (!row) {
          row = document.createElement('ytd-playlist-panel-video-renderer');
          row.style.display = 'block'; row.textContent = value.videoId;
          row.set = (path, next) => {
            if (path !== 'data') throw new Error('Unexpected native row binding');
            f.rowWrites++;
            row.data = next; row.selected = Boolean(next.selected);
            row.toggleAttribute('selected', row.selected);
          };
          recycledRows.set(value.playlistSetVideoId, row);
        }
        const stale = f.staleRows.has(value.videoId), selected = row.selected;
        row.set('data', value);
        if (stale) { row.selected = selected; row.toggleAttribute('selected', Boolean(selected)); }
        rows.push(row);
      }
      items.replaceChildren(...rows);
      panel.dispatchEvent(new CustomEvent('yt-rendererstamper-finished', { bubbles: true }));
    };
    owner.set = (path, data) => {
      if (path !== 'data') throw new Error('Unexpected native panel binding');
      f.displayWrites++;
      f.bind(data);
    };
    f.render = () => {
      f.bind(f.seed ? { playlistId: listId, totalVideos: f.ids.length, currentIndex: f.ids.indexOf(f.current),
        contents: f.ids.map(id => ({ playlistPanelVideoRenderer: dataFor(id) })) } : null);
      window.dispatchEvent(new CustomEvent("yt-playlist-data-updated"));
    };
    if (!unsupported) owner.handleDrop = ({ currDragItem }) => {
      f.moves.push(currDragItem.data.videoId);
      f.ids = [...items.children].map(row => row.data.videoId);
      f.render();
    };
    f.render();
    const dropdown = document.createElement("tp-yt-iron-dropdown");
    const popup = document.createElement("ytd-menu-popup-renderer");
    Object.assign(popup.style, { display: "none", position: "fixed", top: "64px", right: "20px", zIndex: "2500", background: "#272727", padding: "8px 0" });
    popup.setAttribute("role", "menu"); dropdown.append(popup); document.querySelector("ytd-app").append(dropdown);
    dropdown.close = () => { popup.style.display = "none"; };
    dropdown.refit = () => { f.refits = (f.refits || 0) + 1; };
    const endpoint = id => ({ signalServiceEndpoint: { signal: "CLIENT_SIGNAL", actions: [{ addToPlaylistCommand: {
      videoId: id, videoIds: [id], listType: "PLAYLIST_EDIT_LIST_TYPE_QUEUE", openMiniplayer: true,
      onCreateListCommand: { createPlaylistServiceEndpoint: { params: "CAQ%3D", videoIds: [id] } },
    } }] } });
    const popupOwner = popup.polymerController = {
      data: null,
      set(path, value) {
        if (path !== "data") throw new Error("Unexpected native binding path");
        this.data = value; popup.replaceChildren();
        for (const item of value.items) {
          const row = document.createElement("ytd-menu-service-item-renderer");
          row.polymerController = { data: item.menuServiceItemRenderer };
          row.textContent = row.polymerController.data.text.simpleText;
          row.setAttribute("role", "menuitem"); row.tabIndex = 0;
          Object.assign(row.style, { display: "block", padding: "10px 16px", cursor: "pointer" });
          row.onclick = () => {
            const command = row.polymerController.data.serviceEndpoint;
            if (command?.signalServiceEndpoint?.actions.length) popupOwner.resolveCommand(command);
            dropdown.close();
          };
          popup.append(row);
        }
      },
      resolveCommand(command) {
        const action = command.signalServiceEndpoint.actions[0].addToPlaylistCommand;
        f.adds.push(structuredClone(action));
        setTimeout(() => {
          if (!f.seed) { f.seed = true; f.ids = [f.current]; }
          f.ids.push(action.videoId); f.render();
        }, f.delay);
        return true;
      },
    };
    f.open = id => {
      const nativeItems = [{ menuServiceItemRenderer: { text: { simpleText: "Add to queue" }, icon: { iconType: "ADD_TO_QUEUE_TAIL" }, serviceEndpoint: endpoint(id) } }];
      if (nativeNext) nativeItems.unshift({ menuServiceItemRenderer: { text: { simpleText: "Native play next" }, icon: { iconType: "QUEUE_PLAY_NEXT" } } });
      f.nativeItems = nativeItems;
      popupOwner.set("data", { items: nativeItems }); popup.style.display = "block";
      popup.dispatchEvent(new CustomEvent("yt-popup-opened", { bubbles: true }));
    };
    f.popup = popup; f.owner = owner;
    f.resolveNative = popupOwner.resolveCommand.bind(popupOwner);
    if (sheet) {
      // Model the current native wrapper contract: .data is write-only and
      // returns a Symbol; child rows expose neither data nor a resolver.
      popup.remove();
      const view = document.createElement('yt-sheet-view-model');
      view.setAttribute('role', 'menu'); view.style.cssText = popup.style.cssText;
      dropdown.append(view);
      dropdown.close = () => { view.style.display = 'none'; };
      let model;
      const opaque = Symbol('native-write-only-prop');
      f.setSheetData = value => {
        model = value; view.replaceChildren();
        const list = document.createElement('yt-list-view-model'); view.append(list);
        for (const item of value.content.listViewModel.listItems) {
          const data = item.listItemViewModel;
          const row = document.createElement('yt-list-item-view-model');
          Object.defineProperty(row, 'data', { get: () => opaque });
          if (data.targetId) row.setAttribute('data-target-id', data.targetId);
          const button = document.createElement('button');
          button.type = 'button'; button.setAttribute('role', 'menuitem');
          button.textContent = data.title.content;
          button.style.cssText = 'display:block;height:40px;width:236px;text-align:left;padding:0 16px';
          button.onclick = () => {
            const command = data.rendererContext?.commandContext?.onTap?.innertubeCommand;
            if (command?.signalServiceEndpoint?.actions.length) popupOwner.resolveCommand(command);
            dropdown.close();
          };
          row.append(button); list.append(row);
        }
      };
      Object.defineProperty(view, 'data', { get: () => opaque, set: f.setSheetData });
      view.componentProps = { data: () => model };
      view.setters = { data: f.setSheetData };
      document.querySelector('ytd-app').resolveCommand = popupOwner.resolveCommand.bind(popupOwner);
      const item = (title, icon, command) => ({ listItemViewModel: {
        title: { content: title }, leadingImage: { sources: [{ clientResource: { imageName: icon } }] },
        rendererContext: { commandContext: { onTap: { innertubeCommand: command } } },
      } });
      f.open = id => {
        f.nativeItems = [item('Add to queue', 'ADD_TO_QUEUE_TAIL', endpoint(id))];
        if (nativeNext) f.nativeItems.unshift(item('Native play next', 'QUEUE_PLAY_NEXT', {}));
        f.nativeSheetData = { header: { preserved: true }, content: { listViewModel: { listItems: f.nativeItems } } };
        f.setSheetData(f.nativeSheetData); view.style.display = 'block';
        view.dispatchEvent(new CustomEvent('yt-popup-opened', { bubbles: true }));
      };
      f.popup = view;
    }
  }, { ids: options.ids === undefined ? [A, B, C] : options.ids, current: options.current || A,
    delay: options.delay || 0, unsupported: Boolean(options.unsupported), nativeNext: Boolean(options.nativeNext),
    listId: options.listId || "TLPQfixture", sheet: Boolean(options.sheet) });
  if (!options.suite) await page.addScriptTag({ content: `(() => { ${SELECTION_INSTALLER}\n ${INSTALLER}\n installQueuePlayingMarkerReconciliation(); window.disposeQueueNext = installQueuePlayNext(); })();` });
  return page;
}

async function choose(page, id, { keyboard = false } = {}) {
  await page.evaluate(id => queueFixture.open(id), id);
  const action = page.getByRole("menuitem", { name: "Play next in queue", exact: true });
  await action.waitFor({ state: "visible" });
  if (keyboard) { await action.focus(); await action.press("Enter"); }
  else await action.click();
}
const snapshot = page => page.evaluate(() => ({ ids: queueFixture.ids, adds: queueFixture.adds, moves: queueFixture.moves,
  playing: fixture.playerId, title: document.querySelector("h1").textContent,
  url: location.href, comments: document.querySelector("ytd-comments").textContent }));

test("the native menu stamps Play next directly above Add to queue without changing the source menu", async t => {
  const page = await open(t);
  await page.evaluate(id => queueFixture.open(id), D);
  assert.deepEqual(await page.getByRole("menuitem").allTextContents(), ["Play next in queue", "Add to queue"]);
  assert.equal(await page.evaluate(() => queueFixture.nativeItems.length), 1);
  await page.evaluate(id => queueFixture.open(id), B);
  assert.equal(await page.getByRole("menuitem", { name: "Play next in queue" }).count(), 1);
});

test('the current sheet keeps native sizing, opaque props and the untouched source menu', async t => {
  const page = await open(t, { sheet: true });
  await page.evaluate(id => queueFixture.open(id), D);
  await page.waitForFunction(() => queueFixture.refits === 1);
  assert.deepEqual(await page.getByRole('menuitem').allTextContents(), ['Play next in queue', 'Add to queue']);
  assert.deepEqual(await page.evaluate(() => ({
    opaque: typeof queueFixture.popup.data === 'symbol',
    originalItems: queueFixture.nativeItems.length,
    headerPreserved: queueFixture.popup.componentProps.data().header === queueFixture.nativeSheetData.header,
    originalCommand: queueFixture.popup.componentProps.data().content.listViewModel.listItems[1] === queueFixture.nativeItems[0],
  })), { opaque: true, originalItems: 1, headerPreserved: true, originalCommand: true });
  const boxes = await page.getByRole('menuitem').evaluateAll(rows => rows.map(row => ({ height: row.getBoundingClientRect().height, width: row.getBoundingClientRect().width })));
  assert.deepEqual(boxes[0], boxes[1]);
  await page.evaluate(() => queueFixture.popup.dispatchEvent(new CustomEvent('yt-popup-opened', { bubbles: true })));
  assert.equal(await page.getByRole('menuitem', { name: 'Play next in queue' }).count(), 1);
});

for (const key of ['Enter', ' ']) test(`current sheet ${key === ' ' ? 'Space' : key} activation uses the native app resolver once`, async t => {
  const page = await open(t, { sheet: true });
  await page.evaluate(id => queueFixture.open(id), D);
  const action = page.getByRole('menuitem', { name: 'Play next in queue', exact: true });
  await action.focus(); await action.press(key);
  await page.waitForFunction(() => queueFixture.moves.length === 1);
  assert.deepEqual((await snapshot(page)).ids, [A, D, B, C]);
  assert.equal((await snapshot(page)).adds.length, 1);
});

for (const sheet of [false, true]) test(`${sheet ? 'current sheet' : 'legacy menu'} uses the native command router when no resolver is exposed`, async t => {
  const page = await open(t, { sheet });
  await page.evaluate(() => {
    const app = document.querySelector('ytd-app');
    delete app.resolveCommand;
    if (queueFixture.popup.polymerController) delete queueFixture.popup.polymerController.resolveCommand;
    queueFixture.nativeRoutes = [];
    app.addEventListener('yt-action', event => {
      const action = event.detail;
      if (action.actionName !== 'yt-command-executor-command') return;
      queueFixture.nativeRoutes.push({ bubbles: event.bubbles, composed: event.composed,
        optional: action.optionalAction, sameSource: action.args[1] === queueFixture.popup });
      queueFixture.resolveNative(action.args[0]);
      action.returnValue.push(undefined); // Native acknowledgement is not a truthy result.
    });
  });
  await choose(page, D);
  await page.waitForFunction(() => queueFixture.moves.length === 1);
  assert.deepEqual((await snapshot(page)).ids, [A, D, B, C]);
  assert.equal((await snapshot(page)).adds.length, 1);
  assert.deepEqual(await page.evaluate(() => queueFixture.nativeRoutes), [
    { bubbles: true, composed: true, optional: false, sameSource: true },
  ]);
});

test('the generated Suite uses native dispatch without an exposed app resolver', { timeout: 20000 }, async t => {
  const page = await open(t, { sheet: true, suite: true });
  await page.evaluate(() => {
    const app = document.querySelector('ytd-app'); delete app.resolveCommand;
    app.addEventListener('yt-action', event => {
      if (event.detail.actionName !== 'yt-command-executor-command') return;
      queueFixture.resolveNative(event.detail.args[0]); event.detail.returnValue.push(undefined);
    });
  });
  const before = await snapshot(page);
  await choose(page, D);
  await page.waitForFunction(() => queueFixture.moves.length === 1);
  const after = await snapshot(page);
  assert.deepEqual(after.ids, [A, D, B, C]); assert.equal(after.adds.length, 1);
  assert.equal(after.playing, before.playing); assert.equal(after.url, before.url);
  assert.equal(after.title, before.title); assert.equal(after.comments, before.comments);
});

for (const onHost of [true, false]) test(`a ${onHost ? 'host' : 'controller'} resolver retains its receiver when the other object lacks one`, async t => {
  const page = await open(t, { sheet: true });
  await page.evaluate(onHost => {
    const app = document.querySelector('ytd-app');
    app.polymerController = {}; delete app.resolveCommand;
    const receiver = onHost ? app : app.polymerController;
    receiver.resolveCommand = function(endpoint) {
      queueFixture.correctReceiver = this === receiver;
      return queueFixture.resolveNative(endpoint);
    };
  }, onHost);
  await choose(page, D);
  await page.waitForFunction(() => queueFixture.moves.length === 1);
  assert.equal(await page.evaluate(() => queueFixture.correctReceiver), true);
  assert.equal((await snapshot(page)).adds.length, 1);
});

test('an existing queued video needs neither an exposed resolver nor a command router', async t => {
  const page = await open(t, { sheet: true });
  await page.evaluate(() => { delete document.querySelector('ytd-app').resolveCommand; });
  await choose(page, C);
  await page.waitForFunction(() => queueFixture.moves.length === 1);
  assert.deepEqual((await snapshot(page)).ids, [A, C, B]);
  assert.equal((await snapshot(page)).adds.length, 0);
});

test('an unacknowledged native dispatch is attempted once without automatic retries', async t => {
  const page = await open(t, { sheet: true });
  await page.evaluate(() => {
    const app = document.querySelector('ytd-app'); delete app.resolveCommand;
    queueFixture.dispatchAttempts = 0;
    app.addEventListener('yt-action', event => {
      if (event.detail.actionName === 'yt-command-executor-command') queueFixture.dispatchAttempts++;
    });
  });
  await choose(page, D);
  assert.match(await page.locator('[data-yt-master-queue-status]').textContent(), /could not accept/);
  await page.waitForTimeout(100);
  assert.equal(await page.evaluate(() => queueFixture.dispatchAttempts), 1);
  assert.equal((await snapshot(page)).adds.length, 0);
  assert.deepEqual((await snapshot(page)).moves, []);
});

test('a rejected direct dispatch never falls through to a second native route', async t => {
  const page = await open(t, { sheet: true });
  await page.evaluate(() => {
    const app = document.querySelector('ytd-app'); queueFixture.fallbackAttempts = 0;
    app.resolveCommand = command => { queueFixture.resolveNative(command); return false; };
    app.addEventListener('yt-action', event => {
      if (event.detail.actionName === 'yt-command-executor-command') queueFixture.fallbackAttempts++;
    });
  });
  await choose(page, D);
  await page.waitForFunction(() => queueFixture.ids.length === 4);
  assert.equal((await snapshot(page)).adds.length, 1);
  assert.equal(await page.evaluate(() => queueFixture.fallbackAttempts), 0);
  assert.deepEqual((await snapshot(page)).moves, []);
});

test('a preflight failure does not consume an otherwise reusable menu selection', async t => {
  const page = await open(t, { sheet: true });
  await page.evaluate(id => { queueFixture.owner.canReorder = false; queueFixture.open(id); }, D);
  const action = page.getByRole('menuitem', { name: 'Play next in queue', exact: true });
  await action.click();
  assert.match(await page.locator('[data-yt-master-queue-status]').textContent(), /still updating/);
  await page.evaluate(() => { queueFixture.owner.canReorder = true; });
  await action.click();
  await page.waitForFunction(() => queueFixture.moves.length === 1);
  assert.equal((await snapshot(page)).adds.length, 1);
  assert.deepEqual((await snapshot(page)).ids, [A, D, B, C]);
});

test('current sheet Add to queue and an existing native Play next remain unchanged', async t => {
  const page = await open(t, { sheet: true, nativeNext: true });
  await page.evaluate(id => queueFixture.open(id), D);
  assert.deepEqual(await page.getByRole('menuitem').allTextContents(), ['Native play next', 'Add to queue']);
  await page.getByRole('menuitem', { name: 'Add to queue', exact: true }).click();
  await page.waitForFunction(() => queueFixture.ids.length === 4);
  assert.deepEqual((await snapshot(page)).ids, [A, B, C, D]);
  assert.deepEqual((await snapshot(page)).moves, []);
});

test('an unsupported current sheet data getter keeps only its original native action', async t => {
  const page = await open(t, { sheet: true });
  await page.evaluate(id => {
    queueFixture.popup.componentProps.data = () => { throw new Error('disposed native sheet'); };
    queueFixture.open(id);
  }, D);
  assert.deepEqual(await page.getByRole('menuitem').allTextContents(), ['Add to queue']);
  assert.equal((await snapshot(page)).adds.length, 0);
});

test('a recycled current sheet cannot reuse an entry from an obsolete model', async t => {
  const page = await open(t, { sheet: true });
  await page.evaluate(id => {
    queueFixture.open(id);
    const data = queueFixture.popup.componentProps.data();
    queueFixture.setSheetData({ ...data }); // Native replacement without another popup-open event.
  }, D);
  await page.getByRole('menuitem', { name: 'Play next in queue', exact: true }).click();
  assert.equal((await snapshot(page)).adds.length, 0);
  assert.deepEqual((await snapshot(page)).moves, []);
});

for (const sheet of [false, true]) for (const [name, ids, target, expected, moves] of [
  ["new video", [A, B, C], D, [A, D, B, C], [D]],
  ["already queued", [A, B, C], C, [A, C, B], [C]],
  ["already next", [A, B, C], B, [A, B, C], []],
  ["currently playing", [A, B, C], A, [A, B, C], []],
]) test(`${sheet ? 'current sheet' : 'legacy menu'} Play next handles ${name} without restarting the playing video`, async t => {
  const page = await open(t, { ids, sheet });
  const before = await snapshot(page);
  await choose(page, target);
  await page.waitForFunction(ids => JSON.stringify(queueFixture.ids) === JSON.stringify(ids), expected);
  const after = await snapshot(page);
  assert.deepEqual(after.ids, expected); assert.deepEqual(after.moves, moves);
  assert.equal(after.adds.length, name === "new video" ? 1 : 0);
  assert.deepEqual({ ...after, ids: before.ids, adds: before.adds, moves: before.moves }, before);
  if (after.adds.length) {
    assert.equal(after.adds[0].openMiniplayer, false);
    assert.equal(after.adds[0].onCreateListCommand.createPlaylistServiceEndpoint.params, "CAQ%3D");
  }
});

test("an earlier queued item moves after the current item via native keyboard activation", async t => {
  const page = await open(t, { ids: [B, A, C], current: A });
  await choose(page, B, { keyboard: true });
  await page.waitForFunction(() => queueFixture.moves.length === 1);
  assert.deepEqual((await snapshot(page)).ids, [A, B, C]);
  assert.equal((await snapshot(page)).adds.length, 0);
});

test("an absent queue is created natively with the current video preserved", async t => {
  const page = await open(t, { ids: null, delay: 100 });
  await choose(page, D);
  await page.waitForFunction(() => queueFixture.ids.length === 2);
  assert.deepEqual((await snapshot(page)).ids, [A, D]);
  assert.equal((await snapshot(page)).playing, A);
});

for (const sheet of [false, true]) for (const type of ["yt-navigate-start", "pagehide"]) test(`${sheet ? 'current sheet' : 'legacy menu'} ${type} cancels deferred reordering`, async t => {
  const page = await open(t, { delay: 150, sheet });
  await choose(page, D);
  await page.evaluate(type => window.dispatchEvent(new Event(type)), type);
  await page.waitForTimeout(220);
  assert.deepEqual((await snapshot(page)).moves, []);
  assert.equal((await snapshot(page)).adds.length, 1);
});

test("queue auto-advance cancels the move instead of targeting another current video", async t => {
  const page = await open(t, { delay: 150 });
  await choose(page, D);
  await page.evaluate(id => { fixture.playerId = id; queueFixture.current = id; queueFixture.render(); }, B);
  await page.waitForTimeout(220);
  assert.deepEqual((await snapshot(page)).moves, []);
  assert.match(await page.locator('[role="status"]').last().textContent(), /Playback changed/);
});

test("YouTube's own Play next entry is not duplicated", async t => {
  const page = await open(t, { nativeNext: true });
  await page.evaluate(id => queueFixture.open(id), D);
  assert.deepEqual(await page.getByRole("menuitem").allTextContents(), ["Native play next", "Add to queue"]);
});

test("the ordinary Add to queue entry still appends normally", async t => {
  const page = await open(t);
  await page.evaluate(id => queueFixture.open(id), D);
  await page.getByRole("menuitem", { name: "Add to queue", exact: true }).click();
  await page.waitForFunction(() => queueFixture.ids.length === 4);
  assert.deepEqual((await snapshot(page)).ids, [A, B, C, D]);
  assert.deepEqual((await snapshot(page)).moves, []);
});

for (const sheet of [false, true]) test(`the generated Suite provides the ${sheet ? 'current sheet' : 'legacy menu'} action and preserves title/comments`, { timeout: 20000 }, async t => {
  const page = await open(t, { suite: true, sheet });
  const before = await snapshot(page);
  await choose(page, D);
  await page.waitForFunction(() => queueFixture.moves.length === 1);
  const after = await snapshot(page);
  assert.deepEqual(after.ids, [A, D, B, C]);
  assert.equal(after.comments, before.comments); assert.equal(after.title, before.title);
  assert.equal(after.playing, before.playing); assert.equal(after.url, before.url);
});

test("a collapsed native miniplayer queue is moved only when its ID matches the active player", async t => {
  const page = await open(t);
  await page.evaluate(() => {
    const panel = document.querySelector('ytd-playlist-panel-renderer');
    const mini = document.createElement('ytd-miniplayer'); document.querySelector('ytd-app').append(mini); mini.append(panel);
    panel.style.display = 'none';
    document.getElementById('movie_player').getPlaylistId = () => 'TLPQfixture';
  });
  await choose(page, C);
  await page.waitForFunction(() => queueFixture.moves.length === 1);
  assert.deepEqual((await snapshot(page)).ids, [A, C, B]);
  assert.equal((await snapshot(page)).adds.length, 0);
});

test("ambiguous visible players do not enqueue or change playback", async t => {
  const page = await open(t);
  await page.evaluate(() => {
    const duplicate = document.createElement('div'); duplicate.id = 'movie_player';
    Object.assign(duplicate.style, { width: '100px', height: '100px' });
    duplicate.getVideoData = () => ({ video_id: 'zzzzzzzzzzz' }); document.body.append(duplicate);
  });
  await choose(page, D);
  assert.equal((await snapshot(page)).adds.length, 0);
  assert.deepEqual((await snapshot(page)).moves, []);
  assert.match(await page.locator('[data-yt-master-queue-status]').textContent(), /identify the playing video/);
});

for (const sheet of [false, true]) {
  const menu = sheet ? 'current sheet' : 'legacy menu';
  for (const existing of [false, true]) test(`${menu} rejects a stale visible queue for ${existing ? 'existing' : 'new'} Play next entries`, async t => {
    const page = await open(t, { sheet });
    await page.evaluate(() => {
      document.getElementById('movie_player').getPlaylistId = () => 'TLPQother';
    });
    const before = await snapshot(page);
    await choose(page, existing ? C : D);
    assert.match(await page.locator('[data-yt-master-queue-status]').textContent(), /queue is still updating/);
    assert.deepEqual(await snapshot(page), before);
  });

  test(`${menu} rejects duplicate visible players even when their video IDs agree`, async t => {
    const page = await open(t, { sheet });
    await page.evaluate(id => {
      const duplicate = document.createElement('div'); duplicate.id = 'movie_player';
      Object.assign(duplicate.style, { width: '100px', height: '100px' });
      duplicate.getVideoData = () => ({ video_id: id }); document.body.append(duplicate);
    }, A);
    const before = await snapshot(page);
    await choose(page, D);
    assert.match(await page.locator('[data-yt-master-queue-status]').textContent(), /identify the playing video/);
    assert.deepEqual(await snapshot(page), before);
  });

  test(`${menu} cancels a deferred move when the active queue ID changes`, async t => {
    const page = await open(t, { sheet, delay: 150 });
    const before = await snapshot(page);
    await choose(page, D);
    await page.evaluate(() => {
      document.getElementById('movie_player').getPlaylistId = () => 'TLPQother';
    });
    await page.waitForFunction(() => document.querySelector('[data-yt-master-queue-status]')?.textContent.includes('The queue changed'));
    await page.waitForTimeout(200);
    const after = await snapshot(page);
    assert.deepEqual(after.ids, [A, B, C, D]);
    assert.equal(after.adds.length, 1);
    assert.deepEqual(after.moves, []);
    assert.deepEqual({ ...after, ids: before.ids, adds: before.adds }, before);
  });
}

test("a hidden stale player does not override the visible current video", async t => {
  const page = await open(t);
  await page.evaluate(() => {
    const duplicate = document.createElement('div'); duplicate.id = 'movie_player'; duplicate.hidden = true;
    duplicate.getVideoData = () => ({ video_id: 'zzzzzzzzzzz' }); document.body.prepend(duplicate);
  });
  await choose(page, C);
  await page.waitForFunction(() => queueFixture.moves.length === 1);
  assert.deepEqual((await snapshot(page)).ids, [A, C, B]);
});

test("batch and mismatched queue commands retain only their original action", async t => {
  const page = await open(t);
  for (const ids of [[A, B], [A]]) {
    await page.evaluate(({ target, ids }) => {
      queueFixture.open(target);
      const data = queueFixture.nativeItems;
      data[0].menuServiceItemRenderer.serviceEndpoint.signalServiceEndpoint.actions[0].addToPlaylistCommand.videoIds = ids;
      const popup = queueFixture.popup;
      popup.polymerController.set('data', { items: data });
      popup.dispatchEvent(new CustomEvent('yt-popup-opened', { bubbles: true }));
    }, { target: D, ids });
    assert.deepEqual(await page.getByRole('menuitem').allTextContents(), ['Add to queue']);
  }
});

test("a native move exception is not retried or followed by another add", async t => {
  const page = await open(t);
  await page.evaluate(() => { queueFixture.owner.handleDrop = () => { queueFixture.moves.push('attempt'); throw new Error('changed native implementation'); }; });
  await choose(page, C);
  await page.waitForFunction(() => queueFixture.moves.length === 1);
  await page.waitForTimeout(80);
  assert.deepEqual((await snapshot(page)).moves, ['attempt']);
  assert.equal((await snapshot(page)).adds.length, 0);
  assert.match(await page.locator('[data-yt-master-queue-status]').textContent(), /Could not confirm/);
});

test("success waits for native queue data rather than the optimistic DOM move", async t => {
  const page = await open(t);
  await page.evaluate(() => {
    queueFixture.owner.handleDrop = ({ currDragItem }) => {
      queueFixture.moves.push(currDragItem.data.videoId);
      const next = [...currDragItem.parentNode.children].map(row => row.data.videoId);
      queueFixture.confirmMove = () => { queueFixture.ids = next; queueFixture.render(); };
    };
  });
  await choose(page, C);
  await page.waitForFunction(() => queueFixture.moves.length === 1);
  assert.equal(await page.locator('[data-yt-master-queue-status]').count(), 0);
  assert.deepEqual((await snapshot(page)).ids, [A, B, C]);
  await page.evaluate(() => queueFixture.confirmMove());
  await page.waitForFunction(() => document.querySelector('[data-yt-master-queue-status]')?.textContent === 'Playing next in queue');
  assert.deepEqual((await snapshot(page)).moves, [C]);
  assert.deepEqual((await snapshot(page)).ids, [A, C, B]);
});

test("a silent native no-op cannot report success or trigger another commit", { timeout: 16000 }, async t => {
  const page = await open(t);
  await page.evaluate(() => {
    queueFixture.owner.handleDrop = ({ currDragItem }) => queueFixture.moves.push(currDragItem.data.videoId);
  });
  await choose(page, C);
  await page.waitForFunction(() => queueFixture.moves.length === 1);
  await page.evaluate(() => queueFixture.render());
  await page.waitForFunction(() => document.querySelector('[data-yt-master-queue-status]')?.textContent.includes('Could not confirm'), null, { timeout: 10000 });
  assert.deepEqual((await snapshot(page)).moves, [C]);
  assert.deepEqual((await snapshot(page)).ids, [A, B, C]);
  assert.equal((await snapshot(page)).adds.length, 0);
});

test("rapid repeated requests are explained rather than appended twice", async t => {
  const page = await open(t, { delay: 250 });
  await choose(page, D);
  await choose(page, C);
  assert.match(await page.locator('[data-yt-master-queue-status]').textContent(), /Please wait/);
  await page.waitForFunction(() => queueFixture.moves.length === 1);
  assert.equal((await snapshot(page)).adds.length, 1);
  assert.deepEqual((await snapshot(page)).ids, [A, D, B, C]);
});

test("an unsupported native reorder ends with one clear bounded failure", { timeout: 16000 }, async t => {
  const page = await open(t, { unsupported: true });
  await choose(page, D);
  await page.waitForFunction(() => document.querySelector('[data-yt-master-queue-status]')?.textContent.includes('could not move'), null, { timeout: 10000 });
  assert.equal((await snapshot(page)).adds.length, 1);
  assert.deepEqual((await snapshot(page)).moves, []);
  assert.deepEqual((await snapshot(page)).ids, [A, B, C, D]);
});

test("Play next installs no polling, custom queue storage or direct network client", () => {
  assert.doesNotMatch(INSTALLER, /setInterval|fetch\s*\(|XMLHttpRequest|localStorage|sessionStorage|\.loadVideo|\.loadPlaylist|innerHTML/);
});

const selection = page => page.evaluate(() => ({
  model: queueFixture.owner.data.contents.filter(item => item.playlistPanelVideoRenderer.selected).map(item => item.playlistPanelVideoRenderer.videoId),
  rows: [...document.querySelectorAll('ytd-playlist-panel-video-renderer[selected]')].map(row => row.data.videoId),
  properties: [...document.querySelectorAll('ytd-playlist-panel-video-renderer')].filter(row => row.selected).map(row => row.data.videoId),
}));

for (const suite of [false, true]) test(`${suite ? 'generated Suite' : 'source'} clears stale playing flags after advance and Play next`, { timeout: 20000 }, async t => {
  const page = await open(t, { suite });
  await page.waitForTimeout(80);
  await page.evaluate(id => {
    queueFixture.originalRows = [...document.querySelectorAll('ytd-playlist-panel-video-renderer')];
    queueFixture.staleSelected.add(queueFixture.current);
    queueFixture.current = id; fixture.playerId = id;
    queueFixture.render();
  }, B);
  await page.waitForFunction(() => queueFixture.owner.data.contents.filter(item => item.playlistPanelVideoRenderer.selected).length === 1);
  assert.deepEqual(await selection(page), { model: [B], rows: [B], properties: [B] });
  const before = await snapshot(page);
  await choose(page, D);
  await page.waitForFunction(() => queueFixture.moves.length === 1);
  await page.waitForFunction(() => document.querySelectorAll('ytd-playlist-panel-video-renderer[selected]').length === 1);
  assert.deepEqual(await selection(page), { model: [B], rows: [B], properties: [B] });
  const after = await snapshot(page);
  assert.deepEqual(after.ids, [A, B, D, C]);
  assert.equal(after.playing, B); assert.equal(after.title, before.title);
  assert.equal(after.comments, before.comments); assert.equal(after.url, before.url);
  assert.equal(await page.evaluate(() => queueFixture.originalRows.every(row => row.isConnected)), true);
});

test('a reused row with correct model but stale computed selection is rebound natively', async t => {
  const page = await open(t);
  await page.waitForTimeout(80);
  await page.evaluate(id => {
    queueFixture.staleRows.add(queueFixture.current);
    queueFixture.current = id; fixture.playerId = id;
    queueFixture.render();
  }, B);
  await page.waitForFunction(() => document.querySelectorAll('ytd-playlist-panel-video-renderer[selected]').length === 1);
  assert.deepEqual(await selection(page), { model: [B], rows: [B], properties: [B] });
  assert.equal(await page.evaluate(() => queueFixture.displayWrites), 0);
  assert.deepEqual((await snapshot(page)).moves, []);
});

for (const fault of ['wrong-index', 'wrong-list', 'duplicate-video', 'incomplete', 'unmatched-row', 'dragging', 'two-players', 'advert', 'missing-binding']) {
  test(`playing-marker correction leaves ${fault} state untouched`, async t => {
    const page = await open(t);
    await page.waitForTimeout(80);
    await page.evaluate(fault => {
      const f = queueFixture, panel = f.owner;
      f.staleSelected.add('ccccccccccc'); f.render();
      if (fault === 'wrong-index') panel.data.currentIndex = 1;
      if (fault === 'wrong-list') document.getElementById('movie_player').getPlaylistId = () => 'TLPQother';
      if (fault === 'duplicate-video') {
        panel.data.contents[2].playlistPanelVideoRenderer.videoId = f.current;
        document.querySelectorAll('ytd-playlist-panel-video-renderer')[2].data.videoId = f.current;
      }
      if (fault === 'incomplete') panel.data.totalVideos++;
      if (fault === 'unmatched-row') document.querySelector('ytd-playlist-panel-video-renderer').data = { videoId: 'zzzzzzzzzzz' };
      if (fault === 'dragging') panel.ytReorderableController = { native_dragListGroup: { isDragging: () => true } };
      if (fault === 'two-players') {
        const player = document.createElement('div'); player.id = 'movie_player'; player.style.cssText = 'width:10px;height:10px';
        player.getVideoData = () => ({ video_id: f.current }); document.body.append(player);
      }
      if (fault === 'advert') document.getElementById('movie_player').classList.add('ad-showing');
      if (fault === 'missing-binding') delete panel.set;
    }, fault);
    const before = await selection(page);
    await page.waitForTimeout(120);
    assert.deepEqual(await selection(page), before);
    assert.equal(await page.evaluate(() => queueFixture.displayWrites), 0);
    assert.deepEqual((await snapshot(page)).moves, []);
  });
}

test('saved playlists retain their native selection flags', async t => {
  const page = await open(t, { listId: 'PLfixture' });
  await page.evaluate(() => { queueFixture.staleSelected.add('ccccccccccc'); queueFixture.render(); });
  await page.waitForTimeout(100);
  assert.deepEqual((await selection(page)).model, [A, C]);
  assert.equal(await page.evaluate(() => queueFixture.displayWrites), 0);
});

test('navigation suspends marker correction until the new page finishes', async t => {
  const page = await open(t);
  await page.evaluate(() => {
    window.dispatchEvent(new Event('yt-navigate-start'));
    queueFixture.staleSelected.add('ccccccccccc'); queueFixture.render();
  });
  await page.waitForTimeout(100);
  assert.deepEqual((await selection(page)).model, [A, C]);
  await page.evaluate(() => window.dispatchEvent(new Event('yt-navigate-finish')));
  await page.waitForFunction(() => queueFixture.displayWrites === 1);
  assert.deepEqual(await selection(page), { model: [A], rows: [A], properties: [A] });
});

test('a native setter which ignores correction cannot trigger a restamping loop', async t => {
  const page = await open(t);
  await page.evaluate(() => {
    queueFixture.owner.set = () => {
      queueFixture.displayWrites++;
      queueFixture.popup.dispatchEvent(new Event('yt-playlist-data-updated', { bubbles: true }));
    };
    queueFixture.staleSelected.add('ccccccccccc'); queueFixture.render();
  });
  await page.waitForTimeout(180);
  assert.equal(await page.evaluate(() => queueFixture.displayWrites), 1);
});

test('marker repair is idle once coherent and can repair a later recurrence', async t => {
  const page = await open(t);
  for (let round = 1; round <= 2; round++) {
    await page.evaluate(() => { queueFixture.staleSelected.add('ccccccccccc'); queueFixture.render(); });
    await page.waitForFunction(round => queueFixture.displayWrites === round, round);
    await page.waitForTimeout(80);
    const writes = await page.evaluate(() => queueFixture.rowWrites);
    await page.evaluate(() => {
      for (let i = 0; i < 8; i++) window.dispatchEvent(new Event('yt-playlist-data-updated'));
    });
    await page.waitForTimeout(80);
    assert.equal(await page.evaluate(() => queueFixture.rowWrites), writes);
  }
  assert.deepEqual(await selection(page), { model: [A], rows: [A], properties: [A] });
});

test('panel repair preserves unchanged entries, native endpoints and unrelated metadata', async t => {
  const page = await open(t);
  await page.evaluate(() => {
    queueFixture.staleSelected.add('ccccccccccc'); queueFixture.render();
    const data = queueFixture.owner.data;
    data.fixtureMetadata = { preserved: true };
    const video = data.contents[2].playlistPanelVideoRenderer;
    video.title = { simpleText: 'DeArrow replacement' };
    video.navigationEndpoint = { watchEndpoint: { videoId: video.videoId } };
    queueFixture.beforeRepair = { data, video };
  });
  await page.waitForFunction(() => queueFixture.displayWrites === 1);
  assert.deepEqual(await page.evaluate(() => {
    const before = queueFixture.beforeRepair, after = queueFixture.owner.data;
    return { metadata: after.fixtureMetadata === before.data.fixtureMetadata,
      unchangedEntry: after.contents[0] === before.data.contents[0],
      title: after.contents[2].playlistPanelVideoRenderer.title === before.video.title,
      endpoint: after.contents[2].playlistPanelVideoRenderer.navigationEndpoint === before.video.navigationEndpoint,
      originalSelection: before.video.selected };
  }), { metadata: true, unchangedEntry: true, title: true, endpoint: true, originalSelection: true });
});

test('the existing rail observer repairs a stale attribute without a native data event', { timeout: 20000 }, async t => {
  const page = await open(t, { suite: true });
  await page.waitForTimeout(100);
  await page.evaluate(() => {
    const row = document.querySelectorAll('ytd-playlist-panel-video-renderer')[2];
    row.selected = true; row.setAttribute('selected', '');
  });
  await page.waitForFunction(() => document.querySelectorAll('ytd-playlist-panel-video-renderer[selected]').length === 1);
  assert.deepEqual(await selection(page), { model: [A], rows: [A], properties: [A] });
  assert.equal(await page.evaluate(() => queueFixture.displayWrites), 0);
});

test('a collapsed miniplayer panel with the active queue ID also loses its stale marker', async t => {
  const page = await open(t);
  await page.evaluate(() => {
    document.querySelector('ytd-playlist-panel-renderer').style.display = 'none';
    queueFixture.staleSelected.add('ccccccccccc'); queueFixture.render();
  });
  await page.waitForFunction(() => queueFixture.displayWrites === 1);
  assert.deepEqual(await selection(page), { model: [A], rows: [A], properties: [A] });
});

test('an unavailable player API fails closed without a runtime error', async t => {
  const page = await open(t);
  await page.evaluate(() => {
    document.getElementById('movie_player').getPlaylistId = () => { throw new Error('disposed player'); };
    queueFixture.staleSelected.add('ccccccccccc'); queueFixture.render();
  });
  await page.waitForTimeout(100);
  assert.equal(await page.evaluate(() => queueFixture.displayWrites), 0);
});

test('playing-marker reconciliation adds no polling, observer or playback command', () => {
  assert.doesNotMatch(SELECTION_INSTALLER, /setInterval|setTimeout|MutationObserver|fetch\s*\(|XMLHttpRequest|\.loadVideo|\.loadPlaylist|\.selected\s*=(?!=)/);
});
