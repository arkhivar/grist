// Table operations target original Attendance records behind the summary view.
const salaryAttendanceOps = {
  getTableId: async () => WIDGET_CONFIG.classTableId,
  update: async (updates, options) => {
    const rows = Array.isArray(updates) ? updates : [updates];
    return grist.docApi.applyUserActions(rows.map(row =>
      ['UpdateRecord', WIDGET_CONFIG.classTableId, row.id, row.fields]), options);
  },
  create: async (record, options) => {
    const result = await grist.docApi.applyUserActions([
      ['AddRecord', WIDGET_CONFIG.classTableId, null, record.fields],
    ], options);
    return { id: result?.retValues?.[0] };
  },
  destroy: async ids => grist.docApi.applyUserActions(ids.map(id =>
    ['RemoveRecord', WIDGET_CONFIG.classTableId, id])),
};

function salaryTableOperations() {
  return salaryAttendanceOps;
}

async function salaryFetchClassRecord(recordId) {
  const table = await grist.docApi.fetchTable(WIDGET_CONFIG.classTableId);
  const index = (table.id || []).findIndex(id => Number(id) === Number(recordId));
  if (index < 0) throw new Error(`Class record ${recordId} is unavailable`);
  return Object.fromEntries(Object.entries(table).map(([col, values]) =>
    [col, Array.isArray(values) ? values[index] : undefined]));
}
