// Modal de tarefa: formulário, comentários, histórico, salvar/excluir/duplicar e etiquetas
import { Automation } from './automation.js';
import { CPMCache, dependencyCycle } from './cpm.js';
import { DB } from './db.js';
import { Dialog } from './dialog.js';
import { friendlyError, setLoading, toast } from './feedback.js';
import { $, $$, addDays, addWorkingDays, colorFromString, daysBetween, escapeHtml, fmtDateFull, fmtDateShort, initials, rolledProgress, snapTaskDates, today, workingDaysBetween } from './helpers.js';
import { KanbanConfig } from './kanban-config.js';
import { renderCommentBody } from './mentions.js';
import { Modal } from './modal.js';
import { CONSTRAINT_TYPES, DELAY_CAUSES, PPC_CAUSES, RESTRICTION_STATUS, State, validateTaskStatusChange } from './state.js';
import { UI } from './ui.js';
import { Views } from './views.js';

// Plugado em UI: continuam acessíveis como UI.<método> e this.<método>.
Object.assign(UI, {
  openTaskModal(taskId = null, defaultParentId = null, opts = {}) {
    if (!State.currentProjectId) { toast('Crie um projeto primeiro', 'error'); return; }
    const task = taskId ? State.tasks.find(t => t.id === taskId) : null;
    const isEdit = !!task;
    // Visualizador/comentarista: abre em modo leitura (vê tudo, não edita).
    // Criar nova tarefa não é permitido sem edição.
    const canEdit = DB.iCanEdit();
    if (!canEdit && !isEdit) { toast('Sem permissão para criar tarefas neste projeto', 'error'); return; }
    // Posição/datas pré-definidas ao criar a partir do Gantt (botão direito → acima/abaixo/subtarefa).
    // A tarefa só é GRAVADA ao clicar em Salvar — cancelar não cria nada.
    UI._pendingNewOrderIndex = (!isEdit && opts && opts.orderIndex != null) ? opts.orderIndex : null;
    const _seedStart = (!isEdit && opts && opts.startDate) ? opts.startDate : null;
    const _seedEnd   = (!isEdit && opts && opts.endDate)   ? opts.endDate   : null;
    // Predecessoras já existentes desta tarefa
    const existingDeps = isEdit ? State.dependencies.filter(d => d.task_id === task.id) : [];
    // Tarefas que podem ser predecessoras: QUALQUER tarefa (inclusive PAI/resumo),
    // exceto a própria, seus ANCESTRAIS e seus DESCENDENTES — evita ciclos com o roll-up.
    const _predExcluded = new Set();
    if (task) {
      _predExcluded.add(task.id);
      let _anc = task.parent_id, _g = 0;
      while (_anc && _g++ < 50) { _predExcluded.add(_anc); const _p = State.tasks.find(x => x.id === _anc); _anc = _p ? _p.parent_id : null; }
      const _stack = State.tasks.filter(x => x.parent_id === task.id);
      while (_stack.length) { const _t = _stack.pop(); _predExcluded.add(_t.id); State.tasks.filter(x => x.parent_id === _t.id).forEach(c => _stack.push(c)); }
    }
    const candidateTasks = State.tasks.filter(t => !_predExcluded.has(t.id));
    // Parent pré-definido (ao criar subtarefa a partir do modal do pai)
    const presetParentId = defaultParentId || task?.parent_id || null;
    // Tarefa pai? (tem filhos → datas calculadas automaticamente pelo roll-up)
    const isParentTask = task ? State.tasks.some(t => t.parent_id === task.id) : false;
    // Tarefa atrasada? (não concluída e com término já vencido) — habilita causa de não cumprimento
    const _isOverdue = !!(task && task.status !== 'concluido' && !isParentTask && task.end_date && task.end_date < today());
    // Duração inicial em dias corridos (para cálculo interno)
    const initDur = task?.start_date && task?.end_date
      ? daysBetween(task.start_date, task.end_date) + 1
      : 8;
    // Duração em dias úteis
    const initDurWd = task?.start_date && task?.end_date
      ? workingDaysBetween(task.start_date, task.end_date)
      : 5;

    // Pré-computa dados usados no template e no JS pós-modal
    const subtasks = isEdit ? State.tasks.filter(t => t.parent_id === task.id) : [];
    const checklistItems = (task?.checklist && Array.isArray(task.checklist)) ? task.checklist : [];
    const checkDoneCount = checklistItems.filter(i => i.done).length;
    // Restrições vinculadas a esta tarefa (só em edição) — listadas/criadas na aba "Restrições"
    const taskRestrictions = isEdit ? (State.restrictions || []).filter(r => r.task_id === task.id) : [];
    const taskRestrOpen = taskRestrictions.filter(r => r.status !== 'resolvida' && r.status !== 'cancelada').length;
    const defaultTab = existingDeps.length > 0 ? 'pred' : subtasks.length > 0 ? 'sub' : checklistItems.length > 0 ? 'check' : 'pred';

    Modal.open({
      title: isEdit ? 'Editar Tarefa · ' + task.code : 'Nova Tarefa',
      cls: isEdit ? 'modal-extrawide' : 'modal-wide',
      body: `
        <div class="${isEdit ? 'task-split' : ''}">
        <div class="${isEdit ? 'task-split-left' : ''}">
        <div id="paneEdit">
        <form id="taskForm">

          <!-- campos de restrição ocultos — sempre ASAP -->
          <input type="hidden" name="constraint_type" value="ASAP">
          <input type="hidden" name="constraint_date" value="">
          <input type="hidden" name="constraint_reason" value="">

          <!-- ① HEADER: status + código + marco -->
          <div class="tm-header">
            <div class="tm-chip-wrap">
              <span class="tm-status-dot" id="tmStatusDot"></span>
              <select name="status" class="tm-chip-native-sel tm-status-sel" id="tmStatusSel">
                ${KanbanConfig.get().map(col => `<option value="${col.id}" ${(task?.status || 'a_fazer') === col.id ? 'selected' : ''}>${escapeHtml(col.label)}</option>`).join('')}
              </select>
              <span class="tm-chip-arrow">▾</span>
            </div>
            ${isEdit ? `<span class="tm-code">${task.code}</span>` : ''}
            <label class="tm-milestone-label" title="Tarefa inativa: fica fora do caminho crítico e do cálculo de progresso">
              <input type="checkbox" id="isInactiveChk" name="inactive" ${task?.inactive ? 'checked' : ''}>
              ⏸ Inativa
            </label>
            <label class="tm-milestone-label" ${isParentTask ? 'style="opacity:.5;" title="Tarefa-pai não pode ser marco — suas datas são um intervalo (roll-up das subtarefas), incompatível com um marco (ponto único no tempo)"' : ''}>
              <input type="checkbox" id="isMilestoneChk" name="is_milestone" ${task?.is_milestone ? 'checked' : ''} ${isParentTask ? 'disabled' : ''}>
              ◆ Marco
            </label>
          </div>

          <!-- ② TÍTULO -->
          <div class="tm-title-wrap">
            <input class="tm-title-input" name="title" required maxlength="200" value="${escapeHtml(task?.title || '')}" placeholder="Ex.: Concretagem do pavimento térreo" autocomplete="off">
          </div>

          <!-- ③ CHIPS: responsável · disciplina · prioridade — responsável oculto em tarefas pai -->
          <div class="tm-chips-row">
            ${!isParentTask ? `<div class="tm-chip-wrap">
              <select name="assignee_id" class="tm-chip-native-sel">
                <option value="">Responsável</option>
                ${State.members.map(m => `<option value="${m.id}" ${task?.assignee_id === m.id ? 'selected' : ''}>${escapeHtml(m.name.split(' ')[0])}</option>`).join('')}
              </select>
              <span class="tm-chip-arrow">▾</span>
            </div>` : `<input type="hidden" name="assignee_id" value="">`}
            <div class="tm-chip-wrap">
              <select name="discipline_id" class="tm-chip-native-sel">
                <option value="">Disciplina</option>
                ${State.disciplines.map(d => `<option value="${d.id}" ${task?.discipline_id === d.id ? 'selected' : ''}>${escapeHtml(d.code + ' · ' + d.name)}</option>`).join('')}
              </select>
              <span class="tm-chip-arrow">▾</span>
            </div>
            <div class="tm-chip-wrap">
              <select name="priority" class="tm-chip-native-sel">
                <option value="baixa" ${task?.priority === 'baixa' ? 'selected' : ''}>↓ Baixa</option>
                <option value="media" ${(task?.priority === 'media' || !task) ? 'selected' : ''}>→ Média</option>
                <option value="alta" ${task?.priority === 'alta' ? 'selected' : ''}>↑ Alta</option>
                <option value="critica" ${task?.priority === 'critica' ? 'selected' : ''}>⚡ Crítica</option>
              </select>
              <span class="tm-chip-arrow">▾</span>
            </div>
          </div>

          <!-- ④ TAREFA PAI (só se houver candidatos) -->
          ${(() => {
            const depthMap = new Map();
            const computeDepth = (t) => {
              if (depthMap.has(t.id)) return depthMap.get(t.id);
              if (!t.parent_id) { depthMap.set(t.id, 1); return 1; }
              const parent = State.tasks.find(x => x.id === t.parent_id);
              const d = parent ? computeDepth(parent) + 1 : 1;
              depthMap.set(t.id, d);
              return d;
            };
            State.tasks.forEach(computeDepth);
            const getDescendants = (tid) => {
              const kids = State.tasks.filter(t => t.parent_id === tid);
              return kids.reduce((acc, k) => [...acc, k.id, ...getDescendants(k.id)], []);
            };
            const forbidden = task ? new Set([task.id, ...getDescendants(task.id)]) : new Set();
            // Candidatos a pai: até 8 níveis de profundidade; SEMPRE inclui o pai
            // pré-selecionado (evita que, sem a opção, o save jogue a subtarefa para o nível 1).
            const parentCandidates = State.tasks.filter(t => !forbidden.has(t.id) && ((depthMap.get(t.id) || 1) < 8 || t.id === presetParentId));
            if (parentCandidates.length === 0) return '';
            return `<div class="tm-parent-row">
              <div class="tm-parent-inner">
                <span class="tm-parent-label-txt">Tarefa pai</span>
                <div class="tm-parent-wrap">
                  <select class="tm-parent-select" name="parent_id" id="taskParentSel">
                    <option value="">— Sem tarefa pai (nível 1)</option>
                    ${parentCandidates.map(t => {
                      const depth = depthMap.get(t.id) || 1;
                      const indent = '  '.repeat((depth - 1) * 2);
                      return `<option value="${t.id}" ${presetParentId === t.id ? 'selected' : ''}>${indent}${escapeHtml(t.title)}</option>`;
                    }).join('')}
                  </select>
                  <span class="tm-parent-arrow">▾</span>
                </div>
              </div>
            </div>`;
          })()}

          <!-- ⑤ BANNER pai read-only -->
          ${isParentTask ? `<div style="display:flex;align-items:center;gap:8px;padding:6px 10px;background:rgba(31,58,138,0.07);border:1px solid rgba(31,58,138,0.2);border-radius:3px;margin-bottom:12px;font-size:11px;font-family:var(--font-mono);color:var(--blueprint);">📐 <strong>Tarefa pai</strong> — datas e progresso calculados pelo somatório das subtarefas</div>` : ''}

          <!-- ⑥ DATAS + DURAÇÃO -->
          <div class="tm-dates-row">
            <div class="tm-date-field">
              <div class="tm-date-label-txt">Início</div>
              <input class="tm-date-input" name="start_date" id="taskStartInput" type="date" required value="${task?.start_date || _seedStart || today()}" ${isParentTask ? 'readonly style="opacity:.5;pointer-events:none;"' : ''}>
            </div>
            <div class="tm-date-field">
              <div class="tm-date-label-txt" id="taskEndLabel">Término</div>
              <input class="tm-date-input" name="end_date" id="taskEndInput" type="date" required value="${task?.end_date || _seedEnd || addDays(today(), 7)}" ${isParentTask ? 'readonly style="opacity:.5;pointer-events:none;"' : ''}>
            </div>
            <div class="tm-date-field">
              <div class="tm-date-label-txt" style="white-space:nowrap;">Dias Úteis</div>
              <div style="display:flex;align-items:baseline;gap:4px;">
                <input class="tm-date-input" type="number" id="taskDurWdInput" min="1" step="1" value="${initDurWd}"
                  ${isParentTask ? 'readonly' : ''} style="width:52px;text-align:center;${isParentTask ? 'opacity:.5;pointer-events:none;' : ''}"
                  title="Digite a quantidade de dias úteis — o término é recalculado automaticamente">
                <span style="font-size:11px;color:var(--ink-mute);">d.ú.</span>
              </div>
              <input type="hidden" id="taskDurInput" value="${initDur}">
            </div>
          </div>

          <!-- ⑥b CUSTO (financeiro) — integrado na linha de progresso abaixo -->

          <!-- ⑥b2 SETOR (área responsável pela tarefa) — oculto em tarefas pai -->
          <div style="margin-bottom:12px;${isParentTask ? 'display:none;' : ''}">
            <label class="tm-date-label-txt" style="display:flex;align-items:center;justify-content:space-between;margin-bottom:5px;">
              <span>Setor responsável</span>
              <button type="button" id="btnManageSectors" style="font-family:var(--font-mono);font-size:10px;color:var(--accent);background:none;border:none;cursor:pointer;padding:0;">⚙ Gerenciar setores</button>
            </label>
            <div class="tm-chip-wrap" style="width:100%;">
              <select class="form-input" name="sector" id="taskSectorSel">
                <option value="">— Sem setor</option>
                ${(() => {
                  const regNames = (State.sectors || []).map(s => s.name);
                  const all = [...new Set(regNames.concat(State.tasks.map(t => t.sector).filter(Boolean)))].sort((a, b) => a.localeCompare(b));
                  const cur = task?.sector || '';
                  let opts = all.map(s => `<option value="${escapeHtml(s)}" ${cur === s ? 'selected' : ''}>${escapeHtml(s)}</option>`).join('');
                  // Caso o setor atual não esteja no registro (legado), garante a opção
                  if (cur && !all.includes(cur)) opts = `<option value="${escapeHtml(cur)}" selected>${escapeHtml(cur)}</option>` + opts;
                  return opts;
                })()}
              </select>
            </div>
            <div style="font-size:10px;color:var(--ink-mute);margin-top:3px;">Área/departamento responsável — usado para medir responsabilidade nos relatórios.</div>
          </div>

          <!-- ⑥c CAUSA DE NÃO CUMPRIMENTO (tarefa atrasada) -->
          ${(_isOverdue || task?.delay_cause) ? `
          <div style="margin-bottom:12px;padding:10px 12px;background:rgba(229,75,26,0.05);border:1px solid rgba(229,75,26,0.25);border-radius:3px;">
            <label class="tm-date-label-txt" style="display:flex;align-items:center;gap:6px;margin-bottom:6px;color:var(--accent-danger);">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:13px;height:13px;flex-shrink:0;"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
              Causa do não cumprimento (tarefa atrasada)
            </label>
            <select class="form-input" name="delay_cause" style="margin-bottom:8px;">
              <option value="">— Selecione a causa</option>
              ${Object.entries(DELAY_CAUSES).map(([code, lbl]) => `<option value="${code}" ${task?.delay_cause === code ? 'selected' : ''}>${escapeHtml(lbl)}</option>`).join('')}
              ${task?.delay_cause && !DELAY_CAUSES[task.delay_cause] ? `<option value="${escapeHtml(task.delay_cause)}" selected>${escapeHtml(PPC_CAUSES[task.delay_cause] || task.delay_cause)} (legado)</option>` : ''}
            </select>
            <input class="form-input" name="delay_note" placeholder="Observação (opcional)" value="${escapeHtml(task?.delay_note || '')}">
          </div>` : ''}

          <!-- ⑦ BASELINE (compact, só se tiver) -->
          ${task?.baseline_start ? `
          <div style="display:flex;align-items:center;gap:8px;padding:5px 10px;background:var(--bg-deep);border:1px solid var(--border);border-radius:2px;margin-bottom:12px;font-size:11px;font-family:var(--font-mono);">
            <span style="color:var(--ink-mute);font-size:9px;text-transform:uppercase;letter-spacing:.08em;">📌 Baseline</span>
            <span>${fmtDateShort(task.baseline_start)} → ${fmtDateShort(task.baseline_end)}</span>
            ${(() => { const d = daysBetween(task.baseline_end, task.end_date); return d === 0 ? '<span style="color:var(--accent-success);">· no plano</span>' : `<span style="color:${d>0?'var(--accent-danger)':'var(--accent-success)'};">· ${d>0?'+':''}${d}d</span>`; })()}
          </div>` : ''}

          <!-- ⑧ CUSTO + PROGRESSO na mesma linha -->
          <div id="progressGroup" style="margin-bottom:16px;">
            <div style="display:flex;gap:14px;align-items:flex-end;flex-wrap:wrap;">
              <!-- Custo previsto -->
              <div style="flex:0 0 160px;">
                <label class="tm-date-label-txt" style="display:block;margin-bottom:5px;">Custo previsto (R$)</label>
                <div style="position:relative;">
                  <span style="position:absolute;left:8px;top:50%;transform:translateY(-50%);font-family:var(--font-mono);font-size:11px;color:var(--ink-mute);pointer-events:none;">R$</span>
                  <input class="form-input" name="cost" type="number" min="0" step="0.01" inputmode="decimal"
                    placeholder="0,00" value="${(task?.cost != null && task?.cost !== '') ? task.cost : ''}"
                    style="font-family:var(--font-mono);padding-left:30px;font-size:12px;" ${isParentTask ? 'disabled style="opacity:.5;"' : ''}>
                </div>
              </div>
              <!-- Progresso -->
              <div class="tm-progress-wrap" style="flex:1;min-width:160px;" ${isParentTask ? 'title="Calculado pela média das subtarefas"' : ''}>
                <div class="tm-progress-header">
                  <span class="tm-progress-title">Progresso</span>
                  <div class="tm-progress-pct-wrap">
                    <input type="number" id="progressOut" min="0" max="100" step="0.01" value="${(task?.progress ?? 0).toFixed(2)}" ${isParentTask ? 'readonly' : ''}
                      style="width:88px;font-family:var(--font-mono);color:var(--accent);font-weight:700;font-size:13px;text-align:right;background:transparent;border:none;border-bottom:1px solid var(--accent);padding:2px 4px;outline:none;${isParentTask ? 'opacity:.6;pointer-events:none;' : ''}">
                    <span style="font-family:var(--font-mono);color:var(--accent);font-weight:700;font-size:12px;">%</span>
                  </div>
                </div>
                <div class="tm-progress-track" ${isParentTask ? 'style="opacity:.45;"' : ''}>
                  <div class="tm-progress-fill" id="tmProgressFill" style="width:${task?.progress ?? 0}%"></div>
                  <input type="range" id="progressSlider" name="progress" min="0" max="100" step="0.01" value="${task?.progress ?? 0}" ${isParentTask ? 'disabled' : ''} class="tm-progress-slider">
                </div>
              </div>
            </div>
          </div>

          <!-- ⑨ TABS: predecessoras · subtarefas · checklist · etiquetas -->
          <div class="tm-tabs-wrap">
            <div class="tm-tabs-bar">
              <div class="tm-tab ${defaultTab === 'pred' ? 'active' : ''}" data-tm-tab="pred">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:13px;height:13px;vertical-align:-2px;margin-right:4px;"><path d="M9 14L4 9l5-5"/><path d="M4 9h11a4 4 0 0 1 4 4v7"/></svg>Predecessoras${existingDeps.length > 0 ? `<span class="tm-tab-badge">${existingDeps.length}</span>` : ''}
              </div>
              ${isEdit ? `<div class="tm-tab ${defaultTab === 'sub' ? 'active' : ''}" data-tm-tab="sub">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:13px;height:13px;vertical-align:-2px;margin-right:4px;"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>Subtarefas${subtasks.length > 0 ? `<span class="tm-tab-badge">${subtasks.length}</span>` : ''}
              </div>` : ''}
              <div class="tm-tab ${defaultTab === 'check' ? 'active' : ''}" data-tm-tab="check">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:13px;height:13px;vertical-align:-2px;margin-right:4px;"><polyline points="9 11 12 14 22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>Checklist${checklistItems.length > 0 ? `<span class="tm-tab-badge">${checkDoneCount}/${checklistItems.length}</span>` : ''}
              </div>
              <div class="tm-tab ${defaultTab === 'labels' ? 'active' : ''}" data-tm-tab="labels">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:13px;height:13px;vertical-align:-2px;margin-right:4px;"><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/></svg>Etiquetas
              </div>
              ${isEdit ? `<div class="tm-tab ${defaultTab === 'restr' ? 'active' : ''}" data-tm-tab="restr">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:13px;height:13px;vertical-align:-2px;margin-right:4px;"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>Restrições${taskRestrOpen > 0 ? `<span class="tm-tab-badge" style="background:var(--accent-danger);">${taskRestrOpen}</span>` : (taskRestrictions.length > 0 ? `<span class="tm-tab-badge">${taskRestrictions.length}</span>` : '')}
              </div>` : ''}
            </div>

            <!-- Predecessoras -->
            <div class="tm-pane ${defaultTab === 'pred' ? 'active' : ''}" id="tmPanePred">
              <div style="display:flex;justify-content:flex-end;margin-bottom:8px;">
                <button type="button" class="btn btn-secondary" id="btnAddDep" style="padding:4px 10px;font-size:11px;">+ Adicionar predecessora</button>
              </div>
              <div id="depList" style="display:flex;flex-direction:column;gap:5px;margin-bottom:8px;"></div>
              <div style="font-family:var(--font-mono);font-size:9px;color:var(--ink-mute);line-height:1.5;">
                <strong>TI</strong> Término→Início · <strong>II</strong> Início→Início · <strong>TT</strong> Término→Término · <strong>IT</strong> Início→Término · defasagem em <strong>dias úteis</strong> (negativo = antecipação)
              </div>
            </div>

            <!-- Subtarefas (só edição) -->
            ${isEdit ? `<div class="tm-pane ${defaultTab === 'sub' ? 'active' : ''}" id="tmPaneSub">
              <div style="display:flex;justify-content:flex-end;margin-bottom:8px;">
                <button type="button" class="btn btn-secondary" id="btnAddSubtask" data-parent-id="${task.id}" style="padding:4px 10px;font-size:11px;">+ Nova subtarefa</button>
              </div>
              ${subtasks.length === 0
                ? `<div style="font-size:11px;color:var(--ink-mute);font-style:italic;padding:4px 0;">Nenhuma subtarefa ainda.</div>`
                : `<div style="display:flex;flex-direction:column;gap:3px;">
                    ${subtasks.map(st => {
                      const dot = st.status === 'concluido' ? 'var(--accent-success)' : st.status === 'em_andamento' ? 'var(--accent)' : st.status === 'bloqueada' ? 'var(--accent-danger)' : 'var(--ink-mute)';
                      return `<div style="display:flex;align-items:center;gap:8px;padding:5px 8px;background:var(--bg-deep);border-radius:2px;cursor:pointer;font-size:12px;" data-action="edit-task" data-id="${st.id}">
                        <div style="width:6px;height:6px;border-radius:50%;background:${dot};flex-shrink:0;"></div>
                        <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(st.title)}</span>
                        <span style="font-family:var(--font-mono);font-size:9px;color:var(--ink-mute);">${st.code}</span>
                        <span style="font-family:var(--font-mono);font-size:9px;color:${parseFloat(st.progress)===100?'var(--accent-success)':'var(--ink-mute)'};">${parseFloat(st.progress||0).toFixed(0)}%</span>
                      </div>`;
                    }).join('')}
                  </div>`}
            </div>` : ''}

            <!-- Checklist -->
            <div class="tm-pane ${defaultTab === 'check' ? 'active' : ''}" id="tmPaneCheck">
              <div id="checklistItems" style="display:flex;flex-direction:column;gap:3px;margin-bottom:8px;">
                ${checklistItems.map(it => `
                  <div class="checklist-item" data-checklist-id="${it.id}">
                    <input type="checkbox" ${it.done ? 'checked' : ''} data-checklist-done="${it.id}">
                    <span class="checklist-item-text${it.done ? ' done' : ''}" contenteditable="true" data-checklist-text="${it.id}">${escapeHtml(it.text)}</span>
                    <button type="button" class="checklist-item-del" data-checklist-del="${it.id}" title="Remover">✕</button>
                  </div>`).join('')}
              </div>
              <div style="display:flex;gap:6px;">
                <input id="checklistNewInput" class="form-input" type="text" placeholder="Novo item…" maxlength="200" style="flex:1;padding:5px 8px;font-size:12px;">
                <button type="button" id="btnAddChecklistItem" class="btn btn-secondary" style="padding:4px 10px;font-size:11px;flex-shrink:0;">+ Adicionar</button>
              </div>
            </div>

            <!-- Etiquetas -->
            <div class="tm-pane ${defaultTab === 'labels' ? 'active' : ''}" id="tmPaneLabels">
              <div style="position:relative;">
                <div id="assignedLabelsRow" style="display:flex;flex-wrap:wrap;gap:6px;align-items:center;min-height:28px;margin-bottom:6px;">
                  <button type="button" id="btnAddLabelInline"
                    style="display:inline-flex;align-items:center;gap:4px;padding:2px 8px;border-radius:10px;font-size:11px;font-weight:600;cursor:pointer;border:1px dashed var(--border-strong);background:transparent;color:var(--ink-mute);">
                    ＋ Etiqueta
                  </button>
                </div>
                <div id="labelDropdown" style="display:none;position:absolute;left:0;right:0;z-index:200;background:var(--bg-panel);border:1px solid var(--border-strong);border-radius:4px;box-shadow:0 4px 16px rgba(0,0,0,.12);padding:8px;">
                  <div id="labelDropdownList" style="display:flex;flex-direction:column;gap:4px;max-height:140px;overflow-y:auto;margin-bottom:8px;"></div>
                  <div style="border-top:1px solid var(--border);padding-top:8px;display:flex;gap:6px;align-items:center;">
                    <input id="newLabelNameInput" class="form-input" type="text" placeholder="Nova etiqueta..." maxlength="32" style="flex:1;padding:5px 8px;font-size:11px;"/>
                    <input id="newLabelColorInput" type="color" value="#5fd9e8" style="width:28px;height:28px;padding:0;border:1px solid var(--border);border-radius:3px;cursor:pointer;background:none;"/>
                    <button type="button" id="btnCreateLabelInline" class="btn btn-cta" style="padding:4px 10px;font-size:11px;">Criar</button>
                  </div>
                </div>
              </div>
            </div>

            <!-- Restrições vinculadas (só edição) -->
            ${isEdit ? `<div class="tm-pane ${defaultTab === 'restr' ? 'active' : ''}" id="tmPaneRestr">
              <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
                <span style="font-size:11px;color:var(--ink-mute);">Impedimentos que bloqueiam esta tarefa.</span>
                <button type="button" class="btn btn-secondary" id="btnAddRestr" style="padding:4px 10px;font-size:11px;flex-shrink:0;">+ Nova restrição vinculada</button>
              </div>
              <div style="display:flex;flex-direction:column;gap:5px;">
                ${taskRestrictions.length === 0
                  ? `<div style="font-size:11px;color:var(--ink-mute);font-style:italic;padding:4px 0;">Nenhuma restrição vinculada ainda.</div>`
                  : taskRestrictions.map(r => {
                      const st = (typeof RESTRICTION_STATUS !== 'undefined' && RESTRICTION_STATUS[r.status]) || {};
                      return `<div style="display:flex;align-items:center;gap:8px;padding:6px 8px;background:var(--bg-deep);border-radius:3px;cursor:pointer;font-size:12px;" data-restr-row="1" data-id="${r.id}" title="Abrir restrição">
                        <span style="width:8px;height:8px;border-radius:50%;background:${st.color || 'var(--ink-mute)'};flex-shrink:0;"></span>
                        <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(r.description || '(sem descrição)')}</span>
                        ${r.due_date ? `<span style="font-family:var(--font-mono);font-size:10px;color:var(--ink-mute);flex-shrink:0;">${fmtDateShort(r.due_date)}</span>` : ''}
                        <span style="font-size:10px;font-weight:600;color:${st.color || 'var(--ink-mute)'};flex-shrink:0;">${st.label || r.status}</span>
                      </div>`;
                    }).join('')}
              </div>
            </div>` : ''}

          </div><!-- /tm-tabs-wrap -->

        </form>
        </div><!-- /paneEdit -->
        </div><!-- /task-split-left -->

        ${isEdit ? `
        <div class="task-split-right">
          <div class="task-split-right-head">
            <span>Comentários</span>
            <span id="commentCount" style="color:var(--accent);font-size:11px;"></span>
          </div>
          <div id="commentsList" class="task-split-comments">
            <div style="color:var(--ink-mute);font-size:12px;font-style:italic;text-align:center;padding:20px;">Carregando...</div>
          </div>
          <div class="task-split-input">
            ${State.myRole !== 'viewer' ? `
              <textarea id="newCommentBody" class="form-input" rows="3" placeholder="Comentar… @nome para mencionar" style="width:100%;resize:none;font-size:12px;margin-bottom:6px;"></textarea>
              <button type="button" class="btn btn-cta" id="btnPostComment" style="width:100%;padding:7px;">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="margin-right:4px;vertical-align:-2px;"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
                Comentar
              </button>
            ` : `<div style="font-size:11px;color:var(--ink-mute);font-style:italic;text-align:center;">Somente leitura.</div>`}
          </div>
          <details class="task-split-history" open>
            <summary>Log de atividade</summary>
            <div class="history-inner" id="historyList">
              <div style="color:var(--ink-mute);font-size:12px;font-style:italic;text-align:center;padding:12px;">Carregando...</div>
            </div>
          </details>
        </div>
        ` : ''}
        </div><!-- /task-split -->
      `,
      footer: `
        ${isEdit && canEdit ? `<button class="btn btn-ghost" style="color:var(--accent-danger)" id="btnDelTask">Excluir</button>` : ''}
        ${isEdit && canEdit ? `<button class="btn btn-ghost" id="btnDuplicateTask" title="Duplicar esta tarefa com as mesmas configurações" style="margin-right:auto;">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:13px;height:13px;"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
          Duplicar
        </button>` : ''}
        <button class="btn btn-secondary" id="btnCancelTask">${canEdit ? 'Cancelar' : 'Fechar'}</button>
        ${canEdit ? `<button class="btn btn-cta" id="btnSaveTask">Salvar</button>` : ''}
      `
    });

    // Slider ↔ input numérico sincronizados
    const slider = $('#progressSlider'), out = $('#progressOut');
    slider.oninput = () => { out.value = parseFloat(slider.value).toFixed(2); };
    out.oninput = () => {
      let v = parseFloat(out.value);
      if (isNaN(v)) v = 0;
      v = Math.max(0, Math.min(100, v));
      slider.value = v;
    };
    out.onblur = () => {
      let v = parseFloat(out.value);
      if (isNaN(v)) v = 0;
      v = Math.max(0, Math.min(100, v));
      out.value = v.toFixed(2);
      slider.value = v;
    };

    // === MILESTONE: esconde término e progresso, força end = start ===
    const msChk = $('#isMilestoneChk');
    const startInput = $('#taskStartInput');
    const endInput = $('#taskEndInput');
    const endLabel = $('#taskEndLabel');
    const progressGroup = $('#progressGroup');
    const applyMilestoneUI = () => {
      if (msChk?.checked) {
        if (endInput)  endInput.style.display = 'none';
        if (endLabel)  endLabel.textContent = 'Data do Marco';
        if (progressGroup) progressGroup.style.display = 'none';
        if (endInput && startInput) endInput.value = startInput.value;
      } else {
        if (endInput)  endInput.style.display = '';
        if (endLabel)  endLabel.textContent = 'Término';
        if (progressGroup) progressGroup.style.display = '';
      }
    };
    msChk.onchange = applyMilestoneUI;
    const _durWdInput = document.getElementById('taskDurWdInput');
    // Datas → dias úteis (mantém o campo em sincronia quando início/término mudam)
    const _updateDurWd = () => {
      const s = startInput?.value, e = endInput?.value;
      if (_durWdInput && s && e && e >= s) _durWdInput.value = workingDaysBetween(s, e);
    };
    // Dias úteis → término (recalcula o término a partir do nº de dias úteis digitado)
    const _applyDurWd = () => {
      const s = startInput?.value;
      const n = parseInt(_durWdInput?.value);
      if (!s || isNaN(n) || n < 1) return;
      endInput.value = addWorkingDays(s, n);
      endInput.dispatchEvent(new Event('change')); // sincroniza duração-corrida e demais campos
    };
    endInput.min = startInput.value;
    startInput.onchange = () => {
      endInput.min = startInput.value;
      if (endInput.value && endInput.value < startInput.value) endInput.value = startInput.value;
      if (msChk.checked) endInput.value = startInput.value;
      _updateDurWd();
    };
    endInput.onchange = () => _updateDurWd();
    if (_durWdInput && !isParentTask) {
      _durWdInput.onchange = _applyDurWd;
      _durWdInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); _applyDurWd(); } });
    }
    applyMilestoneUI();

    // === Dot de status — sincroniza cor com o select ===
    const _tmStatusSel = document.getElementById('tmStatusSel');
    const _tmStatusDot = document.getElementById('tmStatusDot');

    // === Fill bar do progresso — sobrescreve handlers com versão + fill ===
    const _tmFill = document.getElementById('tmProgressFill');
    const _syncFill = () => { if (_tmFill) _tmFill.style.width = (parseFloat(slider.value) || 0) + '%'; };
    slider.oninput = () => { out.value = parseFloat(slider.value).toFixed(2); _syncFill(); };
    out.oninput = () => {
      let v = parseFloat(out.value); if (isNaN(v)) v = 0;
      v = Math.max(0, Math.min(100, v)); slider.value = v; _syncFill();
    };
    out.onblur = () => {
      let v = parseFloat(out.value); if (isNaN(v)) v = 0;
      v = Math.max(0, Math.min(100, v)); out.value = v.toFixed(2); slider.value = v; _syncFill();
    };
    _syncFill();

    // === Status "concluída" → bloqueia progresso em 100%; outros → desbloqueia ===
    const _applyProgressLock = (status) => {
      if (!slider || !out) return;
      if (status === 'concluido') {
        slider.value = 100; out.value = '100.00'; _syncFill();
        slider.disabled = true; out.readOnly = true;
        out.style.opacity = '0.5'; out.style.pointerEvents = 'none';
        slider.style.opacity = '0.4'; slider.style.pointerEvents = 'none';
      } else {
        // Ao sair de "concluída", reseta para 0
        if (parseFloat(slider.value) >= 100 && (task?.status ?? '') === 'concluido') {
          slider.value = 0; out.value = '0.00'; _syncFill();
        }
        slider.disabled = false; out.readOnly = false;
        out.style.opacity = ''; out.style.pointerEvents = '';
        slider.style.opacity = ''; slider.style.pointerEvents = '';
      }
    };

    if (_tmStatusSel) {
      if (_tmStatusDot) {
        const _syncStatusDot = () => {
          const col = KanbanConfig.get().find(c => c.id === _tmStatusSel.value);
          if (col) _tmStatusDot.style.background = col.color;
        };
        _tmStatusSel.addEventListener('change', _syncStatusDot);
        _syncStatusDot();
      }
      _tmStatusSel.addEventListener('change', () => _applyProgressLock(_tmStatusSel.value));
      _applyProgressLock(_tmStatusSel.value); // aplica estado inicial
    }

    // === Tabs ===
    document.querySelectorAll('.tm-tab').forEach(tab => {
      tab.onclick = () => {
        const key = tab.dataset.tmTab;
        const paneId = 'tmPane' + key.charAt(0).toUpperCase() + key.slice(1);
        document.querySelectorAll('.tm-tab').forEach(t => t.classList.remove('active'));
        document.querySelectorAll('.tm-pane').forEach(p => p.classList.remove('active'));
        tab.classList.add('active');
        const pane = document.getElementById(paneId);
        if (pane) pane.classList.add('active');
      };
    });

    // restrições removidas da UI — campos ocultos sempre ASAP

    // === ETIQUETAS — sistema inline (sem abrir outro modal) ===
    const initialLabelIds = task ? State.taskLabels.filter(tl => tl.task_id === task.id).map(tl => tl.label_id) : [];
    UI._selectedLabelIds = new Set(initialLabelIds);

    const _assignedRow   = $('#assignedLabelsRow');
    const _labelDropdown = $('#labelDropdown');
    const _addBtn        = $('#btnAddLabelInline');
    const _dropdownList  = $('#labelDropdownList');

    // Renderiza chips das etiquetas atribuídas à tarefa
    const renderAssignedChips = () => {
      // Remove chips antigos (mantém apenas o botão ＋)
      _assignedRow.querySelectorAll('.assigned-label-chip').forEach(c => c.remove());
      UI._selectedLabelIds.forEach(lid => {
        const lab = State.labels.find(l => l.id === lid);
        if (!lab) return;
        const chip = document.createElement('span');
        chip.className = 'assigned-label-chip';
        chip.style.cssText = `display:inline-flex;align-items:center;gap:5px;padding:3px 8px 3px 10px;border-radius:12px;font-size:11px;font-weight:600;background:${lab.color};color:#11161f;`;
        chip.innerHTML = `${escapeHtml(lab.name)}<span data-remove-lid="${lid}" style="cursor:pointer;font-size:13px;line-height:1;opacity:.7;margin-left:2px;">×</span>`;
        chip.querySelector('[data-remove-lid]').onclick = (e) => {
          e.stopPropagation();
          UI._selectedLabelIds.delete(lid);
          renderAssignedChips();
          renderDropdownList();
        };
        _assignedRow.insertBefore(chip, _addBtn);
      });
    };

    // Renderiza lista no dropdown com check nos selecionados
    const renderDropdownList = () => {
      if (State.labels.length === 0) {
        _dropdownList.innerHTML = '<div style="font-size:11px;color:var(--ink-mute);font-style:italic;padding:4px 0;">Crie sua primeira etiqueta abaixo.</div>';
        return;
      }
      _dropdownList.innerHTML = State.labels.map(lab => {
        const on = UI._selectedLabelIds.has(lab.id);
        return `<div data-pick-lid="${escapeHtml(lab.id)}" style="display:flex;align-items:center;gap:8px;padding:5px 8px;border-radius:3px;cursor:pointer;background:${on ? 'var(--bg-elevated)' : 'transparent'};transition:background .1s;">
          <span style="display:inline-block;width:12px;height:12px;border-radius:50%;background:${escapeHtml(lab.color)};flex-shrink:0;"></span>
          <span style="flex:1;font-size:12px;color:var(--ink);">${escapeHtml(lab.name)}</span>
          ${on ? '<span style="font-size:14px;color:var(--accent-success);">✓</span>' : '<span style="width:14px;"></span>'}
        </div>`;
      }).join('');
      _dropdownList.querySelectorAll('[data-pick-lid]').forEach(row => {
        row.onmouseenter = () => row.style.background = 'var(--bg-elevated)';
        row.onmouseleave = () => row.style.background = UI._selectedLabelIds.has(row.dataset.pickLid) ? 'var(--bg-elevated)' : 'transparent';
        row.onclick = () => {
          const lid = row.dataset.pickLid;
          if (UI._selectedLabelIds.has(lid)) UI._selectedLabelIds.delete(lid);
          else UI._selectedLabelIds.add(lid);
          renderAssignedChips();
          renderDropdownList();
        };
      });
    };

    // Toggle dropdown
    _addBtn.onclick = (e) => {
      e.stopPropagation();
      const visible = _labelDropdown.style.display !== 'none';
      _labelDropdown.style.display = visible ? 'none' : 'block';
      if (!visible) { renderDropdownList(); $('#newLabelNameInput')?.focus(); }
    };
    // Fecha dropdown ao clicar fora
    document.addEventListener('click', function _closeLabelDrop(e) {
      if (!_labelDropdown.contains(e.target) && e.target !== _addBtn) {
        _labelDropdown.style.display = 'none';
        document.removeEventListener('click', _closeLabelDrop);
      }
    });

    // Criar nova etiqueta inline
    const _btnCreateLabelInline = $('#btnCreateLabelInline');
    if (_btnCreateLabelInline) {
      _btnCreateLabelInline.onclick = async () => {
        const nameInput  = $('#newLabelNameInput');
        const colorInput = $('#newLabelColorInput');
        const name = nameInput.value.trim();
        if (!name) { nameInput.focus(); return; }
        const color = colorInput.value || '#5fd9e8';
        _btnCreateLabelInline.disabled = true;
        _btnCreateLabelInline.textContent = '...';
        try {
          const newLabel = await DB.createLabel(State.currentProjectId, name, color);
          State.labels.push(newLabel);
          UI._selectedLabelIds.add(newLabel.id); // auto-seleciona
          nameInput.value = '';
          colorInput.value = '#5fd9e8';
          renderAssignedChips();
          renderDropdownList();
        } catch(e) {
          toast('Erro ao criar etiqueta: ' + e.message, 'error');
        } finally {
          _btnCreateLabelInline.disabled = false;
          _btnCreateLabelInline.textContent = 'Criar';
        }
      };
    }
    // Enter no input de nome cria a etiqueta
    $('#newLabelNameInput')?.addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); _btnCreateLabelInline?.click(); }
    });

    // Render inicial dos chips atribuídos
    renderAssignedChips();

    // Predecessoras — render dinâmico
    const _depRows = []; // estado temporário das predecessoras enquanto o modal está aberto
    existingDeps.forEach(d => _depRows.push({ predecessor_id: d.predecessor_id, type: d.type, lag_days: d.lag_days, _existingId: d.id }));

    // Mapas de número de linha (estilo MS Project) vindos do último render do Gantt
    const _rowOfId = (Views._rowNumbers instanceof Map) ? Views._rowNumbers : new Map();
    const _idOfRow = (Views._rowNumberToId instanceof Map) ? Views._rowNumberToId : new Map();
    const renderDeps = () => {
      const root = $('#depList');
      if (_depRows.length === 0) {
        root.innerHTML = '<div style="color:var(--ink-mute);font-size:12px;font-family:var(--font-mono);padding:8px 0;">Sem predecessoras</div>';
        return;
      }
      root.innerHTML = _depRows.map((d, idx) => `
        <div style="display:grid;grid-template-columns:50px 1fr 78px 62px 30px;gap:6px;align-items:center;padding:6px;background:var(--bg-deep);border:1px solid var(--border);border-radius:2px;">
          <input data-idx="${idx}" data-field="rownum" type="number" min="1" value="${_rowOfId.get(d.predecessor_id) || ''}" class="form-input" style="padding:4px 4px;font-size:12px;text-align:center;font-family:var(--font-mono);" placeholder="nº" title="Nº da linha da predecessora (coluna # do Gantt)">
          <select data-idx="${idx}" data-field="predecessor_id" class="form-input" style="padding:4px 6px;font-size:12px;">
            <option value="">— Selecione</option>
            ${candidateTasks.map(t => `<option value="${t.id}" ${d.predecessor_id === t.id ? 'selected' : ''}>${escapeHtml(t.title)}</option>`).join('')}
          </select>
          <select data-idx="${idx}" data-field="type" class="form-input" style="padding:4px 6px;font-size:12px;">
            <option value="FS" ${d.type === 'FS' ? 'selected' : ''}>TI · Término→Início</option>
            <option value="SS" ${d.type === 'SS' ? 'selected' : ''}>II · Início→Início</option>
            <option value="FF" ${d.type === 'FF' ? 'selected' : ''}>TT · Término→Término</option>
            <option value="SF" ${d.type === 'SF' ? 'selected' : ''}>IT · Início→Término</option>
          </select>
          <input data-idx="${idx}" data-field="lag_days" type="number" step="1" value="${d.lag_days || 0}" class="form-input" style="padding:4px 6px;font-size:12px;text-align:center;" title="Defasagem em dias úteis (negativo = antecipação/overlap)">
          <button type="button" data-idx="${idx}" data-rm="1" class="icon-btn danger" style="margin:0;padding:4px;" title="Remover">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>
      `).join('');
      // listeners
      root.querySelectorAll('select, input[type="number"]').forEach(el => {
        el.onchange = (e) => {
          const i = +e.target.dataset.idx, f = e.target.dataset.field;
          if (f === 'lag_days') { _depRows[i][f] = parseInt(e.target.value) || 0; }
          else if (f === 'rownum') {
            const n = parseInt(e.target.value);
            if (!n) { _depRows[i].predecessor_id = ''; renderDeps(); return; }
            const pid = _idOfRow.get(n);
            if (!pid) { toast('Linha ' + n + ' não encontrada', 'error'); renderDeps(); return; }
            if (task && pid === task.id) { toast('A tarefa não pode ser predecessora dela mesma', 'error'); renderDeps(); return; }
            if (!candidateTasks.some(t => t.id === pid)) { toast('Essa linha não pode ser predecessora (a própria tarefa, um ancestral ou uma subtarefa dela)', 'error'); renderDeps(); return; }
            _depRows[i].predecessor_id = pid; renderDeps();
          }
          else _depRows[i][f] = e.target.value;
        };
      });
      root.querySelectorAll('button[data-rm]').forEach(b => {
        b.onclick = () => { _depRows.splice(+b.dataset.idx, 1); renderDeps(); };
      });
    };
    $('#btnAddDep').onclick = () => {
      if (candidateTasks.length === 0) { toast('Crie outras tarefas para usar como predecessoras', 'error'); return; }
      _depRows.push({ predecessor_id: '', type: 'FS', lag_days: 0 });
      renderDeps();
    };
    renderDeps();
    // Expõe para saveTask via closure
    UI._pendingDepRows = _depRows;

    // === DURAÇÃO — sincronização bidirecional com início/término ===
    if (!isParentTask) {
      const startEl = $('#taskStartInput');
      const endEl   = $('#taskEndInput');
      const durEl   = $('#taskDurInput');

      const updateDurFromDates = () => {
        if (startEl.value && endEl.value) {
          const d = daysBetween(startEl.value, endEl.value) + 1;
          if (d >= 1) durEl.value = d;
        }
      };
      const updateEndFromDur = () => {
        const dur = parseInt(durEl.value) || 1;
        if (startEl.value) {
          endEl.value = addDays(startEl.value, dur - 1);
        }
      };

      startEl?.addEventListener('change', () => {
        // Se término < início, ajusta término
        if (endEl.value && endEl.value < startEl.value) {
          endEl.value = addDays(startEl.value, parseInt(durEl.value) - 1 || 0);
        }
        updateDurFromDates();
      });
      endEl?.addEventListener('change', updateDurFromDates);
      durEl?.addEventListener('change', updateEndFromDur);
      durEl?.addEventListener('input', () => {
        const d = parseInt(durEl.value);
        if (d >= 1) updateEndFromDur();
      });
    }

    // ===== CHECKLIST handlers =====
    UI._checklistItems = (task?.checklist && Array.isArray(task.checklist))
      ? JSON.parse(JSON.stringify(task.checklist))
      : [];

    const _checklistRoot = () => $('#checklistItems');

    const renderChecklist = () => {
      const root = _checklistRoot();
      if (!root) return;
      root.innerHTML = UI._checklistItems.map(it => `
        <div class="checklist-item" data-checklist-id="${it.id}">
          <input type="checkbox" ${it.done ? 'checked' : ''} data-checklist-done="${it.id}">
          <span class="checklist-item-text${it.done ? ' done' : ''}" contenteditable="true" data-checklist-text="${it.id}">${escapeHtml(it.text)}</span>
          <button type="button" class="checklist-item-del" data-checklist-del="${it.id}" title="Remover">✕</button>
        </div>`).join('');
      bindChecklist();
    };

    const bindChecklist = () => {
      _checklistRoot()?.querySelectorAll('[data-checklist-done]').forEach(chk => {
        chk.onchange = () => {
          const it = UI._checklistItems.find(x => x.id === chk.dataset.checklistDone);
          if (it) { it.done = chk.checked; chk.nextElementSibling.classList.toggle('done', chk.checked); }
        };
      });
      _checklistRoot()?.querySelectorAll('[data-checklist-text]').forEach(span => {
        span.oninput = () => {
          const it = UI._checklistItems.find(x => x.id === span.dataset.checklistText);
          if (it) it.text = span.textContent.trim();
        };
        span.onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); $('#checklistNewInput')?.focus(); } };
      });
      _checklistRoot()?.querySelectorAll('[data-checklist-del]').forEach(btn => {
        btn.onclick = () => {
          UI._checklistItems = UI._checklistItems.filter(x => x.id !== btn.dataset.checklistDel);
          renderChecklist();
        };
      });
    };

    const addChecklistItem = () => {
      const inp = $('#checklistNewInput');
      if (!inp) return;
      const text = inp.value.trim();
      if (!text) { inp.focus(); return; }
      UI._checklistItems.push({ id: 'cl_' + Date.now() + '_' + Math.random().toString(36).slice(2,6), text, done: false });
      inp.value = '';
      renderChecklist();
    };

    $('#btnAddChecklistItem')?.addEventListener('click', addChecklistItem);
    $('#checklistNewInput')?.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); addChecklistItem(); } });
    bindChecklist();

    $('#btnCancelTask').onclick = () => { UI._pendingNewOrderIndex = null; Modal.close(); };
    if ($('#btnSaveTask')) $('#btnSaveTask').onclick = async function() {
      this.disabled = true; const orig = this.textContent; this.textContent = 'Salvando…';
      try { await UI.saveTask(task?.id); } finally { this.disabled = false; this.textContent = orig; }
    };
    // Gerenciar setores — guarda a seleção atual para repor ao reabrir o modal
    const _btnMngSec = $('#btnManageSectors');
    if (_btnMngSec) _btnMngSec.onclick = () => UI.openSectorsModal(() => UI.openTaskModal(task?.id, defaultParentId));
    if (isEdit && $('#btnDelTask')) $('#btnDelTask').onclick = () => UI.deleteTask(task.id);
    if (isEdit && $('#btnDuplicateTask')) $('#btnDuplicateTask').onclick = () => UI.duplicateTask(task.id);

    // ── Modo leitura (visualizador/comentarista): desabilita TODOS os campos do
    // painel de edição. O usuário vê todos os detalhes da tarefa, mas não altera
    // nada; os comentários (à direita) seguem ativos conforme o papel.
    if (!canEdit) {
      const pane = $('#paneEdit');
      if (pane) {
        pane.querySelectorAll('input, select, textarea, button').forEach(el => {
          el.disabled = true;
          el.style.cursor = 'default';
        });
        pane.querySelectorAll('[contenteditable]').forEach(el => el.setAttribute('contenteditable', 'false'));
        pane.style.opacity = '0.96';
      }
    }

    // Botão "Adicionar subtarefa" — abre novo modal com parent_id pré-definido
    const btnSub = $('#btnAddSubtask');
    if (btnSub) {
      btnSub.onclick = () => {
        const parentId = btnSub.dataset.parentId;
        Modal.close();
        UI.openTaskModal(null, parentId);
      };
    }

    // + Nova restrição vinculada → abre o modal de restrição já com esta tarefa,
    //   e ao salvar/cancelar retorna para a edição da tarefa.
    const btnAddRestr = $('#btnAddRestr');
    if (btnAddRestr && isEdit) {
      btnAddRestr.onclick = () => {
        Modal.close();
        UI.openRestrictionModal(null, { defaultTaskId: task.id, returnToTaskId: task.id });
      };
    }
    // Clique numa restrição vinculada → edita e retorna para esta tarefa
    if (isEdit) $$('[data-restr-row]').forEach(el => {
      el.onclick = () => {
        const rid = el.dataset.id;
        Modal.close();
        UI.openRestrictionModal(rid, { returnToTaskId: task.id });
      };
    });

    // Clique em linha de subtarefa → abre edição
    $$('[data-action="edit-task"]').forEach(el => {
      el.onclick = (e) => {
        e.stopPropagation();
        Modal.close();
        UI.openTaskModal(el.dataset.id);
      };
    });

    // === PAINEL LATERAL: comentários sempre visíveis em edição ===
    if (isEdit) {
      UI._currentTaskId = task.id;
      // Carrega comentários e histórico imediatamente (paralelo)
      UI.loadCommentsForTask(task.id);
      UI.loadTaskHistory(task.id);
    } else {
      UI._currentTaskId = null;
    }
  },

  // Carrega/renderiza comentários da tarefa aberta
  async loadCommentsForTask(taskId) {
    try {
      const list = await DB.listComments(taskId);
      State.comments = list;
      this.renderCommentsList(taskId);
    } catch (err) {
      console.warn('Falha ao listar comentários:', err.message);
      const root = $('#commentsList');
      if (root) {
        let msg = err.message;
        if (msg.includes('comments') && msg.includes('does not exist')) msg = 'Tabela comments ainda não existe — rode 08-migration-v3.6.sql';
        root.innerHTML = `<div style="color:var(--accent-danger);font-size:11px;font-family:var(--font-mono);">${escapeHtml(msg)}</div>`;
      }
    }
    // Wire do botão de postar
    const btn = $('#btnPostComment');
    if (btn) {
      btn.onclick = async () => {
        const ta = $('#newCommentBody');
        const body = ta.value.trim();
        if (!body) return;
        try {
          btn.disabled = true; btn.textContent = '...';
          const created = await DB.createComment(taskId, body);
          State.comments.push(created);
          ta.value = '';
          this.renderCommentsList(taskId);
          // Recarrega histórico para incluir o novo comentário (se a tabela suportar)
          this.loadTaskHistory(taskId);
        } catch (err) {
          toast('Erro ao postar: ' + err.message, 'error');
        } finally { btn.disabled = false; btn.textContent = 'Comentar'; }
      };
    }

    // === AUTOCOMPLETE DE MENÇÕES (@) ===
    const ta = $('#newCommentBody');
    if (ta) UI.attachMentionAutocomplete(ta);
  },

  // Liga o autocomplete de @ a um <textarea>
  attachMentionAutocomplete(textarea) {
    let dropdown = null;
    let users = [];
    let activeIdx = 0;
    let triggerStart = -1;  // posição do '@' no textarea
    let queryStr = '';

    // Carrega lista de usuários do projeto sob demanda
    const loadUsers = async () => {
      if (users.length > 0) return;
      try {
        users = await DB.listMentionableUsers(State.currentProjectId);
      } catch (e) {
        console.warn('Falha ao carregar usuários para menção:', e.message);
        users = [];
      }
    };

    const closeDropdown = () => {
      if (dropdown) { dropdown.remove(); dropdown = null; }
      triggerStart = -1; queryStr = ''; activeIdx = 0;
    };

    const renderDropdown = (filtered) => {
      if (!dropdown) {
        dropdown = document.createElement('div');
        dropdown.className = 'mention-dropdown';
        document.body.appendChild(dropdown);
      }
      if (filtered.length === 0) {
        dropdown.innerHTML = '<div style="padding:14px;color:var(--ink-mute);font-size:12px;font-style:italic;">Nenhum usuário encontrado</div>';
        return;
      }
      dropdown.innerHTML = filtered.map((u, i) => `
        <div class="mention-item ${i === activeIdx ? 'active' : ''}" data-uid="${u.id}" data-name="${escapeHtml(u.name)}">
          <div class="mention-item-avatar" style="background:${colorFromString(u.name)};">${initials(u.name)}</div>
          <div style="flex:1;min-width:0;">
            <div class="mention-item-name">${escapeHtml(u.name)}</div>
            ${u.email ? `<div class="mention-item-email">${escapeHtml(u.email)}</div>` : ''}
          </div>
        </div>
      `).join('');
      // Wire click
      dropdown.querySelectorAll('.mention-item').forEach((el, i) => {
        el.onmousedown = (e) => { e.preventDefault(); activeIdx = i; insertMention(filtered[i]); };
      });
      // Posiciona o dropdown perto do textarea
      const rect = textarea.getBoundingClientRect();
      dropdown.style.left = rect.left + 'px';
      dropdown.style.top = (rect.bottom + window.scrollY + 4) + 'px';
    };

    const filterUsers = () => {
      const q = queryStr.toLowerCase().trim();
      if (!q) return users.slice(0, 8);
      return users.filter(u =>
        u.name.toLowerCase().includes(q) ||
        u.email.toLowerCase().includes(q)
      ).slice(0, 8);
    };

    const insertMention = (user) => {
      const before = textarea.value.slice(0, triggerStart);
      const after = textarea.value.slice(textarea.selectionStart);
      const mentionText = `@[${user.name}](${user.id})`;
      textarea.value = before + mentionText + ' ' + after;
      const newPos = before.length + mentionText.length + 1;
      textarea.setSelectionRange(newPos, newPos);
      textarea.focus();
      closeDropdown();
    };

    textarea.addEventListener('input', async (e) => {
      const pos = textarea.selectionStart;
      const text = textarea.value;

      // Detecta se acabamos de digitar '@' precedido por espaço/início
      // Procura o '@' mais próximo à esquerda do cursor que não tenha letras antes
      let atIdx = -1;
      for (let i = pos - 1; i >= 0; i--) {
        const c = text[i];
        if (c === '@') {
          // Verifica que o caractere antes é espaço, quebra ou início
          if (i === 0 || /\s/.test(text[i - 1])) { atIdx = i; }
          break;
        }
        if (/\s/.test(c)) break;  // quebra ao achar espaço sem ter encontrado @
      }

      if (atIdx === -1) { closeDropdown(); return; }
      // Garante que entre @ e cursor não tem espaço/quebra
      const between = text.slice(atIdx + 1, pos);
      if (/\s/.test(between)) { closeDropdown(); return; }

      triggerStart = atIdx;
      queryStr = between;
      await loadUsers();
      activeIdx = 0;
      renderDropdown(filterUsers());
    });

    textarea.addEventListener('keydown', (e) => {
      if (!dropdown) return;
      const filtered = filterUsers();
      if (filtered.length === 0) return;
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        activeIdx = (activeIdx + 1) % filtered.length;
        renderDropdown(filtered);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        activeIdx = (activeIdx - 1 + filtered.length) % filtered.length;
        renderDropdown(filtered);
      } else if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        insertMention(filtered[activeIdx]);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        closeDropdown();
      }
    });

    textarea.addEventListener('blur', () => {
      // Pequeno delay para permitir click no item
      setTimeout(closeDropdown, 200);
    });
  },

  renderCommentsList(taskId) {
    const root = $('#commentsList');
    const counter = $('#commentCount');
    if (!root) return;
    const items = State.comments.filter(c => c.task_id === taskId);
    if (counter) counter.textContent = `${items.length} ${items.length === 1 ? 'comentário' : 'comentários'}`;
    const tabBadge = $('#tabCommentBadge');
    if (tabBadge) tabBadge.textContent = items.length > 0 ? String(items.length) : '—';
    if (items.length === 0) {
      root.innerHTML = '<div style="color:var(--ink-mute);font-size:12px;font-style:italic;text-align:center;padding:20px 0;">Sem comentários ainda. Seja o primeiro!</div>';
      return;
    }
    // Mapa de id→{nome, email} para exibir autor
    const memberByUser = new Map(State.members.map(m => [m.user_id || m.id, m]));
    root.innerHTML = items.map(c => {
      const member = memberByUser.get(c.user_id);
      const isOwner = c.user_id === State.user.id;
      const authorName = isOwner ? 'Você' : (member?.name || 'Usuário');
      const authorColor = colorFromString(authorName);
      const ago = (() => {
        const diff = Date.now() - new Date(c.created_at).getTime();
        const mins = Math.floor(diff / 60000);
        if (mins < 1) return 'agora';
        if (mins < 60) return `${mins} min atrás`;
        const hrs = Math.floor(mins / 60);
        if (hrs < 24) return `${hrs}h atrás`;
        return fmtDateFull(c.created_at);
      })();
      return `
        <div style="display:flex;gap:10px;align-items:flex-start;">
          <div style="width:28px;height:28px;border-radius:50%;background:${authorColor};color:#fff;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;flex-shrink:0;">${initials(authorName)}</div>
          <div style="flex:1;min-width:0;">
            <div style="display:flex;justify-content:space-between;align-items:baseline;gap:8px;">
              <div style="font-size:12px;font-weight:600;">${escapeHtml(authorName)}</div>
              <div style="font-family:var(--font-mono);font-size:10px;color:var(--ink-mute);">${ago}</div>
            </div>
            <div style="font-size:13px;color:var(--ink);margin-top:2px;white-space:pre-wrap;word-break:break-word;">${renderCommentBody(c.body)}</div>
            ${isOwner ? `<button type="button" class="icon-btn danger" data-action="delete-comment" data-id="${c.id}" data-task-id="${taskId}" style="margin-top:4px;padding:2px 4px;font-size:10px;color:var(--ink-mute);" title="Excluir">excluir</button>` : ''}
          </div>
        </div>
      `;
    }).join('');
    // Wire delete
    root.querySelectorAll('[data-action="delete-comment"]').forEach(b => {
      b.onclick = async () => {
        if (!await Dialog.confirm({ title: 'Excluir comentário', msg: 'Excluir este comentário? A ação não pode ser desfeita.', confirmText: 'Excluir', danger: true })) return;
        try {
          await DB.deleteComment(b.dataset.id);
          State.comments = State.comments.filter(c => c.id !== b.dataset.id);
          UI.renderCommentsList(b.dataset.taskId);
        } catch (err) { toast(friendlyError(err), 'error'); }
      };
    });
  },

  async loadTaskHistory(taskId) {
    const root = $('#historyList');
    if (!root) return;
    const memberByUser = new Map(State.members.map(m => [m.user_id || m.id, m]));
    const fieldLabels = {
      title:'Título', status:'Status', priority:'Prioridade', progress:'Progresso',
      start_date:'Início', end_date:'Término', assignee_id:'Responsável',
      discipline_id:'Disciplina', description:'Descrição', constraint_type:'Restrição',
    };
    const statusLabels = { a_fazer:'A Fazer', bloqueada:'Bloqueada', em_andamento:'Em Andamento', concluido:'Concluída' };
    const iconFor = (field) => {
      if (field === 'status')      return { bg:'rgba(95,217,232,0.15)',   icon:'●' };
      if (field === 'progress')    return { bg:'rgba(126,234,159,0.15)', icon:'↑' };
      if (field === 'assignee_id') return { bg:'rgba(180,140,255,0.15)', icon:'@' };
      return { bg:'rgba(91,100,122,0.12)', icon:'✎' };
    };
    const ago = (ts) => {
      const diff = Date.now() - new Date(ts).getTime();
      const m = Math.floor(diff / 60000);
      if (m < 1) return 'agora';
      if (m < 60) return `${m}min atrás`;
      const h = Math.floor(m / 60);
      if (h < 24) return `${h}h atrás`;
      const d = Math.floor(h / 24);
      return d < 7 ? `${d}d atrás` : fmtDateShort(ts);
    };
    const fmtVal = (v, f) => {
      if (!v && v !== 0) return '—';
      if (f === 'status') return statusLabels[v] || v;
      if (f === 'assignee_id')  { const m = State.members.find(x => x.id === v);    return m?.name || v; }
      if (f === 'discipline_id'){ const d = State.disciplines.find(x => x.id === v); return d ? `${d.code} · ${d.name}` : v; }
      if (f === 'progress') return parseFloat(v).toFixed(0) + '%';
      if (f.includes('date')) return fmtDateShort(v);
      return String(v).slice(0, 60) + (String(v).length > 60 ? '…' : '');
    };

    try {
      const log = await DB.listTaskHistory(taskId);
      // Merge audit entries with loaded comments for a unified activity feed
      const comments = State.comments.filter(c => c.task_id === taskId);
      const feed = [
        ...log.map(e => ({ ...e, _type: 'change' })),
        ...comments.map(c => ({ ...c, _type: 'comment' })),
      ].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));  // newest first

      if (!feed.length) {
        root.innerHTML = '<div style="color:var(--ink-mute);font-size:12px;font-style:italic;text-align:center;padding:20px;">Nenhuma atividade registrada ainda.</div>';
        return;
      }
      root.innerHTML = feed.map(entry => {
        if (entry._type === 'comment') {
          const mem = memberByUser.get(entry.user_id);
          const who = entry.user_id === State.user.id ? 'Você' : (mem?.name || 'Usuário');
          const snippet = (entry.body || '').replace(/@\[([^\]]+)\]\([^)]+\)/g, '@$1').slice(0, 80);
          return `<div class="hist-line">
            <div class="hist-icon" style="background:rgba(229,75,26,0.12);color:var(--accent);">💬</div>
            <div class="hist-body">
              <span class="hist-who">${escapeHtml(who)}</span>
              <span class="hist-what"> comentou</span>
              <div class="hist-val" style="color:var(--ink-soft);font-style:italic;margin-top:2px;">"${escapeHtml(snippet)}${snippet.length < (entry.body||'').length ? '…' : ''}"</div>
            </div>
            <div class="hist-when">${ago(entry.created_at)}</div>
          </div>`;
        }
        // audit change entry
        const mem = memberByUser.get(entry.user_id);
        const who = entry.user_id === State.user.id ? 'Você' : (mem?.name || 'Usuário');
        const ic = iconFor(entry.field);
        const fieldLabel = fieldLabels[entry.field] || entry.field;
        return `<div class="hist-line">
          <div class="hist-icon" style="background:${ic.bg};color:var(--ink-soft);">${ic.icon}</div>
          <div class="hist-body">
            <span class="hist-who">${escapeHtml(who)}</span>
            <span class="hist-what"> alterou <strong>${escapeHtml(fieldLabel)}</strong></span>
            ${entry.old_val != null ? `<div class="hist-val" style="color:var(--accent-danger);text-decoration:line-through;margin-top:2px;">${escapeHtml(fmtVal(entry.old_val, entry.field))}</div>` : ''}
            <div class="hist-val" style="color:var(--accent-success);">${escapeHtml(fmtVal(entry.new_val, entry.field))}</div>
          </div>
          <div class="hist-when">${ago(entry.created_at)}</div>
        </div>`;
      }).join('');
    } catch (err) {
      root.innerHTML = `<div style="color:var(--ink-mute);font-size:11px;text-align:center;padding:20px;">
        ${escapeHtml(err.message)}
      </div>`;
    }
  },

  async saveTask(id) {
    if (!DB.iCanEdit()) { toast('Sem permissão para editar este projeto', 'error'); return; }
    const form = $('#taskForm');
    const data = Object.fromEntries(new FormData(form).entries());
    // Progresso: 2 casas decimais; o saveTask faz fallback para int se a coluna ainda for integer
    const progressDecimal = Math.round(parseFloat(data.progress || 0) * 100) / 100;
    data.progress = progressDecimal;
    if (!data.assignee_id) data.assignee_id = null;
    if (!data.discipline_id) data.discipline_id = null;
    if (!data.parent_id) data.parent_id = null;
    // Custo (financeiro): número ≥ 0 ou null
    if (data.cost === '' || data.cost == null || isNaN(parseFloat(data.cost))) data.cost = null;
    else data.cost = Math.max(0, Math.round(parseFloat(data.cost) * 100) / 100);

    // Causa de não cumprimento (só presente quando a seção foi renderizada): normaliza vazio → null
    if ('delay_cause' in data && !data.delay_cause) data.delay_cause = null;
    if ('delay_note' in data && !data.delay_note) data.delay_note = null;
    // Setor responsável: normaliza vazio → null e remove espaços
    if ('sector' in data) data.sector = data.sector && data.sector.trim() ? data.sector.trim() : null;

    // Regra de bloqueio ↔ restrições
    {
      const existing = id ? State.tasks.find(t => t.id === id) : null;
      const curStatus = existing ? existing.status : 'a_fazer';
      const v = validateTaskStatusChange({ id, status: curStatus }, data.status);
      if (!v.ok) { toast(v.message, 'error'); return; }
    }

    // Marco: força end = start, progresso = 0/100 (binário)
    data.is_milestone = $('#isMilestoneChk')?.checked || false;
    if (data.is_milestone) {
      data.end_date = data.start_date;
      data.progress = data.status === 'concluido' ? 100 : 0;
    }
    // Tarefa inativa: fora do CPM e do progresso
    data.inactive = $('#isInactiveChk')?.checked || false;
    // Sincronia status <-> progresso (regra global): concluído => 100% e 100% => concluído
    {
      const _pg = parseFloat(data.progress) || 0;
      if (data.status === 'concluido' && _pg < 100) data.progress = 100;
      else if (_pg >= 100 && data.status !== 'concluido') data.status = 'concluido';
    }
    // Tarefa pai: preserva datas e progresso calculados (não permite editar manualmente)
    if (id) {
      const existingTask = State.tasks.find(t => t.id === id);
      const hasChildren = existingTask ? State.tasks.some(t => t.parent_id === id) : false;
      if (hasChildren) {
        data.start_date = existingTask.start_date;
        data.end_date   = existingTask.end_date;
        data.progress   = existingTask.progress;
      }
    }
    if (new Date(data.end_date) < new Date(data.start_date)) { toast('Data de término deve ser após o início', 'error'); return; }

    // Dias úteis: tarefa-folha nunca grava início/término em dia não útil (a tarefa-pai
    // já tem datas de roll-up, vindas das filhas, então fica de fora).
    const _isParentSave = id && State.tasks.some(t => t.parent_id === id);
    if (!_isParentSave && data.start_date && data.end_date) {
      const _sn = snapTaskDates(data.start_date, data.end_date);
      data.start_date = _sn.start;
      data.end_date   = _sn.end;
    }

    // Restrições
    if (!data.constraint_type) data.constraint_type = 'ASAP';
    if (!CONSTRAINT_TYPES[data.constraint_type].needsDate) data.constraint_date = null;
    if (!data.constraint_date) data.constraint_date = null;
    if (!data.constraint_reason || data.constraint_type === 'ASAP') data.constraint_reason = null;

    // Checklist: coleta itens do estado temporário e limpa textos do contenteditable
    if (UI._checklistItems) {
      $('#checklistItems')?.querySelectorAll('[data-checklist-text]').forEach(span => {
        const it = UI._checklistItems.find(x => x.id === span.dataset.checklistText);
        if (it) it.text = span.textContent.trim();
      });
      data.checklist = UI._checklistItems.filter(it => it.text);
    }

    // Filtra predecessoras: exclui vazias e auto-referência. Tarefas-pai PODEM ser
    // predecessoras; ciclos com ancestrais/descendentes já são barrados no seletor.
    const depRows = (UI._pendingDepRows || []).filter(d => d.predecessor_id && d.predecessor_id !== id);
    if (id) {
      const proposed = State.dependencies.filter(d => d.task_id !== id)
        .concat(depRows.map(d => ({ ...d, task_id: id })));
      if (dependencyCycle(State.tasks, proposed)) {
        toast('Dependência circular: remova o vínculo que fecha o ciclo antes de salvar.', 'error');
        return;
      }
    }

    // Posição explícita ao criar pelo Gantt (acima/abaixo/subtarefa): só agora, ao Salvar.
    if (!id && UI._pendingNewOrderIndex != null) data.order_index = UI._pendingNewOrderIndex;

    // Automação Tier 1: hook pré-create (atribuir por disciplina)
    const _taskBefore = id ? { ...State.tasks.find(t => t.id === id) } : null;

    // Helper: tenta salvar; se a coluna progress for integer e der erro, refaz arredondando
    const trySave = async (payload) => {
      if (!id) Automation.applyOnTaskCreate(payload);
      try {
        if (id) { await DB.updateTask(id, payload); return true; }
        else { return await DB.createTask(State.currentProjectId, payload); }
      } catch (err) {
        // Se for erro de tipo no progress, faz fallback para int (mostra aviso)
        if (err.message && err.message.includes('progress') && err.message.includes('integer')) {
          console.warn('Coluna progress ainda é integer — rode 04-migration-v3.2.sql para suportar decimais. Arredondando.');
          toast('⚠ Progresso salvo arredondado (rode 04-migration-v3.2.sql para 2 decimais)', 'warning');
          payload.progress = Math.round(payload.progress);
          if (id) { await DB.updateTask(id, payload); return true; }
          else { return await DB.createTask(State.currentProjectId, payload); }
        }
        // Se for erro por coluna discipline_id ausente, tenta sem
        if (err.message && err.message.includes('discipline_id')) {
          console.warn('Coluna discipline_id ainda não existe — rode 04-migration-v3.2.sql.');
          toast('⚠ Disciplina não salva (rode 04-migration-v3.2.sql)', 'warning');
          delete payload.discipline_id;
          if (id) { await DB.updateTask(id, payload); return true; }
          else { return await DB.createTask(State.currentProjectId, payload); }
        }
        // Se for erro por colunas v3.4 ausentes (marcos/restrições), retira e tenta de novo
        if (err.message && (
          err.message.includes('is_milestone') ||
          err.message.includes('constraint_type') ||
          err.message.includes('constraint_date') ||
          err.message.includes('constraint_reason')
        )) {
          console.warn('Colunas v3.4 (marcos/restrições) ausentes — rode 06-migration-v3.4.sql.');
          toast('⚠ Marcos/restrições não salvos (rode 06-migration-v3.4.sql)', 'warning');
          delete payload.is_milestone;
          delete payload.constraint_type;
          delete payload.constraint_date;
          delete payload.constraint_reason;
          if (id) { await DB.updateTask(id, payload); return true; }
          else { return await DB.createTask(State.currentProjectId, payload); }
        }
        // Se for erro por coluna parent_id ausente, tenta sem
        if (err.message && err.message.includes('parent_id')) {
          console.warn('Coluna parent_id ainda não existe — rode 19-subtasks.sql.');
          toast('⚠ Tarefa pai não salva (rode 19-subtasks.sql)', 'warning');
          delete payload.parent_id;
          if (id) { await DB.updateTask(id, payload); return true; }
          else { return await DB.createTask(State.currentProjectId, payload); }
        }
        // Se for erro por coluna checklist ausente, tenta sem (rode 15-migration-v4.2-checklist.sql)
        if (err.message && err.message.includes('checklist')) {
          console.warn('Coluna checklist não existe — rode 15-migration-v4.2-checklist.sql.');
          toast('⚠ Checklist não salvo (rode 15-migration-v4.2-checklist.sql)', 'warning');
          delete payload.checklist;
          if (id) { await DB.updateTask(id, payload); return true; }
          else { return await DB.createTask(State.currentProjectId, payload); }
        }
        // Coluna cost (financeiro) ausente — rode 28-task-cost.sql
        if (err.message && err.message.includes('cost')) {
          console.warn('Coluna cost não existe — rode 28-task-cost.sql.');
          toast('⚠ Custo não salvo (rode 28-task-cost.sql)', 'warning');
          delete payload.cost;
          if (id) { await DB.updateTask(id, payload); return true; }
          else { return await DB.createTask(State.currentProjectId, payload); }
        }
        // Colunas de causa de atraso ausentes — rode a migration de delay_cause/delay_note
        if (err.message && (err.message.includes('delay_cause') || err.message.includes('delay_note'))) {
          console.warn('Colunas delay_cause/delay_note não existem — rode a migration correspondente.');
          toast('⚠ Causa do atraso não salva (rode a migration de delay_cause)', 'warning');
          delete payload.delay_cause;
          delete payload.delay_note;
          if (id) { await DB.updateTask(id, payload); return true; }
          else { return await DB.createTask(State.currentProjectId, payload); }
        }
        // Coluna setor ausente — rode 31-task-sector.sql
        if (err.message && err.message.includes('sector')) {
          console.warn('Coluna sector não existe — rode 31-task-sector.sql.');
          toast('⚠ Setor não salvo (rode 31-task-sector.sql)', 'warning');
          delete payload.sector;
          if (id) { await DB.updateTask(id, payload); return true; }
          else { return await DB.createTask(State.currentProjectId, payload); }
        }
        // Coluna inactive ausente — rode 33-task-inactive.sql
        if (err.message && err.message.includes('inactive')) {
          console.warn('Coluna inactive não existe — rode 33-task-inactive.sql.');
          toast('⚠ Status inativo não salvo (rode 33-task-inactive.sql)', 'warning');
          delete payload.inactive;
          if (id) { await DB.updateTask(id, payload); return true; }
          else { return await DB.createTask(State.currentProjectId, payload); }
        }
        throw err;
      }
    };

    try {
      setLoading(true);
      let taskId = id;
      const oldTask = id ? { ...State.tasks.find(x => x.id === id) } : null;
      const result = await trySave({ ...data });
      if (id) {
        const t = State.tasks.find(x => x.id === id); Object.assign(t, data);
        // Registra no audit log os campos que mudaram
        if (oldTask) {
          const watchFields = ['title','status','priority','progress','start_date','end_date','assignee_id','discipline_id'];
          const changes = {};
          for (const f of watchFields) {
            const ov = oldTask[f] != null ? String(oldTask[f]) : null;
            const nv = data[f] != null ? String(data[f]) : null;
            if (ov !== nv) changes[f] = { from: ov, to: nv };
          }
          if (Object.keys(changes).length) DB.logTaskChange(id, changes);
        }
      } else {
        State.tasks.push(result);
        taskId = result.id;
        // Garante que parent_id consta no objeto local mesmo que o Supabase não o retorne
        if (data.parent_id) {
          const pushed = State.tasks.find(t => t.id === taskId);
          if (pushed && !pushed.parent_id) pushed.parent_id = data.parent_id;
        }
        // Reordena pela posição explícita (criação posicionada via Gantt)
        if (UI._pendingNewOrderIndex != null) {
          const _oi = (t) => (typeof t.order_index === 'number' ? t.order_index : Date.parse(t.created_at || 0) || 0);
          State.tasks.sort((a, b) => _oi(a) - _oi(b));
        }
      }

      // Sincroniza dependências — reconcilia pelo CONTEÚDO (predecessor|tipo|lag),
      // não pelo _existingId. Assim, TROCAR a predecessora/tipo/lag de uma linha
      // existente apaga a antiga e cria a nova corretamente.
      const _depKey = (d) => `${d.predecessor_id}|${d.type || 'FS'}|${d.lag_days || 0}`;
      const existing = State.dependencies.filter(d => d.task_id === taskId);
      const desiredKeys = new Set(depRows.map(_depKey));
      const existingKeys = new Set(existing.map(_depKey));
      // Remove as que não estão mais no estado desejado
      for (const ex of existing) {
        if (!desiredKeys.has(_depKey(ex))) {
          await DB.deleteDependency(ex.id);
          State.dependencies = State.dependencies.filter(x => x.id !== ex.id);
        }
      }
      // Adiciona as novas (que ainda não existem com a mesma chave)
      let depErrors = 0;
      let lastErr = null;
      for (const d of depRows) {
        if (existingKeys.has(_depKey(d))) continue; // já existe igual
        try {
          const created = await DB.createDependency({ task_id: taskId, predecessor_id: d.predecessor_id, type: d.type, lag_days: d.lag_days || 0 });
          State.dependencies.push(created);
          existingKeys.add(_depKey(d)); // evita duplicar se houver linhas repetidas
        } catch (e) {
          depErrors++;
          lastErr = e;
          console.error('Falha ao criar dependência:', e);
        }
      }

      // === SALVA LABELS ===
      try {
        if (UI._selectedLabelIds) {
          const labelIds = Array.from(UI._selectedLabelIds);
          await DB.setTaskLabels(taskId, labelIds);
          // Atualiza o State.taskLabels local
          State.taskLabels = State.taskLabels.filter(tl => tl.task_id !== taskId);
          labelIds.forEach(lid => State.taskLabels.push({ task_id: taskId, label_id: lid }));
        }
      } catch (e) {
        console.warn('Falha ao salvar labels:', e.message);
      }

      // === ROLL-UP: propaga datas e progresso para a tarefa pai ===
      await UI.rollUpParentTask(data.parent_id || (oldTask?.parent_id || null), true);

      Modal.close();
      await UI.render();

      // === #2/#3: propagação para subtarefas (só ao editar uma tarefa-pai) ===
      if (id && State.tasks.some(t => t.parent_id === id)) {
        const _descendants = (rootId) => {
          const out = [], stack = State.tasks.filter(t => t.parent_id === rootId);
          while (stack.length) { const t = stack.pop(); out.push(t); State.tasks.filter(x => x.parent_id === t.id).forEach(c => stack.push(c)); }
          return out;
        };
        // #3 — inativar a tarefa-pai inativa as subtarefas (automático)
        if (data.inactive && oldTask && !oldTask.inactive) {
          const descs = _descendants(id).filter(t => !t.inactive);
          if (descs.length) {
            try {
              await DB.updateTasksBatch(descs.map(t => ({ id: t.id, inactive: true })));
              descs.forEach(t => t.inactive = true);
              CPMCache.invalidate();
              await UI.render();
              toast(`${descs.length} subtarefa(s) também inativada(s)`, 'info');
            } catch (e) { toast('Falha ao inativar subtarefas: ' + friendlyError(e), 'error'); }
          }
        }
        // #2 — mudou a disciplina da tarefa-pai → oferece replicar às subtarefas
        if (data.discipline_id && data.discipline_id !== (oldTask ? oldTask.discipline_id : null)) {
          const descs = _descendants(id).filter(t => !t.inactive && t.discipline_id !== data.discipline_id);
          if (descs.length) {
            const ok = await Dialog.confirm({
              title: 'Replicar disciplina',
              msg: `Aplicar esta disciplina também às ${descs.length} subtarefa(s)?`,
              confirmText: 'Replicar',
            });
            if (ok) {
              try {
                await DB.updateTasksBatch(descs.map(t => ({ id: t.id, discipline_id: data.discipline_id })));
                descs.forEach(t => t.discipline_id = data.discipline_id);
                await UI.render();
                toast('Disciplina replicada às subtarefas', 'success');
              } catch (e) { toast('Falha ao replicar disciplina: ' + friendlyError(e), 'error'); }
            }
          }
        }
      }

      const _origExistKeys = new Set(existing.map(_depKey));
      const _depsChanged = desiredKeys.size !== _origExistKeys.size || [...desiredKeys].some(k => !_origExistKeys.has(k));
      const _datesChanged = !id || !oldTask ||
        String(data.start_date || '') !== String(oldTask.start_date || '') ||
        String(data.end_date || '') !== String(oldTask.end_date || '');
      if (_datesChanged || _depsChanged) UI.scheduleAutoRecalc();
      if (depErrors > 0) {
        let msg = lastErr?.message || 'erro desconhecido';
        if (msg.includes('does not exist') || msg.includes('relation')) {
          msg = 'A tabela task_dependencies não existe. Rode REPAIR-v3.2.sql no Supabase.';
        }
        toast(`⚠ Tarefa salva, mas ${depErrors} dependência(s) falharam: ${msg}`, 'error');
      } else {
        toast(id ? 'Tarefa atualizada' : 'Tarefa criada', 'success');
      }
      // Automação Tier 1: hook pós-update (auto-PPC)
      if (id) await Automation.applyOnTaskUpdate(id, data, _taskBefore);
    } catch (err) { toast(friendlyError(err), 'error'); }
    finally { setLoading(false); UI._pendingDepRows = null; UI._pendingNewOrderIndex = null; }
  },

  async deleteTask(id) {
    if (!DB.iCanDelete()) { toast('Sem permissão para excluir tarefas neste projeto', 'error'); return; }
    if (!await Dialog.confirm({ title: 'Excluir tarefa', msg: 'Excluir esta tarefa permanentemente? Subtarefas e dependências também serão removidas.', confirmText: 'Excluir', danger: true })) return;
    try {
      setLoading(true);
      const task = State.tasks.find(t => t.id === id);
      const parentId = task?.parent_id || null;
      await DB.deleteTask(id);
      State.tasks = State.tasks.filter(t => t.id !== id);
      if (parentId) await UI.rollUpParentTask(parentId, true);
      Modal.close();
      await UI.render();
      UI.scheduleAutoRecalc();
      toast('Tarefa excluída', 'success');
    } catch (err) { toast(friendlyError(err), 'error'); }
    finally { setLoading(false); }
  },

  // ===== DUPLICAR TAREFA =====
  async duplicateTask(id) {
    if (!DB.iCanEdit()) { toast('Sem permissão para criar tarefas neste projeto', 'error'); return; }
    const src = State.tasks.find(t => t.id === id);
    if (!src) return;
    try {
      setLoading(true);
      Modal.close();
      const copy = {
        title:         src.title + ' (cópia)',
        parent_id:     src.parent_id || null,
        start_date:    addDays(src.start_date, 7),
        end_date:      addDays(src.end_date,   7),
        status:        'a_fazer',
        priority:      src.priority,
        progress:      0,
        assignee_id:   src.assignee_id   || null,
        discipline_id: src.discipline_id || null,
        is_milestone:  src.is_milestone  || false,
        notes:         src.notes         || null,
        constraint_type: 'ASAP',
      };
      const created = await DB.createTask(State.currentProjectId, copy);
      State.tasks.push(created);
      if (created.parent_id) await UI.rollUpParentTask(created.parent_id);
      await UI.render();
      toast(`Tarefa duplicada — "${created.title}"`, 'success');
      UI.openTaskModal(created.id);
    } catch (err) { toast('Erro ao duplicar: ' + err.message, 'error'); }
    finally { setLoading(false); }
  },

  // ===== ROLL-UP DE TAREFAS PAI =====
  // Recalcula datas (min início / max fim) e progresso (média dos filhos) do pai — e sobe recursivamente
  async rollUpParentTask(parentId, silent = false) {
    if (!parentId) return;
    const parent = State.tasks.find(t => t.id === parentId);
    if (!parent) return;

    const children = State.tasks.filter(t => t.parent_id === parentId && !t.inactive);
    if (children.length === 0) return;
    // Início e término são independentes: uma filha com término mas sem início
    // ainda conta no MÁX do término (e vice-versa).
    const withStart = children.filter(t => t.start_date);
    const withEnd   = children.filter(t => t.end_date);
    if (!withStart.length && !withEnd.length) return;

    const newStart = withStart.length ? withStart.reduce((min, t) => t.start_date < min ? t.start_date : min, withStart[0].start_date) : parent.start_date;
    const newEnd   = withEnd.length   ? withEnd.reduce((max, t) => t.end_date   > max ? t.end_date   : max, withEnd[0].end_date) : parent.end_date;
    const newProg  = rolledProgress(children);
    // Linha de base do pai = MIN/MAX das LB das filhas (pai não tem LB própria)
    const withBs = children.filter(t => t.baseline_start);
    const withBe = children.filter(t => t.baseline_end);
    const newBs = withBs.length ? withBs.reduce((m, t) => t.baseline_start < m ? t.baseline_start : m, withBs[0].baseline_start) : null;
    const newBe = withBe.length ? withBe.reduce((m, t) => t.baseline_end > m ? t.baseline_end : m, withBe[0].baseline_end) : null;

    const changed = parent.start_date !== newStart || parent.end_date !== newEnd
      || Math.round(parseFloat(parent.progress)||0) !== newProg
      || (newBs && parent.baseline_start !== newBs) || (newBe && parent.baseline_end !== newBe);
    if (!changed) return;

    const updates = { start_date: newStart, end_date: newEnd, progress: newProg };
    if (newBs && parent.baseline_start !== newBs) updates.baseline_start = newBs;
    if (newBe && parent.baseline_end   !== newBe) updates.baseline_end   = newBe;
    try {
      await DB.updateTask(parentId, updates);
      Object.assign(parent, updates);
      if (!silent) toast(`↑ "${parent.title}" atualizado (roll-up: ${newStart} → ${newEnd}, ${newProg}%)`, 'success');
    } catch (e) {
      console.warn('rollUpParentTask:', e.message);
    }

    // Sobe recursivamente
    if (parent.parent_id) await UI.rollUpParentTask(parent.parent_id, silent);
  },

  // ===== LABELS =====
  openLabelModal(labelId = null) {
    if (!State.currentProjectId) { toast('Selecione um projeto', 'error'); return; }
    const label = labelId ? State.labels.find(l => l.id === labelId) : null;
    const isEdit = !!label;
    const presetColors = ['#E54B1A', '#D4A82C', '#2E7D4F', '#1F3A8A', '#C13B12', '#1F3A8A', '#f29ec4', '#a3e635', '#fb923c', '#94a3b8'];
    Modal.open({
      title: isEdit ? 'Editar Etiqueta' : 'Nova Etiqueta',
      body: `
        <form id="labelForm">
          <div class="form-group">
            <label class="form-label">Nome</label>
            <input class="form-input" name="name" required maxlength="40" value="${escapeHtml(label?.name || '')}" placeholder="Ex.: Urgente, Externo, Revisar">
          </div>
          <div class="form-group">
            <label class="form-label">Cor</label>
            <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;">
              ${presetColors.map(c => `
                <div data-color="${c}" class="label-color-chip" style="width:28px;height:28px;border-radius:3px;background:${c};cursor:pointer;border:2px solid ${(label?.color || presetColors[0]) === c ? 'var(--ink)' : 'transparent'};"></div>
              `).join('')}
              <input type="color" name="color" id="customColorInput" value="${label?.color || presetColors[0]}" style="width:42px;height:28px;border:1px solid var(--border);border-radius:3px;cursor:pointer;background:transparent;">
            </div>
          </div>
        </form>
      `,
      footer: `${isEdit ? `<button class="btn btn-ghost" style="color:var(--accent-danger)" id="btnDelLabel">Excluir</button>` : ''}
               <button class="btn btn-secondary" id="btnCancelLabel">Cancelar</button>
               <button class="btn btn-cta" id="btnSaveLabel">Salvar</button>`
    });
    const colorInput = $('#customColorInput');
    $('#modal').querySelectorAll('.label-color-chip').forEach(chip => {
      chip.onclick = () => {
        $('#modal').querySelectorAll('.label-color-chip').forEach(c => c.style.border = '2px solid transparent');
        chip.style.border = '2px solid var(--ink)';
        colorInput.value = chip.dataset.color;
      };
    });
    $('#btnCancelLabel').onclick = () => Modal.close();
    $('#btnSaveLabel').onclick = () => UI.saveLabel(label?.id);
    if (isEdit) $('#btnDelLabel').onclick = () => UI.deleteLabel(label.id);
  },

  async saveLabel(id) {
    const data = Object.fromEntries(new FormData($('#labelForm')).entries());
    if (!data.name?.trim()) { toast('Nome é obrigatório', 'error'); return; }
    try {
      setLoading(true);
      if (id) {
        const updated = await DB.updateLabel(id, { name: data.name.trim(), color: data.color });
        const idx = State.labels.findIndex(l => l.id === id);
        if (idx >= 0) State.labels[idx] = updated;
      } else {
        const created = await DB.createLabel(State.currentProjectId, data.name.trim(), data.color);
        State.labels.push(created);
      }
      Modal.close();
      await UI.render();
      toast(id ? 'Etiqueta atualizada' : 'Etiqueta criada', 'success');
    } catch (err) {
      let msg = err.message;
      if (msg.includes('Limite de 15')) msg = 'Limite de 15 etiquetas por projeto atingido';
      else if (msg.includes('duplicate') || msg.includes('unique')) msg = 'Já existe uma etiqueta com esse nome';
      else if (msg.includes('labels') && msg.includes('does not exist')) msg = 'Tabela labels ainda não existe — rode 07-migration-v3.5.sql';
      toast(msg, 'error');
    } finally { setLoading(false); }
  },

  async deleteLabel(id) {
    const label = State.labels.find(l => l.id === id);
    if (!label) return;
    const usageCount = State.taskLabels.filter(tl => tl.label_id === id).length;
    const msg = usageCount > 0
      ? `Excluir a etiqueta "${label.name}"? Ela está em ${usageCount} ${usageCount === 1 ? 'tarefa' : 'tarefas'} e será removida automaticamente delas.`
      : `Excluir a etiqueta "${label.name}"?`;
    if (!await Dialog.confirm({ title: 'Excluir etiqueta', msg, confirmText: 'Excluir', danger: true })) return;
    try {
      setLoading(true);
      await DB.deleteLabel(id);
      State.labels = State.labels.filter(l => l.id !== id);
      State.taskLabels = State.taskLabels.filter(tl => tl.label_id !== id);
      Modal.close();
      await UI.render();
      toast('Etiqueta excluída', 'success');
    } catch (err) { toast(friendlyError(err), 'error'); }
    finally { setLoading(false); }
  },
});
