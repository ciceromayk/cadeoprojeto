// Menções (@usuário) em comentários
import { escapeHtml } from './helpers.js';
import { State } from './state.js';

// ============================================================================
// MENÇÕES (@ user) — parsing e rendering
// ============================================================================
// Formato persistido (markdown-like): @[Nome do Usuário](uuid)
// Quando renderizado: <span class="mention" data-uid="uuid">@Nome do Usuário</span>
//
// Sintaxe na hora da digitação: usuário digita @, autocomplete sugere usuários,
// ao escolher um, insere @[Nome](uuid) no texto.

// Renderiza body de comentário com menções → HTML seguro
export function renderCommentBody(body) {
  if (!body) return '';
  // Primeiro escapa o HTML inteiro para segurança
  const escaped = escapeHtml(body);
  // Como escapeHtml transformou \[ em &#91; (ou similar), trabalhamos sobre o body original
  // mas substituindo as menções por placeholders seguros
  let html = '';
  let lastIdx = 0;
  const regex = /@\[([^\]]+)\]\(([0-9a-f-]+)\)/g;
  let m;
  while ((m = regex.exec(body)) !== null) {
    // Pega texto antes da menção e escapa
    html += escapeHtml(body.slice(lastIdx, m.index));
    // Insere a menção como pílula
    const name = escapeHtml(m[1]);
    const uid = escapeHtml(m[2]);
    const isMe = uid === State.user?.id;
    html += `<span class="mention${isMe ? ' mention-me' : ''}" data-uid="${uid}" title="${name}">@${name}</span>`;
    lastIdx = m.index + m[0].length;
  }
  html += escapeHtml(body.slice(lastIdx));
  return html;
}

// Extrai os UUIDs de usuários mencionados em um texto (para validação cliente)
function extractMentionUuids(body) {
  if (!body) return [];
  const out = [];
  const regex = /@\[[^\]]+\]\(([0-9a-f-]+)\)/g;
  let m;
  while ((m = regex.exec(body)) !== null) out.push(m[1]);
  return out;
}
