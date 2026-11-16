// Linhas de base: comparativo, editor e histórico
import { BaselineCompare } from './baseline.js';
import { DB } from './db.js';
import { Dialog } from './dialog.js';
import { friendlyError, setLoading, toast } from './feedback.js';
import { $, escapeHtml, fmtDateShort } from './helpers.js';
import { Modal } from './modal.js';
import { State } from './state.js';
import { UI } from './ui.js';
import { Views } from './views.js';

// Plugado em Views: continuam acessíveis como Views.<método> e this.<método>.
Object.assign(Views, {
  // ===== VIEW "HOJE" — uso rápido em obra/visita =====
  // ===== VIEW COMPARATIVO DE BASELINES =====
  baselineCompare() {
    if (!Views.current()) return Views.emptyProject();
    const { chain, perTask, stages } = BaselineCompare.buildDiff();

    if (chain.length < 2) {
      return `
        <div class="page-title-block">
          <div class="page-eyebrow">CRONOGRAMA · COMPARATIVO</div>
          <div class="page-title">Comparar Baselines</div>
        </div>
        <div class="empty-state" style="background:var(--bg-panel);border:1px solid var(--border);border-radius:3px;padding:40px 20px;">
          <div class="empty-state-title">Sem baselines suficientes</div>
          <div class="empty-state-sub">Salve pelo menos uma linha de base no Gantt → Ferramentas → Salvar Linha de Base.</div>
        </div>`;
    }

    // Cores da cadeia LB1..LB4 + atual
    const colors = ['var(--blueprint)', 'var(--accent-warm)', 'var(--accent-success)', 'var(--accent-violet)', 'var(--accent)'];
    const labelOf = (s) => s.slot === 'CUR' ? 'Atual' : `LB${s.slot}`;

    // Ordena tarefas por |totalEndShift| desc (maiores variações primeiro)
    const sorted = perTask.slice().sort((a, b) => Math.abs(b.totalEndShift || 0) - Math.abs(a.totalEndShift || 0));
    const topN = 30; // mostrar top 30 por padrão
    const limited = sorted.slice(0, topN);

    // ── KPIs por estágio ────────────────────────────────────────────────────
    const stageCards = stages.map((s, i) => {
      const c = colors[Math.min(i + 1, colors.length - 1)];
      const sign = s.totalShift > 0 ? '+' : '';
      const shiftColor = s.totalShift > 0 ? 'var(--accent-danger)' : s.totalShift < 0 ? 'var(--accent-success)' : 'var(--ink-mute)';
      return `
        <div class="panel" style="padding:14px 16px;border-left:3px solid ${c};">
          <div style="font-family:var(--font-mono);font-size:10px;color:var(--ink-mute);text-transform:uppercase;letter-spacing:.1em;margin-bottom:6px;">
            ${escapeHtml(s.fromLbl)} → ${escapeHtml(s.toLbl)}
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">
            <div>
              <div style="font-size:22px;font-weight:800;color:${shiftColor};line-height:1.1;">${sign}${s.totalShift}d</div>
              <div style="font-size:10px;color:var(--ink-mute);">Desvio total (fim)</div>
            </div>
            <div>
              <div style="font-size:22px;font-weight:800;color:var(--ink);line-height:1.1;">${s.avgShift > 0 ? '+' : ''}${s.avgShift}d</div>
              <div style="font-size:10px;color:var(--ink-mute);">Média por tarefa</div>
            </div>
            <div>
              <div style="font-size:14px;font-weight:700;color:var(--accent-danger);">${s.atrasadas}</div>
              <div style="font-size:10px;color:var(--ink-mute);">Atrasaram</div>
            </div>
            <div>
              <div style="font-size:14px;font-weight:700;color:var(--accent-success);">${s.adiantadas}</div>
              <div style="font-size:10px;color:var(--ink-mute);">Adiantaram</div>
            </div>
            <div>
              <div style="font-size:14px;font-weight:700;color:var(--blueprint);">+${s.added}</div>
              <div style="font-size:10px;color:var(--ink-mute);">Entraram</div>
            </div>
            <div>
              <div style="font-size:14px;font-weight:700;color:var(--ink-mute);">−${s.removed}</div>
              <div style="font-size:10px;color:var(--ink-mute);">Saíram</div>
            </div>
          </div>
        </div>`;
    }).join('');

    // ── Gráfico de cascata (variação do total de dias entre estágios) ──────
    // Cada barra mostra como o desvio MÉDIO foi acumulando.
    const VW = 900, VH = 220, mL = 60, mR = 16, mT = 16, mB = 36;
    const pw = VW - mL - mR, ph = VH - mT - mB;
    const cumulative = [];
    let acc = 0;
    stages.forEach(s => { acc += s.totalShift; cumulative.push(acc); });
    const maxAbs = Math.max(1, ...cumulative.map(Math.abs));
    const Y = v => mT + ph / 2 - (v / maxAbs) * (ph / 2);
    const barW = pw / stages.length * 0.6;
    let prev = 0;
    const waterfallBars = stages.map((s, i) => {
      const xC = mL + (i + 0.5) * (pw / stages.length);
      const y0 = Y(prev), y1 = Y(prev + s.totalShift);
      const yTop = Math.min(y0, y1), h = Math.abs(y1 - y0);
      const fill = s.totalShift > 0 ? 'var(--accent-danger)' : 'var(--accent-success)';
      const rect = `<rect x="${(xC - barW/2).toFixed(1)}" y="${yTop.toFixed(1)}" width="${barW.toFixed(1)}" height="${Math.max(2, h).toFixed(1)}" rx="2" fill="${fill}" opacity="0.78"/>`;
      const sign = s.totalShift > 0 ? '+' : '';
      const lbl = `<text x="${xC.toFixed(1)}" y="${(yTop - 6).toFixed(1)}" text-anchor="middle" font-size="11" font-family="var(--font-mono)" fill="${fill}" font-weight="700">${sign}${s.totalShift}d</text>`;
      const stage = `<text x="${xC.toFixed(1)}" y="${(VH - 18).toFixed(1)}" text-anchor="middle" font-size="9" font-family="var(--font-mono)" fill="var(--ink-mute)">${escapeHtml(s.fromLbl)}→${escapeHtml(s.toLbl)}</text>`;
      const cum = `<text x="${xC.toFixed(1)}" y="${(VH - 4).toFixed(1)}" text-anchor="middle" font-size="9" font-family="var(--font-mono)" fill="var(--ink-soft)">acum ${cumulative[i] > 0 ? '+' : ''}${cumulative[i]}d</text>`;
      prev += s.totalShift;
      return rect + lbl + stage + cum;
    }).join('');
    const baseline0 = `<line x1="${mL}" y1="${Y(0).toFixed(1)}" x2="${VW-mR}" y2="${Y(0).toFixed(1)}" stroke="var(--ink-mute)" stroke-width="1" stroke-dasharray="4 3"/>`;
    const waterfall = `
      <div class="panel" style="margin-bottom:14px;">
        <div class="panel-head"><div class="panel-title">Desvio Acumulado (Cascata)</div><div class="panel-title-mono">dias de variação no término</div></div>
        <div class="panel-body">
          <svg viewBox="0 0 ${VW} ${VH}" width="100%" preserveAspectRatio="xMidYMid meet" style="display:block;">
            ${baseline0}${waterfallBars}
            <text x="${mL - 10}" y="${(Y(0) + 4).toFixed(1)}" text-anchor="end" font-size="9" font-family="var(--font-mono)" fill="var(--ink-mute)">0d</text>
          </svg>
          <div style="font-size:11px;color:var(--ink-mute);margin-top:8px;">
            <strong style="color:var(--accent-danger);">Vermelho = atraso adicional</strong> ·
            <strong style="color:var(--accent-success);">Verde = ganho de prazo</strong>
          </div>
        </div>
      </div>`;

    // ── Tabela detalhada por tarefa ─────────────────────────────────────────
    const headerCols = chain.map((s, i) => `<th style="text-align:center;color:${colors[Math.min(i, colors.length - 1)]};font-family:var(--font-mono);">${escapeHtml(labelOf(s))}<br><span style="font-size:8px;color:var(--ink-mute);font-weight:400;">início → fim</span></th>`).join('');
    const tableRows = limited.map(row => {
      const cells = row.points.map((p, i) => {
        if (!p) return `<td style="text-align:center;color:var(--ink-mute);font-family:var(--font-mono);font-size:10px;">—</td>`;
        return `<td style="text-align:center;font-family:var(--font-mono);font-size:10px;">
          ${fmtDateShort(p.start)}<br>${fmtDateShort(p.end)}
        </td>`;
      }).join('');
      const shift = row.totalEndShift;
      const shiftColor = shift > 0 ? 'var(--accent-danger)' : shift < 0 ? 'var(--accent-success)' : 'var(--ink-mute)';
      const sign = shift > 0 ? '+' : '';
      return `<tr>
        <td style="font-family:var(--font-mono);font-size:10px;color:var(--accent);">${escapeHtml(row.code)}</td>
        <td style="font-size:12px;max-width:280px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${escapeHtml(row.title)}">${escapeHtml(row.title)}</td>
        ${cells}
        <td style="text-align:right;font-family:var(--font-mono);font-size:12px;font-weight:700;color:${shiftColor};">${shift === null ? '—' : sign + shift + 'd'}</td>
      </tr>`;
    }).join('');

    return `
      <div class="page-title-block">
        <div class="page-eyebrow">CRONOGRAMA · COMPARATIVO</div>
        <div class="page-title">Comparar Baselines</div>
        <div class="page-subtitle">Análise de como o plano evoluiu entre snapshots. ${chain.length} marcos · ${perTask.length} tarefas no escopo.</div>
      </div>

      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:10px;margin-bottom:14px;">
        ${stageCards}
      </div>

      ${stages.length > 0 ? waterfall : ''}

      <div class="panel">
        <div class="panel-head">
          <div class="panel-title">Detalhamento por Tarefa</div>
          <div class="panel-title-mono">${limited.length} de ${perTask.length} · ordenado por |variação| de término</div>
        </div>
        <div class="panel-body" style="padding:0;overflow-x:auto;">
          <table class="data-table" style="width:100%;">
            <thead>
              <tr>
                <th>Cód.</th>
                <th>Tarefa</th>
                ${headerCols}
                <th style="text-align:right;">Δ Total</th>
              </tr>
            </thead>
            <tbody>${tableRows}</tbody>
          </table>
        </div>
        ${perTask.length > topN ? `<div style="padding:10px;font-size:11px;color:var(--ink-mute);text-align:center;">Mostrando as ${topN} tarefas com maiores variações. ${perTask.length - topN} restantes não exibidas.</div>` : ''}
      </div>`;
  },
});

// Plugado em UI: continuam acessíveis como UI.<método> e this.<método>.
Object.assign(UI, {
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
});
