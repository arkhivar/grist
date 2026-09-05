# Architecture and capability boundaries

This note exists so future development sessions can recover the widget's
architecture without rediscovering how Grist and GitHub Pages divide the work.

## Release numbering

The version is a display/cache identifier rather than strict semantic
versioning. Starting after v6.7, small releases use `6.71`, `6.72`, `6.73`, and
so on. From v7.01 on, releases keep two decimal digits (`7.01`, `7.02`, …).
A release must update both `WIDGET_VERSION` in `shared/core.js` and all four
`?v=` asset keys in `sprints.html`; otherwise GitHub Pages or an embedding
browser may continue serving an older script or stylesheet.

## What runs where

| Layer | Responsibility |
|---|---|
| GitHub Pages | Serves the static HTML, CSS, and JavaScript. It has no database, background worker, or secret storage. |
| Widget iframe | Renders the interface, reacts to pointer/keyboard events, computes groups and sums, and calls the Grist plugin API. |
| Grist plugin bridge | Connects the iframe to the containing document, subject to the widget's granted access level. |
| Grist document | Stores records, formulas, references, attachments, and saved widget options. It is the backend for this widget. |
| Optional external service | Needed for secret API keys, AI calls, long-running jobs, scheduled work, large-file processing, or integrations outside Grist. |

The production widget imports Grist's bridge from
`https://docs.getgrist.com/grist-plugin-api.js`. Full access lets the widget
read and modify document data; access should only be granted to trusted widget
code. See Grist's [Custom Widget documentation](https://support.getgrist.com/widget-custom/).

## Startup lifecycle

Grist delivers the following independently; their callback order is not
guaranteed:

1. `grist.onOptions(...)` supplies saved widget options and interaction details.
2. `grist.onRecords(...)` supplies the records selected for this widget.
3. Metadata calls such as `grist.docApi.fetchTable(...)` supply real column
   datatypes and formula/writability information.

Code that depends on more than one source must wait for every required source.
For example, automatic grouping waits for options, records, and metadata so it
can choose a real single-value `Choice` column without overwriting a valid
saved grouping or mistaking `ChoiceList` for `Choice`.

## Runtime API map

| API | Purpose in this widget |
|---|---|
| `grist.ready({requiredAccess: 'full'})` | Declares that editing, duplication, deletion, and cross-group moves need Full access. |
| `grist.onRecords(callback)` | Receives the currently selected/filtered/linked records and rerenders the groups. |
| `grist.onOptions(callback)` | Receives saved widget options on startup and whenever Grist changes or clears them. The second argument reports the granted access level. |
| `grist.setOption(key, value)` | Writes compact per-widget-section configuration such as grouping, sorting, and column layout. |
| `grist.selectedTable.getTableId()` | Resolves the table backing this widget instance. |
| `grist.selectedTable.create(...)` | Duplicates records using writable fields and the source `manualSort` value. |
| `grist.selectedTable.update(...)` | Saves edited cells and changes a grouping value after a cross-group drop. |
| `grist.selectedTable.destroy(...)` | Deletes one or more confirmed records. |
| `grist.docApi.fetchTable(...)` | Reads Grist metadata tables to discover exact column types, formulas, and writability. |
| `grist.docApi.applyUserActions(...)` | Available for future multi-table or lower-level document actions that do not fit `selectedTable`. |

Metadata detection reads `_grist_Tables` to find the selected table reference
and `_grist_Tables_column` to map `colId`, `type`, and `isFormula`. Never infer
writability only from the displayed cell value: a text-looking column may be a
formula, reference, lookup, or encoded Grist type.

## Persistence

Widget configuration is not stored in this repository or in browser cookies.
It is stored by Grist as JSON options belonging to the particular custom-widget
section. The write/read pattern is:

```js
await grist.setOption('groupBy', groupBy);

grist.onOptions((options) => {
  if (options && options.groupBy) groupBy = options.groupBy;
});
```

After an option changes, Grist may show its green **Save** control. Applying
that change commits the section configuration to the document and makes it
available to collaborators. A second widget using the same GitHub Pages URL
has its own options because persistence belongs to the widget section, not the
URL. See the official [Widget options API](https://support.getgrist.com/code/interfaces/grist_plugin_api.WidgetAPI/).

Current option schema:

| Key | Stored representation | Meaning |
|---|---|---|
| `groupBy` | string | Column ID, optionally with a date granularity suffix such as `date::month`. |
| `sortMode` | string | `alpha-desc`, `alpha-asc`, `count-desc`, or `count-asc`. |
| `boolFmtKey` | string | Selected Boolean rendering preset. |
| `limitMaxH` | Boolean | Whether each expanded group receives a height cap. |
| `maxGroupH` | number | Height cap in pixels when enabled. |
| `editableColumns` | JSON-encoded string array | Writable Text columns enabled for the large editor. |
| `columnOrder` | JSON-encoded string array | Shared visible-column order for every group table. |
| `columnWidths` | JSON-encoded object | Column ID to pixel width; clamped again when loaded. |

Currently session-only:

- selected record IDs;
- expanded/collapsed groups;
- open editor state;
- drag state and transient animations.

Widget options are suitable for compact configuration, not business records,
logs, media, or secrets. Those belong in Grist tables or an external service.

### Three different save paths

1. **Record data** — calls to `selectedTable.create/update/destroy` modify Grist
   rows immediately after the returned promise succeeds. They are not widget
   options and do not wait for the green view-configuration Save button.
2. **Widget configuration** — `setOption` changes this section's view state.
   Grist may present the change as pending until the user applies the green
   **Save** control; once applied, collaborators receive it through `onOptions`.
3. **Session-only interaction state** — selection, collapsed groups, drag
   previews, open editors, and animations live only in JavaScript memory and
   intentionally disappear on reload.

When an optimistic local update is useful for responsiveness, the Grist write
must still be awaited first or have an explicit rollback path. Diagnostics
should record the source record IDs, target fields, and complete API error.

## Data access and writes

- `grist.onRecords(...)` follows the widget's selected table, filters, and
  linking configuration.
- `grist.selectedTable` performs row operations on that selected table.
- `grist.docApi.fetchTable(...)` can read other tables when access allows it.
- `grist.docApi.applyUserActions(...)` can perform document actions when full
  access allows it.
- Grist's REST API can support services operating outside the widget. Prefer
  document-scoped OAuth/connected-app access over embedding an account-wide API
  key. See [REST API usage](https://support.getgrist.com/rest-api/).
- Grist webhooks can notify an external service when rows are added or changed,
  enabling background workflows. See [Webhooks](https://support.getgrist.com/webhooks/).

## Practical boundaries

The iframe can implement almost any ordinary browser interface: dashboards,
calendars, timelines, canvases, charts, rich editors, drag-and-drop workflows,
audio capture, and multi-step tools. Grist remains responsible for document
permissions and data.

Do not put secrets in JavaScript served by GitHub Pages: every visitor can read
them. Calls requiring an AI key, email credential, payment key, or private
third-party token need a small server-side endpoint. Long-running or scheduled
work also needs Grist Automations/webhooks or an external worker because a
widget only runs while its page is open. Large media should normally live in
Grist attachments or object storage, with metadata and URLs stored in tables.

When adding a feature, first decide whether it is:

1. **View/configuration state** → widget options.
2. **School data** → Grist tables and references.
3. **Immediate document interaction** → Grist plugin API.
4. **Secret, scheduled, long-running, or integration work** → external backend
   connected through webhooks or the REST API.
