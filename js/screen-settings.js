// Tela Configurações e backup
import { Auth } from './auth.js';
import { DB, setupRealtime } from './db.js';
import { Dialog } from './dialog.js';
import { setLoading, toast } from './feedback.js';
import { $, Holidays, escapeHtml, today } from './helpers.js';
import { Modal } from './modal.js';
import { MSPX } from './mspx.js';
import { State } from './state.js';
import { UI } from './ui.js';
import { Views } from './views.js';

// Plugado em Views: continuam acessíveis como Views.<método> e this.<método>.
Object.assign(Views, {
  settings() {
    return `
      <div class="page-title-block"><div class="page-eyebrow">CONFIGURAÇÕES</div><div class="page-title">Preferências</div></div>

      <div class="panel">
        <div class="panel-head"><div class="panel-title">Conta</div></div>
        <div class="panel-body">
          <div class="form-row" style="align-items:flex-end;">
            <div class="form-group" style="flex:1;">
              <label class="form-label">Nome</label>
              <input class="form-input" id="settingsNameInput" value="${escapeHtml(State.profile?.full_name || '')}" placeholder="Seu nome completo" autocomplete="off">
            </div>
            <div class="form-group" style="flex:1;">
              <label class="form-label">E-mail</label>
              <input class="form-input" value="${escapeHtml(State.user.email)}" disabled>
            </div>
            <div class="form-group" style="flex:0;">
              <button class="btn btn-cta" id="btnSaveName" style="white-space:nowrap;">Salvar nome</button>
            </div>
          </div>
        </div>
      </div>

      <div class="panel" style="margin-top:14px;">
        <div class="panel-head">
          <div class="panel-title">Automações</div>
          <div class="panel-title-mono">${(() => { const a = State.automation || {}; const on = (a.archiveDoneDays > 0 ? 1 : 0) + (a.promotePriorityNearDeadline ? 1 : 0) + (a.stalledAlertDays > 0 ? 1 : 0) + (a.autoPpcOnComplete ? 1 : 0) + (a.assignByDiscipline ? 1 : 0); return on + ' / 5 ativas'; })()}</div>
        </div>
        <div class="panel-body">
          <div style="font-size:12px;color:var(--ink-soft);margin-bottom:14px;">Regras prontas que rodam automaticamente. As preferências ficam só no seu navegador.</div>
          ${(() => {
            const a = State.automation || {};
            const row = (icon, title, desc, control) => `
              <div style="display:flex;align-items:flex-start;gap:12px;padding:12px 0;border-bottom:1px solid var(--border);">
                <div style="font-size:18px;line-height:1;flex-shrink:0;margin-top:2px;">${icon}</div>
                <div style="flex:1;min-width:0;">
                  <div style="font-size:13px;font-weight:600;">${title}</div>
                  <div style="font-size:11px;color:var(--ink-mute);margin-top:2px;">${desc}</div>
                </div>
                <div style="flex-shrink:0;">${control}</div>
              </div>`;
            const toggle = (key, on) => `
              <label style="display:inline-flex;align-items:center;gap:6px;cursor:pointer;user-select:none;">
                <input type="checkbox" class="auto-toggle" data-auto-key="${key}" ${on ? 'checked' : ''}>
                <span style="font-family:var(--font-mono);font-size:10px;color:${on ? 'var(--accent-success)' : 'var(--ink-mute)'};text-transform:uppercase;">${on ? 'ON' : 'OFF'}</span>
              </label>`;
            const num = (key, val) => `
              <input type="number" class="form-input auto-num" data-auto-key="${key}" min="0" max="365" value="${val}" style="width:70px;font-size:12px;padding:4px 6px;text-align:right;">`;
            return `
              ${row('🗂', 'Arquivar concluídas há N dias', 'Tarefas concluídas há N ou mais dias somem da Lista/Kanban/Tabela (continuam no Gantt e nos relatórios). 0 = desligado.', num('archiveDoneDays', a.archiveDoneDays || 0))}
              ${row('⏫', 'Promover prioridade perto do prazo', 'Tarefa com prazo ≤ 3 dias e ainda não concluída vira Alta (visual no card). Não altera o banco.', toggle('promotePriorityNearDeadline', !!a.promotePriorityNearDeadline))}
              ${row('🐢', 'Aviso de tarefa parada (stalled)', 'Tarefa "Em Andamento" sem alteração há N dias ganha um aviso visual. 0 = desligado.', num('stalledAlertDays', a.stalledAlertDays || 0))}
              ${row('✓', 'Auto-PPC ao concluir tarefa', 'Quando você marca uma tarefa como Concluída, o compromisso da semana no Last Planner vira "Cumprida" automaticamente.', toggle('autoPpcOnComplete', !!a.autoPpcOnComplete))}
              ${row('👤', 'Atribuir responsável por disciplina', 'Ao criar uma tarefa com disciplina e sem responsável definido, o líder técnico da disciplina é atribuído.', toggle('assignByDiscipline', !!a.assignByDiscipline))}`;
          })()}
        </div>
      </div>

      <div class="panel" style="margin-top:14px;">
        <div class="panel-head">
          <div class="panel-title">Labels do Projeto Atual</div>
          <div class="panel-title-mono">${State.labels.length} / 15</div>
        </div>
        <div class="panel-body">
          ${!State.currentProjectId ? `<div style="color:var(--ink-mute);font-size:12px;">Selecione um projeto para gerenciar labels.</div>` : `
            <div style="font-size:12px;color:var(--ink-soft);margin-bottom:14px;">Labels servem para classificar tarefas (ex.: "Urgente", "Externo", "Bloqueio Interno"). Cada projeto pode ter até 15 labels.</div>
            <div id="labelsList" style="display:flex;flex-direction:column;gap:8px;margin-bottom:14px;">
              ${State.labels.length === 0 ? `<div style="color:var(--ink-mute);font-size:12px;font-style:italic;">Nenhuma label criada ainda.</div>` :
                State.labels.map(lab => {
                  const usageCount = State.taskLabels.filter(tl => tl.label_id === lab.id).length;
                  return `
                    <div style="display:flex;align-items:center;gap:10px;padding:8px 12px;background:var(--bg-deep);border:1px solid var(--border);border-radius:2px;">
                      <div style="width:14px;height:14px;border-radius:2px;background:${escapeHtml(lab.color)};flex-shrink:0;"></div>
                      <div style="flex:1;font-size:13px;font-weight:600;">${escapeHtml(lab.name)}</div>
                      <div style="font-family:var(--font-mono);font-size:10px;color:var(--ink-mute);">${usageCount} ${usageCount === 1 ? 'tarefa' : 'tarefas'}</div>
                      <button class="icon-btn" data-action="edit-label" data-id="${lab.id}" title="Editar">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                      </button>
                      <button class="icon-btn danger" data-action="delete-label" data-id="${lab.id}" title="Excluir">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/></svg>
                      </button>
                    </div>
                  `;
                }).join('')
              }
            </div>
            <button class="btn btn-secondary" data-action="new-label" ${State.labels.length >= 15 ? 'disabled' : ''}>
              ${State.labels.length >= 15 ? 'Limite de 15 labels atingido' : '+ Nova Label'}
            </button>
          `}
        </div>
      </div>

      <div class="panel" style="margin-top:14px;">
        <div class="panel-head"><div class="panel-title">Folgas e Feriados</div><div class="panel-title-mono">dias não úteis</div></div>
        <div class="panel-body">
          <p style="font-size:12px;color:var(--ink-soft);margin-bottom:12px;">Cadastre feriados, férias e outros dias não úteis. Para um <strong>período</strong> (feriado prolongado, férias), preencha o <strong>Término</strong>. Esses dias são excluídos do cálculo de <strong>dias úteis</strong> nas tarefas.</p>
          <div style="display:flex;gap:8px;align-items:flex-end;margin-bottom:12px;flex-wrap:wrap;">
            <div class="form-group" style="flex:0 0 140px;margin-bottom:0;">
              <label class="form-label">Início</label>
              <input class="form-input" type="date" id="holidayDateInput">
            </div>
            <div class="form-group" style="flex:0 0 140px;margin-bottom:0;">
              <label class="form-label">Término <span style="color:var(--ink-mute);font-weight:400;">(opcional)</span></label>
              <input class="form-input" type="date" id="holidayEndInput" title="Deixe vazio para um único dia. Preencha para períodos (férias, feriado prolongado).">
            </div>
            <div class="form-group" style="flex:1;min-width:150px;margin-bottom:0;">
              <label class="form-label">Descrição</label>
              <input class="form-input" id="holidayNameInput" placeholder="Ex.: Natal, Carnaval, Férias…" autocomplete="off">
            </div>
            <button class="btn btn-cta" data-action="add-holiday" style="flex-shrink:0;white-space:nowrap;">+ Adicionar</button>
          </div>
          <div id="holidayList" style="max-height:220px;overflow-y:auto;border:1px solid var(--border);border-radius:4px;">${Holidays.listHtml()}</div>
        </div>
      </div>

      <div class="panel" style="margin-top:14px;">
        <div class="panel-head"><div class="panel-title">Dados</div><div class="panel-title-mono">backup · lgpd art. 18</div></div>
        <div class="panel-body">
          <p style="color:var(--ink-soft);font-size:13px;margin-bottom:14px;">Backup completo: o JSON inclui <strong>projetos, tarefas, dependências, disciplinas, restrições, RACI, etiquetas, comentários e Last Planner</strong>. Faça backups regulares — e você pode restaurar a qualquer momento importando o arquivo.</p>
          <div style="display:flex;gap:8px;flex-wrap:wrap;">
            <button class="btn btn-secondary" data-action="export-data">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
              Exportar Backup Completo (JSON + Excel + XML)
            </button>
            <button class="btn btn-secondary" data-action="import-data">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
              Importar / restaurar backup
            </button>
          </div>
          <div class="lgpd-notice" style="margin-top:12px;">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
            <span>Direito LGPD (Art. 18): você pode solicitar acesso, correção ou exclusão dos seus dados a qualquer momento. Dados pessoais coletados: <strong>nome</strong> e <strong>e-mail</strong>.</span>
          </div>
        </div>
      </div>

      <div class="panel danger-zone" style="margin-top:14px;">
        <div class="panel-head">
          <div class="panel-title">Zona de Perigo</div>
          <div class="panel-title-mono" style="color:var(--accent-danger);">ação irreversível</div>
        </div>
        <div class="panel-body">
          <p style="font-size:13px;color:var(--ink-soft);margin-bottom:16px;">
            A exclusão remove <strong style="color:var(--ink);">todos os seus projetos, tarefas, entregáveis, disciplinas e membros de equipe</strong>. Esta ação não pode ser desfeita.<br>
            <span style="font-size:11px;color:var(--ink-mute);font-family:var(--font-mono);margin-top:4px;display:block;">Conforme LGPD Art. 18, VI — o titular tem direito à eliminação dos dados.</span>
          </p>
          <button class="btn" data-action="delete-account" style="background:rgba(193,59,18,0.1);border:1px solid rgba(193,59,18,0.4);color:var(--accent-danger);font-size:12px;font-weight:600;">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M10 11v6"/><path d="M14 11v6"/></svg>
            Excluir minha conta e todos os dados
          </button>
        </div>
      </div>

      <div style="text-align:center;margin-top:30px;font-family:var(--font-mono);font-size:11px;color:var(--ink-mute);letter-spacing:0.1em;">
        CADÊOPROJETO v3.0 · POSTGRESQL · LGPD COMPLIANT · GRATUITO PARA A COMUNIDADE<br>
        <span style="font-size:10px;margin-top:4px;display:block;">
          <a data-action="open-privacy-modal" style="color:var(--ink-mute);text-decoration:none;cursor:pointer;" onmouseover="this.style.color='var(--accent)'" onmouseout="this.style.color='var(--ink-mute)'">Política de Privacidade</a>
          &nbsp;·&nbsp;
          <a data-action="open-terms-modal" style="color:var(--ink-mute);text-decoration:none;cursor:pointer;" onmouseover="this.style.color='var(--accent)'" onmouseout="this.style.color='var(--ink-mute)'">Termos de Uso</a>
        </span>
      </div>
    `;
  },
});

// Plugado em UI: continuam acessíveis como UI.<método> e this.<método>.
Object.assign(UI, {
  async exportData() {
    setLoading(true);
    try {
      const dateStr = today();
      const email = (State.user?.email || 'user').replace(/[^a-z0-9]/gi, '_');

      // ── 1. Coleta todos os projetos ──────────────────────────────────────────
      const out = {
        format: 'cadeoprojeto-backup', version: 2,
        exported_at: new Date().toISOString(),
        user: State.user?.email,
        holidays: Holidays.load(),
        projects: [],
      };
      for (const proj of State.projects) {
        out.projects.push(await DB.exportProjectFull(proj.id));
      }
      const totalTasks = out.projects.reduce((s, p) => s + (p.tasks?.length || 0), 0);

      // ── 2. JSON ───────────────────────────────────────────────────────────────
      this._dlBlob(
        new Blob([JSON.stringify(out, null, 2)], { type: 'application/json' }),
        `cadeoprojeto-backup-${email}-${dateStr}.json`
      );

      // ── 3. Excel (.xlsx via SheetJS CDN) ─────────────────────────────────────
      await new Promise((resolve, reject) => {
        if (window.XLSX) { resolve(); return; }
        const s = document.createElement('script');
        s.src = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';
        // SRI: garante que o script do CDN não foi adulterado
        s.integrity = 'sha384-vtjasyidUo0kW94K5MXDXntzOJpQgBKXmE7e2Ga4LG0skTTLeBi97eFAXsqewJjw';
        s.crossOrigin = 'anonymous';
        s.onload = resolve; s.onerror = reject;
        document.head.appendChild(s);
      });
      const wb = window.XLSX.utils.book_new();
      for (const pd of out.projects) {
        const proj = pd.project || {};
        const rows = (pd.tasks || []).map(tk => ({
          Código: tk.code || '',
          Título: tk.title || '',
          Status: tk.status || '',
          Prioridade: tk.priority || '',
          Início: tk.start_date || '',
          Término: tk.end_date || '',
          'Progresso (%)': parseFloat(tk.progress) || 0,
          'Custo Previsto (R$)': tk.cost || '',
          Responsável: (State.teamMembers || []).find(m => m.id === tk.assignee_id)?.name || '',
          Disciplina: (State.disciplines || []).find(d => d.id === tk.discipline_id)?.name || '',
          Setor: tk.sector || '',
          Marco: tk.is_milestone ? 'Sim' : 'Não',
        }));
        if (rows.length > 0) {
          const ws = window.XLSX.utils.json_to_sheet(rows);
          const sheetName = (proj.name || 'Projeto').replace(/[\\\/\?\*\[\]:]/g, '_').slice(0, 31);
          window.XLSX.utils.book_append_sheet(wb, ws, sheetName);
        }
      }
      if (wb.SheetNames.length > 0) {
        const xlsxBuffer = window.XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
        this._dlBlob(
          new Blob([xlsxBuffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }),
          `cadeoprojeto-tarefas-${email}-${dateStr}.xlsx`
        );
      }

      // ── 4. MS Project XML (projeto atual) ────────────────────────────────────
      if (State.tasks.length > 0 && window.MSPX) {
        const project = Views.current();
        const xml = MSPX.serialize(project, State.tasks, State.dependencies, State.members || State.teamMembers || []);
        const safeName = (project?.name || 'projeto').replace(/[^a-z0-9]/gi, '_');
        this._dlBlob(
          new Blob([xml], { type: 'application/xml' }),
          `cadeoprojeto-msproject-${safeName}-${dateStr}.xml`
        );
      }

      toast(`Backup exportado · ${out.projects.length} projeto(s), ${totalTasks} tarefas · JSON + Excel + XML`, 'success');
    } catch (err) { console.error(err); toast('Erro ao exportar: ' + err.message, 'error'); }
    finally { setLoading(false); }
  },

  importData() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,application/json';
    input.onchange = async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      let parsed;
      try { parsed = JSON.parse(await file.text()); }
      catch (err) { toast('Arquivo JSON inválido', 'error'); return; }
      const projects = parsed.projects || [];
      if (!Array.isArray(projects) || projects.length === 0) { toast('Nenhum projeto encontrado no arquivo', 'error'); return; }
      const isV2 = parsed.format === 'cadeoprojeto-backup' || projects[0]?.tasks !== undefined;
      // Modal de confirmação
      const rows = projects.map((p, i) => {
        const pr = p.project || p;
        const nt = (p.tasks || []).length;
        return `<label style="display:flex;align-items:center;gap:10px;padding:8px 10px;border-bottom:1px solid var(--border);cursor:pointer;font-size:12px;">
          <input type="checkbox" class="imp-proj-chk" data-idx="${i}" checked>
          <div style="flex:1;min-width:0;">
            <div style="font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(pr.name || 'Projeto ' + (i + 1))}</div>
            <div style="font-family:var(--font-mono);font-size:10px;color:var(--ink-mute);">${nt} tarefas · ${(p.disciplines || []).length} disc · ${(p.restrictions || []).length} restr · ${(p.dependencies || []).length} dep</div>
          </div>
        </label>`;
      }).join('');
      Modal.open({
        title: 'Importar backup',
        cls: 'modal-wide',
        body: `
          <div style="font-size:12px;color:var(--ink-soft);margin-bottom:12px;">
            Cada projeto selecionado será recriado como um <strong>novo projeto</strong> (sufixo "(importado)"), sem afetar os existentes.
            ${!isV2 ? '<br><span style="color:var(--accent-warm);">⚠ Arquivo de formato antigo: dependências, restrições, RACI e Last Planner podem não estar incluídos.</span>' : ''}
          </div>
          <div style="max-height:46vh;overflow-y:auto;border:1px solid var(--border);border-radius:4px;">${rows}</div>
          <div style="font-size:11px;color:var(--ink-mute);margin-top:8px;">Comentários são reatribuídos a você. Responsáveis/líderes são mantidos só se o membro existir na sua conta.</div>
        `,
        footer: `<button class="btn btn-secondary" id="btnCancelImport">Cancelar</button><button class="btn btn-cta" id="btnConfirmImport">Importar selecionados</button>`,
      });
      $('#btnCancelImport').onclick = () => Modal.close();
      $('#btnConfirmImport').onclick = async () => {
        const idxs = [...document.querySelectorAll('.imp-proj-chk:checked')].map(c => parseInt(c.dataset.idx));
        if (idxs.length === 0) { toast('Selecione ao menos um projeto', 'error'); return; }
        Modal.close();
        setLoading(true);
        let ok = 0, fail = 0;
        for (const i of idxs) {
          try {
            await DB.importProjectFull(projects[i]);
            ok++;
          } catch (err) { console.error('import falhou:', err); fail++; }
        }
        // Recarrega lista de projetos e abre o último importado
        try {
          State.projects = await DB.listProjects();
          if (State.projects[0]) { State.currentProjectId = State.projects[0].id; await DB.loadCurrentProject(); setupRealtime(); }
        } catch (e) { console.warn('[import] recarga pós-importação falhou:', e.message); }
        State.currentView = 'projects'; UI.setActiveNav('projects');
        await UI.render();
        setLoading(false);
        toast(`Importação concluída · ${ok} projeto(s)${fail ? `, ${fail} falha(s)` : ''}`, fail ? 'warning' : 'success');
      };
    };
    input.click();
  },

  async confirmDeleteAccount() {
    const step1 = await Dialog.confirm({ title: '⚠ Excluir conta', msg: 'Esta ação é IRREVERSÍVEL.\n\nSerão excluídos permanentemente:\n• Todos os seus projetos\n• Todas as tarefas e entregáveis\n• Todos os membros de equipe cadastrados\n• Todas as disciplinas, RACI, aprovações', confirmText: 'Continuar', danger: true });
    if (!step1) return;
    const step2 = await Dialog.confirm({ title: 'Confirmação final', msg: 'Para excluir sua conta de forma permanente, digite a palavra abaixo:', confirmText: 'Excluir minha conta', danger: true, requireType: 'EXCLUIR' });
    if (!step2) { toast('Exclusão cancelada', 'warning'); return; }

    setLoading(true);
    try {
      const sb = State.supabase;
      const uid = State.user.id;
      // Apaga dados na ordem correta (cascata via FK, mas garantindo)
      // 1. Tarefas e dependências (cascade do projeto)
      // 2. Entregáveis, RACI, aprovações (cascade)
      // 3. Projetos (cascade para tudo acima via ON DELETE CASCADE)
      for (const proj of State.projects) {
        await sb.from('tasks').delete().eq('project_id', proj.id);
        await sb.from('restrictions').delete().eq('project_id', proj.id);
        await sb.from('disciplines').delete().eq('project_id', proj.id);
        await sb.from('project_allocations').delete().eq('project_id', proj.id);
        await sb.from('projects').delete().eq('id', proj.id);
      }
      // 4. Membros globais de equipe
      await sb.from('team_members').delete().eq('owner_id', uid);
      // 5. Chama RPC para deletar o próprio usuário (requer a migration de segurança)
      const { error: rpcError } = await sb.rpc('delete_my_account');
      if (rpcError) {
        // Se a função não existir ainda, apenas desloga e avisa
        toast('Dados excluídos. Execute o SQL "14-lgpd-delete-account.sql" para completar a exclusão do login.', 'warning');
      } else {
        toast('Conta excluída com sucesso', 'success');
      }
      await Auth.signOut();
      setTimeout(() => location.reload(), 1500);
    } catch (err) {
      toast('Erro ao excluir: ' + err.message, 'error');
    } finally {
      setLoading(false);
    }
  },
});
