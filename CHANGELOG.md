# Changelog

All notable changes to the widgets in this repo (formerly the grist-sprints grouped-view widget).

## v7.01 — 2026-09-05

- The repository is renamed `arkhivar/grist-sprints` → **`arkhivar/grist`**:
  it now hosts a widget family, and "sprints" is one widget in it.
- The grouped-view widget's entry page is renamed `groups.html` →
  **`sprints.html`**; `groups.html` and `widget_groupes.html` both remain as
  redirect stubs. New Pages URL: `https://arkhivar.github.io/grist/sprints.html`.
- Per-widget code moves to `widgets/sprints/`; the test suite is
  `tests/sprints.test.js`; `index.html` links updated (`sprints.html` live,
  `salaries.html` planned).
- Version numbers keep two decimal digits from now on (7.01, 7.02, …).

## v7.0 — 2026-08-15

- Restructure the repo into a monorepo for a multi-widget family: shared code
  moves to `shared/` (`core.js`, `base.css`), per-widget code to
  `widgets/<name>/` (`widgets/groups/app.js`, `widgets/groups/actions.js`),
  and each widget gets its own suite under `tests/` (`tests/groups.test.js`).
- Update asset paths in `groups.html` and bump all cache keys to `?v=7.0`;
  the live embed URL `groups.html` stays at the repo root, unchanged.
- Add `index.html`, a lightweight gallery listing every widget in the repo.
- Zero behavior change: files were moved, not modified (only the
  `WIDGET_VERSION` constant and asset paths changed).

## v6.72 — 2026-08-15

- Add a committed jsdom test suite (`tests/widget.test.js`, no test framework)
  covering date rendering (ISO strings, object-wrapped values, epoch seconds,
  invisible-character pollution), grip selection, row actions (duplicate
  payload, two-step delete), automatic group sums, and the diagnostics panel.
- Add `package.json` (`npm test`) and a GitHub Actions workflow
  (`.github/workflows/test.yml`) running the suite on every push and PR to
  `main`.

## v6.71 — 2026-08-01

- Adopt the three-digit `6.7x` release sequence so small iterations can advance
  through `6.71`, `6.72`, and so on without racing toward v7.
- Expand `ARCHITECTURE.md` with the concrete Grist APIs, persisted option keys,
  record-write lifecycle, metadata tables, and state ownership boundaries.
- Extend `ROADMAP.md` with long-horizon school products, clearly separating
  Grist + GitHub Pages projects from ideas that require external services.
- Bump the live widget badge and every static asset cache key to v6.71.

## v6.7 — 2026-08-01

- Automatically group by the first visible single-value Grist `Choice` column
  when there is no valid saved grouping, and persist that selection so the
  widget opens with data instead of an empty prompt.
- Wait for saved options, records, and real Grist column metadata before
  applying the fallback, preserving every valid grouping the user selected.
- Make alphabetical Z→A the default group sort while preserving any explicitly
  saved sort order, and bump static asset cache keys.

## v6.6 — 2026-07-31

- Fix the visible grip extending into a neighboring table cell's pointer area
  in some layouts by widening and fixing the selection/drag column.
- Make drag initiation more robust with a larger grip hit area, immediate
  pressed/grabbed feedback, a lower movement threshold, explicit pointer
  cleanup, and prevention of native browser drag interference.
- Track pointer movement even on selection-only grips. If the current grouping
  is not eligible for moves, a drag attempt now reports the exact reason in a
  toast and Diagnostics instead of silently doing nothing.
- Add a detailed disabled reason for read-only, date-bucket, Date/DateTime, and
  unsupported grouping types, and bump static asset cache keys.

## v6.5 — 2026-07-31

- Make a plain row-grip click select only that record, clearing the previous
  selection so selection no longer feels unexpectedly sticky.
- Add Ctrl/Cmd-click toggling and Shift-click contiguous range selection;
  Ctrl/Cmd+Shift-click adds a range to the current selection.
- Make dragging an unselected row adopt the same selection model: it becomes
  the sole selection unless Ctrl/Cmd is held, while dragging an already
  selected row still moves the complete selected set.
- Apply the same non-sticky behavior to group select-all grips and bump static
  asset cache keys.

## v6.4 — 2026-07-31

- Replace row and group select-all checkboxes with compact six-dot grip
  controls: click to toggle selection, or drag beyond a small movement
  threshold to start moving records.
- Allow records to move between existing groups only for writable, non-formula,
  non-date `Text` and single-value `Choice` grouping columns.
- Drag an already-selected record to move the complete selection together;
  dragging an unselected record moves only that row.
- Highlight valid destination groups, support collapsed targets and edge
  auto-scrolling, suppress post-drag clicks, and let Escape cancel safely.
- Write the destination group's raw value through one
  `grist.selectedTable.update()` call, including clearing values through the
  `(empty)` group, then refresh counts, sums, sorting, selection, and movement
  feedback after Grist confirms the update.
- Add move eligibility and complete move outcomes to Diagnostics, preserve
  reduced-motion behavior, and document deferred date/Choice List rules in
  `ROADMAP.md`.
- Bumped static asset cache keys so the interaction update loads.

## v6.3 — 2026-07-31

- Animate group cards into their new positions when the Sort control changes,
  so their records visibly travel with the reordered groups instead of jumping.
- Give freshly duplicated rows a short fade/slide entrance and a soft accent
  highlight once Grist sends the created record back through `onRecords`.
- Target duplicate animation by Grist's returned record ID, including bulk
  duplication, so unrelated records never animate.
- Respect the operating system's reduced-motion preference by skipping both
  sorting and duplicate animations.
- Bumped static asset cache keys so the motion update loads.

## v6.2 — 2026-07-31

- Give every group one shared column layout so headers, values, and automatic
  sums stay aligned regardless of long cell content.
- Add drag handles to resize columns across all groups, with 64–520px limits
  and double-click/keyboard reset support.
- Add header drag-and-drop and Alt+Arrow keyboard controls to reorder columns
  across all groups.
- Persist column widths and order through Grist options and add a
  **Reset widths & order** control in settings.
- Synchronize horizontal scrolling between groups and keep automatic sum chips
  aligned with scrolled numeric columns.
- Extend Diagnostics with current order and custom widths.
- Bumped static asset cache keys so the shared layout loads.

## v6.1 — 2026-07-31

- Move automatic numeric sums from the table's column-name row into the
  always-visible group header.
- Align each total horizontally with its corresponding table column and keep
  totals visible while groups are collapsed.
- Re-align totals after rendering, font loading, and window resizing.
- Bumped static asset cache keys so the corrected placement loads.

## v6.0 — 2026-07-31

- Replace configurable aggregate rules with automatic Sum totals for every
  visible Grist Numeric/Int column, including numeric formula columns.
- Show each total directly in its corresponding table-column header with only
  the number—no `Σ`, function name, or repeated column name.
- Remove the Aggregates settings UI, Count/Average/Min/Max implementations,
  aggregate chips, and saved-rule handling.
- Extend metadata diagnostics with declared Grist column types and the columns
  receiving automatic sums.
- Bumped static asset cache keys so the automatic totals load.

## v5.9 — 2026-07-30

- Remove the remaining colored dot from every group header.
- Move the group row-count badge into the dot's former position, immediately
  before the group name; configured aggregate chips remain aligned on the
  right.
- Remove the now-unused automatic color palette and dot styling.
- Bumped static asset cache keys so the new group-header layout loads.

## v5.8 — 2026-07-30

- Keep editable Text previews to one line and truncate overflow with an
  ellipsis, so long notes never increase table row height.
- Detect true writable Grist DateTime columns from table metadata and make
  them editable automatically with a native date-and-time picker.
- Read, write, and display DateTime values consistently in UTC, avoiding
  browser-local timezone shifts.
- Expand Editable Fields settings and Diagnostics to identify automatic
  DateTime editors.
- Bumped static asset cache keys so the compact previews and picker load.

## v5.7 — 2026-07-30

- Add configurable editing for writable Text columns, with `C` enabled by
  default when it is a writable Text field.
- Open editable cells in a deliberately large, nearly full-widget textarea
  suitable for long attendance notes, emojis, and multi-line text.
- Add Save/Cancel controls, live character count, Ctrl/Cmd+Enter save, Escape
  cancel, immediate local refresh, and Grist update diagnostics.
- Exclude formula, non-Text, hidden, and active grouping columns from editing.
- Bumped static asset cache keys so the text editor loads.

## v5.6 — 2026-07-30

- Preserve a duplicated record's Grist `manualSort` position so the copy stays
  beside its source instead of being appended to the bottom of its group.
- Include special columns only while fetching the source record; formula and
  helper columns remain excluded from the created payload.
- Bumped static asset cache keys so the duplicate-order fix loads.

## v5.5 — 2026-07-30

- Normalize typed Grist values before duplication: Ref cells become row IDs,
  RefLists become Grist lists of row IDs, Date/DateTime cells become epoch
  seconds, and lookup wrappers are unwrapped recursively.
- Remove the Group Colors settings UI, saved color options, event handlers,
  and customization styles; groups retain an automatic visual palette.
- Expand Diagnostics to use the freed settings space and show typed versus
  normalized duplicate payload field types.
- Bumped static asset cache keys so the reference-normalization fix loads.

## v5.4 — 2026-07-30

- Fetch duplicate payloads with `cellFormat: "typed"` and unexpanded
  references so Ref/RefList cells stay valid Grist values instead of decoded
  `RecordStub` objects.
- Expand Diagnostics with granted access, selected table ID, writable columns,
  encoded payload types, created/deleted record IDs, recent action status, and
  full API error messages.
- Increase the diagnostics panel height and color-code action outcomes.
- Bumped static asset cache keys so the typed-reference fix loads.

## v5.3 — 2026-07-30

- Duplicate records from raw Grist values and copy only writable columns,
  excluding formula, helper, ID, and manual-sort fields.
- Delete records in one array operation, including single-row deletes, for
  compatibility with TableOperations implementations that reject the scalar
  response after deleting successfully.
- Report the real Grist API error and granted access level instead of showing
  a misleading Full-access message for every action failure.
- Bumped static asset cache keys so the corrected record actions load.

## v5.2 — 2026-07-29

- Format ISO dates supplied by Grist as object-wrapped cell values, rather
  than handling primitive JavaScript strings only.
- Bumped static asset cache keys to ensure the wrapper-aware formatter loads.

## v5.1 — 2026-07-29

- Fixed DateTime epoch values with a non-midnight time rendering as raw
  numbers; Date and DateTime values now share the UTC cell formatter.
- Bumped all static asset URLs so browsers and GitHub Pages cannot reuse a
  cached pre-fix v5 script that still displays ISO transport strings.

## v5.0 — 2026-07-29

### Changed
- **English rebrand** — the widget page is now `groups.html`
  (`<html lang="en">`, English static markup); `widget_groupes.html` becomes
  a tiny redirect stub (`<meta http-equiv="refresh">` + `location.replace`)
  so existing embeds keep working.
- **French localization removed** — the `I18N.fr` dictionary and the
  `navigator.language` switch are gone; `T` is now a flat English-only dict
  and `LOCALE` is fixed to `en-US`. All code comments are in English.

### Added
- **Version badge** in the toolbar (`v5.0`), fed from the new
  `WIDGET_VERSION` constant.
- **Diagnostics section** in the settings panel (⚙): widget version, record
  and column counts, and per-column detection (JS type, date-like yes/no,
  first raw value rendered with `JSON.stringify` so invisible characters
  appear as `\uXXXX` escapes).

### Fixed
- **Widened invisible-character strip** in `parseIsoDateSec` — in addition to
  ZWSP/ZWNJ/ZWJ/word joiner/BOM, the parser now also strips soft hyphen
  (U+00AD), Mongolian vowel separator (U+180E), LRM/RLM (U+200E/U+200F),
  bidi embedding/override controls (U+202A–U+202E), deprecated format
  characters (U+2061–U+2064) and bidi isolates (U+2066–U+2069) before
  matching ISO dates.

## v4.1 — 2026-07-29

### Fixed
- **ISO date parsing hardened** — strings stored by formulas/imports may carry
  invisible artifacts; `parseIsoDateSec` now strips zero-width characters
  (ZWSP U+200B, ZWNJ U+200C, ZWJ U+200D, word joiner U+2060, BOM U+FEFF) and
  normalizes whitespace runs (including non-breaking spaces) before matching.
  Previously such values fell back to raw text in cells and excluded the
  column from date-granularity grouping.
- **Checkboxes render dark in dark-mode browsers** — the widget now declares
  `color-scheme: light` on `:root` so native form controls keep the light
  theme regardless of the OS/browser color scheme.

### Changed
- Cache-buster bumped to `?v=5` on all CSS/JS URLs.
- README gains a **Troubleshooting** section (stale cache, lost widget
  linking after re-adding, wiped per-widget options, Full access requirement,
  dark checkboxes).

## v4 — 2026-07-29

### Added
- **Multi-select bulk actions** (`widget-actions.js`): checkbox column in
  every group table, per-group select-all, and a bottom action bar
  (*N selected — Duplicate selected / Delete selected / Clear*) shown while a
  selection exists. Bulk delete uses the same two-step arm/confirm pattern.
  Selection is pruned automatically when records disappear.
- Cache-busted asset URLs (`?v=4`) so browsers pick up new files reliably.

### Changed
- **Row action buttons (⧉ / ✕) are always visible** (dimmed at rest, full
  opacity on hover/focus) instead of hover-revealed.
- **ISO date cell rendering is per value** — no longer gated on the whole
  column passing the date-like check.
- **Numbers render without thousand separators** (`-1425`, not `-1,425`) in
  cells and aggregate chips; averages still rounded to ≤ 2 decimals.

## v3 — 2026-07-28

### Added
- **Row actions**: duplicate ⧉ / delete ✕ per record (two-step delete with
  4 s auto-disarm) via `grist.selectedTable.create/destroy`; requires
  `requiredAccess: 'full'`.
- **ISO 8601 text date support**: text columns storing ISO strings are
  detected as date-like and get day/month/year grouping; values without a
  timezone designator are treated as UTC.
- **Unlimited group height by default** (no internal scrollbar); optional
  height cap via ⚙ → *Limit group height* (persisted `limitMaxH`).
- Split the single-file widget into `widget.css`, `widget-core.js`,
  `widget-app.js` for maintainability.

## v2 — 2026-07-28

### Fixed
- **Empty GROUP BY dropdown** when the linked/filtered selection returns
  zero records: columns learned from previous non-empty fetches are kept
  (`knownDateCols` persists date-column knowledge), and the column selector
  is rebuilt on every `onRecords` — including empty ones.

## v1 — 2026-07-28

- Fork of
  [maximelacoste/grist-widget-grouped-view](https://github.com/maximelacoste/grist-widget-grouped-view)
  with **aggregate chips in group headers** (count/sum/avg/min/max, persisted
  via `grist.setOption('aggregates', …)`) and full **EN/FR localization**.
- Date-aware grouping (by day/month/year, UTC bucketing, chronological sort)
  for native Grist Date/DateTime columns (epoch seconds).
