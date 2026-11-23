// Public profile of a player. Every number comes from the official views
// (player_match_stats, match_mvp_scores, goalkeeper_clean_sheet_statistics);
// this module only groups them for display. A handful of queries for the
// whole page (no query per match).
import { useEffect, useState } from 'react';
import { supabase, type Player } from '@/lib/supabase';
import { one } from '@/lib/relations';
import { FEATURE_MVP } from '@/lib/features';
import { bySeason, summarize, type ProfileMatchRow, type SeasonLine, type Totals } from '@/lib/stats/profile';

export type { ProfileMatchRow, SeasonLine, Totals };

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type MatchInfo = {
  id: string; scheduled_at: string | null; home_score: number | null; away_score: number | null;
  home_penalty_score: number | null; away_penalty_score: number | null;
  round: { name: string; stage: { name: string; season: { id: string; name: string; competition: { id: string; name: string } | null } | null } | null } | null;
  home_team: { team: { id: string; name: string; logo_url: string | null } | null } | null;
  away_team: { team: { id: string; name: string; logo_url: string | null } | null } | null;
};
type RosterRow = { shirt_number: number | null; season_team: { id: string; season_id: string; created_at: string; team: { id: string; name: string; logo_url: string | null } | null } | null };

export type ProfileMatch = ProfileMatchRow & {
  competitionName: string; seasonName: string; roundName: string; stageName: string;
  teamName: string; teamLogo: string | null; opponentName: string; opponentLogo: string | null; opponentTeamId: string | null;
  teamScore: number | null; opponentScore: number | null; penalties: string | null; mvp: boolean; mvpPoints: number | null;
};
export type TeamSpell = { seasonTeamId: string; teamId: string; teamName: string; teamLogo: string | null; seasonId: string; seasonName: string; competitionName: string; shirt: number | null; matches: number; createdAt: string };
export type KeeperLine = { games: number; clean_sheets: number; total_seconds: number };

export type PlayerProfile = {
  player: Player & { slug?: string | null };
  matches: ProfileMatch[];
  seasons: SeasonLine[];
  totals: Totals;
  teams: TeamSpell[];
  keeper: KeeperLine | null;
  incomplete: { teamName: string; matches: number }[];
  names: { competitions: Record<string, string>; seasons: Record<string, string>; teams: Record<string, { name: string; logo: string | null }> };
};

export function usePlayerProfile(idOrSlug?: string, refreshVersion = 0) {
  const [state, setState] = useState<{ loading: boolean; error: boolean; profile: PlayerProfile | null }>({ loading: true, error: false, profile: null });
  useEffect(() => {
    let active = true;
    setState({ loading: true, error: false, profile: null });
    if (!idOrSlug) { setState({ loading: false, error: false, profile: null }); return () => { active = false; }; }
    (async () => {
      const column = UUID_RE.test(idOrSlug) ? 'id' : 'slug';
      const { data: player, error } = await supabase.from('players').select('id, nickname, full_name, photo_url, nationality, position, slug').eq(column, column === 'slug' ? idOrSlug.toLowerCase() : idOrSlug).maybeSingle();
      if (!active) return;
      if (error) { setState({ loading: false, error: true, profile: null }); return; }
      if (!player) { setState({ loading: false, error: false, profile: null }); return; }
      const pid = (player as { id: string }).id;
      const [statsRes, mvpRes, rosterRes, keeperRes] = await Promise.all([
        supabase.from('player_match_stats').select('match_id, competition_id, season_id, team_id, season_team_id, side, result, goals, assists, own_goals, was_goalkeeper, in_lineup, scheduled_at').eq('player_id', pid),
        FEATURE_MVP ? supabase.from('match_mvp_scores').select('match_id, total, is_mvp').eq('player_id', pid) : Promise.resolve({ data: [], error: null }),
        supabase.from('rosters').select('shirt_number, season_team:season_team_id ( id, season_id, created_at, team:team_id ( id, name, logo_url ) )').eq('player_id', pid),
        supabase.from('goalkeeper_clean_sheet_statistics').select('games, clean_sheets, total_seconds').eq('player_id', pid),
      ]);
      if (!active) return;
      if (statsRes.error) { setState({ loading: false, error: true, profile: null }); return; }
      const rows = (statsRes.data ?? []) as ProfileMatchRow[];
      const mvpRows = ((mvpRes.data ?? []) as { match_id: string; total: number; is_mvp: boolean }[]);
      const mvpMatches = new Set(mvpRows.filter((m) => m.is_mvp).map((m) => m.match_id));
      const mvpPoints = new Map(mvpRows.map((m) => [m.match_id, m.total]));
      const rosters = ((rosterRes.data ?? []) as unknown as RosterRow[]).map((r) => ({ shirt: r.shirt_number, st: one(r.season_team) })).filter((r) => r.st && one(r.st.team));

      const matchIds = rows.map((r) => r.match_id);
      const seasonIds = [...new Set([...rows.map((r) => r.season_id), ...rosters.map((r) => r.st!.season_id)])];
      const rosterSeasonTeams = rosters.map((r) => r.st!.id);
      const [matchRes, seasonRes, lineupRes] = await Promise.all([
        matchIds.length ? supabase.from('matches').select('id, scheduled_at, home_score, away_score, home_penalty_score, away_penalty_score, round:round_id ( name, stage:stage_id ( name, season:season_id ( id, name, competition:competition_id ( id, name ) ) ) ), home_team:home_team_id ( team:team_id ( id, name, logo_url ) ), away_team:away_team_id ( team:team_id ( id, name, logo_url ) )').in('id', matchIds) : Promise.resolve({ data: [], error: null }),
        seasonIds.length ? supabase.from('seasons').select('id, name, competition:competition_id ( id, name )').in('id', seasonIds) : Promise.resolve({ data: [], error: null }),
        rosterSeasonTeams.length ? supabase.from('team_match_lineups').select('match_id, season_team_id').in('season_team_id', rosterSeasonTeams).eq('lineup_registered', false) : Promise.resolve({ data: [], error: null }),
      ]);
      if (!active) return;
      const infos = new Map(((matchRes.data ?? []) as unknown as MatchInfo[]).map((m) => [m.id, m]));
      const seasons = new Map(((seasonRes.data ?? []) as unknown as { id: string; name: string; competition: { id: string; name: string } | null }[]).map((s) => [s.id, s]));
      const competitions: Record<string, string> = {};
      const seasonNames: Record<string, string> = {};
      for (const s of seasons.values()) { seasonNames[s.id] = s.name; const c = one(s.competition); if (c) competitions[c.id] = c.name; }
      const teams: Record<string, { name: string; logo: string | null }> = {};
      for (const r of rosters) { const t = one(r.st!.team)!; teams[t.id] = { name: t.name, logo: t.logo_url }; }

      const matches: ProfileMatch[] = rows.map((r) => {
        const m = infos.get(r.match_id);
        const mine = r.side === 'home' ? one(m?.home_team ?? null) : one(m?.away_team ?? null);
        const other = r.side === 'home' ? one(m?.away_team ?? null) : one(m?.home_team ?? null);
        const myTeam = one(mine?.team ?? null); const otherTeam = one(other?.team ?? null);
        if (myTeam) teams[myTeam.id] = { name: myTeam.name, logo: myTeam.logo_url };
        const round = one(m?.round ?? null); const stage = one(round?.stage ?? null); const season = one(stage?.season ?? null); const comp = one(season?.competition ?? null);
        if (comp) competitions[comp.id] = comp.name;
        if (season) seasonNames[season.id] = season.name;
        const pen = m && m.home_penalty_score !== null && m.away_penalty_score !== null
          ? (r.side === 'home' ? `${m.home_penalty_score}–${m.away_penalty_score}` : `${m.away_penalty_score}–${m.home_penalty_score}`) : null;
        return {
          ...r,
          competitionName: comp?.name ?? '', seasonName: season?.name ?? '', roundName: round?.name ?? '', stageName: stage?.name ?? '',
          teamName: myTeam?.name ?? '—', teamLogo: myTeam?.logo_url ?? null, opponentName: otherTeam?.name ?? '—', opponentLogo: otherTeam?.logo_url ?? null, opponentTeamId: otherTeam?.id ?? null,
          teamScore: m ? (r.side === 'home' ? m.home_score : m.away_score) : null,
          opponentScore: m ? (r.side === 'home' ? m.away_score : m.home_score) : null,
          penalties: pen, mvp: mvpMatches.has(r.match_id), mvpPoints: mvpPoints.get(r.match_id) ?? null,
        };
      }).sort((a, b) => (b.scheduled_at ? Date.parse(b.scheduled_at) : 0) - (a.scheduled_at ? Date.parse(a.scheduled_at) : 0));

      // matches of his teams with no lineup in which he has no proven participation
      const played = new Set(matchIds);
      const missing = new Map<string, number>();
      for (const l of (lineupRes.data ?? []) as { match_id: string; season_team_id: string }[]) {
        if (played.has(l.match_id)) continue;
        missing.set(l.season_team_id, (missing.get(l.season_team_id) ?? 0) + 1);
      }
      const teamSpells: TeamSpell[] = rosters.map((r) => {
        const st = r.st!; const t = one(st.team)!; const s = seasons.get(st.season_id);
        return {
          seasonTeamId: st.id, teamId: t.id, teamName: t.name, teamLogo: t.logo_url, seasonId: st.season_id,
          seasonName: s?.name ?? '', competitionName: one(s?.competition ?? null)?.name ?? '', shirt: r.shirt,
          matches: rows.filter((x) => x.season_team_id === st.id).length, createdAt: st.created_at,
        };
      });
      // teams he played for without being in the roster any more (history is kept)
      for (const r of rows) {
        if (teamSpells.some((t) => t.seasonTeamId === r.season_team_id)) continue;
        const m = matches.find((x) => x.season_team_id === r.season_team_id)!;
        teamSpells.push({ seasonTeamId: r.season_team_id, teamId: r.team_id, teamName: m.teamName, teamLogo: m.teamLogo, seasonId: r.season_id, seasonName: m.seasonName, competitionName: m.competitionName, shirt: null, matches: rows.filter((x) => x.season_team_id === r.season_team_id).length, createdAt: r.scheduled_at ?? '' });
      }
      teamSpells.sort((a, b) => Date.parse(b.createdAt || '0') - Date.parse(a.createdAt || '0'));
      const incomplete = [...missing.entries()].map(([st, n]) => ({ teamName: teamSpells.find((t) => t.seasonTeamId === st)?.teamName ?? 'sua equipe', matches: n }));
      const keeperRows = (keeperRes.data ?? []) as KeeperLine[];
      const keeper = keeperRows.length ? keeperRows.reduce((acc, k) => ({ games: acc.games + k.games, clean_sheets: acc.clean_sheets + k.clean_sheets, total_seconds: acc.total_seconds + k.total_seconds }), { games: 0, clean_sheets: 0, total_seconds: 0 }) : null;

      setState({
        loading: false, error: false,
        profile: { player: player as PlayerProfile['player'], matches, seasons: bySeason(rows, mvpMatches), totals: summarize(rows, mvpMatches), teams: teamSpells, keeper, incomplete, names: { competitions, seasons: seasonNames, teams } },
      });
    })();
    return () => { active = false; };
  }, [idOrSlug, refreshVersion]);
  return state;
}
