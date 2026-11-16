// Views: geração de HTML das telas
import { $, DEP_TYPE_PT, DateFilter, Holidays, SITUACAO_META, _parseYMD, _wdBetweenCache, addDays, colorFromString, daysBetween, escapeHtml, fmtBRL, fmtDate, fmtDateFull, fmtDateShort, forecastEndDate, initials, parentTag, physicalProgress, plannedProgressPct, relativeDate, statusFilterChips, taskSituacao, today, workingDaysBetween } from './helpers.js';
import { CPMCache, computeCriticalPath } from './cpm.js';
import { setLoading, toast } from './feedback.js';
import { CONSTRAINT_TYPES, DELAY_CAUSES, PPC_CAUSES, RESTRICTION_STATUS, RESTRICTION_TYPES, State } from './state.js';
import { DB } from './db.js';
import { Perf } from './perf.js';
import { HealthCheck } from './health.js';
import { BaselineCompare } from './baseline.js';
import { Modal } from './modal.js';
import { KanbanConfig } from './kanban-config.js';
import { GanttCols } from './gantt-cols.js';
import { Automation } from './automation.js';
import { UI } from './ui.js';

// Cache de render do Gantt — populados em gantt(), consumidos em _renderGanttImpl().
// Evita recalcular taskSituacao/forecastEndDate 3× por render (contagem + filtro + célula).
let _ganttSitCache = null; // Map<taskId, situacao>
let _ganttFcCache  = null; // Map para forecastEndDate (compartilhado nas 3 passagens)

// ---------- VIEWS (apenas geração de HTML) ----------
export const Views = {
  current() { return State.projects.find(p => p.id === State.currentProjectId); },

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

  emptyProject() {
    const isFirstUse = State.projects.length === 0;
    if (isFirstUse) {
      const userName = State.profile?.full_name?.split(' ')[0] || 'engenheiro';
      return `
        <div style="max-width:680px;margin:60px auto;padding:0 20px;">
          <div class="page-eyebrow" style="text-align:center;">BEM-VINDO AO CADÊOPROJETO</div>
          <h1 style="font-size:32px;font-weight:800;text-align:center;margin:8px 0 4px;">Olá, ${escapeHtml(userName)}!</h1>
          <div style="text-align:center;color:var(--ink-soft);font-size:14px;margin-bottom:36px;">
            Vamos começar criando seu primeiro projeto de engenharia.
          </div>

          <div style="max-width:340px;margin:0 auto;">
            <div class="panel" style="cursor:pointer;transition:all 0.15s;border-color:var(--accent);" data-action="new-project">
              <div class="panel-body" style="text-align:center;padding:32px 20px;">
                <div style="width:56px;height:56px;background:var(--accent);border-radius:4px;display:flex;align-items:center;justify-content:center;margin:0 auto 16px;">
                  <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="var(--bg-deep)" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                </div>
                <div style="font-size:18px;font-weight:700;margin-bottom:6px;">Criar Minha Primeira Obra</div>
                <div style="font-size:13px;color:var(--ink-soft);">Configure o nome, datas e comece a cadastrar suas tarefas e entregáveis.</div>
              </div>
            </div>
            <div style="text-align:center;margin-top:14px;">
              <button class="btn btn-ghost" data-action="create-demo"
                style="font-size:11px;color:var(--ink-mute);padding:4px 12px;">
                ou carregar projeto de demonstração →
              </button>
            </div>
          </div>

          <div style="margin-top:36px;padding:20px;background:var(--bg-panel);border:1px solid var(--border);border-radius:3px;">
            <div style="font-family:var(--font-mono);font-size:10px;color:var(--ink-mute);text-transform:uppercase;letter-spacing:0.12em;margin-bottom:10px;">O que tem dentro</div>
            <div style="display:grid;grid-template-columns:repeat(2,1fr);gap:10px 24px;font-size:13px;color:var(--ink-soft);">
              <div>📐 Disciplinas técnicas (NBR 13531/13532)</div>
              <div>📋 Cronograma Gantt com caminho crítico</div>
              <div>🔗 Predecessoras (TI/II/TT/IT) com defasagem</div>
              <div>🎯 Restrições de agendamento (MS Project)</div>
              <div>👥 Matriz RACI por tarefa</div>
              <div>📌 Linha de base (baseline)</div>
              <div>📊 Marcos (milestones)</div>
              <div>🔁 Import/Export MS Project XML</div>
            </div>
          </div>
        </div>
      `;
    }
    // Caso não seja primeiro uso (ex: deletou todos os projetos)
    return `
      <div class="empty-state" style="margin-top:80px;">
        <div class="empty-state-icon"><svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg></div>
        <div class="empty-state-title">Sem projetos ativos</div>
        <div class="empty-state-sub">Crie um novo projeto para começar.</div>
        <button class="btn btn-cta" data-action="new-project">+ Novo Projeto</button>
      </div>
    `;
  },

  gantt() {
    const p = this.current();
    if (!p) return this.emptyProject();
    if (State.tasks.length === 0) {
      return `
        <div class="page-title-block"><div class="page-eyebrow">CRONOGRAMA</div><div class="page-title">Linha do Tempo do Projeto</div></div>
        <div class="empty-state" style="background:var(--bg-panel);border:1px solid var(--border);border-radius:3px;">
          <div class="empty-state-icon"><svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><line x1="3" y1="6" x2="14" y2="6"/><line x1="7" y1="12" x2="20" y2="12"/><line x1="5" y1="18" x2="16" y2="18"/></svg></div>
          <div class="empty-state-title">Nenhuma tarefa no cronograma</div>
          <div class="empty-state-sub">Adicione tarefas com datas para visualizá-las na linha do tempo.</div>
          <button class="btn btn-cta" data-action="new-task">+ Nova Tarefa</button>
        </div>
      `;
    }
    const cpmInfo = CPMCache.get(State.tasks, State.dependencies);
    const violationCount = cpmInfo.violations.size;
    const hasBaseline = State.tasks.some(t => t.baseline_start);
    const todayNow = today();
    const avgProgress = Math.round(physicalProgress(State.tasks));
    const delayedCount = State.tasks.filter(t => !t.inactive && (parseFloat(t.progress) || 0) < 100 && t.status !== 'concluido' && t.end_date && t.end_date < todayNow).length;
    // Pré-computa situação UMA VEZ para todas as tarefas, compartilhando o cache de
    // forecastEndDate. Eliminam-se 2 das 3 passagens completas (chip count + filtro
    // + célula) que antes reconstituíam workingDaysBetween do zero cada vez.
    _wdBetweenCache.clear();
    _ganttFcCache = new Map();
    _ganttSitCache = new Map();
    State.tasks.forEach(t => {
      if (!t.inactive) _ganttSitCache.set(t.id, taskSituacao(t, _ganttFcCache, todayNow, State.situacaoBasis));
    });
    // Contagem por SITUAÇÃO (selo) — alimenta os filtros rápidos do Gantt.
    const _sitCounts = { futura: 0, atrasada: 0, no_prazo: 0, concluida: 0 };
    _ganttSitCache.forEach(s => { if (_sitCounts[s] !== undefined) _sitCounts[s]++; });
    const _sitChips = [
      ['all', `Todas`, State.tasks.filter(t => !t.inactive).length, 'var(--ink-soft)'],
      ['atrasada', SITUACAO_META.atrasada.label, _sitCounts.atrasada, SITUACAO_META.atrasada.color],
      ['no_prazo', SITUACAO_META.no_prazo.label, _sitCounts.no_prazo, SITUACAO_META.no_prazo.color],
      ['futura', SITUACAO_META.futura.label, _sitCounts.futura, SITUACAO_META.futura.color],
      ['concluida', SITUACAO_META.concluida.label, _sitCounts.concluida, SITUACAO_META.concluida.color],
    ];
    const _curSit = State.ganttSituacaoFilter || 'all';
    const _sitChipsHtml = _sitChips.map(([id, lbl, n, col]) => {
      const active = _curSit === id;
      return `<button data-sit-filter="${id}" style="display:inline-flex;align-items:center;gap:5px;font-family:var(--font-mono);font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.04em;padding:3px 9px;border-radius:11px;cursor:pointer;border:1px solid ${active ? col : 'var(--border-strong)'};background:${active ? col : 'transparent'};color:${active ? '#fff' : col};">${lbl}<span style="opacity:${active ? '.85' : '.6'};">${n}</span></button>`;
    }).join('');
    // Toggle da BASE do cálculo do selo: linha de base vigente × planejamento atual.
    const _curBasis = State.situacaoBasis === 'planned' ? 'planned' : 'baseline';
    const _basisBtn = (id, lbl, tip) => `<button data-sit-basis="${id}" title="${tip}" style="font-family:var(--font-mono);font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.04em;padding:3px 9px;border:none;cursor:pointer;background:${_curBasis===id?'var(--accent)':'transparent'};color:${_curBasis===id?'var(--bg-deep)':'var(--ink-soft)'};">${lbl}</button>`;
    const _basisToggle = `<span style="margin-left:auto;font-family:var(--font-mono);font-size:9px;color:var(--ink-mute);text-transform:uppercase;letter-spacing:.1em;">Base:</span><div style="display:inline-flex;border:1px solid var(--border-strong);border-radius:11px;overflow:hidden;">${_basisBtn('baseline','Linha de base','Compara o status contra a linha de base vigente')}${_basisBtn('planned','Planejamento','Compara o status contra as datas planejadas atuais (início/término)')}</div>`;
    const progressColor = avgProgress >= 75 ? 'var(--accent-success)' : avgProgress >= 40 ? 'var(--accent)' : 'var(--ink-soft)';
    // Profundidade máxima da EAP → alimenta o seletor de nível (dinâmico por projeto)
    const _taskByIdGantt = new Map(State.tasks.map(t => [t.id, t]));
    const _depthMemo = new Map();
    const _depthOf = (t) => {
      if (_depthMemo.has(t.id)) return _depthMemo.get(t.id);
      let d = 1, pid = t.parent_id, guard = 0;
      while (pid && guard++ < 24) { const par = _taskByIdGantt.get(pid); if (!par) break; d++; pid = par.parent_id; }
      _depthMemo.set(t.id, d); return d;
    };
    const maxDepth = State.tasks.reduce((m, t) => Math.max(m, _depthOf(t)), 1);
    return `
      <div class="page-title-block"><div class="page-eyebrow">CRONOGRAMA · GANTT</div><div class="page-title">Linha do Tempo</div><div class="page-subtitle">Arraste as barras para reagendar. 1 clique edita o campo · 2 cliques abrem a tarefa · botão direito: ir para a tarefa ou criar. Barras vermelhas: caminho crítico. Tracejado cinza: linha de base.</div></div>
      <div class="gantt-toolbar">
        <div class="zoom-group">
          <button class="zoom-btn ${State.ganttZoom === 'day' ? 'active' : ''}" data-zoom="day">Dia</button>
          <button class="zoom-btn ${State.ganttZoom === 'week' ? 'active' : ''}" data-zoom="week">Semana</button>
          <button class="zoom-btn ${State.ganttZoom === 'month' ? 'active' : ''}" data-zoom="month">Mês</button>
        </div>
        <button class="btn btn-secondary" id="btnGanttToday" title="Rolar até hoje" style="padding:5px 10px;font-size:11px;font-family:var(--font-mono);">Hoje</button>
        <span class="gantt-sep"></span>
        <span class="gantt-cpm-legend">${cpmInfo.criticalIds.size} críticas</span>
        ${violationCount > 0 ? `<span class="gantt-violation-legend" data-action="show-violations">⚠ ${violationCount} ${violationCount === 1 ? 'violação' : 'violações'}</span>` : ''}
        <span class="gantt-sep"></span>
        <button class="btn ${State._scheduleDirty ? 'btn-cta' : 'btn-secondary'}" data-action="auto-schedule" title="${State._scheduleDirty ? 'Datas mudaram — recalcule o cronograma' : 'Recalcula datas conforme dependências e restrições'}" style="padding:6px 10px;font-size:11px;${State._scheduleDirty ? 'animation:recalc-pulse 1.6s ease-in-out infinite;' : ''}">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:14px;height:14px;"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>
          ${State._scheduleDirty ? 'Recalcular ⚠' : 'Recalcular'}
        </button>
        <label id="ganttAutoRecalcToggle" title="Quando ligado, o cronograma é recalculado automaticamente a cada mudança de data, duração ou predecessora." style="display:inline-flex;align-items:center;gap:5px;cursor:pointer;font-family:var(--font-mono);font-size:10px;color:${State.ganttAutoRecalc ? 'var(--accent)' : 'var(--ink-mute)'};text-transform:uppercase;letter-spacing:0.06em;user-select:none;">
          <input type="checkbox" ${State.ganttAutoRecalc ? 'checked' : ''} style="accent-color:var(--accent);width:13px;height:13px;cursor:pointer;">
          Auto
        </label>
        <!-- Nível (dropdown dinâmico conforme a profundidade da EAP do projeto) -->
        ${maxDepth > 1 ? `
        <div style="display:flex;align-items:center;gap:5px;">
          <span style="font-family:var(--font-mono);font-size:10px;color:var(--ink-mute);text-transform:uppercase;letter-spacing:0.1em;">Nível:</span>
          <select id="ganttLevelSel" class="form-input" style="width:auto;font-size:11px;padding:4px 8px;">
            <option value="all" ${(State.ganttLevelFilter||'all')==='all'?'selected':''}>Todos (${maxDepth})</option>
            ${Array.from({length: maxDepth - 1}, (_, i) => i + 1).map(n =>
              `<option value="${n}" ${String(State.ganttLevelFilter)===String(n)?'selected':''}>${n === 1 ? 'Só nível 1' : 'Até nível ' + n}</option>`
            ).join('')}
          </select>
        </div>` : ''}
        <!-- Mostrar/ocultar o gráfico Gantt -->
        <button class="btn ${State.ganttChartVisible ? 'btn-secondary' : 'btn-cta'}" id="ganttToggleChart" style="padding:6px 10px;font-size:11px;">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:14px;height:14px;"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="9" y1="21" x2="9" y2="9"/></svg>
          ${State.ganttChartVisible ? 'Ocultar Gantt' : 'Ver Gantt'}
        </button>
        <!-- Ampliar gráfico: colapsa/restaura o painel de colunas da esquerda -->
        <button class="btn btn-secondary" id="ganttToggleWidth" title="${State.ganttFullWidth ? 'Mostrar colunas (tabela)' : 'Ampliar o gráfico (esconder colunas)'}" style="padding:6px 10px;font-size:11px;">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:14px;height:14px;">${State.ganttFullWidth ? '<polyline points="9 18 15 12 9 6"/><line x1="3" y1="4" x2="3" y2="20"/>' : '<polyline points="15 18 9 12 15 6"/><line x1="21" y1="4" x2="21" y2="20"/>'}</svg>
          ${State.ganttFullWidth ? 'Colunas' : 'Ampliar'}
        </button>
        <!-- Menu unificado de ferramentas -->
        <div style="position:relative;" id="ganttToolsWrap">
          <button class="btn btn-secondary" id="btnGanttTools" style="padding:6px 12px;font-size:11px;display:flex;align-items:center;gap:5px;">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:14px;height:14px;"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/></svg>
            Ferramentas
            <svg viewBox="0 0 10 6" fill="currentColor" style="width:8px;height:8px;"><polygon points="0,0 10,0 5,6"/></svg>
          </button>
          <div id="ganttToolsMenu" style="display:none;position:absolute;top:calc(100% + 4px);left:0;z-index:200;background:var(--bg-panel);border:1px solid var(--border-strong);border-radius:4px;box-shadow:0 6px 20px rgba(0,0,0,.18);min-width:230px;padding:4px 0;">
            <div style="padding:4px 12px 2px;font-family:var(--font-mono);font-size:9px;color:var(--ink-mute);text-transform:uppercase;letter-spacing:.1em;border-bottom:1px solid var(--border);margin-bottom:4px;">Baseline</div>
            <button class="gantt-tool-item" data-action="set-baseline">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:14px;height:14px;flex-shrink:0;"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
              Salvar Linha de Base
            </button>
            <button class="gantt-tool-item" data-action="baseline-history">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:14px;height:14px;flex-shrink:0;"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
              Histórico de Baselines
            </button>
            ${DB.iAmAdmin() ? `<button class="gantt-tool-item" data-action="edit-baseline" title="Ajustar a linha de base tarefa a tarefa (somente admin)">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:14px;height:14px;flex-shrink:0;color:var(--accent-warm);"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4z"/></svg>
              <span style="color:var(--accent-warm);">Ajustar Linha de Base (admin)</span>
            </button>` : ''}
            <div style="padding:6px 12px 2px;font-family:var(--font-mono);font-size:9px;color:var(--ink-mute);text-transform:uppercase;letter-spacing:.1em;border-top:1px solid var(--border);border-bottom:1px solid var(--border);margin:4px 0 4px;">Exibição</div>
            <button class="gantt-tool-item" data-action="gantt-columns">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:14px;height:14px;flex-shrink:0;color:var(--accent);"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="9" y1="3" x2="9" y2="21"/><line x1="15" y1="3" x2="15" y2="21"/></svg>
              <span style="color:var(--accent);">Colunas exibíveis</span>
            </button>
            <div style="padding:6px 12px 2px;font-family:var(--font-mono);font-size:9px;color:var(--ink-mute);text-transform:uppercase;letter-spacing:.1em;border-top:1px solid var(--border);border-bottom:1px solid var(--border);margin:4px 0 4px;">Importar</div>
            <button class="gantt-tool-item" data-action="import-mspx">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:14px;height:14px;flex-shrink:0;color:var(--accent-warm);"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
              <span style="color:var(--accent-warm);">MS Project (.xml)</span>
            </button>
            <button class="gantt-tool-item" data-action="import-csv">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:14px;height:14px;flex-shrink:0;color:#2E7D4F;"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
              <span style="color:#2E7D4F;">Importar CSV</span>
            </button>
            <button class="gantt-tool-item" data-action="import-prevision">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:14px;height:14px;flex-shrink:0;color:#1f3a8a;"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
              <span style="color:#1f3a8a;">Prevision (.xlsx)</span>
            </button>
            <button class="gantt-tool-item" data-action="eap-templates">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:14px;height:14px;flex-shrink:0;color:#7C3AED;"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="9" y1="21" x2="9" y2="9"/></svg>
              <span style="color:#7C3AED;">Templates EAP</span>
            </button>
            <div style="padding:6px 12px 2px;font-family:var(--font-mono);font-size:9px;color:var(--ink-mute);text-transform:uppercase;letter-spacing:.1em;border-top:1px solid var(--border);border-bottom:1px solid var(--border);margin:4px 0 4px;">Exportar</div>
            <button class="gantt-tool-item" data-action="export-mspx">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:14px;height:14px;flex-shrink:0;"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
              Exportar XML (MS Project)
            </button>
            <button class="gantt-tool-item" data-action="export-gantt-csv">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:14px;height:14px;flex-shrink:0;"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
              Exportar EAP (CSV)
            </button>
            <button class="gantt-tool-item" data-action="export-gantt-png">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:14px;height:14px;flex-shrink:0;color:var(--accent-success);"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
              <span style="color:var(--accent-success);">Exportar Imagem (PNG)</span>
            </button>
            <div style="padding:6px 12px 2px;font-family:var(--font-mono);font-size:9px;color:var(--ink-mute);text-transform:uppercase;letter-spacing:.1em;border-top:1px solid var(--border);border-bottom:1px solid var(--border);margin:4px 0 4px;">Manutenção</div>
            <button class="gantt-tool-item" data-action="fix-mspx-types" title="Inverte FS↔FF e SS↔SF em todas as dependências do projeto. Use só se você importou de XML do MS Project antes da versão 2.4.5.">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:14px;height:14px;flex-shrink:0;color:var(--accent-danger);"><path d="M21 12a9 9 0 1 1-3-6.7"/><polyline points="21 4 21 10 15 10"/></svg>
              <span style="color:var(--accent-danger);">Corrigir tipos FS↔FF (legado)</span>
            </button>
          </div>
        </div>
        <div style="margin-left:auto;display:flex;align-items:center;gap:16px;">
          ${delayedCount > 0 ? `<span style="font-family:var(--font-mono);font-size:11px;color:var(--accent-danger);font-weight:700;letter-spacing:0.05em;">⚠ ${delayedCount} ATRASADA${delayedCount > 1 ? 'S' : ''}</span>` : ''}
          <span style="font-family:var(--font-mono);font-size:11px;color:var(--ink-mute);letter-spacing:0.08em;">AVANÇO <strong style="color:${progressColor};font-size:13px;">${avgProgress}%</strong></span>
          <span style="font-family:var(--font-mono);font-size:11px;color:var(--ink-mute);">${State.tasks.length} TAREFAS · ${fmtDateFull(p.start_date)} → ${fmtDateFull(p.end_date)}</span>
        </div>
      </div>
      <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-bottom:10px;">
        <span style="font-family:var(--font-mono);font-size:9px;color:var(--ink-mute);text-transform:uppercase;letter-spacing:.1em;margin-right:2px;">Situação:</span>
        ${_sitChipsHtml}
        ${_basisToggle}
      </div>
      <div class="mob-gantt-hint" style="display:none;align-items:center;gap:8px;padding:8px 12px;margin-bottom:10px;background:rgba(229,75,26,0.06);border:1px solid rgba(229,75,26,0.2);border-radius:3px;font-size:12px;color:var(--ink-soft);">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 12h14"/><path d="M12 5l7 7-7 7"/></svg>
        Deslize horizontalmente para ver o cronograma completo.
      </div>
      <div class="gantt-container"><div class="gantt-scroll ${State.ganttFullWidth ? 'gantt-hide-left' : ''}" id="ganttScroll">${this.renderGantt(p)}</div></div>
    `;
  },

  renderGantt(p) {
    Perf.start('renderGantt');
    const _ret = this._renderGanttImpl(p);
    Perf.end('renderGantt');
    return _ret;
  },
  _renderGanttImpl(p) {
    // Preserva ordem da EAP: NÃO reordenar por start_date.
    const tasks = State.tasks;
    if (tasks.length === 0) return '';
    // Datas válidas só: YYYY-MM-DD com ano plausível (1990–2100). Evita que um
    // typo (ex.: ano "20226") infle o intervalo a milhões de dias e estoure a
    // string do HTML ("Invalid string length"). Datas inválidas são ignoradas.
    const _validGanttDate = s => {
      if (!s || typeof s !== 'string') return null;
      const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
      if (!m) return null;
      const y = +m[1];
      if (y < 1990 || y > 2100) return null;
      const d = new Date(s + 'T00:00:00');
      return isNaN(d.getTime()) ? null : d;
    };
    const _badDateTasks = tasks.filter(t => (t.start_date && !_validGanttDate(t.start_date)) || (t.end_date && !_validGanttDate(t.end_date)));
    if (_badDateTasks.length) console.warn('[Gantt] ' + _badDateTasks.length + ' tarefa(s) com data fora do intervalo plausível (ignoradas no eixo):', _badDateTasks.map(t => `${t.code || t.id}: ${t.start_date} → ${t.end_date}`));
    const _allValid = [];
    tasks.forEach(t => { const a = _validGanttDate(t.start_date); if (a) _allValid.push(a); const b = _validGanttDate(t.end_date); if (b) _allValid.push(b); });
    [p.start_date, p.end_date].forEach(s => { const d = _validGanttDate(s); if (d) _allValid.push(d); });
    let minDate, maxDate;
    if (_allValid.length === 0) {
      // Sem nenhuma data válida → janela padrão ao redor de hoje
      minDate = new Date(); maxDate = new Date(); maxDate.setDate(maxDate.getDate() + 30);
    } else {
      let minMs = Infinity, maxMs = -Infinity;
      for (const d of _allValid) { const ms = d.getTime(); if (ms < minMs) minMs = ms; if (ms > maxMs) maxMs = ms; }
      minDate = new Date(minMs); maxDate = new Date(maxMs);
    }
    minDate.setDate(minDate.getDate() - 2);
    maxDate.setDate(maxDate.getDate() + 2);

    let totalDays = Math.max(1, daysBetween(minDate.toISOString().slice(0,10), maxDate.toISOString().slice(0,10)));
    // Teto de segurança: ~54 anos. Protege contra qualquer caso extremo remanescente.
    const _MAX_GANTT_DAYS = 20000;
    if (totalDays > _MAX_GANTT_DAYS) {
      totalDays = _MAX_GANTT_DAYS;
      maxDate = new Date(minDate); maxDate.setDate(maxDate.getDate() + _MAX_GANTT_DAYS);
      console.warn('[Gantt] intervalo de datas excedeu o teto e foi limitado a ' + _MAX_GANTT_DAYS + ' dias.');
    }
    let cellWidth = 28;
    if (State.ganttZoom === 'week') cellWidth = 14;
    if (State.ganttZoom === 'month') cellWidth = 6;
    const totalWidth = totalDays * cellWidth;
    const todayStr = today();

    // Build month/year groups for the top header row
    const _mGroups = [];
    for (let i = 0; i < totalDays; i++) {
      const d = new Date(minDate); d.setDate(d.getDate() + i);
      const key = d.getMonth() + '-' + d.getFullYear();
      const last = _mGroups[_mGroups.length - 1];
      if (!last || last.key !== key) _mGroups.push({ key, count: 1, d: new Date(d) });
      else last.count++;
    }
    let headerMonthCells = '';
    for (const g of _mGroups) {
      const label = g.d.toLocaleDateString('pt-BR', { month: 'short', year: 'numeric' });
      headerMonthCells += `<div class="gantt-header-month-cell" style="width:${g.count * cellWidth}px;min-width:${g.count * cellWidth}px;">${label}</div>`;
    }

    let headerCells = '', cellsTemplate = '';
    for (let i = 0; i < totalDays; i++) {
      const d = new Date(minDate); d.setDate(d.getDate() + i);
      const isWeekend = d.getDay() === 0 || d.getDay() === 6;
      const isToday = d.toISOString().slice(0,10) === todayStr;
      const dayLabel = State.ganttZoom === 'day' ? d.getDate() :
                       State.ganttZoom === 'week' ? (d.getDay() === 1 ? d.getDate() : '') :
                       (d.getDate() === 1 ? d.toLocaleDateString('pt-BR', { month: 'short' }).toUpperCase() : '');
      headerCells += `<div class="gantt-header-cell ${isWeekend ? 'weekend' : ''} ${isToday ? 'today' : ''}" style="width:${cellWidth}px;min-width:${cellWidth}px;">${dayLabel}</div>`;
      cellsTemplate += `<div class="gantt-cell ${isWeekend ? 'weekend' : ''} ${isToday ? 'today-line' : ''}" style="width:${cellWidth}px;min-width:${cellWidth}px;"></div>`;
    }

    // Calcula caminho crítico
    const cpm = (tasks === State.tasks) ? CPMCache.get(State.tasks, State.dependencies) : computeCriticalPath(tasks, State.dependencies);

    // taskPos é calculado DEPOIS de obter visibleTasks (ordem WBS) — veja abaixo
    const rowHeight = 44;

    // ── Compute WBS codes and depths ─────────────────────────────────────────
    const wbsCodes = new Map();
    const wbsDepths = new Map();
    const byParent = new Map();
    tasks.forEach(t => {
      const pid = t.parent_id || null;
      if (!byParent.has(pid)) byParent.set(pid, []);
      byParent.get(pid).push(t);
    });
    const assignWbs = (parentId, prefix, depth) => {
      const kids = byParent.get(parentId) || [];
      kids.forEach((t, i) => {
        const code = prefix + (i + 1);
        wbsCodes.set(t.id, code);
        wbsDepths.set(t.id, depth);
        assignWbs(t.id, code + '.', depth + 1);
      });
    };
    assignWbs(null, '', 1);
    // Tasks sem parent_id que não apareceram no byParent(null): fallback sequencial
    tasks.forEach((t, i) => {
      if (!wbsCodes.has(t.id)) { wbsCodes.set(t.id, String(i + 1)); wbsDepths.set(t.id, 1); }
    });

    // PERF: pré-calcula índices O(1) usados em hasChildren/isHidden
    const _taskById = new Map();
    const _parentIdsSet = new Set();
    for (const tk of tasks) {
      _taskById.set(tk.id, tk);
      if (tk.parent_id) _parentIdsSet.add(tk.parent_id);
    }
    const hasChildren = (taskId) => _parentIdsSet.has(taskId);
    // Filtro rápido por SITUAÇÃO (selo): usa _ganttSitCache pré-computado em gantt().
    const _sitFilter = State.ganttSituacaoFilter || 'all';
    let _sitVisibleSet = null;
    if (_sitFilter !== 'all') {
      _sitVisibleSet = new Set();
      tasks.forEach(t => {
        if (t.inactive) return;
        const _s = _ganttSitCache?.get(t.id) ?? taskSituacao(t, _ganttFcCache || new Map(), todayStr, State.situacaoBasis);
        if (_s === _sitFilter) {
          _sitVisibleSet.add(t.id);
          let pid = t.parent_id, g = 0;
          while (pid && g++ < 50) { _sitVisibleSet.add(pid); pid = _taskById.get(pid)?.parent_id || null; }
        }
      });
    }
    // ── Filtra por nível e colapso ────────────────────────────────────────────
    const isHidden = (task) => {
      if (_sitVisibleSet && !_sitVisibleSet.has(task.id)) return true;
      // Filtro de nível (dropdown dinâmico): "N" oculta tudo mais fundo que o nível N
      const depth = wbsDepths.get(task.id) || 1;
      const _lf = State.ganttLevelFilter;
      if (_lf && _lf !== 'all') { const _maxLvl = parseInt(_lf, 10); if (!isNaN(_maxLvl) && depth > _maxLvl) return true; }
      // Colapso: ocultar se algum ancestral está colapsado (lookup O(1) via _taskById)
      let pid = task.parent_id;
      while (pid) {
        if (State.ganttCollapsed.has(pid)) return true;
        pid = _taskById.get(pid)?.parent_id || null;
      }
      return false;
    };

    // Ordena por EAP (hierarquia): 1, 1.1, 1.2, 2, 2.1, ...
    const wbsCompare = (a, b) => {
      const ca = (wbsCodes.get(a.id) || '').split('.').map(Number);
      const cb = (wbsCodes.get(b.id) || '').split('.').map(Number);
      for (let i = 0; i < Math.max(ca.length, cb.length); i++) {
        const pa = ca[i] ?? 0, pb = cb[i] ?? 0;
        if (pa !== pb) return pa - pb;
      }
      return 0;
    };
    const visibleTasks = tasks.filter(t => !isHidden(t)).sort(wbsCompare);

    // Número de linha (1,2,3…) ESTÁVEL — estilo MS Project, para as predecessoras.
    // Calculado sobre TODAS as tarefas do projeto (não só as visíveis), na mesma
    // ordem de EAP. Antes era calculado só sobre `visibleTasks`: colapsar uma fase
    // escondia as filhas e RENUMERAVA tudo que vinha depois na lista — quebrando
    // a coluna "#" e também apagando referências de predecessora que apontavam
    // para uma tarefa temporariamente oculta (a linha "some" da tabela, mas o
    // vínculo interno continua existindo). Agora o número de uma tarefa nunca
    // muda, esteja ela visível ou oculta por colapso/filtro de nível/situação.
    const _allSortedTasks = [...tasks].sort(wbsCompare);
    const rowNumbers = new Map();
    _allSortedTasks.forEach((tk, i) => rowNumbers.set(tk.id, i + 1));
    Views._rowNumbers = rowNumbers;
    Views._rowNumberToId = new Map(_allSortedTasks.map((tk, i) => [i + 1, tk.id]));

    // Indexa posição de cada tarefa APÓS ordenar por WBS para setas SVG ficarem corretas.
    // Alturas das linhas (sincronizadas com .gantt-row / .gantt-row-subtask no CSS):
    // demais 50px, subtarefas (eapDepth > 1) 46px — espaço para nome (2 linhas) + responsável.
    // A barra (h:24) é centralizada verticalmente; o conector ancora no centro da linha.
    const ROW_H = 54, ROW_H_SUB = 50;
    const taskPos = new Map();
    let _yAcc = 0;
    visibleTasks.forEach((tk, idx) => {
      const rowH = ((wbsDepths.get(tk.id) || 1) > 1) ? ROW_H_SUB : ROW_H;
      const startOffset = daysBetween(minDate.toISOString().slice(0,10), tk.start_date) * cellWidth;
      // Marco tem largura zero (início = término): o conector ancora no centro do losango,
      // não uma célula à direita. Tarefas normais usam a largura real da barra.
      const duration = tk.is_milestone ? 0 : Math.max(1, daysBetween(tk.start_date, tk.end_date)) * cellWidth;
      taskPos.set(tk.id, { idx, startX: startOffset, endX: startOffset + duration, y: _yAcc + rowH / 2 });
      _yAcc += rowH;
    });
    const _totalRowsHeight = _yAcc;

    // Colunas exibíveis do painel esquerdo (exibição + largura configuráveis)
    const _gCols = GanttCols.cols();
    const _gGrid = GanttCols.gridTemplate();
    const _leftW = GanttCols.leftWidth();

    // Lookups O(1) — evita .find()/.filter() por linha (O(n²) em projetos grandes)
    const _memberById = new Map(State.members.map(m => [m.id, m]));
    const _discById = new Map(State.disciplines.map(d => [d.id, d]));
    // Dependências indexadas por tarefa (a coluna "Preds." fazia filter por linha → O(n²))
    const _depsByTask = new Map();
    (State.dependencies || []).forEach(d => {
      if (!_depsByTask.has(d.task_id)) _depsByTask.set(d.task_id, []);
      _depsByTask.get(d.task_id).push(d);
    });
    // Reutiliza _ganttFcCache pré-populado em gantt() — evita recomputar forecastEndDate
    // no loop de linhas para tarefas já calculadas na passagem de contagem de chips.
    const _showForecast = _gCols.some(c => c.id === 'forecast_end' || c.id === 'delay_lb' || c.id === 'situacao');
    const _fcCache = _ganttFcCache || new Map();

    let rows = '';
    visibleTasks.forEach((task, taskIdx) => {
      const pos = taskPos.get(task.id);
      const startOffset = pos.startX;
      const duration = pos.endX - pos.startX;
      const member = _memberById.get(task.assignee_id);
      const disc = _discById.get(task.discipline_id);
      const isCritical = cpm.criticalIds.has(task.id);
      const violation = cpm.violations.get(task.id);
      const isMilestone = !!task.is_milestone;
      const baseColor = task.status === 'concluido' ? 'var(--accent-success)' :
                    task.status === 'em_andamento' ? 'var(--accent)' :
                    task.status === 'bloqueada' ? 'var(--accent-danger)' : 'var(--blueprint)';
      const barColor = isCritical ? '#c0160a' : baseColor;
      const progressVal = (parseFloat(task.progress) || 0).toFixed((parseFloat(task.progress) || 0) % 1 === 0 ? 0 : 2);

      // EAP hierárquico (ex.: 1, 1.1, 1.1.2)
      const eapNum = wbsCodes.get(task.id) || (taskIdx + 1);
      const eapDepth = wbsDepths.get(task.id) || 1;
      const indentPx = (eapDepth - 1) * 14;

      // Altura da linha + posição vertical (centralizada) da barra/marco
      const _rowH = eapDepth > 1 ? ROW_H_SUB : ROW_H;
      const _barTop = Math.round((_rowH - 24) / 2);
      const _msTop  = Math.round((_rowH - 16) / 2);
      // Tooltip da barra: nome, início, término e responsável
      const _tipName = member ? member.name : 'Sem responsável';
      const _barTip = `${task.title}\nInício: ${fmtDateShort(task.start_date)}    Término: ${isMilestone ? '—' : fmtDateShort(task.end_date)}\nResponsável: ${_tipName}`
        + `${hasChildren(task.id) ? '\n(tarefa pai — não arrastável)' : ''}`
        + `${isCritical ? '\n● Caminho crítico' : ''}`
        + `${violation ? '\n⚠ ' + violation.message : ''}`;

      // Atraso = término planejado vs. HOJE, só para tarefas ainda NÃO medidas a 100%.
      // Tarefa 100%/concluída não tem atraso (✓); término no futuro também não (clamp em 0).
      const _done = (parseFloat(task.progress) || 0) >= 100 || task.status === 'concluido';
      const atrasoVal = (_done || task.inactive)
        ? 0
        : Math.max(0, daysBetween(task.end_date, todayStr));
      // Causa de não cumprimento (tarefa atrasada)
      const _causeLbl = task.delay_cause ? (DELAY_CAUSES[task.delay_cause] || PPC_CAUSES[task.delay_cause] || task.delay_cause) : '';
      const _causeTip = _causeLbl ? `Causa: ${_causeLbl}${task.delay_note ? ' — ' + task.delay_note : ''}` : '';
      const _atrasoTipBase = `${atrasoVal} dia(s) de atraso · término ${fmtDateShort(task.end_date)} já passou de hoje`;
      const atrasoHtml = _done
        ? `<span style="color:var(--accent-success);font-size:13px;">✓</span>`
        : atrasoVal > 0
          ? `<span style="color:var(--accent-danger);" title="${escapeHtml(_causeTip || _atrasoTipBase)}">+${atrasoVal}d${_causeLbl ? ' <span style=\"font-size:9px;opacity:.8;\">●</span>' : ''}</span>`
          : `<span style="color:var(--ink-mute);font-size:10px;">—</span>`;

      // Previsão de novo término (ritmo real) — só quando faz sentido E a coluna está visível
      const _fc = _showForecast ? forecastEndDate(task, _fcCache) : null;
      const _fcDelta = _fc ? daysBetween(task.end_date, _fc) : 0; // >0 = estoura o prazo
      const _fcColor = !_fc ? 'var(--ink-mute)' : (_fcDelta > 0 ? 'var(--accent-danger)' : 'var(--accent-success)');
      const forecastHtml = _fc
        ? `<span style="color:${_fcColor};font-weight:600;" title="${_fcDelta > 0 ? '+' + _fcDelta + ' dia(s) vs. planejado' : (_fcDelta < 0 ? _fcDelta + ' dia(s) vs. planejado' : 'dentro do prazo')} — estimado pelo ritmo de avanço">${fmtDateShort(_fc)}</span>`
        : `<span style="color:var(--ink-mute);font-size:10px;opacity:.5;">—</span>`;

      // Restrição: ícone para mostrar na coluna de nome
      let constraintIcon = '';
      if (task.constraint_type && task.constraint_type !== 'ASAP' && task.constraint_type !== 'ALAP') {
        const def = CONSTRAINT_TYPES[task.constraint_type];
        const tooltip = `${task.constraint_type} ${def?.label || ''} ${task.constraint_date ? fmtDateFull(task.constraint_date) : ''}${task.constraint_reason ? ' — ' + task.constraint_reason : ''}`;
        constraintIcon = `<span class="constraint-icon" title="${escapeHtml(tooltip)}">${def?.icon || '🔒'}</span>`;
      }
      // Violação: ícone laranja piscando
      const violationIcon = violation ? `<span class="violation-icon" title="${escapeHtml(violation.message)}">⚠</span>` : '';

      // Baseline (ghost bar abaixo da principal, se existir)
      let baselineGhost = '';
      if (task.baseline_start && task.baseline_end) {
        const bsOffset = daysBetween(minDate.toISOString().slice(0,10), task.baseline_start) * cellWidth;
        const bsDur = Math.max(1, daysBetween(task.baseline_start, task.baseline_end)) * cellWidth;
        baselineGhost = `<div class="gantt-baseline" style="left:${bsOffset}px;width:${bsDur}px;" title="Linha de base: ${fmtDateFull(task.baseline_start)} → ${fmtDateFull(task.baseline_end)}"></div>`;
      }

      // Renderização da barra: marco vira losango, tarefa normal vira retângulo
      const barElement = isMilestone
        ? `<div class="gantt-milestone${isCritical ? ' gantt-milestone-critical' : ''}${violation ? ' gantt-violation' : ''}" data-task-id="${task.id}" style="left:${startOffset - 8}px;top:${_msTop}px;background:${barColor};" title="${escapeHtml(_barTip)}">
            <span class="gantt-milestone-label">${escapeHtml(task.title)}</span>
          </div>`
        : `<div class="gantt-bar${isCritical ? ' gantt-bar-critical' : ''}${violation ? ' gantt-violation' : ''}" data-task-id="${task.id}"${hasChildren(task.id) ? ' data-is-parent="true"' : ''} style="left:${startOffset}px;top:${_barTop}px;width:${duration}px;background:${barColor};" title="${escapeHtml(_barTip)}">
            <div class="gantt-bar-progress" style="width:${parseFloat(task.progress) || 0}%"></div>
            <span style="position:relative;z-index:1;overflow:hidden;text-overflow:ellipsis;">${progressVal}% · ${escapeHtml(task.title)}</span>
            <div class="gantt-bar-resize"></div>
          </div>`;

      // Renderiza cada célula do painel esquerdo conforme as colunas visíveis
      const _progColor = (parseFloat(task.progress) || 0) >= 100 ? 'var(--accent-success)'
                       : (parseFloat(task.progress) || 0) > 0 ? 'var(--accent)' : 'var(--ink-mute)';
      const _cellFor = (colId) => {
        switch (colId) {
          case 'eap': {
            // Mostra o NÚMERO DA LINHA (id estilo MS Project) — base das predecessoras.
            const rowN = rowNumbers.get(task.id) || (taskIdx + 1);
            return `<div class="gantt-row-eap" style="font-size:${String(rowN).length > 3 ? '9px' : '10px'};" title="Linha ${rowN} · EAP ${eapNum}">${rowN}</div>`;
          }
          case 'name':
            return `<div class="gantt-row-name" data-task-id="${task.id}" data-field="title" style="padding-left:${4 + indentPx}px;" title="1 clique: editar · 2 cliques: abrir tarefa">
              ${hasChildren(task.id) ? `<button class="gantt-collapse-btn" data-collapse-id="${task.id}" title="${State.ganttCollapsed.has(task.id) ? 'Expandir subtarefas' : 'Recolher subtarefas'}" aria-label="${State.ganttCollapsed.has(task.id) ? 'Expandir' : 'Recolher'}">
                  <svg viewBox="0 0 12 12" width="12" height="12" fill="currentColor" style="transition:transform .18s ease;transform:${State.ganttCollapsed.has(task.id) ? 'rotate(-90deg)' : 'rotate(0deg)'};"><path d="M2 4l4 5 4-5z"/></svg>
                </button>` : '<span class="gantt-collapse-spacer"></span>'}
              <div style="width:${8 - Math.min(eapDepth-1,2)}px;height:${8 - Math.min(eapDepth-1,2)}px;border-radius:${isMilestone ? '0' : '50%'};background:${barColor};flex-shrink:0;${isMilestone ? 'transform:rotate(45deg);' : ''}opacity:${eapDepth === 1 ? 1 : 0.7};"></div>
              <div style="flex:1;min-width:0;">
                <div class="gantt-task-name">${task.inactive ? '<span style="font-family:var(--font-mono);font-size:8px;font-weight:700;color:var(--ink-mute);background:var(--bg-deep);border:1px solid var(--border-strong);border-radius:2px;padding:0 4px;margin-right:4px;text-transform:uppercase;letter-spacing:.05em;" title="Tarefa inativa — fora do caminho crítico e do progresso">⏸ Inativa</span>' : ''}${isMilestone ? '<span style="color:var(--accent-violet);font-weight:800;margin-right:3px;" title="Marco">◆</span>' : ''}${escapeHtml(task.title)} ${constraintIcon} ${violationIcon}</div>
                <div class="gantt-task-meta">${disc ? escapeHtml(disc.code + ' · ' + disc.name) : 'Sem disciplina'}</div>
              </div>
            </div>`;
          case 'duration':
            // Duração em DIAS ÚTEIS (igual ao campo dentro da tarefa). Marco não tem duração.
            return isMilestone
              ? `<div class="gantt-row-date" style="font-size:11px;color:var(--ink-mute);opacity:.5;">—</div>`
              : `<div class="gantt-row-date g-editable" data-field="duration" style="font-size:11px;" title="Dias úteis">${workingDaysBetween(task.start_date,task.end_date)}d</div>`;
          case 'baseline_start':
            return `<div class="gantt-row-date" style="${!task.baseline_start ? 'color:var(--ink-mute);opacity:.4;' : ''}">${task.baseline_start ? fmtDateShort(task.baseline_start) : '—'}</div>`;
          case 'baseline_end':
            return `<div class="gantt-row-date" style="${!task.baseline_end ? 'color:var(--ink-mute);opacity:.4;' : ''}">${task.baseline_end ? fmtDateShort(task.baseline_end) : '—'}</div>`;
          case 'start':
            return `<div class="gantt-row-date g-editable" data-field="start">${fmtDateShort(task.start_date)}</div>`;
          case 'end':
            // Marco também exibe término (= data do marco); não é editável (segue o início).
            return isMilestone
              ? `<div class="gantt-row-date" title="Marco — término igual à data do marco">${fmtDateShort(task.end_date || task.start_date)}</div>`
              : `<div class="gantt-row-date g-editable" data-field="end">${fmtDateShort(task.end_date)}</div>`;
          case 'forecast_end':
            return `<div class="gantt-row-date">${forecastHtml}</div>`;
          case 'sector':
            return `<div class="gantt-row-date g-editable" data-field="sector" style="${task.sector ? '' : 'color:var(--ink-mute);opacity:.5;'}" title="${task.sector ? escapeHtml(task.sector) : 'Sem setor'}">${task.sector ? escapeHtml(task.sector) : '—'}</div>`;
          case 'progress':
            return `<div class="gantt-row-date g-editable" data-field="progress" style="font-weight:700;color:${_progColor};">${progressVal}%</div>`;
          case 'planned_progress': {
            // % que a tarefa DEVERIA ter concluído hoje, pela mesma base do selo de
            // Situação (Linha de base ou Planejado, conforme o toggle "Base:" do Gantt).
            if (isMilestone) return `<div class="gantt-row-date" style="font-size:11px;color:var(--ink-mute);opacity:.5;">—</div>`;
            const _pp = plannedProgressPct(task, State.situacaoBasis, todayStr);
            if (_pp === null) return `<div class="gantt-row-date" style="color:var(--ink-mute);opacity:.4;">—</div>`;
            const _actual = parseFloat(task.progress) || 0;
            const _ppColor = _actual >= _pp ? 'var(--accent-success)' : 'var(--accent-danger)';
            return `<div class="gantt-row-date" style="color:${_ppColor};" title="Progresso esperado hoje, comparado ao % Concl. real">${_pp}%</div>`;
          }
          case 'predecessors': {
            // Predecessoras desta tarefa → NÚMERO DA LINHA (estilo MS Project), não EAP.
            const preds = _depsByTask.get(task.id) || [];
            const predTxt = preds.map(d => {
              const predRow = rowNumbers.get(d.predecessor_id);
              const typeTag = (d.type && d.type !== 'FS') ? (DEP_TYPE_PT[d.type] || d.type) : '';
              const lagTag  = d.lag_days ? `+${d.lag_days}d` : '';
              return predRow ? `${predRow}${typeTag}${lagTag}` : '';
            }).filter(Boolean).join(', ');
            // Editável para TODAS as tarefas — inclusive pai (fase): é assim que se liga
            // uma fase a outra (a predecessora do pai vira o "portão" das filhas).
            const _predEditable = !task.inactive;
            return `<div class="gantt-row-date${_predEditable ? ' g-editable' : ''}"${_predEditable ? ' data-field="predecessors"' : ''} style="font-size:10px;font-family:var(--font-mono);${predTxt ? 'color:var(--ink-soft);' : 'color:var(--ink-mute);opacity:.4;'}" title="${_predEditable ? (hasChildren(task.id) ? 'Predecessora da FASE — empurra as subtarefas sem predecessora. Ex.: 12, 15TT+2' : 'Clique para editar predecessoras — nº da linha, ex.: 12, 15TT+2') : (predTxt || 'Sem predecessora')}"><span style="white-space:nowrap;">${predTxt || '—'}</span></div>`;
          }
          case 'delay':
            return `<div class="gantt-row-delay">${atrasoHtml}</div>`;
          case 'delay_lb': {
            // Atraso vs linha de base = Previsão de término − Término da LB,
            // só para tarefas ainda NÃO medidas a 100%. Precisa de LB e de previsão.
            if (_done || !task.baseline_end || !_fc) return `<div class="gantt-row-date" style="color:var(--ink-mute);opacity:.4;">—</div>`;
            const _dlb = daysBetween(task.baseline_end, _fc);
            const _dlbCol = _dlb > 0 ? 'var(--accent-danger)' : (_dlb < 0 ? 'var(--accent-success)' : 'var(--ink-mute)');
            return `<div class="gantt-row-date" style="font-family:var(--font-mono);font-size:11px;color:${_dlbCol};" title="Previsão ${fmtDateShort(_fc)} vs término LB ${fmtDateShort(task.baseline_end)}">${_dlb > 0 ? '+' : ''}${_dlb}d</div>`;
          }
          case 'situacao': {
            if (task.inactive) return `<div class="gantt-row-date" style="color:var(--ink-mute);opacity:.4;">—</div>`;
            const _sit = _ganttSitCache?.get(task.id) ?? taskSituacao(task, _fcCache, todayStr, State.situacaoBasis);
            const _m = SITUACAO_META[_sit];
            const _baseLbl = State.situacaoBasis === 'planned' ? 'o planejamento (início/término atuais)' : 'a linha de base';
            const _tip = _sit === 'concluida' ? 'Concluída (100%)'
                       : _sit === 'futura'   ? `Tarefa futura — por ${_baseLbl}, ainda não deveria ter iniciado`
                       : _sit === 'atrasada' ? `Atrasada em relação a ${_baseLbl} (início que já deveria ter ocorrido, término vencido, ou previsão passando do término)`
                                             : `No prazo — dentro de ${_baseLbl}`;
            return `<div class="gantt-row-date" style="padding:2px 0;" title="${_tip}"><span style="display:inline-block;font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.04em;color:${_m.color};background:${_m.bg};border:1px solid ${_m.color};border-radius:3px;padding:1px 6px;white-space:nowrap;">${_m.label}</span></div>`;
          }
        }
        return '';
      };
      const _leftCells = _gCols.map(c => _cellFor(c.id)).join('');

      rows += `
        <div class="gantt-row${isCritical ? ' gantt-row-critical' : ''}${violation ? ' gantt-row-violation' : ''}${atrasoVal > 0 ? ' gantt-row-overdue' : ''}${eapDepth > 1 ? ' gantt-row-subtask' : ''}"${task.inactive ? ' style="opacity:.5;"' : ''}>
          <div class="gantt-row-left" data-task-id="${task.id}" style="width:${_leftW}px;grid-template-columns:${_gGrid};">
            ${_leftCells}
          </div>
          ${State.ganttChartVisible ? `<div class="gantt-row-timeline" style="width:${totalWidth}px;">
            ${cellsTemplate}
            ${baselineGhost}
            ${barElement}
          </div>` : ''}
        </div>
      `;
    });

    const svgArrows = '';

    const _headerCells = _gCols.map((c, i) => {
      const align = c.id === 'eap' ? 'justify-content:center;' : c.id === 'name' ? 'justify-content:flex-start;' : '';
      // Handle de redimensionamento na borda direita (exceto na última coluna)
      const handle = i < _gCols.length - 1 ? `<span class="gantt-col-resize" data-col-resize="${c.id}" title="Arraste para ajustar a largura"></span>` : '';
      // "#" e "Descrição" ficam fixas; as demais podem ser arrastadas para reordenar.
      const pinned = (c.id === 'eap' || c.id === 'name');
      const drag = pinned ? '' : ` draggable="true" data-col-id="${c.id}" title="Arraste para reordenar"`;
      return `<div class="gantt-col-head${pinned ? '' : ' gantt-col-draggable'}"${drag} style="${align}position:relative;${pinned ? '' : 'cursor:grab;'}">${c.label}${handle}</div>`;
    }).join('');

    return `
      <div class="gantt-header">
        <div class="gantt-header-left" style="width:${_leftW}px;grid-template-columns:${_gGrid};">
          ${_headerCells}
        </div>
        ${State.ganttChartVisible ? `<div class="gantt-header-timeline" style="width:${totalWidth}px;">
          <div class="gantt-header-month-row">${headerMonthCells}</div>
          <div class="gantt-header-day-row">${headerCells}</div>
        </div>` : ''}
      </div>
      <div style="position:relative;">
        ${rows}
        ${svgArrows}
      </div>
    `;
  },

  tasks() {
    const p = this.current();
    if (!p) return this.emptyProject();
    const f = State.taskFilters;
    const mode = State.taskViewMode;
    const groupBy = State.taskGroupBy;

    // === FILTRAR TAREFAS ===
    // Tarefas PAI (com filhas) nunca aparecem na Gestão de Tarefas — em nenhum modo.
    // O status/progresso delas é sempre derivado das subtarefas (visíveis no Gantt).
    const _parentIds = new Set(State.tasks.filter(t => t.parent_id).map(t => t.parent_id));
    // Tarefas inativas só aparecem no Gantt — ficam fora da Gestão de Tarefas
    let filtered = State.tasks.filter(t => !_parentIds.has(t.id) && !t.inactive);
    // Automação Tier 1: arquiva concluídas há N dias (oculta da Lista/Kanban/Tabela)
    filtered = filtered.filter(t => !Automation.isArchived(t));
    if (f.search) {
      const q = f.search.toLowerCase();
      filtered = filtered.filter(t => t.title.toLowerCase().includes(q) || (t.code || '').toLowerCase().includes(q));
    }
    if (f.status !== 'all') filtered = filtered.filter(t => t.status === f.status);
    if (f.priority !== 'all') filtered = filtered.filter(t => t.priority === f.priority);
    if (f.assignee !== 'all') filtered = filtered.filter(t => (t.assignee_id || 'none') === f.assignee);
    if (f.discipline !== 'all') filtered = filtered.filter(t => (t.discipline_id || 'none') === f.discipline);
    if (f.label !== 'all') filtered = filtered.filter(t => State.taskLabels.some(tl => tl.task_id === t.id && tl.label_id === f.label));
    if (f.sector && f.sector !== 'all') filtered = filtered.filter(t => (t.sector || '__none__') === f.sector);
    if (f.overdue) { const _t = today(); filtered = filtered.filter(t => t.status !== 'concluido' && t.end_date && t.end_date < _t); }
    const _tdf = State.dateFilters.tasks;
    if (_tdf && (_tdf.from || _tdf.to)) filtered = filtered.filter(t => DateFilter.match(t.end_date, _tdf.from, _tdf.to));

    // Contadores para badge de filtro ativo (apenas folhas, já que pais não aparecem aqui)
    const totalTasks = State.tasks.length - _parentIds.size;
    const activeFilters = Object.values(f).filter(v => v !== 'all' && v !== '' && v !== false).length
      + ((_tdf && (_tdf.from || _tdf.to)) ? 1 : 0);

    // Membros e disciplinas para selects
    const members = State.members;
    const disciplines = State.disciplines;
    const labels = State.labels;
    // Setores: cadastrados (State.sectors) ∪ os já presentes nas tarefas
    const sectors = [...new Set((State.sectors || []).map(s => s.name).concat(State.tasks.map(t => t.sector).filter(Boolean)))].sort((a, b) => a.localeCompare(b));
    const statusOpts = KanbanConfig.get().map(c => ({ id: c.id, label: c.label }));
    const prioOpts = [
      { id: 'baixa', label: 'Baixa' }, { id: 'media', label: 'Média' }, { id: 'alta', label: 'Alta' }, { id: 'critica', label: 'Crítica' },
    ];

    // === HTML ===
    return `
      <div class="page-title-block">
        <div class="page-eyebrow">TAREFAS · ${mode === 'kanban' ? 'KANBAN' : mode === 'list' ? 'LISTA' : 'TABELA'}${activeFilters > 0 ? ` · ${activeFilters} FILTRO${activeFilters > 1 ? 'S' : ''}` : ''}</div>
        <div class="page-title">Gestão de Tarefas</div>
        <div class="page-subtitle">${filtered.length} de ${totalTasks} tarefa${totalTasks !== 1 ? 's' : ''}${activeFilters > 0 ? ' (filtradas)' : ''}${DateFilter.label('tasks') ? ` · <span style="color:var(--accent);">término ${DateFilter.label('tasks')}</span>` : ''}</div>
      </div>

      <!-- TOOLBAR: TOGGLE + AGRUPAMENTO -->
      <div style="display:flex;gap:10px;align-items:center;margin-bottom:12px;flex-wrap:wrap;">
        <div style="display:flex;border:1px solid var(--border);border-radius:3px;overflow:hidden;">
          <button class="btn ${mode === 'list' ? 'btn-cta' : 'btn-ghost'}" data-action="task-mode" data-mode="list" style="border-radius:0;padding:6px 14px;font-size:11px;">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:14px;height:14px;margin-right:4px;vertical-align:-2px;"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><circle cx="3.5" cy="6" r="1"/><circle cx="3.5" cy="12" r="1"/><circle cx="3.5" cy="18" r="1"/></svg>
            Lista
          </button>
          <button class="btn ${mode === 'kanban' ? 'btn-cta' : 'btn-ghost'}" data-action="task-mode" data-mode="kanban" style="border-radius:0;padding:6px 14px;font-size:11px;">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:14px;height:14px;margin-right:4px;vertical-align:-2px;"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/></svg>
            Kanban
          </button>
          <button class="btn ${mode === 'table' ? 'btn-cta' : 'btn-ghost'}" data-action="task-mode" data-mode="table" style="border-radius:0;padding:6px 14px;font-size:11px;">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:14px;height:14px;margin-right:4px;vertical-align:-2px;"><rect x="3" y="3" width="18" height="18" rx="1"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="3" y1="15" x2="21" y2="15"/><line x1="9" y1="3" x2="9" y2="21"/></svg>
            Tabela
          </button>
        </div>

        <label style="font-family:var(--font-mono);font-size:10px;color:var(--ink-mute);text-transform:uppercase;letter-spacing:0.1em;">Agrupar:</label>
        <select class="form-input" id="taskGroupBy" style="width:auto;min-width:140px;font-size:12px;padding:5px 10px;">
          <option value="status" ${groupBy === 'status' ? 'selected' : ''}>Status</option>
          <option value="stage" ${groupBy === 'stage' ? 'selected' : ''}>Etapa (atividade pai)</option>
          <option value="discipline" ${groupBy === 'discipline' ? 'selected' : ''}>Disciplina</option>
          <option value="assignee" ${groupBy === 'assignee' ? 'selected' : ''}>Responsável</option>
          <option value="sector" ${groupBy === 'sector' ? 'selected' : ''}>Setor</option>
          <option value="priority" ${groupBy === 'priority' ? 'selected' : ''}>Prioridade</option>
          <option value="none" ${groupBy === 'none' ? 'selected' : ''}>Sem agrupamento</option>
        </select>

        ${activeFilters > 0 ? `<button class="btn btn-ghost" data-action="clear-task-filters" style="font-size:11px;color:var(--accent-danger);padding:5px 10px;">✕ Limpar filtros</button>` : ''}
      </div>

      <!-- FILTROS AVANÇADOS -->
      <div style="display:flex;gap:8px;margin-bottom:16px;flex-wrap:wrap;align-items:center;">
        <input type="text" class="form-input" id="taskSearch" placeholder="Buscar por título ou código..." value="${escapeHtml(f.search)}" style="width:220px;font-size:12px;padding:6px 10px;">
        <select class="form-input" id="taskFltStatus" style="width:auto;font-size:12px;padding:5px 10px;">
          <option value="all">Status: Todos</option>
          ${statusOpts.map(o => `<option value="${o.id}" ${f.status === o.id ? 'selected' : ''}>${o.label}</option>`).join('')}
        </select>
        <button id="taskFltOverdue" class="btn" style="font-size:12px;padding:5px 11px;display:inline-flex;align-items:center;gap:6px;border:1px solid ${f.overdue ? 'var(--accent-danger)' : 'var(--border-strong)'};background:${f.overdue ? 'rgba(193,59,18,0.10)' : 'transparent'};color:${f.overdue ? 'var(--accent-danger)' : 'var(--ink-soft)'};" title="Mostrar só tarefas atrasadas">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" style="width:13px;height:13px;"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
          Atrasadas
        </button>
        <select class="form-input" id="taskFltPriority" style="width:auto;font-size:12px;padding:5px 10px;">
          <option value="all">Prioridade: Todas</option>
          ${prioOpts.map(o => `<option value="${o.id}" ${f.priority === o.id ? 'selected' : ''}>${o.label}</option>`).join('')}
        </select>
        <select class="form-input" id="taskFltAssignee" style="width:auto;font-size:12px;padding:5px 10px;">
          <option value="all">Responsável: Todos</option>
          <option value="none" ${f.assignee === 'none' ? 'selected' : ''}>Sem responsável</option>
          ${members.map(m => `<option value="${m.id}" ${f.assignee === m.id ? 'selected' : ''}>${escapeHtml(m.name)}</option>`).join('')}
        </select>
        ${disciplines.length > 0 ? `
          <select class="form-input" id="taskFltDiscipline" style="width:auto;font-size:12px;padding:5px 10px;">
            <option value="all">Disciplina: Todas</option>
            ${disciplines.map(d => `<option value="${d.id}" ${f.discipline === d.id ? 'selected' : ''}>${escapeHtml(d.code)} · ${escapeHtml(d.name)}</option>`).join('')}
          </select>
        ` : ''}
        ${labels.length > 0 ? `
          <select class="form-input" id="taskFltLabel" style="width:auto;font-size:12px;padding:5px 10px;">
            <option value="all">Etiqueta: Todas</option>
            ${labels.map(l => `<option value="${l.id}" ${f.label === l.id ? 'selected' : ''}>${escapeHtml(l.name)}</option>`).join('')}
          </select>
        ` : ''}
        ${sectors.length > 0 ? `
          <select class="form-input" id="taskFltSector" style="width:auto;font-size:12px;padding:5px 10px;">
            <option value="all">Setor: Todos</option>
            <option value="__none__" ${f.sector === '__none__' ? 'selected' : ''}>Sem setor</option>
            ${sectors.map(s => `<option value="${escapeHtml(s)}" ${f.sector === s ? 'selected' : ''}>${escapeHtml(s)}</option>`).join('')}
          </select>
        ` : ''}
        ${DateFilter.ui('tasks')}
      </div>

      <!-- CONTEÚDO: KANBAN · LISTA · TABELA -->
      ${(() => {
        // Paginação do Kanban: pré-computa e guarda as listas completas para o "Ver mais"
        if (mode === 'kanban') {
          const cols = KanbanConfig.get();
          // Contexto de lookups O(1) para os cards (evita 5 varreduras O(n) por card)
          const _cardCtx = {
            memberById: new Map(State.members.map(m => [m.id, m])),
            taskById: new Map(State.tasks.map(tk => [tk.id, tk])),
            discById: new Map((State.disciplines||[]).map(d => [d.id, d])),
            childrenByParent: new Map(),
            rootsOrder: [],
            predCountByTask: new Map(),
            labelById: new Map(State.labels.map(l => [l.id, l])),
            labelsByTask: new Map(),
          };
          State.tasks.forEach(tk => {
            if (tk.parent_id) {
              if (!_cardCtx.childrenByParent.has(tk.parent_id)) _cardCtx.childrenByParent.set(tk.parent_id, []);
              _cardCtx.childrenByParent.get(tk.parent_id).push(tk);
            } else {
              _cardCtx.rootsOrder.push(tk);
            }
          });
          State.dependencies.forEach(d => _cardCtx.predCountByTask.set(d.task_id, (_cardCtx.predCountByTask.get(d.task_id) || 0) + 1));
          State.taskLabels.forEach(tl => {
            const lab = _cardCtx.labelById.get(tl.label_id);
            if (!lab) return;
            if (!_cardCtx.labelsByTask.has(tl.task_id)) _cardCtx.labelsByTask.set(tl.task_id, []);
            _cardCtx.labelsByTask.get(tl.task_id).push(lab);
          });
          Views._cardCtx = _cardCtx;
          Views._kanbanColCache = {};
          if (groupBy === 'status') {
            cols.forEach(col => { Views._kanbanColCache[col.id] = filtered.filter(t => t.status === col.id); });
          } else {
            this.groupTasks(filtered, groupBy).forEach(g => { Views._kanbanColCache[g.key] = g.items; });
          }
        }
        if (filtered.length === 0 && totalTasks > 0) {
          return `<div class="empty-state" style="padding:48px 20px;">
            <div class="empty-state-icon"><svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/><line x1="11" y1="8" x2="11" y2="14"/><line x1="8" y1="11" x2="14" y2="11"/></svg></div>
            <div class="empty-state-title">Nenhuma tarefa com esses filtros</div>
            <div class="empty-state-sub">Tente ampliar os critérios ou limpe os filtros para ver todas as ${totalTasks} tarefas.</div>
            <button class="btn btn-cta" data-action="clear-task-filters" style="margin-top:8px;">✕ Limpar filtros</button>
          </div>`;
        }
        if (totalTasks === 0) {
          return `<div class="empty-state" style="padding:48px 20px;">
            <div class="empty-state-icon"><svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="9" y1="21" x2="9" y2="9"/></svg></div>
            <div class="empty-state-title">Nenhuma tarefa ainda</div>
            <div class="empty-state-sub">Crie a primeira tarefa do projeto para começar a acompanhar o andamento.</div>
            <button class="btn btn-cta" data-action="new-task" style="margin-top:8px;">+ Nova Tarefa</button>
          </div>`;
        }
        return mode === 'kanban' ? this.tasksKanban(filtered, groupBy) : mode === 'list' ? this.tasksRows(filtered, groupBy) : this.tasksList(filtered, groupBy);
      })()}
    `;
  },

  // ===== KANBAN VIEW (com agrupamento) =====
  // Paginação: renderiza PAGE_SIZE cards por coluna; o botão "Ver mais" injeta o lote seguinte
  // sem re-render completo — evita travar o scroll em projetos grandes (500+ tarefas).
  _kanbanPageSize: 30,
  _kanbanLoadMore(listEl, allTasks, from) {
    const btn = listEl.querySelector('.kanban-load-more-btn');
    if (btn) { btn.disabled = true; btn.textContent = 'Carregando…'; }
    const page = Views._kanbanPageSize;
    const next = allTasks.slice(from, from + page);
    next.forEach(t => {
      const div = document.createElement('div');
      div.innerHTML = Views.taskCard(t);
      while (div.firstChild) listEl.insertBefore(div.firstChild, listEl.querySelector('.kanban-load-more-btn'));
    });
    const newFrom = from + next.length;
    if (btn) {
      if (newFrom >= allTasks.length) { btn.remove(); }
      else { btn.disabled = false; btn.dataset.from = String(newFrom); btn.textContent = `Ver mais (${allTasks.length - newFrom} restantes)`; }
    }
    // Re-bind drag para os novos cards
    if (window.UI && UI.bindKanbanDrag) UI.bindKanbanDrag();
  },
  tasksKanban(filtered, groupBy) {
    const groups = this.groupTasks(filtered, groupBy);
    const PAGE = this._kanbanPageSize;
    if (groupBy === 'status') {
      // Kanban: colunas configuráveis via KanbanConfig
      const cols = KanbanConfig.get();
      const colCount = Math.max(cols.length, 1);
      return `
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:10px;">
          <span style="font-size:11px;color:var(--ink-mute);font-family:var(--font-mono);">${cols.length} colunas</span>
          <button class="btn btn-ghost" data-action="open-kanban-config" style="font-size:11px;padding:3px 10px;margin-left:auto;">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="margin-right:4px;"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
            Configurar Colunas
          </button>
        </div>
        <div class="kanban-board" style="grid-template-columns:repeat(${colCount},1fr);">
          ${cols.map(col => {
            const tasksInCol = filtered.filter(t => t.status === col.id);
            const visible = tasksInCol.slice(0, PAGE);
            const remaining = tasksInCol.length - visible.length;
            return `<div class="kanban-col">
              <div class="kanban-col-head">
                <div class="kanban-col-dot" style="background:${col.color}"></div>
                <div class="kanban-col-title">${escapeHtml(col.label)}</div>
                <div class="kanban-col-count">${tasksInCol.length}</div>
              </div>
              <div class="kanban-list" data-status="${col.id}" data-col-id="${col.id}">
                ${tasksInCol.length === 0
                  ? `<div class="kanban-empty">Nenhuma tarefa aqui</div>`
                  : visible.map(t => this.taskCard(t)).join('')}
                ${remaining > 0 ? `<button class="kanban-load-more-btn btn btn-ghost" data-action="kanban-load-more" data-col-status="${col.id}" data-from="${PAGE}" style="width:100%;margin-top:6px;padding:7px;font-size:11px;color:var(--ink-mute);border:1px dashed var(--border);">Ver mais (${remaining} restantes)</button>` : ''}
              </div>
            </div>`;
          }).join('')}
        </div>`;
    }
    // Agrupamento customizado em kanban: cada grupo = seção vertical (também paginado)
    return `<div style="display:flex;flex-direction:column;gap:18px;">
      ${groups.map(g => {
        const visible = g.items.slice(0, PAGE);
        const remaining = g.items.length - visible.length;
        return `
        <div class="panel">
          <div class="panel-head"><div class="panel-title">${escapeHtml(g.label)}</div><div class="panel-title-mono">${g.items.length}</div></div>
          <div class="panel-body" style="padding:0;">
            <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:10px;padding:14px;" data-group-key="${escapeHtml(g.key)}">
              ${visible.map(t => this.taskCard(t)).join('')}
              ${remaining > 0 ? `<button class="kanban-load-more-btn btn btn-ghost" data-action="kanban-load-more" data-group-key="${escapeHtml(g.key)}" data-from="${PAGE}" style="grid-column:1/-1;padding:8px;font-size:11px;color:var(--ink-mute);border:1px dashed var(--border);">Ver mais (${remaining} restantes)</button>` : ''}
            </div>
          </div>
        </div>`;
      }).join('')}
    </div>`;
  },

  // ===== LIST/TABLE VIEW =====
  tasksList(filtered, groupBy) {
    const sc = State.taskSortCol;
    const sd = State.taskSortDir;
    // Lookups O(1) — o comparador de sort roda O(n log n) vezes; .find() dentro dele era O(n²ˡᵒᵍⁿ)
    const _memberById = new Map(State.members.map(m => [m.id, m]));
    const _discById = new Map(State.disciplines.map(d => [d.id, d]));
    const _taskById = new Map(State.tasks.map(tk => [tk.id, tk]));
    const _labelById = new Map(State.labels.map(l => [l.id, l]));
    const _labelsByTaskId = new Map();
    State.taskLabels.forEach(tl => {
      if (!_labelsByTaskId.has(tl.task_id)) _labelsByTaskId.set(tl.task_id, []);
      const lab = _labelById.get(tl.label_id);
      if (lab) _labelsByTaskId.get(tl.task_id).push(lab);
    });
    // Sortear
    const sorted = [...filtered].sort((a, b) => {
      let va = a[sc], vb = b[sc];
      if (sc === 'assignee') {
        va = _memberById.get(a.assignee_id)?.name || 'zzz';
        vb = _memberById.get(b.assignee_id)?.name || 'zzz';
      }
      if (sc === 'discipline') {
        va = _discById.get(a.discipline_id)?.code || 'zzz';
        vb = _discById.get(b.discipline_id)?.code || 'zzz';
      }
      if (va == null) va = ''; if (vb == null) vb = '';
      const cmp = String(va).localeCompare(String(vb), 'pt-BR', { numeric: true });
      return sd === 'asc' ? cmp : -cmp;
    });

    const groups = groupBy === 'none' ? [{ label: '', items: sorted }] : this.groupTasks(sorted, groupBy);
    const arrow = (col) => sc === col ? (sd === 'asc' ? ' ▲' : ' ▼') : '';
    const thStyle = 'cursor:pointer;user-select:none;white-space:nowrap;padding:8px 10px;font-family:var(--font-mono);font-size:11px;color:var(--ink-mute);text-transform:uppercase;letter-spacing:0.1em;border-bottom:1px solid var(--border);';
    const tdStyle = 'padding:8px 10px;border-bottom:1px solid var(--border);font-size:14px;';

    return groups.map(g => `
      ${g.label ? `<div style="font-family:var(--font-mono);font-size:10px;color:var(--ink-mute);text-transform:uppercase;letter-spacing:0.12em;padding:12px 0 6px;border-bottom:2px solid var(--accent);margin-bottom:4px;">${escapeHtml(g.label)} · ${g.items.length}</div>` : ''}
      <div style="overflow-x:auto;margin-bottom:16px;">
        <table style="width:100%;border-collapse:collapse;">
          <thead><tr>
            <th style="${thStyle}" data-sort="code">CÓD${arrow('code')}</th>
            <th style="${thStyle}" data-sort="title">TÍTULO${arrow('title')}</th>
            <th style="${thStyle}" data-sort="status">STATUS${arrow('status')}</th>
            <th style="${thStyle}" data-sort="priority">PRIO${arrow('priority')}</th>
            <th style="${thStyle}" data-sort="assignee">RESPONSÁVEL${arrow('assignee')}</th>
            <th style="${thStyle}" data-sort="sector">SETOR${arrow('sector')}</th>
            <th style="${thStyle}" data-sort="discipline">DISC${arrow('discipline')}</th>
            <th style="${thStyle}" data-sort="end_date">PRAZO${arrow('end_date')}</th>
            <th style="${thStyle}" data-sort="progress">PROG${arrow('progress')}</th>
          </tr></thead>
          <tbody>
            ${g.items.map(t => {
              const member = _memberById.get(t.assignee_id);
              const disc = _discById.get(t.discipline_id);
              const isOverdue = t.status !== 'concluido' && t.end_date < today();
              const statusColors = { a_fazer: 'var(--ink-mute)', bloqueada: 'var(--accent-danger)', em_andamento: 'var(--accent)', concluido: 'var(--accent-success)' };
              const statusLabels = { a_fazer: 'A Fazer', bloqueada: 'Bloqueada', em_andamento: 'Em Andamento', concluido: 'Concluída' };
              const prioColors = { critica: '#a4161a', alta: 'var(--accent-danger)', media: 'var(--accent-warm)', baixa: 'var(--accent-success)' };
              const taskLabelObjs = _labelsByTaskId.get(t.id) || [];
              const rd = relativeDate(t.end_date, t.status);
              return `<tr style="cursor:pointer;transition:background 0.1s;" data-action="edit-task" data-id="${t.id}" onmouseover="this.style.background='var(--bg-hover)'" onmouseout="this.style.background='transparent'">
                <td style="${tdStyle}font-family:var(--font-mono);color:var(--accent);font-weight:600;">${t.code}</td>
                <td style="${tdStyle}max-width:280px;font-weight:500;">
                  <div style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(t.title)}
                  ${taskLabelObjs.length > 0 ? taskLabelObjs.map(l => `<span style="font-size:8px;font-weight:700;padding:1px 5px;border-radius:6px;background:${escapeHtml(l.color)};color:#11161f;margin-left:4px;">${escapeHtml(l.name)}</span>`).join('') : ''}</div>
                  ${parentTag(t, _taskById)}
                </td>
                <td class="inline-editable" style="${tdStyle}" title="Clique para alterar status"
                    onclick="event.stopPropagation();window._openInlinePick(event,'${t.id}','status');">
                  <span style="color:${statusColors[t.status]};font-weight:600;font-size:13px;">${statusLabels[t.status] || t.status}</span>
                </td>
                <td class="inline-editable" style="${tdStyle}" title="Clique para alterar prioridade"
                    onclick="event.stopPropagation();window._openInlinePick(event,'${t.id}','priority');">
                  <span style="color:${prioColors[t.priority]};font-weight:600;font-size:13px;">${t.priority.charAt(0).toUpperCase() + t.priority.slice(1)}</span>
                </td>
                <td class="inline-editable" style="${tdStyle}font-size:13px;" title="Clique para alterar responsável"
                    onclick="event.stopPropagation();window._openInlinePick(event,'${t.id}','assignee');">
                  ${member ? `<span style="display:inline-flex;align-items:center;gap:5px;"><span style="width:20px;height:20px;border-radius:50%;background:${colorFromString(member.name)};color:#fff;display:inline-flex;align-items:center;justify-content:center;font-size:9px;font-weight:700;flex-shrink:0;">${initials(member.name)}</span>${escapeHtml(member.name.split(' ')[0])}</span>` : '<span style="color:var(--ink-mute);">—</span>'}
                </td>
                <td class="inline-editable" style="${tdStyle}font-size:13px;" title="Clique para alterar setor"
                    onclick="event.stopPropagation();window._openInlinePick(event,'${t.id}','sector');">
                  ${t.sector ? `<span style="font-size:11px;font-weight:600;padding:2px 7px;border-radius:3px;background:rgba(46,125,79,.1);color:#2E7D4F;border:1px solid rgba(46,125,79,.25);">${escapeHtml(t.sector)}</span>` : '<span style="color:var(--ink-mute);">—</span>'}
                </td>
                <td style="${tdStyle}font-size:12px;">${disc ? `<span style="font-size:11px;font-weight:700;padding:2px 7px;border-radius:3px;background:rgba(31,58,138,.08);color:var(--blueprint);border:1px solid rgba(31,58,138,.2);font-family:var(--font-mono);">${escapeHtml(disc.code)}</span>` : '<span style="color:var(--ink-mute);">—</span>'}</td>
                <td style="${tdStyle}font-family:var(--font-mono);font-size:13px;" title="${t.end_date || ''}">
                  <span style="color:${rd.color};font-weight:${rd.color==='var(--accent-danger)'?'700':'400'};">${rd.text}</span>
                </td>
                <td class="inline-editable" style="${tdStyle}font-family:var(--font-mono);font-size:13px;color:var(--accent);" title="Clique para alterar progresso"
                    onclick="event.stopPropagation();window._openInlinePick(event,'${t.id}','progress');">
                  ${(t.progress ?? 0).toFixed(0)}%
                </td>
              </tr>`;
            }).join('')}
          </tbody>
        </table>
      </div>
    `).join('');
  },

  // ===== AGRUPAMENTO HELPER =====
  groupTasks(tasks, groupBy) {
    const map = new Map();
    const keyFn = {
      status: t => t.status,
      priority: t => t.priority,
      assignee: t => t.assignee_id || 'none',
      discipline: t => t.discipline_id || 'none',
      sector: t => t.sector || 'none',
      stage: t => t.parent_id || 'none',
    }[groupBy] || (t => 'all');
    const labelFn = {
      status: key => ({ a_fazer: 'A Fazer', bloqueada: 'Bloqueada', em_andamento: 'Em Andamento', concluido: 'Concluída' }[key] || key),
      priority: key => ({ critica: '⚡ Crítica', alta: '🔴 Alta', media: '🟡 Média', baixa: '🟢 Baixa' }[key] || key),
      assignee: key => {
        if (key === 'none') return 'Sem responsável';
        const m = State.members.find(x => x.id === key);
        return m ? m.name : 'Desconhecido';
      },
      discipline: key => {
        if (key === 'none') return 'Sem disciplina';
        const d = State.disciplines.find(x => x.id === key);
        return d ? `${d.code} · ${d.name}` : 'Desconhecida';
      },
      sector: key => (key === 'none' ? 'Sem setor' : key),
      stage: key => {
        if (key === 'none') return 'Sem etapa';
        const pt = State.tasks.find(x => x.id === key);
        return pt ? pt.title : 'Etapa removida';
      },
    }[groupBy] || (() => 'Todas');

    tasks.forEach(t => {
      const k = keyFn(t);
      if (!map.has(k)) map.set(k, []);
      map.get(k).push(t);
    });
    const out = Array.from(map.entries()).map(([key, items]) => ({ key, label: labelFn(key), items }));
    if (groupBy === 'stage') {
      // Etapas na ordem do cronograma (início da atividade pai); "Sem etapa" por último
      const _st = k => { const pt = State.tasks.find(x => x.id === k); return (pt && pt.start_date) || '9999'; };
      out.sort((a, b) => (a.key === 'none') - (b.key === 'none') || _st(a.key).localeCompare(_st(b.key)));
    }
    return out;
  },

  // ===== LISTA DENSA (grupos recolhíveis · mini progresso · colunas padronizadas) =====
  tasksRows(filtered, groupBy) {
    const memberById = new Map(State.members.map(m => [m.id, m]));
    const canEdit = DB.iCanEdit();
    const pillOf = { a_fazer: ['is-todo', 'A fazer'], bloqueada: ['is-late', 'Bloqueada'], em_andamento: ['is-doing', 'Em andamento'], concluido: ['is-done', 'Concluída'] };
    const prioBars = { critica: 3, alta: 3, media: 2, baixa: 1 };
    const prioVar = { critica: 'var(--prio-crit)', alta: 'var(--prio-high)', media: 'var(--prio-med)', baixa: 'var(--prio-low)' };
    const prioLbl = { critica: 'Crítica', alta: 'Alta', media: 'Média', baixa: 'Baixa' };
    const byDate = (a, b) => (a.end_date || '9999').localeCompare(b.end_date || '9999') || String(a.code || '').localeCompare(String(b.code || ''), 'pt-BR', { numeric: true });
    const groups = groupBy === 'none'
      ? [{ key: '__all', label: '', items: [...filtered].sort(byDate) }]
      : this.groupTasks([...filtered].sort(byDate), groupBy);
    const t0 = today();

    const rowHtml = t => {
      const m = memberById.get(t.assignee_id);
      const done = t.status === 'concluido';
      const pl = pillOf[t.status] || ['is-todo', String(t.status || '').replace(/_/g, ' ')];
      const rd = relativeDate(t.end_date, t.status);
      const late = !done && t.end_date && t.end_date < t0;
      const pr = t.priority || 'media';
      return `<div class="row trow" data-action="edit-task" data-id="${t.id}" style="cursor:pointer;">
        <span class="trow-check${done ? ' is-done' : ''}" aria-hidden="true">${done ? '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="3.5"><polyline points="20 6 9 17 4 12"/></svg>' : ''}</span>
        <span class="trow-code">${escapeHtml(t.code || '')}</span>
        <span class="row-title${done ? ' is-done' : ''}" title="${escapeHtml(t.title)}">${escapeHtml(t.title)}</span>
        <span class="row-meta">
          <span class="prio-bars" style="--c:${prioVar[pr] || 'var(--ink-mute)'};" title="Prioridade: ${prioLbl[pr] || pr}" onclick="event.stopPropagation();window._openInlinePick(event,'${t.id}','priority');">${[1, 2, 3].map(i => `<i class="${i <= (prioBars[pr] || 1) ? 'on' : ''}"></i>`).join('')}</span>
          <span class="trow-date" style="color:${late ? 'var(--status-late)' : rd.color};${late ? 'font-weight:700;' : ''}" title="${t.end_date || 'sem prazo'}">${rd.text}</span>
          <span class="pill ${pl[0]}" style="cursor:pointer;" title="Alterar status" onclick="event.stopPropagation();window._openInlinePick(event,'${t.id}','status');">${escapeHtml(pl[1])}</span>
          ${m
            ? `<span class="avatar-sm avatar-tip" data-tip="${escapeHtml(m.name)}" style="background:${colorFromString(m.name)};cursor:pointer;" onclick="event.stopPropagation();window._openInlinePick(event,'${t.id}','assignee');">${escapeHtml(initials(m.name))}</span>`
            : `<span class="avatar-sm is-empty" title="Sem responsável — clique para atribuir" onclick="event.stopPropagation();window._openInlinePick(event,'${t.id}','assignee');">+</span>`}
        </span>
      </div>`;
    };

    return `<div class="tgroups">` + groups.map(g => {
      const total = g.items.length;
      const nDone = g.items.filter(x => x.status === 'concluido').length;
      const pct = total ? Math.round(nDone / total * 100) : 0;
      const starts = g.items.map(x => x.start_date).filter(Boolean).sort();
      const ends = g.items.map(x => x.end_date).filter(Boolean).sort();
      const range = starts.length && ends.length ? `${fmtDateShort(starts[0])} – ${fmtDateShort(ends[ends.length - 1])}` : '';
      const hasLate = g.items.some(x => x.status !== 'concluido' && x.end_date && x.end_date < t0);
      const key = groupBy + ':' + g.key;
      const ov = State.collapsedTaskGroups.get(key);
      const collapsed = ov !== undefined ? ov : (total > 0 && nDone === total); // padrão: etapa 100% concluída fica recolhida
      const body = `<div class="tgroup-body">${g.items.map(rowHtml).join('')}${canEdit ? `<button class="tgroup-add" data-action="new-task">+ Adicionar tarefa</button>` : ''}</div>`;
      if (!g.label) return `<section class="tgroup">${body}</section>`;
      return `<section class="tgroup${collapsed ? ' is-collapsed' : ''}" data-group-key="${escapeHtml(key)}">
        <button class="tgroup-head" data-action="toggle-task-group" data-key="${escapeHtml(key)}" aria-expanded="${collapsed ? 'false' : 'true'}">
          <span class="tgroup-chev">▾</span>
          <span class="tgroup-name">${escapeHtml(g.label)}</span>
          ${range ? `<span class="tgroup-range">${range}</span>` : ''}
          ${hasLate ? '<span class="pill is-late no-dot" title="Há tarefas atrasadas">atraso</span>' : ''}
          <span class="tgroup-count">${nDone}/${total}</span>
          <span class="progress-mini tgroup-bar${pct === 100 ? ' is-done' : ''}" style="--pct:${pct}%;"><span></span></span>
        </button>
        ${body}
      </section>`;
    }).join('') + `</div>`;
  },

  taskCard(t) {
    // Usa o contexto pré-computado pelo render do Kanban (lookups O(1));
    // fallback: reconstrói na hora (caso chamado fora do fluxo normal).
    let ctx = Views._cardCtx;
    if (!ctx || !ctx.taskById.has(t.id)) {
      ctx = {
        memberById: new Map(State.members.map(m => [m.id, m])),
        taskById: new Map(State.tasks.map(tk => [tk.id, tk])),
        childrenByParent: new Map(),
        rootsOrder: State.tasks.filter(tk => !tk.parent_id),
        predCountByTask: new Map(),
        labelById: new Map(State.labels.map(l => [l.id, l])),
        labelsByTask: new Map(),
      };
      State.tasks.forEach(tk => { if (tk.parent_id) { if (!ctx.childrenByParent.has(tk.parent_id)) ctx.childrenByParent.set(tk.parent_id, []); ctx.childrenByParent.get(tk.parent_id).push(tk); } });
      State.dependencies.forEach(d => ctx.predCountByTask.set(d.task_id, (ctx.predCountByTask.get(d.task_id) || 0) + 1));
      State.taskLabels.forEach(tl => { const lab = ctx.labelById.get(tl.label_id); if (!lab) return; if (!ctx.labelsByTask.has(tl.task_id)) ctx.labelsByTask.set(tl.task_id, []); ctx.labelsByTask.get(tl.task_id).push(lab); });
    }
    const member = ctx.memberById.get(t.assignee_id);
    const isOverdue = t.status !== 'concluido' && t.end_date < today();
    // EAP do card (índice entre irmãos via mapas O(1))
    const parentTask = t.parent_id ? ctx.taskById.get(t.parent_id) : null;
    const siblings = t.parent_id ? (ctx.childrenByParent.get(t.parent_id) || []) : ctx.rootsOrder;
    const eapIdx = siblings.indexOf(t) + 1;
    const eapLabel = parentTask
      ? (() => {
          const parentSiblings = parentTask.parent_id ? (ctx.childrenByParent.get(parentTask.parent_id) || []) : ctx.rootsOrder;
          return (parentSiblings.indexOf(parentTask) + 1) + '.' + eapIdx;
        })()
      : String(eapIdx);
    const predCount = ctx.predCountByTask.get(t.id) || 0;
    // Progresso no card: sempre inteiro (compacto e consistente)
    const progressVal = String(Math.round(parseFloat(t.progress) || 0));

    // Labels desta tarefa
    const taskLabelObjs = ctx.labelsByTask.get(t.id) || [];
    return `
      <div class="task-card priority-${t.priority}" draggable="true" data-task-id="${t.id}">
        <div class="task-card-id"><span style="color:var(--accent);font-weight:700;">${eapLabel}</span> · ${t.code}${predCount ? ` · <span style="color:var(--accent);">⛓ ${predCount}</span>` : ''}${Automation.isStalled(t) ? ` · <span title="Sem progresso há ${State.automation.stalledAlertDays}+ dias" style="color:var(--accent-warm);font-size:10px;">🐢</span>` : ''}${Automation.shouldPromotePriority(t) ? ` · <span title="Prazo próximo — promovida para Alta" style="color:var(--accent-danger);font-size:10px;font-weight:700;">⏫</span>` : ''}</div>
        ${taskLabelObjs.length > 0 ? `<div style="display:flex;flex-wrap:wrap;gap:4px;margin:6px 0;">
          ${taskLabelObjs.map(lab => `<span style="font-size:9px;font-weight:700;padding:2px 6px;border-radius:8px;background:${escapeHtml(lab.color)};color:#11161f;line-height:1.2;">${escapeHtml(lab.name)}</span>`).join('')}
        </div>` : ''}
        <div class="task-card-title">${escapeHtml(t.title)}</div>
        ${parentTask ? `<div style="font-size:10px;color:var(--ink-mute);margin:-2px 0 6px;display:flex;align-items:center;gap:4px;overflow:hidden;" title="Pertence à tarefa pai: ${escapeHtml(parentTask.title)}"><span style="color:var(--accent);flex-shrink:0;">↳</span><span style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escapeHtml(parentTask.title)}</span></div>` : ''}
        <div class="task-card-meta">
          <span class="prio-badge ${t.priority}">${t.priority}</span>
          <span class="task-tag" style="color:var(--accent);">${progressVal}%</span>
          ${t.sector ? `<span style="font-size:9px;font-weight:700;padding:1px 5px;border-radius:8px;background:var(--accent-success);color:#0a1a0a;line-height:1.4;">${escapeHtml(t.sector)}</span>` : ''}
          ${(() => { const d = ctx.discById?.get(t.discipline_id); return d ? `<span style="font-size:9px;font-weight:700;padding:1px 5px;border-radius:8px;background:var(--blueprint);color:#fff;font-family:var(--font-mono);line-height:1.4;">${escapeHtml(d.code)}</span>` : ''; })()}
        </div>
        <div class="task-card-footer">
          ${member ? `<div class="avatar-tip" data-tip="${escapeHtml(member.name)}"><div class="task-assignee" style="background:${colorFromString(member.name)}">${initials(member.name)}</div></div>` : '<div></div>'}
          <div style="display:flex;align-items:center;gap:5px;">
            ${(() => { const atd = t.status !== 'concluido' ? Math.max(0, daysBetween(t.end_date, today())) : 0; return atd > 0 ? `<span style="font-family:var(--font-mono);font-size:9px;font-weight:700;color:var(--bg-deep);background:var(--accent-danger);padding:1px 5px;border-radius:2px;letter-spacing:0.04em;">+${atd}d</span>` : ''; })()}
            <div class="task-due" style="color:${relativeDate(t.end_date,t.status).color};">${relativeDate(t.end_date,t.status).text}</div>
          </div>
        </div>
        ${(() => { const sub = ctx.childrenByParent.get(t.id) || []; if (sub.length === 0) return ''; const done = sub.filter(x => x.status === 'concluido').length; return `<div style="display:flex;align-items:center;gap:5px;margin-top:5px;font-family:var(--font-mono);font-size:9px;color:var(--ink-mute);"><span style="color:${done===sub.length?'var(--accent-success)':'var(--ink-mute)'};">✓ ${done}/${sub.length}</span> subtarefas</div>`; })()}
        <div style="height:3px;background:var(--bg-deep);border-radius:2px;margin-top:7px;overflow:hidden;">
          <div style="height:100%;width:${Math.min(100,parseFloat(t.progress)||0).toFixed(0)}%;background:${t.status==='concluido'?'var(--accent-success)':'linear-gradient(90deg,var(--accent),var(--blueprint))'};border-radius:2px;transition:width 0.4s;"></div>
        </div>
      </div>
    `;
  },

  // ============================================================================
  // PERMISSÕES — gerenciamento de papéis (dono e administrador)
  // ============================================================================
  permissions() {
    if (!DB.iAmAdmin()) {
      return `
        <div class="empty-state" style="margin-top:80px;">
          <div class="empty-state-icon">🔒</div>
          <div class="empty-state-title">Acesso restrito</div>
          <div class="empty-state-sub">Apenas administradores e donos podem acessar esta página.</div>
        </div>
      `;
    }

    const proj = State.projects.find(p => p.id === State.currentProjectId);
    if (!proj) return this.emptyProject();

    // Combina dono + compartilhados em uma lista única
    const ownerProfile = State.profile; // O dono é sempre o usuário atual aqui
    const members = State.shares.filter(s => s.project_id === proj.id);

    const ROLE_INFO = {
      owner: { label: 'Dono', color: 'var(--accent-warm)', desc: 'Controle total · pode excluir o projeto e gerenciar permissões' },
      admin: { label: 'Administrador', color: 'var(--accent-danger)', desc: 'Pode criar, modificar e excluir tarefas/disciplinas/entregáveis' },
      editor: { label: 'Editor', color: 'var(--accent)', desc: 'Pode criar e modificar conteúdo (não pode excluir)' },
      commenter: { label: 'Comentarista', color: 'var(--accent-success)', desc: 'Pode ver tudo e postar comentários' },
      viewer: { label: 'Visualizador', color: 'var(--ink-soft)', desc: 'Acesso apenas para leitura' },
    };

    return `
      <div class="page-title-block">
        <div class="page-eyebrow">PROJETO · ${escapeHtml(proj.name)}</div>
        <div class="page-title">Permissões</div>
        <div class="page-subtitle">Gerencie quem tem acesso e o que cada pessoa pode fazer.</div>
      </div>

      <!-- HIERARQUIA DE PAPÉIS — referência rápida -->
      <div class="panel" style="margin-bottom:14px;">
        <div class="panel-head"><div class="panel-title">Níveis de Acesso</div></div>
        <div class="panel-body">
          <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:12px;">
            ${Object.entries(ROLE_INFO).map(([key, info]) => `
              <div style="padding:10px;border-left:3px solid ${info.color};background:var(--bg-deep);border-radius:2px;">
                <div style="font-family:var(--font-mono);font-size:10px;color:${info.color};text-transform:uppercase;letter-spacing:0.1em;margin-bottom:4px;">${info.label}</div>
                <div style="font-size:11px;color:var(--ink-soft);line-height:1.4;">${info.desc}</div>
              </div>
            `).join('')}
          </div>
        </div>
      </div>

      <!-- LISTA DE MEMBROS DO PROJETO (alocados) -->
      <div class="panel">
        <div class="panel-head">
          <div class="panel-title">Membros do Projeto</div>
          <div class="panel-title-mono">${(() => { const others = State.allocations.filter(a => { const tm = State.teamMembers.find(m => m.id === a.team_member_id); return tm && !((tm.user_id && tm.user_id === State.user.id) || (tm.email && tm.email.toLowerCase() === State.user.email.toLowerCase())); }); return (others.length + 1) + ' ' + (others.length === 0 ? 'pessoa' : 'pessoas'); })()}</div>
        </div>
        <div class="panel-body" style="padding:0;">
          <!-- DONO (sempre presente) -->
          <div style="display:flex;align-items:center;gap:12px;padding:14px 20px;border-bottom:1px solid var(--border);background:rgba(212,168,44,0.04);">
            <div style="width:36px;height:36px;border-radius:50%;background:${colorFromString(ownerProfile?.full_name || State.user.email)};color:#fff;display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:700;flex-shrink:0;">${initials(ownerProfile?.full_name || State.user.email)}</div>
            <div style="flex:1;min-width:0;">
              <div style="font-size:13px;font-weight:600;">${escapeHtml(ownerProfile?.full_name || 'Você')}</div>
              <div style="font-family:var(--font-mono);font-size:10px;color:var(--ink-mute);margin-top:2px;">${escapeHtml(State.user.email)}</div>
            </div>
            <div style="font-family:var(--font-mono);font-size:10px;color:${ROLE_INFO.owner.color};background:rgba(212,168,44,0.12);padding:4px 10px;border-radius:2px;text-transform:uppercase;letter-spacing:0.1em;font-weight:700;">
              ${ROLE_INFO.owner.label}
            </div>
            <div style="width:42px;"></div>
          </div>

          <!-- MEMBROS ALOCADOS -->
          ${State.allocations.length === 0 ? `
            <div style="padding:30px 20px;text-align:center;color:var(--ink-mute);font-size:13px;">
              Nenhum membro alocado neste projeto ainda.<br>
              <span style="font-size:11px;font-family:var(--font-mono);">Use o botão "Alocar Membro" acima para adicionar pessoas da sua equipe.</span>
            </div>
          ` : State.allocations.map(a => {
            const tm = State.teamMembers.find(m => m.id === a.team_member_id);
            if (!tm) return '';
            // Oculta o dono — já aparece na linha fixa de DONO acima
            if ((tm.user_id && tm.user_id === State.user.id) ||
                (tm.email && tm.email.toLowerCase() === State.user.email.toLowerCase())) return '';
            const info = ROLE_INFO[a.role] || ROLE_INFO.viewer;
            return `
              <div style="display:flex;align-items:center;gap:12px;padding:14px 20px;border-bottom:1px solid var(--border);">
                <div style="width:36px;height:36px;border-radius:50%;background:${colorFromString(tm.name)};color:#fff;display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:700;flex-shrink:0;">${initials(tm.name)}</div>
                <div style="flex:1;min-width:0;">
                  <div style="font-size:13px;font-weight:600;">${escapeHtml(tm.name)}</div>
                  <div style="font-family:var(--font-mono);font-size:10px;color:var(--ink-mute);margin-top:2px;">${escapeHtml(tm.role_title || tm.email || '')}</div>
                </div>
                ${DB.iAmOwner() ? `
                <select class="form-input" style="width:170px;font-size:12px;padding:6px 10px;" data-alloc-id="${a.id}" data-action="perm-change-alloc-role">
                  <option value="viewer" ${a.role === 'viewer' ? 'selected' : ''}>Visualizador</option>
                  <option value="commenter" ${a.role === 'commenter' ? 'selected' : ''}>Comentarista</option>
                  <option value="editor" ${a.role === 'editor' ? 'selected' : ''}>Editor</option>
                  <option value="admin" ${a.role === 'admin' ? 'selected' : ''}>Administrador</option>
                </select>
                <button class="icon-btn danger" data-action="perm-remove-alloc" data-id="${a.id}" title="Remover do projeto">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                </button>` : `
                <div style="font-family:var(--font-mono);font-size:10px;color:${info.color};background:color-mix(in srgb,${info.color} 12%,transparent);padding:4px 10px;border-radius:2px;text-transform:uppercase;letter-spacing:0.1em;font-weight:700;">${info.label}</div>
                <div style="width:42px;"></div>`}
              </div>
            `;
          }).join('')}
        </div>
      </div>
    `;
  },

  // ===== VIEW "HOJE" — uso rápido em obra/visita =====
  // ===== VIEW COMPARATIVO DE BASELINES =====
  baselineCompare() {
    if (!Views.current()) return Views.emptyProject();
    const { chain, perTask, stages } = BaselineCompare.buildDiff();

    if (chain.length < 2) {
      return `
        <div class="page-title-block">
          <div class="page-eyebrow">CRONOGRAMA · COMPARATIVO</div>
          <div class="page-title">Comparar Baselines</div>
        </div>
        <div class="empty-state" style="background:var(--bg-panel);border:1px solid var(--border);border-radius:3px;padding:40px 20px;">
          <div class="empty-state-title">Sem baselines suficientes</div>
          <div class="empty-state-sub">Salve pelo menos uma linha de base no Gantt → Ferramentas → Salvar Linha de Base.</div>
        </div>`;
    }

    // Cores da cadeia LB1..LB4 + atual
    const colors = ['var(--blueprint)', 'var(--accent-warm)', 'var(--accent-success)', 'var(--accent-violet)', 'var(--accent)'];
    const labelOf = (s) => s.slot === 'CUR' ? 'Atual' : `LB${s.slot}`;

    // Ordena tarefas por |totalEndShift| desc (maiores variações primeiro)
    const sorted = perTask.slice().sort((a, b) => Math.abs(b.totalEndShift || 0) - Math.abs(a.totalEndShift || 0));
    const topN = 30; // mostrar top 30 por padrão
    const limited = sorted.slice(0, topN);

    // ── KPIs por estágio ────────────────────────────────────────────────────
    const stageCards = stages.map((s, i) => {
      const c = colors[Math.min(i + 1, colors.length - 1)];
      const sign = s.totalShift > 0 ? '+' : '';
      const shiftColor = s.totalShift > 0 ? 'var(--accent-danger)' : s.totalShift < 0 ? 'var(--accent-success)' : 'var(--ink-mute)';
      return `
        <div class="panel" style="padding:14px 16px;border-left:3px solid ${c};">
          <div style="font-family:var(--font-mono);font-size:10px;color:var(--ink-mute);text-transform:uppercase;letter-spacing:.1em;margin-bottom:6px;">
            ${escapeHtml(s.fromLbl)} → ${escapeHtml(s.toLbl)}
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">
            <div>
              <div style="font-size:22px;font-weight:800;color:${shiftColor};line-height:1.1;">${sign}${s.totalShift}d</div>
              <div style="font-size:10px;color:var(--ink-mute);">Desvio total (fim)</div>
            </div>
            <div>
              <div style="font-size:22px;font-weight:800;color:var(--ink);line-height:1.1;">${s.avgShift > 0 ? '+' : ''}${s.avgShift}d</div>
              <div style="font-size:10px;color:var(--ink-mute);">Média por tarefa</div>
            </div>
            <div>
              <div style="font-size:14px;font-weight:700;color:var(--accent-danger);">${s.atrasadas}</div>
              <div style="font-size:10px;color:var(--ink-mute);">Atrasaram</div>
            </div>
            <div>
              <div style="font-size:14px;font-weight:700;color:var(--accent-success);">${s.adiantadas}</div>
              <div style="font-size:10px;color:var(--ink-mute);">Adiantaram</div>
            </div>
            <div>
              <div style="font-size:14px;font-weight:700;color:var(--blueprint);">+${s.added}</div>
              <div style="font-size:10px;color:var(--ink-mute);">Entraram</div>
            </div>
            <div>
              <div style="font-size:14px;font-weight:700;color:var(--ink-mute);">−${s.removed}</div>
              <div style="font-size:10px;color:var(--ink-mute);">Saíram</div>
            </div>
          </div>
        </div>`;
    }).join('');

    // ── Gráfico de cascata (variação do total de dias entre estágios) ──────
    // Cada barra mostra como o desvio MÉDIO foi acumulando.
    const VW = 900, VH = 220, mL = 60, mR = 16, mT = 16, mB = 36;
    const pw = VW - mL - mR, ph = VH - mT - mB;
    const cumulative = [];
    let acc = 0;
    stages.forEach(s => { acc += s.totalShift; cumulative.push(acc); });
    const maxAbs = Math.max(1, ...cumulative.map(Math.abs));
    const Y = v => mT + ph / 2 - (v / maxAbs) * (ph / 2);
    const barW = pw / stages.length * 0.6;
    let prev = 0;
    const waterfallBars = stages.map((s, i) => {
      const xC = mL + (i + 0.5) * (pw / stages.length);
      const y0 = Y(prev), y1 = Y(prev + s.totalShift);
      const yTop = Math.min(y0, y1), h = Math.abs(y1 - y0);
      const fill = s.totalShift > 0 ? 'var(--accent-danger)' : 'var(--accent-success)';
      const rect = `<rect x="${(xC - barW/2).toFixed(1)}" y="${yTop.toFixed(1)}" width="${barW.toFixed(1)}" height="${Math.max(2, h).toFixed(1)}" rx="2" fill="${fill}" opacity="0.78"/>`;
      const sign = s.totalShift > 0 ? '+' : '';
      const lbl = `<text x="${xC.toFixed(1)}" y="${(yTop - 6).toFixed(1)}" text-anchor="middle" font-size="11" font-family="var(--font-mono)" fill="${fill}" font-weight="700">${sign}${s.totalShift}d</text>`;
      const stage = `<text x="${xC.toFixed(1)}" y="${(VH - 18).toFixed(1)}" text-anchor="middle" font-size="9" font-family="var(--font-mono)" fill="var(--ink-mute)">${escapeHtml(s.fromLbl)}→${escapeHtml(s.toLbl)}</text>`;
      const cum = `<text x="${xC.toFixed(1)}" y="${(VH - 4).toFixed(1)}" text-anchor="middle" font-size="9" font-family="var(--font-mono)" fill="var(--ink-soft)">acum ${cumulative[i] > 0 ? '+' : ''}${cumulative[i]}d</text>`;
      prev += s.totalShift;
      return rect + lbl + stage + cum;
    }).join('');
    const baseline0 = `<line x1="${mL}" y1="${Y(0).toFixed(1)}" x2="${VW-mR}" y2="${Y(0).toFixed(1)}" stroke="var(--ink-mute)" stroke-width="1" stroke-dasharray="4 3"/>`;
    const waterfall = `
      <div class="panel" style="margin-bottom:14px;">
        <div class="panel-head"><div class="panel-title">Desvio Acumulado (Cascata)</div><div class="panel-title-mono">dias de variação no término</div></div>
        <div class="panel-body">
          <svg viewBox="0 0 ${VW} ${VH}" width="100%" preserveAspectRatio="xMidYMid meet" style="display:block;">
            ${baseline0}${waterfallBars}
            <text x="${mL - 10}" y="${(Y(0) + 4).toFixed(1)}" text-anchor="end" font-size="9" font-family="var(--font-mono)" fill="var(--ink-mute)">0d</text>
          </svg>
          <div style="font-size:11px;color:var(--ink-mute);margin-top:8px;">
            <strong style="color:var(--accent-danger);">Vermelho = atraso adicional</strong> ·
            <strong style="color:var(--accent-success);">Verde = ganho de prazo</strong>
          </div>
        </div>
      </div>`;

    // ── Tabela detalhada por tarefa ─────────────────────────────────────────
    const headerCols = chain.map((s, i) => `<th style="text-align:center;color:${colors[Math.min(i, colors.length - 1)]};font-family:var(--font-mono);">${escapeHtml(labelOf(s))}<br><span style="font-size:8px;color:var(--ink-mute);font-weight:400;">início → fim</span></th>`).join('');
    const tableRows = limited.map(row => {
      const cells = row.points.map((p, i) => {
        if (!p) return `<td style="text-align:center;color:var(--ink-mute);font-family:var(--font-mono);font-size:10px;">—</td>`;
        return `<td style="text-align:center;font-family:var(--font-mono);font-size:10px;">
          ${fmtDateShort(p.start)}<br>${fmtDateShort(p.end)}
        </td>`;
      }).join('');
      const shift = row.totalEndShift;
      const shiftColor = shift > 0 ? 'var(--accent-danger)' : shift < 0 ? 'var(--accent-success)' : 'var(--ink-mute)';
      const sign = shift > 0 ? '+' : '';
      return `<tr>
        <td style="font-family:var(--font-mono);font-size:10px;color:var(--accent);">${escapeHtml(row.code)}</td>
        <td style="font-size:12px;max-width:280px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${escapeHtml(row.title)}">${escapeHtml(row.title)}</td>
        ${cells}
        <td style="text-align:right;font-family:var(--font-mono);font-size:12px;font-weight:700;color:${shiftColor};">${shift === null ? '—' : sign + shift + 'd'}</td>
      </tr>`;
    }).join('');

    return `
      <div class="page-title-block">
        <div class="page-eyebrow">CRONOGRAMA · COMPARATIVO</div>
        <div class="page-title">Comparar Baselines</div>
        <div class="page-subtitle">Análise de como o plano evoluiu entre snapshots. ${chain.length} marcos · ${perTask.length} tarefas no escopo.</div>
      </div>

      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:10px;margin-bottom:14px;">
        ${stageCards}
      </div>

      ${stages.length > 0 ? waterfall : ''}

      <div class="panel">
        <div class="panel-head">
          <div class="panel-title">Detalhamento por Tarefa</div>
          <div class="panel-title-mono">${limited.length} de ${perTask.length} · ordenado por |variação| de término</div>
        </div>
        <div class="panel-body" style="padding:0;overflow-x:auto;">
          <table class="data-table" style="width:100%;">
            <thead>
              <tr>
                <th>Cód.</th>
                <th>Tarefa</th>
                ${headerCols}
                <th style="text-align:right;">Δ Total</th>
              </tr>
            </thead>
            <tbody>${tableRows}</tbody>
          </table>
        </div>
        ${perTask.length > topN ? `<div style="padding:10px;font-size:11px;color:var(--ink-mute);text-align:center;">Mostrando as ${topN} tarefas com maiores variações. ${perTask.length - topN} restantes não exibidas.</div>` : ''}
      </div>`;
  },

  // ===== VIEW SAÚDE DO PROJETO =====
  health() {
    if (!Views.current()) return Views.emptyProject();
    const h = HealthCheck.run();
    const color = HealthCheck.scoreColor(h.score);
    const label = HealthCheck.scoreLabel(h.score);

    // Agrupa por severidade
    const groups = {
      error: h.issues.filter(i => i.severity === 'error'),
      warn:  h.issues.filter(i => i.severity === 'warn'),
      info:  h.issues.filter(i => i.severity === 'info'),
    };
    const sevMeta = {
      error: { lbl: 'Erros',  c: 'var(--accent-danger)', desc: 'Violações de integridade — corrija o quanto antes' },
      warn:  { lbl: 'Avisos', c: 'var(--accent-warm)',   desc: 'Riscos operacionais que afetam a gestão' },
      info:  { lbl: 'Sugestões', c: 'var(--blueprint)',  desc: 'Boas práticas e oportunidades de melhoria' },
    };
    const icon = (sev) => sev === 'error' ? '🔴' : sev === 'warn' ? '⚠️' : 'ℹ️';

    const sectionFor = (sev) => {
      const items = groups[sev];
      if (items.length === 0) return '';
      const meta = sevMeta[sev];
      return `
        <div class="panel" style="margin-bottom:14px;">
          <div class="panel-head" style="border-left:3px solid ${meta.c};">
            <div class="panel-title">${meta.lbl}</div>
            <div class="panel-title-mono">${items.length} ${items.length === 1 ? 'item' : 'itens'}</div>
          </div>
          <div class="panel-body" style="padding:0;">
            <div style="padding:10px 16px;font-size:11px;color:var(--ink-mute);border-bottom:1px solid var(--border);">${meta.desc}</div>
            ${items.map(iss => `
              <div class="hc-issue" style="display:flex;align-items:center;gap:12px;padding:11px 16px;border-bottom:1px solid var(--border);font-size:13px;">
                <span style="flex-shrink:0;font-size:14px;">${icon(iss.severity)}</span>
                <span style="flex:1;min-width:0;line-height:1.4;">${escapeHtml(iss.title)}</span>
                <div style="display:flex;gap:6px;flex-shrink:0;">
                  ${iss.taskId ? `<button class="btn btn-ghost" data-action="edit-task" data-id="${iss.taskId}" style="font-size:11px;padding:4px 9px;">Abrir</button>` : ''}
                  ${iss.action ? `<button class="btn btn-secondary" data-hc-action="${iss.id}" style="font-size:11px;padding:4px 9px;">${escapeHtml(iss.action.label)}</button>` : ''}
                </div>
              </div>
            `).join('')}
          </div>
        </div>`;
    };

    return `
      <div class="page-title-block">
        <div class="page-eyebrow">FERRAMENTAS · SAÚDE</div>
        <div class="page-title">Saúde do Projeto</div>
        <div class="page-subtitle">Score automático com base em integridade, consistência e boas práticas. Atualizado a cada interação.</div>
      </div>

      <!-- Score Hero -->
      <div class="panel" style="margin-bottom:14px;">
        <div class="panel-body">
          <div style="display:grid;grid-template-columns:240px 1fr;gap:24px;align-items:center;">
            <div style="text-align:center;">
              <svg viewBox="0 0 140 140" width="200" height="200" style="display:block;margin:0 auto;">
                <circle cx="70" cy="70" r="58" fill="none" stroke="var(--bg-deep)" stroke-width="12"/>
                <circle cx="70" cy="70" r="58" fill="none" stroke="${color}" stroke-width="12"
                  stroke-dasharray="${(h.score / 100 * 364).toFixed(1)} 364"
                  stroke-linecap="round" transform="rotate(-90 70 70)"/>
                <text x="70" y="76" text-anchor="middle" font-size="42" font-weight="800" fill="${color}" font-family="var(--font-display)">${h.score}</text>
                <text x="70" y="96" text-anchor="middle" font-size="10" fill="var(--ink-mute)" font-family="var(--font-mono)" style="text-transform:uppercase;letter-spacing:.12em;">/100</text>
              </svg>
              <div style="font-family:var(--font-mono);font-size:13px;color:${color};font-weight:700;text-transform:uppercase;letter-spacing:.12em;margin-top:8px;">${label}</div>
            </div>
            <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;">
              <div style="padding:14px 16px;background:var(--bg-deep);border-left:3px solid var(--accent-danger);border-radius:0 3px 3px 0;">
                <div style="font-family:var(--font-mono);font-size:10px;color:var(--ink-mute);text-transform:uppercase;letter-spacing:.1em;">Erros</div>
                <div style="font-size:32px;font-weight:800;color:var(--accent-danger);line-height:1.1;">${h.summary.errors}</div>
              </div>
              <div style="padding:14px 16px;background:var(--bg-deep);border-left:3px solid var(--accent-warm);border-radius:0 3px 3px 0;">
                <div style="font-family:var(--font-mono);font-size:10px;color:var(--ink-mute);text-transform:uppercase;letter-spacing:.1em;">Avisos</div>
                <div style="font-size:32px;font-weight:800;color:var(--accent-warm);line-height:1.1;">${h.summary.warnings}</div>
              </div>
              <div style="padding:14px 16px;background:var(--bg-deep);border-left:3px solid var(--blueprint);border-radius:0 3px 3px 0;">
                <div style="font-family:var(--font-mono);font-size:10px;color:var(--ink-mute);text-transform:uppercase;letter-spacing:.1em;">Sugestões</div>
                <div style="font-size:32px;font-weight:800;color:var(--blueprint);line-height:1.1;">${h.summary.infos}</div>
              </div>
            </div>
          </div>
        </div>
      </div>

      ${h.issues.length === 0 ? `
        <div class="empty-state" style="background:var(--bg-panel);border:1px solid var(--border);border-radius:3px;padding:40px 20px;">
          <div style="font-size:38px;margin-bottom:8px;">✨</div>
          <div class="empty-state-title">Projeto saudável!</div>
          <div class="empty-state-sub">Nenhum problema detectado. Continue mantendo as boas práticas.</div>
        </div>
      ` : sectionFor('error') + sectionFor('warn') + sectionFor('info')}
    `;
  },

  projects() {
    return `
      <div class="page-title-block"><div class="page-eyebrow">PORTFÓLIO</div><div class="page-title">Todos os Projetos</div><div class="page-subtitle">${State.projects.length} ${State.projects.length === 1 ? 'projeto cadastrado' : 'projetos cadastrados'}</div></div>
      <div class="team-grid">
        ${State.projects.map(p => {
          const isCurrent = p.id === State.currentProjectId;
          const isAdmin = p.owner_id === State.user.id;
          const myRole = DB.getMyRoleInProject(p.id);
          const roleLabel = { editor: 'editor', commenter: 'comentarista', viewer: 'visualizador' }[myRole] || 'visualizador';
          const roleColor = myRole === 'editor' ? 'var(--accent-warm)' : (myRole === 'commenter' ? 'var(--accent)' : 'var(--ink-soft)');
          const roleBg = myRole === 'editor' ? 'rgba(212,168,44,0.12)' : (myRole === 'commenter' ? 'rgba(229,75,26,0.12)' : 'rgba(155,168,190,0.12)');
          return `
            <div class="member-card project-card" data-project-card data-id="${p.id}" title="Duplo-clique para abrir o projeto" style="cursor:pointer;${isCurrent ? 'border-color:var(--accent);' : ''}">
              <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;">
                <div style="font-family:var(--font-mono);font-size:11px;color:var(--ink-mute);">PROJETO · ${p.id.slice(0,4).toUpperCase()}</div>
                <div style="display:flex;gap:6px;">
                  ${isAdmin
                    ? '<div style="font-family:var(--font-mono);font-size:10px;color:var(--accent);background:rgba(229,75,26,0.12);padding:2px 8px;border-radius:2px;text-transform:uppercase;letter-spacing:0.1em;font-weight:700;">ADMIN</div>'
                    : `<div style="font-family:var(--font-mono);font-size:10px;color:${roleColor};background:${roleBg};padding:2px 8px;border-radius:2px;text-transform:uppercase;letter-spacing:0.1em;">${roleLabel}</div>`
                  }
                  ${isCurrent ? '<div style="font-family:var(--font-mono);font-size:10px;color:var(--accent);background:rgba(229,75,26,0.1);padding:2px 8px;border-radius:2px;">ATIVO</div>' : ''}
                </div>
              </div>
              <div class="member-name">${escapeHtml(p.name)}</div>
              <div style="color:var(--ink-soft);font-size:12px;margin-top:4px;">${escapeHtml(p.client || 'Sem cliente')}</div>
              <div style="margin-top:14px;font-family:var(--font-mono);font-size:11px;color:var(--ink-mute);">
                ${fmtDateFull(p.start_date)} → ${fmtDateFull(p.end_date)}
              </div>
              <div class="member-actions">
                ${!isCurrent ? `<button class="icon-btn" data-action="switch-project" data-id="${p.id}" title="Abrir projeto"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg></button>` : ''}
                ${isAdmin ? `<button class="icon-btn" data-action="share-project" data-id="${p.id}" title="Administrar equipe e acessos"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><line x1="23" y1="11" x2="17" y2="11"/><line x1="20" y1="8" x2="20" y2="14"/></svg></button>` : ''}
                ${isAdmin ? `<button class="icon-btn" data-action="edit-project" data-id="${p.id}" title="Editar projeto"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg></button>` : ''}
                ${isAdmin ? `<button class="icon-btn" data-action="duplicate-project" data-id="${p.id}" title="Duplicar projeto"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg></button>` : ''}
                ${isAdmin ? `<button class="icon-btn danger" data-action="delete-project" data-id="${p.id}" title="Excluir projeto"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M10 11v6"/><path d="M14 11v6"/></svg></button>` : ''}
              </div>
            </div>
          `;
        }).join('')}
      </div>
    `;
  },

  // ===== FLUXO DE DESEMBOLSO (financeiro) =====
  // Modelo: custo de cada tarefa-folha desembolsado conforme o dia de término —
  // término até o dia 20 → desembolso no mesmo mês do término;
  // término após o dia 20 → desembolso no mês seguinte (dia 05).
  // Previsto + Realizado (custo × avanço).
  monthLbl(k) { const [y, m] = k.split('-'); return new Date(Number(y), Number(m) - 1, 1).toLocaleDateString('pt-BR', { month: 'short', year: '2-digit' }).replace('.', ''); },

  // Data completa de desembolso: mesma data do término (dia ≤20) ou dia 05 do mês seguinte (dia >20).
  _dueDate(d) {
    let [y, m, day] = d.split('-').map(Number);
    if (day > 20) { m++; if (m > 12) { m = 1; y++; } day = 5; }
    return `${y}-${String(m).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  },

  // Mês de desembolso (agrupamento): derivado da data completa acima.
  _dueMonth(d) { return this._dueDate(d).slice(0, 7); },

  // Agrega o desembolso mensal (reusado por view, CSV e relatório de impressão)
  _desembolsoData() {
    const leaves = State.tasks.filter(t => !t.inactive && !State.tasks.some(x => x.parent_id === t.id));
    const costed = leaves.filter(t => t.end_date && (parseFloat(t.cost) || 0) > 0);
    const totalCost = costed.reduce((a, t) => a + (parseFloat(t.cost) || 0), 0);
    const curD = today(), curK = curD.slice(0, 7);
    const dueMonth = d => this._dueMonth(d);
    if (!costed.length) return { leaves, costed, totalCost: 0, rows: [], curK };
    const keys = costed.map(t => dueMonth(t.end_date));
    const minK = keys.reduce((a, b) => a < b ? a : b), maxK = keys.reduce((a, b) => a > b ? a : b);
    const months = [];
    { let [y, m] = minK.split('-').map(Number); const [ey, em] = maxK.split('-').map(Number);
      while (y < ey || (y === ey && m <= em)) { months.push(`${y}-${String(m).padStart(2, '0')}`); m++; if (m > 12) { m = 1; y++; } } }
    const prevM = Object.fromEntries(months.map(k => [k, 0]));
    const realM = Object.fromEntries(months.map(k => [k, 0]));
    costed.forEach(t => {
      const dueD = this._dueDate(t.end_date), k = dueD.slice(0, 7), c = parseFloat(t.cost) || 0;
      prevM[k] += c;
      // Realizado = custo × avanço, contabilizado só quando a data exata de desembolso já chegou (respeita o dia 05)
      if (dueD <= curD) realM[k] += c * Math.max(0, Math.min(100, parseFloat(t.progress) || 0)) / 100;
    });
    let accP = 0, accR = 0;
    const rows = months.map(k => {
      accP += prevM[k];
      const isPast = k <= curK;
      if (isPast) accR += realM[k];
      return { k, prev: prevM[k], real: realM[k], accP, accR: isPast ? accR : null, isPast, pct: totalCost > 0 ? accP / totalCost * 100 : 0 };
    });
    return { leaves, costed, totalCost, rows, curK };
  },

  // Gera o SVG do gráfico Curva S — reusado pela view e pelo modal Desembolso.
  // Retorna { svg, kpis, monthLbl }.
  // State.desembolsoMode: 'monthly' | 'cumulative' | 'both' (padrão)
  //   'monthly'    → só barras mensais; eixo Y escala ao pico mensal
  //   'cumulative' → só linhas acumuladas; eixo Y escala ao total
  //   'both'       → barras + linhas na MESMA escala (totalCost), corrigindo a distorção
  _desembolsoChart(D) {
    const { totalCost, rows, curK, costed, leaves } = D;
    const monthLbl = k => this.monthLbl(k);
    const mode = State.desembolsoMode || 'both';
    const showBars = mode !== 'cumulative';
    const showLine = mode !== 'monthly';

    if (!rows.length) {
      const empty = `<div class="panel"><div class="panel-body"><div class="empty-state" style="padding:32px 20px;">
        <div class="empty-state-title">Nenhum custo lançado ainda</div>
        <div class="empty-state-sub">Preencha o custo previsto das tarefas abaixo — a Curva S aparece automaticamente quando houver ao menos um valor lançado.</div>
        ${DB.iCanEdit() ? `<button class="btn btn-cta" data-action="desembolso-open" style="margin-top:8px;">💰 Preencher custos</button>` : ''}
      </div></div></div>`;
      return { svg: empty, kpis: '', monthLbl };
    }

    const maxMonth = Math.max(...rows.map(r => r.prev), 1);
    const pastRows = rows.filter(r => r.isPast);
    const prevToday = pastRows.length ? pastRows[pastRows.length - 1].accP : 0;
    const realToday = pastRows.length ? pastRows[pastRows.length - 1].accR : 0;
    const peak = rows.reduce((a, r) => r.prev > a.prev ? r : a, rows[0]);
    const realPctOfPrev = prevToday > 0 ? (realToday / prevToday * 100) : 0;

    // Escala Y única: se mostrando linha acumulada, escala ao totalCost (barras e linha comparáveis);
    // se só mensal, escala ao pico mensal para usar bem a altura do gráfico.
    const axisMax = showLine ? totalCost : maxMonth;

    const VW = 1000, VH = 320, mL = 64, mR = 18, mT = 16, mB = 28;
    const pw = VW - mL - mR, ph = VH - mT - mB, n = rows.length;
    const X = i => mL + (n <= 1 ? pw / 2 : (i / (n - 1)) * pw);
    const Y = v => mT + (1 - (axisMax > 0 ? v / axisMax : 0)) * ph;

    // ── Barras mensais ──
    const barW = Math.min((pw / n) * 0.6, 38);
    const bars = showBars ? rows.map((r, i) => {
      const barTop = Y(r.prev);
      const barH = Math.max(0, (mT + ph) - barTop);
      const x = X(i) - barW / 2;
      const _anc = i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle';
      const lbl = r.prev > 0
        ? `<text x="${X(i).toFixed(1)}" y="${(barTop - 4).toFixed(1)}" text-anchor="${_anc}" font-size="8" font-family="var(--font-mono)" fill="var(--ink-soft)">${fmtBRL(r.prev)}</text>`
        : '';
      // Overlay laranja = realizado do mês (só meses passados)
      const realTop = (r.isPast && r.real > 0) ? Y(r.real) : null;
      const realBar = realTop !== null
        ? `<rect x="${x.toFixed(1)}" y="${realTop.toFixed(1)}" width="${barW.toFixed(1)}" height="${((mT + ph) - realTop).toFixed(1)}" rx="2" fill="rgba(229,75,26,0.22)"/>`
        : '';
      return `<rect x="${x.toFixed(1)}" y="${barTop.toFixed(1)}" width="${barW.toFixed(1)}" height="${barH.toFixed(1)}" rx="2" fill="${r.isPast ? 'rgba(31,58,138,0.16)' : 'rgba(31,58,138,0.08)'}"/>${realBar}${lbl}`;
    }).join('') : '';

    // ── Linhas acumuladas ──
    const prevPts = showLine ? rows.map((r, i) => `${X(i).toFixed(1)},${Y(r.accP).toFixed(1)}`).join(' ') : '';
    const areaPts = showLine ? `${mL},${(mT + ph).toFixed(1)} ${prevPts} ${X(n - 1).toFixed(1)},${(mT + ph).toFixed(1)}` : '';
    const realPts = showLine ? rows.map((r, i) => r.isPast ? `${X(i).toFixed(1)},${Y(r.accR).toFixed(1)}` : null).filter(Boolean).join(' ') : '';

    // ── Rótulos de valor nos pontos da linha acumulada ──
    const _lblStep = Math.max(1, Math.ceil(n / 8));
    const _ta = i => i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle';
    const accLabels = showLine ? rows.map((r, i) => ((i === 0 || i === n - 1 || i % _lblStep === 0) && r.accP > 0)
      ? `<text x="${X(i).toFixed(1)}" y="${(Y(r.accP) - 7).toFixed(1)}" text-anchor="${_ta(i)}" font-size="9" font-family="var(--font-mono)" font-weight="700" fill="var(--blueprint)">${fmtBRL(r.accP)}</text>`
      : '').join('') : '';
    const accRealLabels = showLine ? rows.map((r, i) => (r.isPast && r.accR != null && r.accR > 0 && (i === 0 || i === n - 1 || i % _lblStep === 0))
      ? `<text x="${X(i).toFixed(1)}" y="${(Y(r.accR) + 12).toFixed(1)}" text-anchor="${_ta(i)}" font-size="9" font-family="var(--font-mono)" font-weight="700" fill="var(--accent)">${fmtBRL(r.accR)}</text>`
      : '').join('') : '';

    // ── Eixo Y (grade + rótulos) — escala única para tudo ──
    const yGrid = [0, 25, 50, 75, 100].map(pc => {
      const v = axisMax * pc / 100, y = Y(v);
      return `<line x1="${mL}" y1="${y.toFixed(1)}" x2="${(VW - mR).toFixed(1)}" y2="${y.toFixed(1)}" stroke="var(--border)" stroke-width="1"/>` +
             `<text x="${(mL - 8).toFixed(1)}" y="${(y + 3).toFixed(1)}" text-anchor="end" font-size="9" font-family="var(--font-mono)" fill="var(--ink-mute)">${fmtBRL(v)}</text>`;
    }).join('');

    const xStep = Math.max(1, Math.ceil(n / 14));
    const xLabels = rows.map((r, i) => ((i % xStep === 0) || (i === n - 1 && (n - 1) % xStep >= 2))
      ? `<text x="${X(i).toFixed(1)}" y="${VH - 9}" text-anchor="${_ta(i)}" font-size="9" font-family="var(--font-mono)" fill="var(--ink-mute)">${monthLbl(r.k)}</text>` : '').join('');

    const curIdx = rows.findIndex(r => r.k === curK);
    const todayLine = curIdx >= 0
      ? `<line x1="${X(curIdx).toFixed(1)}" y1="${mT}" x2="${X(curIdx).toFixed(1)}" y2="${(mT + ph).toFixed(1)}" stroke="var(--ink-mute)" stroke-width="1" stroke-dasharray="3 3" opacity="0.6"/>` +
        `<text x="${X(curIdx).toFixed(1)}" y="${mT - 4}" text-anchor="middle" font-size="8" font-family="var(--font-mono)" fill="var(--ink-mute)">HOJE</text>`
      : '';

    // ── Toggle de modo ──
    const _cb = m => `State.desembolsoMode='${m}';if(window._dxRefreshChart){window._dxRefreshChart();}else{UI.render();}`;
    const _bs = active =>
      `padding:3px 10px;font-size:10px;font-family:var(--font-mono);border:none;cursor:pointer;transition:background .15s,color .15s;` +
      (active ? 'background:var(--accent);color:#fff;' : 'background:var(--bg-deep);color:var(--ink-mute);');
    const modeToggle = `<div style="display:flex;border:1px solid var(--border);border-radius:4px;overflow:hidden;">
      <button style="${_bs(mode==='monthly')}"    onclick="${_cb('monthly')}">Mensal</button>
      <button style="${_bs(mode==='cumulative')}" onclick="${_cb('cumulative')}">Acumulado</button>
      <button style="${_bs(mode==='both')}"       onclick="${_cb('both')}">Ambos</button>
    </div>`;

    // ── Legenda ──
    const leg = (color, label) =>
      `<span style="display:inline-flex;align-items:center;gap:5px;font-size:11px;color:var(--ink-soft);">` +
      `<span style="width:16px;height:0;border-top:3px solid ${color};display:inline-block;"></span>${label}</span>`;
    const legends = [
      showBars ? leg('rgba(31,58,138,0.5)', 'Previsto (mês)') : '',
      showBars && pastRows.length ? leg('rgba(229,75,26,0.5)', 'Realizado (mês)') : '',
      showLine ? leg('var(--blueprint)', 'Previsto (acum.)') : '',
      showLine && realPts ? leg('var(--accent)', 'Realizado (acum.)') : '',
    ].filter(Boolean).join('');

    const titleMap = { monthly: 'Desembolso — Mensal', cumulative: 'Curva S — Acumulado', both: 'Curva S — Desembolso' };

    const svg = `<div class="panel" style="margin-bottom:14px;">
        <div class="panel-head">
          <div class="panel-title">${titleMap[mode] || 'Curva S — Desembolso'}</div>
          <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;">
            ${legends}
            ${modeToggle}
          </div>
        </div>
        <div class="panel-body">
          <svg viewBox="0 0 ${VW} ${VH}" width="100%" preserveAspectRatio="xMidYMid meet" style="display:block;">
            ${yGrid}${bars}
            ${areaPts ? `<polygon points="${areaPts}" fill="rgba(31,58,138,0.05)"/>` : ''}
            ${prevPts ? `<polyline points="${prevPts}" fill="none" stroke="var(--blueprint)" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>` : ''}
            ${realPts ? `<polyline points="${realPts}" fill="none" stroke="var(--accent)" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>` : ''}
            ${accLabels}${accRealLabels}
            ${todayLine}${xLabels}
          </svg>
        </div>
      </div>`;

    const kpi = (lbl, val, color, sub) => `<div class="panel" style="padding:14px 16px;"><div style="font-family:var(--font-mono);font-size:9px;text-transform:uppercase;letter-spacing:.08em;color:var(--ink-mute);">${lbl}</div><div style="font-size:20px;font-weight:800;color:${color || 'var(--ink)'};line-height:1.15;">${val}</div>${sub ? `<div style="font-size:10px;color:var(--ink-mute);margin-top:2px;">${sub}</div>` : ''}</div>`;
    const kpis = `<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px;margin-bottom:14px;">
        ${kpi('Custo total', fmtBRL(totalCost))}
        ${kpi('Previsto até hoje', fmtBRL(prevToday), 'var(--blueprint)')}
        ${kpi('Realizado até hoje', fmtBRL(realToday), 'var(--accent)', realPctOfPrev.toFixed(0) + '% do previsto')}
        ${kpi('Pico mensal', fmtBRL(peak.prev), 'var(--ink)', monthLbl(peak.k))}
        ${kpi('Tarefas com custo', costed.length + ' / ' + leaves.length)}
      </div>`;
    return { svg, kpis, monthLbl };
  },

  desembolso() {
    const p = this.current();
    if (!p) return `<div class="empty-state" style="padding:60px 20px;"><div class="empty-state-title">Sem projeto</div><div class="empty-state-sub">Selecione um projeto para ver o fluxo de desembolso.</div></div>`;
    const D = this._desembolsoData();
    const { totalCost, rows, curK, costed, leaves } = D;

    const header = `
      <div style="display:flex;align-items:baseline;justify-content:space-between;margin-bottom:16px;flex-wrap:wrap;gap:8px;">
        <div>
          <div class="page-eyebrow">FINANCEIRO · DESEMBOLSO</div>
          <div class="page-title" style="margin-bottom:4px;">Fluxo de Desembolso</div>
          <div style="font-family:var(--font-mono);font-size:11px;color:var(--ink-mute);">Medição: término até dia 20 desembolsa no mesmo mês; após o dia 20, no dia 05 do mês seguinte · ${escapeHtml(p.name)}</div>
        </div>
        <div style="display:flex;gap:6px;flex-wrap:wrap;">
          ${DB.iCanEdit() ? `<button class="btn btn-cta" data-action="desembolso-open" style="font-size:11px;"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:14px;height:14px;"><line x1="12" y1="2" x2="12" y2="22"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg> Preencher custos</button>` : ''}
          ${costed.length ? `<button class="btn btn-secondary" data-action="desembolso-print" style="font-size:11px;"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:14px;height:14px;"><polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/></svg> Relatório</button>
          <button class="btn btn-secondary" data-action="desembolso-csv" style="font-size:11px;"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:14px;height:14px;"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg> CSV</button>` : ''}
        </div>
      </div>`;

    if (costed.length === 0) {
      return header + `<div class="panel"><div class="panel-body"><div class="empty-state" style="padding:40px 20px;">
        <div class="empty-state-title">Nenhum custo lançado</div>
        <div class="empty-state-sub">Abra uma tarefa e preencha o campo <strong>Custo previsto (R$)</strong>. Término até o dia 20 desembolsa <strong>no mesmo mês</strong>; após o dia 20, o desembolso cai no <strong>dia 05 do mês seguinte</strong>.</div>
      </div></div></div>`;
    }

    // Usa _desembolsoChart para evitar duplicação — inclui toggle de escala
    const { svg: chart, kpis, monthLbl } = this._desembolsoChart(D);

    // Variáveis locais ainda necessárias para a tabela abaixo
    const maxMonth = Math.max(...rows.map(r => r.prev), 1);
    const pastRows = rows.filter(r => r.isPast);
    const realToday = pastRows.length ? pastRows[pastRows.length - 1].accR : 0;

    // Pré-computa as tarefas de cada mês (término até dia 20 = mesmo mês; após, mês seguinte)
    const dueMonthOf = d => this._dueMonth(d);
    const tasksByMonth = {};
    costed.forEach(t => { const k = dueMonthOf(t.end_date); if (!tasksByMonth[k]) tasksByMonth[k] = []; tasksByMonth[k].push(t); });

    const tableRows = rows.map(r => {
      const monthTasks = (tasksByMonth[r.k] || []).sort((a, b) => (a.end_date || '').localeCompare(b.end_date || ''));
      const isHighlight = r.k === curK;
      const taskSubrows = monthTasks.map(t => {
        const c = parseFloat(t.cost) || 0;
        const real = r.isPast ? c * Math.min(100, Math.max(0, parseFloat(t.progress) || 0)) / 100 : null;
        const disc = State.disciplines.find(d => d.id === t.discipline_id);
        return `<tr class="desembolso-task-row" data-month="${r.k}" style="display:none;background:var(--bg-elevated);">
          <td style="padding:5px 10px 5px 28px;color:var(--ink-soft);" colspan="2">${escapeHtml(t.title)}${disc ? `<span style="font-family:var(--font-mono);font-size:9px;color:var(--ink-mute);margin-left:6px;">${disc.code}</span>` : ''}${parentTag(t, null, 'inline')}</td>
          <td style="padding:5px 10px;text-align:right;font-family:var(--font-mono);font-size:11px;">${fmtBRL(c)}</td>
          <td style="padding:5px 10px;text-align:right;font-family:var(--font-mono);font-size:11px;color:var(--accent);">${real !== null ? fmtBRL(real) : '·'}</td>
          <td colspan="2" style="padding:5px 10px;">
            <div style="display:flex;align-items:center;gap:6px;">
              <div style="flex:1;height:4px;background:var(--bg-deep);border-radius:2px;overflow:hidden;min-width:60px;"><div style="height:100%;width:${Math.min(100,parseFloat(t.progress)||0).toFixed(0)}%;background:var(--accent);border-radius:2px;"></div></div>
              <span style="font-family:var(--font-mono);font-size:9px;color:var(--ink-mute);">${(parseFloat(t.progress)||0).toFixed(0)}%</span>
            </div>
          </td>
        </tr>`;
      }).join('');
      const chevron = monthTasks.length > 0
        ? `<span class="desembolso-chevron" data-month="${r.k}" style="cursor:pointer;font-size:10px;color:var(--ink-mute);margin-right:6px;display:inline-block;transition:transform .15s;user-select:none;">▶</span>`
        : `<span style="display:inline-block;width:16px;margin-right:6px;"></span>`;
      return `<tr${isHighlight ? ' style="background:rgba(229,75,26,0.05);"' : ''} class="desembolso-month-row" data-month="${r.k}">
        <td style="font-family:var(--font-mono);">${chevron}${monthLbl(r.k)}${monthTasks.length > 0 ? `<span style="font-family:var(--font-mono);font-size:9px;color:var(--ink-mute);margin-left:6px;">${monthTasks.length} tarefa${monthTasks.length !== 1 ? 's' : ''}</span>` : ''}</td>
        <td style="text-align:right;font-family:var(--font-mono);">${r.prev > 0 ? fmtBRL(r.prev) : '—'}</td>
        <td style="text-align:right;font-family:var(--font-mono);color:var(--accent);">${r.isPast ? (r.real > 0 ? fmtBRL(r.real) : '—') : '·'}</td>
        <td><div style="height:6px;background:var(--bg-deep);border-radius:3px;overflow:hidden;min-width:80px;"><div style="height:100%;width:${(r.prev / maxMonth * 100).toFixed(1)}%;background:var(--blueprint);border-radius:3px;"></div></div></td>
        <td style="text-align:right;font-family:var(--font-mono);font-weight:600;">${fmtBRL(r.accP)}</td>
        <td style="text-align:right;font-family:var(--font-mono);color:var(--ink-mute);">${r.pct.toFixed(0)}%</td>
      </tr>${taskSubrows}`;
    }).join('');

    const table = `<div class="panel">
        <div class="panel-head"><div class="panel-title">Desembolso mensal</div><div class="panel-title-mono">${rows.length} meses</div></div>
        <div class="panel-body" style="padding:0;">
          <table class="data-table" style="width:100%;" id="desembolsoTable">
            <thead><tr>
              <th style="text-align:left;">Mês</th><th style="text-align:right;">Previsto (mês)</th><th style="text-align:right;">Realizado (mês)</th><th>Distribuição</th><th style="text-align:right;">Acum. previsto</th><th style="text-align:right;">%</th>
            </tr></thead>
            <tbody>${tableRows}</tbody>
            <tfoot><tr style="font-weight:700;">
              <td style="font-family:var(--font-mono);padding:8px 10px;border-top:2px solid var(--border-strong);">TOTAL</td>
              <td style="text-align:right;font-family:var(--font-mono);padding:8px 10px;border-top:2px solid var(--border-strong);">${fmtBRL(totalCost)}</td>
              <td style="text-align:right;font-family:var(--font-mono);color:var(--accent);padding:8px 10px;border-top:2px solid var(--border-strong);">${fmtBRL(realToday)}</td>
              <td style="border-top:2px solid var(--border-strong);"></td><td style="border-top:2px solid var(--border-strong);"></td>
              <td style="text-align:right;padding:8px 10px;border-top:2px solid var(--border-strong);">100%</td>
            </tr></tfoot>
          </table>
        </div>
      </div>`;

    return header + kpis + chart + table;
  },

  // ===== MODAL DESEMBOLSO — gráfico + tabela editável de custos =====
  // Reune numa só janela o gráfico Curva S e a tabela de preenchimento dos custos por tarefa.
  // Cada linha mostra Cód · Título (+ tarefa pai como subtítulo) · Setor · Disciplina · Término · Custo (R$).
  // O custo é editável e salva em on-blur; o gráfico/KPIs são recalculados ao fechar/reabrir.
  openDesembolsoModal() {
    const proj = Views.current();
    if (!proj) { toast('Selecione um projeto', 'error'); return; }
    if (!DB.iCanEdit()) { toast('Sem permissão para editar custos neste projeto', 'error'); return; }

    const fmtBRLLocal = v => v != null && v !== '' ? Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }) : '';
    const inputCostStyle = 'width:100%;background:var(--bg-deep);border:1px solid var(--border);color:var(--ink);border-radius:2px;padding:5px 8px;font-size:12px;font-family:var(--font-mono);text-align:right;';
    const _taskById = new Map(State.tasks.map(t => [t.id, t]));
    const _discById = new Map(State.disciplines.map(d => [d.id, d]));

    // Sempre folhas (não pai), ordenadas por código
    const leaves = State.tasks
      .filter(t => !t.inactive && !State.tasks.some(x => x.parent_id === t.id))
      .sort((a, b) => String(a.code || '').localeCompare(String(b.code || ''), 'pt-BR', { numeric: true }));

    const renderChart = () => {
      const D = Views._desembolsoData();
      const { svg, kpis } = Views._desembolsoChart(D);
      return kpis + svg;
    };

    const renderRow = (t, groupKey = '') => {
      const parent = t.parent_id ? _taskById.get(t.parent_id) : null;
      const costRaw = (t.cost != null && t.cost !== '') ? t.cost : '';
      return `<tr data-task-id="${t.id}" data-group="${groupKey}">
        <td style="font-family:var(--font-mono);font-size:11px;color:var(--accent);white-space:nowrap;vertical-align:top;padding:8px 10px;">${escapeHtml(t.code || '')}</td>
        <td style="font-size:12px;vertical-align:top;padding:8px 10px;">
          <div style="font-weight:500;line-height:1.3;">${escapeHtml(t.title)}</div>
          ${parent ? `<div class="parent-tag" title="Atividade pai: ${escapeHtml(parent.title)}"><span class="pt-arrow">↳</span><span class="pt-name">${escapeHtml(parent.title)}</span></div>` : ''}
        </td>
        <td style="font-size:11px;color:var(--ink-soft);vertical-align:top;padding:8px 10px;white-space:nowrap;">${t.sector ? escapeHtml(t.sector) : '<span style="color:var(--ink-mute);">—</span>'}</td>
        <td style="font-family:var(--font-mono);font-size:11px;color:var(--ink-soft);vertical-align:top;padding:8px 10px;white-space:nowrap;">${t.end_date ? fmtDateShort(t.end_date) : '<span style="color:var(--ink-mute);">—</span>'}</td>
        <td style="vertical-align:top;padding:6px 10px;width:170px;">
          <input class="dx-cost-field" data-id="${t.id}" data-raw="${costRaw}" type="text" placeholder="R$ 0,00" value="${fmtBRLLocal(costRaw)}" style="${inputCostStyle}">
        </td>
      </tr>`;
    };

    // Agrupa por disciplina
    const dxGroups = new Map();
    for (const t of leaves) {
      const disc = _discById.get(t.discipline_id);
      const key = disc ? disc.id : '__none__';
      if (!dxGroups.has(key)) dxGroups.set(key, { disc: disc || null, tasks: [] });
      dxGroups.get(key).tasks.push(t);
    }
    const dxSortedGroups = [...dxGroups.values()].sort((a, b) => {
      if (!a.disc && !b.disc) return 0;
      if (!a.disc) return 1;
      if (!b.disc) return -1;
      return (a.disc.code || '').localeCompare(b.disc.code || '', 'pt-BR');
    });
    const renderGroupedRows = () => dxSortedGroups.map(g => {
      const key = g.disc ? g.disc.id : '__none__';
      const hdr = `<tr class="dx-group-hdr" data-group="${key}" style="background:var(--bg-mid);border-top:2px solid var(--border);"><td colspan="5" style="padding:7px 10px;font-family:var(--font-mono);font-size:11px;font-weight:600;letter-spacing:.05em;">${g.disc ? `<span style="color:var(--accent);">${escapeHtml(g.disc.code)}</span> · <span style="color:var(--ink);">${escapeHtml(g.disc.name)}</span>` : '<span style="color:var(--ink-mute);">Sem disciplina</span>'} <span style="color:var(--ink-mute);font-weight:400;">(${g.tasks.length})</span></td></tr>`;
      return hdr + g.tasks.map(t => renderRow(t, key)).join('');
    }).join('');

    const totalCount = leaves.length;

    Modal.open({
      title: '💰 Desembolso · ' + escapeHtml(proj.name),
      cls: 'modal-xwide',
      body: `
        <div id="dxChart">${renderChart()}</div>
        <div style="display:flex;align-items:center;gap:10px;margin:14px 0 8px;flex-wrap:wrap;">
          <div style="font-family:var(--font-mono);font-size:10px;text-transform:uppercase;letter-spacing:.08em;color:var(--ink-mute);">Preencher custos por tarefa</div>
          <span id="dxCountInfo" style="font-family:var(--font-mono);font-size:11px;color:var(--ink-mute);">${totalCount} tarefa${totalCount !== 1 ? 's' : ''}</span>
          <input id="dxSearch" type="text" class="form-input" placeholder="Filtrar por código, título ou tarefa pai…" style="flex:1;min-width:240px;font-size:12px;padding:5px 10px;">
        </div>
        <div style="border:1px solid var(--border);border-radius:3px;overflow:hidden;">
          <table class="data-table" style="width:100%;">
            <thead><tr>
              <th style="width:80px;text-align:left;padding:8px 10px;">Código</th>
              <th style="text-align:left;padding:8px 10px;">Tarefa</th>
              <th style="width:100px;text-align:left;padding:8px 10px;">Setor</th>
              <th style="width:100px;text-align:left;padding:8px 10px;">Término</th>
              <th style="width:170px;text-align:left;padding:8px 10px;">Custo previsto</th>
            </tr></thead>
            <tbody id="dxRows">${renderGroupedRows()}</tbody>
          </table>
        </div>`,
      footer: `<button class="btn btn-secondary" id="dxClose">Fechar</button>`
    });
    $('#dxClose').onclick = () => { window._dxRefreshChart = null; Modal.forceClose(); };

    // Filtro de busca (código / título / tarefa pai)
    const _searchEl = $('#dxSearch');
    _searchEl.oninput = () => {
      const q = _searchEl.value.trim().toLowerCase();
      const visGroups = new Set();
      let shown = 0;
      $('#dxRows').querySelectorAll('tr[data-task-id]').forEach(tr => {
        const id = tr.dataset.taskId;
        const t = _taskById.get(id); if (!t) return;
        const parent = t.parent_id ? _taskById.get(t.parent_id) : null;
        const hay = (t.code || '') + ' ' + (t.title || '') + ' ' + (parent?.title || '');
        const show = !q || hay.toLowerCase().includes(q);
        tr.style.display = show ? '' : 'none';
        if (show) { shown++; visGroups.add(tr.dataset.group); }
      });
      $('#dxRows').querySelectorAll('tr.dx-group-hdr').forEach(tr => {
        tr.style.display = (!q || visGroups.has(tr.dataset.group)) ? '' : 'none';
      });
      const info = $('#dxCountInfo');
      if (info) info.textContent = q ? `${shown} de ${totalCount}` : `${totalCount} tarefa${totalCount !== 1 ? 's' : ''}`;
    };

    // Edição inline de custo: ao focar mostra o número, ao sair formata + salva + atualiza gráfico
    const _refreshChart = () => {
      const _chartEl = $('#dxChart');
      if (_chartEl) _chartEl.innerHTML = renderChart();
    };
    // Expõe para os botões de toggle de escala (dentro do SVG gerado) chamarem sem re-render total
    window._dxRefreshChart = _refreshChart;
    $('#dxRows').addEventListener('focusin', (e) => {
      const el = e.target.closest('.dx-cost-field'); if (!el) return;
      el.value = el.dataset.raw || '';
      el.select && el.select();
    });
    $('#dxRows').addEventListener('focusout', async (e) => {
      const el = e.target.closest('.dx-cost-field'); if (!el) return;
      const taskId = el.dataset.id;
      const raw = (el.value || '').replace(/\s/g, '').replace(/\./g, '').replace(',', '.').replace(/[^\d.-]/g, '');
      const val = raw === '' ? null : (isNaN(parseFloat(raw)) ? null : Math.max(0, parseFloat(raw)));
      const task = State.tasks.find(t => t.id === taskId); if (!task) return;
      const prev = task.cost;
      if ((prev || null) === (val || null)) { el.value = fmtBRLLocal(val); return; } // sem mudança
      task.cost = val;
      el.dataset.raw = val != null ? val : '';
      el.value = fmtBRLLocal(val);
      try {
        await DB.updateTask(taskId, { cost: val });
        el.style.outline = '2px solid var(--accent-success)';
        setTimeout(() => { el.style.outline = ''; }, 700);
        _refreshChart();
      } catch (err) {
        task.cost = prev;
        el.dataset.raw = prev != null ? prev : '';
        el.value = fmtBRLLocal(prev);
        el.style.outline = '2px solid var(--accent-danger)';
        toast('Erro ao salvar: ' + (err.message || err), 'error');
      }
    });
  },

  exportDesembolsoCSV() {
    const { rows, totalCost } = this._desembolsoData();
    if (!rows.length) { toast('Nenhum custo lançado', 'warning'); return; }
    const fmt = v => (Number(v) || 0).toFixed(2).replace('.', ',');
    const lines = [['Mes', 'Previsto_mes', 'Realizado_mes', 'Acum_previsto', 'Acum_realizado', 'Percentual'].join(';')];
    rows.forEach(r => {
      lines.push([
        r.k, fmt(r.prev), r.isPast ? fmt(r.real) : '',
        fmt(r.accP), r.isPast ? fmt(r.accR) : '',
        (totalCost > 0 ? r.accP / totalCost * 100 : 0).toFixed(1).replace('.', ',') + '%'
      ].join(';'));
    });
    const blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `desembolso_${(this.current()?.name || 'projeto').replace(/[^\w\-]+/g, '_')}.csv`;
    a.click(); URL.revokeObjectURL(url);
    toast('CSV exportado', 'success');
  },

  notifications() {
    // Marca feed como lido ao abrir a view
    State.realtimeUnread = 0;

    const prefs = State.notifPrefs || {
      email_enabled: true,
      notify_task_due_in_days: 3,
      notify_overdue: true,
      notify_blocked: true,
      notify_constraint_violation: true,
      digest_frequency: 'daily',
    };

    const evFeed = State.realtimeEvents;
    const _ago = (iso) => {
      const d = Date.now() - new Date(iso).getTime();
      const m = Math.floor(d / 60000);
      if (m < 1) return 'agora';
      if (m < 60) return `${m} min atrás`;
      const h = Math.floor(m / 60);
      if (h < 24) return `${h}h atrás`;
      return `${Math.floor(h/24)}d atrás`;
    };

    return `
      <div class="page-title-block">
        <div class="page-eyebrow">NOTIFICAÇÕES</div>
        <div class="page-title">Feed de Atividade</div>
        <div class="page-subtitle">Atualizações em tempo real do projeto e preferências de alerta por e-mail.</div>
      </div>

      <div class="panel" style="margin-bottom:14px;">
        <div class="panel-head" style="display:flex;align-items:center;justify-content:space-between;">
          <div class="panel-title">Atividade Recente</div>
          ${evFeed.length > 0 ? `<button class="btn btn-ghost" style="font-size:11px;padding:3px 8px;" onclick="State.realtimeEvents=[];UI.render();">Limpar</button>` : ''}
        </div>
        <div class="panel-body" style="padding:0;">
          ${evFeed.length === 0 ? `
            <div style="padding:28px 20px;text-align:center;color:var(--ink-mute);font-size:12px;">
              <div style="font-size:24px;margin-bottom:8px;opacity:0.4;">📡</div>
              Nenhuma atualização recebida nesta sessão.<br>
              <span style="font-size:11px;font-family:var(--font-mono);">Alterações de colaboradores aparecerão aqui em tempo real.</span>
            </div>
          ` : evFeed.map((ev, i) => `
            <div style="display:flex;align-items:flex-start;gap:10px;padding:10px 16px;${i < evFeed.length-1 ? 'border-bottom:1px solid var(--border);' : ''}${i === 0 ? 'background:rgba(229,75,26,0.035);' : ''}">
              <span style="font-size:14px;flex-shrink:0;margin-top:1px;">${ev.icon}</span>
              <div style="flex:1;min-width:0;">
                <div style="font-size:12px;color:var(--ink);line-height:1.4;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(ev.text)}</div>
              </div>
              <div style="font-family:var(--font-mono);font-size:10px;color:var(--ink-mute);white-space:nowrap;flex-shrink:0;">${_ago(ev.time)}</div>
            </div>
          `).join('')}
        </div>
      </div>

      <div class="panel">
        <div class="panel-head"><div class="panel-title">Canais</div></div>
        <div class="panel-body">
          <label style="display:flex;align-items:center;gap:12px;padding:10px 0;border-bottom:1px solid var(--border);cursor:pointer;">
            <input type="checkbox" id="notifEmailEnabled" ${prefs.email_enabled ? 'checked' : ''} style="width:16px;height:16px;">
            <div style="flex:1;">
              <div style="font-size:13px;font-weight:600;">E-mail</div>
              <div style="font-size:11px;color:var(--ink-mute);font-family:var(--font-mono);margin-top:2px;">Enviado para <strong>${escapeHtml(State.user.email)}</strong></div>
            </div>
          </label>
          <div style="padding:10px 0;border-bottom:1px solid var(--border);">
            <label class="form-label" style="font-size:11px;">Frequência do Resumo</label>
            <select class="form-input" id="notifDigest">
              <option value="off"    ${prefs.digest_frequency === 'off'    ? 'selected' : ''}>Desativado (apenas alertas críticos)</option>
              <option value="daily"  ${prefs.digest_frequency === 'daily'  ? 'selected' : ''}>Diário (resumo todo dia útil)</option>
              <option value="weekly" ${prefs.digest_frequency === 'weekly' ? 'selected' : ''}>Semanal (toda segunda-feira)</option>
            </select>
          </div>
          <div style="padding:10px 0 2px;font-size:11px;color:var(--ink-mute);line-height:1.5;">
            ➕ Além do resumo, quando uma tarefa é <strong>atribuída a você</strong>, um e-mail sai imediatamente (não espera o resumo).
          </div>
        </div>
      </div>

      <div class="panel" style="margin-top:14px;">
        <div class="panel-head"><div class="panel-title">Quando Notificar</div></div>
        <div class="panel-body">
          <div style="padding:10px 0;border-bottom:1px solid var(--border);">
            <label style="display:flex;align-items:center;gap:12px;cursor:pointer;">
              <input type="checkbox" id="notifOverdue" ${prefs.notify_overdue ? 'checked' : ''} style="width:16px;height:16px;">
              <div style="flex:1;">
                <div style="font-size:13px;font-weight:600;">Tarefa atrasada</div>
                <div style="font-size:11px;color:var(--ink-mute);">Aviso quando uma tarefa passa do prazo sem ser concluída</div>
              </div>
            </label>
          </div>
          <div style="padding:10px 0;border-bottom:1px solid var(--border);">
            <div style="display:flex;align-items:center;gap:12px;">
              <div style="font-size:13px;font-weight:600;flex:1;">Avisar X dias antes do prazo</div>
              <input type="number" id="notifDueDays" value="${prefs.notify_task_due_in_days}" min="0" max="30" class="form-input" style="width:80px;text-align:center;">
            </div>
            <div style="font-size:11px;color:var(--ink-mute);margin-top:6px;">Avisa quando uma tarefa está prestes a vencer (0 = desativado)</div>
          </div>
          <div style="padding:10px 0;border-bottom:1px solid var(--border);">
            <label style="display:flex;align-items:center;gap:12px;cursor:pointer;">
              <input type="checkbox" id="notifBlocked" ${prefs.notify_blocked ? 'checked' : ''} style="width:16px;height:16px;">
              <div style="flex:1;">
                <div style="font-size:13px;font-weight:600;">Tarefa marcada como Bloqueada</div>
                <div style="font-size:11px;color:var(--ink-mute);">Aviso imediato quando alguém bloqueia uma tarefa</div>
              </div>
            </label>
          </div>
          <div style="padding:10px 0;">
            <label style="display:flex;align-items:center;gap:12px;cursor:pointer;">
              <input type="checkbox" id="notifViolation" ${prefs.notify_constraint_violation ? 'checked' : ''} style="width:16px;height:16px;">
              <div style="flex:1;">
                <div style="font-size:13px;font-weight:600;">Violação de Restrição</div>
                <div style="font-size:11px;color:var(--ink-mute);">Aviso quando uma data fixa (MSO/MFO/FNLT/SNET) entra em conflito com as predecessoras</div>
              </div>
            </label>
          </div>
        </div>
      </div>

      <div style="margin-top:14px;padding:14px;background:var(--bg-deep);border:1px solid var(--border);border-radius:2px;font-size:12px;color:var(--ink-soft);">
        <div style="font-family:var(--font-mono);font-size:10px;color:var(--ink-mute);text-transform:uppercase;letter-spacing:0.12em;margin-bottom:6px;">⚙ Como funciona</div>
        Os avisos são enviados por uma rotina diária automática (Edge Function) que roda no servidor do Supabase. Para ativar o envio efetivo de e-mails, é necessário deploy da Edge Function <code style="background:var(--bg-panel);padding:2px 5px;border-radius:2px;color:var(--accent);">notify-tasks</code> e configuração de credenciais SMTP no painel Supabase. Ver <strong>Documentação</strong>.
      </div>
    `;
  },

  async saveNotifPrefs() {
    const data = {
      email_enabled: $('#notifEmailEnabled').checked,
      notify_overdue: $('#notifOverdue').checked,
      notify_blocked: $('#notifBlocked').checked,
      notify_constraint_violation: $('#notifViolation').checked,
      notify_task_due_in_days: parseInt($('#notifDueDays').value) || 0,
      digest_frequency: $('#notifDigest').value,
    };
    try {
      setLoading(true);
      await DB.upsertNotifPrefs(data);
      State.notifPrefs = { ...State.notifPrefs, ...data };
      toast('Preferências salvas', 'success');
    } catch (err) {
      let msg = err.message;
      if (msg.includes('notification_preferences')) msg = 'Tabela ainda não existe — rode 06-migration-v3.4.sql';
      toast(msg, 'error');
    }
    finally { setLoading(false); }
  },

  pendencias() {
    // Auto-carrega dados cross-project se ainda não carregou
    if (!UI._overviewLoadedAt) setTimeout(() => UI.refreshOverview(true), 100);
    const filtro = State.pendenciasFilter || 'all';
    const projects = State.projects;
    const allTasks = State.allTasks.length > 0 ? State.allTasks : State.tasks;
    // Tarefas PAI (com filhas) não entram no relatório — apenas as folhas
    const parentIds = new Set(allTasks.filter(t => t.parent_id).map(t => t.parent_id));
    let tasks = allTasks.filter(t => t.status !== 'concluido' && !parentIds.has(t.id) && !t.inactive);
    if (filtro !== 'all') tasks = tasks.filter(t => t.project_id === filtro);
    const sectorFiltro = State.pendenciasSector || 'all';
    if (sectorFiltro !== 'all') tasks = tasks.filter(t2 => (t2.sector || '__none__') === sectorFiltro);
    // Setores para o filtro: cadastrados ∪ os presentes nas tarefas pendentes
    const pendSectors = [...new Set((State.sectors || []).map(s => s.name).concat(allTasks.filter(t => t.status !== 'concluido' && !parentIds.has(t.id)).map(t => t.sector).filter(Boolean)))].sort((a, b) => a.localeCompare(b));

    // Filtro por Status (multi-seleção — chips independentes)
    const pendStatusSet = State.pendenciasStatusFilter || new Set(['a_fazer', 'em_andamento', 'bloqueada']);
    tasks = tasks.filter(t2 => pendStatusSet.has(t2.status));

    // Filtro de Etiquetas (cross-project): mapa tarefa→[label_id]
    const labelFiltro = State.pendenciasLabel || 'all';
    const _labelsByTask = new Map();
    (State.allTaskLabels || []).forEach(tl => {
      if (!_labelsByTask.has(tl.task_id)) _labelsByTask.set(tl.task_id, []);
      _labelsByTask.get(tl.task_id).push(tl.label_id);
    });
    if (labelFiltro === '__none__') tasks = tasks.filter(t2 => !_labelsByTask.has(t2.id));
    else if (labelFiltro !== 'all') tasks = tasks.filter(t2 => (_labelsByTask.get(t2.id) || []).includes(labelFiltro));
    const _pdf = State.dateFilters.pend;
    if (_pdf && (_pdf.from || _pdf.to)) tasks = tasks.filter(t2 => DateFilter.matchTask(t2, 'pend'));
    // Etiquetas disponíveis no dropdown: só as que aparecem nas tarefas pendentes do escopo
    const _pendBaseTasks = allTasks.filter(t => t.status !== 'concluido' && !parentIds.has(t.id) && (filtro === 'all' || t.project_id === filtro));
    const _usedLabelIds = new Set();
    _pendBaseTasks.forEach(t => (_labelsByTask.get(t.id) || []).forEach(id => _usedLabelIds.add(id)));
    const pendLabels = (State.allLabels || []).filter(l => _usedLabelIds.has(l.id)).sort((a, b) => (a.name || '').localeCompare(b.name || ''));

    const t = today();
    const total = tasks.length;
    const overdue = tasks.filter(t2 => t2.end_date && t2.end_date < t).length;
    const thisWeek = tasks.filter(t2 => {
      if (!t2.end_date) return false;
      const diff = daysBetween(t, t2.end_date);
      return diff >= 0 && diff <= 7;
    }).length;
    // Lookups O(1): resolver tarefa pai (cross-project, inclui pais que não estão em `tasks`) e responsável
    const _taskById = new Map(allTasks.map(tk => [tk.id, tk]));
    const _memberById = new Map((State.teamMembers || []).map(m => [m.id, m]));

    const grouped = projects.map(p => ({
      proj: p,
      tasks: tasks.filter(t2 => t2.project_id === p.id)
        .sort((a, b) => (a.end_date||'9999') > (b.end_date||'9999') ? 1 : -1)
    })).filter(g => g.tasks.length > 0);
    const allCollapsed = grouped.length > 0 && grouped.every(g => State.collapsedPanels.has('pend-' + g.proj.id));

    return `
      <div class="page-title-block">
        <div class="page-eyebrow">FERRAMENTAS · RELATÓRIO</div>
        <div class="page-title">Relatório de Pendências</div>
        <div class="page-subtitle">${total} tarefa${total !== 1 ? 's' : ''} pendente${total !== 1 ? 's' : ''} · <span style="color:var(--accent-danger);">${overdue} atrasada${overdue !== 1 ? 's' : ''}</span> · ${thisWeek} vencem esta semana${DateFilter.label('pend') ? ` · <span style="color:var(--accent);">término ${DateFilter.label('pend')}</span>` : ''}</div>
      </div>

      <div style="display:flex;gap:8px;align-items:center;margin-bottom:16px;flex-wrap:wrap;">
        <select class="form-input" id="pendenciasFilter" style="width:auto;min-width:220px;font-size:12px;padding:6px 10px;">
          <option value="all" ${filtro === 'all' ? 'selected' : ''}>Todas as Obras</option>
          ${projects.map(p => `<option value="${p.id}" ${filtro === p.id ? 'selected' : ''}>${escapeHtml(p.name)}</option>`).join('')}
        </select>
        ${pendSectors.length > 0 ? `
        <select class="form-input" id="pendenciasSector" style="width:auto;min-width:160px;font-size:12px;padding:6px 10px;">
          <option value="all" ${sectorFiltro === 'all' ? 'selected' : ''}>Setor: Todos</option>
          <option value="__none__" ${sectorFiltro === '__none__' ? 'selected' : ''}>Sem setor</option>
          ${pendSectors.map(s => `<option value="${escapeHtml(s)}" ${sectorFiltro === s ? 'selected' : ''}>${escapeHtml(s)}</option>`).join('')}
        </select>` : ''}
        <span style="font-family:var(--font-mono);font-size:9px;color:var(--ink-mute);text-transform:uppercase;letter-spacing:.08em;">Status:</span>
        <div style="display:inline-flex;gap:5px;">${statusFilterChips(pendStatusSet, 'pend-status')}</div>
        ${pendLabels.length > 0 ? `
        <select class="form-input" id="pendenciasLabel" style="width:auto;min-width:160px;font-size:12px;padding:6px 10px;">
          <option value="all" ${labelFiltro === 'all' ? 'selected' : ''}>Etiqueta: Todas</option>
          <option value="__none__" ${labelFiltro === '__none__' ? 'selected' : ''}>Sem etiqueta</option>
          ${pendLabels.map(l => `<option value="${l.id}" ${labelFiltro === l.id ? 'selected' : ''}>${escapeHtml(l.name)}</option>`).join('')}
        </select>` : ''}
        ${DateFilter.ui('pend')}
        ${DateFilter.isActive('pend') ? DateFilter.modeUi('pend') : ''}
        <span style="font-family:var(--font-mono);font-size:11px;color:var(--ink-mute);">${total} PENDENTE${total !== 1 ? 'S' : ''}</span>
        ${overdue > 0 ? `<span style="font-family:var(--font-mono);font-size:11px;color:var(--accent-danger);font-weight:700;">${overdue} ATRASADA${overdue !== 1 ? 'S' : ''}</span>` : ''}
        <div style="display:flex;gap:6px;margin-left:auto;">
          ${grouped.length > 1 ? `<button class="btn btn-ghost" data-action="toggle-pend-collapse" style="font-size:11px;">${allCollapsed ? '▸ Expandir todas' : '▾ Recolher todas'}</button>` : ''}
          <button class="btn btn-secondary" data-action="print-pendencias" style="font-size:11px;">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/></svg>
            Imprimir / PDF
          </button>
          <button class="btn btn-secondary" data-action="export-pendencias" style="font-size:11px;">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
            Exportar CSV
          </button>
        </div>
      </div>

      ${grouped.length === 0 ? `
        <div class="empty-state" style="background:var(--bg-panel);border:1px solid var(--border);border-radius:3px;">
          <div class="empty-state-icon"><svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg></div>
          <div class="empty-state-title">Nenhuma pendência</div>
          <div class="empty-state-sub">Todas as tarefas estão concluídas${filtro !== 'all' ? ' nesta obra' : ''}.</div>
        </div>
      ` : grouped.map(g => {
        const color = colorFromString(g.proj.name);
        const overdueN = g.tasks.filter(t2 => t2.end_date && t2.end_date < t).length;
        const tdS = 'padding:10px 16px;border-bottom:1px solid var(--border);';
        return `
          <details class="panel" data-panel="pend-${g.proj.id}" style="margin-bottom:14px;" ${State.collapsedPanels.has('pend-' + g.proj.id) ? '' : 'open'}>
            <summary class="panel-head">
              <div style="display:flex;align-items:center;gap:10px;min-width:0;">
                <span class="panel-chevron">▾</span>
                <div style="width:10px;height:10px;border-radius:2px;background:${color};flex-shrink:0;"></div>
                <div class="panel-title">${escapeHtml(g.proj.name)}</div>
                ${g.proj.client ? `<div style="font-size:11px;color:var(--ink-mute);">· ${escapeHtml(g.proj.client)}</div>` : ''}
              </div>
              <div style="display:flex;gap:8px;align-items:center;">
                ${overdueN > 0 ? `<span style="font-family:var(--font-mono);font-size:10px;color:var(--accent-danger);font-weight:700;">${overdueN} atrasada${overdueN !== 1 ? 's' : ''}</span>` : ''}
                <span style="font-family:var(--font-mono);font-size:10px;color:var(--ink-mute);">${g.tasks.length} pendente${g.tasks.length !== 1 ? 's' : ''}</span>
              </div>
            </summary>
            <div style="padding:0;overflow:hidden;">
              <table style="width:100%;border-collapse:collapse;font-size:12px;">
                <thead>
                  <tr style="background:var(--bg-elevated);">
                    ${['Código','Título','Status','Prio','Responsável','Setor','Térm. LB','Térm. Prog.','Térm. Est.'].map(h => `<th style="text-align:left;${tdS}font-family:var(--font-mono);font-size:10px;color:var(--ink-mute);text-transform:uppercase;letter-spacing:0.1em;padding:8px 16px;white-space:nowrap;">${h}</th>`).join('')}
                  </tr>
                </thead>
                <tbody>
                  ${g.tasks.map(tk => {
                    const isOverdue = tk.end_date && tk.end_date < t;
                    const prioColors = { critica: '#a4161a', alta: 'var(--accent-danger)', media: 'var(--accent-warm)', baixa: 'var(--accent-success)' };
                    const statusColors = { a_fazer: 'var(--ink-mute)', bloqueada: 'var(--accent-danger)', em_andamento: 'var(--accent)', em_projeto: 'var(--ink-mute)' };
                    const statusLabels = { a_fazer: 'A Fazer', bloqueada: 'Bloqueada', em_andamento: 'Em Andamento', em_projeto: 'Em Projeto' };
                    const member = _memberById.get(tk.assignee_id);
                    const parent = tk.parent_id ? _taskById.get(tk.parent_id) : null;
                    const prazoColor = isOverdue ? 'var(--accent-danger)' : tk.end_date ? 'var(--ink-soft)' : 'var(--ink-mute)';
                    // Térm. Estimado: previsão pelo ritmo real (null quando no prazo / sem dados)
                    const fc = forecastEndDate(tk);
                    const fcLate = fc && tk.end_date && fc > tk.end_date;
                    const _dash = '<span style="color:var(--ink-mute);">—</span>';
                    return `<tr onmouseover="this.style.background='var(--bg-hover)'" onmouseout="this.style.background='transparent'">
                      <td style="${tdS}font-family:var(--font-mono);color:var(--accent);font-size:11px;">${escapeHtml(tk.code||'—')}</td>
                      <td style="${tdS}font-weight:500;max-width:280px;">
                        <div style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(tk.title)}</div>
                        ${parent ? `<div class="parent-tag" title="Atividade pai: ${escapeHtml(parent.title)}"><span class="pt-arrow">↳</span><span class="pt-name">${escapeHtml(parent.title)}</span></div>` : ''}
                      </td>
                      <td style="${tdS}"><span style="font-size:11px;font-weight:600;color:${statusColors[tk.status]||'var(--ink-mute)'};">${statusLabels[tk.status]||tk.status}</span></td>
                      <td style="${tdS}"><span style="font-size:11px;font-weight:600;color:${prioColors[tk.priority]||'var(--ink-mute)'};">${tk.priority}</span></td>
                      <td style="${tdS}font-size:11px;">${member ? `<span style="display:inline-flex;align-items:center;gap:5px;"><span style="width:18px;height:18px;border-radius:50%;background:${colorFromString(member.name)};color:#fff;display:inline-flex;align-items:center;justify-content:center;font-size:8px;font-weight:700;">${initials(member.name)}</span>${escapeHtml(member.name.split(' ')[0])}</span>` : _dash}</td>
                      <td style="${tdS}font-size:11px;">${tk.sector ? escapeHtml(tk.sector) : _dash}</td>
                      <td style="${tdS}font-family:var(--font-mono);font-size:11px;color:var(--ink-mute);">${tk.baseline_end ? fmtDateShort(tk.baseline_end) : _dash}</td>
                      <td style="${tdS}font-family:var(--font-mono);font-size:11px;font-weight:${isOverdue?'700':'400'};color:${prazoColor};">${tk.end_date ? fmtDateShort(tk.end_date) : _dash}</td>
                      <td style="${tdS}font-family:var(--font-mono);font-size:11px;font-weight:${fcLate?'700':'400'};color:${fc ? (fcLate ? 'var(--accent-danger)' : 'var(--accent-success)') : 'var(--ink-mute)'};" title="${fc ? 'Estimado pelo ritmo real de avanço' : 'Sem estimativa (no prazo, sem progresso ou sem datas)'}">${fc ? fmtDateShort(fc) : _dash}</td>
                    </tr>`;
                  }).join('')}
                </tbody>
              </table>
            </div>
          </details>
        `;
      }).join('')}
    `;
  },

  // ============================================================================
  // RELATÓRIO — layout com sidebar de navegação + seções colapsáveis
  // ============================================================================
  relatorio() {
    if (!UI._overviewLoadedAt) setTimeout(() => UI.refreshOverview(true), 100);
    const scope = State.relatorioScope || 'current';
    const _rdf = State.dateFilters.rel || { from: '', to: '' };
    // Tarefas inativas só aparecem no Gantt — ficam fora dos relatórios.
    // Filtro de datas (término): quando ativo, considera só tarefas que terminam no intervalo.
    const allTasks = (scope === 'all'
      ? (State.allTasks.length > 0 ? State.allTasks : State.tasks)
      : State.tasks).filter(t => !t.inactive)
      .filter(t => DateFilter.match(t.end_date, _rdf.from, _rdf.to));
    const projects = scope === 'all' ? State.projects : State.projects.filter(p => p.id === State.currentProjectId);
    const p = this.current();
    const genDate = new Date().toLocaleDateString('pt-BR', { day:'2-digit', month:'long', year:'numeric', hour:'2-digit', minute:'2-digit' });

    // ── KPIs ──
    const total   = allTasks.length;
    const done    = allTasks.filter(t => t.status === 'concluido').length;
    const pct     = total > 0 ? Math.round(done / total * 100) : 0;
    const overdue = allTasks.filter(t => t.status !== 'concluido' && t.end_date && t.end_date < today()).length;
    const bloq    = allTasks.filter(t => t.status === 'bloqueada').length;
    const noDate  = allTasks.filter(t => !t.end_date && t.status !== 'concluido').length;

    // ── Status ──
    const statusDef = KanbanConfig.get();
    const statusCounts = statusDef.map(s => ({ ...s, count: allTasks.filter(t => t.status === s.id).length }));

    // ── Donut ──
    const donutR = 38, cx = 46, cy = 46, strokeW = 16;
    const circ = 2 * Math.PI * donutR;
    let offset = 0;
    const donutSlices = statusCounts.filter(s => s.count > 0).map(s => {
      const dash = (s.count / Math.max(total, 1)) * circ;
      const slice = `<circle cx="${cx}" cy="${cy}" r="${donutR}" fill="none" stroke="${s.color}" stroke-width="${strokeW}" stroke-dasharray="${dash.toFixed(2)} ${(circ-dash).toFixed(2)}" stroke-dashoffset="${(-offset).toFixed(2)}" style="transition:stroke-dasharray .6s cubic-bezier(.22,1,.36,1);"/>`;
      offset += dash;
      return slice;
    }).join('');

    // ── Por responsável ──
    const members = State.members.length ? State.members : State.teamMembers;
    const memberCounts = members.map(m => ({
      name: m.name,
      total: allTasks.filter(t => t.assignee_id === m.id).length,
      done:  allTasks.filter(t => t.assignee_id === m.id && t.status === 'concluido').length,
    })).filter(m => m.total > 0).sort((a,b) => (b.total - b.done) - (a.total - a.done)).slice(0, 10);
    const maxMem = Math.max(...memberCounts.map(m => m.total), 1);

    // ── Por prioridade ──
    const prioDef = [
      { id:'alta',  label:'Alta',  color:'var(--prio-high)' },
      { id:'media', label:'Média', color:'var(--prio-med)' },
      { id:'baixa', label:'Baixa', color:'var(--prio-low)' },
    ];
    const prioCounts = prioDef.map(pr => ({ ...pr, count: allTasks.filter(t => t.priority === pr.id).length }));
    const maxPrio = Math.max(...prioCounts.map(p => p.count), 1);

    // ── Progresso por projeto ──
    const projProgress = projects.map(proj => {
      const pt = allTasks.filter(t => t.project_id === proj.id);
      const pp = pt.length ? Math.round(pt.filter(t => t.status === 'concluido').length / pt.length * 100) : 0;
      return { name: proj.name, pct: pp, total: pt.length, color: colorFromString(proj.name) };
    }).sort((a,b) => b.pct - a.pct);

    // ── Overdue por projeto ──
    const overdueByProj = projects.map(proj => ({
      name: proj.name,
      count: allTasks.filter(t => t.project_id === proj.id && t.status !== 'concluido' && t.end_date && t.end_date < today()).length,
    })).filter(x => x.count > 0).sort((a,b) => b.count - a.count);

    const scopeLabel = scope === 'all' ? `${projects.length} projetos` : (p ? escapeHtml(p.name) : '—');

    // ── Impressão rápida (sidebar) ──
    const printBtns = [
      { action:'print-executive',   icon:'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2l6 6M16 13H8M16 17H8M10 9H8', label:'Relatório Executivo', highlight: true },
      { action:'print-tasks',       icon:'M9 11l3 3L22 4', label:'Lista de Tarefas' },
      { action:'print-gantt',       icon:'M3 6h11M7 12h13M5 18h11', label:'Cronograma' },
      { action:'print-restrictions',icon:'M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0zM12 9v4M12 17h.01', label:'Restrições' },
      { action:'print-raci',        icon:'M9 11l3 3L22 4M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11', label:'Matriz RACI' },
      { action:'desembolso-print',  icon:'M12 1v22M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6', label:'Desembolso' },
      { action:'print-scurve',      icon:'M3 17l6-6 4 4 8-8', label:'Avanço Físico (Curva S)' },
      { action:'print-pendencias',  icon:'M12 2L2 7l10 5 10-5-10-5M2 17l10 5 10-5M2 12l10 5 10-5', label:'Pendências' },
    ].map(b => `
      <button class="rpt-print-btn" data-action="${b.action}" style="${b.highlight ? 'background:var(--accent);color:#fff;border-color:var(--accent);font-weight:700;' : ''}">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="${b.icon}"/></svg>
        ${b.label}
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="margin-left:auto;opacity:${b.highlight ? '.7' : '.4'};"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
      </button>`).join('');

    return `
      <div style="display:flex;align-items:baseline;justify-content:space-between;margin-bottom:16px;flex-wrap:wrap;gap:8px;">
        <div>
          <div class="page-eyebrow">ANÁLISE · PORTFÓLIO</div>
          <div class="page-title" style="margin-bottom:4px;">Relatórios</div>
          <div style="font-family:var(--font-mono);font-size:10px;color:var(--ink-mute);">Gerado em ${genDate} · Escopo: ${scopeLabel}${DateFilter.label('rel') ? ` · <span style="color:var(--accent);">término ${DateFilter.label('rel')}</span>` : ''}</div>
        </div>
        <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;">
          ${DateFilter.ui('rel')}
          <span style="font-size:11px;color:var(--ink-mute);font-family:var(--font-mono);margin-left:6px;">Escopo:</span>
          <button data-action="relatorio-scope" data-scope="current" class="btn btn-ghost" style="font-size:11px;padding:4px 10px;${scope==='current'?'background:var(--accent);color:var(--bg-deep);font-weight:700;':''}">Projeto</button>
          <button data-action="relatorio-scope" data-scope="all" class="btn btn-ghost" style="font-size:11px;padding:4px 10px;${scope==='all'?'background:var(--accent);color:var(--bg-deep);font-weight:700;':''}">Portfólio</button>
        </div>
      </div>

      <div class="rpt-layout">

        <!-- SIDEBAR -->
        <div class="rpt-sidebar">
          <div style="font-family:var(--font-mono);font-size:9px;text-transform:uppercase;letter-spacing:.12em;color:var(--ink-mute);padding:4px 10px;margin-bottom:2px;">Imprimir / PDF</div>
          ${printBtns}
        </div>

        <!-- CONTEÚDO -->
        <div>
          <!-- KPI Strip -->
          <div id="rpt-overview" class="kpi-strip">
            <div class="kpi-card">
              <div class="kpi-label">Total</div>
              <div class="kpi-val">${total}</div>
              <div class="kpi-sub">${scopeLabel}</div>
            </div>
            <div class="kpi-card">
              <div class="kpi-label">Concluídas</div>
              <div class="kpi-val" style="color:var(--status-done);">${done}</div>
              <div class="kpi-sub">${pct}% do total</div>
            </div>
            <div class="kpi-card">
              <div class="kpi-label">Em Atraso</div>
              <div class="kpi-val" style="color:${overdue>0?'var(--status-late)':'var(--status-done)'};">${overdue}</div>
              <div class="kpi-sub">${overdue>0?'prazo vencido':'tudo no prazo'}</div>
            </div>
            <div class="kpi-card">
              <div class="kpi-label">Bloqueadas</div>
              <div class="kpi-val" style="color:${bloq>0?'var(--prio-med)':'var(--ink)'};">${bloq}</div>
              <div class="kpi-sub">${noDate} sem prazo</div>
            </div>
          </div>

          <!-- Progresso geral -->
          <div class="chart-panel" style="margin-bottom:10px;">
            <div class="chart-panel-title">Progresso Geral</div>
            <div style="display:flex;align-items:center;gap:12px;">
              <div style="flex:1;height:8px;background:var(--bg-deep);border-radius:4px;overflow:hidden;">
                <div style="height:100%;width:${pct}%;background:linear-gradient(90deg,var(--accent),var(--blueprint));border-radius:4px;transition:width .6s cubic-bezier(.22,1,.36,1);"></div>
              </div>
              <div style="font-family:var(--font-mono);font-size:18px;font-weight:800;color:var(--ink);min-width:46px;text-align:right;">${pct}<span style="font-size:11px;font-weight:400;color:var(--ink-mute);">%</span></div>
            </div>
            <div style="display:flex;gap:16px;margin-top:8px;font-family:var(--font-mono);font-size:10px;color:var(--ink-mute);">
              <span>${done} concluídas</span>
              <span>${total-done} abertas</span>
              <span>${overdue} atrasadas</span>
              <span>${bloq} bloqueadas</span>
            </div>
          </div>

          <!-- Linha 2: Donut + Prioridade -->
          <div id="rpt-status" class="chart-grid-2">
            <!-- Donut por status -->
            <div class="chart-panel">
              <div class="chart-panel-title">Por Status</div>
              <div class="donut-wrap">
                <svg width="92" height="92" viewBox="0 0 92 92" style="flex-shrink:0;transform:rotate(-90deg);">
                  <circle cx="${cx}" cy="${cy}" r="${donutR}" fill="none" stroke="var(--bg-deep)" stroke-width="${strokeW}"/>
                  ${total > 0 ? donutSlices : `<circle cx="${cx}" cy="${cy}" r="${donutR}" fill="none" stroke="var(--border)" stroke-width="${strokeW}"/>`}
                </svg>
                <div class="donut-legend">
                  ${statusCounts.map(s => `
                    <div class="donut-legend-item">
                      <div class="donut-legend-dot" style="background:${s.color};"></div>
                      <div class="donut-legend-label">${s.label}</div>
                      <div class="donut-legend-pct" style="color:var(--ink-mute);">${total?Math.round(s.count/total*100):0}%</div>
                      <div class="donut-legend-val">${s.count}</div>
                    </div>`).join('')}
                </div>
              </div>
            </div>

            <!-- Barras por prioridade -->
            <div id="rpt-priority" class="chart-panel">
              <div class="chart-panel-title">Por Prioridade</div>
              ${prioCounts.map(pr => `
                <div class="bar-row">
                  <div class="bar-row-label">${pr.label}</div>
                  <div class="bar-row-track">
                    <div class="bar-row-fill" style="width:${(pr.count/maxPrio*100).toFixed(1)}%;background:${pr.color};"></div>
                  </div>
                  <div class="bar-row-val">${pr.count}</div>
                </div>`).join('')}
              ${overdueByProj.length ? `
                <div style="margin-top:12px;padding-top:10px;border-top:1px solid var(--border);">
                  <div class="chart-panel-title" style="margin-bottom:8px;">Projetos com Atraso</div>
                  ${overdueByProj.slice(0,4).map(x => `
                    <div class="bar-row">
                      <div class="bar-row-label" title="${escapeHtml(x.name)}">${escapeHtml(x.name.split(' ').slice(0,2).join(' '))}</div>
                      <div class="bar-row-track">
                        <div class="bar-row-fill" style="width:${(x.count/Math.max(...overdueByProj.map(o=>o.count),1)*100).toFixed(1)}%;background:var(--status-late);"></div>
                      </div>
                      <div class="bar-row-val">${x.count}</div>
                    </div>`).join('')}
                </div>` : ''}
            </div>
          </div>

          <!-- Por responsável -->
          ${memberCounts.length ? `
          <div id="rpt-member" class="chart-panel" style="margin-top:10px;">
            <div class="chart-panel-title">Por Responsável — tarefas abertas</div>
            ${memberCounts.map(m => `
              <div class="bar-row" style="margin-bottom:6px;">
                <div class="bar-row-label" title="${escapeHtml(m.name)}">${escapeHtml(m.name.split(' ').slice(0,2).join(' '))}</div>
                <div class="bar-row-track" style="position:relative;">
                  <div class="bar-row-fill" style="width:${(m.total/maxMem*100).toFixed(1)}%;background:${colorFromString(m.name)}33;position:absolute;inset:0;"></div>
                  <div class="bar-row-fill" style="width:${(m.done/maxMem*100).toFixed(1)}%;background:${colorFromString(m.name)};"></div>
                </div>
                <div class="bar-row-val" style="color:${m.total-m.done>0?'var(--ink)':'var(--ink-mute)'};">${m.total-m.done}</div>
              </div>`).join('')}
            <div style="font-family:var(--font-mono);font-size:9px;color:var(--ink-mute);margin-top:6px;">Barra clara = total · Barra cheia = concluídas</div>
          </div>` : ''}

          <!-- Progresso por projeto -->
          ${projProgress.length > 1 ? `
          <div id="rpt-project" class="chart-panel" style="margin-top:10px;">
            <div class="chart-panel-title">Progresso por Projeto</div>
            ${projProgress.map(pr => `
              <div class="proj-progress-row">
                <div class="proj-progress-name">
                  <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(pr.name)}</span>
                  <span style="display:flex;gap:8px;align-items:center;flex-shrink:0;">
                    <span style="font-family:var(--font-mono);font-size:9px;color:var(--ink-mute);">${pr.total} tarefas</span>
                    <span class="proj-progress-pct" style="font-size:11px;font-weight:700;color:${pr.pct===100?'var(--status-done)':'var(--ink-soft)'};">${pr.pct}%</span>
                  </span>
                </div>
                <div class="proj-progress-track">
                  <div class="proj-progress-fill" style="width:${pr.pct}%;background:${colorFromString(pr.name)};"></div>
                </div>
              </div>`).join('')}
          </div>` : ''}
        </div><!-- /conteúdo -->
      </div><!-- /rpt-layout -->
    `;
  },

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

  settings() {
    return `
      <div class="page-title-block"><div class="page-eyebrow">CONFIGURAÇÕES</div><div class="page-title">Preferências</div></div>

      <div class="panel">
        <div class="panel-head"><div class="panel-title">Conta</div></div>
        <div class="panel-body">
          <div class="form-row" style="align-items:flex-end;">
            <div class="form-group" style="flex:1;">
              <label class="form-label">Nome</label>
              <input class="form-input" id="settingsNameInput" value="${escapeHtml(State.profile?.full_name || '')}" placeholder="Seu nome completo" autocomplete="off">
            </div>
            <div class="form-group" style="flex:1;">
              <label class="form-label">E-mail</label>
              <input class="form-input" value="${escapeHtml(State.user.email)}" disabled>
            </div>
            <div class="form-group" style="flex:0;">
              <button class="btn btn-cta" id="btnSaveName" style="white-space:nowrap;">Salvar nome</button>
            </div>
          </div>
        </div>
      </div>

      <div class="panel" style="margin-top:14px;">
        <div class="panel-head">
          <div class="panel-title">Automações</div>
          <div class="panel-title-mono">${(() => { const a = State.automation || {}; const on = (a.archiveDoneDays > 0 ? 1 : 0) + (a.promotePriorityNearDeadline ? 1 : 0) + (a.stalledAlertDays > 0 ? 1 : 0) + (a.autoPpcOnComplete ? 1 : 0) + (a.assignByDiscipline ? 1 : 0); return on + ' / 5 ativas'; })()}</div>
        </div>
        <div class="panel-body">
          <div style="font-size:12px;color:var(--ink-soft);margin-bottom:14px;">Regras prontas que rodam automaticamente. As preferências ficam só no seu navegador.</div>
          ${(() => {
            const a = State.automation || {};
            const row = (icon, title, desc, control) => `
              <div style="display:flex;align-items:flex-start;gap:12px;padding:12px 0;border-bottom:1px solid var(--border);">
                <div style="font-size:18px;line-height:1;flex-shrink:0;margin-top:2px;">${icon}</div>
                <div style="flex:1;min-width:0;">
                  <div style="font-size:13px;font-weight:600;">${title}</div>
                  <div style="font-size:11px;color:var(--ink-mute);margin-top:2px;">${desc}</div>
                </div>
                <div style="flex-shrink:0;">${control}</div>
              </div>`;
            const toggle = (key, on) => `
              <label style="display:inline-flex;align-items:center;gap:6px;cursor:pointer;user-select:none;">
                <input type="checkbox" class="auto-toggle" data-auto-key="${key}" ${on ? 'checked' : ''}>
                <span style="font-family:var(--font-mono);font-size:10px;color:${on ? 'var(--accent-success)' : 'var(--ink-mute)'};text-transform:uppercase;">${on ? 'ON' : 'OFF'}</span>
              </label>`;
            const num = (key, val) => `
              <input type="number" class="form-input auto-num" data-auto-key="${key}" min="0" max="365" value="${val}" style="width:70px;font-size:12px;padding:4px 6px;text-align:right;">`;
            return `
              ${row('🗂', 'Arquivar concluídas há N dias', 'Tarefas concluídas há N ou mais dias somem da Lista/Kanban/Tabela (continuam no Gantt e nos relatórios). 0 = desligado.', num('archiveDoneDays', a.archiveDoneDays || 0))}
              ${row('⏫', 'Promover prioridade perto do prazo', 'Tarefa com prazo ≤ 3 dias e ainda não concluída vira Alta (visual no card). Não altera o banco.', toggle('promotePriorityNearDeadline', !!a.promotePriorityNearDeadline))}
              ${row('🐢', 'Aviso de tarefa parada (stalled)', 'Tarefa "Em Andamento" sem alteração há N dias ganha um aviso visual. 0 = desligado.', num('stalledAlertDays', a.stalledAlertDays || 0))}
              ${row('✓', 'Auto-PPC ao concluir tarefa', 'Quando você marca uma tarefa como Concluída, o compromisso da semana no Last Planner vira "Cumprida" automaticamente.', toggle('autoPpcOnComplete', !!a.autoPpcOnComplete))}
              ${row('👤', 'Atribuir responsável por disciplina', 'Ao criar uma tarefa com disciplina e sem responsável definido, o líder técnico da disciplina é atribuído.', toggle('assignByDiscipline', !!a.assignByDiscipline))}`;
          })()}
        </div>
      </div>

      <div class="panel" style="margin-top:14px;">
        <div class="panel-head">
          <div class="panel-title">Labels do Projeto Atual</div>
          <div class="panel-title-mono">${State.labels.length} / 15</div>
        </div>
        <div class="panel-body">
          ${!State.currentProjectId ? `<div style="color:var(--ink-mute);font-size:12px;">Selecione um projeto para gerenciar labels.</div>` : `
            <div style="font-size:12px;color:var(--ink-soft);margin-bottom:14px;">Labels servem para classificar tarefas (ex.: "Urgente", "Externo", "Bloqueio Interno"). Cada projeto pode ter até 15 labels.</div>
            <div id="labelsList" style="display:flex;flex-direction:column;gap:8px;margin-bottom:14px;">
              ${State.labels.length === 0 ? `<div style="color:var(--ink-mute);font-size:12px;font-style:italic;">Nenhuma label criada ainda.</div>` :
                State.labels.map(lab => {
                  const usageCount = State.taskLabels.filter(tl => tl.label_id === lab.id).length;
                  return `
                    <div style="display:flex;align-items:center;gap:10px;padding:8px 12px;background:var(--bg-deep);border:1px solid var(--border);border-radius:2px;">
                      <div style="width:14px;height:14px;border-radius:2px;background:${escapeHtml(lab.color)};flex-shrink:0;"></div>
                      <div style="flex:1;font-size:13px;font-weight:600;">${escapeHtml(lab.name)}</div>
                      <div style="font-family:var(--font-mono);font-size:10px;color:var(--ink-mute);">${usageCount} ${usageCount === 1 ? 'tarefa' : 'tarefas'}</div>
                      <button class="icon-btn" data-action="edit-label" data-id="${lab.id}" title="Editar">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                      </button>
                      <button class="icon-btn danger" data-action="delete-label" data-id="${lab.id}" title="Excluir">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/></svg>
                      </button>
                    </div>
                  `;
                }).join('')
              }
            </div>
            <button class="btn btn-secondary" data-action="new-label" ${State.labels.length >= 15 ? 'disabled' : ''}>
              ${State.labels.length >= 15 ? 'Limite de 15 labels atingido' : '+ Nova Label'}
            </button>
          `}
        </div>
      </div>

      <div class="panel" style="margin-top:14px;">
        <div class="panel-head"><div class="panel-title">Folgas e Feriados</div><div class="panel-title-mono">dias não úteis</div></div>
        <div class="panel-body">
          <p style="font-size:12px;color:var(--ink-soft);margin-bottom:12px;">Cadastre feriados, férias e outros dias não úteis. Para um <strong>período</strong> (feriado prolongado, férias), preencha o <strong>Término</strong>. Esses dias são excluídos do cálculo de <strong>dias úteis</strong> nas tarefas.</p>
          <div style="display:flex;gap:8px;align-items:flex-end;margin-bottom:12px;flex-wrap:wrap;">
            <div class="form-group" style="flex:0 0 140px;margin-bottom:0;">
              <label class="form-label">Início</label>
              <input class="form-input" type="date" id="holidayDateInput">
            </div>
            <div class="form-group" style="flex:0 0 140px;margin-bottom:0;">
              <label class="form-label">Término <span style="color:var(--ink-mute);font-weight:400;">(opcional)</span></label>
              <input class="form-input" type="date" id="holidayEndInput" title="Deixe vazio para um único dia. Preencha para períodos (férias, feriado prolongado).">
            </div>
            <div class="form-group" style="flex:1;min-width:150px;margin-bottom:0;">
              <label class="form-label">Descrição</label>
              <input class="form-input" id="holidayNameInput" placeholder="Ex.: Natal, Carnaval, Férias…" autocomplete="off">
            </div>
            <button class="btn btn-cta" data-action="add-holiday" style="flex-shrink:0;white-space:nowrap;">+ Adicionar</button>
          </div>
          <div id="holidayList" style="max-height:220px;overflow-y:auto;border:1px solid var(--border);border-radius:4px;">${Holidays.listHtml()}</div>
        </div>
      </div>

      <div class="panel" style="margin-top:14px;">
        <div class="panel-head"><div class="panel-title">Dados</div><div class="panel-title-mono">backup · lgpd art. 18</div></div>
        <div class="panel-body">
          <p style="color:var(--ink-soft);font-size:13px;margin-bottom:14px;">Backup completo: o JSON inclui <strong>projetos, tarefas, dependências, disciplinas, restrições, RACI, etiquetas, comentários e Last Planner</strong>. Faça backups regulares — e você pode restaurar a qualquer momento importando o arquivo.</p>
          <div style="display:flex;gap:8px;flex-wrap:wrap;">
            <button class="btn btn-secondary" data-action="export-data">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
              Exportar Backup Completo (JSON + Excel + XML)
            </button>
            <button class="btn btn-secondary" data-action="import-data">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
              Importar / restaurar backup
            </button>
          </div>
          <div class="lgpd-notice" style="margin-top:12px;">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
            <span>Direito LGPD (Art. 18): você pode solicitar acesso, correção ou exclusão dos seus dados a qualquer momento. Dados pessoais coletados: <strong>nome</strong> e <strong>e-mail</strong>.</span>
          </div>
        </div>
      </div>

      <div class="panel danger-zone" style="margin-top:14px;">
        <div class="panel-head">
          <div class="panel-title">Zona de Perigo</div>
          <div class="panel-title-mono" style="color:var(--accent-danger);">ação irreversível</div>
        </div>
        <div class="panel-body">
          <p style="font-size:13px;color:var(--ink-soft);margin-bottom:16px;">
            A exclusão remove <strong style="color:var(--ink);">todos os seus projetos, tarefas, entregáveis, disciplinas e membros de equipe</strong>. Esta ação não pode ser desfeita.<br>
            <span style="font-size:11px;color:var(--ink-mute);font-family:var(--font-mono);margin-top:4px;display:block;">Conforme LGPD Art. 18, VI — o titular tem direito à eliminação dos dados.</span>
          </p>
          <button class="btn" data-action="delete-account" style="background:rgba(193,59,18,0.1);border:1px solid rgba(193,59,18,0.4);color:var(--accent-danger);font-size:12px;font-weight:600;">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M10 11v6"/><path d="M14 11v6"/></svg>
            Excluir minha conta e todos os dados
          </button>
        </div>
      </div>

      <div style="text-align:center;margin-top:30px;font-family:var(--font-mono);font-size:11px;color:var(--ink-mute);letter-spacing:0.1em;">
        CADÊOPROJETO v3.0 · POSTGRESQL · LGPD COMPLIANT · GRATUITO PARA A COMUNIDADE<br>
        <span style="font-size:10px;margin-top:4px;display:block;">
          <a data-action="open-privacy-modal" style="color:var(--ink-mute);text-decoration:none;cursor:pointer;" onmouseover="this.style.color='var(--accent)'" onmouseout="this.style.color='var(--ink-mute)'">Política de Privacidade</a>
          &nbsp;·&nbsp;
          <a data-action="open-terms-modal" style="color:var(--ink-mute);text-decoration:none;cursor:pointer;" onmouseover="this.style.color='var(--accent)'" onmouseout="this.style.color='var(--ink-mute)'">Termos de Uso</a>
        </span>
      </div>
    `;
  }
};
