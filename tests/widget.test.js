#!/usr/bin/env node
/*
 * widget.test.js — self-contained jsdom test suite for the grist-sprints
 * grouped-view widget (groups.html + widget-core/app/actions.js).
 *
 * No test framework: plain assertions, PASS/FAIL lines, non-zero exit on
 * failure. Run with:  npm test   (or: node tests/widget.test.js)
 *
 * Important: the widget is built as classic scripts that share the global
 * lexical scope. Top-level `const`/`let` do NOT leak between separate
 * window.eval() calls, so the three sources are concatenated into ONE
 * window.eval() — exactly like three <script> tags sharing a realm.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { JSDOM } = require('jsdom');

const ROOT = path.resolve(__dirname, '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');

// ── Tiny test runner ─────────────────────────────────────────
let passed = 0;
let failed = 0;

function assert(cond, msg) {
  if (!cond) throw new Error(msg || 'assertion failed');
}
function assertEq(actual, expected, msg) {
  if (actual !== expected)
    throw new Error(`${msg || 'values differ'} — expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

async function test(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`PASS ${name}`);
  } catch (err) {
    failed++;
    console.log(`FAIL ${name}: ${err && err.message ? err.message : err}`);
  }
}

const flush = () => new Promise(r => setTimeout(r, 0));
async function waitFor(cond, what) {
  for (let i = 0; i < 100; i++) {
    if (cond()) return;
    await flush();
  }
  throw new Error(`timed out waiting for ${what}`);
}

// Everything runs inside main(): top-level await would make Node treat this
// CommonJS file as an ES module (auto module detection in Node ≥ 20.19).
async function main() {

// ── Syntax check of the widget sources (node --check) ────────
await test('syntax: node --check widget-core.js / widget-app.js / widget-actions.js', async () => {
  for (const f of ['widget-core.js', 'widget-app.js', 'widget-actions.js'])
    execFileSync(process.execPath, ['--check', path.join(ROOT, f)]);
});

// ── Build the DOM and evaluate the widget ────────────────────
const html = read('groups.html');
const dom = new JSDOM(html, {
  url: 'https://arkhivar.github.io/grist-sprints/groups.html',
  runScripts: 'outside-only',     // we evaluate the widget ourselves
  pretendToBeVisual: true,        // provides requestAnimationFrame
});
const win = dom.window;
const doc = win.document;

// Grist API mock — records every mutating call.
const calls = { ready: [], setOption: [], create: [], update: [], destroy: [] };
let onRecordsCb = null;
let onOptionsCb = null;

const RECORDS = [
  { id: 1, date: '2026-07-16T00:00:00.000Z', C: true,  students: 'V..Petrichenko', weekday: 'Thu', count: -1425, performance: 'TR', sprint: 'Sprint 13' },
  { id: 2, date: '2026-07-12T23:45:00.000Z', C: false, students: 'A..Sidorov',     weekday: 'Sun', count: -1425, performance: 'TR', sprint: 'Sprint 13' },
  { id: 3, date: Date.parse('2026-07-12T23:45:00Z') / 1000, C: true, students: 'I..Petrov', weekday: 'Sun', count: 5, performance: 'OK', sprint: 'Sprint 14' },
  { id: 4, date: '2026-07-16T00:00:00.000Z\u200E', C: false, students: 'M..Kuznetsov', weekday: 'Thu', count: 7, performance: 'TR', sprint: 'Sprint 14' }, // trailing LRM
  { id: 5, date: '2026-07-1\u00AD6T00:00:00.000Z', C: true, students: 'S..Orlov', weekday: 'Thu', count: 3, performance: 'TR', sprint: 'Sprint 14' },        // soft hyphen
  { id: 6, date: { toString: () => '2026-07-16T00:00:00.000Z' }, C: false, students: 'P..Volkov', weekday: 'Thu', count: null, performance: 'TR', sprint: 'Sprint 15' }, // object-wrapped ISO
];

win.grist = {
  ready(opts) { calls.ready.push(opts); },
  onRecords(cb) { onRecordsCb = cb; },
  onOptions(cb) { onOptionsCb = cb; },
  setOption(k, v) { calls.setOption.push([k, v]); },
  selectedTable: {
    getTableId: async () => 'Table1',
    create: async (...a) => { calls.create.push(a); return { id: 99 }; },
    update: async (...a) => { calls.update.push(a); },
    destroy: async (...a) => { calls.destroy.push(a); },
  },
  docApi: {
    fetchTable: async name => {
      if (name === '_grist_Tables')
        return { id: [1], tableId: ['Table1'] };
      if (name === '_grist_Tables_column')
        return {
          id: [10, 11, 12, 13, 14, 15, 16],
          colId: ['date', 'C', 'students', 'weekday', 'count', 'performance', 'sprint'],
          parentId: [1, 1, 1, 1, 1, 1, 1],
          type: ['Date', 'Bool', 'Text', 'Text', 'Int', 'Text', 'Text'],
          isFormula: [false, false, false, false, false, false, false],
        };
      throw new Error(`unexpected fetchTable: ${name}`);
    },
  },
  viewApi: {
    fetchSelectedRecord: async id => {
      const rec = RECORDS.find(r => r.id === id);
      return rec ? { ...rec } : null;
    },
  },
};

// ONE eval: the three classic scripts share the global lexical scope.
win.eval(
  read('widget-core.js') + '\n;\n' +
  read('widget-app.js') + '\n;\n' +
  read('widget-actions.js')
);

// ── Helpers against the live DOM ─────────────────────────────
function click(el, mods = {}) {
  assert(el, 'click target missing');
  el.dispatchEvent(new win.MouseEvent('click', { bubbles: true, cancelable: true, ...mods }));
}
function grip(id) {
  const g = doc.querySelector(`.row-grip[data-id="${id}"]`);
  assert(g, `grip for record ${id} not found`);
  return g;
}
function cellEl(rowId, colName) {
  const row = doc.querySelector(`tr[data-record-id="${rowId}"]`);
  assert(row, `row for record ${rowId} not found`);
  const table = row.closest('table');
  const headers = [...table.querySelectorAll('thead th[data-column]')];
  const idx = headers.findIndex(th => th.dataset.column === colName);
  assert(idx >= 0, `column "${colName}" not in table header`);
  return row.querySelectorAll('td')[idx + 1]; // +1: grip cell comes first
}
function cellText(rowId, colName) {
  return cellEl(rowId, colName).textContent;
}

// ── Drive the Grist lifecycle ────────────────────────────────
assert(typeof onRecordsCb === 'function', 'grist.onRecords callback not registered');
assert(typeof onOptionsCb === 'function', 'grist.onOptions callback not registered');
onRecordsCb(RECORDS);
onOptionsCb({}, { accessLevel: 'full' });   // settings arg: only accessLevel is read
assertEq(calls.ready.length, 1, 'grist.ready call count');
assertEq(calls.ready[0] && calls.ready[0].requiredAccess, 'full', 'grist.ready access level');
// Wait until table metadata (getWritableColumnIds) has loaded: the editable
// fields section switches from "Loading…" to real checkboxes once it arrives.
await waitFor(
  () => doc.querySelectorAll('#editable-col-list .editable-col-option').length > 0,
  'table metadata load');

// Group by `sprint` through the toolbar select's change handler.
const groupSelect = doc.getElementById('group-select');
assert([...groupSelect.options].some(o => o.value === 'sprint'),
  '"sprint" option missing from #group-select');
groupSelect.value = 'sprint';
groupSelect.dispatchEvent(new win.Event('change', { bubbles: true }));
await flush();

// ── A. Date rendering ────────────────────────────────────────
await test('A1: object-wrapped ISO value renders as a date in .cell-num', async () => {
  const cell = cellEl(6, 'date');
  const num = cell.querySelector('.cell-num');
  assert(num, 'date cell is not wrapped in .cell-num');
  assertEq(num.textContent, '2026-07-16', 'object-wrapped ISO date');
});

await test('A2: plain ISO strings — midnight stays compact, time is kept', async () => {
  assertEq(cellText(1, 'date'), '2026-07-16', 'midnight ISO');
  assertEq(cellText(2, 'date'), '2026-07-12 23:45', 'ISO with time');
});

await test('A3: ISO strings polluted with invisible chars still format', async () => {
  assertEq(cellText(4, 'date'), '2026-07-16', 'trailing U+200E LRM');
  assertEq(cellText(5, 'date'), '2026-07-16', 'embedded U+00AD soft hyphen');
});

await test('A4: epoch number at non-midnight time in a date-like column formats', async () => {
  assertEq(cellText(3, 'date'), '2026-07-12 23:45', 'epoch seconds');
});

await test('A5: ordinary text and plain numbers are untouched', async () => {
  assertEq(cellText(1, 'performance'), 'TR', 'text value');
  assertEq(cellText(1, 'students'), 'V..Petrichenko', 'name value');
  const countCell = cellEl(1, 'count');
  assert(countCell.querySelector('.cell-num'), 'count cell lacks .cell-num');
  assertEq(countCell.textContent, '-1425', 'plain number (no thousand separator)');
});

// ── B. Selection (grip model) ────────────────────────────────
await test('B6: plain grip click selects one row and clears previous selection', async () => {
  click(grip(1));
  assertEq(grip(1).getAttribute('aria-pressed'), 'true', 'grip 1 pressed');
  click(grip(2));
  assertEq(grip(1).getAttribute('aria-pressed'), 'false', 'grip 1 cleared');
  assertEq(grip(2).getAttribute('aria-pressed'), 'true', 'grip 2 pressed');
});

await test('B7: ctrl-click adds to the selection; #sel-bar shows count 2', async () => {
  click(grip(1), { ctrlKey: true });
  assertEq(grip(1).getAttribute('aria-pressed'), 'true', 'grip 1 pressed');
  assertEq(grip(2).getAttribute('aria-pressed'), 'true', 'grip 2 still pressed');
  const bar = doc.getElementById('sel-bar');
  assert(bar.classList.contains('visible'), '#sel-bar is not visible');
  assertEq(doc.getElementById('sel-count-txt').textContent, '2 selected', 'selection count');
});

await test('B8: Clear button empties the selection and hides the bar', async () => {
  click(doc.getElementById('btn-sel-clear'));
  assert(!doc.getElementById('sel-bar').classList.contains('visible'), '#sel-bar still visible');
  assertEq(grip(1).getAttribute('aria-pressed'), 'false', 'grip 1');
  assertEq(grip(2).getAttribute('aria-pressed'), 'false', 'grip 2');
});

// ── C. Row actions ───────────────────────────────────────────
await test('C9: dup click → selectedTable.create with fields minus id/manualSort', async () => {
  const before = calls.create.length;
  click(doc.querySelector('button[data-act="dup"][data-id="1"]'));
  await waitFor(() => calls.create.length === before + 1, 'selectedTable.create');
  const [arg] = calls.create[calls.create.length - 1];
  const { id, manualSort, ...expected } = RECORDS[0];
  assertEq(JSON.stringify(arg.fields), JSON.stringify(expected), 'duplicate fields');
});

await test('C10: del is a two-step arm → confirm → selectedTable.destroy([id])', async () => {
  const btn = doc.querySelector('button[data-act="del"][data-id="1"]');
  assert(btn, 'delete button missing');
  const before = calls.destroy.length;
  click(btn); // first click arms only
  assert(btn.classList.contains('armed'), 'button did not get .armed');
  assertEq(btn.textContent, '?', 'armed button label');
  assertEq(calls.destroy.length, before, 'destroy fired on first click');
  click(btn); // second click executes
  await waitFor(() => calls.destroy.length === before + 1, 'selectedTable.destroy');
  const [ids] = calls.destroy[calls.destroy.length - 1];
  assertEq(JSON.stringify(ids), JSON.stringify([1]), 'destroy ids');
});

// ── D. Aggregates ────────────────────────────────────────────
await test('D11: group header shows the automatic numeric sum (-2850)', async () => {
  const card = [...doc.querySelectorAll('.group')]
    .find(c => c.dataset.groupLabel === 'Sprint 13');
  assert(card, 'group "Sprint 13" not found');
  const sum = card.querySelector('.group-header .group-sum[data-column="count"]');
  assert(sum, 'no .group-sum for column "count" in the group header');
  assertEq(sum.textContent, '-2850', 'sum of -1425 + -1425');
});

// ── E. Diagnostics ───────────────────────────────────────────
await test('E12: diagnostics lists the date column as date-like: yes', async () => {
  click(doc.getElementById('btn-settings'));
  assert(doc.getElementById('settings-panel').classList.contains('open'),
    'settings panel did not open');
  const rows = [...doc.querySelectorAll('#diag-list .diag-row')];
  const dateRow = rows.find(r => r.textContent.startsWith('date ·'));
  assert(dateRow, 'no diagnostics row for the "date" column');
  assert(dateRow.textContent.includes('date-like: yes'),
    `date column not reported date-like — row: ${dateRow.textContent}`);
});

// ── F. Smoke ─────────────────────────────────────────────────
await test('F13: groups.html loads all three widget scripts', async () => {
  for (const f of ['widget-core.js', 'widget-app.js', 'widget-actions.js'])
    assert(html.includes(`<script src="${f}?`), `groups.html missing script tag for ${f}`);
});

// ── Summary ──────────────────────────────────────────────────
console.log(`===== ${passed} passed, ${failed} failed =====`);
process.exitCode = failed ? 1 : 0;

}

main().catch(err => {
  console.log(`FAIL harness: ${err && err.stack ? err.stack : err}`);
  console.log(`===== ${passed} passed, ${failed + 1} failed =====`);
  process.exitCode = 1;
});
