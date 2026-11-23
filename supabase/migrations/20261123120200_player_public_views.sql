/*
# Shared public views for profiles, rankings and the comparator (Phase 1)

Read-only views over the official data (no new source of truth, nothing
stored). All use security_invoker, so the existing RLS applies.

- player_match_participation: one row per player per finished match in which
  his participation is PROVEN: lineup (match_participations), official goals or
  assists, or goalkeeper records. The team comes from the official events or
  goalkeeper records when they exist, otherwise from the lineup; a match can
  never be counted twice for a player.
- player_match_stats: the same rows with the player's goals, assists and own
  goals in the match (exactly the rules of player_competition_statistics) and
  the result for his team (regulation score; a decision on penalties is a draw).
- player_season_summary: totals per player × competition × season × club.
- team_match_lineups: whether each team of each finished match has a lineup.
*/

CREATE OR REPLACE VIEW public.player_match_participation
WITH (security_invoker = true) AS
WITH evidence AS (
  SELECT mp.match_id, mp.player_id, mp.season_team_id, mp.seconds_played, true AS lineup, false AS events, false AS keeper
  FROM public.match_participations mp
  UNION ALL
  SELECT e.match_id, e.player_id, e.team_id, NULL::integer, false, true, false
  FROM public.match_events e
  WHERE e.player_id IS NOT NULL AND e.event_type IN ('GOAL', 'ASSIST')
  UNION ALL
  SELECT gp.match_id, gp.player_id, gp.team_id, NULL::integer, false, false, true
  FROM public.goalkeeper_participations gp
), per_player AS (
  SELECT ev.match_id, ev.player_id,
    COALESCE(
      (array_agg(ev.season_team_id ORDER BY ev.season_team_id) FILTER (WHERE ev.events OR ev.keeper))[1],
      (array_agg(ev.season_team_id ORDER BY ev.season_team_id))[1]
    ) AS season_team_id,
    max(ev.seconds_played) AS seconds_played,
    bool_or(ev.lineup) AS in_lineup,
    bool_or(ev.events) AS has_events,
    bool_or(ev.keeper) AS was_goalkeeper
  FROM evidence ev
  GROUP BY ev.match_id, ev.player_id
)
SELECT pp.match_id, pp.player_id, pp.season_team_id, st.team_id,
  s.competition_id, s.id AS season_id, stg.id AS stage_id, r.id AS round_id,
  CASE WHEN pp.season_team_id = m.home_team_id THEN 'home' ELSE 'away' END AS side,
  CASE WHEN pp.season_team_id = m.home_team_id THEN m.away_team_id ELSE m.home_team_id END AS opponent_season_team_id,
  pp.seconds_played, pp.in_lineup, pp.has_events, pp.was_goalkeeper,
  m.scheduled_at, m.score_source
FROM per_player pp
JOIN public.matches m ON m.id = pp.match_id
JOIN public.season_teams st ON st.id = pp.season_team_id
JOIN public.rounds r ON r.id = m.round_id
JOIN public.stages stg ON stg.id = r.stage_id
JOIN public.seasons s ON s.id = stg.season_id
WHERE m.status = 'FINISHED'
  AND pp.season_team_id IN (m.home_team_id, m.away_team_id);

COMMENT ON VIEW public.player_match_participation IS 'Proven participation (lineup, official goals/assists or goalkeeper records) in finished matches; one row per player per match.';

CREATE OR REPLACE VIEW public.player_match_stats
WITH (security_invoker = true) AS
WITH official_matches AS (
  -- the same matches counted by player_competition_statistics
  SELECT m.id FROM public.matches m
  WHERE m.status = 'FINISHED' AND m.home_score IS NOT NULL AND m.away_score IS NOT NULL AND m.score_source = 'EVENTS'
), event_totals AS (
  SELECT e.match_id, e.player_id,
    count(*) FILTER (WHERE e.event_type = 'GOAL' AND NOT e.is_own_goal AND e.period <> 'PENALTY_SHOOTOUT')::integer AS goals,
    count(*) FILTER (WHERE e.event_type = 'ASSIST' AND e.goal_event_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM public.match_events goal
      WHERE goal.id = e.goal_event_id AND goal.match_id = e.match_id AND goal.event_type = 'GOAL'
        AND NOT goal.is_own_goal AND goal.period <> 'PENALTY_SHOOTOUT' AND goal.team_id = e.team_id
        AND goal.player_id <> e.player_id AND goal.minute_seconds = e.minute_seconds AND goal.period = e.period))::integer AS assists,
    count(*) FILTER (WHERE e.event_type = 'GOAL' AND e.is_own_goal AND e.period <> 'PENALTY_SHOOTOUT')::integer AS own_goals
  FROM public.match_events e
  JOIN official_matches om ON om.id = e.match_id
  WHERE e.player_id IS NOT NULL AND e.event_type IN ('GOAL', 'ASSIST')
  GROUP BY e.match_id, e.player_id
)
SELECT p.*,
  CASE WHEN p.side = 'home' THEN m.home_score ELSE m.away_score END AS team_score,
  CASE WHEN p.side = 'home' THEN m.away_score ELSE m.home_score END AS opponent_score,
  CASE
    WHEN m.home_score IS NULL OR m.away_score IS NULL THEN NULL
    WHEN (CASE WHEN p.side = 'home' THEN m.home_score - m.away_score ELSE m.away_score - m.home_score END) > 0 THEN 'W'
    WHEN m.home_score = m.away_score THEN 'D'
    ELSE 'L'
  END AS result,
  COALESCE(t.goals, 0) AS goals,
  COALESCE(t.assists, 0) AS assists,
  COALESCE(t.own_goals, 0) AS own_goals
FROM public.player_match_participation p
JOIN public.matches m ON m.id = p.match_id
LEFT JOIN event_totals t ON t.match_id = p.match_id AND t.player_id = p.player_id;

COMMENT ON VIEW public.player_match_stats IS 'Per player per finished match: goals, assists, own goals (official rules) and the result for his team.';

CREATE OR REPLACE VIEW public.player_season_summary
WITH (security_invoker = true) AS
SELECT player_id, competition_id, season_id, team_id,
  count(*)::integer AS matches,
  count(*) FILTER (WHERE result = 'W')::integer AS wins,
  count(*) FILTER (WHERE result = 'D')::integer AS draws,
  count(*) FILTER (WHERE result = 'L')::integer AS losses,
  sum(goals)::integer AS goals,
  sum(assists)::integer AS assists,
  sum(own_goals)::integer AS own_goals,
  count(*) FILTER (WHERE was_goalkeeper)::integer AS goalkeeper_matches,
  count(*) FILTER (WHERE in_lineup)::integer AS lineup_matches
FROM public.player_match_stats
GROUP BY player_id, competition_id, season_id, team_id;

COMMENT ON VIEW public.player_season_summary IS 'Totals per player, competition, season and club from player_match_stats.';

CREATE OR REPLACE VIEW public.team_match_lineups
WITH (security_invoker = true) AS
SELECT m.id AS match_id, st.id AS season_team_id, st.team_id,
  EXISTS (SELECT 1 FROM public.match_participations mp WHERE mp.match_id = m.id AND mp.season_team_id = st.id) AS lineup_registered
FROM public.matches m
JOIN public.season_teams st ON st.id IN (m.home_team_id, m.away_team_id)
WHERE m.status = 'FINISHED';

COMMENT ON VIEW public.team_match_lineups IS 'For each team of each finished match, whether its lineup was registered.';

GRANT SELECT ON public.player_match_participation, public.player_match_stats, public.player_season_summary, public.team_match_lineups TO anon, authenticated;
