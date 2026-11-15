// Estado global e catálogos/rótulos

// ---------- STATE ----------
export const State = {
  supabase: null,
  user: null,
  profile: null,
  projects: [],
  members: [],     // membros do projeto atual
  tasks: [],       // tarefas do projeto atual
  dependencies: [],// dependências entre tarefas (FS/SS/FF/SF)
  baselineHistory: [], // LB1–LB4 do projeto atual, persistidas no banco
  disciplines: [], // disciplinas técnicas do projeto atual
  sectors: [],     // setores responsáveis cadastrados no projeto atual
  restrictions: [],// restrições/impedimentos do projeto atual
  weeklyCommitments: [], // Last Planner — compromissos semanais do projeto atual
  lpWeekStart: null,     // segunda-feira da semana visível no Last Planner
  raci: [],        // atribuições RACI (por tarefa)
  labels: [],      // etiquetas do projeto atual — máx 15
  taskLabels: [],  // associações tarefa↔label do projeto atual
  comments: [],    // comentários da tarefa aberta no momento (carregados sob demanda)
  myMentions: [],  // menções não-lidas do usuário atual (carregadas no boot)
  myPendingInvites: [], // convites de projeto pendentes p/ o e-mail do usuário (in-app)
  shares: [],      // shares do projeto atual (somente o dono vê todos)
  myRole: 'owner', // 'owner' | 'admin' | 'editor' | 'commenter' | 'viewer'
  // Cross-project (visão geral multi-projeto)
  allTasks: [],          // todas as tarefas de todos os projetos do usuário
  allLabels: [],         // etiquetas de TODOS os projetos (filtro Pendências/Minhas Tarefas)
  allTaskLabels: [],     // vínculos tarefa↔etiqueta de TODOS os projetos
  teamMembers: [],       // cadastro global de equipe do owner
  allocations: [],       // alocações team_member↔projeto do projeto atual
  allOwnerDisciplines: [], // disciplinas de TODOS os projetos do dono (para reuso)
  currentProjectId: null,
  currentView: 'projects',
  ganttZoom: 'week',
  sCurveMode: 'line',    // 'line' | 'bars' | 'mixed'
  sCurveBasis: 'planned', // 'planned' | 'baseline' — curva de referência da Curva S
  sCurveForecast: false, // mostrar projeção de término na Curva S
  desembolsoMode: 'both', // 'monthly' | 'cumulative' | 'both'
  disciplineSort: 'alpha',        // 'alpha' | 'pending' (ordenação das disciplinas)
  disciplineFilterPending: false, // mostrar só disciplinas com pendências
  sectorSort: 'overdue',          // 'alpha' | 'overdue' | 'pending'
  sectorFilterPending: false,     // mostrar só setores com pendências
  sectorView: 'cards',            // 'cards' | 'list'
  ganttLevelFilter: 'all',   // 'all' | '1' | '2' | ... (nível máximo a exibir)
  ganttSituacaoFilter: 'all', // 'all' | 'futura' | 'atrasada' | 'no_prazo' | 'concluida' (filtro por selo)
  situacaoBasis: 'baseline',  // 'baseline' (linha de base vigente) | 'planned' (datas planejadas atuais)
  ganttFullWidth: false,     // true = colapsa o painel de colunas p/ ampliar o gráfico
  ganttChartVisible: false,  // false = só tabela (padrão); true = exibe o gráfico Gantt
  ganttAutoRecalc: (() => { try { const v = localStorage.getItem('projetudo_gantt_auto_recalc'); return v === null ? true : v === '1'; } catch (e) { return true; } })(), // recálculo automático ao mudar datas/deps — ligado por padrão; respeita escolha explícita salva
  ganttCollapsed: new Set(), // IDs de tarefas pai colapsadas
  collapsedPanels: new Set(), // painéis colapsáveis fechados (visão geral / relatórios)
  realtimeChannel: null,
  realtimeEvents: [],   // feed de eventos realtime [{ id, icon, text, time }]
  realtimeUnread: 0,    // contador de eventos não lidos (badge do sininho)
  eapTemplates: [],     // templates de EAP salvos pelo usuário
  notifPrefs: null,  // Preferências de notificação do usuário
  // Automações (Tier 1 — receitas prontas). Persistido em localStorage por usuário.
  automation: {
    archiveDoneDays: 0,                  // 0 = desligado; N = arquiva concluídas há ≥N dias da Lista/Kanban
    promotePriorityNearDeadline: false,  // ≤3d do prazo + não concluída → vira Alta
    stalledAlertDays: 0,                 // 0 = desligado; N = "Em Andamento" sem progresso há ≥N dias → badge
    autoPpcOnComplete: true,             // Tarefa comprometida na semana virou Concluída → marca Cumprida (Last Planner)
    assignByDiscipline: false,           // Nova tarefa com disciplina → atribui o líder daquela disciplina
  },
  // Filtros das views de engenharia
  filterDiscipline: 'all',
  filterStatus: 'all',
  filterApprover: 'all',
  filterApprovalStatus: 'all',
  overviewFilter: 'all',  // 'all' ou um project_id
  overviewMine: false,    // Visão Geral: mostrar só tarefas atribuídas a mim
  overviewSectorFilter: 'all', // Visão Geral — 'all' | '__none__' | nome do setor
  overviewStatusFilter: new Set(['a_fazer', 'em_andamento', 'bloqueada']), // Visão Geral — multi-seleção
  // Filtros avançados da view de Tarefas
  taskViewMode: 'kanban',  // 'kanban' | 'table' (planilha) | 'list' (lista densa agrupada, recolhível)
  taskGroupBy: 'status',   // 'status' | 'stage' | 'discipline' | 'assignee' | 'sector' | 'priority' | 'none'
  collapsedTaskGroups: new Map(), // modo Lista: chave do grupo → true (recolhido) / false (expandido); ausente = padrão
  taskFilters: {
    search: '',
    status: 'all',
    priority: 'all',
    assignee: 'all',
    discipline: 'all',
    label: 'all',
    sector: 'all',
    overdue: false,
  },
  taskSortCol: 'end_date', // coluna de ordenação na lista
  taskSortDir: 'asc',      // 'asc' | 'desc'
  pendenciasFilter: 'all', // 'all' | project_id
  pendenciasSector: 'all', // 'all' | '__none__' | nome do setor
  pendenciasLabel: 'all',  // 'all' | '__none__' | label_id
  pendenciasStatusFilter: new Set(['a_fazer', 'em_andamento', 'bloqueada']), // Pendências — multi-seleção
  lpSectorFilter: 'all',   // Last Planner — 'all' | '__none__' | nome do setor
  lpProjectFilter: 'current',     // Last Planner — 'current' | 'all'
  lpResponsibleFilter: 'all',     // Last Planner — 'all' | '__none__' | member_id
  lpDateMode: 'ending',           // Last Planner — 'ending' (termina na semana) | 'occurring' (acontece na semana)
  calendarYear: new Date().getFullYear(),
  calendarMonth: new Date().getMonth(), // 0-11
  calendarDiscFilter: null,  // discipline_id | null
  calendarProjFilter: null,  // project_id    | null
  relatorioScope: 'current', // 'current' | 'all'
  // Filtros por intervalo de datas (término) — independentes por tela
  dateFilters: { tasks: { from: '', to: '', preset: 'all' }, pend: { from: '', to: '', preset: 'all', mode: 'ending' }, rel: { from: '', to: '', preset: 'all' }, overview: { from: '', to: '', preset: 'all', mode: 'ending' } },
};

// Catálogo de disciplinas padrão (NBR-aware)
export const DISCIPLINE_CATALOG = [
  { code: 'ARQ', name: 'Arquitetônico' },
  { code: 'EST', name: 'Estrutural' },
  { code: 'FUN', name: 'Fundações' },
  { code: 'GEO', name: 'Geotécnico / Sondagem' },
  { code: 'HID', name: 'Hidrossanitário' },
  { code: 'ELE', name: 'Elétrico' },
  { code: 'SPD', name: 'SPDA (Para-raios)' },
  { code: 'PCI', name: 'Prevenção e Combate a Incêndio' },
  { code: 'AVA', name: 'AVAC / Climatização' },
  { code: 'GAS', name: 'Gás' },
  { code: 'CAB', name: 'Cabeamento Estruturado / Telecom' },
  { code: 'CFTV', name: 'CFTV / Segurança' },
  { code: 'AUT', name: 'Automação Predial' },
  { code: 'PAI', name: 'Paisagismo' },
  { code: 'INT', name: 'Interiores' },
  { code: 'LUM', name: 'Luminotécnico' },
  { code: 'ACU', name: 'Acústico' },
  { code: 'URB', name: 'Urbanístico' },
  { code: 'TER', name: 'Terraplenagem' },
];

export const RESTRICTION_TYPES = {
  aprovacao: 'Aprovação',
  licenca: 'Licença / Alvará',
  fornecedor: 'Fornecedor',
  cliente: 'Cliente',
  projeto: 'Projeto / Técnico',
  obra: 'Obra',
  outro: 'Outro',
};

export const RESTRICTION_STATUS = {
  pendente:      { label: 'Pendente',       color: 'var(--ink-mute)' },
  em_tratamento: { label: 'Em Tratamento',  color: 'var(--accent-warm)' },
  resolvida:     { label: 'Resolvida',      color: 'var(--accent-success)' },
  cancelada:     { label: 'Cancelada',      color: 'var(--ink-mute)' },
};

// Last Planner — status do compromisso semanal
export const COMMITMENT_STATUS = {
  pendente:     { label: 'Pendente',      color: 'var(--ink-mute)' },
  cumprido:     { label: 'Cumprido',      color: 'var(--accent-success)' },
  nao_cumprido: { label: 'Não cumprido',  color: 'var(--accent-danger)' },
};

// Last Planner — causas de não-cumprimento (RNC / Reasons for Non-Completion)
// Foco em execução de obra.
export const PPC_CAUSES = {
  programacao:        'Programação deficiente',
  mao_de_obra:        'Mão de obra (falta/insuficiente)',
  material:           'Material (falta/atraso)',
  equipamento:        'Equipamento / ferramenta',
  projeto:            'Projeto (falta de informação)',
  area:               'Área / frente indisponível',
  clima:              'Clima / condições externas',
  mudanca_prioridade: 'Mudança de prioridade',
  pre_requisito:      'Pré-requisito não concluído',
  outro:              'Outro',
};

// Causas de atraso de tarefa (foco em projetos/escritório).
// Usadas no modal de tarefa atrasada e na exibição do Gantt.
export const DELAY_CAUSES = {
  escopo_cliente:        'Escopo alterado pelo cliente',
  aprov_cliente:         'Atraso na aprovação do cliente',
  info_incompleta:       'Informações de entrada incompletas',
  coordenacao:           'Pendências de coordenação',
  incompat_disciplinas:  'Incompatibilidades entre disciplinas',
  retrabalho:            'Retrabalho de projeto',
  sobrecarga:            'Sobrecarga da equipe',
  prio_conflito:         'Priorização conflitante',
  projetista_parceiro:   'Atraso de projetista parceiro',
  aprov_externa:         'Aprovações externas',
  erro_projeto:          'Erro de projeto',
  outros:                'Outros',
};

// Restrições em aberto (pendente/em_tratamento) vinculadas a uma tarefa
export function taskOpenRestrictions(taskId) {
  return (State.restrictions || []).filter(r => r.task_id === taskId && r.status !== 'resolvida' && r.status !== 'cancelada');
}
// Regra de negócio do status "bloqueada" (atrelado a restrições):
//  • só pode BLOQUEAR uma tarefa que tenha restrição em aberto;
//  • só pode SAIR de bloqueada quando todas as restrições estiverem resolvidas.
export function validateTaskStatusChange(task, newStatus) {
  if (!task || !newStatus || newStatus === task.status) return { ok: true };
  const open = taskOpenRestrictions(task.id);
  if (newStatus === 'bloqueada' && open.length === 0) {
    return { ok: false, message: 'Para marcar como Bloqueada, a tarefa precisa de ao menos uma restrição em aberto. Cadastre a restrição vinculada a esta tarefa em "Restrições".' };
  }
  if (task.status === 'bloqueada' && newStatus !== 'bloqueada' && open.length > 0) {
    return { ok: false, message: `Esta tarefa tem ${open.length} restrição(ões) em aberto. Resolva-as antes de alterar o status.` };
  }
  return { ok: true };
}

export const STATUS_LABELS = {
  // Tarefas
  a_fazer: 'A Fazer',
  bloqueada: 'Bloqueada',
  em_andamento: 'Em Andamento',
  concluido: 'Concluída',
  // Entregáveis / disciplinas
  em_projeto: 'Em Projeto',
  em_revisao: 'Em Revisão',
  em_aprovacao: 'Em Aprovação',
  aprovado: 'Aprovado',
  aprovado_com_ressalvas: 'Aprovado c/ Ressalvas',
  emitido: 'Emitido',
  obsoleto: 'Obsoleto',
  pendente: 'Pendente',
  em_analise: 'Em Análise',
  reprovado: 'Reprovado',
  cancelado: 'Cancelado',
  pendente_aprovacao: 'Aguardando Aprovação',
};

const APPROVER_LABELS = {
  interno: 'Interno (Líder Técnico)',
  cliente: 'Cliente / Contratante',
  prefeitura: 'Prefeitura Municipal',
  bombeiros: 'Corpo de Bombeiros',
  crea_cau: 'CREA / CAU',
  concessionaria: 'Concessionária',
  outros: 'Outros',
};

const FILE_PROVIDERS = {
  gdrive: 'Google Drive',
  dropbox: 'Dropbox',
  onedrive: 'OneDrive',
  url: 'URL Externa',
};

export const RACI_LABELS = {
  R: 'Responsible (Executa)',
  A: 'Accountable (Aprovador único)',
  C: 'Consulted (Consultado)',
  I: 'Informed (Informado)',
};

// Restrições de agendamento (estilo MS Project / PMBOK)
export const CONSTRAINT_TYPES = {
  ASAP: { label: 'Antecipar ao máximo (padrão)', needsDate: false, icon: '' },
  ALAP: { label: 'Atrasar ao máximo', needsDate: false, icon: '⊳' },
  MSO:  { label: 'Deve iniciar exatamente em', needsDate: true,  icon: '🔒' },
  MFO:  { label: 'Deve terminar exatamente em', needsDate: true, icon: '🔒' },
  SNET: { label: 'Não pode iniciar antes de', needsDate: true,   icon: '⊳' },
  FNLT: { label: 'Não pode terminar depois de', needsDate: true, icon: '⊲' },
};
// Escopo global: atributos onclick inline só enxergam window.*
window.State = State;
