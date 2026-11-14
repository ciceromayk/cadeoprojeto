// Saúde do projeto (score 0–100)
import { addWorkingDays, fmtDateShort, today, workingDaysBetween } from './helpers.js';
import { State } from './state.js';
import { DB } from './db.js';
import { Perf } from './perf.js';
import { UI } from './ui.js';

// ============================================================================
// HEALTH CHECK — Validador de saúde do projeto + score 0–100
// ============================================================================
// Cada regra retorna um array de "issues". Severidades:
//   error  — viola integridade, bloqueia operações (ex.: ciclo de dependência)
//   warn   — risco operacional (ex.: tarefa sem responsável)
//   info   — sugestão de boa prática (ex.: baseline desatualizada)
//
// Pesos no score: error -3, warn -1, info -0.3 — limitado [0, 100].
//
// Cada issue tem { id, severity, code, title, taskId?, action? } onde action
// é um objeto opcional { label, type, ... } que a UI usa para oferecer
// correção 1-clique.
export const HealthCheck = {
  WEIGHTS: { error: 3, warn: 1, info: 0.3 },

  // Cache (mesmo princípio do CPMCache): evita recomputar a cada render
  // (ex.: colapsar/expandir tarefas no Gantt não muda os dados).
  _hash: null,
  _result: null,
  invalidate() { this._hash = null; this._result = null; },
  _sig() {
    const tasks = State.tasks || [], rests = State.restrictions || [];
    let maxU = 0;
    for (const t of tasks) { const u = t.updated_at || t.created_at || ''; if (u > maxU) maxU = u; }
    for (const r of rests) { const u = r.updated_at || r.created_at || ''; if (u > maxU) maxU = u; }
    return `${tasks.length}|${(State.dependencies||[]).length}|${rests.length}|${(State.disciplines||[]).length}|${(State.sectors||[]).length}|${maxU}`;
  },
  run() {
    const sig = this._sig();
    if (this._hash === sig && this._result) return this._result;
    const res = this._run();
    this._hash = sig; this._result = res;
    return res;
  },

  _run() {
    Perf.start('HealthCheck.run');
    const issues = [];
    const tasks = State.tasks || [];
    const deps  = State.dependencies || [];
    const disciplines = State.disciplines || [];
    const sectors = State.sectors || [];
    const restrictions = State.restrictions || [];
    const t = today();

    // Lookups
    const taskById = new Map(tasks.map(t => [t.id, t]));
    const leafIds = new Set(); // sem filhos
    const parentSet = new Set(tasks.filter(t => t.parent_id).map(t => t.parent_id));
    tasks.forEach(t => { if (!parentSet.has(t.id)) leafIds.add(t.id); });
    const isLeaf = id => leafIds.has(id);
    const leaves = tasks.filter(t => isLeaf(t.id));

    // ── 1. Datas inválidas (fim < início) ────────────────────────────────────
    tasks.forEach(t => {
      if (t.start_date && t.end_date && t.end_date < t.start_date) {
        issues.push({
          id: 'date:' + t.id, severity: 'error', code: 'invalid_dates',
          title: `Data de término anterior ao início: "${t.title}"`,
          taskId: t.id,
          action: { type: 'fix-end-date', label: 'Ajustar término' },
        });
      }
    });

    // ── 2. Dependências circulares ────────────────────────────────────────────
    {
      const adj = new Map();
      deps.forEach(d => {
        if (!adj.has(d.predecessor_id)) adj.set(d.predecessor_id, []);
        adj.get(d.predecessor_id).push(d.task_id);
      });
      // DFS detection
      const WHITE = 0, GRAY = 1, BLACK = 2;
      const color = new Map();
      tasks.forEach(t => color.set(t.id, WHITE));
      const cycles = new Set();
      const stack = [];
      const dfs = (u) => {
        color.set(u, GRAY); stack.push(u);
        for (const v of (adj.get(u) || [])) {
          if (color.get(v) === GRAY) {
            // ciclo: extrai sequência
            const idx = stack.indexOf(v);
            const cyc = stack.slice(idx);
            cycles.add(cyc.sort().join('|'));
          } else if (color.get(v) === WHITE) {
            dfs(v);
          }
        }
        color.set(u, BLACK); stack.pop();
      };
      for (const t of tasks) { if (color.get(t.id) === WHITE) dfs(t.id); }
      cycles.forEach(key => {
        const ids = key.split('|');
        const names = ids.map(id => taskById.get(id)?.title || '').filter(Boolean).slice(0, 3).join(' → ');
        issues.push({
          id: 'cycle:' + key, severity: 'error', code: 'dep_cycle',
          title: `Dependência circular detectada (${ids.length} tarefas): ${names}…`,
        });
      });
    }

    // ── 2b. Sucessora começa antes do fim da predecessora (FS) ────────────────
    // O motor de cálculo NUNCA reagenda uma tarefa já iniciada/concluída (tem
    // progresso real ou status em_andamento/concluído), então se a predecessora
    // for reprogramada para depois, a sucessora "iniciada" fica presa numa data
    // anterior ao fim da predecessora — uma inconsistência real que "Recalcular"
    // não corrige sozinho (mexer na data destruiria o progresso/histórico real).
    // Só sinaliza para o usuário decidir: corrigir a predecessora, o tipo de
    // vínculo (pode ser sobreposição intencional, não FS) ou a sucessora.
    deps.forEach(d => {
      if (d.type !== 'FS') return;
      const succ = taskById.get(d.task_id);
      const pred = taskById.get(d.predecessor_id);
      if (!succ || !pred || !succ.start_date || !pred.end_date) return;
      if (succ.start_date <= pred.end_date) {
        // Só oferece correção de 1 clique quando não há progresso real registrado
        // (nada a perder ao mover a data); com progresso/conclusão real, só sinaliza.
        const canAutoFix = (parseFloat(succ.progress) || 0) === 0 && succ.status !== 'concluido';
        issues.push({
          id: 'predconflict:' + d.id, severity: 'warn', code: 'successor_before_predecessor',
          title: `"${succ.title}" começa (${succ.start_date}) antes do fim de "${pred.title}" (${pred.end_date})`,
          taskId: succ.id,
          action: canAutoFix
            ? { type: 'fix-successor-start', label: 'Corrigir data', predId: pred.id, lag: d.lag_days || 0 }
            : { type: 'open-task', label: 'Revisar vínculo' },
        });
      }
    });

    // ── 3. Tarefa em andamento sem responsável (só leaf) ─────────────────────
    leaves.forEach(t => {
      if (t.status === 'em_andamento' && !t.assignee_id) {
        issues.push({
          id: 'noassign:' + t.id, severity: 'warn', code: 'no_assignee',
          title: `Tarefa em andamento sem responsável: "${t.title}"`,
          taskId: t.id,
          action: { type: 'open-task', label: 'Atribuir responsável' },
        });
      }
    });

    // ── 4. Tarefa em andamento sem progresso ─────────────────────────────────
    leaves.forEach(t => {
      if (t.status === 'em_andamento' && (parseFloat(t.progress) || 0) === 0) {
        issues.push({
          id: 'noprog:' + t.id, severity: 'warn', code: 'stale_progress',
          title: `Em andamento sem progresso: "${t.title}"`,
          taskId: t.id,
          action: { type: 'open-task', label: 'Atualizar progresso' },
        });
      }
    });

    // ── 5. Tarefas atrasadas sem causa registrada ────────────────────────────
    const _today = t;
    leaves.forEach(tk => {
      if (tk.status !== 'concluido' && tk.end_date && tk.end_date < _today && !tk.delay_cause) {
        issues.push({
          id: 'nocause:' + tk.id, severity: 'warn', code: 'overdue_no_cause',
          title: `Tarefa atrasada sem causa registrada: "${tk.title}"`,
          taskId: tk.id,
          action: { type: 'open-task', label: 'Informar causa' },
        });
      }
    });

    // ── 6. Sem disciplina (só leaf — pai herda) ──────────────────────────────
    leaves.forEach(tk => {
      if (!tk.discipline_id && disciplines.length > 0) {
        issues.push({
          id: 'nodisc:' + tk.id, severity: 'info', code: 'no_discipline',
          title: `Sem disciplina vinculada: "${tk.title}"`,
          taskId: tk.id,
          action: { type: 'open-task', label: 'Vincular disciplina' },
        });
      }
    });

    // ── 7. Sem setor (só leaf — pai herda) ───────────────────────────────────
    leaves.forEach(tk => {
      if (!tk.sector && sectors.length > 0) {
        issues.push({
          id: 'nosector:' + tk.id, severity: 'info', code: 'no_sector',
          title: `Sem setor responsável: "${tk.title}"`,
          taskId: tk.id,
          action: { type: 'open-task', label: 'Definir setor' },
        });
      }
    });

    // ── 8. Marco com data ≠ start = end ──────────────────────────────────────
    tasks.forEach(tk => {
      if (tk.is_milestone && tk.start_date !== tk.end_date) {
        issues.push({
          id: 'milestone:' + tk.id, severity: 'warn', code: 'milestone_dates',
          title: `Marco com início ≠ término: "${tk.title}"`,
          taskId: tk.id,
          action: { type: 'fix-milestone', label: 'Alinhar datas' },
        });
      }
    });

    // ── 8b. Tarefa-PAI marcada como marco ─────────────────────────────────────
    // Tarefa-pai tem datas de roll-up (intervalo das filhas) — incompatível com
    // marco (ponto único no tempo). Dados assim já causaram cronograma incorreto
    // (o motor usa start_date do "marco" como referência, ignorando o intervalo real).
    {
      const _parentIdsMs = new Set(tasks.filter(t => t.parent_id).map(t => t.parent_id));
      tasks.forEach(tk => {
        if (tk.is_milestone && _parentIdsMs.has(tk.id)) {
          issues.push({
            id: 'parentms:' + tk.id, severity: 'error', code: 'parent_is_milestone',
            title: `Tarefa-pai marcada como marco: "${tk.title}"`,
            taskId: tk.id,
            action: { type: 'fix-parent-milestone', label: 'Desmarcar marco' },
          });
        }
      });
    }

    // ── 8c. Tarefa-pai com datas fora de sincronia com o rollup das filhas ────
    // Bug conhecido: "Recalcular" às vezes não persiste a data da própria
    // tarefa-pai mesmo quando o valor correto já é usado internamente para
    // agendar as sucessoras (a sucessora fica certa, a tarefa-pai fica com a
    // data antiga na tela). Detecta o desvio comparando com o rollup real.
    {
      const byParentStale = new Map();
      tasks.forEach(tk => {
        if (tk.parent_id) {
          if (!byParentStale.has(tk.parent_id)) byParentStale.set(tk.parent_id, []);
          byParentStale.get(tk.parent_id).push(tk.id);
        }
      });
      const rollupCache = new Map();
      const rollupOf = (id) => {
        if (rollupCache.has(id)) return rollupCache.get(id);
        const kids = byParentStale.get(id);
        const tk = taskById.get(id);
        let result;
        if (!kids || kids.length === 0) {
          result = { start: tk?.start_date || null, end: tk?.end_date || null };
        } else {
          let minStart = null, maxEnd = null;
          kids.forEach(kid => {
            const r = rollupOf(kid);
            if (r.start && (!minStart || r.start < minStart)) minStart = r.start;
            if (r.end && (!maxEnd || r.end > maxEnd)) maxEnd = r.end;
          });
          result = { start: minStart, end: maxEnd };
        }
        rollupCache.set(id, result);
        return result;
      };
      tasks.forEach(tk => {
        if (!parentSet.has(tk.id)) return;
        const r = rollupOf(tk.id);
        if (r.start && r.end && (r.start !== tk.start_date || r.end !== tk.end_date)) {
          issues.push({
            id: 'parentstale:' + tk.id, severity: 'warn', code: 'parent_dates_stale',
            title: `Datas da tarefa-pai fora de sincronia com as filhas: "${tk.title}"`,
            taskId: tk.id,
            action: { type: 'fix-parent-dates', label: 'Sincronizar datas' },
          });
        }
      });
    }

    // ── 9. Restrição vencida ──────────────────────────────────────────────────
    restrictions.forEach(r => {
      if (r.due_date && r.due_date < _today && r.status !== 'resolvida' && r.status !== 'cancelada') {
        issues.push({
          id: 'restov:' + r.id, severity: 'warn', code: 'restriction_overdue',
          title: `Restrição vencida: "${(r.description || '').slice(0, 50)}"`,
        });
      }
    });

    // ── 10. Baseline desatualizada (> 90 dias) ───────────────────────────────
    const baselined = tasks.filter(tk => tk.baseline_set_at);
    if (baselined.length > 0) {
      const oldest = baselined.reduce((a, b) => (a.baseline_set_at < b.baseline_set_at ? a : b));
      const days = Math.floor((new Date(_today) - new Date(oldest.baseline_set_at.slice(0, 10))) / 86400000);
      if (days > 90) {
        issues.push({
          id: 'baseline:stale', severity: 'info', code: 'baseline_stale',
          title: `Linha de base não atualizada há ${days} dias`,
        });
      }
    } else if (tasks.length > 5) {
      issues.push({
        id: 'baseline:none', severity: 'info', code: 'no_baseline',
        title: 'Nenhuma linha de base salva — congele o plano para acompanhar desvios',
      });
    }

    // ── 11. Tarefas órfãs (parent_id apontando para id inexistente) ──────────
    tasks.forEach(tk => {
      if (tk.parent_id && !taskById.has(tk.parent_id)) {
        issues.push({
          id: 'orphan:' + tk.id, severity: 'warn', code: 'orphan_task',
          title: `Tarefa órfã (parent_id inválido): "${tk.title}"`,
          taskId: tk.id,
          action: { type: 'fix-orphan', label: 'Remover vínculo' },
        });
      }
    });

    // ── 12. Sobrealocação de recursos (mesmo responsável em tarefas sobrepostas) ──
    // Detecção apenas: aponta quando um responsável tem 2+ tarefas-folha ativas cujos
    // períodos se sobrepõem (não dá p/ fazer duas ao mesmo tempo). NÃO move nada.
    {
      const memberById = new Map((State.members || []).map(m => [m.id, m]));
      const byAssignee = new Map();
      leaves.forEach(tk => {
        if (!tk.assignee_id || tk.inactive || tk.is_milestone) return;
        if (tk.status === 'concluido') return;            // concluída não conta p/ carga
        if (!tk.start_date || !tk.end_date) return;
        if (!byAssignee.has(tk.assignee_id)) byAssignee.set(tk.assignee_id, []);
        byAssignee.get(tk.assignee_id).push(tk);
      });
      byAssignee.forEach((list, mid) => {
        if (list.length < 2) return;
        list.sort((a, b) => (a.start_date < b.start_date ? -1 : a.start_date > b.start_date ? 1 : 0));
        // Sweep por início: uma tarefa conflita se algo anterior ainda está "rodando".
        // (datas inclusivas; com o boundary TI+1 tarefas encadeadas não dividem o mesmo dia)
        const involved = new Set();
        let firstConflict = null;
        const active = [];
        for (const tk of list) {
          for (let k = active.length - 1; k >= 0; k--) {
            if (active[k].end_date < tk.start_date) active.splice(k, 1);   // já terminou
          }
          if (active.length > 0) {
            involved.add(tk.id);
            active.forEach(a => involved.add(a.id));
            if (!firstConflict) firstConflict = tk;
          }
          active.push(tk);
        }
        if (involved.size < 2) return;
        let minS = null, maxE = null;
        involved.forEach(id => {
          const tk = taskById.get(id); if (!tk) return;
          if (minS === null || tk.start_date < minS) minS = tk.start_date;
          if (maxE === null || tk.end_date   > maxE) maxE = tk.end_date;
        });
        const mem = memberById.get(mid);
        const memName = mem ? (mem.name || 'Responsável').split(' ')[0] : 'Responsável';
        const period = (minS && maxE) ? ` (${fmtDateShort(minS)}–${fmtDateShort(maxE)})` : '';
        issues.push({
          id: 'overalloc:' + mid,
          severity: 'warn', code: 'resource_overallocation',
          title: `${memName} sobrealocado: ${involved.size} tarefas se sobrepõem${period}`,
          taskId: (firstConflict || list[0]).id,
          action: { type: 'open-task', label: 'Ver tarefa' },
        });
      });
    }

    // ── Score ────────────────────────────────────────────────────────────────
    let penalty = 0;
    issues.forEach(i => { penalty += this.WEIGHTS[i.severity] || 0; });
    const score = Math.max(0, Math.min(100, Math.round(100 - penalty)));

    Perf.end('HealthCheck.run');
    return {
      score,
      issues,
      summary: {
        errors: issues.filter(i => i.severity === 'error').length,
        warnings: issues.filter(i => i.severity === 'warn').length,
        infos: issues.filter(i => i.severity === 'info').length,
        total: issues.length,
      },
    };
  },

  // Aplica uma correção rápida; retorna true se mutou estado/DB.
  async applyAction(issue) {
    if (!issue?.action) return false;
    const task = issue.taskId ? State.tasks.find(t => t.id === issue.taskId) : null;
    switch (issue.action.type) {
      case 'open-task':
        if (task) UI.openTaskModal(task.id);
        return false;
      case 'fix-end-date':
        if (task) {
          // se fim < início, end := start
          await DB.updateTask(task.id, { end_date: task.start_date });
          Object.assign(task, { end_date: task.start_date });
          return true;
        }
        return false;
      case 'fix-milestone':
        if (task) {
          await DB.updateTask(task.id, { end_date: task.start_date, progress: task.status === 'concluido' ? 100 : 0 });
          Object.assign(task, { end_date: task.start_date });
          return true;
        }
        return false;
      case 'fix-orphan':
        if (task) {
          await DB.updateTask(task.id, { parent_id: null });
          task.parent_id = null;
          return true;
        }
        return false;
      case 'fix-successor-start':
        if (task) {
          const pred = State.tasks.find(t => t.id === issue.action.predId);
          if (pred?.end_date) {
            const lag = issue.action.lag || 0;
            const newStart = addWorkingDays(pred.end_date, lag >= 0 ? lag + 1 : lag);
            const durationWd = Math.max(1, workingDaysBetween(task.start_date, task.end_date));
            const newEnd = addWorkingDays(newStart, durationWd);
            await DB.updateTask(task.id, { start_date: newStart, end_date: newEnd });
            Object.assign(task, { start_date: newStart, end_date: newEnd });
            return true;
          }
        }
        return false;
      case 'fix-parent-milestone':
        if (task) {
          await DB.updateTask(task.id, { is_milestone: false });
          task.is_milestone = false;
          return true;
        }
        return false;
      case 'fix-parent-dates':
        if (task) {
          const byParentStale = new Map();
          State.tasks.forEach(tk => {
            if (tk.parent_id) {
              if (!byParentStale.has(tk.parent_id)) byParentStale.set(tk.parent_id, []);
              byParentStale.get(tk.parent_id).push(tk.id);
            }
          });
          const byIdStale = new Map(State.tasks.map(tk => [tk.id, tk]));
          const rollupCache = new Map();
          const rollupOf = (id) => {
            if (rollupCache.has(id)) return rollupCache.get(id);
            const kids = byParentStale.get(id);
            const tk = byIdStale.get(id);
            let result;
            if (!kids || kids.length === 0) {
              result = { start: tk?.start_date || null, end: tk?.end_date || null };
            } else {
              let minStart = null, maxEnd = null;
              kids.forEach(kid => {
                const r = rollupOf(kid);
                if (r.start && (!minStart || r.start < minStart)) minStart = r.start;
                if (r.end && (!maxEnd || r.end > maxEnd)) maxEnd = r.end;
              });
              result = { start: minStart, end: maxEnd };
            }
            rollupCache.set(id, result);
            return result;
          };
          const r = rollupOf(task.id);
          if (r.start && r.end) {
            await DB.updateTask(task.id, { start_date: r.start, end_date: r.end });
            Object.assign(task, { start_date: r.start, end_date: r.end });
            return true;
          }
        }
        return false;
    }
    return false;
  },

  scoreColor(score) {
    if (score >= 90) return 'var(--accent-success)';
    if (score >= 75) return 'var(--blueprint)';
    if (score >= 50) return 'var(--accent-warm)';
    return 'var(--accent-danger)';
  },

  scoreLabel(score) {
    if (score >= 90) return 'Excelente';
    if (score >= 75) return 'Bom';
    if (score >= 50) return 'Atenção';
    return 'Crítico';
  },
};
// Escopo global: atributos onclick inline só enxergam window.*
window.HealthCheck = HealthCheck;
