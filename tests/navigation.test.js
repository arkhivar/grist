#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const clone = value => JSON.parse(JSON.stringify(value));
const tick = () => new Promise(resolve => setTimeout(resolve, 0));
async function waitFor(condition, label) {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (condition()) return;
    await tick();
  }
  throw new Error(`Timed out waiting for ${label}`);
}

function createBus() {
  const channels = new Set();
  class MockBroadcastChannel {
    constructor(name) { this.name = name; this.closed = false; channels.add(this); }
    postMessage(value) {
      for (const target of channels) {
        if (target === this || target.name !== this.name) continue;
        const data = clone(value);
        queueMicrotask(() => {
          if (!target.closed) target.onmessage?.({ data });
        });
      }
    }
    close() { this.closed = true; channels.delete(this); }
  }
  return { Channel: MockBroadcastChannel, channels };
}

function createEndpoint(bus, fixture = {}) {
  const dom = new JSDOM('<!doctype html>', { runScripts: 'outside-only',
    url: fixture.url || 'https://arkhivar.github.io/grist/filters.html',
    referrer: fixture.referrer || 'https://grist.example.com/doc/one' });
  const win = dom.window;
  win.BroadcastChannel = bus.Channel;
  win.grist = { docApi: { getDocName: async () => fixture.docId || 'doc-one' } };
  win.eval(read('shared/navigation.js'));
  const visits = [];
  let connection;
  return { dom, win, visits,
    async connect(group = 'students') {
      connection = await win.studentNavigationConnect(group, value => visits.push(clone(value)));
      return connection;
    },
    close() { connection?.close(); win.close(); },
  };
}

function createWidget(bus, fixture = {}) {
  const widget = fixture.widget || 'sprints';
  const html = read(`${widget}.html`);
  const scripts = [...html.matchAll(/<script\b[^>]*\bsrc="([^"]+)"[^>]*>/g)]
    .map(match => match[1]).filter(src => !/^https?:\/\//.test(src))
    .map(src => src.split('?')[0]);
  // Exercise the monthly guard even if Salaries does not load this optional helper.
  if (!scripts.includes('shared/navigation.js'))
    scripts.splice(scripts.indexOf('widgets/sprints/app.js'), 0, 'shared/navigation.js');
  const dom = new JSDOM(html, { runScripts: 'outside-only', pretendToBeVisual: true,
    url: `https://arkhivar.github.io/grist/${widget}.html`,
    referrer: 'https://grist.example.com/doc/one' });
  const win = dom.window;
  win.BroadcastChannel = bus.Channel;
  const calls = { raw: [], docName: 0, metadata: 0, pending: [], options: [], pendingOptions: [] };
  const rows = fixture.rows || [
    { id: 1, datetime: 1788224400, sprint: 'Sprint 01', students: 'Same Name', notes: 'One', wage: 10, performance: ['L', 7] },
    { id: 2, datetime: 1788310800, sprint: 'Sprint 01', students: 'Same Name', notes: 'Two', wage: 20, performance: ['L', 7] },
  ];
  const fields = Object.keys(rows[0]).filter(col => col !== 'id');
  const types = fields.map(col => col === 'students' ? fixture.type || 'Ref:Students'
    : col === 'datetime' ? 'DateTime:Asia/Vladivostok'
    : col === 'wage' ? 'Numeric' : col === 'performance' ? 'RefList:Performance' : 'Text');
  let currentRaw = clone(rows).map(row => ({ ...row, students: fixture.type === 'Text'
    ? row.students : ['R', 'Students', 7] }));
  let onRecords;
  let onOptions;
  let releaseMetadata;
  const metadataGate = fixture.deferMetadata ? new Promise(resolve => { releaseMetadata = resolve; }) : null;
  const rawFetch = (recordId, options) => {
    calls.raw.push({ recordId, options: clone(options) });
    const snapshot = clone(currentRaw);
    const result = recordId == null
      ? Object.fromEntries(['id', ...fields].map(col => [col, snapshot.map(row => row[col])]))
      : snapshot.find(row => Number(row.id) === recordId);
    if (fixture.deferRaw) return new Promise(resolve => calls.pending.push(() => resolve(result)));
    return Promise.resolve(result);
  };
  win.grist = {
    ready() {},
    onRecords(callback) { onRecords = callback; },
    onOptions(callback) { onOptions = callback; },
    async setOption(key, value) {
      calls.options.push([key, value]);
      if (key === 'navigationGroup' && fixture.optionError) throw new Error(fixture.optionError);
      if (key === 'navigationGroup' && fixture.deferOptions)
        await new Promise(resolve => calls.pendingOptions.push(resolve));
    },
    selectedTable: { getTableId: async () => 'All_att' },
    viewApi: {
      ...(!fixture.recordOnly ? { fetchSelectedTable: options => rawFetch(null, options) } : {}),
      fetchSelectedRecord: (id, options) => rawFetch(id, options),
    },
    docApi: {
      async getDocName() { calls.docName++; return 'doc-one'; },
      async fetchTable(tableId) {
        if (tableId === '_grist_Tables')
          return { id: [1, 2, 3], tableId: ['All_att', 'Performance', 'Students'] };
        if (tableId === '_grist_Tables_column') {
          calls.metadata++;
          if (metadataGate) await metadataGate;
          return { id: [...fields.map((_, index) => index + 10), 30, 31],
            colId: [...fields, 'A', 'name'], parentId: [...fields.map(() => 1), 2, 3],
            type: [...types, 'Text', 'Text'], isFormula: [...fields.map(() => false), false, false],
            visibleCol: [...fields.map(col => col === 'performance' ? 30 : col === 'students' ? 31 : 0), 0, 0] };
        }
        if (tableId === 'All_att') return Object.fromEntries(['id', ...fields]
          .map(col => [col, currentRaw.map(row => row[col]) ]));
        if (tableId === 'Performance') return { id: [7], A: ['Teacher'] };
        if (tableId === 'Students') return { id: [7, 8], name: ['Same Name', 'Same Name'] };
        if (tableId === 'Transactions') return { id: [], datetime: [], performance: [], amount: [] };
        throw new Error(`Unexpected table: ${tableId}`);
      },
    },
  };
  win.eval(scripts.map(read).join('\n;\n'));
  return { dom, win, calls, rows,
    records(value = rows) { onRecords(clone(value)); },
    options(value = {}) { onOptions(value, { accessLevel: 'full' }); },
    raw(value) { currentRaw = clone(value); },
    releaseMetadata() { releaseMetadata?.(); },
    async settled() { for (let i = 0; i < 8; i++) await tick(); },
    close() { win.dispatchEvent(new win.Event('pagehide')); win.close(); },
  };
}

let passed = 0;
let failed = 0;
async function test(name, run) {
  try { await run(); passed++; console.log(`PASS ${name}`); }
  catch (error) { failed++; console.error(`FAIL ${name}: ${error.stack}`); }
}

async function main() {
  await test('navigation isolates document, group, widget origin, and embedding origin', async () => {
    const bus = createBus();
    const sender = createEndpoint(bus);
    const same = createEndpoint(bus);
    const others = [createEndpoint(bus, { docId: 'doc-two' }), createEndpoint(bus),
      createEndpoint(bus, { referrer: 'https://other-grist.example.com/doc/one' }),
      createEndpoint(bus, { url: 'https://other-widgets.example.com/filters.html' })];
    try {
      const source = await sender.connect();
      await same.connect();
      for (let i = 0; i < others.length; i++) await others[i].connect(i === 1 ? 'teachers' : 'students');
      source.publish({ tableId: 'Students', ids: [7] });
      await tick();
      assert.deepEqual(same.visits, [{ tableId: 'Students', ids: [7] }]);
      others.forEach(endpoint => assert.deepEqual(endpoint.visits, []));
      assert.match(source.scope, /doc-one/);
      assert.match(source.scope, /grist\.example\.com/);
    } finally { [sender, same, ...others].forEach(endpoint => endpoint.close()); }
  });

  await test('navigation validates visits and replays the current identity to late companions', async () => {
    const bus = createBus();
    const sender = createEndpoint(bus);
    const receiver = createEndpoint(bus);
    try {
      const source = await sender.connect();
      assert.equal(source.publish({ tableId: 'Students', ids: [7, 8] }), false);
      assert.equal(source.publish({ tableId: 'Students', ids: [0] }), false);
      source.publish({ tableId: 'Students', ids: [8] });
      await receiver.connect();
      await tick();
      assert.deepEqual(receiver.visits, [{ tableId: 'Students', ids: [8] }]);
      source.clear();
      source.close();
      assert.equal(source.publish({ text: 'Other' }), false);
      assert.equal(bus.channels.size, 1);
    } finally { sender.close(); receiver.close(); }
  });

  await test('navigation returns unavailable quietly without BroadcastChannel or document API', async () => {
    const bus = createBus();
    const endpoint = createEndpoint(bus);
    try {
      delete endpoint.win.BroadcastChannel;
      assert.equal(await endpoint.win.studentNavigationConnect('students'), null);
      endpoint.win.BroadcastChannel = bus.Channel;
      delete endpoint.win.grist.docApi.getDocName;
      assert.equal(await endpoint.win.studentNavigationConnect('students'), null);
      assert.equal(bus.channels.size, 0);
    } finally { endpoint.close(); }
  });

  await test('Sprints waits for a companion and deduplicates unchanged class refreshes', async () => {
    const bus = createBus();
    const h = createWidget(bus);
    const filter = createEndpoint(bus);
    const late = createEndpoint(bus);
    try {
      h.options(); h.records(); await h.settled();
      assert.equal(h.calls.raw.length, 0);
      await filter.connect();
      await waitFor(() => filter.visits.length === 1, 'initial student visit');
      assert.deepEqual(filter.visits, [{ tableId: 'Students', ids: [7] }]);
      assert.deepEqual(h.calls.raw[0].options, { cellFormat: 'typed', expandRefs: false });
      const reads = h.calls.raw.length;
      h.records(); await h.settled();
      assert.equal(h.calls.raw.length, reads + 1, 'raw references must be reverified when records refresh');
      assert.equal(filter.visits.length, 1);
      const anotherClass = { ...h.rows[0], id: 3, notes: 'New class' };
      h.raw([{ ...anotherClass, students: ['R', 'Students', 7] }]);
      h.records([anotherClass]); await h.settled();
      assert.equal(h.calls.raw.length, reads + 2);
      assert.equal(filter.visits.length, 1, 'same student must not move in history after a class refresh');
      await late.connect();
      await waitFor(() => late.visits.length > 0, 'late filter replay');
      assert.deepEqual(late.visits[0], { tableId: 'Students', ids: [7] });
    } finally { h.close(); filter.close(); late.close(); }
  });

  await test('Sprints waits for options and delayed metadata when the companion starts first', async () => {
    const bus = createBus();
    const filter = createEndpoint(bus);
    const h = createWidget(bus, { deferMetadata: true });
    try {
      await filter.connect(); h.records(); await tick();
      assert.equal(h.calls.docName, 0);
      h.options(); await h.settled();
      assert.equal(h.calls.raw.length, 0);
      h.releaseMetadata();
      await waitFor(() => filter.visits.length > 0, 'visit after metadata');
      assert.deepEqual(filter.visits[0], { tableId: 'Students', ids: [7] });
    } finally { h.close(); filter.close(); }
  });

  await test('Sprints ignores multiple raw students even when their display names are identical', async () => {
    const bus = createBus();
    const h = createWidget(bus);
    const filter = createEndpoint(bus);
    try {
      h.raw(h.rows.map((row, index) => ({ ...row, students: ['R', 'Students', index + 7] })));
      h.options(); h.records(); await filter.connect(); await h.settled();
      assert.deepEqual(filter.visits, []);
      h.raw([{ ...h.rows[1], students: ['R', 'Students', 8] }]);
      h.records([h.rows[1]]);
      await waitFor(() => filter.visits.length === 1, 'distinct student identity');
      assert.deepEqual(filter.visits[0], { tableId: 'Students', ids: [8] });
    } finally { h.close(); filter.close(); }
  });

  await test('Sprints detects changed raw student IDs behind unchanged class IDs and display names', async () => {
    const bus = createBus();
    const h = createWidget(bus);
    const filter = createEndpoint(bus);
    try {
      h.options(); h.records(); await filter.connect();
      await waitFor(() => filter.visits.length === 1, 'original reference');
      h.raw(h.rows.map(row => ({ ...row, students: ['R', 'Students', 8] })));
      h.records();
      await waitFor(() => filter.visits.length === 2, 'changed raw reference');
      assert.deepEqual(filter.visits, [
        { tableId: 'Students', ids: [7] }, { tableId: 'Students', ids: [8] },
      ]);
      h.records(); await h.settled();
      assert.equal(filter.visits.length, 2, 'same identity must not be announced repeatedly');
    } finally { h.close(); filter.close(); }
  });

  await test('Sprints publishes one-item Reference Lists and ignores multi-student lists', async () => {
    const bus = createBus();
    const h = createWidget(bus, { type: 'RefList:Students' });
    const filter = createEndpoint(bus);
    try {
      h.raw(h.rows.map(row => ({ ...row, students: ['r', 'Students', [7, 8]] })));
      h.options(); h.records(); await filter.connect(); await h.settled();
      assert.deepEqual(filter.visits, []);
      h.raw([{ ...h.rows[0], students: ['r', 'Students', [8]] }]);
      h.records([h.rows[0]]);
      await waitFor(() => filter.visits.length === 1, 'single Reference List student');
      assert.deepEqual(filter.visits[0], { tableId: 'Students', ids: [8] });
    } finally { h.close(); filter.close(); }
  });

  await test('Sprints publishes exact Text names and ignores mixed or empty selections', async () => {
    const bus = createBus();
    const h = createWidget(bus, { type: 'Text' });
    const filter = createEndpoint(bus);
    try {
      h.options(); h.records(); await filter.connect();
      await waitFor(() => filter.visits.length === 1, 'Text student');
      assert.deepEqual(filter.visits[0], { text: 'Same Name' });
      assert.equal(h.calls.raw.length, 0);
      h.records([{ ...h.rows[0], students: 'Other' }, h.rows[1]]); await h.settled();
      h.records([]); await h.settled();
      assert.equal(filter.visits.length, 1);
    } finally { h.close(); filter.close(); }
  });

  await test('Sprints discards stale typed reads and preserves reads through identical refreshes', async () => {
    const bus = createBus();
    const h = createWidget(bus, { deferRaw: true });
    const filter = createEndpoint(bus);
    try {
      h.options(); h.records(); await filter.connect();
      await waitFor(() => h.calls.pending.length > 0, 'first raw request');
      const first = h.calls.pending.pop();
      const replacement = { ...h.rows[0], id: 3 };
      h.raw([{ ...replacement, students: ['R', 'Students', 8] }]); h.records([replacement]);
      await waitFor(() => h.calls.pending.length > 0, 'second raw request');
      const second = h.calls.pending.pop();
      h.records([replacement]);
      second(); await waitFor(() => filter.visits.length === 1, 'newest resolved student');
      first(); await h.settled();
      assert.deepEqual(filter.visits, [{ tableId: 'Students', ids: [8] }]);
      assert.equal(h.calls.pending.length, 0);
    } finally { h.close(); filter.close(); }
  });

  await test('Sprints fallback verifies every selected record with typed unexpanded cells', async () => {
    const bus = createBus();
    const h = createWidget(bus, { recordOnly: true });
    const filter = createEndpoint(bus);
    try {
      h.options(); h.records(); await filter.connect();
      await waitFor(() => filter.visits.length > 0, 'record fallback');
      assert.deepEqual(h.calls.raw.map(call => call.recordId), [1, 2]);
      h.calls.raw.forEach(call => assert.deepEqual(call.options, { cellFormat: 'typed', expandRefs: false }));
    } finally { h.close(); filter.close(); }
  });

  await test('Sprints drops pending and cached visits when the linked selection becomes empty', async () => {
    const bus = createBus();
    const h = createWidget(bus, { deferRaw: true });
    const filter = createEndpoint(bus);
    const late = createEndpoint(bus);
    try {
      h.options(); h.records(); await filter.connect();
      await waitFor(() => h.calls.pending.length > 0, 'pending visit');
      const resolve = h.calls.pending.pop();
      h.records([]); resolve(); await h.settled();
      assert.deepEqual(filter.visits, []);
      await late.connect(); await h.settled();
      assert.deepEqual(late.visits, []);
      assert.equal(h.calls.pending.length, 0);
    } finally { h.close(); filter.close(); late.close(); }
  });

  await test('Sprints reconnects when its saved navigation group changes', async () => {
    const bus = createBus();
    const h = createWidget(bus);
    const initial = createEndpoint(bus);
    const moved = createEndpoint(bus);
    try {
      h.options(); h.records(); await initial.connect();
      await waitFor(() => initial.visits.length > 0, 'first group');
      h.options({ navigationGroup: 'second-classroom' }); await h.settled();
      await moved.connect('second-classroom');
      await waitFor(() => moved.visits.length > 0, 'new group');
      assert.deepEqual(moved.visits[0], { tableId: 'Students', ids: [7] });
      assert.equal(initial.visits.length, 1);
    } finally { h.close(); initial.close(); moved.close(); }
  });

  await test('Sprints navigation settings preserve drafts and caret and serialize saves', async () => {
    const bus = createBus();
    const h = createWidget(bus, { deferOptions: true });
    try {
      h.options(); h.records(); await h.settled();
      const input = h.win.document.getElementById('student-navigation-group');
      input.focus(); input.value = 'first-classroom';
      input.dispatchEvent(new h.win.Event('input', { bubbles: true }));
      input.setSelectionRange(2, 6);
      h.records(); h.options({ navigationGroup: 'students' }); await h.settled();
      assert.equal(input.value, 'first-classroom');
      assert.equal(h.win.document.activeElement, input);
      assert.equal(input.selectionStart, 2);
      assert.equal(input.selectionEnd, 6);
      input.dispatchEvent(new h.win.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      await waitFor(() => h.calls.pendingOptions.length === 1, 'first settings save');
      input.value = 'second-classroom';
      input.dispatchEvent(new h.win.Event('input', { bubbles: true }));
      input.dispatchEvent(new h.win.Event('change', { bubbles: true }));
      h.options({ navigationGroup: 'students' }); await h.settled();
      assert.equal(input.value, 'second-classroom');
      assert.deepEqual(h.calls.options.filter(([key]) => key === 'navigationGroup'),
        [['navigationGroup', 'first-classroom']]);
      h.calls.pendingOptions.shift()();
      await waitFor(() => h.calls.pendingOptions.length === 1, 'second serialized save');
      h.calls.pendingOptions.shift()(); await h.settled();
      assert.deepEqual(h.calls.options.filter(([key]) => key === 'navigationGroup'),
        [['navigationGroup', 'first-classroom'], ['navigationGroup', 'second-classroom']]);
      assert.equal(h.win.document.activeElement, input);
      input.value = 'discard-me';
      input.dispatchEvent(new h.win.Event('input', { bubbles: true }));
      input.dispatchEvent(new h.win.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      assert.equal(input.value, 'second-classroom');
    } finally { h.close(); }
  });

  await test('Sprints navigation settings show the real Grist save error without taking focus', async () => {
    const bus = createBus();
    const h = createWidget(bus, { optionError: 'Forbidden: section settings are locked' });
    try {
      h.options(); h.records(); await h.settled();
      const input = h.win.document.getElementById('student-navigation-group');
      input.focus(); input.value = 'another-classroom';
      input.dispatchEvent(new h.win.Event('input', { bubbles: true }));
      input.dispatchEvent(new h.win.Event('change', { bubbles: true }));
      await waitFor(() => h.win.document.getElementById('toast').classList.contains('visible'), 'save error');
      assert.match(h.win.document.getElementById('toast').textContent, /Forbidden: section settings are locked/);
      assert.equal(h.win.document.activeElement, input);
    } finally { h.close(); }
  });

  await test('Salaries does not connect or fetch recent-student navigation', async () => {
    const bus = createBus();
    const h = createWidget(bus, { widget: 'salaries' });
    const filter = createEndpoint(bus);
    try {
      await filter.connect(); h.options(); await h.settled();
      assert.equal(h.calls.docName, 0);
      assert.equal(h.calls.raw.length, 0);
      assert.deepEqual(filter.visits, []);
    } finally { h.close(); filter.close(); }
  });

  console.log(`\n${passed} passed, ${failed} failed.`);
  if (failed) process.exitCode = 1;
}

main().catch(error => { console.error(error); process.exitCode = 1; });
