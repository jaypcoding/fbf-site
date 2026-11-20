import assert from 'node:assert/strict';
import test from 'node:test';
import { buildStandingsLayout, sortStandings } from '../src/lib/standings.ts';

const groups = {
  A: ['Aberração Neural', 'Envy', 'New Jeans', 'Winners Long'],
  B: ['Press X', 'We Already Won', 'Vincere', 'OS4B'],
  C: ['Forsaken', 'Botafogo', 'Domination X', 'Sem Firula'],
  D: ['Hardy Boys', 'Xiamen Pandas Club', 'Wolverhampton', 'Flawless'],
};
const empty = { played: 0, wins: 0, draws: 0, losses: 0, goals_for: 0, goals_against: 0, points: 0 };
// Rows as the stage_standings view returns them (per team, with its group).
function viewRows({ withGroups = true, results = {} } = {}) {
  return Object.entries(groups).flatMap(([letter, teams]) => teams.map((name) => ({
    stage_id: 'stage',
    season_team_id: `st-${name}`,
    team_id: `t-${name}`,
    team_name: name,
    team_logo_url: null,
    stage_group_id: withGroups ? `g-${letter}` : null,
    group_name: withGroups ? `Grupo ${letter}` : null,
    ...empty,
    ...(results[name] ?? {}),
  })));
}
const groupStage = { format: 'Grupos + Mata-mata', tie_breakers: ['POINTS', 'WINS', 'GOAL_DIFF', 'GOALS_FOR', 'TEAM_NAME'] };
const league = { format: 'Pontos corridos', tie_breakers: ['POINTS', 'WINS', 'GOAL_DIFF', 'GOALS_FOR', 'TEAM_NAME'] };
// New Jeans 8 x 1 Winners Long (group A) and two results in other groups.
const results = {
  'New Jeans': { played: 1, wins: 1, goals_for: 8, goals_against: 1, points: 3 },
  'Winners Long': { played: 1, losses: 1, goals_for: 1, goals_against: 8 },
  'Press X': { played: 1, wins: 1, goals_for: 2, goals_against: 1, points: 3 },
  'We Already Won': { played: 1, losses: 1, goals_for: 1, goals_against: 2 },
  'Hardy Boys': { played: 1, wins: 1, goals_for: 1, goals_against: 0, points: 3 },
  'Xiamen Pandas Club': { played: 1, losses: 1, goals_for: 0, goals_against: 1 },
};

test('a group stage shows four separate tables, A to D', () => {
  const layout = buildStandingsLayout(viewRows({ results }), groupStage);
  assert.equal(layout.mode, 'groups');
  assert.deepEqual(layout.tables.map((t) => t.name), ['Grupo A', 'Grupo B', 'Grupo C', 'Grupo D']);
  assert.ok(layout.tables.every((t) => t.rows.length === 4));
});

test('each team appears only in its own group', () => {
  const layout = buildStandingsLayout(viewRows({ results }), groupStage);
  for (const table of layout.tables) {
    const letter = table.name.slice(-1);
    assert.deepEqual(table.rows.map((r) => r.team_name).sort(), [...groups[letter]].sort(), table.name);
  }
  const all = layout.tables.flatMap((t) => t.rows.map((r) => r.team_name));
  assert.equal(new Set(all).size, 16);
});

test('points and numbers are not mixed between groups', () => {
  const layout = buildStandingsLayout(viewRows({ results }), groupStage);
  const byName = (name) => layout.tables.find((t) => t.name === name);
  assert.deepEqual(byName('Grupo A').rows.map((r) => `${r.team_name}:${r.points}`)[0], 'New Jeans:3');
  assert.equal(byName('Grupo A').rows.at(-1).team_name, 'Winners Long', 'goal difference -7 puts Winners Long last');
  assert.equal(byName('Grupo C').rows.reduce((sum, r) => sum + r.points + r.played, 0), 0, 'group C has no result');
  assert.equal(byName('Grupo B').rows[0].team_name, 'Press X');
  assert.equal(byName('Grupo D').rows[0].team_name, 'Hardy Boys');
});

test('tie-breakers are applied inside each group', () => {
  const tie = {
    ...results,
    Forsaken: { played: 2, wins: 1, losses: 1, goals_for: 3, goals_against: 2, points: 3 },
    Botafogo: { played: 2, wins: 1, losses: 1, goals_for: 5, goals_against: 3, points: 3 },
    'Domination X': { played: 2, wins: 1, losses: 1, goals_for: 2, goals_against: 2, points: 3 },
    // Same points as group C leaders, but in another group: must not interfere.
    Envy: { played: 2, wins: 1, losses: 1, goals_for: 9, goals_against: 0, points: 3 },
  };
  const c = buildStandingsLayout(viewRows({ results: tie }), groupStage).tables.find((t) => t.name === 'Grupo C');
  assert.deepEqual(c.rows.map((r) => r.team_name), ['Botafogo', 'Forsaken', 'Domination X', 'Sem Firula'],
    'points tie broken by wins, then goal difference (+2, +1, 0)');
  const namesOnly = sortStandings(viewRows().filter((r) => r.group_name === 'Grupo C'), ['POINTS', 'TEAM_NAME']);
  assert.deepEqual(namesOnly.map((r) => r.team_name), ['Botafogo', 'Domination X', 'Forsaken', 'Sem Firula'], 'all tied: team name');
});

test('a league keeps a single table', () => {
  const rows = viewRows({ withGroups: false, results });
  const layout = buildStandingsLayout(rows, league);
  assert.equal(layout.mode, 'single');
  assert.equal(layout.tables.length, 1);
  assert.equal(layout.tables[0].rows.length, 16);
  assert.equal(layout.tables[0].rows[0].team_name, 'New Jeans');
});

test('a group stage without registered groups is flagged as provisional', () => {
  const layout = buildStandingsLayout(viewRows({ withGroups: false, results }), groupStage);
  assert.equal(layout.mode, 'groups-pending');
  assert.equal(layout.tables.length, 1);
  assert.equal(layout.tables[0].rows.length, 16);
});
