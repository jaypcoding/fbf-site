-- Register the groups of a group stage WITHOUT generating matches.
--
-- A "Grupos + Mata-mata" stage whose rounds were created by hand has no groups,
-- so its standings show a single table. The full table generator
-- (apply_group_schedule) registers groups only together with every match.
-- This function registers only the groups; rounds and matches are untouched,
-- and apply_group_schedule() later accepts the same groups.
--
-- p_groups: [{"name": "Grupo A", "team_ids": [season_team_id, ...]}, ...]
-- Every approved team of the season exactly once, equal group sizes, the group
-- count configured in the stage, and every existing match between teams of the
-- same group. Calling it again with the same groups changes nothing.
CREATE OR REPLACE FUNCTION public.register_stage_groups(p_stage_id uuid, p_groups jsonb)
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
  v_min_size integer;
  v_max_size integer;
  v_message text;
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
    RAISE EXCEPTION 'Os grupos só podem ser registrados em competições publicadas e não encerradas'
      USING ERRCODE = '23514';
  END IF;
  IF v_format <> 'Grupos + Mata-mata' THEN
    RAISE EXCEPTION 'A fase não está configurada como grupos + mata-mata' USING ERRCODE = '23514';
  END IF;
  IF jsonb_typeof(p_groups) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'Lista de grupos inválida' USING ERRCODE = '22023';
  END IF;

  DROP TABLE IF EXISTS pg_temp.fbf_register_groups;
  CREATE TEMP TABLE fbf_register_groups (
    group_order integer NOT NULL,
    name text NOT NULL,
    team_id uuid NOT NULL,
    seed_order integer NOT NULL
  ) ON COMMIT DROP;
  FOR v_group IN
    SELECT value, ordinality::integer AS group_order FROM jsonb_array_elements(p_groups) WITH ORDINALITY
  LOOP
    IF NULLIF(btrim(v_group.value->>'name'), '') IS NULL
       OR jsonb_typeof(v_group.value->'team_ids') IS DISTINCT FROM 'array'
       OR jsonb_array_length(v_group.value->'team_ids') = 0 THEN
      RAISE EXCEPTION 'Cada grupo precisa de um nome e de uma lista de equipes' USING ERRCODE = '22023';
    END IF;
    BEGIN
      INSERT INTO pg_temp.fbf_register_groups (group_order, name, team_id, seed_order)
      SELECT v_group.group_order, btrim(v_group.value->>'name'), team_value::uuid, team_ordinality::integer
      FROM jsonb_array_elements_text(v_group.value->'team_ids') WITH ORDINALITY AS teams(team_value, team_ordinality);
    EXCEPTION WHEN invalid_text_representation THEN
      RAISE EXCEPTION 'Lista de grupos inválida: identificador de equipe incorreto' USING ERRCODE = '22023';
    END;
  END LOOP;

  SELECT count(*), min(group_size), max(group_size)
  INTO v_group_count, v_min_size, v_max_size
  FROM (SELECT group_order, count(*)::integer AS group_size FROM pg_temp.fbf_register_groups GROUP BY group_order) sizes;
  IF v_group_count < 2 THEN
    RAISE EXCEPTION 'São necessários ao menos dois grupos' USING ERRCODE = '23514';
  END IF;
  IF v_min_size <> v_max_size OR v_min_size < 2 THEN
    RAISE EXCEPTION 'Todos os grupos precisam ter o mesmo número de equipes' USING ERRCODE = '23514';
  END IF;
  IF v_settings ? 'group_count' AND (v_settings->>'group_count')::integer <> v_group_count THEN
    RAISE EXCEPTION 'A fase está configurada para % grupos, mas foram informados %',
      v_settings->>'group_count', v_group_count USING ERRCODE = '23514';
  END IF;
  IF (SELECT count(DISTINCT name) FROM pg_temp.fbf_register_groups) <> v_group_count THEN
    RAISE EXCEPTION 'Os nomes dos grupos precisam ser diferentes' USING ERRCODE = '23514';
  END IF;
  SELECT string_agg(t.name, ', ' ORDER BY t.name) INTO v_message
  FROM (SELECT team_id FROM pg_temp.fbf_register_groups GROUP BY team_id HAVING count(*) > 1) d
  JOIN public.season_teams st ON st.id = d.team_id JOIN public.teams t ON t.id = st.team_id;
  IF v_message IS NOT NULL THEN
    RAISE EXCEPTION 'Equipe em mais de um grupo: %', v_message USING ERRCODE = '23514';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_temp.fbf_register_groups g
    LEFT JOIN public.season_teams st ON st.id = g.team_id AND st.season_id = v_season_id
    WHERE st.id IS NULL
  ) THEN
    RAISE EXCEPTION 'A lista contém uma equipe que não está inscrita na temporada' USING ERRCODE = '23514';
  END IF;
  SELECT string_agg(t.name, ', ' ORDER BY t.name) INTO v_message
  FROM public.season_teams st JOIN public.teams t ON t.id = st.team_id
  WHERE st.season_id = v_season_id
    AND NOT EXISTS (SELECT 1 FROM pg_temp.fbf_register_groups g WHERE g.team_id = st.id);
  IF v_message IS NOT NULL THEN
    RAISE EXCEPTION 'Equipe inscrita fora dos grupos: %', v_message USING ERRCODE = '23514';
  END IF;

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
        FROM pg_temp.fbf_register_groups GROUP BY name
      ) planned_groups
    ) THEN
      RAISE EXCEPTION 'A fase já tem grupos diferentes destes; nada foi alterado' USING ERRCODE = '23514';
    END IF;
    RETURN jsonb_build_object('groups_created', false, 'already_registered', true, 'groups', v_group_count);
  END IF;

  -- Every match already in the stage must be between teams of the same group.
  SELECT string_agg(format('%s × %s', home_team.name, away_team.name), '; ') INTO v_message
  FROM public.matches m
  JOIN public.rounds r ON r.id = m.round_id AND r.stage_id = p_stage_id
  JOIN public.season_teams hs ON hs.id = m.home_team_id JOIN public.teams home_team ON home_team.id = hs.team_id
  JOIN public.season_teams aws ON aws.id = m.away_team_id JOIN public.teams away_team ON away_team.id = aws.team_id
  WHERE NOT EXISTS (
    SELECT 1 FROM pg_temp.fbf_register_groups a
    JOIN pg_temp.fbf_register_groups b ON b.group_order = a.group_order
    WHERE a.team_id = m.home_team_id AND b.team_id = m.away_team_id
  );
  IF v_message IS NOT NULL THEN
    RAISE EXCEPTION 'Partida já cadastrada entre equipes de grupos diferentes: %', v_message
      USING ERRCODE = '23514';
  END IF;

  PERFORM set_config('fbf.group_schedule_stage', p_stage_id::text, true);
  INSERT INTO public.stage_groups (stage_id, name, group_order)
  SELECT p_stage_id, name, group_order FROM pg_temp.fbf_register_groups
  GROUP BY name, group_order ORDER BY group_order;
  INSERT INTO public.stage_group_teams (stage_group_id, stage_id, season_team_id, seed_order)
  SELECT sg.id, p_stage_id, g.team_id, g.seed_order
  FROM pg_temp.fbf_register_groups g
  JOIN public.stage_groups sg ON sg.stage_id = p_stage_id AND sg.name = g.name;
  PERFORM set_config('fbf.group_schedule_stage', '', true);

  RETURN jsonb_build_object('groups_created', true, 'already_registered', false, 'groups', v_group_count);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.register_stage_groups(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.register_stage_groups(uuid, jsonb) TO authenticated;
