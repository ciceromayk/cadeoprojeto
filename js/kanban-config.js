// Configuração do Kanban (por projeto)
import { State } from './state.js';

// ---------- KANBAN CONFIG (localStorage por projeto) ----------
export const KanbanConfig = {
  _key() { return `kanban_cols_${State.currentProjectId || 'global'}`; },
  _defaults() {
    return [
      { id: 'a_fazer',      label: 'A Fazer',       color: '#9ba8be' },
      { id: 'bloqueada',    label: 'Bloqueada',     color: '#C13B12' },
      { id: 'em_andamento', label: 'Em Andamento',  color: '#E54B1A' },
      { id: 'concluido',    label: 'Concluída',     color: '#2E7D4F' },
    ];
  },
  get() {
    try {
      const raw = localStorage.getItem(this._key());
      if (raw) return JSON.parse(raw);
    } catch(e) {}
    return this._defaults();
  },
  set(cols) {
    try { localStorage.setItem(this._key(), JSON.stringify(cols)); } catch(e) {}
  },
  reset() {
    try { localStorage.removeItem(this._key()); } catch(e) {}
  },
};
