// Table operations target original Attendance records behind the summary view.
let salaryClassTableIdPromise = null;
let salaryClassTableId = null;

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
