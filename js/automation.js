// Automações (receitas)
import { daysBetween, mondayOf, today } from './helpers.js';
import { State } from './state.js';
import { DB } from './db.js';

// ============================================================================
// AUTOMATION (Tier 1) — receitas prontas, configuradas via toggles
// ============================================================================
// Cada receita roda em hooks bem definidos para evitar surpresas:
//   • applyOnLoad()       → ao carregar dados do projeto (arquivamento, alertas)
//   • applyOnTaskCreate() → antes de criar uma tarefa (atribuir por disciplina)
//   • applyOnTaskUpdate() → após atualizar uma tarefa (auto-PPC)
// O estado é persistido em localStorage por usuário (sem migration nova).
export const Automation = {
  _key() { return `auto_prefs_${State.user?.id || 'anon'}`; },
  _defaults() {
    return {
      archiveDoneDays: 0,
      promotePriorityNearDeadline: false,
      stalledAlertDays: 0,
      autoPpcOnComplete: true,
      assignByDiscipline: false,
    };
  },
  load() {
    try {
      const raw = localStorage.getItem(this._key());
      if (raw) State.automation = { ...this._defaults(), ...JSON.parse(raw) };
    } catch(e) {}
  },
  save() {
    try { localStorage.setItem(this._key(), JSON.stringify(State.automation)); } catch(e) {}
  },
  // Tarefa está "arquivada" pela regra (oculta em Lista/Kanban)?
  isArchived(task) {
    const n = State.automation?.archiveDoneDays || 0;
    if (!n || task.status !== 'concluido') return false;
    const ref = task.completed_at || task.updated_at || task.end_date;
    if (!ref) return false;
    return daysBetween(ref.slice(0, 10), today()) >= n;
  },
  // "Stalled": em andamento sem progresso há ≥N dias (usa updated_at como aproximação)
  isStalled(task) {
    const n = State.automation?.stalledAlertDays || 0;
    if (!n || task.status !== 'em_andamento') return false;
    if ((parseFloat(task.progress) || 0) >= 100) return false;
    const ref = task.updated_at || task.start_date;
    if (!ref) return false;
    return daysBetween(ref.slice(0, 10), today()) >= n;
  },
  // "Prazo próximo": promove para Alta se ≤3 dias do prazo e não concluída/cancelada
  shouldPromotePriority(task) {
    if (!State.automation?.promotePriorityNearDeadline) return false;
    if (!task.end_date || task.status === 'concluido') return false;
    if (task.priority === 'alta' || task.priority === 'critica') return false;
    const d = daysBetween(today(), task.end_date);
    return d >= 0 && d <= 3;
  },
  // Hook: antes de criar uma tarefa, ajusta payload (responsável por disciplina)
  applyOnTaskCreate(payload) {
    if (State.automation?.assignByDiscipline && !payload.assignee_id && payload.discipline_id) {
      const d = State.disciplines.find(x => x.id === payload.discipline_id);
      if (d?.lead_member_id) payload.assignee_id = d.lead_member_id;
    }
    return payload;
  },
  // Hook: após atualizar uma tarefa, dispara efeitos (auto-PPC do Last Planner)
  async applyOnTaskUpdate(taskId, patch, taskBefore) {
    if (State.automation?.autoPpcOnComplete && patch.status === 'concluido' && taskBefore?.status !== 'concluido') {
      // Procura compromisso semanal pendente para esta tarefa e marca como cumprido
      const wkNow = (typeof mondayOf === 'function') ? mondayOf(today()) : null;
      const c = (State.weeklyCommitments || []).find(x => x.task_id === taskId && x.week_start === wkNow && x.status === 'pendente');
      if (c) {
        try { await DB.updateWeeklyCommitment(c.id, { status: 'cumprido', cause: null }); Object.assign(c, { status: 'cumprido', cause: null }); }
        catch(e) { /* tabela ausente: ignora silenciosamente */ }
      }
    }
  },
};
