# Fase 1 — Participação oficial, endereço do jogador e views compartilhadas

Branch `feature/expansao-base`. Aplicado e testado **só no staging**. Nada em produção.

## Migrations (todas aditivas)

### `20261123120000_match_participations.sql`

| Item | Conteúdo |
|---|---|
| Tabela nova | `match_participations(match_id, player_id, season_team_id, seconds_played, source, review_id, recorded_by, recorded_at)`; chave primária `(match_id, player_id)` |
| Índices | `player_id`, `season_team_id` |
| Políticas | leitura pública (como `match_events`); nenhuma permissão de escrita direta para ninguém |
| Escrita | (1) gatilho quando a súmula por replay vira `CONFIRMED`, na mesma transação; (2) RPC `save_match_lineup(partida, versão, escalação, motivo)` |
| Funções novas | `validate_match_participation` (gatilho), `_match_lineup_snapshot`, `match_lineup_fingerprint`, `save_match_lineup`, `record_replay_participations` (gatilho) |
| Função alterada | `prevent_deleting_referenced_shared_data`: ganhou **uma condição** (jogador com participação também não pode ser excluído) |
| Chaves estrangeiras | `RESTRICT`, como replays e histórico de súmula: reset/exclusão de partida com escalação é recusado, nunca apaga em silêncio |
| Impacto nos dados existentes | **Nenhum.** Nenhuma linha existente é alterada. As partidas encerradas continuam sem escalação até alguém informar |

### `20261123120100_player_slugs.sql`

| Item | Conteúdo |
|---|---|
| Coluna nova | `players.slug` (única, obrigatória) |
| Preenchimento | Todos os jogadores, a partir do apelido, por ordem de cadastro. Apelido repetido ganha sufixo (`night`, `night-2`) |
| Regra | Gerado ao criar e **nunca muda** (nem trocando o apelido). Não pode ter formato de id. `/jogadores/<id>` continua valendo |
| Impacto | Só a coluna nova é preenchida (a tabela não tem gatilho de "atualizado em"; nenhuma outra coluna muda) |

### `20261123120200_player_public_views.sql`

Views somente de leitura com `security_invoker` (respeitam o RLS):

| View | O que entrega |
|---|---|
| `player_match_participation` | Uma linha por jogador por partida encerrada com participação **comprovada**: escalação, gol/assistência oficial ou registro de goleiro. A equipe vem dos eventos oficiais quando existem. |
| `player_match_stats` | A linha acima + gols, assistências e gols contra na partida (**mesmas regras** de `player_competition_statistics`) + resultado da equipe (pênaltis = empate) |
| `player_season_summary` | Totais por jogador × competição × temporada × clube |
| `team_match_lineups` | Se cada equipe de cada partida encerrada tem escalação |

## Regras atendidas

| Pedido | Como foi atendido |
|---|---|
| Confirmação de súmula por replay | O payload oficial (calculado no servidor e coberto pelo hash) lista os jogadores identificados, com lado e segundos jogados. A confirmação grava a escalação na mesma transação. |
| Reprocessamento de replay | A reconfirmação substitui a escalação; a anterior vai para o histórico. |
| Edição manual | Botão **Escalação** (ícone de pessoas) nas abas Partidas e Rodadas, só em partidas encerradas. Não mexe em placar nem eventos. Exige motivo, detecta edição simultânea e grava o histórico (aparece em "Editar súmula → Histórico"). |
| Substituições / vários jogadores | Todos os que entraram em campo são marcados; o tempo jogado é guardado quando vem da gravação. |
| Quem jogou sem marcar | Conta como participante pela escalação. |
| Correções posteriores | Salvar de novo substitui a escalação inteira (sem duplicar) e gera nova entrada no histórico. |
| Sem duplicidade | Chave `(partida, jogador)` + a view agrupa escalação e eventos do mesmo jogador numa só participação. |
| Histórico, não elenco atual | A participação guarda a equipe da temporada; jogador que saiu do elenco mantém o passado (e não pode ser excluído). |
| Comprovados por eventos | Gols, assistências e goleiro contam como participação mesmo sem escalação. Esses jogadores aparecem travados no editor. |
| Sem escalação inventada | Jogador sem evidência não conta. |
| Permissões | Só organizador da competição ou admin (`can_manage_match`). Competição encerrada: só admin, como na edição de súmula. |

## Testes

- **pgTAP novo** (`supabase/tests/match_participations.test.sql`, 44 verificações):
  - slugs;
  - participação só por eventos;
  - guardas de permissão, versão, motivo, partida não encerrada, duplicado, fora do elenco e sem lado;
  - escalação e correção sem duplicar;
  - placar e eventos intocados;
  - histórico com autor;
  - confirmação por replay grava a escalação e a reconfirmação a substitui com histórico;
  - equivalência com as estatísticas oficiais;
  - escrita direta negada (até para admin);
  - visitante lê as views;
  - jogador que jogou não pode ser excluído e mantém o passado.
- **Suíte completa no staging:** 441 verificações pgTAP em 14 arquivos, todas aprovadas. Inclui as suítes existentes de replay, edição, reset e exclusão seguros. Staging limpo depois (65 contagens idênticas).
- **CI:** aprovada (front-end + banco local do zero).
- **E2E no staging:** editor de escalação na partida de teste 3×1.
  - 6 participantes comprovados travados; reserva sem gol marcável;
  - salvar 7 → corrigir para 6;
  - no banco: 6 linhas, 0 duplicadas, 8 eventos intocados, 2 entradas de histórico;
  - celular: 1 coluna, sem rolagem lateral.
- **Equivalência com dados reais de produção** (consulta somente leitura com a mesma lógica das views, sem criar nada):

| | Estatística oficial atual | Cálculo novo |
|---|---:|---:|
| Linhas jogador × competição | 36 | 36 (0 diferenças nos dois sentidos) |
| Gols | 98 | 98 |
| Assistências | 79 | 79 |
| Gols contra | 10 | 10 |
| Participações comprovadas hoje | — | 53 (39 jogadores), 0 duplicadas |

## Rollback

Migration reversa possível, porque nada existente foi alterado. Se a tabela estiver vazia, basta remover as views, o gatilho da confirmação, as funções novas e a tabela, e restaurar a versão anterior de `prevent_deleting_referenced_shared_data`. Remover `players.slug` só depois de tirar o uso pelo site.
