// Colunas do painel do Gantt
import { State } from './state.js';

// ============================================================================
// GANTT COLUMNS — colunas do painel esquerdo: exibição + largura configuráveis
// ============================================================================
// A largura total do painel é dinâmica (soma das colunas visíveis). Cada coluna
// tem largura própria em px, editável; mostrar/ocultar e redimensionar persiste
// em localStorage por projeto. Config: { visible: [ids], widths: { id: px } }.
export const GanttCols = {
  REGISTRY: [
    { id: 'eap',            label: '#',         def: 36,  min: 28,  core: true },
    { id: 'name',           label: 'Descrição', def: 260, min: 140, core: true },
    { id: 'sector',         label: 'Setor',     def: 110, min: 60 },
    { id: 'duration',       label: 'Dur.',      def: 50,  min: 40 },
    { id: 'baseline_start', label: 'Ini LB',    def: 62,  min: 48 },
    { id: 'baseline_end',   label: 'Ter LB',    def: 62,  min: 48 },
    { id: 'start',          label: 'Início',    def: 70,  min: 54 },
    { id: 'end',            label: 'Término',   def: 70,  min: 54 },
    { id: 'forecast_end',   label: 'Prev. Térm.', def: 78, min: 56 },
    { id: 'progress',       label: '% Concl.',  def: 58,  min: 48 },
    { id: 'planned_progress', label: '% Prev.', def: 58,  min: 48 },
    { id: 'predecessors',   label: 'Preds.',    def: 68,  min: 48 },
    { id: 'delay',          label: 'Atraso',    def: 54,  min: 44 },
    { id: 'delay_lb',       label: 'Atraso LB', def: 64,  min: 48 },
    { id: 'situacao',       label: 'Situação',  def: 92,  min: 72 },
  ],
  _key() { return `gantt_cols_${State.currentProjectId || 'global'}`; },
  _order() { return this.REGISTRY.map(c => c.id); },
  _load() {
    let cfg = {};
    try { const raw = localStorage.getItem(this._key()); if (raw) cfg = JSON.parse(raw) || {}; } catch (e) {}
    if (Array.isArray(cfg)) cfg = { visible: cfg, widths: {} }; // compat com formato antigo
    if (!cfg || typeof cfg !== 'object') cfg = {};
    if (!Array.isArray(cfg.visible)) cfg.visible = this.REGISTRY.map(c => c.id);
    if (!cfg.widths || typeof cfg.widths !== 'object') cfg.widths = {};
    // Migração: adiciona a coluna "Prev. Térm." uma única vez para quem já tinha config salva
    // (flag _fc garante que, se o usuário ocultar depois, não seja re-adicionada)
    if (!cfg._fc && !cfg.visible.includes('forecast_end')) {
      cfg.visible.push('forecast_end');
      cfg._fc = 1;
      this._save(cfg);
    } else if (!cfg._fc) {
      cfg._fc = 1;
      this._save(cfg);
    }
    // Migração: adiciona a coluna "Atraso LB" uma única vez (flag _alb)
    if (!cfg._alb) {
      if (!cfg.visible.includes('delay_lb')) cfg.visible.push('delay_lb');
      cfg._alb = 1;
      this._save(cfg);
    }
    // Migração: adiciona a coluna "Situação" uma única vez (flag _sit)
    if (!cfg._sit) {
      if (!cfg.visible.includes('situacao')) cfg.visible.push('situacao');
      cfg._sit = 1;
      this._save(cfg);
    }
    // Migração: adiciona a coluna "% Prev." uma única vez (flag _pp)
    if (!cfg._pp) {
      if (!cfg.visible.includes('planned_progress')) cfg.visible.push('planned_progress');
      cfg._pp = 1;
      this._save(cfg);
    }
    // Limpeza: remove colunas de datas reais (funcionalidade descontinuada)
    if (cfg.visible.includes('actual_start') || cfg.visible.includes('actual_end')) {
      cfg.visible = cfg.visible.filter(cid => cid !== 'actual_start' && cid !== 'actual_end');
      this._save(cfg);
    }
    return cfg;
  },
  _save(cfg) { try { localStorage.setItem(this._key(), JSON.stringify(cfg)); } catch (e) {} },
  getVisible() {
    const cfg = this._load();
    const valid = new Set(this._order());
    let vis = cfg.visible.filter(id => valid.has(id));
    this.REGISTRY.filter(c => c.core).forEach(c => { if (!vis.includes(c.id)) vis.push(c.id); });
    // Ordem: usa cfg.order (reordenação manual por arrastar) quando existir; senão a do REGISTRY.
    const custom = Array.isArray(cfg.order) ? cfg.order.filter(id => valid.has(id)) : [];
    const ord = this._order();
    const rank = (id) => { const ci = custom.indexOf(id); return ci >= 0 ? ci : custom.length + ord.indexOf(id); };
    vis.sort((a, b) => rank(a) - rank(b));
    // "#" e "Descrição" ficam sempre fixas, nessa ordem, à esquerda.
    vis = ['eap', 'name', ...vis.filter(id => id !== 'eap' && id !== 'name')];
    return vis;
  },
  // Reordena uma coluna para a posição de outra (arrastar cabeçalho). Âncoras (#, Descrição) fixas.
  reorder(draggedId, targetId) {
    if (!draggedId || !targetId || draggedId === targetId) return;
    if (['eap', 'name'].includes(draggedId) || ['eap', 'name'].includes(targetId)) return;
    const cfg = this._load();
    let order = (Array.isArray(cfg.order) && cfg.order.length ? cfg.order : this.getVisible()).slice();
    this.getVisible().forEach(id => { if (!order.includes(id)) order.push(id); });
    order = order.filter(id => id !== draggedId);
    const ti = order.indexOf(targetId);
    if (ti < 0) return;
    order.splice(ti, 0, draggedId); // insere ANTES do alvo
    cfg.order = order;
    this._save(cfg);
  },
  widthOf(id) {
    const c = this.REGISTRY.find(x => x.id === id);
    if (!c) return 60;
    const n = parseInt(this._load().widths[id]);
    return (!isNaN(n) && n >= (c.min || 28)) ? n : c.def;
  },
  cols() { return this.getVisible().map(id => this.REGISTRY.find(c => c.id === id)).filter(Boolean); },
  isVisible(id) { return this.getVisible().includes(id); },
  toggle(id) {
    const c = this.REGISTRY.find(x => x.id === id);
    if (!c || c.core) return;
    const cfg = this._load();
    const vis = this.getVisible();
    cfg.visible = vis.includes(id) ? vis.filter(x => x !== id) : [...vis, id];
    this._save(cfg);
  },
  setWidth(id, px) {
    const c = this.REGISTRY.find(x => x.id === id);
    if (!c) return;
    const cfg = this._load();
    cfg.widths[id] = Math.max(c.min || 28, Math.round(px));
    this._save(cfg);
  },
  gridTemplate() { return this.cols().map(c => this.widthOf(c.id) + 'px').join(' '); },
  leftWidth() { return this.cols().reduce((s, c) => s + this.widthOf(c.id), 0); },
  reset() { try { localStorage.removeItem(this._key()); } catch (e) {} },
};
