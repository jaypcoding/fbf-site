import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DEFAULT_TEAM_VIEW,
  NO_COMPETITION_LABEL,
  TEAM_VIEWS,
  categoryLabel,
  currentEdition,
  linksFromRows,
  teamCategoryLabels,
  teamsForView,
  viewFromParam,
} from '../src/lib/teamCategories.ts';

// Like production: 16 Principal teams (also used by an archived test
// competition), 8 Aspirantes teams, plus one team with no competition at all.
const principal = Array.from({ length: 16 }, (_, i) => `p${i + 1}`);
const aspirantes = Array.from({ length: 8 }, (_, i) => `a${i + 1}`);
const teams = [...principal, ...aspirantes, 'free'].map((id) => ({ id, name: `Time ${id}`, logo_url: null })).sort((a, b) => a.name.localeCompare(b.name));
const comp = (id, name, category, status, createdAt) => ({ id, name, category, status, createdAt });
const link = (teamId, seasonId, competition, seasonCreatedAt = '2026-11-20T00:00:00Z') => ({ teamId, seasonId, seasonName: `S ${seasonId}`, seasonCreatedAt, competition });
const testDot = comp('c-test', '.', 'Principal', 'CANCELLED', '2026-11-17T00:00:00Z');
const fbf20 = comp('c-fbf20', 'FBF 20 PRINCIPAL', 'Principal', 'ACTIVE', '2026-11-18T00:00:00Z');
const asp = comp('c-asp', 'FBF 20 ASPIRANTES', 'Secundária', 'REGISTRATION', '2026-11-20T22:25:20Z');
const links = [
  ...principal.map((t) => link(t, 's-test', testDot)),
  ...principal.map((t) => link(t, 's-fbf20', fbf20)),
  ...aspirantes.map((t) => link(t, 's-asp', asp)),
];
const ids = (list) => list.map((team) => team.id).sort();

test('PRINCIPAL shows the 16 teams of the current Principal competition only once', () => {
  const { teams: shown, edition } = teamsForView(teams, links, 'principal');
  assert.deepEqual(ids(shown), [...principal].sort());
  assert.equal(new Set(shown.map((t) => t.id)).size, shown.length);
  assert.equal(edition.competitionName, 'FBF 20 PRINCIPAL');
  assert.equal(edition.seasonId, 's-fbf20', 'the archived test competition is ignored');
});

test('ASPIRANTES is the category "Secundária" and shows its 8 teams', () => {
  const { teams: shown, edition } = teamsForView(teams, links, 'aspirantes');
  assert.deepEqual(ids(shown), [...aspirantes].sort());
  assert.equal(edition.competitionName, 'FBF 20 ASPIRANTES');
  assert.equal(categoryLabel('Secundária'), 'Aspirantes');
});

test('TODOS shows every team, including those without a competition, in the original order', () => {
  const { teams: shown, edition } = teamsForView(teams, links, 'todos');
  assert.deepEqual(shown, teams);
  assert.equal(shown.length, 25);
  assert.equal(edition, null);
});

test('TODOS labels: Principal, Aspirantes or no competition (archived ones do not count)', () => {
  const labels = teamCategoryLabels(links);
  assert.deepEqual(labels.get('p1'), ['Principal']);
  assert.deepEqual(labels.get('a1'), ['Aspirantes']);
  assert.equal(labels.get('free'), undefined);
  assert.equal(NO_COMPETITION_LABEL, 'Sem competição');
  const onlyArchived = teamCategoryLabels(principal.map((t) => link(t, 's-test', testDot)));
  assert.equal(onlyArchived.size, 0, 'teams only in archived competitions show "Sem competição"');
});

test('a team in both current competitions gets both labels, Principal first', () => {
  const labels = teamCategoryLabels([...links, link('p1', 's-asp', asp)]);
  assert.deepEqual(labels.get('p1'), ['Principal', 'Aspirantes']);
});

test('a newer current edition takes over; finished, cancelled and missing editions do not', () => {
  const fbf21 = comp('c-fbf21', 'FBF 21 PRINCIPAL', 'Principal', 'UPCOMING', '2026-12-01T00:00:00Z');
  const withNext = [...links, link('p1', 's-fbf21', fbf21), link('free', 's-fbf21', fbf21)];
  assert.equal(currentEdition(withNext, 'Principal').competitionName, 'FBF 21 PRINCIPAL');
  assert.deepEqual(ids(teamsForView(teams, withNext, 'principal').teams), ['free', 'p1']);
  const finished = links.map((l) => (l.competition.id === 'c-fbf20' ? { ...l, competition: { ...fbf20, status: 'FINISHED' } } : l));
  assert.equal(teamsForView(teams, finished, 'principal').edition, null);
  assert.deepEqual(teamsForView(teams, finished, 'principal').teams, []);
  assert.equal(currentEdition([], 'Secundária'), null);
});

test('within a competition, the most recent season is used', () => {
  const older = principal.slice(0, 4).map((t) => link(t, 's-old', fbf20, '2026-01-01T00:00:00Z'));
  const { edition, teams: shown } = teamsForView(teams, [...older, ...links], 'principal');
  assert.equal(edition.seasonId, 's-fbf20');
  assert.equal(shown.length, 16);
});

test('?categoria= values: unknown or missing open TODOS (old links keep working)', () => {
  assert.equal(DEFAULT_TEAM_VIEW, 'todos');
  assert.deepEqual(TEAM_VIEWS.map((v) => v.label), ['PRINCIPAL', 'ASPIRANTES', 'TODOS']);
  assert.equal(viewFromParam('principal'), 'principal');
  assert.equal(viewFromParam('aspirantes'), 'aspirantes');
  assert.equal(viewFromParam(null), 'todos');
  assert.equal(viewFromParam('Principal'), 'todos');
  assert.equal(viewFromParam('x'), 'todos');
});

test('rows embedded by PostgREST (object or array) become links; incomplete rows are skipped', () => {
  const competitions = { id: 'c-asp', name: 'FBF 20 ASPIRANTES', category: 'Secundária', status: 'REGISTRATION', created_at: '2026-11-20T22:25:20Z' };
  const result = linksFromRows([
    { team_id: 'a1', season_id: 's-asp', seasons: { id: 's-asp', name: 'TEMPORADA 20', created_at: '2026-11-20T22:26:15Z', competitions } },
    { team_id: 'a2', season_id: 's-asp', seasons: [{ id: 's-asp', name: 'TEMPORADA 20', created_at: '2026-11-20T22:26:15Z', competitions: [competitions] }] },
    { team_id: 'x', season_id: 's-hidden', seasons: null },
  ]);
  assert.equal(result.length, 2);
  assert.deepEqual(result[0], {
    teamId: 'a1', seasonId: 's-asp', seasonName: 'TEMPORADA 20', seasonCreatedAt: '2026-11-20T22:26:15Z',
    competition: { id: 'c-asp', name: 'FBF 20 ASPIRANTES', category: 'Secundária', status: 'REGISTRATION', createdAt: '2026-11-20T22:25:20Z' },
  });
  assert.equal(result[1].teamId, 'a2');
});
