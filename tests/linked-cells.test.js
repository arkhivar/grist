#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const tick = () => new Promise(resolve => setTimeout(resolve, 0));
async function waitFor(condition) {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (condition()) { await tick(); return; }
    await tick();
  }
  throw new Error('Timed out waiting for linked cells');
}
const plain = value => JSON.parse(JSON.stringify(value));

async function fixture(widget) {
  const html = read(`${widget}.html`);
  const dom = new JSDOM(html, { url: `https://arkhivar.github.io/grist/${widget}.html`,
    runScripts: 'outside-only', pretendToBeVisual: true });
  const win = dom.window;
  const doc = win.document;
  const attendance = {
    id: [11, 12, 13], datetime: [1791162679, 1790915077, 1790812800],
    students: [41, 42, 41], group3: [['L', 33, 34], null, ['L', 35]],
    formulaRef: [21, 18, 21], performance: [['L', 21], ['L', 21, 18], ['L', 21, 18]],
    sprint: ['Sprint A', 'Sprint A', 'Sprint A'], notes: ['First', 'Second', 'Third'], wage: [600, 600, 600],
  };
  const teachers = { id: [21, 18, 33, 34, 35, 36], A: ['vp', 'cl', 'indie', 'North, <Team>', 'Duplicate', 'Duplicate'] };
  let transactions = {
    id: [2125, 2118, 999, 998], performance: [['L', 21], ['L', 21], ['L', 18], ['L']],
    datetime: [1791162679, 1790915077, 1791162679, 1791162679],
    amount: [3000, 22500, 100, 50], op_type: ['transfer_out', 'transfer_out', 'expense', 'income'],
  };
  const summaries = { id: [91, 92], group: [['L', 11, 12, 13], ['L', 12, 13]], performance: [['L', 21], ['L', 18]] };
  const selected = () => widget === 'salaries'
    ? [{ id: 91, group: summaries.group[0], performance: 'vp' }]
    : attendance.id.map((id, index) => Object.fromEntries(Object.entries(attendance).map(([col, values]) =>
      [col, col === 'students' ? (values[index] === 41 ? 'A. Student' : 'B. Student')
        : ['group3', 'performance'].includes(col) ? (values[index] || []).slice(1)
          .map(refId => teachers.A[teachers.id.indexOf(refId)])
          : col === 'formulaRef' ? teachers.A[teachers.id.indexOf(values[index])] : values[index]])));
  const calls = { writes: [], fetches: [] };
  let onRecords;
  let onOptions;
  let deferredTarget = null;
  let nextError = null;
  function write(updates, options) {
    if (nextError) { const error = nextError; nextError = null; throw error; }
    for (const { id, fields } of Array.isArray(updates) ? updates : [updates]) {
      calls.writes.push({ id, fields: plain(fields), options: plain(options) });
      const index = attendance.id.indexOf(id);
      assert(index >= 0, 'write targeted a summary or payment row');
      for (const [col, value] of Object.entries(fields)) attendance[col][index] = plain(value);
    }
  }
  win.grist = {
    ready(options) { assert.equal(options.requiredAccess, 'full'); },
    onOptions(callback) { onOptions = callback; }, onRecords(callback) { onRecords = callback; }, setOption() {},
    selectedTable: { getTableId: async () => widget === 'salaries' ? 'Salary_summary' : 'ALL_ATT',
      update: async (updates, options) => write(updates, options) },
    viewApi: { fetchSelectedRecord: async id => {
      const index = attendance.id.indexOf(id);
      return Object.fromEntries(Object.entries(attendance).map(([col, values]) => [col,
        col === 'students' ? ['R', 'FOLKS', values[index]]
          : ['group3', 'performance'].includes(col) ? ['r', 'PERFORMANCE', (values[index] || []).slice(1)]
            : values[index]]));
    } },
    docApi: {
      async applyUserActions(actions, options) {
        for (const [kind, table, id, fields] of actions) {
          assert.equal(kind, 'UpdateRecord'); assert.equal(table, 'ALL_ATT'); write({ id, fields }, options);
        }
        return { retValues: [] };
      },
      async fetchTable(name) {
        calls.fetches.push(name);
        if (deferredTarget?.name === name) return deferredTarget.promise;
        if (name === '_grist_Tables') return { id: [1, 2, 3, 4, 5],
          tableId: ['ALL_ATT', 'PERFORMANCE', 'FOLKS', 'Transactions', 'Salary_summary'] };
        if (name === '_grist_Tables_column') return {
          id: [10, 11, 12, 13, 14, 15, 16, 17, 18, 20, 30, 40],
          parentId: [1, 1, 1, 1, 1, 1, 1, 1, 1, 2, 3, 4],
          colId: ['datetime', 'students', 'group3', 'formulaRef', 'performance', 'sprint', 'notes', 'wage', 'manualSort', 'A', 'Name', 'performance'],
          type: ['DateTime:Asia/Vladivostok', 'Ref:FOLKS', 'RefList:PERFORMANCE', 'Ref:PERFORMANCE',
            'RefList:PERFORMANCE', 'Choice', 'Text', 'Numeric', 'Numeric', 'Text', 'Text', 'RefList:PERFORMANCE'],
          isFormula: [false, false, false, true, false, false, false, false, false, false, false, false],
          visibleCol: [0, 30, 20, 20, 20, 0, 0, 0, 0, 0, 0, 20],
        };
        if (name === 'ALL_ATT') return attendance;
        if (name === 'PERFORMANCE') return teachers;
        if (name === 'FOLKS') return { id: [41, 42], Name: ['A. Student', 'B. Student'] };
        if (name === 'Salary_summary') return summaries;
        if (name === 'Transactions') return transactions;
        throw new Error(`Unexpected read: ${name}`);
      },
    },
  };
  const scripts = [...html.matchAll(/<script\b[^>]*\bsrc="([^"]+)"/g)]
    .map(match => match[1]).filter(src => !/^https?:/.test(src)).map(src => src.split('?')[0]);
  win.eval(scripts.map(read).join('\n;\n') + `
    window.fillTestCells = (col, id, targets) => {
      activeFillDrag = { recordId: String(id), col,
        targetCells: targets.map(target => findDataCell(String(target), col)) };
      return finishCellFill(true);
    };
  `);
  onOptions({ groupBy: widget === 'salaries' ? 'datetime::month' : 'sprint',
    columnOrder: ['datetime', 'students', 'group3', 'formulaRef', 'performance', 'sprint', 'notes', 'wage'] },
  { accessLevel: 'full' });
  onRecords(selected());
  const cell = (col, id = 11) => doc.querySelector(`[data-cell-id="${id}"][data-cell-col="${col}"]`);
  await waitFor(() => cell('group3')?.dataset.cellWritable === 'true');
  if (widget === 'salaries') await waitFor(() => doc.getElementById('salary-payment-status').textContent === '2 payments');
  function clipboard(action, col, id, data) {
    if (!cell(col, id).classList.contains('cell-selected')) cell(col, id).click();
    const event = new win.Event(action, { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'clipboardData', { value: {
      getData: type => data[type] || '', setData: (type, value) => { data[type] = value; },
    } });
    cell(col, id).dispatchEvent(event);
    return data;
  }
  return { win, doc, calls, cell, attendance, teachers,
    pills: (col, id = 11) => [...cell(col, id).querySelectorAll('.cell-ref-pill')].map(pill => pill.textContent),
    copy: (col, id = 11) => clipboard('copy', col, id, {}),
    paste: (col, text, id = 12) => clipboard('paste', col, id, typeof text === 'string' ? { 'text/plain': text } : text),
    refresh: () => onRecords(selected()),
    refreshPayments(value) { transactions = value; doc.getElementById('btn-refresh-payments').click(); },
    selectBothTeachers() { onRecords(summaries.id.map((id, index) => ({ id,
      group: summaries.group[index], performance: index ? 'cl' : 'vp' }))); },
    deferTarget(name) {
      let resolve;
      deferredTarget = { name, promise: new Promise(done => { resolve = done; }) };
      return () => { deferredTarget = null; resolve(name === 'PERFORMANCE' ? teachers : { id: [41, 42], Name: ['A. Student', 'B. Student'] }); };
    },
    failWrite() { nextError = new Error('Document write rejected by access rules'); },
  };
}

async function clipboardChecks(widget) {
  const h = await fixture(widget);
  try {
    const { doc, win, attendance, calls } = h;
    const copied = h.copy('group3');
    assert(copied['text/plain'].includes('North, <Team>'));
    h.paste('group3', copied);
    await waitFor(() => calls.writes.length === 1 && !doc.getElementById('btn-undo').disabled);
    assert.deepEqual(calls.writes[0], { id: 12, fields: { group3: ['L', 33, 34] }, options: { parseStrings: false } });
    assert.deepEqual(h.pills('group3', 12), ['indie', 'North, <Team>']);
    doc.getElementById('btn-undo').click();
    await waitFor(() => (attendance.group3[1] == null || attendance.group3[1].length === 1)
      && !doc.getElementById('btn-redo').disabled);
    doc.getElementById('btn-redo').click();
    await waitFor(() => attendance.group3[1]?.length === 3 && !doc.getElementById('btn-undo').disabled);
    const unchanged = calls.writes.length;
    h.paste('group3', copied);
    await tick(); await tick();
    assert.equal(calls.writes.length, unchanged, 'unchanged links produced a new write');

    h.paste('group3', 'North, <Team>');
    await waitFor(() => attendance.group3[1]?.length === 2 && attendance.group3[1][1] === 34);
    assert.deepEqual(h.pills('group3', 12), ['North, <Team>'], 'a comma inside one name split the record');
    h.paste('group3', '["indie","North, <Team>"]');
    await waitFor(() => attendance.group3[1]?.length === 3);
    h.paste('group3', 'indie, "North, <Team>"');
    await waitFor(() => attendance.group3[1]?.length === 3);
    h.paste('students', 'A. Student');
    await waitFor(() => attendance.students[1] === 41 && !doc.getElementById('btn-undo').disabled);
    doc.getElementById('btn-undo').click();
    await waitFor(() => attendance.students[1] === 42 && !doc.getElementById('btn-redo').disabled);
    assert.deepEqual(h.pills('students', 12), ['B. Student'], 'Undo restored a display label instead of the raw ID');

    const beforeBlocked = calls.writes.length;
    for (const [col, text, error] of [
      ['formulaRef', 'vp', 'read-only'], ['group3', 'Missing', 'not found'],
      ['group3', 'Duplicate', 'Multiple linked records'],
      ['group3', h.copy('students'), 'links to FOLKS'],
    ]) {
      h.paste(col, text);
      await waitFor(() => doc.getElementById('toast').textContent.includes(error));
      assert.equal(calls.writes.length, beforeBlocked, 'invalid linked paste wrote data');
    }
    h.paste('group3', '#35');
    await waitFor(() => attendance.group3[1]?.[1] === 35);
    assert.deepEqual(h.pills('group3', 12), ['Duplicate']);
    const beforeRange = calls.writes.length;
    h.paste('group3', 'indie\tvp');
    await waitFor(() => doc.getElementById('toast').textContent.includes('formulaRef'));
    assert.equal(calls.writes.length, beforeRange, 'mixed writable/formula range was partially written');

    const beforeLinkedRange = calls.writes.length;
    const beforeRangeReads = calls.fetches.filter(name => name === 'ALL_ATT').length;
    h.paste('group3', 'indie\nvp', 11);
    await waitFor(() => calls.writes.length === beforeLinkedRange + 2 && !doc.getElementById('btn-undo').disabled);
    assert.deepEqual(plain(attendance.group3.slice(0, 2)), [['L', 33], ['L', 21]]);
    if (widget === 'salaries') assert.equal(calls.fetches.filter(name => name === 'ALL_ATT').length - beforeRangeReads, 1,
      'linked range paste re-read Attendance for every cell');
    doc.getElementById('btn-undo').click();
    await waitFor(() => attendance.group3[0]?.length === 3 && !doc.getElementById('btn-redo').disabled);
    assert.deepEqual(plain(attendance.group3.slice(0, 2)), [['L', 33, 34], ['L', 35]], 'range Undo did not restore raw link lists');

    // Fill uses raw IDs even for duplicate visible names; geometry is supplied by the fixture.
    await win.fillTestCells('group3', 13, [11, 12]);
    assert.deepEqual(plain(attendance.group3[0]), ['L', 35]);
    assert.deepEqual(plain(attendance.group3[1]), ['L', 35]);
    doc.getElementById('btn-undo').click();
    await waitFor(() => attendance.group3[0]?.length === 3 && !doc.getElementById('btn-redo').disabled);
    assert.deepEqual(plain(attendance.group3[1]), ['L', 35]);

    h.failWrite();
    h.paste('group3', 'indie');
    await waitFor(() => doc.getElementById('toast').textContent.includes('Document write rejected by access rules'));
    assert.deepEqual(plain(attendance.group3[1]), ['L', 35]);
    const beforeStale = calls.writes.length;
    const release = h.deferTarget('PERFORMANCE');
    h.paste('group3', 'indie');
    h.cell('notes').click();
    release();
    await tick(); await tick();
    assert.equal(calls.writes.length, beforeStale, 'a stale linked paste changed the old target');
    console.log(`PASS ${widget}: linked copy/paste, comma-safe lists, raw-ID Undo/Redo, fill, formula protection, errors, stale selection`);
  } finally { h.win.close(); }
}

async function ledgerChecks() {
  const h = await fixture('salaries');
  try {
    const status = () => h.doc.getElementById('salary-payment-status').textContent;
    const received = () => h.doc.querySelector('.salary-received-sum').textContent;
    const ids = () => [...h.doc.querySelectorAll('.salary-payment-row')].map(row => Number(row.dataset.expenseId));
    assert.deepEqual(ids(), [2125, 2118]);
    assert.equal(received(), '25,500', 'the two circled transfer_out rows must count as received');
    assert(!h.doc.querySelector('.salary-payment-row [data-cell-writable="true"]'), 'payment cells became writable');
    assert.deepEqual([...h.doc.querySelectorAll('.salary-payment-row .cell-ref-pill')].map(pill => pill.textContent), ['vp', 'vp']);
    const transactions = { id: [2125, 2118], performance: [['l', ['r', 'PERFORMANCE', [21, 18]]], ['R', 'PERFORMANCE', 21]],
      datetime: [1791162679, 1790915077], amount: [3000, 22500], op_type: ['transfer_out', 'income'] };
    h.refreshPayments(transactions);
    await waitFor(() => status() === '2 payments');
    assert.equal(received(), '25,500', 'typed references or operation labels changed payment matching');
    assert.deepEqual([...h.doc.querySelector('[data-expense-id="2125"] .cell-ref-list').children]
      .map(pill => pill.textContent), ['vp', 'cl'], 'payment must display its own full teacher list');
    h.selectBothTeachers();
    await waitFor(() => status() === '2 payments');
    assert.deepEqual(ids(), [2125, 2118], 'shared teacher references duplicated a payment row');
    assert.equal(received(), '25,500', 'a transaction was counted once per selected teacher');
    h.refreshPayments({ ...transactions, performance: [21, 18] });
    await waitFor(() => status() === '2 payments');
    assert.equal(received(), '25,500', 'legacy Int teacher IDs no longer match');
    assert.equal(h.calls.writes.length, 0, 'ledger reads modified the document');
    console.log('PASS salaries: current PERFORMANCE RefList ledger, transfer_out, typed and scalar IDs, multi-teacher deduplication');
  } finally { h.win.close(); }
}

async function main() {
  for (const widget of ['sprints', 'salaries']) await clipboardChecks(widget);
  await ledgerChecks();
  console.log('3 linked-cell regression scenarios passed.');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
