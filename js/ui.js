// UI: controlador principal das telas
import { $, $$, DEP_TYPE_FROM_PT, DEP_TYPE_PT, DateFilter, addDays, addWeeks, addWorkingDays, colorFromString, daysBetween, escapeHtml, fmtDateFull, fmtDateShort, forecastEndDate, initials, mondayOf, nextWorkday, physicalProgress, rolledProgress, snapTaskDates, today, workingDaysBetween } from './helpers.js';
import { renderCommentBody } from './mentions.js';
import { CPMCache, autoSchedule, dependencyCycle } from './cpm.js';
import { friendlyError, setLoading, toast } from './feedback.js';
import { APP_VERSION, CHANGELOG } from './changelog.js';
import { CONSTRAINT_TYPES, DELAY_CAUSES, PPC_CAUSES, RESTRICTION_STATUS, State, validateTaskStatusChange } from './state.js';
import { Config } from './auth.js';
import { _EAP_BUILTINS } from './eap-templates.js';
import { DB, setupRealtime } from './db.js';
import { Perf } from './perf.js';
import { HealthCheck } from './health.js';
import { Modal } from './modal.js';
import { MSPX } from './mspx.js';
import { Views } from './views.js';
import { KanbanConfig } from './kanban-config.js';
import { GanttCols } from './gantt-cols.js';
import { Automation } from './automation.js';
import { Dialog } from './dialog.js';
import { LegalDocs } from './legal-docs.js';

// ---------- UI CONTROLLER ----------
export const UI = {
  // PERF: render coalescente — várias chamadas em sequência viram UMA no próximo frame
  _renderPending: false,
  renderDebounced() {
    if (this._renderPending) return;
    this._renderPending = true;
    requestAnimationFrame(() => { this._renderPending = false; this.render(); });
  },

  async render() {
    Perf.start('UI.render');
    this.renderProjectSelect();
    this.renderUserBadge();
    const p = Views.current();
    $('#ganttBadge').textContent = State.tasks.length;
    $('#tasksBadge').textContent = State.tasks.filter(t => t.status !== 'concluido').length;
    // Totais informativos: sem badge visível — o número vai no tooltip do item
    const _navTip = (badgeId, label, text) => { const el = $('#' + badgeId); const it = el && el.closest('.nav-item'); if (it) it.title = `${label} · ${text}`; };
    _navTip('ganttBadge', 'Cronograma', `${State.tasks.length} tarefa${State.tasks.length !== 1 ? 's' : ''}`);
    _navTip('tasksBadge', 'Tarefas', `${$('#tasksBadge').textContent} em aberto`);
    // Botão de alertas na topbar — prioriza CRÍTICOS (bloqueadas + em atraso)
    (() => {
      const t2 = today();
      const tasks2 = State.tasks;
      const openTasks2 = tasks2.filter(tk => tk.status !== 'concluido');
      const critical =
        tasks2.filter(tk => tk.status === 'bloqueada').length +
        openTasks2.filter(tk => tk.end_date && tk.end_date < t2).length;
      const warning =
        State.restrictions.filter(r => r.due_date && r.due_date < t2 && r.status !== 'resolvida' && r.status !== 'cancelada').length +
        openTasks2.filter(tk => !tk.assignee_id && tk.status === 'em_andamento').length;
      const info =
        tasks2.filter(tk => tk.status === 'em_andamento' && (parseFloat(tk.progress)||0) === 0).length;
      const n = critical + warning + info;
      const btn = $('#btnAlerts');
      if (btn) {
        btn.style.display = n > 0 ? '' : 'none';
        const txt = $('#alertBtnText');
        // Destaca só os críticos em vermelho; demais ficam discretos
        if (critical > 0) {
          if (txt) txt.textContent = `${critical} crítico${critical !== 1 ? 's' : ''}`;
          btn.style.color = 'var(--accent-danger)';
          btn.style.borderColor = 'rgba(193,59,18,0.5)';
          btn.style.background = 'rgba(193,59,18,0.10)';
        } else {
          if (txt) txt.textContent = `${n} alerta${n !== 1 ? 's' : ''}`;
          btn.style.color = '';
          btn.style.borderColor = '';
          btn.style.background = '';
        }
        btn.title = `${critical} críticos · ${warning} atenção · ${info} info`;
        const dot = $('#alertDot');
        if (dot) dot.style.display = critical > 0 ? '' : 'none';
      }
    })();
    $('#teamBadge').textContent = State.members.length;
    $('#disciplinesBadge').textContent = State.disciplines.length;
    _navTip('teamBadge', 'Equipe', `${State.members.length} membro${State.members.length !== 1 ? 's' : ''}`);
    _navTip('disciplinesBadge', 'Disciplinas', `${State.disciplines.length} cadastrada${State.disciplines.length !== 1 ? 's' : ''}`);
    // Badge Setores — tarefas atrasadas com setor atribuído
    const _secBadge = $('#sectorsBadge');
    if (_secBadge) {
      const _td = today();
      const _secOverdue = State.tasks.filter(t => !t.inactive && t.status !== 'concluido' && t.sector && t.end_date && t.end_date < _td).length;
      _secBadge.textContent = _secOverdue > 9 ? '9+' : String(_secOverdue);
      _secBadge.style.display = _secOverdue > 0 ? '' : 'none';
    }
    const _restrOpen = State.restrictions.filter(r => r.status !== 'resolvida' && r.status !== 'cancelada').length;
    const _restrBadge = $('#restrictionsBadge');
    _restrBadge.textContent = _restrOpen > 9 ? '9+' : String(_restrOpen);
    _restrBadge.style.display = _restrOpen > 0 ? '' : 'none'; // só aparece quando há restrição aberta
    // Badge Saúde — conta erros + warnings (não conta infos)
    const _healthBadge = $('#healthBadge');
    if (_healthBadge && State.tasks.length > 0) {
      const _h = HealthCheck.run();
      const _n = _h.summary.errors + _h.summary.warnings;
      _healthBadge.textContent = _n > 9 ? '9+' : String(_n);
      _healthBadge.style.display = _n > 0 ? '' : 'none';
      // Cor do badge conforme severidade
      _healthBadge.style.background = _h.summary.errors > 0 ? 'var(--accent-danger)' : (_n > 0 ? 'var(--accent-warm)' : '');
    } else if (_healthBadge) {
      _healthBadge.style.display = 'none';
    }
    // Badge Last Planner — compromissos pendentes da semana atual
    const _lpBadge = $('#lastplannerBadge');
    if (_lpBadge) {
      const _wkNow = mondayOf(today());
      const _lpPend = (State.weeklyCommitments || []).filter(c => c.week_start === _wkNow && c.status === 'pendente').length;
      _lpBadge.textContent = _lpPend > 9 ? '9+' : String(_lpPend);
      _lpBadge.style.display = _lpPend > 0 ? '' : 'none';
    }
    // Badge "Pendências"
    const _allPending = State.allTasks.filter(t => t.status !== 'concluido').length;
    const _pendBadge = $('#pendenciasBadge');
    if (_pendBadge) { _pendBadge.textContent = _allPending > 99 ? '99+' : String(_allPending); _pendBadge.style.display = _allPending > 0 ? '' : 'none'; }

    // Project header (shown on project-scoped views)
    const _projectViews = ['dashboard','gantt','tasks','team','permissions','disciplines','restrictions','lastplanner','raci'];
    const _ph = $('#projectHeader');
    if (_ph) {
      if (p && _projectViews.includes(State.currentView)) {
        _ph.style.display = '';
        $('#projectHeaderName').textContent = p.name;
        const _prog = p ? Math.round(physicalProgress(State.tasks)) : 0;
        $('#projectHeaderMeta').textContent = `${p.client || 'Sem cliente'} · ${p.start_date ? fmtDateFull(p.start_date) + ' → ' + fmtDateFull(p.end_date) : 'Sem datas'} · ${_prog}% concluído`;
        // Status do projeto (pílula) — valores: planejamento, em_andamento, pausado, concluido
        const _stEl = $('#projectHeaderStatus');
        if (_stEl) {
          const _stMap = { planejamento: ['is-todo', 'Planejamento'], em_andamento: ['is-doing', 'Em andamento'], pausado: ['is-review', 'Pausado'], concluido: ['is-done', 'Concluído'] };
          const _st = _stMap[p.status];
          _stEl.className = 'pill ' + (_st ? _st[0] : 'is-todo');
          _stEl.textContent = _st ? _st[1] : String(p.status || '').replace(/_/g, ' ');
          _stEl.style.display = p.status ? '' : 'none';
        }
        // Equipe: até 4 avatares + contador
        const _teamEl = $('#projectHeaderTeam');
        if (_teamEl) {
          const _ms = (State.members || []).filter(m => m && m.name);
          _teamEl.innerHTML = _ms.slice(0, 4).map(m => `<span class="avatar-sm avatar-tip" data-tip="${escapeHtml(m.name)}" style="background:${colorFromString(m.name)};">${escapeHtml(initials(m.name))}</span>`).join('')
            + (_ms.length > 4 ? `<span class="avatar-sm is-more" title="${_ms.length - 4} membros a mais">+${_ms.length - 4}</span>` : '');
        }
      } else {
        _ph.style.display = 'none';
      }
    }

    // Oculta sidebar quando não há projeto selecionado (página de projetos)
    $('#app').classList.toggle('no-sidebar', !State.currentProjectId);

    const bcProj = $('#bcProject');
    bcProj.textContent = p ? p.name : '';
    // Mostra o separador "/" e o nome do projeto só quando há projeto
    const _bcSeps = document.querySelectorAll('.breadcrumb-sep');
    if (_bcSeps.length >= 1) _bcSeps[0].style.display = p ? '' : 'none';
    if (_bcSeps.length >= 2) _bcSeps[1].style.display = p ? '' : 'none';
    bcProj.title = '';
    bcProj.onclick = null;
    const viewLabels = {
      overview: 'Visão Geral',
      dashboard: 'Dashboard', gantt: 'Cronograma', tasks: 'Tarefas', team: 'Equipe',
      permissions: 'Permissões',
      disciplines: 'Disciplinas', restrictions: 'Restrições', lastplanner: 'Last Planner', raci: 'Matriz RACI',
      pendencias: 'Pendências',
      calendario: 'Calendário',
      relatorio: 'Relatórios', desembolso: 'Desembolso',
      projects: 'Projetos', notifications: 'Notificações', settings: 'Configurações'
    };
    const _bcView = $('#bcView');
    _bcView.textContent = p ? (viewLabels[State.currentView] || State.currentView) : '';
    _bcView.style.display = p ? '' : 'none';

    // Badge do sininho (menções + eventos realtime não lidos)
    const bellBadge = $('#topbarBellBadge');
    if (bellBadge) {
      const count = State.myMentions.length + State.realtimeUnread;
      if (count > 0) {
        bellBadge.style.display = 'flex';
        bellBadge.textContent = count > 9 ? '9+' : String(count);
      } else {
        bellBadge.style.display = 'none';
      }
    }

    // Nav "Permissões" só aparece para o dono do projeto
    const navPerm = $('#navPermissions');
    if (navPerm) {
      navPerm.style.display = DB.iAmOwner() ? '' : 'none';
    }

    const ctxMap = {
      overview: { label: 'Atualizar', action: () => UI.refreshOverview(), cta: false },
      // Criação de tarefa só dentro de Tarefas e Cronograma (usa o modal completo, com pai/predecessoras)
      tasks: { label: 'Nova Tarefa', action: () => UI.openTaskModal(), cta: true },
      gantt: { label: 'Nova Tarefa', action: () => UI.openTaskModal(), cta: true },
      team: { label: 'Convidar Membro', action: () => UI.openInviteMemberModal(State.currentProjectId), cta: true },
      permissions: { label: 'Convidar Membro', action: () => UI.openInviteMemberModal(State.currentProjectId), cta: true },
      disciplines: { label: 'Nova Disciplina', action: () => UI.openDisciplineModal(), cta: true },
      restrictions: { label: 'Nova Restrição', action: () => UI.openRestrictionModal(), cta: true },
      lastplanner: { label: 'Comprometer Tarefa', action: () => UI.openCommitPicker(), cta: true },
      raci: { label: 'Nova Tarefa', action: () => UI.openTaskModal(), cta: true },
      pendencias:  { label: 'Exportar CSV', action: () => UI.exportPendenciasCSV(), cta: false },
      calendario:  { label: 'Hoje', action: () => { State.calendarYear = new Date().getFullYear(); State.calendarMonth = new Date().getMonth(); UI.render(); }, cta: false },
      relatorio:   { label: 'Atualizar', action: () => UI.refreshOverview(true).then(() => UI.render()), cta: false },
      desembolso:  { label: 'Exportar CSV', action: () => Views.exportDesembolsoCSV(), cta: false },
      projects: { label: 'Novo Projeto', action: () => UI.openNewProjectModal(), cta: true },
      notifications: { label: 'Salvar Preferências', action: () => Views.saveNotifPrefs(), cta: true },
      settings: { label: 'Salvar', action: () => toast('Configurações salvas', 'success'), cta: true },
    };

    // Dashboard não tem ação de contexto (criação de tarefa fica em Tarefas/Cronograma)
    const _noCtxViews = new Set(['dashboard']);
    const ctxBtn = $('#btnContextAction');

    // Declarado aqui (não dentro do else) para estar sempre em escopo no banner abaixo
    const editingViews = ['disciplines', 'restrictions', 'raci'];
    const requiresEdit = editingViews.includes(State.currentView);

    if (_noCtxViews.has(State.currentView)) {
      ctxBtn.style.display = 'none';
    } else {
      const ctx = ctxMap[State.currentView] || { label: 'Atualizar', action: () => UI.render(), cta: false };
      $('#ctxActionLabel').textContent = ctx.label;
      ctxBtn.onclick = ctx.action;

      // Hierarquia: laranja (btn-cta) só para ações de CRIAÇÃO; utilitárias viram secundárias
      const _isCta = ctx.cta !== false;
      ctxBtn.classList.toggle('btn-cta', _isCta);
      ctxBtn.classList.toggle('btn-secondary', !_isCta);
      // Ícone "+" só faz sentido em ações de criação; utilitárias usam ícone de refresh
      const _ctxIcon = $('#ctxActionIcon');
      if (_ctxIcon) {
        if (_isCta) {
          _ctxIcon.innerHTML = '<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>';
        } else {
          _ctxIcon.innerHTML = '<polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>';
        }
      }

      // Visibilidade do botão de contexto conforme permissão
      const v = State.currentView;
      let showCtx = true;
      if (requiresEdit && !DB.iCanEdit()) showCtx = false;             // disciplinas/restrições/raci → editor+
      else if ((v === 'tasks' || v === 'gantt') && !DB.iCanEdit()) showCtx = false; // criar tarefa → editor+
      else if (v === 'team' && !DB.iAmOwner()) showCtx = false;        // gerir membros do projeto → só dono
      else if (v === 'projects') showCtx = false;                      // já coberto pelo botão global "Novo Projeto"
      ctxBtn.style.display = showCtx ? '' : 'none';
    }

    // Banner sutil quando o usuário não é admin/editor do projeto atual
    const banner = $('#roleBanner');
    if (banner) banner.remove();
    if (State.currentProjectId && !DB.iCanEdit() && requiresEdit) {
      const myRoleLabel = { commenter: 'comentarista', viewer: 'visualizador' }[State.myRole] || 'visualizador';
      const div = document.createElement('div');
      div.id = 'roleBanner';
      div.style.cssText = 'padding:8px 24px;background:rgba(212,168,44,0.08);border-bottom:1px solid var(--accent-warm);font-family:var(--font-mono);font-size:11px;color:var(--accent-warm);text-transform:uppercase;letter-spacing:0.1em;text-align:center;';
      div.innerHTML = `🔒 modo ${myRoleLabel} · só o admin ou um editor podem modificar este projeto`;
      $('#content').parentElement.insertBefore(div, $('#content'));
    }

    // Preserva a rolagem do Gantt entre re-renders (editar/inserir tarefa não volta ao topo)
    let _ganttScrollSave = null;
    const _gsPrev = document.getElementById('ganttScroll');
    if (_gsPrev) _ganttScrollSave = { left: _gsPrev.scrollLeft, top: _gsPrev.scrollTop };

    // Renderiza view preservando o loader
    const loader = $('#globalLoader');
    $('#content').innerHTML = '';
    $('#content').appendChild(loader);
    const viewDiv = document.createElement('div');
    Perf.measure('View.' + State.currentView, () => {
      viewDiv.innerHTML = Views[State.currentView] ? Views[State.currentView]() : `<div style="padding:40px;text-align:center;color:var(--ink-mute);">View "${State.currentView}" não encontrada</div>`;
    });
    while (viewDiv.firstChild) $('#content').appendChild(viewDiv.firstChild);

    // Restaura a rolagem do Gantt (se continuamos na mesma view com o mesmo gráfico)
    if (_ganttScrollSave) {
      const _gsNew = document.getElementById('ganttScroll');
      if (_gsNew) { _gsNew.scrollLeft = _ganttScrollSave.left; _gsNew.scrollTop = _ganttScrollSave.top; }
    }

    Perf.measure('bindViewEvents', () => this.bindViewEvents());
    Perf.end('UI.render');
  },

  renderProjectSelect() {
    const sel = $('#projectSelect');
    if (!State.projects.length) { sel.innerHTML = '<option>Nenhum projeto</option>'; return; }
    sel.innerHTML = State.projects.map(p =>
      `<option value="${p.id}" ${p.id === State.currentProjectId ? 'selected' : ''}>${escapeHtml(p.name)}</option>`
    ).join('');
  },

  renderUserBadge() {
    if (!State.user) return;
    const name = State.profile?.full_name || State.user.email;
    $('#userAvatar').textContent = initials(name);
    $('#userAvatar').style.background = `linear-gradient(135deg, ${colorFromString(name)}, ${colorFromString(State.user.email)})`;
    $('#userNameDisplay').textContent = name;
    // Indicador de novidades (a versão aparece apenas dentro de Novidades)
    let seen = null; try { seen = localStorage.getItem('projetudo.seenVersion'); } catch (e) {}
    const verDot = $('#verDot'); if (verDot) verDot.classList.toggle('show', seen !== APP_VERSION);
    const btnCl = $('#btnChangelog');
    if (btnCl && !btnCl._wired) { btnCl._wired = true; btnCl.onclick = () => UI.openChangelog(); }
    const btnAl = $('#btnAlerts');
    if (btnAl && !btnAl._wired) { btnAl._wired = true; btnAl.onclick = () => UI.openAlertsModal(); }
  },

  openAlertsModal() {
    const t = today();
    const tasks = State.tasks;
    const open = tasks.filter(tk => tk.status !== 'concluido');
    // Ícones SVG (substituem emojis para acabamento consistente)
    const ico = {
      lock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>',
      clock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>',
      doc: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>',
      user: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>',
      chart: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>',
    };
    // Cada grupo recebe uma severidade
    const groups = [
      { sev: 'critico',  icon: ico.lock,  label: 'Tarefas bloqueadas',          items: tasks.filter(tk => tk.status === 'bloqueada'),                             view: 'tasks', tip: 'bloqueada' },
      { sev: 'critico',  icon: ico.clock, label: 'Tarefas em atraso',           items: open.filter(tk => tk.end_date && tk.end_date < t),                         view: 'tasks', tip: '', overdue: true },
      { sev: 'atencao',  icon: ico.doc,   label: 'Restrições vencidas',         items: State.restrictions.filter(r => r.due_date && r.due_date < t && r.status !== 'resolvida' && r.status !== 'cancelada'), view: 'restrictions', tip: '' },
      { sev: 'atencao',  icon: ico.user,  label: 'Em andamento sem responsável', items: open.filter(tk => !tk.assignee_id && tk.status === 'em_andamento'),       view: 'tasks', tip: 'em_andamento' },
      { sev: 'info',     icon: ico.chart, label: 'Em andamento sem progresso',   items: tasks.filter(tk => tk.status === 'em_andamento' && (parseFloat(tk.progress)||0) === 0), view: 'tasks', tip: 'em_andamento' },
    ].filter(g => g.items.length > 0);
    const total = groups.reduce((s, g) => s + g.items.length, 0);
    const sevMeta = {
      critico: { label: 'Crítico',  color: 'var(--accent-danger)' },
      atencao: { label: 'Atenção',  color: 'var(--accent-warm)' },
      info:    { label: 'Informativo', color: 'var(--ink-mute)' },
    };
    const renderGroup = (g, color) => `
      <div style="border-left:3px solid ${color};padding:10px 14px;margin-bottom:8px;background:${color}0a;border-radius:0 4px 4px 0;cursor:pointer;"
           data-alert-view="${g.view}" data-alert-tip="${g.tip}" data-alert-overdue="${g.overdue ? '1' : ''}">
        <div style="display:flex;align-items:center;gap:8px;color:${color};">
          ${g.icon}
          <span style="font-size:13px;font-weight:700;color:var(--ink);">${g.items.length} ${g.label}</span>
        </div>
        <div style="font-size:11px;color:var(--ink-mute);margin-top:4px;margin-left:22px;">
          ${g.items.slice(0, 4).map(i => escapeHtml((i.title || i.description || '').slice(0, 32))).join(' · ')}${g.items.length > 4 ? ` + ${g.items.length - 4} mais` : ''}
        </div>
      </div>`;
    const body = groups.length === 0
      ? `<div style="text-align:center;padding:32px;color:var(--ink-mute);">Nenhum alerta no projeto atual. 🎉</div>`
      : ['critico', 'atencao', 'info'].map(sev => {
          const sevGroups = groups.filter(g => g.sev === sev);
          if (sevGroups.length === 0) return '';
          const m = sevMeta[sev];
          const cnt = sevGroups.reduce((s, g) => s + g.items.length, 0);
          return `
            <div style="margin-bottom:14px;">
              <div style="display:flex;align-items:center;gap:8px;margin-bottom:7px;">
                <span style="width:8px;height:8px;border-radius:50%;background:${m.color};"></span>
                <span style="font-family:var(--font-mono);font-size:10px;font-weight:800;text-transform:uppercase;letter-spacing:.1em;color:${m.color};">${m.label}</span>
                <span style="font-family:var(--font-mono);font-size:10px;color:var(--ink-mute);">${cnt}</span>
                <div style="flex:1;height:1px;background:var(--border);"></div>
              </div>
              ${sevGroups.map(g => renderGroup(g, m.color)).join('')}
            </div>`;
        }).join('');
    Modal.open({
      title: `${total} Alerta${total !== 1 ? 's' : ''} do Projeto`,
      body,
      footer: `<button class="btn btn-secondary" id="btnCloseAlerts">Fechar</button>`
    });
    $('#btnCloseAlerts').onclick = () => Modal.close();
    $('#modal').querySelectorAll('[data-alert-view]').forEach(el => {
      el.onclick = () => {
        Modal.close();
        State.currentView = el.dataset.alertView;
        UI.setActiveNav(el.dataset.alertView);
        if (el.dataset.alertOverdue === '1') {
          State.taskFilters.overdue = true;
          State.taskFilters.status = 'all';
        } else if (el.dataset.alertTip) {
          State.taskFilters.overdue = false;
          State.taskFilters.status = el.dataset.alertTip;
        }
        UI.render();
      };
    });
  },

  openChangelog() {
    const body = `<div style="max-height:64vh;overflow:auto;padding-right:4px;">
      ${CHANGELOG.map((c, i) => `
        <div style="margin-bottom:20px;${i > 0 ? 'padding-top:16px;border-top:1px solid var(--border);' : ''}">
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;flex-wrap:wrap;">
            <span style="font-family:var(--font-mono);font-weight:800;font-size:15px;color:var(--accent);">v${c.version}</span>
            ${i === 0 ? '<span style="font-family:var(--font-mono);font-size:9px;background:var(--accent);color:var(--bg-deep);padding:1px 7px;border-radius:10px;font-weight:700;letter-spacing:.05em;">ATUAL</span>' : ''}
            <span style="font-family:var(--font-mono);font-size:11px;color:var(--ink-mute);">${escapeHtml(c.date)}</span>
            <span style="font-size:13px;font-weight:600;color:var(--ink);">${escapeHtml(c.title)}</span>
          </div>
          <div style="display:flex;flex-direction:column;gap:4px;">
            ${c.items.map(it => `<div style="display:flex;gap:8px;font-size:13px;color:var(--ink-soft);line-height:1.4;"><span style="color:var(--accent);flex-shrink:0;">▸</span><span>${escapeHtml(it)}</span></div>`).join('')}
          </div>
        </div>`).join('')}
    </div>`;
    Modal.open({
      title: '✦ Novidades · CadêOProjeto',
      cls: 'modal-wide',
      body,
      footer: `<button type="button" class="btn btn-secondary" onclick="Modal.close()">Fechar</button>`
    });
    try { localStorage.setItem('projetudo.seenVersion', APP_VERSION); } catch (e) {}
    $('#verDot')?.classList.remove('show');
  },

  bindViewEvents() {
    // Salvar nome (view Settings)
    const _btnSaveName = $('#btnSaveName');
    if (_btnSaveName) {
      _btnSaveName.onclick = async () => {
        const name = $('#settingsNameInput').value.trim();
        if (!name) { toast('Digite um nome', 'error'); return; }
        _btnSaveName.disabled = true;
        try {
          // Atualiza tabela profiles
          const { error: pErr } = await State.supabase
            .from('profiles').update({ full_name: name }).eq('id', State.user.id);
          if (pErr) throw pErr;
          // Atualiza metadado auth
          await State.supabase.auth.updateUser({ data: { full_name: name } });
          State.profile = { ...State.profile, full_name: name };
          this.renderUserBadge();
          toast('Nome atualizado com sucesso', 'success');
        } catch (err) {
          toast('Erro ao salvar nome: ' + err.message, 'error');
        } finally { _btnSaveName.disabled = false; }
      };
    }

    // Filtros de análise no sidebar de Relatórios — scroll até a seção correspondente
    $$('.rpt-nav-item[data-anchor]').forEach(item => {
      item.onclick = () => {
        const target = document.getElementById(item.dataset.anchor);
        if (target) {
          target.scrollIntoView({ behavior: 'smooth', block: 'start' });
          // Atualiza estado ativo
          $$('.rpt-nav-item').forEach(n => n.classList.remove('active'));
          item.classList.add('active');
        }
      };
    });

    // Observa interseção para sincronizar o nav ativo com o scroll
    if (document.querySelector('.rpt-nav-item[data-anchor]')) {
      const _rptSections = ['rpt-overview','rpt-status','rpt-priority','rpt-member','rpt-project']
        .map(id => document.getElementById(id)).filter(Boolean);
      const _rptObserver = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
          if (entry.isIntersecting) {
            const anchor = entry.target.id;
            $$('.rpt-nav-item').forEach(n => {
              n.classList.toggle('active', n.dataset.anchor === anchor);
            });
          }
        });
      }, { root: $('#content'), rootMargin: '-10% 0px -60% 0px', threshold: 0 });
      _rptSections.forEach(s => _rptObserver.observe(s));
    }

    $$('.zoom-btn').forEach(b => {
      if (b.dataset.zoom)        b.onclick = () => { State.ganttZoom = b.dataset.zoom; UI.render(); };
      if (b.dataset.levelFilter) b.onclick = () => { State.ganttLevelFilter = b.dataset.levelFilter; UI.render(); };
    });
    const _lvlSel = $('#ganttLevelSel');
    if (_lvlSel) _lvlSel.onchange = (e) => { State.ganttLevelFilter = e.target.value; UI.render(); };
    // Filtros rápidos por situação (selo) — clicar no chip ativo limpa o filtro.
    $$('[data-sit-filter]').forEach(b => {
      b.onclick = () => {
        const v = b.dataset.sitFilter;
        State.ganttSituacaoFilter = (State.ganttSituacaoFilter === v || v === 'all') ? 'all' : v;
        UI.render();
      };
    });
    $$('[data-sit-basis]').forEach(b => {
      b.onclick = () => { State.situacaoBasis = b.dataset.sitBasis === 'planned' ? 'planned' : 'baseline'; UI.render(); };
    });
    const _tglC = $('#ganttToggleChart');
    if (_tglC) _tglC.onclick = () => { State.ganttChartVisible = !State.ganttChartVisible; UI.render(); };
    const _tglAuto = $('#ganttAutoRecalcToggle');
    if (_tglAuto) _tglAuto.querySelector('input').onchange = (e) => {
      State.ganttAutoRecalc = !!e.target.checked;
      try { localStorage.setItem('projetudo_gantt_auto_recalc', State.ganttAutoRecalc ? '1' : '0'); } catch (err) {}
      // Se ligou o auto e há mudanças pendentes, recalcula já.
      if (State.ganttAutoRecalc && State._scheduleDirty) UI.scheduleAutoRecalc();
      else UI.render();
    };
    const _tglW = $('#ganttToggleWidth');
    if (_tglW) _tglW.onclick = () => { State.ganttFullWidth = !State.ganttFullWidth; UI.render(); };
    const _todayBtn = $('#btnGanttToday');
    if (_todayBtn) _todayBtn.onclick = () => {
      const gs = $('#ganttScroll');
      if (!gs) return;
      const todayCell = gs.querySelector('.gantt-header-cell.today, .gantt-cell.today-line');
      if (todayCell) {
        const offset = todayCell.offsetLeft - (gs.clientWidth / 2) + (todayCell.offsetWidth / 2);
        gs.scrollTo({ left: Math.max(0, offset), behavior: 'smooth' });
      }
    };
    // Projetos — duplo-clique no card abre o projeto (seleciona + Dashboard)
    $$('[data-project-card]').forEach(card => {
      card.addEventListener('dblclick', (e) => {
        if (e.target.closest('button')) return; // não interfere nos botões de ação
        const pid = card.dataset.id;
        if (pid && pid !== State.currentProjectId) {
          UI.switchProject(pid); // switchProject já leva ao Dashboard
        } else if (pid) {
          State.currentView = 'dashboard'; UI.setActiveNav('dashboard'); UI.render();
        }
      });
    });

    // Disciplinas — duplo clique no card abre lista de tarefas editável
    $$('.discipline-card[data-discipline-id]').forEach(card => {
      card.addEventListener('dblclick', (e) => {
        if (e.target.closest('button')) return;
        UI.openDisciplineTasksModal(card.dataset.disciplineId);
      });
    });

    // Setores — duplo clique no card/linha abre lista de tarefas editável
    $$('.sector-card[data-sector-name]').forEach(card => {
      card.addEventListener('dblclick', (e) => {
        if (e.target.closest('button')) return;
        UI.openSectorTasksModal(card.dataset.sectorName);
      });
    });

    // Menu unificado de ferramentas do Gantt
    const _toolBtn = document.getElementById('btnGanttTools');
    const _toolMenu = document.getElementById('ganttToolsMenu');
    if (_toolBtn && _toolMenu) {
      _toolBtn.onclick = (e) => { e.stopPropagation(); const open = _toolMenu.style.display !== 'none'; _toolMenu.style.display = open ? 'none' : 'block'; };
      document.addEventListener('click', function _closeTools(e) { if (!document.getElementById('ganttToolsWrap')?.contains(e.target)) { if(_toolMenu) _toolMenu.style.display='none'; } }, { capture: true, once: false });
    }
    // Colapsar/expandir tarefa pai no Gantt
    $$('.gantt-collapse-btn').forEach(btn => {
      btn.onclick = (e) => {
        e.stopPropagation();
        const tid = btn.dataset.collapseId;
        if (State.ganttCollapsed.has(tid)) State.ganttCollapsed.delete(tid);
        else State.ganttCollapsed.add(tid);
        UI.render();
      };
    });
    this.bindGanttDrag();
    this.bindKanbanDrag();
    this.bindRestrictionKanbanDrag();

    // Redimensionar colunas do Gantt arrastando a borda direita do cabeçalho
    $$('.gantt-col-resize').forEach(h => {
      h.addEventListener('mousedown', (e) => {
        e.preventDefault(); e.stopPropagation();
        const colId = h.dataset.colResize;
        const cols = GanttCols.cols();
        const minW = (GanttCols.REGISTRY.find(c => c.id === colId)?.min) || 28;
        const startX = e.clientX;
        const startW = GanttCols.widthOf(colId);
        const headerLeft = document.querySelector('.gantt-header-left');
        const rowLefts = document.querySelectorAll('.gantt-row-left');
        document.body.classList.add('gantt-col-resizing');
        const widthAt = (id, w) => (id === colId ? w : GanttCols.widthOf(id));
        const apply = (w) => {
          const tmpl = cols.map(c => widthAt(c.id, w) + 'px').join(' ');
          const total = cols.reduce((s, c) => s + widthAt(c.id, w), 0);
          if (headerLeft) { headerLeft.style.gridTemplateColumns = tmpl; headerLeft.style.width = total + 'px'; }
          rowLefts.forEach(r => { r.style.gridTemplateColumns = tmpl; r.style.width = total + 'px'; });
        };
        const onMove = (ev) => apply(Math.max(minW, startW + (ev.clientX - startX)));
        const onUp = (ev) => {
          document.removeEventListener('mousemove', onMove);
          document.removeEventListener('mouseup', onUp);
          document.body.classList.remove('gantt-col-resizing');
          GanttCols.setWidth(colId, Math.max(minW, startW + (ev.clientX - startX)));
          UI.render();
        };
        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
      });
    });

    // Reordenar colunas: arrastar o cabeçalho (exceto "#" e "Descrição", que ficam fixas)
    let _dragColId = null;
    $$('.gantt-col-head.gantt-col-draggable').forEach(head => {
      head.addEventListener('dragstart', (e) => {
        if (e.target.closest('.gantt-col-resize')) { e.preventDefault(); return; } // pegar o handle = redimensionar
        _dragColId = head.dataset.colId;
        head.classList.add('dragging');
        try { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', _dragColId); } catch (_) {}
      });
      head.addEventListener('dragend', () => {
        head.classList.remove('dragging');
        $$('.gantt-col-head').forEach(h => h.classList.remove('col-drop-target'));
        _dragColId = null;
      });
      head.addEventListener('dragover', (e) => {
        if (!_dragColId || head.dataset.colId === _dragColId) return;
        e.preventDefault();
        try { e.dataTransfer.dropEffect = 'move'; } catch (_) {}
        $$('.gantt-col-head').forEach(h => h.classList.remove('col-drop-target'));
        head.classList.add('col-drop-target');
      });
      head.addEventListener('dragleave', () => head.classList.remove('col-drop-target'));
      head.addEventListener('drop', (e) => {
        e.preventDefault();
        const target = head.dataset.colId;
        if (_dragColId && target && _dragColId !== target) { GanttCols.reorder(_dragColId, target); UI.render(); }
      });
    });

    $$('.gantt-bar').forEach(bar => bar.addEventListener('dblclick', () => this.openTaskModal(bar.dataset.taskId)));
    $$('.task-card').forEach(card => card.addEventListener('dblclick', () => this.openTaskModal(card.dataset.taskId)));

    // Interação do painel esquerdo do Gantt:
    //  • 1 clique numa célula editável (título, setor, duração, datas, % concl.) → edição inline
    //  • 2 cliques em qualquer célula → abre a tarefa (modal)
    //  • "Ir para a tarefa" e criar acima/abaixo → menu do botão direito
    // O timeout distingue clique simples (edita) de duplo (abre) sem disparar os dois.
    $$('.gantt-row-left[data-task-id]').forEach(left => {
      const taskId = left.dataset.taskId;
      let _ct = null;
      left.addEventListener('click', (e) => {
        if (e.target.closest('.gantt-collapse-btn')) return;
        if (e.target.closest('input,select,textarea')) return; // já editando
        const cell = e.target.closest('[data-field]');
        clearTimeout(_ct);
        if (!cell || !cell.dataset.field) return; // célula não editável → nada no clique simples
        _ct = setTimeout(() => {
          const field = cell.dataset.field;
          if (field === 'title') {
            const nameSpan = cell.querySelector('.gantt-task-name');
            this.startGanttInlineEdit(nameSpan || cell, taskId, 'title');
          } else {
            this.startGanttInlineEdit(cell, taskId, field);
          }
        }, 220);
      });
      left.addEventListener('dblclick', (e) => {
        if (e.target.closest('.gantt-collapse-btn')) return;
        if (e.target.closest('input,select,textarea')) return;
        clearTimeout(_ct); // cancela a edição pendente do 1º clique
        this.openTaskModal(taskId);
      });
    });

    // Colunas congeladas — agora via position:sticky (CSS); sem JS de translateX.
    const _gs = document.getElementById('ganttScroll');
    if (_gs) {
      // PAN — arrastar o gráfico com o botão do meio do mouse (scroll pressionado)
      _gs.addEventListener('mousedown', (e) => {
        if (e.button !== 1) return; // apenas botão do meio
        e.preventDefault();
        const pan = { x: e.clientX, y: e.clientY, sl: _gs.scrollLeft, st: _gs.scrollTop };
        _gs.style.cursor = 'grabbing';
        const move = (ev) => {
          _gs.scrollLeft = pan.sl - (ev.clientX - pan.x);
          _gs.scrollTop  = pan.st - (ev.clientY - pan.y);
        };
        const up = () => {
          _gs.style.cursor = '';
          document.removeEventListener('mousemove', move);
          document.removeEventListener('mouseup', up);
        };
        document.addEventListener('mousemove', move);
        document.addEventListener('mouseup', up);
      });
      // Evita o autoscroll/menu nativo do botão do meio
      _gs.addEventListener('auxclick', (e) => { if (e.button === 1) e.preventDefault(); });

      // Menu de contexto (clique direito) sobre uma tarefa → criar acima/abaixo/subtarefa
      _gs.addEventListener('contextmenu', (e) => {
        const el = e.target.closest('[data-task-id]');
        if (!el) return;
        e.preventDefault();
        UI.showGanttContextMenu(e.clientX, e.clientY, el.dataset.taskId);
      });

    }

    // Delegação para [data-action]
    $('#content').onclick = (e) => {
      // Handler de correção 1-clique de issues da Saúde do Projeto
      const hcBtn = e.target.closest('[data-hc-action]');
      if (hcBtn) {
        const issueId = hcBtn.dataset.hcAction;
        const h = HealthCheck.run();
        const issue = h.issues.find(i => i.id === issueId);
        if (issue) {
          (async () => {
            try {
              const mutated = await HealthCheck.applyAction(issue);
              if (mutated) { toast('Correção aplicada', 'success'); await UI.render(); }
            } catch (err) { toast(friendlyError(err), 'error'); }
          })();
        }
        return;
      }
      const btn = e.target.closest('[data-action]');
      if (!btn) return;
      const a = btn.dataset.action, id = btn.dataset.id;
      // Ações originais
      if (a === 'new-project') this.openNewProjectModal();
      if (a === 'new-task') this.openTaskModal();
      if (a === 'edit-team-member') this.openTeamMemberModal(id);
      if (a === 'remove-allocation-member') this.removeAllocationByMemberId(id);
      if (a === 'open-allocate-member') this.openInviteMemberModal(State.currentProjectId);
      if (a === 'invite-member') this.openInviteMemberModal(btn.dataset.project || State.currentProjectId);
      if (a === 'convert-legacy-members') this.convertLegacyMembers();
      if (a === 'switch-project') this.switchProject(id);
      if (a === 'edit-project') this.openProjectEditModal(id);
      if (a === 'duplicate-project') this.duplicateProject(id);
      if (a === 'delete-project') this.confirmDeleteProject(id);
      if (a === 'reset-config') {
        (async () => {
          if (await Dialog.confirm({ title: 'Desconectar', msg: 'Desconectar do Supabase? Você precisará inserir as credenciais novamente.', confirmText: 'Desconectar', danger: true })) {
            Config.reset(); location.reload();
          }
        })();
      }
      if (a === 'export-data') this.exportData();
      if (a === 'import-data') this.importData();
      // Feriados
      if (a === 'add-holiday') { this.addHoliday(); return; }
      if (a === 'remove-holiday') { this.removeHoliday(btn.dataset.id); return; }
      if (a === 'export-pendencias') this.exportPendenciasCSV();
      if (a === 'print-pendencias')     this.printPendencias();
      if (a === 'toggle-pend-collapse') this.toggleAllPendencias();
      if (a === 'print-restrictions')   this.printRestrictions();
      if (a === 'print-executive') this.printExecutive();
      if (a === 'print-tasks')  this.printTasks();
      if (a === 'print-gantt')  this.printGantt();
      if (a === 'print-raci')   this.printRaci();
      if (a === 'print-deps')   this.printDeps();
      if (a === 'desembolso-csv') Views.exportDesembolsoCSV();
      if (a === 'desembolso-print') this.printDesembolso();
      if (a === 'desembolso-open') Views.openDesembolsoModal();
      if (a === 'print-scurve') this.printSCurve();
      if (a === 'delete-account') this.confirmDeleteAccount();
      if (a === 'open-privacy-modal') LegalDocs.openPrivacy();
      if (a === 'open-terms-modal') LegalDocs.openTerms();
      // Novas ações de engenharia
      if (a === 'new-discipline') this.openDisciplineModal();
      if (a === 'edit-discipline') this.openDisciplineModal(id);
      if (a === 'link-disciplines') this.openDisciplineLinker();
      if (a === 'import-disciplines') this.openImportFromObraModal('disciplines');
      if (a === 'import-sectors') this.openImportFromObraModal('sectors');
      if (a === 'manage-sectors') this.openSectorsModal();
      if (a === 'delete-discipline') this.deleteDiscipline(id);
      if (a === 'goto-disciplines') { State.currentView = 'disciplines'; this.setActiveNav('disciplines'); this.render(); }
      if (a === 'goto-restrictions') { State.currentView = 'restrictions'; this.setActiveNav('restrictions'); this.render(); }
      if (a === 'goto-tasks') { State.currentView = 'tasks'; this.setActiveNav('tasks'); this.render(); }
      if (a === 'goto-health') { State.currentView = 'health'; this.setActiveNav('health'); this.render(); }
      if (a === 'new-restriction') this.openRestrictionModal();
      if (a === 'edit-restriction') this.openRestrictionModal(id);
      if (a === 'open-restriction') this.openRestrictionModal(btn.dataset.id || (btn.closest('[data-id]')?.dataset.id));
      if (a === 'delete-restriction') this.deleteRestriction(id);
      // Last Planner
      if (a === 'lp-prev-week')  { State.lpWeekStart = addWeeks(State.lpWeekStart || mondayOf(today()), -1); UI.render(); }
      if (a === 'lp-next-week')  { State.lpWeekStart = addWeeks(State.lpWeekStart || mondayOf(today()), 1); UI.render(); }
      if (a === 'lp-this-week')  { State.lpWeekStart = mondayOf(today()); UI.render(); }
      if (a === 'lp-goto-week')  { State.lpWeekStart = btn.dataset.week; UI.render(); }
      if (a === 'lp-commit')     this.lpCommitTask(btn.dataset.id, btn.dataset.week);
      if (a === 'lp-uncommit')   this.lpUncommit(id);
      if (a === 'lp-mark')       this.lpMark(id, btn.dataset.status);
      if (a === 'toggle-raci') this.openRaciCellMenu(btn.dataset.task, btn.dataset.member);
      if (a === 'auto-schedule') this.runAutoSchedule();
      if (a === 'set-baseline') this.setBaseline();
      if (a === 'edit-baseline') this.openBaselineEditor();
      if (a === 'baseline-history') this.openBaselineHistory();
      if (a === 'show-violations') this.showViolations();
      if (a === 'create-demo') this.createDemoProject();
      if (a === 'task-mode') { State.taskViewMode = btn.dataset.mode; UI.render(); }
      if (a === 'toggle-task-group') {
        // Alterna só o DOM (sem re-render completo) e guarda a escolha do usuário
        const sec = btn.closest('.tgroup');
        if (sec) {
          const nowCollapsed = sec.classList.toggle('is-collapsed');
          btn.setAttribute('aria-expanded', nowCollapsed ? 'false' : 'true');
          State.collapsedTaskGroups.set(btn.dataset.key, nowCollapsed);
        }
      }
      if (a === 'kanban-load-more') {
        const from = parseInt(btn.dataset.from) || 0;
        const listEl = btn.closest('.kanban-list') || btn.closest('[data-group-key]');
        const key = btn.dataset.colStatus || btn.dataset.groupKey;
        const allTasks = (Views._kanbanColCache || {})[key] || [];
        Views._kanbanLoadMore(listEl, allTasks, from);
        return;
      }
      if (a === 'clear-task-filters') { State.taskFilters = { search: '', status: 'all', priority: 'all', assignee: 'all', discipline: 'all', label: 'all', sector: 'all', overdue: false }; State.dateFilters.tasks = { from: '', to: '', preset: 'all' }; UI.render(); }
      if (a === 'edit-task') this.openTaskModal(id);
      if (a === 'edit-team-member') this.openTeamMemberModal(id);
      if (a === 'delete-team-member') this.deleteTeamMember(id);
      if (a === 'new-label') this.openLabelModal();
      if (a === 'edit-label') this.openLabelModal(id);
      if (a === 'delete-label') this.deleteLabel(id);
      if (a === 'share-project') this.openShareModal(id);
      if (a === 'refresh-overview') this.refreshOverview();
      if (a === 'overview-toggle-mine') { State.overviewMine = !State.overviewMine; this.render(); }
      if (a === 'perm-remove-share') this.removeShare(id);
      if (a === 'perm-remove-alloc') this.removeAllocation(id);
      if (a === 'gantt-columns') this.openGanttColumnsModal();
      if (a === 'export-mspx') this.exportMSProjectXML();
      if (a === 'import-mspx') this.importMSProjectXML();
      if (a === 'fix-mspx-types') this.fixMSPXLegacyDepTypes();
      if (a === 'import-csv')      this.importTasksCSV();
      if (a === 'import-prevision') this.importPrevisionXLSX();
      if (a === 'eap-templates')   this.openEapTemplatesModal();
      if (a === 'export-gantt-csv') this.exportGanttCSV();
      if (a === 'export-gantt-png') this.exportGanttPNG();
      // Calendário
      if (a === 'cal-prev') {
        State.calendarMonth--;
        if (State.calendarMonth < 0) { State.calendarMonth = 11; State.calendarYear--; }
        UI.render();
      }
      if (a === 'cal-next') {
        State.calendarMonth++;
        if (State.calendarMonth > 11) { State.calendarMonth = 0; State.calendarYear++; }
        UI.render();
      }
      if (a === 'cal-today') {
        State.calendarYear = new Date().getFullYear();
        State.calendarMonth = new Date().getMonth();
        UI.render();
      }
      if (a === 'cal-day') { this.openCalendarDay(btn.dataset.date); }
      // Relatório
      if (a === 'relatorio-scope') {
        State.relatorioScope = btn.dataset.scope;
        if (btn.dataset.scope === 'all' && !UI._overviewLoadedAt) {
          UI.refreshOverview(true).then(() => UI.render());
        } else {
          UI.render();
        }
      }
      // Kanban config
      if (a === 'open-kanban-config') UI.openKanbanConfigModal();
    };

    // Filtros (deliverables, raci, approvals)
    const fltD = $('#fltDiscipline');
    if (fltD) fltD.onchange = (e) => { State.filterDiscipline = e.target.value; UI.render(); };
    const fltS = $('#fltStatus');
    if (fltS) fltS.onchange = (e) => { State.filterStatus = e.target.value; UI.render(); };
    const fltA = $('#fltApprover');
    if (fltA) fltA.onchange = (e) => { State.filterApprover = e.target.value; UI.render(); };
    const fltAS = $('#fltApprovalStatus');
    if (fltAS) fltAS.onchange = (e) => { State.filterApprovalStatus = e.target.value; UI.render(); };
    const fltOV = $('#overviewFilter');
    if (fltOV) fltOV.onchange = (e) => { State.overviewFilter = e.target.value; UI.render(); };
    const fltOVSector = $('#overviewSectorFilter');
    if (fltOVSector) fltOVSector.onchange = (e) => { State.overviewSectorFilter = e.target.value; UI.render(); };
    $$('[data-ov-status]').forEach(b => {
      b.onclick = () => {
        const v = b.dataset.ovStatus;
        if (State.overviewStatusFilter.has(v)) State.overviewStatusFilter.delete(v);
        else State.overviewStatusFilter.add(v);
        UI.render();
      };
    });
    const fltPend = $('#pendenciasFilter');
    if (fltPend) fltPend.onchange = (e) => { State.pendenciasFilter = e.target.value; UI.render(); };
    const fltPendSector = $('#pendenciasSector');
    if (fltPendSector) fltPendSector.onchange = (e) => { State.pendenciasSector = e.target.value; UI.render(); };
    $$('[data-pend-status]').forEach(b => {
      b.onclick = () => {
        const v = b.dataset.pendStatus;
        if (State.pendenciasStatusFilter.has(v)) State.pendenciasStatusFilter.delete(v);
        else State.pendenciasStatusFilter.add(v);
        UI.render();
      };
    });
    const fltPendLabel = $('#pendenciasLabel');
    if (fltPendLabel) fltPendLabel.onchange = (e) => { State.pendenciasLabel = e.target.value; UI.render(); };
    const fltLpSector = $('#lpSectorFilter');
    if (fltLpSector) fltLpSector.onchange = (e) => { State.lpSectorFilter = e.target.value; UI.render(); };
    const fltLpProject = $('#lpProjectFilter');
    if (fltLpProject) fltLpProject.onchange = async (e) => {
      State.lpProjectFilter = e.target.value;
      // Garante que as tarefas de TODOS os projetos estão carregadas (evita "falta obra").
      if (e.target.value === 'all') { try { await UI.refreshOverview(true); } catch (_) {} }
      UI.render();
    };
    const fltLpResp = $('#lpResponsibleFilter');
    if (fltLpResp) fltLpResp.onchange = (e) => { State.lpResponsibleFilter = e.target.value; UI.render(); };
    const fltLpDateMode = $('#lpDateMode');
    if (fltLpDateMode) fltLpDateMode.onchange = (e) => { State.lpDateMode = e.target.value; UI.render(); };

    // Desembolso — chevrons para colapsar/expandir tarefas do mês
    $$('.desembolso-chevron').forEach(ch => {
      ch.onclick = (e) => {
        e.stopPropagation();
        const k = ch.dataset.month;
        const rows = document.querySelectorAll(`.desembolso-task-row[data-month="${k}"]`);
        const isOpen = ch.style.transform === 'rotate(90deg)';
        ch.style.transform = isOpen ? '' : 'rotate(90deg)';
        rows.forEach(r => r.style.display = isOpen ? 'none' : '');
      };
    });

    // Selects de mudar papel na view Permissões
    $$('[data-action="perm-change-role"]').forEach(sel => {
      sel.onchange = (e) => UI.changeShareRole(sel.dataset.shareId, e.target.value);
    });
    $$('[data-action="perm-change-alloc-role"]').forEach(sel => {
      sel.onchange = async (e) => {
        try {
          await DB.updateAllocation(sel.dataset.allocId, e.target.value);
          const a = State.allocations.find(x => x.id === sel.dataset.allocId);
          if (a) a.role = e.target.value;
          const labels = { viewer: 'Visualizador', commenter: 'Comentarista', editor: 'Editor', admin: 'Administrador' };
          toast('Permissão alterada para "' + labels[e.target.value] + '"', 'success');
        } catch (err) { toast(friendlyError(err), 'error'); }
      };
    });

    // === BINDS DA VIEW DE TAREFAS (filtros, agrupamento, sort, toggle modo) ===
    const tSearch = $('#taskSearch');
    if (tSearch) {
      tSearch.oninput = (e) => { State.taskFilters.search = e.target.value; UI.render(); };
      // Manter foco no campo após re-render
      if (State.currentView === 'tasks' && State.taskFilters.search) {
        tSearch.focus();
        tSearch.setSelectionRange(tSearch.value.length, tSearch.value.length);
      }
    }
    const tFltStatus = $('#taskFltStatus');
    if (tFltStatus) tFltStatus.onchange = (e) => { State.taskFilters.status = e.target.value; UI.render(); };
    const tFltOverdue = $('#taskFltOverdue');
    if (tFltOverdue) tFltOverdue.onclick = () => { State.taskFilters.overdue = !State.taskFilters.overdue; UI.render(); };
    const tFltPriority = $('#taskFltPriority');
    if (tFltPriority) tFltPriority.onchange = (e) => { State.taskFilters.priority = e.target.value; UI.render(); };
    const tFltAssignee = $('#taskFltAssignee');
    if (tFltAssignee) tFltAssignee.onchange = (e) => { State.taskFilters.assignee = e.target.value; UI.render(); };
    const tFltDisc = $('#taskFltDiscipline');
    if (tFltDisc) tFltDisc.onchange = (e) => { State.taskFilters.discipline = e.target.value; UI.render(); };
    const tFltLabel = $('#taskFltLabel');
    if (tFltLabel) tFltLabel.onchange = (e) => { State.taskFilters.label = e.target.value; UI.render(); };
    const tFltSector = $('#taskFltSector');
    if (tFltSector) tFltSector.onchange = (e) => { State.taskFilters.sector = e.target.value; UI.render(); };
    const tGroupBy = $('#taskGroupBy');
    if (tGroupBy) tGroupBy.onchange = (e) => { State.taskGroupBy = e.target.value; UI.render(); };

    // Last Planner — seletor de causa de não-cumprimento
    $$('.lp-cause-sel').forEach(sel => {
      sel.onchange = (e) => { e.stopPropagation(); UI.lpSetCause(sel.dataset.id, sel.value); };
    });

    // Configurações → Automações (Tier 1)
    $$('.auto-toggle').forEach(el => {
      el.onchange = () => { State.automation[el.dataset.autoKey] = el.checked; Automation.save(); UI.render(); };
    });
    $$('.auto-num').forEach(el => {
      const apply = () => { const v = Math.max(0, Math.min(365, parseInt(el.value) || 0)); State.automation[el.dataset.autoKey] = v; Automation.save(); UI.render(); };
      el.onchange = apply; el.onblur = apply;
    });

    // Painéis colapsáveis — persiste estado (aberto/fechado) entre re-renders
    $$('details[data-panel]').forEach(d => {
      d.addEventListener('toggle', () => {
        const key = d.dataset.panel;
        if (d.open) State.collapsedPanels.delete(key);
        else State.collapsedPanels.add(key);
      });
    });

    // Sort por click no header da tabela
    $$('th[data-sort]').forEach(th => {
      th.onclick = () => {
        const col = th.dataset.sort;
        if (State.taskSortCol === col) {
          State.taskSortDir = State.taskSortDir === 'asc' ? 'desc' : 'asc';
        } else {
          State.taskSortCol = col;
          State.taskSortDir = 'asc';
        }
        UI.render();
      };
    });
  },

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

  bindKanbanDrag() {
    $$('.task-card[data-task-id]').forEach(card => {
      card.addEventListener('dragstart', (e) => { card.classList.add('dragging'); e.dataTransfer.setData('text/plain', card.dataset.taskId); });
      card.addEventListener('dragend', () => card.classList.remove('dragging'));
    });
    $$('.kanban-list[data-status]').forEach(list => {
      list.addEventListener('dragover', (e) => { e.preventDefault(); list.classList.add('drag-over'); });
      list.addEventListener('dragleave', () => list.classList.remove('drag-over'));
      list.addEventListener('drop', async (e) => {
        e.preventDefault(); list.classList.remove('drag-over');
        const taskId = e.dataTransfer.getData('text/plain');
        const newStatus = list.dataset.status;
        const task = State.tasks.find(t => t.id === taskId);
        if (task && task.status !== newStatus) {
          const _v = validateTaskStatusChange(task, newStatus);
          if (!_v.ok) { toast(_v.message, 'error'); return; }
          const patch = { status: newStatus };
          if (newStatus === 'concluido' && task.progress < 100) patch.progress = 100;
          if (newStatus === 'em_andamento' && task.progress === 0) patch.progress = 10;
          try {
            setLoading(true);
            const _before = { ...task };
            await DB.updateTask(task.id, patch);
            Object.assign(task, patch);
            await Automation.applyOnTaskUpdate(task.id, patch, _before);
            await UI.render();
            toast('Tarefa movida', 'success');
          } catch (err) { toast(friendlyError(err), 'error'); }
          finally { setLoading(false); }
        }
      });
    });
  },

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

  // ===== FILTRO POR INTERVALO DE DATAS (término) =====
  setDateFilter(ns, field, value) {
    const df = State.dateFilters[ns] || { from: '', to: '', preset: 'all' };
    df[field] = value || '';
    df.preset = 'custom'; // editar uma data manualmente vira "Personalizado"
    State.dateFilters[ns] = df;
    UI.render();
  },
  applyDatePreset(ns, preset) {
    // Preserva o "mode" (que terminam/que acontecem) — é preferência de exibição,
    // não deve resetar quando o usuário só troca o intervalo de datas.
    const curMode = (State.dateFilters[ns] || {}).mode;
    if (preset === 'all') {
      State.dateFilters[ns] = { from: '', to: '', preset: 'all', mode: curMode };
    } else if (preset === 'custom') {
      // Mantém as datas atuais, só habilita os campos para edição manual
      const cur = State.dateFilters[ns] || { from: '', to: '' };
      State.dateFilters[ns] = { from: cur.from || '', to: cur.to || '', preset: 'custom', mode: curMode };
    } else {
      State.dateFilters[ns] = { ...DateFilter.resolve(preset), preset, mode: curMode };
    }
    UI.render();
  },
  clearDateFilter(ns) {
    const curMode = (State.dateFilters[ns] || {}).mode;
    State.dateFilters[ns] = { from: '', to: '', preset: 'all', mode: curMode };
    UI.render();
  },
  setDateFilterMode(ns, mode) {
    const df = State.dateFilters[ns] || { from: '', to: '', preset: 'all' };
    df.mode = mode === 'occurring' ? 'occurring' : 'ending';
    State.dateFilters[ns] = df;
    UI.render();
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

  // ===== BASELINE =====
  // ─── Histórico de linhas de base (até 4) — persistido no Supabase ─────
  loadBaselineHistory() {
    return State.baselineHistory || [];
  },
  async saveBaselineHistory(h) {
    const current = State.baselineHistory || [];
    for (const snapshot of h) {
      const old = current.find(b => b.slot === snapshot.slot);
      if (old !== snapshot) await DB.saveBaseline(State.currentProjectId, snapshot);
    }
    for (const old of current) {
      if (!h.some(b => b.slot === old.slot)) await DB.deleteBaseline(State.currentProjectId, old.slot);
    }
    State.baselineHistory = h;
  },

  // ===== EDITOR DE LINHA DE BASE (somente admin) =====
  // Ajuste fino da linha de base tarefa a tarefa, além da captura automática.
  openBaselineEditor() {
    if (!DB.iAmAdmin()) { toast('Apenas o admin/dono pode ajustar a linha de base', 'error'); return; }
    if (!State.currentProjectId) { toast('Abra um projeto primeiro', 'error'); return; }
    // Só tarefas-folha (a linha de base dos pais é derivada das filhas)
    const leaves = State.tasks
      .filter(t => !State.tasks.some(x => x.parent_id === t.id))
      .sort((a, b) => String(a.code || '').localeCompare(String(b.code || ''), 'pt-BR', { numeric: true }));

    const rowFor = (t) => `<tr data-bl-id="${t.id}">
      <td style="padding:6px 8px;border-bottom:1px solid var(--border);font-family:var(--font-mono);font-size:11px;color:var(--accent);white-space:nowrap;">${escapeHtml(t.code || '—')}</td>
      <td style="padding:6px 8px;border-bottom:1px solid var(--border);font-size:12px;max-width:240px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${escapeHtml(t.title)}">${escapeHtml(t.title)}</td>
      <td style="padding:6px 8px;border-bottom:1px solid var(--border);font-family:var(--font-mono);font-size:10px;color:var(--ink-mute);white-space:nowrap;">${fmtDateShort(t.start_date)} → ${fmtDateShort(t.end_date)}</td>
      <td style="padding:6px 8px;border-bottom:1px solid var(--border);"><input type="date" class="form-input bl-start" value="${t.baseline_start || ''}" style="font-size:11px;padding:3px 5px;width:130px;"></td>
      <td style="padding:6px 8px;border-bottom:1px solid var(--border);"><input type="date" class="form-input bl-end" value="${t.baseline_end || ''}" style="font-size:11px;padding:3px 5px;width:130px;"></td>
    </tr>`;

    Modal.open({
      title: '✎ Ajustar Linha de Base · ' + (leaves.length) + ' tarefas',
      cls: 'modal-extrawide',
      body: `
        <div style="font-size:12px;color:var(--ink-soft);margin-bottom:10px;">
          Edite a <strong>linha de base</strong> (planejamento congelado de referência) tarefa a tarefa. A coluna cinza mostra o planejamento <em>atual</em> para comparação. Vazio = sem linha de base para a tarefa.
        </div>
        <div style="display:flex;gap:8px;margin-bottom:12px;flex-wrap:wrap;">
          <button class="btn btn-secondary" id="blCopyPlanned" style="font-size:11px;">↤ Copiar do planejamento atual</button>
          <button class="btn btn-ghost" id="blClearAll" style="font-size:11px;color:var(--accent-danger);">Limpar todas</button>
        </div>
        <div style="max-height:52vh;overflow:auto;border:1px solid var(--border);border-radius:3px;">
          <table style="width:100%;border-collapse:collapse;">
            <thead><tr style="position:sticky;top:0;background:var(--bg-elevated);z-index:1;">
              ${['Cód','Tarefa','Planejado atual','Ini LB','Ter LB'].map(h => `<th style="text-align:left;padding:7px 8px;font-family:var(--font-mono);font-size:10px;color:var(--ink-mute);text-transform:uppercase;letter-spacing:.08em;border-bottom:1px solid var(--border);">${h}</th>`).join('')}
            </tr></thead>
            <tbody id="blRows">${leaves.map(rowFor).join('')}</tbody>
          </table>
        </div>`,
      footer: `<button class="btn btn-secondary" id="blCancel">Cancelar</button>
               <button class="btn btn-cta" id="blSave">Salvar linha de base</button>`
    });

    const _leafById = new Map(leaves.map(t => [t.id, t]));
    $('#blCopyPlanned').onclick = () => {
      $('#blRows').querySelectorAll('tr[data-bl-id]').forEach(tr => {
        const t = _leafById.get(tr.dataset.blId);
        if (!t) return;
        tr.querySelector('.bl-start').value = t.start_date || '';
        tr.querySelector('.bl-end').value = t.end_date || '';
      });
      toast('Preenchido com o planejamento atual — clique em Salvar para gravar', 'info');
    };
    $('#blClearAll').onclick = async () => {
      if (!await Dialog.confirm({ title: 'Limpar linha de base', msg: 'Apagar a linha de base de TODAS as tarefas?', confirmText: 'Limpar', danger: true })) return;
      $('#blRows').querySelectorAll('.bl-start, .bl-end').forEach(i => { i.value = ''; });
    };
    $('#blCancel').onclick = () => Modal.close();
    $('#blSave').onclick = async () => {
      // Coleta só as linhas que mudaram em relação ao valor atual da tarefa
      const updates = [];
      $('#blRows').querySelectorAll('tr[data-bl-id]').forEach(tr => {
        const t = _leafById.get(tr.dataset.blId); if (!t) return;
        const bs = tr.querySelector('.bl-start').value || null;
        const be = tr.querySelector('.bl-end').value || null;
        if (bs && be && be < bs) return; // ignora intervalo inválido (avisa abaixo)
        if ((t.baseline_start || null) !== bs || (t.baseline_end || null) !== be) updates.push({ t, bs, be });
      });
      // Validação de intervalos
      const invalid = [...$('#blRows').querySelectorAll('tr[data-bl-id]')].some(tr => {
        const bs = tr.querySelector('.bl-start').value, be = tr.querySelector('.bl-end').value;
        return bs && be && be < bs;
      });
      if (invalid) { toast('Há término de LB antes do início — corrija antes de salvar', 'error'); return; }
      if (updates.length === 0) { toast('Nada para salvar', 'info'); Modal.close(); return; }
      try {
        setLoading(true);
        const now = new Date().toISOString();
        let ok = 0;
        for (const { t, bs, be } of updates) {
          try {
            await DB.updateTask(t.id, { baseline_start: bs, baseline_end: be, baseline_set_at: now });
            t.baseline_start = bs; t.baseline_end = be; t.baseline_set_at = now; ok++;
          } catch (e) { console.warn('[baseline-edit] falha em', t.code, e.message); }
        }
        Modal.close();
        await UI.render();
        toast(`Linha de base ajustada em ${ok} tarefa${ok !== 1 ? 's' : ''}`, 'success');
      } catch (err) { toast(friendlyError(err), 'error'); }
      finally { setLoading(false); }
    };
  },

  async setBaseline() {
    const history = this.loadBaselineHistory();
    const hasAny = history.length > 0 || State.tasks.some(t => t.baseline_start);
    const n = Math.min(history.length + 1, 4);

    // Modal de escolha do slot
    Modal.open({
      title: 'Salvar Linha de Base',
      body: `
        <div style="font-size:13px;color:var(--ink-soft);margin-bottom:14px;">
          Selecione o slot onde salvar. Existente será sobrescrito. Histórico de até <strong>4 linhas de base</strong> por projeto.
        </div>
        <div id="blSlotList" style="display:flex;flex-direction:column;gap:8px;">
          ${[1,2,3,4].map(i => {
            const existing = history.find(b => b.slot === i);
            return `<label style="display:flex;align-items:center;gap:10px;padding:10px 12px;border:1px solid var(--border);border-radius:3px;cursor:pointer;background:var(--bg-deep);">
              <input type="radio" name="blSlot" value="${i}" ${i === n ? 'checked' : ''} style="accent-color:var(--accent);">
              <span style="flex:1;">
                <span style="font-family:var(--font-mono);font-size:12px;font-weight:700;color:var(--accent);">LB ${i}</span>
                ${existing ? `<span style="font-family:var(--font-mono);font-size:10px;color:var(--ink-mute);margin-left:8px;">salva em ${new Date(existing.set_at).toLocaleDateString('pt-BR')} · ${Object.keys(existing.tasks).length} tarefas</span>`
                  : `<span style="font-size:11px;color:var(--ink-mute);margin-left:8px;">— vazio</span>`}
              </span>
            </label>`;
          }).join('')}
        </div>`,
      footer: `<button class="btn btn-secondary" id="btnCancelBL">Cancelar</button>
               <button class="btn btn-cta" id="btnConfirmBL">Salvar linha de base</button>`
    });
    $('#btnCancelBL').onclick = () => Modal.close();
    $('#btnConfirmBL').onclick = async () => {
      const slot = parseInt($('#blSlotList input[name="blSlot"]:checked')?.value || '1');
      Modal.close();
      try {
        setLoading(true);
        let count = 0, errors = 0, lastErr = null;
        const now = new Date().toISOString();
        // 1) Salva no DB (colunas baseline_start/end — sempre BL1 ativo para o Gantt)
        if (slot === 1) {
          try {
            // 1 único upsert com baseline_start/end/set_at (mesmas colunas p/ todas)
            await DB.updateTasksBatch(State.tasks.map(t => ({
              id: t.id, baseline_start: t.start_date, baseline_end: t.end_date, baseline_set_at: now
            })));
            State.tasks.forEach(t => { t.baseline_start = t.start_date; t.baseline_end = t.end_date; t.baseline_set_at = now; });
            count = State.tasks.length;
          } catch (e) { errors = State.tasks.length; lastErr = e; }
        } else {
          // Outros slots preservam as colunas da LB1 nas tarefas
          count = State.tasks.length;
        }
        if (errors) throw lastErr || new Error('Falha ao salvar a linha de base no banco.');
        // 2) Salva snapshot no histórico persistido
        const snap = { slot, set_at: now, tasks: {} };
        State.tasks.forEach(t => { snap.tasks[t.id] = { start: t.start_date, end: t.end_date, code: t.code || '', title: t.title }; });
        const newHistory = history.filter(b => b.slot !== slot);
        newHistory.push(snap);
        newHistory.sort((a, b) => a.slot - b.slot);
        await this.saveBaselineHistory(newHistory);
        await UI.render();
        toast(`Linha de base LB${slot} salva · ${count} tarefa${count !== 1 ? 's' : ''}`, 'success');
      } catch (err) { toast(friendlyError(err), 'error'); }
      finally { setLoading(false); }
    };
  },

  // Abre modal de visualização e comparação do histórico de baselines
  openBaselineHistory() {
    const history = this.loadBaselineHistory();
    if (!history.length && !State.tasks.some(t => t.baseline_start)) {
      toast('Nenhuma linha de base salva ainda.', 'warning'); return;
    }
    const allSlots = [...history];
    // Garante que BL1 do DB também apareça se existir e não estiver no histórico
    if (State.tasks.some(t => t.baseline_start) && !allSlots.find(b => b.slot === 1)) {
      const snap = { slot: 1, set_at: State.tasks.find(t => t.baseline_set_at)?.baseline_set_at || '', tasks: {} };
      State.tasks.forEach(t => { if (t.baseline_start) snap.tasks[t.id] = { start: t.baseline_start, end: t.baseline_end, code: t.code || '', title: t.title }; });
      allSlots.unshift(snap);
    }
    allSlots.sort((a, b) => a.slot - b.slot);
    const blColors = ['var(--blueprint)', 'var(--accent-warm)', 'var(--accent-success)', 'var(--accent-violet)'];
    const rows = allSlots.map(b => {
      const d = b.set_at ? new Date(b.set_at).toLocaleString('pt-BR') : '—';
      const cnt = Object.keys(b.tasks).length;
      return `<div style="display:flex;align-items:center;gap:12px;padding:10px 14px;border-bottom:1px solid var(--border);">
        <span style="font-family:var(--font-mono);font-size:13px;font-weight:700;color:${blColors[b.slot - 1]};min-width:40px;">LB${b.slot}</span>
        <div style="flex:1;">
          <div style="font-size:13px;font-weight:500;">${cnt} tarefa${cnt !== 1 ? 's' : ''} congeladas</div>
          <div style="font-family:var(--font-mono);font-size:10px;color:var(--ink-mute);">Salva em ${d}</div>
        </div>
        <button class="btn btn-ghost" data-delete-bl="${b.slot}" style="font-size:11px;color:var(--accent-danger);">Excluir</button>
      </div>`;
    }).join('');
    Modal.open({
      title: 'Histórico de Linhas de Base',
      cls: 'modal-wide',
      body: `<div style="border:1px solid var(--border);border-radius:3px;overflow:hidden;">${rows || '<div style="padding:24px;text-align:center;color:var(--ink-mute);">Nenhuma linha de base.</div>'}</div>
             <div style="font-size:11px;color:var(--ink-mute);margin-top:8px;">O Gantt exibe a barra fantasma da <strong>LB1</strong>. As demais ficam no histórico. Ao salvar uma nova LB1, o histórico rotaciona.</div>`,
      footer: `<button class="btn btn-secondary" id="btnCloseBLH">Fechar</button>
               ${allSlots.length > 0 ? `<button class="btn btn-cta" id="btnCompareBL">Comparar Baselines</button>` : ''}`
    });
    $('#btnCloseBLH').onclick = () => Modal.close();
    const _btnCmp = $('#btnCompareBL');
    if (_btnCmp) _btnCmp.onclick = () => { Modal.close(); State.currentView = 'baselineCompare'; UI.setActiveNav(''); UI.render(); };
    $('#modal').querySelectorAll('[data-delete-bl]').forEach(btn => {
      btn.onclick = async () => {
        const slot = parseInt(btn.dataset.deleteBl);
        const updated = this.loadBaselineHistory().filter(b => b.slot !== slot);
        try {
          await this.saveBaselineHistory(updated);
          if (slot === 1) {
            await DB.updateTasksBatch(State.tasks.map(t => ({ id: t.id, baseline_start: null, baseline_end: null, baseline_set_at: null })));
            State.tasks.forEach(t => { t.baseline_start = null; t.baseline_end = null; t.baseline_set_at = null; });
          }
          await UI.render();
          this.openBaselineHistory();
        } catch (e) { toast(friendlyError(e), 'error'); }
      };
    });
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

  // ===== EXPORT MS PROJECT XML =====
  exportMSProjectXML() {
    if (State.tasks.length === 0) { toast('Sem tarefas para exportar', 'error'); return; }
    const project = Views.current();
    const xml = MSPX.serialize(project, State.tasks, State.dependencies, State.members);
    const blob = new Blob([xml], { type: 'application/xml' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    const safeName = (project?.name || 'projeto').replace(/[^a-z0-9]/gi, '_');
    link.href = url;
    link.download = `${safeName}.xml`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast(`Exportado ${State.tasks.length} ${State.tasks.length === 1 ? 'tarefa' : 'tarefas'} em XML`, 'success');
  },

  // ===== IMPORT TAREFAS VIA CSV =====
  importTasksCSV() {
    if (!State.currentProjectId) { toast('Selecione um projeto primeiro', 'error'); return; }
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.csv,text/csv,text/plain';
    input.onchange = async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const text = await file.text();

      // ── Parse CSV ──────────────────────────────────────────────────────────
      const lines = text.split(/\r?\n/).filter(l => l.trim());
      if (lines.length < 2) { toast('CSV vazio ou sem linhas de dados', 'error'); return; }

      // Detect separator (, or ; or \t)
      const sep = lines[0].includes(';') ? ';' : lines[0].includes('\t') ? '\t' : ',';
      const parseRow = (line) => {
        const cells = []; let cur = '', inQ = false;
        for (let i = 0; i < line.length; i++) {
          const c = line[i];
          if (c === '"' && !inQ) { inQ = true; }
          else if (c === '"' && inQ && line[i+1] === '"') { cur += '"'; i++; }
          else if (c === '"' && inQ) { inQ = false; }
          else if (c === sep && !inQ) { cells.push(cur.trim()); cur = ''; }
          else { cur += c; }
        }
        cells.push(cur.trim());
        return cells;
      };

      const headers = parseRow(lines[0]).map(h => h.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9_]/g, '_'));
      const rows = lines.slice(1).map(l => {
        const cells = parseRow(l);
        const obj = {};
        headers.forEach((h, i) => { obj[h] = (cells[i] || '').trim(); });
        return obj;
      }).filter(r => Object.values(r).some(v => v));  // skip blank rows

      if (!rows.length) { toast('Nenhuma linha de dados encontrada', 'error'); return; }

      // ── Map column names (pt or en) ────────────────────────────────────────
      const col = (row, ...aliases) => {
        for (const a of aliases) { if (row[a] !== undefined) return row[a] || ''; }
        return '';
      };

      // ── Helper: match member by name (fuzzy) ───────────────────────────────
      const matchMember = (name) => {
        if (!name) return null;
        const q = name.toLowerCase().trim();
        return State.members.find(m => m.name.toLowerCase().includes(q) || q.includes(m.name.toLowerCase().split(' ')[0].toLowerCase())) || null;
      };

      // ── Helper: match discipline by code or name ───────────────────────────
      const matchDisc = (val) => {
        if (!val) return null;
        const q = val.toLowerCase().trim();
        return State.disciplines.find(d =>
          d.code.toLowerCase() === q || d.name.toLowerCase().includes(q) || q.includes(d.code.toLowerCase())
        ) || null;
      };

      // ── Normalize priority ─────────────────────────────────────────────────
      const normPrio = (v) => {
        if (!v) return 'media';
        const lv = v.toLowerCase().trim();
        if (lv.includes('alta') || lv.includes('high') || lv.includes('critica') || lv === 'a') return 'alta';
        if (lv.includes('baixa') || lv.includes('low') || lv === 'b') return 'baixa';
        return 'media';
      };

      // ── Build preview rows ─────────────────────────────────────────────────
      const parsed = rows.map((row, i) => {
        const title = col(row, 'titulo', 'title', 'tarefa', 'task', 'nome', 'name', 'descricao', 'description');
        const start = col(row, 'inicio', 'start', 'start_date', 'data_inicio', 'data_de_inicio');
        const end   = col(row, 'fim', 'termino', 'end', 'end_date', 'data_fim', 'prazo', 'deadline', 'data_termino');
        const assignee = col(row, 'responsavel', 'assignee', 'responsável', 'assigned_to', 'membro');
        const disc  = col(row, 'disciplina', 'discipline', 'disc', 'area');
        const prio  = col(row, 'prioridade', 'priority', 'prior');
        const member = matchMember(assignee);
        const discipline = matchDisc(disc);

        // Parse dates — support dd/mm/yyyy, yyyy-mm-dd, dd-mm-yyyy
        const parseDate = (s) => {
          if (!s) return null;
          if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
          const m = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
          if (m) return `${m[3]}-${m[2].padStart(2,'0')}-${m[1].padStart(2,'0')}`;
          return null;
        };

        return {
          _row: i + 2,
          title,
          start_date: parseDate(start),
          end_date:   parseDate(end),
          assignee_id: member?.id || null,
          discipline_id: discipline?.id || null,
          priority: normPrio(prio),
          _assigneeName: member?.name || (assignee || null),
          _discName: discipline?.code || (disc || null),
          _valid: !!title,
          _warn: !member && assignee ? `Responsável "${assignee}" não encontrado` : '',
        };
      });

      const valid = parsed.filter(r => r._valid);
      const invalid = parsed.filter(r => !r._valid);

      // ── Preview modal ──────────────────────────────────────────────────────
      const prioLabel = { critica: '⚡ Crítica', alta: '🔴 Alta', media: '🟡 Média', baixa: '🟢 Baixa' };
      Modal.open({
        title: `Importar ${valid.length} tarefa${valid.length !== 1 ? 's' : ''} do CSV`,
        cls: 'modal-wide',
        body: `
          <div style="font-family:var(--font-mono);font-size:10px;color:var(--ink-mute);margin-bottom:10px;">
            ${valid.length} linha${valid.length!==1?'s':''} válida${valid.length!==1?'s':''} · ${invalid.length} ignorada${invalid.length!==1?'s':''} (sem título) · Separador: "${sep === '\t' ? 'TAB' : sep}"
          </div>
          <div style="max-height:400px;overflow-y:auto;">
            <table style="width:100%;border-collapse:collapse;font-size:11px;">
              <thead><tr style="background:var(--bg-elevated);">
                <th style="padding:6px 8px;text-align:left;font-family:var(--font-mono);font-size:9px;color:var(--ink-mute);border-bottom:1px solid var(--border);">Título</th>
                <th style="padding:6px 8px;text-align:left;font-family:var(--font-mono);font-size:9px;color:var(--ink-mute);border-bottom:1px solid var(--border);">Início</th>
                <th style="padding:6px 8px;text-align:left;font-family:var(--font-mono);font-size:9px;color:var(--ink-mute);border-bottom:1px solid var(--border);">Fim</th>
                <th style="padding:6px 8px;text-align:left;font-family:var(--font-mono);font-size:9px;color:var(--ink-mute);border-bottom:1px solid var(--border);">Responsável</th>
                <th style="padding:6px 8px;text-align:left;font-family:var(--font-mono);font-size:9px;color:var(--ink-mute);border-bottom:1px solid var(--border);">Disc.</th>
                <th style="padding:6px 8px;text-align:left;font-family:var(--font-mono);font-size:9px;color:var(--ink-mute);border-bottom:1px solid var(--border);">Prior.</th>
              </tr></thead>
              <tbody>
              ${valid.map((r, i) => `
                <tr style="border-bottom:1px solid var(--border);${i%2===0?'background:var(--bg-deep);':''}${r._warn?'border-left:2px solid var(--accent-warm);':''}">
                  <td style="padding:5px 8px;font-weight:600;">${escapeHtml(r.title)}</td>
                  <td style="padding:5px 8px;font-family:var(--font-mono);font-size:10px;">${r.start_date || '<span style="color:var(--ink-mute)">—</span>'}</td>
                  <td style="padding:5px 8px;font-family:var(--font-mono);font-size:10px;">${r.end_date   || '<span style="color:var(--ink-mute)">—</span>'}</td>
                  <td style="padding:5px 8px;color:${r.assignee_id ? 'var(--ink)' : 'var(--accent-warn)'};font-size:10px;">${escapeHtml(r._assigneeName || '—')}</td>
                  <td style="padding:5px 8px;font-family:var(--font-mono);font-size:10px;color:var(--ink-mute);">${escapeHtml(r._discName || '—')}</td>
                  <td style="padding:5px 8px;font-size:10px;">${prioLabel[r.priority]}</td>
                </tr>
                ${r._warn ? `<tr style="${i%2===0?'background:var(--bg-deep);':''}"><td colspan="6" style="padding:2px 8px 5px;font-size:10px;color:var(--accent-warm);font-family:var(--font-mono);">⚠ ${escapeHtml(r._warn)}</td></tr>` : ''}
              `).join('')}
              </tbody>
            </table>
          </div>
          <div style="margin-top:10px;font-family:var(--font-mono);font-size:9px;color:var(--ink-mute);line-height:1.6;">
            Colunas aceitas: <strong>titulo, inicio, fim, responsavel, disciplina, prioridade</strong> (ou equivalentes em inglês)<br>
            Formatos de data: <strong>dd/mm/aaaa</strong> ou <strong>aaaa-mm-dd</strong>
          </div>
        `,
        footer: `
          <button class="btn btn-secondary" id="btnCancelCsvImport">Cancelar</button>
          <button class="btn btn-cta" id="btnConfirmCsvImport" ${valid.length===0?'disabled':''}>
            Importar ${valid.length} tarefa${valid.length!==1?'s':''}
          </button>
        `
      });

      $('#btnCancelCsvImport').onclick = () => Modal.close();
      $('#btnConfirmCsvImport').onclick = async () => {
        const btn = $('#btnConfirmCsvImport');
        btn.disabled = true; btn.textContent = 'Importando...';
        try {
          setLoading(true);
          let ok = 0, fail = 0;
          for (const row of valid) {
            try {
              const payload = {
                title: row.title,
                status: 'a_fazer',
                priority: row.priority,
                progress: 0,
              };
              if (row.start_date)    payload.start_date    = row.start_date;
              if (row.end_date)      payload.end_date      = row.end_date;
              if (row.assignee_id)   payload.assignee_id   = row.assignee_id;
              if (row.discipline_id) payload.discipline_id = row.discipline_id;
              await DB.createTask(State.currentProjectId, payload);
              ok++;
            } catch (e) { fail++; console.warn('Falha ao criar tarefa:', e.message); }
          }
          await DB.loadCurrentProject();
          Modal.close();
          await UI.render();
          toast(`✓ ${ok} tarefa${ok!==1?'s':''} importada${ok!==1?'s':''}${fail>0?' · '+fail+' falha(s)':''}`, ok > 0 ? 'success' : 'error');
        } catch (err) {
          toast('Erro na importação: ' + err.message, 'error');
        } finally { setLoading(false); }
      };
    };
    input.click();
  },

  // ===== EAP TEMPLATES =====

  // Calcula códigos EAP a partir de uma lista plana com {level}
  _eapCodes(items) {
    const ctr = [0,0,0,0];
    return items.map(it => {
      const lv = (it.level || 1) - 1;
      ctr[lv]++;
      for (let i = lv+1; i < 4; i++) ctr[i] = 0;
      return ctr.slice(0, lv+1).join('.');
    });
  },

  // Determina o parent_id (dentro dos itens do template) de cada item
  _eapParents(items) {
    const stack = []; // stack[level-1] = item mais recente daquele nível
    return items.map(it => {
      const lv = it.level || 1;
      const parent = lv > 1 ? (stack[lv-2] || null) : null;
      stack[lv-1] = it;
      for (let i = lv; i < 4; i++) stack[i] = null;
      return parent;
    });
  },

  openEapTemplatesModal() {
    if (!State.currentProjectId) { toast('Selecione um projeto primeiro', 'error'); return; }

    const allTemplates = () => [..._EAP_BUILTINS, ...(State.eapTemplates || [])];

    const renderList = () => {
      const tpls = allTemplates();
      const listEl = document.getElementById('_eapList');
      if (!listEl) return;
      if (tpls.length === 0) {
        listEl.innerHTML = '<div style="color:var(--ink-mute);font-size:13px;padding:24px;text-align:center;">Nenhum template salvo. Crie um ou use os modelos integrados.</div>';
        return;
      }
      listEl.innerHTML = tpls.map(t => {
        const codes = this._eapCodes(t.items || []);
        const lvl1  = (t.items || []).filter(x => x.level === 1).length;
        const total = (t.items || []).length;
        const badge = t._builtin
          ? `<span style="font-size:10px;padding:2px 6px;background:rgba(124,58,237,0.15);color:#7C3AED;border-radius:10px;font-family:var(--font-mono);">integrado</span>`
          : `<span style="font-size:10px;padding:2px 6px;background:rgba(229,75,26,0.15);color:var(--accent);border-radius:10px;font-family:var(--font-mono);">customizado</span>`;
        const sectorIco = { civil:'🏗', software:'💻', evento:'🎉', generic:'📋' }[t.sector] || '📋';
        return `
          <div style="display:flex;align-items:center;gap:10px;padding:10px 12px;background:var(--bg-card);border:1px solid var(--border);border-radius:4px;margin-bottom:6px;">
            <span style="font-size:22px;">${sectorIco}</span>
            <div style="flex:1;min-width:0;">
              <div style="font-weight:600;font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escapeHtml(t.name)} ${badge}</div>
              ${t.description ? `<div style="font-size:11px;color:var(--ink-mute);margin-top:1px;">${escapeHtml(t.description)}</div>` : ''}
              <div style="font-size:10px;color:var(--ink-mute);font-family:var(--font-mono);margin-top:3px;">${lvl1} grupos · ${total} tarefas</div>
            </div>
            <div style="display:flex;gap:6px;flex-shrink:0;">
              <button class="btn btn-secondary" style="padding:4px 10px;font-size:11px;" onclick="window._eapPreview('${t.id}')">👁 Ver</button>
              <button class="btn btn-secondary" style="padding:4px 10px;font-size:11px;" onclick="window._eapEdit('${t.id}')">✏️</button>
              <button class="btn btn-primary"   style="padding:4px 10px;font-size:11px;" onclick="window._eapApplyStart('${t.id}')">▶ Aplicar</button>
              ${!t._builtin ? `<button class="btn" style="padding:4px 8px;font-size:11px;background:none;border:1px solid var(--border);color:var(--accent-danger);" onclick="window._eapDelete('${t.id}')">🗑</button>` : ''}
            </div>
          </div>`;
      }).join('');
    };

    Modal.open({
      title: '📋 Templates de EAP',
      body: `
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px;">
          <div style="font-size:12px;color:var(--ink-mute);">Estruturas hierárquicas prontas para aplicar ao projeto</div>
          <button class="btn btn-primary" style="padding:5px 13px;font-size:12px;" onclick="window._eapNewTemplate()">+ Novo template</button>
        </div>
        <div id="_eapList" style="max-height:420px;overflow-y:auto;"></div>`,
      cls: 'modal-wide',
    });

    renderList();

    window._eapDelete = async (id) => {
      if (!await Dialog.confirm({ title: 'Excluir template?', message: 'Esta ação não pode ser desfeita.', confirmText: 'Excluir', danger: true })) return;
      setLoading(true);
      try {
        await DB.deleteEapTemplate(id);
        State.eapTemplates = State.eapTemplates.filter(t => t.id !== id);
        toast('Template excluído', 'success');
        renderList();
      } catch (e) { toast(friendlyError(e), 'error'); }
      finally { setLoading(false); }
    };

    window._eapPreview = (id) => {
      const t = allTemplates().find(x => x.id === id);
      if (!t) return;
      const codes = this._eapCodes(t.items || []);
      const rows = (t.items || []).map((it, i) => {
        const indent = (it.level - 1) * 20;
        const isParent = (t.items || []).some(c => c.level === it.level + 1 && i < (t.items||[]).length - 1);
        return `<div style="display:flex;align-items:center;gap:8px;padding:4px 0;border-bottom:1px solid var(--border);">
          <span style="font-family:var(--font-mono);font-size:10px;color:var(--ink-mute);min-width:36px;">${codes[i]}</span>
          <span style="padding-left:${indent}px;font-size:12px;${it.level===1?'font-weight:700;text-transform:uppercase;':''}flex:1;">${escapeHtml(it.title)}</span>
          <span style="font-family:var(--font-mono);font-size:10px;color:var(--ink-mute);flex-shrink:0;">${it.duration_days ? it.duration_days+'d' : '—'}</span>
        </div>`;
      }).join('');
      Modal.open({
        title: `👁 ${escapeHtml(t.name)}`,
        body: `<div style="max-height:420px;overflow-y:auto;font-size:12px;">${rows}</div>`,
        footer: `<button class="btn btn-secondary" onclick="Modal.close()">Fechar</button>
                 <button class="btn btn-primary" onclick="Modal.close();window._eapApplyStart('${id}')">▶ Aplicar ao projeto</button>`,
      });
    };

    window._eapNewTemplate = () => {
      Modal.close();
      this.openEapTemplateEditor(null, async (saved) => {
        State.eapTemplates = await DB.listEapTemplates();
        this.openEapTemplatesModal();
      });
    };

    window._eapEdit = (id) => {
      const t = allTemplates().find(x => x.id === id);
      if (!t) return;
      Modal.close();
      // Built-in: cria uma cópia editável
      const editTarget = t._builtin
        ? { ...t, id: null, name: t.name + ' (cópia)', _builtin: false, items: t.items.map(it => ({ ...it, id: crypto.randomUUID() })) }
        : { ...t, items: (t.items || []).map(it => ({ ...it })) };
      this.openEapTemplateEditor(editTarget, async (saved) => {
        State.eapTemplates = await DB.listEapTemplates();
        this.openEapTemplatesModal();
      });
    };

    window._eapApplyStart = (id) => {
      const t = allTemplates().find(x => x.id === id);
      if (!t) return;
      Modal.close();
      const items = t.items || [];
      const leafCount = items.filter(it => !items.some(c => c.level === it.level + 1 && items.indexOf(c) > items.indexOf(it) && (items.findIndex(x => x.level <= it.level && items.indexOf(x) > items.indexOf(it)) > items.indexOf(c) || items.findIndex(x => x.level <= it.level && items.indexOf(x) > items.indexOf(it)) === -1))).length;
      const totalDays = items.filter(it => it.level > 1 || !items.some(c => c.level === 2)).reduce((s, it) => s + (it.duration_days || 5), 0);
      Modal.open({
        title: '▶ Aplicar template ao projeto',
        body: `
          <div style="font-size:12px;color:var(--ink-mute);margin-bottom:14px;">${escapeHtml(t.name)} · ${items.length} tarefas</div>
          <div style="display:grid;gap:12px;">
            <div class="form-group">
              <label class="form-label">Data de início do projeto</label>
              <input class="form-input" type="date" id="_eapStartDate" value="${today()}">
            </div>
            <div class="form-group">
              <label class="form-label">Multiplicador de prazo <span style="color:var(--ink-mute);font-size:11px;">(1.0 = padrão · 1.5 = +50%)</span></label>
              <input class="form-input" type="number" id="_eapMult" min="0.1" max="10" step="0.1" value="1.0" style="width:120px;">
            </div>
            <label style="display:flex;align-items:center;gap:8px;font-size:13px;cursor:pointer;">
              <input type="checkbox" id="_eapAddDeps" checked style="width:15px;height:15px;accent-color:var(--accent);">
              Criar dependências sequenciais (TI) entre tarefas irmãs
            </label>
            <label style="display:flex;align-items:center;gap:8px;font-size:13px;cursor:pointer;">
              <input type="checkbox" id="_eapAppend" style="width:15px;height:15px;accent-color:var(--accent);">
              Adicionar às tarefas existentes <span style="color:var(--ink-mute);font-size:11px;">(sem marcar = limpa o projeto antes)</span>
            </label>
          </div>
          <div style="margin-top:14px;padding:10px;background:rgba(124,58,237,0.07);border:1px solid rgba(124,58,237,0.2);border-radius:4px;font-size:12px;font-family:var(--font-mono);">
            📐 ${items.length} tarefas · ~${totalDays} dias base
          </div>`,
        footer: `<button class="btn btn-secondary" onclick="Modal.close()">Cancelar</button>
                 <button class="btn btn-primary" onclick="window._eapConfirmApply('${id}')">✓ Aplicar ao projeto</button>`,
      });

      window._eapConfirmApply = async (tid) => {
        const startDate = document.getElementById('_eapStartDate')?.value || today();
        const mult      = parseFloat(document.getElementById('_eapMult')?.value) || 1.0;
        const addDeps   = document.getElementById('_eapAddDeps')?.checked ?? true;
        const append    = document.getElementById('_eapAppend')?.checked ?? false;
        Modal.close();
        await this.applyEapTemplate(items, startDate, mult, addDeps, append);
      };
    };
  },

  openEapTemplateEditor(tpl, onSave) {
    // Cria novo template se tpl === null
    let _items = tpl?.items ? tpl.items.map(it => ({ ...it, id: it.id || crypto.randomUUID() }))
      : [{ id: crypto.randomUUID(), level: 1, title: '', duration_days: 5 }];
    let _name = tpl?.name || '';
    let _desc = tpl?.description || '';
    let _sector = tpl?.sector || 'civil';

    const renderItems = () => {
      const codes = this._eapCodes(_items);
      const cont = document.getElementById('_eapEditorItems');
      if (!cont) return;
      cont.innerHTML = _items.map((it, i) => {
        const indent = (it.level - 1) * 20;
        const canUp  = it.level > 1;
        const canDn  = it.level < 3;
        const canMvUp = i > 0;
        const canMvDn = i < _items.length - 1;
        return `
          <div style="display:flex;align-items:center;gap:6px;padding:5px 6px;background:var(--bg-deep);border:1px solid var(--border);border-radius:3px;margin-bottom:4px;">
            <span style="font-family:var(--font-mono);font-size:10px;color:var(--accent);min-width:32px;flex-shrink:0;">${codes[i]}</span>
            <div style="width:${indent}px;flex-shrink:0;"></div>
            <input value="${escapeHtml(it.title)}" data-eap-idx="${i}" data-eap-field="title"
              class="form-input" style="flex:1;padding:3px 6px;font-size:12px;${it.level===1?'font-weight:700;':''}min-width:120px;"
              placeholder="${it.level===1?'Grupo (ex: FUNDAÇÕES)':'Tarefa (ex: Sondagem)'}">
            <input value="${it.duration_days||''}" data-eap-idx="${i}" data-eap-field="duration_days" type="number" min="1"
              class="form-input" style="width:52px;padding:3px 5px;font-size:11px;text-align:center;" title="Duração (dias)" placeholder="dias">
            <div style="display:flex;gap:2px;flex-shrink:0;">
              <button title="Subir nível (outdent)" ${!canUp?'disabled':''} data-eap-op="outdent" data-eap-idx="${i}"
                style="padding:2px 5px;font-size:11px;border:1px solid var(--border);border-radius:2px;background:none;cursor:${canUp?'pointer':'default'};opacity:${canUp?1:0.3};">←</button>
              <button title="Descer nível (indent)" ${!canDn?'disabled':''} data-eap-op="indent" data-eap-idx="${i}"
                style="padding:2px 5px;font-size:11px;border:1px solid var(--border);border-radius:2px;background:none;cursor:${canDn?'pointer':'default'};opacity:${canDn?1:0.3};">→</button>
              <button title="Mover para cima" ${!canMvUp?'disabled':''} data-eap-op="mvup" data-eap-idx="${i}"
                style="padding:2px 5px;font-size:11px;border:1px solid var(--border);border-radius:2px;background:none;cursor:${canMvUp?'pointer':'default'};opacity:${canMvUp?1:0.3};">▲</button>
              <button title="Mover para baixo" ${!canMvDn?'disabled':''} data-eap-op="mvdn" data-eap-idx="${i}"
                style="padding:2px 5px;font-size:11px;border:1px solid var(--border);border-radius:2px;background:none;cursor:${canMvDn?'pointer':'default'};opacity:${canMvDn?1:0.3};">▼</button>
              <button title="Remover" data-eap-op="rm" data-eap-idx="${i}"
                style="padding:2px 5px;font-size:11px;border:1px solid var(--border);border-radius:2px;background:none;cursor:pointer;color:var(--accent-danger);">✕</button>
            </div>
          </div>`;
      }).join('');

      // Bind events
      cont.querySelectorAll('input[data-eap-idx]').forEach(el => {
        el.oninput = () => {
          const i = +el.dataset.eapIdx, f = el.dataset.eapField;
          _items[i][f] = f === 'duration_days' ? (parseInt(el.value) || null) : el.value;
        };
      });
      cont.querySelectorAll('button[data-eap-op]').forEach(btn => {
        btn.onclick = () => {
          const i = +btn.dataset.eapIdx, op = btn.dataset.eapOp;
          if (op === 'outdent') { _items[i].level = Math.max(1, _items[i].level - 1); }
          if (op === 'indent')  { _items[i].level = Math.min(3, _items[i].level + 1); }
          if (op === 'mvup' && i > 0) { [_items[i-1], _items[i]] = [_items[i], _items[i-1]]; }
          if (op === 'mvdn' && i < _items.length-1) { [_items[i], _items[i+1]] = [_items[i+1], _items[i]]; }
          if (op === 'rm')  { _items.splice(i, 1); }
          renderItems();
        };
      });
    };

    Modal.open({
      title: `${tpl ? '✏️ Editar' : '+ Novo'} Template de EAP`,
      body: `
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:12px;">
          <div class="form-group" style="margin:0;">
            <label class="form-label">Nome do template</label>
            <input class="form-input" id="_eapTplName" value="${escapeHtml(_name)}" placeholder="Ex: Construção Residencial" style="font-size:13px;">
          </div>
          <div class="form-group" style="margin:0;">
            <label class="form-label">Setor</label>
            <select class="form-input" id="_eapTplSector" style="font-size:13px;">
              <option value="civil"    ${_sector==='civil'    ?'selected':''}>🏗 Construção Civil</option>
              <option value="software" ${_sector==='software' ?'selected':''}>💻 Software / TI</option>
              <option value="evento"   ${_sector==='evento'   ?'selected':''}>🎉 Evento / Marketing</option>
              <option value="generic"  ${_sector==='generic'  ?'selected':''}>📋 Genérico</option>
            </select>
          </div>
        </div>
        <div class="form-group" style="margin-bottom:12px;">
          <label class="form-label">Descrição <span style="color:var(--ink-mute);font-size:11px;">(opcional)</span></label>
          <input class="form-input" id="_eapTplDesc" value="${escapeHtml(_desc)}" placeholder="Breve descrição do template" style="font-size:12px;">
        </div>
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;">
          <div style="font-size:12px;font-weight:600;color:var(--ink);">Estrutura EAP</div>
          <button class="btn btn-secondary" id="_eapAddItem" style="padding:3px 10px;font-size:11px;">+ Item</button>
        </div>
        <div id="_eapEditorItems" style="max-height:350px;overflow-y:auto;padding-right:2px;"></div>`,
      footer: `<button class="btn btn-secondary" onclick="Modal.close()">Cancelar</button>
               <button class="btn btn-primary" id="_eapSaveTplBtn">💾 Salvar template</button>`,
      cls: 'modal-wide',
    });

    renderItems();

    document.getElementById('_eapAddItem').onclick = () => {
      const lastLevel = _items.length > 0 ? _items[_items.length - 1].level : 1;
      _items.push({ id: crypto.randomUUID(), level: lastLevel, title: '', duration_days: 5 });
      renderItems();
      setTimeout(() => {
        const inputs = document.querySelectorAll('#_eapEditorItems input[data-eap-field="title"]');
        if (inputs.length) inputs[inputs.length - 1].focus();
      }, 50);
    };

    document.getElementById('_eapSaveTplBtn').onclick = async () => {
      const name = document.getElementById('_eapTplName')?.value?.trim();
      if (!name) { toast('Informe o nome do template', 'error'); return; }
      const validItems = _items.filter(it => it.title?.trim());
      if (validItems.length === 0) { toast('Adicione ao menos um item', 'error'); return; }
      setLoading(true);
      try {
        const payload = {
          id: tpl?._builtin ? null : tpl?.id,
          name,
          description: document.getElementById('_eapTplDesc')?.value?.trim() || null,
          sector: document.getElementById('_eapTplSector')?.value || 'generic',
          items: validItems,
        };
        await DB.saveEapTemplate(payload);
        toast('Template salvo com sucesso', 'success');
        Modal.close();
        if (onSave) onSave(payload);
      } catch (e) { toast('Erro ao salvar: ' + e.message, 'error'); }
      finally { setLoading(false); }
    };
  },

  async applyEapTemplate(items, startDate, mult, addDeps, append, skipConfirm) {
    if (!State.currentProjectId) { toast('Nenhum projeto selecionado', 'error'); return; }
    mult = mult || 1.0;

    if (!skipConfirm) {
      const confirmed = await Dialog.confirm({
        title: 'Aplicar template ao projeto',
        message: append
          ? `Serão criadas ${items.length} tarefas no projeto atual (sem remover as existentes).`
          : `ATENÇÃO: todas as ${State.tasks.length} tarefas existentes serão excluídas e substituídas pelas ${items.length} tarefas do template.`,
        confirmText: 'Aplicar',
        danger: !append,
      });
      if (!confirmed) return;
    }

    setLoading(true);
    try {
      // Remove tarefas existentes se não for append
      if (!append && State.tasks.length > 0) {
        for (const t of [...State.tasks]) {
          await State.supabase.from('tasks').delete().eq('id', t.id);
        }
      }

      // Helper: item é folha se não tiver filhos (nenhum item seguinte com nível maior
      // antes de encontrar um item de nível igual ou menor)
      const _isLeaf = (i) => {
        const L = items[i].level;
        for (let j = i + 1; j < items.length; j++) {
          if (items[j].level <= L) return true;  // irmão/pai → é folha
          if (items[j].level >  L) return false; // filho encontrado → não é folha
        }
        return true; // último item da lista
      };

      // Cria tarefas em ordem, mantendo mapa item.id → task.id criado
      const createdId = {};
      const parents = this._eapParents(items);
      let cursor = startDate;
      const leafIds = [];

      for (let i = 0; i < items.length; i++) {
        const it = items[i];
        const parentItem = parents[i];
        const parentTaskId = parentItem ? (createdId[parentItem.id] || null) : null;
        const leaf = _isLeaf(i);
        const dur  = Math.max(1, Math.round((it.duration_days || 5) * mult));
        // Todos os itens recebem datas (NOT NULL constraint) —
        // pais recebem a data atual do cursor; o roll-up recalculará depois
        const task = await DB.createTask(State.currentProjectId, {
          title:      it.title,
          start_date: cursor,
          end_date:   addDays(cursor, dur - 1),
          parent_id:  parentTaskId,
          status:     'a_fazer',
          priority:   'media',
          progress:   0,
        });
        createdId[it.id] = task.id;
        if (leaf) {
          leafIds.push(task.id);
          cursor = addDays(cursor, dur); // avança o cursor apenas para folhas
        }
      }

      // Dependências sequenciais FS entre tarefas folha
      if (addDeps) {
        for (let j = 1; j < leafIds.length; j++) {
          await DB.createDependency({ task_id: leafIds[j], predecessor_id: leafIds[j-1], type: 'FS', lag_days: 0 });
        }
      }

      await DB.loadCurrentProject();
      await UI.render();
      toast(`✓ Template aplicado — ${items.length} tarefas criadas`, 'success');
    } catch (err) {
      toast('Erro ao aplicar template: ' + err.message, 'error');
    } finally { setLoading(false); }
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

  // ===== IMPORT MS PROJECT XML =====
  // ===== IMPORTAR PREVISION (.xlsx) =====
  // Lê XLSX exportado do Prevision. Colunas esperadas:
  // A=EAP B=Nome C=Início D=Fim E=Duração H=Progresso K=Custo L=Status
  // M=Responsáveis O=Predecessor Q/R=Linha de base
  importPrevisionXLSX() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    input.onchange = async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      try {
        setLoading(true);
        // XLSX é um ZIP; lê via JSZip (CDN com SRI — import() dinâmico não suporta integrity)
        if (!window.JSZip) {
          await new Promise((resolve, reject) => {
            const s = document.createElement('script');
            s.src = 'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js';
            s.integrity = 'sha384-+mbV2IY1Zk/X1p/nWllGySJSUN8uMs+gUAN10Or95UBH0fpj6GfKgPmgC5EXieXG';
            s.crossOrigin = 'anonymous';
            s.onload = resolve;
            s.onerror = () => reject(new Error('Não foi possível carregar o leitor de XLSX. Verifique sua conexão.'));
            document.head.appendChild(s);
          });
        }
        const JSZip = window.JSZip;
        const buf = await file.arrayBuffer();
        const zip = await JSZip.loadAsync(buf);
        // Pega a primeira planilha
        const sheetFile = zip.file('xl/worksheets/sheet1.xml') || Object.values(zip.files).find(f => /xl\/worksheets\/sheet\d+\.xml$/.test(f.name));
        if (!sheetFile) throw new Error('Planilha (xl/worksheets/sheet1.xml) não encontrada no XLSX');
        const sheetXml = await sheetFile.async('string');

        // Carrega sharedStrings se existir
        const ssFile = zip.file('xl/sharedStrings.xml');
        const sharedStrings = [];
        if (ssFile) {
          const ssXml = await ssFile.async('string');
          const dom = new DOMParser().parseFromString(ssXml, 'text/xml');
          dom.querySelectorAll('si').forEach(si => {
            // pode ter múltiplos <t> em <r> (rich text)
            sharedStrings.push(Array.from(si.querySelectorAll('t')).map(t => t.textContent).join(''));
          });
        }

        // Parse sheet
        const dom = new DOMParser().parseFromString(sheetXml, 'text/xml');
        const errN = dom.querySelector('parsererror');
        if (errN) throw new Error('XML da planilha mal formado');

        const rows = [];
        dom.querySelectorAll('row').forEach(rowEl => {
          const cells = {};
          rowEl.querySelectorAll('c').forEach(cEl => {
            const ref = cEl.getAttribute('r') || '';
            const col = ref.match(/^([A-Z]+)/)?.[1] || '';
            const t = cEl.getAttribute('t') || '';
            let v = '';
            if (t === 'inlineStr') {
              v = Array.from(cEl.querySelectorAll('is t')).map(x => x.textContent).join('');
            } else if (t === 's') {
              const idx = parseInt(cEl.querySelector('v')?.textContent || '0');
              v = sharedStrings[idx] || '';
            } else {
              v = cEl.querySelector('v')?.textContent || '';
            }
            cells[col] = v.trim();
          });
          rows.push(cells);
        });

        if (rows.length < 2) throw new Error('Planilha sem dados');
        // Detecta cabeçalho (primeira linha não-vazia) e ignora
        const header = rows.find(r => (r['A']||'').toUpperCase().includes('EAP') || (r['B']||'').toUpperCase().includes('NOME')) || rows[0];
        const headerIdx = rows.indexOf(header);
        const dataRows = rows.slice(headerIdx + 1).filter(r => (r['A']||'').trim() && (r['B']||'').trim());

        // ── Parse Prevision rows ────────────────────────────────────────────────
        const parseDate = s => {
          if (!s) return null;
          // dd/mm/yyyy
          const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
          if (m) return `${m[3]}-${m[2].padStart(2,'0')}-${m[1].padStart(2,'0')}`;
          return null;
        };
        const parseCost = s => {
          if (!s) return 0;
          const n = parseFloat(String(s).replace(/[R$\s.]/g, '').replace(',', '.'));
          return isNaN(n) ? 0 : n;
        };
        // Adapta o status do Prevision ao Kanban configurado do projeto atual.
        // Tenta casar por label (case-insensitive, sem acento); cai para defaults canônicos
        // (a_fazer / em_andamento / bloqueada / concluido) se a coluna não existir.
        const _norm = s => (s||'').toString().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
        const _kanbanCols = KanbanConfig.get(); // [{id, label, ...}]
        const _findKbId = (...candidates) => {
          for (const c of candidates) {
            const target = _norm(c);
            const hit = _kanbanCols.find(col => _norm(col.label) === target || _norm(col.id) === target);
            if (hit) return hit.id;
          }
          // fallback: primeiro id canônico encontrado na lista (preserva ordem do Kanban)
          for (const c of candidates) {
            const target = _norm(c);
            const hit = _kanbanCols.find(col => _norm(col.label).includes(target) || _norm(col.id).includes(target));
            if (hit) return hit.id;
          }
          return _kanbanCols[0]?.id || 'a_fazer';
        };
        // Pré-resolve uma vez para todas as tarefas
        const _stConcluido    = _findKbId('Concluído', 'Concluida', 'Concluido', 'concluido', 'Feito', 'Done');
        const _stEmAndamento  = _findKbId('Em Andamento', 'Em andamento', 'em_andamento', 'Andamento', 'Doing', 'Em Execução');
        const _stBloqueada    = _findKbId('Bloqueada', 'Bloqueado', 'bloqueada', 'Blocked');
        const _stAFazer       = _findKbId('A Fazer', 'A fazer', 'a_fazer', 'Backlog', 'Pendente', 'To Do');
        const statusMap = {
          'concluído': _stConcluido, 'concluido': _stConcluido, 'feito': _stConcluido,
          'bloqueado': _stBloqueada, 'bloqueada': _stBloqueada,
          'desenvolvendo': _stEmAndamento, 'em andamento': _stEmAndamento, 'em_andamento': _stEmAndamento, 'validando': _stEmAndamento,
          'não priorizado': _stAFazer, 'nao priorizado': _stAFazer,
          'priorizada para o ciclo': _stAFazer, 'a fazer': _stAFazer, 'a_fazer': _stAFazer,
        };
        const tasks = [];
        const eapToUid = new Map();
        dataRows.forEach((r, i) => {
          const eap = (r['A']||'').trim();
          const name = (r['B']||'').trim();
          if (!eap || !name) return;
          const start = parseDate(r['C']) || parseDate(r['T']) || parseDate(r['Q']);
          const end   = parseDate(r['D']) || parseDate(r['R']);
          if (!start || !end) return;
          const uid = String(i + 1);
          eapToUid.set(eap, uid);
          // Determina parent pelo EAP (prefixo)
          let parent_eap = null;
          if (eap.includes('.')) parent_eap = eap.slice(0, eap.lastIndexOf('.'));
          const pct = Math.max(0, Math.min(100, parseFloat(r['H']||'0') || 0));
          const status = statusMap[_norm(r['L'])] || (pct >= 100 ? _stConcluido : pct > 0 ? _stEmAndamento : _stAFazer);
          tasks.push({
            uid, eap, parent_eap,
            title: name,
            start_date: start, end_date: end,
            progress: pct,
            cost: parseCost(r['K']),
            status,
            assignee_name: (r['M']||'').split(';')[0].trim(), // primeiro nome
            baseline_start: parseDate(r['Q']),
            baseline_end:   parseDate(r['R']),
            pred_raw: (r['O']||'').trim(),
            // Duração 0 (start = end) marca como milestone (será reavaliado depois
            // que a hierarquia for resolvida — pais com filhos perdem o flag).
            is_milestone: !!(start && end && start === end),
          });
        });

        // Resolve parent_uid via parent_eap
        tasks.forEach(t => {
          t.parent_uid = t.parent_eap ? (eapToUid.get(t.parent_eap) || null) : null;
        });
        // Remove flag de marco das tarefas que têm filhos (parent ≠ marco)
        const _hasChildren = new Set(tasks.map(t => t.parent_uid).filter(Boolean));
        tasks.forEach(t => { if (_hasChildren.has(t.uid)) t.is_milestone = false; });

        // Predecessores: formato "EAP+Nd" ou "EAP-Nd" ou "EAP", múltiplos separados por vírgula
        const deps = [];
        tasks.forEach(t => {
          if (!t.pred_raw) return;
          t.pred_raw.split(/[,;]/).forEach(s => {
            const tok = s.trim();
            if (!tok) return;
            const m = tok.match(/^([\d.]+)([+-]\d+)?d?$/i) || tok.match(/^([\d.]+)/);
            if (!m) return;
            const predEap = m[1];
            const lag = m[2] ? parseInt(m[2]) : 0;
            const predUid = eapToUid.get(predEap);
            if (predUid && predUid !== t.uid) {
              deps.push({ task_uid: t.uid, predecessor_uid: predUid, type: 'FS', lag_days: lag });
            }
          });
        });

        if (tasks.length === 0) { toast('Planilha sem tarefas válidas (verifique EAP, Nome, Início, Fim)', 'error'); return; }

        // ── Pré-visualização ────────────────────────────────────────────────────
        const byUid = new Map(tasks.map(t => [t.uid, t]));
        const depthOf = (t) => { let d = 0, p = t.parent_uid; while (p && byUid.has(p)) { d++; p = byUid.get(p).parent_uid; } return d; };

        Modal.open({
          title: `Importar Prevision (${tasks.length} tarefas)`,
          cls: 'modal-extrawide',
          body: `
            <div style="font-size:13px;color:var(--ink-soft);margin-bottom:14px;">
              Importando do <strong>Prevision</strong>. Hierarquia, linha de base, predecessores e progresso serão preservados.
              As tarefas serão adicionadas ao projeto atual.
            </div>
            <div style="max-height:300px;overflow-y:auto;border:1px solid var(--border);border-radius:2px;">
              <table class="data-table" style="width:100%;">
                <thead><tr><th style="width:60px;">EAP</th><th>Tarefa</th><th style="width:90px;">Início</th><th style="width:90px;">Fim</th><th style="width:55px;text-align:center;">%</th><th style="width:50px;text-align:center;">LB</th><th style="width:100px;">Status</th></tr></thead>
                <tbody>
                  ${tasks.map(t => {
                    const d = depthOf(t);
                    return `<tr>
                      <td style="font-family:var(--font-mono);font-size:10px;color:var(--accent);">${escapeHtml(t.eap)}</td>
                      <td style="font-size:12px;">${'&nbsp;&nbsp;&nbsp;&nbsp;'.repeat(d)}${d > 0 ? '↳ ' : ''}${escapeHtml(t.title)}</td>
                      <td class="col-code">${fmtDateShort(t.start_date)}</td>
                      <td class="col-code">${fmtDateShort(t.end_date)}</td>
                      <td class="col-code" style="text-align:center;">${Math.round(t.progress)}%</td>
                      <td class="col-code" style="text-align:center;">${t.baseline_start ? '✓' : '—'}</td>
                      <td style="font-size:11px;">${t.status}</td>
                    </tr>`;
                  }).join('')}
                </tbody>
              </table>
            </div>
            <div style="font-size:11px;color:var(--ink-mute);margin-top:8px;font-family:var(--font-mono);">
              ${deps.length} dependência(s) · ${tasks.filter(t => tasks.some(x => x.parent_uid === t.uid)).length} tarefa(s) pai · ${tasks.filter(t => t.baseline_start).length} com linha de base
            </div>`,
          footer: `<button class="btn btn-secondary" id="btnCancelPrev">Cancelar</button>
                   <button class="btn btn-cta" id="btnApplyPrev">Importar</button>`
        });
        $('#btnCancelPrev').onclick = () => Modal.close();
        $('#btnApplyPrev').onclick = async () => {
          Modal.close();
          try {
            setLoading(true);
            const idMap = new Map();
            const createResilient = async (payload) => {
              try { return await DB.createTask(State.currentProjectId, payload); }
              catch (err) {
                const msg = err.message || '';
                let stripped = false;
                for (const col of ['parent_id', 'baseline_start', 'baseline_end', 'cost']) {
                  if (msg.includes(col) && col in payload) { delete payload[col]; stripped = true; }
                }
                if (stripped) return await DB.createTask(State.currentProjectId, payload);
                throw err;
              }
            };
            // PERF: cria em lotes por nível de profundidade (pais antes de filhos)
            // Cada nível vira UMA chamada de INSERT, em vez de N roundtrips.
            const byDepth = new Map();
            tasks.forEach(t => {
              const d = depthOf(t);
              if (!byDepth.has(d)) byDepth.set(d, []);
              byDepth.get(d).push(t);
            });
            const depths = [...byDepth.keys()].sort((a, b) => a - b);
            for (const d of depths) {
              const group = byDepth.get(d);
              const payloads = group.map(t => {
                const payload = {
                  title: t.title,
                  start_date: t.start_date,
                  end_date: t.end_date,
                  status: t.status,
                  priority: 'media',
                  progress: t.progress,
                  cost: t.cost || null,
                  parent_id: t.parent_uid ? (idMap.get(t.parent_uid) || null) : null,
                };
                if (t.baseline_start) payload.baseline_start = t.baseline_start;
                if (t.baseline_end)   payload.baseline_end   = t.baseline_end;
                return payload;
              });
              let created;
              try {
                created = await DB.createTasksBatch(State.currentProjectId, payloads);
              } catch (err) {
                // Fallback: 1-a-1 se o batch falhar por algum motivo não tratado
                console.warn('[batch fallback] criando 1-a-1 neste nível:', err.message);
                created = [];
                for (const p of payloads) {
                  const c = await createResilient(p);
                  created.push(c);
                }
              }
              created.forEach((c, i) => {
                idMap.set(group[i].uid, c.id);
                State.tasks.push(c);
              });
            }
            let depsImported = 0;
            for (const d of deps) {
              const taskId = idMap.get(d.task_uid);
              const predId = idMap.get(d.predecessor_uid);
              if (!taskId || !predId) continue;
              try {
                const created = await DB.createDependency({ task_id: taskId, predecessor_id: predId, type: d.type, lag_days: d.lag_days });
                State.dependencies.push(created);
                depsImported++;
              } catch (e) { /* duplicates */ }
            }
            await UI.render();
            toast(`Importado: ${tasks.length} tarefas · ${depsImported} dependências`, 'success');
          } catch (err) { toast(friendlyError(err), 'error'); }
          finally { setLoading(false); }
        };
      } catch (err) {
        console.error(err);
        toast('Erro ao processar Prevision XLSX: ' + err.message, 'error');
      } finally { setLoading(false); }
    };
    input.click();
  },

  // ===== MIGRAÇÃO: Corrige tipos de dependências importadas antes da v2.4.5 =====
  // Versões antigas tinham TYPE_MAP do MSPX invertido (0↔1 e 2↔3), resultando
  // em FS gravado como FF, FF como FS, SS como SF e SF como SS.
  // Este utilitário inverte os tipos em todas as dependências do projeto atual.
  async fixMSPXLegacyDepTypes() {
    if (!State.currentProjectId) { toast('Selecione um projeto', 'warning'); return; }
    const deps = State.dependencies || [];
    if (!deps.length) { toast('Nenhuma dependência neste projeto', 'info'); return; }

    // Contagem por tipo antes
    const before = { FS: 0, FF: 0, SS: 0, SF: 0 };
    deps.forEach(d => { if (before[d.type] !== undefined) before[d.type]++; });

    const swap = { FS: 'FF', FF: 'FS', SS: 'SF', SF: 'SS' };
    const after = { FS: before.FF, FF: before.FS, SS: before.SF, SF: before.SS };

    const ok = await Dialog.confirm({
      title: 'Corrigir tipos de dependência?',
      msg:
        `Esta ferramenta INVERTE os tipos das ${deps.length} dependências:\n\n` +
        `   FS ↔ FF   |   SS ↔ SF\n\n` +
        `Antes:  ${before.FS} FS · ${before.FF} FF · ${before.SS} SS · ${before.SF} SF\n` +
        `Depois: ${after.FS} FS · ${after.FF} FF · ${after.SS} SS · ${after.SF} SF\n\n` +
        `Use somente se você importou de MS Project (.xml) antes da versão 2.4.5 e os tipos ficaram trocados.\n\n` +
        `Esta operação NÃO altera datas. Faça baseline antes se quiser preservar referência.`,
      confirmText: 'Inverter tipos',
      danger: true,
    });
    if (!ok) return;

    try {
      setLoading(true);
      let okCount = 0, errCount = 0;
      // Atualiza em paralelo
      await Promise.all(deps.map(async (d) => {
        const newType = swap[d.type];
        if (!newType || newType === d.type) return;
        try {
          const { error } = await State.supabase
            .from('task_dependencies').update({ type: newType }).eq('id', d.id);
          if (error) throw error;
          d.type = newType;
          okCount++;
        } catch (e) { errCount++; console.warn('[fix-mspx]', d.id, e.message); }
      }));
      CPMCache.invalidate();
      await UI.render();
      if (errCount > 0) {
        toast(`⚠ ${okCount} corrigidas, ${errCount} falharam`, 'warning');
      } else {
        toast(`✓ ${okCount} dependências corrigidas`, 'success');
      }
    } catch (err) {
      toast(friendlyError(err), 'error');
    } finally { setLoading(false); }
  },

  importMSProjectXML() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.xml,application/xml,text/xml';
    input.onchange = async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      try {
        setLoading(true);
        const text = await file.text();
        const parsed = MSPX.parse(text);
        if (!parsed || parsed.tasks.length === 0) {
          toast('XML inválido ou sem tarefas', 'error');
          return;
        }
        // Modal de preview
        Modal.open({
          title: `Importar ${parsed.tasks.length} ${parsed.tasks.length === 1 ? 'tarefa' : 'tarefas'} do XML`,
          body: `
            <div style="font-size:13px;color:var(--ink-soft);margin-bottom:14px;">
              <strong>Atenção:</strong> as novas tarefas serão adicionadas ao projeto atual. As tarefas existentes <strong>não</strong> serão removidas. Dependências do XML serão importadas se as duas tarefas envolvidas forem importadas.
            </div>
            <div style="max-height:300px;overflow-y:auto;border:1px solid var(--border);border-radius:2px;">
              <table class="data-table" style="width:100%;">
                <thead><tr><th>Título (hierarquia)</th><th style="width:110px;">Início</th><th style="width:110px;">Término</th><th style="width:60px;text-align:center;">%</th><th style="width:50px;text-align:center;">LB</th><th style="width:60px;text-align:center;">Marco</th><th style="width:60px;text-align:center;">Inativa</th></tr></thead>
                <tbody>
                  ${(() => {
                    // Profundidade pela cadeia de parent_uid (para indentação na prévia)
                    const byUid = new Map(parsed.tasks.map(t => [t.uid, t]));
                    const depthOf = (t) => { let d = 0, p = t.parent_uid; const seen = new Set(); while (p && byUid.has(p) && !seen.has(p)) { seen.add(p); d++; p = byUid.get(p).parent_uid; } return d; };
                    return parsed.tasks.map(t => {
                      const d = depthOf(t);
                      const isParent = parsed.tasks.some(x => x.parent_uid === t.uid);
                      return `<tr${t.inactive ? ' style="opacity:.55;"' : ''}>
                        <td style="font-size:12px;${isParent ? 'font-weight:700;' : ''}">${'&nbsp;&nbsp;&nbsp;&nbsp;'.repeat(d)}${d > 0 ? '↳ ' : ''}${escapeHtml(t.title)}</td>
                        <td class="col-code">${fmtDateShort(t.start_date)}</td>
                        <td class="col-code">${fmtDateShort(t.end_date)}</td>
                        <td class="col-code" style="text-align:center;">${Math.round(t.progress || 0)}%</td>
                        <td class="col-code" style="text-align:center;">${t.baseline_start ? '✓' : '—'}</td>
                        <td class="col-code" style="text-align:center;">${t.is_milestone ? '◆' : '—'}</td>
                        <td class="col-code" style="text-align:center;">${t.inactive ? '⏸' : '—'}</td>
                      </tr>`;
                    }).join('');
                  })()}
                </tbody>
              </table>
            </div>
            <div style="font-size:11px;color:var(--ink-mute);margin-top:8px;font-family:var(--font-mono);">
              ${parsed.dependencies.length} ${parsed.dependencies.length === 1 ? 'dependência' : 'dependências'} · ${parsed.tasks.filter(t => parsed.tasks.some(x => x.parent_uid === t.uid)).length} tarefa(s) pai · ${parsed.tasks.filter(t => t.baseline_start).length} com linha de base
            </div>
          `,
          footer: `
            <button class="btn btn-secondary" id="btnCancelImp">Cancelar</button>
            <button class="btn btn-cta" id="btnApplyImp">Importar</button>
          `
        });
        $('#btnCancelImp').onclick = () => Modal.close();
        $('#btnApplyImp').onclick = async () => {
          Modal.close(); // fecha a janela imediatamente ao confirmar
          try {
            setLoading(true);
            const idMap = new Map(); // xml_uid → uuid no banco
            const byUid = new Map(parsed.tasks.map(t => [t.uid, t]));
            const depthOf = (t) => { let d = 0, p = t.parent_uid, seen = new Set(); while (p && byUid.has(p) && !seen.has(p)) { seen.add(p); d++; p = byUid.get(p).parent_uid; } return d; };
            const maxDepth = parsed.tasks.reduce((m, t) => Math.max(m, depthOf(t)), 0);

            const buildPayload = (t) => {
              const pct = Math.max(0, Math.min(100, parseFloat(t.progress) || 0));
              const status = pct >= 100 ? 'concluido' : (pct > 0 ? 'em_andamento' : 'a_fazer');
              const pl = {
                title: t.title, start_date: t.start_date, end_date: t.end_date,
                status, priority: 'media', progress: pct,
                is_milestone: t.is_milestone || false, inactive: t.inactive || false,
                parent_id: t.parent_uid ? (idMap.get(t.parent_uid) || null) : null,
              };
              if (t.baseline_start) pl.baseline_start = t.baseline_start;
              if (t.baseline_end)   pl.baseline_end = t.baseline_end;
              return pl;
            };

            // Inserção em LOTE, nível por nível (pais antes dos filhos p/ resolver parent_id).
            // Troca centenas de chamadas sequenciais por poucos inserts — essencial p/ 500+ tarefas.
            const CHUNK = 200;
            let createdCount = 0;
            for (let lvl = 0; lvl <= maxDepth; lvl++) {
              const levelTasks = parsed.tasks.filter(t => depthOf(t) === lvl);
              for (let i = 0; i < levelTasks.length; i += CHUNK) {
                const slice = levelTasks.slice(i, i + CHUNK);
                const created = await DB.createTasksBatch(State.currentProjectId, slice.map(buildPayload));
                created.forEach((row, j) => { if (slice[j]) idMap.set(slice[j].uid, row.id); State.tasks.push(row); });
                createdCount += created.length;
              }
            }

            // Dependências em lote — com fallback por linha em caso de duplicata/erro pontual
            const depRows = parsed.dependencies.map(d => {
              const task_id = idMap.get(d.task_uid), predecessor_id = idMap.get(d.predecessor_uid);
              return (task_id && predecessor_id) ? { task_id, predecessor_id, type: d.type, lag_days: d.lag_days } : null;
            }).filter(Boolean);
            let depsImported = 0;
            for (let i = 0; i < depRows.length; i += CHUNK) {
              const slice = depRows.slice(i, i + CHUNK);
              try {
                const { data, error } = await State.supabase.from('task_dependencies').insert(slice).select();
                if (error) throw error;
                (data || []).forEach(x => State.dependencies.push(x));
                depsImported += (data || []).length;
              } catch (e) {
                for (const dr of slice) {
                  try { const c = await DB.createDependency(dr); State.dependencies.push(c); depsImported++; } catch (_) { /* duplicata */ }
                }
              }
            }
            CPMCache.invalidate();
            await UI.render();
            toast(`Importado: ${createdCount} ${createdCount === 1 ? 'tarefa' : 'tarefas'} e ${depsImported} ${depsImported === 1 ? 'dependência' : 'dependências'}`, 'success');
          } catch (err) { toast('Erro ao importar: ' + err.message, 'error'); }
          finally { setLoading(false); }
        };
      } catch (err) {
        console.error(err);
        toast('Erro ao processar XML: ' + err.message, 'error');
      } finally { setLoading(false); }
    };
    input.click();
  },

  async switchProject(id) {
    State.currentProjectId = id;
    setLoading(true);
    try {
      await DB.loadCurrentProject();
      setupRealtime();
      State.currentView = 'dashboard'; UI.setActiveNav('dashboard');
      await UI.render();
    } catch (err) { toast(friendlyError(err), 'error'); }
    finally { setLoading(false); }
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

  // Aplica um setor a TODA a subárvore (descendentes) de uma tarefa — 1 chamada ao banco.
  async applySectorToSubtree(taskId, sector) {
    const ids = [];
    const walk = (pid) => State.tasks.filter(t => t.parent_id === pid).forEach(c => { ids.push(c.id); c.sector = sector || null; walk(c.id); });
    walk(taskId);
    if (!ids.length) return 0;
    try {
      const { error } = await State.supabase.from('tasks').update({ sector: sector || null }).in('id', ids);
      if (error) throw error;
    } catch (e) {
      console.warn('applySectorToSubtree:', e.message);
      toast('Erro ao aplicar setor: ' + e.message, 'error');
    }
    return ids.length;
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

  setActiveNav(view) {
    $$('.nav-item').forEach(n => n.classList.remove('active'));
    const item = document.querySelector(`.nav-item[data-view="${view}"]`);
    if (item) item.classList.add('active');
  },

  _dlBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
  },

  // ── helpers de impressão ──────────────────────────────────────────────────
  _printWindow(title, bodyHtml, landscape = false) {
    const p = Views.current();
    const projName = p ? escapeHtml(p.name) : 'Portfólio';
    const projClient = p?.client ? ` · ${escapeHtml(p.client)}` : '';
    const genDate  = new Date().toLocaleDateString('pt-BR', { day:'2-digit', month:'long', year:'numeric', hour:'2-digit', minute:'2-digit' });
    const w = window.open('', '_blank', 'width=1100,height=820');
    // SVG "?" logo inline para relatórios
    const logoSvg = `<svg width="32" height="32" viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg"><rect x="1" y="1" width="30" height="30" rx="4" fill="none" stroke="#1A1714" stroke-width="1.5"/><text x="16" y="23" text-anchor="middle" font-family="monospace" font-size="20" font-weight="700" fill="#E54B1A">?</text></svg>`;
    w.document.write(`<!DOCTYPE html><html lang="pt-BR"><head>
      <meta charset="UTF-8">
      <title>${title} — ${projName}</title>
      <style>
        *{box-sizing:border-box;margin:0;padding:0;}
        body{font-family:'Segoe UI',Arial,sans-serif;font-size:11px;color:#1A1714;background:#F2EDE3;}
        /* Toolbar de pré-visualização (some na impressão) */
        #printToolbar{
          position:sticky;top:0;z-index:999;background:#1A1714;display:flex;
          align-items:center;justify-content:space-between;padding:10px 20px;
          gap:12px;border-bottom:2px solid #E54B1A;
        }
        #printToolbar .tbar-title{color:#F2EDE3;font-size:13px;font-weight:700;font-family:monospace;}
        #printToolbar .tbar-sub{color:#94928B;font-size:10px;font-family:monospace;margin-top:2px;}
        #printToolbar .tbar-actions{display:flex;gap:8px;}
        .btn-print{background:#E54B1A;color:#fff;border:none;padding:8px 20px;border-radius:3px;font-size:12px;font-weight:700;cursor:pointer;font-family:inherit;}
        .btn-print:hover{background:#C13B12;}
        .btn-close{background:transparent;color:#94928B;border:1px solid #45403A;padding:8px 14px;border-radius:3px;font-size:12px;cursor:pointer;font-family:inherit;}
        .btn-close:hover{color:#F2EDE3;border-color:#94928B;}
        /* Área de conteúdo */
        #printContent{
          background:#fff;max-width:920px;margin:24px auto;
          box-shadow:0 2px 12px rgba(0,0,0,.12);border-radius:3px;overflow:hidden;
        }
        /* Cabeçalho do documento */
        .doc-header{
          background:#fff;padding:16px 20mm 14px;display:flex;align-items:center;gap:14px;
        }
        .doc-header-logo{flex-shrink:0;}
        .doc-header-brand{font-family:monospace;font-size:9px;color:#E54B1A;text-transform:uppercase;letter-spacing:.14em;margin-bottom:2px;}
        .doc-header-title{font-size:18px;font-weight:800;color:#1A1714;letter-spacing:-.01em;}
        .doc-header-right{margin-left:auto;text-align:right;}
        .doc-header-proj{font-size:12px;font-weight:700;color:#1A1714;}
        .doc-header-date{font-size:9px;color:#6B6359;font-family:monospace;margin-top:2px;}
        /* Faixa laranja */
        .doc-stripe{height:3px;background:linear-gradient(90deg,#E54B1A,#D4A82C);}
        /* Corpo do relatório */
        .doc-body{padding:14mm 20mm;}
        h2{font-size:12px;font-weight:700;margin:16px 0 6px;padding-bottom:4px;border-bottom:1.5px solid #E8E2D4;color:#1A1714;text-transform:uppercase;letter-spacing:.06em;}
        table{width:100%;border-collapse:collapse;font-size:10px;margin-bottom:12px;}
        th{background:#F2EDE3;color:#6B6359;font-size:9px;text-transform:uppercase;letter-spacing:.08em;padding:6px 8px;text-align:left;border-bottom:1.5px solid #E8E2D4;}
        td{padding:5px 8px;border-bottom:1px solid #F2EDE3;vertical-align:top;}
        tr:last-child td{border-bottom:none;}
        tr:nth-child(even) td{background:#FAFAF8;}
        .badge{display:inline-block;padding:1px 6px;border-radius:2px;font-size:9px;font-weight:700;}
        .badge-done{background:#d1fae5;color:#065f46;}
        .badge-todo{background:#F2EDE3;color:#6B6359;}
        .badge-prog{background:#fff3cd;color:#92400e;}
        .badge-bloc{background:#fee2e2;color:#991b1b;}
        .badge-high{background:#fee2e2;color:#991b1b;}
        .badge-mid{background:#fef3c7;color:#92400e;}
        .badge-low{background:#F2EDE3;color:#6B6359;}
        .raci-r{background:#fee2e2;color:#991b1b;font-weight:800;}
        .raci-a{background:#fef3c7;color:#92400e;font-weight:800;}
        .raci-c{background:#dbeafe;color:#1e40af;font-weight:800;}
        .raci-i{background:#f0fdf4;color:#166534;font-weight:800;}
        .raci-cell{text-align:center;}
        .overdue{color:#C13B12;font-weight:700;}
        .progress-wrap{display:flex;align-items:center;gap:6px;}
        .progress-bar{flex:1;height:4px;background:#E8E2D4;border-radius:2px;overflow:hidden;}
        .progress-fill{height:100%;background:#E54B1A;border-radius:2px;}
        /* Rodapé */
        .doc-footer{
          padding:8px 20mm;background:#F2EDE3;border-top:1px solid #E8E2D4;
          font-size:8px;color:#94928B;font-family:monospace;display:flex;justify-content:space-between;
        }
        /* Cabeçalho corrido — só na impressão, repete em todas as páginas */
        .print-rhead{display:none;}
        .print-rhead-brand{font-family:monospace;font-size:9px;color:#E54B1A;text-transform:uppercase;letter-spacing:.12em;}
        .print-rhead-title{font-size:13px;font-weight:800;color:#1A1714;letter-spacing:-.01em;line-height:1.15;}
        .print-rhead-right{margin-left:auto;text-align:right;}
        .print-rhead-proj{font-size:10px;font-weight:700;color:#1A1714;}
        .print-rhead-date{font-size:8px;color:#6B6359;font-family:monospace;}
        /* Cabeçalho e rodapé corridos via caixas de margem do @page:
           ficam NA MARGEM da folha, então repetem em todas as páginas e nunca
           sobrepõem o conteúdo (mesmo mecanismo da numeração). */
        @page{
          size:A4${landscape ? ' landscape' : ''}; margin:24mm 14mm 16mm;
          @top-left{ content:"CadêOProjeto · ${title}"; font-family:monospace; font-size:9px; font-weight:700; color:#1A1714; vertical-align:bottom; padding-bottom:2.5mm; border-bottom:2px solid #E54B1A; }
          @top-center{ content:""; border-bottom:2px solid #E54B1A; }
          @top-right{ content:"${projName}"; font-family:monospace; font-size:9px; font-weight:700; color:#E54B1A; vertical-align:bottom; padding-bottom:2.5mm; border-bottom:2px solid #E54B1A; }
          @bottom-left{ content:"Gerado em ${genDate}"; font-family:monospace; font-size:8px; color:#94928B; }
          @bottom-center{ content:"Página " counter(page) " de " counter(pages); font-family:monospace; font-size:8px; color:#94928B; }
        }
        @media print{
          body{background:#fff;}
          /* Garante faixa laranja, badges (status/RACI) e barras de progresso na impressão */
          *{-webkit-print-color-adjust:exact!important;print-color-adjust:exact!important;}
          #printToolbar{display:none!important;}
          #printContent{box-shadow:none;margin:0;border-radius:0;max-width:none;overflow:visible;}
          /* Cabeçalho/faixa/rodapé em fluxo + corrido dão lugar às caixas de margem do @page */
          .doc-header,.doc-stripe,.doc-footer,.print-rhead{display:none!important;}
          .doc-body{padding:0!important;}
          tr:nth-child(even) td{background:#fafaf8;}
          /* Repete o cabeçalho da tabela a cada página e evita cortar linhas */
          thead{display:table-header-group;}
          tr{page-break-inside:avoid;}
          h2{page-break-after:avoid;}
        }
      </style>
    </head><body>
      <div class="print-rhead">
        <div class="print-rhead-logo">${logoSvg}</div>
        <div>
          <div class="print-rhead-brand">CadêOProjeto · Engenharia</div>
          <div class="print-rhead-title">${title}</div>
        </div>
        <div class="print-rhead-right">
          <div class="print-rhead-proj">${projName}</div>
          <div class="print-rhead-date">${genDate}</div>
        </div>
      </div>
      <div id="printToolbar">
        <div style="display:flex;align-items:center;gap:10px;">
          ${logoSvg}
          <div>
            <div class="tbar-title">${title}</div>
            <div class="tbar-sub">${projName}${projClient} · ${genDate}</div>
          </div>
        </div>
        <div class="tbar-actions">
          <button class="btn-close" onclick="window.close()">✕ Fechar</button>
          <button class="btn-print" onclick="window.print()">🖨 Imprimir</button>
        </div>
      </div>
      <div id="printContent">
        <div class="doc-header">
          <div class="doc-header-logo">${logoSvg}</div>
          <div>
            <div class="doc-header-brand">CadêOProjeto · Gestão de Engenharia</div>
            <div class="doc-header-title">${title}</div>
          </div>
          <div class="doc-header-right">
            <div class="doc-header-proj">${projName}</div>
            ${p?.client ? `<div style="font-size:10px;color:#6B6359;">${escapeHtml(p.client)}</div>` : ''}
            <div class="doc-header-date">Gerado em ${genDate}</div>
          </div>
        </div>
        <div class="doc-stripe"></div>
        <div class="doc-body">
          ${bodyHtml}
        </div>
        <div class="doc-footer">
          <span>CadêOProjeto · Gestão de Projetos de Engenharia</span>
          <span>${title} · ${projName} · ${genDate}</span>
        </div>
      </div>
    </body></html>`);
    w.document.close();
    w.focus();
  },

  printTasks() {
    // Tarefas inativas e tarefas-PAI (fases) ficam fora do relatório — só as folhas de trabalho.
    const _parentIds = new Set(State.tasks.filter(t => t.parent_id).map(t => t.parent_id));
    const tasks = State.tasks.filter(t => !t.inactive && !_parentIds.has(t.id)).sort((a,b) => (a.end_date||'9999') > (b.end_date||'9999') ? 1 : -1);
    const members = State.members;
    const disciplines = State.disciplines;
    const todayStr = today();
    const statusBadge = {
      a_fazer:'<span class="badge badge-todo">A Fazer</span>',
      bloqueada:'<span class="badge badge-bloc">Bloqueada</span>',
      em_andamento:'<span class="badge badge-prog">Em Andamento</span>',
      concluido:'<span class="badge badge-done">Concluída</span>',
    };
    const prioBadge = {
      alta:'<span class="badge badge-high">Alta</span>',
      media:'<span class="badge badge-mid">Média</span>',
      baixa:'<span class="badge badge-low">Baixa</span>',
    };
    // Etiquetas por tarefa (para coluna e filtro do preview)
    const labelsByTask = {};
    (State.taskLabels || []).forEach(tl => {
      (labelsByTask[tl.task_id] = labelsByTask[tl.task_id] || []).push(tl.label_id);
    });
    const labelById = new Map((State.labels || []).map(l => [l.id, l]));
    const _taskById = new Map(State.tasks.map(tk => [tk.id, tk]));

    const rows = tasks.map(t => {
      const m = members.find(x => x.id === t.assignee_id);
      const d = disciplines.find(x => x.id === t.discipline_id);
      const _parent = t.parent_id ? _taskById.get(t.parent_id) : null;
      const isOvd = t.end_date && t.end_date < todayStr && t.status !== 'concluido';
      const pct = Math.min(100, parseFloat(t.progress)||0).toFixed(0);
      const lblIds = labelsByTask[t.id] || [];
      const lblHtml = lblIds.map(lid => {
        const l = labelById.get(lid);
        return l ? `<span style="display:inline-block;font-size:8px;font-weight:700;padding:1px 5px;border-radius:6px;background:${escapeHtml(l.color)};color:#11161f;margin:0 2px 2px 0;">${escapeHtml(l.name)}</span>` : '';
      }).join('');
      return `<tr data-labels="${lblIds.join(',')}">
        <td style="font-family:monospace;font-size:9px;color:#666;">${escapeHtml(t.code||'—')}</td>
        <td><strong>${escapeHtml(t.title)}</strong>${_parent?`<br><span style="color:#E54B1A;font-size:9px;">↳ ${escapeHtml(_parent.title)}</span>`:''}${t.description?`<br><span style="color:#8a96a8;font-size:9px;">${escapeHtml(t.description.slice(0,80))}</span>`:''}</td>
        <td>${statusBadge[t.status]||t.status}</td>
        <td>${prioBadge[t.priority]||'—'}</td>
        <td>${m ? escapeHtml(m.name.split(' ')[0]) : '—'}</td>
        <td>${d ? `<span style="font-family:monospace;font-size:9px;">${d.code}</span>` : '—'}</td>
        <td style="font-size:9px;color:#475569;">${t.sector ? escapeHtml(t.sector) : '—'}</td>
        <td>${lblHtml || '—'}</td>
        <td class="${isOvd?'overdue':''}">${t.end_date ? fmtDateShort(t.end_date) : '—'}</td>
        <td><div class="progress-wrap"><div class="progress-bar"><div class="progress-fill" style="width:${pct}%;background:${t.status==='concluido'?'#059669':'#2563eb'};"></div></div><span style="font-family:monospace;font-size:9px;">${pct}%</span></div></td>
      </tr>`;
    }).join('');

    // Filtro de etiqueta no preview (some na impressão via .no-print)
    const labelFilter = (State.labels || []).length === 0 ? '' : `
      <div class="no-print" style="display:flex;align-items:center;gap:8px;margin-bottom:10px;font-size:11px;">
        <label style="font-family:monospace;font-size:9px;text-transform:uppercase;letter-spacing:.08em;color:#6B6359;">Filtrar etiqueta:</label>
        <select id="rptLabelFilter" style="padding:5px 9px;font-size:11px;border:1px solid #ddd;border-radius:3px;background:#fff;font-family:inherit;">
          <option value="all">Todas</option>
          <option value="none">Sem etiqueta</option>
          ${(State.labels || []).map(l => `<option value="${l.id}">${escapeHtml(l.name)}</option>`).join('')}
        </select>
        <span id="rptLabelCount" style="font-family:monospace;font-size:9px;color:#94928B;"></span>
      </div>
      <style>@media print { .no-print { display:none!important; } }</style>`;

    const body = `
      ${labelFilter}
      <table id="rptTasksTable">
        <thead><tr>
          <th>Cód.</th><th>Tarefa</th><th>Status</th><th>Prior.</th>
          <th>Responsável</th><th>Disc.</th><th>Setor</th><th>Etiquetas</th><th>Prazo</th><th>Progresso</th>
        </tr></thead>
        <tbody>${rows||'<tr><td colspan="10" style="text-align:center;color:#8a96a8;">Nenhuma tarefa</td></tr>'}</tbody>
      </table>
      <div style="font-size:9px;color:#8a96a8;font-family:monospace;">${tasks.length} tarefas · ${tasks.filter(t=>t.status==='concluido').length} concluídas · ${tasks.filter(t=>t.end_date&&t.end_date<todayStr&&t.status!=='concluido').length} em atraso</div>
      <script>
        (function(){
          var sel = document.getElementById('rptLabelFilter');
          if (!sel) return;
          var rows = Array.from(document.querySelectorAll('#rptTasksTable tbody tr[data-labels]'));
          var count = document.getElementById('rptLabelCount');
          sel.addEventListener('change', function(){
            var v = sel.value, shown = 0;
            rows.forEach(function(tr){
              var ids = (tr.dataset.labels || '').split(',').filter(Boolean);
              var show = v === 'all' || (v === 'none' ? ids.length === 0 : ids.indexOf(v) >= 0);
              tr.style.display = show ? '' : 'none';
              if (show) shown++;
            });
            if (count) count.textContent = shown + ' de ' + rows.length + ' tarefas';
          });
        })();
      <\/script>`;
    this._printWindow('Lista de Tarefas', body);
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

  openKanbanConfigModal() {
    const cols = KanbanConfig.get();
    const COLORS = ['#9ba8be','#C13B12','#E54B1A','#2E7D4F','#D4A82C','#1F3A8A','#1F3A8A','#ff9f6b'];

    const renderRows = (list) => list.map((col, i) => `
      <div class="kconfig-col-row" data-idx="${i}">
        <span class="kconfig-col-handle" title="Arraste para reordenar">⠿</span>
        <div class="kconfig-col-dot" style="background:${col.color};"></div>
        <input class="form-input kconfig-name-input" value="${escapeHtml(col.label)}" data-idx="${i}"
          style="flex:1;padding:4px 8px;font-size:13px;height:30px;" maxlength="30">
        <select class="form-input kconfig-color-select" data-idx="${i}"
          style="padding:4px 6px;font-size:12px;height:30px;width:90px;">
          ${COLORS.map(c => `<option value="${c}" ${col.color === c ? 'selected' : ''} style="background:${c};color:#111;">${c}</option>`).join('')}
        </select>
        <button class="btn btn-ghost kconfig-del-btn" data-idx="${i}"
          style="padding:4px 8px;color:var(--accent-danger);font-size:11px;"
          ${list.length <= 1 ? 'disabled' : ''}>✕</button>
      </div>`).join('');

    Modal.open({ title: 'Configurar Colunas do Kanban', body: `
      <div style="font-size:13px;color:var(--ink-soft);margin-bottom:14px;">
        Adicione, renomeie, reordene ou remova colunas. As tarefas permanecem associadas ao ID de status original.
      </div>
      <div id="kcolRows">${renderRows(cols)}</div>
      <button class="kconfig-add-btn" id="kcolAddBtn">+ Adicionar coluna</button>
      <div style="display:flex;gap:8px;margin-top:18px;justify-content:flex-end;">
        <button class="btn btn-ghost" id="kcolResetBtn">Restaurar padrão</button>
        <button class="btn" id="kcolSaveBtn" style="background:var(--accent);color:var(--bg-deep);font-weight:700;">Salvar</button>
      </div>
    ` });

    let current = JSON.parse(JSON.stringify(cols));

    const refresh = () => {
      document.getElementById('kcolRows').innerHTML = renderRows(current);
      bindInputs();
    };

    const bindInputs = () => {
      document.querySelectorAll('.kconfig-name-input').forEach(inp => {
        inp.oninput = (e) => { current[+e.target.dataset.idx].label = e.target.value; };
      });
      document.querySelectorAll('.kconfig-color-select').forEach(sel => {
        sel.onchange = (e) => {
          current[+e.target.dataset.idx].color = e.target.value;
          document.querySelectorAll('.kconfig-col-dot')[+e.target.dataset.idx].style.background = e.target.value;
        };
      });
      document.querySelectorAll('.kconfig-del-btn').forEach(btn => {
        btn.onclick = (e) => {
          const idx = +e.target.dataset.idx;
          current.splice(idx, 1);
          refresh();
        };
      });
    };

    bindInputs();

    document.getElementById('kcolAddBtn').onclick = () => {
      const usedColors = current.map(c => c.color);
      const nextColor = COLORS.find(c => !usedColors.includes(c)) || COLORS[0];
      const newId = 'col_' + Date.now();
      current.push({ id: newId, label: 'Nova Coluna', color: nextColor });
      refresh();
    };

    document.getElementById('kcolResetBtn').onclick = async () => {
      if (!await Dialog.confirm({ title: 'Restaurar padrão', msg: 'Restaurar as colunas padrão do Kanban?\n\nColunas personalizadas serão removidas.', confirmText: 'Restaurar' })) return;
      KanbanConfig.reset();
      Modal.close();
      UI.render();
    };

    document.getElementById('kcolSaveBtn').onclick = () => {
      const valid = current.filter(c => c.label.trim());
      if (!valid.length) { toast('Adicione pelo menos uma coluna', 'warning'); return; }
      KanbanConfig.set(valid);
      Modal.close();
      UI.render();
      toast('Colunas salvas', 'success');
    };
  },

};
// Escopo global: atributos onclick inline só enxergam window.*
window.UI = UI;
