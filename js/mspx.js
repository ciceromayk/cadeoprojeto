// Importação/exportação MS Project XML
import { daysBetween, today } from './helpers.js';

// ============================================================================
// MSPX — MS Project XML serializer/parser
// ============================================================================
// Suporta formato XML do MS Project (Microsoft Office Project) e Primavera P6.
// Mapeia tarefas, dependências (FS/SS/FF/SF) e marcos.
// Não suporta recursos, calendários customizados, hierarquia WBS de N níveis.
// ============================================================================
export const MSPX = {
  // Mapas de código MSP → tipo interno
  // Referência oficial Microsoft: PredecessorLink.Type
  //   0 = Finish-to-Finish (FF)
  //   1 = Finish-to-Start  (FS) — padrão
  //   2 = Start-to-Finish  (SF)
  //   3 = Start-to-Start   (SS)
  TYPE_MAP:     { '0': 'FF', '1': 'FS', '2': 'SF', '3': 'SS' },
  TYPE_MAP_INV: { 'FF': '0', 'FS': '1', 'SF': '2', 'SS': '3' },

  // Converte data para formato MSP (ISO com hora 08:00:00)
  _formatDate(d) {
    if (!d) return '';
    return d + 'T08:00:00';
  },
  // Extrai YYYY-MM-DD de uma data MSP
  _parseDate(s) {
    if (!s) return null;
    return s.slice(0, 10);
  },
  // Lag em MSP é em "minutos" com sufixo (e.g. "1d", "5d")
  _formatLag(days) {
    if (!days || days === 0) return '0';
    // MSP usa décimos de minuto: 1 dia = 480 min em horário comercial; mas "Xd" também é aceito
    return days * 4800; // 1 dia = 480 min × 10 (décimos de minuto)
  },
  _parseLag(s) {
    if (!s) return 0;
    // Aceita "0", "4800" (décimos), "1d" etc
    const num = parseFloat(s);
    if (isNaN(num)) return 0;
    // Heurística: se for >= 100, assume décimos de minuto; se contém "d", dias
    if (typeof s === 'string' && s.toLowerCase().includes('d')) return parseInt(num);
    return Math.round(num / 4800);
  },

  // ========== SERIALIZADOR ==========
  serialize(project, tasks, dependencies, members) {
    const escapeXML = s => String(s || '').replace(/[<>&'"]/g, c =>
      ({'<':'&lt;','>':'&gt;','&':'&amp;',"'":'&apos;','"':'&quot;'})[c]);

    // Ordem hierárquica: pais antes dos filhos (mantém a ordem atual como ordem de irmãos)
    const childrenByParent = new Map();
    tasks.forEach(t => {
      const p = t.parent_id || null;
      if (!childrenByParent.has(p)) childrenByParent.set(p, []);
      childrenByParent.get(p).push(t);
    });
    const ordered = [];
    const depthByTask = new Map();
    const walkOrder = (parentId, depth) => {
      (childrenByParent.get(parentId) || []).forEach(t => {
        depthByTask.set(t.id, depth);
        ordered.push(t);
        walkOrder(t.id, depth + 1);
      });
    };
    walkOrder(null, 1);
    // Órfãs (parent_id aponta para fora do conjunto) entram no fim, nível 1
    tasks.forEach(t => { if (!depthByTask.has(t.id)) { depthByTask.set(t.id, 1); ordered.push(t); } });
    const parentIds = new Set(tasks.filter(t => t.parent_id).map(t => t.parent_id));

    // UID/ID numéricos estáveis seguindo a ordem hierárquica
    const uidByTaskId = new Map();
    ordered.forEach((t, i) => uidByTaskId.set(t.id, i + 1));

    const projStart = tasks.length > 0
      ? tasks.map(t => t.start_date).sort()[0]
      : (project?.start_date || today());
    const projEnd = tasks.length > 0
      ? tasks.map(t => t.end_date).sort().reverse()[0]
      : (project?.end_date || today());

    // Tasks XML (em ordem hierárquica)
    const tasksXml = ordered.map((t, i) => {
      const uid = uidByTaskId.get(t.id);
      const depth = depthByTask.get(t.id) || 1;
      const isParent = parentIds.has(t.id);
      const isMS = !!t.is_milestone ? '1' : '0';
      const dur = isMS === '1' ? 0 : Math.max(1, daysBetween(t.start_date, t.end_date));
      const durMin = dur * 4800; // décimos de minuto

      // Dependências desta tarefa (PredecessorLink)
      const predLinks = (dependencies || [])
        .filter(d => d.task_id === t.id)
        .map(d => {
          const predUid = uidByTaskId.get(d.predecessor_id);
          if (!predUid) return '';
          return `      <PredecessorLink>
        <PredecessorUID>${predUid}</PredecessorUID>
        <Type>${MSPX.TYPE_MAP_INV[d.type] || '1'}</Type>
        <LinkLag>${MSPX._formatLag(d.lag_days || 0)}</LinkLag>
        <LagFormat>7</LagFormat>
      </PredecessorLink>`;
        }).filter(Boolean).join('\n');

      const constraintTypeMap = { ASAP: '0', MSO: '4', MFO: '5', SNET: '2', FNLT: '7', ALAP: '1' };
      const cType = constraintTypeMap[t.constraint_type || 'ASAP'] || '0';
      const cDate = t.constraint_date ? MSPX._formatDate(t.constraint_date) : '';

      return `    <Task>
      <UID>${uid}</UID>
      <ID>${i + 1}</ID>
      <Name>${escapeXML(t.title)}</Name>
      <Type>${isMS}</Type>
      <IsNull>0</IsNull>
      <CreateDate>${new Date().toISOString()}</CreateDate>
      <WBS>${uid}</WBS>
      <OutlineNumber>${uid}</OutlineNumber>
      <OutlineLevel>${depth}</OutlineLevel>
      <Priority>${t.priority === 'alta' ? '700' : t.priority === 'baixa' ? '300' : '500'}</Priority>
      <Start>${MSPX._formatDate(t.start_date)}</Start>
      <Finish>${MSPX._formatDate(t.end_date)}</Finish>
      <Duration>PT${dur * 8}H0M0S</Duration>
      <DurationFormat>7</DurationFormat>
      <Work>PT${dur * 8}H0M0S</Work>
      <Milestone>${isMS}</Milestone>
      <Summary>${isParent ? '1' : '0'}</Summary>
      <PercentComplete>${Math.round(parseFloat(t.progress) || 0)}</PercentComplete>
      <PercentWorkComplete>${Math.round(parseFloat(t.progress) || 0)}</PercentWorkComplete>
      <ConstraintType>${cType}</ConstraintType>${cDate ? `\n      <ConstraintDate>${cDate}</ConstraintDate>` : ''}${t.constraint_reason ? `\n      <Notes>${escapeXML(t.constraint_reason)}</Notes>` : ''}
      ${t.baseline_start ? `<Baseline>
        <Number>0</Number>
        <Start>${MSPX._formatDate(t.baseline_start)}</Start>
        <Finish>${MSPX._formatDate(t.baseline_end)}</Finish>
        <Duration>PT${daysBetween(t.baseline_start, t.baseline_end) * 8}H0M0S</Duration>
        <DurationFormat>7</DurationFormat>
      </Baseline>` : ''}
${predLinks}
    </Task>`;
    }).join('\n');

    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Project xmlns="http://schemas.microsoft.com/project">
  <SaveVersion>14</SaveVersion>
  <Name>${escapeXML(project?.name || 'Projeto')}</Name>
  <Title>${escapeXML(project?.name || 'Projeto')}</Title>
  <Author>CadêOProjeto</Author>
  <CreationDate>${new Date().toISOString()}</CreationDate>
  <StartDate>${MSPX._formatDate(projStart)}</StartDate>
  <FinishDate>${MSPX._formatDate(projEnd)}</FinishDate>
  <ScheduleFromStart>1</ScheduleFromStart>
  <NewTasksAreManual>0</NewTasksAreManual>
  <Tasks>
${tasksXml}
  </Tasks>
</Project>`;
  },

  // ========== PARSER ==========
  parse(xmlText) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(xmlText, 'text/xml');
    const errNode = doc.querySelector('parsererror');
    if (errNode) throw new Error('XML mal formado');

    // Trabalha com namespace ou sem
    const taskEls = Array.from(doc.getElementsByTagName('Task'));
    if (taskEls.length === 0) throw new Error('Nenhuma tarefa encontrada no XML');

    const tasks = [];
    const dependencies = [];

    // Lê apenas FILHOS DIRETOS (evita pegar <Start> de dentro de <Baseline>)
    const getText = (parent, tag) => {
      for (const ch of parent.children) {
        if (ch.tagName === tag || ch.localName === tag) return ch.textContent.trim();
      }
      return '';
    };

    // Pilha para reconstruir a hierarquia a partir do OutlineLevel
    const stack = []; // { uid, level }

    taskEls.forEach(taskEl => {
      if (getText(taskEl, 'IsNull') === '1') return;
      const uid = getText(taskEl, 'UID');
      const name = getText(taskEl, 'Name');
      if (!name || !uid) return;

      // OutlineLevel define a profundidade; ausente → nível 1 (plano)
      const rawLevel = getText(taskEl, 'OutlineLevel');
      const level = rawLevel === '' ? 1 : (parseInt(rawLevel) || 0);
      // Pula a tarefa-resumo do projeto (UID 0 / nível 0)
      if (uid === '0' || level === 0) return;

      const start = MSPX._parseDate(getText(taskEl, 'Start'));
      const finish = MSPX._parseDate(getText(taskEl, 'Finish'));
      const isSummary = getText(taskEl, 'Summary') === '1';
      // Marco do MS Project: explicitamente marcado OU duração 0 (start = finish em
      // tarefa-folha sem filhos). Tarefas-resumo (Summary=1) nunca são marcos mesmo
      // com start = finish.
      const isMs = getText(taskEl, 'Milestone') === '1' ||
        (!isSummary && start && finish && start === finish);
      // Tarefa inativa do MS Project: <Active>0</Active> (1 = ativa). Ausente = ativa.
      const isInactive = getText(taskEl, 'Active') === '0';

      // Percentual concluído (PercentComplete; fallback PercentWorkComplete)
      let pct = parseFloat(getText(taskEl, 'PercentComplete'));
      if (isNaN(pct)) pct = parseFloat(getText(taskEl, 'PercentWorkComplete'));
      if (isNaN(pct)) pct = 0;
      pct = Math.max(0, Math.min(100, pct));

      // Linha de base (primeiro elemento <Baseline> filho)
      let bStart = null, bFinish = null;
      const baseEl = Array.from(taskEl.children).find(c => c.tagName === 'Baseline' || c.localName === 'Baseline');
      if (baseEl) {
        bStart = MSPX._parseDate(getText(baseEl, 'Start'));
        bFinish = MSPX._parseDate(getText(baseEl, 'Finish'));
      }

      // Hierarquia: pai = tarefa anterior com nível imediatamente menor
      while (stack.length && stack[stack.length - 1].level >= level) stack.pop();
      const parentUid = stack.length ? stack[stack.length - 1].uid : null;
      stack.push({ uid, level });

      tasks.push({
        uid,
        title: name,
        start_date: start,
        end_date: finish,
        is_milestone: isMs,
        progress: pct,
        parent_uid: parentUid,
        is_summary: isSummary,
        inactive: isInactive,
        baseline_start: bStart,
        baseline_end: bFinish,
      });

      // Dependências (PredecessorLink) — filhos diretos da Task
      // PredecessorLink pode aparecer como filho direto OU dentro de algum
      // wrapper conforme variações do XML. Buscamos somente os PredecessorLink
      // filhos diretos para não pegar duplicatas de tarefas aninhadas.
      const predLinks = Array.from(taskEl.children).filter(c =>
        c.tagName === 'PredecessorLink' || c.localName === 'PredecessorLink'
      );
      predLinks.forEach(pl => {
        const predUid = getText(pl, 'PredecessorUID');
        const type = getText(pl, 'Type') || '1';
        const lag = getText(pl, 'LinkLag') || '0';
        if (!predUid || predUid === '0') return; // ignora link para o projeto-resumo
        dependencies.push({
          task_uid: uid,
          predecessor_uid: predUid,
          type: MSPX.TYPE_MAP[type] || 'FS',
          lag_days: MSPX._parseLag(lag),
        });
      });
    });

    // Preenche datas faltantes de tarefas-pai a partir dos filhos (recursivo)
    const childrenOf = (u) => tasks.filter(t => t.parent_uid === u);
    const ensureDates = (t) => {
      if (t.start_date && t.end_date) return;
      const kids = childrenOf(t.uid);
      kids.forEach(ensureDates);
      const starts = kids.map(k => k.start_date).filter(Boolean).sort();
      const ends = kids.map(k => k.end_date).filter(Boolean).sort();
      if (!t.start_date && starts.length) t.start_date = starts[0];
      if (!t.end_date && ends.length) t.end_date = ends[ends.length - 1];
    };
    tasks.forEach(ensureDates);

    // Descarta tarefas que continuam sem datas válidas (não importáveis)
    const valid = tasks.filter(t => t.start_date && t.end_date);
    const validUids = new Set(valid.map(t => t.uid));
    // Reanexa filhos cujo pai foi descartado (vira raiz)
    valid.forEach(t => { if (t.parent_uid && !validUids.has(t.parent_uid)) t.parent_uid = null; });
    const validDeps = dependencies.filter(d => validUids.has(d.task_uid) && validUids.has(d.predecessor_uid));

    // Diagnóstico: ajuda a entender perdas durante a importação
    const stats = {
      tasksFound:    tasks.length,
      tasksValid:    valid.length,
      tasksDiscarded: tasks.length - valid.length,
      depsFound:     dependencies.length,
      depsValid:     validDeps.length,
      depsDiscarded: dependencies.length - validDeps.length,
    };
    console.log('[MSPX.parse] stats:', stats);

    return { tasks: valid, dependencies: validDeps, _stats: stats };
  },
};
