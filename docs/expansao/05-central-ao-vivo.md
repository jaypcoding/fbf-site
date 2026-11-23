# Central ao Vivo (staging)

Branch `feature/expansao-ao-vivo`, criada a partir de `feature/expansao-reinicio-auditado`. Nada em produção.

## Regra principal: só informação verdadeira

A Central mostra apenas o que a organização registra no sistema:
- **Em andamento:** partidas com status "ao vivo". Cada uma mostra:
  - o **placar oficial**, que vem dos eventos registrados; se ainda não há placar, aparece "placar não registrado";
  - os **gols na ordem do minuto registrado na súmula**, com assistência, gol contra e "gol sem autor registrado", tal como estão no sistema;
  - o **horário em que a partida foi iniciada no sistema** e o **horário do último registro**;
  - os goleiros registrados no gol naquele momento;
  - as **transmissões vinculadas** à partida (Kick, Twitch, YouTube), com link para o canal.
- **Aguardando início:** partidas cujo horário marcado já passou, mas que ainda não foram iniciadas no sistema. A página diz isso com essas palavras.
- **Próximas 24 horas** e **encerradas nas últimas 24 horas**.

O que a Central **não faz**:
- **Não há cronômetro nem minuto estimado.** O tempo de jogo do HaxBall não é enviado ao site, então qualquer relógio seria uma simulação.
- **Não simula placar nem situação de partida.** Se não houver registros por 20 minutos, o cartão fica tracejado, o indicador "ao vivo" para de piscar e aparece o aviso: "Nenhum registro novo há N minutos. O placar mostrado é o último registrado e pode estar desatualizado."
- **Atualização honesta.** A página consulta o banco a cada 20 segundos enquanto está visível; numa aba escondida, não consulta. Ela mostra "Atualizado às HH:MM:SS" e tem um botão "Atualizar". Se uma atualização falhar, avisa que está mostrando os dados anteriores.

## Fonte dos dados (sem duplicação)

| Informação | Origem |
| --- | --- |
| Placar | `matches.home_score / away_score`, derivados dos eventos pelo próprio banco |
| Gols e assistências | `match_events` |
| Goleiro no gol | `goalkeeper_participations` sem saída registrada |
| Transmissões | `match_streamers` + `streamers` |
| Início no sistema | `live_match_status()`, a partir do histórico de status |
| Último registro | o mais recente entre o início, a última alteração da partida e o último evento |

## Migration `20261124130000_live_center.sql` (aditiva)

- A função `live_match_status()` devolve **só** o par (partida, horário em que foi posta ao vivo), e só para partidas ao vivo agora em competições públicas.
- O histórico de status continua privado, porque também diz quem alterou. A função não expõe usuário nem outras transições.
- Nada é armazenado.
- **Reversão:** `DROP FUNCTION public.live_match_status();`.

## Front

- Nova rota `/ao-vivo`, com o item "Ao vivo" no menu.
- `src/lib/liveCenter.ts` tem as funções puras: gols na ordem registrada, último registro, situação de desatualização e agenda do dia.
- `src/lib/feedSelect.ts` é a consulta compartilhada das listas públicas de partidas, agora usada pela página inicial e pela Central. A regra é a mesma de antes: competições em rascunho e arquivadas não aparecem.

## Testes

- **pgTAP `live_center`, 6 verificações:**
  - partida marcada não aparece;
  - o visitante vê a partida ao vivo com o horário de início;
  - só aparecem partidas ao vivo agora;
  - o histórico de status continua privado;
  - a função devolve só a partida e o horário.
- **Unitários (`tests/liveCenter.test.mjs`, 4 testes):**
  - ordem dos gols, assistências, gol contra e gol sem autor;
  - último registro;
  - desatualização a partir de 20 minutos;
  - agenda: próximas, aguardando início e encerradas.
- **E2E no staging**, numa partida de teste posta ao vivo na competição "TESTE Reinício":
  - cartão com placar 1×0, início e último registro, e o gol com assistência no minuto registrado;
  - nenhum relógio na página;
  - computador claro e celular escuro, sem rolagem lateral;
  - menu com o novo item sem sobreposição de 768 a 1440 px.
