import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { assertLocalSupabase, runLocalSupabase } from './supabase-local.mjs';

assertLocalSupabase();
const status = runLocalSupabase(['status', '--output', 'env'], 'Read local Supabase status');

function statusValue(name) {
  const match = status.match(new RegExp(`^${name}="?([^"\\r\\n]+)"?$`, 'm'));
  return match?.[1];
}

const url = statusValue('API_URL');
const anonKey = statusValue('ANON_KEY');
const serviceRoleKey = statusValue('SERVICE_ROLE_KEY');
assert.ok(url && anonKey && serviceRoleKey, 'Supabase local status must expose local API keys');
assert.ok(['127.0.0.1', 'localhost', '::1'].includes(new URL(url).hostname), 'Integration tests refuse non-local Supabase URLs');

const service = createClient(url, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
const userClient = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
const suffix = randomBytes(6).toString('hex');
const email = `knockout-${suffix}@example.invalid`;
const password = `${randomBytes(24).toString('base64url')}!aA1`;

function requireData(result, operation) {
  if (result.error) throw new Error(`${operation} failed: ${result.error.message}`);
  return result.data;
}

const { user } = requireData(
  await service.auth.admin.createUser({ email, password, email_confirm: true }),
  'Create local test administrator',
);
requireData(
  await service.from('profiles').update({ role: 'ADMIN' }).eq('id', user.id).select('id').single(),
  'Grant local test administrator role',
);
requireData(await userClient.auth.signInWithPassword({ email, password }), 'Sign in local test administrator');

const competition = requireData(
  await service.from('competitions')
    .insert({ name: `Knockout concurrency ${suffix}`, category: 'Test', format: 'Mata-mata', status: 'DRAFT' })
    .select('id').single(),
  'Create synthetic competition',
);
const season = requireData(
  await service.from('seasons')
    .insert({ competition_id: competition.id, name: `Knockout concurrency ${suffix}` })
    .select('id').single(),
  'Create synthetic season',
);
const teams = requireData(
  await service.from('teams')
    .insert(Array.from({ length: 4 }, (_, index) => ({ name: `Knockout ${suffix} team ${index + 1}` })))
    .select('id,name'),
  'Create synthetic teams',
);
const seasonTeams = requireData(
  await service.from('season_teams')
    .insert(teams.map(({ id }) => ({ season_id: season.id, team_id: id })))
    .select('id,team_id'),
  'Approve synthetic teams',
);
const players = requireData(
  await service.from('players')
    .insert(teams.map((_, index) => ({ nickname: `Knockout ${suffix} player ${index + 1}`, position: 'Pivô' })))
    .select('id,nickname'),
  'Create synthetic players',
);
const playersByNumber = new Map(players.map((player, index) => [index + 1, player]));
requireData(
  await service.from('rosters').insert(seasonTeams.map((seasonTeam, index) => ({
    season_team_id: seasonTeam.id,
    player_id: playersByNumber.get(index + 1).id,
  }))),
  'Add synthetic players to rosters',
);
const stage = requireData(
  await service.from('stages')
    .insert({ season_id: season.id, name: 'Knockout concurrency', format: 'Mata-mata' })
    .select('id').single(),
  'Create synthetic knockout stage',
);
const teamIds = seasonTeams.map(({ id }) => id);
const series = [
  {
    key: 'R1M1', round: 1, matchNumber: 1, legs: 1,
    home: { kind: 'team', teamId: teamIds[0] },
    away: { kind: 'team', teamId: teamIds[3] },
  },
  {
    key: 'R1M2', round: 1, matchNumber: 2, legs: 1,
    home: { kind: 'team', teamId: teamIds[1] },
    away: { kind: 'team', teamId: teamIds[2] },
  },
  {
    key: 'R2M1', round: 2, matchNumber: 1, legs: 1,
    home: { kind: 'winner', sourceKey: 'R1M1' },
    away: { kind: 'winner', sourceKey: 'R1M2' },
  },
];
requireData(
  await userClient.rpc('generate_knockout_stage', {
    p_stage_id: stage.id,
    p_series: series,
    p_legs: 1,
  }),
  'Generate synthetic knockout bracket',
);

const firstRound = requireData(
  await service.from('matches')
    .select('id,home_team_id,away_team_id,round:rounds!inner(stage_id,bracket_round)')
    .eq('round.stage_id', stage.id)
    .eq('round.bracket_round', 1),
  'Read synthetic semifinals',
);
assert.equal(firstRound.length, 2, 'The bracket must contain two semifinal matches');

const playersBySeasonTeam = new Map(seasonTeams.map((seasonTeam, index) => [
  seasonTeam.id,
  playersByNumber.get(index + 1).id,
]));
for (const match of firstRound) {
  requireData(
    await userClient.from('matches').update({ status: 'LIVE' }).eq('id', match.id),
    `Start semifinal ${match.id}`,
  );
  requireData(
    await userClient.from('match_events').insert({
      match_id: match.id,
      event_type: 'GOAL',
      period: 'REGULATION',
      minute_seconds: 60,
      team_id: match.home_team_id,
      player_id: playersBySeasonTeam.get(match.home_team_id),
    }),
    `Record synthetic goal in ${match.id}`,
  );
}

const finishResults = await Promise.all(firstRound.map((match) =>
  userClient.from('matches').update({ status: 'FINISHED' }).eq('id', match.id),
));
for (const [index, result] of finishResults.entries()) {
  requireData(result, `Finish semifinal ${firstRound[index].id} concurrently`);
}

const final = requireData(
  await service.from('matches')
    .select('home_team_id,away_team_id,round:rounds!inner(stage_id,bracket_round)')
    .eq('round.stage_id', stage.id)
    .eq('round.bracket_round', 2)
    .single(),
  'Read final after concurrent semifinal results',
);
assert.deepEqual(
  new Set([final.home_team_id, final.away_team_id]),
  new Set(firstRound.map(({ home_team_id }) => home_team_id)),
  'Both concurrent winners must be propagated without overwriting either side',
);

console.log('Knockout concurrency integration passed: simultaneous results populated both final participants.');
