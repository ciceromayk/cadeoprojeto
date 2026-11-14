// Tour de onboarding

// ===== ONBOARDING TOUR =====
export const Tour = {
  _active: false,
  _step: 0,
  _steps: [
    {
      sel: null, pos: 'center',
      title: '👋 Bem-vindo ao CadêOProjeto!',
      desc: 'Gestão de projetos de engenharia civil — Kanban, Gantt, RACI, Equipes e muito mais. Vamos fazer um tour rápido pelas funcionalidades principais.',
    },
    {
      sel: '#sidebar', pos: 'right',
      title: 'Menu de Navegação',
      desc: 'Acesse Dashboard, Tarefas, Gantt, Equipe, Disciplinas, RACI e outras views pelo menu lateral. Clique em ← para recolher e ganhar espaço.',
    },
    {
      sel: '#btnContextAction', pos: 'bottom',
      title: '⚡ Nova Tarefa',
      desc: 'Nas telas <strong>Tarefas</strong> e <strong>Cronograma</strong>, este botão cria uma tarefa no projeto atual com o formulário completo (pai, predecessoras, datas). Atalho: <strong>Alt+N</strong>. No Gantt você também cria com o botão direito (acima/abaixo/subtarefa).',
    },
    {
      sel: '#btnSearch', pos: 'bottom',
      title: '🔍 Busca Global',
      desc: 'Encontre tarefas, projetos e membros instantaneamente em todos os seus projetos. Atalho: <strong>Ctrl+K</strong>.',
    },
    {
      sel: '.nav-item[data-view="tasks"]', pos: 'right',
      title: '📋 Gestão de Tarefas',
      desc: 'Visualize e gerencie tarefas em modo <strong>Kanban</strong> ou <strong>Lista</strong>. Filtre por status, prioridade, responsável, disciplina e etiquetas.',
    },
    {
      sel: '.nav-item[data-view="gantt"]', pos: 'right',
      title: '📅 Gráfico de Gantt',
      desc: 'Cronograma interativo com linha de base, caminho crítico, dependências entre tarefas (FS/SS/FF/SF) e exportação PNG/CSV.',
    },
    {
      sel: '.nav-item[data-view="raci"]', pos: 'right',
      title: '📊 Matriz RACI',
      desc: 'Defina responsabilidades por entregável: Responsável, Aprovador, Consultado e Informado — para cada membro da equipe.',
    },
    {
      sel: null, pos: 'center',
      title: '✅ Tudo certo!',
      desc: 'Você já conhece o essencial. Explore à vontade. Para rever este tour, clique no botão <strong>?</strong> no topo da tela a qualquer momento.',
    },
  ],

  start(force = false) {
    if (!force && localStorage.getItem('projetudo.tourDone')) return;
    this._step = 0;
    this._active = true;
    this._mount();
    this._render();
  },

  _mount() {
    if (!document.getElementById('tourSpotlight')) {
      const sp = document.createElement('div');
      sp.id = 'tourSpotlight';
      sp.style.display = 'none';
      document.body.appendChild(sp);
    }
    if (!document.getElementById('tourCard')) {
      const card = document.createElement('div');
      card.id = 'tourCard';
      document.body.appendChild(card);
    }
  },

  _unmount() {
    document.getElementById('tourSpotlight')?.remove();
    document.getElementById('tourCard')?.remove();
    this._active = false;
    try { localStorage.setItem('projetudo.tourDone', '1'); } catch(e) {}
  },

  _render() {
    const step  = this._steps[this._step];
    const total = this._steps.length;
    const isFirst = this._step === 0;
    const isLast  = this._step === total - 1;
    const sp   = document.getElementById('tourSpotlight');
    const card = document.getElementById('tourCard');
    if (!sp || !card) return;

    // ── Spotlight ──────────────────────────────────────────────────
    if (step.sel) {
      const el = document.querySelector(step.sel);
      if (el) {
        const r = el.getBoundingClientRect();
        const pad = 8;
        sp.style.cssText = `
          display:block;
          top:${r.top  - pad}px; left:${r.left  - pad}px;
          width:${r.width  + pad * 2}px; height:${r.height + pad * 2}px;
        `;
        this._posCard(card, r, step.pos);
      } else {
        sp.style.display = 'none';
        this._centerCard(card);
      }
    } else {
      // Sem alvo — apenas escurece tudo sem spotlight
      sp.style.cssText = `
        display:block;
        top:50%; left:50%; width:0; height:0;
        border:none; border-radius:0;
        box-shadow:0 0 0 4000px rgba(26,23,20,0.82);
        animation:none;
      `;
      this._centerCard(card);
    }

    // ── Dots ───────────────────────────────────────────────────────
    const dots = this._steps.map((_, i) =>
      `<div class="tour-dot ${i === this._step ? 'active' : ''}"></div>`
    ).join('');

    // ── Card content ───────────────────────────────────────────────
    card.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px;margin-bottom:10px;">
        <span style="font-family:var(--font-mono);font-size:10px;color:var(--ink-mute);text-transform:uppercase;letter-spacing:.12em;padding-top:2px;">${this._step + 1} / ${total}</span>
        <button onclick="Tour.skip()" title="Fechar tour" style="background:none;border:none;cursor:pointer;color:var(--ink-mute);font-size:20px;line-height:1;padding:0;margin:0;flex-shrink:0;">&times;</button>
      </div>
      <div style="font-size:15px;font-weight:700;color:var(--ink);margin-bottom:8px;line-height:1.3;">${step.title}</div>
      <div style="font-size:13px;color:var(--ink-soft);line-height:1.65;">${step.desc}</div>
      <div style="display:flex;align-items:center;justify-content:space-between;margin-top:18px;">
        <div class="tour-dots">${dots}</div>
        <div style="display:flex;gap:8px;">
          ${!isFirst ? `<button class="btn btn-ghost" onclick="Tour.prev()" style="padding:5px 13px;font-size:12px;">← Anterior</button>` : ''}
          ${isLast
            ? `<button class="btn btn-cta" onclick="Tour.skip()" style="padding:5px 16px;font-size:12px;">Concluir ✓</button>`
            : `<button class="btn btn-cta" onclick="Tour.next()" style="padding:5px 16px;font-size:12px;">Próximo →</button>`
          }
        </div>
      </div>
    `;
  },

  _posCard(card, rect, pos) {
    card.className = '';
    const margin = 18, w = 320;
    const vw = window.innerWidth, vh = window.innerHeight;
    let top, left;

    if (pos === 'right') {
      left = Math.min(rect.right + margin + 8, vw - w - margin);
      top  = Math.max(margin, Math.min(rect.top, vh - 260));
    } else if (pos === 'bottom') {
      left = Math.max(margin, Math.min(rect.left, vw - w - margin));
      top  = Math.min(rect.bottom + margin + 8, vh - 260);
    } else if (pos === 'left') {
      left = Math.max(margin, rect.left - w - margin - 8);
      top  = Math.max(margin, Math.min(rect.top, vh - 260));
    } else {
      this._centerCard(card); return;
    }
    card.style.cssText = `top:${top}px; left:${left}px; transform:none;`;
  },

  _centerCard(card) {
    card.className = 'tour-center';
    card.style.cssText = '';
  },

  next() { if (this._step < this._steps.length - 1) { this._step++; this._render(); } },
  prev() { if (this._step > 0) { this._step--; this._render(); } },
  skip() { this._unmount(); },
};
// Escopo global: atributos onclick inline só enxergam window.*
window.Tour = Tour;
