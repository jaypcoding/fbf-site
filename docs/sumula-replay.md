# Súmula por gravação (replays .hbr2 do HaxBall)

O organizador envia as gravações de uma partida e o FBF monta a súmula sozinho. Ele extrai placar, gols, autores, assistências, estatísticas individuais e coletivas e mapas de calor. O administrador confere as pendências sinalizadas e confirma. **A unidade de validação é a partida**: uma partida pode ter um arquivo, dois (um por tempo) ou vários trechos.

Painel: **Partidas** ou **Rodadas** → ícone de gravação, ou diretamente `/painel?sumula=<id da partida>`.

## Origem do mecanismo de análise e licenças

- **Decodificador e simulador** (`src/lib/replay/binary.ts`, `inflate.ts`, `format.ts`, `model.ts`, `defaultStadiums.ts`, `engine.ts`) são uma **implementação própria do FBF**, escrita para interoperar com o formato `.hbr2` (versão 3).
  - O cliente do HaxBall não tem licença aberta. Por isso nenhum código dele foi copiado. O arquivo `haxball.js` do Haxball Replay Analyzer, que é código do cliente do jogo, também não foi usado: o próprio repositório avisa que esse arquivo não está coberto pela licença MIT.
  - O analyzer original foi usado **apenas localmente, como oráculo de comparação nos testes**, e não faz parte do site.
- **Definições das estatísticas** (chute, passe, assistência, posse, chute no gol) foram portadas do arquivo `packages/replay-core/src/stats/football.js` do [Haxball Replay Analyzer](https://github.com/haxball-replay-analyzer/haxball-replay-analyzer.github.io). Esse arquivo é código do autor do analyzer, sob licença MIT, Copyright (c) 2020 kpias760. A atribuição está no cabeçalho de `src/lib/replay/stats.ts`.
- **Dependências novas:** nenhuma. A descompressão usa `DecompressionStream`, que existe no navegador, no Deno e no Node.
- **Versão:** analisador `fbf-replay-1.0.0`, definições `fbf-stats-1`, formato de análise `schema 1`.

## Compatibilidade verificada

- **Replays reais:** os 40 replays reais disponíveis, incluindo o de referência `LENDAS-08-11-2026-11h03m-04s-kltt.hbr2`, dão resultado **idêntico** ao analyzer original em todos os campos comparados:
  - placar;
  - ticks de jogo;
  - chutes, passes, chutes no gol e posse por equipe;
  - autor e assistência de cada gol.
- **Estádios padrão:** os 10 estádios padrão do jogo, exercitados com jogos sintéticos, também batem com o original.
- **Mapas de calor:** guardam uma amostra por tick de jogo, igual às posições do original (17.053 por jogador no replay de referência).

## Arquitetura

1. **Navegador** (Web Worker, sem travar a página):
   - verifica assinatura, versão, tamanho e estrutura;
   - calcula o SHA-256;
   - mostra uma pré-análise;
   - envia o arquivo ao bucket **privado** `match-replays`, em `<partida>/<sha256>.hbr2`;
   - registra o envio com `register_match_replay`.
2. **Edge Function `replay-process`:** confere a permissão com o token do usuário. Depois baixa o arquivo com a chave de serviço, confere tamanho e SHA-256, roda o **mesmo** analisador (copiado em `supabase/functions/_shared/replay` por `scripts/sync-replay-core.mjs`; um teste falha se as cópias divergirem) e consolida todos os arquivos da partida. A súmula, o conteúdo oficial, o relatório público e o hash ficam em colunas que só o servidor escreve.
3. **Decisões do administrador:** associar jogadores, definir o lado das equipes, incluir ou excluir trechos, ordenar arquivos, corrigir autoria e escolher goleiros. São salvas e **auditadas** com `save_match_replay_decisions`, e a súmula é refeita no servidor.
4. **Confirmação:** `confirm_match_replay_review(partida, hash)` só aceita o hash da súmula exibida. Na mesma transação, revalida tudo contra o banco:
   - equipes, elencos e posição de goleiro;
   - placar contra gols;
   - conjunto exato de arquivos.

   Depois grava gols, assistências, goleiros e duração nas tabelas oficiais (`match_events`, a mesma fonte de verdade de sempre), finaliza a partida, salva apelidos e publica o relatório.

**Limites:**
- 20 MB por arquivo;
- 4 h de jogo;
- 64 MB descompactados, com interrupção imediata contra "zip bomb";
- 2 milhões de ações.

## Regras de consolidação

| Ponto | Regra |
|---|---|
| Trechos | Cada jogo dentro de cada arquivo é um trecho. Trechos com menos de 1 minuto e sem gols ficam de fora por padrão; o administrador pode incluí-los. |
| Ordem | Data e hora no nome do arquivo (`HBReplay-AAAA-MM-DD-HHhMM`, `DD-MM-AAAA-HHhMMm-SSs`, `rec_<epoch>`) ou numeração final (`JOGO1`, `JOGO2`). Sem isso, o administrador confirma ou reordena. |
| Tempo dividido | Um trecho que começa com o relógio andando e com o placar de um trecho anterior é continuação do mesmo tempo. |
| Gravações repetidas | O mesmo trecho de relógio com os mesmos gols é repetição e conta uma vez. |
| Gols | Deduplicados por equipe e tempo de jogo (tolerância de 0,2 s). Gols anteriores ao início da gravação, ou num intervalo não gravado, entram para a equipe **sem autor**, com aviso. |
| Minuto oficial | Soma das durações dos tempos anteriores mais o relógio do jogo. |
| Vermelho/azul → mandante/visitante | Definido por tempo, a partir dos jogadores identificados, **nunca pelo mando**. Sem segurança, bloqueia até o administrador escolher. |
| Estatísticas somáveis | Somadas entre os trechos que não se sobrepõem. |
| Posse | Ticks brutos de cada equipe sobre o total, nunca média de percentuais. |
| Mapas de calor | Soma de ticks por célula, num referencial em que o mandante ataca para a direita. Os tempos em que o mandante jogou de azul são girados 180°. |

**Limitação conhecida:** quando dois arquivos se sobrepõem só em parte, os gols são deduplicados, mas as estatísticas individuais do segundo arquivo não entram. Isso evita contar o trecho repetido em dobro, e a súmula avisa quando acontece.

## Definições das estatísticas

- **Chute:** apertar o chute com a bola ao alcance.
- **Passe:** chute seguido de chute de outro jogador da mesma equipe, na mesma jogada. A jogada recomeça a cada saída de bola.
- **Gol:** o autor é o último a chutar a bola na jogada.
  - Se o último chute foi de um adversário, é gol contra desse jogador.
  - Se ninguém chutou, o gol fica sem autor.
- **Assistência:** o chutador anterior, diferente do autor e da mesma equipe.
- **Chute no gol:** a trajetória livre da bola (com amortecimento e gravidade, sem rebatidas) cruza a linha do gol adversário entre as traves.
- **Finalização** (definição FBF): a trajetória chega à linha de fundo adversária dentro de uma largura de gol de cada lado das traves.
- **Posse:** ticks de bola rolando em que a equipe (ou o jogador) foi a última a chutar.
- **Toques** (definição FBF): contatos do jogador com a bola.
- **Último toque:** usado para conferir a autoria. Quando o último toque antes do gol é de um companheiro diferente do autor, a súmula pede conferência.

## Identificação de jogadores

- **Automática** só quando é segura: nick exato (sem diferenciar maiúsculas e minúsculas nem espaços repetidos) ou apelido salvo, entre os elencos das duas equipes da partida.
- **Ambiguidade:** dois cadastros com o mesmo nick, ou duas pessoas com nicks iguais ou quase iguais ao mesmo tempo na sala, exigem decisão. As estatísticas nunca são misturadas.
- **Outros casos:** nick desconhecido gera sugestões, mas a associação é manual. Uma associação manual vira apelido (`player_aliases`) para as próximas partidas.
- **Cadastros:** nenhum jogador é criado automaticamente.
- **"Não identificado":** o jogador aparece nas estatísticas como tal. Um gol dele vale só para a equipe, e a assistência dele não é registrada.

## Banco (migration `20261122100000_match_replay_sheets.sql`, aditiva)

| Objeto | Papel |
|---|---|
| `match_replays` | Arquivos: hash, tamanho, versão, analisador, status e análise. Nunca são apagados; a remoção é um status. |
| `match_replay_reviews` | A súmula de cada partida: rascunho, confirmada ou cancelada, com decisões, conteúdo do servidor e hash. |
| `match_replay_reports` | Estatísticas públicas de partidas finalizadas. |
| `player_aliases` | Apelidos dos jogadores. |
| `match_replay_audit` | Histórico imutável: envio, remoção, decisões, cancelamento e confirmação. |
| Bucket `match-replays` | Privado. Envio e download por link assinado (5 min) só para quem gerencia a partida; ninguém substitui nem apaga arquivos. |

As FKs para `matches` são `RESTRICT`: um reset ou exclusão de partida com gravações falha em vez de apagar comprovantes. Se um reset desse tipo for necessário, o procedimento precisa ser adaptado.

Uma partida já validada não recebe nova súmula por gravação. Correções posteriores seguem o fluxo de edição de partidas.
