// Feedback ao usuário: toast, loading, erros globais, offline, checagem de versão
import { $, escapeHtml } from './helpers.js';
import { APP_VERSION } from './changelog.js';

export function toast(msg, type = '', duration = null) {
  const el = document.createElement('div');
  el.className = 'toast ' + type;
  const persist = type === 'warning' && duration === null;
  const ms = duration !== null ? duration : 2800;
  const msgSpan = document.createElement('span');
  msgSpan.className = 'toast-msg';
  msgSpan.textContent = msg;
  el.appendChild(msgSpan);
  if (persist) {
    const btn = document.createElement('button');
    btn.className = 'toast-close';
    btn.textContent = '✕';
    btn.title = 'Fechar';
    btn.onclick = () => { el.style.opacity = '0'; el.style.transform = 'translateX(20px)'; el.style.transition = 'all 0.3s'; setTimeout(() => el.remove(), 320); };
    el.appendChild(btn);
  } else {
    setTimeout(() => { el.style.opacity = '0'; el.style.transform = 'translateX(20px)'; el.style.transition = 'all 0.3s'; }, ms - 400);
    setTimeout(() => el.remove(), ms);
  }
  $('#toastHost').appendChild(el);
}

export const setLoading = on => $('#globalLoader').classList.toggle('active', on);

// Converte erros técnicos do Supabase em mensagens legíveis
export function friendlyError(err) {
  const msg = err?.message || String(err || 'erro desconhecido');
  if (msg.includes('duplicate key') || msg.includes('unique constraint') || msg.includes('already exists')) {
    const _c = msg.match(/unique constraint "([^"]+)"/);
    console.error('[erro de duplicidade]', err);
    return 'Este registro já existe.' + (_c ? ` (${_c[1]})` : '');
  }
  if (msg.includes('violates foreign key') || msg.includes('foreign key')) return 'Este item está em uso e não pode ser removido.';
  if (msg.includes('permission denied') || msg.includes('row-level security') || msg.includes('policy')) return 'Você não tem permissão para esta ação.';
  if (msg.includes('JWT') || msg.includes('token expired') || msg.includes('Invalid JWT')) return 'Sessão expirada — faça login novamente.';
  if (msg.includes('NetworkError') || msg.includes('Failed to fetch') || msg.includes('network')) return 'Sem conexão. Verifique a internet e tente novamente.';
  if (msg.includes('PGRST')) return 'Erro de servidor — tente novamente em instantes.';
  if (msg.includes('does not exist') && msg.includes('relation')) return 'Estrutura do banco desatualizada — rode as migrations pendentes.';
  if (msg.includes('timeout') || msg.includes('timed out')) return 'Tempo de resposta esgotado — tente novamente.';
  return msg;
}
export const setSplashText = t => { const el = $('#splashText'); if (el) el.textContent = t; };

// ---------- HANDLER GLOBAL DE ERROS ----------
// Captura erros não tratados (JS + promises rejeitadas) para o usuário não ficar
// num estado quebrado sem feedback. Guarda as últimas ocorrências em
// window.__lastErrors para diagnóstico (o usuário pode copiar e enviar).
window.__lastErrors = [];
const _logGlobalError = (kind, message, src) => {
  try {
    const entry = { at: new Date().toISOString(), kind, message: String(message).slice(0, 500), src: src || '' };
    window.__lastErrors.push(entry);
    if (window.__lastErrors.length > 20) window.__lastErrors.shift();
    console.error('[global]', kind, message, src || '');
    // Toast com rate-limit (1 a cada 8s) para não inundar a tela em loop de erro
    const now = Date.now();
    if (!_logGlobalError._last || now - _logGlobalError._last > 8000) {
      _logGlobalError._last = now;
      if (typeof toast === 'function' && document.getElementById('toastHost')) {
        toast(friendlyError({ message }) + ' — recarregue se persistir', 'error');
      }
    }
  } catch (e) { /* nunca deixar o handler de erro gerar erro */ }
};
window.addEventListener('error', (e) => {
  // Ignora erros de carregamento de recursos (img/script) — já tratados nos onerror locais
  if (e.target && e.target !== window && (e.target.tagName === 'IMG' || e.target.tagName === 'SCRIPT' || e.target.tagName === 'LINK')) return;
  _logGlobalError('error', e.message || e.error?.message || 'erro desconhecido', e.filename ? `${e.filename}:${e.lineno}` : '');
}, true);
window.addEventListener('unhandledrejection', (e) => {
  _logGlobalError('promise', e.reason?.message || e.reason || 'rejeição não tratada');
});

// ---------- INDICADOR DE OFFLINE ----------
// Sem conexão, os saves otimistas (edição inline) falham em segundo plano.
// Banner fixo avisa o usuário para não confiar no que está na tela.
window.addEventListener('offline', () => {
  if (document.getElementById('offlineBanner')) return;
  const div = document.createElement('div');
  div.id = 'offlineBanner';
  div.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:99998;padding:7px 16px;background:#c13b12;color:#fff;font-size:12px;font-weight:700;text-align:center;letter-spacing:.05em;';
  div.textContent = '⚠ SEM CONEXÃO — alterações feitas agora podem não ser salvas';
  document.body.appendChild(div);
});
window.addEventListener('online', () => {
  document.getElementById('offlineBanner')?.remove();
  if (typeof toast === 'function' && document.getElementById('toastHost')) {
    toast('Conexão restabelecida', 'success');
  }
});

// ---------- VERSION CHECK (cache-busting) ----------
// Compara APP_VERSION com o version.json do servidor (gerado no deploy).
// Se o servidor tem versão mais nova, o usuário está com HTML em cache → banner
// sugerindo recarregar. Silencioso se o arquivo não existir (ex.: ambiente local).
export async function checkAppVersion() {
  try {
    const res = await fetch('version.json?ts=' + Date.now(), { cache: 'no-store' });
    if (!res.ok) return;
    const { version } = await res.json();
    if (!version || version === APP_VERSION) return;
    if (document.getElementById('newVersionBanner')) return; // já avisado
    const div = document.createElement('div');
    div.id = 'newVersionBanner';
    div.style.cssText = 'position:fixed;bottom:16px;left:50%;transform:translateX(-50%);z-index:99999;display:flex;align-items:center;gap:12px;padding:10px 16px;background:var(--bg-elevated);border:1px solid var(--accent);border-radius:4px;box-shadow:0 6px 24px rgba(0,0,0,.25);font-size:13px;';
    div.innerHTML = `<span>🔄 Nova versão disponível (<b>${escapeHtml(version)}</b> — você está na ${APP_VERSION}).</span>
      <button class="btn btn-cta" style="padding:5px 12px;font-size:12px;" onclick="location.reload(true)">Atualizar agora</button>
      <button class="btn btn-ghost" style="padding:5px 8px;font-size:12px;" onclick="this.parentElement.remove()">depois</button>`;
    document.body.appendChild(div);
  } catch (e) { /* offline ou sem version.json — ignora */ }
}
