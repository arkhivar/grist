// Select teachers from Attendance's per/performance target, or classes via group links.
// Keep this widget on the shared grouped-table implementation.
const WIDGET_CONFIG = {
  monthlyOnly: true,
  sumColumns: ['wage', 'count'],
  showGroupingColumn: true,
  editAllWritableText: true,
  editBoolOnSecondClick: true,
  classTableId: 'All_att',
  expensesTableId: 'Transactions',
  receivedColumn: 'salary_received',
  defaultColumnOrder: ['datetime', 'performance', 'per', 'student', 'students', 'notes',
    'wage', 'salary_received', 'count', 'sprint', 'attach_payment'],
  compactColumns: ['performance', 'per', 'wage', 'salary_received', 'count'],
  minimumColumnWidths: { performance: 48, per: 48 },
};
