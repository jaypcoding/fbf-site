-- Run against an isolated staging database before applying the integrity migration.
-- These SELECTs only report rows; they do not modify data.

-- Existing round-robin repeats prevent the pair-claim backfill.
SELECT
  'round_robin_pair' AS issue,
  s.id AS stage_id,
  LEAST(m.home_team_id, m.away_team_id) AS team_low_id,
  GREATEST(m.home_team_id, m.away_team_id) AS team_high_id,
  count(*) AS duplicate_count,
  array_agg(m.id ORDER BY m.id) AS match_ids
FROM public.matches m
JOIN public.rounds r ON r.id = m.round_id
JOIN public.stages s ON s.id = r.stage_id
WHERE s.format = 'Pontos corridos'
  AND m.home_team_id IS NOT NULL
  AND m.away_team_id IS NOT NULL
GROUP BY s.id, LEAST(m.home_team_id, m.away_team_id), GREATEST(m.home_team_id, m.away_team_id)
HAVING count(*) > 1;

-- Duplicate goal identities prevent the unique goal index.
SELECT
  'goal_identity' AS issue,
  match_id,
  team_id,
  player_id,
  minute_seconds,
  count(*) AS duplicate_count,
  array_agg(id ORDER BY id) AS event_ids
FROM public.match_events
WHERE event_type = 'GOAL'
  AND team_id IS NOT NULL
  AND player_id IS NOT NULL
GROUP BY match_id, team_id, player_id, minute_seconds
HAVING count(*) > 1;

-- Duplicate goalkeeper changes/substitutions can prevent the change-event index.
-- The new migration assigns REGULATION to all existing events.
SELECT
  'substitution_identity' AS issue,
  match_id,
  team_id,
  event_type,
  player_id,
  related_player_id,
  minute_seconds,
  count(*) AS duplicate_count,
  array_agg(id ORDER BY id) AS event_ids
FROM public.match_events
WHERE event_type IN ('SUBSTITUTION', 'GOALKEEPER_IN', 'GOALKEEPER_OUT')
GROUP BY match_id, team_id, event_type, player_id, related_player_id, minute_seconds
HAVING count(*) > 1;

-- Approximate diagnostic only: this migration's preflight runs before period and
-- own-goal columns exist, so raw GOAL-event counts cannot reconcile shootouts or
-- own goals. Review all returned matches before any manual reconciliation.
WITH event_scores AS (
  SELECT
    m.id AS match_id,
    count(e.id) FILTER (
      WHERE e.event_type = 'GOAL' AND e.team_id = m.home_team_id
    )::integer AS home_goal_event_count,
    count(e.id) FILTER (
      WHERE e.event_type = 'GOAL' AND e.team_id = m.away_team_id
    )::integer AS away_goal_event_count,
    count(e.id)::integer AS event_count
  FROM public.matches m
  LEFT JOIN public.match_events e ON e.match_id = m.id
  WHERE m.status = 'FINISHED'
  GROUP BY m.id
)
SELECT
  'legacy_score_review' AS issue,
  m.id AS match_id,
  m.home_score,
  m.away_score,
  es.home_goal_event_count,
  es.away_goal_event_count,
  es.event_count,
  CASE
    WHEN es.event_count = 0 THEN 'no events; preserve score as LEGACY'
    ELSE 'raw goal-event counts are only a clue; inspect manually'
  END AS recommendation
FROM public.matches m
JOIN event_scores es ON es.match_id = m.id
WHERE m.status = 'FINISHED'
  AND (
    es.event_count = 0
    OR es.home_goal_event_count IS DISTINCT FROM m.home_score
    OR es.away_goal_event_count IS DISTINCT FROM m.away_score
  )
ORDER BY m.id;
