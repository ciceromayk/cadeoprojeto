// Instrumentação de desempenho

// ============================================================================
// PERFORMANCE — instrumentação para medir custos de cálculo e render
// ============================================================================
// Uso: envolva código com Perf.measure('label', () => { ... }) ou marca manual
// com Perf.start('label') + Perf.end('label'). Veja Perf.report() no console.
export const Perf = {
  _samples: Object.create(null), // { label: { count, total_ms, max_ms, min_ms } }
  _open: Object.create(null),    // marcas abertas (start sem end)
  enabled: true,
  start(label) {
    if (!this.enabled) return;
    this._open[label] = performance.now();
  },
  end(label) {
    if (!this.enabled) return;
    const t0 = this._open[label];
    if (t0 == null) return;
    const dt = performance.now() - t0;
    delete this._open[label];
    const s = this._samples[label] || (this._samples[label] = { count: 0, total_ms: 0, max_ms: 0, min_ms: Infinity });
    s.count++; s.total_ms += dt;
    if (dt > s.max_ms) s.max_ms = dt;
    if (dt < s.min_ms) s.min_ms = dt;
    return dt;
  },
  measure(label, fn) {
    this.start(label);
    try { return fn(); } finally { this.end(label); }
  },
  reset() { this._samples = Object.create(null); this._open = Object.create(null); },
  report() {
    const rows = Object.entries(this._samples)
      .map(([label, s]) => ({
        label,
        count: s.count,
        avg_ms: +(s.total_ms / s.count).toFixed(2),
        total_ms: +s.total_ms.toFixed(1),
        max_ms: +s.max_ms.toFixed(2),
        min_ms: +s.min_ms.toFixed(2),
      }))
      .sort((a, b) => b.total_ms - a.total_ms);
    console.table(rows);
    return rows;
  },
};
// Escopo global: atributos onclick inline só enxergam window.*
window.Perf = Perf;
