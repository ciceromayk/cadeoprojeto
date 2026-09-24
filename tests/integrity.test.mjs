import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../app.html', import.meta.url), 'utf8');
const between = (start, end) => source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start)));
const memory = new Map();
const sandbox = {
  console,
  localStorage: { getItem: k => memory.get(k) ?? null, setItem: (k, v) => memory.set(k, v) },
  document: { querySelector: () => null, querySelectorAll: () => [] },
  CPMCache: { invalidate() {} },
};
vm.createContext(sandbox);
vm.runInContext(
  between('const $ = sel =>', '// Previsão de término') +
  between('function dependencyCycle(', 'function computeCriticalPath(') +
  between('function autoSchedule(', 'function toast('), sandbox
);

// Executa a camada de dados sem rede para testar a paginação e falhas do backup.
vm.runInContext(between('const DB = {', 'function setupRealtime(') + '\nglobalThis.__db = DB;', sandbox);
const rows = Array.from({ length: 1205 }, (_, i) => ({
  id: String(i).padStart(4, '0'), project_id: 'P', order_index: i, created_at: `2026-09-24T00:00:${String(i % 60).padStart(2, '0')}Z`
}));
const tables = { tasks: rows, projects: [{ id: 'P' }] };
const query = (name, fail = null) => {
  const filters = [];
  const orders = [];
  const q = {
    select() { return q; },
    eq(k, v) { filters.push(r => r[k] === v); return q; },
    in(k, values) { filters.push(r => values.includes(r[k])); return q; },
    order(k) { orders.push(k); return q; },
    range(from, to) {
      if (name === fail) return Promise.resolve({ data: null, error: { message: 'falha simulada' } });
      const found = [...(tables[name] || [])].filter(r => filters.every(f => f(r)));
      found.sort((a, b) => { for (const k of orders) { if (a[k] !== b[k]) return a[k] < b[k] ? -1 : 1; } return 0; });
      return Promise.resolve({ data: found.slice(from, Math.min(to + 1, from + 1000)), error: null });
    }
  };
  return q;
};

test('rejeita um ciclo de predecessoras sem deslocar datas', () => {
  const tasks = [
    { id: 'A', title: 'A', start_date: '2026-09-21', end_date: '2026-09-22' },
    { id: 'B', title: 'B', start_date: '2026-09-22', end_date: '2026-09-23' },
  ];
  const deps = [
    { task_id: 'A', predecessor_id: 'B', type: 'FS' },
    { task_id: 'B', predecessor_id: 'A', type: 'FS' },
  ];
  assert.equal(vm.runInContext('dependencyCycle', sandbox)(tasks, deps).length, 3);
  assert.throws(() => vm.runInContext('autoSchedule', sandbox)(tasks, deps), /circular/);
  assert.equal(tasks[0].start_date, '2026-09-21');
});

test('nova predecessora é verificada contra a rede existente', () => {
  const tasks = [{ id: 'A' }, { id: 'B' }, { id: 'C' }];
  const edges = [{ predecessor_id: 'A', task_id: 'B' }, { predecessor_id: 'B', task_id: 'C' }];
  const cycle = vm.runInContext('dependencyCycle', sandbox);
  assert.equal(cycle(tasks, edges), null);
  assert.ok(cycle(tasks, [...edges, { predecessor_id: 'C', task_id: 'A' }]));
});

test('alterar feriado invalida a contagem de dias úteis em cache', () => {
  const run = expression => vm.runInContext(expression, sandbox);
  assert.equal(run("workingDaysBetween('2026-09-24','2026-09-25')"), 1);
  run("Holidays.save([{date:'2026-09-25',name:'feriado'}])");
  assert.equal(run("workingDaysBetween('2026-09-24','2026-09-25')"), 0);
});

test('hoje usa a data civil local, inclusive à noite em Fortaleza', () => {
  const oldTZ = process.env.TZ;
  try {
    process.env.TZ = 'America/Fortaleza';
    sandbox.Date = class extends Date {
      constructor(...args) { super(...(args.length ? args : ['2026-09-25T01:00:00Z'])); }
    };
    assert.equal(vm.runInContext('today()', sandbox), '2026-09-24');
  } finally {
    if (oldTZ === undefined) delete process.env.TZ;
    else process.env.TZ = oldTZ;
    delete sandbox.Date;
  }
});

test('carrega um projeto com mais de mil tarefas e todas as dependências', async () => {
  tables.task_dependencies = rows.map((r, i) => ({ id: r.id, task_id: r.id, predecessor_id: rows[(i + 1) % rows.length].id }));
  sandbox.State = { supabase: { from: name => query(name) } };
  const tasks = await sandbox.__db.listTasks('P');
  const deps = await sandbox.__db.listDependencies('P');
  assert.equal(tasks.length, 1205);
  assert.equal(deps.length, 1205);
});

test('interrompe a exportação se uma tabela falhar', async () => {
  sandbox.State = {
    projects: [{ id: 'P', name: 'Exemplo' }], teamMembers: [],
    supabase: { from: name => query(name, 'comments') }
  };
  await assert.rejects(() => sandbox.__db.exportProjectFull('P'), /Exportação interrompida em comments/);
});

test('criação concorrente usa códigos reservados pelo banco', async () => {
  let next = 42;
  const inserted = [];
  sandbox.State = { supabase: {
    rpc: async (_name, { p_count }) => ({
      data: Array.from({ length: p_count }, () => `T-${String(next++).padStart(3, '0')}`), error: null
    }),
    from: () => ({ insert: payload => ({ select: () => ({
      single: async () => { inserted.push(payload); return { data: payload, error: null }; }
    }) }) })
  } };
  await Promise.all([
    sandbox.__db.createTask('P', { title: 'A' }),
    sandbox.__db.createTask('P', { title: 'B' }),
  ]);
  assert.deepEqual(inserted.map(t => t.code).sort(), ['T-042', 'T-043']);
});
