# Hall da Fama (staging)

Branch `feature/expansao-hall-da-fama`, criada a partir de `feature/expansao-rankings`. Nada em produção. A publicação do Hall da Fama é separada das quatro migrations do MVP, perfis e rankings.

## O que aparece

Rota `/hall-da-fama`, no menu como "Hall da Fama". Entram as competições **encerradas** do sistema e as **edições anteriores ao sistema** confirmadas pela FBF.

- **Campeão, vice e terceiro lugar:** registros oficiais confirmados pela FBF.
- **Artilheiros:**
  - nas competições do sistema, vêm das estatísticas oficiais (`player_season_summary`), sem nenhum registro à parte; gols contra não contam e empate divide o posto;
  - nas edições anteriores ao sistema não há súmulas, então o artilheiro é um registro confirmado pela FBF.
- **Premiações individuais:** registros oficiais da FBF, escolhidos numa lista de categorias que a administração mantém. Nenhuma categoria é obrigatória: cada edição tem só as premiações realmente entregues.
- **Mais MVPs da edição:** só aparece quando o MVP está publicado.
- **Maiores campeões:** quantidade de títulos por equipe, somando os títulos publicados do sistema e de antes dele.
  - Uma equipe cadastrada soma os dois.
  - Uma equipe que só existe pelo nome numa edição antiga é contada por esse nome.
- **Edições anteriores ao sistema:** cartão próprio, tracejado, com o selo "Registro anterior ao sistema, confirmado pela FBF" e a fonte da confirmação.
- **Perfil do jogador:** nova seção "Conquistas", com estes registros:
  - títulos e vices das equipes de que ele fez parte (elenco ou participação comprovada);
  - as premiações dele;
  - as artilharias;
  - registros de edições anteriores ao sistema, só quando citam o próprio jogador (premiação ou artilharia), com o selo "Registro anterior ao sistema". Sem elencos dessas edições, um título de equipe nunca é atribuído a um jogador.

## Fonte dos dados

| Item | Origem | Armazenado? |
| --- | --- | --- |
| Artilheiro (sistema) | `player_season_summary` (súmulas oficiais) | Não |
| Mais MVPs | `mvp_results` (só com o MVP publicado) | Não |
| Campeão, vice, 3º (sistema) | `season_honours`, confirmado por um administrador | Sim, como registro oficial |
| Premiações individuais | `season_honours` + `award_categories` | Sim, como registro oficial |
| Edições anteriores ao sistema (pódio, artilharia, premiações) | `historical_editions` + `season_honours` | Sim, digitado e confirmado por um administrador (não há súmulas) |

O painel sugere o pódio das competições do sistema usando as mesmas regras do site:
- **Mata-mata:** o vencedor da final, com placar agregado e pênaltis tratados pelas regras do chaveamento. A disputa de terceiro lugar é a série alimentada pelos perdedores das semifinais.
- **Pontos corridos:** a classificação ordenada pelos critérios de desempate da fase.

A sugestão não vira título sozinha: um administrador precisa salvá-la e publicá-la. Para as edições antigas não há sugestão: nada é presumido.

## Migration `20261124100000_season_honours.sql` (aditiva)

- **Tabela `award_categories`:** as categorias de premiação.
  - Já vem com as seis aprovadas: Melhor jogador, Melhor goleiro, Melhor volante, Melhor pivô, Revelação e Craque da final.
  - A administração cria, renomeia, desativa e reativa categorias pelo painel, sem mudar código nem criar migration.
  - Uma categoria já publicada não pode ser renomeada, para não mudar prêmios já anunciados: desative e crie outra.
  - Uma categoria já usada nunca é excluída.
- **Tabela `historical_editions`:** edições disputadas antes do sistema.
  - Campos: competição, edição, categoria, ano, datas de início e fim (opcionais), **fonte da confirmação** (obrigatória) e observação.
  - Nenhuma data pode ser futura.
  - Fica separada de `competitions` de propósito: não aparece em tabelas, rankings, estatísticas nem no reset, e não precisa de partidas.
  - Visitantes só veem uma edição depois que ela tem ao menos um registro publicado.
- **Tabela `season_honours`:**
  - pertence a uma temporada do sistema **ou** a uma edição anterior ao sistema, nunca às duas;
  - tipos: CHAMPION, RUNNER_UP, THIRD_PLACE, AWARD (com a categoria) e TOP_SCORER;
  - **TOP_SCORER só existe para edições anteriores ao sistema.** Nas competições do sistema, a artilharia vem das súmulas e o banco recusa qualquer registro paralelo;
  - nas edições antigas, a equipe pode ser uma equipe cadastrada ou um nome digitado (equipe extinta), e o jogador também;
  - nas competições do sistema, só a equipe da temporada e um jogador que participou dela;
  - limites: um campeão, um vice e um terceiro por temporada ou edição; um prêmio pode ser dividido;
  - chaves estrangeiras RESTRICT, para que nada do histórico seja apagado em cascata.
- **Tabela `hall_of_fame_changes`:** histórico de cada criação, alteração, publicação, despublicação e exclusão de registros, edições e categorias, sempre com o motivo. É somente de acréscimo: nem o dono do banco altera ou apaga.
- **Funções:** `save_season_honour`, `publish_season_honour`, `delete_season_honour`, `save_historical_edition`, `delete_historical_edition`, `save_award_category` e `delete_award_category`. Regras:
  - só administradores podem usá-las;
  - o motivo é obrigatório;
  - nas competições do sistema, a equipe precisa pertencer à temporada, o premiado precisa ter participado dela e nada é publicado antes de a competição ser encerrada;
  - nas edições antigas, **publicar é a confirmação do administrador**; tudo começa como rascunho;
  - um registro publicado não pode ser alterado nem excluído sem antes ser despublicado;
  - uma edição com registros publicados não pode ser alterada, e uma edição com registros não pode ser excluída.
- **Leitura:** visitantes veem só registros publicados, de competições encerradas ou de edições antigas. Administradores veem também os rascunhos e o histórico.

## Painel

Nova aba "Hall da Fama", só para administradores, com três partes e um campo de motivo comum.

**Competições do sistema:**
- escolher competição e temporada;
- ver a sugestão do pódio, com a explicação quando ela não é possível: final não disputada, grupos na última fase ou empate total;
- salvar rascunhos, publicar, despublicar e excluir rascunhos;
- cadastrar premiações individuais: a categoria vem da lista de categorias ativas e o jogador é escolhido entre os elencos da temporada.

**Edições anteriores ao sistema:**
- cadastrar e editar a edição, com a fonte da confirmação;
- registrar o pódio: equipe cadastrada ou nome digitado;
- registrar artilheiros (com os gols, se confirmados) e premiações: jogador cadastrado ou nome digitado, equipe opcional;
- publicar (confirmar), despublicar e excluir rascunhos.

**Premiações:** criar, renomear, desativar, reativar e excluir categorias que nunca foram usadas.

## Testes

- **pgTAP `season_honours`, com 52 verificações:**
  - organizador recusado; escrita direta na tabela recusada; motivo obrigatório;
  - equipe de outra temporada recusada; um campeão por temporada; prêmio só para quem participou;
  - nada publicado antes do fim da competição; visitante não vê rascunhos nem o histórico;
  - registro publicado não pode ser alterado nem excluído; histórico completo e em ordem;
  - artilharia do sistema nunca registrada à mão;
  - categorias: as seis aprovadas presentes, criação sem migration, nome único, renomear publicada recusado, excluir usada recusado, desativada não aceita novos prêmios, excluir nunca usada permitido;
  - edições antigas: fonte obrigatória, sem data futura, invisível sem registro publicado, equipe extinta pelo nome, sem equipe de temporada, um campeão por edição, artilheiro confirmado, publicação como confirmação, edição com registro publicado bloqueada;
  - histórico somente de acréscimo.
- **Unitários (`tests/honours.test.mjs`, 8 testes):**
  - final em jogo único, em ida e volta e decidida nos pênaltis; terceiro lugar; final não terminada;
  - pontos corridos com desempate; partidas pendentes; empate total; grupos;
  - artilharia dividida e somada entre equipes;
  - tabela de títulos, incluindo edições antigas com equipe cadastrada e equipe só pelo nome.
- **E2E no staging**, numa competição de teste criada só para isso ("TESTE Hall da Fama", encerrada):
  - o administrador confirma o pódio sugerido, publica e cadastra o melhor jogador;
  - o visitante vê a página no computador e no celular escuro, sem rolagem lateral;
  - as conquistas aparecem nos perfis do campeão e do vice;
  - o organizador não vê a aba;
  - o menu não se sobrepõe em larguras de 768 a 1440 px, com e sem login.
- **E2E das edições antigas e categorias** (edição "TESTE Copa Antiga", só no staging):
  - categoria criada, desativada e excluída; exclusão de categoria em uso recusada;
  - edição sem fonte não é cadastrada;
  - campeão por nome digitado, vice por equipe cadastrada, artilheiro e Revelação;
  - publicados o campeão, o artilheiro e o prêmio; o vice ficou em rascunho e o visitante não o vê;
  - cartão com o selo de registro anterior ao sistema, no computador e no celular escuro;
  - os perfis de sa1 e nelly mostram os registros antigos com o selo.

## Limitações e decisões pendentes

- **Produção:** nenhuma competição está encerrada, então o Hall da Fama ficaria vazio, com aviso, até o fim do FBF 20 ou até a FBF confirmar edições antigas.
- **Edições antigas:** a estrutura está pronta, mas **nenhuma edição real foi cadastrada**. O cadastro e cada confirmação dependem dos organizadores.
- **Reset seguro:** competições com títulos registrados ficam protegidas contra o reset, como já acontece com o histórico de edições. Correções nesses casos usam o procedimento auditado (`docs/expansao/04-reinicio-auditado.md`).
