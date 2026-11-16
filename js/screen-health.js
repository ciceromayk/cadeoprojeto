// Tela Saúde do projeto
import { HealthCheck } from './health.js';
import { escapeHtml } from './helpers.js';
import { Views } from './views.js';

// Plugado em Views: continuam acessíveis como Views.<método> e this.<método>.
Object.assign(Views, {
  // ===== VIEW SAÚDE DO PROJETO =====
  health() {
    if (!Views.current()) return Views.emptyProject();
    const h = HealthCheck.run();
    const color = HealthCheck.scoreColor(h.score);
    const label = HealthCheck.scoreLabel(h.score);

    // Agrupa por severidade
    const groups = {
      error: h.issues.filter(i => i.severity === 'error'),
      warn:  h.issues.filter(i => i.severity === 'warn'),
      info:  h.issues.filter(i => i.severity === 'info'),
    };
    const sevMeta = {
      error: { lbl: 'Erros',  c: 'var(--accent-danger)', desc: 'Violações de integridade — corrija o quanto antes' },
      warn:  { lbl: 'Avisos', c: 'var(--accent-warm)',   desc: 'Riscos operacionais que afetam a gestão' },
      info:  { lbl: 'Sugestões', c: 'var(--blueprint)',  desc: 'Boas práticas e oportunidades de melhoria' },
    };
    const icon = (sev) => sev === 'error' ? '🔴' : sev === 'warn' ? '⚠️' : 'ℹ️';

    const sectionFor = (sev) => {
      const items = groups[sev];
      if (items.length === 0) return '';
      const meta = sevMeta[sev];
      return `
        <div class="panel" style="margin-bottom:14px;">
          <div class="panel-head" style="border-left:3px solid ${meta.c};">
            <div class="panel-title">${meta.lbl}</div>
            <div class="panel-title-mono">${items.length} ${items.length === 1 ? 'item' : 'itens'}</div>
          </div>
          <div class="panel-body" style="padding:0;">
            <div style="padding:10px 16px;font-size:11px;color:var(--ink-mute);border-bottom:1px solid var(--border);">${meta.desc}</div>
            ${items.map(iss => `
              <div class="hc-issue" style="display:flex;align-items:center;gap:12px;padding:11px 16px;border-bottom:1px solid var(--border);font-size:13px;">
                <span style="flex-shrink:0;font-size:14px;">${icon(iss.severity)}</span>
                <span style="flex:1;min-width:0;line-height:1.4;">${escapeHtml(iss.title)}</span>
                <div style="display:flex;gap:6px;flex-shrink:0;">
                  ${iss.taskId ? `<button class="btn btn-ghost" data-action="edit-task" data-id="${iss.taskId}" style="font-size:11px;padding:4px 9px;">Abrir</button>` : ''}
                  ${iss.action ? `<button class="btn btn-secondary" data-hc-action="${iss.id}" style="font-size:11px;padding:4px 9px;">${escapeHtml(iss.action.label)}</button>` : ''}
                </div>
              </div>
            `).join('')}
          </div>
        </div>`;
    };

    return `
      <div class="page-title-block">
        <div class="page-eyebrow">FERRAMENTAS · SAÚDE</div>
        <div class="page-title">Saúde do Projeto</div>
        <div class="page-subtitle">Score automático com base em integridade, consistência e boas práticas. Atualizado a cada interação.</div>
      </div>

      <!-- Score Hero -->
      <div class="panel" style="margin-bottom:14px;">
        <div class="panel-body">
          <div style="display:grid;grid-template-columns:240px 1fr;gap:24px;align-items:center;">
            <div style="text-align:center;">
              <svg viewBox="0 0 140 140" width="200" height="200" style="display:block;margin:0 auto;">
                <circle cx="70" cy="70" r="58" fill="none" stroke="var(--bg-deep)" stroke-width="12"/>
                <circle cx="70" cy="70" r="58" fill="none" stroke="${color}" stroke-width="12"
                  stroke-dasharray="${(h.score / 100 * 364).toFixed(1)} 364"
                  stroke-linecap="round" transform="rotate(-90 70 70)"/>
                <text x="70" y="76" text-anchor="middle" font-size="42" font-weight="800" fill="${color}" font-family="var(--font-display)">${h.score}</text>
                <text x="70" y="96" text-anchor="middle" font-size="10" fill="var(--ink-mute)" font-family="var(--font-mono)" style="text-transform:uppercase;letter-spacing:.12em;">/100</text>
              </svg>
              <div style="font-family:var(--font-mono);font-size:13px;color:${color};font-weight:700;text-transform:uppercase;letter-spacing:.12em;margin-top:8px;">${label}</div>
            </div>
            <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;">
              <div style="padding:14px 16px;background:var(--bg-deep);border-left:3px solid var(--accent-danger);border-radius:0 3px 3px 0;">
                <div style="font-family:var(--font-mono);font-size:10px;color:var(--ink-mute);text-transform:uppercase;letter-spacing:.1em;">Erros</div>
                <div style="font-size:32px;font-weight:800;color:var(--accent-danger);line-height:1.1;">${h.summary.errors}</div>
              </div>
              <div style="padding:14px 16px;background:var(--bg-deep);border-left:3px solid var(--accent-warm);border-radius:0 3px 3px 0;">
                <div style="font-family:var(--font-mono);font-size:10px;color:var(--ink-mute);text-transform:uppercase;letter-spacing:.1em;">Avisos</div>
                <div style="font-size:32px;font-weight:800;color:var(--accent-warm);line-height:1.1;">${h.summary.warnings}</div>
              </div>
              <div style="padding:14px 16px;background:var(--bg-deep);border-left:3px solid var(--blueprint);border-radius:0 3px 3px 0;">
                <div style="font-family:var(--font-mono);font-size:10px;color:var(--ink-mute);text-transform:uppercase;letter-spacing:.1em;">Sugestões</div>
                <div style="font-size:32px;font-weight:800;color:var(--blueprint);line-height:1.1;">${h.summary.infos}</div>
              </div>
            </div>
          </div>
        </div>
      </div>

      ${h.issues.length === 0 ? `
        <div class="empty-state" style="background:var(--bg-panel);border:1px solid var(--border);border-radius:3px;padding:40px 20px;">
          <div style="font-size:38px;margin-bottom:8px;">✨</div>
          <div class="empty-state-title">Projeto saudável!</div>
          <div class="empty-state-sub">Nenhum problema detectado. Continue mantendo as boas práticas.</div>
        </div>
      ` : sectionFor('error') + sectionFor('warn') + sectionFor('info')}
    `;
  },
});
