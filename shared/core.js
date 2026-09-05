  // ── 1. UI strings (English only — everything depends on T) ──
  const T = {
      groupBy:         'Group by',
      sortBy:          'Sort',
      expandAll:       'Expand all',
      collapseAll:     'Collapse all',
      settingsLabel:   'Display settings',
      chooseCol:       '— choose —',
      sortAlphaAsc:    'A → Z',
      sortAlphaDesc:   'Z → A',
      sortCountDesc:   'Count ↓',
      sortCountAsc:    'Count ↑',
      sectionMaxH:     'Max height per group',
      sectionBool:     'True / false display',
      sectionEditable: 'Editable fields',
      sectionColumns:  'Column layout',
      columnLayoutHint: 'Drag headers to reorder. Drag a header edge to resize; double-click the edge to reset that column.',
      resetColumns:    'Reset widths & order',
      resizeColumn:    'Resize column',
      reorderColumn:   'Drag to reorder column',
      editableHint:    'Choose Text fields. Writable DateTime fields are enabled automatically.',
      editableLoading: 'Loading writable columns…',
      editableNone:    'No writable Text or DateTime fields are visible.',
      editableAuto:    'DateTime · automatic',
      editCell:        'Edit text',
      editDateTime:    'Edit date and time',
      editTitle:       'Edit',
      editRecord:      'Record',
      dateTimeLabel:   'UTC date and time',
      dateTimeHint:    'Stored and displayed in UTC.',
      editCancel:      'Cancel',
      editSave:        'Save changes',
      editShortcut:    'Ctrl/Cmd+Enter to save · Esc to cancel',
      editCharacters:  'characters',
      reset:           'Reset',
      noGroups:        'No groups — choose a grouping column.',
      emptyTitle:      'No column selected',
      emptySub:        'Choose a column in the toolbar above<br>to group records.',
      emptyTitleNoRec: 'No records',
      emptySubNoRec:   'The selected table contains no records.',
      emptyNoDataTitle: 'No records to read columns from',
      emptyNoDataSub:   'The current table or filter returned zero rows.<br>Open an unfiltered view or pick another linked row, then choose a grouping column.',
      groups:          'groups',
      records:         'records',
      record:          'record',
      noOtherCol:      'No other column to display.',
      groupCaption:    'Group:',
      emptyGroup:      '(empty)',
      resetMaxH:       'Reset maximum height',
      boolFormatLabel: 'Boolean format:',
      ariaToolbar:     'Grouping options',
      ariaSettings:    'Display settings',
      ariaContent:     'Record groups',
      ariaGroupRegion: 'Records — ',
      cellEmpty:       'empty value',
      byDay:           'by day',
      byMonth:         'by month',
      byYear:          'by year',
      limitMaxH:       'Limit group height',
      dupRecord:       'Duplicate record',
      delRecord:       'Delete record',
      confirmDel:      'Confirm delete?',
      actionFailed:    'Action failed',
      selCount:        '{n} selected',
      selDup:          'Duplicate selected',
      selDel:          'Delete selected',
      selClear:        'Clear',
      selAll:          'Select all',
      rowGrip:         'Select or drag record',
      rowSelect:       'Select record',
      selectGroup:     'Select all records in this group',
      moveRecords:     'Move records',
      confirmDelSel:   'Confirm deleting the selection?',
      boolTrue:  ['✓ true',  'Yes',   'True',  'true',  '1'],
      boolFalse: ['✗ false', 'No',    'False', 'false', '0'],
      boolLabels: ['✓ / ✗', 'Yes / No', 'True / False', '● badge', '1 / 0'],
  };
  const WIDGET_VERSION = '7.0';
  const LOCALE = 'en-US';

  // ── Dates: Grist sends Date/DateTime as epoch seconds (UTC) ──
  const DATE_EPOCH_MIN = 315532800;    // 1980-01-01T00:00:00Z
  const DATE_EPOCH_MAX = 4102444800;   // 2100-01-01T00:00:00Z
  const DATE_GRANULARITIES = ['day', 'month', 'year'];
  const GRAN_I18N_KEY = { day: 'byDay', month: 'byMonth', year: 'byYear' };

  // ── 2. Constants (use T) ──────────────────────────
  function makeBoolFormats() {
    return [
      { key: 'check', label: T.boolLabels[0],
        t: `<span style="color:#16a34a;font-weight:500">${T.boolTrue[0]}</span>`,
        f: `<span style="color:#dc2626">${T.boolFalse[0]}</span>` },
      { key: 'oui',   label: T.boolLabels[1],
        t: `<span style="color:#16a34a;font-weight:500">${T.boolTrue[1]}</span>`,
        f: `<span style="color:#dc2626">${T.boolFalse[1]}</span>` },
      { key: 'tf',    label: T.boolLabels[2],
        t: `<span style="color:#16a34a;font-weight:500">${T.boolTrue[2]}</span>`,
        f: `<span style="color:#dc2626">${T.boolFalse[2]}</span>` },
      { key: 'badge', label: T.boolLabels[3],
        t: `<span style="display:inline-block;padding:1px 7px;border-radius:9px;background:#dcfce7;color:#166534;font-size:10px;font-weight:600">${T.boolTrue[3]}</span>`,
        f: `<span style="display:inline-block;padding:1px 7px;border-radius:9px;background:#fee2e2;color:#991b1b;font-size:10px;font-weight:600">${T.boolFalse[3]}</span>` },
      { key: 'num',   label: T.boolLabels[4],
        t: '<span class="cell-num">1</span>',
        f: '<span class="cell-num cell-null">0</span>' },
    ];
  }
  const BOOL_FORMATS = makeBoolFormats();

  // ── 3. State ───────────────────────────────────────────────
  let allRecords = [];
  let allColumns = [];
  let knownDateCols = new Set();   // date-like columns already observed (persists across empty fetches)
  let groupBy    = '';
  let sortMode   = 'alpha-desc';
  let optionsLoaded = false;
  let metadataLoaded = false;
  let collapsed  = new Set();
  let boolFmtKey = 'check';
  let maxGroupH  = 200;
  let limitMaxH  = false;          // false = unlimited height (default)
  let dateLikeCache = new Map();   // col → bool, reset on every onRecords
  let grantedAccessLevel = 'unknown';
  let writableColumnIdsPromise = null;
  let selectedTableId = 'unknown';
  let writableColumnIds = [];
  let writableColumnTypes = {};
  let columnTypes = {};
  let columnOrder = [];
  let columnWidths = {};
  let editableColumns = new Set();
  let editableColumnsConfigured = false;
  let editableDefaultsApplied = false;
  let editingCell = null;
  const actionDiagnostics = [];
  const armedDeletes = new Map();  // id (string) → timeoutId, two-step confirmation
  const selectedIds = new Set();   // ids (string) of selected records

  // ── 4. DOM refs ───────────────────────────────────────────
  const groupSelect   = document.getElementById('group-select');
  const sortSelect    = document.getElementById('sort-select');
  const content       = document.getElementById('content');
  const statsbar      = document.getElementById('statsbar');
  const emptyState    = document.getElementById('empty-state');
  const settingsPanel = document.getElementById('settings-panel');
  const btnSettings   = document.getElementById('btn-settings');
  const boolRow       = document.getElementById('bool-row');
  const editableColList = document.getElementById('editable-col-list');
  const btnResetColumns = document.getElementById('btn-reset-columns');
  const cellEditor      = document.getElementById('cell-editor');
  const cellEditorDialog = document.getElementById('cell-editor-dialog');
  const cellEditorTitle = document.getElementById('cell-editor-title');
  const cellEditorMeta  = document.getElementById('cell-editor-meta');
  const cellEditorText  = document.getElementById('cell-editor-text');
  const cellEditorDateTimePanel = document.getElementById('cell-editor-datetime-panel');
  const cellEditorDateTime = document.getElementById('cell-editor-datetime');
  const cellEditorCount = document.getElementById('cell-editor-count');
  const btnEditorClose  = document.getElementById('btn-editor-close');
  const btnEditorCancel = document.getElementById('btn-editor-cancel');
  const btnEditorSave   = document.getElementById('btn-editor-save');
  let   statGroups    = document.getElementById('stat-groups');
  let   statRecords   = document.getElementById('stat-records');

  // ── 5. Apply strings to the static DOM ─────────────────────
  function applyI18nToDOM() {
    document.querySelector('label[for="group-select"]').textContent = T.groupBy;
    document.querySelector('label[for="sort-select"]').textContent  = T.sortBy;
    document.getElementById('btn-expand').textContent               = T.expandAll;
    document.getElementById('btn-collapse').textContent             = T.collapseAll;
    document.getElementById('btn-settings').setAttribute('aria-label', T.settingsLabel);
    document.querySelector('#group-select option').textContent      = T.chooseCol;
    const sortOpts = document.querySelectorAll('#sort-select option');
    sortOpts[0].textContent = T.sortAlphaAsc;
    sortOpts[1].textContent = T.sortAlphaDesc;
    sortOpts[2].textContent = T.sortCountDesc;
    sortOpts[3].textContent = T.sortCountAsc;
    document.getElementById('lbl-limitmaxh-txt').textContent     = T.limitMaxH;
    document.getElementById('maxh-range').setAttribute('aria-label', T.sectionMaxH);
    document.getElementById('lbl-bool').textContent              = T.sectionBool;
    document.getElementById('lbl-editable').textContent          = T.sectionEditable;
    document.getElementById('editable-hint').textContent         = T.editableHint;
    document.getElementById('lbl-column-layout').textContent     = T.sectionColumns;
    document.getElementById('column-layout-hint').textContent    = T.columnLayoutHint;
    document.getElementById('btn-reset-columns').textContent     = T.resetColumns;
    document.documentElement.lang = 'en';
    document.getElementById('btn-reset-maxh').textContent        = T.reset;
    document.getElementById('btn-reset-maxh').setAttribute('aria-label', T.resetMaxH);
    document.querySelector('.toolbar').setAttribute('aria-label', T.ariaToolbar);
    document.getElementById('settings-panel').setAttribute('aria-label', T.ariaSettings);
    document.getElementById('content').setAttribute('aria-label', T.ariaContent);
    // Rewrite the stats spans (preserves the ids)
    const statSpans = document.getElementById('statsbar').querySelectorAll(':scope > span');
    statSpans[0].innerHTML = '<span class="stat-val" id="stat-groups">0</span> ' + T.groups;
    statSpans[2].innerHTML = '<span class="stat-val" id="stat-records">0</span> ' + T.records;
    document.querySelector('.empty-title').textContent = T.emptyTitle;
    document.querySelector('.empty-sub').innerHTML     = T.emptySub;
    // Multi-select action bar (bottom of the window)
    document.getElementById('sel-count-txt').textContent = T.selCount.replace('{n}', '0');
    document.getElementById('btn-sel-dup').textContent   = T.selDup;
    document.getElementById('btn-sel-del').textContent   = T.selDel;
    document.getElementById('btn-sel-clear').textContent = T.selClear;
    document.getElementById('version-badge').textContent = 'v' + WIDGET_VERSION;
    document.getElementById('lbl-diag').textContent = 'Diagnostics';
    document.getElementById('btn-editor-close').setAttribute('aria-label', T.editCancel);
    document.getElementById('btn-editor-cancel').textContent = T.editCancel;
    document.getElementById('btn-editor-save').textContent = T.editSave;
    document.getElementById('cell-editor-shortcut').textContent = T.editShortcut;
    document.querySelector('label[for="cell-editor-datetime"]').textContent = T.dateTimeLabel;
    document.getElementById('cell-editor-datetime-hint').textContent = T.dateTimeHint;
  }
  applyI18nToDOM();
  statGroups  = document.getElementById('stat-groups');
  statRecords = document.getElementById('stat-records');

  // ── 6. Utilities ────────────────────────────────────────
  function hasBoolCol() {
    const groupCol = parseGroupBy(groupBy).col;
    return allColumns.filter(c => c !== groupCol)
      .some(c => allRecords.some(r => typeof r[c] === 'boolean'));
  }

  function refreshBoolSection() {
    const s = document.getElementById('bool-section');
    if (s) s.style.display = hasBoolCol() ? '' : 'none';
  }

  function applyMaxGroupH() {
    const app = document.getElementById('app');
    app.style.setProperty('--max-group-h', maxGroupH + 'px');
    app.classList.toggle('limit-maxh', limitMaxH);
  }

  function updateStickyTop() {
    // No-op (layout is now fixed, kept for compatibility)
  }

  function esc(s) {
    return String(s)
      .replace(/&/g,'&amp;').replace(/</g,'&lt;')
      .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  // ── 6b. Dates: detection, parsing, bucketing ─────────────
  // A column is "date-like" if it has ≥ 1 non-empty value and all of
  // its non-empty values are:
  //  - numbers in the epoch range [1980-01-01, 2100-01-01] UTC
  //    (Grist sends Date/DateTime as seconds), or
  //  - ISO 8601 strings (YYYY-MM-DD with optional time/offset)
  //    that parse into the same range. Strings without a timezone
  //    designator are interpreted as UTC.
  const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?(\s*(Z|[+-]\d{2}:?\d{2}))?)?$/i;

  // ISO string → UTC epoch seconds, or null if invalid / out of range.
  // Tolerant of import / copy-paste artifacts: invisible characters are
  // stripped first (soft hyphen, Mongolian vowel separator, ZWSP/ZWNJ/ZWJ,
  // LRM/RLM, bidi embedding/override/isolate controls, deprecated format
  // chars, word joiner, BOM), then whitespace runs (non-breaking,
  // multiple…) are normalized to a single space.
  function parseIsoDateSec(v) {
    if (typeof v !== 'string') return null;
    let s = v
      .replace(/[\u00AD\u180E\u200B-\u200F\u202A-\u202E\u2060-\u2064\u2066-\u206F\uFEFF]/g, '') // invisible / format characters
      .trim()
      .replace(/\s+/g, ' ');                    // multiple / non-breaking spaces
    if (!ISO_DATE_RE.test(s)) return null;
    s = s.replace(' ', 'T');                       // "YYYY-MM-DD HH:mm" → strict ISO
    if (!/(Z|[+-]\d{2}:?\d{2})$/i.test(s)) s += 'Z'; // no timezone → UTC
    const ms = Date.parse(s);
    if (isNaN(ms)) return null;
    const sec = ms / 1000;
    if (sec < DATE_EPOCH_MIN || sec > DATE_EPOCH_MAX) return null;
    return sec;
  }

  // Date-like value → epoch seconds. Besides primitive strings, Grist may
  // provide cell values through an object wrapper whose String(value) is the
  // ISO representation. Keep the ISO parser strict so ordinary objects are
  // never mistaken for dates.
  function parseDateValueSec(v) {
    if (typeof v === 'number') return v;
    if (typeof v === 'string') return parseIsoDateSec(v);
    if (v != null && typeof v === 'object') {
      if (v instanceof Date) {
        const ms = v.getTime();
        if (!isNaN(ms)) {
          const sec = ms / 1000;
          return sec >= DATE_EPOCH_MIN && sec <= DATE_EPOCH_MAX ? sec : null;
        }
        return null;
      }
      return parseIsoDateSec(String(v));
    }
    return null;
  }

  // Date-like value (epoch number, ISO string, or wrapper) → epoch seconds.
  function toEpochSec(v) {
    return parseDateValueSec(v);
  }

  // Render a parsed UTC instant without leaking Grist's transport format
  // (epoch seconds or an ISO string) into the table. Date-only/midnight values
  // stay compact; DateTime values retain their hours and minutes.
  function formatUtcDateSec(sec) {
    const d = new Date(sec * 1000);
    const date = d.toISOString().slice(0, 10);
    const hh = d.getUTCHours(), mm = d.getUTCMinutes(), ss = d.getUTCSeconds();
    return hh === 0 && mm === 0 && ss === 0
      ? date
      : `${date} ${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
  }

  function isDateLikeColumn(col) {
    if (dateLikeCache.has(col)) return dateLikeCache.get(col);
    let has = false;
    for (const r of allRecords) {
      const v = r[col];
      if (v == null || v === '') continue;
      if (typeof v === 'number') {
        if (v < DATE_EPOCH_MIN || v > DATE_EPOCH_MAX) {
          dateLikeCache.set(col, false);
          return false;
        }
      } else if (typeof v === 'string' || typeof v === 'object') {
        if (parseDateValueSec(v) == null) {
          dateLikeCache.set(col, false);
          return false;
        }
      } else {
        dateLikeCache.set(col, false);
        return false;
      }
      has = true;
    }
    dateLikeCache.set(col, has);
    return has;
  }

  // Decode the selection: "col::day|month|year" or plain "col".
  function parseGroupBy(val) {
    const m = /^(.*)::(day|month|year)$/.exec(val || '');
    return m ? { col: m[1], granularity: m[2] }
             : { col: val, granularity: null };
  }

  // UTC bucket start in milliseconds (day / month / year).
  function bucketStartMs(epochSec, granularity) {
    const d = new Date(epochSec * 1000);
    const y = d.getUTCFullYear(), m = d.getUTCMonth(), day = d.getUTCDate();
    if (granularity === 'year')  return Date.UTC(y, 0, 1);
    if (granularity === 'month') return Date.UTC(y, m, 1);
    return Date.UTC(y, m, day);
  }

  // Localized bucket label (always UTC).
  function bucketLabel(ms, granularity) {
    const d = new Date(ms);
    if (granularity === 'year') return String(d.getUTCFullYear());
    if (granularity === 'month')
      return d.toLocaleDateString(LOCALE, { month: 'long', year: 'numeric', timeZone: 'UTC' });
    return d.toLocaleDateString(LOCALE, { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
  }
