import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

const MODULES = [
  ["Miniplayer Restorer", "youtube-miniplayer-button-restorer.user.js", "const mo ="],
  ["Scroll Miniplayer", "youtube-scroll-miniplayer.user.js", "const mutationObserver ="],
];

function createHarness(filename, nextMarker) {
  const source = readFileSync(new URL(`../sources/modules/${filename}`, import.meta.url), "utf8");
  const start = source.indexOf("  function isSuiteDialogContentMutation(");
  const end = source.indexOf(`\n  ${nextMarker}`, start);
  assert.ok(start >= 0 && end > start);
  class Element {
    constructor(tag, id = "", classes = []) {
      this.tag = tag; this.id = id; this.classes = classes;
      this.parentElement = null; this.children = [];
    }
    get isConnected() { return this === body || Boolean(this.parentElement?.isConnected); }
    append(child) { child.parentElement = this; this.children.push(child); return child; }
    matches(selector) {
      return selector.split(",").some(part => {
        part = part.trim();
        return part.startsWith("#") ? this.id === part.slice(1)
          : part.startsWith(".") ? this.classes.includes(part.slice(1)) : this.tag === part;
      });
    }
    closest(selector) {
      for (let element = this; element; element = element.parentElement) {
        if (element.matches(selector)) return element;
      }
      return null;
    }
    querySelector(selector) {
      for (const child of this.children) {
        if (child.matches(selector)) return child;
        const nested = child.querySelector(selector);
        if (nested) return nested;
      }
      return null;
    }
  }
  class Dialog extends Element { constructor(id) { super("dialog", id); } }
  const body = new Element("body");
  const check = vm.runInNewContext(`(${source.slice(start, end).trim()})`, {
    document: { body }, HTMLDialogElement: Dialog,
    PLAYER_TOPOLOGY_SELECTOR: "#movie_player,.html5-video-player,.ytp-right-controls,ytd-watch-flexy,#ytsmp-player-placeholder",
  });
  const mutation = (target, addedNodes = [], removedNodes = []) => ({ type: "childList", target, addedNodes, removedNodes });
  return { Element, Dialog, body, check, mutation };
}

for (const [name, filename, nextMarker] of MODULES) {
  test(`${name}: only connected body-mounted native Suite dialogues qualify`, () => {
    const h = createHarness(filename, nextMarker);
    for (const id of ["ytms-settings-dialog", "ytms-age-dialog"]) {
      const dialog = h.body.append(new h.Dialog(id));
      const field = dialog.append(new h.Element("p"));
      assert.equal(h.check(h.mutation(field, [new h.Element("span")])), true);
      assert.equal(h.check(h.mutation({ parentElement: field })), true, "Text and comment targets use their parent");
      assert.equal(h.check({ ...h.mutation(field), type: "attributes" }), false);
      assert.equal(h.check(h.mutation(h.body, [dialog])), false, "Mounting is native parent topology");
      dialog.parentElement = null;
      assert.equal(h.check(h.mutation(field)), false, "Detached dialogues cannot suppress recovery");
      assert.equal(h.check(h.mutation(h.body, [], [dialog])), false, "Removal is native parent topology");
    }
    const wrapper = h.body.append(new h.Element("div", "ytms-settings-dialog"));
    assert.equal(h.check(h.mutation(wrapper.append(new h.Element("p")))), false);
    const nested = wrapper.append(new h.Dialog("ytms-age-dialog"));
    assert.equal(h.check(h.mutation(nested.append(new h.Element("p")))), false);
    const unknown = h.body.append(new h.Dialog("native-youtube-dialog"));
    assert.equal(h.check(h.mutation(unknown.append(new h.Element("p")))), false);
  });

  test(`${name}: native topology inside a Suite dialogue and mixed batches retain discovery`, () => {
    const h = createHarness(filename, nextMarker);
    const dialog = h.body.append(new h.Dialog("ytms-settings-dialog"));
    const field = dialog.append(new h.Element("p"));
    const wrapper = new h.Element("div");
    const player = wrapper.append(new h.Element("div", "movie_player"));
    assert.equal(h.check(h.mutation(field, [wrapper])), false);
    assert.equal(h.check(h.mutation(field, [], [wrapper])), false);
    dialog.append(wrapper);
    const caption = player.append(new h.Element("span"));
    assert.equal(h.check(h.mutation(caption)), false, "Native descendants are not Suite field edits");
    const mixed = [h.mutation(field), h.mutation(h.body, [], [player])];
    assert.equal(mixed.every(h.check), false);
  });
}
