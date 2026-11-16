// Importação (CSV, MS Project XML, Prevision XLSX) e exportação MS Project
import { CPMCache } from './cpm.js';
import { DB } from './db.js';
import { Dialog } from './dialog.js';
import { friendlyError, setLoading, toast } from './feedback.js';
import { $, escapeHtml, fmtDateShort } from './helpers.js';
import { KanbanConfig } from './kanban-config.js';
import { Modal } from './modal.js';
import { MSPX } from './mspx.js';
import { State } from './state.js';
import { UI } from './ui.js';
import { Views } from './views.js';

// Plugado em UI: continuam acessíveis como UI.<método> e this.<método>.
Object.assign(UI, {
  // ===== IMPORT TAREFAS VIA CSV =====
  importTasksCSV() {
    if (!State.currentProjectId) { toast('Selecione um projeto primeiro', 'error'); return; }
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.csv,text/csv,text/plain';
    input.onchange = async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const text = await file.text();

      // ── Parse CSV ──────────────────────────────────────────────────────────
      const lines = text.split(/\r?\n/).filter(l => l.trim());
      if (lines.length < 2) { toast('CSV vazio ou sem linhas de dados', 'error'); return; }

      // Detect separator (, or ; or \t)
      const sep = lines[0].includes(';') ? ';' : lines[0].includes('\t') ? '\t' : ',';
      const parseRow = (line) => {
        const cells = []; let cur = '', inQ = false;
        for (let i = 0; i < line.length; i++) {
          const c = line[i];
          if (c === '"' && !inQ) { inQ = true; }
          else if (c === '"' && inQ && line[i+1] === '"') { cur += '"'; i++; }
          else if (c === '"' && inQ) { inQ = false; }
          else if (c === sep && !inQ) { cells.push(cur.trim()); cur = ''; }
          else { cur += c; }
        }
        cells.push(cur.trim());
        return cells;
      };

      const headers = parseRow(lines[0]).map(h => h.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9_]/g, '_'));
      const rows = lines.slice(1).map(l => {
        const cells = parseRow(l);
        const obj = {};
        headers.forEach((h, i) => { obj[h] = (cells[i] || '').trim(); });
        return obj;
      }).filter(r => Object.values(r).some(v => v));  // skip blank rows

      if (!rows.length) { toast('Nenhuma linha de dados encontrada', 'error'); return; }

      // ── Map column names (pt or en) ────────────────────────────────────────
      const col = (row, ...aliases) => {
        for (const a of aliases) { if (row[a] !== undefined) return row[a] || ''; }
        return '';
      };

      // ── Helper: match member by name (fuzzy) ───────────────────────────────
      const matchMember = (name) => {
        if (!name) return null;
        const q = name.toLowerCase().trim();
        return State.members.find(m => m.name.toLowerCase().includes(q) || q.includes(m.name.toLowerCase().split(' ')[0].toLowerCase())) || null;
      };

      // ── Helper: match discipline by code or name ───────────────────────────
      const matchDisc = (val) => {
        if (!val) return null;
        const q = val.toLowerCase().trim();
        return State.disciplines.find(d =>
          d.code.toLowerCase() === q || d.name.toLowerCase().includes(q) || q.includes(d.code.toLowerCase())
        ) || null;
      };

      // ── Normalize priority ─────────────────────────────────────────────────
      const normPrio = (v) => {
        if (!v) return 'media';
        const lv = v.toLowerCase().trim();
        if (lv.includes('alta') || lv.includes('high') || lv.includes('critica') || lv === 'a') return 'alta';
        if (lv.includes('baixa') || lv.includes('low') || lv === 'b') return 'baixa';
        return 'media';
      };

      // ── Build preview rows ─────────────────────────────────────────────────
      const parsed = rows.map((row, i) => {
        const title = col(row, 'titulo', 'title', 'tarefa', 'task', 'nome', 'name', 'descricao', 'description');
        const start = col(row, 'inicio', 'start', 'start_date', 'data_inicio', 'data_de_inicio');
        const end   = col(row, 'fim', 'termino', 'end', 'end_date', 'data_fim', 'prazo', 'deadline', 'data_termino');
        const assignee = col(row, 'responsavel', 'assignee', 'responsável', 'assigned_to', 'membro');
        const disc  = col(row, 'disciplina', 'discipline', 'disc', 'area');
        const prio  = col(row, 'prioridade', 'priority', 'prior');
        const member = matchMember(assignee);
        const discipline = matchDisc(disc);

        // Parse dates — support dd/mm/yyyy, yyyy-mm-dd, dd-mm-yyyy
        const parseDate = (s) => {
          if (!s) return null;
          if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
          const m = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
          if (m) return `${m[3]}-${m[2].padStart(2,'0')}-${m[1].padStart(2,'0')}`;
          return null;
        };

        return {
          _row: i + 2,
          title,
          start_date: parseDate(start),
          end_date:   parseDate(end),
          assignee_id: member?.id || null,
          discipline_id: discipline?.id || null,
          priority: normPrio(prio),
          _assigneeName: member?.name || (assignee || null),
          _discName: discipline?.code || (disc || null),
          _valid: !!title,
          _warn: !member && assignee ? `Responsável "${assignee}" não encontrado` : '',
        };
      });

      const valid = parsed.filter(r => r._valid);
      const invalid = parsed.filter(r => !r._valid);

      // ── Preview modal ──────────────────────────────────────────────────────
      const prioLabel = { critica: '⚡ Crítica', alta: '🔴 Alta', media: '🟡 Média', baixa: '🟢 Baixa' };
      Modal.open({
        title: `Importar ${valid.length} tarefa${valid.length !== 1 ? 's' : ''} do CSV`,
        cls: 'modal-wide',
        body: `
          <div style="font-family:var(--font-mono);font-size:10px;color:var(--ink-mute);margin-bottom:10px;">
            ${valid.length} linha${valid.length!==1?'s':''} válida${valid.length!==1?'s':''} · ${invalid.length} ignorada${invalid.length!==1?'s':''} (sem título) · Separador: "${sep === '\t' ? 'TAB' : sep}"
          </div>
          <div style="max-height:400px;overflow-y:auto;">
            <table style="width:100%;border-collapse:collapse;font-size:11px;">
              <thead><tr style="background:var(--bg-elevated);">
                <th style="padding:6px 8px;text-align:left;font-family:var(--font-mono);font-size:9px;color:var(--ink-mute);border-bottom:1px solid var(--border);">Título</th>
                <th style="padding:6px 8px;text-align:left;font-family:var(--font-mono);font-size:9px;color:var(--ink-mute);border-bottom:1px solid var(--border);">Início</th>
                <th style="padding:6px 8px;text-align:left;font-family:var(--font-mono);font-size:9px;color:var(--ink-mute);border-bottom:1px solid var(--border);">Fim</th>
                <th style="padding:6px 8px;text-align:left;font-family:var(--font-mono);font-size:9px;color:var(--ink-mute);border-bottom:1px solid var(--border);">Responsável</th>
                <th style="padding:6px 8px;text-align:left;font-family:var(--font-mono);font-size:9px;color:var(--ink-mute);border-bottom:1px solid var(--border);">Disc.</th>
                <th style="padding:6px 8px;text-align:left;font-family:var(--font-mono);font-size:9px;color:var(--ink-mute);border-bottom:1px solid var(--border);">Prior.</th>
              </tr></thead>
              <tbody>
              ${valid.map((r, i) => `
                <tr style="border-bottom:1px solid var(--border);${i%2===0?'background:var(--bg-deep);':''}${r._warn?'border-left:2px solid var(--accent-warm);':''}">
                  <td style="padding:5px 8px;font-weight:600;">${escapeHtml(r.title)}</td>
                  <td style="padding:5px 8px;font-family:var(--font-mono);font-size:10px;">${r.start_date || '<span style="color:var(--ink-mute)">—</span>'}</td>
                  <td style="padding:5px 8px;font-family:var(--font-mono);font-size:10px;">${r.end_date   || '<span style="color:var(--ink-mute)">—</span>'}</td>
                  <td style="padding:5px 8px;color:${r.assignee_id ? 'var(--ink)' : 'var(--accent-warn)'};font-size:10px;">${escapeHtml(r._assigneeName || '—')}</td>
                  <td style="padding:5px 8px;font-family:var(--font-mono);font-size:10px;color:var(--ink-mute);">${escapeHtml(r._discName || '—')}</td>
                  <td style="padding:5px 8px;font-size:10px;">${prioLabel[r.priority]}</td>
                </tr>
                ${r._warn ? `<tr style="${i%2===0?'background:var(--bg-deep);':''}"><td colspan="6" style="padding:2px 8px 5px;font-size:10px;color:var(--accent-warm);font-family:var(--font-mono);">⚠ ${escapeHtml(r._warn)}</td></tr>` : ''}
              `).join('')}
              </tbody>
            </table>
          </div>
          <div style="margin-top:10px;font-family:var(--font-mono);font-size:9px;color:var(--ink-mute);line-height:1.6;">
            Colunas aceitas: <strong>titulo, inicio, fim, responsavel, disciplina, prioridade</strong> (ou equivalentes em inglês)<br>
            Formatos de data: <strong>dd/mm/aaaa</strong> ou <strong>aaaa-mm-dd</strong>
          </div>
        `,
        footer: `
          <button class="btn btn-secondary" id="btnCancelCsvImport">Cancelar</button>
          <button class="btn btn-cta" id="btnConfirmCsvImport" ${valid.length===0?'disabled':''}>
            Importar ${valid.length} tarefa${valid.length!==1?'s':''}
          </button>
        `
      });

      $('#btnCancelCsvImport').onclick = () => Modal.close();
      $('#btnConfirmCsvImport').onclick = async () => {
        const btn = $('#btnConfirmCsvImport');
        btn.disabled = true; btn.textContent = 'Importando...';
        try {
          setLoading(true);
          let ok = 0, fail = 0;
          for (const row of valid) {
            try {
              const payload = {
                title: row.title,
                status: 'a_fazer',
                priority: row.priority,
                progress: 0,
              };
              if (row.start_date)    payload.start_date    = row.start_date;
              if (row.end_date)      payload.end_date      = row.end_date;
              if (row.assignee_id)   payload.assignee_id   = row.assignee_id;
              if (row.discipline_id) payload.discipline_id = row.discipline_id;
              await DB.createTask(State.currentProjectId, payload);
              ok++;
            } catch (e) { fail++; console.warn('Falha ao criar tarefa:', e.message); }
          }
          await DB.loadCurrentProject();
          Modal.close();
          await UI.render();
          toast(`✓ ${ok} tarefa${ok!==1?'s':''} importada${ok!==1?'s':''}${fail>0?' · '+fail+' falha(s)':''}`, ok > 0 ? 'success' : 'error');
        } catch (err) {
          toast('Erro na importação: ' + err.message, 'error');
        } finally { setLoading(false); }
      };
    };
    input.click();
  },

  // ===== IMPORT MS PROJECT XML =====
  // ===== IMPORTAR PREVISION (.xlsx) =====
  // Lê XLSX exportado do Prevision. Colunas esperadas:
  // A=EAP B=Nome C=Início D=Fim E=Duração H=Progresso K=Custo L=Status
  // M=Responsáveis O=Predecessor Q/R=Linha de base
  importPrevisionXLSX() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    input.onchange = async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      try {
        setLoading(true);
        // XLSX é um ZIP; lê via JSZip (CDN com SRI — import() dinâmico não suporta integrity)
        if (!window.JSZip) {
          await new Promise((resolve, reject) => {
            const s = document.createElement('script');
            s.src = 'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js';
            s.integrity = 'sha384-+mbV2IY1Zk/X1p/nWllGySJSUN8uMs+gUAN10Or95UBH0fpj6GfKgPmgC5EXieXG';
            s.crossOrigin = 'anonymous';
            s.onload = resolve;
            s.onerror = () => reject(new Error('Não foi possível carregar o leitor de XLSX. Verifique sua conexão.'));
            document.head.appendChild(s);
          });
        }
        const JSZip = window.JSZip;
        const buf = await file.arrayBuffer();
        const zip = await JSZip.loadAsync(buf);
        // Pega a primeira planilha
        const sheetFile = zip.file('xl/worksheets/sheet1.xml') || Object.values(zip.files).find(f => /xl\/worksheets\/sheet\d+\.xml$/.test(f.name));
        if (!sheetFile) throw new Error('Planilha (xl/worksheets/sheet1.xml) não encontrada no XLSX');
        const sheetXml = await sheetFile.async('string');

        // Carrega sharedStrings se existir
        const ssFile = zip.file('xl/sharedStrings.xml');
        const sharedStrings = [];
        if (ssFile) {
          const ssXml = await ssFile.async('string');
          const dom = new DOMParser().parseFromString(ssXml, 'text/xml');
          dom.querySelectorAll('si').forEach(si => {
            // pode ter múltiplos <t> em <r> (rich text)
            sharedStrings.push(Array.from(si.querySelectorAll('t')).map(t => t.textContent).join(''));
          });
        }

        // Parse sheet
        const dom = new DOMParser().parseFromString(sheetXml, 'text/xml');
        const errN = dom.querySelector('parsererror');
        if (errN) throw new Error('XML da planilha mal formado');

        const rows = [];
        dom.querySelectorAll('row').forEach(rowEl => {
          const cells = {};
          rowEl.querySelectorAll('c').forEach(cEl => {
            const ref = cEl.getAttribute('r') || '';
            const col = ref.match(/^([A-Z]+)/)?.[1] || '';
            const t = cEl.getAttribute('t') || '';
            let v = '';
            if (t === 'inlineStr') {
              v = Array.from(cEl.querySelectorAll('is t')).map(x => x.textContent).join('');
            } else if (t === 's') {
              const idx = parseInt(cEl.querySelector('v')?.textContent || '0');
              v = sharedStrings[idx] || '';
            } else {
              v = cEl.querySelector('v')?.textContent || '';
            }
            cells[col] = v.trim();
          });
          rows.push(cells);
        });

        if (rows.length < 2) throw new Error('Planilha sem dados');
        // Detecta cabeçalho (primeira linha não-vazia) e ignora
        const header = rows.find(r => (r['A']||'').toUpperCase().includes('EAP') || (r['B']||'').toUpperCase().includes('NOME')) || rows[0];
        const headerIdx = rows.indexOf(header);
        const dataRows = rows.slice(headerIdx + 1).filter(r => (r['A']||'').trim() && (r['B']||'').trim());

        // ── Parse Prevision rows ────────────────────────────────────────────────
        const parseDate = s => {
          if (!s) return null;
          // dd/mm/yyyy
          const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
          if (m) return `${m[3]}-${m[2].padStart(2,'0')}-${m[1].padStart(2,'0')}`;
          return null;
        };
        const parseCost = s => {
          if (!s) return 0;
          const n = parseFloat(String(s).replace(/[R$\s.]/g, '').replace(',', '.'));
          return isNaN(n) ? 0 : n;
        };
        // Adapta o status do Prevision ao Kanban configurado do projeto atual.
        // Tenta casar por label (case-insensitive, sem acento); cai para defaults canônicos
        // (a_fazer / em_andamento / bloqueada / concluido) se a coluna não existir.
        const _norm = s => (s||'').toString().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
        const _kanbanCols = KanbanConfig.get(); // [{id, label, ...}]
        const _findKbId = (...candidates) => {
          for (const c of candidates) {
            const target = _norm(c);
            const hit = _kanbanCols.find(col => _norm(col.label) === target || _norm(col.id) === target);
            if (hit) return hit.id;
          }
          // fallback: primeiro id canônico encontrado na lista (preserva ordem do Kanban)
          for (const c of candidates) {
            const target = _norm(c);
            const hit = _kanbanCols.find(col => _norm(col.label).includes(target) || _norm(col.id).includes(target));
            if (hit) return hit.id;
          }
          return _kanbanCols[0]?.id || 'a_fazer';
        };
        // Pré-resolve uma vez para todas as tarefas
        const _stConcluido    = _findKbId('Concluído', 'Concluida', 'Concluido', 'concluido', 'Feito', 'Done');
        const _stEmAndamento  = _findKbId('Em Andamento', 'Em andamento', 'em_andamento', 'Andamento', 'Doing', 'Em Execução');
        const _stBloqueada    = _findKbId('Bloqueada', 'Bloqueado', 'bloqueada', 'Blocked');
        const _stAFazer       = _findKbId('A Fazer', 'A fazer', 'a_fazer', 'Backlog', 'Pendente', 'To Do');
        const statusMap = {
          'concluído': _stConcluido, 'concluido': _stConcluido, 'feito': _stConcluido,
          'bloqueado': _stBloqueada, 'bloqueada': _stBloqueada,
          'desenvolvendo': _stEmAndamento, 'em andamento': _stEmAndamento, 'em_andamento': _stEmAndamento, 'validando': _stEmAndamento,
          'não priorizado': _stAFazer, 'nao priorizado': _stAFazer,
          'priorizada para o ciclo': _stAFazer, 'a fazer': _stAFazer, 'a_fazer': _stAFazer,
        };
        const tasks = [];
        const eapToUid = new Map();
        dataRows.forEach((r, i) => {
          const eap = (r['A']||'').trim();
          const name = (r['B']||'').trim();
          if (!eap || !name) return;
          const start = parseDate(r['C']) || parseDate(r['T']) || parseDate(r['Q']);
          const end   = parseDate(r['D']) || parseDate(r['R']);
          if (!start || !end) return;
          const uid = String(i + 1);
          eapToUid.set(eap, uid);
          // Determina parent pelo EAP (prefixo)
          let parent_eap = null;
          if (eap.includes('.')) parent_eap = eap.slice(0, eap.lastIndexOf('.'));
          const pct = Math.max(0, Math.min(100, parseFloat(r['H']||'0') || 0));
          const status = statusMap[_norm(r['L'])] || (pct >= 100 ? _stConcluido : pct > 0 ? _stEmAndamento : _stAFazer);
          tasks.push({
            uid, eap, parent_eap,
            title: name,
            start_date: start, end_date: end,
            progress: pct,
            cost: parseCost(r['K']),
            status,
            assignee_name: (r['M']||'').split(';')[0].trim(), // primeiro nome
            baseline_start: parseDate(r['Q']),
            baseline_end:   parseDate(r['R']),
            pred_raw: (r['O']||'').trim(),
            // Duração 0 (start = end) marca como milestone (será reavaliado depois
            // que a hierarquia for resolvida — pais com filhos perdem o flag).
            is_milestone: !!(start && end && start === end),
          });
        });

        // Resolve parent_uid via parent_eap
        tasks.forEach(t => {
          t.parent_uid = t.parent_eap ? (eapToUid.get(t.parent_eap) || null) : null;
        });
        // Remove flag de marco das tarefas que têm filhos (parent ≠ marco)
        const _hasChildren = new Set(tasks.map(t => t.parent_uid).filter(Boolean));
        tasks.forEach(t => { if (_hasChildren.has(t.uid)) t.is_milestone = false; });

        // Predecessores: formato "EAP+Nd" ou "EAP-Nd" ou "EAP", múltiplos separados por vírgula
        const deps = [];
        tasks.forEach(t => {
          if (!t.pred_raw) return;
          t.pred_raw.split(/[,;]/).forEach(s => {
            const tok = s.trim();
            if (!tok) return;
            const m = tok.match(/^([\d.]+)([+-]\d+)?d?$/i) || tok.match(/^([\d.]+)/);
            if (!m) return;
            const predEap = m[1];
            const lag = m[2] ? parseInt(m[2]) : 0;
            const predUid = eapToUid.get(predEap);
            if (predUid && predUid !== t.uid) {
              deps.push({ task_uid: t.uid, predecessor_uid: predUid, type: 'FS', lag_days: lag });
            }
          });
        });

        if (tasks.length === 0) { toast('Planilha sem tarefas válidas (verifique EAP, Nome, Início, Fim)', 'error'); return; }

        // ── Pré-visualização ────────────────────────────────────────────────────
        const byUid = new Map(tasks.map(t => [t.uid, t]));
        const depthOf = (t) => { let d = 0, p = t.parent_uid; while (p && byUid.has(p)) { d++; p = byUid.get(p).parent_uid; } return d; };

        Modal.open({
          title: `Importar Prevision (${tasks.length} tarefas)`,
          cls: 'modal-extrawide',
          body: `
            <div style="font-size:13px;color:var(--ink-soft);margin-bottom:14px;">
              Importando do <strong>Prevision</strong>. Hierarquia, linha de base, predecessores e progresso serão preservados.
              As tarefas serão adicionadas ao projeto atual.
            </div>
            <div style="max-height:300px;overflow-y:auto;border:1px solid var(--border);border-radius:2px;">
              <table class="data-table" style="width:100%;">
                <thead><tr><th style="width:60px;">EAP</th><th>Tarefa</th><th style="width:90px;">Início</th><th style="width:90px;">Fim</th><th style="width:55px;text-align:center;">%</th><th style="width:50px;text-align:center;">LB</th><th style="width:100px;">Status</th></tr></thead>
                <tbody>
                  ${tasks.map(t => {
                    const d = depthOf(t);
                    return `<tr>
                      <td style="font-family:var(--font-mono);font-size:10px;color:var(--accent);">${escapeHtml(t.eap)}</td>
                      <td style="font-size:12px;">${'&nbsp;&nbsp;&nbsp;&nbsp;'.repeat(d)}${d > 0 ? '↳ ' : ''}${escapeHtml(t.title)}</td>
                      <td class="col-code">${fmtDateShort(t.start_date)}</td>
                      <td class="col-code">${fmtDateShort(t.end_date)}</td>
                      <td class="col-code" style="text-align:center;">${Math.round(t.progress)}%</td>
                      <td class="col-code" style="text-align:center;">${t.baseline_start ? '✓' : '—'}</td>
                      <td style="font-size:11px;">${t.status}</td>
                    </tr>`;
                  }).join('')}
                </tbody>
              </table>
            </div>
            <div style="font-size:11px;color:var(--ink-mute);margin-top:8px;font-family:var(--font-mono);">
              ${deps.length} dependência(s) · ${tasks.filter(t => tasks.some(x => x.parent_uid === t.uid)).length} tarefa(s) pai · ${tasks.filter(t => t.baseline_start).length} com linha de base
            </div>`,
          footer: `<button class="btn btn-secondary" id="btnCancelPrev">Cancelar</button>
                   <button class="btn btn-cta" id="btnApplyPrev">Importar</button>`
        });
        $('#btnCancelPrev').onclick = () => Modal.close();
        $('#btnApplyPrev').onclick = async () => {
          Modal.close();
          try {
            setLoading(true);
            const idMap = new Map();
            const createResilient = async (payload) => {
              try { return await DB.createTask(State.currentProjectId, payload); }
              catch (err) {
                const msg = err.message || '';
                let stripped = false;
                for (const col of ['parent_id', 'baseline_start', 'baseline_end', 'cost']) {
                  if (msg.includes(col) && col in payload) { delete payload[col]; stripped = true; }
                }
                if (stripped) return await DB.createTask(State.currentProjectId, payload);
                throw err;
              }
            };
            // PERF: cria em lotes por nível de profundidade (pais antes de filhos)
            // Cada nível vira UMA chamada de INSERT, em vez de N roundtrips.
            const byDepth = new Map();
            tasks.forEach(t => {
              const d = depthOf(t);
              if (!byDepth.has(d)) byDepth.set(d, []);
              byDepth.get(d).push(t);
            });
            const depths = [...byDepth.keys()].sort((a, b) => a - b);
            for (const d of depths) {
              const group = byDepth.get(d);
              const payloads = group.map(t => {
                const payload = {
                  title: t.title,
                  start_date: t.start_date,
                  end_date: t.end_date,
                  status: t.status,
                  priority: 'media',
                  progress: t.progress,
                  cost: t.cost || null,
                  parent_id: t.parent_uid ? (idMap.get(t.parent_uid) || null) : null,
                };
                if (t.baseline_start) payload.baseline_start = t.baseline_start;
                if (t.baseline_end)   payload.baseline_end   = t.baseline_end;
                return payload;
              });
              let created;
              try {
                created = await DB.createTasksBatch(State.currentProjectId, payloads);
              } catch (err) {
                // Fallback: 1-a-1 se o batch falhar por algum motivo não tratado
                console.warn('[batch fallback] criando 1-a-1 neste nível:', err.message);
                created = [];
                for (const p of payloads) {
                  const c = await createResilient(p);
                  created.push(c);
                }
              }
              created.forEach((c, i) => {
                idMap.set(group[i].uid, c.id);
                State.tasks.push(c);
              });
            }
            let depsImported = 0;
            for (const d of deps) {
              const taskId = idMap.get(d.task_uid);
              const predId = idMap.get(d.predecessor_uid);
              if (!taskId || !predId) continue;
              try {
                const created = await DB.createDependency({ task_id: taskId, predecessor_id: predId, type: d.type, lag_days: d.lag_days });
                State.dependencies.push(created);
                depsImported++;
              } catch (e) { /* duplicates */ }
            }
            await UI.render();
            toast(`Importado: ${tasks.length} tarefas · ${depsImported} dependências`, 'success');
          } catch (err) { toast(friendlyError(err), 'error'); }
          finally { setLoading(false); }
        };
      } catch (err) {
        console.error(err);
        toast('Erro ao processar Prevision XLSX: ' + err.message, 'error');
      } finally { setLoading(false); }
    };
    input.click();
  },

  // ===== MIGRAÇÃO: Corrige tipos de dependências importadas antes da v2.4.5 =====
  // Versões antigas tinham TYPE_MAP do MSPX invertido (0↔1 e 2↔3), resultando
  // em FS gravado como FF, FF como FS, SS como SF e SF como SS.
  // Este utilitário inverte os tipos em todas as dependências do projeto atual.
  async fixMSPXLegacyDepTypes() {
    if (!State.currentProjectId) { toast('Selecione um projeto', 'warning'); return; }
    const deps = State.dependencies || [];
    if (!deps.length) { toast('Nenhuma dependência neste projeto', 'info'); return; }

    // Contagem por tipo antes
    const before = { FS: 0, FF: 0, SS: 0, SF: 0 };
    deps.forEach(d => { if (before[d.type] !== undefined) before[d.type]++; });

    const swap = { FS: 'FF', FF: 'FS', SS: 'SF', SF: 'SS' };
    const after = { FS: before.FF, FF: before.FS, SS: before.SF, SF: before.SS };

    const ok = await Dialog.confirm({
      title: 'Corrigir tipos de dependência?',
      msg:
        `Esta ferramenta INVERTE os tipos das ${deps.length} dependências:\n\n` +
        `   FS ↔ FF   |   SS ↔ SF\n\n` +
        `Antes:  ${before.FS} FS · ${before.FF} FF · ${before.SS} SS · ${before.SF} SF\n` +
        `Depois: ${after.FS} FS · ${after.FF} FF · ${after.SS} SS · ${after.SF} SF\n\n` +
        `Use somente se você importou de MS Project (.xml) antes da versão 2.4.5 e os tipos ficaram trocados.\n\n` +
        `Esta operação NÃO altera datas. Faça baseline antes se quiser preservar referência.`,
      confirmText: 'Inverter tipos',
      danger: true,
    });
    if (!ok) return;

    try {
      setLoading(true);
      let okCount = 0, errCount = 0;
      // Atualiza em paralelo
      await Promise.all(deps.map(async (d) => {
        const newType = swap[d.type];
        if (!newType || newType === d.type) return;
        try {
          const { error } = await State.supabase
            .from('task_dependencies').update({ type: newType }).eq('id', d.id);
          if (error) throw error;
          d.type = newType;
          okCount++;
        } catch (e) { errCount++; console.warn('[fix-mspx]', d.id, e.message); }
      }));
      CPMCache.invalidate();
      await UI.render();
      if (errCount > 0) {
        toast(`⚠ ${okCount} corrigidas, ${errCount} falharam`, 'warning');
      } else {
        toast(`✓ ${okCount} dependências corrigidas`, 'success');
      }
    } catch (err) {
      toast(friendlyError(err), 'error');
    } finally { setLoading(false); }
  },

  importMSProjectXML() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.xml,application/xml,text/xml';
    input.onchange = async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      try {
        setLoading(true);
        const text = await file.text();
        const parsed = MSPX.parse(text);
        if (!parsed || parsed.tasks.length === 0) {
          toast('XML inválido ou sem tarefas', 'error');
          return;
        }
        // Modal de preview
        Modal.open({
          title: `Importar ${parsed.tasks.length} ${parsed.tasks.length === 1 ? 'tarefa' : 'tarefas'} do XML`,
          body: `
            <div style="font-size:13px;color:var(--ink-soft);margin-bottom:14px;">
              <strong>Atenção:</strong> as novas tarefas serão adicionadas ao projeto atual. As tarefas existentes <strong>não</strong> serão removidas. Dependências do XML serão importadas se as duas tarefas envolvidas forem importadas.
            </div>
            <div style="max-height:300px;overflow-y:auto;border:1px solid var(--border);border-radius:2px;">
              <table class="data-table" style="width:100%;">
                <thead><tr><th>Título (hierarquia)</th><th style="width:110px;">Início</th><th style="width:110px;">Término</th><th style="width:60px;text-align:center;">%</th><th style="width:50px;text-align:center;">LB</th><th style="width:60px;text-align:center;">Marco</th><th style="width:60px;text-align:center;">Inativa</th></tr></thead>
                <tbody>
                  ${(() => {
                    // Profundidade pela cadeia de parent_uid (para indentação na prévia)
                    const byUid = new Map(parsed.tasks.map(t => [t.uid, t]));
                    const depthOf = (t) => { let d = 0, p = t.parent_uid; const seen = new Set(); while (p && byUid.has(p) && !seen.has(p)) { seen.add(p); d++; p = byUid.get(p).parent_uid; } return d; };
                    return parsed.tasks.map(t => {
                      const d = depthOf(t);
                      const isParent = parsed.tasks.some(x => x.parent_uid === t.uid);
                      return `<tr${t.inactive ? ' style="opacity:.55;"' : ''}>
                        <td style="font-size:12px;${isParent ? 'font-weight:700;' : ''}">${'&nbsp;&nbsp;&nbsp;&nbsp;'.repeat(d)}${d > 0 ? '↳ ' : ''}${escapeHtml(t.title)}</td>
                        <td class="col-code">${fmtDateShort(t.start_date)}</td>
                        <td class="col-code">${fmtDateShort(t.end_date)}</td>
                        <td class="col-code" style="text-align:center;">${Math.round(t.progress || 0)}%</td>
                        <td class="col-code" style="text-align:center;">${t.baseline_start ? '✓' : '—'}</td>
                        <td class="col-code" style="text-align:center;">${t.is_milestone ? '◆' : '—'}</td>
                        <td class="col-code" style="text-align:center;">${t.inactive ? '⏸' : '—'}</td>
                      </tr>`;
                    }).join('');
                  })()}
                </tbody>
              </table>
            </div>
            <div style="font-size:11px;color:var(--ink-mute);margin-top:8px;font-family:var(--font-mono);">
              ${parsed.dependencies.length} ${parsed.dependencies.length === 1 ? 'dependência' : 'dependências'} · ${parsed.tasks.filter(t => parsed.tasks.some(x => x.parent_uid === t.uid)).length} tarefa(s) pai · ${parsed.tasks.filter(t => t.baseline_start).length} com linha de base
            </div>
          `,
          footer: `
            <button class="btn btn-secondary" id="btnCancelImp">Cancelar</button>
            <button class="btn btn-cta" id="btnApplyImp">Importar</button>
          `
        });
        $('#btnCancelImp').onclick = () => Modal.close();
        $('#btnApplyImp').onclick = async () => {
          Modal.close(); // fecha a janela imediatamente ao confirmar
          try {
            setLoading(true);
            const idMap = new Map(); // xml_uid → uuid no banco
            const byUid = new Map(parsed.tasks.map(t => [t.uid, t]));
            const depthOf = (t) => { let d = 0, p = t.parent_uid, seen = new Set(); while (p && byUid.has(p) && !seen.has(p)) { seen.add(p); d++; p = byUid.get(p).parent_uid; } return d; };
            const maxDepth = parsed.tasks.reduce((m, t) => Math.max(m, depthOf(t)), 0);

            const buildPayload = (t) => {
              const pct = Math.max(0, Math.min(100, parseFloat(t.progress) || 0));
              const status = pct >= 100 ? 'concluido' : (pct > 0 ? 'em_andamento' : 'a_fazer');
              const pl = {
                title: t.title, start_date: t.start_date, end_date: t.end_date,
                status, priority: 'media', progress: pct,
                is_milestone: t.is_milestone || false, inactive: t.inactive || false,
                parent_id: t.parent_uid ? (idMap.get(t.parent_uid) || null) : null,
              };
              if (t.baseline_start) pl.baseline_start = t.baseline_start;
              if (t.baseline_end)   pl.baseline_end = t.baseline_end;
              return pl;
            };

            // Inserção em LOTE, nível por nível (pais antes dos filhos p/ resolver parent_id).
            // Troca centenas de chamadas sequenciais por poucos inserts — essencial p/ 500+ tarefas.
            const CHUNK = 200;
            let createdCount = 0;
            for (let lvl = 0; lvl <= maxDepth; lvl++) {
              const levelTasks = parsed.tasks.filter(t => depthOf(t) === lvl);
              for (let i = 0; i < levelTasks.length; i += CHUNK) {
                const slice = levelTasks.slice(i, i + CHUNK);
                const created = await DB.createTasksBatch(State.currentProjectId, slice.map(buildPayload));
                created.forEach((row, j) => { if (slice[j]) idMap.set(slice[j].uid, row.id); State.tasks.push(row); });
                createdCount += created.length;
              }
            }

            // Dependências em lote — com fallback por linha em caso de duplicata/erro pontual
            const depRows = parsed.dependencies.map(d => {
              const task_id = idMap.get(d.task_uid), predecessor_id = idMap.get(d.predecessor_uid);
              return (task_id && predecessor_id) ? { task_id, predecessor_id, type: d.type, lag_days: d.lag_days } : null;
            }).filter(Boolean);
            let depsImported = 0;
            for (let i = 0; i < depRows.length; i += CHUNK) {
              const slice = depRows.slice(i, i + CHUNK);
              try {
                const { data, error } = await State.supabase.from('task_dependencies').insert(slice).select();
                if (error) throw error;
                (data || []).forEach(x => State.dependencies.push(x));
                depsImported += (data || []).length;
              } catch (e) {
                for (const dr of slice) {
                  try { const c = await DB.createDependency(dr); State.dependencies.push(c); depsImported++; } catch (_) { /* duplicata */ }
                }
              }
            }
            CPMCache.invalidate();
            await UI.render();
            toast(`Importado: ${createdCount} ${createdCount === 1 ? 'tarefa' : 'tarefas'} e ${depsImported} ${depsImported === 1 ? 'dependência' : 'dependências'}`, 'success');
          } catch (err) { toast('Erro ao importar: ' + err.message, 'error'); }
          finally { setLoading(false); }
        };
      } catch (err) {
        console.error(err);
        toast('Erro ao processar XML: ' + err.message, 'error');
      } finally { setLoading(false); }
    };
    input.click();
  },

  // ===== EXPORT MS PROJECT XML =====
  exportMSProjectXML() {
    if (State.tasks.length === 0) { toast('Sem tarefas para exportar', 'error'); return; }
    const project = Views.current();
    const xml = MSPX.serialize(project, State.tasks, State.dependencies, State.members);
    const blob = new Blob([xml], { type: 'application/xml' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    const safeName = (project?.name || 'projeto').replace(/[^a-z0-9]/gi, '_');
    link.href = url;
    link.download = `${safeName}.xml`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast(`Exportado ${State.tasks.length} ${State.tasks.length === 1 ? 'tarefa' : 'tarefas'} em XML`, 'success');
  },
});
