import { useEffect, useState } from 'react';
import { supabase, type Competition, type Season, type Team, type Player, type SeasonTeam, type Roster, type Stage, type Round, type Match, type MatchEvent, type GoalkeeperParticipation, type Streamer } from './supabase';
import { useAdminDataVersion } from './adminRefresh';
import { useAuth } from './auth';
import { linksFromRows, type ParticipationLink, type RawParticipationRow } from './teamCategories';

export function useCompetitions() {
  const [competitions, setCompetitions] = useState<Competition[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const refreshVersion = useAdminDataVersion();
  useEffect(() => {
    let active = true;
    setLoading(true);
    supabase.from('competitions').select('id, name, description, category, format, max_teams, registration_starts_at, registration_ends_at, status').order('created_at', { ascending: true }).then(({ data, error: queryError }) => {
      if (active) {
        setError(Boolean(queryError));
        setCompetitions(queryError ? [] : (data || []) as Competition[]);
        setLoading(false);
      }
    });
    return () => { active = false; };
  }, [refreshVersion]);
  return { competitions, loading, error };
}

export function useManagedCompetitions() {
  const { competitions, loading: competitionsLoading, error: competitionsError } = useCompetitions();
  const { profile } = useAuth();
  const isOrganizer = profile?.role === 'ORGANIZER';
  const [managedIds, setManagedIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(isOrganizer);
  const [error, setError] = useState(false);
  const idsKey = competitions.map((competition) => competition.id).join(',');
  const refreshVersion = useAdminDataVersion();

  useEffect(() => {
    if (!isOrganizer) {
      setManagedIds([]);
      setLoading(false);
      setError(false);
      return;
    }
    const ids = idsKey ? idsKey.split(',') : [];
    if (!ids.length) {
      setManagedIds([]);
      setLoading(false);
      setError(false);
      return;
    }
    let active = true;
    setLoading(true);
    setError(false);
    Promise.all(ids.map((competitionId) =>
      supabase.rpc('can_manage_competition', { p_competition_id: competitionId }),
    )).then((results) => {
      if (!active) return;
      if (results.some((result) => result.error)) {
        setManagedIds([]);
        setError(true);
      } else {
        setManagedIds(ids.filter((_, index) => results[index].data === true));
      }
      setLoading(false);
    });
    return () => { active = false; };
  }, [idsKey, isOrganizer, refreshVersion]);

  const managedCompetitions = profile?.role === 'ADMIN'
    ? competitions
    : isOrganizer
      ? competitions.filter((competition) => managedIds.includes(competition.id))
      : [];

  return {
    competitions: managedCompetitions,
    loading: competitionsLoading || (isOrganizer && loading),
    error: competitionsError || (isOrganizer && error),
  };
}

export function useSeasons(competitionId?: string, includeAll = false) {
  const [seasons, setSeasons] = useState<Season[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const refreshVersion = useAdminDataVersion();
  useEffect(() => {
    let active = true;
    if (!competitionId && !includeAll) {
      setSeasons([]);
      setLoading(false);
      setError(false);
      return () => { active = false; };
    }
    setLoading(true);
    let q = supabase.from('seasons').select('id, competition_id, name, starts_at, ends_at').order('created_at', { ascending: false });
    if (competitionId) q = q.eq('competition_id', competitionId);
    q.then(({ data, error: queryError }) => {
      if (active) {
        setError(Boolean(queryError));
        setSeasons(queryError ? [] : (data || []) as Season[]);
        setLoading(false);
      }
    });
    return () => { active = false; };
  }, [competitionId, includeAll, refreshVersion]);
  return { seasons, loading, error };
}

export function useTeams() {
  const [teams, setTeams] = useState<Team[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const refreshVersion = useAdminDataVersion();
  useEffect(() => {
    let active = true;
    setLoading(true);
    supabase.from('teams').select('id, name, logo_url').order('name', { ascending: true }).then(({ data, error: queryError }) => {
      if (active) {
        setError(Boolean(queryError));
        setTeams(queryError ? [] : (data || []) as Team[]);
        setLoading(false);
      }
    });
    return () => { active = false; };
  }, [refreshVersion]);
  return { teams, loading, error };
}

// Which season (and competition) each team takes part in: season_teams with
// its season and competition embedded. Draft competitions are hidden from the
// public by RLS, so they never show up here for visitors.
export function useTeamParticipation() {
  const [links, setLinks] = useState<ParticipationLink[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const refreshVersion = useAdminDataVersion();
  useEffect(() => {
    let active = true;
    setLoading(true);
    supabase.from('season_teams')
      .select('team_id, season_id, seasons!inner(id, name, created_at, competitions!inner(id, name, category, status, created_at))')
      .then(({ data, error: queryError }) => {
        if (!active) return;
        setError(Boolean(queryError));
        setLinks(queryError ? [] : linksFromRows((data || []) as unknown as RawParticipationRow[]));
        setLoading(false);
      });
    return () => { active = false; };
  }, [refreshVersion]);
  return { links, loading, error };
}

export function usePlayers() {
  const [players, setPlayers] = useState<Player[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const refreshVersion = useAdminDataVersion();
  useEffect(() => {
    let active = true;
    setLoading(true);
    supabase.from('players').select('id, nickname, full_name, photo_url, nationality, position').order('nickname', { ascending: true }).then(({ data, error: queryError }) => {
      if (active) {
        setError(Boolean(queryError));
        setPlayers(queryError ? [] : (data || []) as Player[]);
        setLoading(false);
      }
    });
    return () => { active = false; };
  }, [refreshVersion]);
  return { players, loading, error };
}

export function useSeasonTeams(seasonId?: string) {
  const [seasonTeams, setSeasonTeams] = useState<SeasonTeam[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const refreshVersion = useAdminDataVersion();
  useEffect(() => {
    let active = true;
    if (!seasonId) {
      setSeasonTeams([]);
      setLoading(false);
      setError(false);
      return () => { active = false; };
    }
    setLoading(true);
    let q = supabase.from('season_teams').select('id, season_id, team_id, team:team_id ( id, name, logo_url )').order('created_at', { ascending: true });
    q = q.eq('season_id', seasonId);
    q.then(({ data, error: queryError }) => {
      if (active) {
        setError(Boolean(queryError));
        setSeasonTeams(queryError ? [] : (data || []) as unknown as SeasonTeam[]);
        setLoading(false);
      }
    });
    return () => { active = false; };
  }, [seasonId, refreshVersion]);
  return { seasonTeams, loading, error };
}

export function useRosters(seasonTeamId?: string) {
  const [rosters, setRosters] = useState<Roster[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const refreshVersion = useAdminDataVersion();
  useEffect(() => {
    let active = true;
    if (!seasonTeamId) {
      setRosters([]);
      setLoading(false);
      setError(false);
      return () => { active = false; };
    }
    setLoading(true);
    let q = supabase.from('rosters').select('id, season_team_id, player_id, shirt_number, player:player_id ( id, nickname, full_name, photo_url, nationality, position )').order('shirt_number', { ascending: true });
    q = q.eq('season_team_id', seasonTeamId);
    q.then(({ data, error: queryError }) => {
      if (active) {
        setError(Boolean(queryError));
        setRosters(queryError ? [] : (data || []) as unknown as Roster[]);
        setLoading(false);
      }
    });
    return () => { active = false; };
  }, [seasonTeamId, refreshVersion]);
  return { rosters, loading, error };
}

export function useStages(seasonId?: string) {
  const [stages, setStages] = useState<Stage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const refreshVersion = useAdminDataVersion();
  useEffect(() => {
    let active = true;
    if (!seasonId) {
      setStages([]);
      setLoading(false);
      setError(false);
      return () => { active = false; };
    }
    setLoading(true);
    let q = supabase.from('stages').select('id, season_id, name, stage_order, format, tie_breakers, settings').order('stage_order', { ascending: true });
    q = q.eq('season_id', seasonId);
    q.then(({ data, error: queryError }) => {
      if (active) {
        setError(Boolean(queryError));
        setStages(queryError ? [] : (data || []) as Stage[]);
        setLoading(false);
      }
    });
    return () => { active = false; };
  }, [seasonId, refreshVersion]);
  return { stages, loading, error };
}

export function useRounds(stageId?: string, includeAll = false) {
  const [rounds, setRounds] = useState<Round[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const refreshVersion = useAdminDataVersion();
  useEffect(() => {
    let active = true;
    if (!stageId && !includeAll) {
      setRounds([]);
      setLoading(false);
      setError(false);
      return () => { active = false; };
    }
    setLoading(true);
    let q = supabase.from('rounds').select('id, stage_id, name, round_order, phase_type, stage_group_id, leg_number, bracket_round, stage_group:stage_group_id ( id, name, group_order )').order('round_order', { ascending: true });
    if (stageId) q = q.eq('stage_id', stageId);
    q.then(({ data, error: queryError }) => {
      if (active) {
        setError(Boolean(queryError));
        setRounds(queryError ? [] : (data || []) as unknown as Round[]);
        setLoading(false);
      }
    });
    return () => { active = false; };
  }, [stageId, includeAll, refreshVersion]);
  return { rounds, loading, error };
}

const MATCH_SELECT = 'id, round_id, home_team_id, away_team_id, scheduled_at, duration_seconds, home_score, away_score, home_penalty_score, away_penalty_score, status, series_id, series_leg, home_source_match_id, home_source_outcome, away_source_match_id, away_source_outcome, home_team:home_team_id ( id, season_id, team_id, team:team_id ( id, name, logo_url ) ), away_team:away_team_id ( id, season_id, team_id, team:team_id ( id, name, logo_url ) ), round:round_id ( id, stage_id, name, round_order, phase_type, stage_group_id, leg_number, bracket_round, stage_group:stage_group_id ( id, name, group_order ), stage:stage_id ( id, season_id, name, season:season_id ( id, name, competition_id, competition:competition_id ( id, name ) ) ) )';

export function useMatches(roundId?: string) {
  const [matches, setMatches] = useState<Match[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const refreshVersion = useAdminDataVersion();
  useEffect(() => {
    let active = true;
    if (!roundId) {
      setMatches([]);
      setLoading(false);
      setError(false);
      return () => { active = false; };
    }
    setLoading(true);
    let q = supabase.from('matches').select(MATCH_SELECT).order('scheduled_at', { ascending: true });
    q = q.eq('round_id', roundId);
    q.then(({ data, error: queryError }) => {
      if (active) {
        setError(Boolean(queryError));
        setMatches(queryError ? [] : (data || []) as unknown as Match[]);
        setLoading(false);
      }
    });
    return () => { active = false; };
  }, [roundId, refreshVersion]);
  return { matches, loading, error };
}

// Every match of every round of one stage (admin rounds overview).
export function useStageMatches(roundIds: string[]) {
  const [matches, setMatches] = useState<Match[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const refreshVersion = useAdminDataVersion();
  const key = roundIds.join(',');
  useEffect(() => {
    let active = true;
    const ids = key ? key.split(',') : [];
    if (ids.length === 0) {
      setMatches([]);
      setLoading(false);
      setError(false);
      return () => { active = false; };
    }
    setLoading(true);
    supabase.from('matches').select(MATCH_SELECT).in('round_id', ids).then(({ data, error: queryError }) => {
      if (active) {
        setError(Boolean(queryError));
        setMatches(queryError ? [] : (data || []) as unknown as Match[]);
        setLoading(false);
      }
    });
    return () => { active = false; };
  }, [key, refreshVersion]);
  return { matches, loading, error };
}

export function useMatchEvents(matchId?: string) {
  const [events, setEvents] = useState<MatchEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const refreshVersion = useAdminDataVersion();
  useEffect(() => {
    let active = true;
    if (!matchId) {
      setEvents([]);
      setLoading(false);
      setError(false);
      return () => { active = false; };
    }
    setLoading(true);
    let q = supabase.from('match_events').select('id, match_id, event_type, period, is_own_goal, goal_event_id, minute_seconds, team_id, player_id, related_player_id, metadata, player:player_id ( id, nickname, full_name, photo_url, nationality, position ), related_player:related_player_id ( id, nickname ), team:team_id ( id, season_id, team_id, team:team_id ( id, name, logo_url ) )').order('minute_seconds', { ascending: true });
    q = q.eq('match_id', matchId);
    q.then(({ data, error: queryError }) => {
      if (active) {
        setError(Boolean(queryError));
        setEvents(queryError ? [] : (data || []) as unknown as MatchEvent[]);
        setLoading(false);
      }
    });
    return () => { active = false; };
  }, [matchId, refreshVersion]);
  return { events, loading, error };
}

// Public match page: the match itself must load even when the visitor cannot
// read seasons/competitions, so the competition breadcrumb is fetched apart and
// simply omitted if that read fails.
const PUBLIC_MATCH_SELECT = MATCH_SELECT.replace(/, stage:stage_id \( .* \) \) \) \)$/, ' )');

export function useMatch(matchId?: string) {
  const [match, setMatch] = useState<Match | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const refreshVersion = useAdminDataVersion();
  useEffect(() => {
    if (!matchId) { setMatch(null); setLoading(false); setError(false); return; }
    let active = true;
    setLoading(true);
    (async () => {
      const { data, error: queryError } = await supabase.from('matches').select(PUBLIC_MATCH_SELECT).eq('id', matchId).maybeSingle();
      const row = (data as unknown as (Match & { round?: Match['round'] & { stage?: unknown } }) | null) ?? null;
      if (!queryError && row?.round?.stage_id) {
        const { data: stage } = await supabase.from('stages').select('id, season_id, name, season:season_id ( id, name, competition_id, competition:competition_id ( id, name ) )').eq('id', row.round.stage_id).maybeSingle();
        if (stage) row.round.stage = stage;
      }
      if (!active) return;
      setError(Boolean(queryError));
      setMatch(queryError ? null : row);
      setLoading(false);
    })();
    return () => { active = false; };
  }, [matchId, refreshVersion]);
  return { match, loading, error };
}

export type GoalkeeperSpellRow = GoalkeeperParticipation & {
  player: Player | null;
  team: SeasonTeam | null;
  match: { status: Match['status']; duration_seconds: number | null } | null;
};

export function useGoalkeeperParticipations(matchIds: string[]) {
  const key = matchIds.join(',');
  const [spells, setSpells] = useState<GoalkeeperSpellRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const refreshVersion = useAdminDataVersion();
  useEffect(() => {
    const ids = key ? key.split(',') : [];
    if (ids.length === 0) { setSpells([]); setLoading(false); setError(false); return; }
    let active = true;
    setLoading(true);
    supabase.from('goalkeeper_participations').select('id, match_id, team_id, player_id, started_at_seconds, ended_at_seconds, first_conceded_at_seconds, source_event_id, exit_event_id, player:player_id ( id, nickname, photo_url, position ), team:team_id ( id, team:team_id ( id, name, logo_url ) ), match:match_id ( status, duration_seconds )').in('match_id', ids).then(({ data, error: err }) => {
      if (!active) return;
      setError(Boolean(err));
      setSpells(err ? [] : ((data || []) as unknown as GoalkeeperSpellRow[]));
      setLoading(false);
    });
    return () => { active = false; };
  }, [key, refreshVersion]);
  return { spells, loading, error };
}

export type LiveStream = {
  key: string;
  streamer: Streamer;
  matchId: string;
  homeName: string;
  awayName: string;
  homeScore: number | null;
  awayScore: number | null;
};

type LiveMatchRow = {
  id: string;
  home_score: number | null;
  away_score: number | null;
  home_team: { team: { name: string } | null } | null;
  away_team: { team: { name: string } | null } | null;
  match_streamers: { streamer: Streamer | null }[];
};

const LIVE_REFRESH_MS = 60000;

export function useLiveStreams() {
  const [streams, setStreams] = useState<LiveStream[]>([]);
  useEffect(() => {
    let active = true;
    const load = () => {
      supabase.from('matches').select('id, home_score, away_score, home_team:home_team_id ( team:team_id ( name ) ), away_team:away_team_id ( team:team_id ( name ) ), match_streamers ( streamer:streamer_id ( id, display_name, platform, channel ) )').eq('status', 'LIVE').then(({ data, error }) => {
        if (!active || error) return;
        const rows = (data || []) as unknown as LiveMatchRow[];
        setStreams(rows.flatMap((row) => row.match_streamers
          .filter((link) => link.streamer)
          .map((link) => ({
            key: `${row.id}-${link.streamer!.id}`,
            streamer: link.streamer!,
            matchId: row.id,
            homeName: row.home_team?.team?.name || '—',
            awayName: row.away_team?.team?.name || '—',
            homeScore: row.home_score,
            awayScore: row.away_score,
          }))));
      });
    };
    load();
    const timer = window.setInterval(load, LIVE_REFRESH_MS);
    return () => { active = false; window.clearInterval(timer); };
  }, []);
  return { streams };
}
