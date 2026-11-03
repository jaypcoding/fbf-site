import { useEffect, useState } from 'react';
import { supabase, type Competition, type Season, type Team, type Player, type SeasonTeam, type Roster, type Stage, type Round, type Match, type MatchEvent, type GoalkeeperParticipation, type Streamer } from './supabase';

export function useCompetitions() {
  const [competitions, setCompetitions] = useState<Competition[]>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let active = true;
    supabase.from('competitions').select('id, name, description, category, format, max_teams, registration_starts_at, registration_ends_at, status').order('created_at', { ascending: true }).then(({ data }) => {
      if (active) { setCompetitions((data || []) as Competition[]); setLoading(false); }
    });
    return () => { active = false; };
  }, []);
  return { competitions, loading };
}

export function useSeasons(competitionId?: string) {
  const [seasons, setSeasons] = useState<Season[]>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let active = true;
    let q = supabase.from('seasons').select('id, competition_id, name, starts_at, ends_at').order('created_at', { ascending: false });
    if (competitionId) q = q.eq('competition_id', competitionId);
    q.then(({ data }) => { if (active) { setSeasons((data || []) as Season[]); setLoading(false); } });
    return () => { active = false; };
  }, [competitionId]);
  return { seasons, loading };
}

export function useTeams() {
  const [teams, setTeams] = useState<Team[]>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let active = true;
    supabase.from('teams').select('id, name, logo_url').order('name', { ascending: true }).then(({ data }) => {
      if (active) { setTeams((data || []) as Team[]); setLoading(false); }
    });
    return () => { active = false; };
  }, []);
  return { teams, loading };
}

export function usePlayers() {
  const [players, setPlayers] = useState<Player[]>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let active = true;
    supabase.from('players').select('id, nickname, full_name, photo_url, nationality, position').order('nickname', { ascending: true }).then(({ data }) => {
      if (active) { setPlayers((data || []) as Player[]); setLoading(false); }
    });
    return () => { active = false; };
  }, []);
  return { players, loading };
}

export function useSeasonTeams(seasonId?: string) {
  const [seasonTeams, setSeasonTeams] = useState<SeasonTeam[]>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let active = true;
    let q = supabase.from('season_teams').select('id, season_id, team_id, team:team_id ( id, name, logo_url )').order('created_at', { ascending: true });
    if (seasonId) q = q.eq('season_id', seasonId);
    q.then(({ data }) => { if (active) { setSeasonTeams((data || []) as unknown as SeasonTeam[]); setLoading(false); } });
    return () => { active = false; };
  }, [seasonId]);
  return { seasonTeams, loading };
}

export function useRosters(seasonTeamId?: string) {
  const [rosters, setRosters] = useState<Roster[]>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let active = true;
    let q = supabase.from('rosters').select('id, season_team_id, player_id, shirt_number, player:player_id ( id, nickname, full_name, photo_url, nationality, position )').order('shirt_number', { ascending: true });
    if (seasonTeamId) q = q.eq('season_team_id', seasonTeamId);
    q.then(({ data }) => { if (active) { setRosters((data || []) as unknown as Roster[]); setLoading(false); } });
    return () => { active = false; };
  }, [seasonTeamId]);
  return { rosters, loading };
}

export function useStages(seasonId?: string) {
  const [stages, setStages] = useState<Stage[]>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let active = true;
    let q = supabase.from('stages').select('id, season_id, name, stage_order, format, tie_breakers').order('stage_order', { ascending: true });
    if (seasonId) q = q.eq('season_id', seasonId);
    q.then(({ data }) => { if (active) { setStages((data || []) as Stage[]); setLoading(false); } });
    return () => { active = false; };
  }, [seasonId]);
  return { stages, loading };
}

export function useRounds(stageId?: string) {
  const [rounds, setRounds] = useState<Round[]>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let active = true;
    let q = supabase.from('rounds').select('id, stage_id, name, round_order').order('round_order', { ascending: true });
    if (stageId) q = q.eq('stage_id', stageId);
    q.then(({ data }) => { if (active) { setRounds((data || []) as Round[]); setLoading(false); } });
    return () => { active = false; };
  }, [stageId]);
  return { rounds, loading };
}

const MATCH_SELECT = 'id, round_id, home_team_id, away_team_id, scheduled_at, duration_seconds, home_score, away_score, home_penalty_score, away_penalty_score, status, home_team:home_team_id ( id, season_id, team_id, team:team_id ( id, name, logo_url ) ), away_team:away_team_id ( id, season_id, team_id, team:team_id ( id, name, logo_url ) ), round:round_id ( id, stage_id, name, round_order, stage:stage_id ( id, season_id, name, season:season_id ( id, name, competition_id, competition:competition_id ( id, name ) ) ) )';

export function useMatches(roundId?: string) {
  const [matches, setMatches] = useState<Match[]>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let active = true;
    let q = supabase.from('matches').select(MATCH_SELECT).order('scheduled_at', { ascending: true });
    if (roundId) q = q.eq('round_id', roundId);
    q.then(({ data }) => { if (active) { setMatches((data || []) as unknown as Match[]); setLoading(false); } });
    return () => { active = false; };
  }, [roundId]);
  return { matches, loading };
}

export function useMatchEvents(matchId?: string) {
  const [events, setEvents] = useState<MatchEvent[]>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let active = true;
    let q = supabase.from('match_events').select('id, match_id, event_type, period, is_own_goal, goal_event_id, minute_seconds, team_id, player_id, related_player_id, player:player_id ( id, nickname, full_name, photo_url, nationality, position ), related_player:related_player_id ( id, nickname ), team:team_id ( id, season_id, team_id, team:team_id ( id, name, logo_url ) )').order('minute_seconds', { ascending: true });
    if (matchId) q = q.eq('match_id', matchId);
    q.then(({ data }) => { if (active) { setEvents((data || []) as unknown as MatchEvent[]); setLoading(false); } });
    return () => { active = false; };
  }, [matchId]);
  return { events, loading };
}

export function useMatch(matchId?: string) {
  const [match, setMatch] = useState<Match | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    if (!matchId) { setLoading(false); return; }
    let active = true;
    setLoading(true);
    supabase.from('matches').select(MATCH_SELECT).eq('id', matchId).maybeSingle().then(({ data, error }) => {
      if (!active) return;
      setMatch(error ? null : ((data as unknown as Match | null) ?? null));
      setLoading(false);
    });
    return () => { active = false; };
  }, [matchId]);
  return { match, loading };
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
  }, [key]);
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
