export type Pairing = { home: string; away: string };

const BYE = '__bye__';

export function buildRoundRobin(teamIds: string[], legs: 1 | 2 = 1): Pairing[][] {
  if (legs !== 1 && legs !== 2) {
    throw new Error('A competição deve ter turno único ou turno e returno.');
  }
  if (new Set(teamIds).size !== teamIds.length) {
    throw new Error('A lista de times contém IDs duplicados.');
  }
  if (teamIds.some((teamId) => !teamId)) {
    throw new Error('A lista de times contém um ID vazio.');
  }

  const teams = [...teamIds];
  if (teams.length < 2) return [];
  if (teams.includes(BYE)) {
    throw new Error('Um ID de time usa o identificador reservado para folgas.');
  }
  if (teams.length % 2 === 1) teams.push(BYE);
  const size = teams.length;
  const [fixed, ...rotating] = teams;
  const firstLeg: Pairing[][] = [];

  for (let round = 0; round < size - 1; round++) {
    const line = [fixed, ...rotating];
    const pairings: Pairing[] = [];
    for (let i = 0; i < size / 2; i++) {
      const a = line[i];
      const b = line[size - 1 - i];
      if (a === BYE || b === BYE) continue;
      pairings.push(round % 2 === 0 ? { home: a, away: b } : { home: b, away: a });
    }
    firstLeg.push(pairings);
    rotating.unshift(rotating.pop() as string);
  }

  const rounds = legs === 1
    ? firstLeg
    : [...firstLeg, ...firstLeg.map((round) => round.map(({ home, away }) => ({ home: away, away: home })))];
  const pairCount = rounds.reduce((total, round) => total + round.length, 0);
  if (pairCount !== ((teamIds.length * (teamIds.length - 1)) / 2) * legs) {
    throw new Error('A geração de confrontos produziu uma quantidade inválida de partidas.');
  }

  const seenPairings = new Set<string>();
  for (const [roundIndex, round] of rounds.entries()) {
    const teamsInRound = new Set<string>();
    for (const { home, away } of round) {
      if (teamsInRound.has(home) || teamsInRound.has(away)) {
        throw new Error('Um time foi escalado mais de uma vez na mesma rodada.');
      }
      teamsInRound.add(home);
      teamsInRound.add(away);
      const key = [home, away].sort().join(':');
      const leg = legs === 2 && roundIndex >= firstLeg.length ? 2 : 1;
      const legKey = `${leg}:${key}`;
      if (seenPairings.has(legKey)) {
        throw new Error('A geração de confrontos contém uma partida duplicada.');
      }
      seenPairings.add(legKey);
    }
    if (teamIds.length % 2 === 1 && round.length !== (teamIds.length - 1) / 2) {
      throw new Error('Uma rodada com número ímpar de times precisa conter uma folga.');
    }
  }

  return rounds;
}
