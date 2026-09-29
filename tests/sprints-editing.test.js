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

async function createWidget(options = {}, recordsFirst = false, fixture = {}) {
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
  if (fixture.sprintValues) {
    const templates = [...rawRecords.values()];
    rawRecords.clear();
    fixture.sprintValues.forEach((sprint, index) => {
      const id = index + 1;
      rawRecords.set(id, { ...templates[index % templates.length], id, sprint });
    });
  }
  const displayedRecords = () => [...rawRecords.values()].map(record => ({ ...record,
    students: record.students === 21 ? 'A. Student' : 'B. Student',
    teachers: record.teachers.slice(1).map(id => id === 7 ? 'VP' : 'TR'),
    formulaRef: record.formulaRef === 21 ? 'A. Student' : 'B. Student',
  }));
  const calls = { ready: [], updates: [], actions: [], raw: [], options: [], fetches: [], scrolled: [] };
  win.HTMLElement.prototype.scrollIntoView = function (options) {
    calls.scrolled.push({ recordId: this.dataset.cellId, col: this.dataset.cellCol, options });
  };
  let onRecords;
  let onOptions;
  let pendingTargetFetch = null;
  let pendingWrite = null;
  let nextWriteError = null;
  function checkWriteError() {
    if (!nextWriteError) return;
    const error = nextWriteError;
    nextWriteError = null;
    throw error;
  }
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
        if (pendingWrite) {
          const write = pendingWrite;
          pendingWrite = null;
          await write;
        }
        checkWriteError();
        const rows = Array.isArray(updates) ? updates : [updates];
        rows.forEach(row => {
          calls.updates.push({ id: row.id, fields: row.fields, options: writeOptions });
          Object.assign(rawRecords.get(Number(row.id)), row.fields);
        });
        if (fixture.emitRecordsDuringWrite) onRecords(displayedRecords());
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
      async applyUserActions(actions, writeOptions) {
        checkWriteError();
        calls.actions.push({ actions, options: writeOptions });
        actions.forEach(([action, table, id, fields]) => {
          assert.equal(action, 'UpdateRecord');
          assert.equal(table, 'All_att');
          Object.assign(rawRecords.get(Number(id)), fields);
        });
        if (fixture.emitRecordsDuringWrite) onRecords(displayedRecords());
        return actions.map(() => null);
      },
      async fetchTable(name) {
        calls.fetches.push(name);
        if (name === '_grist_Tables') return { id: [1, 2, 3], tableId: tableNames };
        if (name === '_grist_Tables_column') return {
          id: [10, 11, 12, 13, 14, 15, 16, 20, 21], colId: cols,
          parentId: [1, 1, 1, 1, 1, 1, 1, 2, 3],
          type: ['DateTime:Asia/Vladivostok', 'Text', 'Ref:Folks', 'RefList:Performance',
            'Text', 'Ref:Folks', fixture.sprintType || 'Choice', 'Text', 'Text'],
          isFormula: [false, false, false, false, true, true, Boolean(fixture.sprintFormula), false, false],
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
  const key = (element, value, modifiers = {}) => element.dispatchEvent(new win.KeyboardEvent('keydown', {
    bubbles: true, cancelable: true, key: value, ...modifiers,
  }));
  const select = (col, id = 1) => { cell(col, id).click(); return cell(col, id); };
  const open = (col, id = 1) => { select(col, id).click(); };
  const refPills = (col, id = 1) => [...cell(col, id).querySelectorAll('.cell-ref-pill')]
    .map(pill => pill.textContent);
  const optionsFor = label => [...doc.querySelectorAll('.salary-ref-option')]
    .find(option => option.textContent.startsWith(label));
  return { dom, win, doc, calls, cell, key, select, open, refPills, optionsFor,
    group(value) {
      const key = value == null || value === '' ? '\x00__empty__' : value;
      return [...doc.querySelectorAll('.group')].find(card => card.dataset.groupKey === key);
    },
    failNextWrite(message) { nextWriteError = new Error(message); },
    deferWrite() {
      let reject;
      pendingWrite = new Promise((resolve, fail) => { reject = fail; });
      return message => reject(new Error(message));
    },
    paste(col, text, id = 1) {
      const event = new win.Event('paste', { bubbles: true, cancelable: true });
      Object.defineProperty(event, 'clipboardData', {
        value: { getData: type => type === 'text/plain' ? text : '' },
      });
      cell(col, id).dispatchEvent(event);
    },
    deferTarget(name) {
      let resolve;
      const promise = new Promise(done => { resolve = done; });
      pendingTargetFetch = { name, promise };
      return value => { pendingTargetFetch = null; resolve(value); };
    },
    refreshOptions(value) { onOptions(value, { accessLevel: 'full' }); },
    switchRecords(ids) { onRecords(displayedRecords().filter(record => ids.includes(record.id))); },
  };
}

let passed = 0;
let failed = 0;
async function test(name, run) {
  try { await run(); passed++; console.log(`PASS ${name}`); }
  catch (error) { failed++; console.error(`FAIL ${name}: ${error.stack}`); }
}

async function saveSprint(h, value, id = 1) {
  h.select('sprint', id);
  h.key(h.cell('sprint', id), 'F2');
  const input = assertInlineText(h, 'sprint', id);
  input.value = value;
  const before = h.calls.updates.length;
  h.key(input, 'Enter');
  await waitFor(() => h.calls.updates.length === before + 1
    && !h.doc.querySelector('td.cell-inline-editing'), 'saved Sprint edit');
  assert.equal(h.calls.updates[before].fields.sprint, value);
  assert.equal(h.calls.updates[before].options.parseStrings, false);
}

function assertInlineText(h, col, id = 1) {
  const input = h.doc.getElementById('cell-editor-text');
  assert.equal(input.closest('td'), h.cell(col, id), `${col} editor must be inside its cell`);
  assert(h.cell(col, id).classList.contains('cell-inline-editing'), `${col} has no inline editing state`);
  assert.equal(input.hidden, false);
  assert(h.doc.getElementById('cell-editor').hidden, 'text editing opened a popover');
  assert.equal(h.doc.activeElement, input, 'in-cell editor must take keyboard input immediately');
  return input;
}

function assertGroupCount(h, value, count) {
  const group = h.group(value);
  assert(group, `Missing group ${value}`);
  assert.equal(group.querySelectorAll('tbody tr[data-record-id]').length, count);
  assert.equal(group.querySelector('.group-badge').textContent, String(count));
}

async function main() {
  await test('Sprints grouping column starts visible for saved and automatic grouping in either startup order', async () => {
    for (const recordsFirst of [false, true]) {
      for (const automatic of [false, true]) {
        const h = await createWidget(automatic ? { groupBy: null } : {}, recordsFirst,
          { sprintValues: ['Sprint 1', 'Sprint 2'] });
        try {
          assert.equal(h.doc.getElementById('group-select').value, 'sprint');
          assert(h.doc.querySelector('#column-strip th[data-column="sprint"]'),
            'grouped Sprint header must be visible by default');
          assert.equal(h.cell('sprint').textContent, 'Sprint 1');
          h.doc.getElementById('btn-columns').click();
          assert(h.doc.querySelector('.column-control-row[data-column="sprint"] .column-control-toggle').checked,
            'default-visible Sprint must be checked in the column control');
          h.doc.getElementById('btn-columns').click();
          h.select('sprint');
          assert(h.doc.getElementById('cell-editor-text').hidden, 'first click must only select');
          h.cell('sprint').click();
          assert.equal(assertInlineText(h, 'sprint').value, 'Sprint 1');
        } finally { h.dom.window.close(); }
      }
    }
  });

  await test('Sprints explicit hidden and visible grouping choices survive widget reloads and refreshes', async () => {
    let saved = {};
    for (const visible of [false, true]) {
      const h = await createWidget({ columnVisibility: saved }, !visible);
      try {
        h.doc.getElementById('btn-columns').click();
        const toggle = h.doc.querySelector('.column-control-row[data-column="sprint"] .column-control-toggle');
        assert.equal(toggle.checked, !visible, 'reload lost the previous grouping visibility');
        toggle.click();
        await waitFor(() => h.calls.options.some(([key]) => key === 'columnVisibility'),
          'saved Sprint visibility');
        saved = JSON.parse(JSON.stringify(h.calls.options.find(([key]) => key === 'columnVisibility')[1]));
        assert.equal(saved.sprint, visible, 'explicit Sprint visibility was not saved');
      } finally { h.dom.window.close(); }

      const restored = await createWidget({ columnVisibility: saved }, visible);
      try {
        const shown = () => Boolean(restored.doc.querySelector('#column-strip th[data-column="sprint"]'));
        assert.equal(shown(), visible, 'fresh widget did not restore saved Sprint visibility');
        restored.refreshOptions({ sortMode: 'alpha-asc' });
        restored.switchRecords([1, 2]);
        await tick();
        assert.equal(shown(), visible, 'unrelated options or record refresh reset Sprint visibility');
        assert.equal(Boolean(restored.doc.querySelector('[data-cell-col="sprint"]')), visible,
          'Sprint row cells disagree with header visibility');
      } finally { restored.dom.window.close(); }
    }
  });

  await test('Sprints resetting column layout restores the grouped Sprint column and persists its default', async () => {
    let saved;
    const h = await createWidget({ columnVisibility: { sprint: false, notes: false } });
    try {
      assert(!h.doc.querySelector('#column-strip th[data-column="sprint"]'));
      h.doc.getElementById('btn-reset-columns').click();
      assert(h.doc.querySelector('#column-strip th[data-column="sprint"]'), 'layout reset kept Sprint hidden');
      assert(h.cell('notes'), 'layout reset did not restore other hidden fields');
      await waitFor(() => h.calls.options.some(([key]) => key === 'columnVisibility'),
        'saved default column visibility');
      saved = JSON.parse(JSON.stringify(h.calls.options.find(([key]) => key === 'columnVisibility')[1]));
      assert.deepEqual(saved, {}, 'layout reset should remove explicit visibility choices');
    } finally { h.dom.window.close(); }
    const restored = await createWidget({ columnVisibility: saved }, true);
    try {
      assert(restored.doc.querySelector('#column-strip th[data-column="sprint"]'),
        'reset layout lost its default-visible Sprint after reload');
    } finally { restored.dom.window.close(); }
  });

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
      assert.equal(h.doc.querySelector('td.cell-inline-editing'), null);
      h.cell('notes').click();
      const input = assertInlineText(h, 'notes');
      assert.equal(input.value, longNote);
      const fullText = `${longNote}\nA complete edited final line.`;
      input.value = fullText;
      h.key(input, 'Enter', { ctrlKey: true });
      await waitFor(() => h.calls.updates.length === 1 && !h.doc.querySelector('td.cell-inline-editing'));
      assert.equal(h.calls.updates[0].fields.notes, fullText);
      assert.equal(h.calls.updates[0].options.parseStrings, false);
      h.select('notes'); h.key(h.cell('notes'), 'F2');
      assert.equal(assertInlineText(h, 'notes').value, fullText);
      h.key(input, 'Escape');
      assert.equal(h.doc.activeElement, h.cell('notes'));
      h.key(h.cell('notes'), 'Z');
      assert.equal(assertInlineText(h, 'notes').value, 'Z');
      h.key(input, 'Enter');
      await waitFor(() => h.calls.updates.length === 2 && !h.doc.querySelector('td.cell-inline-editing'));
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

  await test('In-cell Text keeps native selection, clipboard, composition and multiline typing', async () => {
    const h = await createWidget();
    try {
      h.open('notes');
      const input = assertInlineText(h, 'notes');
      input.value = 'First line\nSecond line';
      input.setSelectionRange(2, 7);
      for (const [key, modifiers] of [
        ['ArrowLeft', {}], ['ArrowDown', { shiftKey: true }],
        ['z', { ctrlKey: true }], ['Enter', { shiftKey: true }],
        ['Enter', { isComposing: true }],
      ]) {
        assert.equal(h.key(input, key, modifiers), true, `${key} was prevented inside Text`);
      }
      for (const type of ['copy', 'paste']) {
        const event = new h.win.Event(type, { bubbles: true, cancelable: true });
        Object.defineProperty(event, 'clipboardData', { value: {
          getData: () => 'Pasted\ttext\nwith a newline',
          setData: () => { throw new Error('Widget intercepted native text copy'); },
        } });
        input.dispatchEvent(event);
        assert.equal(event.defaultPrevented, false, `${type} was intercepted inside Text`);
      }
      input.dispatchEvent(new h.win.MouseEvent('pointerdown', { bubbles: true, button: 0 }));
      input.dispatchEvent(new h.win.MouseEvent('pointermove', { bubbles: true, buttons: 1 }));
      await tick();
      assert.equal(input.value, 'First line\nSecond line');
      assert.equal(input.selectionStart, 2);
      assert.equal(input.selectionEnd, 7);
      assert.equal(h.doc.querySelectorAll('td.cell-selected').length, 1);
      assert(h.cell('notes').classList.contains('cell-selected'));
      assert.equal(h.calls.updates.length, 0);
      assert.equal(h.calls.actions.length, 0);
      h.key(input, 'Enter');
      await waitFor(() => h.calls.updates.length === 1 && !h.doc.querySelector('td.cell-inline-editing'));
      assert.equal(h.calls.updates[0].fields.notes, 'First line\nSecond line');
    } finally { h.dom.window.close(); }
  });

  await test('In-cell Text Tab saves and moves in either direction, while Escape cancels', async () => {
    const h = await createWidget();
    try {
      h.open('notes');
      const input = assertInlineText(h, 'notes');
      input.value = 'Saved with Tab';
      h.key(input, 'Tab');
      await waitFor(() => h.calls.updates.length === 1 && h.doc.activeElement === h.cell('students'));
      assert.equal(h.calls.updates[0].fields.notes, 'Saved with Tab');
      assert(h.doc.getElementById('salary-ref-editor').hidden, 'Tab should select the next cell');
      h.open('notes');
      assertInlineText(h, 'notes').value = 'Saved with Shift+Tab';
      h.key(input, 'Tab', { shiftKey: true });
      await waitFor(() => h.calls.updates.length === 2 && h.doc.activeElement === h.cell('datetime'));
      assert.equal(h.calls.updates[1].fields.notes, 'Saved with Shift+Tab');
      h.open('notes');
      assertInlineText(h, 'notes').value = 'Cancelled';
      h.key(input, 'Escape');
      assert.equal(h.doc.activeElement, h.cell('notes'));
      assert.equal(h.cell('notes').textContent, 'Saved with Shift+Tab');
      assert.equal(h.calls.updates.length, 2);
      assert.equal(h.doc.querySelector('td.cell-inline-editing'), null);
    } finally { h.dom.window.close(); }
  });

  await test('Click-away saves Text without stealing the newly selected cell or toolbar focus', async () => {
    const h = await createWidget({ columnVisibility: { sprint: true } }, false,
      { emitRecordsDuringWrite: true, sprintValues: ['Sprint A', 'Sprint B'] });
    try {
      h.open('notes');
      const input = assertInlineText(h, 'notes');
      input.value = 'Saved by selecting another row';
      h.cell('notes', 2).click();
      await waitFor(() => h.calls.updates.length === 1 && !h.doc.querySelector('td.cell-inline-editing'));
      assert.equal(h.calls.updates[0].fields.notes, 'Saved by selecting another row');
      assert.equal(h.doc.activeElement, h.cell('notes', 2));
      assert(h.cell('notes', 2).classList.contains('cell-selected'));
      assert.equal(h.doc.querySelectorAll('td.cell-selected').length, 1);
      h.cell('notes', 2).click();
      assertInlineText(h, 'notes', 2).value = 'Saved by clicking the toolbar';
      const toolbarControl = h.doc.getElementById('sort-select');
      toolbarControl.focus();
      toolbarControl.click();
      await waitFor(() => h.calls.updates.length === 2 && !h.doc.querySelector('td.cell-inline-editing'));
      assert.equal(h.calls.updates[1].fields.notes, 'Saved by clicking the toolbar');
      assert.equal(h.doc.activeElement, toolbarControl, 'saving stole focus from the toolbar');
      h.open('sprint');
      assertInlineText(h, 'sprint').value = 'Sprint B';
      h.cell('notes', 2).click();
      await waitFor(() => h.calls.updates.length === 3 && !h.doc.querySelector('td.cell-inline-editing'));
      assertGroupCount(h, 'Sprint B', 2);
      assert.equal(h.group('Sprint A'), undefined);
      assert.equal(h.doc.activeElement, h.cell('notes', 2), 'regrouping stole the newly selected cell');
      assert(h.cell('notes', 2).classList.contains('cell-selected'));
    } finally { h.dom.window.close(); }
  });

  await test('Record refresh preserves the in-cell Text draft, caret and focus, and removes stale editors', async () => {
    const h = await createWidget();
    try {
      h.open('notes');
      const input = assertInlineText(h, 'notes');
      input.value = 'An unsaved\nmultiline draft';
      input.setSelectionRange(3, 9, 'backward');
      input.scrollTop = 18;
      input.scrollLeft = 5;
      h.switchRecords([1, 2]);
      await tick();
      assert.equal(assertInlineText(h, 'notes'), input, 'refresh replaced the native textarea');
      assert.equal(input.value, 'An unsaved\nmultiline draft');
      assert.equal(input.selectionStart, 3);
      assert.equal(input.selectionEnd, 9);
      assert.equal(input.selectionDirection, 'backward');
      assert.equal(input.scrollTop, 18);
      assert.equal(input.scrollLeft, 5);
      assert.equal(h.calls.updates.length, 0, 'refresh saved an unfinished draft');
      h.switchRecords([2]);
      await tick();
      assert.equal(h.doc.querySelector('td.cell-inline-editing'), null);
      assert.equal(input.closest('td'), null, 'removed row retained an active editor');
      assert(h.doc.getElementById('cell-editor').hidden);
      assert.equal(h.calls.updates.length, 0);
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
        assert.equal(h.doc.querySelector('td.cell-inline-editing'), null);
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
        assert.equal(h.doc.querySelector('td.cell-inline-editing'), null);
        assert(!h.calls.options.some(([key, value]) => key === 'editableColumns' && JSON.parse(value).includes('notes')),
          'default overwrote saved text opt-out');
      } finally { h.dom.window.close(); }
    }
  });

  await test('Grouped Text and Choice edit automatically with saved text opt-out and familiar cell gestures', async () => {
    for (const sprintType of ['Text', 'Choice']) {
      for (const recordsFirst of [false, true]) {
        const h = await createWidget({ editableColumns: [], columnVisibility: { sprint: true } },
          recordsFirst, { sprintType, sprintValues: ['Sprint A', 'Sprint B'] });
        try {
          assert(h.cell('sprint').querySelector('.cell-edit-btn'));
          assert.equal(h.cell('notes').querySelector('.cell-edit-btn'), null, 'ordinary Text opt-out changed');
          const automatic = [...h.doc.querySelectorAll('#editable-col-list .editable-col-option')]
            .find(option => option.textContent.startsWith('sprint'));
          assert(automatic?.querySelector('input:checked:disabled'), 'group field is missing its automatic setting');
          h.select('sprint');
          assert(h.doc.getElementById('cell-editor').hidden, 'first click must only select Sprint');
          assert.equal(h.doc.querySelector('td.cell-inline-editing'), null);
          h.cell('sprint').click();
          assert.equal(assertInlineText(h, 'sprint').value, 'Sprint A');
          h.key(h.doc.getElementById('cell-editor-text'), 'Escape');
          h.key(h.cell('sprint'), 'F2');
          assert.equal(assertInlineText(h, 'sprint').value, 'Sprint A');
          h.key(h.doc.getElementById('cell-editor-text'), 'Escape');
          h.key(h.cell('sprint'), 'N');
          assert.equal(assertInlineText(h, 'sprint').value, 'N', 'typing did not replace Sprint text');
          h.key(h.doc.getElementById('cell-editor-text'), 'Escape');
          assert.equal(h.calls.updates.length, 0, 'cancelled edits wrote Sprint');
          const grouping = h.doc.getElementById('group-select');
          grouping.value = 'notes';
          grouping.dispatchEvent(new h.win.Event('change', { bubbles: true }));
          assert.equal(h.cell('sprint').querySelector('.cell-edit-btn'), null,
            'former grouped field ignored saved editing preferences');
          assert(!h.calls.options.some(([key]) => key === 'editableColumns'), 'automatic grouping changed saved Text preferences');
        } finally { h.dom.window.close(); }
      }
    }
  });

  await test('Grouped Text and Choice edits move rows to existing, new and empty groups with Undo/Redo', async () => {
    for (const sprintType of ['Text', 'Choice']) {
      const h = await createWidget({ editableColumns: [], columnVisibility: { sprint: true } },
        false, { sprintType, sprintValues: ['Sprint A', 'Sprint B', 'Sprint A'],
          emitRecordsDuringWrite: sprintType === 'Choice' });
      try {
        await saveSprint(h, 'Sprint B');
        assertGroupCount(h, 'Sprint A', 1);
        assertGroupCount(h, 'Sprint B', 2);
        assert.equal(h.cell('sprint').closest('.group'), h.group('Sprint B'));
        assert.equal(h.doc.activeElement, h.cell('sprint'), 'moved cell lost focus');
        assert(h.cell('sprint').classList.contains('cell-selected'));
        assert.equal(h.calls.scrolled.at(-1)?.recordId, '1', 'moved row was not brought into view');
        assert.equal(h.calls.scrolled.at(-1)?.options.block, 'nearest');
        h.doc.getElementById('btn-undo').click();
        await waitFor(() => h.calls.updates.length === 2 && !h.doc.getElementById('btn-redo').disabled);
        assertGroupCount(h, 'Sprint A', 2);
        assertGroupCount(h, 'Sprint B', 1);
        h.doc.getElementById('btn-redo').click();
        await waitFor(() => h.calls.updates.length === 3 && !h.doc.getElementById('btn-undo').disabled);
        assertGroupCount(h, 'Sprint A', 1);
        assertGroupCount(h, 'Sprint B', 2);
        await saveSprint(h, 'Sprint New');
        assertGroupCount(h, 'Sprint New', 1);
        assertGroupCount(h, 'Sprint B', 1);
        assert.equal(h.doc.getElementById('stat-groups').textContent, '3');
        await saveSprint(h, '');
        assertGroupCount(h, '', 1);
        assert.equal(h.group('Sprint New'), undefined, 'empty source group was retained');
        await saveSprint(h, 'Sprint B', 3);
        assert.equal(h.group('Sprint A'), undefined, 'last departing row left its source group');
        assertGroupCount(h, 'Sprint B', 2);
        assert.equal(h.doc.getElementById('stat-groups').textContent, '2');
        assert.equal(h.doc.getElementById('stat-records').textContent, '3');
      } finally { h.dom.window.close(); }
    }
  });

  await test('Grouped edits and history reveal collapsed destinations and retain cell selection', async () => {
    const h = await createWidget({ columnVisibility: { sprint: true } }, false,
      { sprintValues: ['Sprint A', 'Sprint A', 'Sprint B'] });
    try {
      h.group('Sprint B').querySelector('.group-header').click();
      assert(h.group('Sprint B').classList.contains('collapsed'));
      await saveSprint(h, 'Sprint B');
      assert(!h.group('Sprint B').classList.contains('collapsed'), 'edit destination stayed collapsed');
      assert.equal(h.doc.activeElement, h.cell('sprint'));
      assert.equal(h.doc.querySelectorAll('td.cell-selected').length, 1);
      h.group('Sprint A').querySelector('.group-header').click();
      h.doc.getElementById('btn-undo').click();
      await waitFor(() => h.calls.updates.length === 2 && !h.doc.getElementById('btn-redo').disabled);
      assert(!h.group('Sprint A').classList.contains('collapsed'), 'Undo destination stayed collapsed');
      await waitFor(() => h.doc.activeElement === h.cell('sprint'), 'Undo focus');
      assert(h.cell('sprint').classList.contains('cell-selected'));
      h.group('Sprint B').querySelector('.group-header').click();
      h.doc.getElementById('btn-redo').click();
      await waitFor(() => h.calls.updates.length === 3 && !h.doc.getElementById('btn-undo').disabled);
      assert(!h.group('Sprint B').classList.contains('collapsed'), 'Redo destination stayed collapsed');
      await waitFor(() => h.doc.activeElement === h.cell('sprint'), 'Redo focus');
      assert(h.cell('sprint').classList.contains('cell-selected'));
    } finally { h.dom.window.close(); }
  });

  await test('Grouped formula Text and Choice remain read-only for editing and pasting', async () => {
    for (const sprintType of ['Text', 'Choice']) {
      const h = await createWidget({ editableColumns: ['sprint'], columnVisibility: { sprint: true } },
        false, { sprintType, sprintFormula: true, sprintValues: ['Sprint A', 'Sprint B'] });
      try {
        assert.equal(h.cell('sprint').dataset.cellWritable, 'false');
        assert.equal(h.cell('sprint').querySelector('.cell-edit-btn'), null);
        h.open('sprint'); h.key(h.cell('sprint'), 'F2'); h.key(h.cell('sprint'), 'X');
        assert(h.doc.getElementById('cell-editor').hidden);
        assert.equal(h.doc.querySelector('td.cell-inline-editing'), null);
        h.paste('sprint', 'Sprint New');
        await tick();
        assert.equal(h.calls.updates.length, 0);
        assert.equal(h.calls.actions.length, 0);
        assertGroupCount(h, 'Sprint A', 1);
        assertGroupCount(h, 'Sprint B', 1);
      } finally { h.dom.window.close(); }
    }
  });

  await test('Failed grouped edit keeps its draft and original groups and reports the Grist error', async () => {
    const h = await createWidget({ columnVisibility: { sprint: true } }, false,
      { sprintValues: ['Sprint A', 'Sprint B'] });
    try {
      h.win.console.error = () => {};
      h.open('sprint');
      const input = assertInlineText(h, 'sprint');
      input.value = 'Sprint New';
      h.failNextWrite('ACL denied: sprint cannot be changed');
      h.key(input, 'Enter');
      await waitFor(() => input.getAttribute('aria-invalid') === 'true'
        && !input.disabled, 'failed Sprint edit');
      assert.equal(assertInlineText(h, 'sprint').value, 'Sprint New');
      assert(h.doc.getElementById('toast').textContent.includes('ACL denied: sprint cannot be changed'));
      assertGroupCount(h, 'Sprint A', 1);
      assertGroupCount(h, 'Sprint B', 1);
      assert.equal(h.group('Sprint New'), undefined);
      assert.equal(h.calls.updates.length, 0);
      assert(h.doc.getElementById('btn-undo').disabled, 'failed edit was added to Undo');
      h.key(input, 'Enter');
      await waitFor(() => h.calls.updates.length === 1 && !h.doc.querySelector('td.cell-inline-editing'));
      assertGroupCount(h, 'Sprint New', 1);
      assert.equal(h.group('Sprint A'), undefined);
    } finally { h.dom.window.close(); }
  });

  await test('A failed pending edit of a removed row reports its error without blocking another cell', async () => {
    const h = await createWidget();
    try {
      h.win.console.error = () => {};
      h.open('notes');
      const input = assertInlineText(h, 'notes');
      input.value = 'Pending edit of the previous row';
      const rejectWrite = h.deferWrite();
      h.key(input, 'Enter');
      assert(input.disabled, 'pending save must disable its draft');
      h.switchRecords([2]);
      assert.equal(h.doc.querySelector('[data-cell-id="1"]'), null);
      const toolbarControl = h.doc.getElementById('sort-select');
      toolbarControl.focus();
      rejectWrite('ACL denied: previous row cannot be changed');
      await waitFor(() => h.doc.getElementById('toast').textContent
        .includes('ACL denied: previous row cannot be changed') && !input.disabled,
      'failed save after selection changed');
      assert.equal(input.closest('td'), null, 'removed row kept an in-cell editor');
      assert.equal(input.hidden, true, 'failed removed-row draft left an invisible active input');
      assert(h.doc.getElementById('cell-editor').hidden);
      assert.equal(h.doc.activeElement, toolbarControl, 'stale save failure stole focus');
      assert.equal(h.calls.updates.length, 0);
      assert(h.doc.getElementById('btn-undo').disabled, 'failed save entered session history');
      h.open('notes', 2);
      assertInlineText(h, 'notes', 2).value = 'New visible row edit';
      h.key(input, 'Enter');
      await waitFor(() => h.calls.updates.length === 1 && !h.doc.querySelector('td.cell-inline-editing'));
      assert.equal(h.calls.updates[0].id, 2);
      assert.equal(h.calls.updates[0].fields.notes, 'New visible row edit');
    } finally { h.dom.window.close(); }
  });

  await test('Grouping range paste regroups atomically, clears stale rectangle, and supports Undo/Redo', async () => {
    const h = await createWidget({ sortMode: 'alpha-asc', columnVisibility: { sprint: true } }, false,
      { sprintValues: ['Sprint A', 'Sprint B', 'Sprint A', 'Sprint C'], emitRecordsDuringWrite: true });
    try {
      h.select('sprint', 1);
      h.cell('sprint', 3).dispatchEvent(new h.win.MouseEvent('click', { bubbles: true, shiftKey: true }));
      assert.equal(h.doc.querySelectorAll('td.cell-selected').length, 2);
      h.paste('sprint', 'Sprint C\nSprint B');
      await waitFor(() => h.calls.actions.length === 1 && !h.doc.getElementById('btn-undo').disabled);
      const bundle = h.calls.actions[0];
      assert.equal(bundle.actions.length, 2);
      assert.equal(bundle.options.parseStrings, false);
      assert.equal(JSON.stringify(bundle.actions.map(action => [action[2], action[3].sprint])),
        JSON.stringify([[1, 'Sprint C'], [3, 'Sprint B']]));
      assert.equal(h.group('Sprint A'), undefined);
      assertGroupCount(h, 'Sprint B', 2);
      assertGroupCount(h, 'Sprint C', 2);
      assert.equal(h.doc.querySelectorAll('td.cell-selected').length, 1, 'regrouping retained a rectangle over unrelated rows');
      assert.equal(h.doc.querySelectorAll('td.cell-range').length, 0);
      assert(h.cell('sprint', 1).classList.contains('cell-selected'));
      h.doc.getElementById('btn-undo').click();
      await waitFor(() => h.calls.actions.length === 2 && !h.doc.getElementById('btn-redo').disabled);
      assertGroupCount(h, 'Sprint A', 2);
      assertGroupCount(h, 'Sprint B', 1);
      assertGroupCount(h, 'Sprint C', 1);
      h.doc.getElementById('btn-redo').click();
      await waitFor(() => h.calls.actions.length === 3 && !h.doc.getElementById('btn-undo').disabled);
      assert.equal(h.group('Sprint A'), undefined);
      assertGroupCount(h, 'Sprint B', 2);
      assertGroupCount(h, 'Sprint C', 2);
    } finally { h.dom.window.close(); }
  });

  await test('Sprints obsolete C text preference migrates to notes when C is absent', async () => {
    const h = await createWidget({ editableColumns: ['C'] });
    try {
      assert(h.cell('notes').querySelector('.cell-edit-btn'), 'legacy C preference did not enable notes');
      h.open('notes');
      assertInlineText(h, 'notes');
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
