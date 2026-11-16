// Tela Calendário
import { toast } from './feedback.js';
import { $$, Holidays, colorFromString, escapeHtml, parentTag, today } from './helpers.js';
import { Modal } from './modal.js';
import { State } from './state.js';
import { UI } from './ui.js';
import { Views } from './views.js';

// Plugado em Views: continuam acessíveis como Views.<método> e this.<método>.
Object.assign(Views, {
  // ============================================================================
  // CALENDÁRIO — visualização mensal de tasks por prazo (end_date)
  // ============================================================================
  calendario() {
    if (!UI._overviewLoadedAt) setTimeout(() => UI.refreshOverview(true), 100);
    const year  = State.calendarYear;
    const month = State.calendarMonth;
    // Tarefas inativas só aparecem no Gantt — ficam fora do calendário
    const allTasks = (State.allTasks.length > 0 ? State.allTasks : State.tasks).filter(t => !t.inactive);
    const todayStr = today();

    // ── Filtros ────────────────────────────────────────────────────────────────
    const filterDisc = State.calendarDiscFilter;
    const filterProj = State.calendarProjFilter;
    let filteredTasks = allTasks.filter(t => t.start_date && t.end_date);
    if (filterDisc) filteredTasks = filteredTasks.filter(t => t.discipline_id === filterDisc);
    if (filterProj) filteredTasks = filteredTasks.filter(t => t.project_id === filterProj);

    const monthNames = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho',
                        'Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
    const dayNames = ['Dom','Seg','Ter','Qua','Qui','Sex','Sáb'];

    const firstDay = new Date(year, month, 1);
    const lastDay  = new Date(year, month + 1, 0);
    const startDow = firstDay.getDay();
    const d2 = n => String(n).padStart(2, '0');
    const ds  = d => `${year}-${d2(month+1)}-${d2(d)}`;
    const monthStart = ds(1);
    const monthEnd   = ds(lastDay.getDate());

    // ── Mapa dia → { starting, ending, spanning } ─────────────────────────────
    const dayMap = new Map();
    for (let d = 1; d <= lastDay.getDate(); d++) {
      dayMap.set(ds(d), { starting: [], ending: [], spanning: [] });
    }
    filteredTasks.forEach(t => {
      const tStart = t.start_date, tEnd = t.end_date;
      for (let d = 1; d <= lastDay.getDate(); d++) {
        const key = ds(d);
        if (tEnd < key || tStart > key) continue;
        const entry = dayMap.get(key);
        if      (tStart === key) entry.starting.push(t);
        else if (tEnd   === key) entry.ending.push(t);
        else                     entry.spanning.push(t);
      }
    });

    // ── Stats ──────────────────────────────────────────────────────────────────
    const monthActive  = filteredTasks.filter(t => t.start_date <= monthEnd && t.end_date >= monthStart);
    const cntActive    = monthActive.length;
    const cntEnding    = filteredTasks.filter(t => t.end_date >= monthStart && t.end_date <= monthEnd).length;
    const cntOverdue   = filteredTasks.filter(t => t.end_date < todayStr && t.status !== 'concluido').length;
    const cntDone      = filteredTasks.filter(t => t.end_date >= monthStart && t.end_date <= monthEnd && t.status === 'concluido').length;

    // ── Cores por disciplina ───────────────────────────────────────────────────
    const discColor = id => {
      const d = State.disciplines.find(x => x.id === id);
      return d ? colorFromString(d.code || d.name) : '#94928B';
    };

    // ── Células ────────────────────────────────────────────────────────────────
    const cells = [];
    const prevLast = new Date(year, month, 0).getDate();
    for (let i = startDow - 1; i >= 0; i--) cells.push({ day: prevLast - i, cur: false });
    for (let d = 1; d <= lastDay.getDate(); d++) cells.push({ day: d, cur: true, dateStr: ds(d) });
    let nd = 1;
    while (cells.length < 42) cells.push({ day: nd++, cur: false });

    const cellsHtml = cells.map(cell => {
      const dow = cells.indexOf(cell) % 7;
      const isWkd = dow === 0 || dow === 6;
      if (!cell.cur) return `<div class="cal-cell other-month${isWkd ? ' weekend-day' : ''}"><div class="cal-day-num" >${cell.day}</div></div>`;

      const isToday  = cell.dateStr === todayStr;
      const data     = dayMap.get(cell.dateStr) || { starting: [], ending: [], spanning: [] };
      const allDay   = [...data.ending, ...data.starting];
      const spans    = data.spanning;
      const visible  = allDay.slice(0, 3);
      const moreCount = allDay.length - visible.length + (spans.length > 0 && visible.length >= 3 ? 1 : 0);

      // Barra fina de spanning no topo
      const spanBars = spans.length > 0 ? `
        <div class="cal-span-bars">
          ${spans.slice(0, 6).map(t => `<div class="cal-span-bar" style="background:${discColor(t.discipline_id)};" title="${escapeHtml(t.title)}"></div>`).join('')}
        </div>` : '';

      const chipsHtml = visible.map(t => {
        const isStart   = t.start_date === cell.dateStr;
        const isEnd     = t.end_date   === cell.dateStr;
        const isOverdue = isEnd && t.end_date < todayStr && t.status !== 'concluido';
        const dc        = discColor(t.discipline_id);
        const disc      = State.disciplines.find(d => d.id === t.discipline_id);
        const prefix    = isStart ? '▶ ' : '';
        return `<div class="cal-task-chip${isOverdue ? ' overdue' : ''}"
          data-action="edit-task" data-id="${t.id}"
          style="border-left-color:${dc};background:${dc}18;"
          title="${isStart?'Início: ':isEnd?'Prazo: ':''}${escapeHtml(t.title)}${disc?' · '+disc.code:''}"
        >${prefix}${escapeHtml(t.title)}</div>`;
      }).join('');

      const dayTotal = allDay.length + spans.length;
      return `<div class="cal-cell${isToday ? ' today' : ''}${isWkd ? ' weekend-day' : ''}" data-action="cal-day" data-date="${cell.dateStr}" style="cursor:pointer;" title="${dayTotal} tarefa${dayTotal!==1?'s':''} neste dia — clique para ver todas">
        <div class="cal-day-num">${cell.day}${isToday ? `<span class="cal-today-badge">HOJE</span>` : ''}</div>
        ${spanBars}
        ${chipsHtml}
        ${moreCount > 0 ? `<div class="cal-more">+${moreCount} mais</div>` : ''}
      </div>`;
    }).join('');

    // ── Filtros dropdowns ──────────────────────────────────────────────────────
    const discSel = State.disciplines.length > 0 ? `
      <select class="form-input" style="font-size:11px;padding:3px 8px;height:30px;max-width:180px;"
        onchange="State.calendarDiscFilter=this.value||null;UI.render();">
        <option value="">Todas as disciplinas</option>
        ${State.disciplines.map(d => `<option value="${d.id}"${filterDisc===d.id?' selected':''}>${escapeHtml(d.code)} — ${escapeHtml(d.name)}</option>`).join('')}
      </select>` : '';

    const projSel = State.projects.length > 1 ? `
      <select class="form-input" style="font-size:11px;padding:3px 8px;height:30px;max-width:180px;"
        onchange="State.calendarProjFilter=this.value||null;UI.render();">
        <option value="">Todos os projetos</option>
        ${State.projects.map(p => `<option value="${p.id}"${filterProj===p.id?' selected':''}>${escapeHtml(p.name)}</option>`).join('')}
      </select>` : '';

    // ── Legenda de disciplinas ─────────────────────────────────────────────────
    const discLegend = State.disciplines.slice(0, 8).map(d => `
      <div class="cal-legend-item">
        <div style="width:10px;height:10px;border-radius:2px;background:${colorFromString(d.code||d.name)};opacity:0.8;"></div>
        ${escapeHtml(d.code)}
      </div>`).join('');

    return `
      <div class="page-title-block">
        <div class="page-eyebrow">VISUALIZAÇÃO · PRAZOS</div>
        <div class="page-title">Calendário</div>
      </div>
      <div class="panel">
        <div class="panel-body" style="padding:16px;">

          <div class="cal-nav">
            <button class="cal-nav-btn" data-action="cal-prev">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="15 18 9 12 15 6"/></svg>
            </button>
            <div class="cal-nav-title">${monthNames[month]} ${year}</div>
            <button class="cal-nav-btn" data-action="cal-next">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="9 18 15 12 9 6"/></svg>
            </button>
            <button class="btn btn-ghost" data-action="cal-today" style="font-size:11px;padding:3px 10px;">Hoje</button>
            ${discSel}
            ${projSel}
          </div>

          <div class="cal-filter-bar">
            <div class="cal-stat-chip"><span style="color:var(--accent);font-weight:700;">${cntActive}</span> ativas neste mês</div>
            <div class="cal-stat-chip"><span style="color:var(--ink-soft);font-weight:700;">${cntEnding}</span> com prazo neste mês</div>
            ${cntOverdue > 0 ? `<div class="cal-stat-chip" style="border-color:rgba(193,59,18,0.3);"><span style="color:var(--accent-danger);font-weight:700;">${cntOverdue}</span> atrasadas</div>` : ''}
            <div class="cal-stat-chip"><span style="color:var(--accent-success);font-weight:700;">${cntDone}</span> concluídas neste mês</div>
          </div>

          <div class="cal-grid">
            ${dayNames.map((d, i) => `<div class="cal-header-cell${i===0||i===6?' weekend':''}">${d}</div>`).join('')}
            ${cellsHtml}
          </div>

          <div class="cal-legend" style="margin-top:12px;">
            <span style="font-family:var(--font-mono);font-size:9px;text-transform:uppercase;color:var(--ink-mute);letter-spacing:0.12em;">Disciplinas:</span>
            ${discLegend || '<span style="font-size:11px;color:var(--ink-mute);">Nenhuma disciplina cadastrada</span>'}
            <div style="margin-left:auto;display:flex;gap:12px;">
              <div class="cal-legend-item"><div style="width:10px;height:4px;border-radius:2px;background:var(--ink-mute);opacity:0.35;"></div> Em andamento</div>
              <div class="cal-legend-item"><span style="font-size:10px;">▶</span> Início</div>
              <div class="cal-legend-item" style="color:var(--accent-danger);">⬛ Atrasada</div>
            </div>
          </div>
        </div>
      </div>
    `;
  },
});

// Plugado em UI: continuam acessíveis como UI.<método> e this.<método>.
Object.assign(UI, {
  // Calendário: abre todas as tarefas de um dia (modal)
  openCalendarDay(dateStr) {
    if (!dateStr) return;
    const allTasks = (State.allTasks.length > 0 ? State.allTasks : State.tasks).filter(t => !t.inactive);
    const fd = State.calendarDiscFilter, fp = State.calendarProjFilter;
    let tasks = allTasks.filter(t => t.start_date && t.end_date && t.start_date <= dateStr && t.end_date >= dateStr);
    if (fd) tasks = tasks.filter(t => t.discipline_id === fd);
    if (fp) tasks = tasks.filter(t => t.project_id === fp);
    const starting = tasks.filter(t => t.start_date === dateStr);
    const ending   = tasks.filter(t => t.end_date === dateStr && t.start_date !== dateStr);
    const spanning = tasks.filter(t => t.start_date < dateStr && t.end_date > dateStr);
    const total = tasks.length;
    const multiProj = State.projects.length > 1;
    const dt = new Date(dateStr + 'T00:00:00');
    let dateLbl = dt.toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' });
    dateLbl = dateLbl.charAt(0).toUpperCase() + dateLbl.slice(1);

    const row = (t, tag, color) => {
      const disc = State.disciplines.find(d => d.id === t.discipline_id);
      const member = State.members.find(m => m.id === t.assignee_id) || (State.teamMembers || []).find(m => m.id === t.assignee_id);
      const proj = multiProj ? State.projects.find(p => p.id === t.project_id) : null;
      const overdue = t.end_date < today() && t.status !== 'concluido';
      const meta = [t.code, proj && proj.name, disc && disc.code, member && member.name.split(' ')[0]].filter(Boolean).map(escapeHtml).join(' · ');
      return `<div class="cal-day-row" data-id="${t.id}" style="display:flex;align-items:center;gap:10px;padding:8px 10px;border-bottom:1px solid var(--border);cursor:pointer;">
        <span style="width:4px;align-self:stretch;min-height:26px;border-radius:2px;background:${color};flex-shrink:0;"></span>
        <div style="flex:1;min-width:0;">
          <div style="font-size:13px;font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escapeHtml(t.title)}</div>
          <div style="font-family:var(--font-mono);font-size:10px;color:var(--ink-mute);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${meta}</div>
          ${parentTag(t)}
        </div>
        <span style="font-family:var(--font-mono);font-size:10px;font-weight:700;color:${color};white-space:nowrap;">${tag}</span>
        ${overdue ? '<span style="font-family:var(--font-mono);font-size:9px;color:var(--accent-danger);">atrasada</span>' : ''}
      </div>`;
    };
    const section = (title, arr, tag, color) => arr.length
      ? `<div style="font-family:var(--font-mono);font-size:10px;text-transform:uppercase;letter-spacing:.1em;color:var(--ink-mute);padding:10px 10px 4px;">${title} · ${arr.length}</div>${arr.map(t => row(t, tag, color)).join('')}`
      : '';

    const body = total === 0
      ? `<div class="empty-state" style="padding:30px 20px;"><div class="empty-state-sub">Nenhuma tarefa neste dia.</div></div>`
      : `<div style="font-size:12px;color:var(--ink-mute);margin-bottom:8px;">${total} tarefa${total !== 1 ? 's' : ''} neste dia · clique para abrir</div>
         <div style="max-height:60vh;overflow:auto;border:1px solid var(--border);border-radius:3px;">
           ${section('Iniciam', starting, '▶ início', 'var(--blueprint)')}
           ${section('Terminam (prazo)', ending, '● prazo', 'var(--accent)')}
           ${section('Em andamento', spanning, '— atravessa', 'var(--ink-mute)')}
         </div>`;

    Modal.open({
      title: dateLbl,
      cls: 'modal-wide',
      body,
      footer: `<button type="button" class="btn btn-secondary" onclick="Modal.close()">Fechar</button>`
    });
    $$('.cal-day-row').forEach(r => { r.onclick = () => { Modal.close(); UI.openTaskModal(r.dataset.id); }; });
  },

  addHoliday() {
    const dateInput = document.getElementById('holidayDateInput');
    const endInput = document.getElementById('holidayEndInput');
    const nameInput = document.getElementById('holidayNameInput');
    const date = dateInput?.value;
    const end = endInput?.value || null;
    const name = nameInput?.value?.trim();
    if (!date) { toast('Selecione uma data', 'error'); return; }
    if (end && end < date) { toast('O término não pode ser antes do início', 'error'); return; }
    const list = Holidays.load();
    if (list.some(h => h.date === date)) { toast('Data já cadastrada', 'warning'); return; }
    const entry = { date, name: name || date };
    if (end && end > date) entry.end = end;
    list.push(entry);
    Holidays.save(list);
    toast(entry.end ? `Período adicionado: ${date} → ${end}` : `Feriado adicionado: ${date}`, 'success');
    if (dateInput) dateInput.value = '';
    if (endInput) endInput.value = '';
    if (nameInput) nameInput.value = '';
    // Atualiza lista sem re-render completo
    const listEl = document.getElementById('holidayList');
    if (listEl) listEl.innerHTML = Holidays.listHtml();
  },

  removeHoliday(date) {
    let list = Holidays.load().filter(h => h.date !== date);
    Holidays.save(list);
    toast('Feriado removido', 'success');
    const listEl = document.getElementById('holidayList');
    if (listEl) listEl.innerHTML = Holidays.listHtml();
  },
});
