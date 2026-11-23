# Reinício auditado de competição com histórico (staging)

Branch `feature/expansao-reinicio-auditado`, criada a partir de `feature/expansao-hall-da-fama`. Nada em produção.

## Por que existe

O reset seguro de competições (já em produção) continua igual para competições sem histórico. Uma competição com **histórico protegido** continua **bloqueada** para esse reset. Esse histórico inclui:
- escalações;
- súmulas por gravação;
- edições de partidas;
- revisões de MVP;
- rascunhos do Hall da Fama.

A proteção não foi removida. Antes, o bloqueio aparecia como erro de banco no fim da operação. Agora a prévia explica o motivo (código `HAS_HISTORY`) e aponta para o procedimento abaixo.

Quando a FBF realmente precisar corrigir ou reiniciar uma competição nessa situação, existe um **procedimento administrativo específico**.

## Como funciona

1. **Prévia** (`competition_restart_preview`): mostra o histórico que será arquivado, por tipo, os registros da competição que serão removidos, os bloqueios e o texto de confirmação.
2. **Execução** (`restart_competition_audited`), em **uma única transação**:
   - só administradores;
   - motivo obrigatório, com ao menos 20 caracteres;
   - confirmação digitada: `REINICIAR <nome da competição>`;
   - a prévia é recalculada com bloqueio das linhas; se algo mudou desde que o administrador a abriu, a operação é recusada;
   - todo o histórico é copiado para o **arquivo de reinícios** (`competition_restart_archive`), junto com o motivo, quem executou e quando;
   - as linhas de histórico são removidas das tabelas ativas, com cada contagem conferida. As proteções dessas tabelas são suspensas só dentro dessa transação e só para essas linhas;
   - em seguida roda o **mesmo reset seguro** de sempre: cópia integral no `deletion_log` e conferência de que times, jogadores, streamers e contas não mudaram;
   - qualquer divergência desfaz tudo e nada é removido.
3. **Restauração** (`restore_competition_restart`): devolve a competição inteira, todo o histórico e o vínculo dos apelidos com as partidas.
   - Só pode ser executada pela administração do banco; nunca fica exposta à API, como a restauração que já existe para o reset.
   - Cada reinício só pode ser restaurado uma vez.

**Bloqueios:**
- partida ao vivo;
- partida de outra competição que depende desta;
- registros **publicados** no Hall da Fama. Eles precisam ser despublicados antes, cada um com o seu motivo, para que um título público nunca desapareça sem registro.

**Nunca é apagado:**
- times, jogadores, streamers e contas;
- os arquivos de gravação no armazenamento;
- o histórico do Hall da Fama (`hall_of_fame_changes`, somente de acréscimo);
- o próprio arquivo de reinícios, que não pode ser apagado nem alterado. A única mudança possível é marcá-lo como restaurado, uma vez.

## Painel

Na aba **Competições**, botão **Reset geral**:
- se a competição tem histórico, a prévia mostra "Reset bloqueado" com o motivo e o botão **"Abrir o reinício auditado desta competição"**;
- o reinício auditado é feito uma competição por vez;
- a tela mostra o histórico e os registros, por tipo, e pede o motivo e a confirmação digitada;
- o botão só fica habilitado com o motivo e a confirmação corretos.

## Migration `20261124120000_competition_restart_audited.sql`

Só cria estruturas novas, com uma exceção: substitui a função interna `_reset_plan` pelo mesmo conteúdo, acrescido do bloqueio `HAS_HISTORY` e de um parâmetro opcional usado só pelo reinício auditado.
- **Tabela `competition_restart_archive`:** leitura só para administradores; não pode ser apagada nem alterada.
- **Funções:**
  - `_competition_history` e `_history_counts`: internas;
  - `competition_restart_preview` e `restart_competition_audited`: para administradores;
  - `restore_competition_restart`: só para o dono do banco.
- **Reversão:** remover os objetos novos e recriar `_reset_plan(uuid[], boolean)` com o conteúdo de `20261121130000`. O procedimento está no arquivo privado de reversão da publicação.

## Testes

- **pgTAP `competition_restart_audited`, 26 verificações:**
  - o reset comum mostra `HAS_HISTORY` e continua recusando;
  - organizador recusado na prévia e na execução;
  - a prévia lista o histórico;
  - motivo curto, confirmação errada e prévia desatualizada são recusados;
  - registro publicado no Hall da Fama bloqueia o reinício;
  - o reinício remove a competição e o histórico das tabelas ativas, guarda tudo no arquivo e no `deletion_log` e não mexe em times e jogadores;
  - o arquivo não pode ser apagado, alterado nem lido por visitantes;
  - a restauração não fica exposta à API, devolve tudo (eventos e vínculo dos apelidos incluídos) e só funciona uma vez.
- O pgTAP do reset seguro (46 verificações) continua passando sem alteração.
- **E2E no staging:**
  - "TESTE Hall da Fama": o reset comum é bloqueado por histórico, e o reinício é bloqueado pelos 3 registros publicados;
  - "TESTE Reinício", competição criada só para o teste: reset comum bloqueado → reinício auditado → prévia com 4 registros de histórico e 22 da competição;
  - com motivo curto o botão fica desabilitado; com motivo válido e confirmação, o reinício é concluído;
  - em seguida, a restauração pelo banco devolveu a competição, 5 eventos, 2 escalações, o histórico de edição e o rascunho do Hall da Fama.
