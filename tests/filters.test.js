'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const read = name => fs.readFileSync(path.join(__dirname, '..', name), 'utf8');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const sec = text => Date.parse(text) / 1000;
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

async function fixture(options = {}) {
  const dom = new JSDOM(read('filters.html'), {
    url: 'https://arkhivar.github.io/grist/filters.html', referrer: 'https://grist.example/doc/a',
    runScripts: 'outside-only', pretendToBeVisual: true,
  });
  const win = dom.window;
  const channels = new Map();
  win.BroadcastChannel = class {
    constructor(name) { this.name = name; this.closed = false; const list = channels.get(name) || []; list.push(this); channels.set(name, list); }
    postMessage(data) { for (const peer of channels.get(this.name)) if (peer !== this && !peer.closed) setTimeout(() => peer.onmessage?.({ data }), 0); }
    close() { this.closed = true; }
  };
  if (options.noBroadcast) delete win.BroadcastChannel;
  if (options.storage) for (const [key, value] of Object.entries(options.storage)) win.localStorage.setItem(key, value);
  if (options.noStorage) {
    win.Storage.prototype.setItem = () => { throw new Error('Storage blocked'); };
    win.Storage.prototype.getItem = () => { throw new Error('Storage blocked'); };
  }
  let records = [
    { id: 1, students: 'Ann Lee', lastClass: sec('2026-10-05T00:00:00Z'), starts: sec('2026-10-05T15:00:00Z'), count: 2, active: true },
    { id: 2, students: 'Ann Lee', lastClass: sec('2026-10-06T00:00:00Z'), starts: sec('2026-10-05T13:00:00Z'), count: 4, active: false },
    { id: 3, students: 'Anna Smith', lastClass: null, starts: null, count: -2, active: false },
    { id: 4, students: 'Émile Martin', lastClass: sec('2026-10-07T00:00:00Z'), starts: sec('2026-10-06T14:00:00Z'), count: 0, active: true },
    { id: 5, students: 'Emma Miller', lastClass: sec('2026-10-08T00:00:00Z'), starts: sec('2026-10-07T14:00:00Z'), count: 8, active: true },
    { id: 6, students: 'Иван Петров', lastClass: sec('2026-10-09T00:00:00Z'), starts: sec('2026-10-08T14:00:00Z'), count: null, active: true },
  ];
  let table = {
    id: records.map(record => record.id), students: records.map(record => ['R', 'Students', record.id + 100]),
    lastClass: records.map(record => record.lastClass == null ? null : ['d', record.lastClass]),
    starts: records.map(record => record.starts == null ? null : ['D', record.starts, 'Asia/Vladivostok']),
    count: records.map(record => record.count), active: records.map(record => record.active), group: records.map(record => ['L', record.id]),
  };
  const calls = {
    ready: [], selection: [], options: [], rawReads: 0, activeRawReads: 0, maxActiveRawReads: 0,
    metadataReads: {}, activeMetadataReads: {}, maxActiveMetadataReads: {},
  };
  let recordsCallback, optionsCallback;
  let selectionHandler = async () => {};
  let tableHandler = async () => table;
  const metadataHandlers = new Map();
  let selectedTableId = 'All_att_summary_students';
  const metadata = {
    id: [1, 2, 3, 4, 5, 6, 7], parentId: [10, 10, 10, 10, 10, 10, 10],
    colId: ['students', 'lastClass', 'starts', 'count', 'active', 'group', 'manualSort'],
    label: ['students', 'lastClass', 'starts', 'count', 'active', 'group', 'manualSort'],
    type: ['Ref:Students', 'Date', 'DateTime:Asia/Vladivostok', 'Int', 'Bool', 'RefList:All_att', 'Numeric'],
  };
  win.grist = {
    ready: value => calls.ready.push(value),
    onRecords: callback => { recordsCallback = callback; },
    onOptions: callback => { optionsCallback = callback; },
    setSelectedRows: async ids => { calls.selection.push(Array.from(ids)); await selectionHandler(ids); },
    setOption: async (key, value) => { calls.options.push([key, JSON.parse(JSON.stringify(value))]); },
    selectedTable: { getTableId: async () => selectedTableId },
    docApi: {
      getDocName: async () => 'document-a',
      fetchTable: async name => {
        if (!['_grist_Tables', '_grist_Tables_column'].includes(name)) throw new Error(`Unexpected table ${name}`);
        calls.metadataReads[name] = (calls.metadataReads[name] || 0) + 1;
        calls.activeMetadataReads[name] = (calls.activeMetadataReads[name] || 0) + 1;
        calls.maxActiveMetadataReads[name] = Math.max(calls.maxActiveMetadataReads[name] || 0, calls.activeMetadataReads[name]);
        try {
          if (metadataHandlers.has(name)) return await metadataHandlers.get(name)();
          return name === '_grist_Tables' ? { id: [10], tableId: [selectedTableId] } : metadata;
        } finally { calls.activeMetadataReads[name]--; }
      },
    },
    viewApi: {
      fetchSelectedTable: async () => {
        calls.rawReads++;
        calls.activeRawReads++;
        calls.maxActiveRawReads = Math.max(calls.maxActiveRawReads, calls.activeRawReads);
        try { return await tableHandler(); }
        finally { calls.activeRawReads--; }
      },
    },
  };
  win.eval([read('shared/dates.js'), read('shared/navigation.js'), read('widgets/filters/app.js')].join('\n;\n'));
  const api = {
    win, doc: win.document, calls,
    options: (value, settings) => optionsCallback(value, settings),
    records: value => recordsCallback(value || records),
    setTable: value => { table = value; },
    getTable: () => table,
    getRecords: () => records,
    setRecords: value => { records = value; },
    metadata,
    setTableId: value => { selectedTableId = value; },
    setSelectionHandler: callback => { selectionHandler = callback; },
    setTableHandler: callback => { tableHandler = callback; },
    setMetadataHandler: (name, callback) => { if (callback) metadataHandlers.set(name, callback); else metadataHandlers.delete(name); },
    search(value) { const input = win.document.getElementById('filter-search'); input.value = value; input.dispatchEvent(new win.Event('input', { bubbles: true })); },
    async visit(id) {
      api.publisher ||= await win.eval("studentNavigationConnect('students', null)");
      api.publisher.publish({ tableId: 'Students', ids: [id] });
      await pause(12);
    },
    chips() { return [...win.document.querySelectorAll('.filter-chip')]; },
    lastSelection() { return calls.selection.at(-1); },
    close() { api.publisher?.close(); win.dispatchEvent(new win.Event('pagehide')); dom.window.close(); },
  };
  if (!options.noStartup) { api.options(options.saved || {}); api.records(); await pause(25); }
  return api;
}

let passed = 0;
async function test(name, callback, options) {
  const f = await fixture(options);
  try { await callback(f); passed++; console.log(`PASS filters: ${name}`); }
  finally { f.close(); }
}

async function main() {
  await test('read-only full metadata access, progressive partial names, no matches and clear', async f => {
    assert.equal(f.calls.ready[0].requiredAccess, 'full');
    assert.equal(f.calls.ready[0].allowSelectBy, true);
    assert.deepEqual(f.lastSelection(), [1, 2, 3, 4, 5, 6]);
    f.search('A'); await pause(5); assert.deepEqual(f.lastSelection(), [1, 2, 3, 4, 5]);
    f.search('An'); await pause(5); assert.deepEqual(f.lastSelection(), [1, 2, 3]);
    f.search('AnnA'); await pause(5); assert.deepEqual(f.lastSelection(), [3]);
    f.search('Annax'); await pause(5); assert.deepEqual(f.lastSelection(), []);
    assert.equal(f.doc.getElementById('filter-clear').hidden, false);
    f.doc.getElementById('filter-clear').click(); await pause(5);
    assert.deepEqual(f.lastSelection(), [1, 2, 3, 4, 5, 6]);
    assert.equal(f.doc.activeElement.id, 'filter-search');
    assert.equal(f.doc.getElementById('filter-clear').hidden, true);
    assert.ok(f.doc.getElementById('filter-empty-recents'));
    assert.ok(f.doc.querySelector('#btn-filter-rules svg'));
  });
  await test('Unicode, accents and pasted name fragments use literal matching', async f => {
    f.search(' EMILE  martin '); await pause(5); assert.deepEqual(f.lastSelection(), [4]);
    f.search('петр'); await pause(5); assert.deepEqual(f.lastSelection(), [6]);
    f.search('['); await pause(5); assert.deepEqual(f.lastSelection(), []);
  });
  await test('filtering stays available when the browser cannot connect recent-student history', async f => {
    f.search('Anna'); await pause(5);
    assert.deepEqual(f.lastSelection(), [3]);
    assert.match(f.doc.getElementById('filter-status').textContent, /cannot share recent/);
    assert.equal(f.doc.getElementById('toast').textContent, '');
  }, { noBroadcast: true });
  await test('records-first waits for saved options and preserves a saved name column', async f => {
    f.records(); await pause(15); assert.equal(f.calls.selection.length, 0);
    f.options({ studentFilter: { nameColumn: 'students', match: 'all', rules: [{ column: 'count', operator: 'gte', value: '4' }] } });
    await pause(15); assert.deepEqual(f.lastSelection(), [2, 5]);
  }, { noStartup: true });
  await test('Date uses UTC, DateTime compares VLAT calendar days, empty dates remain empty', async f => {
    f.options({ studentFilter: { nameColumn: 'students', rules: [{ column: 'starts', operator: 'is', value: '2026-10-06' }] } });
    await pause(5); assert.deepEqual(f.lastSelection(), [1]);
    f.options({ studentFilter: { nameColumn: 'students', rules: [{ column: 'lastClass', operator: 'is', value: '2026-10-05' }] } });
    await pause(5); assert.deepEqual(f.lastSelection(), [1]);
    f.options({ studentFilter: { nameColumn: 'students', rules: [{ column: 'lastClass', operator: 'empty', value: '' }] } });
    await pause(5); assert.deepEqual(f.lastSelection(), [3]);
  });
  await test('Match any/all, numbers including zero, booleans, incomplete conditions and section persistence', async f => {
    const rules = [{ column: 'count', operator: 'is', value: '0' }, { column: 'active', operator: 'is', value: 'false' }];
    f.options({ studentFilter: { nameColumn: 'students', match: 'any', rules } });
    await pause(5); assert.deepEqual(f.lastSelection(), [2, 3, 4]);
    f.doc.getElementById('filter-match').value = 'all';
    f.doc.getElementById('filter-match').dispatchEvent(new f.win.Event('change'));
    await pause(5); assert.deepEqual(f.lastSelection(), []);
    await pause(210); assert.equal(f.calls.options.at(-1)[0], 'studentFilter');
    assert.equal(f.calls.options.at(-1)[1].match, 'all');
    f.options({ studentFilter: { nameColumn: 'students', rules: [{ column: 'count', operator: 'gt', value: 'wrong' }] } });
    await pause(5); assert.deepEqual(f.lastSelection(), [1, 2, 3, 4, 5, 6]);
  });
  await test('typed lookup wrappers retain raw reference and VLAT date identity; errors are not false booleans', async f => {
    const table = f.getTable();
    table.students[0] = ['l', ['R', 'Students', 101]];
    table.starts[0] = ['l', ['D', sec('2026-10-05T15:00:00Z'), 'Asia/Vladivostok']];
    table.active[1] = ['E', 'Invalid Boolean'];
    f.records(); await pause(12); await f.visit(101);
    assert.equal(f.chips()[0].textContent, 'Ann Lee');
    f.options({ studentFilter: { nameColumn: 'students', rules: [{ column: 'starts', operator: 'is', value: '2026-10-06' }] } });
    await pause(5); assert.deepEqual(f.lastSelection(), [1]);
    f.options({ studentFilter: { nameColumn: 'students', rules: [{ column: 'active', operator: 'is', value: 'false' }] } });
    await pause(5); assert.deepEqual(f.lastSelection(), [3]);
  });
  await test('recent visits dedupe to five IDs, duplicate labels select the exact student, rules pause', async f => {
    for (const id of [101, 102, 103, 104, 105, 106]) await f.visit(id);
    assert.equal(f.chips().length, 5);
    assert.equal(f.chips()[0].textContent, 'Иван Петров');
    await f.visit(102); assert.equal(f.chips()[0].textContent, 'Ann Lee');
    assert.equal(f.chips().length, 5);
    f.options({ studentFilter: { nameColumn: 'students', rules: [{ column: 'active', operator: 'is', value: 'true' }] } });
    await pause(5);
    f.chips()[0].click(); await pause(5); assert.deepEqual(f.lastSelection(), [2]);
    assert.match(f.doc.getElementById('btn-filter-rules').textContent, /paused/);
    f.search('Ann'); await pause(5); assert.deepEqual(f.lastSelection(), [1]);
    assert.ok(f.calls.options.every(([key]) => key !== 'recents'));
  });
  await test('personal history survives refresh and reload, labels stay live, foreign references are ignored', async f => {
    await f.visit(101);
    f.publisher.publish({ tableId: 'OtherStudents', ids: [102] }); await pause(8);
    assert.equal(f.chips().length, 1);
    const updated = [
      { id: 1, students: 'Ann Renamed', lastClass: null, starts: null, count: 2, active: true },
      { id: 2, students: 'Ann Lee', lastClass: null, starts: null, count: 4, active: false },
    ];
    f.setRecords(updated); f.records(); await pause(15);
    assert.equal(f.chips()[0].textContent, 'Ann Renamed');
    const storage = Object.fromEntries(Object.keys(f.win.localStorage).map(key => [key, f.win.localStorage.getItem(key)]));
    const reloaded = await fixture({ storage });
    try { assert.equal(reloaded.chips()[0].textContent, 'Ann Lee'); }
    finally { reloaded.close(); }
  });
  await test('blocked storage still preserves session recent history on refresh', async f => {
    await f.visit(101); f.records(); await pause(15);
    assert.equal(f.chips().length, 1);
  }, { noStorage: true });
  await test('search and rule drafts, caret and keyboard focus survive live data/options refresh', async f => {
    f.doc.getElementById('btn-filter-rules').click();
    assert.equal(f.doc.activeElement.id, 'filter-match');
    f.doc.getElementById('filter-add-rule').click();
    const row = f.doc.querySelector('.filter-rule');
    const field = row.querySelector('select'); field.value = 'students'; field.dispatchEvent(new f.win.Event('change'));
    const input = f.doc.querySelector('.filter-rule input'); input.value = 'Ann'; input.dispatchEvent(new f.win.Event('input'));
    input.focus(); input.setSelectionRange(1, 2);
    f.records(); await pause(15); f.options({}); await pause(5);
    assert.equal(f.doc.activeElement, input); assert.equal(input.value, 'Ann');
    assert.equal(input.selectionStart, 1); assert.equal(input.selectionEnd, 2);
    f.doc.dispatchEvent(new f.win.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    assert.equal(f.doc.getElementById('filter-rules').hidden, true);
    assert.equal(f.doc.activeElement.id, 'btn-filter-rules');
    f.search('Ann'); f.doc.getElementById('filter-search').focus();
    f.records(); await pause(15); assert.equal(f.doc.activeElement.id, 'filter-search');
    assert.equal(f.doc.getElementById('filter-search').value, 'Ann');
  });
  await test('stale raw loads cannot replace the current student rows', async f => {
    const stale = deferred();
    const reads = f.calls.rawReads;
    f.setTableHandler(() => stale.promise); f.records([{ id: 1, students: 'Ann Lee' }]);
    await pause(5); assert.equal(f.calls.rawReads, reads + 1);
    f.setTableHandler(async () => ({ id: [6], students: [['R', 'Students', 106]] }));
    f.records([{ id: 6, students: 'Иван Петров' }]); await pause(5);
    assert.equal(f.calls.rawReads, reads + 1, 'newest refresh waits for the active raw read');
    stale.resolve(f.getTable()); await pause(12);
    assert.deepEqual(f.lastSelection(), [6]);
    assert.equal(f.calls.rawReads, reads + 2);
    assert.equal(f.calls.maxActiveRawReads, 1);
  });
  await test('a burst of native refreshes keeps one active read and loads only the latest snapshot next', async f => {
    const first = deferred();
    const second = deferred();
    let nextRead = 0;
    const reads = f.calls.rawReads;
    const selections = f.calls.selection.length;
    f.setTableHandler(() => ++nextRead === 1 ? first.promise : second.promise);
    f.records([{ id: 1, students: 'Ann Lee' }]); await pause(5);
    for (let index = 0; index < 30; index++)
      f.records([{ id: index % 2 ? 2 : 3, students: index % 2 ? 'Ann Lee' : 'Anna Smith' }]);
    f.records([{ id: 6, students: 'Иван Петров' }]); await pause(5);
    assert.equal(f.calls.rawReads, reads + 1);
    assert.equal(f.calls.activeRawReads, 1);
    first.resolve(f.getTable()); await pause(5);
    assert.equal(f.calls.rawReads, reads + 2, 'intermediate refreshes are coalesced');
    assert.equal(f.calls.selection.length, selections, 'stale snapshot is never published');
    second.resolve(f.getTable()); await pause(12);
    assert.deepEqual(f.lastSelection(), [6]);
    assert.equal(f.calls.selection.length, selections + 1);
    assert.equal(f.calls.maxActiveRawReads, 1);
    assert.equal(f.calls.activeRawReads, 0);
    assert.equal(f.doc.getElementById('filter-count').textContent, '1 / 1');
  });
  await test('native row sorting keeps the same selected IDs without resetting the native cursor', async f => {
    f.search('Ann'); await pause(5);
    assert.deepEqual(f.lastSelection(), [1, 2, 3]);
    const selections = f.calls.selection.length;
    f.setTable(Object.fromEntries(Object.entries(f.getTable()).map(([column, values]) => [column, [...values].reverse()])));
    f.records([...f.getRecords()].reverse()); await pause(12);
    assert.equal(f.calls.selection.length, selections, 'a row-order-only refresh does not republish the same IDs');
    assert.equal(f.doc.getElementById('filter-count').textContent, '3 / 6');
    f.records([...f.getRecords()]); await pause(12);
    assert.equal(f.calls.selection.length, selections);
  });
  await test('a duplicated matching row is published once and repeated native refreshes settle', async f => {
    f.search('Ann'); await pause(5);
    const selections = f.calls.selection.length;
    const duplicated = { id: 7, students: 'Ann Lee', lastClass: null, starts: null, count: 2, active: true };
    const records = [...f.getRecords(), duplicated];
    const raw = { ...duplicated, students: ['R', 'Students', 101], group: ['L', 7] };
    f.setTable(Object.fromEntries(Object.entries(f.getTable()).map(([column, values]) => [column, [...values, raw[column]]])));
    f.setRecords(records);
    // Publishing selection can echo back as another native records event.
    f.setSelectionHandler(async () => { f.records(records); });
    f.records(records); await pause(20);
    assert.deepEqual(f.lastSelection(), [1, 2, 3, 7]);
    assert.equal(f.calls.selection.length, selections + 1);
    for (let index = 0; index < 20; index++) f.records(records);
    await pause(20);
    assert.equal(f.calls.selection.length, selections + 1, 'identical refresh echoes stop without another selection RPC');
    assert.equal(f.calls.maxActiveRawReads, 1);
    assert.equal(f.calls.activeRawReads, 0);
    assert.equal(f.doc.getElementById('filter-count').textContent, '4 / 7');
  });
  await test('stale raw errors release the refresh queue; current failures surface and the next refresh recovers', async f => {
    const first = deferred();
    const selections = f.calls.selection.length;
    f.setTableHandler(() => first.promise);
    f.records([{ id: 1, students: 'Ann Lee' }]); await pause(5);
    f.setTableHandler(async () => f.getTable());
    f.records([{ id: 6, students: 'Иван Петров' }]);
    first.reject(new Error('Stale raw failure')); await pause(12);
    assert.deepEqual(f.lastSelection(), [6]);
    assert.equal(f.calls.selection.length, selections + 1);
    assert.equal(f.doc.getElementById('toast').textContent, '', 'a replaced snapshot failure is not an actionable error');
    assert.equal(f.calls.activeRawReads, 0);
    f.setTableHandler(async () => { throw new Error('Current raw failure'); });
    f.records(); await pause(12);
    assert.equal(f.doc.getElementById('toast').textContent, 'Current raw failure');
    assert.equal(f.doc.getElementById('filter-count').textContent, 'Unable to load');
    assert.equal(f.calls.activeRawReads, 0);
    f.setTableHandler(async () => f.getTable());
    f.records(); await pause(12);
    assert.deepEqual(f.lastSelection(), [1, 2, 3, 4, 5, 6]);
    assert.equal(f.doc.getElementById('filter-count').textContent, '6 / 6');
    assert.equal(f.calls.activeRawReads, 0);
    assert.equal(f.calls.maxActiveRawReads, 1);
  });
  await test('an early raw failure waits for pending metadata before the newest refresh starts', async f => {
    const tables = deferred();
    f.options({});
    f.setMetadataHandler('_grist_Tables', () => tables.promise);
    f.setTableHandler(async () => { throw new Error('Stale raw failure'); });
    f.records([{ id: 1, students: 'Ann Lee' }]); await pause(5);
    assert.equal(f.calls.rawReads, 1);
    assert.equal(f.calls.activeMetadataReads._grist_Tables, 1);
    f.setTableHandler(async () => f.getTable());
    f.records([{ id: 6, students: 'Иван Петров' }]); await pause(5);
    assert.equal(f.calls.rawReads, 1, 'failure cannot release a load while its metadata RPC is pending');
    assert.equal(f.doc.getElementById('toast').textContent, '');
    tables.resolve({ id: [10], tableId: ['All_att_summary_students'] }); await pause(12);
    assert.deepEqual(f.lastSelection(), [6]);
    assert.equal(f.calls.rawReads, 2);
    assert.equal(f.calls.activeMetadataReads._grist_Tables, 0);
    assert.equal(f.calls.maxActiveMetadataReads._grist_Tables, 1);
    assert.equal(f.doc.getElementById('toast').textContent, '');
  }, { noStartup: true });
  await test('an early metadata failure waits for the raw read and surfaces the newest failure before recovery', async f => {
    const raw = deferred();
    f.options({});
    f.setMetadataHandler('_grist_Tables', async () => { throw new Error('Stale metadata failure'); });
    f.setTableHandler(() => raw.promise);
    f.records([{ id: 1, students: 'Ann Lee' }]); await pause(5);
    f.setMetadataHandler('_grist_Tables', async () => { throw new Error('Current metadata unavailable'); });
    f.setTableHandler(async () => f.getTable());
    f.records([{ id: 6, students: 'Иван Петров' }]); await pause(5);
    assert.equal(f.calls.rawReads, 1, 'failure cannot release a load while its raw RPC is pending');
    assert.equal(f.calls.metadataReads._grist_Tables, 1);
    assert.equal(f.doc.getElementById('toast').textContent, '');
    raw.resolve(f.getTable()); await pause(12);
    assert.equal(f.calls.rawReads, 2);
    assert.equal(f.calls.selection.length, 0);
    assert.equal(f.doc.getElementById('toast').textContent, 'Current metadata unavailable');
    assert.equal(f.doc.getElementById('filter-count').textContent, 'Unable to load');
    f.setMetadataHandler('_grist_Tables', null);
    f.records([{ id: 6, students: 'Иван Петров' }]); await pause(12);
    assert.deepEqual(f.lastSelection(), [6]);
    assert.equal(f.calls.rawReads, 3);
    assert.equal(f.calls.maxActiveRawReads, 1);
    assert.equal(f.doc.getElementById('filter-count').textContent, '1 / 1');
  }, { noStartup: true });
  await test('a failed metadata sibling cannot start another load while the other metadata RPC is pending', async f => {
    const columns = deferred();
    f.options({});
    f.setMetadataHandler('_grist_Tables', async () => { throw new Error('Stale table metadata failure'); });
    f.setMetadataHandler('_grist_Tables_column', () => columns.promise);
    f.records([{ id: 1, students: 'Ann Lee' }]); await pause(5);
    f.setMetadataHandler('_grist_Tables', null);
    f.setMetadataHandler('_grist_Tables_column', null);
    for (let index = 0; index < 15; index++) f.records([{ id: 2, students: 'Ann Lee' }]);
    f.records([{ id: 6, students: 'Иван Петров' }]); await pause(5);
    assert.equal(f.calls.rawReads, 1);
    assert.equal(f.calls.metadataReads._grist_Tables_column, 1);
    assert.equal(f.calls.activeMetadataReads._grist_Tables_column, 1);
    columns.resolve(f.metadata); await pause(12);
    assert.deepEqual(f.lastSelection(), [6]);
    assert.equal(f.calls.rawReads, 2);
    assert.equal(f.calls.metadataReads._grist_Tables_column, 2);
    assert.equal(f.calls.maxActiveMetadataReads._grist_Tables_column, 1);
    assert.equal(f.calls.activeMetadataReads._grist_Tables_column, 0);
    assert.equal(f.doc.getElementById('toast').textContent, '');
  }, { noStartup: true });
  await test('an incoming Select By pauses options-first startup and resumes once it is cleared', async f => {
    f.options({}, { linking: { asTarget: 'Cursor:Same-Table', asSource: true } });
    f.records(); await pause(15);
    assert.equal(f.calls.selection.length, 0);
    assert.equal(f.doc.getElementById('filter-count').textContent, 'Check linking');
    assert.match(f.doc.getElementById('filter-count').title, /own Select By/);
    assert.match(f.doc.getElementById('filter-status').textContent, /selects by this filter/);
    f.search('Anna'); await pause(5);
    assert.equal(f.calls.selection.length, 0);
    f.options({}, { linking: { asSource: true } }); await pause(5);
    assert.equal(f.calls.selection.length, 0, 'a partial settings callback does not clear a known incoming link');
    f.options({}, { linking: { asTarget: null, asSource: true } }); await pause(5);
    assert.deepEqual(f.lastSelection(), [3]);
    assert.equal(f.calls.selection.length, 1);
    assert.equal(f.doc.getElementById('filter-count').textContent, '1 / 6');
    assert.equal(f.doc.getElementById('filter-count').title, '');
    assert.doesNotMatch(f.doc.getElementById('filter-status').textContent, /Clear this filter/);
  }, { noStartup: true });
  await test('records-first startup waits for linking settings before publishing rows', async f => {
    f.records(); await pause(15);
    assert.equal(f.calls.selection.length, 0);
    f.options({}, { linking: { asTarget: 'Cursor:Same-Table', asSource: true } }); await pause(5);
    assert.equal(f.calls.selection.length, 0);
    assert.equal(f.doc.getElementById('filter-count').textContent, 'Check linking');
    f.options({}, { linking: { asTarget: null, asSource: true } }); await pause(5);
    assert.deepEqual(f.lastSelection(), [1, 2, 3, 4, 5, 6]);
    assert.equal(f.calls.selection.length, 1);
  }, { noStartup: true });
  await test('clearing an incoming link during a pending refresh publishes only the latest loaded rows', async f => {
    const first = deferred();
    f.options({}, { linking: { asTarget: 'Cursor:Same-Table', asSource: true } });
    f.setTableHandler(() => first.promise);
    f.records([{ id: 1, students: 'Ann Lee' }]); await pause(5);
    f.setTableHandler(async () => f.getTable());
    f.records([{ id: 6, students: 'Иван Петров' }]);
    f.options({}, { linking: { asTarget: null, asSource: true } }); await pause(5);
    assert.equal(f.calls.selection.length, 0, 'unlinking waits for the current raw snapshot');
    first.resolve(f.getTable()); await pause(12);
    assert.deepEqual(f.lastSelection(), [6]);
    assert.equal(f.calls.selection.length, 1);
    assert.equal(f.doc.getElementById('filter-count').textContent, '1 / 1');
  }, { noStartup: true });
  await test('an incoming link drops queued selections and a settling RPC cannot replace the linking hint', async f => {
    const pending = deferred();
    const selections = f.calls.selection.length;
    f.setSelectionHandler(() => pending.promise);
    f.search('An'); f.search('Emma');
    assert.deepEqual(f.lastSelection(), [1, 2, 3]);
    f.options({}, { linking: { asTarget: 'Cursor:Same-Table', asSource: true } });
    pending.resolve(); await pause(8);
    assert.equal(f.calls.selection.length, selections + 1, 'the pending newer selection is not published into an incoming link');
    assert.equal(f.doc.getElementById('filter-count').textContent, 'Check linking');
    f.search('Anna'); await pause(5);
    assert.equal(f.calls.selection.length, selections + 1);
    f.setSelectionHandler(async () => {});
    f.options({}, { linking: { asTarget: null, asSource: true } }); await pause(5);
    assert.deepEqual(f.lastSelection(), [3]);
    assert.equal(f.calls.selection.length, selections + 2);
  });
  await test('unlinking during a delayed selection acknowledgement resends fresh identical IDs once', async f => {
    const pending = deferred();
    const selections = f.calls.selection.length;
    let first = true;
    f.setSelectionHandler(() => {
      if (!first) return Promise.resolve();
      first = false;
      return pending.promise;
    });
    f.search('Ann');
    f.options({}, { linking: { asTarget: 'Cursor:Same-Table', asSource: true } });
    f.options({}, { linking: { asTarget: null, asSource: true } });
    assert.equal(f.calls.selection.length, selections + 1);
    pending.resolve(); await pause(8);
    assert.equal(f.calls.selection.length, selections + 2, 'an acknowledgement from before relinking cannot deduplicate the fresh selection');
    assert.deepEqual(f.calls.selection.slice(-2), [[1, 2, 3], [1, 2, 3]]);
    f.records(); await pause(12);
    assert.equal(f.calls.selection.length, selections + 2);
  });
  await test('switching A to B to A during a delayed acknowledgement publishes fresh A selection once', async f => {
    const pending = deferred();
    const selections = f.calls.selection.length;
    let first = true;
    f.setSelectionHandler(() => {
      if (!first) return Promise.resolve();
      first = false;
      return pending.promise;
    });
    f.search('Ann');
    f.setTableId('Other_summary'); f.records(); await pause(12);
    f.setTableId('All_att_summary_students'); f.records(); await pause(12);
    assert.equal(f.calls.selection.length, selections + 1);
    pending.resolve(); await pause(8);
    assert.equal(f.calls.selection.length, selections + 2, 'returning to the same table does not validate an old-generation acknowledgement');
    assert.deepEqual(f.calls.selection.slice(-2), [[1, 2, 3], [1, 2, 3]]);
    f.records(); await pause(12);
    assert.equal(f.calls.selection.length, selections + 2);
  });
  await test('a source switch discards queued old-table selection until current raw rows are ready', async f => {
    const selection = deferred();
    const raw = deferred();
    const selections = f.calls.selection.length;
    let first = true;
    f.setSelectionHandler(() => {
      if (!first) return Promise.resolve();
      first = false;
      return selection.promise;
    });
    f.search('An'); f.search('Emma');
    f.setTableId('Other_summary'); f.setTableHandler(() => raw.promise);
    f.records(); await pause(5);
    selection.resolve(); await pause(5);
    assert.equal(f.calls.selection.length, selections + 1, 'old queued IDs cannot be sent against a source whose rows are still loading');
    raw.resolve(f.getTable()); await pause(12);
    assert.deepEqual(f.lastSelection(), [5]);
    assert.equal(f.calls.selection.length, selections + 2);
    assert.equal(f.doc.getElementById('filter-count').textContent, '1 / 6');
  });
  await test('older hosts without incoming-link metadata retain progressive filtering', async f => {
    f.options({}, { linking: { asSource: true } });
    f.search('Anna'); await pause(5); assert.deepEqual(f.lastSelection(), [3]);
    f.options({}, {});
    f.search('Emma'); await pause(5); assert.deepEqual(f.lastSelection(), [5]);
    f.options({});
    f.search('Emile'); await pause(5); assert.deepEqual(f.lastSelection(), [4]);
  });
  await test('selection RPCs are serialized, latest query wins, unchanged refresh avoids native cursor resets', async f => {
    const releases = [];
    f.setSelectionHandler(() => new Promise(resolve => releases.push(resolve)));
    f.search('An'); f.search('Anna'); f.search('Emma');
    assert.deepEqual(f.lastSelection(), [1, 2, 3]);
    releases.shift()(); await pause(5); assert.deepEqual(f.lastSelection(), [5]);
    releases.shift()(); await pause(5);
    const count = f.calls.selection.length;
    f.records(); await pause(15); assert.equal(f.calls.selection.length, count);
  });
  await test('a failed older selection cannot leave a stale error count after the latest search succeeds', async f => {
    let reject;
    let first = true;
    f.setSelectionHandler(() => {
      if (!first) return Promise.resolve();
      first = false;
      return new Promise((_, no) => { reject = no; });
    });
    f.search('Ann'); f.search('Emma'); reject(new Error('First selection failed'));
    await pause(10);
    assert.deepEqual(f.lastSelection(), [5]);
    assert.equal(f.doc.getElementById('filter-count').textContent, '1 / 6');
  });
  await test('switching the source table invalidates metadata, history scope and identical row selections', async f => {
    await f.visit(101);
    const count = f.calls.selection.length;
    f.setTableId('Other_summary'); f.metadata.type[0] = 'Ref:OtherStudents';
    f.getTable().students = f.getTable().id.map(id => ['R', 'OtherStudents', id + 100]);
    f.records(); await pause(15);
    assert.equal(f.calls.selection.length, count + 1);
    assert.equal(f.chips().length, 0);
    f.publisher.publish({ tableId: 'OtherStudents', ids: [101] }); await pause(10);
    assert.equal(f.chips().length, 1);
    f.chips()[0].click(); await pause(5); assert.deepEqual(f.lastSelection(), [1]);
  });
  await test('real selection and data errors stay outside table flow and leave search focused', async f => {
    f.doc.getElementById('filter-search').focus();
    f.setSelectionHandler(async () => { throw new Error('Selection rejected by Grist'); });
    f.search('Anna'); await pause(8);
    assert.equal(f.doc.getElementById('toast').textContent, 'Selection rejected by Grist');
    assert.equal(f.doc.activeElement.id, 'filter-search');
    f.setTableHandler(async () => { throw new Error('Raw rows unavailable'); });
    f.records(); await pause(8);
    assert.equal(f.doc.getElementById('toast').textContent, 'Raw rows unavailable');
    assert.equal(f.doc.getElementById('filter-count').textContent, 'Unable to load');
  });
  await test('clearing saved view options resets conditions, empty source publishes no rows', async f => {
    f.options({ studentFilter: { nameColumn: 'students', rules: [{ column: 'active', operator: 'is', value: 'false' }] } });
    await pause(5); assert.deepEqual(f.lastSelection(), [2, 3]);
    f.options({}); await pause(5); assert.deepEqual(f.lastSelection(), [1, 2, 3, 4, 5, 6]);
    f.setTable({ id: [], students: [], lastClass: [] }); f.records([]); await pause(15);
    assert.deepEqual(f.lastSelection(), []);
  });
  const version = /WIDGET_VERSION = '([^']+)'/.exec(read('shared/core.js'))[1];
  for (const entry of ['filters.html', 'sprints.html', 'salaries.html']) {
    const html = read(entry);
    for (const match of html.matchAll(/\?v=([^"']+)/g)) assert.equal(match[1], version, `${entry} cache key`);
    const scripts = [...html.matchAll(/<script src="([^"?]+)(?:\?[^\"]*)?"><\/script>/g)]
      .map(match => match[1]).filter(src => !src.startsWith('https:'));
    assert.doesNotThrow(() => new (require('node:vm').Script)(scripts.map(read).join('\n;\n')), `${entry} classic scope`);
  }
  assert.match(read('filters.html'), new RegExp(`data-widget-version="${version}"`));
  console.log(`\n${passed} filter scenarios passed; every entry has synchronized cache keys and valid classic scope.`);
}
main().catch(error => { console.error(error); process.exitCode = 1; });
