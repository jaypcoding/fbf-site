# MVP, perfis e rankings (staging)

Branches empilhadas: `feature/expansao-mvp`, depois `feature/expansao-perfis`, depois `feature/expansao-rankings` (topo: `c4ba779`). CI aprovada em todas. Nada em produção.

## MVP

- **Migration** `20261123130000_match_mvp.sql`: **apenas views de leitura**, nada armazenado.
  - `match_keeper_spells`: cada período no gol, com tempo, gols sofridos e blocos completos de 2 minutos sem sofrer gol.
  - `match_mvp_scores`: o detalhamento de cada candidato (gols, assistências, goleiro, vitória, gols contra), o total, a maior pontuação da partida, `is_mvp` e `mvp_count`.
- **Regras aprovadas:**
  - pontos: gol +3, assistência +2, +1 por bloco de 2 min no gol sem sofrer gol (cada gol sofrido interrompe), vitória +2, gol contra −3;
  - MVP compartilhado no empate da maior pontuação positiva;
  - sem MVP quando ninguém pontua positivo;
  - pênaltis contam como empate;
  - bônus de vitória só para participação comprovada (escalação, gol, assistência ou goleiro);
  - só partidas com placar vindo dos eventos, como nas estatísticas oficiais;
  - situação de cada partida (decisão de 23/11): **W.O. confirmado** pela organização fica sem MVP, mesmo com escalação; **gol sem autor sem revisão** deixa o MVP pendente; revisada como **partida normal**, calcula normalmente (o gol sem autor não dá pontos). A revisão fica em `match_mvp_reviews`, feita pela seção "Situação para o MVP" do diálogo de Escalação, com motivo e histórico.
- **Caso extremo decidido de forma conservadora:** gol sofrido **com minuto desconhecido** impede dividir o período, então o goleiro dessa equipe não recebe pontos de tempo naquela partida. É sinalizado na página.
- **Página da partida:**
  - cartão do MVP (ou MVPs compartilhados) com o detalhamento;
  - "Como a pontuação foi calculada", com a tabela de todos os candidatos, a fórmula e avisos (escalação não registrada, minuto desconhecido).
- **Publicação controlada pelo banco:** a chave `feature_flags.mvp_public` (só administradores, pelo quadro "Publicação do MVP" no painel, com motivo e histórico) protege a exibição e o acesso. As views do MVP ficam fechadas a visitantes; só as funções `match_mvp` e `mvp_results` entregam o resultado, e apenas com a chave ligada. Organizadores veem uma prévia na página da partida. As estatísticas de goleiro usam a view pública `player_match_keeping`, que não depende da chave. Começa desligada; a publicação dos MVPs históricos depende da FBF.
- **Testes:**
  - pgTAP `match_mvp` com 50 verificações: exemplo da proposta, gol contra, empate no topo, sem MVP, W.O. confirmado, gol sem autor pendente e revisado, troca de goleiro, minuto desconhecido, jogador da escalação sem eventos, correção de súmula e acesso (fechado com a chave desligada, prévia para organizadores, aberto com a chave ligada, views sempre fechadas);
  - **partidas reais:** a lógica do banco aplicada aos 12 jogos oficiais de produção (consulta somente leitura) deu exatamente os mesmos MVPs e pontos da simulação aprovada, incluindo o MVP compartilhado e os 3 W.O. sem MVP;
  - E2E no staging: MVP triplo (3×1) e duplo (4×4), em desktop e celular, nos temas claro e escuro.

## Perfis (`/jogadores/<endereço>`; o endereço por id continua valendo)

- **Números:** partidas, V·E·D, aproveitamento (pontos ÷ possíveis), gols, assistências, gols + assistências, gols contra, MVPs, goleiro (clean sheets).
- **Tabelas e gráfico:**
  - desempenho por competição × temporada × clube;
  - gráfico de barras só com 2 ou mais temporadas, com paleta validada nos temas claro e escuro;
  - partidas com resultado, gols, assistências, goleiro, MVP e link;
  - histórico de equipes (preserva quem saiu do elenco).
- **Aviso de histórico incompleto:** aparece quando as equipes do jogador têm partidas sem escalação registrada.
- **Fonte de dados:** `player_match_stats`, `match_mvp_scores` e `goalkeeper_clean_sheet_statistics`, em poucas consultas, nunca uma por partida. A página anterior foi substituída, sem criar página paralela.
- **Testes:**
  - unitários de agregação;
  - E2E com jogador com MVPs, goleiro, jogador sem partidas (aviso aparece), jogador inexistente, acesso por endereço e por id, celular e tema escuro;
  - totais iguais às estatísticas oficiais.

## Rankings (`/estatisticas`, agora "Rankings" no menu)

- **Categorias:**
  - artilheiros, assistências, G+A, MVPs, partidas, vitórias;
  - aproveitamento e gols/assistências/G+A por partida (mín. 5);
  - goleiros: gols sofridos por partida no gol (mín. 5 como goleiro, menor é melhor);
  - gols contra (informativo);
  - mais o ranking oficial de tempo sem sofrer gol.
- **Filtros:** histórico geral ou competição, temporada, equipe e categoria, guardados na URL.
- **Empates:** dividem a posição ("="); a ordem alfabética dentro do empate não é critério.
- **Mínimo de 5 partidas:** regra sempre visível, com quantos jogadores ficaram abaixo.
- **Testes:**
  - unitários de empates, mínimo, filtros, soma histórica sem duplicar e goleiro;
  - E2E de categorias, filtro, link compartilhado e celular escuro;
  - total geral igual à view oficial (22 gols, 9 assistências, 3 gols contra no staging).

## Limitações

- Nas 12 partidas oficiais de produção, partidas e vitórias contam só participações comprovadas por eventos até as escalações serem preenchidas.
- O ranking oficial de tempo sem sofrer gol só aceita filtro por competição.
- Produção não tem fotos de jogadores (é usado avatar com a inicial).
- O MVP depende do placar vir dos eventos: resultados antigos sem eventos (`LEGACY`) não têm MVP.
