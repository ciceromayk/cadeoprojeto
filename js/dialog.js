// Diálogos de confirmação/prompt
import { escapeHtml } from './helpers.js';

// ============================================================================
// DIALOG — substitui confirm() e prompt() nativos com modais estilizados
// ============================================================================
export const Dialog = {
  _resolve: null,

  confirm({ title = 'Confirmar', msg = '', confirmText = 'Confirmar', danger = false, requireType = null } = {}) {
    return new Promise(resolve => {
      this._resolve = resolve;

      const overlay  = document.getElementById('confirmOverlay');
      const dialog   = document.getElementById('confirmDialog');
      const elTitle  = document.getElementById('confirmDialogTitle');
      const elMsg    = document.getElementById('confirmDialogMsg');
      const elTypeGr = document.getElementById('confirmDialogTypeGroup');
      const elTypeLb = document.getElementById('confirmDialogTypeLabel');
      const elTyped  = document.getElementById('confirmDialogTyped');
      const elOk     = document.getElementById('confirmDialogOk');
      const elCancel = document.getElementById('confirmDialogCancel');

      elTitle.textContent  = title;
      elMsg.textContent    = msg;
      elOk.textContent     = confirmText;

      dialog.classList.toggle('danger', danger);
      elOk.style.background   = danger ? 'var(--accent-danger)' : '';
      elOk.style.borderColor  = danger ? 'var(--accent-danger)' : '';
      elOk.className = 'btn btn-cta';

      if (requireType) {
        elTypeGr.style.display = '';
        elTypeLb.innerHTML = `Digite <strong style="color:var(--accent-danger);font-family:var(--font-mono);">"${escapeHtml(requireType)}"</strong> para confirmar:`;
        elTyped.value = '';
        elOk.disabled = true;
        elTyped.oninput = () => { elOk.disabled = elTyped.value !== requireType; };
        elTyped.onkeydown = (e) => { if (e.key === 'Enter' && !elOk.disabled) this._ok(); };
      } else {
        elTypeGr.style.display = 'none';
        elTyped.oninput = null;
        elOk.disabled = false;
      }

      elOk.onclick     = () => this._ok();
      elCancel.onclick = () => this._cancel();

      overlay.classList.add('active');
      setTimeout(() => (requireType ? elTyped : elOk).focus(), 60);
    });
  },

  _ok() {
    document.getElementById('confirmOverlay').classList.remove('active');
    if (this._resolve) { this._resolve(true); this._resolve = null; }
  },
  _cancel() {
    document.getElementById('confirmOverlay').classList.remove('active');
    if (this._resolve) { this._resolve(false); this._resolve = null; }
  },
};

// Fecha com Escape
document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && document.getElementById('confirmOverlay')?.classList.contains('active')) {
    Dialog._cancel();
  }
});
// Escopo global: atributos onclick inline só enxergam window.*
window.Dialog = Dialog;
