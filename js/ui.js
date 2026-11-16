// UI: controlador principal das telas
import { $, $$, DEP_TYPE_FROM_PT, DEP_TYPE_PT, DateFilter, addDays, addWeeks, addWorkingDays, colorFromString, daysBetween, escapeHtml, fmtDateFull, fmtDateShort, forecastEndDate, initials, mondayOf, nextWorkday, physicalProgress, rolledProgress, snapTaskDates, today, workingDaysBetween } from './helpers.js';
import { CPMCache, autoSchedule, dependencyCycle } from './cpm.js';
import { friendlyError, setLoading, toast } from './feedback.js';
import { APP_VERSION, CHANGELOG } from './changelog.js';
import { State, validateTaskStatusChange } from './state.js';
import { Config } from './auth.js';
import { DB, setupRealtime } from './db.js';
import { Perf } from './perf.js';
import { HealthCheck } from './health.js';
import { Modal } from './modal.js';
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
