  // ── 7. Settings panel — button ─────────────────────────
  btnSettings.addEventListener('click', () => {
    const isOpen = settingsPanel.classList.toggle('open');
    btnSettings.classList.toggle('active', isOpen);
    btnSettings.setAttribute('aria-expanded', String(isOpen));
    if (isOpen) {
      refreshBoolSection();
      refreshEditableColumnsSection();
      refreshDiag();
    }
  });

  // ── 7b. Editable fields ────────────────────────────────────
  function columnBaseType(type) {
    return String(type || '').split(':')[0];
  }

  function isTextColumnType(type) {
    return columnBaseType(type) === 'Text';
  }

  function isDateTimeColumnType(type) {
    return columnBaseType(type) === 'DateTime';
  }

  function getRecordMoveContext() {
    const { col, granularity } = parseGroupBy(groupBy);
    const type = columnBaseType(writableColumnTypes[col] || columnTypes[col]);
    let reason = '';
    if (!col)
      reason = 'Choose a grouping column first';
    else if (granularity)
      reason = 'Moving records between date buckets is not supported yet';
    else if (!writableColumnIds.length && selectedTableId === 'unknown')
      reason = 'Table permissions are still loading; try again in a moment';
    else if (!writableColumnIds.includes(col))
      reason = `The grouping column "${col}" is read-only`;
    else if (isDateLikeColumn(col))
      reason = 'Moving records between Date/DateTime groups is not supported yet';
    else if (type !== 'Text' && type !== 'Choice')
      reason = `The grouping column must be Text or Choice, not ${type || 'an unknown type'}`;
    return { enabled: !reason, col, type, granularity, reason };
  }

  function editableTextCandidates() {
    const groupCol = parseGroupBy(groupBy).col;
    return allColumns.filter(col =>
      col !== groupCol &&
      writableColumnIds.includes(col) &&
      isTextColumnType(writableColumnTypes[col]));
  }

  function isEditableTextColumn(col) {
    return editableColumns.has(col) && editableTextCandidates().includes(col);
  }

  function editableDateTimeCandidates() {
    const groupCol = parseGroupBy(groupBy).col;
    return allColumns.filter(col =>
      col !== groupCol &&
      writableColumnIds.includes(col) &&
      isDateTimeColumnType(writableColumnTypes[col]));
  }

  function editKindForColumn(col) {
    if (editableDateTimeCandidates().includes(col)) return 'datetime';
    if (isEditableTextColumn(col)) return 'text';
    return null;
  }

  function saveEditableColumns() {
    editableColumnsConfigured = true;
    grist.setOption('editableColumns', JSON.stringify([...editableColumns].sort()));
  }

  function applyEditableColumnDefaults() {
    if (editableDefaultsApplied || editableColumnsConfigured) return;
    editableDefaultsApplied = true;
    // This widget's attendance-notes field is C. Enable it immediately when
    // it is a genuine writable Text column; every column remains configurable.
    if (writableColumnIds.includes('C') && isTextColumnType(writableColumnTypes.C)) {
      editableColumns.add('C');
      saveEditableColumns();
    }
  }

  function refreshEditableColumnsSection() {
    if (!editableColList) return;
    editableColList.innerHTML = '';
    if (!writableColumnIds.length) {
      const msg = document.createElement('span');
      msg.className = 'editable-col-empty';
      msg.textContent = T.editableLoading;
      editableColList.appendChild(msg);
      return;
    }
    const textCandidates = editableTextCandidates();
    const dateTimeCandidates = editableDateTimeCandidates();
    if (!textCandidates.length && !dateTimeCandidates.length) {
      const msg = document.createElement('span');
      msg.className = 'editable-col-empty';
      msg.textContent = T.editableNone;
      editableColList.appendChild(msg);
      return;
    }
    textCandidates.forEach(col => {
      const label = document.createElement('label');
      label.className = 'editable-col-option';
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = editableColumns.has(col);
      cb.value = col;
      cb.addEventListener('change', () => {
        if (cb.checked) editableColumns.add(col);
        else editableColumns.delete(col);
        saveEditableColumns();
        render();
      });
      const text = document.createElement('span');
      text.textContent = col;
      label.appendChild(cb);
      label.appendChild(text);
      editableColList.appendChild(label);
    });
    dateTimeCandidates.forEach(col => {
      const label = document.createElement('label');
      label.className = 'editable-col-option automatic';
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = true;
      cb.disabled = true;
      const text = document.createElement('span');
      text.textContent = col;
      const badge = document.createElement('small');
      badge.textContent = T.editableAuto;
      text.appendChild(badge);
      label.appendChild(cb);
      label.appendChild(text);
      editableColList.appendChild(label);
    });
  }

  // ── 8. Boolean formats ────────────────────────────────────
  function buildBoolButtons() {
    boolRow.innerHTML = '';
    BOOL_FORMATS.forEach(fmt => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'bool-btn' + (fmt.key === boolFmtKey ? ' selected' : '');
      btn.setAttribute('role', 'radio');
      btn.setAttribute('aria-checked', String(fmt.key === boolFmtKey));
      btn.setAttribute('aria-label', T.boolFormatLabel + ' ' + fmt.label);
      btn.textContent = fmt.label;
      btn.addEventListener('click', () => {
        boolFmtKey = fmt.key;
        boolRow.querySelectorAll('.bool-btn').forEach(b => {
          b.classList.remove('selected');
          b.setAttribute('aria-checked', 'false');
        });
        btn.classList.add('selected');
        btn.setAttribute('aria-checked', 'true');
        grist.setOption('boolFmtKey', boolFmtKey);
        render();
      });
      boolRow.appendChild(btn);
    });
  }

  // ── 10. Max height per group (checkbox + slider) ──
  // Unchecked (default): unlimited height, no internal scrolling.
  // Checked: the slider is active and caps the group height.
  function refreshMaxHControls() {
    document.getElementById('limit-maxh-cb').checked    = limitMaxH;
    document.getElementById('maxh-range').disabled      = !limitMaxH;
    document.getElementById('btn-reset-maxh').disabled  = !limitMaxH;
  }

  function syncMaxHUI() {
    const range   = document.getElementById('maxh-range');
    const valSpan = document.getElementById('maxh-val');
    range.value = maxGroupH;
    valSpan.textContent = maxGroupH + 'px';
    refreshMaxHControls();
    applyMaxGroupH();
  }

  function initMaxHSlider() {
    const range   = document.getElementById('maxh-range');
    const valSpan = document.getElementById('maxh-val');
    if (!range) return;
    document.getElementById('limit-maxh-cb').addEventListener('change', (e) => {
      limitMaxH = e.target.checked;
      refreshMaxHControls();
      applyMaxGroupH();
      grist.setOption('limitMaxH', limitMaxH);
    });
    range.addEventListener('input',  () => { valSpan.textContent = range.value + 'px'; });
    range.addEventListener('change', () => {
      maxGroupH = parseInt(range.value);
      applyMaxGroupH();
      grist.setOption('maxGroupH', maxGroupH);
    });
    document.getElementById('btn-reset-maxh').addEventListener('click', () => {
      maxGroupH = 200;
      range.value = 200;
      valSpan.textContent = '200px';
      applyMaxGroupH();
      grist.setOption('maxGroupH', maxGroupH);
    });
    syncMaxHUI();
  }

  btnResetColumns.addEventListener('click', () => {
    columnOrder = [...allColumns];
    columnWidths = {};
    sharedTableScrollLeft = 0;
    saveColumnLayout();
    render();
  });

  // ── 10b. Automatic sums ──────────────────────────────────────
  function isNumericColumnType(type) {
    const base = columnBaseType(type);
    return base === 'Numeric' || base === 'Int';
  }

  // Metadata is authoritative once loaded. The value-based fallback keeps
  // sums visible during the brief initial render before metadata arrives.
  function isNumericColumn(col) {
    if (columnTypes[col])
      return isNumericColumnType(columnTypes[col]);
    let hasNum = false;
    for (const r of allRecords) {
      const v = r[col];
      if (v == null || v === '') continue;
      if (typeof v !== 'number' || !Number.isFinite(v)) return false;
      hasNum = true;
    }
    return hasNum;
  }

  function sumColumn(records, col) {
    let sum = 0;
    let hasNumber = false;
    for (const rec of records) {
      const value = rec[col];
      if (typeof value !== 'number' || !Number.isFinite(value)) continue;
      sum += value;
      hasNumber = true;
    }
    if (!hasNumber) return null;
    return Object.is(sum, -0) ? 0 : sum;
  }

  const MIN_COLUMN_WIDTH = 64;
  const MAX_COLUMN_WIDTH = 520;
  const SELECT_COLUMN_WIDTH = 46;
  const ACTIONS_COLUMN_WIDTH = 66;
  let sharedTableScrollLeft = 0;
  let syncingTableScroll = false;
  let draggedColumn = null;
  const pendingRowAnimations = new Map();

  function clampColumnWidth(width) {
    return Math.max(MIN_COLUMN_WIDTH, Math.min(MAX_COLUMN_WIDTH, Math.round(width)));
  }

  function reconcileColumnOrder() {
    const known = new Set(allColumns);
    const saved = columnOrder.filter((col, i) =>
      known.has(col) && columnOrder.indexOf(col) === i);
    const missing = allColumns.filter(col => !saved.includes(col));
    columnOrder = [...saved, ...missing];
  }

  function orderedDisplayColumns(groupCol) {
    reconcileColumnOrder();
    return columnOrder.filter(col => col !== groupCol && allColumns.includes(col));
  }

  function defaultColumnWidth(col) {
    const type = columnBaseType(columnTypes[col]);
    if (type === 'Bool') return 72;
    if (type === 'Numeric' || type === 'Int') return 104;
    if (type === 'Date') return 120;
    if (type === 'DateTime') return 174;

    let longest = String(col).length;
    const sample = allRecords.slice(0, 400);
    for (const rec of sample) {
      const value = rec[col];
      if (value == null || value === '') continue;
      let text;
      if (typeof value === 'string') text = value;
      else if (Array.isArray(value)) text = value.join(', ');
      else if (typeof value === 'object') {
        try { text = JSON.stringify(value); } catch (_) { text = String(value); }
      } else text = String(value);
      longest = Math.max(longest, Math.min(38, text.length));
    }
    return clampColumnWidth(longest * 7.2 + 34);
  }

  function getColumnWidth(col) {
    const saved = Number(columnWidths[col]);
    return Number.isFinite(saved)
      ? clampColumnWidth(saved)
      : defaultColumnWidth(col);
  }

  function getTableWidth(cols) {
    return SELECT_COLUMN_WIDTH + ACTIONS_COLUMN_WIDTH
      + cols.reduce((total, col) => total + getColumnWidth(col), 0);
  }

  function buildColGroup(cols) {
    return '<colgroup>'
      + `<col class="layout-col-sel" style="width:${SELECT_COLUMN_WIDTH}px">`
      + cols.map(col =>
        `<col data-column="${esc(col)}" style="width:${getColumnWidth(col)}px">`
      ).join('')
      + `<col class="layout-col-actions" style="width:${ACTIONS_COLUMN_WIDTH}px">`
      + '</colgroup>';
  }

  function saveColumnLayout() {
    grist.setOption('columnOrder', JSON.stringify(columnOrder));
    grist.setOption('columnWidths', JSON.stringify(columnWidths));
  }

  function applyColumnWidthsToDOM() {
    document.querySelectorAll('.rec-table').forEach(table => {
      const cols = [...table.querySelectorAll('col[data-column]')];
      cols.forEach(colEl => {
        colEl.style.width = `${getColumnWidth(colEl.dataset.column)}px`;
      });
      const dataWidth = cols.reduce(
        (total, colEl) => total + getColumnWidth(colEl.dataset.column), 0);
      table.style.width =
        `${SELECT_COLUMN_WIDTH + ACTIONS_COLUMN_WIDTH + dataWidth}px`;
    });
    scheduleGroupSumAlignment();
  }

  function moveColumn(source, target, after) {
    const groupCol = parseGroupBy(groupBy).col;
    const display = orderedDisplayColumns(groupCol);
    const from = display.indexOf(source);
    if (from < 0) return false;
    display.splice(from, 1);
    let to = display.indexOf(target);
    if (to < 0) return false;
    if (after) to += 1;
    display.splice(to, 0, source);
    const displayed = new Set(display);
    let displayIndex = 0;
    columnOrder = columnOrder.map(col =>
      displayed.has(col) ? display[displayIndex++] : col);
    saveColumnLayout();
    render();
    return true;
  }

  function buildColumnHeader(col) {
    return `<th scope="col" class="column-header" draggable="true" tabindex="0"`
      + ` title="${esc(col)} — ${esc(T.reorderColumn)}" data-column="${esc(col)}">`
      + `<span class="column-name">${esc(col)}</span>`
      + `<span class="column-resize-handle" draggable="false" tabindex="0"`
      + ` role="separator" aria-orientation="vertical"`
      + ` aria-label="${esc(T.resizeColumn)} ${esc(col)}"></span></th>`;
  }

  function buildGroupSums(records, cols) {
    const sums = cols.filter(isNumericColumn).map(col => {
      const sum = sumColumn(records, col);
      const text = sum == null ? '—' : String(sum);
      return `<span class="group-sum" data-column="${esc(col)}"`
        + ` title="Sum of ${esc(col)}" aria-label="Sum of ${esc(col)}: ${esc(text)}"`
        + `>${esc(text)}</span>`;
    });
    return sums.length ? `<span class="group-sums">${sums.join('')}</span>` : '';
  }

  let groupSumAlignFrame = 0;

  function alignGroupSums() {
    groupSumAlignFrame = 0;
    document.querySelectorAll('.group').forEach(card => {
      const header = card.querySelector('.group-header');
      if (!header) return;
      const headerRect = header.getBoundingClientRect();
      const headerCells = new Map(
        [...card.querySelectorAll('.rec-table thead th[data-column]')]
          .map(th => [th.dataset.column, th])
      );
      card.querySelectorAll('.group-sum').forEach(sum => {
        const th = headerCells.get(sum.dataset.column);
        if (!th) return;
        const cellRect = th.getBoundingClientRect();
        sum.style.left = `${cellRect.left + cellRect.width / 2 - headerRect.left}px`;
      });
    });
  }

  function scheduleGroupSumAlignment() {
    if (groupSumAlignFrame) cancelAnimationFrame(groupSumAlignFrame);
    groupSumAlignFrame = requestAnimationFrame(alignGroupSums);
  }

  window.addEventListener('resize', scheduleGroupSumAlignment);
  if (document.fonts && document.fonts.ready)
    document.fonts.ready.then(scheduleGroupSumAlignment);

  function prefersReducedMotion() {
    return typeof window.matchMedia === 'function'
      && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  function captureGroupPositions() {
    return new Map(
      [...content.querySelectorAll('.group[data-animation-key]')].map(card => [
        card.dataset.animationKey,
        card.getBoundingClientRect(),
      ])
    );
  }

  function animateSortedGroups(firstPositions) {
    if (!firstPositions || prefersReducedMotion()) return;
    content.querySelectorAll('.group[data-animation-key]').forEach(card => {
      const first = firstPositions.get(card.dataset.animationKey);
      if (!first) return;
      const last = card.getBoundingClientRect();
      const deltaX = first.left - last.left;
      const deltaY = first.top - last.top;
      if (Math.abs(deltaX) < 1 && Math.abs(deltaY) < 1) return;
      if (typeof card.animate !== 'function') return;
      card.classList.add('group-sort-moving');
      const distance = Math.hypot(deltaX, deltaY);
      const animation = card.animate([
        { transform: `translate(${deltaX}px, ${deltaY}px)` },
        { transform: 'translate(0, 0)' },
      ], {
        duration: Math.max(240, Math.min(420, 220 + distance * .18)),
        easing: 'cubic-bezier(.2,.8,.2,1)',
        fill: 'both',
      });
      let finished = false;
      const finish = () => {
        if (finished) return;
        finished = true;
        card.classList.remove('group-sort-moving');
        animation.cancel();
      };
      animation.addEventListener('finish', finish, { once: true });
      animation.addEventListener('cancel', finish, { once: true });
    });
  }

  function rowForRecordId(id) {
    const key = String(id);
    return [...content.querySelectorAll('tr[data-record-id]')]
      .find(row => row.dataset.recordId === key) || null;
  }

  function startPendingRowAnimations() {
    const now = Date.now();
    pendingRowAnimations.forEach((entry, id) => {
      if (entry.expires <= now) {
        clearTimeout(entry.timer);
        pendingRowAnimations.delete(id);
        return;
      }
      const row = rowForRecordId(id);
      if (!row) return;
      if (prefersReducedMotion()) {
        clearTimeout(entry.timer);
        pendingRowAnimations.delete(id);
        row.classList.remove(entry.className);
        return;
      }
      if (entry.row === row) return;
      clearTimeout(entry.timer);
      entry.row = row;
      row.classList.add(entry.className);
      entry.timer = setTimeout(() => {
        if (pendingRowAnimations.get(id) === entry)
          pendingRowAnimations.delete(id);
        if (row.isConnected) row.classList.remove(entry.className);
      }, entry.duration);
    });
  }

  function queueRowAnimation(id, className, duration) {
    if (id == null || id === 'unknown') return;
    const key = String(id);
    const previous = pendingRowAnimations.get(key);
    if (previous) clearTimeout(previous.timer);
    pendingRowAnimations.set(key, {
      expires: Date.now() + 5000,
      className,
      duration,
      row: null,
      timer: null,
    });
    startPendingRowAnimations();
  }

  function queueDuplicateAnimation(id) {
    queueRowAnimation(id, 'row-enter', 950);
  }

  function queueMoveAnimations(ids) {
    ids.forEach(id => queueRowAnimation(id, 'row-moved', 850));
  }

  // Diagnostics: per-column type detection + first raw value shown with
  // JSON.stringify so invisible characters appear as \uXXXX escapes.
  // (JSON.stringify alone does not escape format chars like LRM, so they
  // are escaped explicitly after serialization.)
  function refreshDiag() {
    const list = document.getElementById('diag-list');
    list.innerHTML = '';
    const head = document.createElement('div');
    head.className = 'diag-row diag-head';
    head.textContent = `v${WIDGET_VERSION} · ${allRecords.length} records · ${allColumns.length} columns`;
    list.appendChild(head);
    const context = document.createElement('div');
    context.className = 'diag-row';
    context.textContent = `access: ${grantedAccessLevel} · table: ${selectedTableId}`;
    list.appendChild(context);
    const writable = document.createElement('div');
    writable.className = 'diag-row';
    writable.textContent = writableColumnIds.length
      ? `writable: ${writableColumnIds.join(', ')}`
      : 'writable: not loaded yet';
    list.appendChild(writable);
    const editable = document.createElement('div');
    editable.className = 'diag-row';
    editable.textContent = editableColumns.size
      ? `editable text: ${[...editableColumns].join(', ')}`
      : 'editable text: none';
    list.appendChild(editable);
    const editableDateTime = document.createElement('div');
    editableDateTime.className = 'diag-row';
    const dateTimeColumns = editableDateTimeCandidates();
    editableDateTime.textContent = dateTimeColumns.length
      ? `editable DateTime: ${dateTimeColumns.join(', ')}`
      : 'editable DateTime: none';
    list.appendChild(editableDateTime);
    const move = document.createElement('div');
    move.className = 'diag-row';
    const moveContext = getRecordMoveContext();
    move.textContent = moveContext.enabled
      ? `drag move: enabled · ${moveContext.col} · ${moveContext.type}`
      : `drag move: disabled · group=${groupBy || '(none)'}`
        + ` · type=${moveContext.type || 'unknown'}`
        + ` · writable=${moveContext.col ? writableColumnIds.includes(moveContext.col) : false}`
        + ` · reason=${moveContext.reason}`;
    list.appendChild(move);
    const summed = document.createElement('div');
    summed.className = 'diag-row';
    const summedColumns = allColumns.filter(isNumericColumn);
    summed.textContent = summedColumns.length
      ? `automatic sums: ${summedColumns.join(', ')}`
      : 'automatic sums: none';
    list.appendChild(summed);
    const layout = document.createElement('div');
    layout.className = 'diag-row';
    const customWidths = Object.keys(columnWidths)
      .filter(col => allColumns.includes(col))
      .map(col => `${col}=${getColumnWidth(col)}px`);
    layout.textContent = `column order: ${orderedDisplayColumns(parseGroupBy(groupBy).col).join(', ')}`
      + ` · custom widths: ${customWidths.length ? customWidths.join(', ') : 'none'}`;
    list.appendChild(layout);
    allColumns.forEach(col => {
      const first = allRecords.map(r => r[col]).find(v => v != null && v !== '');
      const row = document.createElement('div');
      row.className = 'diag-row';
      const raw = first === undefined ? '(empty)' : JSON.stringify(first)
        .replace(/[\u00AD\u180E\u200B-\u200F\u202A-\u202E\u2060-\u2064\u2066-\u206F\uFEFF]/g,
          c => '\\u' + c.codePointAt(0).toString(16).padStart(4, '0'));
      row.textContent = `${col} · ${columnTypes[col] || 'unknown'} · ${typeof first}`
        + ` · date-like: ${isDateLikeColumn(col) ? 'yes' : 'no'}`
        + ` · first: ${raw.length > 80 ? raw.slice(0, 80) + '…' : raw}`;
      list.appendChild(row);
    });
    if (actionDiagnostics.length) {
      const actionHead = document.createElement('div');
      actionHead.className = 'diag-row diag-head diag-action-head';
      actionHead.textContent = 'Recent record actions';
      list.appendChild(actionHead);
      actionDiagnostics.forEach(entry => {
        const row = document.createElement('div');
        row.className = `diag-row diag-action diag-${entry.status}`;
        const details = entry.details ? ` · ${entry.details}` : '';
        row.textContent = `${entry.time} · ${entry.action} · ${entry.status}${details}`;
        list.appendChild(row);
      });
    }
  }

  // ── 11. Grist ────────────────────────────────────────────
  // Full access required: row actions and editable fields write through
  // grist.selectedTable.create / update / destroy.
  grist.ready({ requiredAccess: 'full' });

  function isValidGroupByOption(value) {
    if (!value) return false;
    const { col, granularity } = parseGroupBy(value);
    if (!allColumns.includes(col)) return false;
    return !granularity
      || (knownDateCols.has(col) && DATE_GRANULARITIES.includes(granularity));
  }

  function applyStartupGroupDefault() {
    // Options, records, and table metadata are delivered independently by Grist.
    // Wait for all three so a saved grouping always wins and ChoiceList is never
    // mistaken for a single-value Choice column.
    if (!optionsLoaded || !metadataLoaded || allColumns.length === 0) return false;
    if (isValidGroupByOption(groupBy)) return false;

    const choiceColumn = allColumns.find(col =>
      columnBaseType(columnTypes[col] || writableColumnTypes[col]) === 'Choice');
    if (!choiceColumn) return false;

    groupBy = choiceColumn;
    collapsed.clear();
    rebuildColumnSelect();
    groupSelect.value = choiceColumn;
    grist.setOption('groupBy', choiceColumn);
    recordActionDiagnostic('Auto grouping', 'ok',
      `column=${choiceColumn} · type=Choice`);
    return true;
  }

  grist.onOptions((opts, settings) => {
    grantedAccessLevel = settings && settings.accessLevel
      ? settings.accessLevel
      : 'unknown';
    if (opts) {
      if (opts.groupBy)  { groupBy  = opts.groupBy;  groupSelect.value = groupBy;  }
      if (opts.sortMode) { sortMode = opts.sortMode; sortSelect.value  = sortMode; }
      if (opts.boolFmtKey && BOOL_FORMATS.find(f => f.key === opts.boolFmtKey))
        boolFmtKey = opts.boolFmtKey;
      if (opts.maxGroupH) maxGroupH = parseInt(opts.maxGroupH) || 200;
      // Backward compat: a saved maxGroupH without limitMaxH → unlimited (unchecked).
      if (opts.limitMaxH !== undefined)
        limitMaxH = opts.limitMaxH === true || opts.limitMaxH === 'true' || opts.limitMaxH === 1;
      syncMaxHUI();
      if (Object.prototype.hasOwnProperty.call(opts, 'editableColumns')) {
        editableColumnsConfigured = true;
        try {
          const arr = typeof opts.editableColumns === 'string'
            ? JSON.parse(opts.editableColumns)
            : opts.editableColumns;
          editableColumns = new Set(Array.isArray(arr)
            ? arr.filter(col => typeof col === 'string')
            : []);
        } catch (e) {
          editableColumns = new Set();
        }
      }
      if (Object.prototype.hasOwnProperty.call(opts, 'columnOrder')) {
        try {
          const value = typeof opts.columnOrder === 'string'
            ? JSON.parse(opts.columnOrder)
            : opts.columnOrder;
          columnOrder = Array.isArray(value)
            ? value.filter(col => typeof col === 'string')
            : [];
        } catch (_) {
          columnOrder = [];
        }
      }
      if (Object.prototype.hasOwnProperty.call(opts, 'columnWidths')) {
        try {
          const value = typeof opts.columnWidths === 'string'
            ? JSON.parse(opts.columnWidths)
            : opts.columnWidths;
          columnWidths = {};
          if (value && typeof value === 'object' && !Array.isArray(value)) {
            Object.entries(value).forEach(([col, width]) => {
              if (typeof col === 'string' && Number.isFinite(Number(width)))
                columnWidths[col] = clampColumnWidth(Number(width));
            });
          }
        } catch (_) {
          columnWidths = {};
        }
      }
    }
    optionsLoaded = true;
    getWritableColumnIds().then(() => {
      applyStartupGroupDefault();
      applyEditableColumnDefaults();
      refreshEditableColumnsSection();
      refreshDiag();
      render();
    }).catch(err =>
      recordActionDiagnostic('Metadata', 'error',
        err && err.message ? err.message : String(err)));
    buildBoolButtons();
    refreshEditableColumnsSection();
    refreshDiag();
    render();
  });

  grist.onRecords((records) => {
    allRecords = records || [];
    // Prune the selection: drop ids missing from the new records
    if (selectedIds.size > 0) {
      const present = new Set(allRecords.map(r => String(r.id)));
      selectedIds.forEach(id => { if (!present.has(id)) selectedIds.delete(id); });
    }
    // updateSelBar lives in widget-actions.js (loaded later) — keep the typeof guard
    if (typeof updateSelBar === 'function') updateSelBar();
    dateLikeCache = new Map();
    if (allRecords.length > 0) {
      allColumns = Object.keys(allRecords[0])
        .filter(k => k !== 'id' && k !== 'manualSort');
      reconcileColumnOrder();
      allColumns.forEach(c => {
        if (isDateLikeColumn(c)) knownDateCols.add(c);
        else knownDateCols.delete(c);
      });
    }
    // Always rebuild: already-known columns stay offered
    // even when the current filter returns no records.
    rebuildColumnSelect();
    applyStartupGroupDefault();
    if (settingsPanel.classList.contains('open')) refreshEditableColumnsSection();
    if (settingsPanel.classList.contains('open')) refreshDiag();
    render();
  });

  buildBoolButtons();
  initMaxHSlider();

  // ── 12. Column selector ──────────────────────────────
  function rebuildColumnSelect() {
    const prev = groupSelect.value;
    groupSelect.innerHTML = `<option value="">${T.chooseCol}</option>`;
    allColumns.forEach(col => {
      const opt = document.createElement('option');
      opt.value = col; opt.textContent = col;
      groupSelect.appendChild(opt);
      // Date-like columns: extra day / month / year granularities
      // (knownDateCols persists even when the current fetch is empty)
      if (knownDateCols.has(col)) {
        DATE_GRANULARITIES.forEach(g => {
          const o = document.createElement('option');
          o.value = `${col}::${g}`;
          o.textContent = `${col} — ${T[GRAN_I18N_KEY[g]]}`;
          groupSelect.appendChild(o);
        });
      }
    });
    const target = groupBy || prev;
    const values = Array.from(groupSelect.options).map(o => o.value);
    if (target && values.includes(target)) groupSelect.value = target;
  }

  groupSelect.addEventListener('change', () => {
    groupBy = groupSelect.value;
    collapsed.clear();
    grist.setOption('groupBy', groupBy);
    if (settingsPanel.classList.contains('open')) refreshEditableColumnsSection();
    if (settingsPanel.classList.contains('open')) refreshDiag();
    render();
  });

  sortSelect.addEventListener('change', () => {
    const firstPositions = captureGroupPositions();
    sortMode = sortSelect.value;
    grist.setOption('sortMode', sortMode);
    render();
    animateSortedGroups(firstPositions);
  });

  document.getElementById('btn-expand').addEventListener('click', () => {
    collapsed.clear();
    document.querySelectorAll('.group.collapsed').forEach(el => {
      el.classList.remove('collapsed');
      el.querySelector('.group-header').setAttribute('aria-expanded', 'true');
    });
  });

  document.getElementById('btn-collapse').addEventListener('click', () => {
    getGroups().forEach(g => collapsed.add(g.key));
    document.querySelectorAll('.group:not(.collapsed)').forEach(el => {
      el.classList.add('collapsed');
      el.querySelector('.group-header').setAttribute('aria-expanded', 'false');
    });
  });

  // ── 13. Grouping ────────────────────────────────────────
  function getGroups() {
    if (!groupBy) return [];
    const { col, granularity } = parseGroupBy(groupBy);
    // Granularity active only if the column is still date-like
    const dateMode = !!granularity && allColumns.includes(col) && isDateLikeColumn(col);
    const map = new Map();
    allRecords.forEach(rec => {
      const raw = rec[col];
      let key, label, sortKey, writeValue;
      if (raw == null || raw === '') {
        key = '\x00__empty__'; label = raw; sortKey = null; writeValue = null;
      } else if (dateMode) {
        // raw = epoch (number) or ISO string → epoch seconds
        const sec = toEpochSec(raw);
        if (sec == null) {
          key = '\x00__empty__'; label = raw; sortKey = null; writeValue = null;
        } else {
          const ms = bucketStartMs(sec, granularity);
          key     = String(ms);               // the key carries the bucket epoch
          label   = bucketLabel(ms, granularity);
          sortKey = ms;
          writeValue = raw;
        }
      } else {
        key = String(raw); label = raw; sortKey = null; writeValue = raw;
      }
      if (!map.has(key))
        map.set(key, { key, label, sortKey, writeValue, records: [] });
      map.get(key).records.push(rec);
    });
    const groups = Array.from(map.values());
    groups.sort((a, b) => {
      if (a.key === '\x00__empty__') return  1;
      if (b.key === '\x00__empty__') return -1;
      // Chronological sort (bucket epoch) when grouping by date
      if (sortMode === 'alpha-asc')  return dateMode
        ? a.sortKey - b.sortKey
        : String(a.label).localeCompare(String(b.label), 'fr');
      if (sortMode === 'alpha-desc') return dateMode
        ? b.sortKey - a.sortKey
        : String(b.label).localeCompare(String(a.label), 'fr');
      if (sortMode === 'count-desc') return b.records.length - a.records.length;
      if (sortMode === 'count-asc')  return a.records.length - b.records.length;
      return 0;
    });
    return groups;
  }

  // ── 14. Rendering ─────────────────────────────────────────────
  function render() {
    Array.from(content.children).forEach(c => {
      if (c.id !== 'empty-state' && c.id !== 'toast') c.remove();
    });

    if (!groupBy || allRecords.length === 0) {
      emptyState.style.display = '';
      // No known column (never saw data): dedicated message.
      const noData = !groupBy && allColumns.length === 0;
      emptyState.querySelector('.empty-title').textContent =
        noData ? T.emptyNoDataTitle
               : (!groupBy ? T.emptyTitle : T.emptyTitleNoRec);
      emptyState.querySelector('.empty-sub').innerHTML =
        noData ? T.emptyNoDataSub
               : (!groupBy ? T.emptySub : T.emptySubNoRec);
      statsbar.classList.remove('visible');
      return;
    }

    emptyState.style.display = 'none';
    const groups      = getGroups();
    const groupCol    = parseGroupBy(groupBy).col;
    const displayCols = orderedDisplayColumns(groupCol);

    statsbar.classList.add('visible');
    statGroups.textContent  = groups.length;
    statRecords.textContent = allRecords.length;

    groups.forEach(group => {
      const isCollapsed = collapsed.has(group.key);
      const isEmpty     = group.key === '\x00__empty__';
      const labelTxt    = isEmpty ? T.emptyGroup : esc(String(group.label));
      const labelCls    = isEmpty ? 'group-label is-empty' : 'group-label';
      const bodyId      = 'grp-' + btoa(encodeURIComponent(group.key)).replace(/[^a-zA-Z0-9]/g, '');

      const card = document.createElement('article');
      card.className = 'group' + (isCollapsed ? ' collapsed' : '');
      card.dataset.animationKey = bodyId;
      card.dataset.groupKey = group.key;
      card.dataset.groupLabel = isEmpty ? T.emptyGroup : String(group.label);

      const header = document.createElement('button');
      header.type = 'button';
      header.className = 'group-header';
      header.setAttribute('aria-expanded', String(!isCollapsed));
      header.setAttribute('aria-controls', bodyId);
      header.innerHTML = `
        <svg class="chevron" viewBox="0 0 24 24" fill="none"
             stroke="currentColor" stroke-width="2.5"
             stroke-linecap="round" stroke-linejoin="round"
             aria-hidden="true" focusable="false">
          <polyline points="6 9 12 15 18 9"/>
        </svg>
        <span class="group-badge"
              aria-label="${group.records.length}\u00a0${group.records.length > 1 ? T.records : T.record}"
        >${group.records.length}</span>
        <span class="${labelCls}">${labelTxt}</span>
        ${buildGroupSums(group.records, displayCols)}`;

      header.addEventListener('click', () => {
        if (collapsed.has(group.key)) {
          collapsed.delete(group.key);
          card.classList.remove('collapsed');
          header.setAttribute('aria-expanded', 'true');
        } else {
          collapsed.add(group.key);
          card.classList.add('collapsed');
          header.setAttribute('aria-expanded', 'false');
        }
      });

      const body = document.createElement('div');
      body.className = 'group-body';
      body.id = bodyId;
      body.setAttribute('role', 'region');
      body.setAttribute('aria-label', T.ariaGroupRegion + labelTxt);

      const inner = document.createElement('div');
      inner.className = 'group-body-inner';
      inner.innerHTML = displayCols.length === 0
        ? `<p class="only-group-col">${T.noOtherCol}</p>`
        : buildTable(displayCols, group.records, labelTxt);

      body.appendChild(inner);
      card.appendChild(header);
      card.appendChild(body);
      content.appendChild(card);
    });
    document.querySelectorAll('.scroll-inner').forEach(scroller => {
      scroller.scrollLeft = sharedTableScrollLeft;
    });
    scheduleGroupSumAlignment();
    startPendingRowAnimations();
    refreshBoolSection();
  }

  function gripIconHtml() {
    return `<svg class="grip-icon" viewBox="0 0 12 16" aria-hidden="true"`
      + ` focusable="false"><circle cx="3" cy="3" r="1.25"/>`
      + `<circle cx="9" cy="3" r="1.25"/><circle cx="3" cy="8" r="1.25"/>`
      + `<circle cx="9" cy="8" r="1.25"/><circle cx="3" cy="13" r="1.25"/>`
      + `<circle cx="9" cy="13" r="1.25"/></svg>`;
  }

  function buildTable(cols, records, groupLabel) {
    // Unified selection/drag control first, actions column last.
    const selectedCount = records.filter(rec => selectedIds.has(String(rec.id))).length;
    const selectionState = selectedCount === 0
      ? 'none'
      : (selectedCount === records.length ? 'all' : 'some');
    const groupPressed = selectionState === 'all'
      ? 'true'
      : (selectionState === 'some' ? 'mixed' : 'false');
    const thead = '<th class="col-grip">'
                + `<button type="button" class="group-select-grip"`
                + ` data-selection-state="${selectionState}" aria-pressed="${groupPressed}"`
                + ` title="${esc(T.selectGroup)}" aria-label="${esc(T.selectGroup)}">`
                + `${gripIconHtml()}</button></th>`
                + cols.map(c => buildColumnHeader(c)).join('')
                + '<th class="col-actions" aria-hidden="true"></th>';
    const moveContext = getRecordMoveContext();
    const dragEnabled = moveContext.enabled;
    const tbody = records.map(rec => {
      const idStr = String(rec.id);
      const sel   = selectedIds.has(idStr);
      const rowAnimation = pendingRowAnimations.get(idStr);
      const classes = [
        sel ? 'row-selected' : '',
        rowAnimation ? rowAnimation.className : '',
      ].filter(Boolean).join(' ');
      const gripLabel = dragEnabled ? T.rowGrip : T.rowSelect;
      const gripTitle = dragEnabled
        ? T.rowGrip
        : `${T.rowSelect}. ${moveContext.reason}`;
      return `<tr data-record-id="${esc(idStr)}"${classes ? ` class="${classes}"` : ''}>`
      + `<td class="row-grip-cell"><button type="button" class="row-grip"`
      + ` data-id="${esc(idStr)}" data-drag-enabled="${String(dragEnabled)}"`
      + ` draggable="false" aria-pressed="${String(sel)}" title="${esc(gripTitle)}"`
      + ` aria-label="${esc(gripLabel)} ${esc(idStr)}">${gripIconHtml()}</button></td>`
      + `${cols.map(c => renderTableCell(rec, c)).join('')}`
      + `<td class="row-actions">${rowActionsHtml(rec)}</td></tr>`;
    }).join('');
    return `<div class="scroll-inner" tabindex="0"><table class="rec-table"`
      + ` style="width:${getTableWidth(cols)}px">`
      + `${buildColGroup(cols)}
      <caption>${T.groupCaption} ${esc(groupLabel)}</caption>
      <thead><tr>${thead}</tr></thead>
      <tbody>${tbody}</tbody>
    </table></div>`;
  }

  // Shared column resize, reorder, and horizontal-scroll interactions.
  let activeColumnResize = null;

  content.addEventListener('pointerdown', (e) => {
    const handle = e.target.closest('.column-resize-handle');
    if (!handle) return;
    const th = handle.closest('th[data-column]');
    if (!th) return;
    e.preventDefault();
    e.stopPropagation();
    const col = th.dataset.column;
    activeColumnResize = {
      col,
      startX: e.clientX,
      startWidth: getColumnWidth(col),
      handle,
    };
    handle.classList.add('resizing');
    th.draggable = false;
    if (handle.setPointerCapture) handle.setPointerCapture(e.pointerId);
  });

  window.addEventListener('pointermove', (e) => {
    if (!activeColumnResize) return;
    columnWidths[activeColumnResize.col] = clampColumnWidth(
      activeColumnResize.startWidth + e.clientX - activeColumnResize.startX);
    applyColumnWidthsToDOM();
  });

  function finishColumnResize() {
    if (!activeColumnResize) return;
    const th = activeColumnResize.handle.closest('th[data-column]');
    activeColumnResize.handle.classList.remove('resizing');
    if (th) th.draggable = true;
    activeColumnResize = null;
    saveColumnLayout();
    if (settingsPanel.classList.contains('open')) refreshDiag();
  }

  window.addEventListener('pointerup', finishColumnResize);
  window.addEventListener('pointercancel', finishColumnResize);

  content.addEventListener('dblclick', (e) => {
    const handle = e.target.closest('.column-resize-handle');
    if (!handle) return;
    e.preventDefault();
    e.stopPropagation();
    const th = handle.closest('th[data-column]');
    if (!th) return;
    delete columnWidths[th.dataset.column];
    saveColumnLayout();
    render();
  });

  function clearColumnDropIndicators() {
    content.querySelectorAll('.column-dragging, .column-drop-before, .column-drop-after')
      .forEach(th => th.classList.remove(
        'column-dragging', 'column-drop-before', 'column-drop-after'));
  }

  content.addEventListener('dragstart', (e) => {
    if (e.target.closest('.column-resize-handle')) {
      e.preventDefault();
      return;
    }
    const th = e.target.closest('th.column-header');
    if (!th) return;
    draggedColumn = th.dataset.column;
    th.classList.add('column-dragging');
    if (e.dataTransfer) {
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', draggedColumn);
    }
  });

  content.addEventListener('dragover', (e) => {
    const th = e.target.closest('th.column-header');
    if (!th || !draggedColumn || th.dataset.column === draggedColumn) return;
    e.preventDefault();
    const rect = th.getBoundingClientRect();
    const after = e.clientX > rect.left + rect.width / 2;
    content.querySelectorAll('.column-drop-before, .column-drop-after')
      .forEach(cell => cell.classList.remove('column-drop-before', 'column-drop-after'));
    th.classList.add(after ? 'column-drop-after' : 'column-drop-before');
    th.dataset.dropAfter = String(after);
  });

  content.addEventListener('drop', (e) => {
    const th = e.target.closest('th.column-header');
    if (!th || !draggedColumn) return;
    e.preventDefault();
    const source = draggedColumn;
    const target = th.dataset.column;
    const after = th.dataset.dropAfter === 'true';
    draggedColumn = null;
    clearColumnDropIndicators();
    if (source !== target) moveColumn(source, target, after);
  });

  content.addEventListener('dragend', () => {
    draggedColumn = null;
    clearColumnDropIndicators();
  });

  content.addEventListener('keydown', (e) => {
    const handle = e.target.closest('.column-resize-handle');
    if (handle && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
      e.preventDefault();
      e.stopPropagation();
      const th = handle.closest('th[data-column]');
      const col = th.dataset.column;
      const step = e.shiftKey ? 25 : 10;
      columnWidths[col] = clampColumnWidth(
        getColumnWidth(col) + (e.key === 'ArrowRight' ? step : -step));
      saveColumnLayout();
      applyColumnWidthsToDOM();
      return;
    }
    if (handle && (e.key === 'Home' || e.key === 'Delete')) {
      e.preventDefault();
      e.stopPropagation();
      const th = handle.closest('th[data-column]');
      delete columnWidths[th.dataset.column];
      saveColumnLayout();
      render();
      return;
    }
    const th = e.target.closest('th.column-header');
    if (!th || !e.altKey || !['ArrowLeft', 'ArrowRight'].includes(e.key)) return;
    e.preventDefault();
    const groupCol = parseGroupBy(groupBy).col;
    const display = orderedDisplayColumns(groupCol);
    const index = display.indexOf(th.dataset.column);
    const targetIndex = index + (e.key === 'ArrowRight' ? 1 : -1);
    if (index < 0 || targetIndex < 0 || targetIndex >= display.length) return;
    moveColumn(th.dataset.column, display[targetIndex], e.key === 'ArrowRight');
  });

  content.addEventListener('scroll', (e) => {
    const scroller = e.target;
    if (!scroller.classList || !scroller.classList.contains('scroll-inner')) return;
    if (syncingTableScroll) return;
    if (Math.abs(scroller.scrollLeft - sharedTableScrollLeft) < 1) return;
    sharedTableScrollLeft = scroller.scrollLeft;
    syncingTableScroll = true;
    content.querySelectorAll('.scroll-inner').forEach(other => {
      if (other !== scroller) other.scrollLeft = sharedTableScrollLeft;
    });
    syncingTableScroll = false;
    scheduleGroupSumAlignment();
  }, true);

  // Per-row actions cell: duplicate ⧉ / delete ✕
  // (always visible, dimmed at rest; full opacity on hover / focus).
  function rowActionsHtml(rec) {
    const id = esc(String(rec.id));
    return `<button type="button" class="row-act act-dup" data-act="dup" data-id="${id}"`
         + ` title="${esc(T.dupRecord)}" aria-label="${esc(T.dupRecord)}">⧉</button>`
         + `<button type="button" class="row-act act-del" data-act="del" data-id="${id}"`
         + ` title="${esc(T.delRecord)}" aria-label="${esc(T.delRecord)}">✕</button>`;
  }

  // ── 14b. Row actions: delegation on #content ───────
  let toastTimer = null;
  function showToast(msg, tone = 'error') {
    let toast = document.getElementById('toast');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'toast';
      toast.className = 'toast';
      content.prepend(toast);
    }
    toast.setAttribute('role', tone === 'success' ? 'status' : 'alert');
    toast.classList.toggle('success', tone === 'success');
    toast.textContent = msg;
    toast.classList.add('visible');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove('visible'), 4000);
  }

  function actionErrorMessage(action, err) {
    console.error(`Grist ${action} failed`, err);
    const detail = err && err.message ? err.message : String(err || 'Unknown error');
    recordActionDiagnostic(action, 'error', detail);
    const accessHint = grantedAccessLevel !== 'full'
      ? ` (granted access: ${grantedAccessLevel})`
      : '';
    return `${action} failed${accessHint}: ${detail}`.slice(0, 240);
  }

  function renderTableCell(rec, col) {
    const rendered = renderCell(rec[col], col);
    const editKind = editKindForColumn(col);
    if (!editKind)
      return `<td>${rendered}</td>`;
    const id = esc(String(rec.id));
    const colAttr = esc(col);
    const editLabel = editKind === 'datetime' ? T.editDateTime : T.editCell;
    return `<td class="cell-editable">`
      + `<button type="button" class="cell-edit-btn" data-edit-id="${id}" data-edit-col="${colAttr}" data-edit-kind="${editKind}"`
      + ` aria-label="${esc(editLabel)}: ${colAttr}">`
      + `<span class="cell-edit-value">${rendered}</span>`
      + `<span class="cell-edit-pencil" aria-hidden="true">✎</span>`
      + `</button></td>`;
  }

  function updateEditorCharacterCount() {
    cellEditorCount.textContent = `${cellEditorText.value.length} ${T.editCharacters}`;
  }

  function setEditorBusy(busy) {
    cellEditorText.disabled = busy;
    cellEditorDateTime.disabled = busy;
    btnEditorClose.disabled = busy;
    btnEditorCancel.disabled = busy;
    btnEditorSave.disabled = busy;
    btnEditorSave.textContent = busy ? 'Saving…' : T.editSave;
  }

  function formatDateTimeInput(sec) {
    const date = new Date(Number(sec) * 1000);
    if (!Number.isFinite(Number(sec)) || Number.isNaN(date.getTime())) return '';
    return date.toISOString().slice(0, 19);
  }

  function dateTimeInputSec(value) {
    if (!value) return null;
    const milliseconds = Date.parse(`${value}Z`);
    if (!Number.isFinite(milliseconds))
      throw new Error('Choose a valid date and time');
    return milliseconds / 1000;
  }

  function openFieldEditor(idStr, col) {
    const kind = editKindForColumn(col);
    if (!kind) return;
    const recordId = validRecordId(idStr);
    const rec = allRecords.find(r => Number(r.id) === recordId);
    if (!rec) return;
    const isDateTime = kind === 'datetime';
    const value = isDateTime
      ? parseDateValueSec(rec[col])
      : (rec[col] == null ? '' : String(rec[col]));
    editingCell = { recordId, col, kind, originalValue: value };
    cellEditorTitle.textContent = `${isDateTime ? T.editDateTime : T.editTitle} — ${col}`;
    cellEditorMeta.textContent = `${T.editRecord} ${recordId} · ${selectedTableId}`
      + (isDateTime ? ' · UTC' : '');
    cellEditorText.setAttribute('aria-label', `${T.editTitle} ${col}`);
    cellEditorDateTime.setAttribute('aria-label', `${T.editDateTime}: ${col}`);
    cellEditorMeta.classList.remove('error');
    cellEditorDialog.classList.toggle('date-mode', isDateTime);
    cellEditorText.hidden = isDateTime;
    cellEditorDateTimePanel.hidden = !isDateTime;
    if (isDateTime) {
      cellEditorDateTime.value = value == null ? '' : formatDateTimeInput(value);
      cellEditorCount.textContent = '';
    } else {
      cellEditorText.value = value;
      updateEditorCharacterCount();
    }
    setEditorBusy(false);
    cellEditor.hidden = false;
    requestAnimationFrame(() => {
      if (isDateTime) {
        cellEditorDateTime.focus();
        if (typeof cellEditorDateTime.showPicker === 'function') {
          try { cellEditorDateTime.showPicker(); } catch (_) { /* user can open it normally */ }
        }
      } else {
        cellEditorText.focus();
        cellEditorText.setSelectionRange(value.length, value.length);
      }
    });
  }

  function closeFieldEditor() {
    if (btnEditorSave.disabled) return;
    cellEditor.hidden = true;
    cellEditorDialog.classList.remove('date-mode');
    editingCell = null;
    cellEditorText.value = '';
    cellEditorText.hidden = false;
    cellEditorDateTime.value = '';
    cellEditorDateTimePanel.hidden = true;
  }

  async function saveFieldEditor() {
    if (!editingCell || btnEditorSave.disabled) return;
    const { recordId, col, kind, originalValue } = editingCell;
    let nextValue;
    try {
      if (kind === 'datetime') {
        if (!cellEditorDateTime.checkValidity()) {
          cellEditorDateTime.reportValidity();
          return;
        }
        nextValue = dateTimeInputSec(cellEditorDateTime.value);
      } else {
        nextValue = cellEditorText.value;
      }
    } catch (err) {
      cellEditorMeta.textContent = err.message;
      cellEditorMeta.classList.add('error');
      cellEditorDateTime.focus();
      return;
    }
    if (nextValue === originalValue) {
      closeFieldEditor();
      return;
    }
    setEditorBusy(true);
    cellEditorMeta.classList.remove('error');
    const action = kind === 'datetime' ? 'Edit DateTime' : 'Edit';
    const detail = kind === 'datetime'
      ? `record=${recordId} · column=${col} · value=${nextValue == null ? 'empty' : nextValue} UTC`
      : `record=${recordId} · column=${col} · characters=${nextValue.length}`;
    recordActionDiagnostic(action, 'start', detail);
    try {
      await grist.selectedTable.update(
        { id: recordId, fields: { [col]: nextValue } },
        { parseStrings: false });
      recordActionDiagnostic(action, 'ok', detail);
      const current = allRecords.find(r => Number(r.id) === recordId);
      if (current) current[col] = nextValue;
      setEditorBusy(false);
      closeFieldEditor();
      render();
    } catch (err) {
      const message = actionErrorMessage(action, err);
      cellEditorMeta.textContent = message;
      cellEditorMeta.classList.add('error');
      setEditorBusy(false);
      (kind === 'datetime' ? cellEditorDateTime : cellEditorText).focus();
    }
  }

  function recordActionDiagnostic(action, status, details) {
    actionDiagnostics.unshift({
      time: new Date().toISOString().slice(11, 19),
      action,
      status,
      details: details ? String(details).slice(0, 500) : '',
    });
    actionDiagnostics.splice(12);
    if (settingsPanel.classList.contains('open')) refreshDiag();
  }

  function fieldTypeSummary(fields) {
    return Object.entries(fields).map(([colId, value]) => {
      let type;
      if (Array.isArray(value))
        type = `encoded:${String(value[0] || 'array')}`;
      else if (value === null)
        type = 'null';
      else
        type = typeof value;
      return `${colId}=${type}`;
    }).join(', ');
  }

  function normalizeTypedCell(value) {
    if (!Array.isArray(value) || typeof value[0] !== 'string') return value;
    switch (value[0]) {
      case 'R': return value[2]; // Ref → row ID
      case 'r': return ['L', ...(Array.isArray(value[2]) ? value[2] : [])]; // RefList
      case 'D': // DateTime → epoch seconds
      case 'd': return value[1]; // Date → epoch seconds
      case 'l': return normalizeTypedCell(value[1]); // Lookup → underlying value
      default:  return value;
    }
  }

  function validRecordId(idStr) {
    const id = Number(idStr);
    if (!Number.isInteger(id) || id <= 0)
      throw new Error(`Invalid record id: ${idStr}`);
    return id;
  }

  async function getWritableColumnIds() {
    if (writableColumnIdsPromise) return writableColumnIdsPromise;
    writableColumnIdsPromise = (async () => {
      const tableId = await grist.selectedTable.getTableId();
      selectedTableId = tableId;
      const tables = await grist.docApi.fetchTable('_grist_Tables');
      const tableIndex = (tables.tableId || []).indexOf(tableId);
      if (tableIndex < 0) throw new Error(`Table metadata not found for ${tableId}`);
      const tableRef = tables.id[tableIndex];
      const columns = await grist.docApi.fetchTable('_grist_Tables_column');
      const result = new Set();
      const typeMap = {};
      const allTypeMap = {};
      for (let i = 0; i < (columns.id || []).length; i++) {
        const colId = columns.colId[i];
        if (columns.parentId[i] !== tableRef) continue;
        if (!colId || colId === 'manualSort' || colId.startsWith('gristHelper_')) continue;
        const type = columns.type && columns.type[i] ? columns.type[i] : '';
        allTypeMap[colId] = type;
        if (columns.isFormula[i]) continue;
        result.add(colId);
        typeMap[colId] = type;
      }
      writableColumnIds = [...result];
      writableColumnTypes = typeMap;
      columnTypes = allTypeMap;
      metadataLoaded = true;
      recordActionDiagnostic('Metadata', 'ok',
        `table=${tableId} · writable=${writableColumnIds.join(', ')}`
        + ` · text=${writableColumnIds.filter(col => isTextColumnType(typeMap[col])).join(', ')}`
        + ` · datetime=${writableColumnIds.filter(col => isDateTimeColumnType(typeMap[col])).join(', ')}`
        + ` · numeric=${Object.keys(allTypeMap).filter(col => isNumericColumnType(allTypeMap[col])).join(', ')}`);
      return result;
    })();
    try {
      return await writableColumnIdsPromise;
    } catch (err) {
      writableColumnIdsPromise = null;
      throw err;
    }
  }

  function movableRecordGroupKey(rec, col) {
    const value = rec[col];
    return value == null || value === '' ? '\x00__empty__' : String(value);
  }

  async function moveRecordsToGroup(idStrings, targetKey) {
    await getWritableColumnIds();
    const context = getRecordMoveContext();
    if (!context.enabled)
      throw new Error('Drag-and-drop requires a writable Text or Choice grouping column');

    const target = getGroups().find(group => group.key === targetKey);
    if (!target) throw new Error('The destination group is no longer available');

    const recordIds = [...new Set(idStrings.map(validRecordId))];
    const records = recordIds
      .map(id => allRecords.find(record => Number(record.id) === id))
      .filter(Boolean)
      .filter(record => movableRecordGroupKey(record, context.col) !== targetKey);
    if (!records.length)
      return { moved: 0, label: targetKey === '\x00__empty__' ? T.emptyGroup : String(target.label) };

    const targetValue = targetKey === '\x00__empty__' ? null : target.writeValue;
    const movedIds = records.map(record => Number(record.id));
    const label = targetKey === '\x00__empty__' ? T.emptyGroup : String(target.label);
    const detail = `records=${movedIds.join(',')} · column=${context.col}`
      + ` · target=${label} · type=${context.type}`;
    recordActionDiagnostic('Move', 'start', detail);

    await grist.selectedTable.update(
      records.map(record => ({
        id: Number(record.id),
        fields: { [context.col]: targetValue },
      })),
      { parseStrings: false });

    const firstPositions = captureGroupPositions();
    movedIds.forEach(id => {
      const current = allRecords.find(record => Number(record.id) === id);
      if (current) current[context.col] = targetValue;
    });
    queueMoveAnimations(movedIds);
    render();
    animateSortedGroups(firstPositions);
    recordActionDiagnostic('Move', 'ok', detail);
    return { moved: movedIds.length, label };
  }

  async function duplicateRecordById(idStr) {
    const recordId = validRecordId(idStr);
    recordActionDiagnostic('Duplicate', 'start', `record=${recordId}`);
    const raw = await grist.viewApi.fetchSelectedRecord(recordId, {
      cellFormat: 'typed',
      expandRefs: false,
      includeColumns: 'all',
    });
    if (!raw) throw new Error(`Record ${recordId} is no longer available`);
    const writable = await getWritableColumnIds();
    const typedFields = {};
    const fields = {};
    for (const colId of writable) {
      if (Object.prototype.hasOwnProperty.call(raw, colId)) {
        typedFields[colId] = raw[colId];
        fields[colId] = normalizeTypedCell(raw[colId]);
      }
    }
    // Keep the duplicate beside its source in Grist's underlying row order.
    // manualSort is a special writable column, so it is fetched separately
    // from the normal writable-column list and copied only when numeric.
    if (typeof raw.manualSort === 'number' && Number.isFinite(raw.manualSort)) {
      typedFields.manualSort = raw.manualSort;
      fields.manualSort = raw.manualSort;
    }
    recordActionDiagnostic('Duplicate payload', 'ok',
      `record=${recordId} · typed: ${fieldTypeSummary(typedFields)} · normalized: ${fieldTypeSummary(fields)}`);
    const created = await grist.selectedTable.create({ fields }, { parseStrings: false });
    const createdId = created && created.id != null ? created.id : 'unknown';
    recordActionDiagnostic('Duplicate', 'ok',
      `source=${recordId} · created=${createdId}`);
    queueDuplicateAnimation(createdId);
    return createdId;
  }

  async function deleteRecordsByIds(idStrings) {
    const recordIds = idStrings.map(validRecordId);
    if (recordIds.length === 0) return;
    recordActionDiagnostic('Delete', 'start', `records=${recordIds.join(', ')}`);
    // Pass an array even for one record. This avoids older TableOperations
    // implementations rejecting the single-record response after deletion.
    await grist.selectedTable.destroy(recordIds);
    recordActionDiagnostic('Delete', 'ok', `records=${recordIds.join(', ')}`);
  }

  function disarmDelete(btn, idStr) {
    clearTimeout(armedDeletes.get(idStr));
    armedDeletes.delete(idStr);
    if (btn && btn.isConnected) {
      btn.classList.remove('armed');
      btn.textContent = '✕';
      btn.title = T.delRecord;
      btn.setAttribute('aria-label', T.delRecord);
    }
  }

  async function onDuplicate(btn, idStr) {
    const rec = allRecords.find(r => String(r.id) === idStr);
    if (!rec) return;
    btn.disabled = true;
    try {
      await duplicateRecordById(idStr);
      // No local mutation: Grist will send onRecords → re-render.
    } catch (err) {
      showToast(actionErrorMessage('Duplicate', err));
    } finally {
      // Re-enabled if the DOM was not rebuilt in the meantime.
      if (btn.isConnected) btn.disabled = false;
    }
  }

  async function onDelete(btn, idStr) {
    // First click: arm (two-step confirmation, auto-disarm ~4 s).
    if (!armedDeletes.has(idStr)) {
      btn.classList.add('armed');
      btn.textContent = '?';
      btn.title = T.confirmDel;
      btn.setAttribute('aria-label', T.confirmDel);
      armedDeletes.set(idStr, setTimeout(() => disarmDelete(btn, idStr), 4000));
      return;
    }
    // Second click: execute.
    clearTimeout(armedDeletes.get(idStr));
    armedDeletes.delete(idStr);
    btn.disabled = true;
    try {
      await deleteRecordsByIds([idStr]);
      // No local mutation: Grist will send onRecords → re-render.
    } catch (err) {
      showToast(actionErrorMessage('Delete', err));
      disarmDelete(btn, idStr);
    } finally {
      if (btn.isConnected) btn.disabled = false;
    }
  }

  content.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-act]');
    if (btn && content.contains(btn) && !btn.disabled) {
      const idStr = btn.dataset.id;
      if (btn.dataset.act === 'dup') onDuplicate(btn, idStr);
      else if (btn.dataset.act === 'del') onDelete(btn, idStr);
      return;
    }
    const editBtn = e.target.closest('button[data-edit-id][data-edit-col]');
    if (editBtn && content.contains(editBtn) && !editBtn.disabled)
      openFieldEditor(editBtn.dataset.editId, editBtn.dataset.editCol);
  });

  cellEditorText.addEventListener('input', updateEditorCharacterCount);
  function onEditorKeydown(e) {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      saveFieldEditor();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      closeFieldEditor();
    }
  }
  cellEditorText.addEventListener('keydown', onEditorKeydown);
  cellEditorDateTime.addEventListener('keydown', onEditorKeydown);
  btnEditorClose.addEventListener('click', closeFieldEditor);
  btnEditorCancel.addEventListener('click', closeFieldEditor);
  btnEditorSave.addEventListener('click', saveFieldEditor);

  function renderCell(val, col) {
    if (val == null || val === '')
      return `<span class="cell-null" aria-label="${T.cellEmpty}">—</span>`;
    if (val === true || val === false) {
      const fmt = BOOL_FORMATS.find(f => f.key === boolFmtKey) || BOOL_FORMATS[0];
      return val ? fmt.t : fmt.f;
    }
    if (typeof val === 'number') {
      const isYearLike = Number.isInteger(val) && val >= 1000 && val <= 9999;
      if (isYearLike) return `<span class="cell-num">${val}</span>`;
      // Grist Date and DateTime columns both arrive as epoch seconds. Format
      // every value in a detected date column, not only midnight-aligned dates.
      if (col && isDateLikeColumn(col))
        return `<span class="cell-num">${formatUtcDateSec(val)}</span>`;
      return `<span class="cell-num">${String(val)}</span>`;
    }
    if (Array.isArray(val)) return esc(val.join(', '));
    // Grist can expose ISO values as primitive strings or object wrappers.
    // The strict parser prevents ordinary objects/text from being reformatted.
    const sec = parseDateValueSec(val);
    if (sec != null)
      return `<span class="cell-num">${formatUtcDateSec(sec)}</span>`;
    return esc(String(val));
  }
