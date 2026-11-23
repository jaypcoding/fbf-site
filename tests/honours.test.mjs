// Hall da Fama (src/lib/honours.ts).
import test from 'node:test';
import assert from 'node:assert/strict';
import { suggestPodium, seasonTopScorers, titleTable } from '../src/lib/honours.ts';

const stage = (id, order, tie = ['POINTS', 'WINS', 'GOAL_DIFF', 'GOALS_FOR', 'TEAM_NAME']) => ({ id, stage_order: order, tie_breakers: tie });
const round = (id, stageId, phase, bracket = null, name = 'R') => ({ id, stage_id: stageId, phase_type: phase, bracket_round: bracket, name });
const match = (id, roundId, home, away, hs, as, over = {}) => ({ id, round_id: roundId, status: 'FINISHED', series_id: null, series_leg: 1, home_team_id: home, away_team_id: away, home_score: hs, away_score: as, home_penalty_score: null, away_penalty_score: null, ...over });
const row = (team, over = {}) => ({ stage_id: 'L', season_team_id: team, team_id: team, team_name: team, team_logo_url: null, stage_group_id: null, group_name: null, played: 2, wins: 0, draws: 0, losses: 0, goals_for: 0, goals_against: 0, points: 0, ...over });

test('knockout: the final gives champion and runner-up; the series fed by losers is the third place', () => {
  const stages = [stage('G', 1), stage('K', 2)];
  const rounds = [round('sf', 'K', 'KNOCKOUT', 1), round('f', 'K', 'KNOCKOUT', 2, 'Fase eliminatória 2'), round('t', 'K', 'KNOCKOUT', 2, 'Disputa do terceiro lugar')];
  const matches = [
    match('m1', 'sf', 'A', 'B', 2, 1), match('m2', 'sf', 'C', 'D', 0, 3),
    match('fin', 'f', 'A', 'D', 1, 2, { home_source_outcome: 'WINNER', away_source_outcome: 'WINNER' }),
    match('trd', 't', 'B', 'C', 4, 4, { home_source_outcome: 'LOSER', away_source_outcome: 'LOSER', home_penalty_score: 3, away_penalty_score: 2 }),
  ];
  const p = suggestPodium(stages, rounds, matches, []);
  assert.deepEqual([p.basis, p.champion, p.runnerUp, p.third, p.notes.length], ['FINAL', 'D', 'A', 'B', 0]);
});

test('knockout: two-legged final on aggregate, and a final decided on penalties', () => {
  const stages = [stage('K', 1)];
  const rounds = [round('f', 'K', 'KNOCKOUT', 1)];
  const legs = [match('l1', 'f', 'A', 'B', 2, 0, { series_id: 's', series_leg: 1 }), match('l2', 'f', 'B', 'A', 3, 2, { series_id: 's', series_leg: 2 })];
  assert.equal(suggestPodium(stages, rounds, legs, []).champion, 'A', '4 x 3 on aggregate');
  const pens = [match('p', 'f', 'A', 'B', 1, 1, { home_penalty_score: 4, away_penalty_score: 5 })];
  const r = suggestPodium(stages, rounds, pens, []);
  assert.deepEqual([r.champion, r.runnerUp], ['B', 'A']);
});

test('knockout: an unfinished final gives no champion and says why', () => {
  const p = suggestPodium([stage('K', 1)], [round('f', 'K', 'KNOCKOUT', 1)], [match('f1', 'f', 'A', 'B', null, null, { status: 'SCHEDULED' })], []);
  assert.equal(p.champion, null);
  assert.match(p.notes[0], /final ainda não terminou/);
});

test('league: the official standings order (stage tie-breakers) gives the podium once every match is finished', () => {
  const stages = [stage('L', 1)];
  const rounds = [round('r1', 'L', 'ROUND_ROBIN')];
  const matches = [match('a', 'r1', 'A', 'B', 1, 0), match('b', 'r1', 'B', 'C', 2, 0)];
  const rows = [row('A', { points: 3, wins: 1, goals_for: 1 }), row('B', { points: 3, wins: 1, goals_for: 2, goals_against: 1 }), row('C', { goals_against: 2 })];
  const p = suggestPodium(stages, rounds, matches, rows);
  assert.deepEqual([p.basis, p.champion, p.runnerUp, p.third], ['STANDINGS', 'B', 'A', 'C'], 'equal points and wins: goal difference decides (B +1, A +1 -> goals for)');
  const pending = suggestPodium(stages, rounds, [...matches, match('c', 'r1', 'A', 'C', null, null, { status: 'SCHEDULED' })], rows);
  assert.equal(pending.champion, null);
  assert.match(pending.notes[0], /sem resultado/);
});

test('league: a complete tie at the top is flagged; a group stage needs the organizers', () => {
  const rows = [row('A', { points: 3, wins: 1, goals_for: 1, goals_against: 1 }), row('B', { points: 3, wins: 1, goals_for: 1, goals_against: 1 })];
  const p = suggestPodium([stage('L', 1)], [round('r', 'L', 'ROUND_ROBIN')], [match('x', 'r', 'A', 'B', 1, 1)], rows);
  assert.match(p.notes.join(' '), /empatadas em todos os critérios/);
  const g = suggestPodium([stage('L', 1)], [round('r', 'L', 'GROUP')], [match('x', 'r', 'A', 'B', 1, 1)], rows.map((r) => ({ ...r, stage_group_id: 'g1' })));
  assert.equal(g.champion, null);
  assert.match(g.notes[0], /grupos/);
});

test('top scorers: goals summed over the teams of a season, ties shared, other seasons ignored', () => {
  const rows = [
    { player_id: 'p1', season_id: 's1', team_id: 't1', goals: 4 }, { player_id: 'p1', season_id: 's1', team_id: 't2', goals: 3 },
    { player_id: 'p2', season_id: 's1', team_id: 't3', goals: 7 }, { player_id: 'p3', season_id: 's1', team_id: 't3', goals: 5 },
    { player_id: 'p4', season_id: 's2', team_id: 't1', goals: 9 }, { player_id: 'p5', season_id: 's3', team_id: 't1', goals: 0 },
  ];
  const r = seasonTopScorers(rows, new Set(['s1', 's3']));
  assert.equal(r.length, 1, 's2 not finished, s3 without goals');
  assert.deepEqual([r[0].goals, r[0].players.map((p) => p.playerId).sort()], [7, ['p1', 'p2']]);
  assert.deepEqual(r[0].players.find((p) => p.playerId === 'p1').teamIds, ['t1', 't2']);
});

test('title table: champions first, then runner-ups and thirds; awards ignored', () => {
  const t = titleTable([
    { season_id: 'a', kind: 'CHAMPION', team_id: 'X' }, { season_id: 'b', kind: 'CHAMPION', team_id: 'Y' }, { season_id: 'c', kind: 'CHAMPION', team_id: 'Y' },
    { season_id: 'a', kind: 'RUNNER_UP', team_id: 'Z' }, { season_id: 'b', kind: 'RUNNER_UP', team_id: 'X' }, { season_id: 'a', kind: 'AWARD', team_id: 'Z' },
  ]);
  assert.deepEqual(t.map((l) => `${l.teamId}:${l.titles}/${l.runnerUps}`), ['Y:2/0', 'X:1/1', 'Z:0/1']);
});

test('title table: editions before the system add to registered teams; unregistered teams count by name', () => {
  const t = titleTable([
    { season_id: 's1', kind: 'CHAMPION', team_id: 'X' },
    { season_id: 'h1', kind: 'CHAMPION', team_id: 'X' },
    { season_id: 'h2', kind: 'CHAMPION', team_id: null, team_name: 'Equipe  Extinta' },
    { season_id: 'h3', kind: 'RUNNER_UP', team_id: null, team_name: 'equipe extinta' },
    { season_id: 'h3', kind: 'TOP_SCORER', team_id: null, team_name: 'Outra' },
  ]);
  assert.deepEqual(t.map((l) => `${l.teamId ?? l.teamName}:${l.titles}/${l.runnerUps}`), ['X:2/0', 'Equipe  Extinta:1/1']);
});
