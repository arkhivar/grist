#!/usr/bin/env node
'use strict';

// Payroll registries organize the same editable classes and read-only payments.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const plain = value => JSON.parse(JSON.stringify(value));
const sec = value => Date.parse(value) / 1000;
const tick = () => new Promise(resolve => setTimeout(resolve, 0));
async function waitFor(condition, label = 'payroll period view') {
  for (let attempt = 0; attempt < 150; attempt++) {
    if (condition()) { await tick(); return; }
    await tick();
  }
  throw new Error(`Timed out waiting for ${label}`);
}

function fixture({ view = 'calendar', paymentOnly = false, deferWeeks = false,
  weekFailure = false, wrongMonthType = false, formulaMonth = false,
  commonStudent = false, savedCollapsed } = {}) {
  const html = read('salaries.html');
  const dom = new JSDOM(html, { url: 'https://arkhivar.github.io/grist/salaries.html',
    runScripts: 'outside-only', pretendToBeVisual: true });
  const win = dom.window;
  const doc = win.document;
  const attendance = {
    id: [11, 12, 13],
    start: ['2026-09-27T23:00:00Z', '2026-10-04T14:30:00Z', '2026-06-29T15:00:00Z'].map(sec),
    end: ['2026-09-28T00:00:00Z', '2026-10-04T15:30:00Z', '2026-06-29T16:00:00Z'].map(sec),
    t: [['L', 7], ['L', 7], ['L', 7]],
    notes: ['Office hours', 'Next Monday in VLAT', 'June office hours'],
    wage: [100, -25, 200], count: [-1000, -250, -2000], sprint: ['Office', 'Office', 'Office'],
  };
  if (commonStudent) attendance.student = [41, 41, 41];
  const transactions = {
    id: [1001, 1002, 1003, 1004, 1005, 1006, 1007],
    per: [['L', 7], ['L', 7], ['L', 7], ['L', 7], ['L', 7], ['L', 7], ['L', 8]],
    datetime: ['2026-07-09T01:00:00Z', '2026-07-10T01:00:00Z', '2026-10-08T01:00:00Z',
      '2026-07-12T01:00:00Z', '2026-08-01T01:00:00Z', '2026-10-08T02:00:00Z',
      '2026-07-05T01:00:00Z'].map(sec),
    amount: [300, 50, 100, 40, 5, 6, 75],
    notes: ['June week paid in July', 'June monthly bonus', 'October week',
      'Week has no assigned month', 'No period', 'Conflicting period links', 'Payment before any office hours'],
    forWeek: [101, 0, 102, 104, 0, 102, 0],
    forMonth: [0, 201, 0, 0, 0, 201, 201],
  };
  const weeks = {
    id: [101, 102, 103, 104],
    weekStart: ['2026-06-29', '2026-09-28', '2026-10-05', '2026-07-06'].map(sec),
    weekEnd: ['2026-07-06', '2026-10-05', '2026-10-12', '2026-07-13'].map(sec),
    forMonth: [201, 204, 204, 0],
    isoKey: ['2026-W27', '2026-W40', '2026-W41', '2026-W28'],
    label: ['June week', 'Cross-month week', 'October week', 'Unassigned week'],
  };
  const months = {
    id: [201, 202, 203, 204],
    monthStart: ['2026-06-01', '2026-07-01', '2026-09-01', '2026-10-01'].map(sec),
    monthEnd: ['2026-07-01', '2026-08-01', '2026-10-01', '2026-11-01'].map(sec),
  };
  const tables = { id: [1, 2, 3, 4, 5, 6],
    tableId: ['ALL_ATT', 'PERFORMANCE', 'Transactions', 'WeekRegistry', 'MonthRegistry', 'FOLKS'] };
  const metadata = { id: [], parentId: [], colId: [], type: [], isFormula: [], visibleCol: [] };
  function column(parent, col, type, formula = false, visibleCol = 0) {
    metadata.id.push(100 + metadata.id.length); metadata.parentId.push(parent);
    metadata.colId.push(col); metadata.type.push(type); metadata.isFormula.push(formula);
    metadata.visibleCol.push(visibleCol);
  }
  column(2, 'name', 'Text');
  const teacherLabelRef = metadata.id[0];
  column(6, 'Name', 'Text');
  const studentLabelRef = metadata.id[1];
  Object.keys(attendance).filter(col => col !== 'id').forEach(col =>
    column(1, col, ['start', 'end'].includes(col) ? 'DateTime:Asia/Vladivostok'
      : col === 't' ? 'RefList:PERFORMANCE' : col === 'student' ? 'Ref:FOLKS'
        : ['wage', 'count'].includes(col) ? 'Numeric' : 'Text',
    col === 'count', col === 't' ? teacherLabelRef : col === 'student' ? studentLabelRef : 0));
  Object.keys(transactions).filter(col => col !== 'id').forEach(col =>
    column(3, col, col === 'per' ? 'RefList:PERFORMANCE' : col === 'datetime' ? 'DateTime:Asia/Vladivostok'
      : col === 'amount' ? 'Numeric' : col === 'forWeek' ? 'Ref:WeekRegistry'
        : col === 'forMonth' ? 'Ref:MonthRegistry' : 'Text', false, col === 'per' ? teacherLabelRef : 0));
  Object.keys(weeks).filter(col => col !== 'id').forEach(col =>
    column(4, col, ['weekStart', 'weekEnd'].includes(col) ? 'Date'
      : col === 'forMonth' ? wrongMonthType ? 'Text' : 'Ref:MonthRegistry' : 'Text',
    col === 'forMonth' && formulaMonth));
  Object.keys(months).filter(col => col !== 'id').forEach(col => column(5, col, 'Date'));

  const calls = { fetches: [], writes: [], creates: [], options: [] };
  let writeFailure = null;
  let onRecords;
  let onOptions;
  let releaseWeeks;
  const weekGate = deferWeeks ? new Promise(resolve => { releaseWeeks = resolve; }) : null;
  win.grist = {
    ready(value) { assert.equal(value.requiredAccess, 'full'); },
    onRecords(callback) { onRecords = callback; }, onOptions(callback) { onOptions = callback; },
    setOption(key, value) { calls.options.push([key, plain(value)]); },
    selectedTable: { getTableId: async () => 'PERFORMANCE' },
    docApi: {
      async fetchTable(name) {
        calls.fetches.push(name);
        if (name === '_grist_Tables') return tables;
        if (name === '_grist_Tables_column') return metadata;
        if (name === 'ALL_ATT') return attendance;
        if (name === 'PERFORMANCE') return { id: [7, 8], name: ['me', 'zz'] };
        if (name === 'FOLKS') return { id: [41], Name: ['Common student'] };
        if (name === 'Transactions') return transactions;
        if (name === 'WeekRegistry') {
          if (weekGate) await weekGate;
          if (weekFailure) throw new Error('Registry read denied by document rule');
          return weeks;
        }
        if (name === 'MonthRegistry') return months;
        throw new Error(`Unexpected table ${name}`);
      },
      async applyUserActions(actions, options) {
        assert.equal(options?.parseStrings, false);
        if (writeFailure) throw writeFailure;
        const retValues = [];
        for (const [kind, table, id, fields] of actions) {
          if (kind === 'AddRecord') {
            assert.equal(table, 'ALL_ATT');
            const createdId = id || Math.max(...attendance.id) + 1;
            Object.entries(attendance).forEach(([col, values]) =>
              values.push(col === 'id' ? createdId : plain(fields[col] ?? null)));
            calls.creates.push({ table, id: createdId, fields: plain(fields), options: plain(options) });
            retValues.push(createdId);
            continue;
          }
          assert.equal(kind, 'UpdateRecord');
          const source = table === 'ALL_ATT' ? attendance : table === 'WeekRegistry' ? weeks : null;
          assert(source, `unexpected write target ${table}`);
          const index = source.id.indexOf(id);
          assert(index >= 0, `write used a teacher ID instead of a ${table} row`);
          for (const [col, value] of Object.entries(fields)) source[col][index] = plain(value);
          calls.writes.push({ table, id, fields: plain(fields), options: plain(options) });
          retValues.push(null);
        }
        return { retValues };
      },
    },
  };
  const scripts = [...html.matchAll(/<script\b[^>]*\bsrc="([^"]+)"/g)]
    .map(match => match[1]).filter(src => !/^https?:/.test(src)).map(src => src.split('?')[0]);
  win.eval(scripts.map(read).join('\n;\n') + `
    window.payrollVisibleTestRows = () => visibleCellRows().map(row => row[0].dataset.cellId);
    window.payrollWriteTestCell = (id, col, value) => writeCellValues('Edit', [id], col, value);
    window.payrollRangeTestState = () => ({ selected: selectedCell, rangeEnd: cellRangeEnd });
  `);
  function select(id = paymentOnly ? 8 : 7) { onRecords([{ id, name: id === 7 ? 'me' : 'zz' }]); }
  onOptions({ salaryPeriodView: view,
    ...(savedCollapsed === undefined ? {} : { salaryPeriodCollapsed: savedCollapsed }) },
  { accessLevel: 'full' });
  select();
  const leaf = key => [...doc.querySelectorAll('.group[data-group-key]')]
    .find(card => decodeURIComponent(card.dataset.groupKey) === key);
  const parent = key => [...doc.querySelectorAll('.salary-month[data-group-key]')]
    .find(card => decodeURIComponent(card.dataset.groupKey) === key);
  function expand(card) {
    assert(card, 'expected payroll group is absent');
    if (card.classList.contains('collapsed')) card.querySelector('.group-header').click();
  }
  function expandAll() {
    for (const selector of ['.salary-month.collapsed', '.group.collapsed']) {
      for (let attempt = 0; doc.querySelector(selector) && attempt < 30; attempt++)
        expand(doc.querySelector(selector));
      assert(!doc.querySelector(selector), 'expanding periods left an inaccessible group');
    }
  }
  function changeView(value) {
    const control = doc.getElementById('salary-view-select');
    assert(control, 'payroll view control was not added');
    control.value = value;
    control.dispatchEvent(new win.Event('change', { bubbles: true }));
  }
  return { win, doc, attendance, transactions, weeks, months, metadata, calls, select,
    leaf, parent, expand, expandAll, changeView,
    releaseWeeks() { releaseWeeks?.(); },
    failWrites(message) { writeFailure = message ? new Error(message) : null; },
    status: () => doc.getElementById('salary-payment-status').textContent,
    classIds: () => [...doc.querySelectorAll('tr[data-record-id]')].map(row => Number(row.dataset.recordId)).sort((a, b) => a - b),
    paymentIds: () => [...doc.querySelectorAll('.salary-payment-row')].map(row => Number(row.dataset.expenseId)).sort((a, b) => a - b),
    async loaded() {
      await waitFor(() => doc.querySelector('#column-strip th[data-column="start"]')
        && doc.getElementById('salary-payment-status').textContent.includes(paymentOnly ? '1 payment' : '6 payments'),
      'teacher-linked classes and payments');
      if (view === 'payroll') await waitFor(() => doc.querySelector('.salary-month'), 'payroll registry grouping');
    },
    async assign(weekId, monthId) {
      const button = doc.querySelector(`.salary-week-month[data-week-id="${weekId}"]`);
      assert(button, `week ${weekId} has no month assignment button`);
      button.click();
      await waitFor(() => !doc.getElementById('salary-month-picker').hidden, 'month assignment popover');
      const choice = monthId ? doc.querySelector(`#salary-month-options button[data-month-id="${monthId}"]`)
        : doc.getElementById('salary-month-clear');
      assert(choice, `month ${monthId} is absent from assignment choices`);
      choice.click();
    },
  };
}

let passed = 0;
let failed = 0;
async function test(name, config, check) {
  const h = fixture(config);
  try { await check(h); passed++; console.log(`PASS Salaries payroll: ${name}`); }
  catch (error) { failed++; console.error(`FAIL Salaries payroll: ${name}\n${error.stack || error}`); }
  finally { h.win.close(); }
}

async function main() {
  await test('calendar view makes no registry requests and changing view persists', {}, async h => {
    await h.loaded();
    assert.equal(h.doc.getElementById('salary-view-select').value, 'calendar');
    assert.equal(h.calls.fetches.filter(name => /Registry$/.test(name)).length, 0);
    assert(!h.doc.querySelector('.salary-month'));
    h.changeView('payroll');
    await waitFor(() => h.parent('payroll-month:201'));
    assert(h.calls.options.some(([key, value]) => key === 'salaryPeriodView' && value === 'payroll'));
    assert.equal(h.calls.fetches.filter(name => name === 'WeekRegistry').length, 1);
    assert.equal(h.calls.fetches.filter(name => name === 'MonthRegistry').length, 1);
    h.changeView('calendar');
    await waitFor(() => !h.doc.querySelector('.salary-month'));
    assert.deepEqual(h.classIds(), [11, 12, 13]);
    assert.deepEqual(h.paymentIds(), [1001, 1002, 1003, 1004, 1005, 1006]);
    h.changeView('payroll');
    await waitFor(() => h.parent('payroll-month:201'));
    assert.equal(h.calls.fetches.filter(name => /Registry$/.test(name)).length, 2,
      'changing view repeatedly reloaded registry tables');
  });

  await test('manual month owns crossing weeks; bonus uses assigned month; totals count each row once',
    { view: 'payroll' }, async h => {
      await h.loaded();
      const june = h.parent('payroll-month:201');
      const october = h.parent('payroll-month:204');
      const unassigned = h.parent('payroll-unassigned');
      assert(june && october && unassigned);
      assert.equal(h.leaf('payroll-week:101').closest('.salary-month'), june);
      assert.equal(h.leaf('payroll-week:102').closest('.salary-month'), october,
        'a crossing week used its September start instead of its manual October parent');
      assert.equal(h.leaf('payroll-week:104').closest('.salary-month'), unassigned,
        'an unassigned week silently used its July date as a parent');
      assert(h.leaf('payroll-review').closest('.salary-month') === unassigned);
      const monthly = [...june.querySelectorAll('.group')]
        .find(card => card.dataset.groupLabel === 'Monthly items');
      assert(monthly, 'monthly bonus was not kept separate from weekly items');
      assert.equal(june.querySelector('.group-sum[data-column="salary_received"]').textContent, '350');
      assert.equal(june.querySelector('.group-sum[data-column="wage"]').textContent, '200');
      assert.equal(october.querySelector('.group-sum[data-column="wage"]').textContent, '75');
      assert.equal(october.querySelector('.group-sum[data-column="count"]').textContent, '-1250');
      assert.equal(unassigned.querySelector('.group-sum[data-column="salary_received"]').textContent, '51');
      assert.equal(h.doc.querySelectorAll('tr[data-record-id]').length, 0,
        'collapsed payroll weeks rendered every class row eagerly');
      h.expandAll();
      assert.deepEqual(h.classIds(), [11, 12, 13]);
      assert.deepEqual(h.paymentIds(), [1001, 1002, 1003, 1004, 1005, 1006]);
      assert.deepEqual([...h.leaf('payroll-week:103').querySelectorAll('tr[data-record-id]')]
        .map(row => Number(row.dataset.recordId)), [12], 'VLAT Monday was assigned to the previous week');
      assert(h.leaf('payroll-week:101').querySelector('[data-expense-id="1001"] .salary-payment-date')
        .textContent.includes('2026-07-09'), 'grouping period overwrote the real cash date');
      const visibleMonthly = [...h.parent('payroll-month:201').querySelectorAll('.group')]
        .find(card => card.dataset.groupLabel === 'Monthly items');
      assert(visibleMonthly.querySelector('[data-expense-id="1002"]'), 'June bonus paid in July moved to July');
      assert(h.leaf('payroll-review').querySelector('[data-expense-id="1006"]'),
        'conflicting week/month links were silently resolved');
    });

  await test('payment-only teacher works; cached registry reads survive teacher changes', { view: 'payroll', paymentOnly: true },
    async h => {
      await h.loaded();
      h.expandAll();
      assert.deepEqual(h.classIds(), []);
      assert.deepEqual(h.paymentIds(), [1007]);
      assert.equal(h.parent('payroll-month:201').querySelector('.group-sum[data-column="salary_received"]').textContent, '75');
      h.select(7);
      await waitFor(() => h.status() === '6 payments');
      h.expandAll();
      assert.deepEqual(h.classIds(), [11, 12, 13]);
      assert.equal(h.calls.fetches.filter(name => name === 'WeekRegistry').length, 1);
      assert.equal(h.calls.fetches.filter(name => name === 'MonthRegistry').length, 1);
    });

  await test('month assignment uses registry IDs; Undo/Redo preserve shared global assignment', { view: 'payroll' },
    async h => {
      await h.loaded();
      await h.assign(102, 203);
      await waitFor(() => h.calls.writes.length === 1 && h.parent('payroll-month:203'));
      assert.deepEqual(h.calls.writes[0], { table: 'WeekRegistry', id: 102,
        fields: { forMonth: 203 }, options: { parseStrings: false } });
      assert.equal(h.leaf('payroll-week:102').closest('.salary-month'), h.parent('payroll-month:203'));
      h.doc.getElementById('btn-undo').click();
      await waitFor(() => h.calls.writes.length === 2);
      assert.deepEqual(h.calls.writes[1].fields, { forMonth: 204 });
      h.doc.getElementById('btn-redo').click();
      await waitFor(() => h.calls.writes.length === 3);
      assert.deepEqual(h.calls.writes[2].fields, { forMonth: 203 });
      await h.assign(102, 0);
      await waitFor(() => h.calls.writes.length === 4);
      assert.deepEqual(h.calls.writes[3].fields, { forMonth: 0 });
      assert.equal(h.leaf('payroll-week:102').closest('.salary-month'), h.parent('payroll-unassigned'));
      assert(h.calls.writes.every(write => write.table === 'WeekRegistry'), 'registry Undo targeted Attendance');
      assert(h.calls.fetches.filter(name => name === 'WeekRegistry').length >= 4,
        'month assignment did not freshly read its original registry value');
    });

  await test('failed registry write surfaces real error and leaves week in its original month', { view: 'payroll' },
    async h => {
      await h.loaded();
      h.failWrites('Week assignment denied by document rule');
      await h.assign(102, 203);
      await waitFor(() => [h.doc.getElementById('toast'), h.doc.getElementById('salary-month-status')]
        .some(node => node?.textContent.includes('Week assignment denied by document rule')));
      assert.equal(h.calls.writes.length, 0);
      assert.equal(h.leaf('payroll-week:102').closest('.salary-month'), h.parent('payroll-month:204'));
    });

  await test('pending month assignment is cancelled when the linked teacher changes', { view: 'payroll' },
    async h => {
      await h.loaded();
      const fetchTable = h.win.grist.docApi.fetchTable;
      let releaseRead;
      let deferOneRead = true;
      h.win.grist.docApi.fetchTable = name => {
        if (name === 'WeekRegistry' && deferOneRead) {
          deferOneRead = false;
          return new Promise(resolve => { releaseRead = () => resolve(h.weeks); });
        }
        return fetchTable(name);
      };
      await h.assign(102, 203);
      await waitFor(() => releaseRead);
      h.select(8);
      releaseRead();
      await waitFor(() => h.status() === '1 payment');
      await tick(); await tick();
      assert.equal(h.calls.writes.length, 0, 'a previous teacher\'s pending month assignment was applied');
      assert.equal(h.weeks.forMonth[h.weeks.id.indexOf(102)], 204);
    });

  await test('Undo checks a fresh registry value before replacing another user\'s assignment',
    { view: 'payroll' }, async h => {
      await h.loaded();
      await h.assign(102, 203);
      await waitFor(() => h.calls.writes.length === 1);
      h.weeks.forMonth[h.weeks.id.indexOf(102)] = 201;
      h.doc.getElementById('btn-undo').click();
      await waitFor(() => h.doc.getElementById('toast').textContent.includes('changed outside this edit'));
      assert.equal(h.calls.writes.length, 1, 'Undo overwrote a newer shared month assignment');
      assert.equal(h.weeks.forMonth[h.weeks.id.indexOf(102)], 201);
    });

  await test('existing class editor writes original Attendance IDs and payment grips remain selectors',
    { view: 'payroll' }, async h => {
      await h.loaded();
      h.expandAll();
      const cell = h.doc.querySelector('[data-cell-id="11"][data-cell-col="notes"]');
      cell.click(); cell.click();
      const input = h.doc.getElementById('cell-editor-text');
      assert.equal(input.closest('td'), cell);
      input.value = 'Edited office hours';
      input.dispatchEvent(new h.win.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
      await waitFor(() => h.calls.writes.some(write => write.table === 'ALL_ATT'));
      assert.deepEqual(h.calls.writes.find(write => write.table === 'ALL_ATT'), { table: 'ALL_ATT', id: 11,
        fields: { notes: 'Edited office hours' }, options: { parseStrings: false } });
      h.expandAll();
      const grip = h.doc.querySelector('.salary-expense-grip[data-expense-id="1001"]');
      assert.equal(grip.draggable, false);
      grip.click();
      assert.equal(grip.getAttribute('aria-pressed'), 'true');
      grip.click();
      assert.equal(grip.getAttribute('aria-pressed'), 'false');
      assert(!h.doc.querySelector('.salary-payment-row [data-cell-writable="true"]'));
    });

  await test('a collapsed month removes descendant cells from range and clipboard navigation',
    { view: 'payroll' }, async h => {
      await h.loaded();
      h.expandAll();
      assert.deepEqual(plain(h.win.payrollVisibleTestRows()).sort(), ['11', '12', '13']);
      const june = h.parent('payroll-month:201');
      june.querySelector('.group-header').click();
      await waitFor(() => h.parent('payroll-month:201').classList.contains('collapsed'));
      assert.deepEqual(plain(h.win.payrollVisibleTestRows()).sort(), ['11', '12'],
        'hidden June rows remained eligible for Shift/range paste');
    });

  await test('editing start reveals a collapsed destination week and month through Undo/Redo',
    { view: 'payroll' }, async h => {
      await h.loaded();
      h.expandAll();
      h.leaf('payroll-week:101').querySelector('.group-header').click();
      h.parent('payroll-month:201').querySelector('.group-header').click();
      const startCell = id => h.doc.querySelector(`[data-cell-id="${id}"][data-cell-col="start"]`);
      startCell(11).click();
      startCell(12).dispatchEvent(new h.win.MouseEvent('click', { shiftKey: true, bubbles: true }));
      assert(h.win.payrollRangeTestState().rangeEnd, 'the pre-edit cell range was not established');
      const original = h.attendance.start[0];
      const destination = h.attendance.start[2];
      await h.win.payrollWriteTestCell(11, 'start', destination);
      await waitFor(() => h.leaf('payroll-week:101')?.querySelector('tr[data-record-id="11"]'),
        'edited work row in its revealed destination week');
      assert(!h.parent('payroll-month:201').classList.contains('collapsed'));
      assert(!h.leaf('payroll-week:101').classList.contains('collapsed'));
      assert.equal(h.win.payrollRangeTestState().rangeEnd, null, 'the moved row retained a stale range');
      assert.deepEqual(plain(h.win.payrollRangeTestState().selected), { recordId: '11', col: 'start' });

      h.leaf('payroll-week:102').querySelector('.group-header').click();
      h.parent('payroll-month:204').querySelector('.group-header').click();
      h.doc.getElementById('btn-undo').click();
      await waitFor(() => h.calls.writes.length === 2
        && h.leaf('payroll-week:102')?.querySelector('tr[data-record-id="11"]'), 'Undo revealing the original work period');
      assert(!h.parent('payroll-month:204').classList.contains('collapsed'));
      assert(!h.leaf('payroll-week:102').classList.contains('collapsed'));

      h.leaf('payroll-week:101').querySelector('.group-header').click();
      h.parent('payroll-month:201').querySelector('.group-header').click();
      h.doc.getElementById('btn-redo').click();
      await waitFor(() => h.calls.writes.length === 3
        && h.leaf('payroll-week:101')?.querySelector('tr[data-record-id="11"]'), 'Redo revealing the edited work period');
      assert(!h.parent('payroll-month:201').classList.contains('collapsed'));
      assert(!h.leaf('payroll-week:101').classList.contains('collapsed'));
      assert.deepEqual(h.calls.writes.map(write => ({ table: write.table, id: write.id, fields: write.fields })),
        [destination, original, destination].map(start => ({ table: 'ALL_ATT', id: 11, fields: { start } })));
    });

  await test('week footer creates an Attendance work record with start, raw teacher and common student',
    { view: 'payroll', commonStudent: true }, async h => {
      await h.loaded();
      h.expandAll();
      const add = h.leaf('payroll-week:102').querySelector('.group-add-row');
      assert.equal(add.disabled, false, 'an existing work week has no usable Add record control');
      add.click();
      await waitFor(() => h.calls.creates.length === 1, 'new work record');
      assert.deepEqual(h.calls.creates[0], { table: 'ALL_ATT', id: 14,
        fields: { start: h.attendance.start[0], t: ['L', 7], student: 41 },
        options: { parseStrings: false } });
      // Grist publishes the linked source again after AddRecord completes.
      h.select(7);
      await waitFor(() => h.doc.querySelector('tr[data-record-id="14"]'), 'verified new Attendance row');
      assert(h.leaf('payroll-week:102').querySelector('tr[data-record-id="14"]'),
        'the new work record did not stay in its payroll week');
      assert.equal(h.calls.writes.length, 0, 'adding a work record rewrote a registry or payment');
    });

  await test('saved month and week collapse settings survive a fresh widget instance', { view: 'payroll' },
    async h => {
      await h.loaded();
      h.expandAll();
      h.leaf('payroll-week:102').querySelector('.group-header').click();
      h.parent('payroll-month:201').querySelector('.group-header').click();
      await waitFor(() => h.calls.options.some(([key, value]) => key === 'salaryPeriodCollapsed'
        && JSON.parse(value).includes('payroll-month:201') && JSON.parse(value).includes('payroll-week:102')));
      const saved = h.calls.options.filter(([key]) => key === 'salaryPeriodCollapsed').at(-1)[1];
      const reloaded = fixture({ view: 'payroll', savedCollapsed: saved });
      try {
        await reloaded.loaded();
        assert(reloaded.parent('payroll-month:201').classList.contains('collapsed'));
        assert(reloaded.leaf('payroll-week:102').classList.contains('collapsed'));
        assert(!reloaded.leaf('payroll-week:103').classList.contains('collapsed'),
          'an explicitly saved expanded week returned to its initial collapsed state');
        assert.deepEqual(reloaded.classIds(), [12]);
      } finally { reloaded.win.close(); }
    });

  await test('slow registry load cannot restore a previous teacher', { view: 'payroll', deferWeeks: true }, async h => {
    await waitFor(() => h.calls.fetches.includes('WeekRegistry'));
    h.select(8);
    h.releaseWeeks();
    await waitFor(() => h.status() === '1 payment' && h.parent('payroll-month:201'));
    h.expandAll();
    assert.deepEqual(h.classIds(), []);
    assert.deepEqual(h.paymentIds(), [1007]);
    assert.equal(h.calls.fetches.filter(name => name === 'WeekRegistry').length, 1);
  });

  await test('registry failures remain actionable and calendar view can still be used',
    { view: 'payroll', weekFailure: true }, async h => {
      await waitFor(() => h.doc.body.textContent.includes('Registry read denied by document rule'));
      assert(!h.doc.querySelector('.salary-month'), 'failed registry read made fake calendar period groups');
      assert(h.calls.fetches.includes('MonthRegistry'), 'a failed sibling skipped the remaining registry read');
      h.changeView('calendar');
      await waitFor(() => h.classIds().length === 3 && h.paymentIds().length === 6);
    });

  for (const config of [{ wrongMonthType: true }, { formulaMonth: true }]) {
    await test(`unsafe registry assignment metadata is rejected: ${Object.keys(config)[0]}`,
      { view: 'payroll', ...config }, async h => {
        await waitFor(() => /WeekRegistry.*forMonth|forMonth.*WeekRegistry/s.test(h.doc.body.textContent));
        assert.equal(h.calls.writes.length, 0);
        assert(!h.doc.querySelector('.salary-week-month:not(:disabled)'),
          'an unsupported registry field remained writable');
      });
  }

  console.log(`Salaries payroll periods: ${passed} passed; ${failed} failed`);
  if (failed) process.exitCode = 1;
}

main().catch(error => { console.error(error); process.exitCode = 1; });
