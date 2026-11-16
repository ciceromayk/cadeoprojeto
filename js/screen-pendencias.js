// Tela Pendências
import { toast } from './feedback.js';
import { DateFilter, colorFromString, daysBetween, escapeHtml, fmtDateShort, forecastEndDate, initials, statusFilterChips, today } from './helpers.js';
import { State } from './state.js';
import { UI } from './ui.js';
import { Views } from './views.js';

// Plugado em Views: continuam acessíveis como Views.<método> e this.<método>.
Object.assign(Views, {
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
});

// Plugado em UI: continuam acessíveis como UI.<método> e this.<método>.
Object.assign(UI, {
  printPendencias() {
    const filtro = State.pendenciasFilter || 'all';
    const allTasks = State.allTasks.length > 0 ? State.allTasks : State.tasks;
    // Tarefas PAI (com filhas) não entram no relatório — apenas as folhas
    const parentIds = new Set(allTasks.filter(t => t.parent_id).map(t => t.parent_id));
    let tasks = allTasks.filter(t => t.status !== 'concluido' && !parentIds.has(t.id) && !t.inactive);
    if (filtro !== 'all') tasks = tasks.filter(t => t.project_id === filtro);
    const sectorFiltro = State.pendenciasSector || 'all';
    if (sectorFiltro !== 'all') tasks = tasks.filter(t2 => (t2.sector || '__none__') === sectorFiltro);
    const _pdf = State.dateFilters.pend;
    if (_pdf && (_pdf.from || _pdf.to)) tasks = tasks.filter(t2 => DateFilter.matchTask(t2, 'pend'));
    const t = today();
    const overdue = tasks.filter(t2 => t2.end_date && t2.end_date < t).length;
    const statusLabels = { a_fazer: 'A Fazer', bloqueada: 'Bloqueada', em_andamento: 'Em Andamento', em_projeto: 'Em Projeto' };
    const _taskById = new Map(allTasks.map(tk => [tk.id, tk]));
    const projects = State.projects;
    const grouped = projects.map(p => ({
      proj: p,
      tasks: tasks.filter(t2 => t2.project_id === p.id)
        .sort((a, b) => (a.end_date||'9999') > (b.end_date||'9999') ? 1 : -1)
    })).filter(g => g.tasks.length > 0);

    const filtroLabel = filtro === 'all' ? 'Todas as Obras' : (projects.find(p => p.id === filtro)?.name || '');
    const printDate = new Date().toLocaleDateString('pt-BR', { day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit' });

    const logoSvg = `<svg width="32" height="32" viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg"><rect x="1" y="1" width="30" height="30" rx="4" fill="none" stroke="#1A1714" stroke-width="1.5"/><text x="16" y="23" text-anchor="middle" font-family="monospace" font-size="20" font-weight="700" fill="#E54B1A">?</text></svg>`;
    const html = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<title>Relatório de Pendências — CadêOProjeto</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: 'Segoe UI', Arial, sans-serif; font-size: 11px; color: #1A1714; background: #F2EDE3; }
  #printToolbar { position:sticky;top:0;z-index:999;background:#1A1714;display:flex;align-items:center;justify-content:space-between;padding:10px 20px;gap:12px;border-bottom:2px solid #E54B1A; }
  #printToolbar .tbar-title { color:#F2EDE3;font-size:13px;font-weight:700;font-family:monospace; }
  #printToolbar .tbar-sub { color:#94928B;font-size:10px;font-family:monospace;margin-top:2px; }
  #printToolbar .tbar-actions { display:flex;gap:8px; }
  .btn-print { background:#E54B1A;color:#fff;border:none;padding:8px 20px;border-radius:3px;font-size:12px;font-weight:700;cursor:pointer; }
  .btn-print:hover { background:#C13B12; }
  .btn-close { background:transparent;color:#94928B;border:1px solid #45403A;padding:8px 14px;border-radius:3px;font-size:12px;cursor:pointer; }
  .btn-close:hover { color:#F2EDE3; }
  #printContent { background:#fff;max-width:920px;margin:24px auto;box-shadow:0 2px 12px rgba(0,0,0,.12);border-radius:3px;overflow:hidden; }
  .doc-header { background:#fff;padding:16px 20mm 14px;display:flex;align-items:center;gap:14px; }
  .doc-brand { font-family:monospace;font-size:9px;color:#E54B1A;text-transform:uppercase;letter-spacing:.14em;margin-bottom:2px; }
  .doc-title { font-size:18px;font-weight:800;color:#1A1714; }
  .doc-header-right { margin-left:auto;text-align:right; }
  .doc-proj { font-size:12px;font-weight:700;color:#1A1714; }
  .doc-date { font-size:9px;color:#6B6359;font-family:monospace;margin-top:2px; }
  .doc-stripe { height:3px;background:linear-gradient(90deg,#E54B1A,#D4A82C); }
  .doc-body { padding:14mm 20mm; }
  .doc-summary { font-size:11px;color:#6B6359;margin-bottom:6px; }
  .doc-meta { font-size:9px;color:#94928B;font-family:monospace;margin-bottom:16px;padding-bottom:10px;border-bottom:1px solid #E8E2D4; }
  .doc-meta strong { color:#E54B1A; }
  .project-block { margin-bottom:18px;page-break-inside:avoid; }
  .monthly-grid { display:grid;grid-template-columns:repeat(4,1fr);gap:4px;margin-bottom:18px; }
  .monthly-cell { border:1px solid #E8E2D4;border-radius:2px;padding:5px 8px;font-size:9px; }
  .monthly-cell .mc-month { font-family:monospace;font-weight:700;color:#1A1714;margin-bottom:3px;font-size:9px; }
  .monthly-cell .mc-row { display:flex;justify-content:space-between;color:#6B6359; }
  .monthly-cell .mc-dev-pos { color:#C13B12;font-weight:700; }
  .monthly-cell .mc-dev-neg { color:#2E7D4F;font-weight:700; }
  .project-head { display:flex;align-items:center;gap:8px;padding:8px 12px;background:#F2EDE3;border-left:3px solid #E54B1A; }
  .project-name { font-size:13px;font-weight:700; }
  .project-client { font-size:10px;color:#6B6359; }
  .project-stats { margin-left:auto;font-size:9px;font-family:monospace;color:#6B6359; }
  .project-stats .danger { color:#C13B12;font-weight:700; }
  table { width:100%;border-collapse:collapse;font-size:10px; }
  thead th { background:#F2EDE3;text-align:left;padding:6px 10px;font-family:monospace;font-size:8px;text-transform:uppercase;letter-spacing:.08em;color:#94928B;border-bottom:1px solid #E8E2D4; }
  tbody td { padding:7px 10px;border-bottom:1px solid #F2EDE3;vertical-align:middle; }
  tbody tr:nth-child(even) td { background:#FAFAF8; }
  tbody tr:last-child td { border-bottom:none; }
  .code { font-family:monospace;color:#E54B1A;font-weight:700;font-size:9px; }
  .title-cell { font-weight:500;max-width:260px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap; }
  .prio-alta { color:#C13B12;font-weight:700; }
  .prio-media { color:#D4A82C;font-weight:700; }
  .prio-baixa { color:#2E7D4F;font-weight:700; }
  .overdue { color:#C13B12;font-weight:700; }
  .normal-date { color:#6B6359; }
  .no-date { color:#94928B; }
  .member { display:inline-flex;align-items:center;gap:5px; }
  .avatar { width:18px;height:18px;border-radius:50%;display:inline-flex;align-items:center;justify-content:center;font-size:7px;font-weight:700;color:#fff; }
  .doc-footer { padding:8px 20mm;background:#F2EDE3;border-top:1px solid #E8E2D4;font-size:8px;color:#94928B;font-family:monospace;display:flex;justify-content:space-between; }
  /* Cabeçalho corrido — só na impressão, repete em todas as páginas */
  .print-rhead { display:none; }
  .print-rhead-brand { font-family:monospace;font-size:9px;color:#E54B1A;text-transform:uppercase;letter-spacing:.12em; }
  .print-rhead-title { font-size:13px;font-weight:800;color:#1A1714;letter-spacing:-.01em;line-height:1.15; }
  .print-rhead-right { margin-left:auto;text-align:right; }
  .print-rhead-proj { font-size:10px;font-weight:700;color:#1A1714; }
  .print-rhead-date { font-size:8px;color:#6B6359;font-family:monospace; }
  /* Cabeçalho/rodapé via caixas de margem do @page — repetem em todas as
     páginas e nunca sobrepõem o conteúdo (mesmo mecanismo da numeração). */
  @page {
    size:A4; margin:24mm 14mm 16mm;
    @top-left { content:"CadêOProjeto · Relatório de Pendências"; font-family:monospace; font-size:9px; font-weight:700; color:#1A1714; vertical-align:bottom; padding-bottom:2.5mm; border-bottom:2px solid #E54B1A; }
    @top-center { content:""; border-bottom:2px solid #E54B1A; }
    @top-right { content:"${escapeHtml(filtroLabel)}"; font-family:monospace; font-size:9px; font-weight:700; color:#E54B1A; vertical-align:bottom; padding-bottom:2.5mm; border-bottom:2px solid #E54B1A; }
    @bottom-left { content:"Gerado em ${printDate}"; font-family:monospace; font-size:8px; color:#94928B; }
    @bottom-center { content:"Página " counter(page) " de " counter(pages); font-family:monospace; font-size:8px; color:#94928B; }
  }
  @media print {
    body { background:#fff; }
    /* Garante que faixa laranja, badges e sombreado das linhas saiam na impressão */
    * { -webkit-print-color-adjust:exact!important; print-color-adjust:exact!important; }
    #printToolbar { display:none!important; }
    #printContent { box-shadow:none;margin:0;border-radius:0;max-width:none;overflow:visible; }
    /* Cabeçalho/faixa/rodapé em fluxo + corrido dão lugar às caixas de margem do @page */
    .doc-header,.doc-stripe,.doc-footer,.print-rhead { display:none!important; }
    .doc-body { padding:0!important; }
    tbody tr:nth-child(even) td { background:#fafaf8; }
    /* Repete o cabeçalho da tabela a cada página e evita cortar linhas/blocos */
    thead { display:table-header-group; }
    tr { page-break-inside:avoid; }
    .project-block { page-break-inside:avoid; }
  }
</style>
</head>
<body>
  <div class="print-rhead">
    <div class="print-rhead-logo">${logoSvg}</div>
    <div>
      <div class="print-rhead-brand">CadêOProjeto · Engenharia</div>
      <div class="print-rhead-title">Relatório de Pendências</div>
    </div>
    <div class="print-rhead-right">
      <div class="print-rhead-proj">${escapeHtml(filtroLabel)}</div>
      <div class="print-rhead-date">${printDate}</div>
    </div>
  </div>
  <div id="printToolbar">
    <div style="display:flex;align-items:center;gap:10px;">
      ${logoSvg}
      <div>
        <div class="tbar-title">Relatório de Pendências</div>
        <div class="tbar-sub">${escapeHtml(filtroLabel)} · ${printDate}</div>
      </div>
    </div>
    <div class="tbar-actions">
      <button class="btn-close" onclick="window.close()">✕ Fechar</button>
      <button class="btn-print" onclick="window.print()">🖨 Imprimir</button>
    </div>
  </div>
  <div id="printContent">
    <div class="doc-header">
      ${logoSvg}
      <div>
        <div class="doc-brand">CadêOProjeto · Gestão de Engenharia</div>
        <div class="doc-title">Relatório de Pendências</div>
      </div>
      <div class="doc-header-right">
        <div class="doc-proj">${escapeHtml(filtroLabel)}</div>
        <div class="doc-date">Gerado em ${printDate}</div>
      </div>
    </div>
    <div class="doc-stripe"></div>
    <div class="doc-body">
      <div class="doc-summary">${tasks.length} tarefa${tasks.length!==1?'s':''} pendente${tasks.length!==1?'s':''}</div>
      <div class="doc-meta">Gerado em <strong>${printDate}</strong> · ${overdue > 0 ? `<span style="color:#C13B12;font-weight:700;">${overdue} atrasada${overdue!==1?'s':''}</span>` : '0 atrasadas'}</div>

      ${(() => {
        // Detalhamento Mensal Acumulado (todas as tarefas do portfólio visível)
        const _allT = State.allTasks.length > 0 ? State.allTasks : State.tasks;
        const monthMap = {};
        _allT.forEach(tk => {
          if (!tk.end_date) return;
          const k = tk.end_date.slice(0, 7);
          if (!monthMap[k]) monthMap[k] = { planned: 0, done: 0, total: 0 };
          monthMap[k].total++;
          monthMap[k].planned++;
          if (tk.status === 'concluido') monthMap[k].done++;
        });
        const keys = Object.keys(monthMap).sort();
        if (keys.length === 0) return '';
        let accP = 0, accD = 0;
        const cells = keys.map(k => {
          accP += monthMap[k].planned;
          accD += monthMap[k].done;
          const pctAcc = accP > 0 ? (accD / accP * 100).toFixed(0) : '0';
          const dev = accD - accP;
          const devCls = dev > 0 ? 'mc-dev-neg' : dev < 0 ? 'mc-dev-pos' : '';
          const [y, m] = k.split('-');
          const monthLbl = new Date(parseInt(y), parseInt(m) - 1, 1).toLocaleDateString('pt-BR', { month: 'short', year: '2-digit' });
          return `<div class="monthly-cell">
            <div class="mc-month">${monthLbl.replace('.', '')}</div>
            <div class="mc-row"><span>Prev.</span><span>${monthMap[k].planned}</span></div>
            <div class="mc-row"><span>Real.</span><span>${monthMap[k].done}</span></div>
            <div class="mc-row"><span>Desv.</span><span class="${devCls}">${dev >= 0 ? '+' : ''}${dev}</span></div>
            <div class="mc-row"><span>Avanço</span><span>${pctAcc}%</span></div>
          </div>`;
        });
        return `<h3 style="font-size:10px;font-family:monospace;text-transform:uppercase;letter-spacing:.1em;color:#94928B;margin-bottom:8px;">Detalhamento Mensal (Acumulado)</h3>
          <div class="monthly-grid">${cells.join('')}</div>`;
      })()}

  ${grouped.map(g => {
    const overdueN = g.tasks.filter(t2 => t2.end_date && t2.end_date < t).length;
    return `
    <div class="project-block">
      <div class="project-head">
        <div>
          <div class="project-name">${escapeHtml(g.proj.name)}</div>
          ${g.proj.client ? `<div class="project-client">${escapeHtml(g.proj.client)}</div>` : ''}
        </div>
        <div class="project-stats">
          ${overdueN > 0 ? `<span class="danger">${overdueN} atrasada${overdueN!==1?'s':''} · </span>` : ''}
          ${g.tasks.length} pendente${g.tasks.length!==1?'s':''}
        </div>
      </div>
      <table>
        <thead>
          <tr><th>Código</th><th>Título</th><th>Status</th><th>Prio.</th><th>Responsável</th><th>Setor</th><th>Térm. LB</th><th>Térm. Prog.</th><th>Térm. Est.</th></tr>
        </thead>
        <tbody>
          ${g.tasks.map(tk => {
            const isOverdue = tk.end_date && tk.end_date < t;
            const member = State.teamMembers.find(m => m.id === tk.assignee_id);
            const parent = tk.parent_id ? _taskById.get(tk.parent_id) : null;
            const prioClass = { alta: 'prio-alta', media: 'prio-media', baixa: 'prio-baixa' }[tk.priority] || '';
            const dateClass = !tk.end_date ? 'no-date' : isOverdue ? 'overdue' : 'normal-date';
            const fc = forecastEndDate(tk);
            const fcLate = fc && tk.end_date && fc > tk.end_date;
            return `<tr>
              <td class="code">${escapeHtml(tk.code||'—')}</td>
              <td class="title-cell">${escapeHtml(tk.title)}${parent ? `<br><span style="color:#E54B1A;font-size:9px;">↳ ${escapeHtml(parent.title)}</span>` : ''}</td>
              <td>${statusLabels[tk.status]||tk.status}</td>
              <td class="${prioClass}">${tk.priority}</td>
              <td>${member ? `<span class="member"><span class="avatar" style="background:${colorFromString(member.name)};">${initials(member.name)}</span>${escapeHtml(member.name.split(' ')[0])}</span>` : '—'}</td>
              <td>${tk.sector ? escapeHtml(tk.sector) : '—'}</td>
              <td class="no-date">${tk.baseline_end ? fmtDateShort(tk.baseline_end) : '—'}</td>
              <td class="${dateClass}">${tk.end_date ? fmtDateShort(tk.end_date) : '—'}</td>
              <td class="${fcLate ? 'overdue' : 'normal-date'}">${fc ? fmtDateShort(fc) : '—'}</td>
            </tr>`;
          }).join('')}
        </tbody>
      </table>
    </div>`;
  }).join('')}
    </div><!-- /doc-body -->
    <div class="doc-footer">
      <span>CadêOProjeto · Gestão de Projetos de Engenharia</span>
      <span>Relatório de Pendências · ${printDate}</span>
    </div>
  </div><!-- /printContent -->
</body>
</html>`;

    const win = window.open('', '_blank');
    win.document.write(html);
    win.document.close();
    win.focus();
  },

  // Recolhe/expande todas as obras do Relatório de Pendências de uma vez
  toggleAllPendencias() {
    const panels = [...document.querySelectorAll('details[data-panel^="pend-"]')];
    if (!panels.length) return;
    const anyOpen = panels.some(p => p.open);
    panels.forEach(p => {
      const key = p.dataset.panel;
      if (anyOpen) State.collapsedPanels.add(key);   // recolhe todas
      else State.collapsedPanels.delete(key);        // expande todas
    });
    UI.render();
  },

  exportPendenciasCSV() {
    const filtro = State.pendenciasFilter || 'all';
    const allTasks = State.allTasks.length > 0 ? State.allTasks : State.tasks;
    // Tarefas PAI (com filhas) não entram no relatório — apenas as folhas
    const parentIds = new Set(allTasks.filter(t => t.parent_id).map(t => t.parent_id));
    let tasks = allTasks.filter(t => t.status !== 'concluido' && !parentIds.has(t.id) && !t.inactive);
    if (filtro !== 'all') tasks = tasks.filter(t => t.project_id === filtro);
    const sectorFiltro = State.pendenciasSector || 'all';
    if (sectorFiltro !== 'all') tasks = tasks.filter(t => (t.sector || '__none__') === sectorFiltro);
    const _pdf = State.dateFilters.pend;
    if (_pdf && (_pdf.from || _pdf.to)) tasks = tasks.filter(t => DateFilter.matchTask(t, 'pend'));
    const statusLabels = { a_fazer: 'A Fazer', bloqueada: 'Bloqueada', em_andamento: 'Em Andamento', em_projeto: 'Em Projeto' };
    const _taskById = new Map(allTasks.map(tk => [tk.id, tk]));
    const rows = [['Obra','Código','Título','Atividade Pai','Status','Prioridade','Responsável','Setor','Término LB','Término Programado','Término Estimado']];
    tasks.forEach(t => {
      const proj = State.projects.find(p => p.id === t.project_id);
      const member = State.teamMembers.find(m => m.id === t.assignee_id);
      const parent = t.parent_id ? _taskById.get(t.parent_id) : null;
      rows.push([
        proj?.name || '', t.code || '', t.title, parent?.title || '',
        statusLabels[t.status] || t.status, t.priority,
        member?.name || '', t.sector || '',
        t.baseline_end || '', t.end_date || '', forecastEndDate(t) || ''
      ]);
    });
    const csv = rows.map(r => r.map(c => `"${String(c).replace(/"/g,'""')}"`).join(',')).join('\n');
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `pendencias-${today()}.csv`; a.click();
    URL.revokeObjectURL(url);
    toast('CSV exportado', 'success');
  },
});
