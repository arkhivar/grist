# AGENTS.md — guidance for AI coding agents

This repo (`arkhivar/grist`) hosts a family of **Grist custom widgets**: static
HTML/CSS/JS pages served via GitHub Pages (or any static host), embedded in
Grist documents as *Custom* widgets. No build step, no framework, classic
scripts sharing the global lexical scope (no IIFEs, no modules).

## Layout

```
<name>.html              # one entry page per widget — English noun (sprints.html, salaries.html)
index.html               # gallery linking to every widget
shared/
  core.js                # UI strings (T), version, grouped state, Grist helpers
  dates.js               # date parsing and VLAT helpers without grouped DOM
  navigation.js          # document-scoped recent-student bridge
  references.js          # shared Reference / Reference List picker and labels
  base.css               # design system (tokens, toolbar, tables, grips, editor, toasts)
widgets/<name>/          # per-widget code (app.js, actions.js)
tests/<name>.test.js     # one jsdom suite per widget, no framework
```

## Commands

```sh
npm ci        # exact dev-only dependencies from package-lock.json
npm test      # discovers and runs every tests/*.test.js suite
```

## Hard rules

1. **Version bumps are atomic**: update `WIDGET_VERSION` in `shared/core.js`
   AND every `?v=` asset key in the entry HTML together (cache-busting; Pages
   and browsers otherwise serve stale files). Two decimal digits: 7.01, 7.02…
2. **Never break the shared-scope contract**: no IIFEs, no ES modules, no
   redeclared top-level names across the scripts of one widget.
3. **Run `npm test` before every commit.** The runner discovers every
   `tests/*.test.js` suite. A change that can't be tested in
   jsdom (layout-dependent drag geometry, etc.) must be called out in the
   commit message.
4. Write operations require `requiredAccess: 'full'` and must surface the real
   Grist API error (never a generic "needs Full access" message).
5. Comments and UI strings: English only.
6. **Markdown filenames** use a leading underscore and uppercase words
   separated by underscores, as in `_RELEASE_NOTES.md`. Keep `README.md` and
   `AGENTS.md` under their exact conventional names.

## Grist quirks we learned the hard way (do not rediscover)

- **Date/DateTime cells** arrive as epoch seconds (UTC), as ISO 8601 strings,
  OR as **object wrappers whose `String()` is the ISO text**. Always go through
  `parseDateValueSec()` / `formatUtcDateSec()` in `shared/dates.js`; never
  assume `typeof === 'string'`.
- `parseIsoDateSec` strips invisible/format characters (ZWSP, LRM/RLM, bidi
  controls, soft hyphen, BOM) and normalizes whitespace before matching — keep
  imports/pastes tolerant.
- `onRecords`, `onOptions`, and metadata fetches arrive **independently**; wait
  for every source you depend on (see automatic grouping in the sprints app).
- Widget **options persist per widget section**, not per URL. Changing the
  widget URL creates a fresh instance: the owner must re-set Full access,
  Select By linking, and saved view options.
- `selectedTable.destroy()` is called with an **array** of ids (even for one
  record) — some TableOperations builds reject the scalar response otherwise.
- Duplicates re-fetch the source record with `cellFormat: 'typed'` and
  unexpanded references, then copy only writable columns plus `manualSort`.
- Re-adding / re-pointing a custom widget resets its data selection; the owner
  re-links via ⋮ → Edit data selection → Select By.

## Shared UX/UI standard

All widgets, including Sprints and Salaries, follow the same cell interaction
standard. Preserve it when extending editing or adding another widget:

- First click selects the cell. Once selected, one further click immediately
  starts in-cell editing and places the caret at the clicked text position.
  These are ordinary clicks with no double-click timing requirement; do not
  add another activation click or force the caret to the end of the value.
- Writable, enabled Text/Choice and Numeric/Int fields use this interaction.
  Typing replaces the selected value; Enter/F2 edits the existing value.
  Enter/click-away saves, Tab/Shift+Tab saves and moves, and Escape cancels.
  Text supports Shift+Enter for a newline and native selection/copy/paste.
- Keep the UI compact, preserve drafts and caret through refreshes, and retain
  cell ranges, copy/paste, and Undo/Redo. On payment rows, only writable period
  references have editors. Formula cells are read-only.
  DateTime and Reference pickers remain compact, non-blocking popovers.
- View settings persist per section. Grouping columns are visible by default;
  an explicitly saved visibility choice wins. Feedback stays in the fixed
  bottom-right live region without moving rows or taking focus.

The shared design language and shortcuts are documented in [_DESIGN.md](_DESIGN.md).
For the complete user workflow, see [Editing fields](README.md#editing-fields).

## Workflow

- GitHub `main` is the source of truth. Direct-to-main pushes are currently
  expected by the owner after completed changes pass tests; keep commits small
  and one-purpose, then push immediately so the live widget can be tested.
- CI: `.github/workflows/test.yml` runs `npm ci` and `npm test` on every push
  and pull request.
- When serving from the owner's VPS instead of Pages: the widget files are
  plain static files — point the web server at the checkout and update the
  custom-widget URL in the Grist doc accordingly (fresh widget instance, see
  the options note above).

## Salaries widget

`salaries.html` uses the shared grouped-table app. Selecting rows from the table
referenced by `All_att.t` (legacy `per` / `performance`) filters classes by those raw teacher IDs.
Currently that table is `PERFORMANCE`, with initials in its `name` column (the
Reference's configured visible column). Teacher selection works even when the
teacher has payments but no classes. Linked `All_att` summary
rows supply `group` RefLists of original `All_att` row IDs (`Attendance` is the
display label; `ALL_ATT` is the current table ID). The widget resolves the
configured `All_att` ID from metadata, reads those class rows with `fetchTable`,
displays their fields, and writes class edits to the resolved ID.
It reads `Transactions` with `fetchTable`,
matches raw teacher IDs from the selected teacher/summary rows
against Transactions (`All_att.t` is a RefList), and
groups payments by explicit month assignment or by `Transactions.datetime`
in Vladivostok time. A helper `date` column is unnecessary. The current
`Transactions.per` column is a RefList to `PERFORMANCE`; single
Reference and legacy Int IDs also work. Include a transaction when any of its
teacher IDs matches the selection, counting the row once even when multiple
selected teachers match. Every transaction with
a teacher reference counts as salary received. Month headers show the signed
`wage` and `count` subtotals and `amount` payment subtotal over their columns;
class and payment rows share one table grid with wage and paid columns. Payment
rows support edits to their period references. A toolbar button re-fetches Transactions after external edits. Keep
selection changes race-safe and never treat a failed expense fetch as zero
payments.

## Current state (v7.76)

- Salaries has an optional persisted `salaryPeriodView`: `calendar` (default,
  Calendar months) or `payroll` (Weekly, with manual months containing ISO weeks).
  Calendar groups classes by their explicit `ALL_ATT.forMonth` or their VLAT
  `start` (legacy `datetime`). Invalid month links fall back to the scheduled
  month and show a toolbar warning. A payment’s valid
  `Transactions.forMonth` link to `MonthRegistry` overrides its cash month, even
  when `forWeek` is also set. Keep the original cash date, signed amount, and
  payment count. Blank links use the VLAT cash month. Invalid assignments keep
  their cash month and show a toolbar warning. Failed registry reads leave
  payment totals unavailable. Salaries derives grouping and ignores saved
  `groupBy`.
  `widgets/salaries/periods.js` builds the period model; `payroll.js` handles
  preferences and shared registry writes; `period-controls.js` supplies one
  non-blocking month picker. `payment-periods.js` provides the per-record
  period editor for both ALL_ATT and Transactions. Sprints does not load these payroll scripts.
- Salaries uses one `forMonth` and one `forWeek` after `count` for both row
  types. Each appears when either source provides it. The row determines the
  table for picker writes and history. Migrate saved layout and sorting from
  the old payment IDs `salary_forMonth` and `salary_forWeek` to the shared
  field names. Keep the first saved position of each pair. When both sources
  have explicit width or visibility settings, use the class field's setting.
  Grist can mark fresh, typed Attendance period references as formula columns
  with an empty formula string. Allow the first explicit assignment through
  the picker, paste or fill. Grist promotes the column to data on that write.
  Keep populated formulas read-only and omit untouched empty period fields
  when duplicating a class or replaying its creation.
  A save, clear, Undo or Redo regroups the edited row.
  Calendar reads payment week labels
  on demand when the column is visible. Label failures preserve payment grouping
  and fall back to raw IDs.
- Calendar loads `MonthRegistry` on demand for matching explicit month links.
  Payroll shares that cache and also loads `WeekRegistry`. Refresh payments
  invalidates both. Keep generation guards and await every sibling read.
  Period ends are exclusive. Weeks run Monday to Monday and months run from
  the first day to the first day of the next month.
  In Weekly, valid `Transactions.forWeek` and `Transactions.forMonth` together
  place a payment in that week under its explicit month, including when the
  registry week has a different month or none. The same week can appear under
  multiple months. Count each payment once and preserve its cash date and
  signed amount. Month-only payments use Monthly items. Payments with neither
  link or an invalid period assignment go to Needs review.
- Keep raw class period IDs alongside rendered labels. In Weekly, a valid
  `ALL_ATT.forWeek` overrides the scheduled VLAT week and `ALL_ATT.forMonth`
  overrides its parent month for that class. With a month assignment and no
  scheduled or assigned week, use Monthly items. Invalid supplied registry links
  go to Needs review. Preserve start, wage and count. Period edits and history
  must target the source table even when class and payment row IDs coincide.
- Classes and payments with a week and an empty month take their month from
  `WeekRegistry.forMonth` (editable `Ref:MonthRegistry`).
  A blank week month places these rows under Unassigned month. Never infer or
  write this shared default from a transaction's date or explicit month.
  Show the shared month picker on week groups with rows using that default.
  It writes raw IDs to WeekRegistry only, fresh-reads metadata and value,
  rejects stale selections and newer assignments during history replay, and
  preserves real API errors.
- Payroll parents aggregate children without duplicate row tables. Collapsed
  periods render no row DOM; collapse preferences have a separate saved set so
  delayed automatic calendar grouping cannot erase them. Date edits, paste,
  and history reveal the selected row's destination week and month. In both
  Salaries views, the footer adds a blank lesson for a single selected teacher
  using that teacher's raw ID and the last date of the displayed month. DateTime
  starts at midnight in VLAT. Payment-only groups in a dated month support
  the same action. Use class period links to preserve the Weekly placement.
  Reload linked Attendance after creation and history replay. Staff office
  hours use ordinary Attendance wages. `tests/salaries-periods.test.js` covers
  Calendar overrides, grouping, links, lazy rows, registry edits and history,
  failures, races, work editing and creation, and saved settings.

- Attendance datetime is renamed to start (same column reference). End is an
  editable DateTime:Asia/Vladivostok data column, initialized to start + 1 hour
  for existing dated rows. Its trigger formula preserves value or supplies
  start + datetime.timedelta(hours=1), with recalcWhen 0 and recalcDeps on
  start; new/initially undated rows receive the same default when start is set.
  Existing custom ends remain editable and do not move on later start edits.
- Document history formulas FOLKS.lastClass/lastSprint use indexed
  ALL_ATT.lookupRecords(student=CONTAINS($id)) instead of scanning ALL_ATT.all
  for every person. PERFORMANCE.lastClass/lastYearClasses use t/group2
  lookups; counts exclude overlapping row IDs. Direct lookup comprehensions
  preserve Grist's record-type inference during future column renames.
  All 2836 history results and 89 summary lastClass values were checked
  against the document backup after this migration.
- Native RenameColumn can miss row attributes reached through Python
  containers or summary RefLists. Inspect dependent formulas after a rename,
  including Attendance-derived summary lastClass formulas; do not assume
  every r.datetime became r.start. Keep the datetime Python module and
  Transactions.datetime unchanged.
- Shared dateTimeStartColumn() accepts legacy datetime and start (exact then
  case-insensitive, legacy priority when both exist). Both grouped widgets
  migrate saved row sorting, order, widths, visibility, and editing preferences
  after a rename. Sprints also migrates saved date grouping. Keep unavailable
  saved order slots until metadata can identify renamed fields. Filters migrates
  saved date conditions.
  Transactions.datetime stays unchanged and payment rows appear under start.
  tests/start-columns.test.js covers defaults, delayed metadata, migration,
  ledger dates, and editable start/end picker writes in both widgets.

- Resolve teacher columns independently with `salaryTeacherColumn()`: legacy
  performance first, then per, then t. The current class field is ALL_ATT.t;
  Transactions still uses performance. Payment matching, summary selection,
  reference labels, and class writes use the actual source field IDs. Saved
  order/width/visibility/editing and row-sort preferences follow the renamed
  teacher field when exactly one recognized teacher field remains; explicit
  replacement settings win and coexisting fields keep independent settings.
  Teacher selection signatures include all three aliases so changing t does
  not preserve a draft from the previously selected teacher. Metadata is
  cached, so reload after source schema changes.
  `tests/salaries-teacher-columns.test.js` covers mixed schemas, migration,
  raw-reference writes, payment-only teachers, and failure handling.

- Salaries' canonical order is start (or legacy datetime), t (label per; legacy per/performance), student (or legacy
  students), notes, wage, salary_received (label paid), count,
  forMonth, forWeek, sprint, attach_payment, then other fields. Saved orders win; Reset column layout restores
  the configured default. Keep source field IDs unchanged for options/writes.
  Per defaults to 48px; wage, paid, and count default to 64px;
  saved widths win. Month headers also show the signed class count sum.

- Numeric cells, inline number editors, and group totals align to the right
  in both grouped widgets. Header labels are left-aligned, with the sort button
  on the right. `formatNumberValue()` in shared core formats plain numbers
  without grouping separators. Editor and clipboard values retain source
  precision. Keep numeric styling off Date/DateTime cells.
- Salary payment rows show optional `Transactions.notes` as escaped, clipped
  read-only text with the complete note in its tooltip, independently of the
  Attendance notes column's type. Prefer the visible `start` (legacy `datetime`) column for
  payment dates when the monthly grouping helper is hidden.

- Salaries matches scalar and list teacher references in Transactions, including
  typed wrappers. Tagged `transfer_out` records in the combined ledger count
  as received; each payment displays its own complete teacher list.
- Both grouped widgets support writable Reference/Reference List copy, paste,
  and fill. Resolve copied names or external names/#IDs against fresh choices,
  keep comma-containing labels separate, and reject ambiguous names or links
  to a different target table. Read original raw IDs for Undo/Redo, share reads
  within a range, and cancel pending pastes after selection changes. Formula
  and payment fields are excluded from range writes. `tests/linked-cells.test.js` covers both
  widgets and the current uppercase PERFORMANCE/ALL_ATT ledger schema.

- Salaries resolves its configured `All_att` class table ID from metadata:
  exact match first, then a unique case-insensitive match (currently `ALL_ATT`).
  Reads, writable metadata, reference source records, and every class write
  use that resolved ID. Missing or ambiguous IDs surface the error and block
  writes. Reuse the metadata read rather than fetching it again for resolution.
  `tests/salaries-table-id.test.js` covers teacher, summary, and direct class
  selections after capitalization changes, exact-match priority, and write targets.

- `filters.html` is a read-only companion on the same student summary as the
  native table. It publishes matching summary IDs with `setSelectedRows`;
  the link chain is Filters → native summary → Sprints. Keep Filters unlinked
  upstream. Native filters intersect with this selection.
- The filter also works on ungrouped `All_att`, publishing matching attendance
  row IDs. Counts always represent source records. Keep one active data load
  and only the newest waiting refresh; await every sibling read even after a
  failure. Selection signatures use table ID and the sorted matching ID set,
  with generations rejecting acknowledgements from old sources/link states.
  When a host supplies `settings.linking.asTarget`, pause publication for an
  incoming link and show Check linking; older hosts remain supported.
- Progressive name search, typed Match all/any conditions, and five recent
  students share `shared/base.css`. Saved conditions/name field/navigation
  group are section options; query and active recent selection are temporary.
  A recent chip selects by stable raw student identity and pauses conditions
  until normal search or condition editing resumes.
- Sprints reports a single common student to `shared/navigation.js` only when
  a companion connects. BroadcastChannel is scoped by document, embedding
  origin, and navigation group; personal recents use browser storage, never
  shared options. Use the same hosting origin and navigation group for a pair.
  Raw reads are race-safe and repeated class refreshes do not reorder recents.
  Salaries does not participate in student navigation.
- Date helpers now live in `shared/dates.js`, loaded before `shared/core.js`
  in both grouped widgets. `WIDGET_VERSION` remains in core. Filters uses a
  synchronized version marker on its entry shell and never loads grouped core.
- `tests/filters.test.js` and `tests/navigation.test.js` cover selection,
  history, ID/label isolation, saved preferences, dates, stale loads, and focus.

- Live widget: `sprints.html` (grouped view: collapsible groups, automatic
  numeric header sums, group-aware footer row creation, grip selection + bulk
  actions, drag between groups, inline text/DateTime editing, adjustable
  columns, diagnostics panel).
- `index.html` gallery lists all three active widgets.
- With no valid saved grouping, Sprints picks the `sprint` column ID (exact,
  then case-insensitive), including plain Text. Only if absent does it fall
  back to the first single-value Choice column. Valid saved groupings win;
  Salaries keeps its monthly Date/DateTime default.
- Sprints footer creation inherits the common visible student via a typed, unexpanded
  source record, as well as the clicked sprint. Grist's outer Select By filter
  does not automatically supply fields for custom-widget AddRecord actions.
- Cell ranges support Shift-click, Shift+arrows, drag selection, and rectangular
  clipboard blocks. Session history includes range pastes and footer row creation.
- Visible writable Text/Choice grouping cells edit automatically in the shared
  in-cell editor. Saving moves the row into the matching group or creates a new
  one; clearing uses the empty group. Group edits, paste/fill, and Undo/Redo
  clear stale cell ranges and reveal the selected moved row, including collapsed
  destinations. Ordinary Text editing preferences remain respected.
- Right-click menus target whole rows covered by a cell range or grip selection;
  duplicate/delete reuse existing API helpers (not session-undoable yet).
  Menu deletion takes one click; inline and bottom-bar deletion remain two-step.
- Writable Int/Numeric and enabled Text/Choice cells edit in place: typing replaces, second click
  places the caret, Enter/click-away saves, Tab saves and moves, Escape cancels.
  Preserve drafts across render() and keep native input events out of cell-range
  handlers. Text uses a compact textarea with native selection and clipboard;
  Shift+Enter inserts a line break, and Ctrl/Cmd+Enter also saves. The same
  editor serves Sprints and Salaries. Unchanged linked Salaries selections
  preserve drafts during class refreshes; a changed selection closes them.
  Session history remains supported; formulas stay read-only. Header totals
  align to the column content edge.
- DateTime display/edit/clipboard and calendar grouping use Asia/Vladivostok;
  storage stays UTC. Use dateTimeWallDate/formatDateTimeSec/parseDateTimeWallSec
  for local clock conversion; keep Date-only fields on their existing UTC path.
  DateTime cells and clipboard text include the VLAT weekday, for example
  `2026-10-10 15:00 (Sat)`. DateTime paste accepts this weekday suffix as well
  as the existing ISO and plain date/time formats.
  Open DateTime pickers reanchor after renders, preserving their date/time draft
  through refreshes, scroll, and resize. Removed or hidden target cells close them.
  Clicking outside saves the chosen date/time; OK also saves and uses the same
  neutral button style as Cancel. Cancel and Escape discard the draft.
- Group and row sorts are independent. Both widgets use the right-hand header
  buttons to sort within each group. Click a column to sort ascending, then
  toggle between ascending and descending. Salaries sorts class and payment
  rows together. Row sort is a persisted section option
  (`rowSort: {column, direction}`), view-only, stable, and empty-last. With no
  saved sort, both widgets default to `start` (legacy `datetime`) descending
  after options, metadata, and columns are ready and save the default once.
  If neither field exists or a legacy saved option has an empty column, rows
  start in incoming order until a sort is selected.
- The toolbar and its settings scroll with the rows in both grouped widgets.
  The column strip sticks at the top once reached. Column names, drag
  reordering, keyboard reordering, and resize handles live there.
  The toolbar Columns popover offers visibility switches and drag grips for
  every field, including hidden fields. Its search matches labels and field
  IDs. Alt+Up/Down reorders among the matching fields. Column visibility and full order persist per widget section;
  hidden fields keep their position. The grouped field in Sprints starts
  visible; explicitly saved visibility choices remain respected. At least one
  data column stays visible. Reset column layout restores order, widths, and visibility.
  The grip header cell contains a single expand/collapse-all toggle. Its next
  action follows the visible groups, including mixed open and closed states.
  The top control and group headers share one caret icon; their centers align
  with the 46px grip column, pointing down when open and right when collapsed.
  Each group header puts its count after the group name, before aligned totals.
  Group footers keep only the add-row control. Horizontal scrolling and header
  totals align with the strip. The only visible horizontal scrollbar stays at
  the bottom of the widget viewport; its width follows the header's usable
  width, and group tables follow it without extra horizontal bars. Horizontal
  wheel and Shift+wheel gestures anywhere in the widget move that scrollbar.
  The strip and group cards align with the content edges. Counts sit in the
  toolbar.
- Automatic column widths are measured once per render and date group labels
  once per distinct bucket. Salary reference labels share metadata and target
  table fetches within one selection, while editor choices remain fresh.
  Payment loading skips a second `All_att` fetch when the selected summary
  already identifies the teacher and avoids an immediate duplicate render.
- Notifications use a persistent, fixed bottom-right live region outside
  `#content`; never put feedback in table flow or steal cell focus.
- Test suite: `tests/sprints.test.js`, 65 checks, green.
- `tests/sprints-editing.test.js` adds 27 checks with writable notes, Reference
  and Reference List metadata, formula protection, saved preferences, stale
  picker loads, and grouped Text/Choice editing, movement, history, paste,
  default visibility, saved visibility reloads, column layout reset, and
  automatic Sprint grouping with saved preferences and startup ordering.
- `tests/salaries.test.js` covers linked teacher matching, VLAT month boundaries,
  expense-only months, refresh, and failed expense fetches.
- `tests/salaries-selection.test.js` covers direct teacher selection, shared
  class references, payment-only teachers, original class edit IDs, and stale
  selection loads and adding the first class for a payment-only teacher.
- `tests/row-sort-default.test.js` covers default DateTime sorting, startup
  ordering, saved/manual choices, empty selections, and reloads in both widgets.
- `tests/date-picker-refresh.test.js` covers DateTime drafts through refreshes,
  scroll/resize, saving to the original class, click-away saves, neutral OK,
  Cancel/Escape, duplicate pending writes, failed saves, and removed/hidden targets.
- Payment rows have selector grips with single, additive, and range selection;
  keep them out of Attendance drag, edit, duplicate, and delete operations.
  Clicking the sole selected grip again clears selection in both widgets.
- Reference and Reference List cells share the light linked-record pill style
  from `shared/base.css`. Keep list labels as distinct items, including labels
  containing commas, and apply the same style to the linked teacher on each
  payment row. A payment row displays its own teacher reference.
- Both widgets load `shared/references.js` before the grouped app. Writable
  Reference and Reference List fields use the same picker, table adapters,
  raw IDs, and session history. New Sprints sections enable writable `notes`
  (or legacy `C`) Text editing by default; saved Text editing choices remain
  respected. A saved enabled `C` migrates to `notes` only if `C` is absent.
  Values have their own clipping wrappers so selected cells can show the fill
  handle without long text spilling into neighboring columns.
- Salaries follows the selected summary `group` links to `All_att` class rows,
  retaining Select By filtering and expanded Reference labels. Writable Text,
  Choice, Numeric/Int, DateTime, Bool, and Reference columns have in-widget
  editing; Reference List columns use multi-select editing. Formula columns
  remain read-only. Saved column order survives options
  arriving before records.
