// Views: geração de HTML das telas
import { DateFilter, colorFromString, daysBetween, escapeHtml, fmtDateShort, initials, parentTag, relativeDate, today } from './helpers.js';
import { State } from './state.js';
import { DB } from './db.js';
import { KanbanConfig } from './kanban-config.js';
import { Automation } from './automation.js';
import { UI } from './ui.js';

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
