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
    // Called for every rendered cell: check this column directly rather than
    // rebuilding candidate lists across all columns for each cell.
    if (!writableColumnIds.includes(col)) return null;
    const type = writableColumnTypes[col];
    if (isNumericColumnType(type)) return 'number';
    if (col === parseGroupBy(groupBy).col) return null;
    if (isDateTimeColumnType(type)) return 'datetime';
    if (editableColumns.has(col) && isTextColumnType(type)) return 'text';
    return null;
  }

  function editLabelForKind(kind) {
    return kind === 'datetime' ? T.editDateTime : kind === 'number' ? T.editNumber : T.editCell;
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
    const automaticCandidates = editableDateTimeCandidates().concat(allColumns.filter(col =>
      writableColumnIds.includes(col) && isNumericColumnType(writableColumnTypes[col])));
    if (!textCandidates.length && !automaticCandidates.length) {
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
    automaticCandidates.forEach(col => {
      const label = document.createElement('label');
      label.className = 'editable-col-option automatic';
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = true;
      cb.disabled = true;
      const text = document.createElement('span');
      text.textContent = col;
      const badge = document.createElement('small');
      badge.textContent = isNumericColumnType(writableColumnTypes[col]) ? 'Number · automatic' : T.editableAuto;
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
    const config = typeof WIDGET_CONFIG === 'undefined' ? null : WIDGET_CONFIG;
    const hidden = config?.hiddenDisplayColumns || [];
    return columnOrder.filter(col => allColumns.includes(col)
      && !hidden.includes(col) && (config?.showGroupingColumn || col !== groupCol));
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

  let columnLayoutSaveQueue = Promise.resolve();

  function queueColumnLayoutOption(key, value, action) {
    const snapshot = Array.isArray(value) ? [...value] : { ...value };
    columnLayoutSaveQueue = columnLayoutSaveQueue
      .then(() => grist.setOption(key, snapshot))
      .catch(err => showToast(actionErrorMessage(action, err), 'error'));
    return columnLayoutSaveQueue;
  }

  function saveColumnOrder() {
    return queueColumnLayoutOption('columnOrder', columnOrder, 'Save column order');
  }

  function saveColumnWidths() {
    return queueColumnLayoutOption('columnWidths', columnWidths, 'Save column widths');
  }

  function saveColumnLayout() {
    saveColumnOrder();
    return saveColumnWidths();
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
    saveColumnOrder();
    render();
    return true;
  }

  function buildColumnFooter(col) {
    return `<th scope="col" class="column-header" draggable="true" tabindex="0"`
      + ` title="${esc(col)} — ${esc(T.reorderColumn)}" data-column="${esc(col)}">`
      + `<span class="column-footer-content"><span class="column-name">${esc(col)}</span>`
      + `</span>`
      + `<span class="column-resize-handle" draggable="false" tabindex="0"`
      + ` role="separator" aria-orientation="vertical"`
      + ` aria-label="${esc(T.resizeColumn)} ${esc(col)}"></span></th>`;
  }

  function buildGroupSums(records, cols) {
    const sumColumns = typeof WIDGET_CONFIG === 'undefined' ? null : WIDGET_CONFIG.sumColumns;
    return '<span class="group-sums">' + cols.filter(col =>
      isNumericColumn(col) && (!sumColumns || sumColumns.includes(col))).map(col => {
      const sum = sumColumn(records, col);
      const value = sum == null ? '—' : String(sum);
      const label = sumColumns ? 'Salary subtotal' : `Sum of ${col}`;
      return `<span class="group-sum" data-column="${esc(col)}"`
        + ` title="${esc(label)}" aria-label="${esc(label)}: ${esc(value)}">`
        + `${esc(value)}</span>`;
    }).join('') + '</span>';
  }

  let groupSumAlignFrame = 0;
  function scheduleGroupSumAlignment() {
    cancelAnimationFrame(groupSumAlignFrame);
    groupSumAlignFrame = requestAnimationFrame(() => {
      const placements = [];
      content.querySelectorAll('.group').forEach(card => {
        const headerRect = card.querySelector('.group-header').getBoundingClientRect();
        const footers = new Map([...card.querySelectorAll('tfoot th[data-column]')]
          .map(cell => [cell.dataset.column, cell]));
        card.querySelectorAll('.group-sum').forEach(sum => {
          const cell = footers.get(sum.dataset.column);
          if (!cell) return;
          const rect = cell.getBoundingClientRect();
          const padding = parseFloat(getComputedStyle(cell).paddingLeft) || 0;
          placements.push({ sum, left: rect.left + padding - headerRect.left,
            width: Math.max(0, rect.width - padding * 2) });
        });
      });
      // Finish layout reads before writing styles, avoiding per-column reflow.
      placements.forEach(({ sum, left, width }) => {
        sum.style.left = `${left}px`;
        sum.style.maxWidth = `${width}px`;
      });
    });
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

  function salaryDateColumn(col) {
    const type = columnBaseType(columnTypes[col]);
    return type ? type === 'Date' || type === 'DateTime' : knownDateCols.has(col);
  }

  function isValidGroupByOption(value) {
    if (!value) return false;
    const { col, granularity } = parseGroupBy(value);
    if (!allColumns.includes(col)) return false;
    if (typeof WIDGET_CONFIG !== 'undefined' && WIDGET_CONFIG.monthlyOnly)
      return granularity === 'month' && salaryDateColumn(col);
    return !granularity
      || (knownDateCols.has(col) && DATE_GRANULARITIES.includes(granularity));
  }

  function applyStartupGroupDefault() {
    // Options, records, and table metadata are delivered independently by Grist.
    // Wait for all three so a saved grouping always wins and ChoiceList is never
    // mistaken for a single-value Choice column.
    if (!optionsLoaded || !metadataLoaded || allColumns.length === 0) return false;
    if (isValidGroupByOption(groupBy)) return false;

    if (typeof WIDGET_CONFIG !== 'undefined' && WIDGET_CONFIG.monthlyOnly) {
      const dateColumn = allColumns.find(col => col.toLowerCase() === 'date' && salaryDateColumn(col))
        || allColumns.find(col => salaryDateColumn(col)
          && ['Date', 'DateTime'].includes(columnBaseType(columnTypes[col])))
        || allColumns.find(col => salaryDateColumn(col));
      if (!dateColumn) {
        groupBy = '';
        groupSelect.value = '';
        return false;
      }
      groupBy = `${dateColumn}::month`;
      collapsed.clear();
      rebuildColumnSelect();
      groupSelect.value = groupBy;
      grist.setOption('groupBy', groupBy);
      recordActionDiagnostic('Auto grouping', 'ok', `column=${dateColumn} · month`);
      return true;
    }

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
      if (Object.prototype.hasOwnProperty.call(opts, 'rowSort') && !pendingRowSortSaves) {
        const nextRowSort = normalizeRowSort(opts.rowSort);
        if (rowSort.column !== nextRowSort.column || rowSort.direction !== nextRowSort.direction)
          cellRangeEnd = null;
        rowSort = nextRowSort;
      }
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
      rebuildColumnSelect();
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
      if (typeof WIDGET_CONFIG !== 'undefined' && WIDGET_CONFIG.monthlyOnly
          && groupBy && !isValidGroupByOption(groupBy)) groupBy = '';
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
      if (typeof WIDGET_CONFIG !== 'undefined' && WIDGET_CONFIG.monthlyOnly) {
        if (!salaryDateColumn(col)) return;
        const option = new Option(`${col} — ${T.byMonth}`, `${col}::month`);
        groupSelect.add(option);
        return;
      }
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

  // Row sorting is a local view preference, never a manualSort/data write.
  let rowSortSaveQueue = Promise.resolve();
  let pendingRowSortSaves = 0;
  const rowSortCollator = new Intl.Collator(LOCALE, { numeric: true, sensitivity: 'base' });

  function normalizeRowSort(value) {
    try {
      const parsed = typeof value === 'string' ? JSON.parse(value) : value;
      return { column: typeof parsed?.column === 'string' ? parsed.column : '',
        direction: parsed?.direction === 'desc' ? 'desc' : 'asc' };
    } catch (_) { return { column: '', direction: 'asc' }; }
  }

  function rowSortColumnType() {
    const type = columnBaseType(columnTypes[rowSort.column]);
    return type || (allColumns.includes(rowSort.column) && isDateLikeColumn(rowSort.column) ? 'DateTime' : '');
  }

  function refreshRowSortControls() {
    rowSortSelect.replaceChildren(new Option('Grist order', ''));
    allColumns.forEach(col => rowSortSelect.add(new Option(col, col)));
    if (rowSort.column && !allColumns.includes(rowSort.column)) {
      const missing = new Option(`${rowSort.column} (unavailable)`, rowSort.column);
      missing.disabled = true;
      rowSortSelect.add(missing);
    }
    rowSortSelect.value = rowSort.column;
    const type = rowSortColumnType();
    const labels = type === 'Date' || type === 'DateTime' ? ['Oldest first', 'Newest first']
      : type === 'Int' || type === 'Numeric' ? ['Lowest first', 'Highest first']
      : type === 'Bool' ? ['False first', 'True first'] : ['A → Z', 'Z → A'];
    rowSortDirection.options[0].textContent = labels[0];
    rowSortDirection.options[1].textContent = labels[1];
    rowSortDirection.value = rowSort.direction;
    rowSortDirection.disabled = !rowSort.column || !allColumns.includes(rowSort.column);
  }

  function changeRowSort() {
    rowSort = { column: rowSortSelect.value, direction: rowSortDirection.value };
    const snapshot = { ...rowSort };
    // Reordering changes what lies between range endpoints: retain just the
    // active cell, rather than silently selecting a different rectangle.
    cellRangeEnd = null;
    render();
    pendingRowSortSaves++;
    rowSortSaveQueue = rowSortSaveQueue
      .then(() => grist.setOption('rowSort', snapshot))
      .catch(err => showToast(actionErrorMessage('Save row sorting', err)))
      .finally(() => { pendingRowSortSaves--; });
  }
  rowSortSelect.addEventListener('change', changeRowSort);
  rowSortDirection.addEventListener('change', changeRowSort);

  function sortGroupRows(groups) {
    if (!rowSort.column || !allColumns.includes(rowSort.column)) return;
    const type = rowSortColumnType();
    const direction = rowSort.direction === 'desc' ? -1 : 1;
    const keyFor = value => {
      if (value == null || value === '') return null;
      if (type === 'Date' || type === 'DateTime') {
        const seconds = parseDateValueSec(value);
        return Number.isFinite(seconds) ? seconds : null;
      }
      if (type === 'Int' || type === 'Numeric' || type === 'Bool' || typeof value === 'number') {
        const number = Number(value);
        return Number.isFinite(number) ? number : null;
      }
      return String(value);
    };
    groups.forEach(group => {
      // Parse once per row, not on every comparator call. Tie order remains
      // the incoming Grist order in either direction; blanks always go last.
      group.records = group.records.map((record, index) => ({ record, index, key: keyFor(record[rowSort.column]) }))
        .sort((a, b) => {
          if (a.key == null || b.key == null)
            return a.key == null && b.key == null ? a.index - b.index : a.key == null ? 1 : -1;
          const comparison = typeof a.key === 'number' && typeof b.key === 'number'
            ? a.key - b.key : rowSortCollator.compare(String(a.key), String(b.key));
          return comparison * direction || a.index - b.index;
        }).map(item => item.record);
    });
  }

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
    const dateMode = !!granularity && allColumns.includes(col)
      && (typeof WIDGET_CONFIG !== 'undefined' && WIDGET_CONFIG.monthlyOnly
        ? salaryDateColumn(col) : isDateLikeColumn(col));
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
          const calendarSec = isDateTimeColumnType(columnTypes[col])
            ? dateTimeWallDate(sec).getTime() / 1000 : sec;
          const ms = bucketStartMs(calendarSec, granularity);
          key     = String(ms);               // the key carries the bucket epoch
          label   = bucketLabel(ms, granularity);
          sortKey = ms;
          writeValue = raw;
        }
      } else {
        key = String(raw); label = raw; sortKey = null; writeValue = raw;
        if (isDateTimeColumnType(columnTypes[col]) && parseDateValueSec(raw) != null)
          label = formatDateTimeSec(parseDateValueSec(raw));
      }
      if (!map.has(key))
        map.set(key, { key, label, sortKey, writeValue, records: [] });
      map.get(key).records.push(rec);
    });
    const groups = Array.from(map.values());
    sortGroupRows(groups);
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
    const restoreNumberFocus = document.activeElement === cellEditorNumber;
    const numberSelection = [cellEditorNumber.selectionStart, cellEditorNumber.selectionEnd];
    refreshRowSortControls();
    if (typeof closeRowContextMenu === 'function') closeRowContextMenu(false);
    const restoreCellFocus = content.contains(document.activeElement)
      && document.activeElement.closest('td.data-cell');
    Array.from(content.children).forEach(c => {
      if (c.id !== 'empty-state') c.remove();
    });

    if (!groupBy || allRecords.length === 0) {
      if (editingCell?.kind === 'number') {
        cellEditorDialog.insertBefore(cellEditorNumber, cellEditorDateTimePanel);
        closeFieldEditor();
      }
      emptyState.style.display = '';
      // No known column (never saw data): dedicated message.
      const noData = !groupBy && allColumns.length === 0;
      emptyState.querySelector('.empty-title').textContent =
        noData ? T.emptyNoDataTitle
               : (!groupBy ? T.emptyTitle : T.emptyTitleNoRec);
      emptyState.querySelector('.empty-sub').innerHTML =
        noData ? T.emptyNoDataSub
               : (!groupBy ? T.emptySub : T.emptySubNoRec);
      if (typeof WIDGET_CONFIG !== 'undefined' && WIDGET_CONFIG.monthlyOnly && !groupBy) {
        const table = selectedTableId === 'unknown' ? 'the selected table' : esc(selectedTableId);
        emptyState.querySelector('.empty-title').textContent = allRecords.length
          ? (metadataLoaded ? 'No Date/DateTime column available' : 'Loading date columns…')
          : T.emptyNoDataTitle;
        emptyState.querySelector('.empty-sub').innerHTML = allRecords.length
          ? `Source: ${table} · ${allRecords.length} records. Choose a class table with a Date/DateTime column and wage in Grist’s Edit data selection.`
          : `Source: ${table}. Check the Select By link and choose a teacher in Grist.`;
      }
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
        refreshCellRange();
      });

      const body = document.createElement('div');
      body.className = 'group-body';
      body.id = bodyId;
      body.setAttribute('role', 'region');
      body.setAttribute('aria-label', T.ariaGroupRegion + labelTxt);

      const inner = document.createElement('div');
      inner.className = 'group-body-inner';
      inner.innerHTML = buildTable(displayCols, group);

      body.appendChild(inner);
      card.appendChild(header);
      card.appendChild(body);
      content.appendChild(card);
    });
    document.querySelectorAll('.scroll-inner').forEach(scroller => {
      scroller.scrollLeft = sharedTableScrollLeft;
    });
    startPendingRowAnimations();
    refreshCellRange();
    if (editingCell && editingCell.kind === 'number') {
      const cell = findDataCell(editingCell.recordId, editingCell.col);
      if (cell && editKindForColumn(editingCell.col) === 'number') {
        attachInlineNumber(cell);
        if (restoreNumberFocus) {
          cellEditorNumber.focus({ preventScroll: true });
          cellEditorNumber.setSelectionRange(...numberSelection);
        }
      } else if (!btnEditorSave.disabled) closeFieldEditor();
    } else if (restoreCellFocus) focusSelectedCell();
    scheduleGroupSumAlignment();
    refreshBoolSection();
  }

  function gripIconHtml() {
    return `<svg class="grip-icon" viewBox="0 0 12 16" aria-hidden="true"`
      + ` focusable="false"><circle cx="3" cy="3" r="1.25"/>`
      + `<circle cx="9" cy="3" r="1.25"/><circle cx="3" cy="8" r="1.25"/>`
      + `<circle cx="9" cy="8" r="1.25"/><circle cx="3" cy="13" r="1.25"/>`
      + `<circle cx="9" cy="13" r="1.25"/></svg>`;
  }

  function plusIconHtml() {
    return `<svg class="add-row-icon" viewBox="0 0 16 16" fill="none"`
      + ` stroke="currentColor" stroke-width="1.8" stroke-linecap="round"`
      + ` aria-hidden="true" focusable="false"><path d="M8 3v10M3 8h10"/></svg>`;
  }

  function buildTable(cols, group) {
    // Per-row selection/drag control first, actions column last. The table's
    // structural controls and aggregates live in a footer below the records.
    const records = group.records;
    const groupLabel = group.key === '\x00__empty__' ? T.emptyGroup : String(group.label);
    const addContext = getAddRowContext(group);
    const addLabel = addContext.enabled
      ? `${T.addRowToGroup} ${groupLabel}`
      : `${T.addRowUnavailable}: ${addContext.reason}`;
    const footer = '<th class="col-grip">'
      + `<button type="button" class="group-add-row" data-group-key="${esc(encodeURIComponent(group.key))}"`
      + ` title="${esc(addLabel)}" aria-label="${esc(addLabel)}"`
      + `${addContext.enabled ? '' : ' disabled'}>${plusIconHtml()}</button></th>`
      + cols.map(col => buildColumnFooter(col)).join('')
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
      <tbody>${tbody}</tbody>
      <tfoot><tr>${footer}</tr></tfoot>
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
    saveColumnWidths();
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
    saveColumnWidths();
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
      saveColumnWidths();
      applyColumnWidthsToDOM();
      return;
    }
    if (handle && (e.key === 'Home' || e.key === 'Delete')) {
      e.preventDefault();
      e.stopPropagation();
      const th = handle.closest('th[data-column]');
      delete columnWidths[th.dataset.column];
      saveColumnWidths();
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
    const toast = document.getElementById('toast');
    toast.setAttribute('role', tone === 'success' ? 'status' : 'alert');
    toast.setAttribute('aria-live', tone === 'success' ? 'polite' : 'assertive');
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

  const CELL_CLIPBOARD_MIME = 'application/x-arkhivar-grist-cell';
  const CELL_COPY_TYPES = new Set([
    'Text', 'Choice', 'Bool', 'Int', 'Numeric', 'Date', 'DateTime',
  ]);
  const CELL_HISTORY_LIMIT = 50;

  function cellColumnType(col) {
    return columnBaseType(writableColumnTypes[col] || columnTypes[col]);
  }

  function isSupportedCellColumn(col) {
    return CELL_COPY_TYPES.has(cellColumnType(col));
  }

  function isWritableCellColumn(col) {
    return writableColumnIds.includes(col) && isSupportedCellColumn(col);
  }

  function cellHistoryValue(value, type) {
    if (value == null) return null;
    return normalizeCellValueForWrite(value, type);
  }

  function updateCellHistoryControls() {
    const undoEntry = cellUndoStack[cellUndoStack.length - 1];
    const redoEntry = cellRedoStack[cellRedoStack.length - 1];
    const undoLabel = undoEntry
      ? `${T.undo} ${undoEntry.label} (Ctrl/Cmd+Z)`
      : T.nothingToUndo;
    const redoLabel = redoEntry
      ? `${T.redo} ${redoEntry.label} (Ctrl/Cmd+Y)`
      : T.nothingToRedo;
    btnUndo.disabled = cellHistoryBusy || !undoEntry;
    btnRedo.disabled = cellHistoryBusy || !redoEntry;
    btnUndo.title = undoLabel;
    btnRedo.title = redoLabel;
    btnUndo.setAttribute('aria-label', undoLabel);
    btnRedo.setAttribute('aria-label', redoLabel);
  }

  function rememberCellHistory(label, col, changes) {
    const meaningful = changes.filter(change => !Object.is(change.before, change.after));
    if (!meaningful.length) return;
    rememberHistoryEntry({ label, col, changes: meaningful });
  }

  function rememberHistoryEntry(entry) {
    cellUndoStack.push(entry);
    if (cellUndoStack.length > CELL_HISTORY_LIMIT) cellUndoStack.shift();
    cellRedoStack.length = 0;
    updateCellHistoryControls();
  }

  function applyCellChangesLocally(col, changes, side) {
    const byId = new Map(changes.map(change => [change.id, change[side]]));
    allRecords.forEach(record => {
      const id = Number(record.id);
      if (byId.has(id)) record[col] = byId.get(id);
    });
  }

  async function replayCellHistory(direction) {
    if (cellHistoryBusy) return;
    const isUndo = direction === 'undo';
    const source = isUndo ? cellUndoStack : cellRedoStack;
    const destination = isUndo ? cellRedoStack : cellUndoStack;
    const entry = source[source.length - 1];
    if (!entry) return;
    if (entry.kind === 'create') {
      cellHistoryBusy = true;
      updateCellHistoryControls();
      try {
        if (isUndo) {
          const table = await grist.docApi.fetchTable(entry.tableId);
          const index = table.id.indexOf(entry.id);
          if (index < 0) throw new Error('The added record no longer exists');
          entry.fields = Object.fromEntries(writableColumnIds
            .filter(col => Object.prototype.hasOwnProperty.call(table, col))
            .map(col => [col, table[col][index]]));
          if (table.manualSort) entry.fields.manualSort = table.manualSort[index];
          await grist.docApi.applyUserActions([
            ['RemoveRecord', entry.tableId, entry.id],
          ]);
          allRecords = allRecords.filter(record => Number(record.id) !== entry.id);
        } else {
          // Keep the ID so older edit/paste history still points to this row.
          const table = await grist.docApi.fetchTable(entry.tableId);
          if (table.id.includes(entry.id))
            throw new Error('Cannot redo: another record now uses the original row ID');
          await grist.docApi.applyUserActions([
            ['AddRecord', entry.tableId, entry.id, entry.fields],
          ], { parseStrings: false });
          queueRowAnimation(entry.id, 'row-enter', 950);
        }
        source.pop();
        destination.push(entry);
        render();
      } catch (err) {
        showToast(actionErrorMessage(isUndo ? T.undo : T.redo, err));
      } finally {
        cellHistoryBusy = false;
        updateCellHistoryControls();
      }
      return;
    }
    const side = isUndo ? 'before' : 'after';
    const updates = entry.changes.map(change => ({
      id: change.id,
      fields: { [change.col || entry.col]: change[side] },
    }));
    const action = isUndo ? T.undo : T.redo;
    const detail = `action=${entry.label} · records=${entry.changes.map(change => change.id).join(',')}`
      + ` · column=${entry.col}`;
    cellHistoryBusy = true;
    updateCellHistoryControls();
    recordActionDiagnostic(action, 'start', detail);
    try {
      if (entry.kind === 'range') {
        await grist.docApi.applyUserActions(updates.map(update =>
          ['UpdateRecord', entry.tableId, update.id, update.fields]), { parseStrings: false });
      } else {
        await grist.selectedTable.update(
          updates.length === 1 ? updates[0] : updates,
          { parseStrings: false });
      }
      source.pop();
      destination.push(entry);
      entry.changes.forEach(change => applyCellChangesLocally(change.col || entry.col, [change], side));
      selectedCell = {
        recordId: String(entry.changes[0].id),
        col: entry.changes[0].col || entry.col,
      };
      cellRangeEnd = null;
      recordActionDiagnostic(action, 'ok', detail);
      showToast(`${action} complete: ${entry.label}`, 'success');
      render();
      requestAnimationFrame(focusSelectedCell);
    } catch (err) {
      showToast(actionErrorMessage(action, err));
    } finally {
      cellHistoryBusy = false;
      updateCellHistoryControls();
    }
  }

  function selectedCellMatches(recordId, col) {
    return Boolean(selectedCell &&
      selectedCell.recordId === String(recordId) && selectedCell.col === col);
  }

  function normalizeCellValueForWrite(value, type) {
    if (type === 'Text' || type === 'Choice') return value == null ? '' : String(value);
    if (value == null || value === '') return null;
    if (type === 'Bool') return Boolean(value);
    if (type === 'Int' || type === 'Numeric') {
      const number = Number(value);
      return Number.isFinite(number) ? number : null;
    }
    if (type === 'Date' || type === 'DateTime') {
      const seconds = parseDateValueSec(value);
      if (seconds == null) return null;
      if (type === 'Date') {
        const date = new Date(seconds * 1000);
        return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()) / 1000;
      }
      return Math.floor(seconds / 60) * 60;
    }
    return null;
  }

  function cellClipboardText(value, type) {
    if (value == null || value === '') return '';
    if (type === 'Bool') return value ? 'true' : 'false';
    if (type === 'Date' || type === 'DateTime') {
      const seconds = parseDateValueSec(value);
      if (seconds == null) return '';
      const iso = new Date(seconds * 1000).toISOString();
      return type === 'Date' ? iso.slice(0, 10) : formatDateTimeSec(seconds);
    }
    return String(value);
  }

  function parsePastedCellText(text, type) {
    if (type === 'Text' || type === 'Choice') return text;
    const normalized = String(text || '').trim();
    if (!normalized) return null;
    if (type === 'Bool') {
      if (/^(true|yes|1|✓)$/i.test(normalized)) return true;
      if (/^(false|no|0|✗)$/i.test(normalized)) return false;
      throw new Error(`Paste requires a Boolean value, not "${normalized}"`);
    }
    if (type === 'Int' || type === 'Numeric') {
      const number = Number(normalized);
      if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(normalized)
          || !Number.isFinite(number) || (type === 'Int' && !Number.isSafeInteger(number)))
        throw new Error(`Paste requires a valid ${type} value, not "${normalized}"`);
      return number;
    }
    if (type === 'Date' || type === 'DateTime') {
      const seconds = type === 'DateTime' ? parseDateTimeWallSec(normalized) : parseDateValueSec(normalized);
      if (seconds == null) throw new Error(`Paste requires a valid ${type} value`);
      return normalizeCellValueForWrite(seconds, type);
    }
    throw new Error(`Paste is not supported for ${type || 'this column type'}`);
  }

  function findDataCell(recordId, col) {
    return [...content.querySelectorAll('td.data-cell')].find(cell =>
      cell.dataset.cellId === String(recordId) && cell.dataset.cellCol === col) || null;
  }

  function focusSelectedCell() {
    if (!selectedCell) return;
    const cell = findDataCell(selectedCell.recordId, selectedCell.col);
    if (cell) cell.focus({ preventScroll: true });
  }

  function visibleCellRows() {
    return [...content.querySelectorAll('.group:not(.collapsed) tbody tr')]
      .map(row => [...row.querySelectorAll('td.data-cell')]).filter(row => row.length);
  }

  function selectedCellGrid() {
    if (!selectedCell) return [];
    const rows = visibleCellRows();
    const endpoint = cellRangeEnd || selectedCell;
    const r1 = rows.findIndex(row => row[0].dataset.cellId === selectedCell.recordId);
    const r2 = rows.findIndex(row => row[0].dataset.cellId === endpoint.recordId);
    if (r1 < 0 || r2 < 0) return [];
    const c1 = rows[r1].findIndex(cell => cell.dataset.cellCol === selectedCell.col);
    const c2 = rows[r2].findIndex(cell => cell.dataset.cellCol === endpoint.col);
    if (c1 < 0 || c2 < 0) return [];
    return rows.slice(Math.min(r1, r2), Math.max(r1, r2) + 1)
      .map(row => row.slice(Math.min(c1, c2), Math.max(c1, c2) + 1));
  }

  function refreshCellRange() {
    const classes = ['cell-selected', 'cell-range', 'range-top', 'range-bottom', 'range-left', 'range-right'];
    content.querySelectorAll('td.data-cell').forEach(cell => {
      cell.classList.remove(...classes);
      cell.setAttribute('aria-selected', 'false');
      cell.tabIndex = -1;
    });
    const grid = selectedCellGrid();
    const multi = grid.length > 1 || (grid[0] && grid[0].length > 1);
    grid.forEach((row, r) => row.forEach((cell, c) => {
      cell.classList.add('cell-selected');
      if (multi) {
        cell.classList.add('cell-range');
        if (r === 0) cell.classList.add('range-top');
        if (r === grid.length - 1) cell.classList.add('range-bottom');
        if (c === 0) cell.classList.add('range-left');
        if (c === row.length - 1) cell.classList.add('range-right');
      }
      cell.setAttribute('aria-selected', 'true');
      if (selectedCellMatches(cell.dataset.cellId, cell.dataset.cellCol)) cell.tabIndex = 0;
    }));
  }

  function selectDataCell(cell, focus = true, extend = false) {
    if (!cell) return false;
    const position = { recordId: cell.dataset.cellId, col: cell.dataset.cellCol };
    if (extend && selectedCell && selectedCellGrid().length) cellRangeEnd = position;
    else { selectedCell = position; cellRangeEnd = null; }
    refreshCellRange();
    if (focus) focusSelectedCell();
    return true;
  }

  function clearSelectedCell() {
    selectedCell = null;
    cellRangeEnd = null;
    refreshCellRange();
  }

  function isClipboardInput(target) {
    return Boolean(target && target.closest &&
      target.closest('input, textarea, select, [contenteditable="true"]'));
  }

  async function writeCellValues(action, recordIds, col, value) {
    if (cellHistoryBusy) return;
    const ids = [...new Set(recordIds.map(id => validRecordId(id)).filter(id => id != null))];
    if (!ids.length) return;
    const type = cellColumnType(col);
    const after = cellHistoryValue(value, type);
    const changes = ids.map(id => {
      const record = allRecords.find(item => Number(item.id) === id);
      return {
        id,
        before: record ? cellHistoryValue(record[col], type) : null,
        after,
      };
    }).filter(change => !Object.is(change.before, change.after));
    if (!changes.length) {
      showToast('No cell changes to apply', 'success');
      return;
    }
    const updates = changes.map(change => ({ id: change.id, fields: { [col]: change.after } }));
    const changedIds = changes.map(change => change.id);
    const detail = `records=${changedIds.join(',')} · column=${col} · type=${type}`;
    recordActionDiagnostic(action, 'start', detail);
    cellHistoryBusy = true;
    updateCellHistoryControls();
    try {
      await grist.selectedTable.update(
        updates.length === 1 ? updates[0] : updates,
        { parseStrings: false });
      applyCellChangesLocally(col, changes, 'after');
      rememberCellHistory(action, col, changes);
      recordActionDiagnostic(action, 'ok', detail);
      showToast(action === 'Fill' ? `${changes.length} cells filled` : 'Cell pasted', 'success');
      render();
      requestAnimationFrame(focusSelectedCell);
    } catch (err) {
      showToast(actionErrorMessage(action, err));
    } finally {
      cellHistoryBusy = false;
      updateCellHistoryControls();
    }
  }

  function encodeClipboardGrid(rows) {
    return rows.map(row => row.map(text => /[\t\r\n"]/.test(text)
      ? '"' + text.replace(/"/g, '""') + '"' : text).join('\t')).join('\n');
  }

  function decodeClipboardGrid(text) {
    const rows = [[]];
    let value = '', quoted = false;
    for (let i = 0; i < text.length; i++) {
      const char = text[i];
      if (char === '"' && (quoted || value === '')) {
        if (quoted && text[i + 1] === '"') { value += '"'; i++; }
        else quoted = !quoted;
      } else if (!quoted && (char === '\t' || char === '\r' || char === '\n')) {
        rows[rows.length - 1].push(value);
        value = '';
        if (char !== '\t') {
          if (char === '\r' && text[i + 1] === '\n') i++;
          rows.push([]);
        }
      } else value += char;
    }
    if (quoted) throw new Error('Clipboard contains an unfinished quoted cell');
    rows[rows.length - 1].push(value);
    if (rows.length > 1 && /[\r\n]$/.test(text)) rows.pop();
    return rows;
  }

  function copySelectedCell(e) {
    if (!selectedCell || isClipboardInput(e.target) || !e.clipboardData) return;
    const grid = selectedCellGrid();
    if (!grid.length) return;
    const cells = grid.map(row => row.map(cell => {
      const col = cell.dataset.cellCol;
      const type = cellColumnType(col);
      const record = allRecords.find(item => String(item.id) === cell.dataset.cellId);
      return { type, value: normalizeCellValueForWrite(record[col], type) };
    }));
    if (cells.some(row => row.some(cell => !CELL_COPY_TYPES.has(cell.type)))) {
      e.preventDefault();
      showToast('Copy blocked: the selection includes an unsupported column type');
      return;
    }
    const text = encodeClipboardGrid(cells.map(row =>
      row.map(cell => cellClipboardText(cell.value, cell.type))));
    copiedCell = { cells, text };
    e.clipboardData.setData('text/plain', text);
    try { e.clipboardData.setData(CELL_CLIPBOARD_MIME, JSON.stringify(copiedCell)); } catch (_) {}
    e.preventDefault();
    const copiedCount = cells.length * cells[0].length;
    showToast(`${copiedCount} ${copiedCount === 1 ? 'cell' : 'cells'} copied`, 'success');
  }

  async function pasteSelectedCell(e) {
    if (!selectedCell || isClipboardInput(e.target) || !e.clipboardData) return;
    e.preventDefault();
    if (cellHistoryBusy) return;
    const text = e.clipboardData.getData('text/plain');
    let packet = null;
    try {
      const encoded = e.clipboardData.getData(CELL_CLIPBOARD_MIME);
      if (encoded) packet = JSON.parse(encoded);
    } catch (_) {}
    if (!packet && copiedCell && copiedCell.text === text) packet = copiedCell;
    try {
      const values = packet ? (packet.cells || [[packet]]) : decodeClipboardGrid(text);
      if (!Array.isArray(values) || !values.length || !Array.isArray(values[0]) ||
          !values[0].length || values.some(row => !Array.isArray(row) || row.length !== values[0].length))
        throw new Error('Paste requires a rectangular block of cells');
      const grid = selectedCellGrid();
      if (!grid.length) return;
      const rows = visibleCellRows();
      const first = grid[0][0];
      const rowStart = rows.findIndex(row => row[0].dataset.cellId === first.dataset.cellId);
      const colStart = rows[rowStart].indexOf(first);
      const singleTarget = grid.length === 1 && grid[0].length === 1;
      const height = singleTarget ? values.length : grid.length;
      const width = singleTarget ? values[0].length : grid[0].length;
      if (height % values.length || width % values[0].length)
        throw new Error('The selected range must match the copied block or be a whole multiple of it');
      if (rowStart + height > rows.length || colStart + width > rows[rowStart].length)
        throw new Error('Not enough visible rows or columns for this paste');
      const changes = [];
      for (let r = 0; r < height; r++) {
        for (let c = 0; c < width; c++) {
          const target = rows[rowStart + r][colStart + c];
          const col = target.dataset.cellCol;
          if (!isWritableCellColumn(col)) throw new Error('Paste blocked: "' + col + '" is read-only or unsupported');
          const type = cellColumnType(col);
          const input = values[r % values.length][c % values[0].length];
          if (packet && (!input || input.type !== type))
            throw new Error('Paste blocked: ' + (input && input.type) + ' cannot be pasted into ' + type);
          const after = packet ? normalizeCellValueForWrite(input.value, type) : parsePastedCellText(input, type);
          const id = validRecordId(target.dataset.cellId);
          const record = allRecords.find(item => Number(item.id) === id);
          changes.push({ id, col, before: cellHistoryValue(record[col], type), after });
        }
      }
      // Preserve the existing single-cell path; rectangular writes use one atomic action bundle.
      if (changes.length === 1) {
        await writeCellValues('Paste', [changes[0].id], changes[0].col, changes[0].after);
        return;
      }
      const meaningful = changes.filter(change => !Object.is(change.before, change.after));
      if (!meaningful.length) return;
      cellHistoryBusy = true;
      updateCellHistoryControls();
      try {
        const tableId = await grist.selectedTable.getTableId();
        await grist.docApi.applyUserActions(meaningful.map(change =>
          ['UpdateRecord', tableId, change.id, { [change.col]: change.after }]), { parseStrings: false });
        meaningful.forEach(change => applyCellChangesLocally(change.col, [change], 'after'));
        rememberHistoryEntry({ kind: 'range', label: 'Paste range', tableId, changes: meaningful });
        selectedCell = { recordId: first.dataset.cellId, col: first.dataset.cellCol };
        const last = rows[rowStart + height - 1][colStart + width - 1];
        cellRangeEnd = { recordId: last.dataset.cellId, col: last.dataset.cellCol };
        render();
        focusSelectedCell();
        showToast(meaningful.length + ' cells pasted', 'success');
      } finally {
        cellHistoryBusy = false;
        updateCellHistoryControls();
      }
    } catch (err) {
      showToast(actionErrorMessage('Paste', err));
    }
  }

  function renderTableCell(rec, col) {
    const rendered = renderCell(rec[col], col);
    const editKind = editKindForColumn(col);
    const id = esc(String(rec.id));
    const colAttr = esc(col);
    const isSelected = selectedCellMatches(rec.id, col);
    const isWritable = isWritableCellColumn(col);
    const classes = ['data-cell', editKind ? 'cell-editable' : '', isSelected ? 'cell-selected' : '']
      .filter(Boolean).join(' ');
    const contentHtml = editKind
      ? `<button type="button" class="cell-edit-btn" data-edit-id="${id}" data-edit-col="${colAttr}" data-edit-kind="${editKind}"`
        + ` aria-label="${esc(editLabelForKind(editKind))}: ${colAttr}"`
        + (editKind === 'number' ? '>' : ` aria-haspopup="dialog" aria-expanded="false">`)
        + `<span class="cell-edit-value">${rendered}</span></button>`
      : rendered;
    return `<td class="${classes}" data-cell-id="${id}" data-cell-col="${colAttr}"`
      + ` data-cell-writable="${String(isWritable)}" tabindex="${isSelected ? '0' : '-1'}"`
      + (!isWritable && isNumericColumnType(columnTypes[col])
        ? ' title="Read-only number: edit its source values or formula in Grist"' : '')
      + ` aria-selected="${String(isSelected)}">${contentHtml}`
      + `<span class="cell-fill-handle" aria-hidden="true" title="${esc(T.fillCells)}"></span></td>`;
  }

  function updateEditorCharacterCount() {
    cellEditorCount.textContent = `${cellEditorText.value.length} ${T.editCharacters}`;
  }

  function setEditorBusy(busy) {
    cellEditorText.disabled = busy;
    cellEditorNumber.disabled = busy;
    cellEditorDateTimePanel.querySelectorAll('button, input').forEach(control => {
      control.disabled = busy;
    });
    btnEditorCancel.disabled = busy;
    btnEditorSave.disabled = busy;
    if (!busy) datePickerClear.disabled = !datePickerSelectedDate;
    btnEditorSave.textContent = busy ? 'Saving…' : T.editSave;
  }

  function dateTimeInputSec(value) {
    if (!value) return null;
    const seconds = parseDateTimeWallSec(value);
    if (seconds == null)
      throw new Error('Choose a valid date and time');
    return seconds;
  }

  let datePickerViewYear = 1970;
  let datePickerViewMonth = 0;
  let datePickerSelectedDate = '';
  let datePickerSelectedTime = '00:00';
  const datePickerMonthFormatter = new Intl.DateTimeFormat(LOCALE, {
    month: 'long', year: 'numeric', timeZone: 'UTC',
  });
  const datePickerDayFormatter = new Intl.DateTimeFormat(LOCALE, {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC',
  });

  function utcDateKey(date) {
    return date.toISOString().slice(0, 10);
  }

  function dateFromKey(key) {
    const parts = String(key || '').split('-').map(Number);
    if (parts.length !== 3 || parts.some(part => !Number.isInteger(part))) return null;
    const date = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2]));
    return Number.isNaN(date.getTime()) ? null : date;
  }

  function syncDateTimePickerValue() {
    cellEditorDateTime.value = datePickerSelectedDate
      ? `${datePickerSelectedDate}T${datePickerSelectedTime}`
      : '';
    datePickerClear.disabled = !datePickerSelectedDate || btnEditorSave.disabled;
  }

  function renderDatePickerTimes() {
    const values = [];
    for (let hour = 0; hour < 24; hour++) {
      for (const minute of [0, 30])
        values.push(`${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`);
    }
    if (!values.includes(datePickerSelectedTime)) {
      values.push(datePickerSelectedTime);
      values.sort();
    }
    datePickerTimeList.innerHTML = values.map(value => {
      const selected = value === datePickerSelectedTime;
      return `<button type="button" class="date-picker-time-option${selected ? ' selected' : ''}"`
        + ` data-time="${value}" role="option" aria-selected="${selected ? 'true' : 'false'}"`
        + ` tabindex="${selected ? '0' : '-1'}">${value}</button>`;
    }).join('');
    const selected = datePickerTimeList.querySelector('.date-picker-time-option.selected');
    if (selected) {
      const selectedIndex = values.indexOf(datePickerSelectedTime);
      const optionHeight = selected.offsetHeight || 36;
      datePickerTimeList.scrollTop = Math.max(0, (selectedIndex - 3) * optionHeight);
    }
  }

  function renderDateTimePicker() {
    const monthStart = new Date(Date.UTC(datePickerViewYear, datePickerViewMonth, 1));
    datePickerMonth.textContent = datePickerMonthFormatter.format(monthStart);
    const mondayOffset = (monthStart.getUTCDay() + 6) % 7;
    const gridStart = new Date(Date.UTC(
      datePickerViewYear, datePickerViewMonth, 1 - mondayOffset));
    const todayKey = utcDateKey(dateTimeWallDate());
    const selectedVisible = datePickerSelectedDate &&
      datePickerSelectedDate >= utcDateKey(gridStart) &&
      datePickerSelectedDate <= utcDateKey(new Date(gridStart.getTime() + 41 * 86400000));
    let firstCurrentMonthKey = '';
    const buttons = [];
    for (let index = 0; index < 42; index++) {
      const date = new Date(gridStart.getTime() + index * 86400000);
      const key = utcDateKey(date);
      const outside = date.getUTCMonth() !== datePickerViewMonth;
      if (!outside && !firstCurrentMonthKey) firstCurrentMonthKey = key;
      const selected = key === datePickerSelectedDate;
      const today = key === todayKey;
      const tabStop = selectedVisible ? selected : key === firstCurrentMonthKey;
      const classes = ['date-picker-day'];
      if (outside) classes.push('outside');
      if (today) classes.push('today');
      if (selected) classes.push('selected');
      buttons.push(`<button type="button" role="gridcell" class="${classes.join(' ')}"`
        + ` data-date="${key}" aria-label="${esc(datePickerDayFormatter.format(date))}"`
        + ` aria-selected="${selected ? 'true' : 'false'}" tabindex="${tabStop ? '0' : '-1'}">`
        + `${date.getUTCDate()}</button>`);
    }
    datePickerGrid.innerHTML = buttons.join('');
    renderDatePickerTimes();
    syncDateTimePickerValue();
  }

  function focusDateTimePicker() {
    const target = datePickerGrid.querySelector('.date-picker-day.selected')
      || datePickerGrid.querySelector('.date-picker-day:not(.outside)');
    if (target) target.focus();
  }

  function selectDatePickerDate(key, focusAfter = true) {
    const date = dateFromKey(key);
    if (!date) return;
    datePickerSelectedDate = utcDateKey(date);
    datePickerViewYear = date.getUTCFullYear();
    datePickerViewMonth = date.getUTCMonth();
    renderDateTimePicker();
    if (focusAfter) focusDateTimePicker();
  }

  function setDateTimePickerValue(sec) {
    const value = sec == null ? NaN : Number(sec);
    const date = Number.isFinite(value) ? dateTimeWallDate(value) : null;
    if (date && !Number.isNaN(date.getTime())) {
      datePickerSelectedDate = utcDateKey(date);
      datePickerViewYear = date.getUTCFullYear();
      datePickerViewMonth = date.getUTCMonth();
      datePickerSelectedTime = date.toISOString().slice(11, 16);
    } else {
      const now = dateTimeWallDate();
      datePickerSelectedDate = '';
      datePickerViewYear = now.getUTCFullYear();
      datePickerViewMonth = now.getUTCMonth();
      datePickerSelectedTime = '00:00';
    }
    renderDateTimePicker();
  }

  function shiftDatePickerMonth(delta) {
    const next = new Date(Date.UTC(datePickerViewYear, datePickerViewMonth + delta, 1));
    datePickerViewYear = next.getUTCFullYear();
    datePickerViewMonth = next.getUTCMonth();
    renderDateTimePicker();
    const target = datePickerGrid.querySelector('.date-picker-day:not(.outside)');
    if (target) target.focus();
  }

  function moveDatePickerSelection(key, dayDelta) {
    const date = dateFromKey(key);
    if (!date) return;
    date.setUTCDate(date.getUTCDate() + dayDelta);
    selectDatePickerDate(utcDateKey(date));
  }

  function selectDatePickerTime(value, focusAfter = true) {
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(value || '')) return;
    datePickerSelectedTime = value;
    if (!datePickerSelectedDate) {
      const now = dateTimeWallDate();
      datePickerSelectedDate = utcDateKey(now);
      datePickerViewYear = now.getUTCFullYear();
      datePickerViewMonth = now.getUTCMonth();
    }
    renderDateTimePicker();
    if (focusAfter) {
      const selected = datePickerTimeList.querySelector('.date-picker-time-option.selected');
      if (selected) selected.focus();
    }
  }

  function scrollDatePickerTimes(direction) {
    const firstOption = datePickerTimeList.querySelector('.date-picker-time-option');
    datePickerTimeList.scrollTop += direction * (firstOption ? firstOption.offsetHeight || 36 : 36) * 4;
  }

  function positionFieldEditorPopover() {
    if (!editingCell || editingCell.kind === 'number') return;
    const anchor = editingCell.anchorEl;
    if (!anchor || !anchor.isConnected) {
      closeFieldEditor();
      return;
    }
    const margin = 8;
    const gap = 6;
    const anchorRect = anchor.getBoundingClientRect();
    if (anchorRect.bottom < 0 || anchorRect.top > window.innerHeight ||
        anchorRect.right < 0 || anchorRect.left > window.innerWidth) {
      closeFieldEditor();
      return;
    }
    const dialogRect = cellEditorDialog.getBoundingClientRect();
    const fallbackWidth = editingCell.kind === 'datetime' ? 456 : 480;
    const fallbackHeight = editingCell.kind === 'datetime' ? 330 : 220;
    const dialogWidth = dialogRect.width || Math.min(fallbackWidth, window.innerWidth - margin * 2);
    const dialogHeight = dialogRect.height || Math.min(fallbackHeight, window.innerHeight - margin * 2);
    let left = anchorRect.left;
    if (left + dialogWidth > window.innerWidth - margin)
      left = anchorRect.right - dialogWidth;
    left = Math.max(margin, Math.min(left, window.innerWidth - dialogWidth - margin));
    let top = anchorRect.bottom + gap;
    if (top + dialogHeight > window.innerHeight - margin)
      top = anchorRect.top - dialogHeight - gap;
    top = Math.max(margin, Math.min(top, window.innerHeight - dialogHeight - margin));
    cellEditorDialog.style.left = `${Math.round(left)}px`;
    cellEditorDialog.style.top = `${Math.round(top)}px`;
  }

  function attachInlineNumber(cell) {
    cell.classList.add('cell-number-editing');
    cell.appendChild(cellEditorNumber);
    editingCell.anchorEl = cell.querySelector('.cell-edit-btn');
  }

  // The second click chooses a caret position in the existing value. Measure
  // its monospace glyph using the actual input font, not a guessed pixel size.
  function positionNumberCaret(clientX) {
    const input = cellEditorNumber;
    const style = getComputedStyle(input);
    const measure = document.createElement('span');
    measure.style.cssText = `position:fixed;visibility:hidden;white-space:pre;font:${style.font}`;
    measure.textContent = '0';
    document.body.appendChild(measure);
    const width = measure.getBoundingClientRect().width;
    measure.remove();
    const offset = clientX - input.getBoundingClientRect().left - parseFloat(style.paddingLeft) + input.scrollLeft;
    const position = width ? Math.max(0, Math.min(input.value.length, Math.round(offset / width))) : input.value.length;
    input.setSelectionRange(position, position);
  }

  function openFieldEditor(idStr, col, anchorEl = null, initialText = null, clientX = null) {
    if (cellHistoryBusy || btnEditorSave.disabled) return;
    if (editingCell?.kind === 'number') return;
    const kind = editKindForColumn(col);
    if (!kind) return;
    const recordId = validRecordId(idStr);
    const rec = allRecords.find(r => Number(r.id) === recordId);
    if (!rec) return;
    const isDateTime = kind === 'datetime';
    const isNumber = kind === 'number';
    const value = isDateTime
      ? parseDateValueSec(rec[col])
      : (rec[col] == null ? '' : String(rec[col]));
    const originalValue = isNumber ? normalizeCellValueForWrite(rec[col], cellColumnType(col)) : isDateTime && value != null
      ? Math.floor(value / 60) * 60
      : value;
    const historyValue = cellHistoryValue(rec[col], cellColumnType(col));
    editingCell = { recordId, col, kind, originalValue, historyValue, anchorEl };
    const editorLabel = `${editLabelForKind(kind)}: ${col}${isDateTime ? ' (VLAT)' : ''}`;
    cellEditorText.setAttribute('aria-label', editorLabel);
    cellEditorNumber.setAttribute('aria-label', editorLabel);
    datePickerGrid.setAttribute('aria-label', `${T.editDateTime}: ${col}`);
    cellEditorError.hidden = true;
    cellEditorError.textContent = '';
    cellEditorNumber.removeAttribute('aria-invalid');
    if (isNumber) {
      cellEditorNumber.value = initialText == null ? value : initialText;
      cellEditorNumber.hidden = false;
      attachInlineNumber(anchorEl.closest('td.data-cell'));
      setEditorBusy(false);
      cellEditorNumber.focus({ preventScroll: true });
      cellEditorNumber.setSelectionRange(cellEditorNumber.value.length, cellEditorNumber.value.length);
      if (clientX != null) positionNumberCaret(clientX);
      return;
    }
    cellEditorDialog.classList.toggle('date-mode', isDateTime);
    cellEditor.classList.add('popover-mode');
    datePickerFooterActions.hidden = !isDateTime;
    cellEditorDialog.removeAttribute('aria-modal');
    cellEditorDialog.removeAttribute('aria-labelledby');
    cellEditorDialog.setAttribute('aria-label', editorLabel);
    if (anchorEl) anchorEl.setAttribute('aria-expanded', 'true');
    cellEditorText.hidden = isDateTime;
    cellEditorNumber.hidden = true;
    cellEditorDateTimePanel.hidden = !isDateTime;
    if (isDateTime) {
      setDateTimePickerValue(value);
      cellEditorCount.textContent = 'VLAT';
    } else {
      cellEditorText.value = initialText == null ? value : initialText;
      updateEditorCharacterCount();
    }
    setEditorBusy(false);
    cellEditor.hidden = false;
    positionFieldEditorPopover();
    // Focus synchronously so fast typing cannot lose the second character.
    if (isDateTime) {
      focusDateTimePicker();
    } else {
      cellEditorText.focus();
      cellEditorText.setSelectionRange(cellEditorText.value.length, cellEditorText.value.length);
    }
  }

  function closeFieldEditor() {
    if (btnEditorSave.disabled) return;
    const anchor = editingCell && editingCell.anchorEl;
    const numberCell = cellEditorNumber.closest('td');
    if (numberCell) numberCell.classList.remove('cell-number-editing');
    cellEditorDialog.insertBefore(cellEditorNumber, cellEditorDateTimePanel);
    cellEditorNumber.removeAttribute('aria-invalid');
    if (anchor && anchor.isConnected && anchor.hasAttribute('aria-expanded')) anchor.setAttribute('aria-expanded', 'false');
    cellEditor.hidden = true;
    cellEditorDialog.classList.remove('date-mode');
    cellEditor.classList.remove('popover-mode');
    datePickerFooterActions.hidden = true;
    cellEditorError.hidden = true;
    cellEditorError.textContent = '';
    cellEditorDialog.style.left = '';
    cellEditorDialog.style.top = '';
    cellEditorDialog.removeAttribute('aria-label');
    cellEditorDialog.removeAttribute('aria-labelledby');
    editingCell = null;
    cellEditorText.value = '';
    cellEditorNumber.value = '';
    cellEditorNumber.hidden = true;
    cellEditorText.hidden = false;
    cellEditorDateTime.value = '';
    datePickerSelectedDate = '';
    datePickerSelectedTime = '00:00';
    cellEditorDateTimePanel.hidden = true;
  }

  async function saveFieldEditor() {
    if (!editingCell || btnEditorSave.disabled || cellHistoryBusy) return;
    const { recordId, col, kind, originalValue, historyValue } = editingCell;
    let nextValue;
    try {
      if (kind === 'datetime') {
        nextValue = dateTimeInputSec(cellEditorDateTime.value);
      } else if (kind === 'number') {
        nextValue = parsePastedCellText(cellEditorNumber.value, cellColumnType(col));
      } else {
        nextValue = cellEditorText.value;
      }
    } catch (err) {
      cellEditorError.textContent = kind === 'number' ? err.message.replace('Paste requires', 'Enter') : err.message;
      cellEditorError.hidden = false;
      if (kind === 'datetime') focusDateTimePicker();
      else if (kind === 'number') {
        cellEditorNumber.setAttribute('aria-invalid', 'true');
        showToast(cellEditorError.textContent);
        cellEditorNumber.focus();
      }
      return false;
    }
    if (nextValue === originalValue) {
      closeFieldEditor();
      if (kind === 'text') focusSelectedCell();
      return true;
    }
    setEditorBusy(true);
    cellEditorError.hidden = true;
    cellEditorError.textContent = '';
    const action = kind === 'datetime' ? 'Edit DateTime' : kind === 'number' ? 'Edit number' : 'Edit';
    const detail = kind === 'datetime'
      ? `record=${recordId} · column=${col} · value=${nextValue == null ? 'empty' : nextValue} UTC`
      : kind === 'number' ? `record=${recordId} · column=${col} · value=${nextValue == null ? 'empty' : nextValue}`
      : `record=${recordId} · column=${col} · characters=${nextValue.length}`;
    recordActionDiagnostic(action, 'start', detail);
    cellHistoryBusy = true;
    updateCellHistoryControls();
    try {
      await grist.selectedTable.update(
        { id: recordId, fields: { [col]: nextValue } },
        { parseStrings: false });
      recordActionDiagnostic(action, 'ok', detail);
      const current = allRecords.find(r => Number(r.id) === recordId);
      if (current) current[col] = nextValue;
      rememberCellHistory(action, col, [{
        id: recordId,
        before: historyValue,
        after: cellHistoryValue(nextValue, cellColumnType(col)),
      }]);
      setEditorBusy(false);
      closeFieldEditor();
      render();
      if (kind === 'text') focusSelectedCell();
      return true;
    } catch (err) {
      const message = actionErrorMessage(action, err);
      cellEditorError.textContent = message;
      cellEditorError.hidden = false;
      setEditorBusy(false);
      if (kind === 'datetime') focusDateTimePicker();
      else if (kind === 'number') {
        cellEditorNumber.setAttribute('aria-invalid', 'true');
        showToast(message);
        selectDataCell(cellEditorNumber.closest('td'), false);
        cellEditorNumber.focus();
      }
      else cellEditorText.focus();
      return false;
    } finally {
      cellHistoryBusy = false;
      updateCellHistoryControls();
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

  function getAddRowContext(group) {
    const { col } = parseGroupBy(groupBy);
    const type = columnBaseType(writableColumnTypes[col] || columnTypes[col]);
    let reason = '';
    if (!col)
      reason = 'Choose a grouping column first';
    else if (!metadataLoaded)
      reason = 'Writable columns are still loading';
    else if (!writableColumnIds.includes(col))
      reason = `The grouping column "${col}" is read-only`;
    else if (!CELL_COPY_TYPES.has(type))
      reason = `The grouping column type ${type || 'unknown'} is not supported`;

    let value = null;
    if (!reason && group && group.key !== '\x00__empty__') {
      value = normalizeCellValueForWrite(group.writeValue, type);
      if (value == null && group.writeValue != null && group.writeValue !== '')
        reason = `The group value cannot be written as ${type}`;
    }
    return { enabled: !reason, col, type, value, reason };
  }

  async function getNewRowFields(context, group) {
    const fields = { [context.col]: context.value };
    // The outer student selection is applied by Grist before onRecords.
    // Inherit only this known parent field, never unrelated common values.
    const studentCols = allColumns.filter(col => /^(students?|students?_name)$/i.test(col));
    if (studentCols.length !== 1 || studentCols[0] === context.col) return fields;
    const studentCol = studentCols[0];
    const records = allRecords;
    const sample = group.records[0];
    const student = sample && sample[studentCol];
    if (student == null || student === '') return fields;
    if (!records.every(rec => JSON.stringify(rec[studentCol]) === JSON.stringify(student)))
      return fields;
    if (!writableColumnIds.includes(studentCol))
      throw new Error(`The student field "${studentCol}" is read-only; a new row cannot be assigned to this student.`);
    const raw = await grist.viewApi.fetchSelectedRecord(Number(sample.id), {
      cellFormat: 'typed', expandRefs: false, includeColumns: 'all',
    });
    if (allRecords !== records || parseGroupBy(groupBy).col !== context.col)
      throw new Error('The selected student or grouping changed. Please click + again.');
    if (!raw || !Object.prototype.hasOwnProperty.call(raw, studentCol))
      throw new Error(`Cannot read the stored student value from "${studentCol}".`);
    fields[studentCol] = normalizeTypedCell(raw[studentCol]);
    return fields;
  }

  async function addRecordToGroup(button, groupKey) {
    if (cellHistoryBusy) return;
    cellHistoryBusy = true;
    updateCellHistoryControls();
    button.disabled = true;
    button.classList.add('saving');
    try {
      await getWritableColumnIds();
      const group = getGroups().find(candidate => candidate.key === groupKey);
      if (!group) throw new Error('The destination group is no longer available');
      const context = getAddRowContext(group);
      if (!context.enabled) throw new Error(context.reason);
      const label = group.key === '\x00__empty__' ? T.emptyGroup : String(group.label);
      const detail = `column=${context.col} · target=${label} · type=${context.type}`;
      const fields = await getNewRowFields(context, group);
      recordActionDiagnostic('Add row', 'start', detail);
      const tableId = await grist.selectedTable.getTableId();
      const result = await grist.docApi.applyUserActions([
        ['AddRecord', tableId, null, fields],
      ], { parseStrings: false });
      const createdId = validRecordId(result && result.retValues && result.retValues[0]);
      rememberHistoryEntry({ kind: 'create', label: 'Add row', tableId, id: createdId, fields });
      // Verify stored data, rather than treating a returned ID as proof that
      // the group assignment survived host defaults or document triggers.
      const stored = await grist.docApi.fetchTable(tableId);
      const index = stored.id.indexOf(createdId);
      const matches = Object.entries(fields).every(([col, value]) => {
        if (!Object.prototype.hasOwnProperty.call(stored, col)) return false;
        const type = columnBaseType(writableColumnTypes[col]);
        const normalize = val => CELL_COPY_TYPES.has(type)
          ? normalizeCellValueForWrite(val, type) : normalizeTypedCell(val);
        return JSON.stringify(normalize(stored[col][index])) === JSON.stringify(normalize(value));
      });
      if (index < 0 || !matches)
        throw new Error(`Record ${createdId} was created, but Grist did not retain its student or group assignment. Check column defaults, formulas, or triggers before adding another row.`);
      queueRowAnimation(createdId, 'row-enter', 950);
      recordActionDiagnostic('Add row', 'ok', `${detail} · created=${createdId}`);
      showToast(`${T.addRow}: ${label}`, 'success');
    } finally {
      cellHistoryBusy = false;
      updateCellHistoryControls();
      if (button.isConnected) {
        button.disabled = false;
        button.classList.remove('saving');
      }
    }
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

  function visibleCellsForColumn(col) {
    return [...content.querySelectorAll('td.data-cell')]
      .filter(cell => cell.dataset.cellCol === col);
  }

  function clearFillPreview() {
    content.querySelectorAll('td.cell-fill-preview')
      .forEach(cell => cell.classList.remove('cell-fill-preview'));
  }

  function updateFillPreview(targetCell) {
    if (!activeFillDrag || !targetCell ||
        targetCell.dataset.cellCol !== activeFillDrag.col) return;
    const cells = visibleCellsForColumn(activeFillDrag.col);
    const sourceIndex = cells.indexOf(activeFillDrag.sourceCell);
    const targetIndex = cells.indexOf(targetCell);
    if (sourceIndex < 0 || targetIndex < 0) return;
    clearFillPreview();
    const start = Math.min(sourceIndex, targetIndex);
    const end = Math.max(sourceIndex, targetIndex);
    activeFillDrag.targetCells = cells.slice(start, end + 1)
      .filter(cell => cell !== activeFillDrag.sourceCell);
    activeFillDrag.targetCells.forEach(cell => cell.classList.add('cell-fill-preview'));
  }

  async function finishCellFill(commit) {
    if (!activeFillDrag) return;
    const drag = activeFillDrag;
    activeFillDrag = null;
    clearFillPreview();
    if (!commit || !drag.targetCells.length) return;
    const sourceRecord = allRecords.find(record => String(record.id) === drag.recordId);
    const type = cellColumnType(drag.col);
    if (!sourceRecord || !isWritableCellColumn(drag.col)) return;
    const value = normalizeCellValueForWrite(sourceRecord[drag.col], type);
    await writeCellValues(
      'Fill', drag.targetCells.map(cell => cell.dataset.cellId), drag.col, value);
  }

  function moveSelectedCell(key, extend = false) {
    if (!selectedCell) return false;
    const position = extend && cellRangeEnd ? cellRangeEnd : selectedCell;
    const current = findDataCell(position.recordId, position.col);
    if (!current) return false;
    let cells;
    if (key === 'ArrowUp' || key === 'ArrowDown') {
      cells = visibleCellsForColumn(position.col);
    } else {
      cells = [...current.closest('tr').querySelectorAll('td.data-cell')];
    }
    const index = cells.indexOf(current);
    const delta = key === 'ArrowUp' || key === 'ArrowLeft' ? -1 : 1;
    const target = cells[index + delta];
    return target ? selectDataCell(target, true, extend) : false;
  }

  content.addEventListener('click', (e) => {
    if (isClipboardInput(e.target)) return;
    if (e.target.closest('.cell-fill-handle')) return;
    const addButton = e.target.closest('.group-add-row[data-group-key]');
    if (addButton && content.contains(addButton) && !addButton.disabled) {
      addRecordToGroup(addButton, decodeURIComponent(addButton.dataset.groupKey))
        .catch(err => showToast(actionErrorMessage('Add row', err)));
      return;
    }
    const btn = e.target.closest('button[data-act]');
    if (btn && content.contains(btn) && !btn.disabled) {
      const idStr = btn.dataset.id;
      if (btn.dataset.act === 'dup') onDuplicate(btn, idStr);
      else if (btn.dataset.act === 'del') onDelete(btn, idStr);
      return;
    }
    const cell = e.target.closest('td.data-cell');
    if (!cell || !content.contains(cell)) return;
    if (Date.now() < suppressCellClickUntil) {
      suppressCellClickUntil = 0;
      e.preventDefault();
      return;
    }
    const wasSelected = !cellRangeEnd && selectedCellMatches(cell.dataset.cellId, cell.dataset.cellCol);
    selectDataCell(cell, true, e.shiftKey);
    const editBtn = cell.querySelector('button[data-edit-id][data-edit-col]');
    if (wasSelected && !e.shiftKey && editBtn && !editBtn.disabled)
      openFieldEditor(editBtn.dataset.editId, editBtn.dataset.editCol, editBtn, null, e.detail ? e.clientX : null);
  });

  content.addEventListener('pointerdown', (e) => {
    if (isClipboardInput(e.target)) return;
    if (e.button !== 0 && e.button !== 2) return;
    if (e.target.closest('.cell-fill-handle')) return;
    const cell = e.target.closest('td.data-cell');
    if (!cell) return;
    e.preventDefault();
    cellSelectionDrag = { pointerId: e.pointerId, cell, extend: e.shiftKey, moved: false };
  });
  window.addEventListener('pointermove', (e) => {
    const drag = cellSelectionDrag;
    if (!drag || drag.pointerId !== e.pointerId) return;
    const hit = document.elementFromPoint && document.elementFromPoint(e.clientX, e.clientY);
    const target = hit && hit.closest('td.data-cell');
    if (!target || !content.contains(target) || target.closest('.group.collapsed')) return;
    if (drag.moved && cellRangeEnd && cellRangeEnd.recordId === target.dataset.cellId
        && cellRangeEnd.col === target.dataset.cellCol) return;
    if (!drag.moved && target === drag.cell) return;
    e.preventDefault();
    if (!drag.moved) selectDataCell(drag.cell, false, drag.extend);
    drag.moved = true;
    selectDataCell(target, true, true);
  });
  function finishCellSelection(e) {
    if (!cellSelectionDrag || cellSelectionDrag.pointerId !== e.pointerId) return;
    if (cellSelectionDrag.moved) suppressCellClickUntil = Date.now() + 400;
    cellSelectionDrag = null;
  }
  window.addEventListener('pointerup', finishCellSelection);
  window.addEventListener('pointercancel', finishCellSelection);

  content.addEventListener('pointerdown', (e) => {
    const handle = e.target.closest('.cell-fill-handle');
    if (!handle) return;
    const sourceCell = handle.closest('td.data-cell');
    if (!sourceCell || sourceCell.dataset.cellWritable !== 'true') return;
    e.preventDefault();
    e.stopPropagation();
    selectDataCell(sourceCell, false);
    activeFillDrag = {
      pointerId: e.pointerId,
      sourceCell,
      recordId: sourceCell.dataset.cellId,
      col: sourceCell.dataset.cellCol,
      targetCells: [],
    };
    if (handle.setPointerCapture) {
      try { handle.setPointerCapture(e.pointerId); } catch (_) {}
    }
  });

  window.addEventListener('pointermove', (e) => {
    if (!activeFillDrag || e.pointerId !== activeFillDrag.pointerId) return;
    e.preventDefault();
    const hit = document.elementFromPoint
      ? document.elementFromPoint(e.clientX, e.clientY)
      : null;
    const targetCell = hit && hit.closest ? hit.closest('td.data-cell') : null;
    updateFillPreview(targetCell);
  });

  window.addEventListener('pointerup', (e) => {
    if (activeFillDrag && e.pointerId === activeFillDrag.pointerId)
      finishCellFill(true);
  });
  window.addEventListener('pointercancel', (e) => {
    if (activeFillDrag && e.pointerId === activeFillDrag.pointerId)
      finishCellFill(false);
  });

  content.addEventListener('keydown', (e) => {
    if (isClipboardInput(e.target) || e.isComposing) return;
    const cell = e.target.closest('td.data-cell');
    if (!cell || !selectedCellMatches(cell.dataset.cellId, cell.dataset.cellCol)) return;
    const kind = editKindForColumn(cell.dataset.cellCol);
    if (!e.ctrlKey && !e.metaKey && !e.altKey && e.key.length === 1 && (kind === 'number' || kind === 'text')) {
      e.preventDefault();
      selectDataCell(cell);
      openFieldEditor(cell.dataset.cellId, cell.dataset.cellCol, cell.querySelector('.cell-edit-btn'), e.key);
      return;
    }
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
      if (moveSelectedCell(e.key, e.shiftKey)) e.preventDefault();
      return;
    }
    if (e.key === 'Enter' || e.key === 'F2') {
      const editBtn = cell.querySelector('button[data-edit-id][data-edit-col]');
      if (editBtn && !editBtn.disabled) {
        e.preventDefault();
        openFieldEditor(editBtn.dataset.editId, editBtn.dataset.editCol, editBtn);
      }
      return;
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      clearSelectedCell();
    }
  });

  document.addEventListener('copy', copySelectedCell);
  document.addEventListener('paste', pasteSelectedCell);
  btnUndo.addEventListener('click', () => replayCellHistory('undo'));
  btnRedo.addEventListener('click', () => replayCellHistory('redo'));
  document.addEventListener('keydown', (e) => {
    if (!(e.ctrlKey || e.metaKey) || e.altKey || !cellEditor.hidden || isClipboardInput(e.target))
      return;
    const key = String(e.key || '').toLowerCase();
    let direction = '';
    if (key === 'z') direction = e.shiftKey ? 'redo' : 'undo';
    else if (key === 'y') direction = 'redo';
    if (!direction) return;
    e.preventDefault();
    replayCellHistory(direction);
  });
  updateCellHistoryControls();

  document.addEventListener('click', (e) => {
    if (editingCell && editingCell.kind === 'number') {
      if (!cellEditorNumber.closest('td')?.contains(e.target)) {
        saveFieldEditor();
        // Validation is synchronous: do not leave an invalid draft behind.
        if (editingCell && !btnEditorSave.disabled) {
          e.preventDefault();
          e.stopPropagation();
        }
      }
      return;
    }
    if (cellEditor.hidden || !cellEditor.classList.contains('popover-mode')) return;
    const anchor = editingCell && editingCell.anchorEl;
    if (cellEditorDialog.contains(e.target) || (anchor && anchor.contains(e.target))) return;
    closeFieldEditor();
  }, true);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !cellEditor.hidden && cellEditor.classList.contains('popover-mode')) {
      e.preventDefault();
      closeFieldEditor();
    }
  });
  window.addEventListener('resize', positionFieldEditorPopover);
  content.addEventListener('scroll', positionFieldEditorPopover, { passive: true });

  cellEditorText.addEventListener('input', updateEditorCharacterCount);
  function onEditorKeydown(e) {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      saveFieldEditor();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      closeFieldEditor();
      focusSelectedCell();
    }
  }
  cellEditorText.addEventListener('keydown', onEditorKeydown);
  cellEditorNumber.addEventListener('keydown', async (e) => {
    if (e.isComposing) return;
    if (e.key === 'Enter' || e.key === 'Tab') {
      e.preventDefault();
      e.stopPropagation();
      const direction = e.key === 'Tab' ? (e.shiftKey ? 'ArrowLeft' : 'ArrowRight') : null;
      if (await saveFieldEditor()) {
        if (direction) moveSelectedCell(direction);
        focusSelectedCell();
      }
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      closeFieldEditor();
      focusSelectedCell();
    }
  });
  cellEditorDateTimePanel.addEventListener('keydown', onEditorKeydown);
  datePickerPrev.addEventListener('click', () => shiftDatePickerMonth(-1));
  datePickerNext.addEventListener('click', () => shiftDatePickerMonth(1));
  datePickerPrevYear.addEventListener('click', () => shiftDatePickerMonth(-12));
  datePickerNextYear.addEventListener('click', () => shiftDatePickerMonth(12));
  datePickerGrid.addEventListener('click', (e) => {
    const day = e.target.closest('.date-picker-day[data-date]');
    if (day && datePickerGrid.contains(day)) selectDatePickerDate(day.dataset.date);
  });
  datePickerGrid.addEventListener('keydown', (e) => {
    const day = e.target.closest('.date-picker-day[data-date]');
    if (!day) return;
    const key = day.dataset.date;
    let handled = true;
    if (e.key === 'ArrowLeft') moveDatePickerSelection(key, -1);
    else if (e.key === 'ArrowRight') moveDatePickerSelection(key, 1);
    else if (e.key === 'ArrowUp') moveDatePickerSelection(key, -7);
    else if (e.key === 'ArrowDown') moveDatePickerSelection(key, 7);
    else if (e.key === 'Home') {
      const date = dateFromKey(key);
      moveDatePickerSelection(key, -((date.getUTCDay() + 6) % 7));
    } else if (e.key === 'End') {
      const date = dateFromKey(key);
      moveDatePickerSelection(key, 6 - ((date.getUTCDay() + 6) % 7));
    } else if (e.key === 'PageUp' || e.key === 'PageDown') {
      const date = dateFromKey(key);
      const dayOfMonth = date.getUTCDate();
      const direction = e.key === 'PageUp' ? -1 : 1;
      const targetMonth = new Date(Date.UTC(
        date.getUTCFullYear(), date.getUTCMonth() + direction, 1));
      const lastDay = new Date(Date.UTC(
        targetMonth.getUTCFullYear(), targetMonth.getUTCMonth() + 1, 0)).getUTCDate();
      targetMonth.setUTCDate(Math.min(dayOfMonth, lastDay));
      selectDatePickerDate(utcDateKey(targetMonth));
    } else {
      handled = false;
    }
    if (handled) e.preventDefault();
  });
  datePickerTimeList.addEventListener('click', (e) => {
    const option = e.target.closest('.date-picker-time-option[data-time]');
    if (option && datePickerTimeList.contains(option))
      selectDatePickerTime(option.dataset.time);
  });
  datePickerTimeList.addEventListener('keydown', (e) => {
    const option = e.target.closest('.date-picker-time-option[data-time]');
    if (!option) return;
    const options = [...datePickerTimeList.querySelectorAll('.date-picker-time-option')];
    const current = options.indexOf(option);
    let next = current;
    if (e.key === 'ArrowUp') next = Math.max(0, current - 1);
    else if (e.key === 'ArrowDown') next = Math.min(options.length - 1, current + 1);
    else if (e.key === 'PageUp') next = Math.max(0, current - 4);
    else if (e.key === 'PageDown') next = Math.min(options.length - 1, current + 4);
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = options.length - 1;
    else return;
    e.preventDefault();
    selectDatePickerTime(options[next].dataset.time);
  });
  datePickerTimeUp.addEventListener('click', () => scrollDatePickerTimes(-1));
  datePickerTimeDown.addEventListener('click', () => scrollDatePickerTimes(1));
  datePickerToday.addEventListener('click', () => {
    const now = dateTimeWallDate();
    datePickerSelectedTime = `${String(now.getUTCHours()).padStart(2, '0')}`
      + `:${now.getUTCMinutes() < 30 ? '00' : '30'}`;
    selectDatePickerDate(utcDateKey(now));
  });
  datePickerClear.addEventListener('click', () => {
    datePickerSelectedDate = '';
    renderDateTimePicker();
    datePickerToday.focus();
  });
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
        return `<span class="cell-num">${isDateTimeColumnType(columnTypes[col]) ? formatDateTimeSec(val) : formatUtcDateSec(val)}</span>`;
      return `<span class="cell-num">${String(val)}</span>`;
    }
    if (Array.isArray(val)) return esc(val.join(', '));
    // Grist can expose ISO values as primitive strings or object wrappers.
    // The strict parser prevents ordinary objects/text from being reformatted.
    const sec = parseDateValueSec(val);
    if (sec != null)
      return `<span class="cell-num">${isDateTimeColumnType(columnTypes[col]) ? formatDateTimeSec(sec) : formatUtcDateSec(sec)}</span>`;
    return esc(String(val));
  }
