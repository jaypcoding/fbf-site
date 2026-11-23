# Fase 4a — Simulação histórica do MVP

**Situação:** proposta em avaliação. Nenhum MVP é exibido nem tratado como oficial até a FBF aprovar a fórmula.

- Código do cálculo: `src/lib/stats/mvp.ts`, puro e determinístico, com testes em `tests/mvp.test.mjs`.
- Simulação: `scripts/mvp/simulate.mts` + `scripts/mvp/official_matches.sql` (somente leitura).
- O relatório completo, com os apelidos dos replays, fica fora do repositório (pasta de operação), porque o repositório é público.

## Fórmula avaliada (referência)

| Ação | Pontos |
|---|---:|
| Gol (gol contra nunca conta como gol) | +3 |
| Assistência válida (mesma regra das estatísticas oficiais) | +2 |
| Cada bloco completo de 2 min como goleiro sem sofrer gol | +1 |
| Vitória (só para quem comprovadamente jogou pela equipe vencedora) | +2 |
| Gol contra | −3 |

Regras de cálculo:
- **Goleiro:** cada período no gol é dividido pelos gols sofridos (gol do adversário ou gol contra da própria equipe). Só blocos de 2 minutos inteiros dentro de um trecho sem gol contam.
- **Troca de goleiro:** cada goleiro só recebe pelo próprio período.
- **Vitória e pênaltis:** a vitória é dada pelo placar da partida. Gols de disputa de pênaltis ficam fora, como nas estatísticas oficiais.
- **Empate na maior pontuação:** o MVP é compartilhado.
- **Sem MVP:** se ninguém tiver pontuação positiva, a partida fica sem MVP.

## Dados usados

| Fonte | Volume | Qualidade |
|---|---|---|
| (A) Partidas oficiais encerradas (produção, leitura) | 12 partidas, 39 jogadores pontuando | Gols, assistências e goleiros oficiais. **Sem escalação registrada**: só se sabe que jogou quem marcou, assistiu ou foi goleiro. Goleiro registrado em 8 das 12. 3 partidas 1×0 com gol sem autor no segundo 0 (provável W.O.). |
| (B) Replays reais (42 arquivos locais) | 28 jogos com ≥ 5 min, 187 jogadores | Participação completa (tempo de cada jogador em cada lado). Goleiro pelo cadastro de goleiros da FBF quando o apelido bate; senão **estimado pela posição média** (só para a simulação). |

## Resultados — fórmula proposta

| Métrica | (A) Oficiais | (B) Replays |
|---|---:|---:|
| Partidas avaliadas | 12 | 28 |
| Jogadores avaliados | 39 | 187 |
| Partidas sem MVP | 3 (os 3 prováveis W.O.) | 0 |
| MVP compartilhado (empate) | 1 | 3 (11%) |
| Pontuação média do MVP | 18,6 | 10,8 |
| MVP ≠ maior artilheiro | 5 de 9 | 2 de 28 |
| MVP goleiro | 2 de 10 MVPs | 3 de 31 MVPs |
| MVP da equipe derrotada | 0 | 0 |

**Distribuição por função (oficiais):** 5 volantes, 3 pivôs, 2 goleiros. Nos replays, 90% dos MVPs são jogadores de linha e 10% goleiros.

### Quem seria MVP nas partidas oficiais

| Partida | MVP | Pontos | Detalhe |
|---|---|---:|---|
| R1 · Domination X 9×9 Sem Firula | dreka | 23 | 7 gols, 1 assistência (empate: sem bônus) |
| R1 · Vincere 9×8 OS4B | telly | 20 | 4G 3A + vitória |
| R1 · New Jeans 8×1 Winners Long | klx | 19 | 5G 1A + vitória |
| R1 · Press X 5×3 We Already Won | Richn | 15 | 3G 2A + vitória |
| R1 · Wolverhampton 9×2 Flawless | richaard | 19 | 3G 4A + vitória (artilheiro Budoks: 18) |
| R1 · Aberração Neural 3×5 Envy | santa **e** ikkena | 11 | goleiro: 6 blocos + 1 gol + vitória / 1G 3A + vitória |
| R2 · Forsaken 10×3 Domination X | Fusion | 22 | 4G 4A + vitória (artilheiro cosmo, da mesma equipe: 6G 1A, 1 gol contra = 19) |
| R2 · Vincere 5×1 We Already Won | Terquila | 14 | goleiro: 6 blocos + 2 gols + vitória |
| R2 · Press X 8×10 OS4B | jn | 24 | 6G 2A + vitória (Richn: 8G, 1 gol contra, derrota = 21) |
| R1 · Hardy Boys 0×1 Xiamen · R1 · Forsaken 1×0 Botafogo · R2 · New Jeans 1×0 Envy | — | — | sem autor de gol (provável W.O.): sem dados |

## Variações de pesos

O "MVP muda" conta as partidas em que o MVP difere da fórmula proposta.

| Variação | (A) muda | (B) muda | (B) MVP goleiro | Leitura |
|---|---:|---:|---:|---|
| V1 — vitória +1 | 0 | 1 (4%) | 3 | Quase sem efeito |
| V2 — sem bônus de vitória | 0 | 5 (18%) | 3 | Mais empates (5); MVP do derrotado fica possível |
| V3 — gol 2 (igual à assistência) | 1 | 12 (43%) | 9 | Muda muito; aumenta empates (8) e goleiros |
| V4 — goleiro +1 a cada 3 min | 2 | 2 (7%) | 2 | Goleiro quase nunca é MVP nas oficiais (0) |
| V5 — goleiro +1 por minuto | 4 | 12 (43%) | 15 | **Distorce:** goleiro vira MVP em metade dos jogos |
| V6 — gol contra −2 | 0 | 0 | 3 | Sem efeito prático |

## Análise e possíveis distorções

1. **A proposta é equilibrada.** Premia quem decide o jogo: o maior artilheiro é MVP na maioria dos casos. Ainda assim, permite MVP de quem dá assistências (richaard, Fusion) ou de goleiro com atuação muito boa (santa, Terquila: 6 blocos de 2 min sem sofrer gol + gols).
2. **O teto do goleiro é previsível.** Em 14 minutos sem sofrer gol, o goleiro faz no máximo 7 blocos + vitória = 9 pontos, o equivalente a 3 gols. É competitivo em jogos de placar baixo e raramente supera atacantes em goleadas. Parece adequado; a V5 mostra que pesar mais o goleiro desequilibra.
3. **O gol contra pesa.** Em dois casos o maior artilheiro perdeu o MVP: cosmo por um gol contra (seu companheiro Fusion fez 4G 4A) e Richn por gol contra + derrota (8 gols, mas o MVP foi jn, do time vencedor). É coerente com a fórmula.
4. **Empates são raros, mas existem** (1 em 9 oficiais, 3 em 28 replays). O MVP compartilhado foi mantido, sem critério extra.
5. **Limitação mais importante: escalação.** Nas partidas oficiais o bônus de vitória só chega a quem marcou, assistiu ou foi goleiro, porque não há registro de quem jogou. Nesta amostra isso **não mudou nenhum MVP** (V1 e V2 dão o mesmo resultado nas oficiais), mas pode mudar em jogos de placar baixo. A solução é a migration M1 (participação oficial).
6. **Partidas sem goleiro registrado (4 das 12):** nenhum ponto de goleiro é dado. O sistema não inventa goleiro.
7. **W.O. registrados como 1×0** ficam sem MVP. Recomendação: a FBF definir se W.O. deve ter marcação própria no futuro.
8. **Pênaltis:** a vitória vale pelo placar da partida. Uma partida decidida nos pênaltis é tratada como empate para o bônus. Precisa de confirmação da FBF (não houve caso na amostra).

## Recomendação

Aprovar a **fórmula proposta (V0) sem mudanças**, com quatro pontos para a FBF confirmar:

1. MVP compartilhado em caso de empate na pontuação máxima.
2. Sem MVP quando ninguém tem pontuação positiva (inclui W.O.).
3. Decisão por pênaltis: tratada como empate para o bônus de vitória.
4. Bônus de vitória só para quem tem participação registrada (depende da M1).

Depois da aprovação, o MVP é calculado por função no banco a partir dos dados oficiais, sem tabela própria. Assim, qualquer correção de súmula ou replay reprocessado atualiza o MVP na hora.
