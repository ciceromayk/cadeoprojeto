// Tela Notificações
import { DB } from './db.js';
import { friendlyError, setLoading, toast } from './feedback.js';
import { $, escapeHtml, fmtDateFull } from './helpers.js';
import { renderCommentBody } from './mentions.js';
import { Modal } from './modal.js';
import { State } from './state.js';
import { UI } from './ui.js';
import { Views } from './views.js';

// Plugado em Views: continuam acessíveis como Views.<método> e this.<método>.
Object.assign(Views, {
  notifications() {
    // Marca feed como lido ao abrir a view
    State.realtimeUnread = 0;

    const prefs = State.notifPrefs || {
      email_enabled: true,
      notify_task_due_in_days: 3,
      notify_overdue: true,
      notify_blocked: true,
      notify_constraint_violation: true,
      digest_frequency: 'daily',
    };

    const evFeed = State.realtimeEvents;
    const _ago = (iso) => {
      const d = Date.now() - new Date(iso).getTime();
      const m = Math.floor(d / 60000);
      if (m < 1) return 'agora';
      if (m < 60) return `${m} min atrás`;
      const h = Math.floor(m / 60);
      if (h < 24) return `${h}h atrás`;
      return `${Math.floor(h/24)}d atrás`;
    };

    return `
      <div class="page-title-block">
        <div class="page-eyebrow">NOTIFICAÇÕES</div>
        <div class="page-title">Feed de Atividade</div>
        <div class="page-subtitle">Atualizações em tempo real do projeto e preferências de alerta por e-mail.</div>
      </div>

      <div class="panel" style="margin-bottom:14px;">
        <div class="panel-head" style="display:flex;align-items:center;justify-content:space-between;">
          <div class="panel-title">Atividade Recente</div>
          ${evFeed.length > 0 ? `<button class="btn btn-ghost" style="font-size:11px;padding:3px 8px;" onclick="State.realtimeEvents=[];UI.render();">Limpar</button>` : ''}
        </div>
        <div class="panel-body" style="padding:0;">
          ${evFeed.length === 0 ? `
            <div style="padding:28px 20px;text-align:center;color:var(--ink-mute);font-size:12px;">
              <div style="font-size:24px;margin-bottom:8px;opacity:0.4;">📡</div>
              Nenhuma atualização recebida nesta sessão.<br>
              <span style="font-size:11px;font-family:var(--font-mono);">Alterações de colaboradores aparecerão aqui em tempo real.</span>
            </div>
          ` : evFeed.map((ev, i) => `
            <div style="display:flex;align-items:flex-start;gap:10px;padding:10px 16px;${i < evFeed.length-1 ? 'border-bottom:1px solid var(--border);' : ''}${i === 0 ? 'background:rgba(229,75,26,0.035);' : ''}">
              <span style="font-size:14px;flex-shrink:0;margin-top:1px;">${ev.icon}</span>
              <div style="flex:1;min-width:0;">
                <div style="font-size:12px;color:var(--ink);line-height:1.4;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(ev.text)}</div>
              </div>
              <div style="font-family:var(--font-mono);font-size:10px;color:var(--ink-mute);white-space:nowrap;flex-shrink:0;">${_ago(ev.time)}</div>
            </div>
          `).join('')}
        </div>
      </div>

      <div class="panel">
        <div class="panel-head"><div class="panel-title">Canais</div></div>
        <div class="panel-body">
          <label style="display:flex;align-items:center;gap:12px;padding:10px 0;border-bottom:1px solid var(--border);cursor:pointer;">
            <input type="checkbox" id="notifEmailEnabled" ${prefs.email_enabled ? 'checked' : ''} style="width:16px;height:16px;">
            <div style="flex:1;">
              <div style="font-size:13px;font-weight:600;">E-mail</div>
              <div style="font-size:11px;color:var(--ink-mute);font-family:var(--font-mono);margin-top:2px;">Enviado para <strong>${escapeHtml(State.user.email)}</strong></div>
            </div>
          </label>
          <div style="padding:10px 0;border-bottom:1px solid var(--border);">
            <label class="form-label" style="font-size:11px;">Frequência do Resumo</label>
            <select class="form-input" id="notifDigest">
              <option value="off"    ${prefs.digest_frequency === 'off'    ? 'selected' : ''}>Desativado (apenas alertas críticos)</option>
              <option value="daily"  ${prefs.digest_frequency === 'daily'  ? 'selected' : ''}>Diário (resumo todo dia útil)</option>
              <option value="weekly" ${prefs.digest_frequency === 'weekly' ? 'selected' : ''}>Semanal (toda segunda-feira)</option>
            </select>
          </div>
          <div style="padding:10px 0 2px;font-size:11px;color:var(--ink-mute);line-height:1.5;">
            ➕ Além do resumo, quando uma tarefa é <strong>atribuída a você</strong>, um e-mail sai imediatamente (não espera o resumo).
          </div>
        </div>
      </div>

      <div class="panel" style="margin-top:14px;">
        <div class="panel-head"><div class="panel-title">Quando Notificar</div></div>
        <div class="panel-body">
          <div style="padding:10px 0;border-bottom:1px solid var(--border);">
            <label style="display:flex;align-items:center;gap:12px;cursor:pointer;">
              <input type="checkbox" id="notifOverdue" ${prefs.notify_overdue ? 'checked' : ''} style="width:16px;height:16px;">
              <div style="flex:1;">
                <div style="font-size:13px;font-weight:600;">Tarefa atrasada</div>
                <div style="font-size:11px;color:var(--ink-mute);">Aviso quando uma tarefa passa do prazo sem ser concluída</div>
              </div>
            </label>
          </div>
          <div style="padding:10px 0;border-bottom:1px solid var(--border);">
            <div style="display:flex;align-items:center;gap:12px;">
              <div style="font-size:13px;font-weight:600;flex:1;">Avisar X dias antes do prazo</div>
              <input type="number" id="notifDueDays" value="${prefs.notify_task_due_in_days}" min="0" max="30" class="form-input" style="width:80px;text-align:center;">
            </div>
            <div style="font-size:11px;color:var(--ink-mute);margin-top:6px;">Avisa quando uma tarefa está prestes a vencer (0 = desativado)</div>
          </div>
          <div style="padding:10px 0;border-bottom:1px solid var(--border);">
            <label style="display:flex;align-items:center;gap:12px;cursor:pointer;">
              <input type="checkbox" id="notifBlocked" ${prefs.notify_blocked ? 'checked' : ''} style="width:16px;height:16px;">
              <div style="flex:1;">
                <div style="font-size:13px;font-weight:600;">Tarefa marcada como Bloqueada</div>
                <div style="font-size:11px;color:var(--ink-mute);">Aviso imediato quando alguém bloqueia uma tarefa</div>
              </div>
            </label>
          </div>
          <div style="padding:10px 0;">
            <label style="display:flex;align-items:center;gap:12px;cursor:pointer;">
              <input type="checkbox" id="notifViolation" ${prefs.notify_constraint_violation ? 'checked' : ''} style="width:16px;height:16px;">
              <div style="flex:1;">
                <div style="font-size:13px;font-weight:600;">Violação de Restrição</div>
                <div style="font-size:11px;color:var(--ink-mute);">Aviso quando uma data fixa (MSO/MFO/FNLT/SNET) entra em conflito com as predecessoras</div>
              </div>
            </label>
          </div>
        </div>
      </div>

      <div style="margin-top:14px;padding:14px;background:var(--bg-deep);border:1px solid var(--border);border-radius:2px;font-size:12px;color:var(--ink-soft);">
        <div style="font-family:var(--font-mono);font-size:10px;color:var(--ink-mute);text-transform:uppercase;letter-spacing:0.12em;margin-bottom:6px;">⚙ Como funciona</div>
        Os avisos são enviados por uma rotina diária automática (Edge Function) que roda no servidor do Supabase. Para ativar o envio efetivo de e-mails, é necessário deploy da Edge Function <code style="background:var(--bg-panel);padding:2px 5px;border-radius:2px;color:var(--accent);">notify-tasks</code> e configuração de credenciais SMTP no painel Supabase. Ver <strong>Documentação</strong>.
      </div>
    `;
  },

  async saveNotifPrefs() {
    const data = {
      email_enabled: $('#notifEmailEnabled').checked,
      notify_overdue: $('#notifOverdue').checked,
      notify_blocked: $('#notifBlocked').checked,
      notify_constraint_violation: $('#notifViolation').checked,
      notify_task_due_in_days: parseInt($('#notifDueDays').value) || 0,
      digest_frequency: $('#notifDigest').value,
    };
    try {
      setLoading(true);
      await DB.upsertNotifPrefs(data);
      State.notifPrefs = { ...State.notifPrefs, ...data };
      toast('Preferências salvas', 'success');
    } catch (err) {
      let msg = err.message;
      if (msg.includes('notification_preferences')) msg = 'Tabela ainda não existe — rode 06-migration-v3.4.sql';
      toast(msg, 'error');
    }
    finally { setLoading(false); }
  },
});

// Plugado em UI: continuam acessíveis como UI.<método> e this.<método>.
Object.assign(UI, {
  // ===== MENÇÕES — modal do sininho =====
  async openMentionsModal() {
    // Recarrega menções não-lidas (se algum chegou via realtime ainda não foi puxado)
    try {
      State.myMentions = await DB.listMyUnreadMentions();
    } catch (e) {
      let msg = e.message;
      if (msg.includes('mentions') && msg.includes('does not exist')) msg = 'Tabela mentions ainda não existe — rode 10-migration-v3.7.sql';
      toast(msg, 'error');
      return;
    }
    const items = State.myMentions;

    Modal.open({
      title: items.length === 0 ? 'Sem menções novas' : `${items.length} ${items.length === 1 ? 'menção' : 'menções'} não lida${items.length === 1 ? '' : 's'}`,
      body: `
        ${items.length === 0 ? `
          <div style="padding:30px 20px;text-align:center;color:var(--ink-mute);font-size:13px;">
            Você ainda não foi mencionado em nenhum comentário.<br>
            <span style="font-size:11px;font-family:var(--font-mono);">Quando alguém usar @${escapeHtml(State.profile?.full_name?.split(' ')[0] || 'você')} num comentário, aparece aqui.</span>
          </div>
        ` : `
          <div style="display:flex;flex-direction:column;gap:8px;max-height:480px;overflow-y:auto;">
            ${items.map(m => {
              const proj = State.projects.find(p => p.id === m.project_id);
              const ago = (() => {
                const diff = Date.now() - new Date(m.created_at).getTime();
                const mins = Math.floor(diff / 60000);
                if (mins < 1) return 'agora';
                if (mins < 60) return `${mins} min atrás`;
                const hrs = Math.floor(mins / 60);
                if (hrs < 24) return `${hrs}h atrás`;
                return fmtDateFull(m.created_at);
              })();
              return `
                <div style="padding:12px;background:var(--bg-deep);border:1px solid var(--border);border-left:3px solid var(--accent-warm);border-radius:2px;cursor:pointer;" data-action="open-mention" data-task-id="${m.task_id}" data-mention-id="${m.id}">
                  <div style="display:flex;justify-content:space-between;gap:8px;margin-bottom:4px;">
                    <div style="font-family:var(--font-mono);font-size:10px;color:var(--ink-mute);text-transform:uppercase;letter-spacing:0.1em;">
                      ${escapeHtml(proj?.name || 'projeto')}
                    </div>
                    <div style="font-family:var(--font-mono);font-size:10px;color:var(--ink-mute);">${ago}</div>
                  </div>
                  <div style="font-size:13px;color:var(--ink);line-height:1.4;">${renderCommentBody(m.comment_snippet || '(comentário sem texto)')}</div>
                </div>
              `;
            }).join('')}
          </div>
        `}
      `,
      footer: `
        ${items.length > 0 ? '<button class="btn btn-secondary" id="btnMarkAllRead">Marcar todas como lidas</button>' : ''}
        <button class="btn btn-cta" id="btnCloseMentions">Fechar</button>
      `
    });
    $('#btnCloseMentions').onclick = () => Modal.close();
    if (items.length > 0) {
      $('#btnMarkAllRead').onclick = async () => {
        try {
          await DB.markMentionsRead(items.map(m => m.id));
          State.myMentions = [];
          Modal.close();
          await UI.render();
          toast('Menções marcadas como lidas', 'success');
        } catch (err) { toast(friendlyError(err), 'error'); }
      };
    }
    // Click numa menção: abre a tarefa correspondente e marca como lida
    $('#modal').querySelectorAll('[data-action="open-mention"]').forEach(el => {
      el.onclick = async () => {
        const taskId = el.dataset.taskId;
        const mentionId = el.dataset.mentionId;
        try {
          await DB.markMentionsRead([mentionId]);
          State.myMentions = State.myMentions.filter(m => m.id !== mentionId);
        } catch (e) { console.warn('Falha ao marcar menção como lida:', e.message); }
        Modal.close();
        // Abre a tarefa (se for do projeto atual)
        const task = State.tasks.find(t => t.id === taskId);
        if (task) {
          UI.openTaskModal(taskId);
        } else {
          toast('A tarefa está em outro projeto. Troque para esse projeto antes de abrir.', 'warning');
          await UI.render();
        }
      };
    });
  },
});
