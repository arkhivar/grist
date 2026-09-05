#!/usr/bin/env node
'use strict';

// Run every widget suite in its own Node process. Keeping suites isolated
// preserves the browser-like global-script assumptions used by the widgets.
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const suites = fs.readdirSync(__dirname)
  .filter(name => name.endsWith('.test.js'))
  .sort();

if (suites.length === 0) {
  console.error('No widget test suites found in tests/.');
  process.exitCode = 1;
} else {
  let failed = 0;
  for (const suite of suites) {
    console.log(`\n> node tests/${suite}`);
    const result = spawnSync(process.execPath, [path.join(__dirname, suite)], {
      stdio: 'inherit',
    });
    if (result.error) {
      console.error(`Could not run ${suite}: ${result.error.message}`);
      failed++;
    } else if (result.status !== 0) {
      failed++;
    }
  }
  if (failed) {
    console.error(`\n${failed} widget test suite${failed === 1 ? '' : 's'} failed.`);
    process.exitCode = 1;
  } else {
    console.log(`\n${suites.length} widget test suite${suites.length === 1 ? '' : 's'} passed.`);
  }
}
