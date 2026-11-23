# Comparador de jogadores (staging)

Branch `feature/expansao-comparador`, criada a partir de `feature/expansao-ao-vivo`. Nada em produção. **Sem migration.**

## O que faz

- Rota `/comparar`, com até três jogadores.
- Acessos:
  - página de Jogadores ("Comparar jogadores");
  - Rankings ("Comparar jogadores lado a lado", que já leva a competição filtrada);
  - perfil do jogador ("Comparar com outro jogador").
- A comparação fica no endereço (`?jogadores=sa1,nelly&competicao=…&temporada=…&comuns=1`) e pode ser compartilhada.

## Condições equivalentes

- **Mesmo recorte para todos:** todas as competições, uma competição ou uma temporada.
- **"Só partidas em que todos atuaram"** (opcional): considera apenas as partidas oficiais com participação comprovada de todos os jogadores escolhidos, no mesmo time ou como adversários. A página mostra quantas são.
- **Destaque com critério:** o melhor valor só é destacado quando a comparação é justa.
  - Médias (gols, assistências e participações por partida) e aproveitamento só são destacados quando todos têm ao menos 5 partidas, o mesmo mínimo dos rankings de eficiência.
  - "Gols sofridos por partida no gol" exige 5 partidas no gol.
  - Abaixo disso, a linha diz "sem destaque: amostra mínima de 5".
  - Partidas, vitórias, empates, derrotas, gols contra e partidas no gol são contexto e não recebem destaque.
  - Empates de valor também não recebem destaque.
- **Avisos:** amostra pequena, e quantidades de partidas muito diferentes (a página sugere usar "só partidas em que todos atuaram" ou um recorte).
- **Confronto direto** (com dois jogadores): partidas em que se enfrentaram (vitórias de cada um e empates) e partidas em que jogaram juntos.
- **MVPs:** só aparecem quando o MVP estiver publicado.

## Fonte única

- Os números vêm de `player_match_stats`, a mesma visão que `player_season_summary` soma.
- Eles são totalizados pela **mesma função `aggregate()` dos rankings**, então o comparador não tem contagem própria e não pode divergir dos rankings nem dos perfis.
- Goleiros: `player_match_keeping`.
- MVPs: `mvp_results`, só com o MVP publicado.
- Contam apenas partidas encerradas com participação comprovada (súmula, escalação ou lances), como no resto do site.

## Testes

- **Unitários (`tests/compare.test.mjs`, 4 testes):**
  - os totais do comparador são idênticos aos da função dos rankings (fonte única);
  - recorte por competição e "só partidas em comum";
  - confronto direto (contra e juntos);
  - regras de destaque: amostra mínima, empate, métricas de contexto e gols sofridos.
- **E2E no staging (sa1 × nelly):**
  - aberto a partir do perfil;
  - segundo jogador adicionado;
  - tabela com destaques, 5 partidas em comum e confronto direto de 5 partidas (3 vitórias de sa1 e 2 empates);
  - recorte "TESTE Hall da Fama": 1 partida, médias sem destaque por amostra e aviso exibido;
  - o link compartilhado abre igual no celular escuro, sem rolagem lateral.
