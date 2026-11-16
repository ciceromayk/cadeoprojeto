// Views: geração de HTML das telas
import { escapeHtml } from './helpers.js';
import { State } from './state.js';

// ---------- VIEWS (apenas geração de HTML) ----------
export const Views = {
  current() { return State.projects.find(p => p.id === State.currentProjectId); },

  emptyProject() {
    const isFirstUse = State.projects.length === 0;
    if (isFirstUse) {
      const userName = State.profile?.full_name?.split(' ')[0] || 'engenheiro';
      return `
        <div style="max-width:680px;margin:60px auto;padding:0 20px;">
          <div class="page-eyebrow" style="text-align:center;">BEM-VINDO AO CADÊOPROJETO</div>
          <h1 style="font-size:32px;font-weight:800;text-align:center;margin:8px 0 4px;">Olá, ${escapeHtml(userName)}!</h1>
          <div style="text-align:center;color:var(--ink-soft);font-size:14px;margin-bottom:36px;">
            Vamos começar criando seu primeiro projeto de engenharia.
          </div>

          <div style="max-width:340px;margin:0 auto;">
            <div class="panel" style="cursor:pointer;transition:all 0.15s;border-color:var(--accent);" data-action="new-project">
              <div class="panel-body" style="text-align:center;padding:32px 20px;">
                <div style="width:56px;height:56px;background:var(--accent);border-radius:4px;display:flex;align-items:center;justify-content:center;margin:0 auto 16px;">
                  <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="var(--bg-deep)" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                </div>
                <div style="font-size:18px;font-weight:700;margin-bottom:6px;">Criar Minha Primeira Obra</div>
                <div style="font-size:13px;color:var(--ink-soft);">Configure o nome, datas e comece a cadastrar suas tarefas e entregáveis.</div>
              </div>
            </div>
            <div style="text-align:center;margin-top:14px;">
              <button class="btn btn-ghost" data-action="create-demo"
                style="font-size:11px;color:var(--ink-mute);padding:4px 12px;">
                ou carregar projeto de demonstração →
              </button>
            </div>
          </div>

          <div style="margin-top:36px;padding:20px;background:var(--bg-panel);border:1px solid var(--border);border-radius:3px;">
            <div style="font-family:var(--font-mono);font-size:10px;color:var(--ink-mute);text-transform:uppercase;letter-spacing:0.12em;margin-bottom:10px;">O que tem dentro</div>
            <div style="display:grid;grid-template-columns:repeat(2,1fr);gap:10px 24px;font-size:13px;color:var(--ink-soft);">
              <div>📐 Disciplinas técnicas (NBR 13531/13532)</div>
              <div>📋 Cronograma Gantt com caminho crítico</div>
              <div>🔗 Predecessoras (TI/II/TT/IT) com defasagem</div>
              <div>🎯 Restrições de agendamento (MS Project)</div>
              <div>👥 Matriz RACI por tarefa</div>
              <div>📌 Linha de base (baseline)</div>
              <div>📊 Marcos (milestones)</div>
              <div>🔁 Import/Export MS Project XML</div>
            </div>
          </div>
        </div>
      `;
    }
    // Caso não seja primeiro uso (ex: deletou todos os projetos)
    return `
      <div class="empty-state" style="margin-top:80px;">
        <div class="empty-state-icon"><svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg></div>
        <div class="empty-state-title">Sem projetos ativos</div>
        <div class="empty-state-sub">Crie um novo projeto para começar.</div>
        <button class="btn btn-cta" data-action="new-project">+ Novo Projeto</button>
      </div>
    `;
  },

};
