// Tela Last Planner
import { DB } from './db.js';
import { Dialog } from './dialog.js';
import { toast } from './feedback.js';
import { addDays, addWeeks, colorFromString, escapeHtml, fmtDateShort, initials, mondayOf, parentTag, today, weekRangeLabel } from './helpers.js';
import { Modal } from './modal.js';
import { COMMITMENT_STATUS, PPC_CAUSES, State } from './state.js';
import { UI } from './ui.js';
import { Views } from './views.js';

// Plugado em Views: continuam acessíveis como Views.<método> e this.<método>.
Object.assign(Views, {
  // ============================================================================
  // LAST PLANNER SYSTEM — Plano Semanal · Lookahead · %PPC
  // ============================================================================
  lpComputePPC(weekStart) {
    const list = (State.weeklyCommitments || []).filter(c => c.week_start === weekStart);
    const committed = list.length;
    const done = list.filter(c => c.status === 'cumprido').length;
    const notDone = list.filter(c => c.status === 'nao_cumprido').length;
    const pending = list.filter(c => c.status === 'pendente').length;
    const ppc = committed > 0 ? Math.round((done / committed) * 100) : null;
    return { committed, done, notDone, pending, ppc, list };
  },

  lpWeekHistory(n) {
    const base = mondayOf(today());
    const arr = [];
    for (let i = n - 1; i >= 0; i--) {
      const w = addWeeks(base, -i);
      arr.push({ week: w, ...this.lpComputePPC(w) });
    }
    return arr;
  },

  lpRestrictionFor(taskId) {
    return (State.restrictions || []).find(r => r.task_id === taskId && (r.status === 'pendente' || r.status === 'em_tratamento')) || null;
  },

  lpPpcColor(ppc) {
    if (ppc == null) return 'var(--ink-mute)';
    if (ppc >= 80) return 'var(--accent-success)';
    if (ppc >= 50) return 'var(--accent-warm)';
    return 'var(--accent-danger)';
  },

  lastplanner() {
    const p = this.current();
    if (!p) return this.emptyProject();
    if (!State.lpWeekStart) State.lpWeekStart = mondayOf(today());
    const wk = State.lpWeekStart;
    const thisWeek = mondayOf(today());
    const cur = this.lpComputePPC(wk);
    const hist = this.lpWeekHistory(8);
    const maxPpc = 100;

    // ===== KPI cards =====
    const ppcTxt = cur.ppc == null ? '—' : cur.ppc + '%';
    const ppcColor = this.lpPpcColor(cur.ppc);
    const kpi = (label, val, color, sub) => `
      <div style="flex:1;min-width:120px;background:var(--bg-panel);border:1px solid var(--border);border-radius:6px;padding:14px 16px;">
        <div style="font-family:var(--font-mono);font-size:10px;text-transform:uppercase;letter-spacing:.1em;color:var(--ink-mute);margin-bottom:6px;">${label}</div>
        <div style="font-size:26px;font-weight:800;color:${color};line-height:1;">${val}</div>
        ${sub ? `<div style="font-size:11px;color:var(--ink-mute);margin-top:5px;">${sub}</div>` : ''}
      </div>`;

    // ===== Sparkline PPC (8 semanas) =====
    const spark = `
      <div style="flex:2;min-width:240px;background:var(--bg-panel);border:1px solid var(--border);border-radius:6px;padding:14px 16px;">
        <div style="font-family:var(--font-mono);font-size:10px;text-transform:uppercase;letter-spacing:.1em;color:var(--ink-mute);margin-bottom:10px;">Tendência do PPC · 8 semanas</div>
        <div style="display:flex;align-items:flex-end;gap:6px;height:70px;">
          ${hist.map(h => {
            const hpct = h.ppc == null ? 0 : h.ppc;
            const c = this.lpPpcColor(h.ppc);
            const isCur = h.week === wk;
            return `<div style="flex:1;display:flex;flex-direction:column;align-items:center;gap:4px;cursor:pointer;" data-action="lp-goto-week" data-week="${h.week}" title="Semana ${weekRangeLabel(h.week)} · ${h.ppc == null ? 'sem dados' : h.ppc + '% PPC'}">
              <div style="font-family:var(--font-mono);font-size:8px;color:var(--ink-mute);">${h.ppc == null ? '' : h.ppc}</div>
              <div style="width:100%;max-width:26px;height:${Math.max(3, hpct / maxPpc * 50)}px;background:${c};border-radius:2px 2px 0 0;${isCur ? 'outline:2px solid var(--accent);outline-offset:1px;' : ''}"></div>
              <div style="font-family:var(--font-mono);font-size:8px;color:${isCur ? 'var(--accent)' : 'var(--ink-mute)'};">${h.week.slice(8)}/${h.week.slice(5, 7)}</div>
            </div>`;
          }).join('')}
        </div>
      </div>`;

    // ===== Plano Semanal (semana wk) =====
    const planRows = cur.list
      .slice()
      .sort((a, b) => (a.status === 'pendente' ? -1 : 1) - (b.status === 'pendente' ? -1 : 1))
      .map(c => this.lpCommitmentRow(c)).join('');
    const planSection = `
      <div class="panel" style="margin-bottom:16px;">
        <div class="panel-head">
          <div class="panel-title">Plano Semanal</div>
          <div class="panel-title-mono">${cur.committed} comprometida${cur.committed !== 1 ? 's' : ''} · ${cur.done} ✓ · ${cur.notDone} ✗ · ${cur.pending} pendente${cur.pending !== 1 ? 's' : ''}</div>
        </div>
        <div class="panel-body" style="padding:0;">
          ${cur.committed === 0
            ? `<div class="empty-state" style="padding:28px 20px;"><div class="empty-state-sub">Nenhuma tarefa comprometida para esta semana.<br>Use <strong>+ Comprometer Tarefa</strong> ou clique numa tarefa no Lookahead abaixo.</div></div>`
            : `<div style="display:flex;flex-direction:column;">${planRows}</div>`}
        </div>
      </div>`;

    // ===== Lookahead (6 semanas a partir de wk) =====
    const lpProjFilter = State.lpProjectFilter || 'current';
    const lpAllTasks = lpProjFilter === 'all' && State.allTasks && State.allTasks.length > 0
      ? State.allTasks
      : State.tasks;
    const isLeaf = (t) => !lpAllTasks.some(x => x.parent_id === t.id);
    // Filtro de setor (aplica ao Lookahead)
    const lpSector = State.lpSectorFilter || 'all';
    const lpSectors = [...new Set((State.sectors || []).map(s => s.name).concat(lpAllTasks.map(t => t.sector).filter(Boolean)))].sort((a, b) => a.localeCompare(b));
    const _matchLpSector = (t) => lpSector === 'all' || (t.sector || '__none__') === lpSector;
    // Filtro de responsável (aplica ao Lookahead)
    const lpResp = State.lpResponsibleFilter || 'all';
    const lpRespMembers = [...new Set(lpAllTasks.map(t => t.assignee_id).filter(Boolean))]
      .map(id => State.members.find(m => m.id === id)).filter(Boolean)
      .sort((a, b) => a.name.localeCompare(b.name));
    const _matchLpResp = (t) => lpResp === 'all' || (lpResp === '__none__' ? !t.assignee_id : t.assignee_id === lpResp);
    // Modo de data: 'ending' = tarefas que TERMINAM na semana; 'occurring' = que ACONTECEM (se sobrepõem) na semana.
    const lpDateMode = State.lpDateMode === 'occurring' ? 'occurring' : 'ending';
    const _inWeek = (t, w) => {
      if (lpDateMode === 'occurring') {
        if (!t.start_date || !t.end_date) return false;
        const wEnd = addDays(w, 6);                       // domingo da semana
        return t.start_date <= wEnd && t.end_date >= w;   // intervalos se sobrepõem
      }
      return t.end_date && mondayOf(t.end_date) === w;    // termina naquela semana
    };
    const lookWeeks = [];
    for (let i = 0; i < 6; i++) lookWeeks.push(addWeeks(wk, i));
    const lookaheadBoard = `
      <div class="panel">
        <div class="panel-head">
          <div class="panel-title">Lookahead · 6 semanas</div>
          <div class="panel-title-mono">🔒 = restrição aberta (precisa liberar)</div>
        </div>
        <div class="panel-body" style="padding:12px;overflow-x:auto;">
          <div class="kanban-board" style="grid-template-columns:repeat(6,minmax(180px,1fr));height:auto;min-height:200px;">
            ${lookWeeks.map((w, i) => {
              const tasksW = lpAllTasks
                .filter(t => isLeaf(t) && !t.inactive && _matchLpSector(t) && _matchLpResp(t) && t.status !== 'concluido' && _inWeek(t, w))
                .sort((a, b) => String(a.end_date).localeCompare(String(b.end_date)));
              return `<div class="kanban-col">
                <div class="kanban-col-head" style="border-top:2px solid ${i === 0 ? 'var(--accent)' : 'var(--border-strong)'};">
                  <div class="kanban-col-title">${i === 0 ? 'Esta semana' : 'Sem ' + (i + 1)}</div>
                  <div class="kanban-col-count">${tasksW.length}</div>
                </div>
                <div style="font-family:var(--font-mono);font-size:9px;color:var(--ink-mute);padding:0 10px 6px;">${weekRangeLabel(w)}</div>
                <div class="kanban-list">
                  ${tasksW.length === 0
                    ? `<div style="color:var(--ink-mute);font-size:11px;font-style:italic;padding:12px 4px;text-align:center;">—</div>`
                    : tasksW.map(t => this.lpLookaheadCard(t, w, lpProjFilter === 'all')).join('')}
                </div>
              </div>`;
            }).join('')}
          </div>
        </div>
      </div>`;

    // ===== Pareto de causas (não-cumprimento) =====
    const causeCounts = {};
    (State.weeklyCommitments || []).filter(c => c.status === 'nao_cumprido' && c.cause).forEach(c => { causeCounts[c.cause] = (causeCounts[c.cause] || 0) + 1; });
    const causeArr = Object.entries(causeCounts).sort((a, b) => b[1] - a[1]);
    const totalNC = causeArr.reduce((s, [, n]) => s + n, 0);
    const paretoSection = causeArr.length === 0 ? '' : `
      <div class="panel" style="margin-top:16px;">
        <div class="panel-head"><div class="panel-title">Causas de Não-Cumprimento (RNC)</div><div class="panel-title-mono">${totalNC} ocorrência${totalNC !== 1 ? 's' : ''}</div></div>
        <div class="panel-body">
          <div style="display:flex;flex-direction:column;gap:8px;">
            ${causeArr.map(([code, n]) => {
              const pct = Math.round(n / totalNC * 100);
              return `<div style="display:flex;align-items:center;gap:10px;">
                <div style="width:200px;font-size:12px;flex-shrink:0;">${escapeHtml(PPC_CAUSES[code] || code)}</div>
                <div style="flex:1;height:14px;background:var(--bg-deep);border-radius:3px;overflow:hidden;"><div style="height:100%;width:${pct}%;background:var(--accent-danger);"></div></div>
                <div style="font-family:var(--font-mono);font-size:11px;color:var(--ink-soft);width:64px;text-align:right;flex-shrink:0;">${n} · ${pct}%</div>
              </div>`;
            }).join('')}
          </div>
        </div>
      </div>`;

    return `
      <div class="page-title-block">
        <div class="page-eyebrow">ENGENHARIA · LAST PLANNER</div>
        <div class="page-title">Planejamento Semanal</div>
        <div class="page-subtitle">Comprometa tarefas livres de restrição, acompanhe o cumprimento e o %PPC.</div>
      </div>

      <!-- Navegador de semana -->
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:14px;flex-wrap:wrap;">
        <button class="btn btn-ghost" data-action="lp-prev-week" style="padding:6px 12px;">◀</button>
        <div style="font-family:var(--font-mono);font-size:13px;font-weight:700;min-width:150px;text-align:center;">
          Semana de ${weekRangeLabel(wk)}
          ${wk === thisWeek ? '<span style="font-size:9px;color:var(--accent);text-transform:uppercase;letter-spacing:.08em;display:block;">semana atual</span>' : ''}
        </div>
        <button class="btn btn-ghost" data-action="lp-next-week" style="padding:6px 12px;">▶</button>
        ${wk !== thisWeek ? `<button class="btn btn-ghost" data-action="lp-this-week" style="padding:6px 12px;font-size:11px;">Esta semana</button>` : ''}
        <div style="margin-left:auto;display:flex;gap:8px;flex-wrap:wrap;align-items:center;">
          ${State.projects && State.projects.length > 1 ? `
          <select class="form-input" id="lpProjectFilter" style="width:auto;min-width:170px;font-size:12px;padding:6px 10px;">
            <option value="current" ${lpProjFilter === 'current' ? 'selected' : ''}>Projeto: ${escapeHtml(p.name)}</option>
            <option value="all" ${lpProjFilter === 'all' ? 'selected' : ''}>Todos os projetos</option>
          </select>` : ''}
          ${lpRespMembers.length > 0 ? `
          <select class="form-input" id="lpResponsibleFilter" style="width:auto;min-width:160px;font-size:12px;padding:6px 10px;">
            <option value="all" ${lpResp === 'all' ? 'selected' : ''}>Responsável: Todos</option>
            <option value="__none__" ${lpResp === '__none__' ? 'selected' : ''}>Sem responsável</option>
            ${lpRespMembers.map(m => `<option value="${m.id}" ${lpResp === m.id ? 'selected' : ''}>${escapeHtml(m.name)}</option>`).join('')}
          </select>` : ''}
          ${lpSectors.length > 0 ? `
          <select class="form-input" id="lpSectorFilter" style="width:auto;min-width:150px;font-size:12px;padding:6px 10px;">
            <option value="all" ${lpSector === 'all' ? 'selected' : ''}>Setor: Todos</option>
            <option value="__none__" ${lpSector === '__none__' ? 'selected' : ''}>Sem setor</option>
            ${lpSectors.map(s => `<option value="${escapeHtml(s)}" ${lpSector === s ? 'selected' : ''}>${escapeHtml(s)}</option>`).join('')}
          </select>` : ''}
          <select class="form-input" id="lpDateMode" title="Como as tarefas são distribuídas nas colunas de semana." style="width:auto;min-width:180px;font-size:12px;padding:6px 10px;">
            <option value="ending" ${lpDateMode === 'ending' ? 'selected' : ''}>Exibir: que terminam na semana</option>
            <option value="occurring" ${lpDateMode === 'occurring' ? 'selected' : ''}>Exibir: que acontecem na semana</option>
          </select>
        </div>
      </div>

      <!-- KPIs -->
      <div style="display:flex;gap:12px;margin-bottom:16px;flex-wrap:wrap;">
        ${kpi('PPC da semana', ppcTxt, ppcColor, cur.committed > 0 ? `${cur.done}/${cur.committed} cumpridas` : 'sem compromissos')}
        ${kpi('Comprometidas', cur.committed, 'var(--ink)', '')}
        ${kpi('Cumpridas', cur.done, 'var(--accent-success)', '')}
        ${kpi('Não cumpridas', cur.notDone, 'var(--accent-danger)', '')}
        ${spark}
      </div>

      ${planSection}
      ${lookaheadBoard}
      ${paretoSection}
    `;
  },

  lpCommitmentRow(c) {
    const t = State.tasks.find(x => x.id === c.task_id);
    const member = State.members.find(m => m.id === (c.responsible_id || t?.assignee_id));
    const st = COMMITMENT_STATUS[c.status] || COMMITMENT_STATUS.pendente;
    const rest = t ? this.lpRestrictionFor(t.id) : null;
    return `
      <div style="display:flex;align-items:center;gap:10px;padding:9px 14px;border-bottom:1px solid var(--border);font-size:12px;">
        <span style="width:8px;height:8px;border-radius:50%;background:${st.color};flex-shrink:0;"></span>
        <span style="flex:1;min-width:0;cursor:pointer;font-weight:500;" data-action="edit-task" data-id="${c.task_id}" title="${escapeHtml(t?.title || '')}">
          <span style="display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${t ? `<span style="font-family:var(--font-mono);font-size:10px;color:var(--accent);">${t.code}</span> ${escapeHtml(t.title)}` : '<span style="color:var(--ink-mute);">(tarefa removida)</span>'}${rest ? `<span style="font-size:9px;color:var(--accent-danger);margin-left:6px;" title="${escapeHtml(rest.description)}">🔒 restrição</span>` : ''}</span>
          ${t ? parentTag(t) : ''}
        </span>
        ${member ? `<div class="avatar-tip" data-tip="${escapeHtml(member.name)}" style="flex-shrink:0;"><div class="task-assignee" style="background:${colorFromString(member.name)}">${initials(member.name)}</div></div>` : '<div style="width:22px;flex-shrink:0;"></div>'}
        ${c.status === 'nao_cumprido'
          ? `<select class="form-input lp-cause-sel" data-id="${c.id}" style="width:auto;max-width:180px;font-size:11px;padding:4px 8px;flex-shrink:0;">
               <option value="">Causa…</option>
               ${Object.entries(PPC_CAUSES).map(([code, lbl]) => `<option value="${code}" ${c.cause === code ? 'selected' : ''}>${escapeHtml(lbl)}</option>`).join('')}
             </select>`
          : ''}
        <div style="display:flex;gap:4px;flex-shrink:0;">
          <button class="btn ${c.status === 'cumprido' ? 'btn-cta' : 'btn-ghost'}" data-action="lp-mark" data-id="${c.id}" data-status="cumprido" title="Cumprida" style="padding:3px 9px;font-size:12px;">✓</button>
          <button class="btn ${c.status === 'nao_cumprido' ? 'btn-cta' : 'btn-ghost'}" data-action="lp-mark" data-id="${c.id}" data-status="nao_cumprido" title="Não cumprida" style="padding:3px 9px;font-size:12px;">✗</button>
          <button class="btn btn-ghost" data-action="lp-uncommit" data-id="${c.id}" title="Remover do plano" style="padding:3px 8px;font-size:11px;color:var(--ink-mute);">⊘</button>
        </div>
      </div>`;
  },

  lpLookaheadCard(t, wk, showProject = false) {
    const commit = (State.weeklyCommitments || []).find(c => c.task_id === t.id && c.week_start === wk);
    const committed = !!commit;
    const rest = this.lpRestrictionFor(t.id);
    const allTasks = State.allTasks && State.allTasks.length > 0 ? State.allTasks : State.tasks;
    const member = State.members.find(m => m.id === t.assignee_id);
    const isOverdue = t.status !== 'concluido' && t.end_date < today();
    const parent = t.parent_id ? allTasks.find(x => x.id === t.parent_id) : null;
    const proj = showProject ? (State.projects || []).find(p => p.id === t.project_id) : null;
    return `
      <div class="task-card" style="cursor:default;border-left:3px solid ${rest ? 'var(--accent-danger)' : (committed ? 'var(--accent-success)' : 'var(--border-strong)')};">
        ${proj ? `<div style="font-family:var(--font-mono);font-size:9px;color:var(--ink-mute);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-bottom:2px;" title="${escapeHtml(proj.name)}">${escapeHtml(proj.name)}</div>` : ''}
        <div class="task-card-id"><span style="color:var(--accent);">${t.code}</span>${rest ? ` · <span style="color:var(--accent-danger);" title="${escapeHtml(rest.description)}">🔒</span>` : ''}</div>
        <div class="task-card-title" style="cursor:pointer;" data-action="edit-task" data-id="${t.id}">${escapeHtml(t.title)}</div>
        ${parent ? `<div style="font-size:10px;color:var(--ink-mute);margin:-2px 0 2px;display:flex;align-items:center;gap:3px;overflow:hidden;" title="Atividade pai: ${escapeHtml(parent.title)}"><span style="color:var(--accent);flex-shrink:0;">↳</span><span style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escapeHtml(parent.title)}</span></div>` : ''}
        <div class="task-card-footer" style="margin-top:7px;">
          ${member ? `<div class="avatar-tip" data-tip="${escapeHtml(member.name)}"><div class="task-assignee" style="background:${colorFromString(member.name)}">${initials(member.name)}</div></div>` : '<div></div>'}
          <div class="task-due" style="color:${isOverdue ? 'var(--accent-danger)' : 'var(--ink-mute)'};">${fmtDateShort(t.end_date)}</div>
        </div>
        ${committed
          ? `<button class="btn btn-ghost lp-undo-btn" data-action="lp-uncommit" data-id="${commit.id}" title="Clique para tirar do plano semanal" style="width:100%;margin-top:7px;padding:4px;font-size:10px;color:var(--accent-success);">✓ comprometida · <span style="opacity:.85;">↩ tirar do plano</span></button>`
          : `<button class="btn btn-ghost" data-action="lp-commit" data-id="${t.id}" data-week="${wk}" style="width:100%;margin-top:7px;padding:4px;font-size:10px;">+ Comprometer</button>`}
      </div>`;
  },
});

// Plugado em UI: continuam acessíveis como UI.<método> e this.<método>.
Object.assign(UI, {
  // ===== LAST PLANNER — ações =====
  async lpCommitTask(taskId, week) {
    if (!taskId || !week) return;
    // Last Planner: comentaristas também podem comprometer tarefas (planejamento semanal)
    if (!DB.iCanComment()) { toast('Você não tem permissão neste projeto', 'error'); return; }
    if ((State.weeklyCommitments || []).some(c => c.task_id === taskId && c.week_start === week)) {
      toast('Tarefa já comprometida nesta semana', 'info'); return;
    }
    const t = State.tasks.find(x => x.id === taskId);
    try {
      const c = await DB.createWeeklyCommitment(State.currentProjectId, {
        task_id: taskId, week_start: week, responsible_id: t?.assignee_id || null, status: 'pendente'
      });
      State.weeklyCommitments.push(c);
      toast('Tarefa comprometida', 'success');
      UI.render();
    } catch (err) {
      if (/weekly_commitments|schema cache|does not exist|relation|column/i.test(err.message || '')) {
        toast('Tabela do Last Planner ausente — rode o 17-migration-v4.3-lastplanner.sql no Supabase.', 'error');
      } else { toast('Erro ao comprometer: ' + err.message, 'error'); }
    }
  },

  async lpUncommit(id) {
    const c = (State.weeklyCommitments || []).find(x => x.id === id);
    const t = c ? State.tasks.find(tk => tk.id === c.task_id) : null;
    const nome = t ? `"${t.title}"` : 'esta tarefa';
    if (!await Dialog.confirm({
      title: 'Tirar do plano semanal',
      msg: `A tarefa ${nome} será removida do plano semanal e deixará de estar comprometida nesta semana.\n\nDeseja continuar?`,
      confirmText: 'Tirar do plano'
    })) return;
    try {
      await DB.deleteWeeklyCommitment(id);
      State.weeklyCommitments = State.weeklyCommitments.filter(c => c.id !== id);
      UI.render();
      toast('Tarefa removida do plano semanal', 'success');
    } catch (err) { toast('Erro ao remover: ' + err.message, 'error'); }
  },

  async lpMark(id, status) {
    const c = (State.weeklyCommitments || []).find(x => x.id === id);
    if (!c) return;
    const newStatus = c.status === status ? 'pendente' : status;
    const patch = { status: newStatus };
    if (newStatus !== 'nao_cumprido') patch.cause = null;
    try {
      await DB.updateWeeklyCommitment(id, patch);
      Object.assign(c, patch);
      UI.render();
    } catch (err) { toast('Erro ao atualizar: ' + err.message, 'error'); }
  },

  async lpSetCause(id, cause) {
    const c = (State.weeklyCommitments || []).find(x => x.id === id);
    if (!c) return;
    try {
      await DB.updateWeeklyCommitment(id, { cause: cause || null });
      c.cause = cause || null;
    } catch (err) { toast('Erro ao salvar causa: ' + err.message, 'error'); }
  },

  openCommitPicker() {
    const wk = State.lpWeekStart || mondayOf(today());
    const isLeaf = (t) => !State.tasks.some(x => x.parent_id === t.id);
    const committedIds = new Set((State.weeklyCommitments || []).filter(c => c.week_start === wk).map(c => c.task_id));
    const candidates = State.tasks
      .filter(t => isLeaf(t) && t.status !== 'concluido' && !committedIds.has(t.id))
      .sort((a, b) => String(a.end_date || '9999').localeCompare(String(b.end_date || '9999')));
    const rowHtml = (t) => {
      const rest = Views.lpRestrictionFor(t.id);
      return `<div class="commit-pick-row" data-pick-id="${t.id}" style="display:flex;align-items:center;gap:10px;padding:8px 10px;border-bottom:1px solid var(--border);cursor:pointer;font-size:12px;" onmouseover="this.style.background='var(--bg-hover)'" onmouseout="this.style.background='transparent'">
        <span style="font-family:var(--font-mono);font-size:10px;color:var(--accent);flex-shrink:0;">${t.code}</span>
        <span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(t.title)} ${rest ? '<span style="font-size:9px;color:var(--accent-danger);">🔒</span>' : ''}${parentTag(t, null, 'inline')}</span>
        <span style="font-family:var(--font-mono);font-size:10px;color:var(--ink-mute);flex-shrink:0;">${t.end_date ? fmtDateShort(t.end_date) : '—'}</span>
        <span class="btn btn-ghost" style="padding:2px 8px;font-size:11px;flex-shrink:0;">+ Add</span>
      </div>`;
    };
    const body = `
      <div style="margin-bottom:10px;font-size:12px;color:var(--ink-mute);">Semana de <strong>${weekRangeLabel(wk)}</strong> — escolha tarefas para comprometer.</div>
      <input id="commitPickSearch" class="form-input" placeholder="Buscar tarefa…" style="width:100%;margin-bottom:10px;font-size:12px;padding:6px 10px;">
      <div id="commitPickList" style="max-height:50vh;overflow-y:auto;border:1px solid var(--border);border-radius:4px;">
        ${candidates.length === 0 ? '<div style="padding:20px;text-align:center;color:var(--ink-mute);font-size:12px;">Nenhuma tarefa livre para comprometer.</div>' : candidates.map(rowHtml).join('')}
      </div>`;
    Modal.open({ title: 'Comprometer tarefas', body, footer: '<button class="btn btn-secondary" onclick="Modal.close()">Fechar</button>', cls: 'modal-wide' });
    setTimeout(() => {
      const search = document.getElementById('commitPickSearch');
      const list = document.getElementById('commitPickList');
      if (search && list) {
        search.oninput = () => {
          const q = search.value.toLowerCase();
          list.querySelectorAll('.commit-pick-row').forEach(row => {
            const t = State.tasks.find(x => x.id === row.dataset.pickId);
            const show = !q || (t && (((t.title || '').toLowerCase().includes(q)) || ((t.code || '').toLowerCase().includes(q))));
            row.style.display = show ? '' : 'none';
          });
        };
      }
      if (list) {
        list.onclick = async (e) => {
          const row = e.target.closest('.commit-pick-row');
          if (!row) return;
          await this.lpCommitTask(row.dataset.pickId, wk);
          row.remove();
        };
      }
    }, 30);
  },
});
