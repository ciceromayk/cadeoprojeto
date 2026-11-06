# CadêOProjeto

Aplicação estática em `index.html` e `app.html`, com autenticação e dados no Supabase.

## Atualização para 4.7.0

Antes de publicar `app.html`, faça backup do banco e execute
[`migrations/001-integrity.sql`](migrations/001-integrity.sql) no SQL Editor do
projeto Supabase configurado no aplicativo. A migração adiciona a reserva atômica
de códigos, uma restrição de unicidade por projeto e a tabela de linhas de base
com políticas de acesso por projeto. Ela depende das tabelas `projects`, `tasks`
e `project_shares` já existentes. **Ela não substitui o esquema inicial e as
outras migrações históricas**, que não foram incluídas no repositório original.

Verifique antes quais tarefas têm códigos duplicados:

```sql
SELECT project_id, code, id AS task_id, created_at,
       row_number() OVER (PARTITION BY project_id, code ORDER BY created_at, id) AS occurrence
FROM public.tasks
WHERE (project_id, code) IN (
  SELECT project_id, code FROM public.tasks WHERE code IS NOT NULL
  GROUP BY project_id, code HAVING count(*) > 1
)
ORDER BY project_id, code, occurrence;
```

Se houver repetição, a migração mantém o código da tarefa mais antiga (com
desempate pelo ID) e atribui novos `T-NNN` às demais, acima dos números já
utilizados no projeto. Cada mudança é indicada por `NOTICE` com projeto, ID,
código anterior e código novo. Os IDs e vínculos permanecem intactos. Se algum
sistema externo usa o código da tarefa como identificador, revise as repetições
antes de executar a migração. A execução é transacional: se falhar, todas as
alterações dessa tentativa são revertidas.

O aplicativo novo informa erro se a migração ainda não tiver sido aplicada.
Depois da migração, publique juntos
`index.html`, `app.html` e `version.json` no mesmo diretório.

Na primeira abertura de cada projeto pelo proprietário, as linhas de base
antigas do navegador são copiadas para o banco. O registro local é removido
somente após a cópia bem-sucedida. Faça a primeira abertura no navegador onde
as linhas de base foram criadas; dados de outro navegador não podem ser
recuperados automaticamente.

## Verificação local

```sh
node --test tests/integrity.test.mjs
```

Essa suíte cobre ciclos de predecessoras, invalidação de feriados e data civil
local. A verificação de políticas RLS e das operações reais com Supabase exige
um banco de testes com o esquema histórico, ausente deste repositório.

## Deploy automático (Cloudflare Pages)

O workflow [`.github/workflows/deploy.yml`](.github/workflows/deploy.yml) publica
o site no Cloudflare Pages:

- **push na `main`** → produção;
- **pull request** → preview com URL própria (só para PRs do próprio repositório);
- antes de publicar, roda `node --test tests/integrity.test.mjs` e confere se
  `APP_VERSION` em `app.html` é igual à de `version.json`;
- só `index.html`, `app.html` e `version.json` vão para o ar (migrações, testes
  e README ficam de fora); `deploy/_headers` define o cache (`version.json` nunca
  é cacheado, para o aviso de nova versão funcionar).

### Configuração única

1. No Cloudflare: **Workers & Pages → Create → Pages → Direct Upload** e crie o
   projeto (o nome padrão esperado é `cadeoprojeto`).
2. Crie um **API Token** com a permissão *Account → Cloudflare Pages → Edit*.
3. No GitHub, em **Settings → Secrets and variables → Actions**:
   - *Secrets*: `CLOUDFLARE_API_TOKEN` e `CLOUDFLARE_ACCOUNT_ID`;
   - *Variables* (opcional): `CLOUDFLARE_PAGES_PROJECT`, se o projeto tiver outro nome.
4. No Supabase (**Authentication → URL Configuration**), adicione o domínio do
   Pages (e o domínio próprio, se houver) em *Site URL / Redirect URLs*.

A migração SQL (`migrations/001-integrity.sql`) continua sendo executada
manualmente no Supabase, **antes** de publicar uma versão que dependa dela.
