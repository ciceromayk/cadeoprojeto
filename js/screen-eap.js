// Modelos de EAP: biblioteca, editor e aplicação
import { DB } from './db.js';
import { Dialog } from './dialog.js';
import { _EAP_BUILTINS } from './eap-templates.js';
import { friendlyError, setLoading, toast } from './feedback.js';
import { addDays, escapeHtml, today } from './helpers.js';
import { Modal } from './modal.js';
import { State } from './state.js';
import { UI } from './ui.js';

// Plugado em UI: continuam acessíveis como UI.<método> e this.<método>.
Object.assign(UI, {
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
});
