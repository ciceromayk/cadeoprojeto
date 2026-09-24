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

Verifique antes se há códigos duplicados:

```sql
SELECT project_id, code, count(*)
FROM public.tasks
GROUP BY project_id, code
HAVING count(*) > 1;
```

Se a consulta retornar linhas, resolva os códigos duplicados antes da migração;
o índice único recusará a atualização. O aplicativo novo informa erro se a
migração ainda não tiver sido aplicada. Depois da migração, publique juntos
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
