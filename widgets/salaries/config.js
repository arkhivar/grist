// The linked Grist selection supplies All_att rows whose group links Attendance.
// Keep this widget on the shared grouped-table implementation.
const WIDGET_CONFIG = {
  monthlyOnly: true,
  sumColumns: ['wage'],
  showGroupingColumn: true,
  editAllWritableText: true,
  editBoolOnSecondClick: true,
  editReferences: true,
  classTableId: 'Attendance',
  expensesTableId: 'Expenses',
  receivedColumn: 'salary_received',
};
