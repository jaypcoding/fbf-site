# Preparação e validação local do Supabase

Este procedimento não aplica migrations nem altera dados remotos. O único comando de configuração Cloud descrito é `supabase link`, que salva o Project Ref localmente e não executa mudanças no banco. Não há instruções de `db push`, migration ou reset remoto.

## Conexão do frontend com o Supabase Cloud

O cliente usado pelo frontend é criado em `src/lib/supabase.ts` com `@supabase/supabase-js`. Ele lê somente:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY` (chave pública `anon` legada ou `sb_publishable_`)

O arquivo `.env.local` foi preparado na raiz do projeto com essas duas variáveis vazias. Preencha os valores copiados de **Project Settings → API** no Dashboard do projeto correto. Não coloque `service_role`, `sb_secret_`, senha do banco ou access token nesse arquivo. `.env.local` está explicitamente no `.gitignore`.

A inicialização do cliente valida que a URL use HTTPS (HTTP é aceito somente para loopback local) e rejeita chaves secret/service-role. Para checar a conectividade sem ler nem modificar dados:

```powershell
npm.cmd run supabase:check
```

O script lê explicitamente as duas variáveis do `.env.local` na raiz do projeto (sem imprimir seus valores), faz apenas `GET /auth/v1/health` e envia a chave pública no header `apikey`. Em respostas não exitosas, exibe status HTTP e uma mensagem JSON sanitizada; oculta chaves, JWTs e URLs. Na última verificação, o endpoint respondeu HTTP 200 para o host do projeto vinculado. Isso confirma a conectividade do Auth health endpoint, não valida schema, RLS nem migrations. A URL anterior de `.env` não foi copiada.

O Supabase CLI está na versão local 3.0.0 e agora está vinculado localmente ao Project Ref `wybcbavgixfhvvmegkwc` em `supabase/.temp/project-ref`. O CLI reporta `environment=unverified`; o vínculo local não comprova conectividade do frontend nem valida/aplica migrations. `project_id` em `supabase/config.toml` continua sendo somente o identificador do stack local. Em outro checkout, autentique a CLI com o prompt interativo, inserindo o access token somente nele (não no repositório, `.env.local` ou chat), e vincule usando o ref copiado do Dashboard:

```powershell
npm.cmd exec -- supabase login
$env:SUPABASE_PROJECT_REF = "<Project-Ref-copiado-do-Dashboard>"
npm.cmd exec -- supabase link --project-ref $env:SUPABASE_PROJECT_REF
```

O vínculo foi realizado sem migrations ou alterações de dados. Não execute `db push`, `migration up` remoto ou reset remoto nesta etapa.

As seis migrations estão ordenadas cronologicamente na seção abaixo, mas ainda não podem ser consideradas prontas para aplicação remota: a sequência não foi executada em PostgreSQL local e os testes de integração ainda estão pendentes. Prepare Podman Desktop ou Docker Desktop, execute a validação local completa e revise os resultados; nenhuma migration remota foi aplicada.

### Bootstrap único do primeiro ADMIN

Perfis são criados pelo trigger confiável em `auth.users` e pelo backfill da migration de sincronização. Clientes `anon`/`authenticated`, inclusive ADMIN, não recebem permissão para inserir perfis nem alterar diretamente a coluna `role`; as mudanças normais de papel passam pela RPC `set_user_role`, que verifica se o chamador já é ADMIN. Não existe RPC pública para bootstrap.

Depois de confirmar o usuário correto no Dashboard, o proprietário do projeto pode executar uma única vez o bloco abaixo no SQL Editor do projeto autorizado. Substitua os dois placeholders por UUID e e-mail já conferidos em **Authentication → Users**. O bloco serializa tentativas simultâneas, exige que ambos identifiquem a mesma conta confirmada e que ainda não exista ADMIN; também exige que o perfil esteja em USER. Qualquer resultado diferente de exatamente uma linha causa erro e rollback, evitando promover múltiplas contas acidentalmente. Não use credenciais, senhas, tokens ou chave `service_role`.

```sql
DO $$
DECLARE
  target_user_id uuid := '<UUID-CONFERIDO>'::uuid;
  target_email text := '<EMAIL-CONFERIDO>';
  changed_rows integer;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('fbf-first-admin-bootstrap', 0));

  IF EXISTS (SELECT 1 FROM public.profiles WHERE role = 'ADMIN') THEN
    RAISE EXCEPTION 'Bootstrap cancelado: já existe um ADMIN';
  END IF;

  UPDATE public.profiles AS p
  SET role = 'ADMIN',
      updated_at = now()
  FROM auth.users AS u
  WHERE p.id = target_user_id
    AND u.id = p.id
    AND lower(u.email) = lower(target_email)
    AND u.email_confirmed_at IS NOT NULL
    AND p.role = 'USER';

  GET DIAGNOSTICS changed_rows = ROW_COUNT;
  IF changed_rows <> 1 THEN
    RAISE EXCEPTION 'Bootstrap cancelado: a conta confirmada não corresponde, já não está em USER ou não é a primeira promoção';
  END IF;
END
$$;
```

Esse passo altera somente o papel do perfil explicitamente identificado. Não o execute em produção sem autorização expressa do proprietário, e não o inclua em migrations nem em scripts da aplicação.

## Auditoria de dependências

Na auditoria inicial desta revisão, `npm audit` informou 21 entradas: 13 HIGH, 6 MODERATE e 2 LOW. Foram aplicadas atualizações sem `--force` e sem alterar funcionalidades:

- React Router 7.18.5 e `ws` 8.22.1 permanecem nas versões corrigidas.
- Vite foi atualizado para 6.4.5 e `@vitejs/plugin-react` para 4.7.0, cuja faixa de peers declara suporte a Vite 6.
- PostCSS está em 8.5.32 e esbuild em 0.25.12.
- As atualizações compatíveis do npm corrigiram as demais entradas HIGH, inclusive `brace-expansion` 1.1.21.
- ESLint 9.39.5 e `typescript-eslint` 8.72.1 foram atualizados sem mudar major.

Após as correções, `npm audit` ainda reporta 12 entradas MODERATE, sem HIGH/CRITICAL. São pacotes transitivos sinalizados pelo mesmo advisory de `minimatch <11.0.1`, propagado por `eslint`/`@eslint/config-array`/`@eslint/eslintrc` e `typescript-eslint`/`typescript-estree`. O lockfile resolve `minimatch` 3.1.5 no caminho do ESLint e 10.2.6 no caminho do TypeScript ESLint; ambos estão abaixo da versão corrigida 11.0.1. O npm não oferece correção sem breaking para a árvore atual; o plugin React Hooks instalado aceita ESLint até 9. Forçar minimatch 11 ou migrar o conjunto de lint para majors diferentes implicaria mudanças incompatíveis não justificadas nesta preparação. O risco está restrito às ferramentas locais de lint/configuração que processam padrões glob; esses pacotes não fazem parte das dependências de produção. `npm audit --omit=dev` retorna zero vulnerabilidades.

Não foi usado `npm audit fix --force`. O `npm audit fix` sem força foi executado e deixou os alertas restantes acima documentados.

Após `npm ci`, os testes unitários (10/10), lint, typecheck e build passaram com Vite 6.4.5. Esses resultados não validam o PostgreSQL.

`npm ci` também informa que ESLint 9.39.5 está depreciado. O upgrade para ESLint 10 foi deixado para uma revisão de compatibilidade separada: o `eslint-plugin-react-hooks` atualmente instalado declara peer support somente até ESLint 9.

## Ordem e escopo das migrations

O CLI executa as migrations em ordem cronológica pelo timestamp:

1. `20260926173632_create_fbf_platform_schema.sql` — cria perfis, competições, temporadas, times, jogadores, inscrições em temporada, elencos, fases, rodadas, partidas, eventos, participações de goleiros e atribuições de organizadores; inclui índices, funções de papel e RLS.
2. `20261102130652_add_profile_sync_and_role_management.sql` — sincroniza novos usuários de `auth.users` com `profiles`, faz backfill dos usuários já existentes e adiciona `set_user_role`, restrita a ADMIN.
3. `20261102130703_add_streamers_and_match_commentary.sql` — cria streamers e a associação entre streamer e partida.
4. `20261102130911_scope_organizer_write_access_to_assigned_competitions.sql` — adiciona funções para resolver a competição de cada temporada/fase/rodada/partida e restringe escritas desses dados à atribuição do ORGANIZER.
5. `20261102133000_competition_lifecycle_and_round_robin.sql` — adiciona datas, vagas e inscrições; RPCs de inscrição/revisão; validações de ciclo de vida e relacionamentos; geração todos-contra-todos e views de classificação/estatísticas.
6. `20261102140000_match_domain_integrity.sql` — adiciona histórico imutável de status, origem do placar, período/gol contra, validações e triggers de eventos e goleiros, índices únicos, proteção de confrontos duplicados e views oficiais; restringe alterações de registros globais compartilhados a ADMIN.

As dependências seguem a ordem: a segunda migration exige `profiles` e papéis da primeira; a terceira exige `matches`; a quarta exige tabelas e funções de permissões e `match_streamers`; a quinta exige os helpers de escopo da quarta; a sexta substitui e complementa estruturas e políticas das anteriores. Não há `DROP TABLE`, `TRUNCATE` ou exclusão geral de dados nas seis migrations. Ainda assim, a aplicação desde banco vazio **não foi executada**: a compatibilidade SQL permanece por validar com PostgreSQL local.

A cadeia principal de relações é `competitions → seasons → stages → rounds → matches`; `season_teams` liga uma temporada aos registros globais de `teams`, `rosters` liga participação a `players`, e eventos/participações de goleiros apontam para partidas, times aprovados e jogadores. `competition_organizers` mapeia usuários a competições. `match_streamers` liga partidas a `streamers`. As funções e triggers posteriores validam essa cadeia; as views de classificação/estatística dependem de partidas finalizadas, eventos e participações. As views usam `security_invoker`, por isso o major PostgreSQL 15 foi definido em [config.toml](./config.toml).

### Critério de Clean Sheet e placares LEGACY

Para partidas oficiais baseadas em eventos, o cálculo considera todos os intervalos válidos do goleiro, corta o tempo limpo no primeiro gol sofrido de cada intervalo e agrega os intervalos antes de contar jogos/Clean Sheets. Um goleiro que sai e retorna pode receber no máximo um Clean Sheet na partida; um substituto não precisa jogar a partida inteira.

Partidas `LEGACY` preservam o placar final sem fabricar eventos. Quando o placar preservado indica zero gols contra do time do goleiro, cada intervalo completo e validado recebe Clean Sheet e seu tempo de participação. Se o placar indica gols contra, a view não atribui Clean Sheet nem estima tempo limpo, pois sem eventos não há horário confiável dos gols.

### Transição de permissões ORGANIZER

- As migrations 1 e 3 permitem temporariamente que ORGANIZER, como manager, escreva em dados globais de times, jogadores e streamers.
- A migration 4 restringe conteúdo de competição à atribuição, mas ainda preserva essa escrita compartilhada.
- A migration 5 adiciona operações de inscrição/fase e conserva os escopos; não substitui ainda todas as políticas globais.
- A migration 6 troca as políticas globais de times, jogadores e streamers por ADMIN-only e mantém a associação de streamers à partida sob escopo da competição.

Portanto, não exponha a instalação a ORGANIZER entre as migrations 4 e 6. Em uma instalação nova, deixe toda a sequência terminar e valide a migration final antes de liberar contas de organizador. Se a sequência parar antes da sexta migration, mantenha o ambiente isolado.

### Dados criados ou backfill

Em banco vazio, a primeira migration insere exatamente estas três competições DRAFT:

- `FBF 20 PRINCIPAL` — categoria `Principal`, formato `Pontos corridos`, descrição “Competição principal da Federação Brasileira de Futsal.”
- `FBF 20 SECUNDARIA` — categoria `Secundária`, formato `Pontos corridos`, descrição “Competição secundária da Federação Brasileira de Futsal.”
- `URUN X4` — categoria `X4`, formato `Personalizado`, descrição “Competição X4 da Federação Brasileira de Futsal.”

Ela não semeia usuários, temporadas, times, jogadores, partidas ou resultados. A segunda migration cria perfis para usuários que já existam em `auth.users`; em banco local novo, essa consulta não cria usuários de demonstração. Na migration 6, partidas já existentes recebem `score_source = 'LEGACY'` pelo default da coluna, preservando placares existentes; ela cria uma linha baseline de histórico para cada partida preexistente sem histórico e backfills a tabela de reivindicação de confrontos de pontos corridos. Ela interrompe a aplicação se encontrar pares duplicados nessa modalidade. Nenhum desses backfills foi executado nesta revisão.

## Supabase Storage e logos

- Em `supabase/config.toml`, Storage está desativado (`[storage] enabled = false`).
- Não há migration de bucket, políticas para `storage.objects` nem chamadas ao SDK de Storage no frontend.
- A tabela `teams` possui `logo_url`; o cadastro/edição de times aceita uma URL digitada manualmente. As páginas exibem essa URL. Isso não é upload nem armazenamento pelo Supabase.
- Upload, substituição e remoção de arquivo ainda não existem. Para implementá-los futuramente será necessário habilitar Storage, criar bucket e políticas RLS apropriadas (escrita global atualmente reservada a ADMIN), construir o fluxo de seleção/upload/preview, atualizar `logo_url` com a URL do objeto e tratar a remoção/substituição do objeto antigo e erros. Nenhum desses itens foi implementado nesta etapa.

## Preparação do Podman Desktop no Windows

O Supabase CLI `3.0.0` está presente neste projeto. O `supabase start --help` dessa versão descreve um stack local em containers e não oferece uma flag `--runtime`; a documentação atual do Supabase lista Podman como engine compatível, mas essa combinação exata ainda não foi iniciada nem testada nesta máquina. O Podman precisa estar acessível pelo CLI como engine compatível com Docker; a confirmação será `podman info` seguida de `npm.cmd run db:start`.

Podman Desktop no Windows requer uma Podman machine Linux e WSL 2 ou Hyper-V. A documentação do Podman indica 6 GB de RAM para a machine e privilégios administrativos para habilitar o provider. A máquina atual tem 8,4 GB de RAM física e 8 processadores lógicos: alocar 6 GB deixaria pouca memória para o Windows e demais processos. Há 19,3 GB livres no disco C:, e a capacidade recomendada para o disco virtual e os downloads do stack precisa ser avaliada antes da instalação; a documentação consultada não publica um mínimo único de armazenamento para esta combinação.

Neste momento `podman`, `docker`, `psql` e `postgres` não estão instalados, WSL não está disponível/configurado e não há distro instalada. Portanto, **não instalei nem iniciei nada**. Com a autorização da usuária, o caminho Podman é:

1. Verificar virtualização no BIOS/UEFI e os requisitos da edição/versão do Windows. Em PowerShell como Administrador, preparar WSL 2:

   ```powershell
   wsl --update
   wsl --install --no-distribution
   ```

   Reinicie se solicitado; então confira `wsl --status`.
2. Instale o Podman Desktop pelo [guia oficial para Windows](https://podman-desktop.io/docs/installation/windows-install), escolhendo WSL 2 como provider. Esse passo requer instalação de software e pode solicitar elevação; **não foi executado**.
3. Após instalação e confirmação de espaço/memória, inicialize e verifique uma Podman machine. Exemplo para uma máquina com recursos suficientes:

   ```powershell
   podman machine init --cpus 4 --memory 6144 --disk-size 30 --now
   podman info
   ```

   `--disk-size` está em GiB e é capacidade virtual, não uma garantia de espaço físico disponível. Não execute esse exemplo enquanto não houver armazenamento suficiente. Se o Podman Desktop já criou a machine, não a inicialize novamente.

## Comandos locais

Execute a partir da raiz `project` no PowerShell. Use `npm.cmd` para evitar a política que pode bloquear `npm.ps1`.

```powershell
npm.cmd ci
podman info
npm.cmd run db:start
npm.cmd exec -- supabase status
npm.cmd exec -- supabase db query "SHOW server_version;"
npm.cmd run db:reset
npm.cmd run db:test
node scripts/test-round-robin-concurrency.mjs
node scripts/test-legacy-migration.mjs
```

`supabase status` deve mostrar a API local em loopback, normalmente `http://127.0.0.1:54321`; `SHOW server_version` deve mostrar PostgreSQL major 15. O `db:reset` é destrutivo para o banco local: aplica as seis migrations do zero e dados iniciais de demonstração.

`db:reset` e `db:test` passam por `scripts/supabase-local.mjs`, que consulta o status e exige URL loopback antes de reset/teste, além de rejeitar seletores remotos. Os testes de concorrência e legado também verificam URL local. `supabase start`/`status` são comandos locais do CLI; não use `link`, `db push`, `--db-url` ou credenciais remotas nesta validação. O teste de legado reinicia o banco local até a migration anterior à de integridade, carrega fixtures temporárias e aplica a migration final; ao fim, para retornar ao schema atual limpo, rode novamente:

```powershell
npm.cmd run db:reset
```

Atalho para iniciar e executar toda a sequência de integração:

```powershell
npm.cmd run test:integration
```

Ao terminar:

```powershell
npm.cmd exec -- supabase stop
podman machine stop
```

Os comandos acima não aceitam seleção de projeto remoto. Não acrescente `--remote`, `--db-url`, `--linked` nem credenciais de staging/produção. Não existe comando de aplicação remota neste guia. Até que o engine esteja instalado/iniciado e os comandos executados, migrations e testes PostgreSQL permanecem pendentes e não aprovados.

## Preflight

[diagnostics/preflight.sql](./diagnostics/preflight.sql) contém consultas somente de leitura para confrontos duplicados, identidades duplicadas de eventos e revisão de placares históricos. As contagens de gol são indicativas, porque o preflight antecede campos de período e gol contra. Ele não modifica dados e não deve ser interpretado como correção automática.

## Checklist funcional para a próxima etapa

Marque cada fluxo somente depois de testar com o banco local e, quando apropriado, com usuários distintos por papel.

- [ ] Cadastro, login e logout.
- [ ] Perfil: leitura/edição própria e papéis ADMIN, ORGANIZER e USER; tentativa de elevação pelo próprio cliente deve falhar.
- [ ] Campeonatos: criar e editar; validar datas, status, limite de vagas e escopo do ORGANIZER atribuído. Competições com partidas não podem ser excluídas; usar cancelamento/arquivamento ou finalização para preservar o histórico.
- [ ] Equipes: cadastrar, editar e excluir respeitando referências/participações.
- [ ] Logo da equipe: upload, preview, substituição, remoção, acesso e autorização no Storage. Hoje só há campo de URL.
- [ ] Jogadores: cadastrar, editar e excluir respeitando vínculos existentes.
- [ ] Elencos: adicionar/remover jogador por temporada/time; validar transferências e histórico entre elencos.
- [ ] Inscrições: inscrever, retirar, aprovar e rejeitar; vaga máxima, duplicidade, janela e permissão.
- [ ] Temporadas, fases e rodadas: datas, vínculo à competição e proteção contra alterações incompatíveis com partidas existentes.
- [ ] Partidas: geração par/ímpar, folga, simultaneidade, preservação, status, reagendamento e histórico.
- [ ] Gols, assistências, cartões e substituições: validar eventos, correções, gols contra, prorrogação e pênaltis. O esquema atual aceita apenas `GOAL`, `ASSIST`, `SUBSTITUTION`, `GOALKEEPER_IN` e `GOALKEEPER_OUT`; cartões não estão modelados.
- [ ] Classificação e estatísticas: somente partidas finalizadas, regras de desempate, placares corrigidos e eventos sem duplicidade.
- [ ] Goleiros e Clean Sheets: entradas/saídas, substituições, gols sofridos, intervalos incompletos e recálculo após correções.
- [ ] Histórico de ações administrativas: verificar quais mutações geram auditoria. Atualmente há histórico de status de partidas, não um log geral de ações administrativas.
