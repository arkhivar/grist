// Table operations target original Attendance records behind the summary view.
let salaryClassTableIdPromise = null;
let salaryClassTableId = null;
const salaryTeacherColumnIds = ['performance', 'per', 't'];
const salaryPeriodTargets = { forMonth: 'MonthRegistry', forWeek: 'WeekRegistry' };
const salaryEmptyClassPeriodColumns = new Set();
const salaryClassPeriodValues = Symbol('classPeriodValues');
let salaryClassMonthRegistry = null;

function salaryIsPeriodField(col) {
  return Object.hasOwn(salaryPeriodTargets, col);
}

function salaryIsPeriodReference(col, type) {
  if (!salaryIsPeriodField(col)) return false;
  const target = salaryPeriodTargets[col];
  return type === `Ref:${target}` || type === `RefList:${target}`;
}

function salaryClassPeriodField(col) {
  return salaryIsPeriodReference(col, columnTypes[col]);
}

function salaryIsEmptyClassPeriodFormula(tableId, col, type, formula) {
  // Grist turns a typed, empty formula column into data on the first ordinary write.
  return tableId === salaryClassTableId && formula === '' && salaryIsPeriodReference(col, type);
}

function salaryClassPeriodReference(record, field) {
  if (salaryClassPeriodField(field)) return salaryPeriodReference(record[salaryClassPeriodValues]?.[field]);
  // An unrelated Text field can share this name. A link to a different table cannot assign a salary period.
  const wrongTarget = /^(Ref|RefList):/.test(columnTypes[field]) && Boolean(record[field]);
  return { id: 0, valid: !wrongTarget, empty: !wrongTarget };
}

function salarySetClassPeriodValue(record, field, raw) {
  record[salaryClassPeriodValues] ??= Object.create(null);
  record[salaryClassPeriodValues][field] = raw;
  const ref = salaryPeriodReference(raw);
  const ids = referenceIds(raw);
  const registry = field === 'forMonth' ? salaryClassMonthRegistry : salaryPeriodWeeks;
  const labels = ids.map(id => {
    if (!salaryClassPeriodField(field)) return referenceDisplayLabel(field, id);
    const period = registry?.get(id);
    return period?.valid ? period.isoKey || period.label : `#${id}`;
  });
  if (!labels.length && !ref.empty) labels.push('Invalid link');
  setReferenceDisplay(record, field, labels);
  return record[field];
}

function salaryRevealClassPeriod(recordId) {
  for (const group of getGroups()) {
    if (!group.records.some(row => Number(row.id) === Number(recordId))) continue;
    const parentClosed = collapsed.delete(group.key);
    if (group.children) {
      const leaf = group.children.find(child => child.records.some(row => Number(row.id) === Number(recordId)));
      const leafClosed = leaf && collapsed.delete(leaf.key);
      if (parentClosed || leafClosed) salarySavePayrollCollapse();
    }
    return true;
  }
  return false;
}

function salaryTeacherColumn(fields) {
  // Each table may rename this field independently; keep the legacy ID first.
  return salaryTeacherColumnIds.find(col =>
    Object.prototype.hasOwnProperty.call(fields || {}, col)) || null;
}

function salaryRequireTeacherColumn(table, tableId) {
  const col = salaryTeacherColumn(table);
  if (!col || !Array.isArray(table[col]))
    throw new Error(`${tableId} must have a performance, per, or t teacher column`);
  return col;
}

function salaryMigrateTeacherColumnOptions() {
  const col = salaryTeacherColumn(columnTypes);
  if (!col) return;
  // Coexisting fields keep separate preferences; only migrate a clear rename.
  if (salaryTeacherColumnIds.filter(field =>
    Object.prototype.hasOwnProperty.call(columnTypes, field)).length !== 1) return;
  for (const previous of salaryTeacherColumnIds.filter(field => field !== col)) {
    if (columnOrder.includes(previous)) {
      const hasCurrentOrder = columnOrder.includes(col);
      columnOrder = columnOrder.flatMap(field => field === previous
        ? hasCurrentOrder ? [] : [col] : [field]);
    }
    for (const settings of [columnWidths, columnVisibility]) {
      if (!Object.prototype.hasOwnProperty.call(settings, previous)) continue;
      if (!Object.prototype.hasOwnProperty.call(settings, col)) settings[col] = settings[previous];
      delete settings[previous];
    }
    if (editableColumns.delete(previous)) editableColumns.add(col);
    if (rowSort.column === previous) rowSort = { ...rowSort, column: col };
  }
}

async function salaryResolveClassTableId(tables = null) {
  if (!salaryClassTableIdPromise) {
    const metadata = tables ? Promise.resolve(tables) : grist.docApi.fetchTable('_grist_Tables');
    salaryClassTableIdPromise = metadata.then(tables => {
      const tableIds = tables.tableId || [];
      const configured = WIDGET_CONFIG.classTableId;
      if (tableIds.includes(configured)) return salaryClassTableId = configured;
      const matches = tableIds.filter(id => String(id).toLowerCase() === configured.toLowerCase());
      if (matches.length === 1) return salaryClassTableId = matches[0];
      if (matches.length > 1)
        throw new Error(`Attendance table ID is ambiguous: ${matches.join(', ')}`);
      throw new Error(`Table metadata not found for ${configured}`);
    });
  }
  const request = salaryClassTableIdPromise;
  try {
    return await request;
  } catch (error) {
    if (salaryClassTableIdPromise === request) salaryClassTableIdPromise = null;
    throw error;
  }
}

const salaryAttendanceOps = {
  getTableId: salaryResolveClassTableId,
  update: async (updates, options) => {
    const tableId = salaryClassTableId || await salaryResolveClassTableId();
    const rows = Array.isArray(updates) ? updates : [updates];
    return grist.docApi.applyUserActions(rows.map(row =>
      ['UpdateRecord', tableId, row.id, row.fields]), options);
  },
  create: async (record, options) => {
    const tableId = salaryClassTableId || await salaryResolveClassTableId();
    const result = await grist.docApi.applyUserActions([
      ['AddRecord', tableId, null, record.fields],
    ], options);
    return { id: result?.retValues?.[0] };
  },
  destroy: async ids => {
    const tableId = salaryClassTableId || await salaryResolveClassTableId();
    return grist.docApi.applyUserActions(ids.map(id => ['RemoveRecord', tableId, id]));
  },
};

function salaryTableOperations() {
  return salaryAttendanceOps;
}

async function salaryFetchClassRecord(recordId) {
  const tableId = salaryClassTableId || await salaryResolveClassTableId();
  const table = await grist.docApi.fetchTable(tableId);
  const index = (table.id || []).findIndex(id => Number(id) === Number(recordId));
  if (index < 0) throw new Error(`Class record ${recordId} is unavailable`);
  return Object.fromEntries(Object.entries(table).map(([col, values]) =>
    [col, Array.isArray(values) ? values[index] : undefined]));
}
