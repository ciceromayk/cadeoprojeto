// Tela Restrições
import { DB } from './db.js';
import { Dialog } from './dialog.js';
import { friendlyError, setLoading, toast } from './feedback.js';
import { $, $$, escapeHtml, fmtDate, fmtDateFull, fmtDateShort, today } from './helpers.js';
import { Modal } from './modal.js';
import { RESTRICTION_STATUS, RESTRICTION_TYPES, State, taskOpenRestrictions } from './state.js';
import { UI } from './ui.js';
import { Views } from './views.js';

// Plugado em Views: continuam acessíveis como Views.<método> e this.<método>.
Object.assign(Views, {
  restrictions() {
    const p = this.current();
    if (!p) return this.emptyProject();

    const typeFilter = State.filterDiscipline || 'all';
    const t = today();

    if (State.restrictions.length === 0) {
      return `
        <div class="page-title-block">
          <div class="page-eyebrow">PROJETO · RESTRIÇÕES</div>
          <div class="page-title">Restrições</div>
        </div>
        <div class="empty-state" style="background:var(--bg-panel);border:1px solid var(--border);border-radius:3px;">
          <div class="empty-state-icon"><svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg></div>
          <div class="empty-state-title">Nenhuma restrição registrada</div>
          <div class="empty-state-sub">Restrições são impedimentos que bloqueiam o avanço do projeto: aprovações pendentes, licenças, decisões de cliente ou conflitos de projeto.</div>
          <button class="btn btn-cta" data-action="new-restriction">+ Nova Restrição</button>
        </div>
      `;
    }

    let list = [...State.restrictions];
    if (typeFilter !== 'all') list = list.filter(r => r.type === typeFilter);

    const openCount  = State.restrictions.filter(r => r.status !== 'resolvida' && r.status !== 'cancelada').length;
    const overdueCount = State.restrictions.filter(r => r.status !== 'resolvida' && r.status !== 'cancelada' && r.due_date && r.due_date < t).length;

    // ── Card de restrição ──────────────────────────────────────────────────────
    const restrictionCard = (r) => {
      const resp     = State.members.find(m => m.id === r.responsible_id);
      const isOverdue = r.status !== 'resolvida' && r.status !== 'cancelada' && r.due_date && r.due_date < t;
      const st       = RESTRICTION_STATUS[r.status] || { label: r.status, color: 'var(--ink-mute)' };
      const typeLabel = RESTRICTION_TYPES[r.type] || r.type;
      const muted     = r.status === 'resolvida' || r.status === 'cancelada';
      return `
        <div class="task-card" draggable="true" style="border-left-color:${isOverdue ? 'var(--accent-danger)' : st.color};cursor:pointer;${muted ? 'opacity:.55;' : ''}"
             data-action="open-restriction" data-rest-id="${r.id}" data-id="${r.id}">
          <div style="font-size:12px;font-weight:600;line-height:1.4;margin-bottom:7px;color:var(--ink);">${escapeHtml(r.description)}</div>
          <div style="display:flex;flex-wrap:wrap;gap:5px;align-items:center;">
            <span style="font-family:var(--font-mono);font-size:9px;background:var(--bg-deep);border:1px solid var(--border);padding:1px 6px;border-radius:2px;color:var(--ink-mute);">${typeLabel}</span>
            ${resp ? `<span style="font-family:var(--font-mono);font-size:9px;color:var(--ink-soft);display:inline-flex;align-items:center;gap:4px;"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:10px;height:10px;"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>${escapeHtml(resp.name.split(' ')[0])}</span>` : ''}
            ${r.due_date ? `<span style="font-family:var(--font-mono);font-size:9px;color:${isOverdue ? 'var(--accent-danger)' : 'var(--ink-mute)'};font-weight:${isOverdue ? '700' : '400'};">${isOverdue ? '⚠ ' : ''}${fmtDate(r.due_date)}</span>` : ''}
          </div>
          ${r.notes ? `<div style="margin-top:6px;font-size:11px;color:var(--ink-mute);font-style:italic;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(r.notes)}</div>` : ''}
        </div>`;
    };

    return `
      <div class="page-title-block">
        <div class="page-eyebrow">PROJETO · RESTRIÇÕES</div>
        <div class="page-title">Restrições</div>
        <div class="page-subtitle">${openCount} abertas · ${State.restrictions.length} total${overdueCount > 0 ? ` · <span style="color:var(--accent-danger);">⚠ ${overdueCount} atrasadas</span>` : ''}</div>
      </div>

      <div class="filter-bar">
        <span class="filter-label">Tipo:</span>
        <select id="fltDiscipline">
          <option value="all" ${typeFilter === 'all' ? 'selected' : ''}>Todos os tipos</option>
          ${Object.entries(RESTRICTION_TYPES).map(([k, v]) => `<option value="${k}" ${typeFilter === k ? 'selected' : ''}>${v}</option>`).join('')}
        </select>
        <span class="filter-count">${list.length} ${list.length === 1 ? 'restrição' : 'restrições'}</span>
      </div>

      <div class="kanban-board" style="height:calc(100vh - 260px);">
        ${Object.entries(RESTRICTION_STATUS).map(([statusId, st]) => {
          const inCol = list
            .filter(r => r.status === statusId)
            .sort((a, b) => new Date(a.due_date || '9999') - new Date(b.due_date || '9999'));
          return `
            <div class="kanban-col">
              <div class="kanban-col-head" style="border-top:2px solid ${st.color};">
                <div class="kanban-col-dot" style="background:${st.color};"></div>
                <div class="kanban-col-title">${st.label}</div>
                <div class="kanban-col-count">${inCol.length}</div>
              </div>
              <div class="kanban-list" data-rest-status="${statusId}">
                ${inCol.length === 0
                  ? `<div style="color:var(--ink-mute);font-size:11px;font-style:italic;padding:14px 4px;text-align:center;">Nenhuma</div>`
                  : inCol.map(r => restrictionCard(r)).join('')}
              </div>
            </div>`;
        }).join('')}
      </div>
    `;
  },
});

// Plugado em UI: continuam acessíveis como UI.<método> e this.<método>.
Object.assign(UI, {
  async moveRestriction(restId, newStatus) {
    const r = (State.restrictions || []).find(x => x.id === restId);
    if (!r || !newStatus || r.status === newStatus) return;
    if (!DB.iCanEdit()) { toast('Você não tem permissão para editar este projeto', 'error'); return; }
    const patch = { status: newStatus };
    patch.resolved_at = newStatus === 'resolvida' ? (r.resolved_at || today()) : null;
    try {
      setLoading(true);
      await DB.updateRestriction(restId, patch);
      Object.assign(r, patch);
      // Se resolvida/cancelada e havia tarefa vinculada bloqueada, oferece desbloquear
      const linked = r.task_id ? State.tasks.find(t => t.id === r.task_id) : null;
      if (linked && (newStatus === 'resolvida' || newStatus === 'cancelada') && linked.status === 'bloqueada'
          && taskOpenRestrictions(linked.id).length === 0) {
        const unblock = await Dialog.confirm({
          title: 'Restrição resolvida',
          msg: `Mover a tarefa "${linked.title.slice(0, 40)}" de Bloqueada para Em Andamento?`,
          confirmText: 'Desbloquear tarefa',
        });
        if (unblock) { await DB.updateTask(linked.id, { status: 'em_andamento' }); Object.assign(linked, { status: 'em_andamento' }); }
      }
      await UI.render();
      toast('Restrição movida', 'success');
    } catch (err) { toast(friendlyError(err), 'error'); }
    finally { setLoading(false); }
  },

  // Drag-and-drop do Kanban de Restrições (muda o status arrastando o card)
  bindRestrictionKanbanDrag() {
    $$('.task-card[data-rest-id]').forEach(card => {
      card.addEventListener('dragstart', (e) => {
        card.classList.add('dragging');
        e.dataTransfer.setData('text/plain', card.dataset.restId);
      });
      card.addEventListener('dragend', () => card.classList.remove('dragging'));
    });
    $$('.kanban-list[data-rest-status]').forEach(list => {
      list.addEventListener('dragover', (e) => { e.preventDefault(); list.classList.add('drag-over'); });
      list.addEventListener('dragleave', () => list.classList.remove('drag-over'));
      list.addEventListener('drop', (e) => {
        e.preventDefault(); list.classList.remove('drag-over');
        const restId = e.dataTransfer.getData('text/plain');
        this.moveRestriction(restId, list.dataset.restStatus);
      });
    });
  },

  // ===== RESTRICTION MODAL =====
  openRestrictionModal(restrictionId = null, opts = {}) {
    if (!State.currentProjectId) { toast('Crie um projeto primeiro', 'error'); return; }
    const rest = restrictionId ? State.restrictions.find(r => r.id === restrictionId) : null;
    const isEdit = !!rest;
    // Tarefa pré-selecionada (ao abrir a partir da edição de uma tarefa)
    const preTaskId = rest?.task_id || opts.defaultTaskId || '';
    // Se aberto a partir de uma tarefa, ao fechar/salvar reabre o modal dela
    State._restReturnToTaskId = opts.returnToTaskId || null;
    const defaultRestTab = preTaskId ? 'task' : 'notes';
    // Setores disponíveis: cadastrados ∪ presentes nas tarefas (mesmo padrão das tarefas)
    const _restSectors = [...new Set((State.sectors || []).map(s => s.name).concat(State.tasks.map(t => t.sector).filter(Boolean)))].sort((a, b) => a.localeCompare(b));

    Modal.open({
      title: isEdit ? 'Editar Restrição' : 'Nova Restrição',
      cls: 'modal-wide',
      body: `
        <form id="restForm">

          <!-- ① HEADER: status + tipo -->
          <div class="tm-header">
            <div class="tm-chip-wrap">
              <span class="tm-status-dot" id="restStatusDot"></span>
              <select name="status" class="tm-chip-native-sel tm-status-sel" id="restStatusSel">
                ${Object.entries(RESTRICTION_STATUS).map(([k, v]) => `<option value="${k}" ${(rest?.status || 'pendente') === k ? 'selected' : ''}>${v.label}</option>`).join('')}
              </select>
              <span class="tm-chip-arrow">▾</span>
            </div>
            <div class="tm-chip-wrap">
              <select name="type" class="tm-chip-native-sel">
                ${Object.entries(RESTRICTION_TYPES).map(([k, v]) => `<option value="${k}" ${(rest?.type || 'outro') === k ? 'selected' : ''}>${v}</option>`).join('')}
              </select>
              <span class="tm-chip-arrow">▾</span>
            </div>
          </div>

          <!-- ② DESCRIÇÃO -->
          <div class="tm-title-wrap">
            <textarea class="tm-title-input" name="description" required rows="2"
              placeholder="Ex.: Aprovação do projeto estrutural pelo cliente antes de iniciar as fundações"
              style="resize:vertical;min-height:52px;font-size:15px;font-weight:500;line-height:1.5;">${escapeHtml(rest?.description || '')}</textarea>
          </div>

          <!-- ③ CHIPS: responsável + setor + prazo -->
          <div class="tm-chips-row" style="align-items:flex-end;">
            <div class="tm-chip-wrap">
              <select name="responsible_id" class="tm-chip-native-sel">
                <option value="">Responsável</option>
                ${State.members.map(m => `<option value="${m.id}" ${rest?.responsible_id === m.id ? 'selected' : ''}>${escapeHtml(m.name.split(' ')[0])}</option>`).join('')}
              </select>
              <span class="tm-chip-arrow">▾</span>
            </div>
            <div class="tm-chip-wrap">
              <select name="sector" class="tm-chip-native-sel">
                <option value="">Setor</option>
                ${_restSectors.map(s => `<option value="${escapeHtml(s)}" ${rest?.sector === s ? 'selected' : ''}>${escapeHtml(s)}</option>`).join('')}
              </select>
              <span class="tm-chip-arrow">▾</span>
            </div>
            <div class="tm-date-field" style="min-width:160px;">
              <div class="tm-date-label-txt">Prazo para resolver</div>
              <input class="tm-date-input" name="due_date" type="date" value="${rest?.due_date || ''}">
            </div>
          </div>

          <!-- ④ TABS: observações | tarefa vinculada -->
          <div class="tm-tabs-wrap">
            <div class="tm-tabs-bar">
              <div class="tm-tab ${defaultRestTab === 'notes' ? 'active' : ''}" data-tm-tab="notes">
                📝 Observações${rest?.notes ? ` <span class="tm-tab-badge">✓</span>` : ''}
              </div>
              <div class="tm-tab ${defaultRestTab === 'task' ? 'active' : ''}" data-tm-tab="task">
                🔗 Tarefa vinculada${preTaskId ? ` <span class="tm-tab-badge">1</span>` : ''}
              </div>
            </div>

            <!-- Observações -->
            <div class="tm-pane ${defaultRestTab === 'notes' ? 'active' : ''}" id="tmPaneNotes">
              <div style="display:flex;justify-content:flex-end;margin-bottom:4px;">
                <span id="restNotesCount" style="font-size:10px;color:var(--ink-mute);font-family:var(--font-mono);">${(rest?.notes || '').length}/1000</span>
              </div>
              <textarea class="form-input" name="notes" rows="4" maxlength="1000"
                placeholder="Detalhes, protocolo, contato responsável..."
                style="width:100%;resize:vertical;font-size:13px;box-sizing:border-box;"
                oninput="const c=document.getElementById('restNotesCount');if(c)c.textContent=this.value.length+'/1000';">${escapeHtml(rest?.notes || '')}</textarea>
            </div>

            <!-- Tarefa vinculada -->
            <div class="tm-pane ${defaultRestTab === 'task' ? 'active' : ''}" id="tmPaneTask">
              <div style="font-size:11px;color:var(--ink-mute);margin-bottom:10px;line-height:1.5;">
                Ao salvar com status <strong>Pendente</strong> ou <strong>Em Tratamento</strong>, a tarefa vinculada será marcada automaticamente como <strong style="color:var(--accent-danger);">Bloqueada</strong>.
              </div>
              <div class="tm-parent-wrap">
                <select class="tm-parent-select" name="task_id">
                  <option value="">— Nenhuma tarefa vinculada</option>
                  ${State.tasks.sort((a,b) => (a.title||'').localeCompare(b.title||'')).map(t =>
                    `<option value="${t.id}" ${(preTaskId === t.id) ? 'selected' : ''}>${escapeHtml((t.code ? t.code+' · ' : '') + t.title)}</option>`
                  ).join('')}
                </select>
                <span class="tm-parent-arrow">▾</span>
              </div>
            </div>
          </div><!-- /tm-tabs-wrap -->

        </form>
      `,
      footer: `${isEdit ? `<button class="btn btn-ghost" style="color:var(--accent-danger)" id="btnDelRest">Excluir</button>` : ''}
               <button class="btn btn-secondary" id="btnCancelRest">Cancelar</button>
               <button class="btn btn-cta" id="btnSaveRest">Salvar</button>`
    });

    // Status dot — usa as cores do RESTRICTION_STATUS
    const _rStatusSel = document.getElementById('restStatusSel');
    const _rStatusDot = document.getElementById('restStatusDot');
    if (_rStatusSel && _rStatusDot) {
      const _syncRDot = () => {
        _rStatusDot.style.background = RESTRICTION_STATUS[_rStatusSel.value]?.color || 'var(--ink-mute)';
      };
      _rStatusSel.addEventListener('change', _syncRDot);
      _syncRDot();
    }

    // Tabs
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

    $('#btnCancelRest').onclick = () => {
      const ret = State._restReturnToTaskId; State._restReturnToTaskId = null;
      Modal.close();
      if (ret) setTimeout(() => UI.openTaskModal(ret), 60);
    };
    $('#btnSaveRest').onclick = () => UI.saveRestriction(rest?.id);
    if (isEdit) $('#btnDelRest').onclick = () => UI.deleteRestriction(rest.id);
  },

  async saveRestriction(id) {
    const data = Object.fromEntries(new FormData($('#restForm')).entries());
    if (!data.due_date)       data.due_date = null;
    if (!data.notes)          data.notes = null;
    if (!data.responsible_id) data.responsible_id = null;
    if (!data.task_id)        data.task_id = null;
    data.sector = (data.sector && data.sector.trim()) ? data.sector.trim() : null;
    if (data.status === 'resolvida' && !data.resolved_at) data.resolved_at = today();
    else if (data.status !== 'resolvida') data.resolved_at = null;

    // Captura a tarefa vinculada para lógica de bloqueio
    const linkedTaskId   = data.task_id;
    const linkedTask     = linkedTaskId ? State.tasks.find(t => t.id === linkedTaskId) : null;
    const isBlockingStatus = ['pendente', 'em_tratamento'].includes(data.status);
    const isResolved     = data.status === 'resolvida' || data.status === 'cancelada';

    // Tenta salvar com task_id; se a coluna não existir, remove e tenta de novo
    const trySave = async (payload) => {
      try {
        if (id) { await DB.updateRestriction(id, payload); }
        else { const c = await DB.createRestriction(State.currentProjectId, payload); State.restrictions.push(c); }
      } catch (err) {
        const m = err.message || '';
        // Coluna sector ausente → remove e tenta de novo (rode 36-restriction-sector.sql)
        if (m.includes('sector')) {
          if (payload.sector) toast('⚠ Campo "Setor" ignorado — rode 36-restriction-sector.sql para ativá-lo', 'warning');
          delete payload.sector;
          if (id) { await DB.updateRestriction(id, payload); }
          else { const c = await DB.createRestriction(State.currentProjectId, payload); State.restrictions.push(c); }
        } else if (m.includes('task_id') || m.includes('column')) {
          // Só avisa se o usuário realmente vinculou uma tarefa (evita ruído em troca de status)
          if (payload.task_id) toast('⚠ Campo "Tarefa vinculada" ignorado — rode 21-add-restriction-task-link.sql para ativá-lo', 'warning');
          delete payload.task_id;
          if (id) { await DB.updateRestriction(id, payload); }
          else { const c = await DB.createRestriction(State.currentProjectId, payload); State.restrictions.push(c); }
        } else throw err;
      }
    };

    try {
      setLoading(true);
      await trySave({ ...data });

      if (id) {
        const r = State.restrictions.find(x => x.id === id); if (r) Object.assign(r, data);
        toast('Restrição atualizada', 'success');
      } else {
        toast('Restrição registrada', 'success');
      }

      // Auto-bloquear / desbloquear tarefa vinculada
      if (linkedTask) {
        if (isBlockingStatus && linkedTask.status !== 'bloqueada') {
          // Bloqueia a tarefa
          await DB.updateTask(linkedTask.id, { status: 'bloqueada' });
          Object.assign(linkedTask, { status: 'bloqueada' });
          toast(`⚠ Tarefa "${linkedTask.title.slice(0, 30)}" marcada como Bloqueada`, 'warning');
        } else if (isResolved && linkedTask.status === 'bloqueada') {
          // Restrição resolvida: oferecer para desbloquear
          const unblock = await Dialog.confirm({
            title: 'Restrição resolvida',
            msg: `A restrição foi ${data.status}. Deseja mover a tarefa "${linkedTask.title.slice(0, 40)}" de Bloqueada para Em Andamento?`,
            confirmText: 'Desbloquear tarefa',
          });
          if (unblock) {
            await DB.updateTask(linkedTask.id, { status: 'em_andamento' });
            Object.assign(linkedTask, { status: 'em_andamento' });
            toast(`✓ Tarefa "${linkedTask.title.slice(0, 30)}" desbloqueada`, 'success');
          }
        }
      }

      Modal.close();
      await UI.render();
      // Se a restrição foi criada a partir da edição de uma tarefa, reabre a tarefa
      const ret = State._restReturnToTaskId; State._restReturnToTaskId = null;
      if (ret) setTimeout(() => UI.openTaskModal(ret), 60);
    } catch (err) { toast(friendlyError(err), 'error'); }
    finally { setLoading(false); }
  },

  async deleteRestriction(id) {
    if (!await Dialog.confirm({ title: 'Excluir restrição', msg: 'Excluir esta restrição?\n\nA ação não pode ser desfeita.', confirmText: 'Excluir', danger: true })) return;
    try {
      setLoading(true);
      await DB.deleteRestriction(id);
      State.restrictions = State.restrictions.filter(r => r.id !== id);
      Modal.close();
      await UI.render();
      const ret = State._restReturnToTaskId; State._restReturnToTaskId = null;
      if (ret) setTimeout(() => UI.openTaskModal(ret), 60);
      toast('Restrição excluída', 'success');
    } catch (err) { toast(friendlyError(err), 'error'); }
    finally { setLoading(false); }
  },

  printRestrictions() {
    const p = Views.current();
    if (!p) { toast('Selecione um projeto', 'warning'); return; }
    if (!State.restrictions.length) { toast('Nenhuma restrição cadastrada', 'warning'); return; }
    const todayStr = today();
    const rests = [...State.restrictions].sort((a, b) => {
      const order = { pendente: 0, em_tratamento: 1, resolvida: 2, cancelada: 3 };
      return (order[a.status] ?? 9) - (order[b.status] ?? 9) || new Date(a.due_date||'9999') - new Date(b.due_date||'9999');
    });
    const openCount = rests.filter(r => r.status !== 'resolvida' && r.status !== 'cancelada').length;
    const overdueCount = rests.filter(r => r.status !== 'resolvida' && r.status !== 'cancelada' && r.due_date && r.due_date < todayStr).length;
    const statusColor = { pendente:'#94928B', em_tratamento:'#D4A82C', resolvida:'#2E7D4F', cancelada:'#94928B' };

    let body = `
      <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:14px;padding-bottom:10px;border-bottom:2px solid #1A1714;">
        <div>
          <div style="font-size:18px;font-weight:800;letter-spacing:-0.02em;">${escapeHtml(p.name)}</div>
          <div style="font-size:10px;color:#94928B;font-family:monospace;margin-top:2px;">${escapeHtml(p.client||'—')} · ${fmtDateFull(p.start_date)} → ${fmtDateFull(p.end_date)}</div>
        </div>
        <div style="text-align:right;">
          <div style="font-size:13px;font-weight:700;">Log de Restrições</div>
          <div style="font-size:9px;color:#94928B;font-family:monospace;">Gerado em: ${fmtDateFull(todayStr)}</div>
        </div>
      </div>
      <div style="display:flex;gap:16px;margin-bottom:14px;font-family:monospace;font-size:9px;">
        <span><strong>${rests.length}</strong> restrições</span>
        <span style="color:#E54B1A;"><strong>${openCount}</strong> abertas</span>
        <span style="color:#2E7D4F;"><strong>${rests.filter(r=>r.status==='resolvida').length}</strong> resolvidas</span>
        ${overdueCount > 0 ? `<span style="color:#C13B12;font-weight:700;">⚠ ${overdueCount} em atraso</span>` : '<span style="color:#2E7D4F;">✓ sem atrasos</span>'}
      </div>
      <table>
        <thead><tr>
          <th style="width:90px;">Tipo</th>
          <th>Descrição</th>
          <th style="width:110px;">Responsável</th>
          <th style="width:75px;text-align:center;">Prazo</th>
          <th style="width:90px;text-align:center;">Status</th>
        </tr></thead>
        <tbody>
          ${rests.map(r => {
            const resp = State.members.find(m => m.id === r.responsible_id);
            const isOvd = r.status !== 'resolvida' && r.status !== 'cancelada' && r.due_date && r.due_date < todayStr;
            const sc = statusColor[r.status] || '#94928B';
            const st = RESTRICTION_STATUS[r.status];
            return `<tr style="${isOvd ? 'background:#fff8f8;' : ''}">
              <td style="font-family:monospace;font-size:9px;color:#64748b;">${RESTRICTION_TYPES[r.type]||r.type}</td>
              <td><strong style="font-size:11px;">${escapeHtml(r.description)}</strong>${r.notes ? `<br><span style="font-size:8px;color:#94928B;">${escapeHtml(r.notes.slice(0,120))}${r.notes.length>120?'…':''}</span>` : ''}</td>
              <td style="font-size:10px;">${resp ? escapeHtml(resp.name) : '—'}</td>
              <td style="text-align:center;font-family:monospace;font-size:9px;${isOvd?'color:#C13B12;font-weight:700;':'color:#666;'}">${r.due_date?fmtDateShort(r.due_date):'—'}${isOvd?' ⚠':''}</td>
              <td style="text-align:center;"><span style="padding:1px 5px;border-radius:2px;font-size:8px;font-weight:700;background:${sc}22;color:${sc};border:1px solid ${sc}44;">${st?.label||r.status}</span></td>
            </tr>`;
          }).join('')}
        </tbody>
      </table>
      <div style="font-size:8px;color:#94928B;font-family:monospace;margin-top:12px;padding-top:8px;border-top:1px solid #E8E2D4;">
        Gerado pelo PROJETUDO em ${fmtDateFull(todayStr)} · ${rests.length} restrições registradas
      </div>`;

    this._printWindow('Log de Restrições', body);
  },
});
