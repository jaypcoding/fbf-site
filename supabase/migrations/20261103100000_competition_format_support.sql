BEGIN;

CREATE TABLE IF NOT EXISTS public.stage_groups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  stage_id uuid NOT NULL REFERENCES public.stages(id) ON DELETE CASCADE,
  name text NOT NULL,
  group_order integer NOT NULL CHECK (group_order > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, stage_id),
  UNIQUE (stage_id, name),
  UNIQUE (stage_id, group_order)
);

CREATE TABLE IF NOT EXISTS public.stage_group_teams (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  stage_group_id uuid NOT NULL,
  stage_id uuid NOT NULL REFERENCES public.stages(id) ON DELETE CASCADE,
  season_team_id uuid NOT NULL REFERENCES public.season_teams(id) ON DELETE RESTRICT,
  seed_order integer NOT NULL CHECK (seed_order > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (stage_group_id, stage_id)
    REFERENCES public.stage_groups(id, stage_id) ON DELETE CASCADE,
  UNIQUE (stage_id, season_team_id),
  UNIQUE (stage_group_id, season_team_id),
  UNIQUE (stage_group_id, seed_order)
);

CREATE INDEX IF NOT EXISTS stage_groups_stage_order_idx
  ON public.stage_groups(stage_id, group_order);
CREATE INDEX IF NOT EXISTS stage_group_teams_group_order_idx
  ON public.stage_group_teams(stage_group_id, seed_order);

ALTER TABLE public.stages
  ADD COLUMN IF NOT EXISTS settings jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE public.rounds
  ADD COLUMN IF NOT EXISTS phase_type text NOT NULL DEFAULT 'ROUND_ROBIN',
  ADD COLUMN IF NOT EXISTS stage_group_id uuid REFERENCES public.stage_groups(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS leg_number integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS bracket_round integer;
ALTER TABLE public.matches
  ADD COLUMN IF NOT EXISTS series_id uuid,
  ADD COLUMN IF NOT EXISTS series_leg integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS home_source_match_id uuid REFERENCES public.matches(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS home_source_outcome text,
  ADD COLUMN IF NOT EXISTS away_source_match_id uuid REFERENCES public.matches(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS away_source_outcome text;
CREATE UNIQUE INDEX IF NOT EXISTS matches_series_leg_unique_idx
  ON public.matches(series_id, series_leg)
  WHERE series_id IS NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'rounds_phase_type_valid') THEN
    ALTER TABLE public.rounds ADD CONSTRAINT rounds_phase_type_valid
      CHECK (phase_type IN ('ROUND_ROBIN', 'GROUP', 'KNOCKOUT', 'MANUAL'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'rounds_leg_number_valid') THEN
    ALTER TABLE public.rounds ADD CONSTRAINT rounds_leg_number_valid CHECK (leg_number IN (1, 2));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'rounds_group_phase_valid') THEN
    ALTER TABLE public.rounds ADD CONSTRAINT rounds_group_phase_valid
      CHECK ((phase_type = 'GROUP') = (stage_group_id IS NOT NULL));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'rounds_bracket_number_valid') THEN
    ALTER TABLE public.rounds ADD CONSTRAINT rounds_bracket_number_valid
      CHECK ((phase_type = 'KNOCKOUT') = (bracket_round IS NOT NULL));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'matches_series_leg_valid') THEN
    ALTER TABLE public.matches ADD CONSTRAINT matches_series_leg_valid
      CHECK (series_leg IN (1, 2));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'matches_source_outcomes_valid') THEN
    ALTER TABLE public.matches ADD CONSTRAINT matches_source_outcomes_valid
      CHECK (
        (home_source_match_id IS NULL AND home_source_outcome IS NULL)
        OR (home_source_match_id IS NOT NULL AND home_source_outcome IS NOT NULL
          AND home_source_outcome IN ('WINNER', 'LOSER'))
      )
      NOT VALID;
    ALTER TABLE public.matches ADD CONSTRAINT matches_away_source_outcomes_valid
      CHECK (
        (away_source_match_id IS NULL AND away_source_outcome IS NULL)
        OR (away_source_match_id IS NOT NULL AND away_source_outcome IS NOT NULL
          AND away_source_outcome IN ('WINNER', 'LOSER'))
      )
      NOT VALID;
  END IF;
END
$$;

ALTER TABLE public.matches
  DROP CONSTRAINT IF EXISTS matches_penalty_scores_valid;
ALTER TABLE public.matches
  ADD CONSTRAINT matches_penalty_scores_valid
  CHECK (
    (home_penalty_score IS NULL AND away_penalty_score IS NULL)
    OR (
      home_penalty_score >= 0
      AND home_penalty_score IS NOT NULL
      AND away_penalty_score >= 0
      AND away_penalty_score IS NOT NULL
      AND home_penalty_score <> away_penalty_score
      AND home_score IS NOT NULL
      AND away_score IS NOT NULL
    )
  );

ALTER TABLE public.round_robin_pair_claims
  ADD COLUMN IF NOT EXISTS leg_number integer NOT NULL DEFAULT 1;
ALTER TABLE public.round_robin_pair_claims
  DROP CONSTRAINT IF EXISTS round_robin_pair_claims_pkey;
ALTER TABLE public.round_robin_pair_claims
  ADD CONSTRAINT round_robin_pair_claims_pkey
  PRIMARY KEY (stage_id, team_low_id, team_high_id, leg_number);
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'round_robin_pair_claims_leg_valid') THEN
    ALTER TABLE public.round_robin_pair_claims
      ADD CONSTRAINT round_robin_pair_claims_leg_valid CHECK (leg_number IN (1, 2));
  END IF;
END
$$;

ALTER TABLE public.stage_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stage_group_teams ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.stage_groups, public.stage_group_teams TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON public.stage_groups, public.stage_group_teams TO authenticated;

DROP POLICY IF EXISTS "stage_groups_public_select" ON public.stage_groups;
CREATE POLICY "stage_groups_public_select"
  ON public.stage_groups FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "stage_groups_scoped_insert" ON public.stage_groups;
CREATE POLICY "stage_groups_scoped_insert"
  ON public.stage_groups FOR INSERT TO authenticated
  WITH CHECK (public.can_manage_stage(stage_id));
DROP POLICY IF EXISTS "stage_groups_scoped_update" ON public.stage_groups;
CREATE POLICY "stage_groups_scoped_update"
  ON public.stage_groups FOR UPDATE TO authenticated
  USING (public.can_manage_stage(stage_id))
  WITH CHECK (public.can_manage_stage(stage_id));
DROP POLICY IF EXISTS "stage_groups_scoped_delete" ON public.stage_groups;
CREATE POLICY "stage_groups_scoped_delete"
  ON public.stage_groups FOR DELETE TO authenticated
  USING (public.can_manage_stage(stage_id));

DROP POLICY IF EXISTS "stage_group_teams_public_select" ON public.stage_group_teams;
CREATE POLICY "stage_group_teams_public_select"
  ON public.stage_group_teams FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "stage_group_teams_scoped_insert" ON public.stage_group_teams;
CREATE POLICY "stage_group_teams_scoped_insert"
  ON public.stage_group_teams FOR INSERT TO authenticated
  WITH CHECK (public.can_manage_stage(stage_id));
DROP POLICY IF EXISTS "stage_group_teams_scoped_update" ON public.stage_group_teams;
CREATE POLICY "stage_group_teams_scoped_update"
  ON public.stage_group_teams FOR UPDATE TO authenticated
  USING (public.can_manage_stage(stage_id))
  WITH CHECK (public.can_manage_stage(stage_id));
DROP POLICY IF EXISTS "stage_group_teams_scoped_delete" ON public.stage_group_teams;
CREATE POLICY "stage_group_teams_scoped_delete"
  ON public.stage_group_teams FOR DELETE TO authenticated
  USING (public.can_manage_stage(stage_id));

CREATE OR REPLACE FUNCTION public.guard_stage_format_changes()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF (
    NEW.season_id IS DISTINCT FROM OLD.season_id
    OR NEW.format IS DISTINCT FROM OLD.format
    OR NEW.settings IS DISTINCT FROM OLD.settings
  ) AND EXISTS (
    SELECT 1
    FROM public.rounds r
    JOIN public.matches m ON m.round_id = r.id
    WHERE r.stage_id = OLD.id
  ) THEN
    RAISE EXCEPTION 'Não é permitido alterar temporada, formato ou regras de uma fase com partidas'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS stages_guard_match_structure ON public.stages;
CREATE TRIGGER stages_guard_match_structure
BEFORE UPDATE OF season_id, format, settings ON public.stages
FOR EACH ROW EXECUTE FUNCTION public.guard_stage_format_changes();

CREATE OR REPLACE FUNCTION public.guard_round_format_changes()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF (
    NEW.stage_id IS DISTINCT FROM OLD.stage_id
    OR NEW.phase_type IS DISTINCT FROM OLD.phase_type
    OR NEW.stage_group_id IS DISTINCT FROM OLD.stage_group_id
    OR NEW.leg_number IS DISTINCT FROM OLD.leg_number
    OR NEW.bracket_round IS DISTINCT FROM OLD.bracket_round
  ) AND EXISTS (SELECT 1 FROM public.matches WHERE round_id = OLD.id) THEN
    RAISE EXCEPTION 'Não é permitido alterar a estrutura de uma rodada com partidas'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS rounds_guard_match_structure ON public.rounds;
CREATE TRIGGER rounds_guard_match_structure
BEFORE UPDATE OF stage_id, phase_type, stage_group_id, leg_number, bracket_round
ON public.rounds
FOR EACH ROW EXECUTE FUNCTION public.guard_round_format_changes();

CREATE OR REPLACE FUNCTION public.validate_stage_group_team()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_season_id uuid;
BEGIN
  SELECT season_id INTO v_season_id FROM public.stages WHERE id = NEW.stage_id;
  IF v_season_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.season_teams
    WHERE id = NEW.season_team_id AND season_id = v_season_id
  ) THEN
    RAISE EXCEPTION 'A equipe do grupo não pertence à temporada da fase'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS stage_group_teams_validate ON public.stage_group_teams;
CREATE TRIGGER stage_group_teams_validate
BEFORE INSERT OR UPDATE ON public.stage_group_teams
FOR EACH ROW EXECUTE FUNCTION public.validate_stage_group_team();

CREATE OR REPLACE FUNCTION public.validate_round_format()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.stage_group_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.stage_groups
    WHERE id = NEW.stage_group_id AND stage_id = NEW.stage_id
  ) THEN
    RAISE EXCEPTION 'O grupo da rodada precisa pertencer à fase informada'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS rounds_validate_format ON public.rounds;
CREATE TRIGGER rounds_validate_format
BEFORE INSERT OR UPDATE OF stage_id, phase_type, stage_group_id
ON public.rounds
FOR EACH ROW EXECUTE FUNCTION public.validate_round_format();

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

DROP TRIGGER IF EXISTS stage_groups_guard_changes ON public.stage_groups;
CREATE TRIGGER stage_groups_guard_changes
BEFORE INSERT OR UPDATE OR DELETE ON public.stage_groups
FOR EACH ROW EXECUTE FUNCTION public.guard_stage_group_changes();
DROP TRIGGER IF EXISTS stage_group_teams_guard_changes ON public.stage_group_teams;
CREATE TRIGGER stage_group_teams_guard_changes
BEFORE INSERT OR UPDATE OR DELETE ON public.stage_group_teams
FOR EACH ROW EXECUTE FUNCTION public.guard_stage_group_changes();

CREATE OR REPLACE FUNCTION public.validate_match_progression_source()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_stage_id uuid;
  v_phase_type text;
  v_bracket_round integer;
  v_source record;
  v_source_match public.matches%ROWTYPE;
  v_winner uuid;
  v_expected_team uuid;
BEGIN
  SELECT stage_id, phase_type, bracket_round
  INTO v_stage_id, v_phase_type, v_bracket_round
  FROM public.rounds WHERE id = NEW.round_id;
  IF v_phase_type <> 'KNOCKOUT'
     AND (NEW.home_source_match_id IS NOT NULL OR NEW.away_source_match_id IS NOT NULL) THEN
    RAISE EXCEPTION 'Somente partidas eliminatórias podem depender de outro resultado'
      USING ERRCODE = '23514';
  END IF;
  IF NEW.home_source_match_id IS NOT NULL
     AND NEW.home_source_match_id = NEW.away_source_match_id THEN
    RAISE EXCEPTION 'Uma partida não pode usar vencedor e perdedor do mesmo confronto'
      USING ERRCODE = '23514';
  END IF;
  IF v_phase_type = 'KNOCKOUT'
     AND NEW.home_team_id IS NOT NULL AND NEW.away_team_id IS NOT NULL
  THEN
    PERFORM 1 FROM public.stages WHERE id = v_stage_id FOR UPDATE;
    IF EXISTS (
       SELECT 1
       FROM public.matches other_match
       JOIN public.rounds other_round ON other_round.id = other_match.round_id
       WHERE other_round.stage_id = v_stage_id
         AND other_round.phase_type = 'KNOCKOUT'
         AND other_round.bracket_round = v_bracket_round
         AND other_match.id <> NEW.id
         AND LEAST(other_match.home_team_id, other_match.away_team_id)
             = LEAST(NEW.home_team_id, NEW.away_team_id)
         AND GREATEST(other_match.home_team_id, other_match.away_team_id)
             = GREATEST(NEW.home_team_id, NEW.away_team_id)
         AND (
           NEW.series_id IS NULL OR other_match.series_id IS NULL
           OR other_match.series_id <> NEW.series_id
         )
    ) THEN
      RAISE EXCEPTION 'Confronto eliminatório duplicado nesta fase'
        USING ERRCODE = '23505';
    END IF;
  END IF;
  IF NEW.home_source_match_id IS NOT NULL OR NEW.away_source_match_id IS NOT NULL THEN
    FOR v_source IN
      SELECT sources.source_id FROM unnest(ARRAY[
        NEW.home_source_match_id, NEW.away_source_match_id
      ]) AS sources(source_id)
      WHERE sources.source_id IS NOT NULL
    LOOP
      IF v_source.source_id = NEW.id THEN
        RAISE EXCEPTION 'Uma partida não pode depender do próprio resultado'
          USING ERRCODE = '23514';
      END IF;
      IF NOT EXISTS (
        SELECT 1
        FROM public.matches source_match
        JOIN public.rounds source_round ON source_round.id = source_match.round_id
        WHERE source_match.id = v_source.source_id
          AND source_round.stage_id = v_stage_id
          AND source_round.phase_type = 'KNOCKOUT'
          AND source_round.bracket_round < v_bracket_round
          AND source_match.series_leg = (
            SELECT max(series_leg) FROM public.matches WHERE series_id = source_match.series_id
          )
      ) THEN
        RAISE EXCEPTION 'A origem precisa ser a última partida de uma fase eliminatória anterior'
          USING ERRCODE = '23514';
      END IF;
    END LOOP;
  END IF;
  IF NEW.home_source_match_id IS NOT NULL THEN
    v_winner := public.knockout_series_winner(NEW.home_source_match_id);
    SELECT * INTO v_source_match FROM public.matches WHERE id = NEW.home_source_match_id;
    v_expected_team := CASE NEW.home_source_outcome
      WHEN 'WINNER' THEN v_winner
      WHEN 'LOSER' THEN CASE
        WHEN v_winner = v_source_match.home_team_id THEN v_source_match.away_team_id
        WHEN v_winner = v_source_match.away_team_id THEN v_source_match.home_team_id
        ELSE NULL END
      ELSE NULL END;
    IF NEW.home_team_id IS DISTINCT FROM v_expected_team THEN
      RAISE EXCEPTION 'A equipe mandante é controlada pelo resultado que alimenta a chave'
        USING ERRCODE = '23514';
    END IF;
  END IF;
  IF NEW.away_source_match_id IS NOT NULL THEN
    v_winner := public.knockout_series_winner(NEW.away_source_match_id);
    SELECT * INTO v_source_match FROM public.matches WHERE id = NEW.away_source_match_id;
    v_expected_team := CASE NEW.away_source_outcome
      WHEN 'WINNER' THEN v_winner
      WHEN 'LOSER' THEN CASE
        WHEN v_winner = v_source_match.home_team_id THEN v_source_match.away_team_id
        WHEN v_winner = v_source_match.away_team_id THEN v_source_match.home_team_id
        ELSE NULL END
      ELSE NULL END;
    IF NEW.away_team_id IS DISTINCT FROM v_expected_team THEN
      RAISE EXCEPTION 'A equipe visitante é controlada pelo resultado que alimenta a chave'
        USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS matches_validate_progression_source ON public.matches;
CREATE TRIGGER matches_validate_progression_source
BEFORE INSERT OR UPDATE OF round_id, home_team_id, away_team_id,
  home_source_match_id, home_source_outcome, away_source_match_id, away_source_outcome
ON public.matches
FOR EACH ROW EXECUTE FUNCTION public.validate_match_progression_source();

CREATE OR REPLACE FUNCTION public.claim_round_robin_match_pair()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_stage_id uuid;
  v_stage_format text;
  v_phase_type text;
  v_leg_number integer;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Partidas não podem ser excluídas; cancele a partida para preservar o histórico'
      USING ERRCODE = '55000';
  END IF;

  SELECT r.stage_id, r.phase_type, r.leg_number, s.format
  INTO v_stage_id, v_phase_type, v_leg_number, v_stage_format
  FROM public.rounds r
  JOIN public.stages s ON s.id = r.stage_id
  WHERE r.id = NEW.round_id;

  IF TG_OP = 'UPDATE' THEN
    IF (OLD.round_id, OLD.home_team_id, OLD.away_team_id)
       IS NOT DISTINCT FROM (NEW.round_id, NEW.home_team_id, NEW.away_team_id) THEN
      RETURN NEW;
    END IF;
    DELETE FROM public.round_robin_pair_claims WHERE match_id = OLD.id;
  END IF;

  IF v_phase_type IN ('ROUND_ROBIN', 'GROUP')
     AND v_stage_format IN ('Pontos corridos', 'Grupos + Mata-mata')
     AND NEW.home_team_id IS NOT NULL
     AND NEW.away_team_id IS NOT NULL THEN
    IF v_phase_type = 'GROUP' AND NOT EXISTS (
      SELECT 1
      FROM public.rounds r
      JOIN public.stage_group_teams home_group
        ON home_group.stage_group_id = r.stage_group_id
       AND home_group.season_team_id = NEW.home_team_id
      JOIN public.stage_group_teams away_group
        ON away_group.stage_group_id = r.stage_group_id
       AND away_group.season_team_id = NEW.away_team_id
      WHERE r.id = NEW.round_id
    ) THEN
      RAISE EXCEPTION 'Uma partida da fase de grupos só pode envolver equipes daquele grupo'
        USING ERRCODE = '23514';
    END IF;
    INSERT INTO public.round_robin_pair_claims (
      stage_id, team_low_id, team_high_id, leg_number, match_id
    )
    VALUES (
      v_stage_id,
      LEAST(NEW.home_team_id, NEW.away_team_id),
      GREATEST(NEW.home_team_id, NEW.away_team_id),
      v_leg_number,
      NEW.id
    );
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.generate_round_robin(p_stage_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_season_id uuid;
  v_stage_format text;
  v_legs integer;
  v_rotation uuid[];
  v_next_rotation uuid[];
  v_team_count integer;
  v_size integer;
  v_round_index integer;
  v_pair_index integer;
  v_leg integer;
  v_i integer;
  v_home uuid;
  v_away uuid;
  v_round_id uuid;
  v_round_order integer;
  v_created_rounds integer := 0;
  v_created_matches integer := 0;
  v_expected_pairs integer;
  v_existing_matches integer;
  v_existing_pairs integer;
BEGIN
  SELECT season_id, format, COALESCE((settings->>'legs')::integer, 1)
  INTO v_season_id, v_stage_format, v_legs
  FROM public.stages
  WHERE id = p_stage_id
  FOR UPDATE;
  IF v_season_id IS NULL THEN
    RAISE EXCEPTION 'Fase não encontrada' USING ERRCODE = 'P0002';
  END IF;
  IF NOT public.can_manage_season(v_season_id) THEN
    RAISE EXCEPTION 'Sem permissão para gerenciar esta fase' USING ERRCODE = '42501';
  END IF;
  IF v_stage_format <> 'Pontos corridos' THEN
    RAISE EXCEPTION 'A geração todos-contra-todos só pode ser usada em fases de pontos corridos' USING ERRCODE = '23514';
  END IF;
  IF v_legs NOT IN (1, 2) THEN
    RAISE EXCEPTION 'O formato aceita turno único ou turno e returno' USING ERRCODE = '23514';
  END IF;

  SELECT COALESCE(array_agg(id ORDER BY id), ARRAY[]::uuid[])
  INTO v_rotation
  FROM public.season_teams
  WHERE season_id = v_season_id;
  v_team_count := cardinality(v_rotation);
  IF v_team_count < 2 THEN
    RAISE EXCEPTION 'São necessários ao menos dois times aprovados' USING ERRCODE = '23514';
  END IF;

  v_expected_pairs := (v_team_count * (v_team_count - 1) / 2) * v_legs;
  SELECT count(*)::integer,
    count(DISTINCT (
      LEAST(m.home_team_id, m.away_team_id),
      GREATEST(m.home_team_id, m.away_team_id),
      r.leg_number
    )) FILTER (
      WHERE r.phase_type = 'ROUND_ROBIN'
        AND m.home_team_id IS NOT NULL AND m.away_team_id IS NOT NULL
    )::integer
  INTO v_existing_matches, v_existing_pairs
  FROM public.matches m
  JOIN public.rounds r ON r.id = m.round_id
  WHERE r.stage_id = p_stage_id;
  IF v_existing_matches > 0 THEN
    IF v_existing_matches = v_expected_pairs AND v_existing_pairs = v_expected_pairs
       AND NOT EXISTS (
         SELECT 1 FROM public.rounds r
         JOIN public.matches m ON m.round_id = r.id
         WHERE r.stage_id = p_stage_id AND r.phase_type <> 'ROUND_ROBIN'
       ) THEN
      RETURN jsonb_build_object('rounds', 0, 'matches', 0, 'already_generated', true);
    END IF;
    RAISE EXCEPTION 'A fase já possui partidas. Nenhum confronto existente foi alterado'
      USING ERRCODE = '23514';
  END IF;

  IF v_team_count % 2 = 1 THEN
    v_rotation := array_append(v_rotation, NULL::uuid);
  END IF;
  v_size := cardinality(v_rotation);
  SELECT COALESCE(max(round_order), 0) + 1
  INTO v_round_order
  FROM public.rounds
  WHERE stage_id = p_stage_id;

  FOR v_leg IN 1..v_legs LOOP
    SELECT COALESCE(array_agg(id ORDER BY id), ARRAY[]::uuid[])
    INTO v_rotation
    FROM public.season_teams
    WHERE season_id = v_season_id;
    IF v_team_count % 2 = 1 THEN
      v_rotation := array_append(v_rotation, NULL::uuid);
    END IF;
    FOR v_round_index IN 1..(v_size - 1) LOOP
      INSERT INTO public.rounds (stage_id, name, round_order, phase_type, leg_number)
      VALUES (
        p_stage_id,
        CASE WHEN v_legs = 2 THEN 'Turno ' || v_leg || ' · Rodada ' || v_round_index
             ELSE 'Rodada ' || v_round_index END,
        v_round_order + (v_leg - 1) * (v_size - 1) + v_round_index - 1,
        'ROUND_ROBIN',
        v_leg
      )
      RETURNING id INTO v_round_id;
      v_created_rounds := v_created_rounds + 1;

      FOR v_pair_index IN 1..(v_size / 2) LOOP
        v_home := v_rotation[v_pair_index];
        v_away := v_rotation[v_size - v_pair_index + 1];
        IF v_home IS NOT NULL AND v_away IS NOT NULL THEN
          IF (v_round_index + v_pair_index) % 2 = 0 THEN
            IF v_leg = 2 THEN
              INSERT INTO public.matches (round_id, home_team_id, away_team_id, status)
              VALUES (v_round_id, v_away, v_home, 'SCHEDULED');
            ELSE
              INSERT INTO public.matches (round_id, home_team_id, away_team_id, status)
              VALUES (v_round_id, v_home, v_away, 'SCHEDULED');
            END IF;
          ELSE
            IF v_leg = 2 THEN
              INSERT INTO public.matches (round_id, home_team_id, away_team_id, status)
              VALUES (v_round_id, v_home, v_away, 'SCHEDULED');
            ELSE
              INSERT INTO public.matches (round_id, home_team_id, away_team_id, status)
              VALUES (v_round_id, v_away, v_home, 'SCHEDULED');
            END IF;
          END IF;
          v_created_matches := v_created_matches + 1;
        END IF;
      END LOOP;

      v_next_rotation := ARRAY[v_rotation[1], v_rotation[v_size]];
      FOR v_i IN 2..(v_size - 1) LOOP
        v_next_rotation := array_append(v_next_rotation, v_rotation[v_i]);
      END LOOP;
      v_rotation := v_next_rotation;
    END LOOP;
  END LOOP;

  IF v_created_matches <> v_expected_pairs THEN
    RAISE EXCEPTION 'A geração produziu um número inesperado de partidas'
      USING ERRCODE = '23514';
  END IF;
  RETURN jsonb_build_object(
    'rounds', v_created_rounds,
    'matches', v_created_matches,
    'already_generated', false
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.generate_round_robin(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.generate_round_robin(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.generate_group_stage(
  p_stage_id uuid,
  p_groups jsonb,
  p_group_legs integer,
  p_qualifiers_per_group integer
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_season_id uuid;
  v_stage_format text;
  v_group record;
  v_group_teams uuid[];
  v_rotation uuid[];
  v_next_rotation uuid[];
  v_team_count integer;
  v_size integer;
  v_round integer;
  v_pair integer;
  v_leg integer;
  v_i integer;
  v_home uuid;
  v_away uuid;
  v_round_id uuid;
  v_round_order integer;
  v_match_count integer := 0;
  v_expected integer := 0;
  v_group_count integer;
BEGIN
  SELECT season_id, format INTO v_season_id, v_stage_format
  FROM public.stages WHERE id = p_stage_id FOR UPDATE;
  IF v_season_id IS NULL THEN RAISE EXCEPTION 'Fase não encontrada' USING ERRCODE = 'P0002'; END IF;
  IF NOT public.can_manage_season(v_season_id) THEN
    RAISE EXCEPTION 'Sem permissão para gerenciar esta fase' USING ERRCODE = '42501';
  END IF;
  IF v_stage_format <> 'Grupos + Mata-mata' THEN
    RAISE EXCEPTION 'A fase não está configurada como grupos + mata-mata' USING ERRCODE = '23514';
  END IF;
  IF p_group_legs IS NULL OR p_group_legs NOT IN (1, 2)
     OR p_qualifiers_per_group IS NULL OR p_qualifiers_per_group < 1
     OR jsonb_typeof(p_groups) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'Configuração de grupos inválida' USING ERRCODE = '22023';
  END IF;
  v_group_count := jsonb_array_length(p_groups);
  IF v_group_count < 2 THEN RAISE EXCEPTION 'São necessários ao menos dois grupos' USING ERRCODE = '23514'; END IF;
  IF EXISTS (SELECT 1 FROM public.rounds WHERE stage_id = p_stage_id)
     OR EXISTS (
       SELECT 1 FROM public.stage_groups WHERE stage_id = p_stage_id
     ) THEN
    RAISE EXCEPTION 'A fase já possui grupos ou rodadas; nada foi alterado'
      USING ERRCODE = '23514';
  END IF;

  DROP TABLE IF EXISTS pg_temp.fbf_group_plan;
  CREATE TEMP TABLE fbf_group_plan (
    group_order integer NOT NULL,
    name text NOT NULL,
    team_id uuid NOT NULL,
    seed_order integer NOT NULL,
    PRIMARY KEY (group_order, seed_order),
    UNIQUE (name, seed_order),
    UNIQUE (team_id)
  ) ON COMMIT DROP;
  FOR v_group IN
    SELECT value, ordinality::integer AS group_order
    FROM jsonb_array_elements(p_groups) WITH ORDINALITY
  LOOP
    IF jsonb_typeof(v_group.value->'team_ids') IS DISTINCT FROM 'array' THEN
      RAISE EXCEPTION 'A lista de equipes do grupo precisa ser um array'
        USING ERRCODE = '23514';
    END IF;
    IF jsonb_array_length(v_group.value->'team_ids') < 2
       OR NULLIF(btrim(v_group.value->>'name'), '') IS NULL THEN
      RAISE EXCEPTION 'Cada grupo precisa de um nome e ao menos duas equipes'
        USING ERRCODE = '23514';
    END IF;
    INSERT INTO pg_temp.fbf_group_plan (group_order, name, team_id, seed_order)
    SELECT
      v_group.group_order,
      btrim(v_group.value->>'name'),
      team_value::uuid,
      team_ordinality::integer
    FROM jsonb_array_elements_text(v_group.value->'team_ids')
      WITH ORDINALITY AS teams(team_value, team_ordinality);
  END LOOP;

  IF (SELECT count(*) FROM pg_temp.fbf_group_plan)
     <> (SELECT count(*) FROM public.season_teams WHERE season_id = v_season_id)
     OR EXISTS (
       SELECT 1
       FROM pg_temp.fbf_group_plan p
       LEFT JOIN public.season_teams st
         ON st.id = p.team_id AND st.season_id = v_season_id
       WHERE st.id IS NULL
     ) THEN
    RAISE EXCEPTION 'Todos os times aprovados precisam ser distribuídos uma única vez'
      USING ERRCODE = '23514';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_temp.fbf_group_plan GROUP BY group_order HAVING count(*) < 2
  ) THEN
    RAISE EXCEPTION 'Cada grupo precisa ter ao menos duas equipes' USING ERRCODE = '23514';
  END IF;
  IF p_qualifiers_per_group > (
    SELECT min(team_count)
    FROM (
      SELECT count(*)::integer AS team_count
      FROM pg_temp.fbf_group_plan
      GROUP BY group_order
    ) group_sizes
  ) THEN
    RAISE EXCEPTION 'O número de classificados não pode exceder o tamanho do menor grupo'
      USING ERRCODE = '23514';
  END IF;

  UPDATE public.stages
  SET settings = settings || jsonb_build_object(
    'group_count', v_group_count,
    'group_legs', p_group_legs,
    'qualifiers_per_group', p_qualifiers_per_group
  )
  WHERE id = p_stage_id;

  INSERT INTO public.stage_groups (stage_id, name, group_order)
  SELECT p_stage_id, name, group_order FROM pg_temp.fbf_group_plan
  GROUP BY name, group_order ORDER BY group_order;

  FOR v_group IN
    SELECT id, name, group_order
    FROM public.stage_groups WHERE stage_id = p_stage_id ORDER BY group_order
  LOOP
    SELECT array_agg(p.team_id ORDER BY p.seed_order)
    INTO v_group_teams
    FROM pg_temp.fbf_group_plan p
    WHERE p.group_order = v_group.group_order;
    INSERT INTO public.stage_group_teams (stage_group_id, stage_id, season_team_id, seed_order)
    SELECT v_group.id, p_stage_id, p.team_id, p.seed_order
    FROM pg_temp.fbf_group_plan p WHERE p.group_order = v_group.group_order;

    v_team_count := cardinality(v_group_teams);
    v_rotation := v_group_teams;
    IF v_team_count % 2 = 1 THEN v_rotation := array_append(v_rotation, NULL::uuid); END IF;
    v_size := cardinality(v_rotation);
    v_expected := v_expected + (v_team_count * (v_team_count - 1) / 2) * p_group_legs;

    FOR v_leg IN 1..p_group_legs LOOP
      v_rotation := v_group_teams;
      IF v_team_count % 2 = 1 THEN v_rotation := array_append(v_rotation, NULL::uuid); END IF;
      FOR v_round IN 1..(v_size - 1) LOOP
        v_round_order := COALESCE((
          SELECT max(round_order) + 1 FROM public.rounds WHERE stage_id = p_stage_id
        ), 1);
        INSERT INTO public.rounds (
          stage_id, name, round_order, phase_type, stage_group_id, leg_number
        ) VALUES (
          p_stage_id,
          v_group.name || CASE WHEN p_group_legs = 2 THEN ' · Turno ' || v_leg ELSE '' END
            || ' · Rodada ' || v_round,
          v_round_order,
          'GROUP',
          v_group.id,
          v_leg
        ) RETURNING id INTO v_round_id;

        FOR v_pair IN 1..(v_size / 2) LOOP
          v_home := v_rotation[v_pair];
          v_away := v_rotation[v_size - v_pair + 1];
          IF v_home IS NOT NULL AND v_away IS NOT NULL THEN
            IF (v_round + v_pair) % 2 = 0 THEN
              IF v_leg = 2 THEN
                INSERT INTO public.matches (round_id, home_team_id, away_team_id, status)
                VALUES (v_round_id, v_away, v_home, 'SCHEDULED');
              ELSE
                INSERT INTO public.matches (round_id, home_team_id, away_team_id, status)
                VALUES (v_round_id, v_home, v_away, 'SCHEDULED');
              END IF;
            ELSE
              IF v_leg = 2 THEN
                INSERT INTO public.matches (round_id, home_team_id, away_team_id, status)
                VALUES (v_round_id, v_home, v_away, 'SCHEDULED');
              ELSE
                INSERT INTO public.matches (round_id, home_team_id, away_team_id, status)
                VALUES (v_round_id, v_away, v_home, 'SCHEDULED');
              END IF;
            END IF;
            v_match_count := v_match_count + 1;
          END IF;
        END LOOP;

        v_next_rotation := ARRAY[v_rotation[1], v_rotation[v_size]];
        FOR v_i IN 2..(v_size - 1) LOOP
          v_next_rotation := array_append(v_next_rotation, v_rotation[v_i]);
        END LOOP;
        v_rotation := v_next_rotation;
      END LOOP;
    END LOOP;
  END LOOP;

  IF v_match_count <> v_expected THEN
    RAISE EXCEPTION 'A geração dos grupos produziu uma quantidade inesperada de partidas'
      USING ERRCODE = '23514';
  END IF;
  RETURN jsonb_build_object('groups', v_group_count, 'matches', v_match_count);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.generate_group_stage(uuid, jsonb, integer, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.generate_group_stage(uuid, jsonb, integer, integer) TO authenticated;

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
      WHERE r.stage_id = p_stage_id AND r.phase_type = 'GROUP'
        AND m.status <> 'FINISHED'
    )
    OR NOT EXISTS (
      SELECT 1 FROM public.matches m
      JOIN public.rounds r ON r.id = m.round_id
      WHERE r.stage_id = p_stage_id AND r.phase_type = 'GROUP'
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

CREATE OR REPLACE FUNCTION public.knockout_series_winner(p_match_id uuid)
RETURNS uuid
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_series_id uuid;
  v_stage_id uuid;
  v_legs integer;
  v_match public.matches%ROWTYPE;
  v_team_id uuid;
  v_home_goals integer;
  v_away_goals integer;
  v_finished_count integer;
  v_series_count integer;
BEGIN
  SELECT m, r.stage_id
  INTO v_match, v_stage_id
  FROM public.matches m
  JOIN public.rounds r ON r.id = m.round_id
  WHERE m.id = p_match_id AND r.phase_type = 'KNOCKOUT';
  IF NOT FOUND OR v_match.status <> 'FINISHED' THEN RETURN NULL; END IF;

  SELECT count(*)::integer INTO v_legs
  FROM public.matches WHERE series_id = v_match.series_id;
  v_series_id := v_match.series_id;
  IF v_series_id IS NULL THEN RETURN NULL; END IF;

  SELECT count(*) FILTER (WHERE status = 'FINISHED'), count(*)
  INTO v_finished_count, v_series_count
  FROM public.matches WHERE series_id = v_series_id;
  IF v_series_count <> v_legs OR v_finished_count <> v_legs THEN RETURN NULL; END IF;

  IF v_legs = 1 THEN
    IF v_match.home_score > v_match.away_score THEN RETURN v_match.home_team_id; END IF;
    IF v_match.away_score > v_match.home_score THEN RETURN v_match.away_team_id; END IF;
    IF v_match.home_penalty_score > v_match.away_penalty_score THEN RETURN v_match.home_team_id; END IF;
    IF v_match.away_penalty_score > v_match.home_penalty_score THEN RETURN v_match.away_team_id; END IF;
    RETURN NULL;
  END IF;

  SELECT
    COALESCE(sum(CASE WHEN m.home_team_id = v_match.home_team_id THEN m.home_score
                      WHEN m.away_team_id = v_match.home_team_id THEN m.away_score END), 0)::integer,
    COALESCE(sum(CASE WHEN m.home_team_id = v_match.away_team_id THEN m.home_score
                      WHEN m.away_team_id = v_match.away_team_id THEN m.away_score END), 0)::integer
  INTO v_home_goals, v_away_goals
  FROM public.matches m
  WHERE m.series_id = v_series_id AND m.status = 'FINISHED';
  IF v_home_goals > v_away_goals THEN RETURN v_match.home_team_id; END IF;
  IF v_away_goals > v_home_goals THEN RETURN v_match.away_team_id; END IF;
  IF v_match.home_penalty_score > v_match.away_penalty_score THEN RETURN v_match.home_team_id; END IF;
  IF v_match.away_penalty_score > v_match.home_penalty_score THEN RETURN v_match.away_team_id; END IF;
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.validate_knockout_penalty_decision(
  p_match_id uuid,
  p_home_score integer,
  p_away_score integer
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_match public.matches%ROWTYPE;
  v_stage_id uuid;
  v_phase text;
  v_leg_count integer;
  v_series_id uuid;
  v_home_total integer;
  v_away_total integer;
  v_other_finished integer;
  v_series_count integer;
BEGIN
  SELECT m, r.stage_id, r.phase_type
  INTO v_match, v_stage_id, v_phase
  FROM public.matches m JOIN public.rounds r ON r.id = m.round_id
  WHERE m.id = p_match_id;
  v_series_id := v_match.series_id;
  IF v_phase <> 'KNOCKOUT' OR v_series_id IS NULL THEN
    RETURN p_home_score = p_away_score;
  END IF;
  SELECT count(*)::integer INTO v_leg_count
  FROM public.matches WHERE series_id = v_series_id;
  IF v_leg_count = 1 THEN RETURN p_home_score = p_away_score; END IF;
  IF v_leg_count <> 2 THEN RETURN false; END IF;

  SELECT count(*) FILTER (WHERE status = 'FINISHED'),
    count(*)::integer,
    COALESCE(sum(CASE
      WHEN m.id = p_match_id THEN
        CASE WHEN m.home_team_id = v_match.home_team_id THEN p_home_score ELSE p_away_score END
      WHEN m.home_team_id = v_match.home_team_id THEN m.home_score
      WHEN m.away_team_id = v_match.home_team_id THEN m.away_score
      ELSE 0 END), 0)::integer,
    COALESCE(sum(CASE
      WHEN m.id = p_match_id THEN
        CASE WHEN m.home_team_id = v_match.away_team_id THEN p_home_score ELSE p_away_score END
      WHEN m.home_team_id = v_match.away_team_id THEN m.home_score
      WHEN m.away_team_id = v_match.away_team_id THEN m.away_score
      ELSE 0 END), 0)::integer
  INTO v_other_finished, v_series_count, v_home_total, v_away_total
  FROM public.matches m
  WHERE m.series_id = v_series_id;
  RETURN v_series_count = 2 AND v_other_finished = 1 AND v_home_total = v_away_total;
END;
$$;

CREATE OR REPLACE FUNCTION public.validate_match_status_and_score()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_home_score integer;
  v_away_score integer;
  v_home_penalties integer;
  v_away_penalties integer;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'SCHEDULED' THEN
      RAISE EXCEPTION 'Uma partida nova deve começar como agendada' USING ERRCODE = '23514';
    END IF;
    NEW.score_source := 'EVENTS';
    NEW.home_score := NULL;
    NEW.away_score := NULL;
    NEW.home_penalty_score := NULL;
    NEW.away_penalty_score := NULL;
    RETURN NEW;
  END IF;

  IF NEW.score_source IS DISTINCT FROM OLD.score_source THEN
    RAISE EXCEPTION 'A origem do placar é controlada pelo banco' USING ERRCODE = '42501';
  END IF;
  IF OLD.score_source = 'EVENTS'
     AND (NEW.home_score IS DISTINCT FROM OLD.home_score
       OR NEW.away_score IS DISTINCT FROM OLD.away_score
       OR NEW.home_penalty_score IS DISTINCT FROM OLD.home_penalty_score
       OR NEW.away_penalty_score IS DISTINCT FROM OLD.away_penalty_score)
     AND pg_trigger_depth() < 2 THEN
    RAISE EXCEPTION 'O placar oficial é derivado dos eventos da partida' USING ERRCODE = '42501';
  END IF;
  IF OLD.score_source = 'LEGACY'
     AND (NEW.home_score IS DISTINCT FROM OLD.home_score
       OR NEW.away_score IS DISTINCT FROM OLD.away_score
       OR NEW.home_penalty_score IS DISTINCT FROM OLD.home_penalty_score
       OR NEW.away_penalty_score IS DISTINCT FROM OLD.away_penalty_score)
     AND pg_trigger_depth() < 2 THEN
    RAISE EXCEPTION 'O placar legado precisa ser reconciliado por um processo autorizado'
      USING ERRCODE = '42501';
  END IF;

  IF NEW.status IS DISTINCT FROM OLD.status THEN
    IF NOT (CASE OLD.status
      WHEN 'SCHEDULED' THEN NEW.status IN ('LIVE', 'POSTPONED', 'CANCELLED')
      WHEN 'LIVE' THEN NEW.status IN ('FINISHED', 'POSTPONED', 'CANCELLED')
      WHEN 'POSTPONED' THEN NEW.status IN ('SCHEDULED', 'CANCELLED')
      ELSE false
    END) THEN
      RAISE EXCEPTION 'Transição de status inválida: % -> %', OLD.status, NEW.status
        USING ERRCODE = '23514';
    END IF;

    IF NEW.status = 'FINISHED' THEN
      SELECT
        count(*) FILTER (
          WHERE e.event_type = 'GOAL' AND e.period <> 'PENALTY_SHOOTOUT'
            AND ((e.team_id = m.home_team_id AND NOT e.is_own_goal)
              OR (e.team_id = m.away_team_id AND e.is_own_goal))
        )::integer,
        count(*) FILTER (
          WHERE e.event_type = 'GOAL' AND e.period <> 'PENALTY_SHOOTOUT'
            AND ((e.team_id = m.away_team_id AND NOT e.is_own_goal)
              OR (e.team_id = m.home_team_id AND e.is_own_goal))
        )::integer,
        count(*) FILTER (
          WHERE e.event_type = 'GOAL' AND e.period = 'PENALTY_SHOOTOUT'
            AND e.team_id = m.home_team_id AND NOT e.is_own_goal
        )::integer,
        count(*) FILTER (
          WHERE e.event_type = 'GOAL' AND e.period = 'PENALTY_SHOOTOUT'
            AND e.team_id = m.away_team_id AND NOT e.is_own_goal
        )::integer
      INTO v_home_score, v_away_score, v_home_penalties, v_away_penalties
      FROM public.matches m LEFT JOIN public.match_events e ON e.match_id = m.id
      WHERE m.id = NEW.id GROUP BY m.id;

      IF OLD.score_source = 'LEGACY'
         AND OLD.home_score IS NOT NULL AND OLD.away_score IS NOT NULL
         AND NOT EXISTS (
           SELECT 1 FROM public.match_events e
           WHERE e.match_id = NEW.id AND e.event_type = 'GOAL'
         ) THEN
        NEW.home_score := OLD.home_score;
        NEW.away_score := OLD.away_score;
        NEW.home_penalty_score := OLD.home_penalty_score;
        NEW.away_penalty_score := OLD.away_penalty_score;
        NEW.score_source := 'LEGACY';
      ELSE
        IF OLD.score_source = 'LEGACY'
           AND OLD.home_score IS NOT NULL AND OLD.away_score IS NOT NULL
           AND (
             OLD.home_score IS DISTINCT FROM COALESCE(v_home_score, 0)
             OR OLD.away_score IS DISTINCT FROM COALESCE(v_away_score, 0)
             OR OLD.home_penalty_score IS DISTINCT FROM CASE
               WHEN COALESCE(v_home_penalties, 0) + COALESCE(v_away_penalties, 0) > 0
               THEN COALESCE(v_home_penalties, 0) ELSE NULL END
             OR OLD.away_penalty_score IS DISTINCT FROM CASE
               WHEN COALESCE(v_home_penalties, 0) + COALESCE(v_away_penalties, 0) > 0
               THEN COALESCE(v_away_penalties, 0) ELSE NULL END
           ) THEN
          RAISE EXCEPTION 'Os eventos não correspondem ao placar legado; corrija os eventos antes de finalizar'
            USING ERRCODE = '23514';
        END IF;
        NEW.home_score := COALESCE(v_home_score, 0);
        NEW.away_score := COALESCE(v_away_score, 0);
        NEW.home_penalty_score := CASE
          WHEN COALESCE(v_home_penalties, 0) + COALESCE(v_away_penalties, 0) > 0
          THEN COALESCE(v_home_penalties, 0) ELSE NULL END;
        NEW.away_penalty_score := CASE
          WHEN COALESCE(v_home_penalties, 0) + COALESCE(v_away_penalties, 0) > 0
          THEN COALESCE(v_away_penalties, 0) ELSE NULL END;
        NEW.score_source := 'EVENTS';
      END IF;

      IF NEW.home_penalty_score IS NOT NULL
         AND NOT public.validate_knockout_penalty_decision(
           NEW.id, NEW.home_score, NEW.away_score
         ) THEN
        RAISE EXCEPTION 'Pênaltis só podem decidir um empate válido no formato e na fase da partida'
          USING ERRCODE = '23514';
      END IF;
      IF NEW.home_penalty_score IS NOT NULL
         AND NEW.home_penalty_score = NEW.away_penalty_score THEN
        RAISE EXCEPTION 'A disputa de pênaltis precisa ter um vencedor' USING ERRCODE = '23514';
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.propagate_knockout_result()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_phase text;
  v_winner uuid;
  v_target record;
  v_home uuid;
  v_away uuid;
BEGIN
  SELECT r.phase_type INTO v_phase
  FROM public.rounds r WHERE r.id = NEW.round_id;
  IF v_phase <> 'KNOCKOUT' OR NEW.series_id IS NULL THEN RETURN NEW; END IF;
  v_winner := public.knockout_series_winner(NEW.id);

  FOR v_target IN
    SELECT * FROM public.matches
    WHERE home_source_match_id = NEW.id OR away_source_match_id = NEW.id
    ORDER BY id
    FOR UPDATE
  LOOP
    v_home := v_target.home_team_id;
    v_away := v_target.away_team_id;
    IF v_target.home_source_match_id = NEW.id THEN
      v_home := CASE v_target.home_source_outcome
        WHEN 'WINNER' THEN v_winner
        WHEN 'LOSER' THEN CASE
          WHEN v_winner = NEW.home_team_id THEN NEW.away_team_id
          WHEN v_winner = NEW.away_team_id THEN NEW.home_team_id
          ELSE NULL END
        ELSE NULL END;
    END IF;
    IF v_target.away_source_match_id = NEW.id THEN
      v_away := CASE v_target.away_source_outcome
        WHEN 'WINNER' THEN v_winner
        WHEN 'LOSER' THEN CASE
          WHEN v_winner = NEW.home_team_id THEN NEW.away_team_id
          WHEN v_winner = NEW.away_team_id THEN NEW.home_team_id
          ELSE NULL END
        ELSE NULL END;
    END IF;
    IF (v_home, v_away) IS DISTINCT FROM (v_target.home_team_id, v_target.away_team_id) THEN
      IF v_target.status NOT IN ('SCHEDULED', 'POSTPONED') THEN
        RAISE EXCEPTION 'O resultado não pode alterar um confronto seguinte que já começou'
          USING ERRCODE = '23514';
      END IF;
      UPDATE public.matches SET home_team_id = v_home, away_team_id = v_away
      WHERE id = v_target.id;
    END IF;
  END LOOP;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS matches_propagate_knockout_result ON public.matches;
CREATE TRIGGER matches_propagate_knockout_result
AFTER UPDATE OF status, home_score, away_score, home_penalty_score, away_penalty_score
ON public.matches
FOR EACH ROW
WHEN (OLD.status IS DISTINCT FROM NEW.status
  OR OLD.home_score IS DISTINCT FROM NEW.home_score
  OR OLD.away_score IS DISTINCT FROM NEW.away_score
  OR OLD.home_penalty_score IS DISTINCT FROM NEW.home_penalty_score
  OR OLD.away_penalty_score IS DISTINCT FROM NEW.away_penalty_score)
EXECUTE FUNCTION public.propagate_knockout_result();

REVOKE EXECUTE ON FUNCTION public.knockout_series_winner(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.validate_knockout_penalty_decision(uuid, integer, integer)
  FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE VIEW public.stage_standings
WITH (security_invoker = true) AS
SELECT
  stg.id AS stage_id,
  s.id AS season_id,
  s.competition_id,
  st.id AS season_team_id,
  t.id AS team_id,
  t.name AS team_name,
  t.logo_url AS team_logo_url,
  count(m.id)::integer AS played,
  count(m.id) FILTER (
    WHERE (m.home_team_id = st.id AND m.home_score > m.away_score)
       OR (m.away_team_id = st.id AND m.away_score > m.home_score)
  )::integer AS wins,
  count(m.id) FILTER (WHERE m.home_score = m.away_score)::integer AS draws,
  count(m.id) FILTER (
    WHERE (m.home_team_id = st.id AND m.home_score < m.away_score)
       OR (m.away_team_id = st.id AND m.away_score < m.home_score)
  )::integer AS losses,
  COALESCE(sum(CASE WHEN m.home_team_id = st.id THEN m.home_score ELSE m.away_score END), 0)::integer AS goals_for,
  COALESCE(sum(CASE WHEN m.home_team_id = st.id THEN m.away_score ELSE m.home_score END), 0)::integer AS goals_against,
  COALESCE(sum(
    CASE
      WHEN (m.home_team_id = st.id AND m.home_score > m.away_score)
        OR (m.away_team_id = st.id AND m.away_score > m.home_score) THEN 3
      WHEN m.home_score = m.away_score THEN 1
      ELSE 0
    END
  ), 0)::integer AS points,
  sgt.stage_group_id,
  sg.name AS group_name
FROM public.stages stg
JOIN public.seasons s ON s.id = stg.season_id
JOIN public.season_teams st ON st.season_id = s.id
JOIN public.teams t ON t.id = st.team_id
LEFT JOIN public.stage_group_teams sgt
  ON sgt.stage_id = stg.id AND sgt.season_team_id = st.id
LEFT JOIN public.stage_groups sg ON sg.id = sgt.stage_group_id
LEFT JOIN public.rounds r ON r.stage_id = stg.id
  AND r.phase_type IN ('ROUND_ROBIN', 'GROUP')
  AND (r.phase_type <> 'GROUP' OR r.stage_group_id = sgt.stage_group_id)
LEFT JOIN public.matches m
  ON m.round_id = r.id
  AND m.status = 'FINISHED'
  AND m.home_score IS NOT NULL
  AND m.away_score IS NOT NULL
  AND (m.home_team_id = st.id OR m.away_team_id = st.id)
GROUP BY stg.id, s.id, s.competition_id, st.id, t.id, t.name, t.logo_url, sgt.stage_group_id, sg.name;

GRANT SELECT ON public.stage_standings TO anon, authenticated;

COMMIT;
