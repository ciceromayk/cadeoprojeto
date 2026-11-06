# Convenções do projeto

## Toda correção ou deploy = nova versão + entrada em "Novidades"

Sempre que fizer uma correção, melhoria ou preparar um deploy que chegue ao usuário:

1. Incrementar a versão em **`APP_VERSION`** (`app.html`) **e** em `version.json` (devem ser iguais;
   o CI confere). Correção → patch (4.7.1 → 4.7.2); funcionalidade nova → minor; mudança grande → major.
2. Acrescentar **no topo** do array `CHANGELOG` (`app.html`) uma entrada
   `{ version, date: 'mês/ano', title, items: [...] }` em português, descrevendo o que o usuário percebe.
   `CHANGELOG[0].version` deve ser igual a `APP_VERSION`.
3. Publicar `index.html`, `app.html` e `version.json` juntos (o deploy automático já faz isso).

## Outros

- `app.html` usa fim de linha CRLF: preserve-o ao editar por script.
- Migrações SQL ficam em `migrations/` e são executadas manualmente no Supabase, em ordem, antes de
  publicar a versão que depende delas. Devem ser idempotentes.
- Testes: `node --test tests/integrity.test.mjs` e `npm run check:undef` (detecta variáveis não definidas;
  rode `npm ci` antes). **Antes de entregar mudança em `app.html`, rode os dois.**
- Ao reaplicar/mesclar código de outra versão, confira o posicionamento: um bloco na função errada gera
  erros de runtime (ex.: `pdata is not defined`) que só o `check:undef` e o uso real do app revelam.
