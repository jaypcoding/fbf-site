-- Goalkeeper registered after the match was already finished.
--
-- The period of a goalkeeper (ended_at_seconds) is filled in only when the
-- match changes to FINISHED (close_goalkeeper_participations_on_match_finish)
-- or by the goalkeeper-change events. Users cannot type it. So a starting
-- goalkeeper registered *after* the match was finished stayed open forever,
-- and goalkeeper_match_clean_sheet_statistics ignores open periods: the clean
-- sheet data never appeared (FBF 20: jabu and Cave in New Jeans 8 x 1 Winners
-- Long).
--
-- Fix (minimal diff to validate_goalkeeper_participation):
--   * when a user (or this migration) registers or touches a manual period of
--     a FINISHED match with a known duration, the period is closed by the
--     database: at the start of the next period of the same team (a goalkeeper
--     change recorded by events) or, if there is none, at the end of the match;
--   * the first goal conceded is computed with that end, as before;
--   * inside the event synchronization (trigger depth >= 2) nothing changes,
--     so rebuilding periods from goalkeeper-change events keeps working;
--   * users still cannot send ended_at_seconds (checked before, on the value
--     sent).
-- Then the periods left open by the bug are closed once (backfill).

CREATE OR REPLACE FUNCTION public.validate_goalkeeper_participation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_match public.matches%ROWTYPE;
  v_first_conceded integer;
BEGIN
  IF TG_OP IN ('UPDATE', 'DELETE')
     AND (OLD.source_event_id IS NOT NULL OR OLD.exit_event_id IS NOT NULL)
     AND pg_trigger_depth() < 2 THEN
    RAISE EXCEPTION 'Participações controladas por eventos só podem ser corrigidas pelos próprios eventos'
      USING ERRCODE = '42501';
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  IF pg_trigger_depth() < 2
     AND (
       NEW.source_event_id IS NOT NULL
       OR NEW.exit_event_id IS NOT NULL
       OR NEW.started_at_seconds <> 0
       OR NEW.ended_at_seconds IS NOT NULL
     ) THEN
    RAISE EXCEPTION 'Somente o goleiro inicial pode ser cadastrado manualmente; tempos derivados vêm dos eventos'
      USING ERRCODE = '42501';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(NEW.match_id::text || ':' || NEW.team_id::text, 0));
  SELECT * INTO v_match
  FROM public.matches
  WHERE id = NEW.match_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Partida não encontrada' USING ERRCODE = '23503';
  END IF;
  IF NEW.team_id IS DISTINCT FROM v_match.home_team_id
     AND NEW.team_id IS DISTINCT FROM v_match.away_team_id THEN
    RAISE EXCEPTION 'O time do goleiro não participa desta partida'
      USING ERRCODE = '23514';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.rosters
    WHERE season_team_id = NEW.team_id AND player_id = NEW.player_id
  ) OR NOT EXISTS (
    SELECT 1 FROM public.players
    WHERE id = NEW.player_id AND position = 'Goleiro'
  ) THEN
    RAISE EXCEPTION 'O jogador precisa ser goleiro e pertencer ao elenco do time'
      USING ERRCODE = '23514';
  END IF;

  -- New: a manual period of an already finished match is closed by the
  -- database (never inside the event synchronization, depth >= 2).
  IF pg_trigger_depth() < 2
     AND NEW.source_event_id IS NULL
     AND NEW.ended_at_seconds IS NULL
     AND v_match.status = 'FINISHED'
     AND v_match.duration_seconds IS NOT NULL THEN
    NEW.ended_at_seconds := COALESCE((
      SELECT min(gp.started_at_seconds)
      FROM public.goalkeeper_participations gp
      WHERE gp.match_id = NEW.match_id
        AND gp.team_id = NEW.team_id
        AND gp.id IS DISTINCT FROM NEW.id
        AND gp.started_at_seconds > NEW.started_at_seconds
    ), v_match.duration_seconds);
  END IF;

  IF v_match.duration_seconds IS NOT NULL
     AND (
       NEW.started_at_seconds > v_match.duration_seconds
       OR NEW.ended_at_seconds > v_match.duration_seconds
     ) THEN
    RAISE EXCEPTION 'A participação excede a duração registrada da partida'
      USING ERRCODE = '23514';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM public.goalkeeper_participations gp
    WHERE gp.match_id = NEW.match_id
      AND gp.team_id = NEW.team_id
      AND gp.id IS DISTINCT FROM NEW.id
      AND NEW.started_at_seconds < COALESCE(gp.ended_at_seconds, 2147483647)
      AND gp.started_at_seconds < COALESCE(NEW.ended_at_seconds, 2147483647)
  ) THEN
    RAISE EXCEPTION 'As participações de goleiros do mesmo time não podem se sobrepor'
      USING ERRCODE = '23514';
  END IF;

  SELECT min(e.minute_seconds) INTO v_first_conceded
  FROM public.match_events e
  WHERE e.match_id = NEW.match_id
    AND e.event_type = 'GOAL'
    AND e.period <> 'PENALTY_SHOOTOUT'
    AND (
      (NOT e.is_own_goal AND e.team_id <> NEW.team_id)
      OR (e.is_own_goal AND e.team_id = NEW.team_id)
    )
    AND e.minute_seconds >= NEW.started_at_seconds
    AND (
      NEW.ended_at_seconds IS NULL
      OR e.minute_seconds < NEW.ended_at_seconds
      OR (
        NEW.ended_at_seconds = v_match.duration_seconds
        AND NEW.started_at_seconds < NEW.ended_at_seconds
        AND e.minute_seconds = NEW.ended_at_seconds
      )
    );
  NEW.first_conceded_at_seconds := v_first_conceded;
  RETURN NEW;
END;
$$;

-- Backfill: close, once, the manual periods left open in finished matches.
-- The no-op UPDATE goes through the trigger above (depth 1), which closes the
-- period and recomputes the first goal conceded; nothing else is touched.
UPDATE public.goalkeeper_participations gp
SET started_at_seconds = gp.started_at_seconds
FROM public.matches m
WHERE m.id = gp.match_id
  AND m.status = 'FINISHED'
  AND m.duration_seconds IS NOT NULL
  AND gp.ended_at_seconds IS NULL
  AND gp.source_event_id IS NULL;
