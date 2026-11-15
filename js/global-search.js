// Busca global
import { $, colorFromString, escapeHtml, initials, parentTag } from './helpers.js';
import { State } from './state.js';
import { UI } from './ui.js';

// ---------- GLOBAL SEARCH ----------
export const GlobalSearch = {
  open() {
    $('#searchOverlay').classList.add('active');
    const inp = $('#searchInput');
    inp.value = '';
    inp.focus();
    this.render('');
  },
  close() {
    $('#searchOverlay').classList.remove('active');
  },
  render(q) {
    const results = $('#searchResults');
    if (!q.trim()) {
      results.innerHTML = '<div style="padding:28px;text-align:center;color:var(--ink-mute);font-family:var(--font-mono);font-size:11px;">Digite para buscar tarefas, projetos e membros</div>';
      return;
    }
    const low = q.toLowerCase();
    const allTasks = State.allTasks.length > 0 ? State.allTasks : State.tasks;
    const tasks = allTasks
      .filter(t => t.title.toLowerCase().includes(low) || (t.code||'').toLowerCase().includes(low))
      .slice(0, 6);
    const projects = State.projects
      .filter(p => p.name.toLowerCase().includes(low) || (p.client||'').toLowerCase().includes(low))
      .slice(0, 4);
    const members = State.teamMembers
      .filter(m => m.name.toLowerCase().includes(low) || (m.email||'').toLowerCase().includes(low))
      .slice(0, 4);

    let html = '';
    if (tasks.length > 0) {
      html += `<div class="search-section-title">Tarefas</div>`;
      html += tasks.map(t => {
        const proj = State.projects.find(p => p.id === t.project_id);
        const statusColors = { a_fazer:'var(--ink-mute)', bloqueada:'var(--accent-danger)', em_andamento:'var(--accent)', concluido:'var(--accent-success)' };
        return `<div class="search-item" data-search-action="goto-task" data-task-id="${t.id}" data-project-id="${t.project_id}">
          <div class="search-item-icon" style="background:var(--bg-elevated);color:${statusColors[t.status]||'var(--ink-mute)'};">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>
          </div>
          <div style="min-width:0;flex:1;">
            <div class="search-item-name">${escapeHtml(t.title)}</div>
            <div class="search-item-meta">${escapeHtml(t.code||'')}${proj ? ' · ' + escapeHtml(proj.name) : ''}${parentTag(t, null, 'inline')}</div>
          </div>
        </div>`;
      }).join('');
    }
    if (projects.length > 0) {
      html += `<div class="search-section-title">Projetos</div>`;
      html += projects.map(p => `<div class="search-item" data-search-action="goto-project" data-project-id="${p.id}">
        <div class="search-item-icon" style="background:${colorFromString(p.name)}22;color:${colorFromString(p.name)};">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>
        </div>
        <div style="min-width:0;flex:1;">
          <div class="search-item-name">${escapeHtml(p.name)}</div>
          <div class="search-item-meta">${escapeHtml(p.client||'Sem cliente')}</div>
        </div>
      </div>`).join('');
    }
    if (members.length > 0) {
      html += `<div class="search-section-title">Membros da Equipe</div>`;
      html += members.map(m => `<div class="search-item" data-search-action="goto-member">
        <div class="search-item-icon" style="background:${colorFromString(m.name)};color:#fff;font-weight:700;font-size:12px;">${initials(m.name)}</div>
        <div style="min-width:0;flex:1;">
          <div class="search-item-name">${escapeHtml(m.name)}</div>
          <div class="search-item-meta">${escapeHtml(m.role_title||m.email||'')}</div>
        </div>
      </div>`).join('');
    }
    if (!html) {
      html = '<div style="padding:28px;text-align:center;color:var(--ink-mute);font-family:var(--font-mono);font-size:11px;">Nenhum resultado encontrado</div>';
    }
    results.innerHTML = html;
    results.querySelectorAll('.search-item').forEach(item => {
      item.addEventListener('click', () => {
        const action = item.dataset.searchAction;
        GlobalSearch.close();
        if (action === 'goto-task') {
          const taskId = item.dataset.taskId;
          const projectId = item.dataset.projectId;
          (async () => {
            if (projectId && projectId !== State.currentProjectId) await UI.switchProject(projectId);
            State.currentView = 'tasks'; UI.setActiveNav('tasks');
            await UI.render();
            UI.openTaskModal(taskId);
          })();
        } else if (action === 'goto-project') {
          const projectId = item.dataset.projectId;
          (async () => {
            await UI.switchProject(projectId);
            State.currentView = 'dashboard'; UI.setActiveNav('dashboard');
            await UI.render();
          })();
        } else if (action === 'goto-member') {
          State.currentView = 'team'; UI.setActiveNav('team');
          UI.render();
        }
      });
    });
  }
};
