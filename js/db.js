// Camada de acesso a dados (Supabase) e realtime
import { $, addDays, rolledProgress, snapTaskDates, today } from './helpers.js';
import { CPMCache, dependencyCycle } from './cpm.js';
import { toast } from './feedback.js';
import { State } from './state.js';
import { UI } from './ui.js';

// ---------- DATA ACCESS LAYER ----------
export const DB = {
  async pageAll(buildQuery, pageSize = 1000) {
    const rows = [];
    for (let from = 0; ; from += pageSize) {
      const { data, error } = await buildQuery().range(from, from + pageSize - 1);
      if (error) throw error;
      rows.push(...(data || []));
      if (!data || data.length < pageSize) return rows;
    }
  },
  async listProjects() {
    return this.pageAll(() => State.supabase.from('projects').select('*')
      .order('created_at', { ascending: false }).order('id'));
  },

  async createProject({ name, client, start_date, end_date }) {
    const { data, error } = await State.supabase
      .from('projects')
      .insert({ owner_id: State.user.id, name, client, start_date, end_date })
      .select().single();
    if (error) throw error;
    return data;
  },

  async updateProject(id, patch) {
    const { error } = await State.supabase.from('projects').update(patch).eq('id', id);
    if (error) throw error;
  },

  async deleteProject(id) {
    const { error } = await State.supabase.from('projects').delete().eq('id', id);
    if (error) throw error;
  },


  async listTasks(projectId) {
    // Ordena por order_index (posição explícita); created_at como desempate/legado.
    return this.pageAll(() => State.supabase.from('tasks').select('*').eq('project_id', projectId)
      .order('order_index', { ascending: true, nullsFirst: true })
      .order('created_at', { ascending: true }).order('id'));
  },

  async allocateTaskCodes(projectId, count) {
    const codes = [];
    while (codes.length < count) {
      const size = Math.min(500, count - codes.length);
      const { data, error } = await State.supabase.rpc('allocate_task_codes', {
        p_project_id: projectId, p_count: size
      });
      if (error) throw new Error('Migração de códigos de tarefas pendente (migrations/001-integrity.sql): ' + error.message);
      if (!Array.isArray(data) || data.length !== size) throw new Error('Falha ao reservar códigos de tarefas.');
      codes.push(...data);
    }
    return codes;
  },

  // Conflito no índice único (project_id, code): o contador do banco ficou atrás de códigos já usados
  // (ex.: tarefas criadas por versão antiga do app depois da migração). Nova reserva já avança o contador.
  _isCodeConflict(err) {
    return !!err && err.code === '23505' && /tasks_project_code_unique|\(project_id, code\)/i.test(`${err.message || ''} ${err.details || ''}`);
  },

  async createTask(projectId, t) {
    for (let attempt = 0; ; attempt++) {
      const [code] = await this.allocateTaskCodes(projectId, 1);
      const payload = { project_id: projectId, ...t, code: t.code || code };
      // order_index padrão (vai para o fim) se não foi informado — usa epoch (ms), bem acima do backfill
      if (payload.order_index === undefined || payload.order_index === null) payload.order_index = Date.now();
      let { data, error } = await State.supabase
        .from('tasks').insert(payload).select().single();
      // fallback: se a coluna order_index ainda não existe (migration 27 não rodou)
      if (error && /order_index|column/i.test(error.message || '')) {
        delete payload.order_index;
        ({ data, error } = await State.supabase.from('tasks').insert(payload).select().single());
      }
      if (!error) return data;
      if (this._isCodeConflict(error) && !t.code && attempt < 8) {
        console.warn('[createTask] código', payload.code, 'já existe; reservando outro (tentativa', attempt + 1, ')');
        continue;
      }
      throw error;
    }
  },

  async updateTask(id, patch) {
    // Capture before-state for audit log (silently — task may not be in State yet)
    const existing = State.tasks.find(t => t.id === id);
    const { error } = await State.supabase.from('tasks').update(patch).eq('id', id);
    if (error) throw error;
    // Invalida cache de CPM em mudanças estruturais (datas, deps, parent)
    if (patch.start_date !== undefined || patch.end_date !== undefined ||
        patch.parent_id !== undefined || patch.constraint_type !== undefined ||
        patch.constraint_date !== undefined) CPMCache.invalidate();
    // Auto-log the diff (silent — table may not exist yet)
    if (existing) {
      const tracked = ['status','priority','progress','title','start_date','end_date','assignee_id','discipline_id'];
      const changes = {};
      tracked.forEach(f => {
        if (patch[f] !== undefined) {
          const ov = existing[f] != null ? String(existing[f]) : null;
          const nv = patch[f]   != null ? String(patch[f])    : null;
          if (ov !== nv) changes[f] = { from: existing[f], to: patch[f] };
        }
      });
      if (Object.keys(changes).length) DB.logTaskChange(id, changes);
    }
  },

  // PERF: atualização em lote — colapsa N PATCHs (recálculo de cronograma,
  // ajuste de linha de base) numa quantidade mínima de chamadas.
  // SEGURANÇA DE DADOS: o upsert em massa exige colunas uniformes, senão o
  // PostgREST preenche as colunas ausentes com NULL. Por isso agrupamos os
  // updates por ASSINATURA DE CHAVES (mesmo conjunto de campos) e enviamos um
  // upsert por grupo — cada linha do grupo tem exatamente as mesmas colunas,
  // então só os campos informados são tocados. Nenhuma outra coluna é alterada.
  async updateTasksBatch(updates) {
    if (!updates?.length) return;
    // Usa UPDATE por id (NÃO upsert). O upsert vira INSERT…ON CONFLICT e exige as
    // colunas NOT NULL (code, title, project_id…) que o patch não traz → "null value
    // in column code". O UPDATE simples só altera as colunas do patch, usa o project_id
    // já existente na linha (policy de UPDATE passa) e não toca o resto.
    // Paraleliza em lotes para não abrir centenas de conexões de uma vez.
    let structural = false;
    const valid = updates.filter(u => u && u.id && Object.keys(u).some(k => k !== 'id'));
    const CHUNK = 50;
    for (let i = 0; i < valid.length; i += CHUNK) {
      const chunk = valid.slice(i, i + CHUNK);
      await Promise.all(chunk.map(u => {
        const { id, ...patch } = u;
        if (/start_date|end_date|parent_id|constraint_type|constraint_date/.test(Object.keys(patch).join(','))) structural = true;
        return State.supabase.from('tasks').update(patch).eq('id', id)
          .then(({ error }) => { if (error) throw error; });
      }));
    }
    if (structural) CPMCache.invalidate();
  },

  async deleteTask(id) {
    const { error } = await State.supabase.from('tasks').delete().eq('id', id);
    if (error) throw error;
    CPMCache.invalidate();
  },

  // PERF: criação em lote — única chamada de INSERT para várias tarefas.
  // Gera códigos sequenciais T-XXX. Retorna o array criado (mesma ordem do payload).
  async createTasksBatch(projectId, tasksData) {
    if (!tasksData?.length) return [];
    const epoch = Date.now();
    // Estratégia de tentativa: lote completo; se falhar por coluna ausente,
    // strip do campo problemático e retentar (mesma resiliência do importer).
    const _try = async (payload) => {
      const { data, error } = await State.supabase.from('tasks').insert(payload).select();
      if (error) throw error;
      return data;
    };
    const optional = ['parent_id', 'baseline_start', 'baseline_end', 'cost', 'is_milestone', 'inactive', 'order_index', 'constraint_type', 'constraint_date'];
    for (let attempt = 0; ; attempt++) {
      const codes = await this.allocateTaskCodes(projectId, tasksData.length);
      const rows = tasksData.map((t, i) => ({
        project_id: projectId,
        order_index: epoch + i,
        ...t,
        code: t.code || codes[i],
      }));
      try {
        const data = await _try(rows);
        CPMCache.invalidate();
        return data;
      } catch (err) {
        // Conflito de código: reserva novo bloco (o contador do banco avança a cada reserva)
        if (this._isCodeConflict(err) && !tasksData.some(t => t.code) && attempt < 8) {
          console.warn('[createTasksBatch] conflito de código; reservando novo bloco (tentativa', attempt + 1, ')');
          continue;
        }
        const msg = err.message || '';
        const dropped = [];
        for (const col of optional) {
          if (msg.includes(col)) { rows.forEach(r => delete r[col]); dropped.push(col); }
        }
        if (dropped.length) {
          console.warn('[createTasksBatch] removendo colunas ausentes no banco:', dropped.join(', '));
          const data = await _try(rows);
          CPMCache.invalidate();
          return data;
        }
        throw err;
      }
    }
  },

  // ===== TASK DEPENDENCIES (FS/SS/FF/SF) =====
  async listDependencies(projectId) {
    // Busca dependências de tarefas pertencentes ao projeto
    const ids = (await this.pageAll(() => State.supabase.from('tasks').select('id')
      .eq('project_id', projectId).order('id'))).map(t => t.id);
    if (ids.length === 0) return [];
    const all = [];
    for (let i = 0; i < ids.length; i += 100) {
      const batch = ids.slice(i, i + 100);
      all.push(...await this.pageAll(() => State.supabase.from('task_dependencies')
        .select('*').in('task_id', batch).order('id')));
    }
    return all;
  },
  async listBaselines(projectId) {
    const { data, error } = await State.supabase.from('project_baselines').select('*')
      .eq('project_id', projectId).order('slot');
    if (error) throw new Error('Migração de linhas de base pendente (migrations/001-integrity.sql): ' + error.message);
    return (data || []).map(b => ({ slot: b.slot, set_at: b.set_at, tasks: b.tasks }));
  },
  async saveBaseline(projectId, snapshot) {
    const { error } = await State.supabase.from('project_baselines').upsert({
      project_id: projectId, slot: snapshot.slot, set_at: snapshot.set_at,
      tasks: snapshot.tasks, created_by: State.user.id
    }, { onConflict: 'project_id,slot' });
    if (error) throw error;
  },
  async deleteBaseline(projectId, slot) {
    const { error } = await State.supabase.from('project_baselines').delete()
      .eq('project_id', projectId).eq('slot', slot);
    if (error) throw error;
  },
  async createDependency(d) {
    if (State.tasks.some(t => t.id === d.task_id) && State.tasks.some(t => t.id === d.predecessor_id) &&
        dependencyCycle(State.tasks, State.dependencies.concat(d))) {
      throw new Error('Dependência circular: vínculo não foi salvo.');
    }
    const { data, error } = await State.supabase
      .from('task_dependencies').insert(d).select().single();
    if (error) throw error;
    CPMCache.invalidate();
    return data;
  },
  async deleteDependency(id) {
    const { error } = await State.supabase.from('task_dependencies').delete().eq('id', id);
    if (error) throw error;
    CPMCache.invalidate();
  },

  // ===== NOTIFICATION PREFERENCES =====
  async getNotifPrefs() {
    if (!State.user) return null;
    const { data, error } = await State.supabase
      .from('notification_preferences').select('*').eq('user_id', State.user.id).maybeSingle();
    if (error) throw error;
    return data;
  },
  async upsertNotifPrefs(patch) {
    const payload = { user_id: State.user.id, ...patch, updated_at: new Date().toISOString() };
    const { data, error } = await State.supabase
      .from('notification_preferences').upsert(payload, { onConflict: 'user_id' })
      .select().single();
    if (error) throw error;
    return data;
  },

  // ===== LABELS =====
  async listLabels(projectId) {
    const { data, error } = await State.supabase
      .from('labels').select('*').eq('project_id', projectId).order('name');
    if (error) throw error;
    return data || [];
  },
  async createLabel(projectId, name, color) {
    const { data, error } = await State.supabase
      .from('labels').insert({ project_id: projectId, name, color }).select().single();
    if (error) throw error;
    return data;
  },
  async updateLabel(id, patch) {
    const { data, error } = await State.supabase
      .from('labels').update(patch).eq('id', id).select().single();
    if (error) throw error;
    return data;
  },
  async deleteLabel(id) {
    const { error } = await State.supabase.from('labels').delete().eq('id', id);
    if (error) throw error;
  },
  // Junção tarefa↔label
  async listTaskLabels(projectId) {
    // Lista todos task_labels de todas as tarefas do projeto
    const taskIds = State.tasks.map(t => t.id);
    if (taskIds.length === 0) return [];
    const all = [];
    for (let i = 0; i < taskIds.length; i += 100) {
      all.push(...await this.pageAll(() => State.supabase.from('task_labels').select('*')
        .in('task_id', taskIds.slice(i, i + 100)).order('task_id').order('label_id')));
    }
    return all;
  },
  async setTaskLabels(taskId, labelIds) {
    // Remove todos os existentes desta tarefa, depois insere os novos (transação simples)
    const { error: errDel } = await State.supabase.from('task_labels').delete().eq('task_id', taskId);
    if (errDel) throw errDel;
    if (labelIds && labelIds.length > 0) {
      const rows = labelIds.map(lid => ({ task_id: taskId, label_id: lid }));
      const { error } = await State.supabase.from('task_labels').insert(rows);
      if (error) throw error;
    }
  },

  // ===== CROSS-PROJECT (Visão Geral multi-projeto) =====
  async listAllTasksForUser() {
    if (!State.projects || State.projects.length === 0) return [];
    const projectIds = State.projects.map(p => p.id);
    // Pagina em blocos de 1000 (limite padrão do PostgREST/Supabase por consulta).
    // Sem isso, portfólios com mais de 1000 tarefas no total tinham projetos
    // inteiros "sumindo" da Visão Geral/Pendências/Last Planner — a consulta
    // truncava silenciosamente (sem erro) assim que batia o limite.
    const all = [];
    for (let i = 0; i < projectIds.length; i += 100) {
      all.push(...await this.pageAll(() => State.supabase.from('tasks').select('*')
        .in('project_id', projectIds.slice(i, i + 100)).order('id')));
    }
    return all;
  },
  // Etiquetas de TODOS os projetos do usuário (para filtros cross-projeto:
  // Pendências, Minhas Tarefas). Não-fatal: devolve [] se a tabela faltar.
  async listAllLabels() {
    if (!State.projects || State.projects.length === 0) return [];
    const projectIds = State.projects.map(p => p.id);
    try {
      const { data, error } = await State.supabase
        .from('labels').select('*').in('project_id', projectIds);
      if (error) throw error;
      return data || [];
    } catch (e) { console.warn('listAllLabels:', e.message); return []; }
  },
  async listAllTaskLabels() {
    if (!State.allTasks || State.allTasks.length === 0) return [];
    const taskIds = State.allTasks.map(t => t.id);
    try {
      // Em lotes para não estourar o limite de itens do .in()
      const out = [];
      for (let i = 0; i < taskIds.length; i += 100) {
        out.push(...await this.pageAll(() => State.supabase.from('task_labels').select('*')
          .in('task_id', taskIds.slice(i, i + 100)).order('task_id').order('label_id')));
      }
      return out;
    } catch (e) { console.warn('listAllTaskLabels:', e.message); return []; }
  },

  // ===== COMMENTS =====
  async listComments(taskId) {
    const { data, error } = await State.supabase
      .from('comments').select('*').eq('task_id', taskId).order('created_at', { ascending: true });
    if (error) throw error;
    return data || [];
  },
  async createComment(taskId, body) {
    const { data, error } = await State.supabase
      .from('comments').insert({ task_id: taskId, user_id: State.user.id, body })
      .select().single();
    if (error) throw error;
    return data;
  },
  async updateComment(id, body) {
    const { data, error } = await State.supabase
      .from('comments').update({ body }).eq('id', id).select().single();
    if (error) throw error;
    return data;
  },
  async deleteComment(id) {
    const { error } = await State.supabase.from('comments').delete().eq('id', id);
    if (error) throw error;
  },

  // ===== AUDIT LOG (histórico de alterações) =====
  async listTaskHistory(taskId) {
    const { data, error } = await State.supabase
      .from('task_audit_log')
      .select('*')
      .eq('task_id', taskId)
      .order('created_at', { ascending: false })
      .limit(50);
    // Schema cache ainda não reconhece a tabela → trata como log vazio (não bloqueia a UI)
    if (error && (error.message?.includes('task_audit_log') || error.code === 'PGRST200')) return [];
    if (error) throw error;
    return data || [];
  },
  async logTaskChange(taskId, changes) {
    // Registra um objeto {field: {from, to}} no log — silencia erros (tabela pode não existir)
    try {
      const entries = Object.entries(changes).map(([field, { from: old_val, to: new_val }]) => ({
        task_id: taskId,
        user_id: State.user.id,
        field,
        old_val: old_val != null ? String(old_val) : null,
        new_val: new_val != null ? String(new_val) : null,
      }));
      if (!entries.length) return;
      await State.supabase.from('task_audit_log').insert(entries);
    } catch (e) { /* silencioso se tabela não existir ainda */ }
  },

  // ===== MENTIONS (menções @) =====
  // Lista usuários que têm acesso ao projeto atual (para autocomplete)
  // Combina dono + compartilhados, retornando { id, name, email }
  async listMentionableUsers(projectId) {
    if (!projectId) return [];
    // Busca shares + dono. Para o dono, pega o profile dele.
    const proj = State.projects.find(p => p.id === projectId);
    if (!proj) return [];
    const userIds = new Set([proj.owner_id]);
    State.shares.filter(s => s.project_id === projectId).forEach(s => userIds.add(s.user_id));
    if (userIds.size === 0) return [];
    const { data, error } = await State.supabase
      .from('profiles').select('id, full_name, email').in('id', Array.from(userIds));
    if (error) throw error;
    return (data || []).map(u => ({
      id: u.id,
      name: u.full_name || u.email || 'Usuário',
      email: u.email || '',
    }));
  },
  // Lista menções NÃO LIDAS do usuário atual (para sininho)
  async listMyUnreadMentions() {
    if (!State.user) return [];
    const { data, error } = await State.supabase
      .from('mentions').select('*')
      .eq('mentioned_user_id', State.user.id)
      .is('read_at', null)
      .order('created_at', { ascending: false })
      .limit(50);
    if (error) throw error;
    return data || [];
  },
  // Marca menções como lidas (em massa)
  async markMentionsRead(mentionIds) {
    if (!mentionIds || mentionIds.length === 0) return;
    const { error } = await State.supabase
      .from('mentions').update({ read_at: new Date().toISOString() })
      .in('id', mentionIds);
    if (error) throw error;
  },

  // ===== PROJECT SHARES (compartilhamento) =====
  async listShares(projectId) {
    const { data, error } = await State.supabase
      .from('project_shares').select('*').eq('project_id', projectId);
    if (error) throw error;
    return data || [];
  },
  // Cria share por e-mail. Se o usuário ainda não tem conta, cria erro com mensagem clara.
  async createShareByEmail(projectId, email, role) {
    // Procura o user_id pelo e-mail (usa profiles, que é populada após signup)
    const { data: profiles, error: pErr } = await State.supabase
      .from('profiles').select('id, email').eq('email', email.trim().toLowerCase()).maybeSingle();
    if (pErr) throw pErr;
    if (!profiles) {
      throw new Error('Este e-mail ainda não está cadastrado no CadêOProjeto. Peça para a pessoa criar conta primeiro.');
    }
    if (profiles.id === State.user.id) {
      throw new Error('Você é o dono deste projeto — não precisa se compartilhar.');
    }
    const { data, error } = await State.supabase
      .from('project_shares').insert({
        project_id: projectId,
        user_id: profiles.id,
        invited_email: email.trim().toLowerCase(),
        invited_by: State.user.id,
        role: role || 'viewer',
      }).select().single();
    if (error) throw error;
    return data;
  },
  async updateShareRole(id, role) {
    const { data, error } = await State.supabase
      .from('project_shares').update({ role }).eq('id', id).select().single();
    if (error) throw error;
    return data;
  },
  async deleteShare(id) {
    const { error } = await State.supabase.from('project_shares').delete().eq('id', id);
    if (error) throw error;
  },

  // ===== PROJECT INVITES (convites por e-mail) =====
  async listInvites(projectId) {
    const { data, error } = await State.supabase
      .from('project_invites').select('*')
      .eq('project_id', projectId).eq('status', 'pending')
      .order('created_at', { ascending: false });
    if (error) throw error;
    return data || [];
  },
  async createInvite(projectId, email, role) {
    const norm = email.trim().toLowerCase();
    // Não convidar a si mesmo
    if (norm === State.user.email.toLowerCase())
      throw new Error('Você não pode se convidar para o próprio projeto.');
    // Verifica se já tem acesso ativo
    const { data: existing } = await State.supabase
      .from('project_shares').select('id').eq('project_id', projectId).eq('invited_email', norm).maybeSingle();
    if (existing) throw new Error('Este e-mail já tem acesso ao projeto.');
    // Verifica convite pendente duplicado
    const { data: dup } = await State.supabase
      .from('project_invites').select('id').eq('project_id', projectId).eq('invited_email', norm).eq('status', 'pending').maybeSingle();
    if (dup) throw new Error('Já existe um convite pendente para este e-mail.');

    const { data, error } = await State.supabase
      .from('project_invites')
      .insert({ project_id: projectId, invited_email: norm, invited_by: State.user.id, role })
      .select().single();
    if (error) throw error;

    // Dispara Edge Function para enviar o e-mail
    const proj = State.projects.find(p => p.id === projectId);
    try {
      await State.supabase.functions.invoke('send-invite', {
        body: {
          token: data.token,
          email: norm,
          role,
          projectName: proj?.name || '—',
          inviterName: State.profile?.full_name || State.user.email,
          appUrl: window.location.href.split('?')[0],
        }
      });
    } catch (fnErr) {
      // Convite foi criado no banco; falha no e-mail é avisada mas não bloqueia
      console.warn('send-invite function error:', fnErr);
      toast('Convite salvo, mas o e-mail pode não ter sido enviado. Verifique a secret APP_URL.', 'warn');
    }
    return data;
  },
  async cancelInvite(id) {
    const { error } = await State.supabase
      .from('project_invites').update({ status: 'expired' }).eq('id', id);
    if (error) throw error;
  },
  async acceptInviteByToken(token) {
    const { data, error } = await State.supabase.rpc('accept_project_invite', { p_token: token });
    if (error) throw error;
    return data; // { project_id, role } or { error: '...' }
  },
  // Convites pendentes endereçados ao e-mail do usuário logado (aparece in-app)
  async listMyPendingInvites() {
    try {
      const { data, error } = await State.supabase.rpc('my_pending_invites');
      if (error) throw error;
      return data || [];
    } catch (e) { console.warn('my_pending_invites indisponível (rode 22-invites-in-app.sql):', e.message); return []; }
  },
  async declineInvite(token) {
    const { error } = await State.supabase.rpc('decline_invite', { p_token: token });
    if (error) throw error;
  },
  // Verifica se um e-mail já tem conta no sistema (para feedback ao convidar)
  async emailIsRegistered(email) {
    try {
      const { data, error } = await State.supabase.rpc('email_is_registered', { p_email: email.trim().toLowerCase() });
      if (error) throw error;
      return !!data;
    } catch (e) { return null; } // null = não foi possível verificar
  },

  // Determina o papel do usuário atual no projeto:
  // 'admin' (dono original) > 'editor' > 'commenter' > 'viewer'
  getMyRoleInProject(projectId) {
    if (!State.user || !projectId) return 'viewer';
    const proj = State.projects.find(p => p.id === projectId);
    if (proj && proj.owner_id === State.user.id) return 'owner';
    const share = State.shares.find(s => s.project_id === projectId && s.user_id === State.user.id);
    return share?.role || 'viewer';
  },
  // Helpers de permissão (consultam State.myRole)
  iAmOwner() { return State.myRole === 'owner'; },
  iAmAdmin() { return State.myRole === 'owner' || State.myRole === 'admin'; },
  iCanEdit() { return ['owner', 'admin', 'editor'].includes(State.myRole); },
  iCanDelete() { return ['owner', 'admin'].includes(State.myRole); },
  iCanComment() { return ['owner', 'admin', 'editor', 'commenter'].includes(State.myRole); },
  // Permissão de edição num projeto específico (útil em telas cross-projeto,
  // ex.: "Nova Tarefa" global, onde State.myRole é do projeto atual)
  iCanEditProject(projectId) { return ['owner', 'admin', 'editor'].includes(this.getMyRoleInProject(projectId)); },
  // Transferir propriedade
  async transferOwnership(projectId, newOwnerEmail) {
    const { error } = await State.supabase.rpc('transfer_project_ownership', {
      pid: projectId,
      new_owner_email: newOwnerEmail.trim().toLowerCase(),
    });
    if (error) throw error;
  },

  // ===== TEAM MEMBERS (cadastro global) =====
  async listTeamMembers() {
    const { data, error } = await State.supabase
      .from('team_members').select('*').eq('owner_id', State.user.id).order('name');
    if (error) throw error;
    return data || [];
  },
  async createTeamMember(m) {
    const { data, error } = await State.supabase
      .from('team_members').insert({ owner_id: State.user.id, ...m }).select().single();
    if (error) throw error;
    return data;
  },
  async updateTeamMember(id, patch) {
    const { data, error } = await State.supabase
      .from('team_members').update(patch).eq('id', id).select().single();
    if (error) throw error;
    return data;
  },
  async deleteTeamMember(id) {
    const { error } = await State.supabase.from('team_members').delete().eq('id', id);
    if (error) throw error;
  },

  // ===== PROJECT ALLOCATIONS =====
  async listAllocations(projectId) {
    const { data, error } = await State.supabase
      .from('project_allocations').select('*').eq('project_id', projectId);
    if (error) throw error;
    return data || [];
  },
  async allocateMember(projectId, teamMemberId, role) {
    const { data, error } = await State.supabase
      .from('project_allocations').insert({ project_id: projectId, team_member_id: teamMemberId, role: role || 'editor' }).select().single();
    if (error) throw error;
    return data;
  },
  async updateAllocation(id, role) {
    const { data, error } = await State.supabase
      .from('project_allocations').update({ role }).eq('id', id).select().single();
    if (error) throw error;
    return data;
  },
  async removeAllocation(id) {
    const { error } = await State.supabase.from('project_allocations').delete().eq('id', id);
    if (error) throw error;
  },

  // Reconstrói State.members a partir de teamMembers + allocations do projeto atual
  computeMembers() {
    State.members = State.allocations
      .map(a => {
        const tm = State.teamMembers.find(m => m.id === a.team_member_id);
        return tm ? { ...tm, role: tm.role_title, allocation_id: a.id, allocation_role: a.role } : null;
      })
      .filter(Boolean);
    // Garante que o dono do projeto SEMPRE aparece como membro (mín. 1 componente).
    // Só vale a regra se o usuário atual é o dono do projeto atual.
    if (State.user) {
      const curProj = (State.projects || []).find(p => p.id === State.currentProjectId);
      const iAmTheOwner = curProj ? curProj.owner_id === State.user.id : true;
      if (iAmTheOwner) {
        let ownerMember = (State.teamMembers || []).find(m =>
          (m.user_id && m.user_id === State.user.id) ||
          (m.email && m.email.toLowerCase() === State.user.email.toLowerCase())
        );
        // Fallback: se o team_member do dono ainda não existe em teamMembers,
        // monta um virtual a partir do perfil/auth para a UI nunca ficar vazia.
        if (!ownerMember) {
          const nm = State.profile?.full_name || State.user.email.split('@')[0];
          ownerMember = {
            id: 'owner-virtual-' + State.user.id,
            name: nm,
            email: State.user.email,
            role_title: 'Dono do Projeto',
            user_id: State.user.id,
            _virtual: true,
          };
        }
        if (!State.members.some(m =>
          (ownerMember.user_id && m.user_id === ownerMember.user_id) ||
          (ownerMember.email && m.email && m.email.toLowerCase() === ownerMember.email.toLowerCase()) ||
          m.id === ownerMember.id
        )) {
          State.members.unshift({ ...ownerMember, role: ownerMember.role_title || 'Dono', allocation_id: null, allocation_role: 'owner' });
        }
      }
    }
  },

  // ===== DISCIPLINES =====
  async listDisciplines(projectId) {
    const { data, error } = await State.supabase
      .from('disciplines').select('*').eq('project_id', projectId).order('code');
    if (error) throw error;
    return data || [];
  },
  async createDiscipline(projectId, d) {
    const { data, error } = await State.supabase
      .from('disciplines').insert({ project_id: projectId, ...d }).select().single();
    if (error) throw error; return data;
  },
  async updateDiscipline(id, patch) {
    const { error } = await State.supabase.from('disciplines').update(patch).eq('id', id);
    if (error) throw error;
  },
  async deleteDiscipline(id) {
    const { error } = await State.supabase.from('disciplines').delete().eq('id', id);
    if (error) throw error;
  },

  // ===== SECTORS (setores responsáveis) =====
  async listSectors(projectId) {
    const { data, error } = await State.supabase
      .from('sectors').select('*').eq('project_id', projectId).order('name');
    if (error) throw error;
    return data || [];
  },
  async createSector(projectId, s) {
    const { data, error } = await State.supabase
      .from('sectors').insert({ project_id: projectId, ...s }).select().single();
    if (error) throw error; return data;
  },
  async updateSector(id, patch) {
    const { error } = await State.supabase.from('sectors').update(patch).eq('id', id);
    if (error) throw error;
  },
  async deleteSector(id) {
    const { error } = await State.supabase.from('sectors').delete().eq('id', id);
    if (error) throw error;
  },

  // ===== RESTRICTIONS =====
  async listRestrictions(projectId) {
    const { data, error } = await State.supabase
      .from('restrictions').select('*').eq('project_id', projectId).order('due_date');
    if (error) throw error;
    return data || [];
  },
  async createRestriction(projectId, r) {
    const { data, error } = await State.supabase
      .from('restrictions').insert({ project_id: projectId, ...r }).select().single();
    if (error) throw error; return data;
  },
  async updateRestriction(id, patch) {
    const { error } = await State.supabase.from('restrictions').update(patch).eq('id', id);
    if (error) throw error;
  },
  async deleteRestriction(id) {
    const { error } = await State.supabase.from('restrictions').delete().eq('id', id);
    if (error) throw error;
  },

  // ===== LAST PLANNER — COMPROMISSOS SEMANAIS =====
  async listWeeklyCommitments(projectId) {
    const { data, error } = await State.supabase
      .from('weekly_commitments').select('*').eq('project_id', projectId).order('week_start');
    if (error) throw error;
    return data || [];
  },
  async createWeeklyCommitment(projectId, c) {
    const { data, error } = await State.supabase
      .from('weekly_commitments').insert({ project_id: projectId, ...c }).select().single();
    if (error) throw error; return data;
  },
  async updateWeeklyCommitment(id, patch) {
    const { error } = await State.supabase
      .from('weekly_commitments').update({ ...patch, updated_at: new Date().toISOString() }).eq('id', id);
    if (error) throw error;
  },
  async deleteWeeklyCommitment(id) {
    const { error } = await State.supabase.from('weekly_commitments').delete().eq('id', id);
    if (error) throw error;
  },

  // ===== EAP TEMPLATES =====
  async listEapTemplates() {
    try {
      const { data, error } = await State.supabase
        .from('eap_templates').select('*')
        .order('created_at', { ascending: false });
      if (error) throw error;
      return (data || []).map(r => ({ ...r, items: r.items || [] }));
    } catch (e) { return []; }
  },
  async saveEapTemplate(tpl) {
    const payload = { name: tpl.name, description: tpl.description || null, sector: tpl.sector || 'generic', items: tpl.items };
    if (tpl.id && !tpl.id.startsWith('__builtin')) {
      const { error } = await State.supabase.from('eap_templates').update({ ...payload, updated_at: new Date().toISOString() }).eq('id', tpl.id);
      if (error) throw error;
      return tpl.id;
    } else {
      const { data, error } = await State.supabase.from('eap_templates').insert({ ...payload, created_by: State.user?.id }).select('id').single();
      if (error) throw error;
      return data.id;
    }
  },
  async deleteEapTemplate(id) {
    const { error } = await State.supabase.from('eap_templates').delete().eq('id', id);
    if (error) throw error;
  },

  // ===== RACI (tarefas) =====
  async listRaci(projectId) {
    // raci_assignments.deliverable_id agora armazena task_id (antes armazenava restriction_id)
    const taskIds = (await this.pageAll(() => State.supabase.from('tasks').select('id')
      .eq('project_id', projectId).order('id'))).map(t => t.id);

    // Em lotes para não estourar o limite de itens do .in() (mesmo padrão de listAllTaskLabels)
    const inBatches = async (ids) => {
      const out = [];
      for (let i = 0; i < ids.length; i += 500) {
        const slice = ids.slice(i, i + 500);
        out.push(...await this.pageAll(() => State.supabase.from('raci_assignments')
          .select('*').in('deliverable_id', slice).order('deliverable_id').order('member_id')));
      }
      return out;
    };

    const direct = taskIds.length ? await inBatches(taskIds) : [];

    // Compatibilidade: projetos que tinham RACI atribuído no modelo antigo (por restrição)
    // guardam deliverable_id = restriction_id. Remapeia via restrictions.task_id quando o
    // vínculo existir, para não "sumir" com atribuições antigas. Best-effort: se a coluna
    // task_id não existir no schema do projeto, apenas ignora (não quebra o carregamento).
    try {
      const { data: rests, error: e2 } = await State.supabase
        .from('restrictions').select('id, task_id').eq('project_id', projectId);
      if (e2) throw e2;
      const linked = (rests || []).filter(r => r.task_id);
      if (linked.length > 0) {
        const legacy = await inBatches(linked.map(r => r.id));
        if (legacy.length > 0) {
          const taskByRestriction = new Map(linked.map(r => [r.id, r.task_id]));
          const seen = new Set(direct.map(r => `${r.deliverable_id}|${r.member_id}|${r.role}`));
          legacy.forEach(row => {
            row.deliverable_id = taskByRestriction.get(row.deliverable_id);
            const key = `${row.deliverable_id}|${row.member_id}|${row.role}`;
            if (!seen.has(key)) { seen.add(key); direct.push(row); }
          });
        }
      }
    } catch (e) { console.warn('listRaci: compatibilidade com RACI legado (por restrição) não aplicada:', e.message); }

    return direct;
  },
  async setRaci(taskId, memberId, role) {
    const { data, error } = await State.supabase
      .from('raci_assignments')
      .insert({ deliverable_id: taskId, member_id: memberId, role })
      .select().single();
    if (error && error.code !== '23505') throw error;
    return data;
  },
  async removeRaci(taskId, memberId, role) {
    const { error } = await State.supabase.from('raci_assignments').delete()
      .match({ deliverable_id: taskId, member_id: memberId, role });
    if (error) throw error;
  },
  async clearRaciForTask(taskId) {
    const { error } = await State.supabase.from('raci_assignments').delete()
      .eq('deliverable_id', taskId);
    if (error) throw error;
  },

  // ===== BACKUP COMPLETO (export/import de um projeto inteiro) =====
  // Exporta TODAS as entidades de um projeto, com queries auto-contidas (não dependem de State).
  async exportProjectFull(projectId) {
    const sb = State.supabase;
    const q = async (table, col, val, isIn) => {
      const parts = isIn ? Array.from({ length: Math.ceil((val || []).length / 100) },
        (_, i) => val.slice(i * 100, (i + 1) * 100)) : [val];
      const rows = [];
      for (const part of parts) {
        try {
          rows.push(...await this.pageAll(() => {
            const query = sb.from(table).select('*');
            const filtered = isIn ? query.in(col, part) : query.eq(col, part);
            if (table === 'project_baselines') return filtered.order('slot');
            if (table === 'task_labels') return filtered.order('task_id').order('label_id');
            if (table === 'raci_assignments') return filtered.order('deliverable_id').order('member_id').order('role');
            return filtered.order('id');
          }));
        } catch (e) { throw new Error(`Exportação interrompida em ${table}: ${e.message}`); }
      }
      return rows;
    };
    const tasks = await q('tasks', 'project_id', projectId);
    const taskIds = tasks.map(t => t.id);
    const restrictions = await q('restrictions', 'project_id', projectId);
    const allocations = await q('project_allocations', 'project_id', projectId);
    const memberIds = new Set(allocations.map(a => a.team_member_id));
    tasks.forEach(t => { if (t.assignee_id) memberIds.add(t.assignee_id); });
    const members = (State.teamMembers || []).filter(m => memberIds.has(m.id)).map(m => ({ id: m.id, name: m.name, email: m.email, role: m.role }));
    return {
      project: State.projects.find(p => p.id === projectId) || { id: projectId },
      tasks,
      dependencies: await q('task_dependencies', 'task_id', taskIds, true),
      disciplines: await q('disciplines', 'project_id', projectId),
      restrictions,
      raci: await q('raci_assignments', 'deliverable_id', taskIds, true),
      labels: await q('labels', 'project_id', projectId),
      task_labels: await q('task_labels', 'task_id', taskIds, true),
      comments: await q('comments', 'task_id', taskIds, true),
      weekly_commitments: await q('weekly_commitments', 'project_id', projectId),
      baseline_snapshots: await q('project_baselines', 'project_id', projectId),
      members,
    };
  },

  // Importa um projeto a partir do JSON, recriando tudo num projeto NOVO (remapeando IDs).
  // onProgress(texto) é chamado a cada etapa para feedback.
  async importProjectFull(pdata, onProgress, nameSuffix = ' (importado)') {
    const memberExists = (id) => (State.teamMembers || []).some(m => m.id === id);
    const prog = (t) => { if (onProgress) onProgress(t); };

    // 1) Projeto
    prog('Criando projeto…');
    const p = pdata.project || {};
    const newProj = await this.createProject({
      name: (p.name || 'Projeto importado') + nameSuffix,
      client: p.client || null,
      start_date: p.start_date || today(),
      end_date: p.end_date || addDays(today(), 60),
    });
    if (p.status) { try { await this.updateProject(newProj.id, { status: p.status }); } catch (e) { console.warn('[import] status do projeto não aplicado:', e.message); } }

    // 2) Disciplinas
    const discMap = {};
    for (const d of (pdata.disciplines || [])) {
      const { id, project_id, created_at, updated_at, lead_member_id, ...rest } = d;
      const payload = { ...rest };
      if (lead_member_id && memberExists(lead_member_id)) payload.lead_member_id = lead_member_id;
      try { const nd = await this.createDiscipline(newProj.id, payload); discMap[id] = nd.id; } catch (e) { console.warn('[import] disciplina não criada:', e.message); }
    }

    // 3) Labels
    const labelMap = {};
    for (const l of (pdata.labels || [])) {
      try { const nl = await this.createLabel(newProj.id, l.name, l.color); labelMap[l.id] = nl.id; } catch (e) { console.warn('[import] etiqueta não criada:', e.message); }
    }

    // 4) Tarefas (1ª passada: sem parent_id)
    prog(`Criando ${(pdata.tasks || []).length} tarefas…`);
    const taskMap = {};
    for (const t of (pdata.tasks || [])) {
      const { id, project_id, created_at, updated_at, parent_id, discipline_id, assignee_id, ...rest } = t;
      const payload = { ...rest };
      if (discipline_id && discMap[discipline_id]) payload.discipline_id = discMap[discipline_id];
      if (assignee_id && memberExists(assignee_id)) payload.assignee_id = assignee_id;
      try { const nt = await this.createTask(newProj.id, payload); taskMap[id] = nt.id; } catch (e) { console.warn('[import] tarefa não criada:', e.message); }
    }
    // 4b) 2ª passada: parent_id
    for (const t of (pdata.tasks || [])) {
      if (t.parent_id && taskMap[t.id] && taskMap[t.parent_id]) {
        try { await this.updateTask(taskMap[t.id], { parent_id: taskMap[t.parent_id] }); } catch (e) { console.warn('[import] vínculo pai/filho não aplicado:', e.message); }
      }
    }

    // 5) Dependências
    prog('Recriando dependências…');
    for (const d of (pdata.dependencies || [])) {
      if (taskMap[d.task_id] && taskMap[d.predecessor_id]) {
        try { await this.createDependency({ task_id: taskMap[d.task_id], predecessor_id: taskMap[d.predecessor_id], type: d.type || 'FS', lag_days: d.lag_days || 0 }); } catch (e) { console.warn('[import] dependência não criada:', e.message); }
      }
    }

    // 6) Restrições (com fallback se a coluna task_id não existir)
    const restMap = {};
    for (const r of (pdata.restrictions || [])) {
      const { id, project_id, created_at, updated_at, resolved_at, task_id, responsible_id, ...rest } = r;
      const payload = { ...rest, resolved_at: resolved_at || null };
      if (task_id && taskMap[task_id]) payload.task_id = taskMap[task_id];
      if (responsible_id && memberExists(responsible_id)) payload.responsible_id = responsible_id;
      try {
        const nr = await this.createRestriction(newProj.id, payload); restMap[id] = nr.id;
      } catch (e) {
        try { delete payload.task_id; const nr = await this.createRestriction(newProj.id, payload); restMap[id] = nr.id; } catch (e2) { console.warn('[import] restrição não criada:', e2.message); }
      }
    }

    // 7) Etiquetas das tarefas (task_labels)
    const labelsByTask = {};
    (pdata.task_labels || []).forEach(tl => {
      if (taskMap[tl.task_id] && labelMap[tl.label_id]) {
        (labelsByTask[taskMap[tl.task_id]] = labelsByTask[taskMap[tl.task_id]] || []).push(labelMap[tl.label_id]);
      }
    });
    for (const [tid, lids] of Object.entries(labelsByTask)) { try { await this.setTaskLabels(tid, lids); } catch (e) { console.warn('[import] etiquetas da tarefa não aplicadas:', e.message); } }

    // 8) RACI
    for (const r of (pdata.raci || [])) {
      if (taskMap[r.deliverable_id] && memberExists(r.member_id)) {
        try { await this.setRaci(taskMap[r.deliverable_id], r.member_id, r.role); } catch (e) { console.warn('[import] RACI não aplicado:', e.message); }
      }
    }

    // 9) Last Planner (compromissos semanais)
    for (const c of (pdata.weekly_commitments || [])) {
      if (taskMap[c.task_id]) {
        const payload = { task_id: taskMap[c.task_id], week_start: c.week_start, status: c.status || 'pendente', cause: c.cause || null };
        if (c.responsible_id && memberExists(c.responsible_id)) payload.responsible_id = c.responsible_id;
        try { await this.createWeeklyCommitment(newProj.id, payload); } catch (e) { console.warn('[import] compromisso semanal não criado:', e.message); }
      }
    }

    // 10) Comentários (preserva texto e data; reautoria para o usuário atual)
    for (const c of (pdata.comments || [])) {
      if (taskMap[c.task_id]) {
        try { await State.supabase.from('comments').insert({ task_id: taskMap[c.task_id], user_id: State.user.id, body: c.body, created_at: c.created_at || new Date().toISOString() }); } catch (e) { console.warn('[import] comentário não criado:', e.message); }
      }
    }

    // 10b) Linhas de base (snapshots) — recria com os novos IDs das tarefas
    for (const b of (pdata.baseline_snapshots || [])) {
      if (![1, 2, 3, 4].includes(Number(b.slot))) continue;
      const mapped = {};
      for (const [oldId, value] of Object.entries(b.tasks || {})) {
        if (taskMap[oldId]) mapped[taskMap[oldId]] = value;
      }
      await this.saveBaseline(newProj.id, { slot: Number(b.slot), set_at: b.set_at || new Date().toISOString(), tasks: mapped });
    }

    // 11) Garante o dono como membro do novo projeto
    // (todo projeto deve ter ao menos 1 membro: o dono)
    if (State.user) {
      const ownerMember = (State.teamMembers || []).find(m =>
        (m.user_id && m.user_id === State.user.id) ||
        (m.email && m.email.toLowerCase() === State.user.email.toLowerCase())
      );
      if (ownerMember) {
        try { await this.allocateMember(newProj.id, ownerMember.id, 'admin'); } catch (e) { /* já alocado ou falha não-fatal */ }
      }
    }

    return newProj;
  },

  // ===== LEGACY STUB (não usado — mantido para evitar erros se chamado) =====
  async deleteApproval(id) {
    const { error } = await State.supabase.from('approvals').delete().eq('id', id);
    if (error) throw error;
  },

  // Carrega tudo que o app precisa para o projeto atual (resiliente a tabelas v3 ausentes)
  async loadCurrentProject() {
    if (!State.currentProjectId) {
      State.members = []; State.tasks = []; State.dependencies = []; State.baselineHistory = [];
      State.disciplines = []; State.restrictions = []; State.weeklyCommitments = []; State.sectors = [];
      State.raci = []; State.labels = []; State.taskLabels = [];
      return;
    }
    // Helper: roda uma query e retorna [] em caso de erro (com warning no console)
    const safe = async (label, fn) => {
      try { return await fn(); }
      catch (err) {
        console.warn('[loadCurrentProject] falha em', label, '— rode a migration correspondente se ainda não rodou:', err.message);
        return [];
      }
    };

    const [tasks, dependencies, disciplines, restrictions, raci, labels] = await Promise.all([
      this.listTasks(State.currentProjectId),
      safe('dependencies', () => this.listDependencies(State.currentProjectId)),
      safe('disciplines', () => this.listDisciplines(State.currentProjectId)),
      safe('restrictions', () => this.listRestrictions(State.currentProjectId)),
      safe('raci', () => this.listRaci(State.currentProjectId)),
      safe('labels', () => this.listLabels(State.currentProjectId)),
    ]);
    State.tasks = tasks;
    State.dependencies = dependencies;
    // Falha explícita: sem esta tabela a aplicação não pode prometer histórico durável.
    State.baselineHistory = await this.listBaselines(State.currentProjectId);
    State.disciplines = disciplines;
    State.restrictions = restrictions;
    State.raci = raci;
    State.labels = labels;
    // task_labels precisa ser carregado DEPOIS porque depende de tasks
    State.taskLabels = await safe('task_labels', () => this.listTaskLabels(State.currentProjectId));
    State.weeklyCommitments = await safe('weekly_commitments', () => this.listWeeklyCommitments(State.currentProjectId));
    State.sectors = await safe('sectors', () => this.listSectors(State.currentProjectId));
    // Carrega shares e determina papel do usuário atual
    State.shares = await safe('shares', () => this.listShares(State.currentProjectId));
    State.allocations = await safe('allocations', () => this.listAllocations(State.currentProjectId));

    // Auto-aloca o dono como membro se ele ainda não tiver alocação neste projeto
    // (corrige projetos antigos criados antes dessa regra)
    // OBS: usar proj.owner_id direto — State.myRole ainda não foi definido nesse ponto.
    const _curProj = (State.projects || []).find(p => p.id === State.currentProjectId);
    if (State.user && _curProj && _curProj.owner_id === State.user.id) {
      const ownerTM = (State.teamMembers || []).find(m =>
        (m.user_id && m.user_id === State.user.id) ||
        (m.email && m.email.toLowerCase() === State.user.email.toLowerCase())
      );
      if (ownerTM && !State.allocations.some(a => a.team_member_id === ownerTM.id)) {
        try {
          const alloc = await this.allocateMember(State.currentProjectId, ownerTM.id, 'admin');
          State.allocations.push(alloc);
          console.log('[auto-alloc] Dono adicionado como membro do projeto', State.currentProjectId);
        } catch (e) {
          console.warn('[auto-alloc] Falha ao alocar dono:', e.message);
        }
      }
    }

    this.computeMembers();
    State.myRole = this.getMyRoleInProject(State.currentProjectId);
    if (this.iAmAdmin()) {
      const legacyKey = `baseline_history_${State.currentProjectId}`;
      let legacy = [];
      try { legacy = JSON.parse(localStorage.getItem(legacyKey) || '[]'); } catch (e) {}
      for (const snapshot of legacy) {
        if (!State.baselineHistory.some(b => b.slot === snapshot.slot)) {
          await this.saveBaseline(State.currentProjectId, snapshot);
          State.baselineHistory.push(snapshot);
        }
      }
      if (legacy.length) localStorage.removeItem(legacyKey);
    }

    // Normaliza dados: sincroniza status<->% (folhas) e roll-up de datas/progresso (pais)
    try { await this.normalizeLoadedTasks(); } catch (e) { console.warn('[normalize] falhou:', e.message); }

    // Carrega disciplinas dos outros projetos do dono para reuso no modal
    try {
      const otherIds = (State.projects || []).map(p => p.id).filter(id => id !== State.currentProjectId);
      if (otherIds.length > 0) {
        const { data: otherDiscs } = await State.supabase
          .from('disciplines').select('*').in('project_id', otherIds).order('code');
        State.allOwnerDisciplines = otherDiscs || [];
      } else {
        State.allOwnerDisciplines = [];
      }
    } catch (e) { State.allOwnerDisciplines = []; }

    // Aviso se a migration v3 (disciplines) não rodou
    if (disciplines.length === 0) {
      try {
        await State.supabase.from('disciplines').select('id').limit(1);
      } catch (err) {
        State._migrationMissing = true;
      }
    }
  },

  // ===== NORMALIZAÇÃO DE DADOS (roda sempre ao carregar) =====
  // 1) Folhas: status 'concluido' ⇄ progresso 100% (sincronia nos dois sentidos)
  // 2) Pais: roll-up — início = MÍN das filhas, término = MÁX das filhas,
  //          progresso = média; status segue no limite de concluído.
  // Corrige no banco apenas o que estiver inconsistente (idempotente e auto-limitante).
  async normalizeLoadedTasks() {
    const tasks = State.tasks;
    if (!Array.isArray(tasks) || tasks.length === 0) return;
    if (State._normalizing) return;
    State._normalizing = true;
    try {
      const childrenOf = new Map();
      tasks.forEach(t => {
        const pid = t.parent_id;
        if (pid) { if (!childrenOf.has(pid)) childrenOf.set(pid, []); childrenOf.get(pid).push(t); }
      });
      const isParent = id => childrenOf.has(id);
      const pending = [];

      // 1) Folhas — sincroniza status <-> progresso (ignora inativas)
      tasks.forEach(t => {
        if (isParent(t.id) || t.inactive) return;
        const prog = parseFloat(t.progress) || 0;
        const upd = {};
        if (t.status === 'concluido' && prog < 100) upd.progress = 100;
        else if (prog >= 100 && t.status !== 'concluido') upd.status = 'concluido';
        // Marco: término SEMPRE igual ao início (corrige importações com datas divergentes)
        if (t.is_milestone && t.start_date && t.end_date !== t.start_date) upd.end_date = t.start_date;
        // Dias úteis: início e término nunca caem em dia não útil (fim de semana/feriado).
        const _es = t.start_date;
        const _ee = ('end_date' in upd) ? upd.end_date : t.end_date;
        if (_es && _ee) {
          const _sn = snapTaskDates(_es, _ee);
          if (_sn.start !== _es) upd.start_date = _sn.start;
          if (_sn.end !== _ee) upd.end_date = _sn.end;
        }
        if (Object.keys(upd).length) { Object.assign(t, upd); pending.push([t.id, upd]); }
      });

      // 2) Pais — roll-up bottom-up (processa os mais profundos primeiro)
      const depthOf = (t) => {
        let d = 0, cur = t; const seen = new Set();
        while (cur && cur.parent_id && !seen.has(cur.id)) { seen.add(cur.id); cur = tasks.find(x => x.id === cur.parent_id); d++; }
        return d;
      };
      const parents = tasks.filter(t => isParent(t.id)).sort((a, b) => depthOf(b) - depthOf(a));
      parents.forEach(parent => {
        // Filhas inativas não entram no roll-up (datas nem progresso)
        const all = (childrenOf.get(parent.id) || []).filter(k => !k.inactive);
        if (!all.length) return;
        // Datas: considera filhas que tenham a respectiva data (início e término
        // SÃO independentes — uma filha com término mas sem início ainda conta no MÁX).
        const withStart = all.filter(k => k.start_date);
        const withEnd   = all.filter(k => k.end_date);
        const newStart = withStart.length
          ? withStart.reduce((m, k) => k.start_date < m ? k.start_date : m, withStart[0].start_date)
          : parent.start_date;
        const newEnd = withEnd.length
          ? withEnd.reduce((m, k) => k.end_date > m ? k.end_date : m, withEnd[0].end_date)
          : parent.end_date;
        const newProg  = rolledProgress(all);
        // Linha de base do pai também é roll-up: MIN dos baseline_start das filhas e MAX dos baseline_end.
        // Pais não têm LB própria — derivam das filhas para não ficarem com "—" no Gantt.
        const withBs = all.filter(k => k.baseline_start);
        const withBe = all.filter(k => k.baseline_end);
        const newBs = withBs.length ? withBs.reduce((m, k) => k.baseline_start < m ? k.baseline_start : m, withBs[0].baseline_start) : null;
        const newBe = withBe.length ? withBe.reduce((m, k) => k.baseline_end > m ? k.baseline_end : m, withBe[0].baseline_end) : null;
        const upd = {};
        if (newStart && parent.start_date !== newStart) upd.start_date = newStart;
        if (newEnd   && parent.end_date   !== newEnd)   upd.end_date   = newEnd;
        if (newBs && parent.baseline_start !== newBs) upd.baseline_start = newBs;
        if (newBe && parent.baseline_end   !== newBe) upd.baseline_end   = newBe;
        if (Math.round(parseFloat(parent.progress) || 0) !== newProg) upd.progress = newProg;
        if (newProg >= 100 && parent.status !== 'concluido') upd.status = 'concluido';
        else if (newProg < 100 && parent.status === 'concluido') upd.status = 'em_andamento';
        if (Object.keys(upd).length) { Object.assign(parent, upd); pending.push([parent.id, upd]); }
      });

      // Persiste só se houver inconsistências E o usuário puder editar
      if (pending.length && (typeof this.iCanEdit !== 'function' || this.iCanEdit())) {
        try { await this.updateTasksBatch(pending.map(([id, upd]) => ({ id, ...upd }))); }
        catch (e) { console.warn('[normalize] batch falhou:', e.message); }
        console.log(`[normalize] ${pending.length} tarefa(s) corrigida(s) (status/% e roll-up de pais)`);
      }
    } finally {
      State._normalizing = false;
    }
  },

  // Cria projeto seed para usuários novos
  async createSeedProject() {
    const t = today();
    const proj = await this.createProject({
      name: 'Edifício Atlântico — Bloco A',
      client: 'Cliente Exemplo',
      start_date: addDays(t, -30),
      end_date: addDays(t, 90),
    });
    const userName = State.profile?.full_name || State.user.email.split('@')[0];
    const tmA = await this.createTeamMember({ name: 'Você (' + userName.split(' ')[0] + ')', role_title: 'Coordenador de Projetos', email: State.user.email });
    const tmB = await this.createTeamMember({ name: 'Carlos Mendes', role_title: 'Eng. Estrutural', email: 'carlos@exemplo.com' });
    const tmC = await this.createTeamMember({ name: 'Ana Beatriz', role_title: 'Arquiteta', email: 'ana@exemplo.com' });
    const tmD = await this.createTeamMember({ name: 'Roberto Lima', role_title: 'Eng. Eletricista', email: 'roberto@exemplo.com' });
    const tmE = await this.createTeamMember({ name: 'Juliana Costa', role_title: 'Eng. Mecânica (AVAC)', email: 'juliana@exemplo.com' });
    State.teamMembers.push(tmA, tmB, tmC, tmD, tmE);
    await Promise.all([tmA, tmB, tmC, tmD, tmE].map(tm => this.allocateMember(proj.id, tm.id, 'editor')));
    const memberA = { id: tmA.id }; const memberB = { id: tmB.id };
    const memberC = { id: tmC.id }; const memberD = { id: tmD.id };
    const memberE = { id: tmE.id };

    // Tarefas exemplo
    const seedTasks = [
      { title: 'Anteprojeto arquitetônico', status: 'concluido', priority: 'alta', start_date: addDays(t, -30), end_date: addDays(t, -15), progress: 100, assignee_id: memberC.id },
      { title: 'Pré-dimensionamento estrutural', status: 'em_andamento', priority: 'alta', start_date: addDays(t, -14), end_date: addDays(t, 7), progress: 65, assignee_id: memberB.id },
      { title: 'Compatibilização de projetos', status: 'a_fazer', priority: 'alta', start_date: addDays(t, 8), end_date: addDays(t, 28), progress: 0, assignee_id: memberA.id },
      { title: 'Memorial descritivo arquitetônico', status: 'em_andamento', priority: 'media', start_date: addDays(t, -5), end_date: addDays(t, 5), progress: 80, assignee_id: memberC.id },
      { title: 'Detalhamento elétrico', status: 'bloqueada', priority: 'alta', start_date: addDays(t, 15), end_date: addDays(t, 35), progress: 0, assignee_id: memberD.id },
      { title: 'Memorial de cálculo estrutural', status: 'a_fazer', priority: 'media', start_date: addDays(t, 28), end_date: addDays(t, 42), progress: 0, assignee_id: memberB.id },
    ];
    const createdTasks = [];
    for (const tk of seedTasks) createdTasks.push(await this.createTask(proj.id, tk));
    const [taskAnteprojeto, taskPreDim, , taskMemDescr, taskEletrico] = createdTasks;

    // Disciplinas exemplo
    const discARQ = await this.createDiscipline(proj.id, { code: 'ARQ', name: 'Arquitetônico', lead_member_id: memberC.id });
    const discEST = await this.createDiscipline(proj.id, { code: 'EST', name: 'Estrutural', lead_member_id: memberB.id });
    const discELE = await this.createDiscipline(proj.id, { code: 'ELE', name: 'Elétrico', lead_member_id: memberD.id });
    const discAVA = await this.createDiscipline(proj.id, { code: 'AVA', name: 'AVAC / Climatização', lead_member_id: memberE.id });
    await this.createDiscipline(proj.id, { code: 'HID', name: 'Hidrossanitário' });
    await this.createDiscipline(proj.id, { code: 'PCI', name: 'Prevenção e Combate a Incêndio' });

    // Restrições exemplo
    const r1 = await this.createRestriction(proj.id, { description: 'Aprovação do projeto de fundações pelo cliente antes de iniciar a estrutura', type: 'aprovacao', responsible_id: memberA.id, due_date: addDays(t, 5), status: 'pendente', notes: 'Aguardando reunião de apresentação do Memorial de Cálculo.' });
    const r2 = await this.createRestriction(proj.id, { description: 'Alvará de construção na prefeitura municipal', type: 'licenca', responsible_id: memberA.id, due_date: addDays(t, 20), status: 'em_tratamento', notes: 'Protocolo PROC-2025-12345 protocolado. Prazo de análise: 20 dias úteis.' });
    const r3 = await this.createRestriction(proj.id, { description: 'Definição do fornecedor de esquadrias — prazo de fabricação impacta cronograma', type: 'fornecedor', responsible_id: memberC.id, due_date: addDays(t, 10), status: 'pendente' });
    const r4 = await this.createRestriction(proj.id, { description: 'Compatibilização elétrica x arquitetura — conflito nos shafts do pavimento tipo', type: 'projeto', responsible_id: memberD.id, due_date: addDays(t, -2), status: 'em_tratamento', notes: 'Reunião de compatibilização agendada.' });

    // RACI exemplo — atribuições por tarefa (não por restrição)
    await this.setRaci(taskPreDim.id, memberA.id, 'A');
    await this.setRaci(taskPreDim.id, memberC.id, 'R');
    await this.setRaci(taskPreDim.id, memberB.id, 'C');
    await this.setRaci(taskAnteprojeto.id, memberA.id, 'R');
    await this.setRaci(taskAnteprojeto.id, memberA.id, 'A');
    await this.setRaci(taskMemDescr.id, memberC.id, 'R');
    await this.setRaci(taskMemDescr.id, memberA.id, 'A');
    await this.setRaci(taskEletrico.id, memberD.id, 'R');
    await this.setRaci(taskEletrico.id, memberA.id, 'A');
    await this.setRaci(taskEletrico.id, memberC.id, 'C');

    return proj;
  }
};

// ---------- REALTIME ----------
export function setupRealtime() {
  if (State.realtimeChannel) State.supabase.removeChannel(State.realtimeChannel);
  if (!State.currentProjectId) return;

  // Silently reloads data — used for non-task tables.
  // DEBOUNCE (600ms): rajadas de eventos realtime (ex.: import em lote do outro lado,
  // recálculo de cronograma) viram UMA recarga em vez de dezenas. Também coalesce
  // eventos que chegam DURANTE uma recarga (roda de novo no fim, uma única vez).
  let _rtReloadTimer = null, _rtReloading = false, _rtReloadAgain = false;
  const _doReload = async () => {
    if (_rtReloading) { _rtReloadAgain = true; return; }
    _rtReloading = true;
    try { await DB.loadCurrentProject(); UI.render(); }
    catch (e) { console.warn('[realtime] recarga falhou:', e.message); }
    finally {
      _rtReloading = false;
      if (_rtReloadAgain) { _rtReloadAgain = false; reload(); }
    }
  };
  const reload = () => {
    clearTimeout(_rtReloadTimer);
    _rtReloadTimer = setTimeout(_doReload, 600);
  };

  // Push an event to the in-app notification feed
  const _rtPush = (icon, text) => {
    State.realtimeEvents.unshift({ id: Date.now() + Math.random(), icon, text, time: new Date().toISOString() });
    if (State.realtimeEvents.length > 100) State.realtimeEvents.length = 100;
    State.realtimeUnread++;
    // Update badge immediately without full re-render
    const bb = document.getElementById('topbarBellBadge');
    if (bb) {
      const n = State.myMentions.length + State.realtimeUnread;
      bb.style.display = n > 0 ? 'flex' : 'none';
      bb.textContent = n > 9 ? '9+' : String(n);
    }
  };

  // Smart handler for task changes — shows descriptive toasts
  let _rtTaskDebounceTimer = null;
  const _rtTaskQueue = [];
  const _flushTaskToast = () => {
    if (!_rtTaskQueue.length) return;
    const items = _rtTaskQueue.splice(0, _rtTaskQueue.length);
    if (items.length === 1) {
      const { icon, msg } = items[0];
      _rtPush(icon, msg);
      toast(`${icon} ${msg}`, 'info');
    } else {
      const msg = `${items.length} tarefas atualizadas`;
      _rtPush('✏️', msg);
      toast(`✏️ ${msg}`, 'info');
    }
  };

  const _SL = { a_fazer: 'A Fazer', em_andamento: 'Em Andamento', bloqueada: 'Bloqueada', concluido: 'Concluído' };
  const _PL = { alta: 'Alta ↑', media: 'Média', baixa: 'Baixa ↓' };

  const taskHandler = async (payload) => {
    const ev  = payload.eventType;
    const nw  = payload.new  || {};
    const ol  = payload.old  || {};
    // PATCH IMEDIATO em memória → a mudança (ex.: novo responsável) aparece NA HORA no
    // outro equipamento, sem esperar a recarga completa do projeto. O reload() abaixo
    // (debounced) reconcilia dependências/labels/normalização de datas logo em seguida.
    try {
      if (ev === 'DELETE') {
        const id = ol.id || nw.id;
        if (id) State.tasks = State.tasks.filter(t => t.id !== id);
      } else if (nw.id) {
        const idx = State.tasks.findIndex(t => t.id === nw.id);
        if (idx >= 0) Object.assign(State.tasks[idx], nw);
        else State.tasks.push(nw);
      }
      CPMCache.invalidate();
    } catch (e) { /* best-effort; o reload abaixo reconcilia */ }
    reload();

    const nm  = (nw.name || ol.name || nw.title || ol.title || '').slice(0, 36);
    let icon = '✏️', msg = '';
    if (ev === 'INSERT') {
      icon = '➕'; msg = nm ? `Nova tarefa: "${nm}"` : 'Tarefa criada';
    } else if (ev === 'DELETE') {
      icon = '🗑'; msg = nm ? `Tarefa removida: "${nm}"` : 'Tarefa excluída';
    } else {
      const ch2 = [];
      if (ol.status   !== nw.status   && nw.status   != null) ch2.push(`${_SL[ol.status]  || ol.status} → ${_SL[nw.status]  || nw.status}`);
      if (ol.progress !== nw.progress && nw.progress != null) ch2.push(`progresso ${nw.progress}%`);
      if (ol.priority !== nw.priority && nw.priority != null) ch2.push(`prioridade ${_PL[nw.priority] || nw.priority}`);
      if (ol.assignee_id !== nw.assignee_id) { const am = (State.members || []).find(m => m.id === nw.assignee_id); ch2.push(am ? `→ ${(am.name || '').split(' ')[0]}` : 'responsável removido'); }
      if (ol.end_date !== nw.end_date && nw.end_date != null) ch2.push(`prazo ${nw.end_date}`);
      msg = nm ? (ch2.length ? `"${nm}": ${ch2.join(' · ')}` : `"${nm}" atualizada`) : 'Tarefa atualizada';
    }
    _rtTaskQueue.push({ icon, msg });
    clearTimeout(_rtTaskDebounceTimer);
    _rtTaskDebounceTimer = setTimeout(() => { _flushTaskToast(); UI.render(); }, 400);
  };

  try {
    let ch = State.supabase
      .channel('project:' + State.currentProjectId)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tasks', filter: `project_id=eq.${State.currentProjectId}` }, taskHandler)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'project_allocations', filter: `project_id=eq.${State.currentProjectId}` }, reload)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'team_members', filter: `owner_id=eq.${State.user.id}` }, async () => { State.teamMembers = await DB.listTeamMembers(); DB.computeMembers(); UI.render(); })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'projects', filter: `owner_id=eq.${State.user.id}` },
        async () => { State.projects = await DB.listProjects(); UI.render(); })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'task_dependencies' }, reload);

    // Realtime das tabelas v3 — só registra se a migration rodou
    if (!State._migrationMissing) {
      ch = ch
        .on('postgres_changes', { event: '*', schema: 'public', table: 'disciplines', filter: `project_id=eq.${State.currentProjectId}` }, reload)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'sectors', filter: `project_id=eq.${State.currentProjectId}` }, reload)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'restrictions', filter: `project_id=eq.${State.currentProjectId}` }, reload)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'weekly_commitments', filter: `project_id=eq.${State.currentProjectId}` }, reload)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'raci_assignments' }, reload)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'labels', filter: `project_id=eq.${State.currentProjectId}` }, reload)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'task_labels' }, reload)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'comments' }, () => {
          // Se um modal de tarefa estiver aberto, recarrega comentários
          const modalOpen = $('#modalBackdrop')?.classList.contains('active');
          if (modalOpen && UI._currentTaskId) UI.loadCommentsForTask(UI._currentTaskId);
        })
        .on('postgres_changes', { event: '*', schema: 'public', table: 'project_shares', filter: `project_id=eq.${State.currentProjectId}` }, reload)
        .on('postgres_changes', {
          event: 'INSERT', schema: 'public', table: 'mentions',
          filter: `mentioned_user_id=eq.${State.user.id}`
        }, async (payload) => {
          // Adiciona à lista de menções não lidas e atualiza badge
          State.myMentions.unshift(payload.new);
          await UI.render();
          // Toast suave para avisar
          const proj = State.projects.find(p => p.id === payload.new.project_id);
          toast(`💬 Você foi mencionado${proj ? ' em ' + proj.name : ''}`, 'info');
        })
        .on('postgres_changes', {
          event: 'INSERT', schema: 'public', table: 'project_invites',
          filter: `invited_email=eq.${(State.user.email || '').toLowerCase()}`
        }, async () => {
          // Novo convite chegou para o meu e-mail — recarrega e mostra o banner ao vivo
          State.myPendingInvites = await DB.listMyPendingInvites();
          UI.renderPendingInvitesBanner();
          toast('📨 Você recebeu um convite de projeto', 'info');
        });
    }

    State.realtimeChannel = ch.subscribe();
  } catch (err) {
    console.warn('Realtime setup falhou:', err.message);
  }
}
