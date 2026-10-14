#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const plain = value => JSON.parse(JSON.stringify(value));
const tick = () => new Promise(resolve => setTimeout(resolve, 0));
async function waitFor(condition, message = 'Timed out loading renamed teacher columns') {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (condition()) { await tick(); return; }
    await tick();
  }
  throw new Error(message);
}

function fixture({ classCol = 'per', paymentCol = 'per', summaryCol = 'per',
  mode = 'teacher', options = {}, recordsFirst = false, both = false } = {}) {
  const html = read('salaries.html');
  const dom = new JSDOM(html, { url: 'https://arkhivar.github.io/grist/salaries.html',
    runScripts: 'outside-only', pretendToBeVisual: true });
  const win = dom.window;
  const doc = win.document;
  const attendance = {
    id: [11, 12, 13], datetime: [1790812800, 1790899200, 1790985600],
    student: [41, 41, 42], notes: ['Only VP', 'Shared class', 'Only TR'],
    wage: [100, 200, 300], count: [-1000, -2000, -3000],
    sprint: ['Sprint A', 'Sprint A', 'Sprint B'], attach_payment: [101, 101, 102],
  };
  if (classCol) attendance[classCol] = [['L', 7], ['L', 7, 8], ['L', 8]];
  const summary = { id: [91, 92, 93], group: [['L', 11, 12], ['L', 12, 13], ['L']] };
  if (summaryCol) summary[summaryCol] = [['L', 7], ['L', 8], ['L', 9]];
  let transactions = {
    id: [101, 102, 103], datetime: [1790985600, 1790985600, 1790985600],
    amount: [1000, 500, 75], notes: ['Shared teacher payment', 'TR payment', 'Payment before first class'],
  };
  if (paymentCol) transactions[paymentCol] = [
    ['l', ['r', 'PERFORMANCE', [7, 8]]], ['R', 'PERFORMANCE', 8], ['L', 9],
  ];
  if (both) {
    attendance.per = [['L', 8], ['L', 8], ['L', 8]];
    summary.per = [['L', 8], ['L', 8], ['L', 8]];
    transactions.per = [['L', 8], ['L', 7], ['L', 7]];
  }
  const sourceId = mode === 'teacher' ? 'PERFORMANCE'
    : mode === 'direct' || mode === 'host-summary' ? 'ALL_ATT' : 'Salary_summary';
  const calls = { writes: [], options: [], fetches: [] };
  const metadata = { id: [], parentId: [], colId: [], type: [], isFormula: [], visibleCol: [] };
  function column(parent, id, colId, type, formula = false, visibleCol = 0) {
    metadata.id.push(id); metadata.parentId.push(parent); metadata.colId.push(colId);
    metadata.type.push(type); metadata.isFormula.push(formula); metadata.visibleCol.push(visibleCol);
  }
  column(2, 21, 'A', 'Text');
  column(3, 31, 'Name', 'Text');
  Object.keys(attendance).filter(col => col !== 'id').forEach((col, index) => {
    const type = ['performance', 'per'].includes(col) ? 'RefList:PERFORMANCE'
      : col === 'student' ? 'Ref:FOLKS' : col === 'attach_payment' ? 'Ref:Transactions'
        : col === 'datetime' ? 'DateTime:Asia/Vladivostok'
          : col === 'wage' || col === 'count' ? 'Numeric' : 'Text';
    column(1, 100 + index, col, type, col === 'count',
      ['performance', 'per'].includes(col) ? 21 : col === 'student' ? 31 : 0);
  });
  Object.keys(summary).filter(col => col !== 'id').forEach((col, index) =>
    column(5, 200 + index, col, col === 'group' ? 'RefList:ALL_ATT' : 'RefList:PERFORMANCE', true,
      col === 'group' ? 0 : 21));
  Object.keys(transactions).filter(col => col !== 'id').forEach((col, index) =>
    column(4, 300 + index, col, ['performance', 'per'].includes(col) ? 'RefList:PERFORMANCE'
      : col === 'datetime' ? 'DateTime:Asia/Vladivostok' : col === 'amount' ? 'Numeric' : 'Text', false,
      ['performance', 'per'].includes(col) ? 21 : 0));
  let onRecords;
  let onOptions;
  win.grist = {
    ready(value) { assert.equal(value.requiredAccess, 'full'); },
    onRecords(callback) { onRecords = callback; }, onOptions(callback) { onOptions = callback; },
    setOption(key, value) { calls.options.push([key, plain(value)]); },
    selectedTable: { getTableId: async () => sourceId },
    docApi: {
      async fetchTable(name) {
        calls.fetches.push(name);
        if (name === '_grist_Tables') return { id: [1, 2, 3, 4, 5],
          tableId: ['ALL_ATT', 'PERFORMANCE', 'FOLKS', 'Transactions', 'Salary_summary'] };
        if (name === '_grist_Tables_column') return metadata;
        if (name === 'ALL_ATT') return attendance;
        if (name === 'PERFORMANCE') return { id: [7, 8, 9], A: ['vp', 'tr', 'zz'] };
        if (name === 'FOLKS') return { id: [41, 42], Name: ['A. Student', 'B. Student'] };
        if (name === 'Salary_summary') return summary;
        if (name === 'Transactions') {
          if (transactions instanceof Error) throw transactions;
          return transactions;
        }
        throw new Error(`Unexpected fetch: ${name}`);
      },
      async applyUserActions(actions, writeOptions) {
        for (const [kind, table, id, fields] of actions) {
          assert.equal(kind, 'UpdateRecord'); assert.equal(table, 'ALL_ATT');
          const index = attendance.id.indexOf(id);
          assert(index >= 0, 'a selected summary or teacher ID was used as a class ID');
          Object.entries(fields).forEach(([col, value]) => {
            assert(Object.hasOwn(attendance, col), `write used stale field ID ${col}`);
            attendance[col][index] = plain(value);
          });
          calls.writes.push({ table, id, fields: plain(fields), options: plain(writeOptions) });
        }
        return { retValues: [] };
      },
    },
  };
  const scripts = [...html.matchAll(/<script\b[^>]*\bsrc="([^"]+)"/g)]
    .map(match => match[1]).filter(src => !/^https?:/.test(src)).map(src => src.split('?')[0]);
  win.eval(scripts.map(read).join('\n;\n') + `
    window.teacherPreferenceState = () => ({ order: [...columnOrder], widths: { ...columnWidths },
      visibility: { ...columnVisibility }, editable: [...editableColumns] });
  `);
  function select(id = 7) {
    if (mode === 'teacher') { onRecords([{ id, A: id === 7 ? 'vp' : id === 8 ? 'tr' : 'zz' }]); return; }
    if (mode === 'direct') {
      onRecords([{ id: 11, [classCol]: 'vp' }]); return;
    }
    const index = id === 7 ? 0 : id === 8 ? 1 : 2;
    onRecords([Object.fromEntries(Object.entries(summary).map(([col, values]) => [col, values[index]]))]);
  }
  function applyOptions(value) { onOptions(value, { accessLevel: 'full' }); }
  if (recordsFirst) { select(); applyOptions(options); }
  else { applyOptions(options); select(); }
  const status = () => doc.getElementById('salary-payment-status').textContent;
  const order = () => [...doc.querySelectorAll('#column-strip th[data-column]')].map(th => th.dataset.column);
  const width = col => doc.querySelector(`#column-strip col[data-column="${col}"]`)?.style.width;
  return { win, doc, attendance, calls, select, status, order, width, applyOptions,
    classIds: () => [...doc.querySelectorAll('tr[data-record-id]')].map(row => Number(row.dataset.recordId)).sort((a, b) => a - b),
    paymentIds: () => [...doc.querySelectorAll('.salary-payment-row')].map(row => Number(row.dataset.expenseId)).sort((a, b) => a - b),
    cell: (col, id = 11) => doc.querySelector(`[data-cell-id="${id}"][data-cell-col="${col}"]`),
    refreshPayments(value) { transactions = value; doc.getElementById('btn-refresh-payments').click(); },
  };
}

async function loadingCheck(config) {
  const h = fixture(config);
  try {
    await waitFor(() => h.status() === '1 payment', JSON.stringify(config));
    assert.deepEqual(h.classIds(), config.mode === 'direct' ? [11] : [11, 12]);
    assert.deepEqual(h.paymentIds(), [101]);
    const teacherColumn = config.classCol || 'per';
    const orderedFields = config.both ? h.order().filter(col => col !== 'per') : h.order();
    assert.deepEqual(orderedFields.slice(0, 9), ['datetime', teacherColumn, 'student', 'notes',
      'wage', 'salary_received', 'count', 'sprint', 'attach_payment']);
    assert.equal(h.doc.querySelector(`#column-strip th[data-column="${teacherColumn}"] .column-name`).textContent, 'per');
    assert.equal(h.width(teacherColumn), '48px');
    for (const col of ['wage', 'salary_received', 'count']) assert.equal(h.width(col), '64px');
    assert.deepEqual([...h.doc.querySelectorAll('.salary-payment-row .cell-ref-pill')].map(pill => pill.textContent), ['vp', 'tr'],
      'the payment did not display its own complete raw-ID teacher list');
    assert.equal(h.doc.querySelector('.salary-received-sum').textContent, '1000');
    const cell = h.cell(teacherColumn);
    assert.deepEqual([...cell.querySelectorAll('.cell-ref-pill')].map(pill => pill.textContent), ['vp']);
    cell.click();
    const paste = new h.win.Event('paste', { bubbles: true, cancelable: true });
    Object.defineProperty(paste, 'clipboardData', { value: { getData: type => type === 'text/plain' ? '#8' : '' } });
    cell.dispatchEvent(paste);
    await waitFor(() => h.calls.writes.length === 1);
    assert.deepEqual(h.calls.writes[0], { table: 'ALL_ATT', id: 11,
      fields: { [teacherColumn]: ['L', 8] }, options: { parseStrings: false } });
    assert(!h.doc.querySelector('.salary-payment-row [data-cell-writable="true"]'));
    console.log(`PASS Salaries teacher fields: ${JSON.stringify(config)}`);
  } finally { h.win.close(); }
}

async function migrationCheck(recordsFirst) {
  const options = {
    columnOrder: ['datetime', 'performance', 'student', 'notes', 'wage', 'salary_received', 'count', 'sprint'],
    columnWidths: { performance: 112, wage: 96 }, columnVisibility: { performance: false },
    editableColumns: JSON.stringify(['notes', 'performance']),
  };
  const h = fixture({ options, recordsFirst });
  try {
    await waitFor(() => h.status() === '1 payment');
    assert(!h.order().includes('per'), 'saved hidden teacher field became visible after rename');
    const saved = plain(h.win.teacherPreferenceState());
    assert.deepEqual(saved.order.slice(0, 8),
      ['datetime', 'per', 'student', 'notes', 'wage', 'salary_received', 'count', 'sprint']);
    assert.equal(saved.widths.per, 112, 'renamed field lost its saved width');
    assert.equal(saved.visibility.per, false);
    assert.equal(saved.editable.includes('per'), true, 'enabled text preference did not migrate');
    assert.equal(saved.editable.includes('performance'), false);
    h.applyOptions({ ...options, columnVisibility: { performance: true } });
    await waitFor(() => h.order().includes('per'));
    assert.equal(h.width('per'), '112px');
    assert.equal(h.width('wage'), '96px', 'an unrelated saved width changed');
    assert.deepEqual(h.order().slice(0, 8),
      ['datetime', 'per', 'student', 'notes', 'wage', 'salary_received', 'count', 'sprint']);
    h.applyOptions({ ...options, columnWidths: { performance: 112, per: 48 },
      columnVisibility: { performance: false, per: true } });
    await waitFor(() => h.order().includes('per') && h.width('per') === '48px');
    assert.equal(h.width('per'), '48px', 'explicit new-field width lost to the stale alias');
    h.doc.getElementById('btn-reset-columns').click();
    await waitFor(() => h.calls.options.some(([key]) => key === 'columnOrder'));
    assert.equal(h.width('per'), '48px');
    assert.deepEqual(h.order().slice(0, 9), ['datetime', 'per', 'student', 'notes',
      'wage', 'salary_received', 'count', 'sprint', 'attach_payment']);
    assert.equal(h.calls.writes.length, 0, 'layout migration rewrote document records');
    console.log(`PASS Salaries teacher preferences: ${recordsFirst ? 'records' : 'options'} first, order/width/visibility/editing migration`);
  } finally { h.win.close(); }
}

async function main() {
  for (const config of [
    { classCol: 'per', paymentCol: 'performance', summaryCol: 'performance', mode: 'teacher' },
    { classCol: 'performance', paymentCol: 'per', summaryCol: 'per', mode: 'summary' },
    { classCol: 'per', paymentCol: 'per', summaryCol: 'performance', mode: 'summary' },
    { classCol: 'per', paymentCol: 'performance', summaryCol: 'per', mode: 'host-summary' },
    { classCol: 'performance', paymentCol: 'performance', summaryCol: 'performance', mode: 'teacher' },
    { classCol: 'per', paymentCol: 'per', summaryCol: 'per', mode: 'direct' },
    { classCol: 'performance', paymentCol: 'performance', summaryCol: 'performance', mode: 'summary', both: true },
  ]) await loadingCheck(config);
  for (const recordsFirst of [false, true]) await migrationCheck(recordsFirst);

  const paymentOnly = fixture();
  try {
    await waitFor(() => paymentOnly.status() === '1 payment');
    paymentOnly.select(9);
    await waitFor(() => paymentOnly.status() === '1 payment' && paymentOnly.paymentIds()[0] === 103);
    assert.deepEqual(paymentOnly.classIds(), []);
    assert.equal(paymentOnly.width('per'), '48px');
    assert.equal(paymentOnly.doc.querySelector('.salary-received-sum').textContent, '75');
    assert.equal(paymentOnly.doc.querySelector('.salary-payment-row .cell-ref-pill').textContent, 'zz');
    assert(paymentOnly.doc.querySelector('.group-add-row').disabled);
    console.log('PASS Salaries teacher rename: payment-only teacher retains dates, labels and compact layout');
  } finally { paymentOnly.win.close(); }

  const failed = fixture();
  try {
    await waitFor(() => failed.status() === '1 payment');
    failed.refreshPayments(new Error('Transactions read rejected by access rules'));
    await waitFor(() => failed.status().includes('Transactions read rejected by access rules'));
    assert(failed.status().startsWith('Payments unavailable:'), 'failed ledger read appeared as zero payments');
    assert.equal(failed.doc.querySelector('.salary-received-sum').textContent, '—');
    assert.deepEqual(failed.paymentIds(), []);
    console.log('PASS Salaries teacher rename: real failed-fetch error remains visible');
  } finally { failed.win.close(); }

  for (const config of [{ classCol: null }, { paymentCol: null }]) {
    const h = fixture(config);
    try {
      await waitFor(() => /unavailable:/i.test(h.status()));
      assert(/performance|\bper\b/i.test(h.status()), 'missing teacher field has no actionable column hint');
      assert(!/^0 payments$/.test(h.status()), 'missing teacher column silently became zero payments');
      assert.equal(h.calls.writes.length, 0);
      console.log(`PASS Salaries teacher rename: missing ${config.classCol === null ? 'class' : 'payment'} teacher column reports an error`);
    } finally { h.win.close(); }
  }
  console.log('13 Salaries teacher-column checks passed.');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
