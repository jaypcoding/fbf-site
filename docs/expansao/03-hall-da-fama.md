# Hall da Fama (staging)

Branch `feature/expansao-hall-da-fama`, criada a partir de `feature/expansao-rankings`. Nada em produção.

## O que aparece

Rota `/hall-da-fama`, no menu como "Hall da Fama". Só entram competições **encerradas**.

- **Campeão, vice e terceiro lugar:** registros oficiais confirmados pela FBF.
- **Artilheiros:** vêm das estatísticas oficiais (`player_season_summary`), sem nenhum registro à parte.
  - Gols contra não contam.
  - Empate divide o posto.
- **Premiações individuais:** registros oficiais da FBF, como melhor jogador ou melhor goleiro.
- **Mais MVPs da edição:** só aparece quando o MVP está publicado.
- **Maiores campeões:** quantidade de títulos por equipe, calculada a partir dos títulos publicados.
- **Perfil do jogador:** nova seção "Conquistas", com três tipos de registro:
  - títulos e vices das equipes de que ele fez parte (elenco ou participação comprovada);
  - as premiações dele;
  - as artilharias.

## Fonte dos dados

| Item | Origem | Armazenado? |
| --- | --- | --- |
| Artilheiro | `player_season_summary` (súmulas oficiais) | Não |
| Mais MVPs | `mvp_results` (só com o MVP publicado) | Não |
| Campeão, vice, 3º | `season_honours`, confirmado por um administrador | Sim, como registro oficial |
| Premiações individuais | `season_honours` | Sim, como registro oficial |

O painel sugere o pódio usando as mesmas regras do site:
- **Mata-mata:** o vencedor da final, com placar agregado e pênaltis tratados pelas regras do chaveamento. A disputa de terceiro lugar é a série alimentada pelos perdedores das semifinais.
- **Pontos corridos:** a classificação ordenada pelos critérios de desempate da fase.

A sugestão não vira título sozinha: um administrador precisa salvá-la e publicá-la.

## Migration `20261124100000_season_honours.sql` (aditiva)

- **Tabela `season_honours`:**
  - campos: temporada, tipo (CHAMPION, RUNNER_UP, THIRD_PLACE ou AWARD), nome do prêmio, equipe da temporada, jogador, base (FINAL, STANDINGS ou MANUAL), observação, situação (DRAFT ou PUBLISHED) e quem e quando registrou e publicou;
  - limites: um campeão, um vice e um terceiro por temporada; um prêmio pode ser dividido;
  - chaves estrangeiras RESTRICT, para que nada do histórico seja apagado em cascata.
- **Tabela `season_honour_changes`:** histórico de cada criação, alteração, publicação, despublicação e exclusão, sempre com o motivo.
- **Funções** `save_season_honour`, `publish_season_honour` e `delete_season_honour`, com estas regras:
  - só administradores podem usá-las;
  - o motivo é obrigatório;
  - a equipe precisa pertencer à temporada;
  - o premiado precisa ter participado da temporada (elenco ou participação comprovada);
  - nada é publicado antes de a competição ser encerrada;
  - um registro publicado não pode ser alterado nem excluído sem antes ser despublicado.
- **Leitura:** visitantes veem só registros publicados de competições encerradas. Administradores veem também os rascunhos.

## Painel

Nova aba "Hall da Fama", só para administradores:
- escolher competição e temporada;
- ver a sugestão do pódio, com a explicação quando ela não é possível: final não disputada, grupos na última fase ou empate total;
- salvar rascunhos, publicar, despublicar e excluir rascunhos;
- cadastrar premiações individuais, com nomes sugeridos e o jogador escolhido entre os elencos da temporada.

## Testes

- **pgTAP `season_honours`, com 24 verificações:**
  - organizador recusado;
  - escrita direta na tabela recusada;
  - motivo obrigatório;
  - equipe de outra temporada recusada;
  - um campeão por temporada;
  - prêmio só para quem participou;
  - nada publicado antes do fim da competição;
  - visitante não vê rascunhos nem o histórico;
  - registro publicado não pode ser alterado nem excluído;
  - histórico completo e em ordem.
- **Unitários (`tests/honours.test.mjs`, 7 testes):**
  - final em jogo único, em ida e volta e decidida nos pênaltis;
  - terceiro lugar;
  - final não terminada;
  - pontos corridos com desempate;
  - partidas pendentes;
  - empate total;
  - grupos;
  - artilharia dividida e somada entre equipes;
  - tabela de títulos.
- **E2E no staging**, numa competição de teste criada só para isso ("TESTE Hall da Fama", encerrada):
  - o administrador confirma o pódio sugerido, publica e cadastra o melhor jogador;
  - o visitante vê a página no computador e no celular escuro, sem rolagem lateral;
  - as conquistas aparecem nos perfis do campeão e do vice;
  - o organizador não vê a aba;
  - o menu não se sobrepõe em larguras de 768 a 1440 px, com e sem login.

## Limitações e decisões pendentes

- **Produção:** nenhuma competição está encerrada, então o Hall da Fama ficaria vazio, com aviso, até o fim do FBF 20.
- **Edições antigas (fora do sistema):** para entrarem, a FBF precisa cadastrá-las como competição encerrada e confirmar os títulos. É conteúdo oficial e depende da autorização de vocês.
- **Reset seguro:** competições com títulos registrados ficam protegidas contra o reset, como já acontece com o histórico de edições.
