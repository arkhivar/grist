// Select teachers from All_att.performance's target, or classes via group links.
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
  defaultColumnOrder: ['datetime', 'performance', 'student', 'students', 'notes',
    'wage', 'salary_received', 'count', 'sprint', 'attach_payment'],
  compactColumns: ['performance', 'wage', 'salary_received', 'count'],
};
