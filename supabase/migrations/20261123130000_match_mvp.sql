/*
# MVP of the match (formula approved by the FBF on 2026-11-23)

Read-only views over the official data: nothing is stored, so a corrected
sheet, a reprocessed recording or a new lineup changes the MVP immediately and
there is never an outdated MVP.

Formula (per player per match):
  goal +3 (own goals never count as goals) · valid assist +2 ·
  +1 per complete 2-minute block in goal without conceding (each goal conceded
  interrupts the period) · win +2 · own goal −3.
Rules:
  - candidates are the proven participants (lineup, official goals/assists or
    goalkeeper records: player_match_participation); the win bonus goes to the
    proven participants of the winning side;
  - the result is the regulation score: a decision on penalties is a draw;
  - shared MVP when several players have the highest positive total; no MVP
    when nobody has a positive total;
  - only matches whose result comes from the events (as in the official
    player statistics); a W.O. registered without authors has no candidates;
  - a goal conceded with unknown minute makes it impossible to split the
    goalkeeper's period: no goalkeeper points for that team in that match
    (shown as keeper_time_unknown).

Views:
  - match_keeper_spells: every goalkeeper spell with its time, goals conceded
    and complete clean blocks;
  - match_mvp_scores: the full breakdown of every candidate, the total, the
    best total of the match and whether he is (or shares) the MVP.
*/

CREATE OR REPLACE VIEW public.match_keeper_spells
WITH (security_invoker = true) AS
WITH spells AS (
  SELECT gp.id AS spell_id, gp.match_id, gp.player_id, gp.team_id AS season_team_id,
    GREATEST(gp.started_at_seconds, 0) AS start_seconds,
    GREATEST(GREATEST(gp.started_at_seconds, 0), COALESCE(gp.ended_at_seconds, m.duration_seconds, gp.started_at_seconds)) AS end_seconds
  FROM public.goalkeeper_participations gp
  JOIN public.matches m ON m.id = gp.match_id
  WHERE m.status = 'FINISHED'
), conceded AS (
  -- goals that count against the keeper's team: a goal of the opponent or an
  -- own goal of his own team (penalty shootouts excluded)
  SELECT sp.spell_id, g.minute_seconds AS t,
    (COALESCE((g.metadata->>'minute_unknown')::boolean, false) OR g.minute_seconds = 0) AS unknown_time
  FROM spells sp
  JOIN public.match_events g ON g.match_id = sp.match_id AND g.event_type = 'GOAL' AND g.period <> 'PENALTY_SHOOTOUT'
    AND ((g.team_id <> sp.season_team_id AND NOT g.is_own_goal) OR (g.team_id = sp.season_team_id AND g.is_own_goal))
), in_spell AS (
  SELECT c.spell_id, c.t
  FROM conceded c JOIN spells sp ON sp.spell_id = c.spell_id
  WHERE NOT c.unknown_time AND c.t > sp.start_seconds AND c.t <= sp.end_seconds
), cuts AS (
  SELECT spell_id, t FROM in_spell
  UNION ALL
  SELECT spell_id, end_seconds FROM spells
), intervals AS (
  SELECT c.spell_id, c.t - lag(c.t, 1, sp.start_seconds) OVER (PARTITION BY c.spell_id ORDER BY c.t) AS len
  FROM cuts c JOIN spells sp ON sp.spell_id = c.spell_id
)
SELECT sp.spell_id, sp.match_id, sp.player_id, sp.season_team_id, sp.start_seconds, sp.end_seconds,
  (sp.end_seconds - sp.start_seconds) AS keeper_seconds,
  (SELECT count(*) FROM in_spell i WHERE i.spell_id = sp.spell_id)::integer AS goals_conceded,
  EXISTS (SELECT 1 FROM conceded c WHERE c.spell_id = sp.spell_id AND c.unknown_time) AS time_unknown,
  CASE WHEN EXISTS (SELECT 1 FROM conceded c WHERE c.spell_id = sp.spell_id AND c.unknown_time) THEN 0
    ELSE COALESCE((SELECT sum(floor(GREATEST(iv.len, 0) / 120.0)) FROM intervals iv WHERE iv.spell_id = sp.spell_id), 0)
  END::integer AS clean_blocks
FROM spells sp;

COMMENT ON VIEW public.match_keeper_spells IS 'Goalkeeper spells of finished matches: time in goal, goals conceded and complete 2-minute clean blocks (MVP formula).';

CREATE OR REPLACE VIEW public.match_mvp_scores
WITH (security_invoker = true) AS
WITH keeper AS (
  SELECT match_id, player_id, sum(keeper_seconds)::integer AS keeper_seconds, sum(clean_blocks)::integer AS keeper_blocks,
    sum(goals_conceded)::integer AS keeper_goals_conceded, bool_or(time_unknown) AS keeper_time_unknown
  FROM public.match_keeper_spells
  GROUP BY match_id, player_id
), base AS (
  SELECT s.match_id, s.player_id, s.season_team_id, s.team_id, s.competition_id, s.season_id, s.side, s.result,
    s.in_lineup, s.has_events, s.was_goalkeeper, s.goals, s.assists, s.own_goals,
    COALESCE(k.keeper_seconds, 0) AS keeper_seconds, COALESCE(k.keeper_blocks, 0) AS keeper_blocks,
    COALESCE(k.keeper_goals_conceded, 0) AS keeper_goals_conceded, COALESCE(k.keeper_time_unknown, false) AS keeper_time_unknown,
    (s.result = 'W') AS won
  FROM public.player_match_stats s
  JOIN public.matches m ON m.id = s.match_id
  LEFT JOIN keeper k ON k.match_id = s.match_id AND k.player_id = s.player_id
  WHERE m.score_source = 'EVENTS' AND m.home_score IS NOT NULL AND m.away_score IS NOT NULL
), scored AS (
  SELECT b.*,
    b.goals * 3 AS points_goals,
    b.assists * 2 AS points_assists,
    b.keeper_blocks AS points_keeper,
    CASE WHEN b.won THEN 2 ELSE 0 END AS points_win,
    b.own_goals * -3 AS points_own_goals,
    b.goals * 3 + b.assists * 2 + b.keeper_blocks + CASE WHEN b.won THEN 2 ELSE 0 END - b.own_goals * 3 AS total
  FROM base b
), ranked AS (
  SELECT sc.*, max(sc.total) OVER (PARTITION BY sc.match_id) AS top_total FROM scored sc
)
SELECT r.*,
  (r.top_total > 0 AND r.total = r.top_total) AS is_mvp,
  count(*) FILTER (WHERE r.top_total > 0 AND r.total = r.top_total) OVER (PARTITION BY r.match_id)::integer AS mvp_count
FROM ranked r;

COMMENT ON VIEW public.match_mvp_scores IS 'MVP formula approved on 2026-11-23: breakdown per candidate (proven participant) of each match, total and MVP flag (shared on ties, none when the best total is not positive).';

GRANT SELECT ON public.match_keeper_spells, public.match_mvp_scores TO anon, authenticated;
