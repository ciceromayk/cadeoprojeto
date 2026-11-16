// Tela Desembolso
import { DB } from './db.js';
import { toast } from './feedback.js';
import { $, escapeHtml, fmtBRL, fmtBRLk, fmtDateShort, parentTag, parentTitleOf, today } from './helpers.js';
import { Modal } from './modal.js';
import { State } from './state.js';
import { UI } from './ui.js';
import { Views } from './views.js';

// Plugado em Views: continuam acessíveis como Views.<método> e this.<método>.
Object.assign(Views, {
  // ===== FLUXO DE DESEMBOLSO (financeiro) =====
  // Modelo: custo de cada tarefa-folha desembolsado conforme o dia de término —
  // término até o dia 20 → desembolso no mesmo mês do término;
  // término após o dia 20 → desembolso no mês seguinte (dia 05).
  // Previsto + Realizado (custo × avanço).
  monthLbl(k) { const [y, m] = k.split('-'); return new Date(Number(y), Number(m) - 1, 1).toLocaleDateString('pt-BR', { month: 'short', year: '2-digit' }).replace('.', ''); },

  // Data completa de desembolso: mesma data do término (dia ≤20) ou dia 05 do mês seguinte (dia >20).
  _dueDate(d) {
    let [y, m, day] = d.split('-').map(Number);
    if (day > 20) { m++; if (m > 12) { m = 1; y++; } day = 5; }
    return `${y}-${String(m).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  },

  // Mês de desembolso (agrupamento): derivado da data completa acima.
  _dueMonth(d) { return this._dueDate(d).slice(0, 7); },

  // Agrega o desembolso mensal (reusado por view, CSV e relatório de impressão)
  _desembolsoData() {
    const leaves = State.tasks.filter(t => !t.inactive && !State.tasks.some(x => x.parent_id === t.id));
    const costed = leaves.filter(t => t.end_date && (parseFloat(t.cost) || 0) > 0);
    const totalCost = costed.reduce((a, t) => a + (parseFloat(t.cost) || 0), 0);
    const curD = today(), curK = curD.slice(0, 7);
    const dueMonth = d => this._dueMonth(d);
    if (!costed.length) return { leaves, costed, totalCost: 0, rows: [], curK };
    const keys = costed.map(t => dueMonth(t.end_date));
    const minK = keys.reduce((a, b) => a < b ? a : b), maxK = keys.reduce((a, b) => a > b ? a : b);
    const months = [];
    { let [y, m] = minK.split('-').map(Number); const [ey, em] = maxK.split('-').map(Number);
      while (y < ey || (y === ey && m <= em)) { months.push(`${y}-${String(m).padStart(2, '0')}`); m++; if (m > 12) { m = 1; y++; } } }
    const prevM = Object.fromEntries(months.map(k => [k, 0]));
    const realM = Object.fromEntries(months.map(k => [k, 0]));
    costed.forEach(t => {
      const dueD = this._dueDate(t.end_date), k = dueD.slice(0, 7), c = parseFloat(t.cost) || 0;
      prevM[k] += c;
      // Realizado = custo × avanço, contabilizado só quando a data exata de desembolso já chegou (respeita o dia 05)
      if (dueD <= curD) realM[k] += c * Math.max(0, Math.min(100, parseFloat(t.progress) || 0)) / 100;
    });
    let accP = 0, accR = 0;
    const rows = months.map(k => {
      accP += prevM[k];
      const isPast = k <= curK;
      if (isPast) accR += realM[k];
      return { k, prev: prevM[k], real: realM[k], accP, accR: isPast ? accR : null, isPast, pct: totalCost > 0 ? accP / totalCost * 100 : 0 };
    });
    return { leaves, costed, totalCost, rows, curK };
  },

  // Gera o SVG do gráfico Curva S — reusado pela view e pelo modal Desembolso.
  // Retorna { svg, kpis, monthLbl }.
  // State.desembolsoMode: 'monthly' | 'cumulative' | 'both' (padrão)
  //   'monthly'    → só barras mensais; eixo Y escala ao pico mensal
  //   'cumulative' → só linhas acumuladas; eixo Y escala ao total
  //   'both'       → barras + linhas na MESMA escala (totalCost), corrigindo a distorção
  _desembolsoChart(D) {
    const { totalCost, rows, curK, costed, leaves } = D;
    const monthLbl = k => this.monthLbl(k);
    const mode = State.desembolsoMode || 'both';
    const showBars = mode !== 'cumulative';
    const showLine = mode !== 'monthly';

    if (!rows.length) {
      const empty = `<div class="panel"><div class="panel-body"><div class="empty-state" style="padding:32px 20px;">
        <div class="empty-state-title">Nenhum custo lançado ainda</div>
        <div class="empty-state-sub">Preencha o custo previsto das tarefas abaixo — a Curva S aparece automaticamente quando houver ao menos um valor lançado.</div>
        ${DB.iCanEdit() ? `<button class="btn btn-cta" data-action="desembolso-open" style="margin-top:8px;">💰 Preencher custos</button>` : ''}
      </div></div></div>`;
      return { svg: empty, kpis: '', monthLbl };
    }

    const maxMonth = Math.max(...rows.map(r => r.prev), 1);
    const pastRows = rows.filter(r => r.isPast);
    const prevToday = pastRows.length ? pastRows[pastRows.length - 1].accP : 0;
    const realToday = pastRows.length ? pastRows[pastRows.length - 1].accR : 0;
    const peak = rows.reduce((a, r) => r.prev > a.prev ? r : a, rows[0]);
    const realPctOfPrev = prevToday > 0 ? (realToday / prevToday * 100) : 0;

    // Escala Y única: se mostrando linha acumulada, escala ao totalCost (barras e linha comparáveis);
    // se só mensal, escala ao pico mensal para usar bem a altura do gráfico.
    const axisMax = showLine ? totalCost : maxMonth;

    const VW = 1000, VH = 320, mL = 64, mR = 18, mT = 16, mB = 28;
    const pw = VW - mL - mR, ph = VH - mT - mB, n = rows.length;
    const X = i => mL + (n <= 1 ? pw / 2 : (i / (n - 1)) * pw);
    const Y = v => mT + (1 - (axisMax > 0 ? v / axisMax : 0)) * ph;

    // ── Barras mensais ──
    const barW = Math.min((pw / n) * 0.6, 38);
    const bars = showBars ? rows.map((r, i) => {
      const barTop = Y(r.prev);
      const barH = Math.max(0, (mT + ph) - barTop);
      const x = X(i) - barW / 2;
      const _anc = i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle';
      const lbl = r.prev > 0
        ? `<text x="${X(i).toFixed(1)}" y="${(barTop - 4).toFixed(1)}" text-anchor="${_anc}" font-size="8" font-family="var(--font-mono)" fill="var(--ink-soft)">${fmtBRL(r.prev)}</text>`
        : '';
      // Overlay laranja = realizado do mês (só meses passados)
      const realTop = (r.isPast && r.real > 0) ? Y(r.real) : null;
      const realBar = realTop !== null
        ? `<rect x="${x.toFixed(1)}" y="${realTop.toFixed(1)}" width="${barW.toFixed(1)}" height="${((mT + ph) - realTop).toFixed(1)}" rx="2" fill="rgba(229,75,26,0.22)"/>`
        : '';
      return `<rect x="${x.toFixed(1)}" y="${barTop.toFixed(1)}" width="${barW.toFixed(1)}" height="${barH.toFixed(1)}" rx="2" fill="${r.isPast ? 'rgba(31,58,138,0.16)' : 'rgba(31,58,138,0.08)'}"/>${realBar}${lbl}`;
    }).join('') : '';

    // ── Linhas acumuladas ──
    const prevPts = showLine ? rows.map((r, i) => `${X(i).toFixed(1)},${Y(r.accP).toFixed(1)}`).join(' ') : '';
    const areaPts = showLine ? `${mL},${(mT + ph).toFixed(1)} ${prevPts} ${X(n - 1).toFixed(1)},${(mT + ph).toFixed(1)}` : '';
    const realPts = showLine ? rows.map((r, i) => r.isPast ? `${X(i).toFixed(1)},${Y(r.accR).toFixed(1)}` : null).filter(Boolean).join(' ') : '';

    // ── Rótulos de valor nos pontos da linha acumulada ──
    const _lblStep = Math.max(1, Math.ceil(n / 8));
    const _ta = i => i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle';
    const accLabels = showLine ? rows.map((r, i) => ((i === 0 || i === n - 1 || i % _lblStep === 0) && r.accP > 0)
      ? `<text x="${X(i).toFixed(1)}" y="${(Y(r.accP) - 7).toFixed(1)}" text-anchor="${_ta(i)}" font-size="9" font-family="var(--font-mono)" font-weight="700" fill="var(--blueprint)">${fmtBRL(r.accP)}</text>`
      : '').join('') : '';
    const accRealLabels = showLine ? rows.map((r, i) => (r.isPast && r.accR != null && r.accR > 0 && (i === 0 || i === n - 1 || i % _lblStep === 0))
      ? `<text x="${X(i).toFixed(1)}" y="${(Y(r.accR) + 12).toFixed(1)}" text-anchor="${_ta(i)}" font-size="9" font-family="var(--font-mono)" font-weight="700" fill="var(--accent)">${fmtBRL(r.accR)}</text>`
      : '').join('') : '';

    // ── Eixo Y (grade + rótulos) — escala única para tudo ──
    const yGrid = [0, 25, 50, 75, 100].map(pc => {
      const v = axisMax * pc / 100, y = Y(v);
      return `<line x1="${mL}" y1="${y.toFixed(1)}" x2="${(VW - mR).toFixed(1)}" y2="${y.toFixed(1)}" stroke="var(--border)" stroke-width="1"/>` +
             `<text x="${(mL - 8).toFixed(1)}" y="${(y + 3).toFixed(1)}" text-anchor="end" font-size="9" font-family="var(--font-mono)" fill="var(--ink-mute)">${fmtBRL(v)}</text>`;
    }).join('');

    const xStep = Math.max(1, Math.ceil(n / 14));
    const xLabels = rows.map((r, i) => ((i % xStep === 0) || (i === n - 1 && (n - 1) % xStep >= 2))
      ? `<text x="${X(i).toFixed(1)}" y="${VH - 9}" text-anchor="${_ta(i)}" font-size="9" font-family="var(--font-mono)" fill="var(--ink-mute)">${monthLbl(r.k)}</text>` : '').join('');

    const curIdx = rows.findIndex(r => r.k === curK);
    const todayLine = curIdx >= 0
      ? `<line x1="${X(curIdx).toFixed(1)}" y1="${mT}" x2="${X(curIdx).toFixed(1)}" y2="${(mT + ph).toFixed(1)}" stroke="var(--ink-mute)" stroke-width="1" stroke-dasharray="3 3" opacity="0.6"/>` +
        `<text x="${X(curIdx).toFixed(1)}" y="${mT - 4}" text-anchor="middle" font-size="8" font-family="var(--font-mono)" fill="var(--ink-mute)">HOJE</text>`
      : '';

    // ── Toggle de modo ──
    const _cb = m => `State.desembolsoMode='${m}';if(window._dxRefreshChart){window._dxRefreshChart();}else{UI.render();}`;
    const _bs = active =>
      `padding:3px 10px;font-size:10px;font-family:var(--font-mono);border:none;cursor:pointer;transition:background .15s,color .15s;` +
      (active ? 'background:var(--accent);color:#fff;' : 'background:var(--bg-deep);color:var(--ink-mute);');
    const modeToggle = `<div style="display:flex;border:1px solid var(--border);border-radius:4px;overflow:hidden;">
      <button style="${_bs(mode==='monthly')}"    onclick="${_cb('monthly')}">Mensal</button>
      <button style="${_bs(mode==='cumulative')}" onclick="${_cb('cumulative')}">Acumulado</button>
      <button style="${_bs(mode==='both')}"       onclick="${_cb('both')}">Ambos</button>
    </div>`;

    // ── Legenda ──
    const leg = (color, label) =>
      `<span style="display:inline-flex;align-items:center;gap:5px;font-size:11px;color:var(--ink-soft);">` +
      `<span style="width:16px;height:0;border-top:3px solid ${color};display:inline-block;"></span>${label}</span>`;
    const legends = [
      showBars ? leg('rgba(31,58,138,0.5)', 'Previsto (mês)') : '',
      showBars && pastRows.length ? leg('rgba(229,75,26,0.5)', 'Realizado (mês)') : '',
      showLine ? leg('var(--blueprint)', 'Previsto (acum.)') : '',
      showLine && realPts ? leg('var(--accent)', 'Realizado (acum.)') : '',
    ].filter(Boolean).join('');

    const titleMap = { monthly: 'Desembolso — Mensal', cumulative: 'Curva S — Acumulado', both: 'Curva S — Desembolso' };

    const svg = `<div class="panel" style="margin-bottom:14px;">
        <div class="panel-head">
          <div class="panel-title">${titleMap[mode] || 'Curva S — Desembolso'}</div>
          <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;">
            ${legends}
            ${modeToggle}
          </div>
        </div>
        <div class="panel-body">
          <svg viewBox="0 0 ${VW} ${VH}" width="100%" preserveAspectRatio="xMidYMid meet" style="display:block;">
            ${yGrid}${bars}
            ${areaPts ? `<polygon points="${areaPts}" fill="rgba(31,58,138,0.05)"/>` : ''}
            ${prevPts ? `<polyline points="${prevPts}" fill="none" stroke="var(--blueprint)" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>` : ''}
            ${realPts ? `<polyline points="${realPts}" fill="none" stroke="var(--accent)" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>` : ''}
            ${accLabels}${accRealLabels}
            ${todayLine}${xLabels}
          </svg>
        </div>
      </div>`;

    const kpi = (lbl, val, color, sub) => `<div class="panel" style="padding:14px 16px;"><div style="font-family:var(--font-mono);font-size:9px;text-transform:uppercase;letter-spacing:.08em;color:var(--ink-mute);">${lbl}</div><div style="font-size:20px;font-weight:800;color:${color || 'var(--ink)'};line-height:1.15;">${val}</div>${sub ? `<div style="font-size:10px;color:var(--ink-mute);margin-top:2px;">${sub}</div>` : ''}</div>`;
    const kpis = `<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px;margin-bottom:14px;">
        ${kpi('Custo total', fmtBRL(totalCost))}
        ${kpi('Previsto até hoje', fmtBRL(prevToday), 'var(--blueprint)')}
        ${kpi('Realizado até hoje', fmtBRL(realToday), 'var(--accent)', realPctOfPrev.toFixed(0) + '% do previsto')}
        ${kpi('Pico mensal', fmtBRL(peak.prev), 'var(--ink)', monthLbl(peak.k))}
        ${kpi('Tarefas com custo', costed.length + ' / ' + leaves.length)}
      </div>`;
    return { svg, kpis, monthLbl };
  },

  desembolso() {
    const p = this.current();
    if (!p) return `<div class="empty-state" style="padding:60px 20px;"><div class="empty-state-title">Sem projeto</div><div class="empty-state-sub">Selecione um projeto para ver o fluxo de desembolso.</div></div>`;
    const D = this._desembolsoData();
    const { totalCost, rows, curK, costed, leaves } = D;

    const header = `
      <div style="display:flex;align-items:baseline;justify-content:space-between;margin-bottom:16px;flex-wrap:wrap;gap:8px;">
        <div>
          <div class="page-eyebrow">FINANCEIRO · DESEMBOLSO</div>
          <div class="page-title" style="margin-bottom:4px;">Fluxo de Desembolso</div>
          <div style="font-family:var(--font-mono);font-size:11px;color:var(--ink-mute);">Medição: término até dia 20 desembolsa no mesmo mês; após o dia 20, no dia 05 do mês seguinte · ${escapeHtml(p.name)}</div>
        </div>
        <div style="display:flex;gap:6px;flex-wrap:wrap;">
          ${DB.iCanEdit() ? `<button class="btn btn-cta" data-action="desembolso-open" style="font-size:11px;"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:14px;height:14px;"><line x1="12" y1="2" x2="12" y2="22"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg> Preencher custos</button>` : ''}
          ${costed.length ? `<button class="btn btn-secondary" data-action="desembolso-print" style="font-size:11px;"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:14px;height:14px;"><polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/></svg> Relatório</button>
          <button class="btn btn-secondary" data-action="desembolso-csv" style="font-size:11px;"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:14px;height:14px;"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg> CSV</button>` : ''}
        </div>
      </div>`;

    if (costed.length === 0) {
      return header + `<div class="panel"><div class="panel-body"><div class="empty-state" style="padding:40px 20px;">
        <div class="empty-state-title">Nenhum custo lançado</div>
        <div class="empty-state-sub">Abra uma tarefa e preencha o campo <strong>Custo previsto (R$)</strong>. Término até o dia 20 desembolsa <strong>no mesmo mês</strong>; após o dia 20, o desembolso cai no <strong>dia 05 do mês seguinte</strong>.</div>
      </div></div></div>`;
    }

    // Usa _desembolsoChart para evitar duplicação — inclui toggle de escala
    const { svg: chart, kpis, monthLbl } = this._desembolsoChart(D);

    // Variáveis locais ainda necessárias para a tabela abaixo
    const maxMonth = Math.max(...rows.map(r => r.prev), 1);
    const pastRows = rows.filter(r => r.isPast);
    const realToday = pastRows.length ? pastRows[pastRows.length - 1].accR : 0;

    // Pré-computa as tarefas de cada mês (término até dia 20 = mesmo mês; após, mês seguinte)
    const dueMonthOf = d => this._dueMonth(d);
    const tasksByMonth = {};
    costed.forEach(t => { const k = dueMonthOf(t.end_date); if (!tasksByMonth[k]) tasksByMonth[k] = []; tasksByMonth[k].push(t); });

    const tableRows = rows.map(r => {
      const monthTasks = (tasksByMonth[r.k] || []).sort((a, b) => (a.end_date || '').localeCompare(b.end_date || ''));
      const isHighlight = r.k === curK;
      const taskSubrows = monthTasks.map(t => {
        const c = parseFloat(t.cost) || 0;
        const real = r.isPast ? c * Math.min(100, Math.max(0, parseFloat(t.progress) || 0)) / 100 : null;
        const disc = State.disciplines.find(d => d.id === t.discipline_id);
        return `<tr class="desembolso-task-row" data-month="${r.k}" style="display:none;background:var(--bg-elevated);">
          <td style="padding:5px 10px 5px 28px;color:var(--ink-soft);" colspan="2">${escapeHtml(t.title)}${disc ? `<span style="font-family:var(--font-mono);font-size:9px;color:var(--ink-mute);margin-left:6px;">${disc.code}</span>` : ''}${parentTag(t, null, 'inline')}</td>
          <td style="padding:5px 10px;text-align:right;font-family:var(--font-mono);font-size:11px;">${fmtBRL(c)}</td>
          <td style="padding:5px 10px;text-align:right;font-family:var(--font-mono);font-size:11px;color:var(--accent);">${real !== null ? fmtBRL(real) : '·'}</td>
          <td colspan="2" style="padding:5px 10px;">
            <div style="display:flex;align-items:center;gap:6px;">
              <div style="flex:1;height:4px;background:var(--bg-deep);border-radius:2px;overflow:hidden;min-width:60px;"><div style="height:100%;width:${Math.min(100,parseFloat(t.progress)||0).toFixed(0)}%;background:var(--accent);border-radius:2px;"></div></div>
              <span style="font-family:var(--font-mono);font-size:9px;color:var(--ink-mute);">${(parseFloat(t.progress)||0).toFixed(0)}%</span>
            </div>
          </td>
        </tr>`;
      }).join('');
      const chevron = monthTasks.length > 0
        ? `<span class="desembolso-chevron" data-month="${r.k}" style="cursor:pointer;font-size:10px;color:var(--ink-mute);margin-right:6px;display:inline-block;transition:transform .15s;user-select:none;">▶</span>`
        : `<span style="display:inline-block;width:16px;margin-right:6px;"></span>`;
      return `<tr${isHighlight ? ' style="background:rgba(229,75,26,0.05);"' : ''} class="desembolso-month-row" data-month="${r.k}">
        <td style="font-family:var(--font-mono);">${chevron}${monthLbl(r.k)}${monthTasks.length > 0 ? `<span style="font-family:var(--font-mono);font-size:9px;color:var(--ink-mute);margin-left:6px;">${monthTasks.length} tarefa${monthTasks.length !== 1 ? 's' : ''}</span>` : ''}</td>
        <td style="text-align:right;font-family:var(--font-mono);">${r.prev > 0 ? fmtBRL(r.prev) : '—'}</td>
        <td style="text-align:right;font-family:var(--font-mono);color:var(--accent);">${r.isPast ? (r.real > 0 ? fmtBRL(r.real) : '—') : '·'}</td>
        <td><div style="height:6px;background:var(--bg-deep);border-radius:3px;overflow:hidden;min-width:80px;"><div style="height:100%;width:${(r.prev / maxMonth * 100).toFixed(1)}%;background:var(--blueprint);border-radius:3px;"></div></div></td>
        <td style="text-align:right;font-family:var(--font-mono);font-weight:600;">${fmtBRL(r.accP)}</td>
        <td style="text-align:right;font-family:var(--font-mono);color:var(--ink-mute);">${r.pct.toFixed(0)}%</td>
      </tr>${taskSubrows}`;
    }).join('');

    const table = `<div class="panel">
        <div class="panel-head"><div class="panel-title">Desembolso mensal</div><div class="panel-title-mono">${rows.length} meses</div></div>
        <div class="panel-body" style="padding:0;">
          <table class="data-table" style="width:100%;" id="desembolsoTable">
            <thead><tr>
              <th style="text-align:left;">Mês</th><th style="text-align:right;">Previsto (mês)</th><th style="text-align:right;">Realizado (mês)</th><th>Distribuição</th><th style="text-align:right;">Acum. previsto</th><th style="text-align:right;">%</th>
            </tr></thead>
            <tbody>${tableRows}</tbody>
            <tfoot><tr style="font-weight:700;">
              <td style="font-family:var(--font-mono);padding:8px 10px;border-top:2px solid var(--border-strong);">TOTAL</td>
              <td style="text-align:right;font-family:var(--font-mono);padding:8px 10px;border-top:2px solid var(--border-strong);">${fmtBRL(totalCost)}</td>
              <td style="text-align:right;font-family:var(--font-mono);color:var(--accent);padding:8px 10px;border-top:2px solid var(--border-strong);">${fmtBRL(realToday)}</td>
              <td style="border-top:2px solid var(--border-strong);"></td><td style="border-top:2px solid var(--border-strong);"></td>
              <td style="text-align:right;padding:8px 10px;border-top:2px solid var(--border-strong);">100%</td>
            </tr></tfoot>
          </table>
        </div>
      </div>`;

    return header + kpis + chart + table;
  },

  // ===== MODAL DESEMBOLSO — gráfico + tabela editável de custos =====
  // Reune numa só janela o gráfico Curva S e a tabela de preenchimento dos custos por tarefa.
  // Cada linha mostra Cód · Título (+ tarefa pai como subtítulo) · Setor · Disciplina · Término · Custo (R$).
  // O custo é editável e salva em on-blur; o gráfico/KPIs são recalculados ao fechar/reabrir.
  openDesembolsoModal() {
    const proj = Views.current();
    if (!proj) { toast('Selecione um projeto', 'error'); return; }
    if (!DB.iCanEdit()) { toast('Sem permissão para editar custos neste projeto', 'error'); return; }

    const fmtBRLLocal = v => v != null && v !== '' ? Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }) : '';
    const inputCostStyle = 'width:100%;background:var(--bg-deep);border:1px solid var(--border);color:var(--ink);border-radius:2px;padding:5px 8px;font-size:12px;font-family:var(--font-mono);text-align:right;';
    const _taskById = new Map(State.tasks.map(t => [t.id, t]));
    const _discById = new Map(State.disciplines.map(d => [d.id, d]));

    // Sempre folhas (não pai), ordenadas por código
    const leaves = State.tasks
      .filter(t => !t.inactive && !State.tasks.some(x => x.parent_id === t.id))
      .sort((a, b) => String(a.code || '').localeCompare(String(b.code || ''), 'pt-BR', { numeric: true }));

    const renderChart = () => {
      const D = Views._desembolsoData();
      const { svg, kpis } = Views._desembolsoChart(D);
      return kpis + svg;
    };

    const renderRow = (t, groupKey = '') => {
      const parent = t.parent_id ? _taskById.get(t.parent_id) : null;
      const costRaw = (t.cost != null && t.cost !== '') ? t.cost : '';
      return `<tr data-task-id="${t.id}" data-group="${groupKey}">
        <td style="font-family:var(--font-mono);font-size:11px;color:var(--accent);white-space:nowrap;vertical-align:top;padding:8px 10px;">${escapeHtml(t.code || '')}</td>
        <td style="font-size:12px;vertical-align:top;padding:8px 10px;">
          <div style="font-weight:500;line-height:1.3;">${escapeHtml(t.title)}</div>
          ${parent ? `<div class="parent-tag" title="Atividade pai: ${escapeHtml(parent.title)}"><span class="pt-arrow">↳</span><span class="pt-name">${escapeHtml(parent.title)}</span></div>` : ''}
        </td>
        <td style="font-size:11px;color:var(--ink-soft);vertical-align:top;padding:8px 10px;white-space:nowrap;">${t.sector ? escapeHtml(t.sector) : '<span style="color:var(--ink-mute);">—</span>'}</td>
        <td style="font-family:var(--font-mono);font-size:11px;color:var(--ink-soft);vertical-align:top;padding:8px 10px;white-space:nowrap;">${t.end_date ? fmtDateShort(t.end_date) : '<span style="color:var(--ink-mute);">—</span>'}</td>
        <td style="vertical-align:top;padding:6px 10px;width:170px;">
          <input class="dx-cost-field" data-id="${t.id}" data-raw="${costRaw}" type="text" placeholder="R$ 0,00" value="${fmtBRLLocal(costRaw)}" style="${inputCostStyle}">
        </td>
      </tr>`;
    };

    // Agrupa por disciplina
    const dxGroups = new Map();
    for (const t of leaves) {
      const disc = _discById.get(t.discipline_id);
      const key = disc ? disc.id : '__none__';
      if (!dxGroups.has(key)) dxGroups.set(key, { disc: disc || null, tasks: [] });
      dxGroups.get(key).tasks.push(t);
    }
    const dxSortedGroups = [...dxGroups.values()].sort((a, b) => {
      if (!a.disc && !b.disc) return 0;
      if (!a.disc) return 1;
      if (!b.disc) return -1;
      return (a.disc.code || '').localeCompare(b.disc.code || '', 'pt-BR');
    });
    const renderGroupedRows = () => dxSortedGroups.map(g => {
      const key = g.disc ? g.disc.id : '__none__';
      const hdr = `<tr class="dx-group-hdr" data-group="${key}" style="background:var(--bg-mid);border-top:2px solid var(--border);"><td colspan="5" style="padding:7px 10px;font-family:var(--font-mono);font-size:11px;font-weight:600;letter-spacing:.05em;">${g.disc ? `<span style="color:var(--accent);">${escapeHtml(g.disc.code)}</span> · <span style="color:var(--ink);">${escapeHtml(g.disc.name)}</span>` : '<span style="color:var(--ink-mute);">Sem disciplina</span>'} <span style="color:var(--ink-mute);font-weight:400;">(${g.tasks.length})</span></td></tr>`;
      return hdr + g.tasks.map(t => renderRow(t, key)).join('');
    }).join('');

    const totalCount = leaves.length;

    Modal.open({
      title: '💰 Desembolso · ' + escapeHtml(proj.name),
      cls: 'modal-xwide',
      body: `
        <div id="dxChart">${renderChart()}</div>
        <div style="display:flex;align-items:center;gap:10px;margin:14px 0 8px;flex-wrap:wrap;">
          <div style="font-family:var(--font-mono);font-size:10px;text-transform:uppercase;letter-spacing:.08em;color:var(--ink-mute);">Preencher custos por tarefa</div>
          <span id="dxCountInfo" style="font-family:var(--font-mono);font-size:11px;color:var(--ink-mute);">${totalCount} tarefa${totalCount !== 1 ? 's' : ''}</span>
          <input id="dxSearch" type="text" class="form-input" placeholder="Filtrar por código, título ou tarefa pai…" style="flex:1;min-width:240px;font-size:12px;padding:5px 10px;">
        </div>
        <div style="border:1px solid var(--border);border-radius:3px;overflow:hidden;">
          <table class="data-table" style="width:100%;">
            <thead><tr>
              <th style="width:80px;text-align:left;padding:8px 10px;">Código</th>
              <th style="text-align:left;padding:8px 10px;">Tarefa</th>
              <th style="width:100px;text-align:left;padding:8px 10px;">Setor</th>
              <th style="width:100px;text-align:left;padding:8px 10px;">Término</th>
              <th style="width:170px;text-align:left;padding:8px 10px;">Custo previsto</th>
            </tr></thead>
            <tbody id="dxRows">${renderGroupedRows()}</tbody>
          </table>
        </div>`,
      footer: `<button class="btn btn-secondary" id="dxClose">Fechar</button>`
    });
    $('#dxClose').onclick = () => { window._dxRefreshChart = null; Modal.forceClose(); };

    // Filtro de busca (código / título / tarefa pai)
    const _searchEl = $('#dxSearch');
    _searchEl.oninput = () => {
      const q = _searchEl.value.trim().toLowerCase();
      const visGroups = new Set();
      let shown = 0;
      $('#dxRows').querySelectorAll('tr[data-task-id]').forEach(tr => {
        const id = tr.dataset.taskId;
        const t = _taskById.get(id); if (!t) return;
        const parent = t.parent_id ? _taskById.get(t.parent_id) : null;
        const hay = (t.code || '') + ' ' + (t.title || '') + ' ' + (parent?.title || '');
        const show = !q || hay.toLowerCase().includes(q);
        tr.style.display = show ? '' : 'none';
        if (show) { shown++; visGroups.add(tr.dataset.group); }
      });
      $('#dxRows').querySelectorAll('tr.dx-group-hdr').forEach(tr => {
        tr.style.display = (!q || visGroups.has(tr.dataset.group)) ? '' : 'none';
      });
      const info = $('#dxCountInfo');
      if (info) info.textContent = q ? `${shown} de ${totalCount}` : `${totalCount} tarefa${totalCount !== 1 ? 's' : ''}`;
    };

    // Edição inline de custo: ao focar mostra o número, ao sair formata + salva + atualiza gráfico
    const _refreshChart = () => {
      const _chartEl = $('#dxChart');
      if (_chartEl) _chartEl.innerHTML = renderChart();
    };
    // Expõe para os botões de toggle de escala (dentro do SVG gerado) chamarem sem re-render total
    window._dxRefreshChart = _refreshChart;
    $('#dxRows').addEventListener('focusin', (e) => {
      const el = e.target.closest('.dx-cost-field'); if (!el) return;
      el.value = el.dataset.raw || '';
      el.select && el.select();
    });
    $('#dxRows').addEventListener('focusout', async (e) => {
      const el = e.target.closest('.dx-cost-field'); if (!el) return;
      const taskId = el.dataset.id;
      const raw = (el.value || '').replace(/\s/g, '').replace(/\./g, '').replace(',', '.').replace(/[^\d.-]/g, '');
      const val = raw === '' ? null : (isNaN(parseFloat(raw)) ? null : Math.max(0, parseFloat(raw)));
      const task = State.tasks.find(t => t.id === taskId); if (!task) return;
      const prev = task.cost;
      if ((prev || null) === (val || null)) { el.value = fmtBRLLocal(val); return; } // sem mudança
      task.cost = val;
      el.dataset.raw = val != null ? val : '';
      el.value = fmtBRLLocal(val);
      try {
        await DB.updateTask(taskId, { cost: val });
        el.style.outline = '2px solid var(--accent-success)';
        setTimeout(() => { el.style.outline = ''; }, 700);
        _refreshChart();
      } catch (err) {
        task.cost = prev;
        el.dataset.raw = prev != null ? prev : '';
        el.value = fmtBRLLocal(prev);
        el.style.outline = '2px solid var(--accent-danger)';
        toast('Erro ao salvar: ' + (err.message || err), 'error');
      }
    });
  },

  exportDesembolsoCSV() {
    const { rows, totalCost } = this._desembolsoData();
    if (!rows.length) { toast('Nenhum custo lançado', 'warning'); return; }
    const fmt = v => (Number(v) || 0).toFixed(2).replace('.', ',');
    const lines = [['Mes', 'Previsto_mes', 'Realizado_mes', 'Acum_previsto', 'Acum_realizado', 'Percentual'].join(';')];
    rows.forEach(r => {
      lines.push([
        r.k, fmt(r.prev), r.isPast ? fmt(r.real) : '',
        fmt(r.accP), r.isPast ? fmt(r.accR) : '',
        (totalCost > 0 ? r.accP / totalCost * 100 : 0).toFixed(1).replace('.', ',') + '%'
      ].join(';'));
    });
    const blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `desembolso_${(this.current()?.name || 'projeto').replace(/[^\w\-]+/g, '_')}.csv`;
    a.click(); URL.revokeObjectURL(url);
    toast('CSV exportado', 'success');
  },
});

// Plugado em UI: continuam acessíveis como UI.<método> e this.<método>.
Object.assign(UI, {
  printDesembolso() {
    const p = Views.current();
    if (!p) { toast('Selecione um projeto', 'warning'); return; }
    const D = Views._desembolsoData();
    if (!D.rows.length) { toast('Nenhum custo lançado nas tarefas', 'warning'); return; }
    const { rows, totalCost, curK, costed } = D;
    const monthLbl = k => Views.monthLbl(k);
    const dueMonth = d => Views._dueMonth(d);
    const tasksByMonth = {};
    costed.forEach(t => { const k = dueMonth(t.end_date); if (!tasksByMonth[k]) tasksByMonth[k] = []; tasksByMonth[k].push(t); });
    const pastRows = rows.filter(r => r.isPast);
    const prevToday = pastRows.length ? pastRows[pastRows.length - 1].accP : 0;
    const realToday = pastRows.length ? pastRows[pastRows.length - 1].accR : 0;
    const peak = rows.reduce((a, r) => r.prev > a.prev ? r : a, rows[0]);

    // Curva S (cores fixas p/ impressão)
    const VW = 920, VH = 300, mL = 70, mR = 16, mT = 14, mB = 26;
    const pw = VW - mL - mR, ph = VH - mT - mB, n = rows.length;
    const X = i => mL + (n <= 1 ? pw / 2 : (i / (n - 1)) * pw);
    const Yc = v => mT + (1 - (totalCost > 0 ? v / totalCost : 0)) * ph;
    const maxMonth = Math.max(...rows.map(r => r.prev), 1);
    const barW = Math.min((pw / n) * 0.6, 34);
    const bars = rows.map((r, i) => { const h = (r.prev / maxMonth) * ph, x = X(i) - barW / 2; return `<rect x="${x.toFixed(1)}" y="${(mT + ph - h).toFixed(1)}" width="${barW.toFixed(1)}" height="${h.toFixed(1)}" rx="2" fill="rgba(31,58,138,0.14)"/>`; }).join('');
    const prevPts = rows.map((r, i) => `${X(i).toFixed(1)},${Yc(r.accP).toFixed(1)}`).join(' ');
    const areaPts = `${mL},${(mT + ph).toFixed(1)} ${prevPts} ${X(n - 1).toFixed(1)},${(mT + ph).toFixed(1)}`;
    const realPts = rows.map((r, i) => r.isPast ? `${X(i).toFixed(1)},${Yc(r.accR).toFixed(1)}` : null).filter(Boolean).join(' ');
    const yGrid = [0, 25, 50, 75, 100].map(pc => { const v = totalCost * pc / 100, y = Yc(v); return `<line x1="${mL}" y1="${y.toFixed(1)}" x2="${VW - mR}" y2="${y.toFixed(1)}" stroke="#e6e6e6" stroke-width="1"/><text x="${mL - 7}" y="${(y + 3).toFixed(1)}" text-anchor="end" font-size="8" font-family="monospace" fill="#888">${fmtBRLk(v)}</text>`; }).join('');
    const xStep = Math.max(1, Math.ceil(n / 14));
    const xLabels = rows.map((r, i) => ((i % xStep === 0) || (i === n - 1 && (n - 1) % xStep >= 2)) ? `<text x="${X(i).toFixed(1)}" y="${VH - 8}" text-anchor="middle" font-size="8" font-family="monospace" fill="#888">${monthLbl(r.k)}</text>` : '').join('');
    const curIdx = rows.findIndex(r => r.k === curK);
    const todayLine = curIdx >= 0 ? `<line x1="${X(curIdx).toFixed(1)}" y1="${mT}" x2="${X(curIdx).toFixed(1)}" y2="${mT + ph}" stroke="#94928b" stroke-width="1" stroke-dasharray="3 3"/><text x="${X(curIdx).toFixed(1)}" y="${mT - 3}" text-anchor="middle" font-size="7" font-family="monospace" fill="#94928b">HOJE</text>` : '';

    const trs = rows.map(r => {
      const monthTasks = (tasksByMonth[r.k] || []).sort((a, b) => (a.end_date || '').localeCompare(b.end_date || ''));
      const taskSubrows = monthTasks.map(t => {
        const c = parseFloat(t.cost) || 0;
        const real = r.isPast ? c * Math.min(100, Math.max(0, parseFloat(t.progress) || 0)) / 100 : null;
        const parentTitle = parentTitleOf(t);
        return `<tr style="background:#f7f6f2;">
          <td style="padding:3px 10px 3px 22px;font-size:10px;color:#555;">${escapeHtml(t.title)}${parentTitle ? `<span style="font-size:9px;color:#888;margin-left:6px;">↳ ${escapeHtml(parentTitle)}</span>` : ''}</td>
          <td style="text-align:right;font-family:monospace;font-size:10px;">${fmtBRL(c)}</td>
          <td style="text-align:right;font-family:monospace;font-size:10px;color:#c13b12;">${real !== null && real > 0 ? fmtBRL(real) : ''}</td>
          <td colspan="2"></td>
        </tr>`;
      }).join('');
      return `<tr${r.k === curK ? ' style="background:#fff6f0;"' : ''}>
        <td style="font-family:monospace;">${monthLbl(r.k)}</td>
        <td style="text-align:right;font-family:monospace;">${r.prev > 0 ? fmtBRL(r.prev) : '—'}</td>
        <td style="text-align:right;font-family:monospace;color:#c13b12;">${r.isPast ? (r.real > 0 ? fmtBRL(r.real) : '—') : ''}</td>
        <td style="text-align:right;font-family:monospace;font-weight:600;">${fmtBRL(r.accP)}</td>
        <td style="text-align:right;font-family:monospace;color:#888;">${r.pct.toFixed(0)}%</td>
      </tr>${taskSubrows}`;
    }).join('');
    const kpiBox = (l, v) => `<div style="text-align:center;"><strong>${v}</strong><br><span style="color:#888;font-size:9px;">${l}</span></div>`;

    const body = `
      <div style="display:flex;gap:24px;align-items:flex-start;margin-bottom:10px;">
        <div style="flex:1;"><h2 style="margin:0 0 4px 0;">${escapeHtml(p.name)}</h2>
          <div style="font-size:10px;color:#666;">Fluxo de Desembolso · medição (até dia 20: mesmo mês; após dia 20: dia 05 do mês seguinte) · Emitido em ${new Date().toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' })}</div></div>
        <div style="display:flex;gap:16px;font-family:monospace;font-size:11px;">
          ${kpiBox('custo total', fmtBRL(totalCost))}${kpiBox('previsto até hoje', fmtBRL(prevToday))}${kpiBox('realizado até hoje', fmtBRL(realToday))}
        </div>
      </div>
      <div style="display:flex;gap:14px;align-items:center;margin:4px 0 8px;font-size:10px;color:#444;font-family:monospace;">
        <span style="display:inline-flex;align-items:center;gap:5px;"><span style="width:16px;border-top:3px solid #1f3a8a;display:inline-block;"></span>Previsto</span>
        <span style="display:inline-flex;align-items:center;gap:5px;"><span style="width:16px;border-top:3px solid #e54b1a;display:inline-block;"></span>Realizado</span>
        <span style="margin-left:auto;color:#888;">Pico mensal: ${fmtBRL(peak.prev)} (${monthLbl(peak.k)})</span>
      </div>
      <svg viewBox="0 0 ${VW} ${VH}" width="100%" style="display:block;border:1px solid #e0e0e0;border-radius:3px;background:#fff;">
        ${yGrid}${bars}
        <polygon points="${areaPts}" fill="rgba(31,58,138,0.05)"/>
        <polyline points="${prevPts}" fill="none" stroke="#1f3a8a" stroke-width="2"/>
        ${realPts ? `<polyline points="${realPts}" fill="none" stroke="#e54b1a" stroke-width="2"/>` : ''}
        ${todayLine}${xLabels}
      </svg>
      <h2 style="margin:16px 0 4px;">Desembolso mensal</h2>
      <table>
        <thead><tr><th>Mês</th><th style="text-align:right;">Previsto (mês)</th><th style="text-align:right;">Realizado (mês)</th><th style="text-align:right;">Acum. previsto</th><th style="text-align:right;">%</th></tr></thead>
        <tbody>${trs}</tbody>
        <tfoot><tr style="font-weight:700;border-top:2px solid #ccc;">
          <td style="font-family:monospace;">TOTAL</td>
          <td style="text-align:right;font-family:monospace;">${fmtBRL(totalCost)}</td>
          <td style="text-align:right;font-family:monospace;color:#c13b12;">${fmtBRL(realToday)}</td>
          <td></td><td style="text-align:right;">100%</td>
        </tr></tfoot>
      </table>`;
    this._printWindow('Relatório de Desembolso', body);
  },
});
