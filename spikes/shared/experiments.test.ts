import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { fork } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import { fixture, makePolicy } from './policy.ts';
import { initialize, open, reserve, complete, fail, snapshot } from './sqlite-reference.ts';
import type { Reservation } from './sqlite-reference.ts';

const evidence = new URL('../evidence/', import.meta.url);
const runs = new URL('../runs/', import.meta.url);
mkdirSync(evidence, { recursive: true });
mkdirSync(runs, { recursive: true });
const run = mkdtempSync(fileURLToPath(new URL('run-', runs)));
const observations: any[] = [];
let serial = 0;
function store(used = 0) {
  const path = `${run}/experiment-${serial++}.sqlite`;
  initialize(path, used);
  return { path, db: open(path) };
}
const input = (file = 'f1', op = 'op1', estimate = 1_200_000): Reservation => ({
  user: 'member', op, file, visit: 'visit-bogota-1', fingerprint: 'synthetic-file-digest', estimate,
});
const session = (id: string) => `test-session:${id}`;

// Synchronize independent OS processes before they issue their DB operations.
async function race(path: string, mode: string, inputs: Reservation[]) {
  const children = inputs.map((r) => {
    const child = fork(fileURLToPath(new URL('./concurrent-child.ts', import.meta.url)), [path, mode, JSON.stringify(r)], {
      execArgv: [], stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    });
    let result: any;
    let stderr = '';
    child.stderr!.on('data', (s) => { stderr += s; });
    const ready = new Promise<void>((resolve, reject) => {
      child.on('message', (message: any) => {
        if (message.phase === 'ready') resolve();
        else result = message;
      });
      child.once('error', reject);
      child.once('exit', () => reject(new Error('child exited before barrier')));
    });
    const done = new Promise<any>((resolve, reject) => {
      child.once('error', reject);
      child.once('exit', (code) => {
        if (mode === 'crash' && code === 17) resolve({ pid: child.pid, crashed: true, code });
        else if (code === 0 && result?.phase === 'result') resolve({ pid: child.pid, ...result });
        else reject(new Error(`child exit ${code}: ${result?.message ?? stderr}`));
      });
    });
    // Attach immediately so an early runtime failure cannot be an unhandled rejection.
    done.catch(() => {});
    return { child, ready, done };
  });
  const watchdog = setTimeout(() => children.forEach(({ child }) => child.kill()), 20_000);
  try {
    await Promise.all(children.map((c) => c.ready));
    children.forEach((c) => c.child.send('start'));
    return await Promise.all(children.map((c) => c.done));
  } finally {
    clearTimeout(watchdog);
    children.forEach(({ child }) => { if (child.exitCode === null) child.kill(); });
  }
}

test('AUTH-01 mock sessions: absent, invented, inactive and revoked identities deny', () => {
  const policy = makePolicy();
  for (const identity of [null, 'invented', session('inactive')]) {
    assert.deepEqual(policy.request(identity, 'photo.display', 'photo-rome-guest'), { ok: false, error: 'unavailable' });
  }
  assert(policy.allows(session('guest'), 'photo.display', 'photo-rome-guest'));
  policy.revokeSession(session('guest'));
  assert(!policy.allows(session('guest'), 'photo.display', 'photo-rome-guest'));
});

test('AUTH-02 Italy-only guest denies Colombia IDs, media, metadata, map and counts', () => {
  const p = makePolicy();
  for (const action of ['photo.display', 'photo.thumbnail', 'photo.original', 'photo.metadata']) {
    assert.deepEqual(p.request(session('guest'), action, 'photo-bogota-1'), p.request(session('guest'), action, 'missing-id'));
  }
  for (const action of ['trip.read', 'trip.map', 'trip.counts']) assert(!p.allows(session('guest'), action, 'trip-colombia'));
  for (const action of ['project.overview', 'project.counts']) assert(!p.allows(session('guest'), action, 'project-main'));
  assert.deepEqual(p.photos(session('guest')), ['photo-rome-guest', 'photo-rome-member']);
  assert.deepEqual(p.photos(session('guest'), { country: 'COL' }), []);
  observations.push({ id: 'AUTH-02', guestVisiblePhotos: 2, guestColombiaCount: 0, projectOverview: 'denied' });
});

test('AUTH-03 full-project membership inherits all trips; outsider is excluded', () => {
  const p = makePolicy();
  for (const actor of ['owner', 'admin', 'member']) {
    for (const trip of ['trip-italy', 'trip-colombia', 'trip-colombia-repeat']) assert(p.allows(session(actor), 'trip.read', trip));
    assert(!p.allows(session(actor), 'trip.read', 'trip-other'));
    assert.equal(p.photos(session(actor)).length, 5);
  }
  assert(!p.allows(session('outsider'), 'trip.read', 'trip-italy'));
});

test('AUTH-04 owner-only management cannot be acquired by project admin', () => {
  const p = makePolicy();
  for (const action of ['project.archive', 'project.manageAdmins', 'project.transfer']) {
    assert(p.allows(session('owner'), action, 'project-main'));
    for (const actor of ['admin', 'member', 'guest']) assert(!p.allows(session(actor), action, 'project-main'));
  }
});

test('AUTH-05 configurable trip creation excludes trip-only guest', () => {
  const p = makePolicy();
  assert(p.allows(session('admin'), 'trip.create', 'project-main'));
  assert(!p.allows(session('member'), 'trip.create', 'project-main'));
  p.data.projects[0].membersCanCreateTrips = true;
  assert(p.allows(session('member'), 'trip.create', 'project-main'));
  assert(!p.allows(session('guest'), 'trip.create', 'project-main'));
});

test('AUTH-06 visit creator, photo author and admin rights are separate', () => {
  const p = makePolicy();
  assert(p.allows(session('guest'), 'visit.create', 'visit-rome'));
  assert(p.allows(session('guest'), 'visit.edit', 'visit-rome'));
  assert(!p.allows(session('member'), 'visit.edit', 'visit-rome'));
  assert(p.allows(session('admin'), 'visit.edit', 'visit-rome'));
  assert(p.allows(session('guest'), 'photo.original', 'photo-rome-guest'));
  assert(!p.allows(session('member'), 'photo.original', 'photo-rome-guest'));
  for (const actor of ['owner', 'admin']) assert(p.allows(session(actor), 'photo.original', 'photo-rome-guest'));
  assert(p.allows(session('member'), 'photo.display', 'photo-rome-guest'));
  assert(!p.allows(session('member'), 'photo.trash', 'photo-rome-guest'));
  assert(p.allows(session('member'), 'photo.trash', 'photo-rome-member'));
  assert(!p.allows(session('guest'), 'photo.move', 'photo-rome-guest'));
});

test('AUTH-07 revocation denies new reads despite authorship or quota responsibility', () => {
  const p = makePolicy();
  p.data.tripMemberships[0].active = false;
  for (const action of ['photo.original', 'photo.display', 'photo.metadata', 'photo.trash']) assert(!p.allows(session('guest'), action, 'photo-rome-guest'));
  assert.deepEqual(p.photos(session('guest')), []);
  assert.equal(p.data.photos[0].quotaOwner, 'guest');
});

test('AUTH-08 shared Place preserves repeated visits and deduplicates authorization paths', () => {
  const p = makePolicy();
  const visits = p.data.visits.filter((v: any) => v.place === 'place-bogota' && v.trip !== 'trip-other');
  assert.equal(new Set(visits.map((v: any) => v.id)).size, 3);
  assert.equal(new Set(visits.map((v: any) => v.trip)).size, 2);
  const photos = p.photos(session('overlap'), { place: 'place-bogota' });
  assert.equal(photos.length, 3);
  assert.equal(new Set(photos).size, 3);
  observations.push({ id: 'AUTH-08', samePlaceDistinctVisits: 3, tripCount: 2, authorizedColombiaPhotos: photos.length });
});

test('AUTH-09 every inactive ancestor and non-ready photo suppresses normal reads', () => {
  for (const ancestor of ['projects', 'trips', 'visits', 'photos']) {
    const p = makePolicy();
    p.data[ancestor][0].state = ancestor === 'photos' ? 'trash' : 'archived';
    assert(!p.allows(session('owner'), 'photo.display', 'photo-rome-guest'));
  }
});

test('QUOTA-01 negative control reproduces unsafe check-then-write oversubscription across processes', async () => {
  const { path, db } = store();
  db.exec('CREATE TABLE unsafe (used INTEGER, reserved INTEGER, quota INTEGER); INSERT INTO unsafe VALUES (480000000,0,500000000)');
  const result = await race(path, 'unsafe', [input('a', 'unsafe', 17_000_000), input('b', 'unsafe', 17_000_000)]);
  const row = db.prepare('SELECT * FROM unsafe').get();
  assert.equal(Number(row.used) + Number(row.reserved), 514_000_000);
  observations.push({ id: 'QUOTA-01', expectedUnsafeCounterexample: true, totalBytes: 514_000_000, result });
  db.close();
});

test('QUOTA-02 ten process races each accept exactly one 17MB reservation at 480/500MB', async () => {
  const rounds = [];
  for (let n = 0; n < 10; n++) {
    const { path, db } = store(480_000_000);
    const started = performance.now();
    const results = await race(path, 'reserve', [input('a', `race-${n}`, 17_000_000), input('b', `race-${n}`, 17_000_000)]);
    assert.deepEqual(results.map((r) => r.result).sort(), ['quota_denied', 'reserved']);
    const state = snapshot(db);
    assert.equal(state.account.reserved, 17_000_000);
    assert.equal(Number(state.account.used) + Number(state.account.reserved), 497_000_000);
    rounds.push({ results, state, elapsedMs: +(performance.now() - started).toFixed(3) });
    db.close();
  }
  observations.push({ id: 'QUOTA-02', rounds });
});

test('QUOTA-03 cancellation/failure releases once and actual original+derivative bytes count once', () => {
  const { db } = store(480_000_000);
  const r = input('a', 'release', 17_000_000);
  assert.equal(reserve(db, r).result, 'reserved');
  assert.equal(fail(db, r), 'released');
  assert.equal(fail(db, r), 'noop');
  assert.equal(snapshot(db).account.reserved, 0);
  reserve(db, r);
  assert.equal(complete(db, r, 15_000_000, 1_000_000), 'ready');
  assert.equal(complete(db, r, 15_000_000, 1_000_000), 'replay');
  assert.equal(snapshot(db).account.used, 496_000_000);
  assert.equal(snapshot(db).account.reserved, 0);
  observations.push({ id: 'QUOTA-03', state: snapshot(db) });
  db.close();
});

test('QUOTA-04 actual-byte overflow rolls back; failed reservation can be explicitly released', () => {
  const { db } = store(480_000_000);
  const r = input('a', 'oversized-actual', 17_000_000);
  reserve(db, r);
  assert.throws(() => complete(db, r, 20_000_000, 1), /quota_actual_bytes/);
  assert.equal(snapshot(db).account.used, 480_000_000);
  assert.equal(snapshot(db).account.reserved, 17_000_000);
  assert.equal(snapshot(db).assets.n, 0);
  fail(db, r);
  assert.equal(snapshot(db).account.reserved, 0);
  db.close();
});

test('QUOTA-05 killed transaction leaves no orphan reservation or upload row', async () => {
  const { path, db } = store(480_000_000);
  const results = await race(path, 'crash', [input('a', 'crash', 17_000_000)]);
  assert.equal(snapshot(db).account.reserved, 0);
  assert.equal(snapshot(db).uploads.length, 0);
  observations.push({ id: 'QUOTA-05', results, state: snapshot(db) });
  db.close();
});

test('UPLOAD-01 batch 7 successes/3 failures retries only failures, preserving IDs and charge', () => {
  const { db } = store();
  const f = fixture().uploadCases;
  const files = Array.from({ length: f.files }, (_, i) => input(`file-${i}`, f.batch));
  files.forEach((r, i) => {
    reserve(db, r);
    if (i < f.initialSuccesses) complete(db, r, f.originalBytes, f.displayBytes);
    else fail(db, r);
  });
  const initial = snapshot(db);
  assert.equal(initial.account.used, 7_700_000);
  assert.equal(initial.account.reserved, 0);
  const originalIds = db.prepare("SELECT photo FROM upload WHERE state='ready' ORDER BY photo").all();
  files.slice(7).forEach((r) => { reserve(db, r); complete(db, r, f.originalBytes, f.displayBytes); });
  files.forEach((r) => { assert.equal(reserve(db, r).result, 'replay'); assert.equal(complete(db, r, f.originalBytes, f.displayBytes), 'replay'); });
  const final = snapshot(db);
  assert.equal(final.uploads[0].n, 10);
  assert.equal(final.uploads[0].attempts, 13);
  assert.equal(final.assets.n, 20);
  assert.equal(final.account.used, 11_000_000);
  assert.equal(final.account.reserved, 0);
  for (const row of originalIds) assert(db.prepare('SELECT 1 FROM upload WHERE photo=?').get(row.photo));
  observations.push({ id: 'UPLOAD-01', initial, final });
  db.close();
});

test('UPLOAD-02 eight concurrent duplicate requests reserve and complete only once', async () => {
  const { path, db } = store();
  const inputs = Array.from({ length: 8 }, () => input());
  const reservations = await race(path, 'reserve', inputs);
  assert.equal(reservations.filter((r) => r.result === 'reserved').length, 1);
  assert.equal(snapshot(db).account.reserved, 1_200_000);
  const completions = await race(path, 'complete', inputs);
  assert.equal(completions.filter((r) => r.result === 'ready').length, 1);
  const state = snapshot(db);
  assert.equal(state.uploads[0].n, 1);
  assert.equal(state.assets.n, 2);
  assert.equal(state.account.used, 1_100_000);
  assert.equal(state.account.reserved, 0);
  observations.push({ id: 'UPLOAD-02', reservations, completions, state });
  db.close();
});

test('UPLOAD-03 intentional duplicate content with new operation creates another photo', () => {
  const { db } = store();
  for (const op of ['new-intent-1', 'new-intent-2']) {
    const r = input('same-file-content', op);
    reserve(db, r);
    complete(db, r, 1_000_000, 100_000);
  }
  assert.equal(snapshot(db).uploads[0].n, 2);
  assert.equal(snapshot(db).account.used, 2_200_000);
  db.close();
});

test('UPLOAD-04 key reuse with changed content, target or estimate is rejected without charge', () => {
  const { db } = store();
  const r = input();
  reserve(db, r);
  for (const change of [{ fingerprint: 'changed' }, { visit: 'visit-rome' }, { estimate: 1 }]) {
    assert.throws(() => reserve(db, { ...r, ...change }), /idempotency_conflict/);
  }
  assert.equal(snapshot(db).account.reserved, r.estimate);
  assert.equal(snapshot(db).account.used, 0);
  complete(db, r, 1_000_000, 100_000);
  assert.throws(() => complete(db, r, 1_000_001, 100_000), /completion_conflict/);
  assert.equal(snapshot(db).account.used, 1_100_000);
  db.close();
});

test('UPLOAD-05 idempotency keys are user scoped', () => {
  const { db } = store();
  db.prepare('INSERT INTO account(user,used,quota) VALUES (?,?,?)').run('guest', 0, 500_000_000);
  reserve(db, input());
  reserve(db, { ...input(), user: 'guest' });
  assert.equal(db.prepare('SELECT count(*) n FROM upload').get().n, 2);
  assert.equal(db.prepare('SELECT reserved FROM account WHERE user=?').get('guest').reserved, 1_200_000);
  db.close();
});

test('VALIDATION-01 synthetic metadata size hypotheses accept boundary values and reject oversized batches', () => {
  // This checks declared byte counts only: it does NOT sniff/decode media content.
  const { maxFile, maxBatch } = fixture().byteHypothesis;
  const accepts = (sizes: number[]) => sizes.length > 0 && sizes.length <= maxBatch && sizes.every((n) => Number.isSafeInteger(n) && n > 0 && n <= maxFile);
  for (const bytes of [19_900_000, 20_000_000]) assert(accepts([bytes]));
  assert(!accepts([20_000_001]));
  assert(accepts(Array(10).fill(1)));
  assert(!accepts(Array(11).fill(1)));
  assert(!accepts([NaN]));
  assert(!accepts([-1]));
  observations.push({ id: 'VALIDATION-01', MB: 1_000_000, maxFile, maxBatch, binaryValidation: 'NOT TESTED' });
});

after(() => {
  writeFileSync(new URL('observations.json', evidence), JSON.stringify({
    scope: 'SHARED_REFERENCE_ONLY_NOT_D1_OR_POSTGRESQL', node: process.version,
    sqlite: 'node:sqlite', runDirectory: run, observations,
  }, null, 2) + '\n');
});
