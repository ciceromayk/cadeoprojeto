// Comparativo de linhas de base
import { daysBetween } from './helpers.js';
import { State } from './state.js';

// ============================================================================
// BASELINE COMPARE — comparativo entre snapshots de linha de base
// ============================================================================
// Lê o histórico persistido no banco + LB1 das tarefas e produz:
//   • cadeia ordenada [LB1, LB2, LB3, LB4, "atual"]
//   • para cada tarefa: variações de início/fim entre snapshots adjacentes
//   • totais agregados: dias deslizados (positivo = atrasou), tarefas entrando/saindo
export const BaselineCompare = {
  // Carrega todos os snapshots disponíveis + estado atual como último "snapshot"
  collectSnapshots() {
    const history = State.baselineHistory || [];
    const all = [...history];
    // LB1 do DB se existir e não estiver no histórico
    if (State.tasks.some(t => t.baseline_start) && !all.find(b => b.slot === 1)) {
      const snap = { slot: 1, set_at: State.tasks.find(t => t.baseline_set_at)?.baseline_set_at || '', tasks: {} };
      State.tasks.forEach(t => { if (t.baseline_start) snap.tasks[t.id] = { start: t.baseline_start, end: t.baseline_end, code: t.code || '', title: t.title }; });
      all.unshift(snap);
    }
    all.sort((a, b) => a.slot - b.slot);
    // Snapshot do estado atual ("CUR")
    const cur = { slot: 'CUR', label: 'Atual', set_at: new Date().toISOString(), tasks: {} };
    State.tasks.forEach(t => {
      cur.tasks[t.id] = { start: t.start_date, end: t.end_date, code: t.code || '', title: t.title };
    });
    return { snapshots: all, current: cur };
  },

  // Calcula deltas entre cada par adjacente da cadeia [LB1..LBn, CUR]
  buildDiff() {
    const { snapshots, current } = this.collectSnapshots();
    const chain = [...snapshots, current];
    if (chain.length < 2) return { chain, perTask: [], stages: [] };

    // Agrupa todas as tarefas que aparecem em algum snapshot
    const allTaskIds = new Set();
    chain.forEach(s => { Object.keys(s.tasks).forEach(id => allTaskIds.add(id)); });

    const perTask = [...allTaskIds].map(id => {
      const points = chain.map(s => s.tasks[id] || null);
      // Calcula deltas em dias entre cada par adjacente (fim, comparado com fim anterior)
      const deltas = [];
      for (let i = 1; i < points.length; i++) {
        const a = points[i - 1], b = points[i];
        if (!a || !b) { deltas.push(null); continue; }
        const dStart = daysBetween(a.start, b.start); // positivo = começou depois
        const dEnd   = daysBetween(a.end,   b.end);   // positivo = terminou depois (atrasou)
        deltas.push({ dStart, dEnd, from: a, to: b });
      }
      // Total acumulado (do primeiro snapshot até o estado atual)
      const first = points.find(p => p !== null);
      const last  = points.slice().reverse().find(p => p !== null);
      const totalEndShift = first && last ? daysBetween(first.end, last.end) : null;
      const totalStartShift = first && last ? daysBetween(first.start, last.start) : null;
      // Pega título do snapshot mais recente onde a tarefa existe
      const title = last?.title || State.tasks.find(t => t.id === id)?.title || '';
      const code  = last?.code  || State.tasks.find(t => t.id === id)?.code  || '';
      return { id, title, code, points, deltas, totalEndShift, totalStartShift };
    });

    // Estatísticas agregadas por estágio (par de snapshots)
    const stages = [];
    for (let i = 1; i < chain.length; i++) {
      const from = chain[i - 1], to = chain[i];
      let added = 0, removed = 0, kept = 0, totalShift = 0, atrasadas = 0, adiantadas = 0;
      const taskIdsFrom = new Set(Object.keys(from.tasks));
      const taskIdsTo   = new Set(Object.keys(to.tasks));
      taskIdsTo.forEach(id => { if (!taskIdsFrom.has(id)) added++; });
      taskIdsFrom.forEach(id => { if (!taskIdsTo.has(id)) removed++; });
      taskIdsFrom.forEach(id => {
        if (!taskIdsTo.has(id)) return;
        kept++;
        const a = from.tasks[id], b = to.tasks[id];
        const dEnd = daysBetween(a.end, b.end);
        totalShift += dEnd;
        if (dEnd > 0) atrasadas++;
        else if (dEnd < 0) adiantadas++;
      });
      stages.push({
        fromLbl: from.slot === 'CUR' ? 'Atual' : `LB${from.slot}`,
        toLbl:   to.slot === 'CUR' ? 'Atual' : `LB${to.slot}`,
        added, removed, kept, totalShift, atrasadas, adiantadas,
        avgShift: kept > 0 ? +(totalShift / kept).toFixed(1) : 0,
      });
    }

    return { chain, perTask, stages };
  },
};
// Escopo global: atributos onclick inline só enxergam window.*
window.BaselineCompare = BaselineCompare;
