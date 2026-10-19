// Registry payroll periods are separate from the calendar-month view. A week's
// parent month is always its explicit registry link, never its payment date.
let salaryPeriodView = 'calendar';
let salaryPeriodRegistryStatus = 'idle';
let salaryPeriodRegistryError = '';
let salaryPeriodWeeks = new Map();
let salaryPeriodMonths = new Map();
let salaryPeriodRegistryPromise = null;
let salaryPeriodRegistryGeneration = 0;

function salaryPayrollActive() {
  return salaryPeriodView === 'payroll';
}

function salaryPeriodReference(value) {
  const raw = normalizeTypedCell(value);
  if (raw == null || raw === '' || raw === 0)
    return { id: 0, empty: true, valid: true };
  const values = Array.isArray(raw) ? (raw[0] === 'L' ? raw.slice(1) : raw) : [raw];
  if (!values.length) return { id: 0, empty: true, valid: true };
  const valid = values.every(item => {
    const cell = normalizeTypedCell(item);
    return cell !== null && cell !== '' && typeof cell !== 'boolean' && !Array.isArray(cell)
      && Number.isInteger(Number(cell)) && Number(cell) > 0;
  });
  const ids = [...new Set(referenceIds(value))];
  return { id: valid && ids.length === 1 ? ids[0] : 0,
    empty: false, valid: valid && ids.length === 1 };
}

function salaryPeriodMonthId(value) {
  return salaryPeriodReference(value).id;
}

function salaryPeriodDateSec(value) {
  const sec = parseDateValueSec(normalizeTypedCell(value));
  return Number.isFinite(sec) && sec >= DATE_EPOCH_MIN && sec <= DATE_EPOCH_MAX
    ? sec : null;
}

function salaryPeriodIsoWeek(startSec) {
  const date = new Date(startSec * 1000);
  date.setUTCDate(date.getUTCDate() + 4 - (date.getUTCDay() || 7));
  const year = date.getUTCFullYear();
  const yearStart = Date.UTC(year, 0, 1);
  const number = Math.ceil(((date.getTime() - yearStart) / 86400000 + 1) / 7);
  return `${year}-W${String(number).padStart(2, '0')}`;
}

function salaryPeriodRegistryColumnMeta(tableId, col, tables, columns) {
  const names = tables?.tableId || [];
  let tableIndex = names.indexOf(tableId);
  if (tableIndex < 0) {
    const matches = names.map((name, index) => ({ name, index }))
      .filter(item => String(item.name).toLowerCase() === tableId.toLowerCase());
    if (matches.length === 1) tableIndex = matches[0].index;
  }
  if (tableIndex < 0) return null;
  const tableRef = tables.id[tableIndex];
  const columnIndex = (columns?.colId || []).findIndex((name, index) =>
    name === col && Number(columns.parentId?.[index]) === Number(tableRef));
  if (columnIndex < 0) return null;
  return { type: columns.type?.[columnIndex] || '',
    isFormula: !!columns.isFormula?.[columnIndex] };
}

function salaryPeriodRegistriesFromTables(weeks, months, tables, columns) {
  for (const [tableId, table, required] of [
    ['WeekRegistry', weeks, ['id', 'weekStart', 'weekEnd', 'forMonth']],
    ['MonthRegistry', months, ['id', 'monthStart', 'monthEnd']],
  ]) {
    for (const col of required) {
      if (!Array.isArray(table?.[col]) || table[col].length !== table.id?.length)
        throw new Error(`${tableId} must have ${required.join(', ')} columns`);
      if (col === 'id') continue;
      const meta = salaryPeriodRegistryColumnMeta(tableId, col, tables, columns);
      if (!meta) throw new Error(`Column metadata not found for ${tableId}.${col}`);
      if (col === 'forMonth') {
        if (meta.type !== 'Ref:MonthRegistry' || meta.isFormula)
          throw new Error('WeekRegistry.forMonth must be an editable Reference to MonthRegistry');
      } else if (meta.type !== 'Date') {
        throw new Error(`${tableId}.${col} must be a Date column`);
      }
    }
  }

  const monthMap = new Map();
  months.id.forEach((rawId, index) => {
    const id = Number(rawId);
    if (!Number.isInteger(id) || id <= 0 || monthMap.has(id))
      throw new Error('MonthRegistry contains an invalid or duplicate row ID');
    const startSec = salaryPeriodDateSec(months.monthStart[index]);
    const endSec = salaryPeriodDateSec(months.monthEnd[index]);
    const start = startSec == null ? null : new Date(startSec * 1000);
    const expectedEnd = start == null ? null
      : Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 1) / 1000;
    const valid = start != null && start.getUTCDate() === 1
      && startSec % 86400 === 0 && endSec === expectedEnd;
    monthMap.set(id, { id, startSec, endSec,
      sortKey: valid ? startSec * 1000 : null,
      label: valid ? start.toLocaleDateString('en-US', {
        month: 'long', year: 'numeric', timeZone: 'UTC',
      }) : `Month #${id} (invalid dates)`,
      valid, invalidReason: valid ? '' : 'Invalid month registry dates' });
  });

  const weekMap = new Map();
  weeks.id.forEach((rawId, index) => {
    const id = Number(rawId);
    if (!Number.isInteger(id) || id <= 0 || weekMap.has(id))
      throw new Error('WeekRegistry contains an invalid or duplicate row ID');
    const startSec = salaryPeriodDateSec(weeks.weekStart[index]);
    const endSec = salaryPeriodDateSec(weeks.weekEnd[index]);
    const start = startSec == null ? null : new Date(startSec * 1000);
    const valid = start != null && start.getUTCDay() === 1
      && startSec % 86400 === 0 && endSec === startSec + 7 * 86400;
    const monthRef = salaryPeriodReference(weeks.forMonth[index]);
    const month = monthMap.get(monthRef.id);
    const monthValid = monthRef.valid && (monthRef.empty || !!month?.valid);
    const isoKey = valid ? salaryPeriodIsoWeek(startSec) : '';
    const range = valid ? `${formatUtcDateSec(startSec)} – ${formatUtcDateSec(endSec - 86400)}` : '';
    weekMap.set(id, { id, startSec, endSec, isoKey,
      monthId: monthRef.id,
      sortKey: valid ? startSec * 1000 : null,
      label: valid ? `${isoKey} · ${range}` : `Week #${id} (invalid dates)`,
      valid, monthValid,
      invalidReason: !valid ? 'Invalid week registry dates'
        : !monthValid ? 'Invalid month assignment in WeekRegistry' : '' });
  });
  return { weeks: weekMap, months: monthMap };
}

function salaryInvalidatePeriodRegistries() {
  ++salaryPeriodRegistryGeneration;
  salaryPeriodRegistryPromise = null;
  salaryPeriodRegistryStatus = 'idle';
  salaryPeriodRegistryError = '';
  salaryPeriodWeeks = new Map();
  salaryPeriodMonths = new Map();
}

async function salaryLoadPeriodRegistries(force = false) {
  if (!force && salaryPeriodRegistryStatus === 'ready')
    return { weeks: salaryPeriodWeeks, months: salaryPeriodMonths };
  if (!force && salaryPeriodRegistryPromise) return salaryPeriodRegistryPromise;
  const generation = ++salaryPeriodRegistryGeneration;
  salaryPeriodRegistryStatus = 'loading';
  salaryPeriodRegistryError = '';
  salaryPeriodRegistryPromise = salaryFetchPeriodRegistries(generation);
  return salaryPeriodRegistryPromise;
}

async function salaryFetchPeriodRegistries(generation) {
  try {
    // Await every sibling even after a failed read, so retries cannot overlap
    // a forgotten registry or metadata request from the preceding load.
    const results = await Promise.allSettled([
      grist.docApi.fetchTable('WeekRegistry'),
      grist.docApi.fetchTable('MonthRegistry'),
      grist.docApi.fetchTable('_grist_Tables'),
      grist.docApi.fetchTable('_grist_Tables_column'),
    ]);
    const failure = results.find(result => result.status === 'rejected');
    if (failure) throw failure.reason;
    const parsed = salaryPeriodRegistriesFromTables(...results.map(result => result.value));
    if (generation === salaryPeriodRegistryGeneration) {
      salaryPeriodWeeks = parsed.weeks;
      salaryPeriodMonths = parsed.months;
      salaryPeriodRegistryStatus = 'ready';
    }
    return parsed;
  } catch (error) {
    if (generation === salaryPeriodRegistryGeneration) {
      salaryPeriodRegistryStatus = 'error';
      salaryPeriodRegistryError = error?.message || String(error);
      salaryPeriodWeeks = new Map();
      salaryPeriodMonths = new Map();
    }
    throw error;
  } finally {
    if (generation === salaryPeriodRegistryGeneration) salaryPeriodRegistryPromise = null;
  }
}

function salaryBuildPayrollGroups(records, payments) {
  const parents = new Map();
  const leaves = new Map();
  const weekByStart = new Map();
  salaryPeriodWeeks.forEach(week => {
    if (!week.valid) return;
    if (weekByStart.has(week.startSec)) weekByStart.set(week.startSec, null);
    else weekByStart.set(week.startSec, week);
  });

  function parentFor(monthId) {
    const month = salaryPeriodMonths.get(monthId);
    const key = month?.valid ? `payroll-month:${month.id}` : 'payroll-unassigned';
    if (!parents.has(key)) parents.set(key, { key,
      label: month?.valid ? month.label : 'Unassigned month',
      monthId: month?.valid ? month.id : 0,
      sortKey: month?.valid ? month.sortKey : null,
      records: [], payments: [], children: [] });
    return parents.get(key);
  }

  function leafFor(week, month, reviewReason) {
    const key = reviewReason ? 'payroll-review'
      : week ? `payroll-week:${week.id}` : `payroll-monthly:${month.id}`;
    if (!leaves.has(key)) {
      const parent = parentFor(reviewReason ? 0 : week ? week.monthId : month.id);
      const leaf = { key,
        label: reviewReason ? 'Needs review · unassigned or conflicting period'
          : week ? week.label : 'Monthly items',
        sortKey: reviewReason ? null : week ? week.sortKey : month.sortKey,
        weekId: week?.id || 0, monthId: parent.monthId,
        writeValue: null, records: [], payments: [],
        addRowDisabledReason: 'Add the first work record for this period in Attendance',
      };
      leaves.set(key, leaf);
      parent.children.push(leaf);
    }
    return leaves.get(key);
  }

  const startColumn = dateTimeStartColumn(allColumns)
    || dateTimeStartColumn(columnTypes);
  const groupedColumn = parseGroupBy(groupBy).col;
  records.forEach(record => {
    const sec = startColumn ? salaryPeriodDateSec(record[startColumn]) : null;
    let week = null;
    if (sec != null) {
      const wallDate = dateTimeWallDate(sec);
      const monday = Date.UTC(wallDate.getUTCFullYear(), wallDate.getUTCMonth(),
        wallDate.getUTCDate() - (wallDate.getUTCDay() + 6) % 7) / 1000;
      week = weekByStart.get(monday);
    }
    const review = !week || !week.monthValid;
    const leaf = leafFor(review ? null : week, null, review);
    leaf.records.push(record);
    if (!review && leaf.records.length === 1) {
      leaf.writeValue = record[groupedColumn] ?? null;
      delete leaf.addRowDisabledReason;
    }
  });

  payments.forEach(payment => {
    const weekRef = salaryPeriodReference(payment.weekRef);
    const monthRef = salaryPeriodReference(payment.monthRef);
    const week = salaryPeriodWeeks.get(weekRef.id);
    const month = salaryPeriodMonths.get(monthRef.id);
    const review = !weekRef.valid || !monthRef.valid
      || (!weekRef.empty && !monthRef.empty)
      || (weekRef.empty && monthRef.empty)
      || (!weekRef.empty && (!week?.valid || !week.monthValid))
      || (!monthRef.empty && !month?.valid);
    leafFor(review ? null : week, review ? null : month, review).payments.push(payment);
  });

  const newestFirst = (a, b) => a.sortKey == null ? (b.sortKey == null ? 0 : 1)
    : b.sortKey == null ? -1 : b.sortKey - a.sortKey || a.key.localeCompare(b.key);
  parents.forEach(parent => {
    parent.children.sort((a, b) => a.key === 'payroll-review' ? 1
      : b.key === 'payroll-review' ? -1
        : a.key.startsWith('payroll-monthly:') ? 1
          : b.key.startsWith('payroll-monthly:') ? -1 : newestFirst(a, b));
    parent.children.forEach(leaf => {
      parent.records.push(...leaf.records);
      parent.payments.push(...leaf.payments);
    });
  });
  return [...parents.values()].sort(newestFirst);
}
