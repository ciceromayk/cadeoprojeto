// Cronograma (Gantt): render, edição inline, arrastar, menu de contexto, exportação e impressão
import { CPMCache, autoSchedule, computeCriticalPath, dependencyCycle } from './cpm.js';
import { DB } from './db.js';
import { Dialog } from './dialog.js';
import { friendlyError, setLoading, toast } from './feedback.js';
import { GanttCols } from './gantt-cols.js';
import { $, $$, DEP_TYPE_FROM_PT, DEP_TYPE_PT, SITUACAO_META, _wdBetweenCache, addDays, addWorkingDays, daysBetween, escapeHtml, fmtDateFull, fmtDateShort, forecastEndDate, nextWorkday, physicalProgress, plannedProgressPct, rolledProgress, snapTaskDates, taskSituacao, today, workingDaysBetween } from './helpers.js';
import { Modal } from './modal.js';
import { Perf } from './perf.js';
import { CONSTRAINT_TYPES, DELAY_CAUSES, PPC_CAUSES, State } from './state.js';
import { UI } from './ui.js';
import { Views } from './views.js';

// Cache de render do Gantt — populados em gantt(), consumidos em _renderGanttImpl().
// Evita recalcular taskSituacao/forecastEndDate 3× por render (contagem + filtro + célula).
let _ganttSitCache = null; // Map<taskId, situacao>
let _ganttFcCache  = null; // Map para forecastEndDate (compartilhado nas 3 passagens)

// Plugado em Views: continuam acessíveis como Views.<método> e this.<método>.
Object.assign(Views, {
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
});

// Plugado em UI: continuam acessíveis como UI.<método> e this.<método>.
Object.assign(UI, {
  bindGanttDrag() {
    let dragging = null;
    $$('.gantt-bar').forEach(bar => {
      bar.addEventListener('mousedown', (e) => {
        // Tarefas pai (com filhos) são travadas — apenas folhas podem ser arrastadas
        if (bar.dataset.isParent === 'true') return;
        if (e.target.classList.contains('gantt-bar-resize')) {
          dragging = { mode: 'resize', bar, startX: e.clientX, startWidth: bar.offsetWidth, taskId: bar.dataset.taskId };
        } else {
          dragging = { mode: 'move', bar, startX: e.clientX, startLeft: parseInt(bar.style.left), taskId: bar.dataset.taskId };
        }
        bar.classList.add('dragging');
        e.preventDefault();
      });
    });

    document.addEventListener('mousemove', (e) => {
      if (!dragging) return;
      const dx = e.clientX - dragging.startX;
      let cellWidth = 28;
      if (State.ganttZoom === 'week') cellWidth = 14;
      if (State.ganttZoom === 'month') cellWidth = 6;
      const days = Math.round(dx / cellWidth);
      if (dragging.mode === 'move') {
        dragging.bar.style.left = (dragging.startLeft + days * cellWidth) + 'px';
        dragging._days = days;
      } else {
        const newWidth = Math.max(cellWidth, dragging.startWidth + days * cellWidth);
        dragging.bar.style.width = newWidth + 'px';
        dragging._days = days;
      }
    });

    document.addEventListener('mouseup', async () => {
      if (!dragging) return;
      dragging.bar.classList.remove('dragging');
      const days = dragging._days || 0;
      if (days !== 0) {
        const task = State.tasks.find(t => t.id === dragging.taskId);
        if (task) {
          try {
            setLoading(true);
            const patch = dragging.mode === 'move'
              ? { start_date: addDays(task.start_date, days), end_date: addDays(task.end_date, days) }
              : { end_date: addDays(task.end_date, days) };
            // Dias úteis: arraste/redimensionamento nunca deixa início/término em dia não útil.
            const _ps = ('start_date' in patch) ? patch.start_date : task.start_date;
            const _sn = snapTaskDates(_ps, patch.end_date);
            if ('start_date' in patch) patch.start_date = _sn.start;
            patch.end_date = _sn.end;
            await DB.updateTask(task.id, patch);
            Object.assign(task, patch);
            await UI.rollUpParentTask(task.parent_id || null, true);
            await UI.render();
            UI.scheduleAutoRecalc();
          } catch (err) { toast(friendlyError(err), 'error'); }
          finally { setLoading(false); }
        }
      }
      dragging = null;
    });
  },

  // ===== CONFIGURAR COLUNAS DO GANTT =====
  openGanttColumnsModal() {
    const render = () => {
      const visible = GanttCols.getVisible();
      const rowsHtml = GanttCols.REGISTRY.map(c => {
        const on = visible.includes(c.id);
        return `
          <div style="display:flex;align-items:center;gap:10px;padding:9px 12px;border-bottom:1px solid var(--border);${c.core ? 'opacity:.85;' : ''}">
            <label style="display:flex;align-items:center;gap:10px;flex:1;cursor:${c.core ? 'not-allowed' : 'pointer'};min-width:0;">
              <input type="checkbox" data-col-toggle="${c.id}" ${on ? 'checked' : ''} ${c.core ? 'disabled' : ''} style="width:16px;height:16px;accent-color:var(--accent);">
              <span style="font-size:13px;font-weight:500;">${c.label}</span>
              ${c.core ? '<span style="font-family:var(--font-mono);font-size:9px;color:var(--ink-mute);text-transform:uppercase;letter-spacing:.08em;">fixa</span>' : ''}
            </label>
            <div style="display:flex;align-items:center;gap:5px;${on ? '' : 'opacity:.35;pointer-events:none;'}">
              <span style="font-family:var(--font-mono);font-size:10px;color:var(--ink-mute);">largura</span>
              <input type="number" data-col-width="${c.id}" value="${GanttCols.widthOf(c.id)}" min="${c.min || 28}" max="600" step="2"
                style="width:64px;font-family:var(--font-mono);font-size:12px;text-align:right;background:var(--bg-deep);border:1px solid var(--border);color:var(--ink);border-radius:2px;padding:3px 6px;">
              <span style="font-family:var(--font-mono);font-size:10px;color:var(--ink-mute);">px</span>
            </div>
          </div>`;
      }).join('');
      $('#modalBody').innerHTML = `
        <div style="font-size:13px;color:var(--ink-soft);margin-bottom:12px;">Marque quais colunas aparecem e defina a <strong>largura</strong> (px) de cada uma. <strong>EAP</strong> e <strong>Descrição</strong> são fixas (sempre visíveis). Também é possível arrastar a borda direita do cabeçalho no Gantt.</div>
        <div style="border:1px solid var(--border);border-radius:3px;overflow:hidden;">${rowsHtml}</div>`;
      $('#modalBody').querySelectorAll('[data-col-toggle]').forEach(chk => {
        chk.onchange = () => { GanttCols.toggle(chk.dataset.colToggle); UI.render(); render(); };
      });
      $('#modalBody').querySelectorAll('[data-col-width]').forEach(inp => {
        inp.onchange = () => {
          const v = parseInt(inp.value);
          if (!isNaN(v)) { GanttCols.setWidth(inp.dataset.colWidth, v); UI.render(); render(); }
        };
      });
    };
    Modal.open({
      title: 'Colunas do Cronograma',
      body: '',
      footer: `<button class="btn btn-ghost" id="btnResetGanttCols">Restaurar padrão</button>
               <button class="btn btn-cta" id="btnDoneGanttCols">Concluído</button>`
    });
    render();
    $('#btnResetGanttCols').onclick = () => { GanttCols.reset(); UI.render(); render(); };
    $('#btnDoneGanttCols').onclick = () => Modal.close();
  },

  // ===== EDIÇÃO INLINE NAS COLUNAS DO GANTT =====
  // Centraliza a barra da tarefa no gráfico do Gantt ("ir para a tarefa")
  scrollGanttToTask(taskId) {
    const bar = document.querySelector(`.gantt-bar[data-task-id="${taskId}"], .gantt-milestone[data-task-id="${taskId}"]`);
    const scroll = document.getElementById('ganttScroll');
    if (!bar || !scroll) return;
    const leftPanelW = document.querySelector('.gantt-header-left')?.offsetWidth || 700;
    const barLeft   = parseInt(bar.style.left)  || 0;
    const barWidth  = parseInt(bar.style.width) || 28;
    const viewportW = scroll.clientWidth - leftPanelW;
    const target    = Math.max(0, barLeft - viewportW / 2 + barWidth / 2);
    scroll.scrollTo({ left: target, behavior: 'smooth' });
    bar.style.transition = 'filter .2s'; bar.style.filter = 'brightness(1.5)';
    setTimeout(() => { bar.style.filter = ''; }, 600);
  },

  // Salva as predecessoras editadas inline no Gantt (formato MS Project: "12, 15FS+2, 8SS-1").
  async _saveGanttPredecessors(taskId, val) {
    const task = State.tasks.find(t => t.id === taskId);
    if (!task) return;
    const idByRow = (Views._rowNumberToId instanceof Map) ? Views._rowNumberToId : new Map();
    // Exclusões: a própria tarefa, seus ancestrais e seus descendentes (evita ciclos)
    const excluded = new Set([taskId]);
    let anc = task.parent_id, g = 0;
    while (anc && g++ < 50) { excluded.add(anc); const p = State.tasks.find(x => x.id === anc); anc = p ? p.parent_id : null; }
    const stack = State.tasks.filter(x => x.parent_id === taskId);
    while (stack.length) { const t = stack.pop(); excluded.add(t.id); State.tasks.filter(x => x.parent_id === t.id).forEach(c => stack.push(c)); }
    // Parse das entradas
    const entries = (val || '').split(',').map(s => s.trim()).filter(Boolean);
    const parsed = [];
    for (const e of entries) {
      const m = e.match(/^(\d+)\s*(TI|II|TT|IT|FS|SS|FF|SF)?\s*([+-]\s*\d+)?$/i);
      if (!m) { toast(`Predecessora inválida: "${e}"`, 'error'); return; }
      const rn = parseInt(m[1]);
      const pid = idByRow.get(rn);
      if (!pid) { toast(`A linha ${rn} não existe`, 'error'); return; }
      if (excluded.has(pid)) { toast(`Linha ${rn}: não pode ser a própria tarefa, um ancestral ou uma subtarefa`, 'error'); return; }
      if (parsed.some(x => x.predecessor_id === pid)) continue; // ignora repetição
      const _raw = (m[2] || '').toUpperCase();           // rótulo PT (TI/II/TT/IT) ou código interno
      const type = _raw ? (DEP_TYPE_FROM_PT[_raw] || _raw) : 'FS';
      parsed.push({ predecessor_id: pid, type, lag_days: m[3] ? parseInt(m[3].replace(/\s+/g, '')) : 0 });
    }
    // Reconcilia por conteúdo (predecessor|tipo|lag): remove o que saiu, cria o que entrou
    const _key = d => `${d.predecessor_id}|${d.type || 'FS'}|${d.lag_days || 0}`;
    const existing = State.dependencies.filter(d => d.task_id === taskId);
    const desired = new Set(parsed.map(_key));
    const existKeys = new Set(existing.map(_key));
    if (dependencyCycle(State.tasks, State.dependencies.filter(d => d.task_id !== taskId)
      .concat(parsed.map(d => ({ ...d, task_id: taskId }))))) {
      toast('Dependência circular: remova o vínculo que fecha o ciclo.', 'error');
      return;
    }
    try {
      for (const ex of existing) {
        if (!desired.has(_key(ex))) { await DB.deleteDependency(ex.id); State.dependencies = State.dependencies.filter(x => x.id !== ex.id); }
      }
      for (const d of parsed) {
        if (existKeys.has(_key(d))) continue;
        const created = await DB.createDependency({ task_id: taskId, predecessor_id: d.predecessor_id, type: d.type, lag_days: d.lag_days || 0 });
        State.dependencies.push(created); existKeys.add(_key(d));
      }
      CPMCache.invalidate();
      UI.render();
      UI.scheduleAutoRecalc();
    } catch (err) {
      const raw = err?.message || '';
      const msg = (raw.includes('task_dependencies') || raw.includes('does not exist') || raw.includes('relation'))
        ? 'A tabela task_dependencies não existe. Rode REPAIR-v3.2.sql no Supabase.' : friendlyError(err);
      toast('Falha ao salvar predecessoras: ' + msg, 'error');
    }
  },

  startGanttInlineEdit(cell, taskId, field) {
    const task = State.tasks.find(t => t.id === taskId);
    if (!task || !cell) return;
    if (!DB.iCanEdit()) { toast('Sem permissão para editar neste projeto', 'error'); return; }
    const isParent = State.tasks.some(t => t.parent_id === taskId);
    const isMs = !!task.is_milestone;
    if ((field === 'duration' || field === 'end') && (isParent || isMs)) { toast(isParent ? 'Calculado pelas subtarefas' : 'Marco não tem duração', 'info'); return; }
    if (field === 'start' && isParent) { toast('Datas do pai são calculadas pelas subtarefas', 'info'); return; }
    if (field === 'progress' && isParent) { toast('Progresso do pai é calculado pelas subtarefas', 'info'); return; }
    // Predecessoras SÃO permitidas em tarefas-pai (fase): é o que liga uma fase a outra.
    if (cell.querySelector('input')) return; // já editando

    const original = cell.innerHTML;
    const input = document.createElement('input');
    input.className = 'g-inline-input';
    if (field === 'title') {
      input.type = 'text'; input.value = task.title || '';
      input.style.cssText = 'font-size:13px;padding:1px 4px;border:1px solid var(--accent);border-radius:2px;background:var(--bg-panel);color:var(--ink);';
    } else if (field === 'duration') {
      input.type = 'number'; input.min = '1'; input.step = '1';
      input.value = String(workingDaysBetween(task.start_date, task.end_date));
      input.style.cssText = 'font-size:11px;padding:1px 2px;text-align:center;border:1px solid var(--accent);border-radius:2px;background:var(--bg-panel);color:var(--ink);font-family:var(--font-mono);';
    } else if (field === 'progress') {
      input.type = 'number'; input.min = '0'; input.max = '100'; input.step = '1';
      input.value = String(Math.round(parseFloat(task.progress) || 0));
      input.style.cssText = 'font-size:11px;padding:1px 2px;text-align:right;border:1px solid var(--accent);border-radius:2px;background:var(--bg-panel);color:var(--ink);font-family:var(--font-mono);';
    } else if (field === 'sector') {
      // Usa select (não input livre) — só setores cadastrados
      const sel = document.createElement('select');
      sel.style.cssText = 'font-size:11px;padding:1px 2px;border:1px solid var(--accent);border-radius:2px;background:var(--bg-panel);color:var(--ink);max-width:100%;';
      const sectorNames = [...new Set((State.sectors || []).map(s => s.name).concat(State.tasks.map(t => t.sector).filter(Boolean)))].sort((a, b) => a.localeCompare(b));
      sel.innerHTML = `<option value="">— Sem setor</option>` + sectorNames.map(n => `<option value="${escapeHtml(n)}" ${task.sector === n ? 'selected' : ''}>${escapeHtml(n)}</option>`).join('');
      cell.innerHTML = '';
      cell.appendChild(sel);
      sel.focus();
      let sdone = false;
      const srestore = () => { if (!sdone) { sdone = true; UI.render(); } };
      const scommit = async () => {
        if (sdone) return; sdone = true;
        const val = sel.value || null;
        if ((val || null) !== (task.sector || null)) await UI.saveGanttInline(taskId, 'sector', val || '');
        else UI.render();
      };
      sel.addEventListener('change', scommit);
      sel.addEventListener('blur', scommit);
      sel.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.preventDefault(); srestore(); } });
      return; // saída antecipada — já criou o select diretamente
    } else if (field === 'predecessors') {
      input.type = 'text';
      const _rowOf = (Views._rowNumbers instanceof Map) ? Views._rowNumbers : new Map();
      input.value = State.dependencies.filter(d => d.task_id === taskId).map(d => {
        const rn = _rowOf.get(d.predecessor_id); if (!rn) return '';
        const tt = (d.type && d.type !== 'FS') ? (DEP_TYPE_PT[d.type] || d.type) : '';
        const lg = d.lag_days ? (d.lag_days > 0 ? '+' + d.lag_days : String(d.lag_days)) : '';
        return `${rn}${tt}${lg}`;
      }).filter(Boolean).join(', ');
      input.style.cssText = 'font-size:11px;padding:1px 4px;border:1px solid var(--accent);border-radius:2px;background:var(--bg-panel);color:var(--ink);font-family:var(--font-mono);min-width:90px;';
      input.title = 'Ex.: 12, 15TT+2, 8II-1 (nº da linha + tipo TI/II/TT/IT + lag em dias úteis; negativo = antecipação). Vazio remove todas.';
    } else { // start | end
      input.type = 'date'; input.value = field === 'start' ? task.start_date : task.end_date;
      input.style.cssText = 'font-size:10px;padding:1px 2px;border:1px solid var(--accent);border-radius:2px;background:var(--bg-panel);color:var(--ink);font-family:var(--font-mono);';
    }
    cell.innerHTML = '';
    cell.appendChild(input);
    input.focus();
    if (input.select) try { input.select(); } catch (e) {}

    let done = false;
    const restore = () => { if (!done) { done = true; cell.innerHTML = original; } };
    const commit = async () => {
      if (done) return; done = true;
      const val = input.value;
      cell.innerHTML = original; // o re-render aplicará o valor definitivo
      await UI.saveGanttInline(taskId, field, val);
    };
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); commit(); }
      else if (e.key === 'Escape') { e.preventDefault(); restore(); }
    });
    input.addEventListener('blur', commit);
  },

  async saveGanttInline(taskId, field, val) {
    const task = State.tasks.find(t => t.id === taskId);
    if (!task) return;
    // Predecessoras valem para qualquer tarefa, INCLUSIVE pai (fase) — tratado antes do
    // guard de roll-up, pois é o que liga uma fase à outra.
    if (field === 'predecessors') { await this._saveGanttPredecessors(taskId, val); return; }
    // Defesa: datas/duração/progresso de tarefa-pai são roll-up (título e setor são editáveis)
    if (!['title', 'sector'].includes(field) && State.tasks.some(t => t.parent_id === taskId)) return;
    if (field !== 'title' && task.is_milestone && (field === 'duration' || field === 'end')) return;
    const patch = {};
    if (field === 'title') {
      const t = (val || '').trim();
      if (!t || t === task.title) return;
      patch.title = t;
    } else if (field === 'duration') {
      // Duração em DIAS ÚTEIS (igual ao campo da tarefa): término = início + N dias úteis.
      const d = parseInt(val);
      if (!d || d < 1) return;
      const s = nextWorkday(task.start_date);              // início sempre em dia útil
      const newEnd = addWorkingDays(s, d);
      if (s === task.start_date && newEnd === task.end_date) return;
      if (s !== task.start_date) patch.start_date = s;
      patch.end_date = newEnd;
    } else if (field === 'start') {
      if (!val || val === task.start_date) return;
      const s = nextWorkday(val);                          // empurra p/ próximo dia útil
      const wdur = workingDaysBetween(task.start_date, task.end_date); // preserva duração útil
      patch.start_date = s;
      patch.end_date = addWorkingDays(s, wdur);
    } else if (field === 'end') {
      if (!val || val === task.end_date) return;
      if (val < task.start_date) { toast('Término não pode ser antes do início', 'error'); return; }
      const _sn = snapTaskDates(task.start_date, val);     // término no último dia útil
      if (_sn.end === task.end_date) return;
      patch.end_date = _sn.end;
    } else if (field === 'progress') {
      let p = parseFloat(val);
      if (isNaN(p)) return;
      p = Math.max(0, Math.min(100, p));
      if (p === (parseFloat(task.progress) || 0)) return;
      patch.progress = p;
      // Status derivado do progresso
      if (p >= 100) patch.status = 'concluido';
      else if (p > 0 && task.status === 'a_fazer') patch.status = 'em_andamento';
      else if (p === 0 && task.status === 'concluido') patch.status = 'a_fazer';
    } else if (field === 'sector') {
      const s = (val || '').trim();
      if ((s || null) === (task.sector || null)) return;
      patch.sector = s || null;
    }
    // ── Edição OTIMISTA: aplica em memória + 1 render imediato; grava no banco
    //    em segundo plano. Evita o "travamento" de esperar a rede a cada edição.
    Object.assign(task, patch);
    const parentPatches = this._rollUpInMemory(task.parent_id || null);
    const datesChanged = ('start_date' in patch) || ('end_date' in patch);
    if (datesChanged) CPMCache.invalidate();
    UI.render();

    // Persiste em segundo plano (sem bloquear a UI)
    (async () => {
      try {
        await DB.updateTask(taskId, patch);
        for (const [pid, ppatch] of parentPatches) await DB.updateTask(pid, ppatch);
        // Só reprograma dependências quando DATAS mudaram (progresso/setor não afetam o cronograma)
        if (datesChanged) UI.scheduleAutoRecalc();
      } catch (err) {
        toast('Erro ao salvar: ' + err.message, 'error');
        try { await DB.loadCurrentProject(); await UI.render(); } catch (e) { console.warn('[inline-save] rollback falhou:', e.message); }
      }
    })();

    // Setor: oferecer "puxar" o valor para todas as subtarefas (preenchimento em massa)
    if (field === 'sector') {
      const kids = State.tasks.filter(t => t.parent_id === taskId);
      if (kids.length) {
        const descCount = this._countDescendants(taskId);
        const ok = await Dialog.confirm({
          title: 'Aplicar setor às subtarefas?',
          msg: `Deseja aplicar o setor ${task.sector ? '“' + task.sector + '”' : '(vazio)'} às ${descCount} subtarefa(s) desta tarefa?`,
          confirmText: 'Aplicar a todas',
        });
        if (ok) {
          const n = await this.applySectorToSubtree(taskId, task.sector || null);
          UI.render();
          toast(`Setor aplicado a ${n} subtarefa(s)`, 'success');
        }
      }
    }
  },

  // Roll-up dos pais EM MEMÓRIA (sem I/O). Retorna [[id, patch], ...] p/ persistir.
  _rollUpInMemory(parentId) {
    const patches = [];
    let pid = parentId; const seen = new Set();
    while (pid && !seen.has(pid)) {
      seen.add(pid);
      const parent = State.tasks.find(t => t.id === pid);
      if (!parent) break;
      const children = State.tasks.filter(t => t.parent_id === pid && !t.inactive);
      if (children.length) {
        const wS = children.filter(c => c.start_date), wE = children.filter(c => c.end_date);
        const newStart = wS.length ? wS.reduce((m, c) => c.start_date < m ? c.start_date : m, wS[0].start_date) : parent.start_date;
        const newEnd   = wE.length ? wE.reduce((m, c) => c.end_date > m ? c.end_date : m, wE[0].end_date) : parent.end_date;
        const newProg  = rolledProgress(children);
        const upd = {};
        if (newStart && parent.start_date !== newStart) upd.start_date = newStart;
        if (newEnd && parent.end_date !== newEnd) upd.end_date = newEnd;
        if (Math.round(parseFloat(parent.progress) || 0) !== newProg) upd.progress = newProg;
        if (newProg >= 100 && parent.status !== 'concluido') upd.status = 'concluido';
        else if (newProg < 100 && parent.status === 'concluido') upd.status = 'em_andamento';
        if (Object.keys(upd).length) { Object.assign(parent, upd); patches.push([pid, upd]); }
      }
      pid = parent.parent_id;
    }
    return patches;
  },

  _countDescendants(taskId) {
    let n = 0;
    const walk = (pid) => State.tasks.filter(t => t.parent_id === pid).forEach(c => { n++; walk(c.id); });
    walk(taskId);
    return n;
  },

  // ===== MENU DE CONTEXTO DO GANTT (clique direito) =====
  showGanttContextMenu(x, y, taskId) {
    document.getElementById('ganttCtxMenu')?.remove();
    const task = State.tasks.find(t => t.id === taskId);
    if (!task) return;
    const canEdit = DB.iCanEdit();
    const menu = document.createElement('div');
    menu.id = 'ganttCtxMenu';
    menu.style.cssText = `position:fixed;left:${x}px;top:${y}px;z-index:10000;background:var(--bg-panel);border:1px solid var(--border-strong);border-radius:5px;box-shadow:0 6px 24px rgba(0,0,0,.22);padding:4px;min-width:200px;font-size:13px;`;
    const item = (icon, label, action, danger) => `
      <div class="gctx-item" data-gctx="${action}" style="display:flex;align-items:center;gap:9px;padding:7px 10px;border-radius:3px;cursor:pointer;color:${danger ? 'var(--accent-danger)' : 'var(--ink)'};white-space:nowrap;">
        <span style="width:16px;text-align:center;">${icon}</span>${label}
      </div>`;
    const sep = `<div style="height:1px;background:var(--border);margin:4px 2px;"></div>`;
    menu.innerHTML = `
      <div style="padding:5px 10px 6px;font-size:10px;font-family:var(--font-mono);color:var(--ink-mute);text-transform:uppercase;letter-spacing:.08em;overflow:hidden;text-overflow:ellipsis;max-width:220px;">${escapeHtml(task.code || '')} · ${escapeHtml((task.title || '').slice(0, 28))}</div>
      ${item('⌖', 'Ir para a tarefa no gráfico', 'goto')}
      ${sep}
      ${canEdit ? `
        ${item('↑', 'Nova tarefa acima', 'above')}
        ${item('↓', 'Nova tarefa abaixo', 'below')}
        ${item('↳', 'Nova subtarefa', 'child')}
        ${sep}` : ''}
      ${(canEdit && State.tasks.some(t => t.parent_id === taskId)) ? item('▤', 'Puxar setor p/ subtarefas', 'sector-down') : ''}
      ${item('✎', 'Editar tarefa', 'edit')}`;
    document.body.appendChild(menu);
    // Reposiciona se sair da tela
    const r = menu.getBoundingClientRect();
    if (r.right > window.innerWidth) menu.style.left = (window.innerWidth - r.width - 8) + 'px';
    if (r.bottom > window.innerHeight) menu.style.top = (window.innerHeight - r.height - 8) + 'px';
    // hover
    menu.querySelectorAll('.gctx-item').forEach(it => {
      it.onmouseover = () => it.style.background = 'var(--bg-hover)';
      it.onmouseout = () => it.style.background = 'transparent';
      it.onclick = async () => {
        const act = it.dataset.gctx;
        menu.remove();
        if (act === 'edit') this.openTaskModal(taskId);
        else if (act === 'goto') this.scrollGanttToTask(taskId);
        else if (act === 'sector-down') {
          const descCount = this._countDescendants(taskId);
          const ok = await Dialog.confirm({
            title: 'Puxar setor para subtarefas',
            msg: `Aplicar o setor ${task.sector ? '“' + task.sector + '”' : '(vazio)'} às ${descCount} subtarefa(s)?`,
            confirmText: 'Aplicar a todas',
          });
          if (ok) { const n = await this.applySectorToSubtree(taskId, task.sector || null); await UI.render(); toast(`Setor aplicado a ${n} subtarefa(s)`, 'success'); }
        }
        else this.createTaskRelative(taskId, act);
      };
    });
    const closer = (ev) => { if (!menu.contains(ev.target)) { menu.remove(); document.removeEventListener('mousedown', closer); document.removeEventListener('scroll', closer, true); } };
    setTimeout(() => { document.addEventListener('mousedown', closer); document.addEventListener('scroll', closer, true); }, 0);
  },

  async createTaskRelative(taskId, position) {
    if (!DB.iCanEdit()) { toast('Sem permissão para criar tarefas neste projeto', 'error'); return; }
    const ref = State.tasks.find(t => t.id === taskId);
    if (!ref) return;
    const oi = (t) => (typeof t.order_index === 'number' ? t.order_index : Date.parse(t.created_at || 0) || 0);
    let parent_id, order_index;
    if (position === 'child') {
      parent_id = ref.id;
      const kids = State.tasks.filter(t => t.parent_id === ref.id).sort((a, b) => oi(a) - oi(b));
      order_index = kids.length ? oi(kids[kids.length - 1]) + 1 : oi(ref) + 0.5;
    } else {
      parent_id = ref.parent_id || null;
      const sibs = State.tasks.filter(t => (t.parent_id || null) === (parent_id || null)).sort((a, b) => oi(a) - oi(b));
      const idx = sibs.findIndex(t => t.id === ref.id);
      if (position === 'below') {
        const next = sibs[idx + 1];
        order_index = next ? (oi(ref) + oi(next)) / 2 : oi(ref) + 1;
      } else { // above
        const prev = sibs[idx - 1];
        order_index = prev ? (oi(prev) + oi(ref)) / 2 : oi(ref) - 1;
      }
    }
    // Cria DIRETO no Gantt (sem abrir o modal) e já abre a edição inline do nome.
    try {
      setLoading(true);
      const payload = {
        title: 'Nova tarefa',
        status: 'a_fazer',
        priority: 'media',
        progress: 0,
        start_date: ref.start_date || today(),
        end_date: ref.end_date || addDays(today(), 7),
        parent_id,
        order_index,
        discipline_id: ref.discipline_id || null,
        sector: ref.sector || null,
      };
      const created = await DB.createTask(State.currentProjectId, payload);
      State.tasks.push(created);
      // Reordena por order_index para a nova tarefa aparecer na posição certa (acima/abaixo)
      const _oi = (t) => (typeof t.order_index === 'number' ? t.order_index : Date.parse(t.created_at || 0) || 0);
      State.tasks.sort((a, b) => _oi(a) - _oi(b));
      // Se virou subtarefa de uma folha, o pai deixa de ser folha → roll-up de datas/progresso
      if (parent_id) await UI.rollUpParentTask(parent_id, true);
      await UI.render();
      // Abre a edição inline do nome da nova tarefa (preencher a descrição sem modal)
      setTimeout(() => {
        const cell = document.querySelector(`.gantt-row-left[data-task-id="${created.id}"] [data-field="title"]`);
        if (cell) {
          try { UI.scrollGanttToTask(created.id); } catch (_) {}
          UI.startGanttInlineEdit(cell.querySelector('.gantt-task-name') || cell, created.id, 'title');
        }
      }, 60);
    } catch (err) { toast(friendlyError(err), 'error'); }
    finally { setLoading(false); }
  },

  exportGanttCSV() {
    const p = Views.current();
    if (!p) { toast('Selecione um projeto', 'warning'); return; }
    const tasks = State.tasks;
    if (!tasks.length) { toast('Nenhuma tarefa para exportar', 'warning'); return; }

    // Recomputa WBS (mesma lógica do renderGantt)
    const wbsCodes = new Map();
    const wbsDepths = new Map();
    const byParent = new Map();
    tasks.forEach(t => {
      const pid = t.parent_id || null;
      if (!byParent.has(pid)) byParent.set(pid, []);
      byParent.get(pid).push(t);
    });
    const assignWbs = (parentId, prefix, depth) => {
      (byParent.get(parentId) || []).forEach((t, i) => {
        const code = prefix + (i + 1);
        wbsCodes.set(t.id, code);
        wbsDepths.set(t.id, depth);
        assignWbs(t.id, code + '.', depth + 1);
      });
    };
    assignWbs(null, '', 1);
    tasks.forEach((t, i) => { if (!wbsCodes.has(t.id)) { wbsCodes.set(t.id, String(i + 1)); wbsDepths.set(t.id, 1); } });

    const todayStr = today();
    const STATUS_PT = { a_fazer: 'A Fazer', em_andamento: 'Em Andamento', bloqueada: 'Bloqueada', concluido: 'Concluído' };
    const PRIORITY_PT = { baixa: 'Baixa', media: 'Média', alta: 'Alta', critica: 'Crítica' };

    const header = ['EAP','Nível','Código','Tarefa','Status','Prioridade','Início','Fim','Prev. Término','Duração (dias)','Progresso (%)','Atraso (dias)','Responsável','Disciplina','Setor'];
    const csvRows = [header.map(h => `"${h}"`).join(';')];

    tasks.forEach(t => {
      const eap   = wbsCodes.get(t.id) || '';
      const depth = wbsDepths.get(t.id) || 1;
      const dur   = t.start_date && t.end_date ? daysBetween(t.start_date, t.end_date) + 1 : '';
      const delay = t.status !== 'concluido' && t.end_date < todayStr ? daysBetween(t.end_date, todayStr) : 0;
      const member = State.members.find(m => m.id === t.assignee_id);
      const disc   = State.disciplines.find(d => d.id === t.discipline_id);
      const row = [
        eap,
        depth,
        t.code || '',
        t.title || '',
        STATUS_PT[t.status] || t.status || '',
        PRIORITY_PT[t.priority] || t.priority || '',
        t.start_date || '',
        t.end_date || '',
        forecastEndDate(t) || '',
        dur,
        (parseFloat(t.progress) || 0).toFixed(1),
        delay,
        member ? member.name : '',
        disc ? disc.code : '',
        t.sector || '',
      ];
      csvRows.push(row.map(v => `"${String(v).replace(/"/g, '""')}"`).join(';'));
    });

    const bom = '﻿'; // BOM para Excel reconhecer UTF-8
    const blob = new Blob([bom + csvRows.join('\r\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `eap_${(p.name || 'projeto').replace(/\s+/g,'-').toLowerCase()}_${todayStr}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    toast('CSV exportado com sucesso', 'success');
  },

  async exportGanttPNG() {
    const p = Views.current();
    if (!p) { toast('Selecione um projeto', 'warning'); return; }
    if (!State.tasks.length) { toast('Nenhuma tarefa para exportar', 'warning'); return; }

    toast('Gerando imagem...', '');
    try {
      // Carrega html2canvas dinamicamente se ainda não estiver disponível
      if (!window.html2canvas) {
        await new Promise((resolve, reject) => {
          const s = document.createElement('script');
          s.src = 'https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js';
          // SRI: garante que o script do CDN não foi adulterado
          s.integrity = 'sha384-ZZ1pncU3bQe8y31yfZdMFdSpttDoPmOZg2wguVK9almUodir1PghgT0eY7Mrty8H';
          s.crossOrigin = 'anonymous';
          s.onload = resolve;
          s.onerror = () => reject(new Error('Não foi possível carregar html2canvas. Verifique sua conexão.'));
          document.head.appendChild(s);
        });
      }

      const container = document.querySelector('.gantt-container');
      if (!container) { toast('Cronograma não encontrado', 'error'); return; }

      const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
      const canvas = await window.html2canvas(container, {
        backgroundColor: isDark ? '#1A1714' : '#FBF8F2',
        scale: 2,
        useCORS: true,
        logging: false,
        scrollX: 0,
        scrollY: -window.scrollY,
        windowWidth: document.documentElement.scrollWidth,
      });

      const url = canvas.toDataURL('image/png');
      const a = document.createElement('a');
      a.href = url;
      a.download = `cronograma_${(p.name || 'projeto').replace(/\s+/g, '-').toLowerCase()}_${today()}.png`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      toast('PNG exportado com sucesso', 'success');
    } catch (err) {
      toast('Erro ao exportar: ' + err.message, 'error');
    }
  },

  printGantt() {
    const p = Views.current();
    if (!p) { toast('Selecione um projeto', 'warning'); return; }
    const allTasks = State.tasks.filter(t => !t.inactive && t.start_date && t.end_date);
    if (!allTasks.length) { toast('Nenhuma tarefa com datas para imprimir', 'warning'); return; }

    // ── Recomputa WBS ────────────────────────────────────────────────────────
    const wbsCodes = new Map(), wbsDepths = new Map(), byParent = new Map();
    allTasks.forEach(t => {
      const pid = t.parent_id || null;
      if (!byParent.has(pid)) byParent.set(pid, []);
      byParent.get(pid).push(t);
    });
    const assignWbs = (pid, prefix, depth) => {
      (byParent.get(pid) || []).forEach((t, i) => {
        const code = prefix + (i + 1);
        wbsCodes.set(t.id, code);
        wbsDepths.set(t.id, depth);
        assignWbs(t.id, code + '.', depth + 1);
      });
    };
    assignWbs(null, '', 1);
    allTasks.forEach((t, i) => { if (!wbsCodes.has(t.id)) { wbsCodes.set(t.id, String(i + 1)); wbsDepths.set(t.id, 1); } });

    // Ordena pela EAP para impressão
    const tasks = [...allTasks].sort((a, b) => {
      const ca = wbsCodes.get(a.id) || '', cb = wbsCodes.get(b.id) || '';
      const pa = ca.split('.').map(Number), pb = cb.split('.').map(Number);
      for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
        if ((pa[i]||0) !== (pb[i]||0)) return (pa[i]||0) - (pb[i]||0);
      }
      return 0;
    });

    const members  = State.members;
    const todayStr = today();

    // ── Tabela-Gantt (pagina e repete o cabeçalho; legível em paisagem) ──────────
    const allDates  = tasks.flatMap(t => [t.start_date, t.end_date]).sort();
    const minDate   = allDates[0], maxDate = allDates[allDates.length - 1];
    const totalDays = Math.max(daysBetween(minDate, maxDate) + 1, 1);
    const pctOf = (d) => Math.max(0, Math.min(100, daysBetween(minDate, d) / totalDays * 100));

    // Meses no intervalo
    const months = [];
    { let cur = new Date(minDate + 'T00:00:00'); cur.setDate(1);
      const endD = new Date(maxDate + 'T00:00:00');
      while (cur <= endD) { months.push(new Date(cur)); cur.setMonth(cur.getMonth() + 1); } }
    const todayPct = (todayStr >= minDate && todayStr <= maxDate) ? pctOf(todayStr) : null;

    // Grade de meses + linha do "hoje" como SVG de fundo (reusada em todas as faixas)
    const gridInner = months.map(m => {
      const x = pctOf(m.toISOString().slice(0,10)), yr = m.getMonth() === 0;
      return `<line x1="${x.toFixed(2)}" y1="0" x2="${x.toFixed(2)}" y2="10" stroke="${yr ? '#c2ccd9' : '#eceff3'}" stroke-width="${yr ? 0.5 : 0.3}"/>`;
    }).join('');
    const gridToday = todayPct != null ? `<line x1="${todayPct.toFixed(2)}" y1="0" x2="${todayPct.toFixed(2)}" y2="10" stroke="#e54b1a" stroke-width="0.7" stroke-dasharray="1.2,1"/>` : '';
    const gridUri = `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 10" preserveAspectRatio="none">${gridInner}${gridToday}</svg>`)}`;

    // Rótulos de mês no cabeçalho (intervalo adaptativo p/ não sobrepor)
    const mStep = months.length > 30 ? 3 : months.length > 16 ? 2 : 1;
    const monthLabels = months.map((m, i) => {
      if (i % mStep !== 0) return '';
      const x = pctOf(m.toISOString().slice(0,10));
      // Evita colisão do rótulo do mês com o marcador "HOJE"
      if (todayPct != null && Math.abs(x - todayPct) < 3.2) return '';
      const mn = m.toLocaleDateString('pt-BR', { month: 'short' }).replace('.', '');
      const lbl = m.getMonth() === 0 ? `${mn}/${String(m.getFullYear()).slice(2)}` : mn;
      return `<span style="position:absolute;left:${x.toFixed(2)}%;font-family:monospace;font-size:7px;color:#64748b;white-space:nowrap;">${lbl}</span>`;
    }).join('');
    const todayLbl = todayPct != null ? `<span style="position:absolute;left:${todayPct.toFixed(2)}%;transform:translateX(-50%);font-family:monospace;font-size:7px;font-weight:700;color:#e54b1a;">HOJE</span>` : '';

    // Linhas
    const _hasKids = (tid) => tasks.some(t => t.parent_id === tid);
    const gxRows = tasks.map((t, i) => {
      const eap = wbsCodes.get(t.id) || '', depth = wbsDepths.get(t.id) || 1;
      const mem = members.find(x => x.id === t.assignee_id);
      const isParent = _hasKids(t.id), isDone = t.status === 'concluido';
      const isOvd = !isDone && t.end_date < todayStr, isMs = !!t.is_milestone;
      const fill = isDone ? '#059669' : isOvd ? '#c13b12' : isParent ? '#1f3a8a' : '#2563eb';
      const left = pctOf(t.start_date), w = Math.max(pctOf(t.end_date) - left, 0.5);
      const prog = Math.min(100, parseFloat(t.progress) || 0), indent = (depth - 1) * 10;
      const rowBg = isParent ? 'background:#eef2f7;' : (i % 2 ? 'background:#fafbfc;' : '');
      // Formato dd/mm (sem ano) para as etiquetas junto à barra
      const fmtDM = d => { if (!d) return ''; const [y,m,day] = d.split('-'); return `${day}/${m}`; };
      const barEl = isMs
        ? `<div class="gx-ms" style="left:${left.toFixed(2)}%;background:${fill};"></div>
           <span class="gx-date-start" style="left:${left.toFixed(2)}%;top:1px;">${fmtDM(t.start_date)}</span>`
        : `<div class="gx-bar" style="left:${left.toFixed(2)}%;width:${w.toFixed(2)}%;background:${fill};">
            ${prog > 0 ? `<div class="gx-prog" style="width:${prog}%;"></div>` : ''}
           </div>
           <span class="gx-date-start" style="left:${left.toFixed(2)}%;">${fmtDM(t.start_date)}</span>
           <span class="gx-date-end"   style="left:${(left + w).toFixed(2)}%;">${fmtDM(t.end_date)}</span>`;
      return `<tr style="${rowBg}">
        <td class="gx-eap">${eap}</td>
        <td class="gx-name" style="padding-left:${4 + indent}px;${isParent ? 'font-weight:700;' : ''}${isOvd ? 'color:#c13b12;' : ''}">${escapeHtml(t.title)}</td>
        <td class="gx-mono">${fmtDateShort(t.start_date)}</td>
        <td class="gx-mono"${isOvd ? ' style="color:#c13b12;font-weight:700;"' : ''}>${isMs ? '—' : fmtDateShort(t.end_date)}</td>
        <td class="gx-mono" style="text-align:right;">${prog.toFixed(0)}%</td>
        <td class="gx-tl"><div class="gx-track">${barEl}</div></td>
      </tr>`;
    }).join('');

    const ganttTableHtml = `<style>
      .gx{width:100%;border-collapse:collapse;table-layout:fixed;}
      .gx th{background:#f1f5f9;color:#475569;font-size:8px;text-transform:uppercase;letter-spacing:.03em;padding:5px 6px;text-align:left;border-bottom:1.5px solid #cbd5e1;vertical-align:bottom;}
      .gx td{padding:3px 6px;border-bottom:1px solid #eef1f4;vertical-align:middle;font-size:8.5px;}
      .gx-eap{font-family:monospace;font-size:8px;color:#2563eb;white-space:nowrap;vertical-align:top;padding-top:4px!important;}
      .gx-name{word-break:break-word;white-space:normal;line-height:1.3;}
      .gx-mono{font-family:monospace;font-size:8px;white-space:nowrap;vertical-align:top;padding-top:4px!important;}
      .gx-tl{padding:0 4px 0 24px!important;vertical-align:top;}
      .gx-tl-head{padding:0 4px 3px 24px!important;}
      .gx-track{position:relative;height:22px;background-image:url("${gridUri}");background-size:100% 100%;background-repeat:no-repeat;}
      .gx-bar{position:absolute;top:6px;height:10px;border-radius:2px;min-width:1.5px;overflow:hidden;box-shadow:0 .5px 1px rgba(0,0,0,.18);}
      .gx-prog{position:absolute;top:0;left:0;bottom:0;background:rgba(255,255,255,.45);}
      /* Data de início: imediatamente à ESQUERDA do início da barra */
      .gx-date-start{position:absolute;top:8px;font-family:monospace;font-size:6.5px;color:#334155;white-space:nowrap;line-height:1;transform:translateX(-100%);padding-right:3px;}
      /* Data de término: imediatamente à DIREITA do fim da barra */
      .gx-date-end{position:absolute;top:8px;font-family:monospace;font-size:6.5px;color:#334155;white-space:nowrap;line-height:1;padding-left:3px;}
      .gx-ms{position:absolute;top:5px;width:10px;height:10px;transform:translateX(-50%) rotate(45deg);border-radius:1px;box-shadow:0 .5px 1px rgba(0,0,0,.2);}
      .gx-scale{position:relative;height:11px;}
      .gx-legend{display:flex;gap:14px;font-size:8px;color:#475569;margin:6px 0 6px;font-family:monospace;}
      .gx-legend span{display:inline-flex;align-items:center;gap:4px;}
      .gx-legend i{width:10px;height:8px;border-radius:2px;display:inline-block;}
      @media print{ .gx-bar,.gx-prog,.gx-ms,.gx-track,.gx th,.gx-legend i{-webkit-print-color-adjust:exact!important;print-color-adjust:exact!important;} .gx tr{page-break-inside:avoid;} .gx thead{display:table-header-group;} }
    </style>
      <div class="gx-legend">
        <span><i style="background:#1f3a8a;"></i>Fase/pai</span>
        <span><i style="background:#2563eb;"></i>Tarefa</span>
        <span><i style="background:#059669;"></i>Concluída</span>
        <span><i style="background:#c13b12;"></i>Atrasada</span>
        <span><i style="background:#e54b1a;width:2px;border-radius:0;"></i>Hoje</span>
      </div>
      <table class="gx">
        <colgroup>
          <col style="width:5%"><col style="width:32%"><col style="width:8%"><col style="width:8%"><col style="width:5%"><col style="width:42%">
        </colgroup>
        <thead><tr>
          <th>EAP</th><th>Tarefa</th><th>Início</th><th>Fim</th><th style="text-align:right;">%</th>
          <th class="gx-tl-head"><div class="gx-scale">${monthLabels}${todayLbl}</div></th>
        </tr></thead>
        <tbody>${gxRows}</tbody>
      </table>`;

    // Resumo
    const avgProg = Math.round(physicalProgress(tasks));
    const doneCount = tasks.filter(t => t.status === 'concluido').length;
    const overdueCount = tasks.filter(t => t.end_date < todayStr && t.status !== 'concluido').length;

    const body = `
      <div style="display:flex;gap:24px;align-items:flex-start;margin-bottom:10px;">
        <div style="flex:1;">
          <h2 style="margin:0 0 4px 0;">${escapeHtml(p.name)}</h2>
          <div style="font-size:10px;color:#666;">Cronograma · Emitido em ${new Date().toLocaleDateString('pt-BR',{day:'2-digit',month:'long',year:'numeric'})}</div>
        </div>
        <div style="display:flex;gap:16px;font-family:monospace;font-size:11px;">
          <div style="text-align:center;"><strong>${tasks.length}</strong><br><span style="color:#888;font-size:9px;">tarefas</span></div>
          <div style="text-align:center;"><strong style="color:#059669;">${doneCount}</strong><br><span style="color:#888;font-size:9px;">concluídas</span></div>
          <div style="text-align:center;"><strong style="color:#c13b12;">${overdueCount}</strong><br><span style="color:#888;font-size:9px;">atrasadas</span></div>
          <div style="text-align:center;"><strong>${avgProg}%</strong><br><span style="color:#888;font-size:9px;">avanço</span></div>
        </div>
      </div>
      ${ganttTableHtml}`;
    this._printWindow('Cronograma', body, true);
  },

  printDeps() {
    const p = Views.current();
    if (!p) { toast('Selecione um projeto', 'warning'); return; }
    const deps = State.dependencies || [];
    if (!deps.length) { toast('Nenhuma dependência cadastrada', 'warning'); return; }
    const tasks = State.tasks;
    const statusBadge = {
      a_fazer:'<span class="badge badge-todo">A Fazer</span>',
      bloqueada:'<span class="badge badge-bloc">Bloqueada</span>',
      em_andamento:'<span class="badge badge-prog">Em Andamento</span>',
      concluido:'<span class="badge badge-done">Concluída</span>',
    };
    const typeLabel = { FS:'Término→Início (TI)', SS:'Início→Início (II)', FF:'Término→Término (TT)', SF:'Início→Término (IT)' };
    const rows = deps.map(dep => {
      const pred = tasks.find(t => t.id === dep.predecessor_id);
      const succ = tasks.find(t => t.id === dep.successor_id);
      if (!pred || !succ) return '';
      const blocked = pred.status !== 'concluido' && succ.status !== 'concluido';
      return `<tr${blocked?' style="background:#fff8f8;"':''}>
        <td><strong>${escapeHtml(pred.title)}</strong><br><span style="font-family:monospace;font-size:9px;color:#666;">${escapeHtml(pred.code||'')}</span></td>
        <td>${statusBadge[pred.status]||pred.status}</td>
        <td style="text-align:center;font-family:monospace;color:#2563eb;">${typeLabel[dep.type]||dep.type||'FS'}</td>
        <td><strong>${escapeHtml(succ.title)}</strong><br><span style="font-family:monospace;font-size:9px;color:#666;">${escapeHtml(succ.code||'')}</span></td>
        <td>${statusBadge[succ.status]||succ.status}</td>
        <td style="text-align:center;">${blocked?'<span class="badge badge-bloc">Bloqueado</span>':'<span class="badge badge-done">OK</span>'}</td>
      </tr>`;
    }).join('');

    const body = `
      <table>
        <thead><tr>
          <th>Predecessora</th><th>Status</th><th>Tipo</th>
          <th>Sucessora</th><th>Status</th><th>Situação</th>
        </tr></thead>
        <tbody>${rows||'<tr><td colspan="6" style="text-align:center;color:#8a96a8;">Nenhuma dependência</td></tr>'}</tbody>
      </table>
      <div style="font-size:9px;color:#8a96a8;font-family:monospace;">${deps.length} dependências registradas</div>`;
    this._printWindow('Lista de Dependências', body);
  },

  // ===== AUTO-AGENDAMENTO =====
  async runAutoSchedule() {
    if (State.tasks.length === 0) return;
    if (!DB.iCanEdit()) { toast('Sem permissão para recalcular neste projeto', 'error'); return; }
    UI.showRecalcOverlay();
    // Deixa o navegador pintar o overlay antes do cálculo síncrono.
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    const changes = autoSchedule(State.tasks, State.dependencies);
    if (changes.length === 0) {
      State._scheduleDirty = false;
      UI.hideRecalcOverlay();
      toast('Cronograma já está consistente — nada a recalcular', 'success');
      UI.render();
      return;
    }
    // UI OTIMISTA: aplica em memória e renderiza JÁ; a gravação no banco roda em
    // segundo plano. Em caso de erro, reverte e recarrega. Para cronogramas grandes
    // esse padrão tira o tempo de rede do caminho percebido pelo usuário.
    const _snapshot = changes.map(c => {
      const t = State.tasks.find(x => x.id === c.id);
      return { id: c.id, oldStart: t?.start_date, oldEnd: t?.end_date };
    });
    changes.forEach(c => {
      const t = State.tasks.find(x => x.id === c.id);
      if (t) { t.start_date = c.newStart; t.end_date = c.newEnd; }
    });
    State._scheduleDirty = false;
    CPMCache.invalidate();
    UI.render();
    UI.hideRecalcOverlay();
    toast(`Cronograma recalculado · ${changes.length} ${changes.length === 1 ? 'tarefa atualizada' : 'tarefas atualizadas'}`, 'success');
    // Persiste em segundo plano
    (async () => {
      try {
        await DB.updateTasksBatch(changes.map(c => ({ id: c.id, start_date: c.newStart, end_date: c.newEnd })));
      } catch (err) {
        // Reverte em memória e avisa o usuário
        _snapshot.forEach(s => { const t = State.tasks.find(x => x.id === s.id); if (t) { t.start_date = s.oldStart; t.end_date = s.oldEnd; } });
        State._scheduleDirty = true;
        CPMCache.invalidate();
        UI.render();
        toast('Falha ao salvar o recálculo: ' + friendlyError(err), 'error');
      }
    })();
  },

  // ===== RECÁLCULO AUTOMÁTICO (eficiente, com debounce) =====
  // Dispara após mudanças no cronograma; coalesce várias mudanças seguidas.
  // NÃO recalcula automaticamente. Marca que o cronograma precisa de recálculo
  // (o botão "Recalcular" fica destacado) e alerta o usuário uma vez por ciclo.
  scheduleAutoRecalc() {
    if (!DB.iCanEdit()) return;
    // MODO AUTOMÁTICO: recalcula sozinho (com debounce) a cada mudança de data/duração/predecessora.
    if (State.ganttAutoRecalc) {
      State._scheduleDirty = true;
      UI.showRecalcOverlay();
      clearTimeout(UI._autoRecalcTimer);
      UI._autoRecalcTimer = setTimeout(() => { UI.autoRecalc(); }, 650);
      return;
    }
    const wasDirty = State._scheduleDirty;
    State._scheduleDirty = true;
    if (!wasDirty) toast('Datas alteradas — clique em "Recalcular" para reprogramar o cronograma.', 'warning', 4000);
    // Atualiza só o botão se possível (evita re-render completo a cada tecla)
    const _btn = document.querySelector('[data-action="auto-schedule"]');
    if (_btn && !_btn.classList.contains('btn-cta')) {
      _btn.classList.remove('btn-secondary'); _btn.classList.add('btn-cta');
      _btn.style.animation = 'recalc-pulse 1.6s ease-in-out infinite';
    }
  },

  async autoRecalc() {
    if (!State.currentProjectId || State.tasks.length === 0 || !DB.iCanEdit()) { UI.hideRecalcOverlay(); return; }
    if (UI._recalcRunning) { UI._recalcAgain = true; return; } // evita reentrância
    UI._recalcRunning = true;
    UI.showRecalcOverlay();
    // Deixa o navegador pintar o overlay antes do cálculo (autoSchedule é síncrono).
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    try {
      if (dependencyCycle(State.tasks, State.dependencies)) throw new Error('Dependência circular. Corrija as predecessoras antes de recalcular.');
      const dbUpdates = [];
      // 1) Propaga datas conforme dependências/restrições (in-memory)
      const changes = autoSchedule(State.tasks, State.dependencies);
      changes.forEach(c => {
        const t = State.tasks.find(x => x.id === c.id);
        if (t) { t.start_date = c.newStart; t.end_date = c.newEnd; dbUpdates.push({ id: c.id, start_date: c.newStart, end_date: c.newEnd }); }
      });
      // 2) Roll-up dos pais (folhas → raiz), in-memory, coletando updates
      const tasks = State.tasks;
      const hasChildren = id => tasks.some(t => t.parent_id === id);
      const depthOf = (t) => { let d = 0, p = t; while (p && p.parent_id) { const par = tasks.find(x => x.id === p.parent_id); if (!par) break; d++; p = par; } return d; };
      const parents = tasks.filter(t => hasChildren(t.id)).sort((a, b) => depthOf(b) - depthOf(a)); // mais fundos primeiro
      parents.forEach(parent => {
        const ch = tasks.filter(t => t.parent_id === parent.id && !t.inactive);
        if (!ch.length) return;
        const wS = ch.filter(t => t.start_date);
        const wE = ch.filter(t => t.end_date);
        if (!wS.length && !wE.length) return;
        const ns = wS.length ? wS.reduce((m, t) => t.start_date < m ? t.start_date : m, wS[0].start_date) : parent.start_date;
        const ne = wE.length ? wE.reduce((m, t) => t.end_date > m ? t.end_date : m, wE[0].end_date) : parent.end_date;
        const np = rolledProgress(ch);
        if (parent.start_date !== ns || parent.end_date !== ne || Math.round(parseFloat(parent.progress) || 0) !== np) {
          parent.start_date = ns; parent.end_date = ne; parent.progress = np;
          dbUpdates.push({ id: parent.id, start_date: ns, end_date: ne, progress: np });
        }
      });
      // 3) Nada a fazer → limpa o "dirty" e re-renderiza só o botão (eficiente)
      if (dbUpdates.length === 0) { State._scheduleDirty = false; await UI.render(); return; }
      // 4) Persiste em lote (1 upsert por assinatura de campos) e re-renderiza uma vez
      await DB.updateTasksBatch(dbUpdates);
      State._scheduleDirty = false;
      await UI.render();
      toast(`↻ Cronograma recalculado · ${dbUpdates.length} ajuste${dbUpdates.length !== 1 ? 's' : ''}`, 'info');
    } catch (e) { console.warn('autoRecalc:', e.message); toast('Falha ao recalcular: ' + friendlyError(e), 'error'); }
    finally {
      UI._recalcRunning = false;
      if (UI._recalcAgain) { UI._recalcAgain = false; UI.scheduleAutoRecalc(); } // mudou durante o cálculo → roda de novo
      else UI.hideRecalcOverlay();
    }
  },

  // ===== OVERLAY "RECALCULANDO" — ampulheta em formato do "?" da marca =====
  showRecalcOverlay() {
    clearTimeout(UI._recalcOverlayHideT);
    if (document.getElementById('recalcOverlay')) return;
    const el = document.createElement('div');
    el.id = 'recalcOverlay';
    el.innerHTML = `<div class="recalc-hourglass">?</div><span class="recalc-overlay-txt">Recalculando o cronograma…</span>`;
    document.body.appendChild(el);
  },

  hideRecalcOverlay() {
    // Atraso curto p/ o overlay ser visível mesmo em recálculos instantâneos (evita flicker).
    clearTimeout(UI._recalcOverlayHideT);
    UI._recalcOverlayHideT = setTimeout(() => {
      const el = document.getElementById('recalcOverlay');
      if (el) { el.style.opacity = '0'; setTimeout(() => el.remove(), 220); }
    }, 280);
  },

  // ===== VIOLAÇÕES =====
  showViolations() {
    const cpm = CPMCache.get(State.tasks, State.dependencies);
    const violations = Array.from(cpm.violations.entries()).map(([id, v]) => {
      const t = State.tasks.find(x => x.id === id);
      return { task: t, ...v };
    });
    if (violations.length === 0) {
      toast('Sem violações de restrições', 'success');
      return;
    }
    Modal.open({
      title: `${violations.length} ${violations.length === 1 ? 'Violação' : 'Violações'} de Restrição`,
      body: `
        <div style="font-size:13px;color:var(--ink-soft);margin-bottom:14px;">
          Estas tarefas têm restrições de data que entram em conflito com as predecessoras ou outras restrições:
        </div>
        <div style="display:flex;flex-direction:column;gap:10px;">
          ${violations.map(v => `
            <div style="padding:12px;background:rgba(212,168,44,0.06);border:1px solid var(--accent-warm);border-left:3px solid var(--accent-warm);border-radius:2px;cursor:pointer;" data-action="edit-task-from-violation" data-id="${v.task.id}">
              <div style="display:flex;justify-content:space-between;gap:8px;align-items:flex-start;margin-bottom:6px;">
                <div style="font-weight:600;font-size:13px;">${v.task.code} · ${escapeHtml(v.task.title)}</div>
                <span style="font-family:var(--font-mono);font-size:10px;background:var(--accent-warm);color:var(--bg-deep);padding:2px 6px;border-radius:2px;font-weight:700;">${v.type}</span>
              </div>
              <div style="font-size:12px;color:var(--ink);">${escapeHtml(v.message)}</div>
              ${v.task.constraint_reason ? `<div style="font-size:11px;color:var(--ink-soft);margin-top:6px;font-style:italic;">Motivo: ${escapeHtml(v.task.constraint_reason)}</div>` : ''}
            </div>
          `).join('')}
        </div>
      `,
      footer: `<button class="btn btn-cta" id="btnCloseViol">Fechar</button>`
    });
    $('#btnCloseViol').onclick = () => Modal.close();
    $('#modal').querySelectorAll('[data-action="edit-task-from-violation"]').forEach(el => {
      el.onclick = () => { Modal.close(); UI.openTaskModal(el.dataset.id); };
    });
  },
});
