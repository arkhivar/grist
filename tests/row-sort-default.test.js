#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const tick = () => new Promise(resolve => setTimeout(resolve, 0));
const sortedHeader = doc => doc.querySelector(
  '#column-strip th[aria-sort="ascending"], #column-strip th[aria-sort="descending"]');
const headerSortButton = (doc, col) =>
  doc.querySelector(`#column-strip th[data-column="${col}"] button.column-sort-button`);
async function waitFor(condition, label) {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (condition()) return;
    await tick();
  }
  throw new Error(`Timed out waiting for ${label}`);
}

function createWidget(widget, fixture = {}) {
  const html = read(`${widget}.html`);
  const scripts = [...html.matchAll(/<script\b[^>]*\bsrc="([^"]+)"[^>]*>/g)]
    .map(match => match[1]).filter(src => !/^https?:\/\//.test(src))
    .map(src => src.split('?')[0]);
  const dom = new JSDOM(html, { url: `https://arkhivar.github.io/grist/${widget}.html`,
    runScripts: 'outside-only', pretendToBeVisual: true });
  const win = dom.window;
  const doc = win.document;
  const datetimeColumn = fixture.datetimeColumn || 'datetime';
  const rows = [
    { id: 1, [datetimeColumn]: Date.parse('2026-09-01T01:00:00Z') / 1000,
      sprint: 'Sprint 01', notes: 'Oldest', wage: 30, performance: ['L', 7] },
    { id: 2, [datetimeColumn]: '2026-09-03T01:00:00Z',
      sprint: 'Sprint 01', notes: 'Newest', wage: 20, performance: ['L', 7] },
    { id: 3, [datetimeColumn]: { toString: () => '2026-09-02T01:00:00Z' },
      sprint: 'Sprint 01', notes: 'Middle', wage: 10, performance: ['L', 7] },
  ];
  if (fixture.extraDatetimeColumn) {
    rows.forEach((row, index) => { row.DateTime = Date.parse(`2026-09-0${index + 1}T01:00:00Z`) / 1000; });
  }
  const fields = Object.keys(rows[0]).filter(col => col !== 'id');
  const classes = Object.fromEntries(['id', ...fields].map(col => [col, rows.map(row => row[col])]));
  const types = fields.map(col => col === datetimeColumn || col === 'DateTime' ? 'DateTime:Asia/Vladivostok'
    : col === 'wage' ? 'Numeric' : col === 'performance' ? 'RefList:Performance' : 'Text');
  let onRecords;
  let onOptions;
  let releaseMetadata;
  const metadataGate = fixture.deferMetadata ? new Promise(resolve => { releaseMetadata = resolve; }) : null;
  const calls = { options: [], updates: [], metadata: 0 };
  win.grist = {
    ready() {},
    onRecords(callback) { onRecords = callback; },
    onOptions(callback) { onOptions = callback; },
    async setOption(key, value) { calls.options.push([key, value]); },
    selectedTable: {
      getTableId: async () => 'All_att',
      async update(...args) { calls.updates.push(args); },
    },
    docApi: {
      async fetchTable(name) {
        if (name === '_grist_Tables') return { id: [1, 2], tableId: ['All_att', 'Performance'] };
        if (name === '_grist_Tables_column') {
          calls.metadata++;
          if (metadataGate) await metadataGate;
          return { id: [...fields.map((_, index) => index + 10), 30],
            colId: [...fields, 'A'], parentId: [...fields.map(() => 1), 2],
            type: [...types, 'Text'], isFormula: fields.map(() => false).concat(false),
            visibleCol: fields.map(col => col === 'performance' ? 30 : 0).concat(0) };
        }
        if (name === 'All_att') return classes;
        if (name === 'Performance') return { id: [7], A: ['VP'] };
        if (name === 'Transactions') return { id: [], datetime: [], performance: [], amount: [] };
        throw new Error(`Unexpected fetchTable: ${name}`);
      },
    },
  };
  win.eval(scripts.map(read).join('\n;\n'));
  return { dom, win, doc, calls,
    records(value = rows) { onRecords(value); },
    options(value = {}) { onOptions(value, { accessLevel: 'full' }); },
    releaseMetadata() { releaseMetadata?.(); },
    order: () => [...doc.querySelectorAll('tr[data-record-id]')].map(row => Number(row.dataset.recordId)),
    sorts: () => calls.options.filter(([key]) => key === 'rowSort').map(([, value]) => value),
    async loaded() {
      await waitFor(() => doc.querySelectorAll('tr[data-record-id]').length === rows.length, `${widget} rows`);
      await tick();
      await tick();
    },
    clearSort() {
      if (widget === 'salaries') {
        sortedHeader(doc).querySelector('button.column-sort-button').click();
        return;
      }
      const columnControl = doc.getElementById('row-sort-select');
      columnControl.value = '';
      columnControl.dispatchEvent(new win.Event('change', { bubbles: true }));
    },
  };
}

function assertSortColumn(widget, doc, column) {
  const actual = widget === 'salaries' ? sortedHeader(doc)?.dataset.column || ''
    : doc.getElementById('row-sort-select').value;
  assert.equal(actual, column);
}

let passed = 0;
let failed = 0;
async function test(name, run) {
  try { await run(); passed++; console.log(`PASS ${name}`); }
  catch (error) { failed++; console.error(`FAIL ${name}: ${error.stack}`); }
}

async function main() {
  for (const widget of ['sprints', 'salaries']) {
    await test(`${widget}: defaults to datetime newest first after records arrive before options`, async () => {
      const h = createWidget(widget);
      try {
        h.records();
        await tick();
        assert.equal(h.sorts().length, 0, 'must wait for saved options');
        h.options({ sortMode: 'alpha-asc' });
        await h.loaded();
        assert.deepEqual(h.order(), [2, 3, 1]);
        assertSortColumn(widget, h.doc, 'datetime');
        if (widget === 'salaries') {
          assert.equal(sortedHeader(h.doc).getAttribute('aria-sort'), 'descending');
          assert.equal(headerSortButton(h.doc, 'datetime').textContent.trim(), '↓');
        } else {
          assert.equal(h.doc.getElementById('row-sort-direction').value, 'desc');
          assert.equal(h.doc.getElementById('row-sort-direction').selectedOptions[0].textContent, 'Newest first');
        }
        assert.equal(h.doc.getElementById('sort-select').value, 'alpha-asc', 'row sorting must not change group sorting');
        const group = h.doc.querySelector('.group').dataset.groupLabel;
        assert.equal(group, widget === 'salaries' ? 'September 2026' : 'Sprint 01',
          'grouping must remain independent of row sorting');
        assert.equal(h.sorts().length, 1);
        h.records();
        h.options({ sortMode: 'alpha-asc' });
        await h.loaded();
        assert.equal(h.sorts().length, 1, 'refreshes must not persist the default repeatedly');
      } finally { h.dom.window.close(); }
    });

    await test(`${widget}: options-first startup waits for delayed metadata`, async () => {
      const h = createWidget(widget, { deferMetadata: true });
      try {
        h.options();
        h.records();
        await waitFor(() => h.calls.metadata > 0, 'metadata request');
        assert.equal(h.sorts().length, 0);
        h.releaseMetadata();
        await h.loaded();
        assert.deepEqual(h.order(), [2, 3, 1]);
        assert.equal(h.sorts().length, 1);
      } finally { h.dom.window.close(); }
    });

    await test(`${widget}: empty startup does not save a sort until datetime is available`, async () => {
      const h = createWidget(widget);
      try {
        h.options();
        h.records([]);
        await tick();
        await tick();
        assert.equal(h.sorts().length, 0);
        h.records();
        await h.loaded();
        assert.deepEqual(h.order(), [2, 3, 1]);
        assert.equal(h.sorts().length, 1);
      } finally { h.dom.window.close(); }
    });

    await test(`${widget}: saved row sorts and explicit Grist order win before metadata arrives`, async () => {
      for (const [saved, expected] of [
        [{ column: 'wage', direction: 'asc' }, [3, 2, 1]],
        [{ column: '', direction: 'asc' }, [1, 2, 3]],
        [{ column: 'datetime', direction: 'asc' }, [1, 3, 2]],
      ]) {
        const h = createWidget(widget, { deferMetadata: true });
        try {
          h.records();
          h.options({ rowSort: JSON.stringify(saved) });
          h.releaseMetadata();
          await h.loaded();
          assert.deepEqual(h.order(), expected);
          assert.equal(h.sorts().length, 0, 'must not rewrite an explicit saved preference');
        } finally { h.dom.window.close(); }
      }
    });

    await test(`${widget}: persisted default survives reload, and selecting Grist order stays selected`, async () => {
      const original = createWidget(widget);
      let savedDefault;
      let savedManual;
      try {
        original.options();
        original.records();
        await original.loaded();
        savedDefault = { ...original.sorts()[0] };
        original.clearSort();
        await tick();
        original.records();
        original.options({});
        await original.loaded();
        assert.deepEqual(original.order(), [1, 2, 3]);
        savedManual = { ...original.sorts().at(-1) };
        assert.equal(savedManual.column, '');
        assert.equal(original.sorts().length, 2);
      } finally { original.dom.window.close(); }
      for (const [saved, expected] of [[savedDefault, [2, 3, 1]], [savedManual, [1, 2, 3]]]) {
        const reloaded = createWidget(widget);
        try {
          reloaded.options({ rowSort: saved });
          reloaded.records();
          await reloaded.loaded();
          assert.deepEqual(reloaded.order(), expected);
          assert.equal(reloaded.sorts().length, 0);
        } finally { reloaded.dom.window.close(); }
      }
    });

    await test(`${widget}: datetime matching is exact first, then case-insensitive`, async () => {
      for (const fixture of [{ extraDatetimeColumn: true }, { datetimeColumn: 'DateTime' }]) {
        const h = createWidget(widget, fixture);
        try {
          h.options();
          h.records();
          await h.loaded();
          assertSortColumn(widget, h.doc, fixture.datetimeColumn || 'datetime');
          assert.deepEqual(h.order(), [2, 3, 1]);
        } finally { h.dom.window.close(); }
      }
    });

    await test(`${widget}: tables without datetime keep Grist order without a saved default`, async () => {
      const h = createWidget(widget, { datetimeColumn: 'startsAt' });
      try {
        h.options();
        h.records();
        await h.loaded();
        assert.deepEqual(h.order(), [1, 2, 3]);
        assertSortColumn(widget, h.doc, '');
        assert.equal(h.sorts().length, 0);
      } finally { h.dom.window.close(); }
    });
  }
  await test('salaries: each column has a keyboard-focusable sort button and the row-sort cycle persists', async () => {
    const h = createWidget('salaries');
    try {
      h.options({ sortMode: 'alpha-asc' });
      h.records();
      await h.loaded();
      assert.equal(h.doc.querySelector('#row-sort-select, #row-sort-direction'), null);
      const headers = [...h.doc.querySelectorAll('#column-strip th[data-column]')];
      assert(headers.some(header => header.dataset.column === 'salary_received'));
      for (const header of headers) {
        const button = header.querySelector('button.column-sort-button');
        assert(button, `Missing sort button for ${header.dataset.column}`);
        assert.equal(button.tabIndex, 0);
        assert(button.getAttribute('aria-label'));
        assert.equal(button.textContent.trim(), header.dataset.column === 'datetime' ? '↓' : '↕');
      }
      let saveCount = 1;
      for (const [icon, order, column, direction] of [
        ['↕', [1, 2, 3], '', 'asc'],
        ['↑', [1, 3, 2], 'datetime', 'asc'],
        ['↓', [2, 3, 1], 'datetime', 'desc'],
      ]) {
        const button = headerSortButton(h.doc, 'datetime');
        button.focus();
        assert(button.dispatchEvent(new h.win.KeyboardEvent('keydown',
          { key: 'Enter', bubbles: true, cancelable: true })), 'header intercepted native button activation');
        button.click();
        const refreshedButton = headerSortButton(h.doc, 'datetime');
        assert.equal(h.doc.activeElement, refreshedButton, 'sorting lost header-button focus');
        assert.equal(refreshedButton.textContent.trim(), icon);
        assertSortColumn('salaries', h.doc, column);
        assert.deepEqual(h.order(), order);
        saveCount++;
        await waitFor(() => h.sorts().length === saveCount, `row sort save ${saveCount}`);
        assert.deepEqual({ ...h.sorts().at(-1) }, { column, direction });
      }
      headerSortButton(h.doc, 'wage').click();
      assertSortColumn('salaries', h.doc, 'wage');
      assert.equal(sortedHeader(h.doc).getAttribute('aria-sort'), 'ascending');
      assert.equal(headerSortButton(h.doc, 'datetime').textContent.trim(), '↕');
      assert.deepEqual(h.order(), [3, 2, 1]);
      assert.equal(h.doc.getElementById('sort-select').value, 'alpha-asc');
      assert.equal(h.calls.updates.length, 0);
    } finally { h.dom.window.close(); }
  });
  console.log(`\n${passed} passed, ${failed} failed.`);
  if (failed) process.exitCode = 1;
}
main().catch(error => { console.error(error); process.exitCode = 1; });
