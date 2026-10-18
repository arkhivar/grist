// Select teachers from Attendance's t/per/performance target, or classes via group links.
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
  defaultColumnOrder: ['datetime', 'start', 'performance', 'per', 't', 'student', 'students', 'notes',
    'wage', 'salary_received', 'count', 'sprint', 'attach_payment'],
  compactColumns: ['performance', 'per', 't', 'wage', 'salary_received', 'count'],
  minimumColumnWidths: { performance: 48, per: 48, t: 48 },
};
