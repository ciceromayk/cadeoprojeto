// Tela Disciplinas
import { DB } from './db.js';
import { Dialog } from './dialog.js';
import { friendlyError, setLoading, toast } from './feedback.js';
import { $, $$, colorFromString, escapeHtml, parentTag, today } from './helpers.js';
import { Modal } from './modal.js';
import { DISCIPLINE_CATALOG, State } from './state.js';
import { UI } from './ui.js';
import { Views } from './views.js';

// Plugado em Views: continuam acessíveis como Views.<método> e this.<método>.
Object.assign(Views, {
  disciplines() {
    const p = this.current();
    if (!p) return this.emptyProject();

    if (State.disciplines.length === 0) {
      return `
        <div class="page-title-block"><div class="page-eyebrow">ENGENHARIA</div><div class="page-title">Disciplinas Técnicas</div></div>
        <div class="empty-state" style="background:var(--bg-panel);border:1px solid var(--border);border-radius:3px;">
          <div class="empty-state-icon"><svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/></svg></div>
          <div class="empty-state-title">Cadastre as disciplinas do projeto</div>
          <div class="empty-state-sub">Arquitetônico, Estrutural, Hidráulico, Elétrico, AVAC, PCI...<br>Cada disciplina pode ter um líder técnico e nº de ART/RRT.</div>
          <button class="btn btn-cta" data-action="new-discipline">+ Nova Disciplina</button>
        </div>
      `;
    }

    const view = State.disciplineView === 'list' ? 'list' : 'cards';
    const editSvg = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>`;
    const delSvg = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/></svg>`;

    // Estatísticas por disciplina (reusadas por cards e lista)
    let discData = State.disciplines.map(d => {
      const lead = State.members.find(m => m.id === d.lead_member_id);
      const dtasks = State.tasks.filter(x => x.discipline_id === d.id && !x.inactive);
      const total = dtasks.length;
      const done = dtasks.filter(x => x.status === 'concluido').length;
      const inProgress = dtasks.filter(x => x.status === 'em_andamento').length;
      const overdue = dtasks.filter(x => x.status !== 'concluido' && x.end_date && x.end_date < today()).length;
      const pending = total - done; // tarefas não concluídas = pendências
      const progress = total > 0 ? Math.round(dtasks.reduce((s, t) => s + (parseFloat(t.progress) || 0), 0) / total) : 0;
      const color = colorFromString(d.code || d.name);
      let derivedStatus = 'em_projeto', derivedLabel = 'Sem tarefas';
      if (total > 0) {
        if (done === total) { derivedStatus = 'emitido'; derivedLabel = 'Concluída'; }
        else if (overdue > 0) { derivedStatus = 'em_revisao'; derivedLabel = `${overdue} em atraso`; }
        else if (inProgress > 0) { derivedStatus = 'em_projeto'; derivedLabel = 'Em andamento'; }
        else { derivedStatus = 'pendente'; derivedLabel = 'A iniciar'; }
      }
      return { d, lead, total, done, inProgress, overdue, pending, progress, color, derivedStatus, derivedLabel };
    });

    // Filtro: só disciplinas com pendências (tarefas não concluídas)
    const filterPending = !!State.disciplineFilterPending;
    if (filterPending) discData = discData.filter(x => x.pending > 0);

    // Ordenação: alfabética OU por pendências (mais atrasadas/pendentes primeiro)
    const sortMode = State.disciplineSort === 'pending' ? 'pending' : 'alpha';
    discData.sort((a, b) => {
      if (sortMode === 'pending') {
        if (b.overdue !== a.overdue) return b.overdue - a.overdue;
        if (b.pending !== a.pending) return b.pending - a.pending;
      }
      return (a.d.name || '').localeCompare(b.d.name || '', 'pt-BR');
    });

    const tBtn = (v, label) => `<button onclick="State.disciplineView='${v}';UI.render()" style="padding:5px 12px;font-size:12px;font-family:var(--font-mono);border:none;cursor:pointer;${view === v ? 'background:var(--accent);color:var(--bg-deep);font-weight:700;' : 'background:transparent;color:var(--ink-soft);'}">${label}</button>`;
    const toggle = `<div style="display:inline-flex;border:1px solid var(--border-strong);border-radius:3px;overflow:hidden;">${tBtn('cards', '▦ Cards')}${tBtn('list', '≡ Lista')}</div>`;

    const cardsHtml = `<div class="discipline-grid">${discData.map(x => { const d = x.d; return `
      <div class="discipline-card" data-discipline-id="${d.id}" title="Duplo clique para ver tarefas" style="cursor:pointer;border-left:4px solid ${x.color};">
        <div class="discipline-card-head">
          <div class="discipline-code-block" style="background:${x.color}1a;border:1px solid ${x.color}44;border-radius:4px;"><div class="code" style="color:${x.color};">${d.code}</div></div>
          <div style="flex:1;min-width:0;">
            <div class="discipline-name">${escapeHtml(d.name)}</div>
            <div style="margin-top:6px;"><span class="status-badge status-${x.derivedStatus}">${x.derivedLabel}</span></div>
          </div>
          ${DB.iCanEdit() ? `<div style="display:flex;flex-direction:column;gap:4px;">
            <button class="icon-btn" data-action="edit-discipline" data-id="${d.id}" title="Editar">${editSvg}</button>
            <button class="icon-btn danger" data-action="delete-discipline" data-id="${d.id}" title="Excluir">${delSvg}</button>
          </div>` : ''}
        </div>
        <div class="discipline-stats">
          <div class="discipline-stat"><div class="discipline-stat-num">${x.total}</div><div class="discipline-stat-label">Tarefas</div></div>
          <div class="discipline-stat"><div class="discipline-stat-num" style="color:var(--accent)">${x.inProgress}</div><div class="discipline-stat-label">Andamento</div></div>
          <div class="discipline-stat"><div class="discipline-stat-num" style="color:${x.overdue > 0 ? 'var(--accent-danger)' : 'var(--ink-mute)'}">${x.overdue}</div><div class="discipline-stat-label">Atrasadas</div></div>
          <div class="discipline-stat"><div class="discipline-stat-num" style="color:var(--accent-success)">${x.done}</div><div class="discipline-stat-label">Concluídas</div></div>
        </div>
      </div>`; }).join('')}</div>`;

    const listHtml = `<div class="panel" style="padding:0;overflow:hidden;">
      <table class="data-table" style="width:100%;">
        <thead><tr>
          <th style="width:56px;">Cód.</th><th>Disciplina</th><th>Status</th>
          <th style="text-align:right;width:64px;">Tarefas</th><th style="text-align:right;width:64px;">Andam.</th>
          <th style="text-align:right;width:64px;">Atras.</th><th style="text-align:right;width:64px;">Concl.</th>
          <th style="width:120px;">Progresso</th>${DB.iCanEdit() ? '<th style="width:74px;"></th>' : ''}
        </tr></thead>
        <tbody>${discData.map(x => { const d = x.d; return `<tr style="cursor:default;">
          <td style="font-family:var(--font-mono);font-weight:700;color:${x.color};border-left:3px solid ${x.color};">${escapeHtml(d.code)}</td>
          <td style="font-weight:500;">${escapeHtml(d.name)}</td>
          <td><span class="status-badge status-${x.derivedStatus}">${x.derivedLabel}</span></td>
          <td style="text-align:right;font-family:var(--font-mono);">${x.total}</td>
          <td style="text-align:right;font-family:var(--font-mono);color:var(--accent);">${x.inProgress}</td>
          <td style="text-align:right;font-family:var(--font-mono);color:${x.overdue > 0 ? 'var(--accent-danger)' : 'var(--ink-mute)'};">${x.overdue}</td>
          <td style="text-align:right;font-family:var(--font-mono);color:var(--accent-success);">${x.done}</td>
          <td><div style="display:flex;align-items:center;gap:6px;"><div style="flex:1;height:6px;background:var(--bg-deep);border-radius:3px;overflow:hidden;"><div style="height:100%;width:${x.progress}%;background:${x.progress >= 100 ? 'var(--accent-success)' : x.progress >= 50 ? 'var(--blueprint)' : 'var(--accent)'};border-radius:3px;"></div></div><span style="font-family:var(--font-mono);font-size:10px;">${x.progress}%</span></div></td>
          ${DB.iCanEdit() ? `<td style="white-space:nowrap;"><button class="icon-btn" data-action="edit-discipline" data-id="${d.id}" title="Editar">${editSvg}</button> <button class="icon-btn danger" data-action="delete-discipline" data-id="${d.id}" title="Excluir">${delSvg}</button></td>` : ''}
        </tr>`; }).join('')}</tbody>
      </table>
    </div>`;

    return `
      <div style="display:flex;justify-content:space-between;align-items:flex-end;flex-wrap:wrap;gap:8px;margin-bottom:14px;">
        <div class="page-title-block" style="margin-bottom:0;">
          <div class="page-eyebrow">ENGENHARIA · DISCIPLINAS</div>
          <div class="page-title">Disciplinas Técnicas</div>
          <div class="page-subtitle">${State.disciplines.length} ${State.disciplines.length === 1 ? 'disciplina' : 'disciplinas'} · ${State.tasks.filter(t => t.discipline_id).length} tarefas com disciplina</div>
        </div>
        <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
          <button onclick="State.disciplineFilterPending=!State.disciplineFilterPending;UI.render();"
            class="btn" style="font-size:12px;padding:5px 11px;display:inline-flex;align-items:center;gap:6px;border:1px solid ${filterPending ? 'var(--accent-warm)' : 'var(--border-strong)'};background:${filterPending ? 'rgba(212,168,44,0.12)' : 'transparent'};color:${filterPending ? 'var(--accent-warm)' : 'var(--ink-soft)'};" title="Mostrar só disciplinas com tarefas pendentes">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:14px;height:14px;"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
            Com pendências
          </button>
          <select onchange="State.disciplineSort=this.value;UI.render();" class="form-input" style="width:auto;font-size:12px;padding:5px 10px;" title="Ordenar disciplinas">
            <option value="alpha" ${sortMode === 'alpha' ? 'selected' : ''}>Ordem: A → Z</option>
            <option value="pending" ${sortMode === 'pending' ? 'selected' : ''}>Ordem: Pendências primeiro</option>
          </select>
          ${toggle}
          ${DB.iCanEdit() ? `<button class="btn btn-secondary" data-action="import-disciplines" style="display:inline-flex;align-items:center;gap:6px;" title="Copiar disciplinas de outra obra"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:15px;height:15px;"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg> Importar de outra obra</button>` : ''}
          ${DB.iCanEdit() ? `<button class="btn btn-cta" data-action="link-disciplines" style="display:inline-flex;align-items:center;gap:6px;"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:15px;height:15px;"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg> Vincular tarefas</button>` : ''}
        </div>
      </div>
      ${discData.length === 0
        ? `<div class="empty-state" style="background:var(--bg-panel);border:1px solid var(--border);border-radius:6px;padding:36px 20px;">
             <div class="empty-state-icon"><svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg></div>
             <div class="empty-state-title">Nenhuma disciplina com pendências</div>
             <div class="empty-state-sub">Todas as disciplinas estão concluídas (ou sem tarefas). Desative o filtro para ver todas.</div>
             <button class="btn btn-secondary" onclick="State.disciplineFilterPending=false;UI.render();">Mostrar todas</button>
           </div>`
        : (view === 'list' ? listHtml : cardsHtml)}
    `;
  },
});

// Plugado em UI: continuam acessíveis como UI.<método> e this.<método>.
Object.assign(UI, {
  // ===== VINCULAR TAREFAS A DISCIPLINAS (em massa) =====
  openDisciplineLinker() {
    if (!DB.iCanEdit()) { toast('Sem permissão para editar este projeto', 'error'); return; }
    const discs = State.disciplines;
    if (!discs.length) { toast('Cadastre disciplinas primeiro', 'warning'); return; }
    // Tarefas-folha (representam trabalho real; evita dupla contagem dos pais)
    const leaves = State.tasks.filter(t => !State.tasks.some(x => x.parent_id === t.id))
      .sort((a, b) => (a.code || '').localeCompare(b.code || '', undefined, { numeric: true }));
    if (!leaves.length) { toast('Nenhuma tarefa para vincular', 'warning'); return; }

    const opt = (sel) => `<option value="">— sem disciplina</option>` +
      discs.map(d => `<option value="${d.id}"${sel === d.id ? ' selected' : ''}>${escapeHtml(d.code)} · ${escapeHtml(d.name)}</option>`).join('');
    const rowsHtml = leaves.map(t => `<tr>
        <td style="font-family:var(--font-mono);font-size:10px;color:var(--accent);white-space:nowrap;">${escapeHtml(t.code || '')}</td>
        <td style="font-size:12px;">${escapeHtml(t.title)}</td>
        <td><select class="form-input dl-sel" data-task-id="${t.id}" data-orig="${t.discipline_id || ''}" style="padding:5px 8px;font-size:12px;">${opt(t.discipline_id)}</select></td>
      </tr>`).join('');

    Modal.open({
      title: 'Vincular tarefas a disciplinas',
      cls: 'modal-extrawide',
      body: `
        <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:10px;flex-wrap:wrap;">
          <div style="font-size:12px;color:var(--ink-mute);font-family:var(--font-mono);">${leaves.length} tarefas-folha · ${leaves.filter(t => t.discipline_id).length} já vinculadas</div>
          <button type="button" class="btn btn-secondary" id="dlSuggest" style="font-size:12px;">✨ Sugerir por nome</button>
        </div>
        <div style="max-height:56vh;overflow:auto;border:1px solid var(--border);border-radius:3px;">
          <table class="data-table" style="width:100%;">
            <thead><tr><th style="width:60px;">Cód.</th><th>Tarefa</th><th style="width:260px;">Disciplina</th></tr></thead>
            <tbody>${rowsHtml}</tbody>
          </table>
        </div>
        <div style="font-size:10px;color:var(--ink-mute);margin-top:8px;">Tarefas-folha (as que medem progresso). "Sugerir por nome" preenche as vazias a partir do título; suas escolhas manuais são preservadas.</div>`,
      footer: `<button type="button" class="btn btn-secondary" onclick="Modal.close()">Cancelar</button><button type="button" class="btn btn-cta" id="dlSave">Salvar vínculos</button>`
    });

    const norm = s => (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
    const GROUPS = [
      { det: ['arq', 'arquitet'], kw: ['arquitet', 'paisag', 'ambient', 'acessibil', 'luminot', 'acust', 'comunic', 'interior', 'urban'] },
      { det: ['est', 'estrut'], kw: ['estrutur', 'fundac', 'estaca', 'sondagem', 'contenc', 'concret', 'forma', 'premoldad', 'pre-forma', 'viga', 'pilar', 'laje', 'tunel de vento', 'pressoes'] },
      { det: ['ele', 'elet', 'eletr'], kw: ['eletric', 'spda', 'dados', ' voz', 'automac', 'telecom', 'cabeament', 'fotovolt'] },
      { det: ['hid', 'hidr', 'sanit'], kw: ['hidraul', 'hidrossanit', 'sanit', 'agua', 'esgoto', 'pluvial', 'drenagem', 'reuso'] },
      { det: ['ava', 'avac', 'climat', 'hvac', 'termic'], kw: ['climatiz', 'avac', 'ar condicion', 'exaust', 'ventil', 'termic'] },
      { det: ['pci', 'incend'], kw: ['incendio', 'combate a inc', 'sprinkler', 'hidrante', 'deteccao'] },
      { det: ['imp', 'imperm'], kw: ['impermeabil'] },
    ];
    const discKw = discs.map(d => {
      const nd = norm(d.code) + ' ' + norm(d.name);
      const g = GROUPS.find(grp => grp.det.some(term => nd.includes(term)));
      const stems = norm(d.name).split(/[^a-z0-9]+/).filter(w => w.length >= 4).map(w => w.slice(0, 6));
      const kws = [...new Set([...(g ? g.kw : []), ...stems, norm(d.code)].filter(Boolean))];
      return { id: d.id, kws };
    });
    const suggestFor = (title) => {
      const nt = norm(title);
      for (const dk of discKw) { if (dk.kws.some(k => k && nt.includes(k))) return dk.id; }
      return '';
    };

    $('#dlSuggest').onclick = () => {
      let filled = 0;
      $$('.dl-sel').forEach(sel => {
        if (sel.value) return; // preserva escolhas já feitas
        const t = State.tasks.find(x => x.id === sel.dataset.taskId);
        const sug = t ? suggestFor(t.title) : '';
        if (sug) { sel.value = sug; filled++; }
      });
      toast(filled ? `${filled} disciplina${filled > 1 ? 's' : ''} sugerida${filled > 1 ? 's' : ''}` : 'Nenhuma sugestão automática para as tarefas vazias', filled ? 'success' : 'info');
    };

    $('#dlSave').onclick = async () => {
      const changes = [];
      $$('.dl-sel').forEach(sel => {
        const orig = sel.dataset.orig || '', val = sel.value || '';
        if (orig !== val) changes.push({ id: sel.dataset.taskId, discipline_id: val || null });
      });
      if (!changes.length) { Modal.close(); toast('Nada a alterar', 'info'); return; }
      try {
        setLoading(true);
        await Promise.all(changes.map(c => DB.updateTask(c.id, { discipline_id: c.discipline_id })));
        changes.forEach(c => { const t = State.tasks.find(x => x.id === c.id); if (t) t.discipline_id = c.discipline_id; });
        Modal.close();
        await UI.render();
        toast(`${changes.length} tarefa${changes.length > 1 ? 's' : ''} vinculada${changes.length > 1 ? 's' : ''}`, 'success');
      } catch (err) { toast('Erro ao salvar: ' + err.message, 'error'); }
      finally { setLoading(false); }
    };
  },

  // ===== DISCIPLINE MODAL =====
  openDisciplineModal(disciplineId = null) {
    if (!State.currentProjectId) { toast('Crie um projeto primeiro', 'error'); return; }
    const disc = disciplineId ? State.disciplines.find(d => d.id === disciplineId) : null;
    const isEdit = !!disc;
    const usedCodes = State.disciplines.filter(d => d.id !== disciplineId).map(d => d.code);
    const availableCatalog = DISCIPLINE_CATALOG.filter(c => !usedCodes.includes(c.code));
    // Disciplinas de outros projetos ainda não presentes no projeto atual
    const reusable = (State.allOwnerDisciplines || []).filter(d => !usedCodes.includes(d.code));

    Modal.open({
      title: isEdit ? 'Editar Disciplina · ' + disc.code : 'Nova Disciplina Técnica',
      body: `
        <form id="discForm">
          ${!isEdit ? `
            <div class="form-group">
              <label class="form-label">Modelo (ou personalizado)</label>
              <select class="form-input" id="discTemplate">
                <option value="">— Personalizado —</option>
                ${availableCatalog.length > 0 ? `<optgroup label="Catálogo padrão">${availableCatalog.map(c => `<option value="${c.code}|${c.name}|">${c.code} · ${c.name}</option>`).join('')}</optgroup>` : ''}
                ${reusable.length > 0 ? `<optgroup label="Meu acervo (outros projetos)">${reusable.map(c => `<option value="${escapeHtml(c.code)}|${escapeHtml(c.name)}|${escapeHtml(c.notes||'')}">${c.code} · ${escapeHtml(c.name)}</option>`).join('')}</optgroup>` : ''}
              </select>
            </div>
          ` : ''}
          <div class="form-row">
            <div class="form-group"><label class="form-label">Código</label><input class="form-input" name="code" id="discCode" required value="${escapeHtml(disc?.code || '')}" placeholder="Ex.: ARQ" maxlength="6" style="text-transform:uppercase;"></div>
            <div class="form-group"><label class="form-label">Nome</label><input class="form-input" name="name" id="discName" required value="${escapeHtml(disc?.name || '')}" placeholder="Ex.: Arquitetônico"></div>
          </div>
          <div class="form-group"><label class="form-label">Líder Técnico (Responsável)</label>
            <select class="form-input" name="lead_member_id">
              <option value="">— Sem líder definido</option>
              ${State.members.map(m => `<option value="${m.id}" ${disc?.lead_member_id === m.id ? 'selected' : ''}>${escapeHtml(m.name)}${m.role ? ' — ' + escapeHtml(m.role) : ''}</option>`).join('')}
            </select>
          </div>
          <div class="form-group">
            <label class="form-label" style="display:flex;justify-content:space-between;align-items:center;">
              Observações
              <span id="discNotesCount" style="font-size:10px;color:var(--ink-mute);font-family:var(--font-mono);font-weight:400;">${(disc?.notes || '').length}/500</span>
            </label>
            <textarea class="form-input" name="notes" rows="2" maxlength="500" placeholder="Notas técnicas, escopo, restrições..." oninput="const c=document.getElementById('discNotesCount');if(c)c.textContent=this.value.length+'/500';">${escapeHtml(disc?.notes || '')}</textarea>
          </div>
        </form>
      `,
      footer: `${isEdit ? `<button class="btn btn-ghost" style="color:var(--accent-danger)" id="btnDelDisc">Excluir</button>` : ''}
               <button class="btn btn-secondary" id="btnCancelDisc">Cancelar</button>
               <button class="btn btn-cta" id="btnSaveDisc">Salvar</button>`
    });

    if (!isEdit) {
      $('#discTemplate').onchange = (e) => {
        const v = e.target.value;
        if (!v) return;
        const [code, name, notes] = v.split('|');
        $('#discCode').value = code;
        $('#discName').value = name;
        const notesEl = $('#discForm').querySelector('[name="notes"]');
        if (notesEl && notes) notesEl.value = notes;
      };
    }
    $('#btnCancelDisc').onclick = () => Modal.close();
    $('#btnSaveDisc').onclick = async function() {
      this.disabled = true; const orig = this.textContent; this.textContent = 'Salvando…';
      try { await UI.saveDiscipline(disc?.id); } finally { this.disabled = false; this.textContent = orig; }
    };
    if (isEdit) $('#btnDelDisc').onclick = () => UI.deleteDiscipline(disc.id);
  },

  async saveDiscipline(id) {
    const data = Object.fromEntries(new FormData($('#discForm')).entries());
    data.code = (data.code || '').toUpperCase().trim();
    if (!data.lead_member_id) data.lead_member_id = null;
    try {
      setLoading(true);
      if (id) {
        await DB.updateDiscipline(id, data);
        const d = State.disciplines.find(x => x.id === id); Object.assign(d, data);
        toast('Disciplina atualizada', 'success');
      } else {
        const created = await DB.createDiscipline(State.currentProjectId, data);
        State.disciplines.push(created);
        State.disciplines.sort((a, b) => (a.code || '').localeCompare(b.code || ''));
        toast('Disciplina criada', 'success');
      }
      Modal.close();
      await UI.render();
    } catch (err) {
      let msg = err.message;
      if (msg.includes('duplicate')) msg = 'Já existe disciplina com este código.';
      else if (msg.includes('schema cache') || msg.includes('column')) {
        msg = 'Banco desatualizado: rode o SQL 04-migration-v3.2.sql no Supabase para corrigir as colunas faltantes.';
      }
      toast(msg, 'error');
    } finally { setLoading(false); }
  },

  openDisciplineTasksModal(disciplineId) {
    const disc = State.disciplines.find(d => d.id === disciplineId);
    if (!disc) return;
    const dtasks = State.tasks.filter(t => t.discipline_id === disciplineId);

    const statusOpts = [
      { v: 'a_fazer',      l: 'A Fazer' },
      { v: 'em_andamento', l: 'Em Andamento' },
      { v: 'bloqueada',    l: 'Bloqueada' },
      { v: 'concluido',    l: 'Concluída' }
    ];
    const priOpts = [
      { v: 'baixa', l: 'Baixa' },
      { v: 'media', l: 'Média' },
      { v: 'alta',  l: 'Alta' }
    ];

    const selStyle = 'width:100%;background:var(--bg-deep);border:1px solid var(--border);color:var(--ink);border-radius:2px;padding:4px 6px;font-size:12px;font-family:var(--font-display);';
    const inputStyle = 'width:100%;background:var(--bg-deep);border:1px solid var(--border);color:var(--ink);border-radius:2px;padding:4px 6px;font-size:12px;font-family:var(--font-mono);text-align:right;';
    const fmtBRLLocal = v => v != null && v !== '' ? Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }) : '';

    // Etiquetas por tarefa (para o filtro)
    const _lblByTask = {};
    (State.taskLabels || []).forEach(tl => {
      (_lblByTask[tl.task_id] = _lblByTask[tl.task_id] || []).push(tl.label_id);
    });

    const rows = dtasks.length === 0
      ? `<tr><td colspan="6" style="text-align:center;padding:32px;color:var(--ink-mute);">Nenhuma tarefa vinculada a esta disciplina.</td></tr>`
      : dtasks.map((t, i) => {
          const assigneeOpts = State.members.map(m => `<option value="${m.id}"${t.assignee_id === m.id ? ' selected' : ''}>${escapeHtml(m.name)}</option>`).join('');
          const stOpts = statusOpts.map(s => `<option value="${s.v}"${t.status === s.v ? ' selected' : ''}>${s.l}</option>`).join('');
          const prOpts = priOpts.map(p => `<option value="${p.v}"${t.priority === p.v ? ' selected' : ''}>${p.l}</option>`).join('');
          const costRaw  = (t.cost != null && t.cost !== '') ? t.cost : '';
          const costDisp = fmtBRLLocal(costRaw);
          return `<tr data-task-id="${t.id}" data-labels="${(_lblByTask[t.id] || []).join(',')}">
            <td style="font-family:var(--font-mono);font-size:11px;color:var(--ink-mute);white-space:nowrap;padding-right:4px;vertical-align:top;padding-top:10px;">${escapeHtml(t.code || String(i + 1))}</td>
            <td style="font-size:12px;font-weight:500;vertical-align:top;padding-top:8px;"><div style="display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden;line-height:1.3;word-break:break-word;" title="${escapeHtml(t.title)}">${escapeHtml(t.title)}</div>${parentTag(t)}</td>
            <td style="width:170px;vertical-align:top;"><select class="dt-disc-field" data-field="assignee_id" data-id="${t.id}" style="${selStyle}"><option value="">— Sem responsável</option>${assigneeOpts}</select></td>
            <td style="width:140px;vertical-align:top;"><select class="dt-disc-field" data-field="status" data-id="${t.id}" style="${selStyle}">${stOpts}</select></td>
            <td style="width:105px;vertical-align:top;"><select class="dt-disc-field" data-field="priority" data-id="${t.id}" style="${selStyle}">${prOpts}</select></td>
            <td style="width:170px;vertical-align:top;"><input class="dt-disc-field dt-cost-field" data-field="cost" data-id="${t.id}" data-raw="${costRaw}" type="text" placeholder="R$ 0,00" value="${costDisp}" style="${inputStyle}"></td>
          </tr>`;
        }).join('');

    // Filtro de etiqueta (só aparece se o projeto tem etiquetas)
    const _lblFilterHtml = (State.labels || []).length === 0 ? '' : `
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:10px;">
        <label style="font-family:var(--font-mono);font-size:10px;text-transform:uppercase;letter-spacing:.08em;color:var(--ink-mute);">Etiqueta:</label>
        <select id="discTasksLblFilter" class="form-input" style="width:auto;font-size:12px;padding:5px 10px;">
          <option value="all">Todas</option>
          <option value="none">Sem etiqueta</option>
          ${(State.labels || []).map(l => `<option value="${l.id}">${escapeHtml(l.name)}</option>`).join('')}
        </select>
        <span id="discTasksLblCount" style="font-family:var(--font-mono);font-size:10px;color:var(--ink-mute);"></span>
      </div>`;

    Modal.open({
      title: `Tarefas · ${escapeHtml(disc.code)} — ${escapeHtml(disc.name)}`,
      cls: 'modal-xwide',
      body: `
        <div style="font-size:12px;color:var(--ink-mute);margin-bottom:12px;">${dtasks.length} tarefa${dtasks.length !== 1 ? 's' : ''} · Edite os campos diretamente — salva automaticamente ao sair do campo.</div>
        ${_lblFilterHtml}
        <div style="overflow-x:auto;">
          <table class="data-table" style="width:100%;">
            <thead><tr>
              <th style="width:64px;">Código</th>
              <th>Título</th>
              <th style="width:180px;">Responsável</th>
              <th style="width:150px;">Status</th>
              <th style="width:115px;">Prioridade</th>
              <th style="width:180px;">Custo (R$)</th>
            </tr></thead>
            <tbody>${rows}</tbody>
          </table>
        </div>`,
      footer: `<button class="btn btn-secondary" id="btnCloseDiscTasks">Fechar</button>`
    });
    $('#btnCloseDiscTasks').onclick = () => Modal.forceClose();

    // Filtro de etiqueta — esconde/mostra linhas conforme seleção
    const _lblSel = $('#discTasksLblFilter');
    if (_lblSel) {
      _lblSel.onchange = () => {
        const v = _lblSel.value;
        let shown = 0;
        $('#modal').querySelectorAll('tbody tr[data-task-id]').forEach(tr => {
          const ids = (tr.dataset.labels || '').split(',').filter(Boolean);
          const show = v === 'all' || (v === 'none' ? ids.length === 0 : ids.includes(v));
          tr.style.display = show ? '' : 'none';
          if (show) shown++;
        });
        const cnt = $('#discTasksLblCount');
        if (cnt) cnt.textContent = v === 'all' ? '' : `${shown} de ${dtasks.length}`;
      };
    }

    // Expande a largura do modal além do padrão modal-wide
    $('#modal').style.maxWidth = '1120px';

    // Auto-salva: selects no change; custo: focus mostra número, blur formata e salva
    $('#modal').querySelectorAll('.dt-disc-field').forEach(el => {
      if (el.classList.contains('dt-cost-field')) {
        el.addEventListener('focus', () => {
          el.value = el.dataset.raw || '';
        });
        el.addEventListener('blur', async () => {
          const taskId = el.dataset.id;
          const raw = el.value.replace(',', '.').trim();
          const val = raw === '' ? null : parseFloat(raw);
          const task = State.tasks.find(t => t.id === taskId);
          if (!task) return;
          const prev = task.cost;
          task.cost = val;
          el.dataset.raw = val != null ? val : '';
          el.value = fmtBRLLocal(val);
          try {
            await DB.updateTask(taskId, { cost: val });
            el.style.outline = '2px solid var(--accent-success)';
            setTimeout(() => { el.style.outline = ''; }, 900);
          } catch (err) {
            task.cost = prev;
            el.dataset.raw = prev != null ? prev : '';
            el.value = fmtBRLLocal(prev);
            el.style.outline = '2px solid var(--accent-danger)';
            toast('Erro ao salvar: ' + err.message, 'error');
          }
        });
        return;
      }
      el.addEventListener('change', async () => {
        const taskId = el.dataset.id;
        const field  = el.dataset.field;
        let val = el.value;
        if (field === 'assignee_id') val = val === '' ? null : val;

        const task = State.tasks.find(t => t.id === taskId);
        if (!task) return;
        const prev = task[field];
        const prevProg = task.progress;
        const patch = { [field]: val };
        // Regra global: status 'concluído' => progresso 100% (apenas folhas)
        const _isParent = State.tasks.some(t => t.parent_id === taskId);
        if (field === 'status' && val === 'concluido' && !_isParent && (parseFloat(task.progress) || 0) < 100) {
          patch.progress = 100;
        }
        task[field] = val;
        if (patch.progress !== undefined) task.progress = patch.progress;

        try {
          await DB.updateTask(taskId, patch);
          if (patch.progress !== undefined) await UI.rollUpParentTask(task.parent_id || null, true);
          el.style.outline = '2px solid var(--accent-success)';
          setTimeout(() => { el.style.outline = ''; }, 900);
        } catch (err) {
          task[field] = prev;
          if (patch.progress !== undefined) task.progress = prevProg;
          el.style.outline = '2px solid var(--accent-danger)';
          toast('Erro ao salvar: ' + err.message, 'error');
        }
      });
    });
  },

  async deleteDiscipline(id) {
    if (!await Dialog.confirm({ title: 'Excluir disciplina', msg: 'Excluir esta disciplina? As tarefas vinculadas perderão a associação.', confirmText: 'Excluir', danger: true })) return;
    try {
      setLoading(true);
      await DB.deleteDiscipline(id);
      State.disciplines = State.disciplines.filter(d => d.id !== id);
      Modal.close();
      await UI.render();
      toast('Disciplina excluída', 'success');
    } catch (err) { toast(friendlyError(err), 'error'); }
    finally { setLoading(false); }
  },
});
