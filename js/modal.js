// Modal
import { $ } from './helpers.js';

// ---------- MODAL ----------
// Estado de "dirty" — quando um form do modal é editado, marca como dirty.
// Modal.close() verifica e pergunta antes de descartar.
export const Modal = {
  _dirty: false,
  markDirty()   { this._dirty = true;  },
  clearDirty()  { this._dirty = false; },
  isDirty()     { return this._dirty;  },
  // Instala tracker uma única vez no #modal (delegação por evento)
  _installDirtyTracker() {
    if (this._trackerInstalled) return;
    const modal = $('#modal');
    if (!modal) return;
    const onInput = (e) => {
      if (!e.isTrusted) return; // ignora mudanças programáticas
      const tag = (e.target?.tagName || '').toLowerCase();
      if (['input', 'textarea', 'select'].includes(tag) || e.target?.isContentEditable) {
        this.markDirty();
      }
    };
    modal.addEventListener('input', onInput, true);
    modal.addEventListener('change', onInput, true);
    // Ao clicar em "Salvar" (btn-cta no rodapé), limpa dirty
    // assumindo que o save vai prosseguir. Caso falhe, o modal é re-aberto.
    modal.addEventListener('click', (e) => {
      const saveBtn = e.target.closest('.modal-foot .btn-cta, .modal-foot .btn-primary');
      if (saveBtn) this.clearDirty();
    }, true);
    this._trackerInstalled = true;
  },
  open({ title, body, footer, cls = '' }) {
    this.clearDirty();
    this._installDirtyTracker();
    const el = $('#modal');
    el.className = 'modal' + (cls ? ' ' + cls : '');
    $('#modalTitle').textContent = title;
    $('#modalBody').innerHTML = body;
    $('#modalFoot').innerHTML = footer || '';
    $('#modalBackdrop').classList.add('active');
    // Acessibilidade: guarda o foco anterior e prende o Tab dentro do modal
    this._prevFocus = document.activeElement;
    this._installFocusTrap();
    // Auto-foca o primeiro campo interativo (exceto botões) para facilitar a digitação imediata
    setTimeout(() => {
      const first = $('#modal').querySelector('input:not([type="hidden"]):not([readonly]):not([disabled]), textarea:not([readonly]):not([disabled]), select:not([disabled])');
      if (first) try { first.focus(); } catch(_) {}
    }, 80);
  },
  // Focus trap: Tab/Shift+Tab circulam só pelos elementos focáveis do modal
  _installFocusTrap() {
    if (this._trapInstalled) return;
    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Tab') return;
      const backdrop = $('#modalBackdrop');
      if (!backdrop || !backdrop.classList.contains('active')) return;
      const modal = $('#modal');
      const focusables = modal.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
      if (!focusables.length) return;
      const first = focusables[0], last = focusables[focusables.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      else if (!modal.contains(document.activeElement)) { e.preventDefault(); first.focus(); }
    });
    this._trapInstalled = true;
  },
  close(force = false) {
    if (this._dirty && !force) {
      if (!confirm('Você tem alterações não salvas. Deseja descartá-las?')) return;
    }
    this.clearDirty();
    $('#modal').className = 'modal';
    $('#modalBackdrop').classList.remove('active');
    // Devolve o foco para onde estava antes do modal abrir
    if (this._prevFocus && document.contains(this._prevFocus)) { try { this._prevFocus.focus(); } catch (e) {} }
    this._prevFocus = null;
  },
  // Força fechamento (uso interno após Salvar/Excluir confirmados)
  forceClose() { this.close(true); }
};
// Escopo global: atributos onclick inline só enxergam window.*
window.Modal = Modal;
