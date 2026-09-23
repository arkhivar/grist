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
  core.js                # UI strings (T), shared state, date helpers, Grist helpers
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

## Grist quirks we learned the hard way (do not rediscover)

- **Date/DateTime cells** arrive as epoch seconds (UTC), as ISO 8601 strings,
  OR as **object wrappers whose `String()` is the ISO text**. Always go through
  `parseDateValueSec()` / `formatUtcDateSec()` in `shared/core.js`; never
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

`salaries.html` uses the shared grouped-table app. Linked `All_att` summary
rows supply `group` RefLists of original `All_att` row IDs (`Attendance` is the
display label; `All_att` is the table ID). The widget reads those class rows
with `fetchTable`, displays their fields, and writes class edits to `All_att`.
It reads `Expenses` with `fetchTable`,
matches raw `performance` Reference IDs from the selected summary rows against
Expenses (`All_att.performance` is a RefList), and
groups payments using `Expenses.date` in Vladivostok time. Every expense with
a teacher reference counts as salary received. Month headers show the signed
`wage` subtotal and `amount` payment subtotal over their columns; class and
payment rows share one table grid with income and expenses columns. Payment
rows are read-only and a toolbar button re-fetches Expenses after edits there. Keep
selection changes race-safe and never treat a failed expense fetch as zero
payments.

## Current state (v7.29)

- Live widget: `sprints.html` (grouped view: collapsible groups, automatic
  numeric header sums, group-aware footer row creation, grip selection + bulk
  actions, drag between groups, inline text/DateTime editing, adjustable
  columns, diagnostics panel).
- `index.html` gallery lists both active widgets.
- Footer creation inherits the common visible student via a typed, unexpanded
  source record, as well as the clicked sprint. Grist's outer Select By filter
  does not automatically supply fields for custom-widget AddRecord actions.
- Cell ranges support Shift-click, Shift+arrows, drag selection, and rectangular
  clipboard blocks. Session history includes range pastes and footer row creation.
- Right-click menus target whole rows covered by a cell range or grip selection;
  duplicate/delete reuse existing API helpers (not session-undoable yet).
  Menu deletion takes one click; inline and bottom-bar deletion remain two-step.
- Writable Int/Numeric cells edit in place: typing replaces, second click
  places the caret, Enter/click-away saves, Tab saves and moves, Escape cancels.
  Preserve drafts across render() and keep native input events out of cell-range
  handlers. Enabled Text cells open their popover on typing or second click.
  Session history remains supported; formulas stay read-only. Header totals
  align to the column content edge.
- DateTime display/edit/clipboard and calendar grouping use Asia/Vladivostok;
  storage stays UTC. Use dateTimeWallDate/formatDateTimeSec/parseDateTimeWallSec
  for local clock conversion; keep Date-only fields on their existing UTC path.
- Sort groups and Sort rows are independent. Row sort is a persisted section
  option (`rowSort: {column, direction}`), view-only, stable, and empty-last.
- Notifications use a persistent, fixed bottom-right live region outside
  `#content`; never put feedback in table flow or steal cell focus.
- Test suite: `tests/sprints.test.js`, 60 checks, green.
- `tests/salaries.test.js` covers linked teacher matching, VLAT month boundaries,
  expense-only months, refresh, and failed expense fetches.
- Payment rows have selector grips with single, additive, and range selection;
  they stay read-only and cannot be dragged or acted on as Attendance records.
  Clicking the sole selected grip again clears selection in both widgets.
- Salaries follows the selected summary `group` links to `All_att` class rows,
  retaining Select By filtering and expanded Reference labels. Writable Text,
  Choice, Numeric/Int, DateTime, Bool, and Reference columns have in-widget
  editing; Reference List columns use multi-select editing. Formula columns
  remain read-only. Saved column order survives options
  arriving before records.
