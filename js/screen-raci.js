// Tela RACI
import { DB } from './db.js';
import { friendlyError, setLoading, toast } from './feedback.js';
import { $, escapeHtml } from './helpers.js';
import { Modal } from './modal.js';
import { RACI_LABELS, STATUS_LABELS, State } from './state.js';
import { UI } from './ui.js';
import { Views } from './views.js';

// Plugado em Views: continuam acessíveis como Views.<método> e this.<método>.
Object.assign(Views, {
  raci() {
    const p = this.current();
    if (!p) return this.emptyProject();

    if (State.tasks.length === 0) {
      return `
        <div class="page-title-block"><div class="page-eyebrow">PROJETO · RACI</div><div class="page-title">Matriz RACI</div></div>
        <div class="empty-state" style="background:var(--bg-panel);border:1px solid var(--border);border-radius:3px;">
          <div class="empty-state-title">Cadastre tarefas primeiro</div>
          <div class="empty-state-sub">A matriz RACI define <strong>quem é Responsável, Aprovador, Consultado e Informado</strong> para cada tarefa do projeto.</div>
          <button class="btn btn-cta" data-action="goto-tasks">Ir para Tarefas</button>
        </div>
      `;
    }

    if (State.members.length === 0) {
      return `
        <div class="page-title-block"><div class="page-eyebrow">PROJETO · RACI</div><div class="page-title">Matriz RACI</div></div>
        <div class="empty-state" style="background:var(--bg-panel);border:1px solid var(--border);border-radius:3px;">
          <div class="empty-state-title">Adicione membros à equipe</div>
          <div class="empty-state-sub">É preciso ter pessoas cadastradas para atribuir papéis RACI.</div>
        </div>
      `;
    }

    const tks = State.tasks.filter(t => !t.inactive);

    // Índice deliverable_id → member_id → roles[], montado uma vez (evita filter() O(T×M×R) por célula)
    const raciIdx = new Map();
    State.raci.forEach(x => {
      if (!raciIdx.has(x.deliverable_id)) raciIdx.set(x.deliverable_id, new Map());
      const byMember = raciIdx.get(x.deliverable_id);
      if (!byMember.has(x.member_id)) byMember.set(x.member_id, []);
      byMember.get(x.member_id).push(x.role);
    });

    return `
      <div class="page-title-block">
        <div class="page-eyebrow">PROJETO · RACI</div>
        <div class="page-title">Matriz de Responsabilidade</div>
        <div class="page-subtitle">Clique em qualquer célula para atribuir/remover papéis. <strong>R</strong>esponsável (resolve), <strong>A</strong>provador (decide), <strong>C</strong>onsultado, <strong>I</strong>nformado.</div>
      </div>

      <div class="raci-legend">
        <div class="raci-legend-item"><span class="raci-pill R">R</span> <span>Responsible — quem resolve</span></div>
        <div class="raci-legend-item"><span class="raci-pill A">A</span> <span>Accountable — decisão final</span></div>
        <div class="raci-legend-item"><span class="raci-pill C">C</span> <span>Consulted — fornece input</span></div>
        <div class="raci-legend-item"><span class="raci-pill I">I</span> <span>Informed — recebe atualizações</span></div>
      </div>

      <div class="filter-bar">
        <span class="filter-count">${tks.length} ${tks.length === 1 ? 'tarefa' : 'tarefas'} · ${State.members.length} ${State.members.length === 1 ? 'pessoa' : 'pessoas'}</span>
      </div>

      <div class="panel" style="padding:0;">
        <div style="overflow-x:auto;max-height:calc(100vh - 360px);overflow-y:auto;">
          <table class="raci-table">
            <thead>
              <tr>
                <th class="col-deliverable">Tarefa</th>
                ${State.members.map(m => `<th title="${escapeHtml(m.name)}"><div style="font-size:10px;line-height:1.2;">${escapeHtml(m.name.split(' ')[0])}</div><div style="font-size:9px;color:var(--ink-mute);font-weight:400;">${escapeHtml((m.role || '').slice(0, 16))}</div></th>`).join('')}
              </tr>
            </thead>
            <tbody>
              ${tks.map(t => {
                const stLabel = STATUS_LABELS[t.status] || t.status;
                return `
                  <tr>
                    <td class="col-deliverable">
                      <div style="font-family:var(--font-mono);font-size:10px;color:var(--accent);">${escapeHtml(t.code || '')}</div>
                      <div style="font-size:13px;font-weight:600;margin-top:2px;line-height:1.3;">${escapeHtml(t.title)}</div>
                      <span style="font-size:9px;font-weight:700;color:var(--ink-mute);">${escapeHtml(stLabel)}</span>
                    </td>
                    ${State.members.map(m => {
                      const roles = (raciIdx.get(t.id)?.get(m.id) || []).slice().sort();
                      return `
                        <td class="raci-cell" data-action="toggle-raci" data-task="${t.id}" data-member="${m.id}">
                          ${roles.length > 0
                            ? roles.map(role => `<span class="raci-pill ${role}" title="${RACI_LABELS[role]}">${role}</span>`).join(' ')
                            : '<span class="raci-empty">·</span>'}
                        </td>
                      `;
                    }).join('')}
                  </tr>
                `;
              }).join('')}
            </tbody>
          </table>
        </div>
      </div>
    `;
  },
});

// Plugado em UI: continuam acessíveis como UI.<método> e this.<método>.
Object.assign(UI, {
  // ===== RACI CELL TOGGLE =====
  openRaciCellMenu(taskId, memberId) {
    const t = State.tasks.find(x => x.id === taskId);
    const m = State.members.find(x => x.id === memberId);
    if (!t || !m) return;
    const current = State.raci.filter(x => x.deliverable_id === taskId && x.member_id === memberId).map(x => x.role);

    Modal.open({
      title: 'RACI · ' + m.name,
      body: `
        <div style="background:var(--bg-deep);padding:10px;border-radius:2px;margin-bottom:14px;font-size:12px;">
          <div style="color:var(--ink-mute);font-family:var(--font-mono);font-size:10px;text-transform:uppercase;letter-spacing:0.1em;">Tarefa</div>
          <div style="font-weight:600;margin-top:2px;line-height:1.4;">${escapeHtml(t.title)}</div>
        </div>
        <div style="font-size:13px;color:var(--ink-soft);margin-bottom:14px;">Selecione os papéis de <strong>${escapeHtml(m.name)}</strong> nesta tarefa:</div>
        <div style="display:flex;flex-direction:column;gap:8px;">
          ${['R', 'A', 'C', 'I'].map(role => `
            <label style="display:flex;align-items:center;gap:12px;padding:10px;background:var(--bg-deep);border-radius:2px;cursor:pointer;border:1px solid var(--border);">
              <input type="checkbox" name="role" value="${role}" ${current.includes(role) ? 'checked' : ''}>
              <span class="raci-pill ${role}">${role}</span>
              <span style="font-size:13px;">${RACI_LABELS[role]}</span>
            </label>
          `).join('')}
        </div>
        <div style="font-size:11px;color:var(--ink-mute);margin-top:12px;font-family:var(--font-mono);">
          ⓘ DICA: cada tarefa deve ter 1 "A" (responsável pela decisão final).
        </div>
      `,
      footer: `<button class="btn btn-secondary" id="btnCancelRaci">Cancelar</button><button class="btn btn-cta" id="btnSaveRaci">Salvar</button>`
    });
    $('#btnCancelRaci').onclick = () => Modal.close();
    $('#btnSaveRaci').onclick = async () => {
      const selectedRoles = Array.from($('#modal').querySelectorAll('input[name="role"]:checked')).map(i => i.value);
      const toAdd = selectedRoles.filter(x => !current.includes(x));
      const toRemove = current.filter(x => !selectedRoles.includes(x));
      try {
        setLoading(true);
        for (const role of toAdd) {
          const created = await DB.setRaci(taskId, memberId, role);
          if (created) State.raci.push(created);
        }
        for (const role of toRemove) {
          await DB.removeRaci(taskId, memberId, role);
          State.raci = State.raci.filter(x => !(x.deliverable_id === taskId && x.member_id === memberId && x.role === role));
        }
        Modal.close();
        await UI.render();
        toast('RACI atualizado', 'success');
      } catch (err) { toast(friendlyError(err), 'error'); }
      finally { setLoading(false); }
    };
  },

  printRaci() {
    const p = Views.current();
    if (!p) { toast('Selecione um projeto', 'warning'); return; }
    if (!State.tasks.length) { toast('Nenhuma tarefa cadastrada', 'warning'); return; }
    const tks  = State.tasks.filter(t => !t.inactive);
    const mems = State.members;
    const raciLabel = { R:'raci-r', A:'raci-a', C:'raci-c', I:'raci-i' };

    // Índice deliverable_id → member_id → roles[], montado uma vez (evita filter() O(T×M×R) por célula)
    const raciIdx = new Map();
    State.raci.forEach(x => {
      if (!raciIdx.has(x.deliverable_id)) raciIdx.set(x.deliverable_id, new Map());
      const byMember = raciIdx.get(x.deliverable_id);
      if (!byMember.has(x.member_id)) byMember.set(x.member_id, []);
      byMember.get(x.member_id).push(x.role);
    });

    const header = `<th style="min-width:220px;">Tarefa</th>${mems.map(m=>`<th style="text-align:center;max-width:70px;word-break:break-word;">${escapeHtml(m.name.split(' ')[0])}<br><span style="font-weight:400;font-size:8px;color:#8a96a8;">${escapeHtml((m.role||'').slice(0,12))}</span></th>`).join('')}`;
    const rows = tks.map(t => {
      const stLabel = STATUS_LABELS[t.status] || t.status;
      const cells = mems.map(m => {
        const roles = (raciIdx.get(t.id)?.get(m.id) || []).slice().sort();
        return `<td class="raci-cell">${roles.map(role=>`<span class="badge ${raciLabel[role]||''}">${role}</span>`).join(' ')||'·'}</td>`;
      }).join('');
      return `<tr>
        <td><span style="font-family:monospace;font-size:9px;color:#64748b;">${escapeHtml(t.code||'')}</span><br><strong style="font-size:11px;">${escapeHtml(t.title)}</strong><br><span style="font-size:8px;color:#94928B;">${escapeHtml(stLabel)}</span></td>
        ${cells}
      </tr>`;
    }).join('');

    const legend = `<div style="display:flex;gap:12px;margin-bottom:12px;font-size:9px;">
      <span><span class="badge raci-r">R</span> Responsible — quem resolve</span>
      <span><span class="badge raci-a">A</span> Accountable — decide</span>
      <span><span class="badge raci-c">C</span> Consulted — fornece input</span>
      <span><span class="badge raci-i">I</span> Informed — recebe atualizações</span>
    </div>`;

    const body = `${legend}<table><thead><tr>${header}</tr></thead><tbody>${rows}</tbody></table>`;
    this._printWindow('Matriz RACI · Tarefas', body);
  },
});
