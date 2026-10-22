import assert from 'node:assert/strict';
import { test } from 'node:test';
import vm from 'node:vm';
import { installVideoMenu } from '../sources/video-menu.mjs';

test('video menu installer is closure-free when embedded in the master and removes every lifecycle listener', () => {
  const listeners = [];
  const removed = [];
  const target = name => ({
    addEventListener(type, listener, capture) { listeners.push({ name, type, listener, capture }); },
    removeEventListener(type, listener, capture) { removed.push({ name, type, listener, capture }); },
  });
  const context = vm.createContext({ document: target('document'), window: target('window'),
    suite: { settings: { initial: {} } } });
  const dispose = vm.runInContext(`(${installVideoMenu.toString()})(suite)`, context);
  assert.equal(typeof dispose, 'function');
  assert.equal(listeners.filter(entry => entry.name === 'document').length, 4);
  assert.equal(listeners.filter(entry => entry.name === 'window').length, 5);
  assert.ok(listeners.every(entry => entry.capture === true));
  dispose();
  assert.deepEqual(removed, listeners);
});

test('menu setup performs no native command, queue operation, DOM scan or periodic work before a trusted card menu opens', () => {
  const noOp = () => {};
  const context = vm.createContext({
    document: { addEventListener: noOp, removeEventListener: noOp },
    window: { addEventListener: noOp, removeEventListener: noOp },
    suite: { settings: { initial: { menuItemOrder: ['report', '__proto__', 'report', 'download'] } } },
  });
  assert.doesNotThrow(() => vm.runInContext(`(${installVideoMenu.toString()})(suite)()`, context));
});

test('menu compatibility starts unchecked rather than claiming initialisation verifies a native menu', () => {
  const attributes = new Map();
  const noOp = () => {};
  const dispose = vm.runInNewContext(`(${installVideoMenu.toString()})(suite)`, {
    document: { documentElement: {
      getAttribute: name => attributes.get(name) ?? null,
      setAttribute: (name, value) => attributes.set(name, value),
    }, addEventListener: noOp, removeEventListener: noOp },
    window: { addEventListener: noOp, removeEventListener: noOp },
    suite: { settings: { initial: {} } },
  });
  assert.equal(attributes.get('data-ytms-video-menu-status'), 'idle');
  assert.equal(attributes.get('data-ytms-video-menu-compatibility'), 'not-checked');
  dispose();
  assert.equal(attributes.get('data-ytms-video-menu-status'), 'disposed');
  assert.equal(attributes.get('data-ytms-video-menu-compatibility'), 'not-checked');
});
