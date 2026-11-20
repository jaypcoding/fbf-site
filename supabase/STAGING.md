# Ambiente de staging

| Ambiente | Projeto Supabase |
|---|---|
| Produção | `wybcbavgixfhvvmegkwc` |
| Staging | `stzftmetlrsaatfuhhqs` |

As referências ficam em `src/lib/supabaseEnvironment.ts`, usadas pelo site e pelos scripts.

## Regras

- O CLI deste repositório está vinculado à **produção** (`supabase/.temp`). Um `--remote` sem valor atinge o projeto vinculado. **Não rode `supabase db push`, `migration` ou `test db` diretamente para staging**; use os comandos abaixo.
- Toda alteração passa primeiro por uma branch, pelo CI e pelo staging. Produção só com autorização específica.
- Nenhum segredo vai para o Git: `.env` e `.env.*` são ignorados, exceto os modelos `*.example`.

## Comandos

```bash
npm run staging:dry-run      # lista as migrations que seriam aplicadas (não altera nada)
npm run staging:migrations   # histórico de migrations do staging
FBF_CONFIRM_STAGING_PUSH=stzftmetlrsaatfuhhqs npm run staging:push   # aplica migrations
npm run staging:test-db      # testes pgTAP no staging
npm run dev:staging          # site local usando .env.staging
```

O script `scripts/staging.mjs`:

1. recusa qualquer variável `SUPABASE_*`, `VITE_SUPABASE_*`, `FBF_STAGING_*` ou `FBF_CONFIRM_*` que mencione a produção;
2. monta o comando com exatamente `--remote=stzftmetlrsaatfuhhqs` (sem `--linked`, `--db-url` ou outro seletor);
3. confere, na resposta JSON do CLI, que o projeto atingido foi o staging;
4. oculta e-mails, URLs de banco e chaves na saída;
5. no `push`, exige a confirmação acima e roda um `dry-run` antes.

O site em modo `staging` (`vite --mode staging`) recusa iniciar se a URL não for do projeto de staging.

## Testes de banco no staging

`supabase test db` exige Docker. `npm run staging:test-db` usa `supabase db query --file`, que roda pela API do Supabase, sem Docker e sem senha do banco:

- todos os arquivos são convertidos antes de qualquer chamada remota; cada um precisa começar com `BEGIN` e terminar com `ROLLBACK`, sem `COMMIT`, `ABORT`, `END`, `SAVEPOINT` e afins no meio, e sem strings `E'...'` (`scripts/lib/pgtapRemote.mjs` recusa o contrário);
- antes do primeiro teste, uma consulta somente leitura confirma que o staging respondeu e que a última migration dele é igual à local, e registra a contagem de linhas de cada tabela (`public`, `auth`, `supabase_migrations`) e as extensões instaladas;
- cada `SELECT` do teste grava suas linhas TAP numa tabela temporária, lida no último comando;
- o `ROLLBACK` final é removido e nada é confirmado: a API descarta a transação aberta ao fim da requisição (comportamento verificado no staging antes do primeiro uso), então os dados de teste nunca permanecem;
- ao final, a mesma consulta somente leitura é repetida (inclusive impressões digitais de colunas, funções e triggers do schema `public`) e o comando falha se qualquer item tiver mudado.

### Validar uma migration antes de aplicá-la

```bash
npm run staging:test-db -- --with-pending supabase/migrations/<arquivo>.sql
```

A migration é executada dentro da mesma transação dos testes, que nunca é confirmada: ela é validada contra o schema real do staging sem ser aplicada. A migration não pode conter `BEGIN`/`COMMIT` no nível superior. O destino precisa estar na migration imediatamente anterior.

## Configuração local

- `.env.staging` (ignorado pelo Git): `VITE_SUPABASE_URL` do staging e a chave **publishable**. Nunca coloque chaves secretas ou `service_role` nele.
- Os testes de concorrência (`scripts/test-*-concurrency.mjs`) continuam aceitando somente o Supabase local; eles exigem a chave `service_role` e não são executados no staging.
