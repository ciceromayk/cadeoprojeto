// Dashboard e Visão geral: KPIs, curva S, causas de atraso
import { CPMCache } from './cpm.js';
import { DB } from './db.js';
import { friendlyError, setLoading, toast } from './feedback.js';
import { HealthCheck } from './health.js';
import { DateFilter, _parseYMD, addDays, colorFromString, daysBetween, escapeHtml, fmtDate, fmtDateFull, fmtDateShort, forecastEndDate, initials, parentTag, physicalProgress, statusFilterChips, today } from './helpers.js';
import { DELAY_CAUSES, PPC_CAUSES, RESTRICTION_STATUS, RESTRICTION_TYPES, State } from './state.js';
import { UI } from './ui.js';
import { Views } from './views.js';

// Plugado em Views: continuam acessíveis como Views.<método> e this.<método>.
Object.assign(Views, {
  // ============================================================================
  // VISÃO GERAL
  // ============================================================================
  overview() {
    const allProjects = State.projects;
    if (allProjects.length === 0) return this.emptyProject();

    // Auto-refresh: dispara fetch se ainda não carregou (silencioso, em background)
    if (!UI._overviewLoadedAt) {
      // Não bloqueia o render — chama em background e re-renderiza quando voltar
      setTimeout(() => UI.refreshOverview(true), 100);
    }

    const t = today();
    const filterProj = State.overviewFilter || 'all';

    // Atraso em relação ao prazo planejado (end_date atual) ou à linha de base vigente
    // (baseline_end) — ambos medidos contra HOJE, cada um contra sua própria referência.
    // Compartilhado pelas duas tabelas desta view.
    const _atrasoTd = (ref) => {
      const tdA = 'padding:10px 12px;border-bottom:1px solid var(--border);font-size:12px;';
      if (!ref) return `<td style="${tdA}font-family:var(--font-mono);font-size:11px;color:var(--ink-mute);">—</td>`;
      const late = ref < t;
      const days = late ? daysBetween(ref, t) : 0;
      return `<td style="${tdA}font-family:var(--font-mono);font-size:11px;${late ? 'color:var(--accent-danger);font-weight:700;' : 'color:var(--accent-success);'}">${late ? `${days}d` : 'em dia'}</td>`;
    };

    // Tarefas inativas só aparecem no Gantt — ficam fora da Visão Geral
    const allTasks = (State.allTasks.length > 0 ? State.allTasks : State.tasks).filter(t => !t.inactive);

    // Indicador de quando os dados foram atualizados pela última vez
    const lastUpdate = UI._overviewLoadedAt
      ? `atualizado ${(() => {
          const diff = Date.now() - UI._overviewLoadedAt;
          const mins = Math.floor(diff / 60000);
          if (mins < 1) return 'agora';
          if (mins < 60) return `há ${mins}min`;
          return `há ${Math.floor(mins / 60)}h`;
        })()}`
      : 'carregando...';

    let filteredTasks = filterProj === 'all' ? allTasks : allTasks.filter(tk => tk.project_id === filterProj);
    // Filtro "Minhas tarefas": só as atribuídas ao membro do usuário logado
    const _myTm = State.teamMembers.find(m => m.email === State.user?.email);
    const mineOn = State.overviewMine && !!_myTm;
    if (mineOn) filteredTasks = filteredTasks.filter(tk => tk.assignee_id === _myTm.id);

    // Filtro por Setor (mesmo padrão do Last Planner: 'all' | '__none__' | nome do setor)
    const ovSector = State.overviewSectorFilter || 'all';
    const ovSectors = [...new Set((State.sectors || []).map(s => s.name).concat(allTasks.map(t => t.sector).filter(Boolean)))].sort((a, b) => a.localeCompare(b));
    if (ovSector !== 'all') {
      filteredTasks = filteredTasks.filter(tk => ovSector === '__none__' ? !tk.sector : tk.sector === ovSector);
    }

    // Filtro por Status (multi-seleção — chips independentes)
    const ovStatusSet = State.overviewStatusFilter || new Set(['a_fazer', 'em_andamento', 'bloqueada']);
    filteredTasks = filteredTasks.filter(tk => ovStatusSet.has(tk.status));

    // Filtro por período (que terminam / que acontecem no período) — mesmo mecanismo do Last Planner
    const _odf = State.dateFilters.overview;
    if (_odf && (_odf.from || _odf.to)) filteredTasks = filteredTasks.filter(tk => DateFilter.matchTask(tk, 'overview'));

    // Tarefas PAI (com filhas) — não devem aparecer nas listagens; só as folhas
    const parentIds = new Set(allTasks.filter(tk => tk.parent_id).map(tk => tk.parent_id));

    // TAREFAS — pendentes (não concluídas) e folhas, ordenadas por prazo.
    // Tarefas SEM prazo definido também entram (antes ficavam escondidas — o
    // projeto parecia "em dia" mesmo tendo pendências só sem data); vão pro
    // final da lista, marcadas como "Sem prazo".
    const upcomingTasks = [...filteredTasks]
      .filter(tk => tk.status !== 'concluido' && !parentIds.has(tk.id))
      .sort((a, b) => {
        if (!a.end_date && !b.end_date) return 0;
        if (!a.end_date) return 1;
        if (!b.end_date) return -1;
        return new Date(a.end_date) - new Date(b.end_date);
      });

    const overdueTasks = upcomingTasks.filter(tk => tk.end_date && tk.end_date < t);
    const next7Tasks = upcomingTasks.filter(tk => tk.end_date && tk.end_date >= t && tk.end_date <= addDays(t, 7)).length;
    const next30Tasks = upcomingTasks.filter(tk => tk.end_date && tk.end_date >= t && tk.end_date <= addDays(t, 30)).length;

    return `
      <div class="ov-zoom" style="zoom:1.12;">
      <div class="page-title-block">
        <div class="page-eyebrow">PORTFÓLIO · TODOS OS PROJETOS</div>
        <div class="page-title">Visão Geral</div>
        <div class="page-subtitle">Tarefas pendentes e atrasadas em ${allProjects.length} ${allProjects.length === 1 ? 'projeto' : 'projetos'}.</div>
      </div>

      <div style="display:flex;gap:10px;align-items:center;margin-bottom:20px;flex-wrap:wrap;">
        <label class="form-label" style="margin:0;">Projeto:</label>
        <select class="form-input" id="overviewFilter" style="width:auto;min-width:240px;max-width:400px;">
          <option value="all" ${filterProj === 'all' ? 'selected' : ''}>Todos os projetos (${allProjects.length})</option>
          ${allProjects.map(p => `<option value="${p.id}" ${filterProj === p.id ? 'selected' : ''}>${escapeHtml(p.name)}</option>`).join('')}
        </select>
        ${ovSectors.length > 0 ? `
        <label class="form-label" style="margin:0;">Setor:</label>
        <select class="form-input" id="overviewSectorFilter" style="width:auto;min-width:150px;">
          <option value="all" ${ovSector === 'all' ? 'selected' : ''}>Todos</option>
          <option value="__none__" ${ovSector === '__none__' ? 'selected' : ''}>Sem setor</option>
          ${ovSectors.map(s => `<option value="${escapeHtml(s)}" ${ovSector === s ? 'selected' : ''}>${escapeHtml(s)}</option>`).join('')}
        </select>` : ''}
        <span style="font-family:var(--font-mono);font-size:9px;color:var(--ink-mute);text-transform:uppercase;letter-spacing:.08em;">Status:</span>
        <div style="display:inline-flex;gap:5px;">${statusFilterChips(ovStatusSet, 'ov-status')}</div>
        ${DateFilter.ui('overview')}
        ${DateFilter.isActive('overview') ? DateFilter.modeUi('overview') : ''}
        ${_myTm ? `
        <button class="btn ${mineOn ? 'btn-cta' : 'btn-secondary'}" data-action="overview-toggle-mine" style="padding:6px 12px;font-size:11px;display:flex;align-items:center;gap:6px;" title="Mostrar só as tarefas atribuídas a você">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:14px;height:14px;"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
          Minhas tarefas
        </button>` : ''}
        <button class="btn btn-secondary" data-action="refresh-overview" style="padding:6px 12px;font-size:11px;display:flex;align-items:center;gap:6px;">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:14px;height:14px;"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>
          Atualizar
        </button>
        <span style="font-family:var(--font-mono);font-size:10px;color:var(--ink-mute);text-transform:uppercase;letter-spacing:0.1em;">${lastUpdate}${mineOn ? ' · só minhas' : ''}</span>
      </div>

      <!-- TAREFAS -->
      <div style="font-family:var(--font-mono);font-size:10px;color:var(--ink-mute);text-transform:uppercase;letter-spacing:0.12em;margin-bottom:8px;">✓ Tarefas</div>
      ${(() => {
        const totPend = overdueTasks.length + next30Tasks;
        const kpi = (n, label, meta, tone, icon, pct) => `
          <div class="kpi ${tone}">
            <div class="kpi-num">${n}</div>
            <div class="kpi-body">
              <div class="stat-label">${label}</div>
              <div class="stat-meta">${meta}</div>
              ${pct !== null ? `<div class="progress-mini" style="margin-top:7px;--pct:${pct}%;--bar-c:var(--kpi-c);"><span></span></div>` : ''}
            </div>
            <div class="kpi-icon">${icon}</div>
          </div>`;
        const icoWarn = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="34" height="34"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>';
        const icoCal = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="34" height="34"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>';
        const icoClock = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="34" height="34"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>';
        return `<div class="stats-grid" style="grid-template-columns:repeat(3,1fr);margin-bottom:24px;">
          ${kpi(overdueTasks.length, 'Tarefas Atrasadas', overdueTasks.length === 0 ? 'tudo no prazo' : 'passaram do prazo', overdueTasks.length > 0 ? 'is-late' : 'is-ok', icoWarn, totPend > 0 ? Math.round(overdueTasks.length / totPend * 100) : 0)}
          ${kpi(next7Tasks, 'Próximos 7 dias', 'vencem nesta semana', 'is-warn', icoCal, null)}
          ${kpi(next30Tasks, 'Próximos 30 dias', 'no horizonte mensal', 'is-doing', icoClock, null)}
        </div>`;
      })()}

      <details class="panel" data-panel="ov-proximas" ${State.collapsedPanels.has('ov-proximas') ? '' : 'open'}>
        <summary class="panel-head"><div style="display:flex;align-items:center;gap:8px;min-width:0;"><span class="panel-chevron">▾</span><div class="panel-title">Próximas Tarefas (cronológico)</div></div><div class="panel-title-mono">${upcomingTasks.length} pendentes</div></summary>
        <div class="panel-body" style="padding:0;overflow-x:auto;">
          ${upcomingTasks.length === 0 ? `
            <div class="empty-state" style="padding:40px 20px;">
              <div class="empty-state-sub">Nenhuma tarefa pendente. ${filterProj === 'all' ? 'Todos os projetos estão em dia.' : 'Este projeto está em dia.'}</div>
            </div>
          ` : (() => {
            const tdS = 'padding:10px 12px;border-bottom:1px solid var(--border);font-size:12px;';
            const statusColors = { em_andamento: 'var(--accent)', a_fazer: 'var(--ink-mute)', bloqueada: 'var(--accent-danger)', concluido: 'var(--accent-success)' };
            const prioColors = { critica: '#a4161a', alta: 'var(--accent-danger)', media: 'var(--accent-warm)', baixa: 'var(--accent-success)' };
            const prioLabels = { critica: 'Crítica', alta: 'Urgente', media: 'Normal', baixa: 'Baixa' };
            return `
            <table style="width:100%;border-collapse:collapse;">
              <thead><tr>
                <th style="${tdS}font-family:var(--font-mono);font-size:10px;color:var(--ink-mute);text-transform:uppercase;letter-spacing:0.1em;text-align:left;width:32%;">Nome</th>
                <th style="${tdS}font-family:var(--font-mono);font-size:10px;color:var(--ink-mute);text-transform:uppercase;letter-spacing:0.1em;text-align:left;">Projeto</th>
                <th style="${tdS}font-family:var(--font-mono);font-size:10px;color:var(--ink-mute);text-transform:uppercase;letter-spacing:0.1em;text-align:left;">Responsável</th>
                <th style="${tdS}font-family:var(--font-mono);font-size:10px;color:var(--ink-mute);text-transform:uppercase;letter-spacing:0.1em;text-align:left;">Prazo</th>
                <th style="${tdS}font-family:var(--font-mono);font-size:10px;color:var(--ink-mute);text-transform:uppercase;letter-spacing:0.1em;text-align:left;" title="Atraso em relação ao prazo planejado atual">Atraso (Plan.)</th>
                <th style="${tdS}font-family:var(--font-mono);font-size:10px;color:var(--ink-mute);text-transform:uppercase;letter-spacing:0.1em;text-align:left;" title="Atraso em relação à linha de base vigente">Atraso (LB)</th>
                <th style="${tdS}font-family:var(--font-mono);font-size:10px;color:var(--ink-mute);text-transform:uppercase;letter-spacing:0.1em;text-align:left;">Prioridade</th>
              </tr></thead>
              <tbody>
                ${upcomingTasks.slice(0, 20).map(tk => {
                  const proj = allProjects.find(p => p.id === tk.project_id);
                  const projColor = colorFromString(proj?.name || '?');
                  const member = State.members.find(m => m.id === tk.assignee_id);
                  const isOverdue = !!tk.end_date && tk.end_date < t;
                  const dDays = tk.end_date ? daysBetween(t, tk.end_date) : null;
                  const dueTxt = !tk.end_date ? 'Sem prazo' : (isOverdue ? `${Math.abs(dDays)}d atrás` : (dDays === 0 ? 'Hoje' : (dDays === 1 ? 'Amanhã' : fmtDateShort(tk.end_date))));
                  return `<tr style="cursor:default;" onmouseover="this.style.background='var(--bg-hover)'" onmouseout="this.style.background='transparent'">
                    <td style="${tdS}font-weight:500;max-width:320px;">
                      <div style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;"><span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${statusColors[tk.status] || 'var(--ink-mute)'};margin-right:8px;vertical-align:middle;"></span>${escapeHtml(tk.title)}</div>
                      ${parentTag(tk)}
                    </td>
                    <td style="${tdS}"><span style="display:inline-block;padding:2px 10px;border-radius:4px;background:${projColor};color:#fff;font-size:11px;font-weight:700;text-shadow:0 1px 1px rgba(0,0,0,0.25);">${escapeHtml(proj?.name || '?')}</span></td>
                    <td style="${tdS}font-size:11px;">
                      ${member ? `<span class="avatar-tip" data-tip="${escapeHtml(member.name)}" style="display:inline-flex;align-items:center;gap:4px;"><span style="width:22px;height:22px;border-radius:50%;background:${colorFromString(member.name)};color:#fff;display:inline-flex;align-items:center;justify-content:center;font-size:9px;font-weight:700;">${initials(member.name)}</span></span>` : '<span style="color:var(--ink-mute);">—</span>'}
                    </td>
                    <td style="${tdS}font-family:var(--font-mono);font-size:11px;${isOverdue ? 'color:var(--accent-danger);font-weight:700;' : (!tk.end_date ? 'color:var(--ink-mute);font-style:italic;' : '')}">${dueTxt}</td>
                    ${_atrasoTd(tk.end_date)}
                    ${_atrasoTd(tk.baseline_end)}
                    <td style="${tdS}"><span style="display:inline-flex;align-items:center;gap:4px;font-size:11px;"><span style="color:${prioColors[tk.priority] || 'var(--ink-mute)'};">◆</span> ${prioLabels[tk.priority] || tk.priority}</span></td>
                  </tr>`;
                }).join('')}
              </tbody>
            </table>
            ${upcomingTasks.length > 20 ? `<div style="padding:10px 20px;font-size:11px;color:var(--ink-mute);font-family:var(--font-mono);text-align:center;">+ ${upcomingTasks.length - 20} outras tarefas pendentes</div>` : ''}
            `;
          })()}
        </div>
      </details>

      ${overdueTasks.length > 0 ? `
        <details class="panel" data-panel="ov-atrasadas" style="margin-top:14px;" ${State.collapsedPanels.has('ov-atrasadas') ? '' : 'open'}>
          <summary class="panel-head"><div style="display:flex;align-items:center;gap:8px;min-width:0;"><span class="panel-chevron">▾</span><div class="panel-title">Tarefas Atrasadas</div></div><div class="panel-title-mono">${overdueTasks.length}</div></summary>
          <div class="panel-body" style="padding:0;">
            ${overdueTasks.slice(0, 10).map(tk => {
              const proj = allProjects.find(p => p.id === tk.project_id);
              const dDays = daysBetween(t, tk.end_date);
              return `
                <div style="padding:14px 20px;border-bottom:1px solid var(--border);display:flex;align-items:center;gap:12px;border-left:3px solid var(--accent-danger);">
                  <div style="flex:1;min-width:0;">
                    <div style="font-size:13px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(tk.title)}</div>
                    <div style="font-size:11px;color:var(--ink-soft);font-family:var(--font-mono);margin-top:2px;">
                      ${escapeHtml(proj?.name || '?')} · ${tk.code}${parentTag(tk, null, 'inline')}
                    </div>
                  </div>
                  <div style="font-family:var(--font-mono);font-size:11px;color:var(--accent-danger);">
                    ${Math.abs(dDays)}d atrasado
                  </div>
                </div>
              `;
            }).join('')}
            ${overdueTasks.length > 10 ? `<div style="padding:10px 20px;font-size:11px;color:var(--ink-mute);font-family:var(--font-mono);text-align:center;">+ ${overdueTasks.length - 10} outras tarefas atrasadas</div>` : ''}
          </div>
        </details>
      ` : ''}

      <!-- TABELA CROSS-PROJECT: todas as tarefas pendentes, agrupadas por status -->
      ${(() => {
        const pendingTasks = upcomingTasks.filter(tk => tk.status !== 'concluido');
        if (pendingTasks.length === 0) return '';
        const statusGroups = [
          { id: 'em_andamento', label: 'EM PROGRESSO', color: 'var(--accent)',        tint: 'rgba(229,75,26,0.10)' },
          { id: 'a_fazer',      label: 'A FAZER',      color: 'var(--ink-mute)',       tint: 'rgba(107,99,89,0.10)' },
          { id: 'bloqueada',    label: 'BLOQUEADA',    color: 'var(--accent-danger)',  tint: 'rgba(193,59,18,0.10)' },
        ];
        const tdS = 'padding:10px 12px;border-bottom:1px solid var(--border);font-size:12px;';
        return `
          <details class="panel" data-panel="ov-todas" style="margin-top:14px;" ${State.collapsedPanels.has('ov-todas') ? '' : 'open'}>
            <summary class="panel-head">
              <div style="display:flex;align-items:center;gap:8px;min-width:0;"><span class="panel-chevron">▾</span><div class="panel-title">Todas as Tarefas Pendentes</div></div>
              <div class="panel-title-mono">${pendingTasks.length} tarefas</div>
            </summary>
            <div class="panel-body" style="padding:0;overflow-x:auto;">
              ${statusGroups.map(sg => {
                const groupTasks = pendingTasks.filter(tk => tk.status === sg.id);
                if (groupTasks.length === 0) return '';
                return `
                  <div style="padding:10px 16px;background:var(--bg-deep);border-bottom:1px solid var(--border);display:flex;align-items:center;gap:8px;">
                    <span style="display:inline-flex;align-items:center;gap:6px;padding:3px 10px;border-radius:10px;background:${sg.tint};color:${sg.color};font-size:10px;font-weight:800;letter-spacing:0.08em;border:1px solid ${sg.color}33;">
                      <span style="width:6px;height:6px;border-radius:50%;background:${sg.color};"></span>${sg.label}
                    </span>
                    <span style="font-family:var(--font-mono);font-size:11px;color:var(--ink-mute);">${groupTasks.length}</span>
                  </div>
                  <table style="width:100%;border-collapse:collapse;">
                    <thead><tr>
                      <th style="${tdS}font-family:var(--font-mono);font-size:10px;color:var(--ink-mute);text-transform:uppercase;letter-spacing:0.1em;text-align:left;width:40%;">Nome</th>
                      <th style="${tdS}font-family:var(--font-mono);font-size:10px;color:var(--ink-mute);text-transform:uppercase;letter-spacing:0.1em;text-align:left;">Projeto</th>
                      <th style="${tdS}font-family:var(--font-mono);font-size:10px;color:var(--ink-mute);text-transform:uppercase;letter-spacing:0.1em;text-align:left;">Responsável</th>
                      <th style="${tdS}font-family:var(--font-mono);font-size:10px;color:var(--ink-mute);text-transform:uppercase;letter-spacing:0.1em;text-align:left;">Prazo</th>
                      <th style="${tdS}font-family:var(--font-mono);font-size:10px;color:var(--ink-mute);text-transform:uppercase;letter-spacing:0.1em;text-align:left;" title="Atraso em relação ao prazo planejado atual">Atraso (Plan.)</th>
                      <th style="${tdS}font-family:var(--font-mono);font-size:10px;color:var(--ink-mute);text-transform:uppercase;letter-spacing:0.1em;text-align:left;" title="Atraso em relação à linha de base vigente">Atraso (LB)</th>
                      <th style="${tdS}font-family:var(--font-mono);font-size:10px;color:var(--ink-mute);text-transform:uppercase;letter-spacing:0.1em;text-align:left;">Prioridade</th>
                    </tr></thead>
                    <tbody>
                      ${groupTasks.map(tk => {
                        const proj = allProjects.find(p => p.id === tk.project_id);
                        const projColor = colorFromString(proj?.name || '?');
                        const member = State.members.find(m => m.id === tk.assignee_id);
                        const isOverdue = !!tk.end_date && tk.end_date < t;
                        const dDays = tk.end_date ? daysBetween(t, tk.end_date) : null;
                        const dueTxt = !tk.end_date ? 'Sem prazo' : (isOverdue ? `${Math.abs(dDays)}d atrás` : (dDays === 0 ? 'Hoje' : (dDays === 1 ? 'Amanhã' : fmtDateShort(tk.end_date))));
                        const prioColors = { critica: '#a4161a', alta: 'var(--accent-danger)', media: 'var(--accent-warm)', baixa: 'var(--accent-success)' };
                        const prioLabels = { critica: 'Crítica', alta: 'Urgente', media: 'Normal', baixa: 'Baixa' };
                        return `<tr style="cursor:default;" onmouseover="this.style.background='var(--bg-hover)'" onmouseout="this.style.background='transparent'">
                          <td style="${tdS}font-weight:500;max-width:320px;">
                            <div style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;"><span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${sg.color};margin-right:8px;vertical-align:middle;"></span>${escapeHtml(tk.title)}</div>
                            ${parentTag(tk)}
                          </td>
                          <td style="${tdS}"><span style="display:inline-block;padding:2px 10px;border-radius:4px;background:${projColor};color:#fff;font-size:11px;font-weight:700;text-shadow:0 1px 1px rgba(0,0,0,0.25);">${escapeHtml(proj?.name || '?')}</span></td>
                          <td style="${tdS}font-size:11px;">
                            ${member ? `<span class="avatar-tip" data-tip="${escapeHtml(member.name)}" style="display:inline-flex;align-items:center;gap:4px;"><span style="width:22px;height:22px;border-radius:50%;background:${colorFromString(member.name)};color:#fff;display:inline-flex;align-items:center;justify-content:center;font-size:9px;font-weight:700;">${initials(member.name)}</span></span>` : '<span style="color:var(--ink-mute);">—</span>'}
                          </td>
                          <td style="${tdS}font-family:var(--font-mono);font-size:11px;${isOverdue ? 'color:var(--accent-danger);font-weight:700;' : (!tk.end_date ? 'color:var(--ink-mute);font-style:italic;' : '')}">${dueTxt}</td>
                          ${_atrasoTd(tk.end_date)}
                          ${_atrasoTd(tk.baseline_end)}
                          <td style="${tdS}"><span style="display:inline-flex;align-items:center;gap:4px;font-size:11px;"><span style="color:${prioColors[tk.priority] || 'var(--ink-mute)'};">◆</span> ${prioLabels[tk.priority] || tk.priority}</span></td>
                        </tr>`;
                      }).join('')}
                    </tbody>
                  </table>
                `;
              }).join('')}
            </div>
          </details>
        `;
      })()}
      </div>
    `;
  },

  dashboard() {
    const p = this.current();
    if (!p) return this.emptyProject();

    // Tarefas inativas ficam fora das métricas do projeto (progresso, contagens, alertas)
    const tasks = State.tasks.filter(x => !x.inactive);
    const total = tasks.length;
    const t = today();

    // Contagens por STATUS de tarefa
    const cntAFazer      = tasks.filter(x => x.status === 'a_fazer').length;
    const cntBloqueada   = tasks.filter(x => x.status === 'bloqueada').length;
    const cntAndamento   = tasks.filter(x => x.status === 'em_andamento').length;
    const cntConcluida   = tasks.filter(x => x.status === 'concluido').length;

    // Caminho crítico
    const cpm = CPMCache.get(State.tasks, State.dependencies);
    const criticalCount = cpm.criticalIds.size;
    const criticalTasks = State.tasks.filter(tk => cpm.criticalIds.has(tk.id) && tk.status !== 'concluido').slice(0, 5);

    // Avanço geral = avanço físico (ponderado por duração, só folhas) — mesmo da Curva S
    const overallProgress = Math.round(physicalProgress(State.tasks));

    // Restrições abertas (top 5 por prazo)
    const openRestrictions = [...State.restrictions]
      .filter(r => r.status !== 'resolvida' && r.status !== 'cancelada')
      .sort((a, b) => new Date(a.due_date || '9999') - new Date(b.due_date || '9999'))
      .slice(0, 5);

    // Tarefas que vencem esta semana (próximos 7 dias, inclui atrasadas recentes)
    const weekTasks = [...tasks]
      .filter(tk => tk.status !== 'concluido' && tk.end_date)
      .filter(tk => { const diff = daysBetween(t, tk.end_date); return diff >= -3 && diff <= 7; })
      .sort((a, b) => new Date(a.end_date) - new Date(b.end_date))
      .slice(0, 8);

    // ── Priority counts ────────────────────────────────────────────────────────
    const cntAlta  = tasks.filter(x => x.priority === 'alta').length;
    const cntMedia = tasks.filter(x => x.priority === 'media').length;
    const cntBaixa = tasks.filter(x => x.priority === 'baixa').length;

    // ── Timeline progress ──────────────────────────────────────────────────────
    const totalDays   = p.start_date && p.end_date ? Math.max(1, daysBetween(p.start_date, p.end_date)) : 1;
    const elapsedDays = p.start_date ? Math.max(0, daysBetween(p.start_date, t)) : 0;
    const timelinePct = Math.min(100, Math.round(elapsedDays / totalDays * 100));
    const daysLeft    = p.end_date ? daysBetween(t, p.end_date) : null;

    // ── Discipline progress stats ──────────────────────────────────────────────
    const discStats = State.disciplines
      .map(d => {
        const dt = tasks.filter(tk => tk.discipline_id === d.id);
        const dp = dt.length > 0 ? Math.round(dt.reduce((s, tk) => s + (parseFloat(tk.progress) || 0), 0) / dt.length) : 0;
        return { code: d.code, name: d.name, total: dt.length, progress: dp, done: dt.filter(tk => tk.status === 'concluido').length };
      })
      .filter(d => d.total > 0)
      .sort((a, b) => b.progress - a.progress)
      .slice(0, 6);

    // ── SVG ring + helpers ─────────────────────────────────────────────────────
    const _R = 42, _CIRC = +(2 * Math.PI * _R).toFixed(1);
    const _ringOff   = +(_CIRC * (1 - overallProgress / 100)).toFixed(1);
    const _ringColor = overallProgress >= 80 ? 'var(--accent-success)' : overallProgress >= 40 ? 'var(--accent)' : 'var(--accent-warm)';
    const pct        = n => total > 0 ? Math.round(n / total * 100) : 0;
    const _tlColor   = timelinePct > 85 ? 'var(--accent-danger)' : timelinePct > 60 ? 'var(--accent-warm)' : 'var(--blueprint)';
    const _dLeft     = daysLeft !== null ? (daysLeft < 0 ? `${Math.abs(daysLeft)}d atraso` : `${daysLeft}d restantes`) : '—';
    const _dColor    = daysLeft !== null && daysLeft < 0 ? 'var(--accent-danger)' : daysLeft !== null && daysLeft < 14 ? 'var(--accent-warm)' : 'var(--ink-mute)';

    // ── Alertas inteligentes ───────────────────────────────────────────────────
    const _openTasks      = tasks.filter(tk => tk.status !== 'concluido');
    const _alertBlocked   = tasks.filter(tk => tk.status === 'bloqueada');
    const _alertOverdueR  = State.restrictions.filter(r => r.due_date && r.due_date < t && r.status !== 'resolvida' && r.status !== 'cancelada');
    const _alertNoAssign  = _openTasks.filter(tk => !tk.assignee_id && tk.status === 'em_andamento');
    const _alertStalled   = tasks.filter(tk => tk.status === 'em_andamento' && (parseFloat(tk.progress)||0) === 0);
    const _alertNoDate    = _openTasks.filter(tk => !tk.end_date && tk.status !== 'a_fazer');
    const _alertOverdue   = _openTasks.filter(tk => tk.end_date && tk.end_date < t);
    const _dueToday       = _openTasks.filter(tk => tk.end_date === t);
    const _totalAlerts    = _alertBlocked.length + _alertOverdueR.length + _alertNoAssign.length + _alertStalled.length + _alertNoDate.length + _alertOverdue.length;

    // ── Widget "Hoje" (resgata o valor da antiga tela, em forma compacta) ───────
    const _todayLeaves = _openTasks.filter(tk => !tasks.some(x => x.parent_id === tk.id));
    const _wOverdue    = _todayLeaves.filter(tk => tk.end_date && tk.end_date < t).length;
    const _wDueToday   = _todayLeaves.filter(tk => tk.end_date === t).length;
    const _wProgress   = _todayLeaves.filter(tk => tk.status === 'em_andamento').length;
    const _hojeCell = (n, label, color, onclickJs) => `
      <button onclick="${onclickJs}"
        style="flex:1;min-width:0;display:flex;align-items:center;gap:11px;padding:11px 14px;background:transparent;border:none;border-right:1px solid var(--border);cursor:pointer;text-align:left;transition:background .15s;"
        onmouseover="this.style.background='${color}0c'" onmouseout="this.style.background='transparent'">
        <span style="font-size:24px;font-weight:800;font-variant-numeric:tabular-nums;color:${n>0?color:'var(--ink-mute)'};line-height:1;min-width:30px;">${n}</span>
        <span style="font-size:11px;color:var(--ink-soft);line-height:1.25;">${label}</span>
      </button>`;
    const _goTasks = "State.currentView='tasks';UI.setActiveNav('tasks');";
    const _hojeWidget = `
      <div style="display:flex;align-items:stretch;background:var(--bg-panel);border:1px solid var(--border);border-left:3px solid var(--accent);border-radius:6px;margin-bottom:14px;overflow:hidden;">
        <div style="display:flex;align-items:center;gap:8px;padding:0 16px;border-right:1px solid var(--border);background:var(--bg-deep);">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" stroke-width="2.2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
          <span style="font-family:var(--font-mono);font-size:9px;font-weight:700;color:var(--accent);text-transform:uppercase;letter-spacing:.12em;white-space:nowrap;">Hoje</span>
        </div>
        ${_hojeCell(_wOverdue, 'atrasadas', 'var(--accent-danger)', _goTasks + "State.taskFilters.overdue=true;State.taskFilters.status='all';UI.render();")}
        ${_hojeCell(_wDueToday, 'vencem hoje', 'var(--accent-warm)', _goTasks + "State.taskFilters.overdue=false;State.taskFilters.status='all';UI.render();")}
        ${_hojeCell(_wProgress, 'em andamento', 'var(--accent)', _goTasks + "State.taskFilters.overdue=false;State.taskFilters.status='em_andamento';UI.render();")}
      </div>`;

    const _mkAlertItem = (icon, label, items, color, view, tip) => items.length === 0 ? '' : `
      <div style="display:flex;align-items:flex-start;gap:10px;padding:10px 14px;border-left:3px solid ${color};background:${color}08;border-radius:0 3px 3px 0;cursor:pointer;"
           onclick="State.currentView='${view}';UI.setActiveNav('${view}');State.taskFilters.status='${view === 'tasks' ? tip : 'all'}';UI.render();" title="${items.length} ${label}">
        <span style="font-size:15px;flex-shrink:0;margin-top:1px;">${icon}</span>
        <div style="flex:1;min-width:0;">
          <div style="font-size:12px;font-weight:700;color:var(--ink);">${items.length} ${label}</div>
          <div style="font-size:11px;color:var(--ink-mute);margin-top:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">
            ${items.slice(0,3).map(i => escapeHtml((i.title || i.description || '').slice(0,28))).join(' · ')}${items.length > 3 ? ` + ${items.length-3} mais` : ''}
          </div>
        </div>
        <span style="font-family:var(--font-mono);font-size:10px;font-weight:800;color:${color};flex-shrink:0;margin-top:2px;">${items.length}</span>
      </div>`;

    // Alertas agora são exibidos via botão na topbar (modal)
    const _alertsHtml = '';

    // ── Checklist de onboarding (persiste dispensa no localStorage) ──────────
    const onbKey = `projetudo.onb.${p.id}`;
    const onbDismissed = (() => { try { return localStorage.getItem(onbKey) === '1'; } catch(e) { return true; } })();
    const onbSteps = [
      { ok: true,                             label: 'Projeto criado',              action: null,                view: null },
      { ok: State.members.length > 0,         label: 'Equipe cadastrada',           action: 'new-team-member',   view: 'team' },
      { ok: State.disciplines.length > 0,     label: 'Disciplinas configuradas',    action: 'new-discipline',    view: 'disciplines' },
      { ok: State.tasks.length > 0,           label: 'Primeira tarefa adicionada',  action: 'new-task',          view: 'tasks' },
      { ok: State.restrictions.length > 0,    label: 'Primeira restrição registrada', action: 'new-restriction',   view: 'restrictions' },
    ];
    const onbDone = onbSteps.every(s => s.ok);
    const onbHtml = (!onbDismissed && !onbDone) ? `
      <div id="onbChecklist" style="background:var(--bg-panel);border:1px solid var(--accent);border-radius:3px;padding:14px 18px;margin-bottom:16px;">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;">
          <div style="font-family:var(--font-mono);font-size:10px;color:var(--accent);text-transform:uppercase;letter-spacing:0.15em;">▸ Configuração inicial</div>
          <button onclick="try{localStorage.setItem('${onbKey}','1')}catch(e){}this.closest('#onbChecklist').remove();"
            style="background:none;border:1px solid var(--border);border-radius:3px;cursor:pointer;color:var(--ink-mute);font-size:11px;padding:3px 9px;line-height:1.4;font-family:var(--font-mono);"
            title="Não exibir novamente">✓ Marcar como lido</button>
        </div>
        <div style="display:flex;flex-wrap:wrap;gap:8px;">
          ${onbSteps.map(s => `
            <div style="display:flex;align-items:center;gap:7px;padding:6px 12px;border-radius:20px;border:1px solid ${s.ok ? 'var(--accent-success)' : 'var(--border-strong)'};background:${s.ok ? 'rgba(46,125,79,0.07)' : 'var(--bg-deep)'};font-size:12px;font-weight:600;color:${s.ok ? 'var(--accent-success)' : 'var(--ink-soft)'};${!s.ok && s.view ? 'cursor:pointer;' : ''}" ${!s.ok && s.view ? `onclick="State.currentView='${s.view}';UI.setActiveNav('${s.view}');UI.render();"` : ''} title="${s.ok ? 'Concluído' : 'Clique para ir'}">
              <span style="font-size:14px;">${s.ok ? '✓' : '○'}</span>
              ${escapeHtml(s.label)}
            </div>
          `).join('')}
        </div>
      </div>
    ` : '';

    return `
      ${_alertsHtml}
      ${_hojeWidget}
      ${onbHtml}
      <!-- ── Faixa de KPIs: Progresso | Próximo prazo | Prazo do projeto ───── -->
      ${(() => {
        const _hasDates = !!(p.start_date && p.end_date);
        const _nextTask = [...tasks]
          .filter(tk => tk.status !== 'concluido' && tk.end_date && tk.end_date >= t)
          .sort((a, b) => a.end_date.localeCompare(b.end_date))[0];
        const _nextWho = _nextTask ? State.members.find(m => m.id === _nextTask.assignee_id) : null;
        const _nextIn  = _nextTask ? daysBetween(t, _nextTask.end_date) : null;
        return `<div class="dash-kpis">
          <div class="dash-kpi" style="--kpi-c:${_ringColor};">
            <div class="dash-kpi-label">Progresso</div>
            <div class="dash-kpi-main"><span class="dash-kpi-val">${overallProgress}%</span><span class="dash-kpi-sub">${cntConcluida} de ${total} tarefas</span></div>
            <div class="progress-mini" style="--pct:${overallProgress}%;--bar-c:${_ringColor};"><span></span></div>
          </div>
          <div class="dash-kpi">
            <div class="dash-kpi-label">Próximo prazo</div>
            ${_nextTask ? `
              <div class="dash-kpi-main"><span class="dash-kpi-val is-text" title="${escapeHtml(_nextTask.title)}">${escapeHtml(_nextTask.title)}</span></div>
              <div class="dash-kpi-foot"><span style="color:${_nextIn <= 2 ? 'var(--status-late)' : 'var(--ink-soft)'};font-weight:700;">${_parseYMD(_nextTask.end_date).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' })}${_nextIn === 0 ? ' · hoje' : ` · em ${_nextIn}d`}</span>${_nextWho ? `<span class="avatar-sm" style="width:18px;height:18px;font-size:8px;background:${colorFromString(_nextWho.name)};">${escapeHtml(initials(_nextWho.name))}</span><span>${escapeHtml(_nextWho.name)}</span>` : ''}</div>
            ` : `
              <div class="dash-kpi-main"><span class="dash-kpi-val is-text" style="color:var(--ink-mute);">Nenhum prazo futuro</span></div>
              <div class="dash-kpi-foot">sem tarefas abertas com data</div>
            `}
          </div>
          <div class="dash-kpi" style="--kpi-c:${_hasDates ? _dColor : 'var(--ink-mute)'};">
            <div class="dash-kpi-label">Prazo do projeto</div>
            <div class="dash-kpi-main"><span class="dash-kpi-val ${_hasDates ? '' : 'is-text'}">${_hasDates ? _dLeft : 'Sem datas'}</span>${_hasDates ? `<span class="dash-kpi-sub">${timelinePct}% consumido</span>` : ''}</div>
            ${_hasDates ? `<div class="progress-mini" style="--pct:${timelinePct}%;--bar-c:${_tlColor};"><span></span></div>
            <div class="dash-kpi-foot">${fmtDateFull(p.start_date)} → ${fmtDateFull(p.end_date)}</div>` : `<div class="dash-kpi-foot">defina início e fim do projeto</div>`}
          </div>
        </div>`;
      })()}

      <!-- ── Tiles de contagem por status ───────────────────────────────────── -->
      <div class="stat-tiles">
        <div class="stat-tile ">
          <div class="stat-tile-ico"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><rect x="9" y="2" width="6" height="4" rx="1"/><path d="M7 2H5a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2h-2"/><line x1="9" y1="12" x2="15" y2="12"/><line x1="9" y1="16" x2="13" y2="16"/></svg></div>
          <div class="stat-tile-body">
            <div class="stat-label" style="margin-bottom:2px;">A Fazer</div>
            <div class="stat-tile-val">${cntAFazer}</div>
            <div class="stat-tile-meta">${pct(cntAFazer)}% do total</div>
          </div>
        </div>
        <div class="stat-tile t-block${cntBloqueada > 0 ? ' is-on' : ''}">
          <div class="stat-tile-ico"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg></div>
          <div class="stat-tile-body">
            <div class="stat-label" style="margin-bottom:2px;">Bloqueadas</div>
            <div class="stat-tile-val">${cntBloqueada}</div>
            <div class="stat-tile-meta">${cntBloqueada === 0 ? 'sem impedimentos' : 'requerem atenção'}</div>
          </div>
        </div>
        <div class="stat-tile t-doing${cntAndamento > 0 ? ' is-on' : ''}">
          <div class="stat-tile-ico"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><polygon points="5 3 19 12 5 21 5 3"/></svg></div>
          <div class="stat-tile-body">
            <div class="stat-label" style="margin-bottom:2px;">Em Andamento</div>
            <div class="stat-tile-val">${cntAndamento}</div>
            <div class="stat-tile-meta">${pct(cntAndamento)}% do total</div>
          </div>
        </div>
        <div class="stat-tile t-done${cntConcluida > 0 ? ' is-on' : ''}">
          <div class="stat-tile-ico"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg></div>
          <div class="stat-tile-body">
            <div class="stat-label" style="margin-bottom:2px;">Concluídas</div>
            <div class="stat-tile-val">${cntConcluida}</div>
            <div class="stat-tile-meta">${pct(cntConcluida)}% do total</div>
          </div>
        </div>
        <div class="stat-tile t-warn${criticalCount > 0 ? ' is-on' : ''}">
          <div class="stat-tile-ico"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg></div>
          <div class="stat-tile-body">
            <div class="stat-label" style="margin-bottom:2px;">Críticas</div>
            <div class="stat-tile-val">${criticalCount}</div>
            <div class="stat-tile-meta">${cpm.violations.size > 0 ? `<span style="color:var(--accent-warm);">⚠ ${cpm.violations.size} ${cpm.violations.size === 1 ? 'violação' : 'violações'}</span>` : 'caminho crítico'}</div>
          </div>
        </div>
      </div>

      <!-- ── Middle: Upcoming deadlines | Priority + Disciplines ───────────── -->
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-bottom:14px;">

        <div class="panel">
          <div class="panel-head">
            <div class="panel-title">Próximas Entregas</div>
            <div class="panel-title-mono" style="color:${weekTasks.some(tk => tk.end_date < t) ? 'var(--accent-danger)' : 'var(--ink-mute)'};">${weekTasks.length} tarefa${weekTasks.length !== 1 ? 's' : ''}</div>
          </div>
          <div style="padding:0;">
            ${weekTasks.length === 0 ? `
              <div class="empty-state" style="padding:32px 20px;">
                <div class="empty-state-sub">Nenhuma entrega prevista nos próximos 7 dias.</div>
              </div>
            ` : weekTasks.map(tk => {
              const member = State.members.find(m => m.id === tk.assignee_id);
              const isOvd = tk.end_date && tk.end_date < t;
              const prioColors = { critica: '#a4161a', alta: 'var(--accent-danger)', media: 'var(--accent-warm)', baixa: 'var(--accent-success)' };
              const disc = State.disciplines.find(d => d.id === tk.discipline_id);
              const parent = tk.parent_id ? State.tasks.find(x => x.id === tk.parent_id) : null;
              return `
                <div style="padding:10px 18px;border-bottom:1px solid var(--border);display:flex;align-items:center;gap:10px;cursor:pointer;transition:background 0.1s;"
                     data-action="edit-task" data-id="${tk.id}"
                     onmouseover="this.style.background='var(--bg-hover)'" onmouseout="this.style.background=''">
                  <div style="width:3px;height:32px;border-radius:2px;background:${prioColors[tk.priority]||'var(--ink-mute)'};flex-shrink:0;"></div>
                  <div style="flex:1;min-width:0;">
                    <div style="font-size:12.5px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(tk.title)}</div>
                    <div style="font-size:10px;color:var(--ink-mute);font-family:var(--font-mono);margin-top:1px;">${tk.code}${disc ? ' · ' + disc.code : ''}${parent ? ` · <span title="Atividade pai: ${escapeHtml(parent.title)}">↳ ${escapeHtml(parent.title)}</span>` : ''}</div>
                  </div>
                  ${member ? `<div class="avatar-tip" data-tip="${escapeHtml(member.name)}" style="width:24px;height:24px;border-radius:50%;background:${colorFromString(member.name)};color:#fff;display:flex;align-items:center;justify-content:center;font-size:8.5px;font-weight:700;flex-shrink:0;">${initials(member.name)}</div>` : ''}
                  <div style="font-family:var(--font-mono);font-size:11px;color:${isOvd?'var(--accent-danger)':'var(--ink-soft)'};font-weight:${isOvd?'700':'400'};flex-shrink:0;min-width:58px;text-align:right;">${isOvd ? '⚠ ' : ''}${fmtDateShort(tk.end_date)}</div>
                </div>
              `;
            }).join('')}
          </div>
        </div>

        <div style="display:flex;flex-direction:column;gap:14px;">

          <div class="panel">
            <div class="panel-head"><div class="panel-title">Distribuição por Prioridade</div></div>
            <div class="panel-body">
              ${total === 0 ? `<div style="font-size:12px;color:var(--ink-mute);text-align:center;padding:4px 0;">Sem tarefas ainda.</div>` : `
                <div style="display:flex;flex-direction:column;gap:10px;">
                  ${[
                    { label: 'Alta',  count: cntAlta,  color: 'var(--accent-danger)' },
                    { label: 'Média', count: cntMedia, color: 'var(--accent-warm)' },
                    { label: 'Baixa', count: cntBaixa, color: 'var(--accent-success)' },
                  ].map(({ label, count, color }) => `
                    <div>
                      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;">
                        <span style="font-family:var(--font-mono);font-size:10px;color:var(--ink-mute);">${label}</span>
                        <span style="font-family:var(--font-mono);font-size:10px;font-weight:600;color:var(--ink-soft);">${count} <span style="color:var(--ink-mute);font-weight:400;">(${pct(count)}%)</span></span>
                      </div>
                      <div style="height:6px;background:var(--bg-elevated);border-radius:3px;overflow:hidden;">
                        <div style="width:${pct(count)}%;height:100%;background:${color};border-radius:3px;transition:width 0.4s;"></div>
                      </div>
                    </div>
                  `).join('')}
                </div>
              `}
            </div>
          </div>

          <div class="panel" style="flex:1;">
            <div class="panel-head">
              <div class="panel-title">Avanço por Disciplina</div>
              <div class="panel-title-mono">${discStats.length} ativas</div>
            </div>
            <div class="panel-body">
              ${discStats.length === 0 ? `<div style="font-size:12px;color:var(--ink-mute);text-align:center;padding:4px 0;">Configure disciplinas para ver o avanço.</div>` : `
                <div style="display:flex;flex-direction:column;gap:11px;">
                  ${discStats.map(d => `
                    <div>
                      <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:4px;">
                        <span style="font-size:12px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:72%;">${escapeHtml(d.code)}</span>
                        <span style="font-family:var(--font-mono);font-size:10px;font-weight:700;color:var(--ink-soft);flex-shrink:0;">${d.progress}%</span>
                      </div>
                      <div style="height:5px;background:var(--bg-elevated);border-radius:3px;overflow:hidden;">
                        <div style="width:${d.progress}%;height:100%;background:${d.progress >= 80 ? 'var(--accent-success)' : d.progress >= 40 ? 'var(--accent)' : 'var(--accent-warm)'};border-radius:3px;transition:width 0.4s;"></div>
                      </div>
                      <div style="font-family:var(--font-mono);font-size:9px;color:var(--ink-mute);margin-top:2px;">${d.done}/${d.total} concluídas</div>
                    </div>
                  `).join('')}
                </div>
              `}
            </div>
          </div>

        </div>
      </div>

      <!-- ── Bottom: Restrictions + Critical path ───────────────────────────── -->
      <div class="grid-2">
        <div class="panel">
          <div class="panel-head"><div class="panel-title">Restrições Abertas</div><div class="panel-title-mono">${State.restrictions.filter(r=>r.status!=='resolvida'&&r.status!=='cancelada').length} abertas</div></div>
          <div class="panel-body" style="padding:0">
            ${openRestrictions.length === 0 ? `
              <div class="empty-state" style="padding:32px 20px;">
                <div class="empty-state-sub">${State.restrictions.length === 0 ? 'Nenhuma restrição cadastrada. Registre impedimentos em <strong>Restrições</strong>.' : 'Nenhuma restrição aberta. Projeto sem impedimentos!'}</div>
              </div>
            ` : openRestrictions.map(r => {
              const resp = State.members.find(m => m.id === r.responsible_id);
              const isOverdue = r.due_date && r.due_date < t;
              const typeLabel = RESTRICTION_TYPES[r.type] || r.type;
              const stColor = RESTRICTION_STATUS[r.status]?.color || 'var(--ink-mute)';
              return `
                <div style="padding:12px 20px;border-bottom:1px solid var(--border);display:flex;align-items:flex-start;gap:10px;border-left:3px solid ${isOverdue ? 'var(--accent-danger)' : stColor};cursor:pointer;" data-action="open-restriction" data-id="${r.id}">
                  <div style="flex:1;min-width:0;">
                    <div style="font-size:13px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(r.description)}</div>
                    <div style="font-size:11px;color:var(--ink-soft);font-family:var(--font-mono);margin-top:3px;display:flex;gap:8px;flex-wrap:wrap;">
                      <span style="color:var(--ink-mute);">${typeLabel}</span>
                      ${resp ? `<span>· ${escapeHtml(resp.name.split(' ')[0])}</span>` : ''}
                      ${r.due_date ? `<span style="color:${isOverdue ? 'var(--accent-danger)' : 'var(--ink-soft)'};">· ${isOverdue ? '⚠ ' : ''}${fmtDate(r.due_date)}</span>` : ''}
                    </div>
                  </div>
                  <span style="font-family:var(--font-mono);font-size:9px;font-weight:700;color:${stColor};background:${stColor}22;border:1px solid ${stColor}44;padding:2px 6px;border-radius:2px;flex-shrink:0;white-space:nowrap;">${RESTRICTION_STATUS[r.status]?.label || r.status}</span>
                </div>
              `;
            }).join('')}
          </div>
        </div>

        <div class="panel">
          <div class="panel-head"><div class="panel-title">Caminho Crítico</div><div class="panel-title-mono">${criticalCount} críticas</div></div>
          <div class="panel-body" style="padding:0">
            ${criticalTasks.length === 0
              ? `<div class="empty-state" style="padding:32px 20px;"><div class="empty-state-sub">${criticalCount === 0 ? 'Adicione predecessoras às tarefas para calcular o caminho crítico.' : 'Tarefas críticas já concluídas.'}</div></div>`
              : criticalTasks.map(tk => {
                  const member = State.members.find(m => m.id === tk.assignee_id);
                  const isOverdue = tk.status !== 'concluido' && tk.end_date < t;
                  return `
                    <div style="padding:12px 18px;border-bottom:1px solid var(--border);display:flex;align-items:center;gap:10px;border-left:3px solid var(--accent-danger);">
                      <div style="flex:1;min-width:0;">
                        <div style="font-size:13px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(tk.title)}</div>
                        <div style="font-size:11px;color:var(--ink-soft);font-family:var(--font-mono);margin-top:2px;">
                          ${tk.code} · ${member ? escapeHtml(member.name.split(' ')[0]) : 'sem resp.'} · <span style="color:${isOverdue ? 'var(--accent-danger)' : 'var(--ink-soft)'}">${fmtDate(tk.end_date)}</span>${parentTag(tk, null, 'inline')}
                        </div>
                      </div>
                      <div style="font-family:var(--font-mono);font-size:11px;color:var(--ink-mute);text-align:right;">
                        ${(parseFloat(tk.progress) || 0).toFixed(0)}%
                      </div>
                    </div>
                  `;
                }).join('')
            }
          </div>
        </div>
      </div>

      ${this.renderHealthPanel()}
      ${this.renderSCurve()}
      ${this.renderDelayCausesChart()}
    `;
  },

  // ===== CURVA S — Avanço físico Previsto × Realizado (× Linha de Base) =====
  // ===== PAINEL DE SAÚDE DO PROJETO =====
  renderHealthPanel() {
    if (!State.tasks.length) return '';
    const h = HealthCheck.run();
    const color = HealthCheck.scoreColor(h.score);
    const label = HealthCheck.scoreLabel(h.score);

    // Mostra apenas top 5 issues mais severas; o resto fica em "ver todos"
    const ordered = h.issues.slice().sort((a, b) => {
      const order = { error: 0, warn: 1, info: 2 };
      return order[a.severity] - order[b.severity];
    });
    const top = ordered.slice(0, 5);
    const rest = ordered.length - top.length;

    const icon = (sev) => sev === 'error' ? '🔴' : sev === 'warn' ? '⚠️' : 'ℹ️';

    const issuesHtml = h.issues.length === 0
      ? `<div style="padding:24px;text-align:center;color:var(--ink-mute);">Nenhum problema detectado. 👌</div>`
      : top.map(iss => `
        <div class="hc-issue" style="display:flex;align-items:center;gap:10px;padding:9px 12px;border-bottom:1px solid var(--border);font-size:12px;">
          <span style="flex-shrink:0;font-size:13px;">${icon(iss.severity)}</span>
          <span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(iss.title)}</span>
          ${iss.action ? `<button class="btn btn-secondary" data-hc-action="${iss.id}" style="padding:3px 9px;font-size:10px;flex-shrink:0;">${escapeHtml(iss.action.label)}</button>` : ''}
        </div>
      `).join('') + (rest > 0 ? `<div style="padding:8px 12px;font-size:11px;color:var(--ink-mute);text-align:center;"><button class="btn btn-ghost" data-action="goto-health" style="font-size:11px;">Ver todos (${rest > 0 ? '+' + rest : 0} restantes)</button></div>` : '');

    return `
      <div class="panel" style="margin-top:14px;">
        <div class="panel-head">
          <div class="panel-title">Saúde do Projeto</div>
          <div style="display:flex;align-items:center;gap:8px;">
            <span class="panel-title-mono">${h.summary.errors} erro${h.summary.errors !== 1 ? 's' : ''} · ${h.summary.warnings} aviso${h.summary.warnings !== 1 ? 's' : ''} · ${h.summary.infos} info</span>
          </div>
        </div>
        <div class="panel-body">
          <div style="display:grid;grid-template-columns:200px 1fr;gap:18px;align-items:flex-start;">
            <!-- Score grande -->
            <div style="text-align:center;padding:8px;">
              <div style="position:relative;display:inline-block;">
                <svg viewBox="0 0 120 120" width="160" height="160" style="display:block;">
                  <circle cx="60" cy="60" r="50" fill="none" stroke="var(--bg-deep)" stroke-width="10"/>
                  <circle cx="60" cy="60" r="50" fill="none" stroke="${color}" stroke-width="10"
                    stroke-dasharray="${(h.score / 100 * 314).toFixed(1)} 314"
                    stroke-linecap="round" transform="rotate(-90 60 60)"/>
                  <text x="60" y="64" text-anchor="middle" font-size="32" font-weight="800" fill="${color}" font-family="var(--font-display)">${h.score}</text>
                  <text x="60" y="82" text-anchor="middle" font-size="9" fill="var(--ink-mute)" font-family="var(--font-mono)" style="text-transform:uppercase;letter-spacing:.12em;">/100</text>
                </svg>
              </div>
              <div style="font-family:var(--font-mono);font-size:11px;color:${color};font-weight:700;text-transform:uppercase;letter-spacing:.1em;margin-top:6px;">${label}</div>
            </div>
            <!-- Lista de issues -->
            <div style="min-width:0;">
              <div style="font-family:var(--font-mono);font-size:9px;color:var(--ink-mute);text-transform:uppercase;letter-spacing:.12em;margin-bottom:6px;">${h.issues.length === 0 ? 'Tudo certo' : 'Problemas detectados'}</div>
              <div style="border:1px solid var(--border);border-radius:3px;overflow:hidden;">${issuesHtml}</div>
            </div>
          </div>
        </div>
      </div>`;
  },

  renderSCurve() {
    const t = today();
    const mode = State.sCurveMode || 'line'; // 'line' | 'bars' | 'mixed'
    const leaves = State.tasks.filter(tk => !tk.inactive && !State.tasks.some(x => x.parent_id === tk.id) && tk.start_date && tk.end_date);

    // hasBaseline e basis precisam existir antes do panelHead (o toggle os usa)
    const hasBaseline = leaves.some(x => x.baseline_start && x.baseline_end);
    const basis    = (State.sCurveBasis === 'baseline' && hasBaseline) ? 'baseline' : 'planned';
    const refLabel = basis === 'baseline' ? 'Linha de base' : 'Previsto';

    // Toggle Linha / Barras / Misto
    const tBtn = (v, lbl) => `<button onclick="State.sCurveMode='${v}';UI.render();"
      style="padding:4px 12px;font-size:11px;font-family:var(--font-mono);border:none;cursor:pointer;${mode===v ? 'background:var(--accent);color:var(--bg-deep);font-weight:700;' : 'background:transparent;color:var(--ink-soft);'}">${lbl}</button>`;
    const toggle = `<div style="display:inline-flex;border:1px solid var(--border-strong);border-radius:3px;overflow:hidden;">${tBtn('line','〜 Linha')}${tBtn('bars','▬ Barras')}${tBtn('mixed','▬〜 Misto')}</div>`;
    const fcChk = `<label style="display:inline-flex;align-items:center;gap:6px;font-size:11px;color:var(--ink-soft);cursor:pointer;user-select:none;white-space:nowrap;" title="Mostra a mesma previsão de término do Gantt (quando a última tarefa termina) projetada sobre o avanço.">
      <input type="checkbox" ${State.sCurveForecast ? 'checked' : ''} onclick="State.sCurveForecast=this.checked;UI.render();" style="accent-color:var(--accent);width:14px;height:14px;cursor:pointer;">
      Mostrar previsão de término
    </label>`;
    // Toggle de referência: Previsto × Linha de base (só aparece quando há baseline)
    const _bBtnSC = (id, lbl) => `<button onclick="State.sCurveBasis='${id}';UI.render();" style="font-family:var(--font-mono);font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.04em;padding:3px 9px;border:none;cursor:pointer;background:${basis===id?'var(--accent)':'transparent'};color:${basis===id?'var(--bg-deep)':'var(--ink-soft)'};">${lbl}</button>`;
    const basisToggle = hasBaseline
      ? `<div style="display:flex;align-items:center;gap:6px;"><span style="font-family:var(--font-mono);font-size:9px;color:var(--ink-mute);text-transform:uppercase;letter-spacing:.1em;">Comparar com:</span><div style="display:inline-flex;border:1px solid var(--border-strong);border-radius:3px;overflow:hidden;">${_bBtnSC('planned','Previsto')}${_bBtnSC('baseline','Linha de base')}</div></div>`
      : '';
    const panelHead = `<div class="panel-head"><div class="panel-title">Curva S — Avanço Físico</div><div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap;">${fcChk}${basisToggle}${toggle}</div></div>`;

    if (leaves.length === 0) {
      return `<div class="panel" style="margin-top:14px;">${panelHead}<div class="panel-body"><div class="empty-state" style="padding:28px 20px;"><div class="empty-state-sub">Cadastre tarefas com datas para gerar a Curva S.</div></div></div></div>`;
    }

    // Domínio do gráfico: cobre pelo menos as datas OFICIAIS do projeto (cadastro),
    // mesmo que as tarefas hoje não cheguem até lá — senão a curva parece "cortada"
    // sempre que o planejamento detalhado ainda não alcança o fim declarado do projeto.
    let minD = leaves.map(x => x.start_date).reduce((a, b) => a < b ? a : b);
    let maxD = leaves.map(x => x.end_date).reduce((a, b) => a > b ? a : b);
    const _curProj = (State.projects || []).find(p => p.id === State.currentProjectId);
    if (_curProj?.start_date && _curProj.start_date < minD) minD = _curProj.start_date;
    if (_curProj?.end_date && _curProj.end_date > maxD) maxD = _curProj.end_date;
    const W = leaves.map(x => Math.max(1, daysBetween(x.start_date, x.end_date)));
    const totalW = W.reduce((a, b) => a + b, 0);
    const clampFrac = (d, s, e) => { const span = daysBetween(s, e); if (span <= 0) return d >= e ? 1 : 0; return Math.max(0, Math.min(1, daysBetween(s, d) / span)); };
    const plannedAt  = (d) => leaves.reduce((a, x, i) => a + W[i] * clampFrac(d, x.start_date, x.end_date), 0) / totalW * 100;
    const baselineAt = (d) => leaves.reduce((a, x, i) => a + W[i] * clampFrac(d, x.baseline_start || x.start_date, x.baseline_end || x.end_date), 0) / totalW * 100;
    // refAt = curva de referência escolhida (Previsto ou Linha de base)
    const refAt  = basis === 'baseline' ? baselineAt : plannedAt;
    const refTip = basis === 'baseline'
      ? 'Porcentagem esperada até hoje pela LINHA DE BASE (datas baseline de cada tarefa). Tarefas sem baseline usam as datas atuais.'
      : 'Porcentagem do trabalho que deveria estar concluída até hoje, segundo as datas planejadas atuais.';
    const _actualRaw = (d) => leaves.reduce((a, x, i) => {
      const p = Math.max(0, Math.min(100, parseFloat(x.progress) || 0)) / 100;
      const span = daysBetween(x.start_date, t);
      // Tarefa que começa hoje ou no futuro: o progresso já registrado conta integralmente
      // a partir de hoje (não some), pra o Realizado (hoje) bater com o avanço do cronograma.
      const f = span <= 0 ? (d >= Math.min(x.start_date, t) ? 1 : 0) : Math.max(0, Math.min(1, daysBetween(x.start_date, d) / span));
      return a + W[i] * p * f;
    }, 0) / totalW * 100;
    // O Realizado (hoje) tem que bater com o AVANÇO DO PROJETO (andamento da tarefa-pai
    // raiz). A curva mantém o FORMATO (acúmulo ao longo do tempo, ponderado por duração),
    // mas é escalada para terminar exatamente nesse valor no marco de hoje.
    const _ppTarget = physicalProgress(State.tasks);
    const _anchorD  = t < minD ? minD : (t > maxD ? maxD : t);
    const _rawNow   = _actualRaw(_anchorD);
    const _rScale   = _rawNow > 0.05 ? _ppTarget / _rawNow : 1;
    const actualAt  = (d) => _actualRaw(d) * _rScale;

    // ── Previsão de término (projeção do Realizado pelo ritmo RECENTE) ──────────
    const _inRange0 = t >= minD && t <= maxD;
    const scAnchor  = _inRange0 ? t : maxD;          // âncora da projeção (hoje)
    const _realNow  = actualAt(scAnchor);
    let scForecastEnd = null;
    if (State.sCurveForecast && _realNow < 100) {
      // MESMA previsão do Gantt (coluna "Prev. Térm."): a obra termina quando a
      // ÚLTIMA tarefa termina. Para cada folha ativa, usa forecastEndDate (ritmo
      // da própria tarefa) ou o término planejado/real quando ela não tem previsão.
      let maxEnd = null;
      leaves.forEach(lf => {
        const eff = forecastEndDate(lf) || lf.end_date;
        if (eff && (!maxEnd || eff > maxEnd)) maxEnd = eff;
      });
      if (maxEnd && maxEnd > scAnchor) scForecastEnd = maxEnd;
    }
    const _drawForecast = State.sCurveForecast && mode !== 'bars' && !!scForecastEnd && scForecastEnd > scAnchor;
    // Checkbox ligado, projeto em andamento, mas sem dados confiáveis para projetar
    const scFcInsufficient = State.sCurveForecast && mode !== 'bars' && _realNow > 0 && _realNow < 100 && !scForecastEnd;
    const _extend = _drawForecast && scForecastEnd > maxD;
    const domainMax = _extend ? scForecastEnd : maxD;
    const totalDays = Math.max(1, daysBetween(minD, domainMax));

    // ── Gera pontos mensais (1º de cada mês) + maxD ──────────────────────────
    const mNames = ['jan','fev','mar','abr','mai','jun','jul','ago','set','out','nov','dez'];
    const monthPts = [];
    { let [y, m] = minD.slice(0, 7).split('-').map(Number);
      const [ey, em] = domainMax.slice(0, 7).split('-').map(Number);
      while (y < ey || (y === ey && m <= em)) {
        const d = `${y}-${String(m).padStart(2,'0')}-01`;
        if (d >= minD) monthPts.push({ d, label: `${mNames[m-1]}/${String(y).slice(2)}` });
        m++; if (m > 12) { m = 1; y++; }
      }
    }
    if (!monthPts.some(p => p.d === maxD)) monthPts.push({ d: maxD, label: `${fmtDateShort(maxD)}` });
    // Avalia nas datas mensais (para linha), mais hoje
    const todayInRange = t >= minD && t <= maxD;
    const lineDates = [...new Set([...monthPts.map(p => p.d), ...(todayInRange ? [t] : []), maxD])].sort();

    // dimensões SVG
    const VW = 1000, VH = 360, mL = 46, mR = 14, mT = 32, mB = 58;
    const pw = VW - mL - mR, ph = VH - mT - mB;
    const X  = (d) => mL + (daysBetween(minD, d) / totalDays) * pw;
    const Y  = (v) => mT + (1 - Math.max(0, Math.min(100, v)) / 100) * ph;
    const Yb = (v) => mT + ph - Math.max(0, Math.min(100, v)) / 100 * ph; // Y bottom-up para barras

    // ── SVG da projeção de término — curva MÊS A MÊS do realizado até 100% ──────
    let forecastSvg = '';
    if (_drawForecast && scForecastEnd) {
      const _projSpan = Math.max(1, daysBetween(scAnchor, scForecastEnd));
      const projAt = (d) => Math.min(100, _realNow + (100 - _realNow) * (daysBetween(scAnchor, d) / _projSpan));
      // Pontos: hoje + 1º de cada mês entre hoje e a previsão + a própria data prevista
      const fcDates = [...new Set([
        scAnchor,
        ...monthPts.map(p => p.d).filter(d => d > scAnchor && d < scForecastEnd),
        scForecastEnd,
      ])].sort();
      const fcPts = fcDates.map(d => `${X(d).toFixed(1)},${Y(projAt(d)).toFixed(1)}`).join(' ');
      const fcMarkers = fcDates.map((d, i) => {
        if (i === 0) return ''; // o ponto de hoje já é o fim da curva Realizado
        const v = projAt(d), xp = X(d), yp = Y(v);
        const isEnd = d === scForecastEnd;
        const dot = `<circle cx="${xp.toFixed(1)}" cy="${yp.toFixed(1)}" r="${isEnd ? 4 : 3}" fill="var(--bg-panel)" stroke="var(--accent)" stroke-width="${isEnd ? 2 : 1.5}"/>`;
        const lbl = `<text x="${xp.toFixed(1)}" y="${(yp + 14).toFixed(1)}" text-anchor="middle" font-size="9" font-family="var(--font-mono)" fill="var(--accent)" opacity="0.9" font-weight="700">${v.toFixed(0)}%</text>`;
        return dot + lbl;
      }).join('');
      const fxEnd = X(scForecastEnd);
      forecastSvg = `
        <polyline points="${fcPts}" fill="none" stroke="var(--accent)" stroke-width="2" stroke-dasharray="6 4" opacity="0.85"/>
        <line x1="${fxEnd.toFixed(1)}" y1="${mT}" x2="${fxEnd.toFixed(1)}" y2="${(mT+ph).toFixed(1)}" stroke="var(--accent)" stroke-width="1" stroke-dasharray="2 3" opacity="0.5"/>
        ${fcMarkers}
        <text x="${fxEnd.toFixed(1)}" y="${(mT-4).toFixed(1)}" text-anchor="end" font-size="9.5" font-family="var(--font-mono)" fill="var(--accent)" font-weight="700">▸ ${fmtDateShort(scForecastEnd)}</text>`;
    }

    // ── Eixo Y ────────────────────────────────────────────────────────────────
    const yGrid = [0, 25, 50, 75, 100].map(v =>
      `<line x1="${mL}" y1="${Y(v).toFixed(1)}" x2="${VW-mR}" y2="${Y(v).toFixed(1)}" stroke="var(--border)" stroke-width="1"/>
       <text x="${mL-5}" y="${(Y(v)+3.5).toFixed(1)}" text-anchor="end" font-size="10" font-family="var(--font-mono)" fill="var(--ink-mute)">${v}%</text>`).join('');

    // ── Eixo X mensal — gridlines + rótulos ────────────────────────────────
    const nM = monthPts.length;
    // Mostra TODOS os rótulos do eixo X — ajusta a fonte e o ângulo conforme o número de meses
    // para que caibam sem colidir.
    const xFontSize = nM <= 12 ? 11 : nM <= 24 ? 10 : nM <= 36 ? 9 : 8;
    const xRotate   = nM <= 8  ? 0  : nM <= 14 ? -30 : nM <= 24 ? -45 : -55;
    const xAxis = monthPts.map((p, i) => {
      const xp = X(p.d).toFixed(1);
      const grid = `<line x1="${xp}" y1="${mT}" x2="${xp}" y2="${mT+ph}" stroke="var(--border)" stroke-width="0.6" opacity="0.7"/>`;
      const yLbl = VH - 22;
      const transform = xRotate !== 0 ? `transform="rotate(${xRotate},${xp},${yLbl})"` : '';
      const lbl  = `<text x="${xp}" y="${yLbl}" text-anchor="${xRotate < 0 ? 'end' : 'middle'}" font-size="${xFontSize}" font-family="var(--font-mono)" fill="var(--ink-soft)" font-weight="500" ${transform}>${p.label}</text>`;
      return grid + lbl;
    }).join('');

    // ── Linha "hoje" ──────────────────────────────────────────────────────────
    const todayLine = todayInRange ? (() => {
      const tx = X(t).toFixed(1);
      const ty0 = mT, ty1 = mT + ph;
      const pillW = 28, pillH = 14, pillX = (parseFloat(tx) - pillW/2).toFixed(1);
      return `<line x1="${tx}" y1="${ty0}" x2="${tx}" y2="${ty1}" stroke="var(--accent-danger)" stroke-width="1" stroke-dasharray="4 3" opacity="0.5"/>
        <rect x="${pillX}" y="${(ty1+4).toFixed(1)}" width="${pillW}" height="${pillH}" rx="3" fill="var(--accent-danger)" opacity="0.85"/>
        <text x="${tx}" y="${(ty1+13.5).toFixed(1)}" text-anchor="middle" font-size="8.5" font-family="var(--font-mono)" fill="white" font-weight="700" letter-spacing=".04em">HOJE</text>
        <text x="${tx}" y="${(ty0-6).toFixed(1)}" text-anchor="middle" font-size="8" font-family="var(--font-mono)" fill="var(--accent-danger)" opacity="0.7">▼</text>`;
    })() : '';

    // ── KPIs ──────────────────────────────────────────────────────────────────
    const prevHoje  = refAt(todayInRange ? t : maxD);
    const realHoje  = actualAt(todayInRange ? t : maxD);
    const desvio    = realHoje - prevHoje;
    const devColor  = desvio >= -0.5 ? 'var(--accent-success)' : (desvio >= -10 ? 'var(--accent-warm)' : 'var(--accent-danger)');
    const kpi = (lbl, val, color, tip) => `<div style="flex:1;min-width:90px;${tip ? 'cursor:help;' : ''}" ${tip ? `title="${escapeHtml(tip)}"` : ''}><div style="font-family:var(--font-mono);font-size:9px;text-transform:uppercase;letter-spacing:.08em;color:var(--ink-mute);display:flex;align-items:center;gap:4px;">${lbl}${tip ? '<span style="color:var(--ink-mute);font-size:10px;">ⓘ</span>' : ''}</div><div style="font-size:20px;font-weight:800;color:${color};line-height:1.1;">${val}</div></div>`;
    const leg = (color, label, dashed) => `<span style="display:inline-flex;align-items:center;gap:5px;font-size:11px;color:var(--ink-soft);"><span style="width:16px;height:0;border-top:3px ${dashed ? 'dashed' : 'solid'} ${color};display:inline-block;"></span>${label}</span>`;
    const legRect = (color, label) => `<span style="display:inline-flex;align-items:center;gap:5px;font-size:11px;color:var(--ink-soft);"><span style="width:14px;height:10px;background:${color};display:inline-block;border-radius:2px;opacity:.8;"></span>${label}</span>`;

    // ── Conteúdo SVG conforme modo ─────────────────────────────────────────
    let svgContent = '';
    let legend = '';

    if (mode === 'line') {
      // Linha acumulada S-curve — referência (Previsto ou LB) + Realizado
      const ptsToArr = (fn, cap) => lineDates.filter(d => d <= cap).map(d => `${X(d).toFixed(1)},${Y(fn(d)).toFixed(1)}`);
      const refArrPts    = ptsToArr(refAt, maxD);
      const realArrPts   = ptsToArr(actualAt, t);
      const refPts       = refArrPts.join(' ');
      const realizadoPts = realArrPts.join(' ');

      // Áreas preenchidas com gradiente sob as curvas
      const bot = (mT + ph).toFixed(1);
      const refFill = refArrPts.length >= 2
        ? [...refArrPts, `${X(maxD).toFixed(1)},${bot}`, `${mL},${bot}`].join(' ') : '';
      const realLastD = t <= maxD ? t : maxD;
      const realFill = realArrPts.length >= 2
        ? [...realArrPts, `${X(realLastD).toFixed(1)},${bot}`, `${mL},${bot}`].join(' ') : '';
      const gradDefs = `<defs>
        <linearGradient id="scGradP" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="var(--blueprint)" stop-opacity="0.16"/>
          <stop offset="100%" stop-color="var(--blueprint)" stop-opacity="0.01"/>
        </linearGradient>
        <linearGradient id="scGradR" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="var(--accent)" stop-opacity="0.20"/>
          <stop offset="100%" stop-color="var(--accent)" stop-opacity="0.01"/>
        </linearGradient>
      </defs>`;

      // Marcadores e rótulos mensais sobre as curvas — TODOS os meses
      const nM2 = monthPts.length;
      const lblSize  = nM2 <= 14 ? 11 : nM2 <= 24 ? 10 : nM2 <= 36 ? 9 : 8;
      const fmtP = v => v >= 10 ? v.toFixed(0) + '%' : v >= 1 ? v.toFixed(1) + '%' : v > 0 ? v.toFixed(1) + '%' : '0%';
      const monthMarkers = monthPts.map((p, i) => {
        const xp = X(p.d);
        let dotP = '', lblP = '', vPval = null;
        if (p.d <= maxD) {
          const vP = refAt(p.d), yp = Y(vP);
          vPval = vP;
          dotP = `<circle cx="${xp.toFixed(1)}" cy="${yp.toFixed(1)}" r="3.5" fill="var(--blueprint)" stroke="var(--bg-panel)" stroke-width="1.5"/>`;
          lblP = vP > 0
            ? `<text x="${xp.toFixed(1)}" y="${(yp - 10).toFixed(1)}" text-anchor="middle" font-size="${lblSize}" font-family="var(--font-mono)" fill="var(--blueprint)" font-weight="700">${fmtP(vP)}</text>`
            : '';
        }
        let dotR = '', lblR = '';
        if (p.d <= t) {
          const vR = actualAt(p.d), yr = Y(vR);
          dotR = `<circle cx="${xp.toFixed(1)}" cy="${yr.toFixed(1)}" r="3.5" fill="var(--accent)" stroke="var(--bg-panel)" stroke-width="1.5"/>`;
          // Suprime rótulo do Realizado se estiver muito próximo da referência (evita sobreposição)
          const tooClose = vPval !== null && Math.abs(vR - vPval) < 2;
          lblR = vR > 0 && !tooClose
            ? `<text x="${xp.toFixed(1)}" y="${(yr + 14).toFixed(1)}" text-anchor="middle" font-size="${lblSize}" font-family="var(--font-mono)" fill="var(--accent)" font-weight="700">${fmtP(vR)}</text>`
            : '';
        }
        return dotP + lblP + dotR + lblR;
      }).join('');

      svgContent = `
        ${gradDefs}
        ${refFill   ? `<polygon points="${refFill}"   fill="url(#scGradP)"/>` : ''}
        ${realFill  ? `<polygon points="${realFill}"  fill="url(#scGradR)"/>` : ''}
        <polyline points="${refPts}"       fill="none" stroke="var(--blueprint)" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>
        <polyline points="${realizadoPts}" fill="none" stroke="var(--accent)"    stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>
        ${forecastSvg}
        ${monthMarkers}`;
      legend = `${leg('var(--blueprint)', refLabel)} ${leg('var(--accent)', 'Realizado')} ${_drawForecast ? leg('var(--accent)', 'Projeção', true) : ''}`;
    } else if (mode === 'bars') {
      // Barras mensais — delta por mês (incremento de avanço esperado/realizado)
      const barSlots = monthPts.length - 1 > 0 ? monthPts.length - 1 : monthPts.length;
      const slotW = pw / Math.max(barSlots, 1);
      const barW  = Math.max(4, Math.min(slotW * 0.38, 30));
      const gap   = Math.max(1, barW * 0.18);
      // Mostra rótulo se a barra for larga o suficiente (≥14px) ou sempre acima dela
      const showLbl = barW >= 8;
      const bars  = monthPts.map((p, i) => {
        if (i === 0) return '';
        const prev  = monthPts[i - 1].d;
        const curr  = p.d;
        const prevD = refAt(curr) - refAt(prev);
        const realD = curr <= t ? Math.max(0, actualAt(curr) - actualAt(prev)) : null;
        const xCenter = ((X(prev) + X(curr)) / 2);
        const hP = (prevD / 100) * ph;
        const hR = realD !== null ? (realD / 100) * ph : 0;
        const xP = xCenter - gap/2 - barW;
        const xR = xCenter + gap/2;
        const yPtop = mT + ph - hP;
        const yRtop = mT + ph - hR;

        const bP = `<rect x="${xP.toFixed(1)}" y="${yPtop.toFixed(1)}" width="${barW.toFixed(1)}" height="${Math.max(1, hP).toFixed(1)}" rx="2" fill="var(--blueprint)" opacity="0.75"/>`;
        const bR = realD !== null ? `<rect x="${xR.toFixed(1)}" y="${yRtop.toFixed(1)}" width="${barW.toFixed(1)}" height="${Math.max(0.5, hR).toFixed(1)}" rx="2" fill="var(--accent)" opacity="0.85"/>` : '';

        // Rótulos de percentual acima das barras
        const fmtPct = v => v >= 1 ? v.toFixed(0) + '%' : v > 0 ? v.toFixed(1) + '%' : '';
        const lblOffset = 10; // px acima da barra
        const lP = prevD > 0 ? `<text x="${(xP + barW/2).toFixed(1)}" y="${(yPtop - lblOffset + 3).toFixed(1)}" text-anchor="middle" font-size="8.5" font-family="var(--font-mono)" fill="var(--blueprint)" opacity="0.9" font-weight="700">${fmtPct(prevD)}</text>` : '';
        const lR = realD !== null && realD > 0 ? `<text x="${(xR + barW/2).toFixed(1)}" y="${(yRtop - lblOffset + 3).toFixed(1)}" text-anchor="middle" font-size="8.5" font-family="var(--font-mono)" fill="var(--accent)" opacity="0.95" font-weight="700">${fmtPct(realD)}</text>` : '';

        return bP + bR + lP + lR;
      }).join('');
      svgContent = bars;
      legend = `${legRect('var(--blueprint)', refLabel + ' (mês)')} ${legRect('var(--accent)', 'Realizado (mês)')}`;

    } else {
      // ── MODO MISTO (mode === 'mixed'): barras + curva acumulada sobreposta ──
      // Barras (mesma lógica do modo bars, mas mais estreitas para dar espaço à linha)
      const barSlots2 = monthPts.length - 1 > 0 ? monthPts.length - 1 : monthPts.length;
      const slotW2    = pw / Math.max(barSlots2, 1);
      const barW2     = Math.max(4, Math.min(slotW2 * 0.3, 24));
      const gap2      = Math.max(1, barW2 * 0.18);
      const fmtPct2   = v => v >= 1 ? v.toFixed(0) + '%' : v > 0 ? v.toFixed(1) + '%' : '';

      const mixBars = monthPts.map((p, i) => {
        if (i === 0) return '';
        const prev  = monthPts[i - 1].d;
        const curr  = p.d;
        const prevD = refAt(curr) - refAt(prev);
        const realD = curr <= t ? Math.max(0, actualAt(curr) - actualAt(prev)) : null;
        const xCenter = (X(prev) + X(curr)) / 2;
        const hP = (prevD / 100) * ph, hR = realD !== null ? (realD / 100) * ph : 0;
        const xP = xCenter - gap2/2 - barW2, xR = xCenter + gap2/2;
        const yPtop = mT + ph - hP, yRtop = mT + ph - hR;
        const bP  = `<rect x="${xP.toFixed(1)}" y="${yPtop.toFixed(1)}" width="${barW2.toFixed(1)}" height="${Math.max(1,hP).toFixed(1)}" rx="2" fill="var(--blueprint)" opacity="0.45"/>`;
        const bR  = realD !== null ? `<rect x="${xR.toFixed(1)}" y="${yRtop.toFixed(1)}" width="${barW2.toFixed(1)}" height="${Math.max(0.5,hR).toFixed(1)}" rx="2" fill="var(--accent)" opacity="0.5"/>` : '';
        const lP  = prevD > 0 ? `<text x="${(xP+barW2/2).toFixed(1)}" y="${(yPtop-7).toFixed(1)}" text-anchor="middle" font-size="7.5" font-family="var(--font-mono)" fill="var(--blueprint)" opacity="0.75" font-weight="700">${fmtPct2(prevD)}</text>` : '';
        const lR  = realD !== null && realD > 0 ? `<text x="${(xR+barW2/2).toFixed(1)}" y="${(yRtop-7).toFixed(1)}" text-anchor="middle" font-size="7.5" font-family="var(--font-mono)" fill="var(--accent)" opacity="0.85" font-weight="700">${fmtPct2(realD)}</text>` : '';
        return bP + bR + lP + lR;
      }).join('');

      // Linha acumulada sobreposta — referência (Previsto ou LB) + Realizado
      const ptsTo2 = (fn, cap) => lineDates.filter(d => d <= cap).map(d => `${X(d).toFixed(1)},${Y(fn(d)).toFixed(1)}`).join(' ');
      const refPts2       = ptsTo2(refAt, maxD);
      const realizadoPts2 = ptsTo2(actualAt, t);
      const nM3 = monthPts.length;
      const lblEvery3 = nM3 <= 12 ? 2 : nM3 <= 24 ? 3 : 4;
      const fmtP3 = v => v >= 10 ? v.toFixed(0) + '%' : v >= 1 ? v.toFixed(1) + '%' : v > 0 ? v.toFixed(1) + '%' : '';
      const mixMarkers = monthPts.map((p, i) => {
        const xp = X(p.d);
        const showLbl3 = (i % lblEvery3 === 0) || i === nM3 - 1;
        let dotP = '', lblP = '';
        if (p.d <= maxD) {
          const vP = refAt(p.d), yp = Y(vP);
          dotP = `<circle cx="${xp.toFixed(1)}" cy="${yp.toFixed(1)}" r="3.5" fill="var(--blueprint)" stroke="var(--bg-panel)" stroke-width="1.2"/>`;
          lblP = showLbl3 && vP > 0 ? `<text x="${xp.toFixed(1)}" y="${(yp - 9).toFixed(1)}" text-anchor="middle" font-size="8.5" font-family="var(--font-mono)" fill="var(--blueprint)" font-weight="700">${fmtP3(vP)}</text>` : '';
        }
        let dotR = '', lblR = '';
        if (p.d <= t) {
          const vR = actualAt(p.d), yr = Y(vR);
          dotR = `<circle cx="${xp.toFixed(1)}" cy="${yr.toFixed(1)}" r="3.5" fill="var(--accent)" stroke="var(--bg-panel)" stroke-width="1.2"/>`;
          lblR = showLbl3 && vR > 0 ? `<text x="${xp.toFixed(1)}" y="${(yr + 13).toFixed(1)}" text-anchor="middle" font-size="8.5" font-family="var(--font-mono)" fill="var(--accent)" font-weight="700">${fmtP3(vR)}</text>` : '';
        }
        return dotP + lblP + dotR + lblR;
      }).join('');

      svgContent = `
        ${mixBars}
        <polyline points="${refPts2}"       fill="none" stroke="var(--blueprint)" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>
        <polyline points="${realizadoPts2}" fill="none" stroke="var(--accent)"    stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>
        ${forecastSvg}
        ${mixMarkers}`;
      legend = `${legRect('var(--blueprint)', refLabel + ' (mês)')} ${legRect('var(--accent)', 'Realizado (mês)')} ${leg('var(--blueprint)', 'Acum. ' + refLabel.toLowerCase())} ${leg('var(--accent)', 'Acum. realizado')} ${_drawForecast ? leg('var(--accent)', 'Projeção', true) : ''}`;
    }

    return `
      <div class="panel" style="margin-top:14px;">
        ${panelHead}
        <div class="panel-body">
          <div style="display:flex;gap:16px;flex-wrap:wrap;align-items:flex-end;margin-bottom:12px;">
            ${kpi(refLabel + ' (hoje)', prevHoje.toFixed(1) + '%', 'var(--blueprint)', refTip)}
            ${kpi('Realizado (hoje)', realHoje.toFixed(1) + '%', 'var(--accent)', 'Avanço do projeto = andamento da tarefa-pai raiz (ou média das tarefas de menor nível quando não há hierarquia). É o mesmo valor exibido no cronograma.')}
            ${kpi('Desvio', (desvio >= 0 ? '+' : '') + desvio.toFixed(1) + '%', devColor, 'Diferença entre Realizado e ' + refLabel + '. Negativo = projeto atrasado em relação à referência. Verde se ≥ -0,5%, laranja entre -10% e -0,5%, vermelho se < -10%.')}
            ${scForecastEnd ? kpi('Previsão de término', fmtDateShort(scForecastEnd) + (scForecastEnd > maxD ? ` (+${daysBetween(maxD, scForecastEnd)}d)` : ''), 'var(--accent)', 'Mesma previsão do Gantt (coluna "Prev. Térm."): a data em que a última tarefa deve terminar, pelo ritmo de avanço de cada tarefa. Término planejado: ' + fmtDateShort(maxD) + '.') : ''}
            <div style="display:flex;gap:14px;flex-wrap:wrap;margin-left:auto;align-items:center;">${legend}</div>
          </div>
          ${scFcInsufficient ? `
          <div style="display:flex;align-items:flex-start;gap:11px;padding:12px 15px;margin-bottom:12px;background:rgba(212,168,44,0.10);border:1px solid rgba(212,168,44,0.35);border-left:3px solid var(--accent-warm);border-radius:4px;">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:19px;height:19px;flex-shrink:0;color:var(--accent-warm);margin-top:1px;"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="4"/><line x1="4.93" y1="4.93" x2="9.17" y2="9.17"/><line x1="14.83" y1="14.83" x2="19.07" y2="19.07"/><line x1="14.83" y1="9.17" x2="19.07" y2="4.93"/><line x1="9.17" y1="14.83" x2="4.93" y2="19.07"/></svg>
            <div style="font-size:12px;color:var(--ink-soft);line-height:1.45;">
              <strong style="color:var(--ink);">Projeto ainda recuperável.</strong>
              Não há tarefas ativas com datas suficientes para projetar um novo término. Registre/atualize as datas e o progresso das tarefas; a previsão (a mesma do Gantt) aparece automaticamente. Término planejado: <strong>${fmtDateShort(maxD)}</strong>.
            </div>
          </div>` : ''}
          <svg viewBox="0 0 ${VW} ${VH}" width="100%" preserveAspectRatio="xMidYMid meet" style="display:block;overflow:visible;">
            ${yGrid}
            ${xAxis}
            ${todayLine}
            ${svgContent}
          </svg>
        </div>
      </div>`;
  },

  // ===== ANÁLISE DE CAUSAS DE ATRASO (tarefas com delay_cause registrado) =====
  renderDelayCausesChart() {
    const t = today();
    const tasksWithCause = State.tasks.filter(tk => tk.delay_cause);
    if (tasksWithCause.length === 0) return '';

    // Agrupa por causa
    const counts = {};
    const lateTotals = {}; // soma de dias de atraso por causa
    tasksWithCause.forEach(tk => {
      const k = tk.delay_cause;
      counts[k] = (counts[k] || 0) + 1;
      const lateDays = tk.status === 'concluido' ? 0 : Math.max(0, daysBetween(tk.end_date, t));
      lateTotals[k] = (lateTotals[k] || 0) + lateDays;
    });
    const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);
    const total = sorted.reduce((s, [, n]) => s + n, 0);

    const lblOf = code => DELAY_CAUSES[code] || PPC_CAUSES[code] || code;

    // ── Donut (top 6 causas + "outras") ───────────────────────────────────────
    const palette = ['#e54b1a', '#1f3a8a', '#d4a82c', '#2E7D4F', '#a4161a', '#7C3AED', '#9ba8be'];
    const top = sorted.slice(0, 6);
    const outras = sorted.slice(6).reduce((s, [, n]) => s + n, 0);
    const donutData = outras > 0 ? [...top, ['__outras__', outras]] : top;
    const VW = 220, cx = 110, cy = 110, R = 90, r = 56;
    let acc = 0;
    const slices = donutData.map(([code, n], i) => {
      const f0 = acc / total, f1 = (acc + n) / total;
      acc += n;
      const a0 = -Math.PI / 2 + f0 * 2 * Math.PI;
      const a1 = -Math.PI / 2 + f1 * 2 * Math.PI;
      const large = f1 - f0 > 0.5 ? 1 : 0;
      const x0 = cx + R * Math.cos(a0), y0 = cy + R * Math.sin(a0);
      const x1 = cx + R * Math.cos(a1), y1 = cy + R * Math.sin(a1);
      const ix0 = cx + r * Math.cos(a1), iy0 = cy + r * Math.sin(a1);
      const ix1 = cx + r * Math.cos(a0), iy1 = cy + r * Math.sin(a0);
      const d = `M ${x0} ${y0} A ${R} ${R} 0 ${large} 1 ${x1} ${y1} L ${ix0} ${iy0} A ${r} ${r} 0 ${large} 0 ${ix1} ${iy1} Z`;
      return `<path d="${d}" fill="${palette[i % palette.length]}" opacity="0.92"/>`;
    }).join('');

    const legend = donutData.map(([code, n], i) => {
      const pct = Math.round(n / total * 100);
      const lbl = code === '__outras__' ? `Outras (${sorted.length - 6})` : lblOf(code);
      return `<div style="display:flex;align-items:center;gap:8px;font-size:11px;line-height:1.3;">
        <span style="width:11px;height:11px;background:${palette[i % palette.length]};border-radius:2px;flex-shrink:0;"></span>
        <span style="flex:1;color:var(--ink-soft);">${escapeHtml(lbl)}</span>
        <span style="font-family:var(--font-mono);color:var(--ink);font-weight:700;">${n}</span>
        <span style="font-family:var(--font-mono);color:var(--ink-mute);width:36px;text-align:right;">${pct}%</span>
      </div>`;
    }).join('');

    // ── Pareto: barras horizontais com Lei 80/20 ──────────────────────────────
    let cum = 0;
    const paretoRows = sorted.map(([code, n], i) => {
      const pct = Math.round(n / total * 100);
      cum += n;
      const cumPct = Math.round(cum / total * 100);
      const inVital = cum / total <= 0.8 || (i === 0 && sorted.length === 1);
      const days = lateTotals[code] || 0;
      return `<div style="display:flex;align-items:center;gap:10px;">
        <div style="width:230px;font-size:12px;flex-shrink:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${escapeHtml(lblOf(code))}">
          <span style="font-family:var(--font-mono);font-size:9px;color:var(--ink-mute);margin-right:6px;">${String(i + 1).padStart(2, '0')}</span>${escapeHtml(lblOf(code))}
        </div>
        <div style="flex:1;height:14px;background:var(--bg-deep);border-radius:3px;overflow:hidden;position:relative;">
          <div style="height:100%;width:${pct}%;background:${inVital ? 'var(--accent-danger)' : 'var(--ink-mute)'};"></div>
        </div>
        <div style="font-family:var(--font-mono);font-size:11px;color:var(--ink-soft);width:96px;text-align:right;flex-shrink:0;">
          ${n} <span style="color:var(--ink-mute);">·</span> ${pct}% <span style="color:var(--ink-mute);">·</span> ${days}d
        </div>
        <div style="font-family:var(--font-mono);font-size:10px;color:${cum/total <= 0.8 ? 'var(--accent-danger)' : 'var(--ink-mute)'};width:42px;text-align:right;flex-shrink:0;">${cumPct}%</div>
      </div>`;
    }).join('');

    // Diagnóstico (heurística simples)
    const topCode = sorted[0]?.[0];
    const topPct = sorted[0] ? Math.round(sorted[0][1] / total * 100) : 0;
    const diag = sorted.length === 0 ? '' :
      `<div style="margin-top:14px;padding:10px 14px;background:rgba(229,75,26,0.06);border-left:3px solid var(--accent-danger);border-radius:0 3px 3px 0;font-size:12px;color:var(--ink-soft);">
        <strong style="color:var(--accent-danger);">Causa principal:</strong> ${escapeHtml(lblOf(topCode))} (${topPct}% das ocorrências).
        ${sorted.length > 1 ? `Atacando as <strong>causas vitais</strong> (barras vermelhas) você resolve a maioria dos atrasos.` : ''}
      </div>`;

    return `
      <div class="panel" style="margin-top:14px;">
        <div class="panel-head">
          <div class="panel-title">Análise de Causas de Atraso</div>
          <div class="panel-title-mono">${tasksWithCause.length} tarefa${tasksWithCause.length !== 1 ? 's' : ''} · ${sorted.length} causa${sorted.length !== 1 ? 's' : ''}</div>
        </div>
        <div class="panel-body">
          <div style="display:grid;grid-template-columns:240px 1fr;gap:24px;align-items:flex-start;">
            <!-- Donut -->
            <div>
              <svg viewBox="0 0 ${VW} 220" width="100%" style="display:block;">
                ${slices}
                <text x="${cx}" y="${cy - 4}" text-anchor="middle" font-size="28" font-weight="800" fill="var(--accent-danger)" font-family="var(--font-display)">${total}</text>
                <text x="${cx}" y="${cy + 14}" text-anchor="middle" font-size="9" fill="var(--ink-mute)" font-family="var(--font-mono)" style="text-transform:uppercase;letter-spacing:.1em;">ocorrências</text>
              </svg>
              <div style="display:flex;flex-direction:column;gap:5px;margin-top:8px;">
                ${legend}
              </div>
            </div>
            <!-- Pareto -->
            <div>
              <div style="display:flex;align-items:baseline;justify-content:space-between;margin-bottom:10px;">
                <div style="font-family:var(--font-mono);font-size:10px;color:var(--ink-mute);text-transform:uppercase;letter-spacing:0.12em;">Pareto · vitais (≤80% acumulado)</div>
                <div style="font-family:var(--font-mono);font-size:10px;color:var(--ink-mute);">qtd · % · dias atraso · % acum</div>
              </div>
              <div style="display:flex;flex-direction:column;gap:6px;">${paretoRows}</div>
              ${diag}
            </div>
          </div>
        </div>
      </div>`;
  },
});

// Plugado em UI: continuam acessíveis como UI.<método> e this.<método>.
Object.assign(UI, {
  // ===== ATUALIZAR VISÃO GERAL =====
  async refreshOverview(silent = false) {
    try {
      if (!silent) setLoading(true);
      State.allTasks = await DB.listAllTasksForUser();
      // Etiquetas cross-project (para os filtros de Pendências / Minhas Tarefas)
      State.allLabels = await DB.listAllLabels();
      State.allTaskLabels = await DB.listAllTaskLabels();
      UI._overviewLoadedAt = Date.now();
      if (State.currentView === 'overview') await UI.render();
      if (!silent) toast(`Atualizado: ${State.allTasks.length} tarefas`, 'success');
    } catch (err) {
      if (!silent) toast(friendlyError(err), 'error');
      else console.warn('Visão Geral refresh silencioso falhou:', err.message);
    } finally { if (!silent) setLoading(false); }
  },

  // ============================================================================
  // RELATÓRIO DE DESEMBOLSO — curva S (previsto × realizado) + tabela mensal
  // ============================================================================
  // ===== RELATÓRIO: AVANÇO FÍSICO (CURVA S) =====
  // Gera os 3 modos (linha, barras, misto) no mesmo HTML; tabs alternam na preview;
  // imprime o modo visível.
  printSCurve() {
    const p = Views.current();
    if (!p) { toast('Selecione um projeto', 'warning'); return; }
    const t = today();
    const leaves = State.tasks.filter(tk => !tk.inactive && !State.tasks.some(x => x.parent_id === tk.id) && tk.start_date && tk.end_date);
    if (leaves.length === 0) { toast('Sem tarefas com datas para gerar a Curva S', 'warning'); return; }

    const minD = leaves.map(x => x.start_date).reduce((a, b) => a < b ? a : b);
    const maxD = leaves.map(x => x.end_date).reduce((a, b) => a > b ? a : b);
    const totalDays = Math.max(1, daysBetween(minD, maxD));
    const W = leaves.map(x => Math.max(1, daysBetween(x.start_date, x.end_date)));
    const totalW = W.reduce((a, b) => a + b, 0);
    const hasBaseline = leaves.some(x => x.baseline_start && x.baseline_end);
    const clampFrac = (d, s, e) => { const span = daysBetween(s, e); if (span <= 0) return d >= e ? 1 : 0; return Math.max(0, Math.min(1, daysBetween(s, d) / span)); };
    const plannedAt  = (d) => leaves.reduce((a, x, i) => a + W[i] * clampFrac(d, x.start_date, x.end_date), 0) / totalW * 100;
    const baselineAt = (d) => leaves.reduce((a, x, i) => a + W[i] * clampFrac(d, x.baseline_start || x.start_date, x.baseline_end || x.end_date), 0) / totalW * 100;
    const basis    = (State.sCurveBasis === 'baseline' && hasBaseline) ? 'baseline' : 'planned';
    const refLabel = basis === 'baseline' ? 'Linha de base' : 'Previsto';
    const refAt    = basis === 'baseline' ? baselineAt : plannedAt;
    const _actualRaw = (d) => leaves.reduce((a, x, i) => {
      const pr = Math.max(0, Math.min(100, parseFloat(x.progress) || 0)) / 100;
      const span = daysBetween(x.start_date, t);
      // Tarefa que começa hoje ou no futuro: o progresso já registrado conta integralmente
      // a partir de hoje (não some), pra o Realizado (hoje) bater com o avanço do cronograma.
      const f = span <= 0 ? (d >= Math.min(x.start_date, t) ? 1 : 0) : Math.max(0, Math.min(1, daysBetween(x.start_date, d) / span));
      return a + W[i] * pr * f;
    }, 0) / totalW * 100;
    // Ancora o Realizado (hoje) ao AVANÇO DO PROJETO (andamento da tarefa-pai raiz),
    // preservando o formato da curva — mesmo critério da Curva S do dashboard.
    const _ppTarget = physicalProgress(State.tasks);
    const _anchorD  = t < minD ? minD : (t > maxD ? maxD : t);
    const _rawNow   = _actualRaw(_anchorD);
    const _rScale   = _rawNow > 0.05 ? _ppTarget / _rawNow : 1;
    const actualAt  = (d) => _actualRaw(d) * _rScale;

    const mNames = ['jan','fev','mar','abr','mai','jun','jul','ago','set','out','nov','dez'];
    const monthPts = [];
    { let [y, m] = minD.slice(0, 7).split('-').map(Number);
      const [ey, em] = maxD.slice(0, 7).split('-').map(Number);
      while (y < ey || (y === ey && m <= em)) {
        const d = `${y}-${String(m).padStart(2,'0')}-01`;
        if (d >= minD) monthPts.push({ d, label: `${mNames[m-1]}/${String(y).slice(2)}` });
        m++; if (m > 12) { m = 1; y++; }
      }
    }
    if (!monthPts.some(pp => pp.d === maxD)) monthPts.push({ d: maxD, label: fmtDateShort(maxD) });
    const todayInRange = t >= minD && t <= maxD;
    const lineDates = [...new Set([...monthPts.map(pp => pp.d), ...(todayInRange ? [t] : []), maxD])].sort();

    // Cores fixas para impressão (light)
    const COL = { prev: '#1f3a8a', real: '#E54B1A', base: '#6B6359', grid: '#e6e2d6', text: '#1A1714', mute: '#6B6359', today: '#E54B1A' };

    // Geometria
    const VW = 1000, VH = 360, mL = 50, mR = 16, mT = 30, mB = 60;
    const pw = VW - mL - mR, ph = VH - mT - mB;
    const X  = (d) => mL + (daysBetween(minD, d) / totalDays) * pw;
    const Y  = (v) => mT + (1 - Math.max(0, Math.min(100, v)) / 100) * ph;

    // Eixo Y
    const yGrid = [0, 25, 50, 75, 100].map(v =>
      `<line x1="${mL}" y1="${Y(v).toFixed(1)}" x2="${VW-mR}" y2="${Y(v).toFixed(1)}" stroke="${COL.grid}" stroke-width="1"/>
       <text x="${mL-6}" y="${(Y(v)+4).toFixed(1)}" text-anchor="end" font-size="11" font-family="monospace" fill="${COL.mute}">${v}%</text>`).join('');

    // Eixo X — TODOS os meses
    const nM = monthPts.length;
    const xFont = nM <= 12 ? 11 : nM <= 24 ? 10 : nM <= 36 ? 9 : 8;
    const xRot  = nM <= 8 ? 0 : nM <= 14 ? -30 : nM <= 24 ? -45 : -55;
    const xAxis = monthPts.map(pp => {
      const xp = X(pp.d).toFixed(1);
      const grid = `<line x1="${xp}" y1="${mT}" x2="${xp}" y2="${mT+ph}" stroke="${COL.grid}" stroke-width="0.6"/>`;
      const transform = xRot !== 0 ? `transform="rotate(${xRot},${xp},${VH-24})"` : '';
      const lbl = `<text x="${xp}" y="${VH-24}" text-anchor="${xRot < 0 ? 'end' : 'middle'}" font-size="${xFont}" font-family="monospace" fill="${COL.mute}" ${transform}>${pp.label}</text>`;
      return grid + lbl;
    }).join('');
    const todayLine = todayInRange
      ? `<line x1="${X(t).toFixed(1)}" y1="${mT}" x2="${X(t).toFixed(1)}" y2="${mT+ph}" stroke="${COL.today}" stroke-width="1.2" stroke-dasharray="3 2" opacity="0.65"/>
         <text x="${X(t).toFixed(1)}" y="${mT-6}" text-anchor="middle" font-size="9" font-family="monospace" fill="${COL.today}" font-weight="700">HOJE</text>`
      : '';

    const fmtP = v => v >= 10 ? v.toFixed(0) + '%' : v >= 1 ? v.toFixed(1) + '%' : v > 0 ? v.toFixed(1) + '%' : '';
    const lblSize = nM <= 14 ? 11 : nM <= 24 ? 10 : nM <= 36 ? 9 : 8;

    // ── MODO LINHA ──────────────────────────────────────────────────────────────
    const ptsTo = (fn, onlyPast) => lineDates.filter(d => !onlyPast || d <= t).map(d => `${X(d).toFixed(1)},${Y(fn(d)).toFixed(1)}`).join(' ');
    const refPts  = ptsTo(refAt, false);
    const realPts = ptsTo(actualAt, true);
    const markers = monthPts.map(pp => {
      const vP = refAt(pp.d), xp = X(pp.d), yp = Y(vP);
      const dotP = `<circle cx="${xp.toFixed(1)}" cy="${yp.toFixed(1)}" r="3.5" fill="${COL.prev}" stroke="#fff" stroke-width="1.2"/>`;
      const lblP = vP > 0 ? `<text x="${xp.toFixed(1)}" y="${(yp-10).toFixed(1)}" text-anchor="middle" font-size="${lblSize}" font-family="monospace" fill="${COL.prev}" font-weight="700">${fmtP(vP)}</text>` : '';
      let dotR = '', lblR = '';
      if (pp.d <= t) {
        const vR = actualAt(pp.d), yr = Y(vR);
        dotR = `<circle cx="${xp.toFixed(1)}" cy="${yr.toFixed(1)}" r="3.5" fill="${COL.real}" stroke="#fff" stroke-width="1.2"/>`;
        lblR = vR > 0 ? `<text x="${xp.toFixed(1)}" y="${(yr+14).toFixed(1)}" text-anchor="middle" font-size="${lblSize}" font-family="monospace" fill="${COL.real}" font-weight="700">${fmtP(vR)}</text>` : '';
      }
      return dotP + lblP + dotR + lblR;
    }).join('');
    const svgLine = `<svg viewBox="0 0 ${VW} ${VH}" width="100%" preserveAspectRatio="xMidYMid meet" style="display:block;overflow:visible;">
        ${yGrid}${xAxis}${todayLine}
        <polyline points="${refPts}" fill="none" stroke="${COL.prev}" stroke-width="2.5"/>
        <polyline points="${realPts}" fill="none" stroke="${COL.real}" stroke-width="2.5"/>
        ${markers}
      </svg>`;

    // ── MODO BARRAS ─────────────────────────────────────────────────────────────
    const slotW = pw / Math.max(monthPts.length - 1, 1);
    const barW = Math.max(4, Math.min(slotW * 0.38, 30));
    const gap = Math.max(1, barW * 0.18);
    const bars = monthPts.map((pp, i) => {
      if (i === 0) return '';
      const prev = monthPts[i-1].d, curr = pp.d;
      const prevD = refAt(curr) - refAt(prev);
      const realD = curr <= t ? Math.max(0, actualAt(curr) - actualAt(prev)) : null;
      const xC = (X(prev) + X(curr)) / 2;
      const hP = (prevD / 100) * ph, hR = realD !== null ? (realD / 100) * ph : 0;
      const xP = xC - gap/2 - barW, xR = xC + gap/2;
      const yPtop = mT + ph - hP, yRtop = mT + ph - hR;
      const bP = `<rect x="${xP.toFixed(1)}" y="${yPtop.toFixed(1)}" width="${barW.toFixed(1)}" height="${Math.max(1,hP).toFixed(1)}" rx="2" fill="${COL.prev}" opacity="0.78"/>`;
      const bR = realD !== null ? `<rect x="${xR.toFixed(1)}" y="${yRtop.toFixed(1)}" width="${barW.toFixed(1)}" height="${Math.max(0.5,hR).toFixed(1)}" rx="2" fill="${COL.real}" opacity="0.88"/>` : '';
      const lP = prevD > 0 ? `<text x="${(xP+barW/2).toFixed(1)}" y="${(yPtop-7).toFixed(1)}" text-anchor="middle" font-size="${lblSize}" font-family="monospace" fill="${COL.prev}" font-weight="700">${fmtP(prevD)}</text>` : '';
      const lR = realD !== null && realD > 0 ? `<text x="${(xR+barW/2).toFixed(1)}" y="${(yRtop-7).toFixed(1)}" text-anchor="middle" font-size="${lblSize}" font-family="monospace" fill="${COL.real}" font-weight="700">${fmtP(realD)}</text>` : '';
      return bP + bR + lP + lR;
    }).join('');
    const svgBars = `<svg viewBox="0 0 ${VW} ${VH}" width="100%" preserveAspectRatio="xMidYMid meet" style="display:block;overflow:visible;">
        ${yGrid}${xAxis}${todayLine}${bars}
      </svg>`;

    // ── MODO MISTO ──────────────────────────────────────────────────────────────
    const barW2 = Math.max(4, Math.min(slotW * 0.3, 24));
    const gap2  = Math.max(1, barW2 * 0.18);
    const mxBars = monthPts.map((pp, i) => {
      if (i === 0) return '';
      const prev = monthPts[i-1].d, curr = pp.d;
      const prevD = refAt(curr) - refAt(prev);
      const realD = curr <= t ? Math.max(0, actualAt(curr) - actualAt(prev)) : null;
      const xC = (X(prev) + X(curr)) / 2;
      const hP = (prevD / 100) * ph, hR = realD !== null ? (realD / 100) * ph : 0;
      const xP = xC - gap2/2 - barW2, xR = xC + gap2/2;
      const bP = `<rect x="${xP.toFixed(1)}" y="${(mT+ph-hP).toFixed(1)}" width="${barW2.toFixed(1)}" height="${Math.max(1,hP).toFixed(1)}" rx="2" fill="${COL.prev}" opacity="0.42"/>`;
      const bR = realD !== null ? `<rect x="${xR.toFixed(1)}" y="${(mT+ph-hR).toFixed(1)}" width="${barW2.toFixed(1)}" height="${Math.max(0.5,hR).toFixed(1)}" rx="2" fill="${COL.real}" opacity="0.48"/>` : '';
      return bP + bR;
    }).join('');
    const svgMixed = `<svg viewBox="0 0 ${VW} ${VH}" width="100%" preserveAspectRatio="xMidYMid meet" style="display:block;overflow:visible;">
        ${yGrid}${xAxis}${todayLine}${mxBars}
        <polyline points="${refPts}" fill="none" stroke="${COL.prev}" stroke-width="2.5"/>
        <polyline points="${realPts}" fill="none" stroke="${COL.real}" stroke-width="2.5"/>
        ${markers}
      </svg>`;

    // KPIs
    const prevHoje = refAt(todayInRange ? t : maxD);
    const realHoje = actualAt(todayInRange ? t : maxD);
    const desvio   = realHoje - prevHoje;
    const devColor = desvio >= -0.5 ? '#059669' : (desvio >= -10 ? '#D4A82C' : '#C13B12');

    // Tabela mensal acumulada
    const tableRows = monthPts.map(pp => {
      const vP = refAt(pp.d), vR = pp.d <= t ? actualAt(pp.d) : null;
      const dev = vR !== null ? vR - vP : null;
      return `<tr><td style="font-family:monospace;">${pp.label}</td>
        <td style="text-align:right;font-family:monospace;color:${COL.prev};font-weight:700;">${vP.toFixed(1)}%</td>
        <td style="text-align:right;font-family:monospace;color:${COL.real};font-weight:700;">${vR !== null ? vR.toFixed(1) + '%' : '—'}</td>
        <td style="text-align:right;font-family:monospace;color:${dev === null ? COL.mute : (dev >= -0.5 ? '#059669' : (dev >= -10 ? '#D4A82C' : '#C13B12'))};">${dev === null ? '—' : (dev >= 0 ? '+' : '') + dev.toFixed(1) + '%'}</td>
      </tr>`;
    }).join('');

    const legend = `
      <div style="display:flex;gap:18px;flex-wrap:wrap;font-family:monospace;font-size:10px;color:${COL.mute};margin-bottom:10px;">
        <span style="display:inline-flex;align-items:center;gap:5px;"><span style="width:14px;height:0;border-top:3px solid ${COL.prev};display:inline-block;"></span>${refLabel} (acumulado)</span>
        <span style="display:inline-flex;align-items:center;gap:5px;"><span style="width:14px;height:0;border-top:3px solid ${COL.real};display:inline-block;"></span>Realizado (acumulado)</span>
        <span style="display:inline-flex;align-items:center;gap:5px;"><span style="width:12px;height:9px;background:${COL.prev};opacity:0.78;border-radius:1px;display:inline-block;"></span>${refLabel} (mensal)</span>
        <span style="display:inline-flex;align-items:center;gap:5px;"><span style="width:12px;height:9px;background:${COL.real};opacity:0.88;border-radius:1px;display:inline-block;"></span>Realizado (mensal)</span>
      </div>`;

    const body = `
      <style>
        .sc-kpis{display:flex;gap:18px;margin-bottom:14px;flex-wrap:wrap;}
        .sc-kpi{flex:1;min-width:130px;padding:10px 14px;background:#FAFAF8;border-left:3px solid #ccc;}
        .sc-kpi-lbl{font-family:monospace;font-size:9px;text-transform:uppercase;letter-spacing:.08em;color:${COL.mute};}
        .sc-kpi-val{font-size:22px;font-weight:800;line-height:1.1;}
        .sc-tabs{display:flex;gap:0;margin-bottom:14px;border:1px solid #ddd;border-radius:3px;overflow:hidden;width:fit-content;}
        .sc-tab{padding:7px 16px;font-family:monospace;font-size:11px;font-weight:600;color:${COL.mute};cursor:pointer;border-right:1px solid #ddd;background:#fff;}
        .sc-tab:last-child{border-right:none;}
        .sc-tab.active{background:${COL.real};color:#fff;}
        .sc-chart{display:none;}
        .sc-chart.active{display:block;}
        @media print{
          .sc-tabs{display:none!important;}
          .sc-chart{display:none!important;}
          .sc-chart.print-show{display:block!important;}
        }
      </style>
      <div class="sc-kpis">
        <div class="sc-kpi" style="border-left-color:${COL.prev};">
          <div class="sc-kpi-lbl">${refLabel} (hoje)</div>
          <div class="sc-kpi-val" style="color:${COL.prev};">${prevHoje.toFixed(1)}%</div>
        </div>
        <div class="sc-kpi" style="border-left-color:${COL.real};">
          <div class="sc-kpi-lbl">Realizado (hoje)</div>
          <div class="sc-kpi-val" style="color:${COL.real};">${realHoje.toFixed(1)}%</div>
        </div>
        <div class="sc-kpi" style="border-left-color:${devColor};">
          <div class="sc-kpi-lbl">Desvio</div>
          <div class="sc-kpi-val" style="color:${devColor};">${desvio >= 0 ? '+' : ''}${desvio.toFixed(1)}%</div>
        </div>
        <div class="sc-kpi" style="border-left-color:${COL.mute};">
          <div class="sc-kpi-lbl">Período</div>
          <div class="sc-kpi-val" style="font-size:14px;">${monthPts.length} ${monthPts.length === 1 ? 'mês' : 'meses'}</div>
        </div>
      </div>

      ${legend}

      <div class="sc-tabs" id="scTabs">
        <div class="sc-tab active" data-sc="line">〜 Linha</div>
        <div class="sc-tab" data-sc="bars">▬ Barras</div>
        <div class="sc-tab" data-sc="mixed">▬〜 Misto</div>
      </div>

      <div class="sc-chart active print-show" data-sc="line">${svgLine}</div>
      <div class="sc-chart" data-sc="bars">${svgBars}</div>
      <div class="sc-chart" data-sc="mixed">${svgMixed}</div>

      <h2 style="margin-top:18px;">Detalhamento Mensal (acumulado)</h2>
      <table>
        <thead><tr>
          <th>Mês</th><th style="text-align:right;">${refLabel}</th><th style="text-align:right;">Realizado</th><th style="text-align:right;">Desvio</th>
        </tr></thead>
        <tbody>${tableRows}</tbody>
      </table>

      <script>
        (function(){
          var tabs = document.querySelectorAll('#scTabs .sc-tab');
          var charts = document.querySelectorAll('.sc-chart');
          tabs.forEach(function(t){
            t.addEventListener('click', function(){
              tabs.forEach(function(x){ x.classList.remove('active'); });
              t.classList.add('active');
              var mode = t.dataset.sc;
              charts.forEach(function(c){
                c.classList.remove('active');
                c.classList.remove('print-show');
                if (c.dataset.sc === mode) { c.classList.add('active'); c.classList.add('print-show'); }
              });
            });
          });
        })();
      <\/script>
    `;

    this._printWindow('Avanço Físico (Curva S)', body);
  },
});
