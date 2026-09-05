  // ── 15. Unified selection, dragging, and bulk actions ─────
  // Loaded after widget-app.js: shares its top-level bindings.
  const app          = document.getElementById('app');
  const selBar       = document.getElementById('sel-bar');
  const selCountTxt  = document.getElementById('sel-count-txt');
  const btnSelDup    = document.getElementById('btn-sel-dup');
  const btnSelDel    = document.getElementById('btn-sel-del');
  const btnSelClear  = document.getElementById('btn-sel-clear');
  let selectionAnchorId = null;

  function updateSelBar() {
    if (selectedIds.size === 0) {
      selBar.classList.remove('visible');
      app.classList.remove('has-sel');
    } else {
      selBar.classList.add('visible');
      app.classList.add('has-sel');
      selCountTxt.textContent = T.selCount.replace('{n}', String(selectedIds.size));
    }
  }

  function refreshSelectionControls() {
    content.querySelectorAll('.row-grip[data-id]').forEach(grip => {
      const selected = selectedIds.has(grip.dataset.id);
      grip.setAttribute('aria-pressed', String(selected));
      const row = grip.closest('tr');
      if (row) row.classList.toggle('row-selected', selected);
    });

    content.querySelectorAll('.rec-table').forEach(table => {
      const groupGrip = table.querySelector('.group-select-grip');
      if (!groupGrip) return;
      const rowGrips = [...table.querySelectorAll('tbody .row-grip[data-id]')];
      const selectedCount = rowGrips
        .filter(grip => selectedIds.has(grip.dataset.id)).length;
      const state = selectedCount === 0
        ? 'none'
        : (selectedCount === rowGrips.length ? 'all' : 'some');
      groupGrip.dataset.selectionState = state;
      groupGrip.setAttribute('aria-pressed',
        state === 'all' ? 'true' : (state === 'some' ? 'mixed' : 'false'));
    });
  }

  function finishSelectionChange() {
    refreshSelectionControls();
    updateSelBar();
  }

  function recordIdsInVisualOrder() {
    return [...content.querySelectorAll('.row-grip[data-id]')]
      .filter(grip => grip.offsetParent !== null)
      .map(grip => grip.dataset.id);
  }

  function selectRecordFromClick(id, event) {
    const additive = event.ctrlKey || event.metaKey;
    if (event.shiftKey) {
      const orderedIds = recordIdsInVisualOrder();
      let anchorIndex = orderedIds.indexOf(selectionAnchorId);
      const targetIndex = orderedIds.indexOf(id);
      if (targetIndex < 0) return;
      if (anchorIndex < 0) {
        selectionAnchorId = id;
        anchorIndex = targetIndex;
      }
      if (!additive) selectedIds.clear();
      const start = Math.min(anchorIndex, targetIndex);
      const end = Math.max(anchorIndex, targetIndex);
      orderedIds.slice(start, end + 1).forEach(recordId => selectedIds.add(recordId));
    } else if (additive) {
      if (selectedIds.has(id)) selectedIds.delete(id);
      else selectedIds.add(id);
      selectionAnchorId = id;
    } else {
      selectedIds.clear();
      selectedIds.add(id);
      selectionAnchorId = id;
    }
    finishSelectionChange();
  }

  const suppressedGripClicks = new Set();

  content.addEventListener('click', (e) => {
    const rowGrip = e.target.closest('.row-grip[data-id]');
    if (rowGrip) {
      e.preventDefault();
      e.stopPropagation();
      const id = rowGrip.dataset.id;
      if (suppressedGripClicks.has(id)) {
        suppressedGripClicks.delete(id);
        return;
      }
      selectRecordFromClick(id, e);
      return;
    }

    const groupGrip = e.target.closest('.group-select-grip');
    if (!groupGrip) return;
    e.preventDefault();
    e.stopPropagation();
    const table = groupGrip.closest('table');
    if (!table) return;
    const rowGrips = [...table.querySelectorAll('tbody .row-grip[data-id]')];
    const groupIds = rowGrips.map(grip => grip.dataset.id);
    const allSelected = groupIds.every(id => selectedIds.has(id));
    const additive = e.ctrlKey || e.metaKey;
    if (additive) {
      groupIds.forEach(id => {
        if (allSelected) selectedIds.delete(id);
        else selectedIds.add(id);
      });
    } else {
      const exactlyThisGroup = allSelected && selectedIds.size === groupIds.length;
      selectedIds.clear();
      if (!exactlyThisGroup) groupIds.forEach(id => selectedIds.add(id));
    }
    selectionAnchorId = groupIds.find(id => selectedIds.has(id))
      || [...selectedIds][0]
      || null;
    finishSelectionChange();
  });

  function setSelBarDisabled(disabled) {
    [btnSelDup, btnSelDel, btnSelClear].forEach(button => {
      button.disabled = disabled;
    });
  }

  // ── Drag records between compatible groups ────────────────
  const ROW_DRAG_THRESHOLD = 4;
  let pendingRowPointer = null;
  let activeRowDrag = null;

  function draggedRecordIds(id, additive) {
    if (!selectedIds.has(id)) {
      if (!additive) selectedIds.clear();
      selectedIds.add(id);
      selectionAnchorId = id;
      finishSelectionChange();
    }
    const ids = [...selectedIds];
    const present = new Set(allRecords.map(record => String(record.id)));
    return ids.filter(candidate => present.has(candidate));
  }

  function canDropOnGroup(card, ids, context) {
    const targetKey = card.dataset.groupKey;
    return ids.some(id => {
      const record = allRecords.find(item => String(item.id) === id);
      return record && movableRecordGroupKey(record, context.col) !== targetKey;
    });
  }

  function updateRowDropTarget(clientX, clientY) {
    if (!activeRowDrag) return;
    const element = document.elementFromPoint(clientX, clientY);
    const target = element && element.closest('.group.group-drop-valid');
    if (activeRowDrag.target === target) return;
    if (activeRowDrag.target)
      activeRowDrag.target.classList.remove('group-drop-target');
    activeRowDrag.target = target || null;
    if (target) target.classList.add('group-drop-target');
  }

  function updateDragPreview(clientX, clientY) {
    if (!activeRowDrag) return;
    activeRowDrag.lastX = clientX;
    activeRowDrag.lastY = clientY;
    activeRowDrag.preview.style.transform =
      `translate(${Math.round(clientX + 14)}px, ${Math.round(clientY + 12)}px)`;
    const edge = Math.min(80, window.innerHeight * .15);
    if (clientY < edge)
      activeRowDrag.scrollSpeed = -Math.ceil((edge - clientY) / 7);
    else if (clientY > window.innerHeight - edge)
      activeRowDrag.scrollSpeed =
        Math.ceil((clientY - (window.innerHeight - edge)) / 7);
    else
      activeRowDrag.scrollSpeed = 0;
    updateRowDropTarget(clientX, clientY);
  }

  function beginRowDrag(pointer, event) {
    const context = getRecordMoveContext();
    if (!context.enabled) {
      recordActionDiagnostic('Drag gesture', 'error',
        `record=${pointer.id} · ${context.reason}`);
      showToast(`Drag unavailable — ${context.reason}`);
      return false;
    }
    const ids = draggedRecordIds(pointer.id, pointer.additive);
    if (!ids.length) return false;

    const preview = document.createElement('div');
    preview.className = 'row-drag-preview';
    preview.setAttribute('role', 'status');
    preview.textContent = ids.length === 1
      ? 'Move 1 record'
      : `Move ${ids.length} records`;
    document.body.appendChild(preview);

    activeRowDrag = {
      pointerId: pointer.pointerId,
      handle: pointer.handle,
      ids,
      context,
      preview,
      target: null,
      lastX: event.clientX,
      lastY: event.clientY,
      scrollSpeed: 0,
      scrollTimer: null,
    };
    pendingRowPointer = null;
    document.body.classList.add('row-drag-active');
    pointer.handle.classList.remove('drag-armed');
    pointer.handle.classList.add('dragging');
    const draggedSet = new Set(ids);
    content.querySelectorAll('tr[data-record-id]').forEach(row =>
      row.classList.toggle('row-drag-source', draggedSet.has(row.dataset.recordId)));
    content.querySelectorAll('.group[data-group-key]').forEach(card => {
      const valid = canDropOnGroup(card, ids, context);
      card.classList.toggle('group-drop-valid', valid);
      card.classList.toggle('group-drop-invalid', !valid);
    });
    activeRowDrag.scrollTimer = setInterval(() => {
      if (!activeRowDrag || !activeRowDrag.scrollSpeed) return;
      window.scrollBy(0, activeRowDrag.scrollSpeed);
      updateRowDropTarget(activeRowDrag.lastX, activeRowDrag.lastY);
    }, 16);
    updateDragPreview(event.clientX, event.clientY);
    return true;
  }

  function suppressGripClick(id) {
    suppressedGripClicks.add(id);
    setTimeout(() => suppressedGripClicks.delete(id), 500);
  }

  function clearPendingRowPointer(pointerId, suppressClick = false) {
    const pointer = pendingRowPointer;
    if (!pointer || (pointerId != null && pointer.pointerId !== pointerId)) return;
    if (suppressClick) suppressGripClick(pointer.id);
    pointer.handle.classList.remove('drag-armed');
    if (pointer.handle.releasePointerCapture) {
      try { pointer.handle.releasePointerCapture(pointer.pointerId); } catch (_) {}
    }
    pendingRowPointer = null;
  }

  function cleanupRowDrag() {
    const drag = activeRowDrag;
    if (!drag) return;
    clearInterval(drag.scrollTimer);
    if (drag.handle.releasePointerCapture) {
      try { drag.handle.releasePointerCapture(drag.pointerId); } catch (_) {}
    }
    drag.preview.remove();
    drag.handle.classList.remove('drag-armed', 'dragging');
    document.body.classList.remove('row-drag-active');
    content.querySelectorAll(
      '.row-drag-source, .group-drop-valid, .group-drop-invalid, .group-drop-target'
    ).forEach(element => element.classList.remove(
      'row-drag-source', 'group-drop-valid', 'group-drop-invalid', 'group-drop-target'
    ));
    activeRowDrag = null;
  }

  content.addEventListener('pointerdown', (e) => {
    const handle = e.target.closest('.row-grip[data-id]');
    if (!handle) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    if (activeRowDrag) cleanupRowDrag();
    clearPendingRowPointer(null);
    pendingRowPointer = {
      pointerId: e.pointerId,
      id: handle.dataset.id,
      handle,
      startX: e.clientX,
      startY: e.clientY,
      additive: e.ctrlKey || e.metaKey,
    };
    if (handle.dataset.dragEnabled === 'true')
      handle.classList.add('drag-armed');
    if (handle.setPointerCapture) {
      try { handle.setPointerCapture(e.pointerId); } catch (_) {}
    }
  });

  content.addEventListener('dragstart', (e) => {
    if (e.target.closest('.row-grip[data-id]')) e.preventDefault();
  });

  window.addEventListener('pointermove', (e) => {
    if (pendingRowPointer && e.pointerId === pendingRowPointer.pointerId) {
      const distance = Math.hypot(
        e.clientX - pendingRowPointer.startX,
        e.clientY - pendingRowPointer.startY);
      if (distance >= ROW_DRAG_THRESHOLD) {
        const pointer = pendingRowPointer;
        if (!beginRowDrag(pointer, e))
          clearPendingRowPointer(pointer.pointerId, true);
      }
    }
    if (!activeRowDrag || e.pointerId !== activeRowDrag.pointerId) return;
    e.preventDefault();
    updateDragPreview(e.clientX, e.clientY);
  }, { passive: false });

  window.addEventListener('pointerup', (e) => {
    if (pendingRowPointer && e.pointerId === pendingRowPointer.pointerId) {
      clearPendingRowPointer(e.pointerId);
      return;
    }
    if (!activeRowDrag || e.pointerId !== activeRowDrag.pointerId) return;
    e.preventDefault();
    const drag = activeRowDrag;
    const target = drag.target;
    suppressGripClick(drag.handle.dataset.id);
    cleanupRowDrag();
    if (!target) return;

    const targetKey = target.dataset.groupKey;
    target.classList.add('group-drop-saving');
    setSelBarDisabled(true);
    moveRecordsToGroup(drag.ids, targetKey).then(result => {
      if (result.moved) {
        const noun = result.moved === 1 ? 'record' : 'records';
        showToast(`Moved ${result.moved} ${noun} to ${result.label}`, 'success');
      }
    }).catch(err => {
      showToast(actionErrorMessage(T.moveRecords, err));
    }).finally(() => {
      if (target.isConnected) target.classList.remove('group-drop-saving');
      setSelBarDisabled(false);
    });
  }, { passive: false });

  window.addEventListener('pointercancel', (e) => {
    if (pendingRowPointer && e.pointerId === pendingRowPointer.pointerId)
      clearPendingRowPointer(e.pointerId);
    if (activeRowDrag && e.pointerId === activeRowDrag.pointerId)
      cleanupRowDrag();
  });

  window.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || !activeRowDrag) return;
    e.preventDefault();
    const id = activeRowDrag.handle.dataset.id;
    suppressGripClick(id);
    cleanupRowDrag();
  });

  // ── Bulk duplicate ────────────────────────────────────────
  btnSelDup.addEventListener('click', async () => {
    if (selectedIds.size === 0) return;
    setSelBarDisabled(true);
    try {
      for (const idStr of [...selectedIds]) {
        const rec = allRecords.find(record => String(record.id) === idStr);
        if (!rec) continue;
        await duplicateRecordById(idStr);
      }
      selectedIds.clear();
      selectionAnchorId = null;
      finishSelectionChange();
    } catch (err) {
      showToast(actionErrorMessage('Duplicate selection', err));
    } finally {
      setSelBarDisabled(false);
    }
  });

  // ── Bulk delete (two-step confirmation) ───────────────────
  let selDelArmTimer = null;

  function disarmSelDelete() {
    clearTimeout(selDelArmTimer);
    selDelArmTimer = null;
    btnSelDel.classList.remove('armed');
    btnSelDel.textContent = T.selDel;
    btnSelDel.title = T.selDel;
    btnSelDel.setAttribute('aria-label', T.selDel);
  }

  btnSelDel.addEventListener('click', async () => {
    if (selectedIds.size === 0) return;
    if (!btnSelDel.classList.contains('armed')) {
      btnSelDel.classList.add('armed');
      btnSelDel.textContent = '?';
      btnSelDel.title = T.confirmDelSel;
      btnSelDel.setAttribute('aria-label', T.confirmDelSel);
      selDelArmTimer = setTimeout(disarmSelDelete, 4000);
      return;
    }
    disarmSelDelete();
    setSelBarDisabled(true);
    try {
      await deleteRecordsByIds([...selectedIds]);
    } catch (err) {
      showToast(actionErrorMessage('Delete selection', err));
    } finally {
      selectedIds.clear();
      selectionAnchorId = null;
      finishSelectionChange();
      setSelBarDisabled(false);
    }
  });

  btnSelClear.addEventListener('click', () => {
    selectedIds.clear();
    selectionAnchorId = null;
    disarmSelDelete();
    finishSelectionChange();
  });
