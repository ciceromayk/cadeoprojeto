// Verifica identificadores não definidos no <script type="module"> de app.html.
// Pega erros como "pdata is not defined" (bloco colado na função errada) que os testes
// de lógica não cobrem. Uso: node tests/check-undef.mjs  (requer eslint e globals instalados)
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const html = fs.readFileSync(new URL('../app.html', import.meta.url), 'utf8');
const m = html.match(/<script type="module">([\s\S]*?)<\/script>/);
if (!m) { console.error('Script principal não encontrado em app.html'); process.exit(1); }

// Dentro do repositório, para que 'globals' seja resolvido a partir de node_modules
const dir = path.join(process.cwd(), '.undef-tmp');
fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(path.join(dir, 'app.mjs'), m[1]);
fs.writeFileSync(path.join(dir, 'eslint.config.mjs'),
  `import globals from 'globals';
export default [{ files: ['**/*.mjs'], languageOptions: { ecmaVersion: 2023, sourceType: 'module',
  globals: { ...globals.browser, supabase: 'readonly' } }, rules: { 'no-undef': 'error' } }];`);

const bin = path.join(process.cwd(), 'node_modules', '.bin', 'eslint');
const r = spawnSync(bin, ['--config', path.join(dir, 'eslint.config.mjs'), path.join(dir, 'app.mjs')],
  { stdio: 'inherit', cwd: process.cwd() });
fs.rmSync(dir, { recursive: true, force: true });
process.exit(r.status ?? 1);
