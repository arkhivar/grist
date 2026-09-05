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
  acceptable to the owner; keep commits small and one-purpose.
- CI: `.github/workflows/test.yml` runs `npm ci` and `npm test` on every push
  and pull request.
- When serving from the owner's VPS instead of Pages: the widget files are
  plain static files — point the web server at the checkout and update the
  custom-widget URL in the Grist doc accordingly (fresh widget instance, see
  the options note above).

## Next widget in the queue: `salaries.html`

Purpose: teacher salary counter. Monthly grouped class records (from the
attendance/classes table) with extra computed columns, plus linked rows from
the `all expenses` table (salary expenses marked per teacher). Planned data
flow: primary table via `onRecords` + `grist.docApi.fetchTable('all expenses')`
for the linked expenses; teacher matching should prefer a Reference column to
a Teachers table, with a Text/Choice initials column as fallback.
**Open questions for the owner before building**: exact table/column names,
rate column, expense amount column, teacher marker type, and whether expenses
render as rows inside month groups or only contribute to totals.

## Current state (v7.02)

- Live widget: `sprints.html` (grouped view: collapsible groups, automatic
  numeric sums, grip selection + bulk actions, drag between groups, inline
  text/DateTime editing, adjustable columns, diagnostics panel).
- `index.html` gallery lists the family; `salaries.html` is a clear
  coming-soon page rather than an empty endpoint.
- Test suite: `tests/sprints.test.js`, 15 checks, green.
