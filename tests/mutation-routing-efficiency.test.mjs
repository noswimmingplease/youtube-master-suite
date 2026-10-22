import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const source = readFileSync(new URL('../build-master.mjs', import.meta.url), 'utf8');
const start = source.indexOf('function mutationMatchesRegistrations(');
const end = source.indexOf('\nfunction buildMutationCoverage(', start);
assert.ok(start >= 0 && end > start);
const matches = vm.runInNewContext(`(${source.slice(start, end)})`);

function tree() {
  let containsCalls = 0;
  const root = { contains(node) { containsCalls++; return node === child; } };
  const child = { contains() { containsCalls++; return false; } };
  const unrelated = {};
  return { root, child, unrelated, calls: () => containsCalls };
}

for (const [name, options, mutation] of [
  ['unrequested child-list records', { attributes: true, subtree: true }, { type: 'childList' }],
  ['unrequested character-data records', { childList: true, subtree: true }, { type: 'characterData' }],
  ['unrequested attribute records', { childList: true, subtree: true }, { type: 'attributes', attributeName: 'class' }],
  ['filtered attribute names', { attributes: true, attributeFilter: ['selected'], subtree: true }, { type: 'attributes', attributeName: 'class' }],
  ['empty attribute filters', { attributes: true, attributeFilter: [], subtree: true }, { type: 'attributes', attributeName: 'class' }],
]) test(`shared mutation routing rejects ${name} before DOM containment checks`, () => {
  const t = tree();
  const registrations = new Map([[t.root, options]]);
  for (let i = 0; i < 1000; i++) {
    assert.equal(matches(registrations, { ...mutation, target: t.child }, 'runtime-errors'), false);
  }
  assert.equal(t.calls(), 0);
});

test('eligible subtree records still check their live DOM containment', () => {
  const t = tree();
  const registrations = new Map([[t.root, { childList: true, subtree: true }]]);
  assert.equal(matches(registrations, { type: 'childList', target: t.child }, 'runtime-errors'), true);
  assert.equal(matches(registrations, { type: 'childList', target: t.unrelated }, 'runtime-errors'), false);
  assert.equal(t.calls(), 2);
});

test('exact-target and non-subtree registrations do not need containment calls', () => {
  const t = tree();
  const registrations = new Map([[t.root, { childList: true, subtree: false }]]);
  assert.equal(matches(registrations, { type: 'childList', target: t.root }, 'runtime-errors'), true);
  assert.equal(matches(registrations, { type: 'childList', target: t.child }, 'runtime-errors'), false);
  assert.equal(t.calls(), 0);
});

test('ignored runtime-error attributes remain invisible to all logical observers', () => {
  const t = tree();
  const registrations = new Map([[t.root, { attributes: true, subtree: true }]]);
  assert.equal(matches(registrations, { type: 'attributes', attributeName: 'runtime-errors', target: t.child }, 'runtime-errors'), false);
  assert.equal(t.calls(), 0);
});

test('registration and mutation combinations retain the existing matching semantics', () => {
  const t = tree();
  for (let flags = 0; flags < 16; flags++) {
    for (const filter of [undefined, [], ['class'], ['class', 'style']]) {
      const options = { childList: Boolean(flags & 1), characterData: Boolean(flags & 2),
        attributes: Boolean(flags & 4), subtree: Boolean(flags & 8), attributeFilter: filter };
      const registrations = new Map([[t.root, options]]);
      for (const target of [t.root, t.child, t.unrelated]) {
        for (const type of ['childList', 'characterData', 'attributes', 'unknown']) {
          for (const attributeName of ['class', 'style', 'runtime-errors']) {
            const inScope = target === t.root || (options.subtree && target === t.child);
            const expected = attributeName !== 'runtime-errors' || type !== 'attributes'
              ? Boolean(inScope && ((type === 'childList' && options.childList) ||
                (type === 'characterData' && options.characterData) ||
                (type === 'attributes' && options.attributes && (!filter || filter.includes(attributeName)))))
              : false;
            assert.equal(matches(registrations, { type, target, attributeName }, 'runtime-errors'), expected);
          }
        }
      }
    }
  }
});

test('a filtered registration does not prevent another registration receiving its record', () => {
  const t = tree();
  const registrations = new Map([
    [t.root, { attributes: true, attributeFilter: ['class'], subtree: true }],
    [t.child, { characterData: true, subtree: true }],
  ]);
  assert.equal(matches(registrations, { type: 'characterData', target: t.child }, 'runtime-errors'), true);
  assert.equal(t.calls(), 0);
});
