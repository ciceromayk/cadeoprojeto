# Convenções do projeto

## Toda correção ou deploy = nova versão + entrada em "Novidades"

Sempre que fizer uma correção, melhoria ou preparar um deploy que chegue ao usuário:

1. Incrementar a versão em **`APP_VERSION`** (`js/changelog.js`) **e** em `version.json` (devem ser iguais;
   o CI confere). Correção → patch (4.7.1 → 4.7.2); funcionalidade nova → minor; mudança grande → major.
2. Acrescentar **no topo** do array `CHANGELOG` (`js/changelog.js`) uma entrada
   `{ version, date: 'mês/ano', title, items: [...] }` em português, descrevendo o que o usuário percebe.
   `CHANGELOG[0].version` deve ser igual a `APP_VERSION`.
3. Publicar `index.html`, `app.html`, `version.json` e as pastas `css/` e `js/` juntos (o deploy automático já faz isso).

## Outros

- `app.html` usa fim de linha CRLF: preserve-o ao editar por script. `css/app.css` e `js/app.js` usam LF.
- Estrutura: `app.html` é só a marcação; o visual está em `css/app.css`; o código é dividido em módulos ES em `js/`
  (`app.js` é o ponto de entrada; `helpers`, `state`, `db`, `cpm`, `views`, `ui` etc. — veja o 1º comentário de cada arquivo).
  Ao criar um módulo novo: importe-o de quem o usa e acrescente `<link rel="modulepreload" href="js/<nome>.js">` em
  `app.html` (o teste de integridade confere). Funções usadas em `onclick="..."` inline precisam de `window.X = X`.
  Evite reatribuir (`x = ...`) um `let` exportado por outro módulo: ESM não permite — use um objeto ou um setter.
- Migrações SQL ficam em `migrations/` e são executadas manualmente no Supabase, em ordem, antes de
  publicar a versão que depende delas. Devem ser idempotentes.
- Testes: `node --test tests/integrity.test.mjs` e `npm run check:undef` (detecta variáveis não definidas;
  rode `npm ci` antes). **Antes de entregar mudança em `app.html` ou `js/`, rode os dois.**
- Ao reaplicar/mesclar código de outra versão, confira o posicionamento: um bloco na função errada gera
  erros de runtime (ex.: `pdata is not defined`) que só o `check:undef` e o uso real do app revelam. Em módulos, um
  `import` esquecido também aparece como `is not defined` no `check:undef`.
