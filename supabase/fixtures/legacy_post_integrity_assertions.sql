DO $$
DECLARE
  v_match public.matches%ROWTYPE;
  v_match_without_events public.matches%ROWTYPE;
BEGIN
  SELECT * INTO v_match
  FROM public.matches
  WHERE id = 'b6000000-0000-0000-0000-000000000001';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Legacy fixture is missing after migration';
  END IF;
  IF v_match.status <> 'FINISHED'
     OR v_match.home_score <> 2
     OR v_match.away_score <> 1
     OR v_match.score_source <> 'LEGACY' THEN
    RAISE EXCEPTION 'Legacy score was not preserved as expected: %', row_to_json(v_match);
  END IF;
  IF (
    SELECT 1 FROM public.match_events
    WHERE match_id = v_match.id AND event_type = 'GOAL'
  ) IS NULL OR (
    SELECT count(*) FROM public.match_events
    WHERE match_id = v_match.id AND event_type = 'GOAL'
  ) <> 1 THEN
    RAISE EXCEPTION 'Migration altered the mismatched legacy event log';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.match_status_history
    WHERE match_id = v_match.id
      AND previous_status IS NULL
      AND new_status = 'FINISHED'
      AND source = 'MIGRATION_BASELINE'
  ) THEN
    RAISE EXCEPTION 'Legacy status baseline was not recorded';
  END IF;

  SELECT * INTO v_match_without_events
  FROM public.matches
  WHERE id = 'b6000000-0000-0000-0000-000000000002';
  IF NOT FOUND
     OR v_match_without_events.home_score <> 0
     OR v_match_without_events.away_score <> 3
     OR v_match_without_events.score_source <> 'LEGACY'
     OR EXISTS (
       SELECT 1 FROM public.match_events
       WHERE match_id = v_match_without_events.id
     ) THEN
    RAISE EXCEPTION 'Score without event history was not preserved without inventing events';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.goalkeeper_clean_sheet_statistics
    WHERE player_id = 'b7000000-0000-0000-0000-000000000002'
      AND games = 1
      AND clean_sheets = 0
      AND total_seconds = 0
  ) THEN
    RAISE EXCEPTION 'Legacy match with goals against must not infer a clean sheet or clean time';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM public.goalkeeper_clean_sheet_statistics
    WHERE player_id = 'b7000000-0000-0000-0000-000000000003'
      AND games = 1
      AND clean_sheets = 1
      AND total_seconds = 900
  ) THEN
    RAISE EXCEPTION 'Legacy score with zero goals against must preserve a clean-sheet appearance';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM public.goalkeeper_clean_sheet_statistics
    WHERE player_id = 'b7000000-0000-0000-0000-000000000004'
      AND games = 1
      AND clean_sheets = 1
      AND total_seconds = 900
  ) OR NOT EXISTS (
    SELECT 1
    FROM public.goalkeeper_clean_sheet_statistics
    WHERE player_id = 'b7000000-0000-0000-0000-000000000005'
      AND games = 1
      AND clean_sheets = 1
      AND total_seconds = 900
  ) THEN
    RAISE EXCEPTION 'A legacy 0-0 match must credit both participating goalkeepers';
  END IF;

  BEGIN
    UPDATE public.matches SET home_score = 3
    WHERE id = v_match_without_events.id;
    RAISE EXCEPTION 'Direct modification of a legacy score unexpectedly succeeded';
  EXCEPTION
    WHEN insufficient_privilege THEN NULL;
  END;
END;
$$;
