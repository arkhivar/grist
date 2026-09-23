#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const html = read('salaries.html');
const version = /WIDGET_VERSION = '([^']+)'/.exec(read('shared/core.js'))[1];
const assets = [...html.matchAll(/(?:src|href)="([^"]+\?v=([^"]+))"/g)]
  .filter(match => !match[1].startsWith('https://'));
assert.equal(assets.length, 5);
assert(assets.every(match => match[2] === version), 'salaries asset versions differ');
assert(html.includes('widgets/salaries/config.js'));

const dom = new JSDOM(html, {
  url: 'https://arkhivar.github.io/grist/salaries.html',
  runScripts: 'outside-only',
  pretendToBeVisual: true,
});
const win = dom.window;
const doc = win.document;
let onOptions;
let onRecords;
const calls = { ready: [], options: [] };
win.grist = {
  ready(options) { calls.ready.push(options); },
  onOptions(callback) { onOptions = callback; },
  onRecords(callback) { onRecords = callback; },
  setOption(key, value) { calls.options.push([key, value]); },
  selectedTable: { getTableId: async () => 'Attendance' },
  docApi: { fetchTable: async name => {
    if (name === '_grist_Tables')
      return { id: [1], tableId: ['Attendance'] };
    if (name === '_grist_Tables_column')
      return { id: [10, 11, 12, 13], parentId: [1, 1, 1, 1],
        colId: ['startsAt', 'wage', 'students', 'rate'],
        type: ['DateTime:Asia/Vladivostok', 'Numeric', 'Text', 'Numeric'],
        isFormula: [false, true, false, false] };
    throw new Error(`Unexpected table ${name}`);
  } },
};

win.eval([
  'widgets/salaries/config.js',
  'shared/core.js',
  'widgets/sprints/app.js',
  'widgets/sprints/actions.js',
].map(read).join('\n;\n'));

const records = [
  { id: 1, startsAt: '2026-07-31T14:30:00Z', wage: 100, students: 'A', rate: 10 },
  { id: 2, startsAt: Date.parse('2026-08-15T03:00:00Z') / 1000, wage: 200, students: 'B', rate: 20 },
  { id: 3, startsAt: { toString: () => '2026-07-31T13:30:00Z' }, wage: 50, students: 'C', rate: 30 },
];
const tick = () => new Promise(resolve => setTimeout(resolve, 0));
const cards = () => [...doc.querySelectorAll('.group')];
const month = label => cards().find(card => card.dataset.groupLabel === label);

async function main() {
  // Grist delivers options, records, and metadata independently.
  onOptions({ sortMode: 'alpha-asc' }, { accessLevel: 'full' });
  onRecords(records);
  await tick();
  await tick();
  assert.equal(calls.ready[0].requiredAccess, 'full');
  assert(calls.options.some(([key, value]) => key === 'groupBy' && value === 'startsAt::month'));
  assert.equal(doc.getElementById('group-select').value, 'startsAt::month');
  assert.deepEqual([...doc.querySelectorAll('#group-select option')].map(option => option.value), ['', 'startsAt::month']);
  assert.equal(cards().length, 2);
  assert.equal(cards()[0].dataset.groupLabel, 'July 2026');
  assert.equal(month('August 2026').querySelector('.group-badge').textContent, '2');
  assert.equal(month('August 2026').querySelector('.group-sum[data-column="wage"]').textContent, '300');
  assert.equal(month('July 2026').querySelector('.group-sum[data-column="wage"]').textContent, '50');
  assert.equal(doc.querySelectorAll('.group-sum[data-column="rate"]').length, 0);
  assert.equal(doc.getElementById('stat-records').textContent, '3');
  assert(doc.getElementById('statsbar').textContent.includes('classes'));

  const header = month('August 2026').querySelector('.group-header');
  header.click();
  assert.equal(header.getAttribute('aria-expanded'), 'false');
  assert(month('August 2026').classList.contains('collapsed'));

  // onRecords is already scoped by Grist's linked teacher selection.
  onRecords(records.slice(0, 1));
  assert.equal(cards().length, 1);
  assert.equal(month('August 2026').querySelector('.group-sum').textContent, '100');
  assert(month('August 2026').classList.contains('collapsed'));
  onRecords([]);
  assert.equal(cards().length, 0);
  assert(doc.querySelector('.empty-title').textContent.includes('No classes'));
  console.log('PASS salaries: linked records, VLAT monthly groups, wage subtotals, collapse, empty state, cache keys');
  win.close();
}

main().catch(error => { console.error(error); process.exitCode = 1; win.close(); });
