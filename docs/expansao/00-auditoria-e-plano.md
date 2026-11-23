# Grande expansão da FBF — Fase 0: auditoria e plano

Auditoria feita em 2026-11-23 sobre a `main` publicada (`079cd8b`) e o banco de produção (consultas somente leitura). Os números de produção abaixo são dessa data.

## 1. Arquitetura encontrada

- **Front-end:** SPA React + TypeScript (Vite), servida como arquivos estáticos pelo nginx do EC2.
  - Rotas públicas atuais: `/`, `/competicoes`, `/competicoes/:id`, `/times`, `/times/:id`, `/jogadores`, `/jogadores/:id`, `/estatisticas`, `/partidas/:id`.
  - O painel fica em `/painel`.
  - As páginas consultam o Supabase diretamente (supabase-js + RLS), por hooks em `src/lib/hooks.ts`.
- **Banco (Supabase/PostgreSQL):** 19 migrations. Regras de integridade ficam em triggers e funções; o RLS está ativo em todas as tabelas.
  - Toda escrita oficial sensível passa por RPCs `SECURITY DEFINER`: `edit_match_sheet`, `confirm_match_replay_review`, `record_retroactive_match_result`, reset e exclusão seguros.
- **Fonte única das estatísticas:** `match_events` (gols, assistências, gols contra, entrada/saída de goleiro), `matches` (placar, status, duração) e `goalkeeper_participations`. Elas são agregadas pelas views com `security_invoker`:
  - `player_competition_statistics` e `player_career_statistics`: gols, assistências e gols contra; disputa de pênaltis não conta; a assistência é validada contra o gol;
  - `goalkeeper_match_clean_sheet_statistics` e `goalkeeper_clean_sheet_statistics`;
  - `team_competition_statistics` e `stage_standings`.
- **Replays:**
  - analisador próprio (`src/lib/replay`), Edge Function `replay-process`, bucket privado;
  - a confirmação (`confirm_match_replay_review`) grava **gols, assistências e goleiros** em `match_events`/`goalkeeper_participations`;
  - o relatório público vai para `match_replay_reports`.
- **Permissões:** `profiles.role`; os organizadores são ligados a competições (`competition_organizers`). As funções `is_fbf_admin`, `is_fbf_manager` e `can_manage_*` decidem tudo no banco.
- **Publicação:**
  - a CI (GitHub Actions) roda em `main` e `feature/**`: front-end, mais Supabase local com pgTAP, integração e concorrência;
  - as migrations entram em produção pela integração do GitHub ao chegar na `main`;
  - o site é publicado com `scripts/deploy/deploy-vps.sh`, que guarda backup e permite rollback.

## 2. Dados de produção (2026-11-23)

| Item | Situação |
|---|---|
| Competições | FBF 20 PRINCIPAL (ACTIVE), FBF 20 ASPIRANTES (REGISTRATION), 1 cancelada. **Nenhuma encerrada.** |
| Partidas | 12 FINISHED (14 min, placar a partir dos eventos), 60 SCHEDULED, 24 CANCELLED |
| Eventos | 111 gols (10 contra), 79 assistências, todos com o segundo do lance |
| Goleiros | períodos registrados em 8 das 12 partidas encerradas |
| Súmulas por replay confirmadas | 0 |
| Jogadores | 124; nenhum com foto; 3 apelidos repetidos (`night`, `mcelo`, `dd`, 2 cadastros cada) |
| Elencos | por temporada (`rosters` → `season_teams`), **sem datas de entrada e saída** |

## 3. O que já existe e será reaproveitado

| Necessidade | Já existe |
|---|---|
| Gols / assistências / gols contra por competição, temporada e carreira | views `player_*_statistics` |
| Tempo sem sofrer gol e clean sheets | `goalkeeper_participations` + views de clean sheet |
| Resultados de equipe e classificação | `team_competition_statistics`, `stage_standings` |
| Perfil básico do jogador | `/jogadores/:id` (carreira por equipe) |
| Rankings básicos | `/estatisticas` (artilharia, assistências, goleiros) |
| Partida ao vivo | status oficial `LIVE` + miniplayer com Twitch/YouTube/Kick |
| Vencedor de mata-mata | `knockout_series_winner`, `propagate_knockout_result` |
| Histórico de equipes por temporada | `rosters` × `season_teams` × `seasons` |
| Apelidos antigos | `player_aliases` (vindos das súmulas por replay) |

**Decisão:** as novas páginas **estendem** as atuais em vez de duplicá-las.
- O perfil completo é a evolução de `/jogadores/:id`.
- Os rankings são a evolução de `/estatisticas`.
- Os cálculos novos leem as mesmas views e tabelas oficiais; nenhuma tabela paralela de gols ou assistências será criada.

## 4. Lacunas encontradas (o que falta de verdade)

1. **Participação oficial do jogador na partida (a mais importante).** O sistema não registra quem jogou cada partida, só quem marcou, assistiu ou foi goleiro. Sem isso não é possível calcular, de forma confiável:
   - partidas disputadas, vitórias, empates, derrotas e aproveitamento;
   - o bônus de vitória do MVP;
   - a participação em títulos.

   O elenco **não** prova participação. A súmula por replay já conhece todos os jogadores de cada lado e o tempo em campo, mas hoje não grava isso.
2. **URL amigável estável do jogador.** Hoje a URL usa o id. Com apelidos repetidos e trocas de apelido, uma URL só pelo apelido entraria em conflito ou quebraria.
3. **Campeão da competição.** Não há campo de campeão. Ele pode ser **derivado** da final do mata-mata quando a competição estiver `FINISHED`. Prêmios como melhor goleiro e MVP da competição não existem e dependem de critérios oficiais.
4. **Notícias:** nada existe.
5. **Prévia ao compartilhar (Open Graph):** a SPA só gera os metadados no navegador. Discord e WhatsApp não executam JavaScript, então a prévia exige que o servidor responda o HTML com metadados (função de renderização + regra no nginx).
6. **Ao vivo em tempo real:** o status `LIVE` existe, mas na prática os organizadores lançam o resultado depois do jogo. Na produção, SCHEDULED → LIVE → FINISHED acontecem no mesmo instante. Os eventos só chegam depois da partida. A Central ao Vivo vai mostrar o que é real (status e transmissões), sem fingir placar ao vivo.

## 5. Migrations previstas (todas aditivas, testadas no staging antes)

| # | Migration | Conteúdo | Impacto nos dados existentes |
|---|---|---|---|
| M1 | `match_participations` | Tabela `(match_id, player_id, season_team_id, seconds_played, source)` com `source` REPLAY ou SHEET. Leitura pública só de partidas encerradas de competições visíveis; escrita só pelas RPCs oficiais. A confirmação por replay passa a gravar os participantes, e a edição de súmula ganha a lista de quem jogou. | Nenhuma linha existente é alterada. As 12 partidas já encerradas ficam **sem escalação** até um organizador informar (ver decisão D1). |
| M2 | `players.slug` | Coluna única e estável, gerada do apelido. Apelidos repetidos recebem sufixo. Trocar o apelido não troca o slug, e `/jogadores/:id` continua funcionando. | Preenche o slug dos 124 jogadores; nada mais muda. |
| M3 | Views públicas de agregação | Jogador × partida (gols, assistências, gols contra, resultado), rankings com filtros e campeões derivados. Somente views/funções de leitura. | Nenhum. |
| M4 | MVP (só depois da aprovação da fórmula) | Função determinística que calcula o MVP a partir dos dados oficiais, **sem tabela própria**: correções de súmula refletem na hora e nunca existe MVP desatualizado. | Nenhum. |
| M5 | Notícias | Tabela `news_posts`, bucket público de imagens com limite de tipo e tamanho, RLS (rascunho invisível ao público; só gestores escrevem). | Nenhum. |
| M6 | Índices | Só onde as novas consultas exigirem (medido no staging). | Nenhum. |

Nenhuma migration apaga, recria ou reescreve tabelas existentes. Cada uma terá, no PR, justificativa, tabelas, campos, índices, políticas e teste pgTAP.

## 6. Decisões que dependem da FBF

| # | Decisão | Por quê |
|---|---|---|
| D1 | Como tratar as 12 partidas encerradas sem escalação registrada | Opções: (a) organizadores informam quem jogou pela edição de súmula; (b) até lá, essas partidas não contam em "partidas disputadas/vitórias" e o perfil avisa que a escalação não foi registrada. Recomendo (a) + (b). |
| D2 | Fórmula do MVP | Obrigatório pelo pedido: simulação primeiro, aprovação depois. |
| D3 | Prêmios oficiais (melhor goleiro, MVP da competição, chuteira) | Critério oficial da federação. |
| D4 | Mínimo de partidas para rankings de eficiência | Proposta: 5 partidas, visível na página. |
| D5 | Publicação de notícias reais | Conteúdo oficial. |
| D6 | Prévia de links (Open Graph) e sitemap | Exige função no servidor + regra no nginx (mudança de configuração de produção). |
| D7 | Deploy de cada fase | Sempre com sua aprovação. |

**Observação de identidade visual:** o pedido fala em "roxo com dourado", mas a identidade atual do site é **laranja/âmbar sobre marrom escuro (tema escuro) e creme (tema claro)**. Vou preservar a identidade real. Se a FBF quiser migrar para roxo, isso é uma decisão de marca à parte.

## 7. Riscos e como serão tratados

| Risco | Tratamento |
|---|---|
| Contar a mesma partida duas vezes | Tudo agregado por `match_id` a partir das tabelas oficiais; testes pgTAP de duplicidade |
| Partidas canceladas/adiadas contando | Somente `FINISHED` entra nas agregações, como nas views atuais |
| Competições `DRAFT`/canceladas aparecendo | Mesmo filtro de visibilidade do RLS atual |
| Correção de súmula deixando dado velho | Nada derivado é armazenado (views/funções); M1 é regravada na mesma transação da súmula |
| Expor dados privados | As páginas públicas leem só views públicas; nenhum e-mail ou id de conta; teste anon no pgTAP |
| Desempenho | Uma consulta por lista (sem N+1), índices medidos; volume atual pequeno |
| Quebrar o painel ou os replays | O analisador e as RPCs de súmula só ganham comportamento aditivo; a suíte atual (160 testes + pgTAP) tem que continuar verde |
| Apelido repetido | Slug com sufixo; nunca unir cadastros automaticamente |

## 8. Plano de execução e branches

Cada fase tem branch própria `feature/expansao-<fase>`, empilhada na anterior, com commits pequenos, testes e checkpoint. Nada vai para a `main` nem para produção sem aprovação.

| Fase | Branch | Entrega | Depende de aprovação? |
|---|---|---|---|
| 0 | `feature/expansao-fase0` | Este documento | — |
| 1 | `feature/expansao-base` | M1–M3, serviços compartilhados (`src/lib/stats`), testes de equivalência com as views atuais | Não para desenvolver (D1 só para a regra de exibição) |
| 4a | `feature/expansao-mvp-simulacao` | Simulação histórica + relatório | **Aprovação da fórmula (D2) antes de ativar** |
| 2 | `feature/expansao-perfis` | Perfil completo em `/jogadores/:slug` | Não |
| 3 | `feature/expansao-rankings` | Rankings com filtros e histórico | Não (D4 para o mínimo) |
| 4b | `feature/expansao-mvp` | MVP na partida, perfis e rankings | Depois de D2 |
| 5 | `feature/expansao-hall-da-fama` | Campeões derivados, galeria e conquistas por elenco | D3 só para prêmios |
| 6 | `feature/expansao-ao-vivo` | Central ao Vivo (status real + transmissões) | Não |
| 7 | `feature/expansao-comparador` | Comparador no mesmo recorte | Não |
| 8 | `feature/expansao-noticias` | Painel, editor seguro, imagens, páginas públicas | D5 para conteúdo real |
| 9 | `feature/expansao-integracao` | Auditoria geral, SEO/OG (D6), regressão | D6/D7 |

A simulação do MVP (4a) é adiantada para que a aprovação da fórmula possa acontecer enquanto as outras fases andam.

## 9. Testes e rollback

- **Testes:**
  - unitários para os cálculos puros (MVP, rankings, empates);
  - pgTAP para migrations, RLS e funções;
  - equivalência: os totais novos precisam bater com as views atuais;
  - E2E no staging: claro/escuro, 4 tamanhos de tela, papéis visitante/usuário/organizador/admin;
  - CI verde em cada branch.
- **Rollback:**
  - site: `rollback-vps.sh` (cada release guarda backup);
  - migrations aditivas podem ser desfeitas por migration reversa documentada no PR;
  - antes de cada publicação: backup oficial verificado + cópias externas.
