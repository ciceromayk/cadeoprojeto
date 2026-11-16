// Ponto de entrada: splash, login, bootstrap e inicialização
import './inline-edit.js';
import './screen-team.js';
import './screen-disciplines.js';
import './screen-sectors.js';
import './screen-restrictions.js';
import './screen-raci.js';
import './screen-lastplanner.js';
import './screen-desembolso.js';
import './screen-pendencias.js';
import './screen-calendar.js';
import './screen-notifications.js';
import './screen-report.js';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import { $, $$, _parseYMD, addDays, addWorkingDays, daysBetween, escapeHtml, forecastEndDate, isWorkingDay, parentTag, parentTitleOf, physicalProgress, today, workingDaysBetween } from './helpers.js';
import { autoSchedule, computeCriticalPath } from './cpm.js';
import { checkAppVersion, setSplashText, toast } from './feedback.js';
import { State } from './state.js';
import { Auth, Config } from './auth.js';
import { DB, setupRealtime } from './db.js';
import { KeyboardShortcuts } from './keyboard.js';
import { Modal } from './modal.js';
import { MSPX } from './mspx.js';
import { Views } from './views.js';
import { Automation } from './automation.js';
import { Dialog } from './dialog.js';
import { UI } from './ui.js';
import { GlobalSearch } from './global-search.js';
import { LegalDocs } from './legal-docs.js';
import { Tour } from './tour.js';

// ---------- INIT ----------
async function showSplash(text) {
  setSplashText(text);
  $('#splash').style.display = 'flex';
}

async function hideSplash() { $('#splash').style.display = 'none'; }

async function showConfig() {
  await hideSplash();
  $('#configScreen').classList.add('active');
  $('#loginScreen').style.display = 'none';
  $('#app').classList.remove('active');
}

async function showLogin() {
  await hideSplash();
  $('#configScreen').classList.remove('active');
  $('#loginScreen').style.display = 'flex';
  $('#app').classList.remove('active');
}

async function showApp() {
  await hideSplash();
  $('#configScreen').classList.remove('active');
  $('#loginScreen').style.display = 'none';
  $('#app').classList.add('active');

  // Banner de aviso se a migration v3 não rodou
  if (State._migrationMissing) {
    let banner = $('#migrationBanner');
    if (!banner) {
      banner = document.createElement('div');
      banner.id = 'migrationBanner';
      banner.style.cssText = 'background:#3a2d10;border-bottom:1px solid #D4A82C;color:#ffd89c;padding:10px 16px;font-size:12px;display:flex;align-items:center;gap:10px;font-family:var(--font-mono);';
      banner.innerHTML = `
        <span style="font-size:16px;">⚠</span>
        <div style="flex:1;">
          <strong>Migration v3 pendente.</strong> As funcionalidades de Engenharia (Disciplinas, Entregáveis, RACI, Aprovações) não funcionarão até você rodar o <code style="background:#1a1408;padding:1px 5px;border-radius:2px;color:#D4A82C;">02-migration-v3.sql</code> no SQL Editor do Supabase.
        </div>
        <button onclick="this.parentNode.style.display='none'" style="background:transparent;border:1px solid #D4A82C;color:#ffd89c;padding:4px 10px;border-radius:2px;font-family:inherit;font-size:11px;cursor:pointer;">Dispensar</button>
      `;
      $('#app').insertBefore(banner, $('#app').firstChild);
    }
  }

  await UI.render();

  // ── Modal de Resumo Diário ─────────────────────────────────────────────────
  // Mostra no máximo UMA VEZ por dia (não reaparece a cada refresh/login)
  setTimeout(() => {
    try {
      const t = today();
      const _SUMMARY_KEY = 'projetudo.portfolioSummary.lastShown';
      let _lastSummary = ''; try { _lastSummary = localStorage.getItem(_SUMMARY_KEY) || ''; } catch(e){}
      if (_lastSummary === t) return; // já exibido hoje — não incomoda de novo
      const in15 = addDays(t, 15);
      const allT = (State.allTasks && State.allTasks.length > 0) ? State.allTasks : State.tasks;
      const projs = State.projects || [];
      if (projs.length === 0 || allT.length === 0) return;

      // Monta dados por projeto
      const rows = projs.map(p => {
        const allProjT = allT.filter(tk => tk.project_id === p.id);
        const pt       = allProjT.filter(tk => tk.status !== 'concluido');
        const overdue  = pt.filter(tk => tk.end_date && tk.end_date < t).length;
        const due15    = pt.filter(tk => tk.end_date && tk.end_date >= t && tk.end_date <= in15).length;
        const total    = pt.length;
        // Progresso igual ao do dashboard: avanço físico (ponderado por duração, só folhas)
        const progress = Math.round(physicalProgress(allProjT));
        return { p, overdue, due15, total, progress };
      }).filter(r => r.total > 0 || r.overdue > 0);

      if (rows.length === 0) return;

      const totalOverdue = rows.reduce((s, r) => s + r.overdue, 0);
      const totalDue15   = rows.reduce((s, r) => s + r.due15, 0);
      const dateLabel = new Date().toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
        .replace(/^\w/, c => c.toUpperCase());

      const tableRows = rows.map(r => `
        <tr style="cursor:pointer;" onclick="Modal.close();UI.switchProject('${r.p.id}').then(()=>{State.currentView='tasks';UI.setActiveNav('tasks');UI.render();});"
            title="Abrir projeto ${escapeHtml(r.p.name)}">
          <td style="padding:9px 12px;font-weight:600;max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">
            ${escapeHtml(r.p.name)}
            ${r.p.client ? `<div style="font-size:10px;color:var(--ink-mute);font-weight:400;">${escapeHtml(r.p.client)}</div>` : ''}
          </td>
          <td style="padding:9px 12px;text-align:center;font-family:var(--font-mono);font-size:13px;font-weight:700;color:${r.overdue > 0 ? 'var(--accent-danger)' : 'var(--ink-mute)'};">
            ${r.overdue > 0 ? r.overdue : '—'}
          </td>
          <td style="padding:9px 12px;text-align:center;font-family:var(--font-mono);font-size:13px;font-weight:700;color:${r.due15 > 0 ? 'var(--accent-warm)' : 'var(--ink-mute)'};">
            ${r.due15 > 0 ? r.due15 : '—'}
          </td>
          <td style="padding:9px 12px;text-align:center;font-family:var(--font-mono);font-size:11px;color:var(--ink-soft);">
            ${r.total}
          </td>
          <td style="padding:9px 12px;min-width:100px;">
            <div style="background:var(--border);border-radius:10px;height:6px;overflow:hidden;">
              <div style="background:${r.progress >= 80 ? 'var(--accent-success)' : r.progress >= 40 ? 'var(--accent)' : 'var(--accent-warm)'};height:6px;width:${r.progress}%;border-radius:10px;transition:width .3s;"></div>
            </div>
            <div style="font-family:var(--font-mono);font-size:9px;color:var(--ink-mute);margin-top:3px;text-align:right;">${r.progress}%</div>
          </td>
        </tr>`).join('');

      try { localStorage.setItem(_SUMMARY_KEY, t); } catch(e){}
      Modal.open({
        title: 'Resumo do Portfólio',
        cls: 'modal-wide',
        body: `
          <div style="margin-bottom:14px;">
            <div style="font-size:12px;color:var(--ink-mute);font-family:var(--font-mono);">${dateLabel}</div>
            ${(totalOverdue > 0 || totalDue15 > 0) ? `
            <div style="display:flex;gap:10px;margin-top:10px;flex-wrap:wrap;">
              ${totalOverdue > 0 ? `<div style="display:flex;align-items:center;gap:8px;padding:10px 16px;background:rgba(193,59,18,.08);border:1px solid rgba(193,59,18,.3);border-radius:4px;flex:1;min-width:140px;">
                <span style="font-size:22px;">⚠</span>
                <div><div style="font-size:20px;font-weight:800;font-family:var(--font-mono);color:var(--accent-danger);">${totalOverdue}</div>
                <div style="font-size:10px;color:var(--ink-soft);">tarefa${totalOverdue!==1?'s':''} atrasada${totalOverdue!==1?'s':''}</div></div>
              </div>` : ''}
              ${totalDue15 > 0 ? `<div style="display:flex;align-items:center;gap:8px;padding:10px 16px;background:rgba(212,168,44,.08);border:1px solid rgba(212,168,44,.3);border-radius:4px;flex:1;min-width:140px;">
                <span style="font-size:22px;">📅</span>
                <div><div style="font-size:20px;font-weight:800;font-family:var(--font-mono);color:var(--accent-warm);">${totalDue15}</div>
                <div style="font-size:10px;color:var(--ink-soft);">vencem nos próximos 15 dias</div></div>
              </div>` : ''}
            </div>` : `<div style="margin-top:10px;padding:10px 14px;background:rgba(46,125,79,.08);border:1px solid rgba(46,125,79,.3);border-radius:4px;font-size:12px;color:var(--accent-success);">✓ Nenhuma tarefa atrasada ou vencendo em 15 dias.</div>`}
          </div>
          <div style="overflow-x:auto;">
            <table style="width:100%;border-collapse:collapse;font-size:12px;">
              <thead>
                <tr style="border-bottom:2px solid var(--border);">
                  <th style="padding:7px 12px;text-align:left;font-family:var(--font-mono);font-size:9px;text-transform:uppercase;letter-spacing:.08em;color:var(--ink-mute);">Projeto</th>
                  <th style="padding:7px 12px;text-align:center;font-family:var(--font-mono);font-size:9px;text-transform:uppercase;letter-spacing:.08em;color:var(--accent-danger);">Atrasadas</th>
                  <th style="padding:7px 12px;text-align:center;font-family:var(--font-mono);font-size:9px;text-transform:uppercase;letter-spacing:.08em;color:var(--accent-warm);">Próx. 15 dias</th>
                  <th style="padding:7px 12px;text-align:center;font-family:var(--font-mono);font-size:9px;text-transform:uppercase;letter-spacing:.08em;color:var(--ink-mute);">Pendentes</th>
                  <th style="padding:7px 12px;font-family:var(--font-mono);font-size:9px;text-transform:uppercase;letter-spacing:.08em;color:var(--ink-mute);">Progresso</th>
                </tr>
              </thead>
              <tbody>
                ${tableRows}
              </tbody>
            </table>
          </div>
          <div style="margin-top:10px;font-size:10px;color:var(--ink-mute);">Clique em um projeto para acessar suas tarefas.</div>
        `,
        footer: `<button class="btn btn-cta" onclick="Modal.close()">Entendido</button>`,
      });
    } catch(e) { console.warn('Resumo inicial:', e); }
  }, 600);

  // ── Convites de projeto pendentes (in-app) ──────────────────────────────────
  UI.renderPendingInvitesBanner();

  // ── Lembrete semanal de backup ─────────────────────────────────────────────
  // Exibe um banner discreto uma vez por semana lembrando o usuário de exportar dados.
  // Controlado por localStorage — sem SQL, sem intrusão.
  setTimeout(() => {
    const BACKUP_KEY = `backup_reminder_${State.user?.id || 'anon'}`;
    const SNOOZE_KEY = `backup_snooze_${State.user?.id || 'anon'}`;
    const last = parseInt(localStorage.getItem(BACKUP_KEY) || '0');
    const snoozed = parseInt(localStorage.getItem(SNOOZE_KEY) || '0');
    const now = Date.now();
    const WEEK = 7 * 24 * 60 * 60 * 1000;
    if (now - last < WEEK) return; // ainda dentro da semana — silencioso
    if (now - snoozed < WEEK) return; // usuário snoozou esta semana
    // Marca como "exibido agora"
    localStorage.setItem(BACKUP_KEY, String(now));
    // Cria o banner
    const banner = document.createElement('div');
    banner.id = 'backupReminderBanner';
    banner.style.cssText = [
      'position:fixed','bottom:18px','right:18px','z-index:4000',
      'background:var(--bg-panel)','border:1px solid var(--border-strong)',
      'border-left:4px solid var(--accent-warm)','border-radius:6px',
      'box-shadow:0 4px 20px rgba(0,0,0,.22)','padding:14px 16px',
      'max-width:340px','width:calc(100vw - 36px)','font-size:12px',
      'animation:slideInRight .25s ease','display:flex','flex-direction:column','gap:10px'
    ].join(';');
    banner.innerHTML = `
      <div style="display:flex;align-items:flex-start;gap:10px;">
        <span style="font-size:20px;line-height:1;flex-shrink:0;">🗂</span>
        <div style="flex:1;min-width:0;">
          <div style="font-weight:700;color:var(--ink);margin-bottom:3px;">Lembrete semanal de backup</div>
          <div style="color:var(--ink-soft);line-height:1.4;">Baixe um backup completo (projetos, tarefas, dependências, restrições e mais) para garantir que nada se perca. Recomendado uma vez por semana.</div>
        </div>
        <button onclick="document.getElementById('backupReminderBanner').remove()" style="background:none;border:none;cursor:pointer;color:var(--ink-mute);font-size:16px;line-height:1;padding:0;flex-shrink:0;" title="Fechar">✕</button>
      </div>
      <div style="display:flex;gap:8px;justify-content:flex-end;">
        <button id="backupReminderSnooze" class="btn btn-ghost" style="font-size:11px;padding:5px 12px;">Lembrar depois</button>
        <button id="backupReminderExport" class="btn btn-cta" style="font-size:11px;padding:5px 14px;">⬇ Exportar agora</button>
      </div>`;
    document.body.appendChild(banner);
    // Botão exportar — dispara a exportação e fecha o banner
    document.getElementById('backupReminderExport').onclick = () => {
      banner.remove();
      if (window.UI && UI.exportData) UI.exportData();
    };
    // Botão lembrar depois — snooze de 7 dias a partir de agora
    document.getElementById('backupReminderSnooze').onclick = () => {
      localStorage.setItem(SNOOZE_KEY, String(Date.now()));
      banner.remove();
    };
  }, 1800); // aparece 1,8s após o app carregar (não interrompe o boot)

  // Tour NÃO inicia mais automaticamente — a tela inicial é a lista de Projetos.
  // O usuário abre a ajuda pelo botão "?" na barra superior quando quiser.

  // Botão ? visível agora que o app carregou
  const tourBtn = document.getElementById('btnTourHelp');
  if (tourBtn) tourBtn.style.display = '';
}

async function bootstrapAfterLogin() {
  setSplashText('Carregando seus dados...');
  $('#splash').style.display = 'flex';

  try {
    State.profile = await Auth.getProfile();
    State.projects = await DB.listProjects();

    // ── Aceita convite pendente (token armazenado na URL ?invite=) ─────────
    const _pendingToken = localStorage.getItem('pendingInviteToken');
    if (_pendingToken) {
      localStorage.removeItem('pendingInviteToken');
      setSplashText('Aceitando convite...');
      try {
        const result = await DB.acceptInviteByToken(_pendingToken);
        if (result?.error) {
          toast(result.error, 'error');
        } else if (result?.project_id) {
          // Recarrega projetos para incluir o recém-aceito
          State.projects = await DB.listProjects();
          // Abre direto no projeto convidado
          State.currentProjectId = result.project_id;
          toast('Convite aceito! Bem-vindo ao projeto.', 'success');
        }
      } catch (invErr) {
        console.warn('Erro ao aceitar convite:', invErr.message);
        toast('Não foi possível aceitar o convite: ' + invErr.message, 'error');
      }
    }

    // Não seleciona projeto automaticamente — usuário começa na lista de projetos
    State.currentProjectId = State.currentProjectId || null;
    if (!State.currentProjectId) State.currentView = 'projects';

    // Carrega cadastro global de equipe ANTES do loadCurrentProject — caso contrário,
    // o computeMembers() do load roda com State.teamMembers vazio e o dono não aparece
    try {
      State.teamMembers = await DB.listTeamMembers();
      // Garante que o DONO sempre exista como membro da equipe (mín. 1 componente)
      if (State.user) {
        const ownerEmail = State.user.email;
        const ownerExists = State.teamMembers.some(m =>
          (m.user_id && m.user_id === State.user.id) ||
          (m.email && m.email.toLowerCase() === ownerEmail.toLowerCase())
        );
        if (!ownerExists) {
          const ownerName = State.profile?.full_name || ownerEmail.split('@')[0];
          try {
            const created = await DB.createTeamMember({ name: ownerName, email: ownerEmail, role_title: 'Dono do Projeto', active: true });
            State.teamMembers.unshift(created);
          } catch (e2) { console.warn('Não foi possível auto-criar membro dono:', e2.message); }
        }
      }
    }
    catch (e) { console.warn('Team members (rode 12-migration-v3.9.sql):', e.message); State.teamMembers = []; }

    await DB.loadCurrentProject();
    // Carrega dados cross-project (Visão Geral) — não-fatal se falhar
    try {
      State.allTasks = await DB.listAllTasksForUser();
      State.allLabels = await DB.listAllLabels();
      State.allTaskLabels = await DB.listAllTaskLabels();
      UI._overviewLoadedAt = Date.now();
    } catch (e) { console.warn('Visão Geral cross-project:', e.message); }
    // Carrega templates de EAP (não-fatal se tabela ainda não existir)
    try { State.eapTemplates = await DB.listEapTemplates(); }
    catch (e) { console.warn('EAP templates:', e.message); State.eapTemplates = []; }
    // Carrega preferências de notificação (não-fatal se falhar)
    try { State.notifPrefs = await DB.getNotifPrefs(); }
    catch (e) { console.warn('Preferências de notificação:', e.message); State.notifPrefs = null; }
    // Carrega preferências de Automação (localStorage)
    Automation.load();
    // Carrega convites de projeto pendentes para o e-mail do usuário (in-app)
    State.myPendingInvites = await DB.listMyPendingInvites();
    // (teamMembers já foi carregado acima, antes do loadCurrentProject)
    // Carrega menções não-lidas (não-fatal se falhar — tabela pode não existir ainda)
    try { State.myMentions = await DB.listMyUnreadMentions(); }
    catch (e) { console.warn('Menções não carregadas (rode 10-migration-v3.7.sql):', e.message); State.myMentions = []; }
    setupRealtime();
    await showApp();
  } catch (err) {
    console.error('Falha no carregamento inicial:', err);
    const splash = $('#splash');
    const _msg = err.message || String(err);
    // "Failed to fetch" / NetworkError = não chegou ao Supabase (rede, projeto pausado, URL errada).
    // NÃO é falta de migração — orientar de acordo, senão o usuário roda SQL à toa.
    const _isNetwork = /failed to fetch|networkerror|load failed|fetch event|timeout|err_/i.test(_msg);
    const _guidance = _isNetwork
      ? `<strong>Não foi possível conectar ao Supabase.</strong> Verifique, nesta ordem:<br><br>
          <span style="display:inline-block;text-align:left;">
          1. Sua <strong>conexão com a internet</strong>.<br>
          2. Se o <strong>projeto Supabase está pausado</strong> — projetos do plano grátis pausam após ~1 semana sem uso. Entre em <strong>supabase.com</strong> → seu projeto → <strong>Restore/Resume</strong>.<br>
          3. Se a <strong>URL/chave</strong> do Supabase ainda estão corretas.
          </span>`
      : `<strong>Causa mais comum:</strong> o SQL <code style="background:var(--bg-deep);padding:2px 6px;border-radius:2px;color:var(--accent);">02-migration-v3.sql</code> ainda não foi rodado no Supabase.<br><br>
          Vá em <strong>SQL Editor</strong> no painel do Supabase, cole o conteúdo do <code>02-migration-v3.sql</code> e clique em <strong>Run</strong>.`;
    splash.innerHTML = `
      <div style="max-width:480px;text-align:center;padding:30px;">
        <div style="font-size:48px;margin-bottom:12px;">${_isNetwork ? '📡' : '⚠'}</div>
        <div style="font-size:18px;font-weight:700;margin-bottom:8px;color:var(--accent-danger);">${_isNetwork ? 'Sem conexão com o servidor' : 'Erro ao carregar dados'}</div>
        <div style="font-size:13px;color:var(--ink-soft);margin-bottom:18px;font-family:var(--font-mono);background:var(--bg-deep);padding:12px;border-radius:3px;text-align:left;word-break:break-word;">${escapeHtml(_msg)}</div>
        <div style="font-size:13px;color:var(--ink-soft);margin-bottom:18px;line-height:1.5;">${_guidance}</div>
        <button class="btn btn-cta" onclick="location.reload()">Recarregar página</button>
        ${Config.isEmbedded() ? '' : `<button class="btn btn-secondary" style="margin-left:8px;" onclick="Dialog.confirm({title:'Resetar configuração',msg:'Limpar credenciais e recomeçar do zero?',confirmText:'Resetar',danger:true}).then(ok=>{if(ok){Config.reset();location.reload();}})">Resetar configuração</button>`}
      </div>
    `;
  }
}

async function initSupabase(url, key) {
  try {
    State.supabase = createClient(url, key, {
      auth: { persistSession: true, autoRefreshToken: true }
    });

    // Listener de mudanças de sessão
    State.supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_OUT') {
        State.user = null; State.profile = null;
        showLogin();
      }
    });

    // Verifica sessão ativa
    const { data: { session } } = await State.supabase.auth.getSession();
    if (session) {
      State.user = session.user;
      await bootstrapAfterLogin();
    } else {
      await showLogin();
    }
  } catch (err) {
    console.error('Erro ao inicializar Supabase:', err);
    const splash = $('#splash');
    splash.innerHTML = `
      <div style="max-width:480px;text-align:center;padding:30px;">
        <div style="font-size:48px;margin-bottom:12px;">⚠</div>
        <div style="font-size:18px;font-weight:700;margin-bottom:8px;color:var(--accent-danger);">Não foi possível conectar ao Supabase</div>
        <div style="font-size:13px;color:var(--ink-soft);margin-bottom:18px;font-family:var(--font-mono);background:var(--bg-deep);padding:12px;border-radius:3px;text-align:left;word-break:break-word;">${escapeHtml(err.message || String(err))}</div>
        <div style="font-size:13px;color:var(--ink-soft);margin-bottom:18px;line-height:1.5;">
          Verifique a <strong>URL</strong> e a <strong>anon key</strong> em <em>Project Settings → API</em> no painel Supabase.
        </div>
        ${Config.isEmbedded()
          ? '<button class="btn btn-cta" onclick="location.reload()">Tentar novamente</button>'
          : '<button class="btn btn-cta" onclick="if(confirm(\'Limpar credenciais e recomeçar?\')){Config.reset();location.reload();}">Resetar configuração</button>'}
      </div>
    `;
  }
}

// ---------- TESTABLES ----------
// Funções puras expostas para a suíte de testes (tests.html).
// Não fazem parte da API do app — não usar em código de produção.
window.__testables = {
  daysBetween, addDays, _parseYMD, isWorkingDay, workingDaysBetween, addWorkingDays,
  computeCriticalPath, autoSchedule, MSPX, escapeHtml, parentTitleOf, parentTag,
  forecastEndDate,
  // forecastEndDate consulta window.State para resolver predecessoras — estes
  // helpers permitem injetar um State sintético nos testes e restaurar depois.
  _setTestState: (s) => { window.__testState_backup = window.State; window.State = s || { tasks: [], dependencies: [] }; },
  _restoreState: () => { if (window.__testState_backup !== undefined) { window.State = window.__testState_backup; delete window.__testState_backup; } },
};

// ---------- ENTRY POINT ----------
document.addEventListener('DOMContentLoaded', async () => {
  // Version check: no boot e a cada hora (não bloqueia; silencioso se não houver version.json)
  checkAppVersion();
  setInterval(checkAppVersion, 60 * 60 * 1000);

  // ── Captura token de convite da URL (?invite=TOKEN) ─────────────────────
  (function () {
    const params = new URLSearchParams(window.location.search);
    const tok = params.get('invite');
    if (tok) {
      localStorage.setItem('pendingInviteToken', tok);
      // Remove o parâmetro da URL sem recarregar a página
      const clean = window.location.pathname + (window.location.hash || '');
      history.replaceState(null, '', clean);
    }
  })();

  // Setup config screen
  $('#cfgSave').onclick = async () => {
    const url = $('#cfgUrl').value.trim();
    const key = $('#cfgKey').value.trim();
    const errEl = $('#configError');
    errEl.style.display = 'none';

    if (!url || !key) { errEl.textContent = 'Preencha ambos os campos.'; errEl.style.display = 'block'; return; }
    if (!url.startsWith('https://') || !url.includes('.supabase.co')) {
      errEl.textContent = 'A URL deve ser do formato https://xxxxx.supabase.co'; errEl.style.display = 'block'; return;
    }
    if (key.length < 30) {
      errEl.textContent = 'A anon key parece inválida.'; errEl.style.display = 'block'; return;
    }

    // Testa conexão criando cliente
    try {
      const testClient = createClient(url, key);
      const { error } = await testClient.from('projects').select('id').limit(1);
      // Erro de RLS sem auth é esperado e indica conexão OK; outros erros indicam problema.
      if (error && !error.message.toLowerCase().includes('jwt') && error.code !== '42P01' && !error.message.includes('row-level')) {
        // Só falha se for erro de rede ou tabela inexistente
        if (error.code === '42P01') {
          errEl.textContent = 'Tabelas não encontradas. Execute o script 01-schema.sql no SQL Editor.';
        } else if (error.message.toLowerCase().includes('failed to fetch')) {
          errEl.textContent = 'Não foi possível conectar. Verifique a URL.';
        } else {
          errEl.textContent = 'Erro ao conectar: ' + error.message;
        }
        errEl.style.display = 'block'; return;
      }
      Config.save(url, key);
      await initSupabase(url, key);
    } catch (err) {
      errEl.textContent = 'Falha na conexão: ' + err.message;
      errEl.style.display = 'block';
    }
  };

  // (Botão "trocar conexão" removido da tela de login.)
  const _resetCfgBtn = $('#resetConfig');
  if (_resetCfgBtn) _resetCfgBtn.onclick = () => {
    Dialog.confirm({ title: 'Trocar credenciais', msg: 'Limpar as credenciais do Supabase e reiniciar a configuração?', confirmText: 'Resetar', danger: true }).then(ok => { if (ok) { Config.reset(); location.reload(); } });
  };

  // Login rate limiter (cliente) — max 5 tentativas / 60 s
  const _loginRL = { attempts: 0, lockedUntil: 0 };
  const _loginThrottle = () => {
    const now = Date.now();
    if (now < _loginRL.lockedUntil) {
      const wait = Math.ceil((_loginRL.lockedUntil - now) / 1000);
      return `Muitas tentativas. Aguarde ${wait}s antes de tentar novamente.`;
    }
    _loginRL.attempts++;
    if (_loginRL.attempts >= 5) {
      _loginRL.lockedUntil = now + 60_000;
      _loginRL.attempts = 0;
      return 'Muitas tentativas. Aguarde 60s antes de tentar novamente.';
    }
    return null;
  };
  const _loginSuccess = () => { _loginRL.attempts = 0; _loginRL.lockedUntil = 0; };

  // Login form
  $('#loginForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = $('#loginEmail').value.trim().toLowerCase();
    const password = $('#loginPassword').value;
    const name = $('#loginName').value.trim();
    const errEl = $('#loginError'); const okEl = $('#loginSuccess');
    errEl.style.display = 'none'; okEl.style.display = 'none';

    // Rate limit check
    if (Auth.mode !== 'register') {
      const rlMsg = _loginThrottle();
      if (rlMsg) { errEl.textContent = rlMsg; errEl.style.display = 'block'; return; }
    }

    const btn = $('#loginSubmit');
    const origText = btn.textContent;
    btn.innerHTML = '<span class="loader"></span>'; btn.disabled = true;

    try {
      if (Auth.mode === 'register') {
        if (!name) throw new Error('Informe seu nome.');
        if (!$('#consentCheck').checked) throw new Error('Você precisa aceitar os Termos de Uso e a Política de Privacidade para criar uma conta.');
        const { user, session } = await Auth.signUp(email, password, name);
        if (session) {
          State.user = session.user;
          await bootstrapAfterLogin();
        } else {
          // Email confirmation required
          okEl.textContent = 'Conta criada! Confirme seu e-mail para entrar (verifique a caixa de spam).';
          okEl.style.display = 'block';
          Auth.toggleMode();
        }
      } else {
        const { user } = await Auth.signIn(email, password);
        _loginSuccess();
        State.user = user;
        await bootstrapAfterLogin();
      }
    } catch (err) {
      console.error('[Auth] Erro completo:', err);
      let msg = err.message || String(err);
      const lower = msg.toLowerCase();
      if (lower.includes('invalid login') || lower.includes('invalid_credentials')) {
        msg = 'E-mail ou senha incorretos. Se acabou de se cadastrar, confira seu e-mail (incluindo spam) — talvez seja necessário confirmar antes do primeiro login.';
      } else if (lower.includes('already registered') || lower.includes('user_already_exists')) {
        msg = 'Este e-mail já está cadastrado. Use "Entrar" em vez de criar nova conta.';
      } else if (lower.includes('email not confirmed') || lower.includes('email_not_confirmed')) {
        msg = 'Confirme seu e-mail antes de entrar. Verifique a caixa de entrada e a pasta de spam.';
      } else if (lower.includes('rate limit') || lower.includes('too many')) {
        msg = 'Muitas tentativas em sequência. Aguarde alguns minutos antes de tentar novamente.';
      } else if (lower.includes('password') && lower.includes('short')) {
        msg = 'A senha precisa ter no mínimo 6 caracteres.';
      } else if (lower.includes('valid email')) {
        msg = 'E-mail inválido. Verifique e tente de novo.';
      }
      errEl.textContent = msg; errEl.style.display = 'block';
    } finally {
      btn.textContent = origText; btn.disabled = false;
    }
  });

  $('#footerSwitch').addEventListener('click', () => Auth.toggleMode());

  // Links de privacidade/termos na tela de login
  $('#openTerms').addEventListener('click', (e) => { e.preventDefault(); LegalDocs.openTerms(); });
  $('#openPrivacy').addEventListener('click', (e) => { e.preventDefault(); LegalDocs.openPrivacy(); });
  $('#openPrivacyFooter').addEventListener('click', (e) => { e.preventDefault(); LegalDocs.openPrivacy(); });

  // Nav
  $$('.nav-item').forEach(n => n.addEventListener('click', async () => {
    State.currentView = n.dataset.view;
    UI.setActiveNav(State.currentView);
    await UI.render();
  }));

  // Project select
  $('#projectSelect').addEventListener('change', async (e) => UI.switchProject(e.target.value));

  // Botão tour
  // "?" abre menu de ajuda — atalhos OU tour de boas-vindas
  $('#btnTourHelp').addEventListener('click', () => {
    Modal.open({
      title: '? Ajuda',
      body: `
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
          <button class="btn btn-secondary" id="btnHlpKb" style="padding:18px 14px;display:flex;flex-direction:column;gap:8px;align-items:center;">
            <span style="font-size:28px;">⌨</span>
            <span style="font-weight:700;">Atalhos de Teclado</span>
            <span style="font-size:11px;color:var(--ink-mute);">Acelere seu trabalho</span>
          </button>
          <button class="btn btn-secondary" id="btnHlpTour" style="padding:18px 14px;display:flex;flex-direction:column;gap:8px;align-items:center;">
            <span style="font-size:28px;">🎯</span>
            <span style="font-weight:700;">Tour Guiado</span>
            <span style="font-size:11px;color:var(--ink-mute);">Revisão das funcionalidades</span>
          </button>
        </div>`,
      footer: `<button class="btn btn-secondary" id="btnHlpClose">Fechar</button>`
    });
    $('#btnHlpKb').onclick = () => { Modal.close(); KeyboardShortcuts.open(); };
    $('#btnHlpTour').onclick = () => { Modal.close(); Tour.start(true); };
    $('#btnHlpClose').onclick = () => Modal.close();
  });

  // Atalho Alt+N — cria tarefa no projeto atual (modal completo), só nas telas Tarefas/Cronograma
  document.addEventListener('keydown', (e) => {
    if (e.altKey && e.key === 'n' && State.user && !$('#modalBackdrop')?.classList.contains('active')) {
      if (State.currentView !== 'tasks' && State.currentView !== 'gantt') return;
      e.preventDefault();
      UI.openTaskModal();
    }
  });

  // New project btn
  $('#btnNewProject').addEventListener('click', () => UI.openNewProjectModal());

  // Tema claro/escuro (persiste em localStorage)
  const applyTheme = (t) => {
    document.documentElement.setAttribute('data-theme', t);
    $('#iconThemeDark').style.display = t === 'light' ? 'none' : '';
    $('#iconThemeLight').style.display = t === 'light' ? '' : 'none';
    try { localStorage.setItem('projetudo.theme', t); } catch(e){}
  };
  // Boot do tema salvo
  let savedTheme = 'light';
  // Migração silenciosa: copia tema salvo de versões anteriores
  try {
    const oldKeys = ['obraflow.theme', 'projectflow.theme'];
    if (!localStorage.getItem('projetudo.theme')) {
      for (const k of oldKeys) {
        const v = localStorage.getItem(k);
        if (v) { localStorage.setItem('projetudo.theme', v); break; }
      }
    }
    oldKeys.forEach(k => localStorage.removeItem(k));
  } catch(e){}
  try { savedTheme = localStorage.getItem('projetudo.theme') || 'light'; } catch(e){}
  applyTheme(savedTheme);
  $('#btnTheme').addEventListener('click', () => {
    const cur = document.documentElement.getAttribute('data-theme') || 'light';
    applyTheme(cur === 'light' ? 'dark' : 'light');
  });

  // Densidade compacto/confortável (persiste em localStorage)
  const applyDensity = (mode) => {
    const compact = mode === 'compact';
    document.body.classList.toggle('density-compact', compact);
    const ic = $('#iconDensityComfort'), ik = $('#iconDensityCompact');
    if (ic) ic.style.display = compact ? 'none' : '';
    if (ik) ik.style.display = compact ? '' : 'none';
    try { localStorage.setItem('projetudo.density', mode); } catch(e){}
  };
  let savedDensity = 'comfort';
  try { savedDensity = localStorage.getItem('projetudo.density') || 'comfort'; } catch(e){}
  applyDensity(savedDensity);
  $('#btnDensity').addEventListener('click', () => {
    const cur = document.body.classList.contains('density-compact') ? 'compact' : 'comfort';
    applyDensity(cur === 'compact' ? 'comfort' : 'compact');
  });

  // ===== MOBILE: drawer + bottom nav =====
  const _isMobile = () => window.innerWidth <= 768;

  const mobOpenDrawer = () => {
    $('#sidebar')?.classList.add('mob-open');
    $('#mobOverlay')?.classList.add('active');
    document.body.style.overflow = 'hidden';
  };
  const mobCloseDrawer = () => {
    $('#sidebar')?.classList.remove('mob-open');
    $('#mobOverlay')?.classList.remove('active');
    document.body.style.overflow = '';
  };

  // Hamburger no topbar
  $('#btnMobileMenu')?.addEventListener('click', mobOpenDrawer);
  // Botão "Mais" no bottom nav
  $('#mobMenuBtn')?.addEventListener('click', mobOpenDrawer);
  // Overlay fecha o drawer
  $('#mobOverlay')?.addEventListener('click', mobCloseDrawer);
  // Fechar drawer ao navegar (mobile)
  $$('.nav-item').forEach(n => n.addEventListener('click', () => { if (_isMobile()) mobCloseDrawer(); }));

  // Sync bottom nav com a view ativa
  const syncMobNav = (view) => {
    $$('.mob-nav-btn[data-mob-view]').forEach(b => b.classList.toggle('active', b.dataset.mobView === view));
  };

  // Bottom nav: navega ao clicar
  $$('.mob-nav-btn[data-mob-view]').forEach(btn => {
    btn.addEventListener('click', async () => {
      State.currentView = btn.dataset.mobView;
      UI.setActiveNav(State.currentView);
      syncMobNav(State.currentView);
      await UI.render();
    });
  });

  // FAB: abre modal de nova tarefa
  const _mobFab = $('#mobFab');
  if (_mobFab) _mobFab.addEventListener('click', () => UI.openTaskModal());
  // Mostra FAB no mobile (768px abaixo) usando ResizeObserver/matchMedia
  const _fabMQ = window.matchMedia('(max-width: 768px)');
  const _syncFab = () => { if (_mobFab) _mobFab.style.display = _fabMQ.matches && State.currentProjectId ? 'flex' : 'none'; };
  _fabMQ.addEventListener?.('change', _syncFab);
  _syncFab();
  // Re-sincroniza sempre que UI.render rodar (cobertura para troca de projeto)
  const _origRender = UI.render.bind(UI);
  UI.render = async function() { const r = await _origRender(); _syncFab(); return r; };

  // Intercepta setActiveNav para manter bottom nav sincronizado
  const _origSetActiveNav = UI.setActiveNav.bind(UI);
  UI.setActiveNav = (view) => { _origSetActiveNav(view); syncMobNav(view); };

  // Sidebar toggle: rail (padrão) ↔ expandida
  const _app = $('#app');
  const _toggleBtn = $('#btnToggleSidebar');
  const applySidebarExpanded = (expanded) => {
    _app.classList.toggle('sidebar-expanded', expanded);
    if (_toggleBtn) _toggleBtn.title = expanded ? 'Recolher menu' : 'Expandir menu';
    try { localStorage.setItem('projetudo.sidebarExpanded', expanded ? '1' : '0'); } catch(e){}
  };
  // Restaura estado salvo (padrão: expandida)
  try {
    const saved = localStorage.getItem('projetudo.sidebarExpanded');
    applySidebarExpanded(saved !== '0'); // abre por padrão, fecha só se explicitamente fechada
  } catch(e){ applySidebarExpanded(true); }
  _toggleBtn?.addEventListener('click', () => {
    applySidebarExpanded(!_app.classList.contains('sidebar-expanded'));
  });

  // Sininho de notificações — navega para a view de notificações e limpa contadores
  const bell = $('#topbarBell');
  if (bell) bell.addEventListener('click', () => {
    State.realtimeUnread = 0;
    if (State.myMentions.length > 0) {
      UI.openMentionsModal();
    } else {
      State.currentView = 'notifications';
      UI.setActiveNav('notifications');
      UI.render();
    }
  });

  // Logout
  $('#logoutBtn').addEventListener('click', async () => {
    if (!await Dialog.confirm({ title: 'Sair', msg: 'Encerrar a sessão e sair da sua conta?', confirmText: 'Sair' })) return;
    await Auth.signOut();
    location.reload();
  });

  // Modal
  $('#modalClose').addEventListener('click', () => Modal.close());
  // Backdrop NÃO fecha ao clicar fora — deve usar Salvar/Cancelar/X
  // (o click no backdrop é swallowed propositalmente)
  $('#modalBackdrop').addEventListener('click', (e) => { e.stopPropagation(); });
  // Cursor de "não pode" no backdrop para comunicar o bloqueio
  $('#modalBackdrop').style.cursor = 'default';
  // Avisa o usuário se tentar fechar a aba/janela com alterações não salvas
  window.addEventListener('beforeunload', (e) => {
    if (Modal.isDirty()) {
      e.preventDefault();
      e.returnValue = '';
    }
  });

  // Estado para sequência de atalhos (ex.: G+D, G+T, G+C)
  let _seqBuffer = '';
  let _seqTimer = null;
  const _resetSeq = () => { _seqBuffer = ''; if (_seqTimer) { clearTimeout(_seqTimer); _seqTimer = null; } };
  const _goto = (view) => {
    if (Views[view]) {
      State.currentView = view;
      UI.setActiveNav(view);
      UI.render();
    }
  };

  document.addEventListener('keydown', (e) => {
    // Ignora atalhos quando usuário está digitando em input/textarea/contentEditable
    const tag = (e.target?.tagName || '').toLowerCase();
    const isTyping = tag === 'input' || tag === 'textarea' || tag === 'select' || e.target?.isContentEditable;

    if (e.key === 'Escape') { GlobalSearch.close(); _resetSeq(); /* Esc NÃO fecha modal */ }
    if ((e.metaKey || e.ctrlKey) && e.key === 'k') { e.preventDefault(); GlobalSearch.open(); return; }

    // Ctrl+Enter: salva form do modal aberto (procura botão btnSave* ou btn-cta no footer)
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      const isModalOpen = $('#modalBackdrop')?.classList.contains('active');
      if (isModalOpen) {
        const saveBtn = $('#modal .modal-foot .btn-cta') || document.querySelector('#modal [id^="btnSave"]');
        if (saveBtn) { e.preventDefault(); saveBtn.click(); return; }
      }
    }

    if (isTyping) return;

    // "?" abre atalhos
    if (e.key === '?' && !e.metaKey && !e.ctrlKey && !e.altKey) {
      e.preventDefault(); KeyboardShortcuts.open(); return;
    }

    // Sequência G+X (estilo Linear/GitHub)
    if (e.key === 'g' || e.key === 'G') {
      _seqBuffer = 'g';
      _seqTimer = setTimeout(_resetSeq, 1200);
      return;
    }
    if (_seqBuffer === 'g') {
      const map = { d: 'dashboard', t: 'tasks', c: 'gantt', s: 'health', r: 'relatorio' };
      const view = map[e.key.toLowerCase()];
      if (view) { e.preventDefault(); _goto(view); }
      _resetSeq();
      return;
    }
  });

  // Busca Global
  $('#btnSearch').addEventListener('click', () => GlobalSearch.open());
  $('#searchOverlay').addEventListener('click', (e) => { if (e.target.id === 'searchOverlay') GlobalSearch.close(); });
  $('#searchInput').addEventListener('input', (e) => GlobalSearch.render(e.target.value));

  // ── PWA: Service Worker + prompt de instalação ──────────────────────────
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(() => {/* silencioso se sw.js não existir */});
  }
  // Captura o evento beforeinstallprompt para exibir botão de instalação
  let _pwaInstallEvent = null;
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    _pwaInstallEvent = e;
    // Mostra botão flutuante de instalação
    const btn = document.createElement('button');
    btn.id = 'pwaInstallBtn';
    btn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg> Instalar App`;
    btn.style.cssText = 'position:fixed;bottom:20px;right:20px;z-index:9999;background:var(--accent);color:var(--bg-deep);border:none;border-radius:3px;padding:10px 16px;font-size:12px;font-weight:700;font-family:var(--font-display);cursor:pointer;display:flex;align-items:center;gap:8px;box-shadow:0 4px 16px rgba(0,0,0,0.4);animation:modalIn .3s ease;';
    btn.onclick = async () => {
      _pwaInstallEvent.prompt();
      const { outcome } = await _pwaInstallEvent.userChoice;
      if (outcome === 'accepted') { btn.remove(); toast('App instalado com sucesso!', 'success'); }
      _pwaInstallEvent = null;
    };
    document.body.appendChild(btn);
  });
  window.addEventListener('appinstalled', () => {
    document.getElementById('pwaInstallBtn')?.remove();
    toast('CadêOProjeto instalado como app!', 'success');
  });

  // Boot sequence
  setSplashText('Verificando configuração...');
  const cfg = Config.load();
  if (cfg.url && cfg.key) {
    setSplashText('Conectando ao banco...');
    await initSupabase(cfg.url, cfg.key);
  } else {
    await showConfig();
  }
});
