// Views: geração de HTML das telas
import { DEP_TYPE_PT, DateFilter, SITUACAO_META, _wdBetweenCache, colorFromString, daysBetween, escapeHtml, fmtDateFull, fmtDateShort, forecastEndDate, initials, parentTag, physicalProgress, plannedProgressPct, relativeDate, taskSituacao, today, workingDaysBetween } from './helpers.js';
import { CPMCache, computeCriticalPath } from './cpm.js';
import { CONSTRAINT_TYPES, DELAY_CAUSES, PPC_CAUSES, State } from './state.js';
import { DB } from './db.js';
import { Perf } from './perf.js';
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

};
