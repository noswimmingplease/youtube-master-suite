import assert from 'node:assert/strict';
import { test } from 'node:test';
import vm from 'node:vm';
import { createSuiteSupport } from '../sources/suite-support.mjs';

const IDS = ['commentCleaner', 'feedUiCleaner', 'miniplayerButtonRestorer', 'pageCoherence',
  'playerPreferencesLite', 'scrollMiniplayer', 'suiteSettings', 'watchLayoutCleaner'];
function fixture(values = {}) {
  const attributes = new Map(Object.entries(values).map(([name, value]) => [name, typeof value === 'string' ? value : JSON.stringify(value)]));
  const reads = [];
  const document = { documentElement: { getAttribute(name) { reads.push(name); return attributes.get(name) ?? null; } } };
  return { attributes, reads, document, service: createSuiteSupport(document, '1.2.12', IDS) };
}
function health(overrides = {}) {
  return { version: '1.2.12', registeredModules: 8, expectedModules: 8, initialisedModules: IDS,
    pendingModules: [], disabledModules: [], failedModules: [], ready: true, healthy: true, ...overrides };
}

test('support factory is closure-free and reports only known module states, counters and fixed status text', () => {
  const { document } = fixture({
    'data-yt-master-suite': health(),
    'data-ytms-video-menu-compatibility': 'recognised',
    'data-yt-master-state': { identityStatus: 'coherent', nativeLoading: false, confirmedMismatch: false,
      confirmedCoherent: true, commentsHiddenAsStale: false, confirmedStaleComments: false, mismatchChecks: 0,
      loadingRecoveryStatus: 'not-attempted' },
  });
  const service = vm.runInNewContext(`(${createSuiteSupport.toString()})(document, '1.2.12', ids)`, { document, ids: IDS });
  const result = JSON.parse(service.report());
  assert.equal(result.language, 'en-GB');
  assert.equal(result.version, '1.2.12');
  assert.equal(result.health.status, 'available');
  assert.equal(result.health.healthy, true);
  assert.equal(result.health.ready, true);
  assert.deepEqual(result.health.modules, IDS.map(id => ({ id, status: 'initialised' })));
  assert.equal(result.videoMenu.status, 'recognised');
  assert.equal(result.coherence.identityStatus, 'coherent');
  assert.match(result.summary, /8 of 8 modules report initialised/);
  assert.match(result.summary, /last video menu layout was recognised/);
});

test('report omits raw errors, operations, timestamps, URLs, IDs, titles, search, account and timing diagnostics', () => {
  const secret = 'PRIVATE_account_video_channel_search_browser_details';
  const { service, reads } = fixture({
    'data-yt-master-suite': health({ failedModules: [{ id: 'pageCoherence', error: secret }], extra: secret }),
    'data-yt-master-runtime-errors': [
      { module: 'pageCoherence', operation: secret, message: secret, stack: secret, timestamp: secret },
      { module: 'suite', operation: secret, message: secret },
      { module: secret, operation: secret, message: secret },
    ],
    'data-yt-master-state': { identityStatus: 'disagreement', url: `https://example.invalid/${secret}`, urlVideoId: secret,
      playerVideoId: secret, metadataTitle: secret, identityReasons: [secret], identityComparisons: { [secret]: true },
      playerTitle: secret, documentTitle: secret, queueTitle: secret, nativeLoading: true,
      confirmedMismatch: true, confirmedCoherent: false, mismatchChecks: 3, loadingRecoveryStatus: 'pending' },
    'data-yt-master-diagnostics': secret,
    'data-ytms-video-menu-status': secret,
    'data-ytms-video-menu-compatibility': 'unsupported',
  });
  const report = service.report();
  assert.equal(report.includes(secret), false);
  assert.equal(reads.includes('data-yt-master-diagnostics'), false, 'Timing diagnostics must remain off and unread');
  assert.equal(reads.includes('data-ytms-video-menu-status'), false, 'Only the fixed compatibility status is exported');
  const result = JSON.parse(report);
  assert.equal(result.runtimeErrors.total, 2);
  assert.equal(result.runtimeErrors.byModule.find(entry => entry.id === 'pageCoherence').count, 1);
  assert.equal(result.runtimeErrors.byModule.find(entry => entry.id === 'suite').count, 1);
  assert.deepEqual(Object.keys(result.coherence).sort(), ['confirmedCoherent', 'confirmedMismatch', 'identityStatus',
    'loadingRecoveryStatus', 'mismatchChecks', 'nativeLoading', 'status'].sort());
});

test('missing markers mean not yet reported or checked, not a broken script', () => {
  const { service } = fixture();
  const result = JSON.parse(service.report());
  assert.equal(result.health.status, 'missing');
  assert.equal(result.runtimeErrors.status, 'missing');
  assert.equal(result.videoMenu.status, 'not-checked');
  assert.equal(result.coherence.status, 'missing');
  assert.match(result.summary, /health has not been reported/);
  assert.match(result.summary, /compatibility has not been checked/);
  assert.equal(result.summary.includes('failed'), false);
  assert.equal(Object.hasOwn(result.health, 'ready'), false);
  assert.equal(Object.hasOwn(result.health, 'healthy'), false);
});

test('unknown or tampered statuses are unknown and optional booleans/counters are not coerced', () => {
  const secret = 'PRIVATE_status';
  const { service } = fixture({
    'data-yt-master-suite': health({ initialisedModules: ['__proto__', secret], pendingModules: ['suiteSettings'],
      disabledModules: ['feedUiCleaner'], failedModules: [{ id: 'suiteSettings', error: secret }],
      ready: secret, healthy: 'true', registeredModules: 1e8 }),
    'data-ytms-video-menu-compatibility': secret,
    'data-yt-master-state': { identityStatus: secret, nativeLoading: 'false', confirmedMismatch: secret,
      confirmedCoherent: 1, mismatchChecks: -1, loadingRecoveryStatus: secret },
  });
  const report = service.report();
  assert.equal(report.includes(secret), false);
  const result = JSON.parse(report);
  assert.equal(result.videoMenu.status, 'unknown');
  assert.equal(result.coherence.identityStatus, 'unknown');
  assert.equal(result.coherence.loadingRecoveryStatus, 'unknown');
  assert.equal(result.health.modules.find(entry => entry.id === 'suiteSettings').status, 'unknown', 'Contradictory states cannot report success');
  assert.equal(result.health.modules.find(entry => entry.id === 'feedUiCleaner').status, 'disabled');
  for (const property of ['ready', 'healthy', 'registeredModules']) assert.equal(Object.hasOwn(result.health, property), false);
  for (const property of ['nativeLoading', 'confirmedMismatch', 'confirmedCoherent', 'mismatchChecks']) assert.equal(Object.hasOwn(result.coherence, property), false);
});

test('malformed, wrong-shape and oversized JSON markers fail closed without exposing input', () => {
  for (const raw of ['{bad-json', 'null', '[]', 'false', JSON.stringify({ private: 'x'.repeat(70000) })]) {
    const { service } = fixture({ 'data-yt-master-suite': raw, 'data-yt-master-state': raw });
    const result = JSON.parse(service.report());
    assert.equal(result.health.status, 'invalid');
    assert.equal(result.coherence.status, 'invalid');
  }
  for (const raw of ['{bad-json', '{}', 'false', JSON.stringify(Array.from({ length: 21 }, () => ({ module: 'suite' })))]) {
    const { service } = fixture({ 'data-yt-master-runtime-errors': raw });
    const result = JSON.parse(service.report());
    assert.equal(result.runtimeErrors.status, 'invalid');
    assert.equal(result.runtimeErrors.total, 0);
  }
});

test('module configuration and version cannot add arbitrary report strings', () => {
  const { document } = fixture({ 'data-yt-master-runtime-errors': [{ module: 'private-module' }, { module: 'suite' }] });
  const service = createSuiteSupport(document, '1.2.12-private-name', ['private-module', '__proto__', 'suiteSettings']);
  const result = JSON.parse(service.report());
  assert.equal(result.version, 'unknown');
  assert.deepEqual(result.health.modules, [{ id: 'suiteSettings', status: 'unknown' }]);
  assert.deepEqual(result.runtimeErrors.byModule, [{ id: 'suiteSettings', count: 0 }, { id: 'suite', count: 1 }]);
  assert.equal(service.report().includes('private'), false);
});

test('reporting is on demand, read-only and reflects the latest fixed compatibility state', () => {
  const { service, attributes, reads } = fixture();
  assert.deepEqual(reads, [], 'Creating the factory must not inspect the page or start background work');
  for (const status of ['not-checked', 'awaiting-menu', 'loading-menu', 'no-menu', 'not-applicable', 'recognised', 'unsupported']) {
    attributes.set('data-ytms-video-menu-compatibility', status);
    assert.equal(service.snapshot().videoMenu.status, status);
  }
  assert.deepEqual([...new Set(reads)].sort(), ['data-yt-master-suite', 'data-yt-master-runtime-errors',
    'data-yt-master-state', 'data-ytms-video-menu-compatibility'].sort());
  assert.doesNotThrow(() => createSuiteSupport({ get documentElement() { throw new Error('No DOM'); } }, '1.2.12', IDS).report());
});
