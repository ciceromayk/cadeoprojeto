// Utilitários: datas, dias úteis, feriados, progresso, formatação, escapeHtml
import { CPMCache } from './cpm.js';
import { State } from './state.js';

/* =============================================
   CADÊOPROJETO v3 — Supabase Backend
   ============================================= */

// ---------- HELPERS ----------
export const $ = sel => document.querySelector(sel);
export const $$ = sel => document.querySelectorAll(sel);
export const fmtDate = d => d ? new Date(d).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' }) : '—';
// Parser timezone-safe: trata "YYYY-MM-DD" como data CALENDÁRIO (sem fuso).
// new Date("YYYY-MM-DD") interpreta como UTC midnight, daí .getDate() local
// pode voltar 1 dia (depende do fuso). Resolve isso lendo as partes da string.
export const _parseYMD = (d) => {
  if (!d) return null;
  // se já é Date, devolve cópia
  if (d instanceof Date) return new Date(d.getTime());
  const s = String(d);
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return new Date(+m[1], +m[2] - 1, +m[3]); // local, no shift
  return new Date(s); // fallback (datetimes com fuso explícito)
};
export const fmtDateFull = d => {
  const x = _parseYMD(d);
  return x ? x.toLocaleDateString('pt-BR') : '—';
};
// dd/mm/aa para Gantt
export const fmtDateShort = d => {
  const x = _parseYMD(d);
  if (!x) return '—';
  const dd = String(x.getDate()).padStart(2, '0');
  const mm = String(x.getMonth() + 1).padStart(2, '0');
  const yy = String(x.getFullYear()).slice(-2);
  return `${dd}/${mm}/${yy}`;
};
export const daysBetween = (a, b) => Math.round((new Date(b) - new Date(a)) / (1000 * 60 * 60 * 24));
// Moeda BRL: completa (R$ 1.234,56) e compacta para eixos (R$ 1,2 mi)
export const fmtBRL = v => (Number(v) || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
export const fmtBRLk = v => {
  v = Number(v) || 0;
  if (Math.abs(v) >= 1e6) return 'R$ ' + (v / 1e6).toLocaleString('pt-BR', { maximumFractionDigits: 1 }) + ' mi';
  if (Math.abs(v) >= 1e3) return 'R$ ' + (v / 1e3).toLocaleString('pt-BR', { maximumFractionDigits: 0 }) + ' mil';
  return 'R$ ' + v.toLocaleString('pt-BR', { maximumFractionDigits: 0 });
};
export const relativeDate = (d, status) => {
  if (!d) return { text: '—', color: 'var(--ink-mute)' };
  if (status === 'concluido') return { text: fmtDateShort(d), color: 'var(--ink-mute)' };
  const diff = daysBetween(today(), d);
  if (diff < -1) return { text: `${Math.abs(diff)}d atrás`, color: 'var(--accent-danger)' };
  if (diff === -1) return { text: 'Ontem', color: 'var(--accent-warm)' };
  if (diff === 0)  return { text: 'Hoje',  color: 'var(--accent-warm)' };
  if (diff === 1)  return { text: 'Amanhã', color: 'var(--ink-soft)' };
  if (diff <= 7)   return { text: `em ${diff}d`, color: 'var(--ink-soft)' };
  return { text: fmtDateShort(d), color: 'var(--ink-mute)' };
};
export const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x.toISOString().slice(0, 10); };
export const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
// Tipos de dependência: código interno (FS/SS/FF/SF — mantido no banco, no motor e no
// import/export do MS Project) ⇄ rótulo em PORTUGUÊS exibido e digitado (TI/II/TT/IT).
export const DEP_TYPE_PT = { FS: 'TI', SS: 'II', FF: 'TT', SF: 'IT' };
export const DEP_TYPE_FROM_PT = { TI: 'FS', II: 'SS', TT: 'FF', IT: 'SF' };
// ── Feriados e folgas (localStorage) ──────────────────────────────────────────
export const Holidays = {
  _key: 'projetudo_holidays',
  _cache: null,    // array de feriados (lazy) — cada item: { date, end?, name }
  _set: null,      // Set de TODAS as datas (períodos expandidos) p/ lookup O(1)
  // Expande cada feriado/folga no intervalo [date, end] (end opcional = só 1 dia).
  _rebuildSet() {
    this._set = new Set();
    for (const h of (this._cache || [])) {
      if (!h || !h.date) continue;
      const end = (h.end && h.end >= h.date) ? h.end : h.date;
      let cur = h.date, guard = 0;
      while (cur <= end && guard++ < 1100) { this._set.add(cur); cur = addDays(cur, 1); }
    }
  },
  _read() {
    if (this._cache) return this._cache;
    try { this._cache = JSON.parse(localStorage.getItem(this._key) || '[]'); }
    catch { this._cache = []; }
    this._rebuildSet();
    return this._cache;
  },
  load() { return this._read(); },
  save(list) {
    localStorage.setItem(this._key, JSON.stringify(list));
    this._cache = list; this._rebuildSet(); // mantém o cache/Set em sincronia
    _wdBetweenCache.clear();
    CPMCache.invalidate();
  },
  // Lookup O(1) — chamado milhares de vezes por render (workingDaysBetween dia a dia)
  isHoliday(dateStr) { if (!this._set) this._read(); return this._set.has(dateStr); },
  // HTML da lista (reusado pelo painel de Configurações e pelos handlers add/remove)
  listHtml() {
    const list = this.load();
    if (!list.length) return '<div style="padding:14px 16px;font-size:12px;color:var(--ink-mute);text-align:center;">Nenhum feriado cadastrado</div>';
    return list.slice().sort((a, b) => a.date > b.date ? 1 : -1).map(h => {
      const hasRange = h.end && h.end > h.date;
      const lbl = hasRange
        ? `${h.date.split('-').reverse().join('/')} → ${h.end.split('-').reverse().join('/')}`
        : h.date.split('-').reverse().join('/');
      return `<div style="display:flex;align-items:center;gap:10px;padding:8px 12px;border-bottom:1px solid var(--border);">
          <span style="font-family:var(--font-mono);font-size:11px;color:var(--accent);flex-shrink:0;">${lbl}</span>
          <span style="flex:1;font-size:12px;">${escapeHtml(h.name || '')}</span>
          <button class="btn" data-action="remove-holiday" data-id="${h.date}"
            style="font-size:10px;padding:2px 8px;color:var(--accent-danger);border-color:var(--accent-danger);background:transparent;">✕</button>
        </div>`;
    }).join('');
  },
};
export const isWorkingDay = (dateStr) => {
  const d = new Date(dateStr + 'T00:00:00');
  const dow = d.getDay();
  if (dow === 0 || dow === 6) return false;
  return !Holidays.isHoliday(dateStr);
};
// Memoiza por par (a,b) — limpo no início de cada render do Gantt (gantt()).
// Evita recomputar a mesma faixa de datas 3× por render em projetos grandes.
export const _wdBetweenCache = new Map();
export const workingDaysBetween = (a, b) => {
  if (!a || !b || b < a) return 0;
  const k = a + '|' + b;
  const cv = _wdBetweenCache.get(k);
  if (cv !== undefined) return cv;
  let count = 0;
  let cur = new Date(a + 'T00:00:00');
  const end = new Date(b + 'T00:00:00');
  while (cur < end) {
    cur.setDate(cur.getDate() + 1);
    if (isWorkingDay(cur.toISOString().slice(0, 10))) count++;
  }
  _wdBetweenCache.set(k, count);
  return count;
};
export const addWorkingDays = (dateStr, n) => {
  let cur = new Date(dateStr + 'T00:00:00');
  let remaining = Math.abs(n);
  const step = n >= 0 ? 1 : -1;
  while (remaining > 0) {
    cur.setDate(cur.getDate() + step);
    if (isWorkingDay(cur.toISOString().slice(0, 10))) remaining--;
  }
  return cur.toISOString().slice(0, 10);
};
// Empurra uma data para o PRÓXIMO dia útil (se já for útil, mantém).
export const nextWorkday = (dateStr) => { if (!dateStr) return dateStr; let d = dateStr, g = 0; while (!isWorkingDay(d) && g++ < 60) d = addDays(d, 1); return d; };
// Ajusta início/término de uma tarefa para DIAS ÚTEIS, preservando a duração em dias úteis:
//   início → próximo dia útil; término = início + (duração útil) → sempre cai em dia útil.
// Idempotente: datas já em dias úteis voltam iguais.
export const snapTaskDates = (start, end) => {
  if (!start || !end) return { start, end };
  const s = nextWorkday(start);
  const e = addWorkingDays(s, workingDaysBetween(start, end));
  return { start: s, end: e };
};
// Previsão de término — SIMPLES e por tarefa (dias úteis):
//   • Trabalho restante = duração planejada × (1 − %concluído).
//   • Conta a partir de HOJE (ou do início planejado, se ainda não chegou),
//     assumindo o ritmo planejado daqui pra frente. Nunca termina no passado.
//   • Tarefa-pai = MÁX da previsão das filhas.
// NÃO recursa pelas predecessoras (isso era o que compunha atrasos até virar
// datas absurdas tipo 2038). A propagação por dependências é responsabilidade
// do recálculo de cronograma (autoSchedule), não da previsão.
// Retorna null quando: concluída, marco, inativa, sem datas, ou ainda não
// começou e sem progresso (sem desvio a prever).
//
// `_chain`/`_todayStr`/`_state` mantidos por compatibilidade de assinatura;
// `_todayStr` permite teste determinístico e `_state` injeta { tasks } nos testes.
export const forecastEndDate = (task, _cache, _todayStr, _state) => {
  if (!task || task.is_milestone || task.inactive) return null;
  const cache = _cache instanceof Map ? _cache : null;
  if (cache && cache.has(task.id)) return cache.get(task.id);
  const _set = (v) => { if (cache) cache.set(task.id, v); return v; };
  const p = parseFloat(task.progress) || 0;
  if (task.status === 'concluido' || p >= 100) return _set(null);
  const t = _todayStr || today();
  const _s = _state || (typeof State !== 'undefined' ? State : null);
  // Tarefa-PAI: MÁX da previsão das filhas. Mapa de filhos construído uma vez
  // por instância de cache (cache.__km__) — O(n) amortizado, não O(n²) por pai.
  let kids = [];
  if (_s && _s.tasks) {
    if (cache && !cache.has('__km__')) {
      const km = new Map();
      for (const x of _s.tasks) {
        if (x.parent_id && !x.inactive) {
          let arr = km.get(x.parent_id);
          if (!arr) { arr = []; km.set(x.parent_id, arr); }
          arr.push(x);
        }
      }
      cache.set('__km__', km);
    }
    kids = (cache ? cache.get('__km__') : null)?.get(task.id) || [];
  }
  if (kids.length) {
    let maxFc = null;
    kids.forEach(k => {
      const eff = forecastEndDate(k, cache, t, _s) || k.end_date || null;
      if (eff && (!maxFc || eff > maxFc)) maxFc = eff;
    });
    return _set(maxFc);
  }
  if (!task.start_date || !task.end_date) return _set(null);
  // Ainda não começou e sem progresso → no plano, sem desvio a prever
  if (p <= 0 && task.start_date > t) return _set(null);
  // Duração planejada (dias úteis) e trabalho restante pelo ritmo planejado
  const plannedWd  = Math.max(1, workingDaysBetween(task.start_date, task.end_date));
  const remainingWd = Math.max(0, Math.ceil(plannedWd * (1 - p / 100)));
  // Começa de hoje (ou do início planejado, se ele ainda está no futuro)
  const startFrom = task.start_date > t ? task.start_date : t;
  return _set(addWorkingDays(startFrom, remainingWd));
};
// ── SITUAÇÃO DA TAREFA (selo do Gantt) — sempre vs LINHA DE BASE ──────────────
// Retorna 'concluida' | 'futura' | 'atrasada' | 'no_prazo'. A referência de início/
// término é a LINHA DE BASE (baseline_start/baseline_end); se a tarefa não tem LB,
// cai nas datas planejadas atuais. "Atrasada" = devia ter começado (pela LB) e está
// 0%, OU término da LB venceu sem 100%, OU a previsão de término passa do término da LB.
export const taskSituacao = (task, _fcCache, _todayStr, _basis) => {
  const t = _todayStr || today();
  const prog = parseFloat(task.progress) || 0;
  if (prog >= 100 || task.status === 'concluido') return 'concluida';
  // Base do comparativo: 'planned' usa as datas planejadas atuais; 'baseline' (padrão)
  // usa a linha de base vigente (com fallback p/ planejado quando a tarefa não tem LB).
  const usePlanned = _basis === 'planned';
  const refStart = usePlanned ? task.start_date : (task.baseline_start || task.start_date);
  const refEnd   = usePlanned ? task.end_date   : (task.baseline_end   || task.end_date);
  if (prog <= 0 && refStart && refStart > t) return 'futura';
  const lateStart = prog <= 0 && refStart && refStart <= t;     // devia ter iniciado (pela LB)
  const overdue   = refEnd && refEnd < t;                       // término da LB venceu e não está 100%
  const _fc       = forecastEndDate(task, _fcCache, _todayStr);
  const fcLate    = _fc && refEnd && _fc > refEnd;              // previsão passa do término da LB
  return (lateStart || overdue || fcLate) ? 'atrasada' : 'no_prazo';
};
// ── % PREVISTO (progresso esperado hoje, pela mesma base do selo de situação) ──
// Interpolação linear em DIAS ÚTEIS entre refStart e refEnd (mesma resolução
// planejado/linha de base do taskSituacao). null = sem data de referência.
export const plannedProgressPct = (task, _basis, _todayStr) => {
  const t = _todayStr || today();
  const usePlanned = _basis === 'planned';
  const refStart = usePlanned ? task.start_date : (task.baseline_start || task.start_date);
  const refEnd   = usePlanned ? task.end_date   : (task.baseline_end   || task.end_date);
  if (!refStart || !refEnd) return null;
  if (t <= refStart) return 0;
  if (t >= refEnd) return 100;
  const totalWd   = Math.max(1, workingDaysBetween(refStart, refEnd));
  const elapsedWd = workingDaysBetween(refStart, t);
  return Math.round(Math.min(100, Math.max(0, elapsedWd / totalWd * 100)));
};
export const SITUACAO_META = {
  concluida: { label: 'Concluída', color: 'var(--accent-success)', bg: 'rgba(46,125,79,0.12)' },
  futura:    { label: 'Futura',    color: 'var(--ink-mute)',       bg: 'var(--bg-deep)' },
  atrasada:  { label: 'Atrasada',  color: 'var(--accent-danger)',  bg: 'rgba(229,75,26,0.12)' },
  no_prazo:  { label: 'No prazo',  color: 'var(--blueprint)',      bg: 'rgba(31,58,138,0.10)' },
};
// Last Planner — utilidades de semana (segunda → domingo)
export const mondayOf = (d) => { const x = new Date((d || today()) + 'T00:00:00'); const wd = (x.getDay() + 6) % 7; x.setDate(x.getDate() - wd); return x.toISOString().slice(0, 10); };
export const addWeeks = (monday, n) => addDays(monday, n * 7);

// ── Filtro por intervalo de datas (término) — compartilhado por Tarefas, Pendências e Relatórios ──
export const DateFilter = {
  // Resolve um preset para { from, to } (datas ISO YYYY-MM-DD)
  resolve(preset) {
    const tn = today();
    const [y, m] = tn.split('-').map(Number);
    const pad = n => String(n).padStart(2, '0');
    if (preset === 'week')    { const from = mondayOf(tn); return { from, to: addDays(from, 6) }; }
    if (preset === 'month')   { const last = new Date(y, m, 0).getDate();      return { from: `${y}-${pad(m)}-01`, to: `${y}-${pad(m)}-${pad(last)}` }; }
    if (preset === 'quarter') { const q = Math.floor((m - 1) / 3); const sm = q * 3 + 1, em = sm + 2; const last = new Date(y, em, 0).getDate(); return { from: `${y}-${pad(sm)}-01`, to: `${y}-${pad(em)}-${pad(last)}` }; }
    return { from: '', to: '' };
  },
  presetLabels: { all: 'Todos', week: 'Esta semana', month: 'Este mês', quarter: 'Este trimestre', custom: 'Personalizado' },
  // Uma data ISO está dentro do intervalo? (intervalo vazio = passa tudo; sem data = fora quando há intervalo)
  match(dateStr, from, to) {
    if (!from && !to) return true;
    if (!dateStr) return false;
    if (from && dateStr < from) return false;
    if (to && dateStr > to) return false;
    return true;
  },
  // Verifica uma TAREFA inteira contra o filtro, respeitando o "mode" do namespace:
  //   'ending'    (padrão) → t.end_date precisa cair dentro do intervalo (comportamento clássico)
  //   'occurring' → o período da tarefa (start_date..end_date) só precisa CRUZAR o intervalo
  //                 (mesmo conceito do "que acontecem na semana" do Last Planner)
  matchTask(task, ns) {
    const df = (State.dateFilters && State.dateFilters[ns]) || {};
    if (!df.from && !df.to) return true;
    if (df.mode === 'occurring') {
      if (!task.start_date || !task.end_date) return false;
      if (df.from && task.end_date < df.from) return false;
      if (df.to && task.start_date > df.to) return false;
      return true;
    }
    return this.match(task.end_date, df.from, df.to);
  },
  // Dropdown "Exibir: que terminam / que acontecem no período" — só para as telas
  // que optarem por usá-lo (não é parte de ui(), que não deve mudar em Tarefas/Relatórios).
  modeUi(ns) {
    const df = (State.dateFilters && State.dateFilters[ns]) || {};
    const mode = df.mode === 'occurring' ? 'occurring' : 'ending';
    return `<select class="form-input" onchange="UI.setDateFilterMode('${ns}', this.value)" style="width:auto;font-size:12px;padding:5px 8px;" title="Como o intervalo de datas filtra as tarefas">
      <option value="ending" ${mode === 'ending' ? 'selected' : ''}>Exibir: que terminam no período</option>
      <option value="occurring" ${mode === 'occurring' ? 'selected' : ''}>Exibir: que acontecem no período</option>
    </select>`;
  },
  // Está com filtro ativo? (preset diferente de 'all' E com alguma data)
  isActive(ns) {
    const df = (State.dateFilters && State.dateFilters[ns]) || {};
    return (df.preset && df.preset !== 'all') && (df.from || df.to);
  },
  // Rótulo curto do filtro ativo (para título/subtítulo). '' se inativo.
  label(ns) {
    if (!this.isActive(ns)) return '';
    const df = State.dateFilters[ns];
    const fmt = s => { if (!s) return '…'; const p = s.split('-'); return `${p[2]}/${p[1]}/${p[0]}`; };
    const range = `${fmt(df.from)} – ${fmt(df.to)}`;
    // Para presets nomeados mostra o nome + o intervalo; para custom só o intervalo
    return (df.preset && df.preset !== 'custom') ? `${this.presetLabels[df.preset]} (${range})` : range;
  },
  // HTML do filtro (preset + intervalo). ns = namespace ('tasks' | 'pend' | 'rel')
  ui(ns) {
    const df = (State.dateFilters && State.dateFilters[ns]) || { from: '', to: '', preset: 'all' };
    const preset = df.preset || 'all';
    const isAll = preset === 'all';
    const inp = `font-size:12px;padding:4px 6px;border:1px solid var(--border-strong);border-radius:3px;background:var(--bg-deep);color:var(--ink);${isAll ? 'opacity:.45;' : ''}`;
    const opt = (v, lbl) => `<option value="${v}"${preset === v ? ' selected' : ''}>${lbl}</option>`;
    return `<div style="display:flex;gap:4px;align-items:center;" title="Filtrar por término (data de término da tarefa)">
      <select class="form-input" onchange="UI.applyDatePreset('${ns}', this.value)" style="width:auto;font-size:12px;padding:5px 8px;">
        ${opt('all', 'Período: Todos')}
        ${opt('week', 'Esta semana')}
        ${opt('month', 'Este mês')}
        ${opt('quarter', 'Este trimestre')}
        ${opt('custom', 'Personalizado')}
      </select>
      <input type="date" value="${df.from || ''}" ${isAll ? 'disabled' : ''} onchange="UI.setDateFilter('${ns}','from',this.value)" style="${inp}" title="Término a partir de">
      <span style="color:var(--ink-mute);font-size:11px;">–</span>
      <input type="date" value="${df.to || ''}" ${isAll ? 'disabled' : ''} onchange="UI.setDateFilter('${ns}','to',this.value)" style="${inp}" title="Término até">
      ${!isAll ? `<button class="btn btn-ghost" onclick="UI.clearDateFilter('${ns}')" style="font-size:11px;padding:4px 7px;color:var(--accent-danger);" title="Limpar filtro de datas">✕</button>` : ''}
    </div>`;
  },
};
export const weekRangeLabel = (monday) => { const f = s => { const p = s.split('-'); return p[2] + '/' + p[1]; }; return f(monday) + '–' + f(addDays(monday, 6)); };
export const initials = name => { if (!name) return '?'; const p = name.trim().split(/\s+/); return (p[0][0] + (p[1] ? p[1][0] : '')).toUpperCase(); };
// Tarefa pai: título da atividade pai de uma tarefa (Map opcional p/ performance). '' se não houver.
export const parentTitleOf = (task, byId) => {
  if (!task || !task.parent_id) return '';
  const p = byId ? byId.get(task.parent_id) : ((typeof State !== 'undefined' && State.tasks) ? State.tasks.find(x => x.id === task.parent_id) : null)
        || ((typeof State !== 'undefined' && State.allTasks) ? State.allTasks.find(x => x.id === task.parent_id) : null);
  return p ? p.title : '';
};
// Etiqueta padronizada "↳ <pai>" (mesmo padrão visual em listas, cards e relatórios).
// variant: 'block' = linha própria · 'inline' = trecho para colar numa meta existente.
export const parentTag = (task, byId, variant = 'block') => {
  const title = parentTitleOf(task, byId);
  if (!title) return '';
  const safe = escapeHtml(title);
  if (variant === 'inline') return ` <span class="parent-tag-inline" title="Atividade pai: ${safe}">↳ ${safe}</span>`;
  return `<div class="parent-tag" title="Atividade pai: ${safe}"><span class="pt-arrow">↳</span><span class="pt-name">${safe}</span></div>`;
};
// ── PESO POR DURAÇÃO ────────────────────────────────────────────────────────
// Peso de uma tarefa = sua duração (a DUR exibida no Gantt). Tarefa sem datas
// pesa o mínimo (1 dia) para nunca zerar o denominador.
const _durWeight = (t) => (t && t.start_date && t.end_date) ? Math.max(1, daysBetween(t.start_date, t.end_date)) : 1;
// Progresso de uma tarefa-pai = média das filhas PONDERADA pela duração de cada uma.
// Ex.: filha de 30d com 67% e três filhas de 59/123/118d com 0% →
//   (67·30 + 0·59 + 0·123 + 0·118) / (30+59+123+118) ≈ 6%.
// Retorna inteiro arredondado (valor gravado em task.progress).
export const rolledProgress = (children) => {
  let acc = 0, tw = 0;
  for (const c of children) { const w = _durWeight(c); tw += w; acc += w * Math.max(0, Math.min(100, parseFloat(c.progress) || 0)); }
  return tw > 0 ? Math.round(acc / tw) : 0;
};
// ── AVANÇO DO PROJETO (método único) ────────────────────────────────────────
// Regra: se existe hierarquia, o andamento do projeto = andamento da(s) tarefa(s)-pai
// RAIZ (nível 1). Uma raiz → o valor dela; várias raízes → a média PONDERADA POR
// DURAÇÃO delas. Sem hierarquia (lista plana), pondera as próprias tarefas (folhas).
// Usado no Gantt, Dashboard, Curva S e relatórios para o número bater em todas as telas.
export const physicalProgress = (taskList) => {
  const all = taskList || ((typeof State !== 'undefined' && State.tasks) ? State.tasks : []);
  const active = all.filter(tk => !tk.inactive);
  if (!active.length) return 0;
  // Raiz = tarefa sem pai ativo dentro do conjunto.
  const roots = active.filter(tk => !tk.parent_id || !active.some(x => x.id === tk.parent_id));
  const base = roots.length ? roots : active;
  let acc = 0, tw = 0;
  for (const c of base) { const w = _durWeight(c); tw += w; acc += w * Math.max(0, Math.min(100, parseFloat(c.progress) || 0)); }
  return tw > 0 ? acc / tw : 0;
};
export const colorFromString = str => {
  // Paleta terrosa coesa com a identidade creme/laranja — todas escuras o suficiente p/ texto branco
  const palette = ['#C13B12','#B07A12','#2E7D4F','#1B5E5E','#A8431E','#6D4C7D','#5A6B3B','#8B5A2B'];
  let hash = 0; for (let i = 0; i < str.length; i++) hash = str.charCodeAt(i) + ((hash << 5) - hash);
  return palette[Math.abs(hash) % palette.length];
};

// Filtro de status MULTI-seleção (chips que ligam/desligam individualmente) — usado
// na Visão Geral e em Pendências. As duas telas já excluem 'concluido' antes deste
// filtro, então só as 3 situações "em aberto" são selecionáveis aqui.
const STATUS_FILTER_DEFS = [
  ['a_fazer', 'A Fazer', 'var(--ink-mute)'],
  ['em_andamento', 'Em Andamento', 'var(--accent)'],
  ['bloqueada', 'Bloqueada', 'var(--accent-danger)'],
];
export function statusFilterChips(selectedSet, attrName) {
  return STATUS_FILTER_DEFS.map(([id, lbl, col]) => {
    const active = selectedSet.has(id);
    return `<button data-${attrName}="${id}" style="display:inline-flex;align-items:center;gap:5px;font-family:var(--font-mono);font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.04em;padding:3px 9px;border-radius:11px;cursor:pointer;border:1px solid ${active ? col : 'var(--border-strong)'};background:${active ? col : 'transparent'};color:${active ? '#fff' : col};">${lbl}</button>`;
  }).join('');
}

export function escapeHtml(str) {
  if (str == null) return '';
  return String(str).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
