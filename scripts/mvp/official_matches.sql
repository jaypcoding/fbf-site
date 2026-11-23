-- READ ONLY. Official data of every finished match, in the shape used by the
-- MVP simulation (scripts/mvp/simulate.mts). Same rules as the official views:
-- penalty shootout goals are ignored; an assist only counts when it points to
-- a valid goal of the same team, minute and period, by another player.
WITH fm AS (
  SELECT m.id, m.home_team_id, m.away_team_id, m.home_score, m.away_score, m.duration_seconds,
         m.home_penalty_score, m.away_penalty_score, c.name AS competition, s.name AS season, r.name AS round,
         ht.name AS home_name, at.name AS away_name
  FROM matches m
  JOIN rounds r ON r.id = m.round_id
  JOIN stages stg ON stg.id = r.stage_id
  JOIN seasons s ON s.id = stg.season_id
  JOIN competitions c ON c.id = s.competition_id
  JOIN season_teams hst ON hst.id = m.home_team_id JOIN teams ht ON ht.id = hst.team_id
  JOIN season_teams ast ON ast.id = m.away_team_id JOIN teams at ON at.id = ast.team_id
  WHERE m.status = 'FINISHED' AND c.status NOT IN ('DRAFT', 'CANCELLED')
)
SELECT json_build_object(
  'matches', (SELECT json_agg(json_build_object(
      'id', fm.id, 'competition', fm.competition, 'season', fm.season, 'round', fm.round,
      'home', fm.home_name, 'away', fm.away_name, 'homeTeamId', fm.home_team_id, 'awayTeamId', fm.away_team_id,
      'score', json_build_object('home', fm.home_score, 'away', fm.away_score),
      'penalties', json_build_object('home', fm.home_penalty_score, 'away', fm.away_penalty_score),
      'durationSeconds', fm.duration_seconds,
      'goals', (SELECT coalesce(json_agg(json_build_object(
          'seconds', g.minute_seconds, 'teamId', g.team_id, 'playerId', g.player_id, 'ownGoal', g.is_own_goal,
          'assistId', (SELECT a.player_id FROM match_events a
                       WHERE a.goal_event_id = g.id AND a.event_type = 'ASSIST' AND NOT g.is_own_goal
                         AND a.team_id = g.team_id AND a.player_id <> g.player_id
                         AND a.minute_seconds = g.minute_seconds AND a.period = g.period LIMIT 1)
        ) ORDER BY g.minute_seconds), '[]'::json)
        FROM match_events g WHERE g.match_id = fm.id AND g.event_type = 'GOAL' AND g.period <> 'PENALTY_SHOOTOUT'),
      'keepers', (SELECT coalesce(json_agg(json_build_object(
          'playerId', gp.player_id, 'teamId', gp.team_id, 'start', gp.started_at_seconds,
          'end', coalesce(gp.ended_at_seconds, fm.duration_seconds)) ORDER BY gp.started_at_seconds), '[]'::json)
        FROM goalkeeper_participations gp WHERE gp.match_id = fm.id)
    ) ORDER BY fm.round, fm.id) FROM fm),
  'players', (SELECT json_object_agg(p.id, json_build_object('nickname', p.nickname, 'position', p.position)) FROM players p)
) AS data;
