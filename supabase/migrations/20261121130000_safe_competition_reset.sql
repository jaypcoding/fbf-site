-- Safe administrative reset of selected competitions.
--
-- delete_competition_record (20261121100000) refuses anything that was played
-- and published competitions. To restart the federation (new PRINCIPAL and
-- ASPIRANTES), an ADMIN needs to remove whole competitions, played matches
-- included, without touching teams or players. This migration adds:
--
--   reset_competitions_preview(ids)              what would be removed, the
--                                                blockers and a fingerprint
--   reset_competitions(ids, confirmation, fp)    revalidates under lock and
--                                                removes everything, one
--                                                transaction
--
-- Rules:
--   * only a logged-in ADMIN (auth.uid()), never anon or organizers;
--   * only the competitions explicitly listed; the caller types
--     "RESETAR <n> COMPETIÇÕES" and sends the preview fingerprint, recomputed
--     under lock (a stale preview is refused);
--   * a LIVE match, or any match outside the selection that depends on it,
--     blocks the reset;
--   * every row is copied to deletion_log (one entry per competition, same
--     reset_batch_id) before it is deleted; restore_deleted_records(log_id)
--     brings it back, events and goalkeepers included;
--   * explicit deletes, child to parent, each count checked; no TRUNCATE, no
--     DROP, no reliance on ON DELETE CASCADE for the plan, triggers stay on;
--   * teams, players, streamers, profiles and accounts are never deleted: their
--     counts and content hashes are compared before and after, and any change
--     aborts the whole transaction.
--
-- Protection triggers get one narrow exception: a match marked in
-- reset_match_marks for the current transaction id may be removed with its
-- history and events (without recomputing its score). Only reset_competitions
-- writes that table; no API role can, so the exception is unreachable from
-- the site or the API.

-- ------------------------------------------------------------- audit log
ALTER TABLE public.deletion_log ADD COLUMN IF NOT EXISTS reset_batch_id uuid;

-- ------------------------------------------ narrow exception for the reset
-- Matches being removed by reset_competitions, tied to its transaction id.
-- No API role can read or write this table (RLS on, no policies, no grants):
-- only reset_competitions (owner) fills it and empties it before returning.
CREATE TABLE IF NOT EXISTS public.reset_match_marks (
  txid bigint NOT NULL,
  match_id uuid NOT NULL,
  PRIMARY KEY (txid, match_id)
);
ALTER TABLE public.reset_match_marks ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.reset_match_marks FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.match_is_listed_for_reset(p_match_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.reset_match_marks
    WHERE txid = txid_current_if_assigned() AND match_id = p_match_id
  );
$$;
REVOKE ALL ON FUNCTION public.match_is_listed_for_reset(uuid) FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.prevent_match_deletion()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF public.match_is_listed_for_reset(OLD.id) THEN
    RETURN OLD;
  END IF;
  IF public.match_is_listed_for_purge(OLD.id)
     AND OLD.status IN ('SCHEDULED', 'POSTPONED', 'CANCELLED')
     AND OLD.home_score IS NULL AND OLD.away_score IS NULL
     AND OLD.home_penalty_score IS NULL AND OLD.away_penalty_score IS NULL
     AND OLD.duration_seconds IS NULL
     AND NOT OLD.recorded_retroactively
     AND NOT EXISTS (SELECT 1 FROM public.match_events WHERE match_id = OLD.id)
     AND NOT EXISTS (SELECT 1 FROM public.goalkeeper_participations WHERE match_id = OLD.id)
     AND NOT EXISTS (SELECT 1 FROM public.match_streamers WHERE match_id = OLD.id)
     AND NOT EXISTS (SELECT 1 FROM public.match_status_history WHERE match_id = OLD.id) THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'Partidas não podem ser excluídas; use o status CANCELLED para preservar o histórico'
    USING ERRCODE = '55000';
END;
$$;

CREATE OR REPLACE FUNCTION public.prevent_match_status_history_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF TG_OP = 'DELETE' AND public.match_is_listed_for_reset(OLD.match_id) THEN
    RETURN OLD;
  END IF;
  -- Each history row checks itself: a single LIVE/FINISHED entry makes the
  -- whole statement fail, whatever order the rows are deleted in.
  IF TG_OP = 'DELETE'
     AND public.match_is_listed_for_purge(OLD.match_id)
     AND OLD.new_status NOT IN ('LIVE', 'FINISHED')
     AND COALESCE(OLD.previous_status, 'SCHEDULED') NOT IN ('LIVE', 'FINISHED') THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'O histórico de status das partidas é somente de acréscimo'
    USING ERRCODE = '55000';
END;
$$;

-- Removing the events of a match that is being reset must not recompute its
-- score or goalkeeper periods (the match itself is removed right after).
CREATE OR REPLACE FUNCTION public.sync_match_events_to_derived_data()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_match_id uuid;
  v_match public.matches%ROWTYPE;
  v_home_score integer;
  v_away_score integer;
  v_home_penalties integer;
  v_away_penalties integer;
BEGIN
  IF TG_OP = 'DELETE' THEN
    v_match_id := OLD.match_id;
    IF public.match_is_listed_for_reset(v_match_id) THEN
      RETURN OLD;
    END IF;
  ELSE
    v_match_id := NEW.match_id;
  END IF;

  PERFORM public.sync_goalkeeper_participations_from_events(v_match_id);

  SELECT * INTO v_match FROM public.matches WHERE id = v_match_id FOR UPDATE;
  UPDATE public.goalkeeper_participations gp
  SET first_conceded_at_seconds = (
    SELECT min(e.minute_seconds)
    FROM public.match_events e
    WHERE e.match_id = gp.match_id
      AND e.event_type = 'GOAL'
      AND e.period <> 'PENALTY_SHOOTOUT'
      AND (
        (NOT e.is_own_goal AND e.team_id <> gp.team_id)
        OR (e.is_own_goal AND e.team_id = gp.team_id)
      )
      AND e.minute_seconds >= gp.started_at_seconds
      AND (
        gp.ended_at_seconds IS NULL
        OR e.minute_seconds < gp.ended_at_seconds
        OR (
          gp.ended_at_seconds = v_match.duration_seconds
          AND gp.started_at_seconds < gp.ended_at_seconds
          AND e.minute_seconds = gp.ended_at_seconds
        )
      )
  )
  WHERE gp.match_id = v_match_id;

  IF v_match.score_source = 'EVENTS' THEN
    SELECT
      count(*) FILTER (
        WHERE e.event_type = 'GOAL'
          AND e.period <> 'PENALTY_SHOOTOUT'
          AND (
            (e.team_id = v_match.home_team_id AND NOT e.is_own_goal)
            OR (e.team_id = v_match.away_team_id AND e.is_own_goal)
          )
      )::integer,
      count(*) FILTER (
        WHERE e.event_type = 'GOAL'
          AND e.period <> 'PENALTY_SHOOTOUT'
          AND (
            (e.team_id = v_match.away_team_id AND NOT e.is_own_goal)
            OR (e.team_id = v_match.home_team_id AND e.is_own_goal)
          )
      )::integer,
      count(*) FILTER (
        WHERE e.event_type = 'GOAL'
          AND e.period = 'PENALTY_SHOOTOUT'
          AND e.team_id = v_match.home_team_id
      )::integer,
      count(*) FILTER (
        WHERE e.event_type = 'GOAL'
          AND e.period = 'PENALTY_SHOOTOUT'
          AND e.team_id = v_match.away_team_id
      )::integer
    INTO v_home_score, v_away_score, v_home_penalties, v_away_penalties
    FROM public.match_events e
    WHERE e.match_id = v_match_id;

    IF v_match.status = 'FINISHED'
       AND COALESCE(v_home_penalties, 0) + COALESCE(v_away_penalties, 0) > 0
         AND (
           v_home_penalties = v_away_penalties
           OR COALESCE(v_home_score, 0) <> COALESCE(v_away_score, 0)
         ) THEN
        RAISE EXCEPTION 'A correção deixaria a disputa de pênaltis inválida'
          USING ERRCODE = '23514';
    END IF;

    UPDATE public.matches
    SET home_score = COALESCE(v_home_score, 0),
        away_score = COALESCE(v_away_score, 0),
        home_penalty_score = CASE
          WHEN COALESCE(v_home_penalties, 0) + COALESCE(v_away_penalties, 0) > 0
          THEN COALESCE(v_home_penalties, 0) ELSE NULL END,
        away_penalty_score = CASE
          WHEN COALESCE(v_home_penalties, 0) + COALESCE(v_away_penalties, 0) > 0
          THEN COALESCE(v_away_penalties, 0) ELSE NULL END
    WHERE id = v_match_id;
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

-- ------------------------------------------------- preserved registrations
-- Content hashes of what the reset must never change.
CREATE OR REPLACE FUNCTION public._reset_preserved_state()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT jsonb_build_object(
    'teams', (SELECT count(*) FROM public.teams),
    'teams_hash', (SELECT md5(COALESCE(string_agg(to_jsonb(t)::text, ',' ORDER BY t.id), '')) FROM public.teams t),
    'players', (SELECT count(*) FROM public.players),
    'players_hash', (SELECT md5(COALESCE(string_agg(to_jsonb(p)::text, ',' ORDER BY p.id), '')) FROM public.players p),
    'streamers', (SELECT count(*) FROM public.streamers),
    'streamers_hash', (SELECT md5(COALESCE(string_agg(to_jsonb(s)::text, ',' ORDER BY s.id), '')) FROM public.streamers s),
    'profiles', (SELECT count(*) FROM public.profiles),
    'profiles_hash', (SELECT md5(COALESCE(string_agg(to_jsonb(p)::text, ',' ORDER BY p.id), '')) FROM public.profiles p)
  );
$$;
REVOKE ALL ON FUNCTION public._reset_preserved_state() FROM PUBLIC, anon, authenticated;

-- ------------------------------------------------------------- the plan
-- Internal: checks permission, collects every row of each selected
-- competition, the blockers and a fingerprint. Never exposed to the API.
CREATE OR REPLACE FUNCTION public._reset_plan(p_competition_ids uuid[], p_lock boolean DEFAULT false)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_ids uuid[];
  v_id uuid;
  v_comp public.competitions%ROWTYPE;
  v_seasons uuid[];
  v_stages uuid[];
  v_rounds uuid[];
  v_matches uuid[];
  v_season_teams uuid[];
  v_all_matches uuid[] := '{}';
  v_all_season_teams uuid[] := '{}';
  v_counts jsonb;
  v_items jsonb := '[]'::jsonb;
  v_totals jsonb := '{}'::jsonb;
  v_blockers jsonb := '[]'::jsonb;
  v_key text;
  v_n bigint;
  v_fp text := '';
BEGIN
  IF NOT public.is_fbf_admin() THEN
    RAISE EXCEPTION 'Somente administradores podem executar o reset de competições' USING ERRCODE = '42501';
  END IF;
  IF p_competition_ids IS NULL OR cardinality(p_competition_ids) = 0 THEN
    RAISE EXCEPTION 'Selecione ao menos uma competição' USING ERRCODE = '22023';
  END IF;
  IF array_position(p_competition_ids, NULL) IS NOT NULL THEN
    RAISE EXCEPTION 'Seleção de competições inválida' USING ERRCODE = '22023';
  END IF;
  v_ids := ARRAY(SELECT DISTINCT x FROM unnest(p_competition_ids) AS x ORDER BY x);
  IF cardinality(v_ids) <> cardinality(p_competition_ids) THEN
    RAISE EXCEPTION 'A mesma competição foi selecionada mais de uma vez' USING ERRCODE = '22023';
  END IF;

  FOREACH v_id IN ARRAY v_ids LOOP
    IF p_lock THEN
      SELECT * INTO v_comp FROM public.competitions WHERE id = v_id FOR UPDATE;
    ELSE
      SELECT * INTO v_comp FROM public.competitions WHERE id = v_id;
    END IF;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Competição não encontrada: %', v_id USING ERRCODE = 'P0002';
    END IF;

    v_seasons := ARRAY(SELECT id FROM public.seasons WHERE competition_id = v_id ORDER BY id);
    v_stages := ARRAY(SELECT id FROM public.stages WHERE season_id = ANY (v_seasons) ORDER BY id);
    v_rounds := ARRAY(SELECT id FROM public.rounds WHERE stage_id = ANY (v_stages) ORDER BY id);
    IF p_lock THEN
      PERFORM 1 FROM public.seasons WHERE id = ANY (v_seasons) FOR UPDATE;
      PERFORM 1 FROM public.stages WHERE id = ANY (v_stages) FOR UPDATE;
      PERFORM 1 FROM public.rounds WHERE id = ANY (v_rounds) FOR UPDATE;
    END IF;
    v_matches := ARRAY(SELECT id FROM public.matches WHERE round_id = ANY (v_rounds) ORDER BY id);
    v_season_teams := ARRAY(SELECT id FROM public.season_teams WHERE season_id = ANY (v_seasons) ORDER BY id);
    IF p_lock THEN
      PERFORM 1 FROM public.matches WHERE id = ANY (v_matches) FOR UPDATE;
      PERFORM 1 FROM public.season_teams WHERE id = ANY (v_season_teams) FOR UPDATE;
    END IF;

    v_counts := jsonb_build_object(
      'competitions', 1,
      'competition_organizers', (SELECT count(*) FROM public.competition_organizers WHERE competition_id = v_id),
      'seasons', cardinality(v_seasons),
      'season_teams', cardinality(v_season_teams),
      'team_registrations', (SELECT count(*) FROM public.team_registrations WHERE season_id = ANY (v_seasons)),
      'rosters', (SELECT count(*) FROM public.rosters WHERE season_team_id = ANY (v_season_teams)),
      'stages', cardinality(v_stages),
      'stage_groups', (SELECT count(*) FROM public.stage_groups WHERE stage_id = ANY (v_stages)),
      'stage_group_teams', (SELECT count(*) FROM public.stage_group_teams WHERE stage_id = ANY (v_stages)),
      'rounds', cardinality(v_rounds),
      'matches', cardinality(v_matches),
      'match_status_history', (SELECT count(*) FROM public.match_status_history WHERE match_id = ANY (v_matches)),
      'match_events', (SELECT count(*) FROM public.match_events WHERE match_id = ANY (v_matches)),
      'goalkeeper_participations', (SELECT count(*) FROM public.goalkeeper_participations WHERE match_id = ANY (v_matches)),
      'match_streamers', (SELECT count(*) FROM public.match_streamers WHERE match_id = ANY (v_matches)),
      'round_robin_pair_claims', (SELECT count(*) FROM public.round_robin_pair_claims
        WHERE match_id = ANY (v_matches) OR stage_id = ANY (v_stages))
    );

    v_items := v_items || jsonb_build_object(
      'id', v_comp.id, 'name', v_comp.name, 'category', v_comp.category, 'status', v_comp.status,
      'finished_matches', (SELECT count(*) FROM public.matches WHERE id = ANY (v_matches) AND status = 'FINISHED'),
      'counts', v_counts,
      'ids', jsonb_build_object('seasons', to_jsonb(v_seasons), 'stages', to_jsonb(v_stages), 'rounds', to_jsonb(v_rounds),
        'matches', to_jsonb(v_matches), 'season_teams', to_jsonb(v_season_teams)));

    FOR v_key IN SELECT jsonb_object_keys(v_counts) LOOP
      v_totals := v_totals || jsonb_build_object(v_key, COALESCE((v_totals->>v_key)::bigint, 0) + (v_counts->>v_key)::bigint);
    END LOOP;
    v_all_matches := v_all_matches || v_matches;
    v_all_season_teams := v_all_season_teams || v_season_teams;

    -- Fingerprint: ids of every row and the state that matters.
    v_fp := v_fp || '#' || concat_ws('|',
      v_comp.id, v_comp.name, v_comp.status,
      array_to_string(v_seasons, ','), array_to_string(v_stages, ','), array_to_string(v_rounds, ','),
      array_to_string(v_season_teams, ','),
      (SELECT string_agg(concat_ws(':', id, status, home_score, away_score, duration_seconds), ',' ORDER BY id)
        FROM public.matches WHERE id = ANY (v_matches)),
      (SELECT string_agg(user_id::text, ',' ORDER BY user_id) FROM public.competition_organizers WHERE competition_id = v_id),
      (SELECT string_agg(id::text, ',' ORDER BY id) FROM public.team_registrations WHERE season_id = ANY (v_seasons)),
      (SELECT string_agg(id::text, ',' ORDER BY id) FROM public.rosters WHERE season_team_id = ANY (v_season_teams)),
      (SELECT string_agg(id::text, ',' ORDER BY id) FROM public.stage_groups WHERE stage_id = ANY (v_stages)),
      (SELECT string_agg(id::text, ',' ORDER BY id) FROM public.stage_group_teams WHERE stage_id = ANY (v_stages)),
      (SELECT string_agg(id::text, ',' ORDER BY id) FROM public.match_status_history WHERE match_id = ANY (v_matches)),
      (SELECT string_agg(id::text, ',' ORDER BY id) FROM public.match_events WHERE match_id = ANY (v_matches)),
      (SELECT string_agg(concat_ws(':', id, ended_at_seconds), ',' ORDER BY id) FROM public.goalkeeper_participations WHERE match_id = ANY (v_matches)),
      (SELECT string_agg(concat_ws(':', match_id, streamer_id), ',' ORDER BY match_id, streamer_id) FROM public.match_streamers WHERE match_id = ANY (v_matches)),
      (SELECT string_agg(concat_ws(':', stage_id, leg_number, team_low_id, team_high_id, match_id), ','
          ORDER BY stage_id, leg_number, team_low_id, team_high_id)
        FROM public.round_robin_pair_claims WHERE match_id = ANY (v_matches) OR stage_id = ANY (v_stages))
    );
  END LOOP;

  SELECT count(*) INTO v_n FROM public.matches WHERE id = ANY (v_all_matches) AND status = 'LIVE';
  IF v_n > 0 THEN
    v_blockers := v_blockers || jsonb_build_object('code', 'MATCH_LIVE', 'count', v_n,
      'message', format('%s partida(s) ao vivo; finalize ou cancele antes do reset', v_n));
  END IF;
  SELECT count(*) INTO v_n FROM public.matches
  WHERE NOT (id = ANY (v_all_matches))
    AND (home_source_match_id = ANY (v_all_matches) OR away_source_match_id = ANY (v_all_matches)
      OR home_team_id = ANY (v_all_season_teams) OR away_team_id = ANY (v_all_season_teams));
  IF v_n > 0 THEN
    v_blockers := v_blockers || jsonb_build_object('code', 'REFERENCED_ELSEWHERE', 'count', v_n,
      'message', format('%s partida(s) de competições não selecionadas dependem das selecionadas', v_n));
  END IF;

  RETURN jsonb_build_object(
    'competitions', v_items,
    'totals', v_totals,
    'blockers', v_blockers,
    'can_reset', jsonb_array_length(v_blockers) = 0,
    'confirmation', format('RESETAR %s COMPETIÇÕES', cardinality(v_ids)),
    'preserved', public._reset_preserved_state(),
    'fingerprint', md5(v_fp)
  );
END;
$$;
REVOKE ALL ON FUNCTION public._reset_plan(uuid[], boolean) FROM PUBLIC, anon, authenticated;

-- ------------------------------------------------------------- preview
CREATE OR REPLACE FUNCTION public.reset_competitions_preview(p_competition_ids uuid[])
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT p || jsonb_build_object('competitions',
    COALESCE((SELECT jsonb_agg(c - 'ids') FROM jsonb_array_elements(p->'competitions') AS c), '[]'::jsonb))
  FROM (SELECT public._reset_plan(p_competition_ids, false) AS p) q;
$$;
REVOKE ALL ON FUNCTION public.reset_competitions_preview(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reset_competitions_preview(uuid[]) TO authenticated;

-- ------------------------------------------------------------- reset
CREATE OR REPLACE FUNCTION public.reset_competitions(
  p_competition_ids uuid[], p_confirmation text, p_expected_fingerprint text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_plan jsonb;
  v_item jsonb;
  v_counts jsonb;
  v_comp_id uuid;
  v_seasons uuid[];
  v_stages uuid[];
  v_rounds uuid[];
  v_matches uuid[];
  v_season_teams uuid[];
  v_snapshot jsonb;
  v_log_id uuid;
  v_logs jsonb := '[]'::jsonb;
  v_batch uuid := gen_random_uuid();
  v_before jsonb;
  v_after jsonb;
  v_messages text;
  v_n bigint;
  v_step bigint;
BEGIN
  v_plan := public._reset_plan(p_competition_ids, true);

  IF NOT (v_plan->>'can_reset')::boolean THEN
    SELECT string_agg(b->>'message', '; ') INTO v_messages FROM jsonb_array_elements(v_plan->'blockers') AS b;
    RAISE EXCEPTION 'Reset bloqueado: %', v_messages USING ERRCODE = '55000';
  END IF;
  IF p_confirmation IS DISTINCT FROM (v_plan->>'confirmation') THEN
    RAISE EXCEPTION 'Digite exatamente "%" para confirmar', v_plan->>'confirmation' USING ERRCODE = '22023';
  END IF;
  IF p_expected_fingerprint IS DISTINCT FROM (v_plan->>'fingerprint') THEN
    RAISE EXCEPTION 'Os dados mudaram desde a prévia. Abra a prévia novamente antes do reset.' USING ERRCODE = '22023';
  END IF;

  -- Registrations that must survive, frozen for the whole transaction.
  LOCK TABLE public.teams, public.players IN SHARE MODE;
  v_before := public._reset_preserved_state();

  FOR v_item IN SELECT value FROM jsonb_array_elements(v_plan->'competitions') LOOP
    v_comp_id := (v_item->>'id')::uuid;
    v_counts := v_item->'counts';
    v_seasons := ARRAY(SELECT jsonb_array_elements_text(v_item->'ids'->'seasons')::uuid);
    v_stages := ARRAY(SELECT jsonb_array_elements_text(v_item->'ids'->'stages')::uuid);
    v_rounds := ARRAY(SELECT jsonb_array_elements_text(v_item->'ids'->'rounds')::uuid);
    v_matches := ARRAY(SELECT jsonb_array_elements_text(v_item->'ids'->'matches')::uuid);
    v_season_teams := ARRAY(SELECT jsonb_array_elements_text(v_item->'ids'->'season_teams')::uuid);

    -- Copy of every row, in the order a restore inserts them.
    v_snapshot := jsonb_build_object(
      'competitions', COALESCE((SELECT jsonb_agg(to_jsonb(x)) FROM public.competitions x WHERE x.id = v_comp_id), '[]'),
      'competition_organizers', COALESCE((SELECT jsonb_agg(to_jsonb(x)) FROM public.competition_organizers x WHERE x.competition_id = v_comp_id), '[]'),
      'seasons', COALESCE((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.id) FROM public.seasons x WHERE x.id = ANY (v_seasons)), '[]'),
      'season_teams', COALESCE((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.id) FROM public.season_teams x WHERE x.id = ANY (v_season_teams)), '[]'),
      'team_registrations', COALESCE((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.id) FROM public.team_registrations x WHERE x.season_id = ANY (v_seasons)), '[]'),
      'rosters', COALESCE((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.id) FROM public.rosters x WHERE x.season_team_id = ANY (v_season_teams)), '[]'),
      'stages', COALESCE((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.id) FROM public.stages x WHERE x.id = ANY (v_stages)), '[]'),
      'stage_groups', COALESCE((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.id) FROM public.stage_groups x WHERE x.stage_id = ANY (v_stages)), '[]'),
      'stage_group_teams', COALESCE((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.id) FROM public.stage_group_teams x WHERE x.stage_id = ANY (v_stages)), '[]'),
      'rounds', COALESCE((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.id) FROM public.rounds x WHERE x.id = ANY (v_rounds)), '[]'),
      'matches', COALESCE((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.id) FROM public.matches x WHERE x.id = ANY (v_matches)), '[]'),
      'match_status_history', COALESCE((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.id) FROM public.match_status_history x WHERE x.match_id = ANY (v_matches)), '[]'),
      'match_events', COALESCE((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.id) FROM public.match_events x WHERE x.match_id = ANY (v_matches)), '[]'),
      'goalkeeper_participations', COALESCE((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.id) FROM public.goalkeeper_participations x WHERE x.match_id = ANY (v_matches)), '[]'),
      'match_streamers', COALESCE((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.match_id, x.streamer_id) FROM public.match_streamers x WHERE x.match_id = ANY (v_matches)), '[]'),
      'round_robin_pair_claims', COALESCE((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.stage_id, x.leg_number, x.team_low_id, x.team_high_id) FROM public.round_robin_pair_claims x
        WHERE x.match_id = ANY (v_matches) OR x.stage_id = ANY (v_stages)), '[]')
    );

    INSERT INTO public.deletion_log (record_kind, record_id, record_name, record_path, competition_id, competition_name,
      competition_status, deleted_by, deleted_by_role, fingerprint, counts, snapshot, reset_batch_id)
    VALUES ('COMPETITION', v_comp_id, v_item->>'name', 'Reset geral › ' || (v_item->>'name'), v_comp_id, v_item->>'name',
      v_item->>'status', auth.uid(), (SELECT role FROM public.profiles WHERE id = auth.uid()),
      v_plan->>'fingerprint', v_counts, v_snapshot, v_batch)
    RETURNING id INTO v_log_id;
    v_logs := v_logs || jsonb_build_object('log_id', v_log_id, 'competition_id', v_comp_id, 'name', v_item->>'name', 'counts', v_counts);

    INSERT INTO public.reset_match_marks (txid, match_id)
    SELECT txid_current(), x FROM unnest(v_matches) AS x;

    -- Child to parent; each count must match the plan exactly.
    DELETE FROM public.match_streamers WHERE match_id = ANY (v_matches);
    GET DIAGNOSTICS v_n = ROW_COUNT;
    IF v_n <> (v_counts->>'match_streamers')::bigint THEN RAISE EXCEPTION 'Contagem divergente em transmissões'; END IF;

    -- Goalkeeper periods created by events go with their events (ON DELETE
    -- CASCADE of source_event_id, exit_event_id is set to null); the manual
    -- ones are removed right after. Both are checked by the final count.
    SELECT count(*) INTO v_step FROM public.goalkeeper_participations WHERE match_id = ANY (v_matches);
    DELETE FROM public.match_events WHERE match_id = ANY (v_matches);
    GET DIAGNOSTICS v_n = ROW_COUNT;
    IF v_n <> (v_counts->>'match_events')::bigint THEN RAISE EXCEPTION 'Contagem divergente em eventos'; END IF;
    DELETE FROM public.goalkeeper_participations WHERE match_id = ANY (v_matches);
    IF v_step <> (v_counts->>'goalkeeper_participations')::bigint
       OR EXISTS (SELECT 1 FROM public.goalkeeper_participations WHERE match_id = ANY (v_matches)) THEN
      RAISE EXCEPTION 'Contagem divergente em participações de goleiros';
    END IF;

    DELETE FROM public.round_robin_pair_claims WHERE match_id = ANY (v_matches) OR stage_id = ANY (v_stages);
    GET DIAGNOSTICS v_n = ROW_COUNT;
    IF v_n <> (v_counts->>'round_robin_pair_claims')::bigint THEN RAISE EXCEPTION 'Contagem divergente em reservas de confronto'; END IF;
    DELETE FROM public.match_status_history WHERE match_id = ANY (v_matches);
    GET DIAGNOSTICS v_n = ROW_COUNT;
    IF v_n <> (v_counts->>'match_status_history')::bigint THEN RAISE EXCEPTION 'Contagem divergente no histórico de status'; END IF;

    -- Knockout matches reference their source matches (ON DELETE RESTRICT):
    -- remove first the ones nothing else points to, until none is left.
    v_step := 0;
    LOOP
      DELETE FROM public.matches m
      WHERE m.id = ANY (v_matches)
        AND NOT EXISTS (
          SELECT 1 FROM public.matches d
          WHERE d.id <> m.id AND (d.home_source_match_id = m.id OR d.away_source_match_id = m.id)
        );
      GET DIAGNOSTICS v_n = ROW_COUNT;
      EXIT WHEN v_n = 0;
      v_step := v_step + v_n;
    END LOOP;
    IF v_step <> (v_counts->>'matches')::bigint THEN RAISE EXCEPTION 'Contagem divergente em partidas'; END IF;

    DELETE FROM public.rounds WHERE id = ANY (v_rounds);
    GET DIAGNOSTICS v_n = ROW_COUNT;
    IF v_n <> (v_counts->>'rounds')::bigint THEN RAISE EXCEPTION 'Contagem divergente em rodadas'; END IF;
    DELETE FROM public.stage_group_teams WHERE stage_id = ANY (v_stages);
    GET DIAGNOSTICS v_n = ROW_COUNT;
    IF v_n <> (v_counts->>'stage_group_teams')::bigint THEN RAISE EXCEPTION 'Contagem divergente em equipes dos grupos'; END IF;
    DELETE FROM public.stage_groups WHERE stage_id = ANY (v_stages);
    GET DIAGNOSTICS v_n = ROW_COUNT;
    IF v_n <> (v_counts->>'stage_groups')::bigint THEN RAISE EXCEPTION 'Contagem divergente em grupos'; END IF;
    DELETE FROM public.stages WHERE id = ANY (v_stages);
    GET DIAGNOSTICS v_n = ROW_COUNT;
    IF v_n <> (v_counts->>'stages')::bigint THEN RAISE EXCEPTION 'Contagem divergente em fases'; END IF;
    DELETE FROM public.rosters WHERE season_team_id = ANY (v_season_teams);
    GET DIAGNOSTICS v_n = ROW_COUNT;
    IF v_n <> (v_counts->>'rosters')::bigint THEN RAISE EXCEPTION 'Contagem divergente em elencos'; END IF;
    DELETE FROM public.team_registrations WHERE season_id = ANY (v_seasons);
    GET DIAGNOSTICS v_n = ROW_COUNT;
    IF v_n <> (v_counts->>'team_registrations')::bigint THEN RAISE EXCEPTION 'Contagem divergente em inscrições'; END IF;
    DELETE FROM public.season_teams WHERE id = ANY (v_season_teams);
    GET DIAGNOSTICS v_n = ROW_COUNT;
    IF v_n <> (v_counts->>'season_teams')::bigint THEN RAISE EXCEPTION 'Contagem divergente em equipes da temporada'; END IF;
    DELETE FROM public.seasons WHERE id = ANY (v_seasons);
    GET DIAGNOSTICS v_n = ROW_COUNT;
    IF v_n <> (v_counts->>'seasons')::bigint THEN RAISE EXCEPTION 'Contagem divergente em temporadas'; END IF;
    DELETE FROM public.competition_organizers WHERE competition_id = v_comp_id;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    IF v_n <> (v_counts->>'competition_organizers')::bigint THEN RAISE EXCEPTION 'Contagem divergente em organizadores'; END IF;
    DELETE FROM public.competitions WHERE id = v_comp_id;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    IF v_n <> 1 THEN RAISE EXCEPTION 'Contagem divergente em competições'; END IF;

    DELETE FROM public.reset_match_marks WHERE txid = txid_current();
  END LOOP;

  -- Nothing preserved may have changed; nothing of the selection may remain.
  v_after := public._reset_preserved_state();
  IF v_after IS DISTINCT FROM v_before THEN
    RAISE EXCEPTION 'Reset interrompido: times, jogadores, streamers ou perfis mudariam (antes %, depois %)', v_before, v_after
      USING ERRCODE = '55000';
  END IF;
  IF EXISTS (SELECT 1 FROM public.competitions WHERE id = ANY (p_competition_ids))
     OR EXISTS (SELECT 1 FROM public.seasons WHERE competition_id = ANY (p_competition_ids)) THEN
    RAISE EXCEPTION 'Reset interrompido: restaram registros das competições selecionadas' USING ERRCODE = '55000';
  END IF;

  RETURN jsonb_build_object('reset_batch_id', v_batch, 'logs', v_logs, 'totals', v_plan->'totals', 'preserved', v_after);
END;
$$;
REVOKE ALL ON FUNCTION public.reset_competitions(uuid[], text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reset_competitions(uuid[], text, text) TO authenticated;

-- ------------------------------------------------------------- restore
-- Same owner-only procedure as before (never exposed to the API), now also
-- reinserting events, goalkeeper periods and streamer links. Only the tables
-- present in the log counts are compared, so older entries restore as before.
CREATE OR REPLACE FUNCTION public.restore_deleted_records(p_log_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_log public.deletion_log%ROWTYPE;
  v_tables text[] := ARRAY['competitions', 'competition_organizers', 'seasons', 'season_teams', 'team_registrations',
    'rosters', 'stages', 'stage_groups', 'stage_group_teams', 'rounds', 'matches', 'match_status_history',
    'match_events', 'goalkeeper_participations', 'match_streamers', 'round_robin_pair_claims'];
  v_table text;
  v_rows jsonb;
  v_n bigint;
  v_result jsonb := '{}'::jsonb;
BEGIN
  SELECT * INTO v_log FROM public.deletion_log WHERE id = p_log_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Registro de exclusão não encontrado' USING ERRCODE = 'P0002';
  END IF;
  IF v_log.restored_at IS NOT NULL THEN
    RAISE EXCEPTION 'Esta exclusão já foi restaurada em %', v_log.restored_at USING ERRCODE = '55000';
  END IF;

  FOREACH v_table IN ARRAY v_tables LOOP
    EXECUTE format('ALTER TABLE public.%I DISABLE TRIGGER USER', v_table);
  END LOOP;
  FOREACH v_table IN ARRAY v_tables LOOP
    v_rows := COALESCE(v_log.snapshot->v_table, '[]'::jsonb);
    IF jsonb_array_length(v_rows) > 0 AND NOT (v_log.counts ? v_table) THEN
      RAISE EXCEPTION 'Registro de exclusão inconsistente em %', v_table;
    END IF;
    IF jsonb_array_length(v_rows) > 0 THEN
      EXECUTE format('INSERT INTO public.%1$I OVERRIDING SYSTEM VALUE SELECT * FROM jsonb_populate_recordset(NULL::public.%1$I, $1)', v_table)
        USING v_rows;
      GET DIAGNOSTICS v_n = ROW_COUNT;
      IF v_n <> jsonb_array_length(v_rows) THEN
        RAISE EXCEPTION 'Restauração divergente em %', v_table;
      END IF;
    ELSE
      v_n := 0;
    END IF;
    IF v_log.counts ? v_table THEN
      v_result := v_result || jsonb_build_object(v_table, v_n);
    END IF;
  END LOOP;
  FOREACH v_table IN ARRAY v_tables LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE TRIGGER USER', v_table);
  END LOOP;

  IF v_result <> v_log.counts THEN
    RAISE EXCEPTION 'Quantidades restauradas (%) diferentes das excluídas (%)', v_result, v_log.counts;
  END IF;
  UPDATE public.deletion_log SET restored_at = now(), restored_by = current_user WHERE id = p_log_id;
  RETURN v_result;
END;
$$;
REVOKE ALL ON FUNCTION public.restore_deleted_records(uuid) FROM PUBLIC, anon, authenticated, service_role;
