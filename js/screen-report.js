// Tela Relatório
import { toast } from './feedback.js';
import { DateFilter, colorFromString, daysBetween, escapeHtml, fmtDateShort, physicalProgress, today } from './helpers.js';
import { KanbanConfig } from './kanban-config.js';
import { RESTRICTION_STATUS, RESTRICTION_TYPES, State } from './state.js';
import { UI } from './ui.js';
import { Views } from './views.js';

// Plugado em Views: continuam acessíveis como Views.<método> e this.<método>.
Object.assign(Views, {
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
});

// Plugado em UI: continuam acessíveis como UI.<método> e this.<método>.
Object.assign(UI, {
  // ============================================================================
  // RELATÓRIO EXECUTIVO — PDF formatado com sumário executivo, KPIs,
  // progresso por disciplina e lista de tarefas em aberto
  // ============================================================================
  printExecutive() {
    const p = Views.current();
    if (!p) { toast('Selecione um projeto', 'warning'); return; }
    // Tarefas inativas só aparecem no Gantt — ficam fora do relatório executivo
    const tasks    = State.tasks.filter(t => !t.inactive);
    const discs    = State.disciplines;
    const members  = State.members;
    const rests    = State.restrictions.filter(r => r.status !== 'cancelada' && r.status !== 'atendida');
    const todayStr = today();
    const genDate  = new Date().toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' });

    // ── KPIs ──────────────────────────────────────────────────────────────────
    const total   = tasks.length;
    const done    = tasks.filter(t => t.status === 'concluido').length;
    const inProg  = tasks.filter(t => t.status === 'em_andamento').length;
    const blocked = tasks.filter(t => t.status === 'bloqueada').length;
    const overdue = tasks.filter(t => t.status !== 'concluido' && t.end_date && t.end_date < todayStr).length;
    const pct     = total > 0 ? Math.round(done / total * 100) : 0;
    const avgProg = Math.round(physicalProgress(tasks));

    // ── Timeline ──────────────────────────────────────────────────────────────
    const totalDays   = p.start_date && p.end_date ? Math.max(1, daysBetween(p.start_date, p.end_date)) : 0;
    const elapsedDays = p.start_date && totalDays ? Math.max(0, Math.min(totalDays, daysBetween(p.start_date, todayStr))) : 0;
    const tlPct       = totalDays ? Math.round(elapsedDays / totalDays * 100) : 0;
    const daysLeft    = p.end_date ? daysBetween(todayStr, p.end_date) : null;

    // ── Disciplinas ───────────────────────────────────────────────────────────
    const discStats = discs.map(d => {
      const dt    = tasks.filter(t => t.discipline_id === d.id);
      const ddone = dt.filter(t => t.status === 'concluido').length;
      const dp    = dt.length > 0 ? Math.round(dt.reduce((s, t) => s + (parseFloat(t.progress) || 0), 0) / dt.length) : 0;
      return { code: d.code, name: d.name, total: dt.length, done: ddone, progress: dp };
    }).filter(d => d.total > 0).sort((a, b) => b.total - a.total);

    // ── Tarefas em aberto por prioridade ──────────────────────────────────────
    const openTasks = tasks
      .filter(t => t.status !== 'concluido')
      .sort((a, b) => {
        const prio = { alta: 0, media: 1, baixa: 2 };
        if ((prio[a.priority]||1) !== (prio[b.priority]||1)) return (prio[a.priority]||1) - (prio[b.priority]||1);
        return (a.end_date || '9999') > (b.end_date || '9999') ? 1 : -1;
      });

    // ── SVG Progress Ring ─────────────────────────────────────────────────────
    const R = 38, CIRC = +(2 * Math.PI * R).toFixed(1);
    const ringOff   = +(CIRC * (1 - pct / 100)).toFixed(1);
    const ringColor = pct >= 80 ? '#059669' : pct >= 40 ? '#E54B1A' : '#D4A82C';

    // ── Tabela de tarefas abertas ─────────────────────────────────────────────
    const SB = {
      a_fazer:      '<span class="badge badge-todo">A Fazer</span>',
      em_andamento: '<span class="badge badge-prog">Andamento</span>',
      bloqueada:    '<span class="badge badge-bloc">Bloqueada</span>',
    };
    const PB = {
      alta:  '<span class="badge badge-high">Alta</span>',
      media: '<span class="badge badge-mid">Média</span>',
      baixa: '<span class="badge badge-low">Baixa</span>',
    };
    const _taskById = new Map(State.tasks.map(tk => [tk.id, tk]));
    const taskRows = openTasks.slice(0, 60).map(t => {
      const m    = members.find(x => x.id === t.assignee_id);
      const d    = discs.find(x => x.id === t.discipline_id);
      const _parent = t.parent_id ? _taskById.get(t.parent_id) : null;
      const isOvd = t.end_date && t.end_date < todayStr;
      const prog = Math.min(100, parseFloat(t.progress) || 0).toFixed(0);
      return `<tr>
        <td>${SB[t.status] || t.status}</td>
        <td>${PB[t.priority] || '—'}</td>
        <td><strong>${escapeHtml(t.title)}</strong>${_parent ? `<br><span style="color:#E54B1A;font-size:9px;">↳ ${escapeHtml(_parent.title)}</span>` : ''}</td>
        <td style="font-family:monospace;white-space:nowrap;${isOvd ? 'color:#C13B12;font-weight:700;' : ''}">${t.end_date ? fmtDateShort(t.end_date) : '—'}${isOvd ? ' ⚠' : ''}</td>
        <td>${m ? escapeHtml(m.name.split(' ')[0]) : '—'}</td>
        <td style="font-family:monospace;font-size:9px;color:#64748b;">${d ? d.code : '—'}</td>
        <td style="font-size:9px;color:#475569;">${t.sector ? escapeHtml(t.sector) : '—'}</td>
        <td>
          <div class="progress-wrap">
            <div class="progress-bar"><div class="progress-fill" style="width:${prog}%;background:${parseFloat(prog)>=100?'#059669':parseFloat(prog)>=50?'#2563eb':'#E54B1A'};"></div></div>
            <span style="font-family:monospace;font-size:9px;">${prog}%</span>
          </div>
        </td>
      </tr>`;
    }).join('');

    // ── Restrições abertas ────────────────────────────────────────────────────
    const restRows = rests.slice(0, 20).map(r => {
      const st = RESTRICTION_STATUS[r.status] || { label: r.status, color: '#888' };
      const resp = r.responsible_id ? members.find(m => m.id === r.responsible_id) : null;
      const isOvd = r.due_date && r.due_date < todayStr && r.status !== 'atendida';
      return `<tr>
        <td style="font-family:monospace;font-size:9px;color:#64748b;">${escapeHtml(RESTRICTION_TYPES[r.type] || r.type || '—')}</td>
        <td><strong>${escapeHtml(r.description)}</strong></td>
        <td><span class="badge" style="background:${st.color}22;color:${st.color};">${st.label}</span></td>
        <td style="font-family:monospace;white-space:nowrap;${isOvd ? 'color:#C13B12;font-weight:700;' : ''}">${r.due_date ? fmtDateShort(r.due_date) : '—'}</td>
        <td>${resp ? escapeHtml(resp.name.split(' ')[0]) : '—'}</td>
      </tr>`;
    }).join('');

    const body = `
      <!-- CABEÇALHO EXECUTIVO -->
      <div style="display:flex;gap:20px;align-items:flex-start;margin-bottom:18px;flex-wrap:wrap;">

        <!-- Anel de progresso -->
        <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;gap:4px;flex-shrink:0;">
          <svg width="100" height="100" viewBox="0 0 100 100">
            <circle cx="50" cy="50" r="${R}" fill="none" stroke="#E8E2D4" stroke-width="10"/>
            <circle cx="50" cy="50" r="${R}" fill="none" stroke="${ringColor}" stroke-width="10"
              stroke-dasharray="${CIRC}" stroke-dashoffset="${ringOff}"
              stroke-linecap="round" transform="rotate(-90 50 50)"/>
            <text x="50" y="46" text-anchor="middle" font-family="monospace" font-size="16" font-weight="800" fill="#1A1714">${pct}%</text>
            <text x="50" y="59" text-anchor="middle" font-family="monospace" font-size="8" fill="#94928B">AVANÇO</text>
          </svg>
        </div>

        <!-- KPIs -->
        <div style="flex:1;min-width:240px;">
          <div style="display:flex;flex-wrap:wrap;gap:10px;margin-bottom:12px;">
            <div style="background:#F2EDE3;border-radius:3px;padding:8px 14px;text-align:center;min-width:70px;">
              <div style="font-family:monospace;font-size:18px;font-weight:800;color:#1A1714;">${total}</div>
              <div style="font-size:9px;color:#94928B;text-transform:uppercase;letter-spacing:.08em;">Tarefas</div>
            </div>
            <div style="background:#d1fae5;border-radius:3px;padding:8px 14px;text-align:center;min-width:70px;">
              <div style="font-family:monospace;font-size:18px;font-weight:800;color:#065f46;">${done}</div>
              <div style="font-size:9px;color:#065f46;text-transform:uppercase;letter-spacing:.08em;">Concluídas</div>
            </div>
            <div style="background:#fef3c7;border-radius:3px;padding:8px 14px;text-align:center;min-width:70px;">
              <div style="font-family:monospace;font-size:18px;font-weight:800;color:#92400e;">${inProg}</div>
              <div style="font-size:9px;color:#92400e;text-transform:uppercase;letter-spacing:.08em;">Em Andamento</div>
            </div>
            <div style="background:${overdue > 0 ? '#fee2e2' : '#F2EDE3'};border-radius:3px;padding:8px 14px;text-align:center;min-width:70px;">
              <div style="font-family:monospace;font-size:18px;font-weight:800;color:${overdue > 0 ? '#991b1b' : '#94928B'};">${overdue}</div>
              <div style="font-size:9px;color:${overdue > 0 ? '#991b1b' : '#94928B'};text-transform:uppercase;letter-spacing:.08em;">Em Atraso</div>
            </div>
            ${blocked > 0 ? `<div style="background:#fee2e2;border-radius:3px;padding:8px 14px;text-align:center;min-width:70px;">
              <div style="font-family:monospace;font-size:18px;font-weight:800;color:#991b1b;">${blocked}</div>
              <div style="font-size:9px;color:#991b1b;text-transform:uppercase;letter-spacing:.08em;">Bloqueadas</div>
            </div>` : ''}
          </div>
          ${totalDays > 0 ? `
          <!-- Timeline bar -->
          <div style="margin-bottom:6px;">
            <div style="display:flex;justify-content:space-between;font-family:monospace;font-size:9px;color:#94928B;margin-bottom:4px;">
              <span>${p.start_date ? fmtDateShort(p.start_date) : '—'}</span>
              <span style="color:${daysLeft !== null && daysLeft < 0 ? '#C13B12' : '#1A1714'};font-weight:700;">
                ${daysLeft !== null ? (daysLeft < 0 ? `${Math.abs(daysLeft)}d de atraso` : `${daysLeft}d restantes`) : ''}
              </span>
              <span>${p.end_date ? fmtDateShort(p.end_date) : '—'}</span>
            </div>
            <div style="height:8px;background:#E8E2D4;border-radius:4px;overflow:hidden;position:relative;">
              <div style="position:absolute;inset:0;width:${Math.min(100, tlPct)}%;background:${tlPct > 85 ? '#C13B12' : tlPct > 60 ? '#D4A82C' : '#2563eb'};border-radius:4px;"></div>
              <div style="position:absolute;inset:0;width:${Math.min(100, pct)}%;background:${ringColor};border-radius:4px;opacity:0.5;"></div>
            </div>
            <div style="font-family:monospace;font-size:9px;color:#94928B;margin-top:3px;text-align:center;">${tlPct}% do tempo decorrido · ${avgProg}% de progresso médio das tarefas</div>
          </div>` : ''}
        </div>
      </div>

      <!-- PROGRESSO POR DISCIPLINA -->
      ${discStats.length > 0 ? `
      <h2>Progresso por Disciplina</h2>
      <table>
        <thead><tr>
          <th style="width:60px;">Código</th><th>Disciplina</th>
          <th style="width:50px;text-align:right;">Total</th>
          <th style="width:50px;text-align:right;">Feitas</th>
          <th>Progresso</th>
          <th style="width:44px;text-align:right;">%</th>
        </tr></thead>
        <tbody>${discStats.map(d => `<tr>
          <td style="font-family:monospace;font-weight:700;font-size:10px;color:#2563eb;">${escapeHtml(d.code)}</td>
          <td>${escapeHtml(d.name)}</td>
          <td style="text-align:right;font-family:monospace;">${d.total}</td>
          <td style="text-align:right;font-family:monospace;color:${d.done===d.total&&d.total>0?'#059669':'#1A1714'};">${d.done}</td>
          <td><div class="progress-wrap"><div class="progress-bar" style="height:6px;"><div class="progress-fill" style="width:${d.progress}%;background:${d.progress>=100?'#059669':d.progress>=60?'#2563eb':'#E54B1A'};height:100%;"></div></div></div></td>
          <td style="text-align:right;font-family:monospace;font-weight:700;">${d.progress}%</td>
        </tr>`).join('')}</tbody>
      </table>` : ''}

      <!-- TAREFAS EM ABERTO -->
      ${openTasks.length > 0 ? `
      <h2>Tarefas em Aberto${openTasks.length > 60 ? ` (60 de ${openTasks.length})` : ` (${openTasks.length})`}</h2>
      <table>
        <thead><tr>
          <th style="width:72px;">Status</th><th style="width:52px;">Prior.</th>
          <th>Tarefa</th><th style="width:60px;">Prazo</th>
          <th style="width:70px;">Responsável</th><th style="width:44px;">Disc.</th>
          <th style="width:50px;">Setor</th><th style="width:90px;">Progresso</th>
        </tr></thead>
        <tbody>${taskRows}</tbody>
      </table>` : `<h2>Tarefas em Aberto</h2><p style="color:#94928B;font-size:11px;padding:10px 0;">Todas as tarefas foram concluídas. 🎉</p>`}

      <!-- RESTRIÇÕES ABERTAS -->
      ${rests.length > 0 ? `
      <h2>Restrições Pendentes (${rests.length})</h2>
      <table>
        <thead><tr>
          <th style="width:80px;">Tipo</th><th>Descrição</th>
          <th style="width:80px;">Status</th><th style="width:60px;">Prazo</th>
          <th style="width:70px;">Responsável</th>
        </tr></thead>
        <tbody>${restRows}</tbody>
      </table>` : ''}
    `;

    this._printWindow('Relatório Executivo', body);
  },
});
