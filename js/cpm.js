// CPM (caminho crítico), detecção de ciclos e auto-agendamento
import { addWorkingDays, fmtDateFull, nextWorkday, workingDaysBetween } from './helpers.js';
import { Perf } from './perf.js';
import { HealthCheck } from './health.js';

// ============================================================================
// CPM (Critical Path Method) — com restrições e detecção de violações
// ============================================================================
// Algoritmo clássico de caminho crítico com extensão para restrições MS Project:
//   ASAP, ALAP, MSO, MFO, SNET, FNLT
//
// Trabalha em "dias absolutos" (timestamps convertidos em offsets de dias),
// aplica forward pass + clamping de restrições, backward pass + clamping,
// calcula folga (slack), marca como crítica toda tarefa com slack <= 0,
// e detecta restrições violadas (impossíveis dado as predecessoras).
//
// Suporta os 4 tipos de dependência (FS/SS/FF/SF) com lag em dias.
//
// Retorna: {
//   criticalIds: Set<taskId>,
//   slack: Map<taskId, days>,
//   violations: Map<taskId, { type, expected, computed, message }>,
//   projectEnd: Date
// }
// ── Wrapper memoizado de CPM ───────────────────────────────────────────────
// Hash leve baseado no número de itens e timestamp do último update. Suficiente
// porque qualquer create/update/delete passa por DB.updateTask/createTask/...
// que invalida o cache explicitamente (CPMCache.invalidate()).
export const CPMCache = {
  _hash: null,
  _result: null,
  invalidate() { this._hash = null; this._result = null; try { HealthCheck.invalidate(); } catch (e) {} },
  get(tasks, deps) {
    // hash leve: N tarefas, N deps, último updated_at conhecido
    let maxU = 0;
    for (const t of tasks) {
      const u = t.updated_at || t.created_at || '';
      if (u > maxU) maxU = u;
    }
    const hash = `${tasks.length}|${deps.length}|${maxU}`;
    if (this._hash === hash && this._result) {
      Perf.start('computeCriticalPath.cached'); Perf.end('computeCriticalPath.cached');
      return this._result;
    }
    this._hash = hash;
    this._result = computeCriticalPath(tasks, deps);
    return this._result;
  },
};
// Escopo global: atributos onclick inline só enxergam window.*
window.CPMCache = CPMCache;



// Verifica a rede inteira, inclusive os vínculos adicionados antes de persistir.
export function dependencyCycle(tasks, dependencies) {
  const ids = new Set(tasks.map(t => t.id));
  const next = new Map([...ids].map(id => [id, []]));
  for (const d of dependencies) {
    if (ids.has(d.predecessor_id) && ids.has(d.task_id)) next.get(d.predecessor_id).push(d.task_id);
  }
  const visiting = new Set(), visited = new Set(), path = [];
  const visit = id => {
    if (visiting.has(id)) return path.slice(path.indexOf(id)).concat(id);
    if (visited.has(id)) return null;
    visiting.add(id); path.push(id);
    for (const child of next.get(id)) { const cycle = visit(child); if (cycle) return cycle; }
    path.pop(); visiting.delete(id); visited.add(id);
    return null;
  };
  for (const id of ids) { const cycle = visit(id); if (cycle) return cycle; }
  return null;
}

export function computeCriticalPath(tasks, dependencies) {
  Perf.start('computeCriticalPath');
  const result = {
    criticalIds: new Set(),
    slack: new Map(),
    violations: new Map(),
    projectEnd: null,
  };
  if (!tasks || tasks.length === 0) return result;

  // Tarefas inativas não entram no caminho crítico (e suas dependências são ignoradas)
  tasks = tasks.filter(t => !t.inactive);
  if (tasks.length === 0) return result;

  const dayOf = d => Math.floor(new Date(d).getTime() / 86400000);
  const lagDayOf = (dayNum, lagWd) => lagWd === 0 ? dayNum : dayOf(addWorkingDays(new Date(dayNum * 86400000).toISOString().slice(0, 10), lagWd));

  // Marcos têm duração efetiva 0 para o CPM (mesmo que start=end no banco)
  const nodes = new Map();
  tasks.forEach(t => {
    const start = dayOf(t.start_date);
    const end = dayOf(t.end_date);
    const isMs = !!t.is_milestone;
    const duration = isMs ? 0 : Math.max(1, end - start);
    nodes.set(t.id, {
      id: t.id, start, end, duration, isMilestone: isMs,
      es: start, ef: start + duration,
      ls: start, lf: start + duration,
      // Restrição
      ctype: t.constraint_type || 'ASAP',
      cdate: t.constraint_date ? dayOf(t.constraint_date) : null,
    });
  });

  const succsBy = new Map(), predsBy = new Map();
  tasks.forEach(t => { succsBy.set(t.id, []); predsBy.set(t.id, []); });
  (dependencies || []).forEach(d => {
    if (!nodes.has(d.task_id) || !nodes.has(d.predecessor_id)) return;
    succsBy.get(d.predecessor_id).push({ taskId: d.task_id, type: d.type || 'FS', lag: d.lag_days || 0 });
    predsBy.get(d.task_id).push({ predId: d.predecessor_id, type: d.type || 'FS', lag: d.lag_days || 0 });
  });

  // ---- FORWARD PASS (calcula ES/EF) com clamping de restrições ----
  const maxIter = tasks.length + 2;
  for (let iter = 0; iter < maxIter; iter++) {
    let changed = false;
    for (const t of tasks) {
      const node = nodes.get(t.id);
      const preds = predsBy.get(t.id);
      // Inicia com a data planejada (não move para trás)
      let earliestStart = node.start;
      for (const p of preds) {
        const predNode = nodes.get(p.predId);
        let constraint;
        switch (p.type) {
          // FS (TI): começa 1 dia útil APÓS o término da predecessora (lag>=0). Negativo = overlap.
          case 'FS': constraint = lagDayOf(predNode.ef, p.lag >= 0 ? p.lag + 1 : p.lag); break;
          case 'SS': constraint = lagDayOf(predNode.es, p.lag); break;
          case 'FF': constraint = lagDayOf(predNode.ef, p.lag) - node.duration; break;
          case 'SF': constraint = lagDayOf(predNode.es, p.lag) - node.duration; break;
          default:   constraint = lagDayOf(predNode.ef, p.lag >= 0 ? p.lag + 1 : p.lag);
        }
        if (constraint > earliestStart) earliestStart = constraint;
      }
      // Clamping com restrições no forward pass:
      //   SNET: ES >= cdate
      //   MSO:  ES = cdate (data fixa)  → se predecessoras pedem mais, vira VIOLAÇÃO
      //   MFO:  EF = cdate (data fixa)  → ES = cdate - duration
      if (node.cdate != null) {
        if (node.ctype === 'SNET' && earliestStart < node.cdate) earliestStart = node.cdate;
        else if (node.ctype === 'MSO') earliestStart = Math.max(earliestStart, node.cdate);
        else if (node.ctype === 'MFO') earliestStart = Math.max(earliestStart, node.cdate - node.duration);
      }
      const newEf = earliestStart + node.duration;
      if (earliestStart !== node.es || newEf !== node.ef) {
        node.es = earliestStart; node.ef = newEf;
        changed = true;
      }
    }
    if (!changed) break;
  }

  // Fim do projeto = max(EF)
  let projectEndDay = -Infinity;
  nodes.forEach(n => { if (n.ef > projectEndDay) projectEndDay = n.ef; });
  result.projectEnd = new Date(projectEndDay * 86400000);

  // ---- BACKWARD PASS (calcula LS/LF) com clamping ----
  nodes.forEach(n => { n.lf = projectEndDay; n.ls = n.lf - n.duration; });

  for (let iter = 0; iter < maxIter; iter++) {
    let changed = false;
    for (let i = tasks.length - 1; i >= 0; i--) {
      const t = tasks[i];
      const node = nodes.get(t.id);
      const succs = succsBy.get(t.id);
      let latestFinish = projectEndDay;
      for (const s of succs) {
        const succNode = nodes.get(s.taskId);
        let constraint;
        switch (s.type) {
          // FS (TI) espelhado: término da predecessora = início da sucessora − (lag+1) p/ lag>=0.
          case 'FS': constraint = lagDayOf(succNode.ls, -(s.lag >= 0 ? s.lag + 1 : s.lag)); break;
          case 'SS': constraint = lagDayOf(succNode.ls, -s.lag) + node.duration; break;
          case 'FF': constraint = lagDayOf(succNode.lf, -s.lag); break;
          case 'SF': constraint = lagDayOf(succNode.lf, -s.lag) + node.duration; break;
          default:   constraint = lagDayOf(succNode.ls, -(s.lag >= 0 ? s.lag + 1 : s.lag));
        }
        if (constraint < latestFinish) latestFinish = constraint;
      }
      // Clamping no backward pass:
      //   FNLT: LF <= cdate
      //   MFO:  LF = cdate (fixo)
      //   MSO:  LS = cdate → LF = cdate + duration
      //   ALAP: tenta empurrar para o fim do projeto (já é o default)
      if (node.cdate != null) {
        if (node.ctype === 'FNLT' && latestFinish > node.cdate) latestFinish = node.cdate;
        else if (node.ctype === 'MFO') latestFinish = node.cdate;
        else if (node.ctype === 'MSO') latestFinish = Math.min(latestFinish, node.cdate + node.duration);
      }
      const newLs = latestFinish - node.duration;
      if (latestFinish !== node.lf || newLs !== node.ls) {
        node.lf = latestFinish; node.ls = newLs;
        changed = true;
      }
    }
    if (!changed) break;
  }

  // ---- Folga relativa às datas planejadas (mantida em result.slack) ----
  nodes.forEach((n, id) => { result.slack.set(id, n.ls - n.es); });

  // ---- Caminho crítico = cadeia mais longa de tarefas LIGADAS ----
  // CPM puro sobre a rede de dependências entre tarefas-FOLHA: o início de cada
  // tarefa é puxado pelas predecessoras (origem 0), ignorando os intervalos do
  // calendário planejado. Assim o caminho não se fragmenta por gaps de datas —
  // é o "critical path" clássico de gestão de projetos (cadeia mais longa).
  // Tarefas-pai ficam de fora (duração delas é roll-up); são coloridas depois
  // pela propagação hierárquica.
  {
    const parentIds = new Set(tasks.filter(t => t.parent_id).map(t => t.parent_id));
    const leaves = tasks.filter(t => !parentIds.has(t.id));
    const ES = new Map(), EF = new Map(), LS = new Map(), LF = new Map();
    leaves.forEach(t => { const n = nodes.get(t.id); ES.set(t.id, 0); EF.set(t.id, n.duration); });
    const leafPreds = id => predsBy.get(id).filter(p => !parentIds.has(p.predId) && nodes.has(p.predId));
    const leafSuccs = id => succsBy.get(id).filter(s => !parentIds.has(s.taskId) && nodes.has(s.taskId));
    // Forward pass (origem 0; relaxação iterativa, type-aware)
    for (let iter = 0; iter < maxIter; iter++) {
      let changed = false;
      for (const t of leaves) {
        const node = nodes.get(t.id);
        let es = 0;
        for (const p of leafPreds(t.id)) {
          const pef = EF.get(p.predId), pes = ES.get(p.predId);
          let c;
          switch (p.type) {
            case 'SS': c = pes + p.lag; break;
            case 'FF': c = pef + p.lag - node.duration; break;
            case 'SF': c = pes + p.lag - node.duration; break;
            default:   c = pef + (p.lag >= 0 ? p.lag + 1 : p.lag); // FS (TI): +1 dia após o término
          }
          if (c > es) es = c;
        }
        if (es !== ES.get(t.id)) { ES.set(t.id, es); EF.set(t.id, es + node.duration); changed = true; }
      }
      if (!changed) break;
    }
    let endDay = 0;
    EF.forEach(v => { if (v > endDay) endDay = v; });
    // Backward pass
    leaves.forEach(t => { const n = nodes.get(t.id); LF.set(t.id, endDay); LS.set(t.id, endDay - n.duration); });
    for (let iter = 0; iter < maxIter; iter++) {
      let changed = false;
      for (let i = leaves.length - 1; i >= 0; i--) {
        const t = leaves[i];
        const node = nodes.get(t.id);
        let lf = endDay;
        for (const s of leafSuccs(t.id)) {
          const sls = LS.get(s.taskId), slf = LF.get(s.taskId);
          let c;
          switch (s.type) {
            case 'SS': c = sls - s.lag + node.duration; break;
            case 'FF': c = slf - s.lag; break;
            case 'SF': c = slf - s.lag + node.duration; break;
            default:   c = sls - (s.lag >= 0 ? s.lag + 1 : s.lag); // FS (TI): espelha o +1
          }
          if (c < lf) lf = c;
        }
        if (lf !== LF.get(t.id)) { LF.set(t.id, lf); LS.set(t.id, lf - node.duration); changed = true; }
      }
      if (!changed) break;
    }
    // Crítica = folga zero nessa rede (cadeia mais longa)
    result.criticalIds = new Set();
    leaves.forEach(t => { if ((LS.get(t.id) - ES.get(t.id)) <= 0) result.criticalIds.add(t.id); });
  }

  // Observação: tarefas-pai (resumo) NÃO entram no caminho crítico — só as
  // tarefas-folha da cadeia mais longa ficam marcadas. (A propagação hierárquica
  // que pintava os pais foi removida a pedido.)

  // ---- Detecta violações de restrições ----
  // Uma restrição é violada quando o valor que o CPM calculou difere
  // do que a restrição exige (predecessoras forçam tarefa a começar/terminar
  // depois do que MSO/MFO/FNLT permitem)
  const fmt = day => new Date(day * 86400000).toISOString().slice(0,10);
  nodes.forEach((n, id) => {
    if (n.cdate == null) return;
    let violation = null;
    switch (n.ctype) {
      case 'MSO':
        if (n.es !== n.cdate) {
          violation = {
            type: 'MSO', expected: fmt(n.cdate), computed: fmt(n.es),
            message: `Deve iniciar em ${fmtDateFull(fmt(n.cdate))} mas as predecessoras forçam ${fmtDateFull(fmt(n.es))}`
          };
        }
        break;
      case 'MFO':
        if (n.ef !== n.cdate) {
          violation = {
            type: 'MFO', expected: fmt(n.cdate), computed: fmt(n.ef),
            message: `Deve terminar em ${fmtDateFull(fmt(n.cdate))} mas o cálculo aponta ${fmtDateFull(fmt(n.ef))}`
          };
        }
        break;
      case 'FNLT':
        if (n.ef > n.cdate) {
          violation = {
            type: 'FNLT', expected: fmt(n.cdate), computed: fmt(n.ef),
            message: `Não pode terminar depois de ${fmtDateFull(fmt(n.cdate))} mas o cálculo aponta ${fmtDateFull(fmt(n.ef))}`
          };
        }
        break;
      case 'SNET':
        if (n.es < n.cdate) {
          violation = {
            type: 'SNET', expected: fmt(n.cdate), computed: fmt(n.es),
            message: `Não pode iniciar antes de ${fmtDateFull(fmt(n.cdate))} mas o cálculo aponta ${fmtDateFull(fmt(n.es))}`
          };
        }
        break;
    }
    if (violation) result.violations.set(id, violation);
  });

  Perf.end('computeCriticalPath');
  return result;
}

// ============================================================================
// AUTO-AGENDAMENTO — Recalcula datas de início/fim das tarefas
// respeitando dependências e restrições. Modifica `tasks` in-place
// (não persiste no banco — quem persiste é o caller).
//
// Uso: const changes = autoSchedule(tasks, dependencies)
//   → retorna [{ id, oldStart, oldEnd, newStart, newEnd }] das tarefas que mudaram
// ============================================================================
export function autoSchedule(tasks, dependencies) {
  if (!tasks || tasks.length === 0) return [];
  if (dependencyCycle(tasks, dependencies || [])) throw new Error('Dependência circular no cronograma. Corrija as predecessoras antes de recalcular.');
  const changes = [];

  const dayOf = d => Math.floor(new Date(d).getTime() / 86400000);
  const fmt = day => new Date(day * 86400000).toISOString().slice(0,10);
  // Converte lag em DIAS ÚTEIS para o espaço de número de dia do CPM.
  // Lag negativo = antecipação (overlap); lag positivo = espera.
  const lagDayOf = (dayNum, lagWd) => lagWd === 0 ? dayNum : dayOf(addWorkingDays(fmt(dayNum), lagWd));

  // Índice id->task (usado em vários pontos; evita tasks.find O(n) em cada chamada).
  const taskById = new Map(tasks.map(t => [t.id, t]));

  const nodes = new Map();
  tasks.forEach(t => {
    const start = dayOf(t.start_date);
    const end = dayOf(t.end_date);
    const isMs = !!t.is_milestone;
    const duration = isMs ? 0 : Math.max(1, end - start);
    // Duração em DIAS ÚTEIS (usada para recompor o término sempre num dia útil).
    const wdur = isMs ? 0 : workingDaysBetween(t.start_date, t.end_date);
    // Tarefa "iniciada" (real): tem progresso > 0, ou status em_andamento/concluido.
    // Suas datas viram REAIS — o agendador não mexe mais nelas (a predecessora não
    // empurra mais), mas as sucessoras continuam usando essas datas atuais para se
    // posicionar. Marcos seguem o comportamento padrão.
    const started = !isMs && (
      t.status === 'em_andamento' || t.status === 'concluido' ||
      (parseFloat(t.progress) || 0) > 0
    );
    nodes.set(t.id, {
      id: t.id, duration, wdur, started,
      es: start, ef: start + duration,
      ctype: t.constraint_type || 'ASAP',
      cdate: t.constraint_date ? dayOf(t.constraint_date) : null,
      origStart: start, origEnd: end,
    });
  });

  const predsBy = new Map();
  tasks.forEach(t => predsBy.set(t.id, []));
  (dependencies || []).forEach(d => {
    if (!nodes.has(d.task_id) || !nodes.has(d.predecessor_id)) return;
    predsBy.get(d.task_id).push({ predId: d.predecessor_id, type: d.type || 'FS', lag: d.lag_days || 0 });
  });

  // Tarefas-pai (resumo) NÃO são agendadas pelas predecessoras: suas datas são o
  // MÍN início / MÁX término das filhas. Detecta os pais e a ordem bottom-up.
  const _isParent = new Set();
  const _kidsBy = new Map();
  tasks.forEach(t => {
    if (t.parent_id && nodes.has(t.parent_id)) {
      _isParent.add(t.parent_id);
      if (!_kidsBy.has(t.parent_id)) _kidsBy.set(t.parent_id, []);
      _kidsBy.get(t.parent_id).push(t.id);
    }
  });
  const _depthOf = (id) => { let d = 0, cur = taskById.get(id), g = 0; while (cur && cur.parent_id && g++ < 50) { d++; cur = taskById.get(cur.parent_id); } return d; };
  const _parentsBottomUp = [..._isParent].sort((a, b) => _depthOf(b) - _depthOf(a));
  // Mapa id->parent_id (rápido) para subir a cadeia de ancestrais ao aplicar os "portões".
  const _parentOf = new Map(tasks.map(t => [t.id, t.parent_id || null]));

  const maxIter = tasks.length + 2;
  for (let iter = 0; iter < maxIter; iter++) {
    let changed = false;
    // Portão de início que cada tarefa-PAI impõe às filhas, vindo das predecessoras do pai.
    // As filhas SEM predecessora própria ALINHAM exatamente a esse portão — pra frente
    // (predecessora atrasou) ou pra trás (predecessora terminou antes do que a família estava
    // agendada, ex.: dado legado nunca recalculado) — mantendo suas durações e predecessoras
    // internas entre si (o resto da cadeia acompanha via propagação normal FS/SS/FF/SF).
    const _gateOf = new Map();
    for (const pid of _isParent) {
      const gpreds = predsBy.get(pid) || [];
      if (!gpreds.length) continue;
      const pn = nodes.get(pid);
      let gate = -Infinity;
      for (const p of gpreds) {
        const pred = nodes.get(p.predId); if (!pred) continue;
        let c;
        switch (p.type) {
          case 'SS': c = lagDayOf(pred.es, p.lag); break;                              // II
          case 'FF': c = lagDayOf(pred.ef, p.lag) - (pn.ef - pn.es); break;          // TT
          case 'SF': c = lagDayOf(pred.es, p.lag) - (pn.ef - pn.es); break;          // IT
          // FS (TI): sucessora começa 1 dia útil APÓS o término (lag>=0). Negativo = overlap.
          default:   c = lagDayOf(pred.ef, p.lag >= 0 ? p.lag + 1 : p.lag); break;
        }
        // MAIOR entre as predecessoras do pai (CPM padrão): a fase só pode começar quando
        // TODAS as suas predecessoras permitirem — mas esse valor pode ser antes OU depois
        // de onde a família está hoje, e nos dois casos a família deve alinhar a ele.
        if (c > gate) gate = c;
      }
      if (gate > -Infinity) _gateOf.set(pid, gate);
    }
    // Portão efetivo de uma tarefa = MAIOR portão entre seus ancestrais (fases aninhadas).
    const _effGate = (tid) => {
      let g = -Infinity, cur = _parentOf.get(tid), guard = 0;
      while (cur && guard++ < 50) { if (_gateOf.has(cur)) g = Math.max(g, _gateOf.get(cur)); cur = _parentOf.get(cur); }
      return g;
    };
    for (const t of tasks) {
      if (_isParent.has(t.id)) continue; // pai = roll-up das filhas (abaixo), não agenda por predecessora
      const node = nodes.get(t.id);
      // Tarefa JÁ INICIADA: datas viram REAIS, o agendador não mexe mais nelas.
      // Sucessoras continuam usando as datas atuais dela (es/ef já setados no setup).
      if (node.started) continue;
      const preds = predsBy.get(t.id);
      const _g = _effGate(t.id);
      // Filha SEM predecessora própria: alinha exatamente ao portão do pai/ancestral, se houver.
      // Filha COM predecessora própria: segue a predecessora dela (laço abaixo), mas o portão
      // da fase ainda vale como PISO — mesmo já tendo uma predecessora própria bem anterior,
      // a filha não pode começar antes do que a predecessora DO PAI permite (a fase "prende"
      // todas as suas subtarefas, não só a primeira). Se a predecessora própria empurrar a
      // filha para DEPOIS do portão, essa data (mais tardia) continua valendo — é um MÁXIMO
      // entre as duas restrições, como no CPM padrão.
      let earliestStart;
      if (preds.length === 0) {
        earliestStart = _g > -Infinity ? _g : node.origStart;
      } else {
        earliestStart = -Infinity;
      }
      for (const p of preds) {
        const predNode = nodes.get(p.predId);
        let constraint;
        switch (p.type) {
          // FS (TI): começa 1 dia útil APÓS o término da predecessora (lag>=0). Negativo = overlap.
          case 'FS': constraint = lagDayOf(predNode.ef, p.lag >= 0 ? p.lag + 1 : p.lag); break;
          case 'SS': constraint = lagDayOf(predNode.es, p.lag); break;
          case 'FF': constraint = lagDayOf(predNode.ef, p.lag) - node.duration; break;
          case 'SF': constraint = lagDayOf(predNode.es, p.lag) - node.duration; break;
          default:   constraint = lagDayOf(predNode.ef, p.lag >= 0 ? p.lag + 1 : p.lag);
        }
        if (constraint > earliestStart) earliestStart = constraint;
      }
      if (earliestStart === -Infinity) earliestStart = node.origStart;
      if (preds.length > 0 && _g > -Infinity && _g > earliestStart) earliestStart = _g;
      // Restrições
      if (node.cdate != null) {
        if (node.ctype === 'SNET' && earliestStart < node.cdate) earliestStart = node.cdate;
        else if (node.ctype === 'MSO') earliestStart = Math.max(earliestStart, node.cdate);
        else if (node.ctype === 'MFO') earliestStart = Math.max(earliestStart, node.cdate - node.duration);
      }
      // Dias úteis: início vai para o próximo dia útil; término = início + duração útil
      // (cai sempre num dia útil). Mantém a antiga "duration" só para os tipos FF/SF acima.
      if (Number.isFinite(earliestStart)) {
        const _esD = nextWorkday(fmt(earliestStart));
        earliestStart = dayOf(_esD);
        var newEf = dayOf(addWorkingDays(_esD, node.wdur));
      } else {
        var newEf = earliestStart + node.duration;
      }
      if (earliestStart !== node.es || newEf !== node.ef) {
        node.es = earliestStart; node.ef = newEf;
        changed = true;
      }
    }
    // Roll-up das datas dos pais (bottom-up): início = MÍN das filhas, término = MÁX.
    // Roda dentro do laço para propagar p/ sucessoras de um pai na próxima iteração.
    for (const pid of _parentsBottomUp) {
      const kids = (_kidsBy.get(pid) || []).map(id => nodes.get(id)).filter(k => k && Number.isFinite(k.es) && Number.isFinite(k.ef));
      if (!kids.length) continue;
      const minEs = Math.min(...kids.map(k => k.es));
      const maxEf = Math.max(...kids.map(k => k.ef));
      const pn = nodes.get(pid);
      if (pn.es !== minEs || pn.ef !== maxEf) { pn.es = minEs; pn.ef = maxEf; changed = true; }
    }
    if (!changed) break;
  }

  // Coleta mudanças
  nodes.forEach((n, id) => {
    if (n.es !== n.origStart || n.ef !== n.origEnd) {
      const t = tasks.find(x => x.id === id);
      changes.push({
        id,
        title: t.title,
        code: t.code,
        oldStart: fmt(n.origStart),
        oldEnd: fmt(n.origEnd),
        newStart: fmt(n.es),
        newEnd: fmt(n.ef),
      });
    }
  });
  return changes;
}
