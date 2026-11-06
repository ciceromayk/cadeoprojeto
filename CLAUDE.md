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
- Testes: `node --test tests/integrity.test.mjs`.
