#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const html = read('sprints.html');
// Follow the actual entry page so adding a shared script cannot silently leave
// this regression suite testing a different widget from the deployed page.
const scripts = [...html.matchAll(/<script\b[^>]*\bsrc="([^"]+)"[^>]*>/g)]
  .map(match => match[1]).filter(src => !/^https?:\/\//.test(src))
  .map(src => src.split('?')[0]);
const tick = () => new Promise(resolve => setTimeout(resolve, 0));
async function waitFor(condition, description = 'widget update') {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (condition()) return;
    await tick();
  }
  throw new Error(`Timed out waiting for ${description}`);
}

const longNote = '❌ [16/07/2026 2:08 PM] A long note with <markup>, commas and\n'
  + 'a second line that must survive opening and saving. '.repeat(30);

async function createWidget(options = {}, recordsFirst = false) {
  const dom = new JSDOM(html, {
    url: 'https://arkhivar.github.io/grist/sprints.html',
    runScripts: 'outside-only', pretendToBeVisual: true,
  });
  const win = dom.window;
  const doc = win.document;
  // jsdom does not download linked stylesheets in this fixture. Include the
  // shared styles so Sprints cannot accidentally rely on Salaries-only CSS.
  const style = doc.createElement('style');
  style.textContent = read('shared/base.css');
  doc.head.appendChild(style);
  const rawRecords = new Map([
    [1, { id: 1, datetime: 1784178000, notes: longNote, students: 21,
      teachers: ['L', 7], formulaText: 'Formula note', formulaRef: 21, sprint: '' }],
    [2, { id: 2, datetime: 1784178000, notes: 'Second note', students: 22,
      teachers: ['L', 8], formulaText: 'Formula note', formulaRef: 22, sprint: '' }],
  ]);
  const displayedRecords = () => [...rawRecords.values()].map(record => ({ ...record,
    students: record.students === 21 ? 'A. Student' : 'B. Student',
    teachers: record.teachers.slice(1).map(id => id === 7 ? 'VP' : 'TR'),
    formulaRef: record.formulaRef === 21 ? 'A. Student' : 'B. Student',
  }));
  const calls = { ready: [], updates: [], raw: [], options: [], fetches: [] };
  let onRecords;
  let onOptions;
  let pendingTargetFetch = null;
  const tableNames = ['All_att', 'Folks', 'Performance'];
  const cols = ['datetime', 'notes', 'students', 'teachers', 'formulaText', 'formulaRef', 'sprint', 'Name', 'Name'];
  win.grist = {
    ready(value) { calls.ready.push(value); },
    onRecords(callback) { onRecords = callback; },
    onOptions(callback) { onOptions = callback; },
    setOption(key, value) { calls.options.push([key, value]); },
    selectedTable: {
      getTableId: async () => 'All_att',
      async update(updates, writeOptions) {
        const rows = Array.isArray(updates) ? updates : [updates];
        rows.forEach(row => {
          calls.updates.push({ id: row.id, fields: row.fields, options: writeOptions });
          Object.assign(rawRecords.get(Number(row.id)), row.fields);
        });
      },
    },
    viewApi: {
      async fetchSelectedRecord(id, fetchOptions) {
        calls.raw.push({ id, options: fetchOptions });
        const record = rawRecords.get(Number(id));
        return { ...record, students: ['R', 'Folks', record.students],
          teachers: ['r', 'Performance', record.teachers.slice(1)] };
      },
    },
    docApi: {
      async fetchTable(name) {
        calls.fetches.push(name);
        if (name === '_grist_Tables') return { id: [1, 2, 3], tableId: tableNames };
        if (name === '_grist_Tables_column') return {
          id: [10, 11, 12, 13, 14, 15, 16, 20, 21], colId: cols,
          parentId: [1, 1, 1, 1, 1, 1, 1, 2, 3],
          type: ['DateTime:Asia/Vladivostok', 'Text', 'Ref:Folks', 'RefList:Performance',
            'Text', 'Ref:Folks', 'Choice', 'Text', 'Text'],
          isFormula: [false, false, false, false, true, true, false, false, false],
          visibleCol: [0, 0, 20, 21, 0, 20, 0, 0, 0],
        };
        if (pendingTargetFetch && pendingTargetFetch.name === name) return pendingTargetFetch.promise;
        if (name === 'Folks') return { id: [21, 22], Name: ['A. Student', 'B. Student'] };
        if (name === 'Performance') return { id: [7, 8], Name: ['VP', 'TR'] };
        throw new Error(`Unexpected table ${name}`);
      },
    },
  };
  win.eval(scripts.map(read).join('\n;\n'));
  const saved = { groupBy: 'sprint', ...options };
  if (recordsFirst) { onRecords(displayedRecords()); onOptions(saved, { accessLevel: 'full' }); }
  else { onOptions(saved, { accessLevel: 'full' }); onRecords(displayedRecords()); }
  await waitFor(() => doc.querySelectorAll('#editable-col-list .editable-col-option').length > 0,
    'Sprints column metadata');
  await tick();
  assert.equal(calls.ready[0].requiredAccess, 'full');
  const cell = (col, id = 1) => {
    const element = doc.querySelector(`[data-cell-id="${id}"][data-cell-col="${col}"]`);
    assert(element, `Missing ${col} cell for ${id}`);
    return element;
  };
  const key = (element, value) => element.dispatchEvent(new win.KeyboardEvent('keydown', {
    bubbles: true, cancelable: true, key: value,
  }));
  const select = (col, id = 1) => { cell(col, id).click(); return cell(col, id); };
  const open = (col, id = 1) => { select(col, id).click(); };
  const refPills = (col, id = 1) => [...cell(col, id).querySelectorAll('.cell-ref-pill')]
    .map(pill => pill.textContent);
  const optionsFor = label => [...doc.querySelectorAll('.salary-ref-option')]
    .find(option => option.textContent.startsWith(label));
  return { dom, win, doc, calls, cell, key, select, open, refPills, optionsFor,
    deferTarget(name) {
      let resolve;
      const promise = new Promise(done => { resolve = done; });
      pendingTargetFetch = { name, promise };
      return value => { pendingTargetFetch = null; resolve(value); };
    },
    switchRecords(ids) { onRecords(displayedRecords().filter(record => ids.includes(record.id))); },
  };
}

let passed = 0;
let failed = 0;
async function test(name, run) {
  try { await run(); passed++; console.log(`PASS ${name}`); }
  catch (error) { failed++; console.error(`FAIL ${name}: ${error.stack}`); }
}

async function main() {
  await test('Sprints notes default supports second click, F2 and typing without truncating saved text', async () => {
    const h = await createWidget();
    try {
      assert(h.cell('notes').querySelector('.cell-edit-btn'), 'notes was not enabled by default');
      const textValue = h.cell('notes').querySelector('.cell-edit-value');
      assert(textValue, 'long editable notes need a clipping wrapper');
      assert.equal(h.win.getComputedStyle(textValue).overflow, 'hidden', 'editable notes can overflow into adjacent cells');
      assert.equal(h.cell('notes').textContent, longNote);
      h.select('notes');
      assert(h.doc.getElementById('cell-editor').hidden, 'first click must only select');
      h.cell('notes').click();
      assert(!h.doc.getElementById('cell-editor').hidden, 'second click did not open notes');
      assert.equal(h.doc.getElementById('cell-editor-text').value, longNote);
      const fullText = `${longNote}\nA complete edited final line.`;
      h.doc.getElementById('cell-editor-text').value = fullText;
      h.doc.getElementById('btn-editor-save').click();
      await waitFor(() => h.calls.updates.length === 1 && h.doc.getElementById('cell-editor').hidden);
      assert.equal(h.calls.updates[0].fields.notes, fullText);
      assert.equal(h.calls.updates[0].options.parseStrings, false);
      h.select('notes'); h.key(h.cell('notes'), 'F2');
      assert.equal(h.doc.getElementById('cell-editor-text').value, fullText);
      h.doc.getElementById('btn-editor-cancel').click();
      h.key(h.cell('notes'), 'Z');
      assert(!h.doc.getElementById('cell-editor').hidden, 'typing did not open notes');
      assert.equal(h.doc.getElementById('cell-editor-text').value, 'Z');
      h.doc.getElementById('btn-editor-save').click();
      await waitFor(() => h.calls.updates.length === 2 && h.doc.getElementById('cell-editor').hidden);
      assert.equal(h.calls.updates[1].fields.notes, 'Z');
    } finally { h.dom.window.close(); }
  });

  await test('Sprints Reference opens from pill and F2, writes raw IDs, and preserves Undo/Redo labels', async () => {
    const h = await createWidget();
    try {
      assert.deepEqual(h.refPills('students'), ['A. Student']);
      h.cell('students').querySelector('.cell-ref-pill').click();
      assert(h.doc.getElementById('salary-ref-editor').hidden, 'first pill click must only select');
      h.cell('students').querySelector('.cell-ref-pill').click();
      await waitFor(() => h.optionsFor('B. Student'), 'student picker');
      assert.equal(h.win.getComputedStyle(h.doc.getElementById('salary-ref-editor')).position, 'fixed',
        'reference picker must have shared viewport popover styles');
      assert(h.calls.raw.length, 'reference editing did not fetch the raw selected record');
      assert.equal(h.calls.raw[0].options.cellFormat, 'typed');
      assert.equal(h.calls.raw[0].options.expandRefs, false);
      h.optionsFor('B. Student').click();
      await waitFor(() => h.calls.updates.length === 1 && h.doc.getElementById('salary-ref-editor').hidden);
      assert.equal(h.calls.updates[0].fields.students, 22);
      assert.equal(h.calls.updates[0].options.parseStrings, false);
      assert.deepEqual(h.refPills('students'), ['B. Student']);
      h.doc.getElementById('btn-undo').click();
      await waitFor(() => h.calls.updates.length === 2 && h.refPills('students')[0] === 'A. Student');
      assert.equal(h.calls.updates[1].fields.students, 21);
      h.doc.getElementById('btn-redo').click();
      await waitFor(() => h.calls.updates.length === 3 && h.refPills('students')[0] === 'B. Student');
      assert.equal(h.calls.updates[2].fields.students, 22);
      h.key(h.cell('students'), 'F2');
      await waitFor(() => h.optionsFor('B. Student'), 'F2 reference picker');
      assert(!h.doc.getElementById('salary-ref-editor').hidden);
    } finally { h.dom.window.close(); }
  });

  await test('Sprints Reference List uses multi-select, typed raw IDs and session Undo/Redo', async () => {
    const h = await createWidget();
    try {
      h.select('teachers'); h.key(h.cell('teachers'), 'F2');
      await waitFor(() => h.optionsFor('TR'), 'teacher list picker');
      assert.equal(h.optionsFor('VP').getAttribute('aria-selected'), 'true');
      assert.equal(h.doc.getElementById('salary-ref-options').getAttribute('aria-multiselectable'), 'true');
      h.optionsFor('TR').click();
      assert.equal(h.calls.updates.length, 0, 'list option prematurely wrote to Grist');
      h.doc.getElementById('salary-ref-save').click();
      await waitFor(() => h.calls.updates.length === 1 && h.doc.getElementById('salary-ref-editor').hidden);
      assert.equal(JSON.stringify(h.calls.updates[0].fields.teachers), JSON.stringify(['L', 7, 8]));
      assert.deepEqual(h.refPills('teachers'), ['VP', 'TR']);
      h.doc.getElementById('btn-undo').click();
      await waitFor(() => h.calls.updates.length === 2 && h.refPills('teachers').length === 1);
      assert.equal(JSON.stringify(h.calls.updates[1].fields.teachers), JSON.stringify(['L', 7]));
      assert.deepEqual(h.refPills('teachers'), ['VP']);
      h.doc.getElementById('btn-redo').click();
      await waitFor(() => h.calls.updates.length === 3 && h.refPills('teachers').length === 2);
      assert.equal(JSON.stringify(h.calls.updates[2].fields.teachers), JSON.stringify(['L', 7, 8]));
    } finally { h.dom.window.close(); }
  });

  await test('Sprints formula Text and Reference fields stay read-only', async () => {
    const h = await createWidget({ editableColumns: ['notes', 'formulaText'] });
    try {
      for (const col of ['formulaText', 'formulaRef']) {
        assert.equal(h.cell(col).dataset.cellWritable, 'false');
        assert.equal(h.cell(col).querySelector('.cell-edit-btn'), null);
        h.open(col); h.key(h.cell(col), 'F2'); h.key(h.cell(col), 'x');
        assert(h.doc.getElementById('cell-editor').hidden);
        assert(h.doc.getElementById('salary-ref-editor').hidden);
      }
      assert.equal(h.calls.updates.length, 0);
    } finally { h.dom.window.close(); }
  });

  await test('Sprints saved text opt-out wins regardless of lifecycle order', async () => {
    for (const recordsFirst of [false, true]) {
      const h = await createWidget({ editableColumns: [] }, recordsFirst);
      try {
        assert.equal(h.cell('notes').querySelector('.cell-edit-btn'), null);
        const textValue = h.cell('notes').querySelector('.cell-display-value');
        assert(textValue, 'disabled notes need the clipping wrapper too');
        assert.equal(h.win.getComputedStyle(textValue).overflow, 'hidden', 'disabled notes can overflow into adjacent cells');
        h.open('notes'); h.key(h.cell('notes'), 'F2');
        assert(h.doc.getElementById('cell-editor').hidden);
        assert(!h.calls.options.some(([key, value]) => key === 'editableColumns' && JSON.parse(value).includes('notes')),
          'default overwrote saved text opt-out');
      } finally { h.dom.window.close(); }
    }
  });

  await test('Sprints obsolete C text preference migrates to notes when C is absent', async () => {
    const h = await createWidget({ editableColumns: ['C'] });
    try {
      assert(h.cell('notes').querySelector('.cell-edit-btn'), 'legacy C preference did not enable notes');
      h.open('notes');
      assert(!h.doc.getElementById('cell-editor').hidden);
    } finally { h.dom.window.close(); }
  });

  await test('Sprints dismissed pending reference load cannot reopen or populate the old picker', async () => {
    const h = await createWidget();
    try {
      const resolve = h.deferTarget('Folks');
      h.open('students');
      assert(!h.doc.getElementById('salary-ref-editor').hidden);
      h.key(h.doc.getElementById('salary-ref-search'), 'Escape');
      assert(h.doc.getElementById('salary-ref-editor').hidden);
      resolve({ id: [21, 22], Name: ['A. Student', 'B. Student'] });
      await tick(); await tick();
      assert(h.doc.getElementById('salary-ref-editor').hidden);
      assert.equal(h.doc.querySelectorAll('.salary-ref-option').length, 0);
      assert.equal(h.calls.updates.length, 0);
    } finally { h.dom.window.close(); }
  });

  await test('Sprints selection change cancels pending reference editing of a removed row', async () => {
    const h = await createWidget();
    try {
      const resolve = h.deferTarget('Folks');
      h.open('students');
      h.switchRecords([2]);
      assert(h.doc.getElementById('salary-ref-editor').hidden, 'removed row retained an active picker');
      resolve({ id: [21, 22], Name: ['A. Student', 'B. Student'] });
      await tick(); await tick();
      assert(h.doc.getElementById('salary-ref-editor').hidden);
      assert.equal(h.doc.querySelectorAll('.salary-ref-option').length, 0);
      h.open('students', 2);
      await waitFor(() => h.optionsFor('B. Student'), 'new row picker');
      assert.equal(h.optionsFor('B. Student').getAttribute('aria-selected'), 'true');
    } finally { h.dom.window.close(); }
  });

  await test('Sprints late reference response cannot replace a newer column picker', async () => {
    const h = await createWidget();
    try {
      const resolve = h.deferTarget('Folks');
      h.open('students');
      h.open('teachers');
      await waitFor(() => h.optionsFor('TR'), 'newer teacher picker');
      resolve({ id: [21, 22], Name: ['A. Student', 'B. Student'] });
      await tick(); await tick();
      assert(!h.doc.getElementById('salary-ref-editor').hidden);
      assert(h.optionsFor('VP') && h.optionsFor('TR'), 'old response replaced new choices');
      assert.equal(h.optionsFor('A. Student'), undefined);
      h.optionsFor('TR').click();
      h.doc.getElementById('salary-ref-save').click();
      await waitFor(() => h.calls.updates.length === 1 && h.doc.getElementById('salary-ref-editor').hidden);
      assert.equal(JSON.stringify(h.calls.updates[0].fields), JSON.stringify({ teachers: ['L', 7, 8] }));
    } finally { h.dom.window.close(); }
  });

  console.log(`\n${passed} Sprints editing checks passed; ${failed} failed.`);
  if (failed) process.exitCode = 1;
}
main().catch(error => { console.error(error); process.exitCode = 1; });
