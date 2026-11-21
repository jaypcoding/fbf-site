-- Knockout ties with their own number of games (e.g. two-legged semifinals and
-- a single-match final).
--
-- Same function as in 20261120120000_group_schedule_recovery.sql. The only
-- changes:
--   * each series uses its "legs" (1 or 2) when given, otherwise p_legs; the
--     former rule "every series must use the same number of games" is dropped;
--   * the loop that creates the games uses that per-series value.
-- Winners, aggregates and penalties are already resolved per series
-- (knockout_series_winner / propagate_knockout_result), so nothing else changes.
-- A plan without "legs" behaves exactly as before.
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
  v_series_legs integer;
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
    BEGIN
      v_series_legs := COALESCE((v_fixture->>'legs')::integer, p_legs);
    EXCEPTION WHEN others THEN
      RAISE EXCEPTION 'Plano de mata-mata inválido' USING ERRCODE = '22023';
    END;
    IF v_series_legs NOT IN (1, 2) THEN
      RAISE EXCEPTION 'Cada confronto da chave precisa ter 1 ou 2 jogos'
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

    FOR v_leg IN 1..v_series_legs LOOP
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
