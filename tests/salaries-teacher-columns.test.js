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
  mode = 'teacher', options = {}, recordsFirst = false, both = false,
  extraClassColumns = {}, scalarSummary = false, teacherLabelColumn = 'A',
  summaryTableId = 'Salary_summary' } = {}) {
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
  if (summaryCol) summary[summaryCol] = scalarSummary ? [7, 8, 9] : [['L', 7], ['L', 8], ['L', 9]];
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
  Object.assign(attendance, extraClassColumns);
  const teacherFields = ['performance', 'per', 't'];
  const teacherLabelRef = teacherLabelColumn === 'name' ? 16 : 21;
  const sourceId = mode === 'teacher' ? 'PERFORMANCE'
    : mode === 'direct' || mode === 'host-summary' ? 'ALL_ATT' : summaryTableId;
  const calls = { writes: [], options: [], fetches: [] };
  const metadata = { id: [], parentId: [], colId: [], type: [], isFormula: [], visibleCol: [] };
  function column(parent, id, colId, type, formula = false, visibleCol = 0) {
    metadata.id.push(id); metadata.parentId.push(parent); metadata.colId.push(colId);
    metadata.type.push(type); metadata.isFormula.push(formula); metadata.visibleCol.push(visibleCol);
  }
  column(2, teacherLabelRef, teacherLabelColumn, 'Text');
  column(3, 31, 'Name', 'Text');
  Object.keys(attendance).filter(col => col !== 'id').forEach((col, index) => {
    const type = teacherFields.includes(col) ? 'RefList:PERFORMANCE'
      : col === 'student' ? 'Ref:FOLKS' : col === 'attach_payment' ? 'Ref:Transactions'
        : col === 'datetime' ? 'DateTime:Asia/Vladivostok'
          : col === 'wage' || col === 'count' ? 'Numeric' : 'Text';
    column(1, 100 + index, col, type, col === 'count',
      teacherFields.includes(col) ? teacherLabelRef : col === 'student' ? 31 : 0);
  });
  Object.keys(summary).filter(col => col !== 'id').forEach((col, index) =>
    column(5, 200 + index, col, col === 'group' ? 'RefList:ALL_ATT'
      : `${scalarSummary ? 'Ref' : 'RefList'}:PERFORMANCE`, true,
    col === 'group' ? 0 : teacherLabelRef));
  Object.keys(transactions).filter(col => col !== 'id').forEach((col, index) =>
    column(4, 300 + index, col, teacherFields.includes(col) ? 'RefList:PERFORMANCE'
      : col === 'datetime' ? 'DateTime:Asia/Vladivostok' : col === 'amount' ? 'Numeric' : 'Text', false,
      teacherFields.includes(col) ? teacherLabelRef : 0));
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
          tableId: ['ALL_ATT', 'PERFORMANCE', 'FOLKS', 'Transactions', summaryTableId] };
        if (name === '_grist_Tables_column') return metadata;
        if (name === 'ALL_ATT') return attendance;
        if (name === 'PERFORMANCE') return { id: [7, 8, 9], [teacherLabelColumn]: ['vp', 'tr', 'zz'] };
        if (name === 'FOLKS') return { id: [41, 42], Name: ['A. Student', 'B. Student'] };
        if (name === summaryTableId) return summary;
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
      visibility: { ...columnVisibility }, editable: [...editableColumns], rowSort: { ...rowSort } });
  `);
  function select(id = 7) {
    if (mode === 'teacher') {
      onRecords([{ id, [teacherLabelColumn]: id === 7 ? 'vp' : id === 8 ? 'tr' : 'zz' }]); return;
    }
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
  return { win, doc, attendance, summary, calls, select, status, order, width, applyOptions,
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

async function migrationCheck(recordsFirst, previous = 'performance', current = 'per') {
  const options = {
    columnOrder: ['datetime', previous, 'student', 'notes', 'wage', 'salary_received', 'count', 'sprint'],
    columnWidths: { [previous]: 112, wage: 96 }, columnVisibility: { [previous]: false },
    editableColumns: JSON.stringify(['notes', previous]), rowSort: { column: previous, direction: 'asc' },
  };
  const h = fixture({ options, recordsFirst, classCol: current, paymentCol: 'performance', summaryCol: current });
  try {
    await waitFor(() => h.status() === '1 payment');
    assert(!h.order().includes(current), 'saved hidden teacher field became visible after rename');
    const saved = plain(h.win.teacherPreferenceState());
    assert.deepEqual(saved.order.slice(0, 8),
      ['datetime', current, 'student', 'notes', 'wage', 'salary_received', 'count', 'sprint']);
    assert.equal(saved.widths[current], 112, 'renamed field lost its saved width');
    assert.equal(saved.visibility[current], false);
    assert.equal(saved.editable.includes(current), true, 'enabled text preference did not migrate');
    assert.equal(saved.editable.includes(previous), false);
    assert.deepEqual(saved.rowSort, { column: current, direction: 'asc' });
    h.applyOptions({ ...options, columnVisibility: { [previous]: true } });
    await waitFor(() => h.order().includes(current));
    assert.equal(h.width(current), '112px');
    assert.equal(h.width('wage'), '96px', 'an unrelated saved width changed');
    assert.deepEqual(h.order().slice(0, 8),
      ['datetime', current, 'student', 'notes', 'wage', 'salary_received', 'count', 'sprint']);
    h.applyOptions({ ...options, columnWidths: { [previous]: 112, [current]: 48 },
      columnVisibility: { [previous]: false, [current]: true } });
    await waitFor(() => h.order().includes(current) && h.width(current) === '48px');
    assert.equal(h.width(current), '48px', 'explicit new-field width lost to the stale alias');
    h.doc.getElementById('btn-reset-columns').click();
    await waitFor(() => h.calls.options.some(([key]) => key === 'columnOrder'));
    assert.equal(h.width(current), '48px');
    assert.deepEqual(h.order().slice(0, 9), ['datetime', current, 'student', 'notes',
      'wage', 'salary_received', 'count', 'sprint', 'attach_payment']);
    assert.equal(h.calls.writes.length, 0, 'layout migration rewrote document records');
    console.log(`PASS Salaries teacher preferences: ${previous} -> ${current}, ${recordsFirst ? 'records' : 'options'} first, order/width/visibility/editing/sort migration`);
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
    { classCol: 't', paymentCol: 'performance', summaryCol: 't', mode: 'teacher' },
    { classCol: 't', paymentCol: 'performance', summaryCol: 't', mode: 'summary' },
    { classCol: 't', paymentCol: 'performance', summaryCol: 't', mode: 'host-summary' },
    { classCol: 't', paymentCol: 'performance', summaryCol: 't', mode: 'direct' },
    { classCol: 't', paymentCol: 'performance', summaryCol: 't', mode: 'summary',
      scalarSummary: true, teacherLabelColumn: 'name', summaryTableId: 'ALL_ATT_summary_t' },
    { classCol: 't', paymentCol: 'performance', summaryCol: 't', mode: 'teacher',
      teacherLabelColumn: 'name' },
  ]) await loadingCheck(config);
  for (const recordsFirst of [false, true]) {
    await migrationCheck(recordsFirst);
    await migrationCheck(recordsFirst, 'performance', 't');
    await migrationCheck(recordsFirst, 'per', 't');
  }

  const explicit = fixture({ classCol: 't', paymentCol: 'performance', summaryCol: 't', options: {
    columnOrder: ['notes', 'per', 'student', 't', 'datetime', 'wage'],
    columnWidths: { per: 112, t: 48 }, columnVisibility: { per: false, t: true },
    editableColumns: ['notes', 'per', 't'], rowSort: { column: 't', direction: 'desc' },
  } });
  try {
    await waitFor(() => explicit.status() === '1 payment');
    const saved = plain(explicit.win.teacherPreferenceState());
    assert.deepEqual(saved.order.slice(0, 5), ['notes', 'student', 't', 'datetime', 'wage'],
      'a stale per slot displaced the explicit t order');
    assert.equal(saved.widths.t, 48);
    assert.equal(saved.visibility.t, true);
    assert.equal(saved.editable.filter(col => col === 't').length, 1);
    assert(!saved.editable.includes('per'));
    assert.deepEqual(saved.rowSort, { column: 't', direction: 'desc' });
    assert.equal(explicit.calls.writes.length, 0);
    console.log('PASS Salaries t preferences: explicit replacement order, width, visibility, editing and sort win');
  } finally { explicit.win.close(); }

  const coexist = fixture({ classCol: 'per', paymentCol: 'performance', summaryCol: 'per',
    extraClassColumns: { t: [['L', 8], ['L', 8], ['L', 8]] }, options: {
      columnOrder: ['datetime', 't', 'student', 'per'],
      columnWidths: { per: 112, t: 72 }, columnVisibility: { per: true, t: false },
      editableColumns: ['notes', 't'], rowSort: { column: 't', direction: 'asc' },
    } });
  try {
    await waitFor(() => coexist.status() === '1 payment');
    const saved = plain(coexist.win.teacherPreferenceState());
    assert.deepEqual(saved.order.slice(0, 4), ['datetime', 't', 'student', 'per']);
    assert.equal(saved.widths.per, 112);
    assert.equal(saved.widths.t, 72);
    assert.equal(saved.visibility.t, false);
    assert(saved.editable.includes('t'));
    assert.deepEqual(saved.rowSort, { column: 't', direction: 'asc' });
    assert.deepEqual(coexist.classIds(), [11, 12], 'the independent t field overrode the existing per teacher field');
    assert(!coexist.order().includes('t'), 'the explicitly hidden independent field became visible');
    assert.equal(coexist.calls.writes.length, 0);
    console.log('PASS Salaries t preferences: coexisting per and t fields keep independent settings and legacy priority');
  } finally { coexist.win.close(); }

  const selection = fixture({ classCol: 't', paymentCol: 'performance', summaryCol: 't', mode: 'summary',
    scalarSummary: true, teacherLabelColumn: 'name', summaryTableId: 'ALL_ATT_summary_t' });
  try {
    await waitFor(() => selection.status() === '1 payment');
    selection.cell('notes').click();
    selection.cell('notes').click();
    const editor = selection.cell('notes').querySelector('textarea');
    assert(editor, 'the notes draft did not open');
    editor.value = 'Unsaved VP note';
    editor.dispatchEvent(new selection.win.Event('input', { bubbles: true }));
    selection.select(7);
    await waitFor(() => selection.status() === '1 payment');
    assert.equal(selection.cell('notes').querySelector('textarea'), editor,
      'an unchanged t selection discarded the draft');
    selection.summary.t[0] = 8;
    selection.select(7);
    await waitFor(() => selection.status() === '2 payments');
    assert.equal(selection.cell('notes').querySelector('textarea'), null,
      'a changed teacher in the same summary row retained the previous teacher draft');
    assert.deepEqual(selection.paymentIds(), [101, 102]);
    assert.equal(selection.calls.writes.length, 0, 'changing teacher selection saved a previous teacher draft');
    console.log('PASS Salaries t selection: same-row teacher changes refresh payments and discard the old draft');
  } finally { selection.win.close(); }

  for (const teacherColumn of ['per', 't']) {
    const paymentOnly = fixture({ classCol: teacherColumn, paymentCol: 'performance', summaryCol: teacherColumn });
    try {
      await waitFor(() => paymentOnly.status() === '1 payment');
      paymentOnly.select(9);
      await waitFor(() => paymentOnly.status() === '1 payment' && paymentOnly.paymentIds()[0] === 103);
      assert.deepEqual(paymentOnly.classIds(), []);
      assert.equal(paymentOnly.width(teacherColumn), '48px');
      assert.equal(paymentOnly.doc.querySelector('.salary-received-sum').textContent, '75');
      assert.equal(paymentOnly.doc.querySelector('.salary-payment-row .cell-ref-pill').textContent, 'zz');
      assert(paymentOnly.doc.querySelector('.group-add-row').disabled);
      console.log(`PASS Salaries teacher rename: payment-only ${teacherColumn} teacher retains dates, labels and compact layout`);
    } finally { paymentOnly.win.close(); }
  }

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
  console.log('27 Salaries teacher-column checks passed.');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
