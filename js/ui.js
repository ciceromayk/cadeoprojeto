// UI: controlador principal das telas
import { $, $$, DateFilter, addWeeks, colorFromString, escapeHtml, fmtDateFull, fmtDateShort, initials, mondayOf, physicalProgress, today } from './helpers.js';
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
