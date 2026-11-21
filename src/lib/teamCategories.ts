// Views of the public Teams page: PRINCIPAL, ASPIRANTES and TODOS.
//
// A team takes part in a competition through season_teams (team -> season ->
// competition); teams are never duplicated per category. Each category view
// shows the teams of the *current* competition of that category (upcoming,
// registration or active), using its most recent season, so archived test
// competitions never appear and a new edition takes over automatically.
import type { Competition, Team } from './supabase.ts';

export type TeamView = 'principal' | 'aspirantes' | 'todos';

type ViewDefinition = { slug: TeamView; label: string; category: string | null };

// "ASPIRANTES" is stored as the category "Secundária" (kept as is in the database).
export const TEAM_VIEWS: readonly ViewDefinition[] = [
  { slug: 'principal', label: 'PRINCIPAL', category: 'Principal' },
  { slug: 'aspirantes', label: 'ASPIRANTES', category: 'Secundária' },
  { slug: 'todos', label: 'TODOS', category: null },
];

export const DEFAULT_TEAM_VIEW: TeamView = 'todos';

const CATEGORY_LABELS: Record<string, string> = { Principal: 'Principal', 'Secundária': 'Aspirantes' };
export const NO_COMPETITION_LABEL = 'Sem competição';

export const CURRENT_COMPETITION_STATUSES: readonly Competition['status'][] = ['UPCOMING', 'REGISTRATION', 'ACTIVE'];

export type ParticipationLink = {
  teamId: string;
  seasonId: string;
  seasonName: string;
  seasonCreatedAt: string;
  competition: { id: string; name: string; category: string; status: Competition['status']; createdAt: string };
};

export type CurrentEdition = { competitionId: string; competitionName: string; seasonId: string; seasonName: string };

/** View for a `?categoria=` value; unknown or missing values fall back to TODOS (the old page). */
export function viewFromParam(value: string | null | undefined): TeamView {
  return TEAM_VIEWS.find((view) => view.slug === value)?.slug ?? DEFAULT_TEAM_VIEW;
}

export function viewDefinition(view: TeamView): ViewDefinition {
  return TEAM_VIEWS.find((item) => item.slug === view) as ViewDefinition;
}

export function categoryLabel(category: string): string {
  return CATEGORY_LABELS[category] ?? category;
}

const isCurrent = (link: ParticipationLink) => CURRENT_COMPETITION_STATUSES.includes(link.competition.status);

/** Most recent current competition of a category and its most recent season. */
export function currentEdition(links: ParticipationLink[], category: string): CurrentEdition | null {
  const candidates = links.filter((link) => isCurrent(link) && link.competition.category === category);
  if (!candidates.length) return null;
  const newest = [...candidates].sort((a, b) =>
    b.competition.createdAt.localeCompare(a.competition.createdAt)
    || b.seasonCreatedAt.localeCompare(a.seasonCreatedAt)
    || a.competition.id.localeCompare(b.competition.id))[0];
  const season = candidates
    .filter((link) => link.competition.id === newest.competition.id)
    .sort((a, b) => b.seasonCreatedAt.localeCompare(a.seasonCreatedAt) || a.seasonId.localeCompare(b.seasonId))[0];
  return { competitionId: newest.competition.id, competitionName: newest.competition.name, seasonId: season.seasonId, seasonName: season.seasonName };
}

/** Labels of the current editions each team is in ("Principal", "Aspirantes", other categories). */
export function teamCategoryLabels(links: ParticipationLink[]): Map<string, string[]> {
  const editions = new Map<string, CurrentEdition>();
  for (const category of new Set(links.filter(isCurrent).map((link) => link.competition.category))) {
    const edition = currentEdition(links, category);
    if (edition) editions.set(category, edition);
  }
  const labels = new Map<string, string[]>();
  for (const link of links) {
    const edition = editions.get(link.competition.category);
    if (!edition || edition.seasonId !== link.seasonId) continue;
    const label = categoryLabel(link.competition.category);
    const current = labels.get(link.teamId) ?? [];
    if (!current.includes(label)) labels.set(link.teamId, [...current, label]);
  }
  for (const [teamId, values] of labels) labels.set(teamId, sortLabels(values));
  return labels;
}

function sortLabels(values: string[]): string[] {
  const order = ['Principal', 'Aspirantes'];
  return [...values].sort((a, b) => {
    const ia = order.indexOf(a);
    const ib = order.indexOf(b);
    return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib) || a.localeCompare(b, 'pt-BR');
  });
}

export type TeamViewResult = { teams: Team[]; edition: CurrentEdition | null };

/** Teams shown in a view (each team at most once, in the given order). */
export function teamsForView(teams: Team[], links: ParticipationLink[], view: TeamView): TeamViewResult {
  const { category } = viewDefinition(view);
  if (category === null) return { teams, edition: null };
  const edition = currentEdition(links, category);
  if (!edition) return { teams: [], edition: null };
  const ids = new Set(links.filter((link) => link.seasonId === edition.seasonId).map((link) => link.teamId));
  return { teams: teams.filter((team) => ids.has(team.id)), edition };
}

type Relation<T> = T | T[] | null | undefined;
const one = <T,>(value: Relation<T>): T | null => (Array.isArray(value) ? value[0] ?? null : value ?? null);

type RawCompetition = { id: string; name: string; category: string; status: Competition['status']; created_at: string };
type RawSeason = { id: string; name: string; created_at: string; competitions: Relation<RawCompetition> };
export type RawParticipationRow = { team_id: string; season_id: string; seasons: Relation<RawSeason> };

/** Normalizes season_teams rows with their season and competition (embedded by PostgREST). */
export function linksFromRows(rows: RawParticipationRow[]): ParticipationLink[] {
  const links: ParticipationLink[] = [];
  for (const row of rows) {
    const season = one(row.seasons);
    const competition = one(season?.competitions);
    if (!season || !competition) continue;
    links.push({
      teamId: row.team_id,
      seasonId: season.id,
      seasonName: season.name,
      seasonCreatedAt: season.created_at,
      competition: { id: competition.id, name: competition.name, category: competition.category, status: competition.status, createdAt: competition.created_at },
    });
  }
  return links;
}
