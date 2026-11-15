// Edição rápida na tabela (status/prioridade/progresso)
import { colorFromString, escapeHtml, initials } from './helpers.js';
import { toast } from './feedback.js';
import { State, validateTaskStatusChange } from './state.js';
import { DB } from './db.js';
import { Automation } from './automation.js';
import { UI } from './ui.js';

// ============================================================================
// INLINE EDIT PICKER — edição rápida de status/prioridade/progresso na tabela
// ============================================================================
const _closeInlinePick = () => document.getElementById('_inlinePickOverlay')?.remove();

const _openInlinePick = (e, taskId, field) => {
  e.stopPropagation();
  _closeInlinePick();

  const task = State.tasks.find(t => t.id === taskId);
  if (!task) return;

  const td = e.currentTarget;
  const rect = td.getBoundingClientRect();

  // ── Campo progresso: input numérico inline ─────────────────────────────────
  if (field === 'progress') {
    const inp = document.createElement('input');
    inp.type = 'number'; inp.min = 0; inp.max = 100; inp.step = 5;
    inp.value = (parseFloat(task.progress) || 0).toFixed(0);
    inp.className = 'inline-edit-num';
    inp.style.left = rect.left + 'px';
    inp.style.top  = (rect.top + 1) + 'px';
    document.body.appendChild(inp);
    inp.focus(); inp.select();
    const save = async () => {
      const v = Math.min(100, Math.max(0, parseInt(inp.value) || 0));
      inp.remove();
      const patch = { progress: v };
      if (v >= 100) patch.status = 'concluido';
      if (v > 0 && v < 100 && task.status === 'a_fazer') patch.status = 'em_andamento';
      // Não permite que o progresso desbloqueie uma tarefa com restrição em aberto
      if (patch.status && task.status === 'bloqueada' && !validateTaskStatusChange(task, patch.status).ok) {
        delete patch.status;
      }
      const _beforeInline = { ...task };
      await DB.updateTask(taskId, patch);
      await Automation.applyOnTaskUpdate(taskId, patch, _beforeInline);
      await DB.loadProjectData(task.project_id);
      if (State.currentProject === task.project_id) UI.render();
    };
    inp.addEventListener('blur', save);
    inp.addEventListener('keydown', ev => { if (ev.key === 'Enter') { ev.preventDefault(); save(); } if (ev.key === 'Escape') inp.remove(); });
    return;
  }

  // ── Campo assignee: picker de membro ────────────────────────────────────
  if (field === 'assignee') {
    const members = State.members;
    const overlay = document.createElement('div');
    overlay.id = '_inlinePickOverlay'; overlay.className = 'inline-pick-overlay';
    const menu = document.createElement('div');
    menu.className = 'inline-pick-menu';
    menu.style.left = rect.left + 'px'; menu.style.top = (rect.bottom + 4) + 'px';
    const addOpt = (value, label, avatar) => {
      const item = document.createElement('div');
      item.className = 'inline-pick-option' + ((task.assignee_id || '') === value ? ' active' : '');
      item.innerHTML = avatar
        ? `<span style="width:18px;height:18px;border-radius:50%;background:${colorFromString(label)};color:#fff;display:inline-flex;align-items:center;justify-content:center;font-size:8px;font-weight:700;flex-shrink:0;">${initials(label)}</span>${escapeHtml(label)}`
        : `<span style="width:18px;height:18px;flex-shrink:0;display:inline-block;"></span><span style="color:var(--ink-mute);">Sem responsável</span>`;
      item.onclick = async () => {
        overlay.remove();
        const newVal = value || null;
        if (newVal === (task.assignee_id || null)) return;
        const patch = { assignee_id: newVal };
        Object.assign(task, patch);
        await DB.updateTask(taskId, patch);
        UI.render();
      };
      menu.appendChild(item);
    };
    addOpt('', '', false);
    members.forEach(m => addOpt(m.id, m.name, true));
    overlay.onclick = e2 => { if (!menu.contains(e2.target)) overlay.remove(); };
    overlay.appendChild(menu); document.body.appendChild(overlay);
    requestAnimationFrame(() => { const r2 = menu.getBoundingClientRect(); if (r2.bottom > window.innerHeight - 8) menu.style.top = (rect.top - r2.height - 4) + 'px'; });
    return;
  }

  // ── Campo sector: picker de setores ─────────────────────────────────────
  if (field === 'sector') {
    const sectorNames = [...new Set((State.sectors || []).map(s => s.name).concat(State.tasks.map(t => t.sector).filter(Boolean)))].sort((a, b) => a.localeCompare(b));
    const overlay = document.createElement('div');
    overlay.id = '_inlinePickOverlay'; overlay.className = 'inline-pick-overlay';
    const menu = document.createElement('div');
    menu.className = 'inline-pick-menu';
    menu.style.left = rect.left + 'px'; menu.style.top = (rect.bottom + 4) + 'px';
    const addSec = (val, label) => {
      const item = document.createElement('div');
      item.className = 'inline-pick-option' + ((task.sector || '') === val ? ' active' : '');
      item.innerHTML = `<span style="width:8px;height:8px;border-radius:50%;background:var(--border-strong);flex-shrink:0;display:inline-block;"></span>${escapeHtml(label)}`;
      item.onclick = async () => {
        overlay.remove();
        const newVal = val || null;
        if (newVal === (task.sector || null)) return;
        const patch = { sector: newVal };
        Object.assign(task, patch);
        await DB.updateTask(taskId, patch);
        UI.render();
      };
      menu.appendChild(item);
    };
    addSec('', '— Sem setor');
    sectorNames.forEach(n => addSec(n, n));
    overlay.onclick = e2 => { if (!menu.contains(e2.target)) overlay.remove(); };
    overlay.appendChild(menu); document.body.appendChild(overlay);
    requestAnimationFrame(() => { const r2 = menu.getBoundingClientRect(); if (r2.bottom > window.innerHeight - 8) menu.style.top = (rect.top - r2.height - 4) + 'px'; });
    return;
  }

  // ── Opções para status / prioridade ───────────────────────────────────────
  const optMap = {
    status: [
      { value: 'a_fazer',      label: 'A Fazer',       color: 'var(--ink-mute)' },
      { value: 'em_andamento', label: 'Em Andamento',  color: 'var(--accent)' },
      { value: 'bloqueada',    label: 'Bloqueada',     color: 'var(--accent-danger)' },
      { value: 'concluido',    label: 'Concluída',     color: 'var(--accent-success)' },
    ],
    priority: [
      { value: 'alta',    label: 'Alta',    color: 'var(--accent-danger)' },
      { value: 'media',   label: 'Média',   color: 'var(--accent-warm)' },
      { value: 'baixa',   label: 'Baixa',   color: 'var(--accent-success)' },
      { value: 'critica', label: 'Crítica', color: '#a4161a' },
    ],
  };
  const options = optMap[field];
  if (!options) return;

  // Posiciona abaixo da célula (flip se sair da tela)
  const menuTop = rect.bottom + 4;
  const overlay = document.createElement('div');
  overlay.id = '_inlinePickOverlay';
  overlay.className = 'inline-pick-overlay';

  const menu = document.createElement('div');
  menu.className = 'inline-pick-menu';
  menu.style.left = rect.left + 'px';
  menu.style.top  = menuTop + 'px';

  options.forEach(opt => {
    const item = document.createElement('div');
    item.className = 'inline-pick-option' + (task[field] === opt.value ? ' active' : '');
    item.innerHTML = `<span style="width:8px;height:8px;border-radius:50%;background:${opt.color};flex-shrink:0;display:inline-block;"></span>${opt.label}`;
    item.onclick = async () => {
      overlay.remove();
      if (opt.value === task[field]) return;
      if (field === 'status') {
        const v = validateTaskStatusChange(task, opt.value);
        if (!v.ok) { toast(v.message, 'error'); return; }
      }
      const patch = { [field]: opt.value };
      if (field === 'status' && opt.value === 'concluido') patch.progress = 100;
      const _beforeStatus = { ...task };
      await DB.updateTask(taskId, patch);
      await Automation.applyOnTaskUpdate(taskId, patch, _beforeStatus);
      await DB.loadProjectData(task.project_id);
      if (State.currentProject === task.project_id) UI.render();
      UI.showToast(`${field === 'status' ? 'Status' : 'Prioridade'} atualizado`, 'success');
    };
    menu.appendChild(item);
  });

  overlay.onclick = e2 => { if (!menu.contains(e2.target)) overlay.remove(); };
  overlay.appendChild(menu);
  document.body.appendChild(overlay);

  // Flip vertical se menu sair da viewport
  requestAnimationFrame(() => {
    const mRect = menu.getBoundingClientRect();
    if (mRect.bottom > window.innerHeight - 8) {
      menu.style.top = (rect.top - mRect.height - 4) + 'px';
    }
  });
};
// Escopo global: atributos onclick inline só enxergam window.*
window._openInlinePick = _openInlinePick;
