// Telas Projetos e Permissões: criação, edição, compartilhamento e convites
import { DB, setupRealtime } from './db.js';
import { Dialog } from './dialog.js';
import { _EAP_BUILTINS } from './eap-templates.js';
import { friendlyError, setLoading, toast } from './feedback.js';
import { $, addDays, colorFromString, escapeHtml, fmtDateFull, initials, today } from './helpers.js';
import { Modal } from './modal.js';
import { State } from './state.js';
import { UI } from './ui.js';
import { Views } from './views.js';

// Plugado em Views: continuam acessíveis como Views.<método> e this.<método>.
Object.assign(Views, {
  projects() {
    return `
      <div class="page-title-block"><div class="page-eyebrow">PORTFÓLIO</div><div class="page-title">Todos os Projetos</div><div class="page-subtitle">${State.projects.length} ${State.projects.length === 1 ? 'projeto cadastrado' : 'projetos cadastrados'}</div></div>
      <div class="team-grid">
        ${State.projects.map(p => {
          const isCurrent = p.id === State.currentProjectId;
          const isAdmin = p.owner_id === State.user.id;
          const myRole = DB.getMyRoleInProject(p.id);
          const roleLabel = { editor: 'editor', commenter: 'comentarista', viewer: 'visualizador' }[myRole] || 'visualizador';
          const roleColor = myRole === 'editor' ? 'var(--accent-warm)' : (myRole === 'commenter' ? 'var(--accent)' : 'var(--ink-soft)');
          const roleBg = myRole === 'editor' ? 'rgba(212,168,44,0.12)' : (myRole === 'commenter' ? 'rgba(229,75,26,0.12)' : 'rgba(155,168,190,0.12)');
          return `
            <div class="member-card project-card" data-project-card data-id="${p.id}" title="Duplo-clique para abrir o projeto" style="cursor:pointer;${isCurrent ? 'border-color:var(--accent);' : ''}">
              <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;">
                <div style="font-family:var(--font-mono);font-size:11px;color:var(--ink-mute);">PROJETO · ${p.id.slice(0,4).toUpperCase()}</div>
                <div style="display:flex;gap:6px;">
                  ${isAdmin
                    ? '<div style="font-family:var(--font-mono);font-size:10px;color:var(--accent);background:rgba(229,75,26,0.12);padding:2px 8px;border-radius:2px;text-transform:uppercase;letter-spacing:0.1em;font-weight:700;">ADMIN</div>'
                    : `<div style="font-family:var(--font-mono);font-size:10px;color:${roleColor};background:${roleBg};padding:2px 8px;border-radius:2px;text-transform:uppercase;letter-spacing:0.1em;">${roleLabel}</div>`
                  }
                  ${isCurrent ? '<div style="font-family:var(--font-mono);font-size:10px;color:var(--accent);background:rgba(229,75,26,0.1);padding:2px 8px;border-radius:2px;">ATIVO</div>' : ''}
                </div>
              </div>
              <div class="member-name">${escapeHtml(p.name)}</div>
              <div style="color:var(--ink-soft);font-size:12px;margin-top:4px;">${escapeHtml(p.client || 'Sem cliente')}</div>
              <div style="margin-top:14px;font-family:var(--font-mono);font-size:11px;color:var(--ink-mute);">
                ${fmtDateFull(p.start_date)} → ${fmtDateFull(p.end_date)}
              </div>
              <div class="member-actions">
                ${!isCurrent ? `<button class="icon-btn" data-action="switch-project" data-id="${p.id}" title="Abrir projeto"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg></button>` : ''}
                ${isAdmin ? `<button class="icon-btn" data-action="share-project" data-id="${p.id}" title="Administrar equipe e acessos"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><line x1="23" y1="11" x2="17" y2="11"/><line x1="20" y1="8" x2="20" y2="14"/></svg></button>` : ''}
                ${isAdmin ? `<button class="icon-btn" data-action="edit-project" data-id="${p.id}" title="Editar projeto"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg></button>` : ''}
                ${isAdmin ? `<button class="icon-btn" data-action="duplicate-project" data-id="${p.id}" title="Duplicar projeto"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg></button>` : ''}
                ${isAdmin ? `<button class="icon-btn danger" data-action="delete-project" data-id="${p.id}" title="Excluir projeto"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M10 11v6"/><path d="M14 11v6"/></svg></button>` : ''}
              </div>
            </div>
          `;
        }).join('')}
      </div>
    `;
  },

  // ============================================================================
  // PERMISSÕES — gerenciamento de papéis (dono e administrador)
  // ============================================================================
  permissions() {
    if (!DB.iAmAdmin()) {
      return `
        <div class="empty-state" style="margin-top:80px;">
          <div class="empty-state-icon">🔒</div>
          <div class="empty-state-title">Acesso restrito</div>
          <div class="empty-state-sub">Apenas administradores e donos podem acessar esta página.</div>
        </div>
      `;
    }

    const proj = State.projects.find(p => p.id === State.currentProjectId);
    if (!proj) return this.emptyProject();

    // Combina dono + compartilhados em uma lista única
    const ownerProfile = State.profile; // O dono é sempre o usuário atual aqui
    const members = State.shares.filter(s => s.project_id === proj.id);

    const ROLE_INFO = {
      owner: { label: 'Dono', color: 'var(--accent-warm)', desc: 'Controle total · pode excluir o projeto e gerenciar permissões' },
      admin: { label: 'Administrador', color: 'var(--accent-danger)', desc: 'Pode criar, modificar e excluir tarefas/disciplinas/entregáveis' },
      editor: { label: 'Editor', color: 'var(--accent)', desc: 'Pode criar e modificar conteúdo (não pode excluir)' },
      commenter: { label: 'Comentarista', color: 'var(--accent-success)', desc: 'Pode ver tudo e postar comentários' },
      viewer: { label: 'Visualizador', color: 'var(--ink-soft)', desc: 'Acesso apenas para leitura' },
    };

    return `
      <div class="page-title-block">
        <div class="page-eyebrow">PROJETO · ${escapeHtml(proj.name)}</div>
        <div class="page-title">Permissões</div>
        <div class="page-subtitle">Gerencie quem tem acesso e o que cada pessoa pode fazer.</div>
      </div>

      <!-- HIERARQUIA DE PAPÉIS — referência rápida -->
      <div class="panel" style="margin-bottom:14px;">
        <div class="panel-head"><div class="panel-title">Níveis de Acesso</div></div>
        <div class="panel-body">
          <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:12px;">
            ${Object.entries(ROLE_INFO).map(([key, info]) => `
              <div style="padding:10px;border-left:3px solid ${info.color};background:var(--bg-deep);border-radius:2px;">
                <div style="font-family:var(--font-mono);font-size:10px;color:${info.color};text-transform:uppercase;letter-spacing:0.1em;margin-bottom:4px;">${info.label}</div>
                <div style="font-size:11px;color:var(--ink-soft);line-height:1.4;">${info.desc}</div>
              </div>
            `).join('')}
          </div>
        </div>
      </div>

      <!-- LISTA DE MEMBROS DO PROJETO (alocados) -->
      <div class="panel">
        <div class="panel-head">
          <div class="panel-title">Membros do Projeto</div>
          <div class="panel-title-mono">${(() => { const others = State.allocations.filter(a => { const tm = State.teamMembers.find(m => m.id === a.team_member_id); return tm && !((tm.user_id && tm.user_id === State.user.id) || (tm.email && tm.email.toLowerCase() === State.user.email.toLowerCase())); }); return (others.length + 1) + ' ' + (others.length === 0 ? 'pessoa' : 'pessoas'); })()}</div>
        </div>
        <div class="panel-body" style="padding:0;">
          <!-- DONO (sempre presente) -->
          <div style="display:flex;align-items:center;gap:12px;padding:14px 20px;border-bottom:1px solid var(--border);background:rgba(212,168,44,0.04);">
            <div style="width:36px;height:36px;border-radius:50%;background:${colorFromString(ownerProfile?.full_name || State.user.email)};color:#fff;display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:700;flex-shrink:0;">${initials(ownerProfile?.full_name || State.user.email)}</div>
            <div style="flex:1;min-width:0;">
              <div style="font-size:13px;font-weight:600;">${escapeHtml(ownerProfile?.full_name || 'Você')}</div>
              <div style="font-family:var(--font-mono);font-size:10px;color:var(--ink-mute);margin-top:2px;">${escapeHtml(State.user.email)}</div>
            </div>
            <div style="font-family:var(--font-mono);font-size:10px;color:${ROLE_INFO.owner.color};background:rgba(212,168,44,0.12);padding:4px 10px;border-radius:2px;text-transform:uppercase;letter-spacing:0.1em;font-weight:700;">
              ${ROLE_INFO.owner.label}
            </div>
            <div style="width:42px;"></div>
          </div>

          <!-- MEMBROS ALOCADOS -->
          ${State.allocations.length === 0 ? `
            <div style="padding:30px 20px;text-align:center;color:var(--ink-mute);font-size:13px;">
              Nenhum membro alocado neste projeto ainda.<br>
              <span style="font-size:11px;font-family:var(--font-mono);">Use o botão "Alocar Membro" acima para adicionar pessoas da sua equipe.</span>
            </div>
          ` : State.allocations.map(a => {
            const tm = State.teamMembers.find(m => m.id === a.team_member_id);
            if (!tm) return '';
            // Oculta o dono — já aparece na linha fixa de DONO acima
            if ((tm.user_id && tm.user_id === State.user.id) ||
                (tm.email && tm.email.toLowerCase() === State.user.email.toLowerCase())) return '';
            const info = ROLE_INFO[a.role] || ROLE_INFO.viewer;
            return `
              <div style="display:flex;align-items:center;gap:12px;padding:14px 20px;border-bottom:1px solid var(--border);">
                <div style="width:36px;height:36px;border-radius:50%;background:${colorFromString(tm.name)};color:#fff;display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:700;flex-shrink:0;">${initials(tm.name)}</div>
                <div style="flex:1;min-width:0;">
                  <div style="font-size:13px;font-weight:600;">${escapeHtml(tm.name)}</div>
                  <div style="font-family:var(--font-mono);font-size:10px;color:var(--ink-mute);margin-top:2px;">${escapeHtml(tm.role_title || tm.email || '')}</div>
                </div>
                ${DB.iAmOwner() ? `
                <select class="form-input" style="width:170px;font-size:12px;padding:6px 10px;" data-alloc-id="${a.id}" data-action="perm-change-alloc-role">
                  <option value="viewer" ${a.role === 'viewer' ? 'selected' : ''}>Visualizador</option>
                  <option value="commenter" ${a.role === 'commenter' ? 'selected' : ''}>Comentarista</option>
                  <option value="editor" ${a.role === 'editor' ? 'selected' : ''}>Editor</option>
                  <option value="admin" ${a.role === 'admin' ? 'selected' : ''}>Administrador</option>
                </select>
                <button class="icon-btn danger" data-action="perm-remove-alloc" data-id="${a.id}" title="Remover do projeto">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                </button>` : `
                <div style="font-family:var(--font-mono);font-size:10px;color:${info.color};background:color-mix(in srgb,${info.color} 12%,transparent);padding:4px 10px;border-radius:2px;text-transform:uppercase;letter-spacing:0.1em;font-weight:700;">${info.label}</div>
                <div style="width:42px;"></div>`}
              </div>
            `;
          }).join('')}
        </div>
      </div>
    `;
  },
});

// Plugado em UI: continuam acessíveis como UI.<método> e this.<método>.
Object.assign(UI, {
  // ===== APPROVAL MODAL =====

  openNewProjectModal() {
    const tpls = [..._EAP_BUILTINS, ...(State.eapTemplates || [])];
    Modal.open({
      title: 'Novo Projeto',
      body: `
        <form id="projectForm">
          <div class="form-group"><label class="form-label">Nome do projeto</label><input class="form-input" name="name" required placeholder="Ex.: Edifício Atlântico"></div>
          <div class="form-group"><label class="form-label">Cliente</label><input class="form-input" name="client" placeholder="Ex.: Empresa XYZ"></div>
          <div class="form-row">
            <div class="form-group"><label class="form-label">Início</label><input class="form-input" name="start_date" type="date" required value="${today()}"></div>
            <div class="form-group"><label class="form-label">Término previsto</label><input class="form-input" name="end_date" type="date" required value="${addDays(today(), 60)}"></div>
          </div>
          <div class="form-group">
            <label class="form-label">Modelo de EAP (opcional)</label>
            <select class="form-input" id="projTemplateSel">
              <option value="">Em branco — começar sem tarefas</option>
              ${tpls.map(t => `<option value="${t.id}">${escapeHtml(t.name)}${t._builtin ? ' · integrado' : ''} (${(t.items || []).length} tarefas)</option>`).join('')}
            </select>
            <div style="font-size:11px;color:var(--ink-mute);margin-top:4px;">As tarefas do modelo serão criadas automaticamente no novo projeto.</div>
          </div>
          <div style="margin-top:12px;padding-top:12px;border-top:1px dashed var(--border);">
            <div style="display:flex;gap:6px;flex-wrap:wrap;">
              <button type="button" class="btn btn-secondary" id="btnNewProjImportMspx" style="font-size:11px;border-color:var(--accent-warm);color:var(--accent-warm);">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:14px;height:14px;"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
                Importar de MS Project (.xml)
              </button>
              <button type="button" class="btn btn-secondary" id="btnNewProjImportPrev" style="font-size:11px;border-color:#1f3a8a;color:#1f3a8a;">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:14px;height:14px;"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
                Importar de Prevision (.xlsx)
              </button>
            </div>
            <div style="font-size:11px;color:var(--ink-mute);margin-top:4px;">Cria o projeto com os dados acima e já abre o seletor do arquivo para importar tarefas, hierarquia, datas, baseline e dependências.</div>
          </div>
        </form>
      `,
      footer: `<button class="btn btn-secondary" id="btnCancelProj">Cancelar</button><button class="btn btn-cta" id="btnSaveProj">Criar</button>`
    });
    // Cria o projeto a partir do formulário (compartilhado por "Criar" e "Importar MSPX")
    const _createFromForm = async () => {
      const form = $('#projectForm');
      if (!form.reportValidity()) return null;
      const data = Object.fromEntries(new FormData(form).entries());
      const created = await DB.createProject(data);
      State.projects.unshift(created);
      State.currentProjectId = created.id;
      await DB.loadCurrentProject();
      setupRealtime();
      return { created, data };
    };
    $('#btnNewProjImportMspx').onclick = async () => {
      try {
        setLoading(true);
        const res = await _createFromForm();
        if (!res) return;
        Modal.close();
        State.currentView = 'gantt'; UI.setActiveNav('gantt');
        await UI.render();
        toast('Projeto criado — selecione o arquivo do MS Project', 'success');
        UI.importMSProjectXML();
      } catch (err) { toast(friendlyError(err), 'error'); }
      finally { setLoading(false); }
    };
    $('#btnNewProjImportPrev').onclick = async () => {
      try {
        setLoading(true);
        const res = await _createFromForm();
        if (!res) return;
        Modal.close();
        State.currentView = 'gantt'; UI.setActiveNav('gantt');
        await UI.render();
        toast('Projeto criado — selecione o arquivo do Prevision', 'success');
        UI.importPrevisionXLSX();
      } catch (err) { toast(friendlyError(err), 'error'); }
      finally { setLoading(false); }
    };
    $('#btnCancelProj').onclick = () => Modal.close();
    $('#btnSaveProj').onclick = async function() {
      const tplId = $('#projTemplateSel') ? $('#projTemplateSel').value : '';
      const data = Object.fromEntries(new FormData($('#projectForm')).entries());
      this.disabled = true; const _orig = this.textContent; this.textContent = 'Criando…';
      try {
        setLoading(true);
        const created = await DB.createProject(data);
        State.projects.unshift(created);
        State.currentProjectId = created.id;
        await DB.loadCurrentProject();
        setupRealtime();
        Modal.close();
        State.currentView = 'dashboard'; UI.setActiveNav('dashboard');
        await UI.render();
        toast('Projeto criado', 'success');
        // Aplica o modelo de EAP escolhido (sem confirmação extra — já foi escolhido aqui)
        if (tplId) {
          const tpl = [..._EAP_BUILTINS, ...(State.eapTemplates || [])].find(t => t.id === tplId);
          if (tpl && (tpl.items || []).length) {
            await UI.applyEapTemplate(tpl.items, data.start_date, 1, false, true, true);
          }
        }
      } catch (err) { toast(friendlyError(err), 'error'); this.disabled = false; this.textContent = _orig; }
      finally { setLoading(false); }
    };
  },

  openProjectEditModal(id) {
    const p = State.projects.find(x => x.id === id);
    if (!p) return;
    Modal.open({
      title: 'Editar Projeto',
      body: `
        <form id="projectEditForm">
          <div class="form-group"><label class="form-label">Nome</label><input class="form-input" name="name" required value="${escapeHtml(p.name)}"></div>
          <div class="form-group"><label class="form-label">Cliente</label><input class="form-input" name="client" value="${escapeHtml(p.client || '')}"></div>
          <div class="form-row">
            <div class="form-group"><label class="form-label">Início</label><input class="form-input" name="start_date" type="date" value="${p.start_date}"></div>
            <div class="form-group"><label class="form-label">Término</label><input class="form-input" name="end_date" type="date" value="${p.end_date}"></div>
          </div>
          <div class="form-group"><label class="form-label">Status</label>
            <select class="form-input" name="status">
              <option value="planejamento" ${p.status === 'planejamento' ? 'selected' : ''}>Planejamento</option>
              <option value="em_andamento" ${p.status === 'em_andamento' ? 'selected' : ''}>Em Andamento</option>
              <option value="pausado" ${p.status === 'pausado' ? 'selected' : ''}>Pausado</option>
              <option value="concluido" ${p.status === 'concluido' ? 'selected' : ''}>Concluído</option>
            </select>
          </div>
        </form>
      `,
      footer: `<button class="btn btn-secondary" id="btnCancelEdit">Cancelar</button><button class="btn btn-cta" id="btnSaveEdit">Salvar</button>`
    });
    $('#btnCancelEdit').onclick = () => Modal.close();
    $('#btnSaveEdit').onclick = async () => {
      const data = Object.fromEntries(new FormData($('#projectEditForm')).entries());
      try {
        setLoading(true);
        await DB.updateProject(id, data);
        Object.assign(p, data);
        Modal.close();
        await UI.render();
        toast('Projeto atualizado', 'success');
      } catch (err) { toast(friendlyError(err), 'error'); }
      finally { setLoading(false); }
    };
  },

  async deleteProject(id) {
    if (!await Dialog.confirm({ title: 'Excluir projeto', msg: 'Excluir este projeto e todas as suas tarefas?\n\nEsta ação é irreversível e não pode ser desfeita.', confirmText: 'Excluir projeto', danger: true })) return;
    try {
      setLoading(true);
      await DB.deleteProject(id);
      State.projects = State.projects.filter(p => p.id !== id);
      if (State.currentProjectId === id) {
        State.currentProjectId = State.projects[0]?.id || null;
        await DB.loadCurrentProject();
        setupRealtime();
      }
      await UI.render();
      toast('Projeto excluído', 'success');
    } catch (err) { toast(friendlyError(err), 'error'); }
    finally { setLoading(false); }
  },

  async duplicateProject(id) {
    const src = State.projects.find(p => p.id === id);
    if (!src) return;
    if (!await Dialog.confirm({
      title: 'Duplicar projeto',
      msg: `Criar uma cópia de "${src.name}" com todas as tarefas, dependências, disciplinas, restrições, RACI e etiquetas?\n\nVocê será o dono da cópia.`,
      confirmText: 'Duplicar projeto'
    })) return;
    try {
      setLoading(true);
      const data = await DB.exportProjectFull(id);
      const newProj = await DB.importProjectFull(data, null, ' (cópia)');
      State.projects = await DB.listProjects();
      await UI.render();
      toast('Projeto duplicado: ' + escapeHtml(newProj.name), 'success');
    } catch (err) { toast('Erro ao duplicar: ' + err.message, 'error'); }
    finally { setLoading(false); }
  },

  // Modal de confirmação de exclusão (digita o nome do projeto)
  confirmDeleteProject(projectId) {
    const proj = State.projects.find(p => p.id === projectId);
    if (!proj) return;
    Modal.open({
      title: 'Excluir projeto?',
      body: `
        <div style="padding:14px;background:rgba(193,59,18,0.08);border:1px solid var(--accent-danger);border-radius:3px;margin-bottom:14px;">
          <div style="font-size:13px;color:var(--accent-danger);font-weight:600;margin-bottom:6px;">⚠ Esta ação é PERMANENTE e não pode ser desfeita.</div>
          <div style="font-size:12px;color:var(--ink-soft);line-height:1.5;">
            Serão excluídos: <strong>todas as tarefas, disciplinas, entregáveis, comentários, dependências, baseline e revisões</strong> deste projeto.
            Os usuários compartilhados perderão acesso imediatamente.
          </div>
        </div>
        <div class="form-group">
          <label class="form-label">Para confirmar, digite o nome exato do projeto:</label>
          <div style="font-family:var(--font-mono);font-size:12px;color:var(--ink-mute);margin-bottom:6px;">${escapeHtml(proj.name)}</div>
          <input type="text" id="deleteConfirmInput" class="form-input" placeholder="Digite aqui o nome do projeto" autocomplete="off">
        </div>
      `,
      footer: `
        <button class="btn btn-secondary" id="btnCancelDelete">Cancelar</button>
        <button class="btn btn-cta" style="background:var(--accent-danger);color:#fff;" id="btnConfirmDelete" disabled>Excluir permanentemente</button>
      `
    });
    const input = $('#deleteConfirmInput');
    const btn = $('#btnConfirmDelete');
    // Comparação tolerante: ignora caixa, acentos e espaços extras (o nome pode
    // aparecer em CAIXA ALTA em outros lugares por CSS, confundindo a digitação).
    const norm = (s) => (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '')
      .replace(/\s+/g, ' ').trim().toLowerCase();
    const matches = () => norm(input.value) === norm(proj.name) && input.value.trim() !== '';
    input.oninput = () => { btn.disabled = !matches(); };
    input.onkeydown = (e) => { if (e.key === 'Enter' && matches()) { e.preventDefault(); btn.click(); } };
    $('#btnCancelDelete').onclick = () => UI.openShareModal(projectId);
    btn.onclick = async () => {
      try {
        setLoading(true);
        await DB.deleteProject(projectId);
        State.projects = State.projects.filter(p => p.id !== projectId);
        if (State.currentProjectId === projectId) {
          State.currentProjectId = State.projects[0]?.id || null;
          if (State.currentProjectId) await DB.loadCurrentProject();
        }
        Modal.close();
        await UI.render();
        toast('Projeto excluído', 'success');
      } catch (err) { toast(friendlyError(err), 'error'); }
      finally { setLoading(false); }
    };
  },

  // ===== CRIAR PROJETO DEMO =====
  async createDemoProject() {
    if (!await Dialog.confirm({ title: 'Criar projeto demo', msg: 'Criar o projeto demonstração "Edifício Atlântico"?\n\nVocê poderá excluí-lo a qualquer momento depois.', confirmText: 'Criar demo' })) return;
    try {
      setLoading(true);
      await DB.createSeedProject();
      State.projects = await DB.listProjects();
      State.currentProjectId = State.projects[State.projects.length - 1]?.id || State.currentProjectId;
      await DB.loadCurrentProject();
      await UI.render();
      toast('Projeto demo criado', 'success');
    } catch (err) {
      toast('Erro ao criar demo: ' + err.message, 'error');
    } finally { setLoading(false); }
  },

  // ===== COMPARTILHAMENTO =====
  async openShareModal(projectId) {
    const proj = State.projects.find(p => p.id === projectId);
    if (!proj) return;
    if (proj.owner_id !== State.user.id) {
      toast('Apenas o admin (dono) pode gerenciar este projeto', 'error');
      return;
    }
    let shares = [], invites = [];
    try {
      [shares, invites] = await Promise.all([
        DB.listShares(projectId),
        DB.listInvites(projectId).catch(() => []), // silencioso se migration não rodou
      ]);
    } catch (e) {
      let msg = e.message;
      if (msg.includes('project_shares') && msg.includes('does not exist'))
        msg = 'Tabela ainda não existe — rode 08-migration-v3.6.sql';
      toast(msg, 'error');
      return;
    }

    const ownerName = State.profile?.full_name || State.user.email;
    const roleLabel = { viewer: 'Visualizador', commenter: 'Comentarista', editor: 'Editor', admin: 'Administrador' };

    const renderRoleSelect = (shareId, currentRole, action) => `
      <select class="form-input" style="width:140px;font-size:12px;padding:4px 8px;flex-shrink:0;"
        data-share-id="${shareId}" data-action="${action}">
        <option value="viewer"    ${currentRole === 'viewer'    ? 'selected' : ''}>Visualizador</option>
        <option value="commenter" ${currentRole === 'commenter' ? 'selected' : ''}>Comentarista</option>
        <option value="editor"    ${currentRole === 'editor'    ? 'selected' : ''}>Editor</option>
        <option value="admin"     ${currentRole === 'admin'     ? 'selected' : ''}>Administrador</option>
      </select>`;

    Modal.open({
      title: 'Administração · ' + escapeHtml(proj.name),
      body: `
        <div style="font-size:13px;color:var(--ink-soft);margin-bottom:14px;">
          Você é o <strong style="color:var(--accent);">administrador</strong> deste projeto.
          Convites enviados por e-mail chegam mesmo para quem ainda não tem conta.
        </div>

        <!-- Dono -->
        <div style="margin-bottom:14px;padding:10px 12px;background:var(--bg-deep);border:1px solid var(--accent);border-radius:3px;">
          <div style="display:flex;align-items:center;gap:10px;">
            <div style="width:28px;height:28px;border-radius:50%;background:${colorFromString(ownerName)};color:#fff;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;">${initials(ownerName)}</div>
            <div style="flex:1;min-width:0;">
              <div style="font-size:13px;font-weight:600;">${escapeHtml(ownerName)}</div>
              <div style="font-family:var(--font-mono);font-size:10px;color:var(--ink-mute);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(State.user.email)}</div>
            </div>
            <div style="font-family:var(--font-mono);font-size:10px;color:var(--accent);background:rgba(229,75,26,0.12);padding:3px 10px;border-radius:2px;text-transform:uppercase;letter-spacing:0.12em;font-weight:700;flex-shrink:0;">ADMIN</div>
          </div>
        </div>

        <!-- Formulário de convite -->
        <div style="margin-bottom:18px;padding-top:12px;border-top:1px solid var(--border);">
          <label class="form-label">Convidar colaborador por e-mail</label>
          <div style="display:flex;gap:8px;flex-wrap:wrap;">
            <input type="email" id="shareEmailInput" class="form-input" placeholder="email@exemplo.com" style="flex:1;min-width:180px;" autocomplete="off">
            <select id="shareRoleInput" class="form-input" style="width:150px;">
              <option value="viewer">Visualizador</option>
              <option value="commenter">Comentarista</option>
              <option value="editor" selected>Editor</option>
              <option value="admin">Administrador</option>
            </select>
            <button class="btn btn-cta" id="btnSendInvite" style="white-space:nowrap;">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:14px;height:14px;margin-right:5px;vertical-align:-2px;"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
              Enviar convite
            </button>
          </div>
          <div style="font-family:var(--font-mono);font-size:10px;color:var(--ink-mute);margin-top:8px;line-height:1.7;">
            <span style="color:var(--accent-danger);font-weight:600;">Admin</span> · exclui tarefas e gerencia equipe.
            <span style="color:var(--accent);font-weight:600;">Editor</span> · cria e edita.
            <span style="color:var(--accent-warm);font-weight:600;">Comentarista</span> · vê e comenta.
            <span style="color:var(--ink-soft);font-weight:600;">Visualizador</span> · só lê.
          </div>
        </div>

        <!-- Membros com acesso -->
        <div style="margin-bottom:${invites.length > 0 ? '14px' : '0'};">
          <div style="font-family:var(--font-mono);font-size:10px;color:var(--ink-mute);text-transform:uppercase;letter-spacing:0.12em;margin-bottom:8px;">
            Membros com acesso ${shares.length > 0 ? `(${shares.length})` : ''}
          </div>
          <div id="sharesList" style="display:flex;flex-direction:column;gap:6px;">
            ${shares.length === 0
              ? '<div style="color:var(--ink-mute);font-size:12px;font-style:italic;padding:8px 0;">Nenhum membro ainda. Envie um convite acima.</div>'
              : shares.map(s => `
                <div style="display:flex;align-items:center;gap:8px;padding:8px 10px;background:var(--bg-deep);border:1px solid var(--border);border-radius:2px;">
                  <div style="width:26px;height:26px;border-radius:50%;background:${colorFromString(s.invited_email)};color:#fff;display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:700;flex-shrink:0;">${initials(s.invited_email)}</div>
                  <div style="flex:1;min-width:0;font-size:13px;font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${escapeHtml(s.invited_email)}">${escapeHtml(s.invited_email)}</div>
                  ${renderRoleSelect(s.id, s.role, 'change-share-role')}
                  <button class="icon-btn danger" data-action="remove-share" data-id="${s.id}" title="Remover acesso">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                  </button>
                </div>`).join('')
            }
          </div>
        </div>

        <!-- Convites pendentes -->
        ${invites.length > 0 ? `
        <div style="margin-bottom:0;">
          <div style="font-family:var(--font-mono);font-size:10px;color:var(--accent-warm);text-transform:uppercase;letter-spacing:0.12em;margin-bottom:8px;">
            Convites pendentes (${invites.length})
          </div>
          <div style="display:flex;flex-direction:column;gap:6px;">
            ${invites.map(inv => {
              const daysLeft = Math.ceil((new Date(inv.expires_at) - Date.now()) / 86400000);
              return `
              <div style="display:flex;align-items:center;gap:8px;padding:8px 10px;background:var(--bg-deep);border:1px solid var(--accent-warm);border-radius:2px;opacity:.9;">
                <div style="width:26px;height:26px;border-radius:50%;background:#3d2d12;color:var(--accent-warm);display:flex;align-items:center;justify-content:center;font-size:14px;flex-shrink:0;">✉</div>
                <div style="flex:1;min-width:0;">
                  <div style="font-size:13px;font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${escapeHtml(inv.invited_email)}">${escapeHtml(inv.invited_email)}</div>
                  <div style="font-family:var(--font-mono);font-size:10px;color:var(--ink-mute);">${roleLabel[inv.role] || inv.role} · expira em ${daysLeft}d</div>
                </div>
                <button class="btn btn-secondary" style="font-size:11px;padding:3px 10px;color:var(--ink-mute);" data-action="cancel-invite" data-id="${inv.id}" title="Cancelar convite">Cancelar</button>
              </div>`;
            }).join('')}
          </div>
        </div>` : ''}

        <!-- Zona de administração -->
        <div style="margin-top:24px;padding-top:14px;border-top:1px solid var(--border);">
          <div style="font-family:var(--font-mono);font-size:10px;color:var(--accent-danger);text-transform:uppercase;letter-spacing:0.12em;margin-bottom:10px;">Zona de Administração</div>
          <div style="display:flex;flex-direction:column;gap:8px;">
            <button class="btn btn-secondary" id="btnTransferOwnership" style="justify-content:flex-start;text-align:left;color:var(--accent-warm);">
              ↗ Transferir propriedade do projeto
            </button>
            <button class="btn btn-secondary" id="btnDeleteProject" style="justify-content:flex-start;text-align:left;color:var(--accent-danger);">
              ⌫ Excluir projeto permanentemente
            </button>
          </div>
        </div>
      `,
      footer: `<button class="btn btn-cta" id="btnCloseShare">Fechar</button>`
    });
    $('#btnCloseShare').onclick = () => Modal.close();

    // Enviar convite (novo fluxo — não exige conta prévia)
    $('#btnSendInvite').onclick = async () => {
      const email = $('#shareEmailInput').value.trim();
      const role = $('#shareRoleInput').value;
      if (!email) { toast('Digite um e-mail', 'error'); return; }
      const btn = $('#btnSendInvite');
      btn.disabled = true; btn.innerHTML = '<span class="loader"></span> Enviando...';
      try {
        await DB.createInvite(projectId, email, role);
        // Verifica se já tem conta — se sim, o convite aparece direto no app dele
        const registered = await DB.emailIsRegistered(email);
        if (registered === true) {
          toast(`${email} já tem conta — o convite vai aparecer no app dele para aceitar.`, 'success');
        } else if (registered === false) {
          toast(`Convite enviado por e-mail para ${email} (ainda sem conta).`, 'success');
        } else {
          toast(`Convite enviado para ${email}`, 'success');
        }
        UI.openShareModal(projectId);
      } catch (err) {
        toast(friendlyError(err), 'error');
        btn.disabled = false;
        btn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:14px;height:14px;margin-right:5px;vertical-align:-2px;"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>Enviar convite';
      }
    };

    // Alterar papel de membro
    $('#modal').querySelectorAll('[data-action="change-share-role"]').forEach(sel => {
      sel.onchange = async (e) => {
        try {
          await DB.updateShareRole(sel.dataset.shareId, e.target.value);
          const s = State.shares.find(x => x.id === sel.dataset.shareId);
          if (s) s.role = e.target.value;
          toast('Papel atualizado', 'success');
        } catch (err) { toast(friendlyError(err), 'error'); }
      };
    });

    // Remover membro com acesso
    $('#modal').querySelectorAll('[data-action="remove-share"]').forEach(btn => {
      btn.onclick = async () => {
        if (!await Dialog.confirm({ title: 'Remover da equipe', msg: 'Remover esta pessoa da equipe do projeto?', confirmText: 'Remover', danger: true })) return;
        try {
          await DB.deleteShare(btn.dataset.id);
          State.shares = State.shares.filter(s => s.id !== btn.dataset.id);
          UI.openShareModal(projectId);
          toast('Acesso removido', 'success');
        } catch (err) { toast(friendlyError(err), 'error'); }
      };
    });

    // Cancelar convite pendente
    $('#modal').querySelectorAll('[data-action="cancel-invite"]').forEach(btn => {
      btn.onclick = async () => {
        if (!await Dialog.confirm({ title: 'Cancelar convite', msg: 'Cancelar este convite? O link de acesso será invalidado.', confirmText: 'Cancelar convite', danger: true })) return;
        try {
          await DB.cancelInvite(btn.dataset.id);
          toast('Convite cancelado', 'success');
          UI.openShareModal(projectId);
        } catch (err) { toast(friendlyError(err), 'error'); }
      };
    });

    $('#btnTransferOwnership').onclick = () => UI.openTransferOwnershipModal(projectId);
    $('#btnDeleteProject').onclick = () => UI.confirmDeleteProject(projectId);
  },

  // ===== PERMISSÕES (view dedicada) =====
  async openInviteModal() {
    if (!DB.iAmOwner()) { toast('Apenas o dono pode convidar', 'error'); return; }
    Modal.open({
      title: 'Convidar colaborador',
      body: `
        <div style="font-size:13px;color:var(--ink-soft);margin-bottom:14px;">
          Um e-mail de convite será enviado. A pessoa pode criar conta ao clicar no link —
          não é necessário ter conta prévia.
        </div>
        <div class="form-group">
          <label class="form-label">E-mail</label>
          <input type="email" id="inviteEmail" class="form-input" placeholder="email@exemplo.com" required autocomplete="off">
        </div>
        <div class="form-group">
          <label class="form-label">Nível de acesso</label>
          <select id="inviteRole" class="form-input">
            <option value="viewer">Visualizador — apenas lê</option>
            <option value="commenter">Comentarista — pode comentar</option>
            <option value="editor" selected>Editor — pode criar e modificar</option>
            <option value="admin">Administrador — pode também excluir</option>
          </select>
        </div>
      `,
      footer: `
        <button class="btn btn-secondary" id="btnCancelInvite">Cancelar</button>
        <button class="btn btn-cta" id="btnSendInviteForm">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:13px;height:13px;margin-right:5px;vertical-align:-1px;"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
          Enviar convite
        </button>
      `
    });
    $('#btnCancelInvite').onclick = () => Modal.close();
    $('#btnSendInviteForm').onclick = async () => {
      const email = $('#inviteEmail').value.trim();
      const role = $('#inviteRole').value;
      if (!email) { toast('Digite um e-mail', 'error'); return; }
      const btn = $('#btnSendInviteForm');
      const origHtml = btn.innerHTML;
      btn.disabled = true; btn.innerHTML = '<span class="loader"></span> Enviando...';
      try {
        await DB.createInvite(State.currentProjectId, email, role);
        Modal.close();
        await UI.render();
        toast(`Convite enviado para ${email}`, 'success');
      } catch (err) {
        toast(friendlyError(err), 'error');
        btn.disabled = false; btn.innerHTML = origHtml;
      }
    };
  },

  async changeShareRole(shareId, newRole) {
    try {
      await DB.updateShareRole(shareId, newRole);
      const s = State.shares.find(x => x.id === shareId);
      if (s) s.role = newRole;
      const labels = { viewer: 'Visualizador', commenter: 'Comentarista', editor: 'Editor', admin: 'Administrador' };
      toast(`Permissão alterada para "${labels[newRole]}"`, 'success');
    } catch (err) { toast(friendlyError(err), 'error'); await UI.render(); }
  },

  async removeShare(shareId) {
    const s = State.shares.find(x => x.id === shareId);
    if (!s) return;
    if (!await Dialog.confirm({ title: 'Revogar acesso', msg: `Remover o acesso de ${s.invited_email} a este projeto?\n\nA pessoa não conseguirá mais visualizá-lo.`, confirmText: 'Revogar', danger: true })) return;
    try {
      setLoading(true);
      await DB.deleteShare(shareId);
      State.shares = State.shares.filter(x => x.id !== shareId);
      await UI.render();
      toast('Acesso removido', 'success');
    } catch (err) { toast(friendlyError(err), 'error'); }
    finally { setLoading(false); }
  },

  // Modal de transferência de propriedade
  openTransferOwnershipModal(projectId) {
    const proj = State.projects.find(p => p.id === projectId);
    if (!proj) return;
    Modal.open({
      title: 'Transferir propriedade · ' + proj.name,
      body: `
        <div style="font-size:13px;color:var(--ink-soft);margin-bottom:14px;">
          Esta ação transfere a propriedade do projeto para outro usuário.
          O novo dono se torna o <strong style="color:var(--accent);">administrador</strong>.
          Você continuará com acesso como <strong>editor</strong>.
        </div>
        <div style="padding:12px;background:rgba(212,168,44,0.08);border:1px solid var(--accent-warm);border-radius:3px;margin-bottom:14px;font-size:12px;color:var(--ink-soft);">
          ⚠ <strong>Atenção:</strong> uma vez transferido, você não poderá mais excluir o projeto ou gerenciar usuários.
        </div>
        <div class="form-group">
          <label class="form-label">E-mail do novo administrador</label>
          <input type="email" id="newOwnerEmail" class="form-input" placeholder="novo-admin@exemplo.com">
          <div style="font-family:var(--font-mono);font-size:10px;color:var(--ink-mute);margin-top:4px;">
            A pessoa precisa ter conta no CadêOProjeto.
          </div>
        </div>
      `,
      footer: `
        <button class="btn btn-secondary" id="btnCancelTransfer">Cancelar</button>
        <button class="btn btn-cta" style="background:var(--accent-warm);color:#11161f;" id="btnConfirmTransfer">Transferir propriedade</button>
      `
    });
    $('#btnCancelTransfer').onclick = () => UI.openShareModal(projectId);
    $('#btnConfirmTransfer').onclick = async () => {
      const email = $('#newOwnerEmail').value.trim();
      if (!email) { toast('Digite o e-mail', 'error'); return; }
      if (!await Dialog.confirm({ title: 'Transferir propriedade', msg: `Transferir definitivamente "${proj.name}" para ${email}?\n\nVocê perderá os privilégios de admin do projeto.`, confirmText: 'Transferir', danger: true })) return;
      try {
        setLoading(true);
        await DB.transferOwnership(projectId, email);
        State.projects = await DB.listProjects();
        State.shares = await DB.listShares(projectId);
        State.myRole = DB.getMyRoleInProject(projectId);
        Modal.close();
        await UI.render();
        toast('Propriedade transferida com sucesso', 'success');
      } catch (err) { toast(friendlyError(err), 'error'); }
      finally { setLoading(false); }
    };
  },

  async removeAllocation(allocId) {
    const a = State.allocations.find(x => x.id === allocId);
    if (!a) return;
    const tm = State.teamMembers.find(m => m.id === a.team_member_id);
    const proj = Views.current();
    if (!DB.iAmOwner()) { toast('Só o dono do projeto pode remover membros', 'error'); return; }
    if (proj && tm && tm.user_id === proj.owner_id) { toast('O dono do projeto não pode ser removido', 'error'); return; }
    if (!await Dialog.confirm({ title: 'Remover do projeto', msg: `Remover ${tm?.name || 'este membro'} deste projeto?\n\nO cadastro global permanece intacto.`, confirmText: 'Remover', danger: true })) return;
    try {
      setLoading(true);
      await DB.removeAllocation(allocId);
      State.allocations = State.allocations.filter(x => x.id !== allocId);
      DB.computeMembers();
      await UI.render();
      toast('Membro removido do projeto', 'success');
    } catch (err) { toast(friendlyError(err), 'error'); }
    finally { setLoading(false); }
  },

  // ===== CONVITES DE PROJETO PENDENTES (in-app) =====
  renderPendingInvitesBanner() {
    const existing = document.getElementById('pendingInvitesBanner');
    if (existing) existing.remove();
    const invites = State.myPendingInvites || [];
    if (invites.length === 0) return;
    const banner = document.createElement('div');
    banner.id = 'pendingInvitesBanner';
    banner.style.cssText = 'grid-column:1 / -1;background:linear-gradient(90deg, rgba(31,58,138,0.10), rgba(31,58,138,0.03));border-bottom:1px solid var(--blueprint);padding:10px 18px;display:flex;flex-direction:column;gap:8px;';
    banner.innerHTML = `
      <div style="display:flex;align-items:center;gap:10px;font-size:12px;">
        <span style="font-size:16px;">📨</span>
        <strong style="color:var(--ink);">Você tem ${invites.length} convite${invites.length > 1 ? 's' : ''} de projeto</strong>
      </div>
      <div style="display:flex;flex-direction:column;gap:6px;">
        ${invites.map(inv => `
          <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;background:var(--bg-panel);border:1px solid var(--border);border-radius:4px;padding:8px 12px;">
            <div style="flex:1;min-width:0;font-size:12px;">
              <strong style="color:var(--ink);">${escapeHtml(inv.project_name || 'Projeto')}</strong>
              <span style="color:var(--ink-mute);"> · papel: ${escapeHtml(inv.role || 'viewer')} · convidado por ${escapeHtml(inv.invited_by_name || '—')}</span>
            </div>
            <div style="display:flex;gap:6px;flex-shrink:0;">
              <button class="btn btn-ghost" data-action="decline-invite" data-token="${inv.token}" style="font-size:11px;padding:4px 12px;">Recusar</button>
              <button class="btn btn-cta" data-action="accept-invite" data-token="${inv.token}" style="font-size:11px;padding:4px 14px;">Aceitar</button>
            </div>
          </div>`).join('')}
      </div>`;
    const appEl = $('#app');
    if (appEl) appEl.insertBefore(banner, appEl.firstChild);
    // Bind direto (o banner está fora do #content, não pega a delegação de [data-action])
    banner.querySelectorAll('[data-action="accept-invite"]').forEach(b => { b.onclick = () => UI.acceptPendingInvite(b.dataset.token); });
    banner.querySelectorAll('[data-action="decline-invite"]').forEach(b => { b.onclick = () => UI.declinePendingInvite(b.dataset.token); });
  },

  async acceptPendingInvite(token) {
    setLoading(true);
    try {
      const result = await DB.acceptInviteByToken(token);
      if (result?.error) { toast(result.error, 'error'); return; }
      State.projects = await DB.listProjects();
      State.myPendingInvites = await DB.listMyPendingInvites();
      if (result?.project_id) {
        State.currentProjectId = result.project_id;
        await DB.loadCurrentProject();
        setupRealtime();
        State.currentView = 'dashboard'; UI.setActiveNav('dashboard');
      }
      await UI.render();
      UI.renderPendingInvitesBanner();
      toast('Convite aceito! Bem-vindo ao projeto.', 'success');
    } catch (err) { toast('Não foi possível aceitar: ' + err.message, 'error'); }
    finally { setLoading(false); }
  },

  async declinePendingInvite(token) {
    try {
      await DB.declineInvite(token);
      State.myPendingInvites = (State.myPendingInvites || []).filter(i => i.token !== token);
      UI.renderPendingInvitesBanner();
      toast('Convite recusado', 'info');
    } catch (err) { toast('Erro ao recusar: ' + err.message, 'error'); }
  },
});
