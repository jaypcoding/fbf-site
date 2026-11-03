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
assert.ok(url && anonKey && serviceRoleKey, 'Supabase local status must expose API_URL, ANON_KEY, and SERVICE_ROLE_KEY');
assert.ok(['127.0.0.1', 'localhost', '::1'].includes(new URL(url).hostname), 'Integration tests refuse non-local Supabase URLs');

const service = createClient(url, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
const userClient = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
const suffix = randomBytes(6).toString('hex');
const email = `rr-${suffix}@example.invalid`;
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
requireData(
  await userClient.auth.signInWithPassword({ email, password }),
  'Sign in local test administrator',
);

async function createTournament(teamCount, label) {
  const competition = requireData(
    await service.from('competitions')
      .insert({ name: `Integration ${label} ${suffix}`, category: 'Test', format: 'Pontos corridos', status: 'DRAFT' })
      .select('id').single(),
    `Create ${label} competition`,
  );
  const season = requireData(
    await service.from('seasons')
      .insert({ competition_id: competition.id, name: `Integration season ${label}` })
      .select('id').single(),
    `Create ${label} season`,
  );
  const teams = requireData(
    await service.from('teams')
      .insert(Array.from({ length: teamCount }, (_, index) => ({ name: `Integration ${label} ${suffix} team ${index + 1}` })))
      .select('id'),
    `Create ${label} teams`,
  );
  requireData(
    await service.from('season_teams').insert(teams.map(({ id }) => ({ season_id: season.id, team_id: id }))),
    `Approve ${label} teams`,
  );
  const stage = requireData(
    await service.from('stages')
      .insert({ season_id: season.id, name: `Integration ${label} stage`, format: 'Pontos corridos' })
      .select('id').single(),
    `Create ${label} stage`,
  );
  return stage.id;
}

async function verifyGeneratedSchedule(stageId, teamCount) {
  const rounds = requireData(
    await service.from('rounds').select('id,round_order').eq('stage_id', stageId).order('round_order'),
    `Read round schedule for ${teamCount} teams`,
  );
  const matches = requireData(
    await service.from('matches').select('round_id,home_team_id,away_team_id').in('round_id', rounds.map(({ id }) => id)),
    `Read matches for ${teamCount} teams`,
  );
  const expectedMatches = teamCount * (teamCount - 1) / 2;
  assert.equal(matches.length, expectedMatches, `Expected ${expectedMatches} unique matches for ${teamCount} teams`);
  assert.equal(rounds.length, teamCount % 2 === 0 ? teamCount - 1 : teamCount, 'Round count follows the circle method');

  const pairIds = new Set();
  for (const round of rounds) {
    const roundMatches = matches.filter((match) => match.round_id === round.id);
    assert.equal(roundMatches.length, Math.floor(teamCount / 2), 'Every round contains the correct match count');
    const participatingTeams = new Set();
    for (const match of roundMatches) {
      assert.notEqual(match.home_team_id, match.away_team_id, 'A team cannot play itself');
      const pair = [match.home_team_id, match.away_team_id].sort().join(':');
      assert.ok(!pairIds.has(pair), `Pair ${pair} is not repeated`);
      pairIds.add(pair);
      assert.ok(!participatingTeams.has(match.home_team_id), 'Home team plays at most once per round');
      assert.ok(!participatingTeams.has(match.away_team_id), 'Away team plays at most once per round');
      participatingTeams.add(match.home_team_id);
      participatingTeams.add(match.away_team_id);
    }
    if (teamCount % 2 === 1) assert.equal(teamCount - participatingTeams.size, 1, 'Odd-sized rounds have exactly one bye');
  }
}

const evenStageId = await createTournament(4, 'even');
const parallelResults = await Promise.all([
  userClient.rpc('generate_round_robin', { p_stage_id: evenStageId }),
  userClient.rpc('generate_round_robin', { p_stage_id: evenStageId }),
]);
const results = parallelResults.map((result) => requireData(result, 'Generate round robin concurrently'));
assert.equal(results.filter((result) => result.already_generated === true).length, 1, 'One concurrent call returns the idempotent result');
assert.equal(results.filter((result) => result.already_generated === false && result.matches === 6).length, 1, 'One concurrent call creates the full schedule');
await verifyGeneratedSchedule(evenStageId, 4);

const oddStageId = await createTournament(5, 'odd');
requireData(await userClient.rpc('generate_round_robin', { p_stage_id: oddStageId }), 'Generate odd-team round robin');
await verifyGeneratedSchedule(oddStageId, 5);

console.log('Round-robin integration passed: concurrent 4-team generation and odd 5-team byes verified.');
