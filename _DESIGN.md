# Widget design system

## The feel

The widgets should feel like a compact, calm spreadsheet inside Grist. Airtable
and SeaTable are our references for direct cell editing, keyboard navigation,
and grouped records. These grids are for repeated work in small linked panes.
Keep the data in view, make common actions easy to repeat, and give the user a
clear place to resume after every edit.

## Layout and vocabulary

- **Toolbar** is the top row for view controls, status counts, and actions.
  Keep the counts beside **Sort groups** when space allows. Let the toolbar
  wrap in narrow panes and scroll away with the rows. Scrolling back to the
  top reveals it again.
- **Column strip** is the shared sticky header. Column names align left and
  the sort buttons sit right. Click a new column for ascending order and the
  same button to toggle direction. ↑ and ↓ show the active direction. ↕ marks
  other columns. Row sort works within each group, keeps blanks last and
  preserves ties. **Sort groups** controls the order of groups separately.
- **Group header** shows the expand/collapse caret, label, record count, and
  applicable totals. Align totals under their columns so they can be compared
  across groups without expanding them. The caret in the strip expands or
  collapses all groups. Use the group footer’s **+** to add a record in context.
- **Row grips** select whole records. Shift selects a span and Ctrl/Cmd adds
  or removes a row. Selected editable records can be acted on from the bottom
  action bar. Keep grip actions distinct from the rectangular cell selection.
- **Horizontal scrollbar** stays at the bottom of the widget. The strip,
  group tables, and totals share one horizontal position. A sideways trackpad
  gesture or Shift+wheel moves them together.

The **Columns** popover manages visibility and order, including hidden fields.
Drag a header label to reorder it and drag its edge to resize it. The sort
button is its own target. Keep grouping fields visible by default and honor
saved visibility. Save view preferences per Grist widget section so a reload
restores the working layout.

## Visual language

The shared palette uses light neutral surfaces, subtle borders, small radii,
and restrained shadows. IBM Plex Sans serves controls and prose. IBM Plex Mono
helps headers, dates, and figures scan in dense grids. Blue marks selection,
focus, and active controls. Pair state colors with an icon, text, or an
accessible label. See [shared/base.css](shared/base.css) for the tokens.

Right-align numeric cells, inline number editors, and column totals. Show
plain numbers without thousands separators and keep source precision for
editing and copying. Give dates and linked labels their own formatting.
References use light pills, one per linked record. Clip long values inside the
cell and keep the full text available in its editor or tooltip.

Keep routine feedback in the fixed bottom-right toast so a saved change or an
error leaves the grid and focus in place. Show the real Grist error and retain
the draft where the user can correct or retry it. Use motion to show where a
record moved or appeared and respect reduced-motion preferences.

## Editing and selection

A first click selects a cell. Once selected, one ordinary click in editable
Text, Choice, or numeric content opens the in-cell editor and puts the caret
where the user clicked. Typing on a selected cell replaces its value. Preserve
the draft, caret, and scroll position when refreshing the same selection.
Native text selection and clipboard behavior belong inside the editor. The
grid owns rectangular selection, clipboard blocks, and vertical fill from
the blue handle.

Use anchored, non-blocking pickers for DateTime and linked records. The
DateTime picker pairs a Monday-first calendar with a time rail. **OK** or
clicking elsewhere saves the selected value. **Cancel** or **Escape** discards
it. Display and edit DateTime in Vladivostok time (VLAT), including the local
weekday on the grid and clipboard. Grist stores UTC values. Date-only fields
use their UTC calendar date. A single Reference choice saves on selection.
Reference Lists collect the selected pills and commit with **Save**. Formula
cells and Salaries payment rows are read-only.

Session Undo and Redo cover cell edits, paste, fill, and rows added from a group
footer. A range operation is one history step. Grist’s document history handles
changes beyond this widget session.

## Keyboard shortcuts

| Where | Keys | Action |
|---|---|---|
| Grid selection | Arrow keys | Move to the next visible cell |
| Grid selection | Shift + Arrow keys | Extend the rectangular selection |
| Selected editable cell | Enter or F2 | Open the editor with the current value |
| Selected inline-editable cell | Type | Start editing with a replacement value |
| Inline editor | Enter or Ctrl/Cmd + Enter | Save the draft |
| Inline editor | Tab / Shift + Tab | Save and move right / left |
| Text or Choice editor | Shift + Enter | Insert a line break |
| In-cell editor or picker | Escape | Discard the draft and close the editor |
| DateTime calendar | Arrow keys / Page Up or Down | Move by day or week / change month |
| Selected cell or range | Ctrl/Cmd + C or V | Copy or paste compatible data |
| Grid history | Ctrl/Cmd + Z | Undo the last widget operation |
| Grid history | Ctrl/Cmd + Y or Ctrl/Cmd + Shift + Z | Redo |
| Focused column header | Alt + Left / Right | Reorder the column |
| Focused resize edge | Left / Right, with Shift for a larger step | Resize the column |
| Focused resize edge | Home or Delete | Restore automatic width |
| Focused grip in **Columns** | Alt + Up / Down | Reorder the field, including hidden fields |
| Selected cell or row grip | Shift + F10 or the Context Menu key | Open the row actions menu |
| Filters name search | Escape | Clear the query or active recent-student choice |

## Widget-specific choices

- **Sprints** starts with `sprint` grouping when available and puts group
  configuration in the toolbar. Editing a writable Text or single Choice
  grouping cell moves the row to its destination. Dragging a row grip between
  groups is available for those field types. Sprints enables writable `notes`
  or legacy `C` for new sections and lets users configure other Text fields.
- **Salaries** offers **Calendar months** for actual class and transaction dates
  and **Months & weeks** for assigned payroll periods. Classes and payments
  use the same grid and sort within each group. Earned wages, received payments,
  and class counts each have their own aligned subtotal. Payment grips select
  ledger rows. Edit payments in Transactions and use **Refresh payments** to
  update Salaries.
- **Filters** uses the same typography, colors, and compact controls for
  live name search, typed conditions, and recent-student chips. It links
  matching rows into Grist’s selection chain. Recent students are personal to
  the browser and scoped to the document.

For setup and field-specific editing steps, see [README.md](README.md).
For data access and saved option ownership, see [_ARCHITECTURE.md](_ARCHITECTURE.md).
