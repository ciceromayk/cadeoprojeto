// Configuração do Supabase e autenticação
import { $ } from './helpers.js';
import { State } from './state.js';

// ---------- CONFIG ----------
// =====================================================
// CONFIG EMBUTIDA — credenciais Supabase do projeto.
// Para uso pessoal/equipe: cola aqui e o app já vem pronto.
// Para distribuir como template: deixa as duas strings vazias.
// =====================================================
// IMPORTANTE: a anon key do Supabase é projetada para ser pública —
// a segurança está nas RLS policies (Row Level Security), não na key.
// NUNCA cole aqui a service_role key.
const EMBEDDED_CONFIG = {
  url: 'https://nfewfpedaqlizfndguyr.supabase.co',
  key: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5mZXdmcGVkYXFsaXpmbmRndXlyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzc0NjI4NzQsImV4cCI6MjA5MzAzODg3NH0.6LhMGwMaXpIQ-2aH0c5v9rQ4jB2BEBDgZUc0AX30ZI4',
};

export const Config = {
  // Nota: prefixo 'of:' (legado de quando o app se chamava ObraFlow).
  // Mantido para preservar configurações já salvas pelos usuários.
  load() {
    // Prioridade: 1) embutida no HTML, 2) localStorage do navegador
    if (EMBEDDED_CONFIG.url && EMBEDDED_CONFIG.key) {
      return { url: EMBEDDED_CONFIG.url, key: EMBEDDED_CONFIG.key, embedded: true };
    }
    const url = localStorage.getItem('of:supabase_url');
    const key = localStorage.getItem('of:supabase_key');
    return { url, key, embedded: false };
  },
  save(url, key) {
    localStorage.setItem('of:supabase_url', url);
    localStorage.setItem('of:supabase_key', key);
  },
  reset() {
    localStorage.removeItem('of:supabase_url');
    localStorage.removeItem('of:supabase_key');
  },
  isEmbedded() {
    return !!(EMBEDDED_CONFIG.url && EMBEDDED_CONFIG.key);
  }
};

// ---------- AUTH ----------
export const Auth = {
  mode: 'login',

  async signUp(email, password, fullName) {
    const { data, error } = await State.supabase.auth.signUp({
      email, password,
      options: { data: { full_name: fullName } }
    });
    if (error) throw error;
    return data;
  },

  async signIn(email, password) {
    const { data, error } = await State.supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
    return data;
  },

  async signOut() {
    if (State.realtimeChannel) {
      await State.supabase.removeChannel(State.realtimeChannel);
      State.realtimeChannel = null;
    }
    await State.supabase.auth.signOut();
    State.user = null; State.profile = null;
    State.projects = []; State.members = []; State.tasks = [];
    State.currentProjectId = null;
  },

  async getProfile() {
    const { data, error } = await State.supabase
      .from('profiles').select('*').eq('id', State.user.id).single();
    if (error && error.code !== 'PGRST116') throw error;
    return data;
  },

  toggleMode() {
    this.mode = this.mode === 'login' ? 'register' : 'login';
    const isReg = this.mode === 'register';
    $('#loginTitle').textContent = isReg ? 'Criar conta' : 'Acessar plataforma';
    $('#loginSub').textContent = isReg ? 'Gratuito para a comunidade de engenharia.' : 'Gestão de projetos de engenharia para todos.';
    $('#nameGroup').style.display = isReg ? 'block' : 'none';
    $('#consentGroup').style.display = isReg ? 'block' : 'none';
    $('#loginSubmit').textContent = isReg ? 'Criar conta' : 'Entrar';
    $('#footerSwitchText').textContent = isReg ? 'Já tem conta?' : 'Ainda não tem conta?';
    $('#footerSwitch').textContent = isReg ? 'Fazer login' : 'Criar conta gratuita';
    $('#loginError').style.display = 'none';
    $('#loginSuccess').style.display = 'none';
  },

};
