// Atalhos de teclado
import { $, escapeHtml } from './helpers.js';
import { Modal } from './modal.js';

// ============================================================================
// KEYBOARD SHORTCUTS — registro centralizado + modal de ajuda
// ============================================================================
export const KeyboardShortcuts = {
  REGISTRY: [
    { group: 'Global', keys: ['Ctrl', 'K'], desc: 'Busca global' },
    { group: 'Global', keys: ['Alt', 'N'], desc: 'Nova tarefa em qualquer projeto' },
    { group: 'Global', keys: ['?'], desc: 'Mostrar atalhos de teclado' },
    { group: 'Global', keys: ['Esc'], desc: 'Fechar busca / overlay (não fecha modais)' },
    { group: 'Navegação', keys: ['G', 'D'], desc: 'Ir para Dashboard' },
    { group: 'Navegação', keys: ['G', 'T'], desc: 'Ir para Tarefas' },
    { group: 'Navegação', keys: ['G', 'C'], desc: 'Ir para Cronograma (Gantt)' },
    { group: 'Navegação', keys: ['G', 'S'], desc: 'Ir para Saúde do Projeto' },
    { group: 'Navegação', keys: ['G', 'R'], desc: 'Ir para Relatórios' },
    { group: 'Modal', keys: ['Ctrl', 'Enter'], desc: 'Salvar formulário do modal aberto' },
    { group: 'Gantt', keys: ['Botão direito'], desc: 'Menu de contexto da tarefa' },
    { group: 'Gantt', keys: ['1 clique'], desc: 'Editar campo inline (na coluna clicada)' },
    { group: 'Gantt', keys: ['2 cliques'], desc: 'Abrir tarefa para edição' },
    { group: 'Gantt', keys: ['Roda do meio + drag'], desc: 'Pan (arrastar gráfico)' },
  ],
  open() {
    const grouped = {};
    this.REGISTRY.forEach(s => {
      if (!grouped[s.group]) grouped[s.group] = [];
      grouped[s.group].push(s);
    });
    const kbd = (k) => `<kbd style="display:inline-block;padding:2px 7px;background:var(--bg-deep);border:1px solid var(--border-strong);border-bottom-width:2px;border-radius:3px;font-family:var(--font-mono);font-size:11px;color:var(--ink);min-width:18px;text-align:center;">${k}</kbd>`;
    const body = Object.entries(grouped).map(([group, items]) => `
      <div style="margin-bottom:16px;">
        <div style="font-family:var(--font-mono);font-size:10px;color:var(--ink-mute);text-transform:uppercase;letter-spacing:.12em;margin-bottom:8px;border-bottom:1px solid var(--border);padding-bottom:5px;">${group}</div>
        ${items.map(s => `
          <div style="display:flex;align-items:center;gap:12px;padding:6px 0;">
            <div style="flex:1;font-size:13px;color:var(--ink-soft);">${escapeHtml(s.desc)}</div>
            <div style="display:flex;align-items:center;gap:4px;">${s.keys.map((k, i) => kbd(k) + (i < s.keys.length - 1 ? '<span style="color:var(--ink-mute);font-size:10px;margin:0 2px;">+</span>' : '')).join('')}</div>
          </div>
        `).join('')}
      </div>`).join('');
    Modal.open({
      title: '⌨ Atalhos de Teclado',
      cls: 'modal-wide',
      body,
      footer: `<button class="btn btn-secondary" id="btnCloseKb">Fechar</button>`
    });
    $('#btnCloseKb').onclick = () => Modal.close();
  },
};
// Escopo global: atributos onclick inline só enxergam window.*
window.KeyboardShortcuts = KeyboardShortcuts;
