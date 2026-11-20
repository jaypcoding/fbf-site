-- Group stage with SHARED rounds ("Rodada N" holds the matches of every group)
-- and retroactive results for matches played outside the system.
--
-- Additive only: new columns default to false, new functions, one new
-- trigger, and replacements of two functions whose old behaviour is kept for
-- every case except the ones described below. No existing row is changed.

-- 1. Markers shown to the public and to organizers --------------------------

ALTER TABLE public.matches
  ADD COLUMN IF NOT EXISTS duration_is_presumed boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS recorded_retroactively boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.matches.duration_is_presumed IS
  'true when duration_seconds is the presumed regulation length (14:00) because the real duration was not informed';
COMMENT ON COLUMN public.matches.recorded_retroactively IS
  'true when the result was recorded after the match was played outside the system';

-- Both markers are set only by record_retroactive_match_result() and can
-- never be changed by hand.
CREATE OR REPLACE FUNCTION public.guard_match_record_markers()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.duration_is_presumed OR NEW.recorded_retroactively THEN
      RAISE EXCEPTION 'Os marcadores de resultado recuperado são definidos pelo banco'
        USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;
  IF (NEW.duration_is_presumed IS DISTINCT FROM OLD.duration_is_presumed
      OR NEW.recorded_retroactively IS DISTINCT FROM OLD.recorded_retroactively)
     AND COALESCE(current_setting('fbf.retroactive_match', true), '') <> NEW.id::text THEN
    RAISE EXCEPTION 'Os marcadores de resultado recuperado são definidos pelo banco'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS matches_guard_record_markers ON public.matches;
CREATE TRIGGER matches_guard_record_markers
BEFORE INSERT OR UPDATE OF duration_is_presumed, recorded_retroactively ON public.matches
FOR EACH ROW EXECUTE FUNCTION public.guard_match_record_markers();

-- 2. Groups may be registered after shared rounds exist, only through ------
--    apply_group_schedule() (transaction-local marker). Otherwise unchanged.

CREATE OR REPLACE FUNCTION public.guard_stage_group_changes()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_stage_id uuid;
BEGIN
  IF TG_OP = 'DELETE' THEN
    v_stage_id := OLD.stage_id;
  ELSE
    v_stage_id := NEW.stage_id;
  END IF;
  IF TG_OP = 'INSERT'
     AND COALESCE(current_setting('fbf.group_schedule_stage', true), '') = v_stage_id::text THEN
    RETURN NEW;
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.rounds
    WHERE stage_id = v_stage_id
       OR (TG_OP = 'UPDATE' AND stage_id = OLD.stage_id)
  ) THEN
    RAISE EXCEPTION 'Não é permitido alterar grupos ou participantes depois de gerar rodadas'
      USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;

-- 3. One match per team per round; inside a group stage, only teams of the --
--    same group may meet. Applies to round-robin and group rounds of the
--    "Pontos corridos" and "Grupos + Mata-mata" formats.

CREATE OR REPLACE FUNCTION public.validate_match_round_participation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_phase_type text;
  v_stage_id uuid;
  v_stage_format text;
BEGIN
  IF TG_OP = 'UPDATE'
     AND (OLD.round_id, OLD.home_team_id, OLD.away_team_id)
       IS NOT DISTINCT FROM (NEW.round_id, NEW.home_team_id, NEW.away_team_id) THEN
    RETURN NEW;
  END IF;
  SELECT r.phase_type, r.stage_id, s.format
  INTO v_phase_type, v_stage_id, v_stage_format
  FROM public.rounds r JOIN public.stages s ON s.id = r.stage_id
  WHERE r.id = NEW.round_id;
  -- Only formats whose tables guarantee one match per team per round; legacy
  -- and custom formats keep their previous behaviour.
  IF v_phase_type IS NULL OR v_phase_type NOT IN ('ROUND_ROBIN', 'GROUP')
     OR v_stage_format NOT IN ('Pontos corridos', 'Grupos + Mata-mata') THEN
    RETURN NEW;
  END IF;

  -- Serializes concurrent writes to the same round.
  PERFORM pg_advisory_xact_lock(hashtextextended('fbf.round:' || NEW.round_id::text, 0));
  IF EXISTS (
    SELECT 1 FROM public.matches m
    WHERE m.round_id = NEW.round_id
      AND m.id <> NEW.id
      AND (
        (NEW.home_team_id IS NOT NULL AND NEW.home_team_id IN (m.home_team_id, m.away_team_id))
        OR (NEW.away_team_id IS NOT NULL AND NEW.away_team_id IN (m.home_team_id, m.away_team_id))
      )
  ) THEN
    RAISE EXCEPTION 'Uma equipe não pode ter duas partidas na mesma rodada'
      USING ERRCODE = '23514';
  END IF;

  IF v_phase_type = 'ROUND_ROBIN'
     AND v_stage_format = 'Grupos + Mata-mata'
     AND NEW.home_team_id IS NOT NULL AND NEW.away_team_id IS NOT NULL
     AND EXISTS (SELECT 1 FROM public.stage_groups WHERE stage_id = v_stage_id)
     AND NOT EXISTS (
       SELECT 1
       FROM public.stage_group_teams home_group
       JOIN public.stage_group_teams away_group
         ON away_group.stage_group_id = home_group.stage_group_id
       WHERE home_group.stage_id = v_stage_id
         AND home_group.season_team_id = NEW.home_team_id
         AND away_group.season_team_id = NEW.away_team_id
     ) THEN
    RAISE EXCEPTION 'Uma partida da fase de grupos só pode envolver equipes do mesmo grupo'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS matches_validate_round_participation ON public.matches;
CREATE TRIGGER matches_validate_round_participation
BEFORE INSERT OR UPDATE OF round_id, home_team_id, away_team_id ON public.matches
FOR EACH ROW EXECUTE FUNCTION public.validate_match_round_participation();

-- 4. Full group-stage table with shared rounds -----------------------------
--
-- p_groups:   [{"name": "Grupo A", "team_ids": [season_team_id, ...]}, ...]
-- p_matches:  [{"round_order": 1, "home_team_id": ..., "away_team_id": ...,
--               "scheduled_at": "2026-11-21T23:00:00Z" | null}, ...]
--             the COMPLETE table (every group, both legs).
-- p_existing: "<match id>:<status>,..." of the matches the organizer saw in
--             the preview, ordered by id ("" when none). If the stage changed
--             since then, nothing is written.
--
-- Existing matches are never modified; only the missing ones are inserted as
-- SCHEDULED. Calling it again with the same table changes nothing.
CREATE OR REPLACE FUNCTION public.apply_group_schedule(
  p_stage_id uuid,
  p_groups jsonb,
  p_matches jsonb,
  p_existing text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_season_id uuid;
  v_format text;
  v_settings jsonb;
  v_competition_status text;
  v_group record;
  v_group_count integer;
  v_group_size integer;
  v_team_total integer;
  v_round_total integer;
  v_first_leg_rounds integer;
  v_round record;
  v_round_id uuid;
  v_message text;
  v_existing text;
  v_groups_created boolean := false;
  v_rounds_created integer := 0;
  v_rounds_updated integer := 0;
  v_matches_created integer := 0;
  v_matches_existing integer := 0;
BEGIN
  SELECT stg.season_id, stg.format, stg.settings, c.status
  INTO v_season_id, v_format, v_settings, v_competition_status
  FROM public.stages stg
  JOIN public.seasons s ON s.id = stg.season_id
  JOIN public.competitions c ON c.id = s.competition_id
  WHERE stg.id = p_stage_id
  FOR UPDATE OF stg;
  IF v_season_id IS NULL THEN
    RAISE EXCEPTION 'Fase não encontrada' USING ERRCODE = 'P0002';
  END IF;
  IF NOT public.can_manage_season(v_season_id) THEN
    RAISE EXCEPTION 'Sem permissão para gerenciar esta fase' USING ERRCODE = '42501';
  END IF;
  IF v_competition_status NOT IN ('UPCOMING', 'REGISTRATION', 'ACTIVE') THEN
    RAISE EXCEPTION 'A tabela só pode ser gerada em competições publicadas e não encerradas'
      USING ERRCODE = '23514';
  END IF;
  IF v_format <> 'Grupos + Mata-mata' THEN
    RAISE EXCEPTION 'A fase não está configurada como grupos + mata-mata' USING ERRCODE = '23514';
  END IF;
  IF COALESCE((v_settings->>'group_legs')::integer, 1) <> 2 THEN
    RAISE EXCEPTION 'A tabela com rodadas compartilhadas exige grupos com turno e returno'
      USING ERRCODE = '23514';
  END IF;
  IF jsonb_typeof(p_groups) IS DISTINCT FROM 'array' OR jsonb_typeof(p_matches) IS DISTINCT FROM 'array'
     OR p_existing IS NULL THEN
    RAISE EXCEPTION 'Tabela inválida' USING ERRCODE = '22023';
  END IF;

  -- Groups ---------------------------------------------------------------
  DROP TABLE IF EXISTS pg_temp.fbf_schedule_groups;
  CREATE TEMP TABLE fbf_schedule_groups (
    group_order integer NOT NULL,
    name text NOT NULL,
    team_id uuid NOT NULL,
    seed_order integer NOT NULL
  ) ON COMMIT DROP;
  FOR v_group IN
    SELECT value, ordinality::integer AS group_order FROM jsonb_array_elements(p_groups) WITH ORDINALITY
  LOOP
    IF NULLIF(btrim(v_group.value->>'name'), '') IS NULL
       OR jsonb_typeof(v_group.value->'team_ids') IS DISTINCT FROM 'array' THEN
      RAISE EXCEPTION 'Cada grupo precisa de um nome e de uma lista de equipes' USING ERRCODE = '22023';
    END IF;
    INSERT INTO pg_temp.fbf_schedule_groups (group_order, name, team_id, seed_order)
    SELECT v_group.group_order, btrim(v_group.value->>'name'), team_value::uuid, team_ordinality::integer
    FROM jsonb_array_elements_text(v_group.value->'team_ids') WITH ORDINALITY AS teams(team_value, team_ordinality);
  END LOOP;

  SELECT count(DISTINCT group_order), min(group_size), max(group_size)
  INTO v_group_count, v_group_size, v_team_total
  FROM (SELECT group_order, count(*)::integer AS group_size FROM pg_temp.fbf_schedule_groups GROUP BY group_order) sizes;
  IF v_group_count IS NULL OR v_group_count < 2 THEN
    RAISE EXCEPTION 'São necessários ao menos dois grupos' USING ERRCODE = '23514';
  END IF;
  IF v_group_size <> v_team_total OR v_group_size < 2 OR v_group_size % 2 = 1 THEN
    RAISE EXCEPTION 'Todos os grupos precisam ter o mesmo número par de equipes' USING ERRCODE = '23514';
  END IF;
  IF v_settings ? 'group_count' AND (v_settings->>'group_count')::integer <> v_group_count THEN
    RAISE EXCEPTION 'A fase está configurada para % grupos, mas a tabela tem %',
      v_settings->>'group_count', v_group_count USING ERRCODE = '23514';
  END IF;
  IF (SELECT count(DISTINCT name) FROM pg_temp.fbf_schedule_groups) <> v_group_count THEN
    RAISE EXCEPTION 'Os nomes dos grupos precisam ser diferentes' USING ERRCODE = '23514';
  END IF;
  SELECT string_agg(t.name, ', ' ORDER BY t.name) INTO v_message
  FROM (SELECT team_id FROM pg_temp.fbf_schedule_groups GROUP BY team_id HAVING count(*) > 1) d
  JOIN public.season_teams st ON st.id = d.team_id JOIN public.teams t ON t.id = st.team_id;
  IF v_message IS NOT NULL THEN
    RAISE EXCEPTION 'Equipe em mais de um grupo: %', v_message USING ERRCODE = '23514';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_temp.fbf_schedule_groups g
    LEFT JOIN public.season_teams st ON st.id = g.team_id AND st.season_id = v_season_id
    WHERE st.id IS NULL
  ) THEN
    RAISE EXCEPTION 'A tabela contém uma equipe que não está inscrita na temporada' USING ERRCODE = '23514';
  END IF;
  SELECT string_agg(t.name, ', ' ORDER BY t.name) INTO v_message
  FROM public.season_teams st JOIN public.teams t ON t.id = st.team_id
  WHERE st.season_id = v_season_id
    AND NOT EXISTS (SELECT 1 FROM pg_temp.fbf_schedule_groups g WHERE g.team_id = st.id);
  IF v_message IS NOT NULL THEN
    RAISE EXCEPTION 'Equipe inscrita fora dos grupos: %', v_message USING ERRCODE = '23514';
  END IF;

  v_team_total := v_group_count * v_group_size;
  v_first_leg_rounds := v_group_size - 1;
  v_round_total := 2 * v_first_leg_rounds;

  IF EXISTS (SELECT 1 FROM public.stage_groups WHERE stage_id = p_stage_id) THEN
    IF (
      SELECT string_agg(name || ':' || team_ids, ';' ORDER BY name) FROM (
        SELECT sg.name, string_agg(sgt.season_team_id::text, ',' ORDER BY sgt.season_team_id) AS team_ids
        FROM public.stage_groups sg JOIN public.stage_group_teams sgt ON sgt.stage_group_id = sg.id
        WHERE sg.stage_id = p_stage_id GROUP BY sg.name
      ) current_groups
    ) IS DISTINCT FROM (
      SELECT string_agg(name || ':' || team_ids, ';' ORDER BY name) FROM (
        SELECT name, string_agg(team_id::text, ',' ORDER BY team_id) AS team_ids
        FROM pg_temp.fbf_schedule_groups GROUP BY name
      ) planned_groups
    ) THEN
      RAISE EXCEPTION 'Os grupos informados diferem dos grupos já cadastrados nesta fase'
        USING ERRCODE = '23514';
    END IF;
  ELSE
    PERFORM set_config('fbf.group_schedule_stage', p_stage_id::text, true);
    INSERT INTO public.stage_groups (stage_id, name, group_order)
    SELECT p_stage_id, name, group_order FROM pg_temp.fbf_schedule_groups
    GROUP BY name, group_order ORDER BY group_order;
    INSERT INTO public.stage_group_teams (stage_group_id, stage_id, season_team_id, seed_order)
    SELECT sg.id, p_stage_id, g.team_id, g.seed_order
    FROM pg_temp.fbf_schedule_groups g
    JOIN public.stage_groups sg ON sg.stage_id = p_stage_id AND sg.name = g.name;
    PERFORM set_config('fbf.group_schedule_stage', '', true);
    v_groups_created := true;
  END IF;

  -- Planned table --------------------------------------------------------
  DROP TABLE IF EXISTS pg_temp.fbf_schedule_matches;
  CREATE TEMP TABLE fbf_schedule_matches (
    round_order integer NOT NULL,
    home_team_id uuid NOT NULL,
    away_team_id uuid NOT NULL,
    scheduled_at timestamptz,
    group_order integer,
    leg integer
  ) ON COMMIT DROP;
  BEGIN
    INSERT INTO pg_temp.fbf_schedule_matches (round_order, home_team_id, away_team_id, scheduled_at)
    SELECT (value->>'round_order')::integer, (value->>'home_team_id')::uuid,
      (value->>'away_team_id')::uuid, NULLIF(value->>'scheduled_at', '')::timestamptz
    FROM jsonb_array_elements(p_matches);
  EXCEPTION WHEN others THEN
    RAISE EXCEPTION 'Tabela inválida: verifique rodadas, equipes e datas' USING ERRCODE = '22023';
  END;
  IF EXISTS (
    SELECT 1 FROM pg_temp.fbf_schedule_matches
    WHERE round_order IS NULL OR round_order < 1 OR round_order > v_round_total
       OR home_team_id = away_team_id
  ) THEN
    RAISE EXCEPTION 'A tabela precisa usar as rodadas 1 a % e equipes diferentes em cada partida', v_round_total
      USING ERRCODE = '23514';
  END IF;
  UPDATE pg_temp.fbf_schedule_matches pm
  SET group_order = home_group.group_order,
      leg = CASE WHEN pm.round_order <= v_first_leg_rounds THEN 1 ELSE 2 END
  FROM pg_temp.fbf_schedule_groups home_group, pg_temp.fbf_schedule_groups away_group
  WHERE home_group.team_id = pm.home_team_id AND away_group.team_id = pm.away_team_id
    AND home_group.group_order = away_group.group_order;
  SELECT string_agg(home_team.name || ' × ' || away_team.name, ', ') INTO v_message
  FROM pg_temp.fbf_schedule_matches pm
  JOIN public.season_teams hs ON hs.id = pm.home_team_id JOIN public.teams home_team ON home_team.id = hs.team_id
  JOIN public.season_teams aws ON aws.id = pm.away_team_id JOIN public.teams away_team ON away_team.id = aws.team_id
  WHERE pm.group_order IS NULL;
  IF v_message IS NOT NULL THEN
    RAISE EXCEPTION 'Confronto entre equipes de grupos diferentes: %', v_message USING ERRCODE = '23514';
  END IF;
  SELECT string_agg(format('Rodada %s: %s', round_order, team_name), '; ' ORDER BY round_order, team_name)
  INTO v_message
  FROM (
    SELECT p.round_order, t.name AS team_name
    FROM (
      SELECT round_order, home_team_id AS team_id FROM pg_temp.fbf_schedule_matches
      UNION ALL SELECT round_order, away_team_id FROM pg_temp.fbf_schedule_matches
    ) p
    JOIN public.season_teams st ON st.id = p.team_id JOIN public.teams t ON t.id = st.team_id
    GROUP BY p.round_order, t.name HAVING count(*) > 1
  ) repeated;
  IF v_message IS NOT NULL THEN
    RAISE EXCEPTION 'Equipe com mais de uma partida na mesma rodada: %', v_message USING ERRCODE = '23514';
  END IF;
  IF (SELECT count(*) FROM pg_temp.fbf_schedule_matches) <> v_round_total * v_team_total / 2
     OR EXISTS (
       SELECT 1 FROM generate_series(1, v_round_total) AS rounds(round_order)
       WHERE (SELECT count(*) FROM pg_temp.fbf_schedule_matches pm WHERE pm.round_order = rounds.round_order)
         <> v_team_total / 2
     ) THEN
    RAISE EXCEPTION 'A tabela precisa ter % rodadas completas com % partidas cada', v_round_total, v_team_total / 2
      USING ERRCODE = '23514';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_temp.fbf_schedule_matches
    GROUP BY leg, LEAST(home_team_id, away_team_id), GREATEST(home_team_id, away_team_id)
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'Um confronto se repete dentro do mesmo turno' USING ERRCODE = '23514';
  END IF;
  SELECT string_agg(home_team.name || ' × ' || away_team.name, ', ') INTO v_message
  FROM pg_temp.fbf_schedule_matches first_leg
  JOIN pg_temp.fbf_schedule_matches second_leg
    ON second_leg.leg = 2 AND first_leg.leg = 1
   AND LEAST(first_leg.home_team_id, first_leg.away_team_id) = LEAST(second_leg.home_team_id, second_leg.away_team_id)
   AND GREATEST(first_leg.home_team_id, first_leg.away_team_id) = GREATEST(second_leg.home_team_id, second_leg.away_team_id)
  JOIN public.season_teams hs ON hs.id = first_leg.home_team_id JOIN public.teams home_team ON home_team.id = hs.team_id
  JOIN public.season_teams aws ON aws.id = first_leg.away_team_id JOIN public.teams away_team ON away_team.id = aws.team_id
  WHERE second_leg.home_team_id = first_leg.home_team_id;
  IF v_message IS NOT NULL THEN
    RAISE EXCEPTION 'O returno precisa inverter o mando de: %', v_message USING ERRCODE = '23514';
  END IF;

  -- Rounds ---------------------------------------------------------------
  IF EXISTS (
    SELECT 1 FROM public.rounds r JOIN public.matches m ON m.round_id = r.id
    WHERE r.stage_id = p_stage_id AND (r.phase_type <> 'ROUND_ROBIN' OR r.round_order NOT BETWEEN 1 AND v_round_total)
  ) THEN
    RAISE EXCEPTION 'A fase tem partidas fora das rodadas compartilhadas 1 a %; nada foi alterado', v_round_total
      USING ERRCODE = '23514';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.rounds WHERE stage_id = p_stage_id AND round_order BETWEEN 1 AND v_round_total
    GROUP BY round_order HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'A fase tem mais de uma rodada com a mesma ordem; ajuste as rodadas antes de gerar a tabela'
      USING ERRCODE = '23514';
  END IF;

  DROP TABLE IF EXISTS pg_temp.fbf_schedule_rounds;
  CREATE TEMP TABLE fbf_schedule_rounds (round_order integer PRIMARY KEY, round_id uuid NOT NULL) ON COMMIT DROP;
  FOR v_round IN
    SELECT k AS round_order, CASE WHEN k <= v_first_leg_rounds THEN 1 ELSE 2 END AS leg
    FROM generate_series(1, v_round_total) AS k
  LOOP
    SELECT r.id INTO v_round_id FROM public.rounds r
    WHERE r.stage_id = p_stage_id AND r.round_order = v_round.round_order;
    IF v_round_id IS NULL THEN
      INSERT INTO public.rounds (stage_id, name, round_order, phase_type, leg_number)
      VALUES (p_stage_id, 'Rodada ' || v_round.round_order, v_round.round_order, 'ROUND_ROBIN', v_round.leg)
      RETURNING id INTO v_round_id;
      v_rounds_created := v_rounds_created + 1;
    ELSE
      IF EXISTS (
        SELECT 1 FROM public.rounds r
        WHERE r.id = v_round_id AND (r.phase_type <> 'ROUND_ROBIN' OR r.leg_number <> v_round.leg)
      ) THEN
        IF EXISTS (SELECT 1 FROM public.matches WHERE round_id = v_round_id) THEN
          RAISE EXCEPTION 'A rodada % já tem partidas e está marcada com o turno errado', v_round.round_order
            USING ERRCODE = '23514';
        END IF;
        UPDATE public.rounds
        SET phase_type = 'ROUND_ROBIN', stage_group_id = NULL, bracket_round = NULL, leg_number = v_round.leg
        WHERE id = v_round_id;
        v_rounds_updated := v_rounds_updated + 1;
      END IF;
    END IF;
    INSERT INTO pg_temp.fbf_schedule_rounds VALUES (v_round.round_order, v_round_id);
    v_round_id := NULL;
  END LOOP;

  -- Existing matches must be part of the table, unchanged ----------------
  SELECT COALESCE(string_agg(m.id::text || ':' || m.status, ',' ORDER BY m.id), '') INTO v_existing
  FROM public.matches m JOIN public.rounds r ON r.id = m.round_id
  WHERE r.stage_id = p_stage_id;
  IF v_existing IS DISTINCT FROM p_existing THEN
    RAISE EXCEPTION 'As partidas desta fase mudaram desde a prévia; atualize a página e revise a tabela'
      USING ERRCODE = '40001';
  END IF;
  SELECT string_agg(format('Rodada %s: %s × %s', r.round_order, home_team.name, away_team.name), '; ')
  INTO v_message
  FROM public.matches m
  JOIN public.rounds r ON r.id = m.round_id
  LEFT JOIN public.season_teams hs ON hs.id = m.home_team_id LEFT JOIN public.teams home_team ON home_team.id = hs.team_id
  LEFT JOIN public.season_teams aws ON aws.id = m.away_team_id LEFT JOIN public.teams away_team ON away_team.id = aws.team_id
  WHERE r.stage_id = p_stage_id
    AND NOT EXISTS (
      SELECT 1 FROM pg_temp.fbf_schedule_matches pm
      WHERE pm.round_order = r.round_order AND pm.home_team_id = m.home_team_id AND pm.away_team_id = m.away_team_id
    );
  IF v_message IS NOT NULL THEN
    RAISE EXCEPTION 'Partida já cadastrada não corresponde à tabela: %', v_message USING ERRCODE = '23514';
  END IF;

  -- Insert only what is missing -------------------------------------------
  SELECT count(*) INTO v_matches_existing
  FROM public.matches m JOIN public.rounds r ON r.id = m.round_id WHERE r.stage_id = p_stage_id;
  INSERT INTO public.matches (round_id, home_team_id, away_team_id, scheduled_at, status)
  SELECT sr.round_id, pm.home_team_id, pm.away_team_id, pm.scheduled_at, 'SCHEDULED'
  FROM pg_temp.fbf_schedule_matches pm
  JOIN pg_temp.fbf_schedule_rounds sr ON sr.round_order = pm.round_order
  WHERE NOT EXISTS (
    SELECT 1 FROM public.matches m
    WHERE m.round_id = sr.round_id AND m.home_team_id = pm.home_team_id AND m.away_team_id = pm.away_team_id
  )
  ORDER BY pm.round_order, pm.group_order, pm.home_team_id;
  GET DIAGNOSTICS v_matches_created = ROW_COUNT;

  RETURN jsonb_build_object(
    'groups_created', v_groups_created,
    'rounds_created', v_rounds_created,
    'rounds_updated', v_rounds_updated,
    'matches_created', v_matches_created,
    'matches_existing', v_matches_existing,
    'matches_total', v_matches_created + v_matches_existing,
    'already_complete', v_matches_created = 0 AND NOT v_groups_created AND v_rounds_created = 0 AND v_rounds_updated = 0
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.apply_group_schedule(uuid, jsonb, jsonb, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.apply_group_schedule(uuid, jsonb, jsonb, text) TO authenticated;

-- 5. Result of a match played outside the system ---------------------------
--
-- p_goals: [{"team_id": season_team_id, "player_id": uuid | null,
--            "is_own_goal": bool, "minute_seconds": int | null,
--            "assist_player_id": uuid | null}, ...]
--   team_id is the team of the player who scored (for an own goal, the team
--   whose player put the ball in his own net), as in the live panel.
--   player_id may be null (goal credited to the team only, outside the
--   scorer rankings). minute_seconds may be null: stored as 0 with
--   metadata.minute_unknown = true, and shown without a time.
-- p_duration_seconds null => 14:00, marked as presumed.
-- p_played_at null => the scheduled date is kept (no date is invented).
-- The score derived from the goals must equal p_expected_*; otherwise
-- nothing is written. Runs in one transaction: the match is never seen live.
CREATE OR REPLACE FUNCTION public.record_retroactive_match_result(
  p_match_id uuid,
  p_played_at timestamptz,
  p_duration_seconds integer,
  p_goals jsonb,
  p_expected_home_score integer,
  p_expected_away_score integer
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_match record;
  v_competition_status text;
  v_duration integer;
  v_goal record;
  v_goal_event_id uuid;
  v_minute integer;
  v_metadata jsonb;
  v_home_score integer;
  v_away_score integer;
  v_goal_count integer := 0;
BEGIN
  SELECT m.* INTO v_match FROM public.matches m WHERE m.id = p_match_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Partida não encontrada' USING ERRCODE = 'P0002';
  END IF;
  IF NOT public.can_manage_match(p_match_id) THEN
    RAISE EXCEPTION 'Sem permissão para gerenciar esta partida' USING ERRCODE = '42501';
  END IF;
  SELECT c.status INTO v_competition_status
  FROM public.rounds r JOIN public.stages stg ON stg.id = r.stage_id
  JOIN public.seasons s ON s.id = stg.season_id JOIN public.competitions c ON c.id = s.competition_id
  WHERE r.id = v_match.round_id;
  IF v_competition_status NOT IN ('UPCOMING', 'REGISTRATION', 'ACTIVE') THEN
    RAISE EXCEPTION 'Resultados só podem ser registrados em competições publicadas e não encerradas'
      USING ERRCODE = '23514';
  END IF;
  IF v_match.status NOT IN ('SCHEDULED', 'POSTPONED') THEN
    RAISE EXCEPTION 'Somente partidas agendadas ou adiadas podem receber um resultado já disputado'
      USING ERRCODE = '23514';
  END IF;
  IF v_match.home_team_id IS NULL OR v_match.away_team_id IS NULL THEN
    RAISE EXCEPTION 'A partida precisa ter as duas equipes definidas' USING ERRCODE = '23514';
  END IF;
  IF p_expected_home_score IS NULL OR p_expected_away_score IS NULL
     OR p_expected_home_score < 0 OR p_expected_away_score < 0 THEN
    RAISE EXCEPTION 'Informe o placar oficial da partida' USING ERRCODE = '22023';
  END IF;
  IF p_duration_seconds IS NOT NULL AND p_duration_seconds <= 0 THEN
    RAISE EXCEPTION 'A duração da partida deve ser maior que zero' USING ERRCODE = '23514';
  END IF;
  IF jsonb_typeof(COALESCE(p_goals, '[]'::jsonb)) <> 'array' THEN
    RAISE EXCEPTION 'Lista de gols inválida' USING ERRCODE = '22023';
  END IF;
  v_duration := COALESCE(p_duration_seconds, 840);

  PERFORM set_config('fbf.retroactive_match', p_match_id::text, true);
  IF v_match.status = 'POSTPONED' THEN
    UPDATE public.matches SET status = 'SCHEDULED' WHERE id = p_match_id;
  END IF;
  UPDATE public.matches
  SET scheduled_at = COALESCE(p_played_at, scheduled_at),
      duration_seconds = v_duration,
      duration_is_presumed = p_duration_seconds IS NULL,
      recorded_retroactively = true
  WHERE id = p_match_id;
  UPDATE public.matches SET status = 'LIVE' WHERE id = p_match_id;

  FOR v_goal IN SELECT value FROM jsonb_array_elements(COALESCE(p_goals, '[]'::jsonb))
  LOOP
    IF (v_goal.value->>'team_id')::uuid IS DISTINCT FROM v_match.home_team_id
       AND (v_goal.value->>'team_id')::uuid IS DISTINCT FROM v_match.away_team_id THEN
      RAISE EXCEPTION 'Cada gol precisa pertencer a uma das equipes da partida' USING ERRCODE = '23514';
    END IF;
    IF COALESCE((v_goal.value->>'is_own_goal')::boolean, false)
       AND NULLIF(v_goal.value->>'assist_player_id', '') IS NOT NULL THEN
      RAISE EXCEPTION 'Gol contra não tem assistência' USING ERRCODE = '23514';
    END IF;
    IF NULLIF(v_goal.value->>'assist_player_id', '') IS NOT NULL
       AND NULLIF(v_goal.value->>'player_id', '') IS NULL THEN
      RAISE EXCEPTION 'Assistência só pode ser registrada em gol com autor' USING ERRCODE = '23514';
    END IF;
    IF NULLIF(v_goal.value->>'assist_player_id', '') IS NOT NULL
       AND NULLIF(v_goal.value->>'assist_player_id', '') = NULLIF(v_goal.value->>'player_id', '') THEN
      RAISE EXCEPTION 'O autor do gol não pode ser também o autor da assistência' USING ERRCODE = '23514';
    END IF;
    v_minute := NULLIF(v_goal.value->>'minute_seconds', '')::integer;
    v_metadata := jsonb_build_object('source', 'RETROACTIVE');
    IF v_minute IS NULL THEN
      v_minute := 0;
      v_metadata := v_metadata || jsonb_build_object('minute_unknown', true);
    END IF;
    INSERT INTO public.match_events (
      match_id, event_type, minute_seconds, period, team_id, player_id, is_own_goal, metadata
    ) VALUES (
      p_match_id, 'GOAL', v_minute, 'REGULATION', (v_goal.value->>'team_id')::uuid,
      NULLIF(v_goal.value->>'player_id', '')::uuid,
      COALESCE((v_goal.value->>'is_own_goal')::boolean, false), v_metadata
    ) RETURNING id INTO v_goal_event_id;
    IF NULLIF(v_goal.value->>'assist_player_id', '') IS NOT NULL THEN
      INSERT INTO public.match_events (
        match_id, event_type, minute_seconds, period, team_id, player_id, goal_event_id, metadata
      ) VALUES (
        p_match_id, 'ASSIST', v_minute, 'REGULATION', (v_goal.value->>'team_id')::uuid,
        (v_goal.value->>'assist_player_id')::uuid, v_goal_event_id, v_metadata
      );
    END IF;
    v_goal_count := v_goal_count + 1;
  END LOOP;

  UPDATE public.matches SET status = 'FINISHED' WHERE id = p_match_id
  RETURNING home_score, away_score INTO v_home_score, v_away_score;
  IF v_home_score IS DISTINCT FROM p_expected_home_score OR v_away_score IS DISTINCT FROM p_expected_away_score THEN
    RAISE EXCEPTION 'Os gols informados resultam em % × %, mas o placar oficial é % × %; nada foi registrado',
      v_home_score, v_away_score, p_expected_home_score, p_expected_away_score USING ERRCODE = '23514';
  END IF;
  PERFORM set_config('fbf.retroactive_match', '', true);

  RETURN jsonb_build_object(
    'home_score', v_home_score,
    'away_score', v_away_score,
    'goals', v_goal_count,
    'duration_seconds', v_duration,
    'duration_is_presumed', p_duration_seconds IS NULL
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.record_retroactive_match_result(uuid, timestamptz, integer, jsonb, integer, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_retroactive_match_result(uuid, timestamptz, integer, jsonb, integer, integer) TO authenticated;

-- 6. Knockout after a group stage played in shared rounds ------------------
-- Same function as in 20261103100000_competition_format_support.sql; the only
-- change is that the two group-phase checks also accept the shared
-- ROUND_ROBIN rounds of a "Grupos + Mata-mata" stage (groups still required).
CREATE OR REPLACE FUNCTION public.generate_knockout_stage(
  p_stage_id uuid,
  p_series jsonb,
  p_legs integer
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_season_id uuid;
  v_format text;
  v_series record;
  v_fixture jsonb;
  v_home jsonb;
  v_away jsonb;
  v_home_team uuid;
  v_away_team uuid;
  v_home_source uuid;
  v_away_source uuid;
  v_home_outcome text;
  v_away_outcome text;
  v_round_id uuid;
  v_series_id uuid;
  v_match_id uuid;
  v_last_match_id uuid;
  v_round_order integer;
  v_round_ids jsonb := '{}'::jsonb;
  v_series_ids jsonb := '{}'::jsonb;
  v_last_match_ids jsonb := '{}'::jsonb;
  v_key text;
  v_round integer;
  v_match_count integer := 0;
  v_source_key text;
  v_source_rounds jsonb := '{}'::jsonb;
  v_source_refs jsonb := '{}'::jsonb;
  v_source_ref_key text;
  v_team_ids uuid[] := ARRAY[]::uuid[];
  v_eligible_team_ids uuid[];
  v_order_clause text;
  v_order_sql text;
  v_qualifiers_per_group integer;
  v_leg integer;
BEGIN
  SELECT season_id, format INTO v_season_id, v_format
  FROM public.stages WHERE id = p_stage_id FOR UPDATE;
  IF v_season_id IS NULL THEN RAISE EXCEPTION 'Fase não encontrada' USING ERRCODE = 'P0002'; END IF;
  IF NOT public.can_manage_season(v_season_id) THEN
    RAISE EXCEPTION 'Sem permissão para gerenciar esta fase' USING ERRCODE = '42501';
  END IF;
  IF v_format NOT IN ('Mata-mata', 'Grupos + Mata-mata') THEN
    RAISE EXCEPTION 'A fase não está configurada para mata-mata' USING ERRCODE = '23514';
  END IF;
  IF p_legs IS NULL OR p_legs NOT IN (1, 2)
     OR jsonb_typeof(p_series) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'Plano de mata-mata inválido' USING ERRCODE = '22023';
  END IF;
  IF jsonb_array_length(p_series) < 1 THEN
    RAISE EXCEPTION 'Plano de mata-mata inválido' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.rounds r
    JOIN public.matches m ON m.round_id = r.id
    WHERE r.stage_id = p_stage_id AND r.phase_type = 'KNOCKOUT'
  ) THEN
    RAISE EXCEPTION 'A chave já foi gerada; partidas existentes não foram alteradas'
      USING ERRCODE = '23514';
  END IF;
  IF v_format = 'Mata-mata' AND EXISTS (
    SELECT 1 FROM public.matches m
    JOIN public.rounds r ON r.id = m.round_id
    WHERE r.stage_id = p_stage_id
  ) THEN
    RAISE EXCEPTION 'Gere a chave apenas antes de cadastrar partidas manuais'
      USING ERRCODE = '23514';
  END IF;
  IF v_format = 'Grupos + Mata-mata' AND (
    NOT EXISTS (SELECT 1 FROM public.stage_groups WHERE stage_id = p_stage_id)
    OR EXISTS (
      SELECT 1
      FROM public.rounds r
      JOIN public.matches m ON m.round_id = r.id
      WHERE r.stage_id = p_stage_id AND r.phase_type IN ('GROUP', 'ROUND_ROBIN')
        AND m.status <> 'FINISHED'
    )
    OR NOT EXISTS (
      SELECT 1 FROM public.matches m
      JOIN public.rounds r ON r.id = m.round_id
      WHERE r.stage_id = p_stage_id AND r.phase_type IN ('GROUP', 'ROUND_ROBIN')
    )
  ) THEN
    RAISE EXCEPTION 'Finalize todas as partidas dos grupos antes de gerar a chave'
      USING ERRCODE = '23514';
  END IF;
  IF v_format = 'Grupos + Mata-mata' THEN
    SELECT (settings->>'qualifiers_per_group')::integer
    INTO v_qualifiers_per_group
    FROM public.stages WHERE id = p_stage_id;
    IF v_qualifiers_per_group IS NULL OR v_qualifiers_per_group < 1 THEN
      RAISE EXCEPTION 'Configure a quantidade de classificados por grupo antes da chave'
        USING ERRCODE = '23514';
    END IF;
    SELECT string_agg(
      CASE criterion
        WHEN 'POINTS' THEN 'points DESC'
        WHEN 'WINS' THEN 'wins DESC'
        WHEN 'DRAWS' THEN 'draws DESC'
        WHEN 'LOSSES' THEN 'losses ASC'
        WHEN 'GOAL_DIFF' THEN '(goals_for - goals_against) DESC'
        WHEN 'GOALS_FOR' THEN 'goals_for DESC'
        WHEN 'GOALS_AGAINST' THEN 'goals_against ASC'
        WHEN 'TEAM_NAME' THEN 'team_name COLLATE "C" ASC'
      END,
      ', ' ORDER BY position
    )
    INTO v_order_clause
    FROM public.stages st
    CROSS JOIN LATERAL unnest(st.tie_breakers) WITH ORDINALITY AS criteria(criterion, position)
    WHERE st.id = p_stage_id;
    v_order_sql := format(
      'SELECT array_agg(team_id ORDER BY team_id) FROM (
         SELECT season_team_id AS team_id, row_number() OVER (
           PARTITION BY stage_group_id ORDER BY %s, team_name COLLATE "C" ASC
         ) AS group_rank
         FROM public.stage_standings
         WHERE stage_id = $1 AND stage_group_id IS NOT NULL
       ) ranked WHERE group_rank <= $2',
      v_order_clause
    );
    EXECUTE v_order_sql INTO v_eligible_team_ids
      USING p_stage_id, v_qualifiers_per_group;
  ELSE
    SELECT COALESCE(array_agg(id ORDER BY id), ARRAY[]::uuid[])
    INTO v_eligible_team_ids
    FROM public.season_teams
    WHERE season_id = v_season_id;
  END IF;

  SELECT COALESCE(max(round_order), 0) + 1 INTO v_round_order
  FROM public.rounds WHERE stage_id = p_stage_id;

  FOR v_series IN
    SELECT value, ordinality::integer AS position
    FROM jsonb_array_elements(p_series) WITH ORDINALITY
    ORDER BY ordinality
  LOOP
    v_fixture := v_series.value;
    v_key := v_fixture->>'key';
    v_round := (v_fixture->>'round')::integer;
    IF NULLIF(v_key, '') IS NULL OR v_round < 1
       OR v_series_ids ? v_key THEN
      RAISE EXCEPTION 'A chave possui identificadores ou rodadas inválidos'
        USING ERRCODE = '23514';
    END IF;
    IF COALESCE((v_fixture->>'legs')::integer, p_legs) <> p_legs THEN
      RAISE EXCEPTION 'Todas as partidas da chave precisam usar o mesmo número de jogos'
        USING ERRCODE = '23514';
    END IF;
    v_home := v_fixture->'home';
    v_away := v_fixture->'away';
    v_home_team := NULL;
    v_away_team := NULL;
    v_home_source := NULL;
    v_away_source := NULL;
    v_home_outcome := NULL;
    v_away_outcome := NULL;

    IF v_home->>'kind' = 'team' THEN v_home_team := (v_home->>'teamId')::uuid;
    ELSIF v_home->>'kind' IN ('winner', 'loser') THEN
      v_source_key := v_home->>'sourceKey';
      IF NULLIF(v_source_key, '') IS NULL THEN
        RAISE EXCEPTION 'A origem da equipe mandante precisa identificar um confronto';
      END IF;
      v_source_ref_key := jsonb_build_array(v_source_key, upper(v_home->>'kind'))::text;
      IF v_source_refs ? v_source_ref_key THEN
        RAISE EXCEPTION 'Uma posição de classificação não pode alimentar mais de um confronto'
          USING ERRCODE = '23514';
      END IF;
      v_source_refs := jsonb_set(v_source_refs, ARRAY[v_source_ref_key], 'true'::jsonb, true);
      v_home_source := (v_last_match_ids->>v_source_key)::uuid;
      v_home_outcome := upper(v_home->>'kind');
      IF v_home_source IS NULL OR (v_source_rounds->>v_source_key)::integer >= v_round THEN
        RAISE EXCEPTION 'A origem do time mandante precisa vir de uma fase anterior';
      END IF;
    ELSE RAISE EXCEPTION 'Posição mandante inválida'; END IF;

    IF v_away->>'kind' = 'team' THEN v_away_team := (v_away->>'teamId')::uuid;
    ELSIF v_away->>'kind' IN ('winner', 'loser') THEN
      v_source_key := v_away->>'sourceKey';
      IF NULLIF(v_source_key, '') IS NULL THEN
        RAISE EXCEPTION 'A origem da equipe visitante precisa identificar um confronto';
      END IF;
      v_source_ref_key := jsonb_build_array(v_source_key, upper(v_away->>'kind'))::text;
      IF v_source_refs ? v_source_ref_key THEN
        RAISE EXCEPTION 'Uma posição de classificação não pode alimentar mais de um confronto'
          USING ERRCODE = '23514';
      END IF;
      v_source_refs := jsonb_set(v_source_refs, ARRAY[v_source_ref_key], 'true'::jsonb, true);
      v_away_source := (v_last_match_ids->>v_source_key)::uuid;
      v_away_outcome := upper(v_away->>'kind');
      IF v_away_source IS NULL OR (v_source_rounds->>v_source_key)::integer >= v_round THEN
        RAISE EXCEPTION 'A origem do time visitante precisa vir de uma fase anterior';
      END IF;
    ELSE RAISE EXCEPTION 'Posição visitante inválida'; END IF;

    IF v_home_source IS NOT NULL AND v_home_source = v_away_source THEN
      RAISE EXCEPTION 'Uma partida não pode emparelhar vencedor e perdedor do mesmo confronto'
        USING ERRCODE = '23514';
    END IF;
    IF v_home_team IS NOT NULL AND v_away_team IS NOT NULL
       AND v_home_team = v_away_team THEN
      RAISE EXCEPTION 'Uma equipe não pode enfrentar a si mesma' USING ERRCODE = '23514';
    END IF;
    IF v_format = 'Grupos + Mata-mata'
       AND v_home_team IS NOT NULL AND v_away_team IS NOT NULL THEN
      IF (
        SELECT stage_group_id FROM public.stage_group_teams
        WHERE stage_id = p_stage_id AND season_team_id = v_home_team
      ) = (
        SELECT stage_group_id FROM public.stage_group_teams
        WHERE stage_id = p_stage_id AND season_team_id = v_away_team
      ) THEN
        RAISE EXCEPTION 'A chave eliminatória não pode emparelhar equipes do mesmo grupo'
          USING ERRCODE = '23514';
      END IF;
    END IF;
    IF v_home_team IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.season_teams WHERE id = v_home_team AND season_id = v_season_id
    ) OR v_away_team IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.season_teams WHERE id = v_away_team AND season_id = v_season_id
    ) THEN
      RAISE EXCEPTION 'Uma equipe da chave não está aprovada na temporada'
        USING ERRCODE = '23514';
    END IF;

    IF NOT COALESCE((v_fixture->>'thirdPlace')::boolean, false) THEN
      IF v_home_team IS NOT NULL THEN v_team_ids := array_append(v_team_ids, v_home_team); END IF;
      IF v_away_team IS NOT NULL THEN v_team_ids := array_append(v_team_ids, v_away_team); END IF;
    END IF;
    v_series_id := gen_random_uuid();
    IF COALESCE((v_fixture->>'thirdPlace')::boolean, false) THEN
      INSERT INTO public.rounds (
        stage_id, name, round_order, phase_type, bracket_round, leg_number
      ) VALUES (
        p_stage_id, 'Disputa do terceiro lugar', v_round_order, 'KNOCKOUT', v_round, 1
      ) RETURNING id INTO v_round_id;
      v_round_order := v_round_order + 1;
    ELSE
      IF NOT (v_round_ids ? (v_round::text)) THEN
        INSERT INTO public.rounds (
          stage_id, name, round_order, phase_type, bracket_round, leg_number
        ) VALUES (
          p_stage_id, 'Fase eliminatória ' || v_round, v_round_order, 'KNOCKOUT', v_round, 1
        ) RETURNING id INTO v_round_id;
        v_round_ids := jsonb_set(v_round_ids, ARRAY[v_round::text], to_jsonb(v_round_id::text));
        v_round_order := v_round_order + 1;
      ELSE
        v_round_id := (v_round_ids->>v_round::text)::uuid;
      END IF;
    END IF;

    FOR v_leg IN 1..p_legs LOOP
      INSERT INTO public.matches (
        round_id, home_team_id, away_team_id, status,
        series_id, series_leg,
        home_source_match_id, home_source_outcome,
        away_source_match_id, away_source_outcome
      ) VALUES (
        v_round_id,
        CASE WHEN v_leg = 2 THEN v_away_team ELSE v_home_team END,
        CASE WHEN v_leg = 2 THEN v_home_team ELSE v_away_team END,
        'SCHEDULED',
        v_series_id, v_leg,
        CASE WHEN v_leg = 2 THEN v_away_source ELSE v_home_source END,
        CASE WHEN v_leg = 2 THEN v_away_outcome ELSE v_home_outcome END,
        CASE WHEN v_leg = 2 THEN v_home_source ELSE v_away_source END,
        CASE WHEN v_leg = 2 THEN v_home_outcome ELSE v_away_outcome END
      ) RETURNING id INTO v_match_id;
      v_last_match_id := v_match_id;
      v_match_count := v_match_count + 1;
    END LOOP;
    v_series_ids := jsonb_set(v_series_ids, ARRAY[v_key], to_jsonb(v_series_id::text));
    v_last_match_ids := jsonb_set(v_last_match_ids, ARRAY[v_key], to_jsonb(v_last_match_id::text));
    v_source_rounds := jsonb_set(v_source_rounds, ARRAY[v_key], to_jsonb(v_round));
  END LOOP;

  IF cardinality(v_team_ids) <> cardinality(ARRAY(SELECT DISTINCT unnest(v_team_ids))) THEN
    RAISE EXCEPTION 'Uma equipe aparece em mais de um confronto inicial da chave'
      USING ERRCODE = '23514';
  END IF;
  IF cardinality(v_team_ids) < 2 THEN
    RAISE EXCEPTION 'A chave precisa conter ao menos duas equipes classificadas'
      USING ERRCODE = '23514';
  END IF;
  IF ARRAY(SELECT DISTINCT unnest(v_team_ids) ORDER BY 1)
     IS DISTINCT FROM v_eligible_team_ids THEN
    RAISE EXCEPTION 'A chave deve conter exatamente as equipes classificadas para esta fase'
      USING ERRCODE = '23514';
  END IF;
  RETURN jsonb_build_object('matches', v_match_count, 'series', jsonb_array_length(p_series));
END;
$$;

REVOKE EXECUTE ON FUNCTION public.generate_knockout_stage(uuid, jsonb, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.generate_knockout_stage(uuid, jsonb, integer) TO authenticated;

-- 7. Goals credited only to the team in retroactive results -----------------
-- Same function as in 20261102140000_match_domain_integrity.sql; the only
-- change is that a GOAL without player is accepted when the match was recorded
-- retroactively. Every other event, and every live event, still needs a player
-- from the team's roster. Statistics already ignore events without player.
CREATE OR REPLACE FUNCTION public.validate_match_event()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_match public.matches%ROWTYPE;
  v_goal public.match_events%ROWTYPE;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.match_id IS DISTINCT FROM OLD.match_id THEN
    RAISE EXCEPTION 'Não é permitido mover um evento para outra partida'
      USING ERRCODE = '23514';
  END IF;

  SELECT * INTO v_match
  FROM public.matches
  WHERE id = NEW.match_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Partida não encontrada' USING ERRCODE = '23503';
  END IF;
  IF v_match.status NOT IN ('LIVE', 'FINISHED') THEN
    RAISE EXCEPTION 'Eventos só podem ser registrados em partidas ao vivo ou finalizadas'
      USING ERRCODE = '23514';
  END IF;
  IF NEW.minute_seconds < 0
     OR (v_match.duration_seconds IS NOT NULL AND NEW.minute_seconds > v_match.duration_seconds) THEN
    RAISE EXCEPTION 'O minuto do evento está fora da duração da partida'
      USING ERRCODE = '23514';
  END IF;
  IF NEW.period NOT IN ('REGULATION', 'EXTRA_TIME', 'PENALTY_SHOOTOUT') THEN
    RAISE EXCEPTION 'Período de evento inválido' USING ERRCODE = '22023';
  END IF;
  IF NEW.team_id IS NULL
     OR (NEW.team_id IS DISTINCT FROM v_match.home_team_id
         AND NEW.team_id IS DISTINCT FROM v_match.away_team_id) THEN
    RAISE EXCEPTION 'O evento precisa pertencer a um dos times da partida'
      USING ERRCODE = '23514';
  END IF;
  IF NEW.player_id IS NULL THEN
    -- A goal credited only to the team is accepted solely in results recorded
    -- after the match (record_retroactive_match_result); live events always
    -- name the player.
    IF NOT (NEW.event_type = 'GOAL' AND v_match.recorded_retroactively) THEN
      RAISE EXCEPTION 'O jogador não pertence ao elenco do time informado'
        USING ERRCODE = '23514';
    END IF;
  ELSIF NOT EXISTS (
    SELECT 1 FROM public.rosters
    WHERE season_team_id = NEW.team_id AND player_id = NEW.player_id
  ) THEN
    RAISE EXCEPTION 'O jogador não pertence ao elenco do time informado'
      USING ERRCODE = '23514';
  END IF;
  IF NEW.related_player_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.rosters
    WHERE season_team_id = NEW.team_id AND player_id = NEW.related_player_id
  ) THEN
    RAISE EXCEPTION 'O jogador relacionado não pertence ao elenco do time informado'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.event_type = 'ASSIST' THEN
    IF NEW.goal_event_id IS NULL THEN
      RAISE EXCEPTION 'A assistência precisa estar vinculada a um gol válido'
        USING ERRCODE = '23514';
    END IF;
    SELECT * INTO v_goal
    FROM public.match_events
    WHERE id = NEW.goal_event_id;
    IF NOT FOUND
       OR v_goal.match_id <> NEW.match_id
       OR v_goal.event_type <> 'GOAL'
       OR v_goal.is_own_goal
       OR v_goal.period = 'PENALTY_SHOOTOUT'
       OR v_goal.team_id <> NEW.team_id
       OR v_goal.player_id = NEW.player_id
       OR v_goal.minute_seconds <> NEW.minute_seconds
       OR v_goal.period <> NEW.period THEN
      RAISE EXCEPTION 'A assistência não corresponde a um gol válido do mesmo time, minuto e período'
        USING ERRCODE = '23514';
    END IF;
  ELSIF NEW.goal_event_id IS NOT NULL THEN
    RAISE EXCEPTION 'Somente assistências podem referenciar um evento de gol'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.is_own_goal AND NEW.event_type <> 'GOAL' THEN
    RAISE EXCEPTION 'Somente um evento de gol pode ser marcado como gol contra'
      USING ERRCODE = '23514';
  END IF;
  IF NEW.period = 'PENALTY_SHOOTOUT'
     AND (NEW.event_type <> 'GOAL' OR NEW.is_own_goal) THEN
    RAISE EXCEPTION 'A disputa de pênaltis aceita somente gols válidos, não gols contra ou outros eventos'
      USING ERRCODE = '23514';
  END IF;
  IF NEW.event_type = 'SUBSTITUTION'
     AND (NEW.related_player_id IS NULL OR NEW.related_player_id = NEW.player_id) THEN
    RAISE EXCEPTION 'A substituição precisa indicar dois jogadores diferentes'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;
