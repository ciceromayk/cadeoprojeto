// Tela Equipe: membros do projeto, convites e alocação
import { DB } from './db.js';
import { Dialog } from './dialog.js';
import { friendlyError, setLoading, toast } from './feedback.js';
import { $, colorFromString, escapeHtml, initials } from './helpers.js';
import { Modal } from './modal.js';
import { State } from './state.js';
import { UI } from './ui.js';
import { Views } from './views.js';

// Plugado em Views: continuam acessíveis como Views.<método> e this.<método>.
Object.assign(Views, {
  team() {
    const p = this.current();
    if (!p) return this.emptyProject();
    if (State.members.length === 0) {
      return `
        <div class="page-title-block"><div class="page-eyebrow">EQUIPE</div><div class="page-title">Membros do Projeto</div></div>
        <div class="empty-state" style="background:var(--bg-panel);border:1px solid var(--border);border-radius:3px;">
          <div class="empty-state-icon"><svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg></div>
          <div class="empty-state-title">Nenhum membro no projeto</div>
          <div class="empty-state-sub">Convide usuários por e-mail. Quando aceitarem, entram na equipe e podem receber tarefas.</div>
          <button class="btn btn-cta" data-action="invite-member">+ Convidar Membro</button>
        </div>
      `;
    }
    return `
      <div class="page-title-block"><div class="page-eyebrow">EQUIPE</div><div class="page-title">Membros do Projeto</div><div class="page-subtitle">${State.members.length} ${State.members.length === 1 ? 'pessoa' : 'pessoas'} envolvidas</div></div>
      <div class="team-grid">
        ${State.members.map(m => {
          const tasks = State.tasks.filter(t => t.assignee_id === m.id && !t.inactive);
          const leadDiscs = State.disciplines.filter(d => d.lead_member_id === m.id).length;
          const leadSectors = (State.sectors || []).filter(s => s.lead_member_id === m.id).length;
          const raciCount = State.raci.filter(r => r.member_id === m.id && (r.role === 'R' || r.role === 'A')).length;
          return `
            <div class="member-card">
              <div class="member-avatar-lg" style="background:linear-gradient(135deg, ${colorFromString(m.name)}, ${colorFromString(m.email || m.name)})">${initials(m.name)}</div>
              <div class="member-name">${escapeHtml(m.name)}</div>
              <div class="member-role">${escapeHtml(m.role || 'Membro')}</div>
              <div style="font-size:12px;color:var(--ink-soft);font-family:var(--font-mono);margin-top:6px;">${escapeHtml(m.email || '')}</div>
              ${m.phone ? `<div style="font-size:12px;color:var(--ink-soft);font-family:var(--font-mono);margin-top:2px;">${escapeHtml(m.phone)}</div>` : ''}
              <div class="member-stats">
                <div><div class="member-stat-num">${tasks.length}</div><div class="member-stat-label">Tarefas</div></div>
                <div><div class="member-stat-num" style="color:var(--accent)">${leadDiscs}</div><div class="member-stat-label">Disciplinas</div></div>
                <div><div class="member-stat-num" style="color:var(--blueprint)">${leadSectors}</div><div class="member-stat-label">Setores</div></div>
                <div><div class="member-stat-num" style="color:var(--accent-warm)">${raciCount}</div><div class="member-stat-label">R/A</div></div>
              </div>
              ${DB.iAmOwner() ? `
              <div class="member-actions">
                ${m.user_id === p.owner_id
                  ? `<span style="font-family:var(--font-mono);font-size:9px;color:var(--accent);text-transform:uppercase;letter-spacing:.08em;">★ dono</span>`
                  : `<button class="icon-btn danger" data-action="remove-allocation-member" data-id="${m.id}" title="Remover do projeto"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg></button>`}
              </div>` : ''}
            </div>
          `;
        }).join('')}
      </div>
    `;
  },
});

// Plugado em UI: continuam acessíveis como UI.<método> e this.<método>.
Object.assign(UI, {
  async removeAllocationByMemberId(teamMemberId) {
    const alloc = State.allocations.find(a => a.team_member_id === teamMemberId);
    if (!alloc) return;
    const m = State.teamMembers.find(x => x.id === teamMemberId);
    const proj = Views.current();
    if (!DB.iAmOwner()) { toast('Só o dono do projeto pode remover membros', 'error'); return; }
    if (proj && m && m.user_id === proj.owner_id) { toast('O dono do projeto não pode ser removido', 'error'); return; }
    if (!await Dialog.confirm({ title: 'Remover do projeto', msg: `Remover "${m?.name || 'membro'}" deste projeto?\n\nO cadastro global permanece intacto.`, confirmText: 'Remover', danger: true })) return;
    try {
      setLoading(true);
      await DB.removeAllocation(alloc.id);
      State.allocations = State.allocations.filter(a => a.id !== alloc.id);
      DB.computeMembers();
      State.tasks.forEach(t => { if (t.assignee_id === teamMemberId) t.assignee_id = null; });
      await UI.render();
      toast('Membro removido do projeto', 'success');
    } catch (err) { toast(friendlyError(err), 'error'); }
    finally { setLoading(false); }
  },

  // ===== MINHA EQUIPE — CRUD de membros globais =====
  openTeamMemberModal(id = null) {
    const member = id ? State.teamMembers.find(m => m.id === id) : null;
    const isEdit = !!member;
    Modal.open({
      title: isEdit ? 'Editar Membro' : 'Cadastrar Membro',
      body: `
        <form id="teamMemberForm">
          <div class="form-row">
            <div class="form-group"><label class="form-label">Nome *</label><input class="form-input" name="name" required maxlength="100" value="${escapeHtml(member?.name || '')}"></div>
            <div class="form-group"><label class="form-label">E-mail</label><input class="form-input" name="email" type="email" value="${escapeHtml(member?.email || '')}"></div>
          </div>
          <div class="form-row">
            <div class="form-group"><label class="form-label">Cargo / Função</label><input class="form-input" name="role_title" placeholder="Ex: Eng. Estrutural, Projetista" value="${escapeHtml(member?.role_title || '')}"></div>
            <div class="form-group"><label class="form-label">Telefone</label><input class="form-input" name="phone" value="${escapeHtml(member?.phone || '')}"></div>
          </div>
          <div class="form-group">
            <label class="form-label" style="display:flex;justify-content:space-between;align-items:center;">
              Observações
              <span id="tmNotesCount" style="font-size:10px;color:var(--ink-mute);font-family:var(--font-mono);font-weight:400;">${(member?.notes || '').length}/500</span>
            </label>
            <textarea class="form-input" name="notes" rows="2" maxlength="500" id="tmNotesArea" oninput="const c=document.getElementById('tmNotesCount');if(c)c.textContent=this.value.length+'/500';">${escapeHtml(member?.notes || '')}</textarea>
          </div>
          ${(() => {
            // Opção de alocar em todos os projetos onde sou dono
            const myProjects = State.projects.filter(p => p.owner_id === State.user?.id);
            if (myProjects.length === 0) return '';
            return `
            <div style="margin-top:6px;padding:10px 12px;background:var(--bg-deep);border:1px solid var(--border);border-radius:3px;">
              <label style="display:flex;align-items:center;gap:9px;cursor:pointer;font-size:13px;">
                <input type="checkbox" id="tmAllocAll" style="width:16px;height:16px;accent-color:var(--accent);">
                <span>Incluir este membro em <strong>todos os meus projetos</strong> (${myProjects.length})</span>
              </label>
              <div style="font-size:11px;color:var(--ink-mute);margin-top:4px;margin-left:25px;">Aloca como Editor em cada projeto. Projetos onde já é membro são ignorados.</div>
            </div>`;
          })()}
        </form>
      `,
      footer: `
        ${isEdit ? `<button class="btn btn-ghost" style="color:var(--accent-danger)" id="btnDelTeamMember">Excluir</button>` : ''}
        <button class="btn btn-secondary" id="btnCancelTM">Cancelar</button>
        <button class="btn btn-cta" id="btnSaveTM">Salvar</button>
      `
    });
    $('#btnCancelTM').onclick = () => Modal.close();
    $('#btnSaveTM').onclick = async () => {
      const fd = Object.fromEntries(new FormData($('#teamMemberForm')).entries());
      if (!fd.name?.trim()) { toast('Nome é obrigatório', 'error'); return; }
      const allocAll = $('#tmAllocAll')?.checked || false;
      delete fd.tmAllocAll; // não é coluna do banco
      const btnSave = $('#btnSaveTM');
      btnSave.disabled = true; btnSave.textContent = 'Salvando…';
      try {
        setLoading(true);
        let memberId = id;
        if (isEdit) {
          const updated = await DB.updateTeamMember(id, fd);
          const idx = State.teamMembers.findIndex(m => m.id === id);
          if (idx >= 0) State.teamMembers[idx] = updated;
        } else {
          const created = await DB.createTeamMember(fd);
          State.teamMembers.push(created);
          memberId = created.id;
        }
        // Aloca em todos os projetos onde sou dono (pulando os que já têm)
        let allocCount = 0;
        if (allocAll && memberId) {
          const myProjects = State.projects.filter(p => p.owner_id === State.user?.id);
          for (const p of myProjects) {
            try {
              const alloc = await DB.allocateMember(p.id, memberId, 'editor');
              if (p.id === State.currentProjectId && alloc) State.allocations.push(alloc);
              allocCount++;
            } catch (e) { /* já alocado ou erro pontual — segue */ }
          }
        }
        DB.computeMembers();
        Modal.close();
        await UI.render();
        toast(
          (isEdit ? 'Membro atualizado' : 'Membro cadastrado') +
          (allocCount > 0 ? ` · alocado em ${allocCount} projeto${allocCount !== 1 ? 's' : ''}` : ''),
          'success'
        );
      } catch (err) {
        let msg = friendlyError(err);
        if ((err.message || '').includes('team_members') && (err.message || '').includes('does not exist')) msg = 'Rode a migration 12-migration-v3.9.sql no Supabase';
        toast(msg, 'error');
      } finally {
        setLoading(false);
        const b = $('#btnSaveTM'); if (b) { b.disabled = false; b.textContent = 'Salvar'; }
      }
    };
    if (isEdit) $('#btnDelTeamMember').onclick = () => UI.deleteTeamMember(id);
  },

  // ===== CONVIDAR MEMBRO (membros = usuários do sistema) =====
  openInviteMemberModal(projectId = null) {
    // Dono ou Administrador podem convidar membros
    const projects = State.projects.filter(p => ['owner', 'admin'].includes(DB.getMyRoleInProject(p.id)));
    if (projects.length === 0) { toast('Você precisa ser dono ou administrador do projeto para convidar membros', 'error'); return; }
    const pid = projectId || State.currentProjectId || projects[0].id;
    Modal.open({
      title: 'Convidar membro',
      body: `
        <div style="font-size:12px;color:var(--ink-soft);margin-bottom:14px;">
          Membros são <strong>usuários do sistema</strong>. Convide pelo e-mail — quando a pessoa aceitar, ela entra na equipe do projeto e pode receber tarefas.
        </div>
        <form id="inviteMemberForm">
          <div class="form-group"><label class="form-label">Projeto</label>
            <select class="form-input" name="project_id" id="invProjectSel">
              ${projects.map(p => `<option value="${p.id}" ${p.id === pid ? 'selected' : ''}>${escapeHtml(p.name)}</option>`).join('')}
            </select>
          </div>
          <div class="form-group"><label class="form-label">E-mail *</label>
            <input class="form-input" name="email" type="email" required placeholder="pessoa@email.com" autocomplete="off">
          </div>
          <div class="form-group"><label class="form-label">Papel</label>
            <select class="form-input" name="role">
              <option value="editor">Editor — cria e edita conteúdo</option>
              <option value="commenter">Comentarista — vê e comenta</option>
              <option value="viewer">Visualizador — só leitura</option>
              <option value="admin">Administrador — gerencia tudo</option>
            </select>
          </div>
        </form>`,
      footer: `<button class="btn btn-secondary" id="btnCancelInvM">Cancelar</button><button class="btn btn-cta" id="btnSendInvM">Enviar convite</button>`
    });
    $('#btnCancelInvM').onclick = () => Modal.close();
    $('#btnSendInvM').onclick = async () => {
      const fd = Object.fromEntries(new FormData($('#inviteMemberForm')).entries());
      const email = (fd.email || '').trim();
      if (!email) { toast('Digite um e-mail', 'error'); return; }
      const btn = $('#btnSendInvM'); btn.disabled = true; btn.textContent = 'Enviando…';
      try {
        await DB.createInvite(fd.project_id, email, fd.role);
        const reg = await DB.emailIsRegistered(email);
        Modal.close();
        await UI.render();
        if (reg === true) toast(`Convite enviado — ${email} já tem conta e verá o convite no app dele.`, 'success');
        else if (reg === false) toast(`Convite enviado por e-mail. ${email} precisa criar uma conta para virar membro.`, 'success');
        else toast(`Convite enviado para ${email}`, 'success');
      } catch (err) {
        toast(friendlyError(err), 'error');
        btn.disabled = false; btn.textContent = 'Enviar convite';
      }
    };
  },

  // Converte membros antigos (cadastro livre c/ e-mail) em convites de projeto
  async convertLegacyMembers() {
    const legacy = State.teamMembers.filter(m => m.active !== false && !m.user_id && m.email && m.email.includes('@'));
    if (legacy.length === 0) { toast('Nenhum membro antigo para converter', 'info'); return; }
    if (!await Dialog.confirm({
      title: 'Converter em convites',
      msg: `Serão enviados convites para ${legacy.length} membro(s), nos projetos onde cada um está alocado. Quem já tem conta verá o convite no app; quem não tem receberá por e-mail. As tarefas atribuídas são preservadas ao aceitarem.`,
      confirmText: 'Enviar convites',
    })) return;
    setLoading(true);
    let sent = 0, skipped = 0;
    try {
      // mapa: team_member_id -> [projetos onde está alocado] (via allOwnerAllocations não existe; usamos allocations do projeto atual + varremos projetos)
      for (const m of legacy) {
        // projetos onde esse membro está alocado: precisamos buscar por projeto
        let projIds = [];
        for (const p of State.projects.filter(p => DB.getMyRoleInProject(p.id) === 'owner')) {
          try {
            const allocs = await DB.listAllocations(p.id);
            if (allocs.some(a => a.team_member_id === m.id)) projIds.push(p.id);
          } catch (e) { console.warn('[member] falha ao listar alocações de', p.id, e.message); }
        }
        // se não estiver alocado em nenhum, convida para todos os projetos que administro
        if (projIds.length === 0) projIds = State.projects.filter(p => DB.getMyRoleInProject(p.id) === 'owner').map(p => p.id);
        for (const pid of projIds) {
          try { await DB.createInvite(pid, m.email, 'editor'); sent++; }
          catch (e) { skipped++; } // já convidado / já tem acesso → ignora
        }
      }
      await UI.render();
      toast(`Conversão concluída · ${sent} convite(s) enviado(s)${skipped ? `, ${skipped} já existiam` : ''}`, 'success');
    } catch (err) { toast('Erro na conversão: ' + err.message, 'error'); }
    finally { setLoading(false); }
  },

  async deleteTeamMember(id) {
    const m = State.teamMembers.find(x => x.id === id);
    if (!m) return;
    if (!await Dialog.confirm({ title: 'Excluir membro', msg: `Excluir "${m.name}" do cadastro de equipe?\n\nEle será desalocado de todos os projetos.`, confirmText: 'Excluir', danger: true })) return;
    try {
      setLoading(true);
      await DB.deleteTeamMember(id);
      State.teamMembers = State.teamMembers.filter(x => x.id !== id);
      State.allocations = State.allocations.filter(a => a.team_member_id !== id);
      DB.computeMembers();
      Modal.close();
      await UI.render();
      toast('Membro excluído', 'success');
    } catch (err) { toast(friendlyError(err), 'error'); }
    finally { setLoading(false); }
  },

  // ===== ALOCAR MEMBRO NO PROJETO =====
  openAllocateMemberModal() {
    if (!DB.iAmAdmin()) { toast('Apenas o dono ou administrador pode alocar membros', 'error'); return; }
    const allocatedIds = new Set(State.allocations.map(a => a.team_member_id));
    const available = State.teamMembers.filter(m => m.active !== false && !allocatedIds.has(m.id));
    const forceNew = available.length === 0;

    const selectSection = available.length > 0 ? `
      <div id="allocSelectSection">
        <div class="form-group">
          <label class="form-label">Membro</label>
          <select id="allocMemberId" class="form-input">
            ${available.map(m => `<option value="${m.id}">${escapeHtml(m.name)}${m.role_title ? ' · ' + escapeHtml(m.role_title) : ''}</option>`).join('')}
          </select>
        </div>
        <div style="font-size:12px;color:var(--ink-soft);margin-bottom:12px;">
          ou <a href="#" id="allocToggleNew" style="color:var(--accent);text-decoration:none;">Cadastrar novo membro...</a>
        </div>
      </div>` : '';

    const newSection = `
      <div id="allocNewSection" style="${available.length > 0 ? 'display:none;' : ''}border-top:1px solid var(--border);padding-top:14px;margin-top:4px;">
        ${available.length > 0 ? '<div style="font-size:12px;color:var(--ink-soft);margin-bottom:10px;">Novo membro (será salvo no cadastro global)</div>' : '<div style="font-size:13px;color:var(--ink-soft);margin-bottom:14px;">Todos os membros já estão alocados. Cadastre um novo:</div>'}
        <div class="form-row">
          <div class="form-group"><label class="form-label">Nome *</label><input class="form-input" id="newMemberName" placeholder="Nome completo"></div>
          <div class="form-group"><label class="form-label">Cargo / Função</label><input class="form-input" id="newMemberRole" placeholder="Ex: Eng. Civil"></div>
        </div>
        <div class="form-row">
          <div class="form-group"><label class="form-label">E-mail</label><input class="form-input" id="newMemberEmail" type="email" placeholder="email@exemplo.com"></div>
          <div class="form-group"><label class="form-label">Telefone</label><input class="form-input" id="newMemberPhone" type="tel" placeholder="(11) 99999-9999"></div>
        </div>
      </div>`;

    Modal.open({
      title: 'Alocar Membro no Projeto',
      body: `
        ${selectSection}
        ${newSection}
        <div class="form-group" style="margin-top:14px;">
          <label class="form-label">Nível de acesso</label>
          <select id="allocRole" class="form-input">
            <option value="viewer">Visualizador</option>
            <option value="commenter">Comentarista</option>
            <option value="editor" selected>Editor</option>
            <option value="admin">Administrador</option>
          </select>
        </div>
      `,
      footer: `
        <button class="btn btn-secondary" id="btnCancelAlloc">Cancelar</button>
        <button class="btn btn-cta" id="btnSaveAlloc">Alocar</button>
      `
    });

    $('#btnCancelAlloc').onclick = () => Modal.close();

    if (available.length > 0) {
      $('#allocToggleNew').onclick = (e) => {
        e.preventDefault();
        $('#allocSelectSection').style.display = 'none';
        $('#allocNewSection').style.display = '';
        $('#allocToggleNew').closest('#allocSelectSection') && null;
      };
    }

    $('#btnSaveAlloc').onclick = async () => {
      const role = $('#allocRole').value;
      const isNewVisible = $('#allocNewSection').style.display !== 'none';
      try {
        setLoading(true);
        let memberId;
        if (!forceNew && !isNewVisible) {
          memberId = $('#allocMemberId').value;
        } else {
          const name = $('#newMemberName').value.trim();
          if (!name) { toast('Nome é obrigatório', 'error'); return; }
          const tm = await DB.createTeamMember({
            name,
            role_title: $('#newMemberRole').value.trim() || null,
            email: $('#newMemberEmail').value.trim() || null,
            phone: $('#newMemberPhone').value.trim() || null,
          });
          State.teamMembers.push(tm);
          memberId = tm.id;
        }
        const created = await DB.allocateMember(State.currentProjectId, memberId, role);
        State.allocations.push(created);
        DB.computeMembers();
        Modal.close();
        await UI.render();
        toast('Membro alocado no projeto', 'success');
      } catch (err) {
        let msg = err.message;
        if (msg.includes('duplicate')) msg = 'Este membro já está alocado neste projeto';
        toast(msg, 'error');
      } finally { setLoading(false); }
    };
  },
});
