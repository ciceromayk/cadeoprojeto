// Tela Setores
import { DB } from './db.js';
import { Dialog } from './dialog.js';
import { friendlyError, setLoading, toast } from './feedback.js';
import { $, colorFromString, escapeHtml, fmtDateShort, parentTag, today } from './helpers.js';
import { Modal } from './modal.js';
import { State } from './state.js';
import { UI } from './ui.js';
import { Views } from './views.js';

// Plugado em Views: continuam acessíveis como Views.<método> e this.<método>.
Object.assign(Views, {
  // ===== VIEW SETORES =====
  sectors() {
    const p = this.current();
    if (!p) return this.emptyProject();

    const tdToday = today();

    // Todos os nomes de setor: cadastrados ∪ presentes nas tarefas
    const allSectorNames = [...new Set(
      (State.sectors || []).map(s => s.name)
        .concat(State.tasks.map(t => t.sector).filter(Boolean))
    )].sort((a, b) => a.localeCompare(b, 'pt-BR'));

    if (allSectorNames.length === 0) {
      return `
        <div class="page-title-block">
          <div class="page-eyebrow">ENGENHARIA · SETORES</div>
          <div class="page-title">Setores</div>
        </div>
        <div class="empty-state" style="background:var(--bg-panel);border:1px solid var(--border);border-radius:3px;">
          <div class="empty-state-icon"><svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/></svg></div>
          <div class="empty-state-title">Nenhum setor cadastrado</div>
          <div class="empty-state-sub">Cadastre os setores e atribua-os às tarefas para acompanhar a carga e os atrasos por área.</div>
          ${DB.iCanEdit() ? `<button class="btn btn-cta" data-action="manage-sectors">+ Cadastrar Setores</button>` : ''}
        </div>`;
    }

    // Estatísticas por setor
    let sectorData = allSectorNames.map(name => {
      const stasks = State.tasks.filter(t => !t.inactive && t.sector === name);
      const total    = stasks.length;
      const done     = stasks.filter(t => t.status === 'concluido').length;
      const inProg   = stasks.filter(t => t.status === 'em_andamento').length;
      const overdue  = stasks.filter(t => t.status !== 'concluido' && t.end_date && t.end_date < tdToday).length;
      const pending  = total - done;
      const progress = total > 0 ? Math.round(stasks.reduce((s, t) => s + (parseFloat(t.progress) || 0), 0) / total) : 0;
      const color    = colorFromString(name);
      // Próxima tarefa a vencer (não concluída, com data)
      const upcoming = stasks
        .filter(t => t.status !== 'concluido' && t.end_date && t.end_date >= tdToday)
        .sort((a, b) => a.end_date.localeCompare(b.end_date))[0];
      let derivedStatus = 'em_projeto', derivedLabel = 'Sem tarefas';
      if (total > 0) {
        if (done === total)      { derivedStatus = 'emitido';    derivedLabel = 'Concluído'; }
        else if (overdue > 0)    { derivedStatus = 'em_revisao'; derivedLabel = `${overdue} em atraso`; }
        else if (inProg > 0)     { derivedStatus = 'em_projeto'; derivedLabel = 'Em andamento'; }
        else                     { derivedStatus = 'pendente';   derivedLabel = 'A iniciar'; }
      }
      // Responsáveis distintos
      const respIds = [...new Set(stasks.map(t => t.assignee_id).filter(Boolean))];
      const resps = respIds.map(id => State.members.find(m => m.id === id)).filter(Boolean);
      return { name, total, done, inProg, overdue, pending, progress, color, upcoming, derivedStatus, derivedLabel, resps };
    });

    // Filtro: só setores com pendências
    const filterPending = !!State.sectorFilterPending;
    if (filterPending) sectorData = sectorData.filter(x => x.pending > 0);

    // Ordenação
    const sortMode = State.sectorSort || 'overdue';
    sectorData.sort((a, b) => {
      if (sortMode === 'overdue') {
        if (b.overdue !== a.overdue) return b.overdue - a.overdue;
        if (b.pending !== a.pending) return b.pending - a.pending;
      } else if (sortMode === 'pending') {
        if (b.pending !== a.pending) return b.pending - a.pending;
        if (b.overdue !== a.overdue) return b.overdue - a.overdue;
      }
      return a.name.localeCompare(b.name, 'pt-BR');
    });

    const view = State.sectorView === 'list' ? 'list' : 'cards';
    const tBtn = (v, label) => `<button onclick="State.sectorView='${v}';UI.render()" style="padding:5px 12px;font-size:12px;font-family:var(--font-mono);border:none;cursor:pointer;${view === v ? 'background:var(--accent);color:var(--bg-deep);font-weight:700;' : 'background:transparent;color:var(--ink-soft);'}">${label}</button>`;
    const toggle = `<div style="display:inline-flex;border:1px solid var(--border-strong);border-radius:3px;overflow:hidden;">${tBtn('cards', '▦ Cards')}${tBtn('list', '≡ Lista')}</div>`;

    // KPI bar — totais agregados
    const totTotal   = sectorData.reduce((s, x) => s + x.total,   0);
    const totOverdue = sectorData.reduce((s, x) => s + x.overdue, 0);
    const totDone    = sectorData.reduce((s, x) => s + x.done,    0);
    const totPending = sectorData.reduce((s, x) => s + x.pending, 0);
    const kpiBar = `
      <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:14px;">
        <div style="background:var(--bg-panel);border:1px solid var(--border);border-left:3px solid var(--ink-mute);border-radius:3px;padding:10px 14px;">
          <div style="font-family:var(--font-mono);font-size:10px;color:var(--ink-mute);text-transform:uppercase;letter-spacing:.1em;">Total de tarefas</div>
          <div style="font-size:28px;font-weight:800;color:var(--ink);line-height:1.1;">${totTotal}</div>
        </div>
        <div style="background:var(--bg-panel);border:1px solid var(--border);border-left:3px solid var(--accent-danger);border-radius:3px;padding:10px 14px;">
          <div style="font-family:var(--font-mono);font-size:10px;color:var(--ink-mute);text-transform:uppercase;letter-spacing:.1em;">Atrasadas</div>
          <div style="font-size:28px;font-weight:800;color:${totOverdue > 0 ? 'var(--accent-danger)' : 'var(--ink-mute)'};line-height:1.1;">${totOverdue}</div>
        </div>
        <div style="background:var(--bg-panel);border:1px solid var(--border);border-left:3px solid var(--accent-warm);border-radius:3px;padding:10px 14px;">
          <div style="font-family:var(--font-mono);font-size:10px;color:var(--ink-mute);text-transform:uppercase;letter-spacing:.1em;">Pendentes</div>
          <div style="font-size:28px;font-weight:800;color:${totPending > 0 ? 'var(--accent-warm)' : 'var(--ink-mute)'};line-height:1.1;">${totPending}</div>
        </div>
        <div style="background:var(--bg-panel);border:1px solid var(--border);border-left:3px solid var(--accent-success);border-radius:3px;padding:10px 14px;">
          <div style="font-family:var(--font-mono);font-size:10px;color:var(--ink-mute);text-transform:uppercase;letter-spacing:.1em;">Concluídas</div>
          <div style="font-size:28px;font-weight:800;color:var(--accent-success);line-height:1.1;">${totDone}</div>
        </div>
      </div>`;

    // Cards
    const cardsHtml = `<div class="discipline-grid">${sectorData.map(x => `
      <div class="discipline-card sector-card" data-sector-name="${escapeHtml(x.name)}" title="Duplo clique para ver tarefas" style="cursor:pointer;border-left:4px solid ${x.color};">
        <div class="discipline-card-head">
          <div class="discipline-code-block" style="background:${x.color}1a;border:1px solid ${x.color}44;border-radius:4px;min-width:36px;text-align:center;">
            <div class="code" style="color:${x.color};font-size:13px;letter-spacing:.03em;">${escapeHtml(x.name.substring(0,3).toUpperCase())}</div>
          </div>
          <div style="flex:1;min-width:0;">
            <div class="discipline-name">${escapeHtml(x.name)}</div>
            ${x.resps.length > 0 ? `<div style="font-size:10px;color:var(--ink-mute);margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${x.resps.map(r => escapeHtml(r.name)).join(', ')}</div>` : ''}
            <div style="margin-top:6px;"><span class="status-badge status-${x.derivedStatus}">${x.derivedLabel}</span></div>
          </div>
        </div>
        <div class="discipline-stats">
          <div class="discipline-stat"><div class="discipline-stat-num">${x.total}</div><div class="discipline-stat-label">Tarefas</div></div>
          <div class="discipline-stat"><div class="discipline-stat-num" style="color:var(--accent)">${x.inProg}</div><div class="discipline-stat-label">Andamento</div></div>
          <div class="discipline-stat"><div class="discipline-stat-num" style="color:${x.overdue > 0 ? 'var(--accent-danger)' : 'var(--ink-mute)'}">${x.overdue}</div><div class="discipline-stat-label">Atrasadas</div></div>
          <div class="discipline-stat"><div class="discipline-stat-num" style="color:var(--accent-success)">${x.done}</div><div class="discipline-stat-label">Concluídas</div></div>
        </div>
        <div style="margin-top:10px;">
          <div style="display:flex;align-items:center;gap:6px;">
            <div style="flex:1;height:5px;background:var(--bg-deep);border-radius:3px;overflow:hidden;">
              <div style="height:100%;width:${x.progress}%;background:${x.progress >= 100 ? 'var(--accent-success)' : x.progress >= 50 ? 'var(--blueprint)' : x.overdue > 0 ? 'var(--accent-danger)' : 'var(--accent)'};border-radius:3px;transition:width .3s;"></div>
            </div>
            <span style="font-family:var(--font-mono);font-size:10px;color:var(--ink-mute);">${x.progress}%</span>
          </div>
          ${x.upcoming ? `<div style="margin-top:6px;font-size:10px;color:var(--ink-mute);">Próx: <span style="color:var(--ink-soft);">${escapeHtml(x.upcoming.title.substring(0,32))}${x.upcoming.title.length > 32 ? '…' : ''}</span> <span style="font-family:var(--font-mono);">${fmtDateShort(x.upcoming.end_date)}</span></div>` : ''}
        </div>
      </div>`).join('')}</div>`;

    // Lista
    const listHtml = `<div class="panel" style="padding:0;overflow:hidden;">
      <table class="data-table" style="width:100%;">
        <thead><tr>
          <th>Setor</th><th>Responsáveis</th><th>Status</th>
          <th style="text-align:right;width:64px;">Tarefas</th>
          <th style="text-align:right;width:64px;">Andam.</th>
          <th style="text-align:right;width:64px;">Atras.</th>
          <th style="text-align:right;width:64px;">Concl.</th>
          <th style="width:130px;">Progresso</th>
        </tr></thead>
        <tbody>${sectorData.map(x => `<tr class="sector-card" data-sector-name="${escapeHtml(x.name)}" style="cursor:pointer;" title="Duplo clique para ver tarefas">
          <td style="font-weight:600;border-left:3px solid ${x.color};padding-left:10px;">${escapeHtml(x.name)}</td>
          <td style="font-size:11px;color:var(--ink-soft);">${x.resps.length > 0 ? x.resps.map(r => escapeHtml(r.name)).join(', ') : '<span style="color:var(--ink-mute);">—</span>'}</td>
          <td><span class="status-badge status-${x.derivedStatus}">${x.derivedLabel}</span></td>
          <td style="text-align:right;font-family:var(--font-mono);">${x.total}</td>
          <td style="text-align:right;font-family:var(--font-mono);color:var(--accent);">${x.inProg}</td>
          <td style="text-align:right;font-family:var(--font-mono);color:${x.overdue > 0 ? 'var(--accent-danger)' : 'var(--ink-mute)'};">${x.overdue}</td>
          <td style="text-align:right;font-family:var(--font-mono);color:var(--accent-success);">${x.done}</td>
          <td><div style="display:flex;align-items:center;gap:6px;"><div style="flex:1;height:6px;background:var(--bg-deep);border-radius:3px;overflow:hidden;"><div style="height:100%;width:${x.progress}%;background:${x.progress >= 100 ? 'var(--accent-success)' : x.progress >= 50 ? 'var(--blueprint)' : 'var(--accent)'};border-radius:3px;"></div></div><span style="font-family:var(--font-mono);font-size:10px;">${x.progress}%</span></div></td>
        </tr>`).join('')}</tbody>
      </table>
    </div>`;

    return `
      <div style="display:flex;justify-content:space-between;align-items:flex-end;flex-wrap:wrap;gap:8px;margin-bottom:14px;">
        <div class="page-title-block" style="margin-bottom:0;">
          <div class="page-eyebrow">ENGENHARIA · SETORES</div>
          <div class="page-title">Setores</div>
          <div class="page-subtitle">${allSectorNames.length} ${allSectorNames.length === 1 ? 'setor' : 'setores'} · ${State.tasks.filter(t => t.sector).length} tarefas com setor</div>
        </div>
        <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
          <button onclick="State.sectorFilterPending=!State.sectorFilterPending;UI.render();"
            class="btn" style="font-size:12px;padding:5px 11px;display:inline-flex;align-items:center;gap:6px;border:1px solid ${filterPending ? 'var(--accent-warm)' : 'var(--border-strong)'};background:${filterPending ? 'rgba(212,168,44,0.12)' : 'transparent'};color:${filterPending ? 'var(--accent-warm)' : 'var(--ink-soft)'};" title="Mostrar só setores com tarefas pendentes">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:14px;height:14px;"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
            Com pendências
          </button>
          <select onchange="State.sectorSort=this.value;UI.render();" class="form-input" style="width:auto;font-size:12px;padding:5px 10px;" title="Ordenar setores">
            <option value="overdue"  ${sortMode === 'overdue'  ? 'selected' : ''}>Ordem: Mais atrasados</option>
            <option value="pending"  ${sortMode === 'pending'  ? 'selected' : ''}>Ordem: Pendências primeiro</option>
            <option value="alpha"    ${sortMode === 'alpha'    ? 'selected' : ''}>Ordem: A → Z</option>
          </select>
          ${toggle}
          ${DB.iCanEdit() ? `<button class="btn btn-secondary" data-action="manage-sectors" style="display:inline-flex;align-items:center;gap:6px;"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:15px;height:15px;"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/></svg> Gerenciar Setores</button>` : ''}
        </div>
      </div>
      ${kpiBar}
      ${sectorData.length === 0
        ? `<div class="empty-state" style="background:var(--bg-panel);border:1px solid var(--border);border-radius:6px;padding:36px 20px;">
             <div class="empty-state-icon"><svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/></svg></div>
             <div class="empty-state-title">Nenhum setor com pendências</div>
             <div class="empty-state-sub">Todos os setores estão concluídos. Desative o filtro para ver todos.</div>
             <button class="btn btn-secondary" onclick="State.sectorFilterPending=false;UI.render();">Mostrar todos</button>
           </div>`
        : (view === 'list' ? listHtml : cardsHtml)}
    `;
  },
});

// Plugado em UI: continuam acessíveis como UI.<método> e this.<método>.
Object.assign(UI, {
  // ===== MODAL TAREFAS POR SETOR =====
  openSectorTasksModal(sectorName) {
    if (!sectorName) return;
    const stasks = State.tasks.filter(t => t.sector === sectorName);
    const tdToday = today();

    const statusOpts = [
      { v: 'a_fazer',      l: 'A Fazer' },
      { v: 'em_andamento', l: 'Em Andamento' },
      { v: 'bloqueada',    l: 'Bloqueada' },
      { v: 'concluido',    l: 'Concluída' }
    ];
    const priOpts = [
      { v: 'baixa', l: 'Baixa' },
      { v: 'media', l: 'Média' },
      { v: 'alta',  l: 'Alta'  }
    ];

    const selStyle = 'width:100%;background:var(--bg-deep);border:1px solid var(--border);color:var(--ink);border-radius:2px;padding:4px 6px;font-size:12px;font-family:var(--font-display);';
    const fmtBRLLocal = v => v != null && v !== '' ? Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }) : '';

    // ordenar: atrasadas primeiro, depois por data
    const sorted = stasks.slice().sort((a, b) => {
      const aOver = a.status !== 'concluido' && a.end_date && a.end_date < tdToday ? 1 : 0;
      const bOver = b.status !== 'concluido' && b.end_date && b.end_date < tdToday ? 1 : 0;
      if (bOver !== aOver) return bOver - aOver;
      return (a.end_date || '').localeCompare(b.end_date || '');
    });

    const rows = sorted.length === 0
      ? `<tr><td colspan="6" style="text-align:center;padding:32px;color:var(--ink-mute);">Nenhuma tarefa neste setor.</td></tr>`
      : sorted.map((t, i) => {
          const isOver = t.status !== 'concluido' && t.end_date && t.end_date < tdToday;
          const assigneeOpts = State.members.map(m => `<option value="${m.id}"${t.assignee_id === m.id ? ' selected' : ''}>${escapeHtml(m.name)}</option>`).join('');
          const stOpts = statusOpts.map(s => `<option value="${s.v}"${t.status === s.v ? ' selected' : ''}>${s.l}</option>`).join('');
          const prOpts = priOpts.map(p => `<option value="${p.v}"${t.priority === p.v ? ' selected' : ''}>${p.l}</option>`).join('');
          const progColor = t.progress >= 100 ? 'var(--accent-success)' : t.progress >= 50 ? 'var(--blueprint)' : 'var(--accent)';
          return `<tr data-task-id="${t.id}" style="${isOver ? 'background:rgba(var(--accent-danger-rgb, 180,30,30),0.04);' : ''}">
            <td style="font-family:var(--font-mono);font-size:11px;color:var(--ink-mute);white-space:nowrap;padding-right:4px;vertical-align:top;padding-top:10px;">${escapeHtml(t.code || String(i + 1))}</td>
            <td style="font-size:12px;font-weight:500;vertical-align:top;padding-top:8px;">
              <div style="display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden;line-height:1.3;word-break:break-word;" title="${escapeHtml(t.title)}">${escapeHtml(t.title)}</div>
              ${parentTag(t)}
              ${t.end_date ? `<div style="font-size:10px;font-family:var(--font-mono);margin-top:2px;color:${isOver ? 'var(--accent-danger)' : 'var(--ink-mute)'};">${isOver ? '⚠ ' : ''}${fmtDateShort(t.end_date)}</div>` : ''}
            </td>
            <td style="width:170px;vertical-align:top;"><select class="dt-sec-field" data-field="assignee_id" data-id="${t.id}" style="${selStyle}"><option value="">— Sem responsável</option>${assigneeOpts}</select></td>
            <td style="width:140px;vertical-align:top;"><select class="dt-sec-field" data-field="status" data-id="${t.id}" style="${selStyle}">${stOpts}</select></td>
            <td style="width:105px;vertical-align:top;"><select class="dt-sec-field" data-field="priority" data-id="${t.id}" style="${selStyle}">${prOpts}</select></td>
            <td style="width:80px;vertical-align:top;">
              <div style="display:flex;flex-direction:column;gap:4px;">
                <input class="dt-sec-field dt-prog-field" data-field="progress" data-id="${t.id}" type="number" min="0" max="100" value="${parseFloat(t.progress) || 0}" style="width:100%;background:var(--bg-deep);border:1px solid var(--border);color:var(--ink);border-radius:2px;padding:4px 6px;font-size:12px;font-family:var(--font-mono);">
                <div style="height:4px;background:var(--bg-deep);border-radius:2px;overflow:hidden;"><div class="sec-prog-bar" data-id="${t.id}" style="height:100%;width:${parseFloat(t.progress)||0}%;background:${progColor};border-radius:2px;transition:width .2s;"></div></div>
              </div>
            </td>
          </tr>`;
        }).join('');

    Modal.open({
      title: `Tarefas · Setor: ${escapeHtml(sectorName)}`,
      cls: 'modal-wide',
      body: `
        <div style="font-size:12px;color:var(--ink-mute);margin-bottom:12px;">${sorted.length} tarefa${sorted.length !== 1 ? 's' : ''} · Ordenadas por atraso. Edite os campos — salva automaticamente ao sair do campo.</div>
        <div style="overflow-x:auto;">
          <table class="data-table" style="width:100%;table-layout:fixed;">
            <thead><tr>
              <th style="width:60px;">Código</th>
              <th style="width:300px;">Título / Prazo</th>
              <th style="width:170px;">Responsável</th>
              <th style="width:140px;">Status</th>
              <th style="width:105px;">Prioridade</th>
              <th style="width:80px;">%</th>
            </tr></thead>
            <tbody>${rows}</tbody>
          </table>
        </div>`,
      footer: `<button class="btn btn-secondary" id="btnCloseSectorTasks">Fechar</button>`
    });
    $('#modal').style.maxWidth = '1060px';
    $('#btnCloseSectorTasks').onclick = () => Modal.close();

    // Auto-salva
    $('#modal').querySelectorAll('.dt-sec-field').forEach(el => {
      if (el.classList.contains('dt-prog-field')) {
        el.addEventListener('change', async () => {
          const taskId = el.dataset.id;
          let val = Math.max(0, Math.min(100, parseInt(el.value, 10) || 0));
          el.value = val;
          const task = State.tasks.find(t => t.id === taskId);
          if (!task) return;
          const prev = task.progress;
          task.progress = val;
          const patch = { progress: val };
          if (val >= 100 && !State.tasks.some(t => t.parent_id === taskId)) patch.status = 'concluido';
          if (patch.status) task.status = patch.status;
          // atualiza barra visual
          const bar = $('#modal').querySelector(`.sec-prog-bar[data-id="${taskId}"]`);
          if (bar) { bar.style.width = val + '%'; bar.style.background = val >= 100 ? 'var(--accent-success)' : val >= 50 ? 'var(--blueprint)' : 'var(--accent)'; }
          try {
            await DB.updateTask(taskId, patch);
            await UI.rollUpParentTask(task.parent_id || null, true);
            el.style.outline = '2px solid var(--accent-success)';
            setTimeout(() => { el.style.outline = ''; }, 700);
          } catch (err) {
            task.progress = prev; el.value = prev;
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
        const patch = { [field]: val };
        const _isParent = State.tasks.some(t => t.parent_id === taskId);
        if (field === 'status' && val === 'concluido' && !_isParent && (parseFloat(task.progress) || 0) < 100) patch.progress = 100;
        task[field] = val;
        if (patch.progress !== undefined) task.progress = patch.progress;
        try {
          await DB.updateTask(taskId, patch);
          if (patch.progress !== undefined) await UI.rollUpParentTask(task.parent_id || null, true);
          el.style.outline = '2px solid var(--accent-success)';
          setTimeout(() => { el.style.outline = ''; }, 700);
        } catch (err) {
          task[field] = prev;
          el.value = field === 'assignee_id' ? (prev || '') : prev;
          el.style.outline = '2px solid var(--accent-danger)';
          toast('Erro ao salvar: ' + err.message, 'error');
        }
      });
    });
  },

  // ===== CADASTRO DE SETORES =====
  openSectorsModal(onClose) {
    if (!State.currentProjectId) { toast('Crie um projeto primeiro', 'error'); return; }
    const delSvg = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:14px;height:14px;"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/></svg>`;
    const render = () => {
      const list = (State.sectors || []).slice().sort((a, b) => a.name.localeCompare(b.name));
      const _memberOpts = (selId) => `<option value="">— Sem responsável —</option>` + State.members.map(m => `<option value="${m.id}" ${selId === m.id ? 'selected' : ''}>${escapeHtml(m.name)}${m.role ? ' — ' + escapeHtml(m.role) : ''}</option>`).join('');
      const rows = list.length === 0
        ? `<tr><td colspan="3" style="text-align:center;padding:24px;color:var(--ink-mute);">Nenhum setor cadastrado ainda.</td></tr>`
        : list.map(s => {
            const usage = State.tasks.filter(t => t.sector === s.name).length;
            return `<tr>
              <td style="padding:9px 12px;border-bottom:1px solid var(--border);font-weight:500;">${escapeHtml(s.name)}<span style="color:var(--ink-mute);font-family:var(--font-mono);font-size:10px;margin-left:8px;">${usage} tarefa${usage !== 1 ? 's' : ''}</span></td>
              <td style="padding:6px 12px;border-bottom:1px solid var(--border);"><select class="form-input" data-sector-lead="${s.id}" style="padding:4px 6px;font-size:12px;min-width:170px;" title="Responsável pelo setor">${_memberOpts(s.lead_member_id)}</select></td>
              <td style="padding:9px 12px;border-bottom:1px solid var(--border);text-align:right;white-space:nowrap;">
                <button class="icon-btn danger" data-del-sector="${s.id}" title="Excluir setor">${delSvg}</button>
              </td>
            </tr>`;
          }).join('');
      $('#modalBody').innerHTML = `
        <div style="font-size:12px;color:var(--ink-soft);margin-bottom:12px;">Cadastre os setores/áreas responsáveis e, se quiser, aloque um membro como <strong>responsável</strong> por cada setor. Eles ficam disponíveis no campo "Setor responsável" das tarefas e nos filtros dos relatórios.</div>
        <form id="sectorAddForm" style="display:flex;gap:8px;margin-bottom:10px;">
          <input class="form-input" id="newSectorName" placeholder="Nome do setor (ex.: Projetos, Compras, Obra)" maxlength="60" autocomplete="off" style="flex:1;">
          <button type="submit" class="btn btn-cta" style="white-space:nowrap;">+ Adicionar</button>
          <button type="button" class="btn btn-secondary" id="btnImportSectors" style="white-space:nowrap;" title="Copiar setores de outra obra">Importar de outra obra</button>
        </form>
        <div style="border:1px solid var(--border);border-radius:3px;overflow:hidden;">
          <table style="width:100%;border-collapse:collapse;font-size:13px;"><tbody>${rows}</tbody></table>
        </div>`;
      $('#sectorAddForm').onsubmit = async (e) => {
        e.preventDefault();
        const name = $('#newSectorName').value.trim();
        if (!name) return;
        if ((State.sectors || []).some(s => s.name.toLowerCase() === name.toLowerCase())) { toast('Esse setor já existe', 'warning'); return; }
        try {
          const created = await DB.createSector(State.currentProjectId, { name });
          State.sectors.push(created);
          render();
        } catch (err) {
          const raw = err.message || '';
          const msg = (raw.includes('sectors') || raw.includes('schema cache') || raw.includes('does not exist'))
            ? 'Banco desatualizado: rode 32-sectors.sql no Supabase.' : raw;
          toast(msg, 'error');
        }
      };
      $('#modalBody').querySelectorAll('[data-sector-lead]').forEach(sel => {
        sel.onchange = async () => {
          const id = sel.dataset.sectorLead;
          const sec = State.sectors.find(s => s.id === id);
          if (!sec) return;
          const val = sel.value || null;
          try {
            await DB.updateSector(id, { lead_member_id: val });
            sec.lead_member_id = val;
            toast('Responsável do setor atualizado', 'success');
          } catch (err) {
            const raw = err.message || '';
            const msg = (raw.includes('lead_member_id') || raw.includes('schema cache') || raw.includes('column') || raw.includes('does not exist'))
              ? 'Banco desatualizado: rode 37-sector-lead-member.sql no Supabase.' : friendlyError(err);
            toast(msg, 'error');
            render(); // reverte o select ao valor salvo
          }
        };
      });
      $('#modalBody').querySelectorAll('[data-del-sector]').forEach(btn => {
        btn.onclick = async () => {
          const id = btn.dataset.delSector;
          const sec = State.sectors.find(s => s.id === id);
          if (!sec) return;
          if (!await Dialog.confirm({ title: 'Excluir setor', msg: `Excluir o setor "${sec.name}"?\n\nAs tarefas que o utilizam mantêm o texto, mas ele sai da lista.`, confirmText: 'Excluir', danger: true })) return;
          try {
            await DB.deleteSector(id);
            State.sectors = State.sectors.filter(s => s.id !== id);
            render();
          } catch (err) { toast(friendlyError(err), 'error'); }
        };
      });
      const _btnImp = $('#btnImportSectors');
      if (_btnImp) _btnImp.onclick = () => UI.openImportFromObraModal('sectors');
      $('#newSectorName')?.focus();
    };
    Modal.open({
      title: 'Cadastro de Setores',
      cls: 'modal-wide',
      body: '',
      footer: `<button class="btn btn-secondary" id="btnCloseSectors">Concluído</button>`
    });
    render();
    $('#btnCloseSectors').onclick = () => { if (typeof onClose === 'function') onClose(); else { Modal.close(); UI.render(); } };
  },

  // ===== IMPORTAR SETORES / DISCIPLINAS DE OUTRA OBRA =====
  async openImportFromObraModal(kind) {
    // kind: 'sectors' | 'disciplines'
    if (!State.currentProjectId) { toast('Crie um projeto primeiro', 'error'); return; }
    if (!DB.iCanEdit()) { toast('Sem permissão para editar este projeto', 'error'); return; }
    const label = kind === 'sectors' ? 'setores' : 'disciplinas';
    const others = State.projects.filter(p => p.id !== State.currentProjectId && DB.iCanEditProject(p.id));
    if (others.length === 0) { toast('Você não tem outra obra para importar', 'warning'); return; }

    // Conjunto de itens já existentes (para evitar duplicados)
    const existing = kind === 'sectors'
      ? new Set((State.sectors || []).map(s => (s.name || '').toLowerCase()))
      : new Set((State.disciplines || []).map(d => (d.code || '').toUpperCase()));
    let loaded = [];

    Modal.open({
      title: `Importar ${label} de outra obra`,
      cls: 'modal-wide',
      body: `
        <div class="form-group">
          <label class="form-label">Obra de origem</label>
          <select class="form-input" id="impSrcProject">
            <option value="">— Selecione a obra —</option>
            ${others.map(p => `<option value="${p.id}">${escapeHtml(p.name)}</option>`).join('')}
          </select>
        </div>
        <div style="display:flex;justify-content:space-between;align-items:center;margin:6px 0;">
          <span style="font-size:11px;color:var(--ink-mute);">Itens já existentes nesta obra aparecem desativados.</span>
          <button type="button" class="btn btn-ghost" id="impToggleAll" style="font-size:11px;padding:3px 8px;display:none;">Marcar/desmarcar todos</button>
        </div>
        <div id="impList" style="border:1px solid var(--border);border-radius:3px;max-height:320px;overflow:auto;padding:6px;">
          <div style="padding:18px;text-align:center;color:var(--ink-mute);font-size:12px;">Selecione uma obra para ver os ${label}.</div>
        </div>`,
      footer: `<button class="btn btn-secondary" id="impCancel">Cancelar</button>
               <button class="btn btn-cta" id="impDo" disabled>Importar selecionados</button>`
    });

    const renderList = (items) => {
      loaded = items || [];
      const listEl = $('#impList');
      if (!loaded.length) {
        listEl.innerHTML = `<div style="padding:18px;text-align:center;color:var(--ink-mute);font-size:12px;">Essa obra não tem ${label} cadastrad${kind === 'sectors' ? 'os' : 'as'}.</div>`;
        $('#impDo').disabled = true; $('#impToggleAll').style.display = 'none';
        return;
      }
      listEl.innerHTML = loaded.map((it, i) => {
        const dupe = kind === 'sectors'
          ? existing.has((it.name || '').toLowerCase())
          : existing.has((it.code || '').toUpperCase());
        const txt = kind === 'sectors' ? escapeHtml(it.name || '') : `<span style="font-family:var(--font-mono);color:var(--accent);">${escapeHtml(it.code || '')}</span> · ${escapeHtml(it.name || '')}`;
        return `<label style="display:flex;align-items:center;gap:9px;padding:7px 8px;border-bottom:1px solid var(--border);font-size:13px;cursor:${dupe ? 'default' : 'pointer'};${dupe ? 'opacity:.5;' : ''}">
          <input type="checkbox" data-imp="${i}" ${dupe ? 'disabled' : 'checked'} style="width:15px;height:15px;accent-color:var(--accent);">
          <span style="flex:1;">${txt}</span>
          ${dupe ? '<span style="font-size:10px;color:var(--ink-mute);font-family:var(--font-mono);">já existe</span>' : ''}
        </label>`;
      }).join('');
      $('#impDo').disabled = false;
      $('#impToggleAll').style.display = '';
    };

    $('#impSrcProject').onchange = async (e) => {
      const pid = e.target.value;
      if (!pid) { renderList([]); $('#impList').innerHTML = `<div style="padding:18px;text-align:center;color:var(--ink-mute);font-size:12px;">Selecione uma obra para ver os ${label}.</div>`; return; }
      $('#impList').innerHTML = `<div style="padding:18px;text-align:center;color:var(--ink-mute);font-size:12px;">Carregando…</div>`;
      try {
        const items = kind === 'sectors' ? await DB.listSectors(pid) : await DB.listDisciplines(pid);
        renderList(items);
      } catch (err) { $('#impList').innerHTML = `<div style="padding:18px;text-align:center;color:var(--accent-danger);font-size:12px;">Erro ao carregar: ${escapeHtml(err.message)}</div>`; }
    };

    $('#impToggleAll').onclick = () => {
      const boxes = [...$('#impList').querySelectorAll('input[data-imp]:not(:disabled)')];
      const allOn = boxes.every(b => b.checked);
      boxes.forEach(b => { b.checked = !allOn; });
    };

    $('#impCancel').onclick = () => Modal.close();
    $('#impDo').onclick = async () => {
      const picked = [...$('#impList').querySelectorAll('input[data-imp]:checked')].map(c => loaded[+c.dataset.imp]).filter(Boolean);
      if (!picked.length) { toast('Selecione ao menos um item', 'warning'); return; }
      setLoading(true);
      let n = 0;
      try {
        for (const it of picked) {
          if (kind === 'sectors') {
            const created = await DB.createSector(State.currentProjectId, { name: it.name, notes: it.notes || null });
            State.sectors.push(created);
            existing.add((it.name || '').toLowerCase());
          } else {
            const created = await DB.createDiscipline(State.currentProjectId, { code: it.code, name: it.name, notes: it.notes || null });
            State.disciplines.push(created);
            existing.add((it.code || '').toUpperCase());
          }
          n++;
        }
        Modal.close();
        await UI.render();
        toast(`${n} ${n === 1 ? (kind === 'sectors' ? 'setor importado' : 'disciplina importada') : label + ' importad' + (kind === 'sectors' ? 'os' : 'as')}`, 'success');
      } catch (err) {
        const raw = err.message || '';
        const msg = (raw.includes('does not exist') || raw.includes('schema cache'))
          ? (kind === 'sectors' ? 'Banco desatualizado: rode 32-sectors.sql no Supabase.' : raw)
          : raw;
        toast('Erro ao importar: ' + msg, 'error');
      } finally { setLoading(false); }
    };
  },
});
