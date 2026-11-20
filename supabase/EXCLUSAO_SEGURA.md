# Exclusão segura de competições, temporadas, fases e rodadas

Migration: `migrations/20261121100000_safe_record_deletion.sql`.
Testes: `tests/safe_record_deletion.test.sql` (pgTAP) e `../tests/deletion.test.mjs`.

## Como funciona

Pelo painel, o botão 🗑 abre uma **prévia** gerada pelo banco
(`deletion_preview(tipo, id)`), que mostra uma destas duas coisas:

- **o que será removido**, tabela por tabela, com as quantidades; ou
- **por que a exclusão está bloqueada**.

Para confirmar, é preciso digitar o nome exato do registro. Em seguida,
`delete_competition_record(tipo, id, nome, impressão digital)` faz o seguinte:

1. Bloqueia a competição e o conteúdo dela.
2. Refaz todas as verificações. Se as linhas mudaram desde a prévia (a impressão
   digital, calculada com os IDs de todas as linhas, não bate), recusa.
3. Grava em `deletion_log` uma cópia em JSON de todas as linhas.
4. Apaga explicitamente, das tabelas dependentes para a principal, e confere
   cada quantidade apagada com a prévia. Se uma quantidade divergir, nada é
   apagado. A exclusão não depende de `ON DELETE CASCADE`.

Times, jogadores, contas, perfis e streamers **nunca** são apagados; só os
vínculos com a temporada excluída são removidos.

## Permissões

| Registro | Quem pode excluir |
|---|---|
| Competição | ADMIN |
| Temporada, fase, rodada | ADMIN ou ORGANIZER designado para a competição |

- A checagem usa o usuário que está realmente logado (`auth.uid()`).
- A exclusão direta nas tabelas `competitions`, `seasons`, `stages` e `rounds`
  foi removida, tanto as políticas de RLS quanto o GRANT de DELETE.
- O registro de auditoria (`deletion_log`) só pode ser lido por ADMIN e não
  pode ser apagado.

## Bloqueios

**Sempre bloqueado, em qualquer competição.** Qualquer sinal de jogo realizado:

- partida ao vivo ou finalizada, ou que já esteve assim no histórico;
- placar, duração ou resultado retroativo registrado;
- eventos, goleiros ou streamers;
- partida usada como origem de outro confronto, ou equipe usada fora do registro.

**Partidas nunca disputadas** só podem ser removidas em competição
**arquivada** (CANCELLED) ou **em preparação** (DRAFT).

**Competição publicada** (Próxima, Inscrições abertas, Em andamento ou
Finalizada):

- a competição com temporadas fica bloqueada (é preciso arquivá-la antes);
- temporadas e fases com partidas ou grupos ficam bloqueadas;
- temporadas com equipes ou inscrições ficam bloqueadas.

**Rodadas:** só podem ser excluídas quando a fase não tem grupos nem partidas.

Os triggers de proteção de partidas e do histórico de status continuam valendo.
A única exceção são as partidas listadas pela própria função na transação, e
mesmo essas são verificadas de novo, linha por linha.

## Restauração

A restauração é feita só pelo dono do banco, pelo CLI. Ela **não** está
disponível pela API.

```sql
SELECT id, record_kind, record_name, competition_name, deleted_at, counts
FROM public.deletion_log WHERE restored_at IS NULL ORDER BY deleted_at DESC;

SELECT public.restore_deleted_records('<id do registro de exclusão>');
```

A função:

- reinsere as linhas com os mesmos IDs, valores e datas;
- confere as quantidades;
- marca a entrada do log como restaurada (uma restauração só pode ser feita uma
  vez).

Durante a transação, os triggers de usuário das tabelas afetadas ficam
desligados, sob lock exclusivo, e as chaves estrangeiras continuam valendo.

Se, depois da exclusão, alguém tiver criado registros conflitantes (por exemplo,
um confronto que reserva o mesmo par de equipes), a restauração falha e nada é
gravado.

## Reset das competições de teste (produção)

O reset **ainda não foi executado.** Ele exige uma autorização separada, depois
de três passos:

1. Fazer o backup completo com `backup.sh` e validá-lo com `verify-backup.mjs`.
2. Aplicar esta migration na produção.
3. Publicar o frontend.

Execução: um ADMIN exclui, uma por uma, as 4 competições arquivadas com nomes
de teste ("." e ","). Elas somam 149 + 1 + 5 + 2 = **157** linhas. Antes, a
prévia de cada uma deve mostrar exatamente as quantidades abaixo.

| Tabela | Linhas |
|---|---|
| competitions | 4 |
| competition_organizers | 4 |
| seasons | 3 |
| season_teams | 16 |
| team_registrations | 16 |
| rosters | 4 |
| stages | 2 |
| stage_groups | 4 |
| stage_group_teams | 16 |
| rounds | 12 |
| matches (nunca disputadas) | 24 |
| match_status_history | 28 |
| round_robin_pair_claims | 24 |
| **Total** | **157** |

Depois do reset, as verificações são só de leitura. Os hashes de times,
jogadores, contas, perfis e de toda a FBF 20 PRINCIPAL devem ser iguais aos da
linha de base gravada antes da operação.
