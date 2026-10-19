// One non-blocking month chooser for WeekRegistry assignments.
const salaryViewSelect = document.getElementById('salary-view-select');
const salaryMonthPicker = document.getElementById('salary-month-picker');
const salaryMonthSearch = document.getElementById('salary-month-search');
const salaryMonthOptions = document.getElementById('salary-month-options');
const salaryMonthStatus = document.getElementById('salary-month-status');
const salaryMonthClear = document.getElementById('salary-month-clear');
let salaryPeriodEditorContext = null;
let salaryPeriodEditorSaving = false;
let salaryPeriodViewChanging = false;

function salarySyncPeriodControls() {
  salaryViewSelect.value = salaryPeriodView;
  salaryViewSelect.disabled = salaryPeriodViewChanging;
  const grouping = document.getElementById('group-select');
  grouping.disabled = salaryPayrollActive();
  grouping.title = salaryPayrollActive()
    ? 'Months and weeks follow the salary registries' : '';
  if (!salaryPayrollActive()) salaryClosePeriodEditor();
}

function salaryPeriodHeading(group, header) {
  if (!group.weekId) return header;
  const week = salaryPeriodWeeks.get(Number(group.weekId));
  const month = salaryPeriodMonths.get(Number(week?.monthId));
  const wrapper = document.createElement('div');
  wrapper.className = 'salary-period-heading salary-week-heading';
  wrapper.appendChild(header);
  const row = document.createElement('div');
  row.className = 'salary-week-month-row';
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'salary-week-month';
  button.dataset.weekId = String(group.weekId);
  button.setAttribute('aria-haspopup', 'dialog');
  button.setAttribute('aria-expanded', 'false');
  button.setAttribute('aria-controls', 'salary-month-picker');
  button.setAttribute('aria-label', `Assign ${week?.label || group.label} to a month`);
  button.title = 'Choose the salary month for this whole week';
  button.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"'
    + ' stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"'
    + ' aria-hidden="true" focusable="false"><rect x="4" y="5" width="16" height="16" rx="2"/>'
    + '<path d="M8 3v4M16 3v4M4 10h16"/></svg>';
  const label = document.createElement('span');
  label.className = 'salary-week-month-label';
  label.textContent = month?.label || 'Assign month';
  button.appendChild(label);
  button.disabled = salaryPeriodEditorSaving;
  button.addEventListener('click', () => salaryOpenPeriodEditor(group.weekId, button));
  row.appendChild(button);
  wrapper.appendChild(row);
  return wrapper;
}

function salaryClosePeriodEditor() {
  if (salaryPeriodEditorContext?.anchor?.isConnected)
    salaryPeriodEditorContext.anchor.setAttribute('aria-expanded', 'false');
  salaryPeriodEditorContext = null;
  salaryMonthPicker.hidden = true;
  salaryMonthSearch.value = '';
  salaryMonthOptions.replaceChildren();
  salaryMonthStatus.textContent = '';
  salaryMonthStatus.classList.remove('salary-month-error');
}

function salaryPositionPeriodEditor() {
  if (!salaryPeriodEditorContext) return;
  const anchor = salaryPeriodEditorContext.anchor;
  if (!anchor?.isConnected) { salaryClosePeriodEditor(); return; }
  const rect = anchor.getBoundingClientRect();
  const width = Math.max(0, Math.min(300, window.innerWidth - 16));
  salaryMonthPicker.style.width = `${width}px`;
  salaryMonthPicker.style.left = `${Math.max(8, Math.min(rect.left, window.innerWidth - width - 8))}px`;
  const height = salaryMonthPicker.getBoundingClientRect().height || 300;
  const below = rect.bottom + height + 5 <= window.innerHeight;
  salaryMonthPicker.style.top = `${Math.max(8, below ? rect.bottom + 5 : rect.top - height - 5)}px`;
}

function salaryReanchorPeriodEditor() {
  if (!salaryPeriodEditorContext) return;
  if (!salaryPayrollActive()) { salaryClosePeriodEditor(); return; }
  const id = String(salaryPeriodEditorContext.weekId);
  const anchor = [...document.querySelectorAll('.salary-week-month[data-week-id]')]
    .find(button => button.dataset.weekId === id);
  if (!anchor) { salaryClosePeriodEditor(); return; }
  salaryPeriodEditorContext.anchor = anchor;
  anchor.setAttribute('aria-expanded', 'true');
  salaryPositionPeriodEditor();
}

function salaryRenderPeriodOptions() {
  if (!salaryPeriodEditorContext) return;
  const query = salaryMonthSearch.value.trim().toLocaleLowerCase();
  const week = salaryPeriodWeeks.get(salaryPeriodEditorContext.weekId);
  const months = [...salaryPeriodMonths.values()].filter(month => month.valid !== false)
    .sort((a, b) => Number(b.sortKey) - Number(a.sortKey) || b.id - a.id);
  const matches = months.filter(month =>
    month.label.toLocaleLowerCase().includes(query));
  salaryMonthOptions.replaceChildren();
  matches.forEach(month => {
    const option = document.createElement('button');
    option.type = 'button';
    option.className = 'salary-month-option';
    option.dataset.monthId = String(month.id);
    option.setAttribute('role', 'option');
    option.setAttribute('aria-selected', String(month.id === Number(week?.monthId)));
    option.textContent = month.label;
    option.disabled = salaryPeriodEditorSaving;
    option.addEventListener('click', () => salarySavePeriodMonth(month.id));
    salaryMonthOptions.appendChild(option);
  });
  if (!matches.length) {
    const empty = document.createElement('p');
    empty.className = 'salary-month-empty';
    empty.textContent = months.length ? 'No matching months' : 'No months in MonthRegistry';
    salaryMonthOptions.appendChild(empty);
  }
  salaryMonthStatus.textContent = `${matches.length} ${matches.length === 1 ? 'month' : 'months'}`;
  salaryMonthStatus.classList.remove('salary-month-error');
}

function salaryOpenPeriodEditor(weekId, anchor) {
  if (!salaryPayrollActive() || salaryPeriodEditorSaving) return;
  if (salaryPeriodEditorContext?.weekId === Number(weekId)) {
    salaryClosePeriodEditor();
    return;
  }
  salaryClosePeriodEditor();
  if (typeof closeReferenceEditor === 'function') closeReferenceEditor();
  salaryPeriodEditorContext = { weekId: Number(weekId), anchor };
  salaryMonthPicker.hidden = false;
  salaryMonthSearch.disabled = false;
  salaryMonthClear.disabled = false;
  anchor.setAttribute('aria-expanded', 'true');
  salaryRenderPeriodOptions();
  salaryPositionPeriodEditor();
  salaryMonthSearch.focus({ preventScroll: true });
}

async function salarySavePeriodMonth(monthId) {
  if (!salaryPeriodEditorContext || salaryPeriodEditorSaving) return;
  const context = salaryPeriodEditorContext;
  const currentMonth = Number(salaryPeriodWeeks.get(context.weekId)?.monthId) || 0;
  const restoreFocus = salaryMonthPicker.contains(document.activeElement);
  if (currentMonth === monthId) {
    salaryClosePeriodEditor();
    if (restoreFocus && context.anchor?.isConnected)
      context.anchor.focus({ preventScroll: true });
    return;
  }
  salaryPeriodEditorSaving = true;
  salaryMonthSearch.disabled = true;
  salaryMonthClear.disabled = true;
  salaryMonthOptions.querySelectorAll('button').forEach(button => { button.disabled = true; });
  document.querySelectorAll('.salary-week-month').forEach(button => { button.disabled = true; });
  salaryMonthStatus.textContent = 'Saving…';
  salaryMonthStatus.classList.remove('salary-month-error');
  try {
    await salarySetWeekMonth(context.weekId, monthId);
    if (salaryPeriodEditorContext === context) {
      const anchor = context.anchor;
      salaryClosePeriodEditor();
      if (restoreFocus && anchor?.isConnected) {
        anchor.disabled = false;
        anchor.focus({ preventScroll: true });
      }
    }
  } catch (error) {
    if (salaryPeriodEditorContext === context) {
      salaryMonthStatus.textContent = typeof actionErrorMessage === 'function'
        ? actionErrorMessage('Assign week month', error) : String(error.message || error);
      salaryMonthStatus.classList.add('salary-month-error');
    }
  } finally {
    salaryPeriodEditorSaving = false;
    salaryMonthSearch.disabled = false;
    salaryMonthClear.disabled = false;
    salaryMonthOptions.querySelectorAll('button').forEach(button => { button.disabled = false; });
    document.querySelectorAll('.salary-week-month').forEach(button => { button.disabled = false; });
  }
}

salaryViewSelect.addEventListener('change', async () => {
  if (salaryPeriodViewChanging) return;
  salaryPeriodViewChanging = true;
  salaryViewSelect.disabled = true;
  try {
    await salaryChangePeriodView(salaryViewSelect.value);
  } catch (error) {
    if (typeof showToast === 'function') showToast(typeof actionErrorMessage === 'function'
      ? actionErrorMessage('Change salary view', error) : String(error.message || error));
  } finally {
    salaryPeriodViewChanging = false;
    salarySyncPeriodControls();
  }
});
salaryMonthSearch.addEventListener('input', salaryRenderPeriodOptions);
salaryMonthClear.addEventListener('click', () => salarySavePeriodMonth(0));
salaryMonthPicker.addEventListener('keydown', event => {
  if (!['ArrowDown', 'ArrowUp', 'Enter', 'Escape'].includes(event.key)) return;
  event.stopPropagation();
  if (event.key === 'Escape') {
    event.preventDefault();
    const anchor = salaryPeriodEditorContext?.anchor;
    salaryClosePeriodEditor();
    if (anchor?.isConnected) anchor.focus({ preventScroll: true });
    return;
  }
  const options = [...salaryMonthOptions.querySelectorAll('button:not(:disabled)')];
  if (event.key === 'Enter') {
    if (document.activeElement === salaryMonthSearch && options.length) {
      event.preventDefault(); options[0].click();
    }
    return;
  }
  event.preventDefault();
  if (!options.length) return;
  const index = options.indexOf(document.activeElement);
  const next = event.key === 'ArrowDown'
    ? (index + 1) % options.length : (index < 0 ? options.length - 1 : (index - 1 + options.length) % options.length);
  options[next].focus({ preventScroll: true });
  options[next].scrollIntoView?.({ block: 'nearest' });
});
document.addEventListener('pointerdown', event => {
  if (!salaryMonthPicker.hidden && !salaryMonthPicker.contains(event.target)
      && !salaryPeriodEditorContext?.anchor?.contains(event.target)) salaryClosePeriodEditor();
}, true);
window.addEventListener('resize', salaryPositionPeriodEditor);
document.addEventListener('scroll', salaryPositionPeriodEditor, true);
