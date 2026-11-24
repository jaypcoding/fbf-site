# Mapa tático dos clubes (staging)

Branch `feature/mapa-tatico`, criada a partir da `main` em produção (`0049d74`). Nada em produção.

## O que é

Na página de cada equipe (`/times/<id>`), a seção "Elenco" passa a mostrar o mapa tático da temporada escolhida:
- uma quadra vista de cima, com os três titulares;
- o banco de reservas, ao lado no computador e abaixo no celular.

É a **apresentação do elenco definida pelo clube**. **Não é a escalação oficial de nenhuma partida**: não altera participações, súmulas, eventos, gols, assistências, goleiros, estatísticas nem o MVP. A página diz isso logo abaixo do título.

## Auditoria da estrutura existente

| Item | Como já existia | Uso no mapa |
| --- | --- | --- |
| Equipes | `teams` | o clube |
| Temporadas | `seasons` + `season_teams` (a equipe numa temporada) | a formação é guardada por `season_teams`; cada temporada tem a sua |
| Elenco | `rosters` (com número da camisa) | só jogadores do elenco daquela temporada podem ser escalados |
| Jogadores | `players` (apelido, posição, endereço) | nome, posição e link para o perfil |
| Responsável/capitão | **não existia** | tabela nova e mínima `team_managers`, designada só por administradores |
| Participação em partidas | `match_participations` (publicação 1) | **não é usada nem alterada** |

## Banco: migration `20261125100000_team_tactical_map.sql` (aditiva)

| Objeto | Para que serve |
| --- | --- |
| `team_managers` | quem pode editar o mapa de um clube, além dos administradores. Só administradores designam ou removem (`set_team_manager`), com motivo. |
| `team_formations` | uma formação por equipe na temporada: até 3 titulares `{jogador, posição, x, y}`, com x e y proporcionais à quadra (0 a 1), e a ordem do banco. Tem número de versão contra edições simultâneas. |
| `team_player_avatars` | o avatar que o clube deu a cada jogador: cores, símbolo, abreviação, estilo e número. É por clube, para um clube não mudar o visual que outro deu ao mesmo jogador. |
| `team_presentation_changes` | histórico de cada mudança, com quem fez e quando. Somente de acréscimo. |
| `can_edit_team_presentation`, `save_team_formation`, `save_team_player_avatar`, `set_team_manager` | as únicas portas de escrita. Conferem a permissão, o elenco, as duplicidades, os limites da quadra e a versão. |

Regras garantidas pelo banco:
- só administradores ou responsáveis do próprio clube editam;
- só jogadores do elenco daquela temporada entram na formação;
- um jogador aparece uma única vez (titular ou reserva), com no máximo 3 titulares e posições dentro da quadra;
- um salvamento feito sobre uma versão antiga é recusado, com a mensagem de que outra pessoa salvou antes;
- o avatar só vale para jogador que pertence a algum elenco do clube, e as cores e símbolos aceitos são os de uma lista fechada.

São registros de apresentação. Se uma temporada for apagada pelo reset seguro, a formação dela vai junto; nenhum dado oficial depende dela.

**Reversão:** remover as quatro tabelas e as funções. Nada mais depende delas.

## Site

- **Visualização** (todos): quadra, titulares com posição e nome, vagas tracejadas quando há menos de três titulares, e o banco com avatar, apelido, posição e número. Clicar num jogador abre o perfil. Trocar a temporada mostra a formação daquela temporada.
- **Editar escalação** (administradores e responsáveis do clube):
  - arrastar os titulares na quadra;
  - arrastar um reserva pela alça até a quadra (solto sobre um titular, os dois trocam de lugar);
  - pelo toque: tocar no jogador e depois no destino (lugar da quadra, vaga ou outro jogador para trocar);
  - posições GK, VL, PV ou outra de até 4 letras; enviar ao banco; ordem do banco;
  - "Sugerir pelas posições do cadastro" (só uma sugestão: nada é salvo sozinho);
  - Salvar, Cancelar com confirmação quando há alterações, aviso ao sair da página com alterações, mensagens de sucesso, erro e conflito.
- **Editor de avatar** (modelos prontos, sem envio de imagens):
  - cor de fundo e cor da borda (paleta da FBF ou outra cor);
  - 10 símbolos: inicial, número, bola, luva, estrela, escudo, coroa, raio, chama e alvo;
  - abreviação de até 3 letras, número da camisa e 3 estilos (sólido, anel, dividido);
  - prévia em tempo real nos tamanhos da quadra e do banco, e "Voltar ao padrão". Sem configuração, o avatar padrão usa a inicial.
- **Baixar imagem:** PNG 1080×1350 montado com composição própria (escudo, nome, temporada, quadra, titulares, banco e avatares), não é captura de tela. Se o escudo estiver num endereço que não permite cópia, aparecem as iniciais.
- **Painel › Times › Responsáveis pelos clubes** (administradores): designar e remover responsáveis, com motivo.

## Testes

- **pgTAP `team_tactical_map`, 30 verificações:**
  - visitante, usuário comum e organizador recusados;
  - ninguém se designa sozinho nem escreve nas tabelas diretamente;
  - motivo obrigatório;
  - o responsável edita o próprio clube e não o de terceiros;
  - jogador fora do elenco, duplicidade, quarto titular e posição fora da quadra são recusados;
  - salvamento sobre versão antiga é recusado;
  - formação com menos de três titulares é aceita;
  - cada temporada tem a sua formação;
  - avatares validados, sem mexer em outro clube;
  - administrador edita qualquer clube;
  - histórico completo e somente de acréscimo;
  - escalações oficiais, elencos e jogadores intactos.
- **Unitários (`tests/tactics.test.mjs`, 7 testes):** formação a partir do elenco, limites, troca sem duplicar, ordem do banco, sugestão pelas posições, avatares e contraste.
- **E2E no staging, com dados fictícios:**
  - permissões dos cinco perfis, inclusive direto na API;
  - designação pelo painel;
  - sugestão, arraste, troca pelo toque, posição personalizada, salvar e recarregar;
  - avatar salvo e mantido;
  - clube rival e jogador fora do elenco recusados;
  - conflito entre duas pessoas editando;
  - temporada com dois jogadores mostra a vaga;
  - cancelar com confirmação;
  - imagem baixada;
  - celular escuro e tablet sem rolagem lateral.
- **Dados oficiais do staging:** participações, elencos, jogadores, eventos, goleiros e partidas idênticos antes e depois.
