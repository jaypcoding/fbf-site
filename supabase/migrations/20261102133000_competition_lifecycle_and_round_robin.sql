ALTER TABLE public.competitions
  ADD COLUMN IF NOT EXISTS max_teams integer,
  ADD COLUMN IF NOT EXISTS registration_starts_at timestamptz,
  ADD COLUMN IF NOT EXISTS registration_ends_at timestamptz;

ALTER TABLE public.matches
  ADD COLUMN IF NOT EXISTS duration_seconds integer;

ALTER TABLE public.stages
  ADD COLUMN IF NOT EXISTS tie_breakers text[] NOT NULL
  DEFAULT ARRAY['POINTS', 'WINS', 'GOAL_DIFF', 'GOALS_FOR', 'TEAM_NAME']::text[];

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'competitions_max_teams_positive') THEN
    ALTER TABLE public.competitions
      ADD CONSTRAINT competitions_max_teams_positive
      CHECK (max_teams IS NULL OR max_teams > 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'competitions_registration_dates_valid') THEN
    ALTER TABLE public.competitions
      ADD CONSTRAINT competitions_registration_dates_valid
      CHECK (
        registration_starts_at IS NULL
        OR registration_ends_at IS NULL
        OR registration_ends_at >= registration_starts_at
      );
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'seasons_dates_valid') THEN
    ALTER TABLE public.seasons
      ADD CONSTRAINT seasons_dates_valid
      CHECK (starts_at IS NULL OR ends_at IS NULL OR ends_at >= starts_at);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'goalkeeper_conceded_time_within_spell') THEN
    ALTER TABLE public.goalkeeper_participations
      ADD CONSTRAINT goalkeeper_conceded_time_within_spell
      CHECK (
        first_conceded_at_seconds IS NULL
        OR ended_at_seconds IS NULL
        OR first_conceded_at_seconds <= ended_at_seconds
      );
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'matches_duration_positive') THEN
    ALTER TABLE public.matches
      ADD CONSTRAINT matches_duration_positive
      CHECK (duration_seconds IS NULL OR duration_seconds > 0);
  END IF;
END
$$;

CREATE TABLE IF NOT EXISTS public.team_registrations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  season_id uuid NOT NULL REFERENCES public.seasons(id) ON DELETE CASCADE,
  team_id uuid NOT NULL REFERENCES public.teams(id) ON DELETE RESTRICT,
  status text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED', 'WITHDRAWN')),
  submitted_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  reviewed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (season_id, team_id)
);

CREATE INDEX IF NOT EXISTS team_registrations_season_status_idx
  ON public.team_registrations(season_id, status);

ALTER TABLE public.team_registrations ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.team_registrations TO authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.team_registrations FROM anon, authenticated;

DROP POLICY IF EXISTS "team_registrations_manager_select" ON public.team_registrations;
CREATE POLICY "team_registrations_manager_select"
  ON public.team_registrations FOR SELECT TO authenticated
  USING (
    public.can_manage_season(season_id)
  );

REVOKE INSERT, UPDATE, DELETE ON public.competition_organizers FROM anon, authenticated;
GRANT SELECT, INSERT, DELETE ON public.competition_organizers TO authenticated;
DROP POLICY IF EXISTS "competition_organizers_manager_insert" ON public.competition_organizers;
DROP POLICY IF EXISTS "competition_organizers_admin_insert" ON public.competition_organizers;
DROP POLICY IF EXISTS "competition_organizers_admin_select" ON public.competition_organizers;
DROP POLICY IF EXISTS "competition_organizers_public_select" ON public.competition_organizers;
DROP POLICY IF EXISTS "competition_organizers_admin_delete" ON public.competition_organizers;
DROP POLICY IF EXISTS "competition_organizers_manager_update" ON public.competition_organizers;
CREATE POLICY "competition_organizers_admin_select"
  ON public.competition_organizers FOR SELECT TO authenticated
  USING (public.is_fbf_admin());
CREATE POLICY "competition_organizers_admin_insert"
  ON public.competition_organizers FOR INSERT TO authenticated
  WITH CHECK (public.is_fbf_admin());
CREATE POLICY "competition_organizers_admin_delete"
  ON public.competition_organizers FOR DELETE TO authenticated
  USING (public.is_fbf_admin());

DROP POLICY IF EXISTS "competitions_manager_update" ON public.competitions;
CREATE POLICY "competitions_manager_update"
  ON public.competitions FOR UPDATE TO authenticated
  USING (public.can_manage_competition(id))
  WITH CHECK (public.can_manage_competition(id));

DROP POLICY IF EXISTS "season_teams_scoped_insert" ON public.season_teams;
DROP POLICY IF EXISTS "season_teams_approved_registration_insert" ON public.season_teams;
DROP POLICY IF EXISTS "season_teams_scoped_update" ON public.season_teams;
REVOKE UPDATE ON public.season_teams FROM anon, authenticated;
CREATE POLICY "season_teams_approved_registration_insert"
  ON public.season_teams FOR INSERT TO authenticated
  WITH CHECK (
    public.can_manage_season(season_id)
    AND EXISTS (
      SELECT 1
      FROM public.team_registrations tr
      WHERE tr.season_id = season_teams.season_id
        AND tr.team_id = season_teams.team_id
        AND tr.status = 'APPROVED'
    )
  );

DROP POLICY IF EXISTS "season_teams_scoped_delete" ON public.season_teams;

CREATE OR REPLACE FUNCTION public.register_team_for_season(p_season_id uuid, p_team_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_competition_id uuid;
  v_status text;
  v_max_teams integer;
  v_registration_starts_at timestamptz;
  v_registration_ends_at timestamptz;
  v_registration_id uuid;
  v_existing_status text;
  v_count integer;
BEGIN
  SELECT s.competition_id, c.status, c.max_teams, c.registration_starts_at, c.registration_ends_at
  INTO v_competition_id, v_status, v_max_teams, v_registration_starts_at, v_registration_ends_at
  FROM public.seasons s
  JOIN public.competitions c ON c.id = s.competition_id
  WHERE s.id = p_season_id
  FOR UPDATE OF c;

  IF v_competition_id IS NULL THEN
    RAISE EXCEPTION 'Temporada não encontrada' USING ERRCODE = 'P0002';
  END IF;
  IF NOT public.can_manage_competition(v_competition_id) THEN
    RAISE EXCEPTION 'Sem permissão para gerenciar esta competição' USING ERRCODE = '42501';
  END IF;
  IF v_status <> 'REGISTRATION' THEN
    RAISE EXCEPTION 'As inscrições desta competição não estão abertas' USING ERRCODE = '23514';
  END IF;
  IF v_registration_starts_at IS NOT NULL AND now() < v_registration_starts_at THEN
    RAISE EXCEPTION 'O período de inscrições ainda não começou' USING ERRCODE = '23514';
  END IF;
  IF v_registration_ends_at IS NOT NULL AND now() > v_registration_ends_at THEN
    RAISE EXCEPTION 'O período de inscrições já foi encerrado' USING ERRCODE = '23514';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.teams WHERE id = p_team_id) THEN
    RAISE EXCEPTION 'Time não encontrado' USING ERRCODE = '23503';
  END IF;

  SELECT status INTO v_existing_status
  FROM public.team_registrations
  WHERE season_id = p_season_id AND team_id = p_team_id
  FOR UPDATE;

  IF v_existing_status IN ('PENDING', 'APPROVED') THEN
    RAISE EXCEPTION 'Este time já possui uma inscrição ativa nesta temporada' USING ERRCODE = '23505';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.season_teams
    WHERE season_id = p_season_id AND team_id = p_team_id
  ) THEN
    RAISE EXCEPTION 'Este time já está aprovado nesta temporada' USING ERRCODE = '23505';
  END IF;

  IF v_max_teams IS NOT NULL THEN
    SELECT
      (SELECT count(*) FROM public.season_teams WHERE season_id = p_season_id)
      + (SELECT count(*) FROM public.team_registrations
         WHERE season_id = p_season_id AND status = 'PENDING')
    INTO v_count;
    IF v_count >= v_max_teams THEN
      RAISE EXCEPTION 'Não há vagas disponíveis nesta temporada' USING ERRCODE = '23514';
    END IF;
  END IF;

  IF v_existing_status IN ('REJECTED', 'WITHDRAWN') THEN
    UPDATE public.team_registrations
    SET status = 'PENDING',
        submitted_by = auth.uid(),
        reviewed_by = NULL,
        reviewed_at = NULL,
        updated_at = now()
    WHERE season_id = p_season_id AND team_id = p_team_id
    RETURNING id INTO v_registration_id;
  ELSE
    INSERT INTO public.team_registrations (season_id, team_id, submitted_by)
    VALUES (p_season_id, p_team_id, auth.uid())
    RETURNING id INTO v_registration_id;
  END IF;

  RETURN v_registration_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.withdraw_team_registration(p_registration_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_registration public.team_registrations%ROWTYPE;
  v_competition_id uuid;
BEGIN
  SELECT tr.* INTO v_registration
  FROM public.team_registrations tr
  WHERE tr.id = p_registration_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Inscrição não encontrada' USING ERRCODE = 'P0002';
  END IF;

  SELECT s.competition_id INTO v_competition_id
  FROM public.seasons s
  JOIN public.competitions c ON c.id = s.competition_id
  WHERE s.id = v_registration.season_id
  FOR UPDATE OF c;
  IF NOT public.can_manage_competition(v_competition_id) THEN
    RAISE EXCEPTION 'Sem permissão para gerenciar esta competição' USING ERRCODE = '42501';
  END IF;

  SELECT tr.* INTO v_registration
  FROM public.team_registrations tr
  WHERE tr.id = p_registration_id
  FOR UPDATE;
  IF v_registration.status <> 'APPROVED' THEN
    RAISE EXCEPTION 'Somente inscrições aprovadas podem ser retiradas' USING ERRCODE = '23514';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.rosters
    WHERE season_team_id IN (
      SELECT id FROM public.season_teams
      WHERE season_id = v_registration.season_id AND team_id = v_registration.team_id
    )
  ) OR EXISTS (
    SELECT 1
    FROM public.matches m
    WHERE m.home_team_id IN (
      SELECT id FROM public.season_teams
      WHERE season_id = v_registration.season_id AND team_id = v_registration.team_id
    )
    OR m.away_team_id IN (
      SELECT id FROM public.season_teams
      WHERE season_id = v_registration.season_id AND team_id = v_registration.team_id
    )
  ) THEN
    RAISE EXCEPTION 'Não é possível retirar um time com elenco ou partidas vinculadas' USING ERRCODE = '23514';
  END IF;

  DELETE FROM public.season_teams
  WHERE season_id = v_registration.season_id AND team_id = v_registration.team_id;
  UPDATE public.team_registrations
  SET status = 'WITHDRAWN',
      reviewed_by = auth.uid(),
      reviewed_at = now(),
      updated_at = now()
  WHERE id = p_registration_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.review_team_registration(p_registration_id uuid, p_decision text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_registration public.team_registrations%ROWTYPE;
  v_competition_id uuid;
  v_max_teams integer;
  v_team_count integer;
BEGIN
  IF p_decision NOT IN ('APPROVED', 'REJECTED') THEN
    RAISE EXCEPTION 'Decisão de inscrição inválida' USING ERRCODE = '22023';
  END IF;

  SELECT tr.* INTO v_registration
  FROM public.team_registrations tr
  WHERE tr.id = p_registration_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Inscrição não encontrada' USING ERRCODE = 'P0002';
  END IF;

  SELECT s.competition_id, c.max_teams
  INTO v_competition_id, v_max_teams
  FROM public.seasons s
  JOIN public.competitions c ON c.id = s.competition_id
  WHERE s.id = v_registration.season_id
  FOR UPDATE OF c;

  IF NOT public.can_manage_competition(v_competition_id) THEN
    RAISE EXCEPTION 'Sem permissão para gerenciar esta competição' USING ERRCODE = '42501';
  END IF;

  SELECT tr.* INTO v_registration
  FROM public.team_registrations tr
  WHERE tr.id = p_registration_id
  FOR UPDATE;
  IF v_registration.status <> 'PENDING' THEN
    RAISE EXCEPTION 'Somente inscrições pendentes podem ser revisadas' USING ERRCODE = '23514';
  END IF;

  IF p_decision = 'APPROVED' THEN
    SELECT count(*) INTO v_team_count
    FROM public.season_teams
    WHERE season_id = v_registration.season_id;
    IF v_max_teams IS NOT NULL AND v_team_count >= v_max_teams THEN
      RAISE EXCEPTION 'Não há vagas disponíveis nesta temporada' USING ERRCODE = '23514';
    END IF;

    INSERT INTO public.season_teams (season_id, team_id)
    VALUES (v_registration.season_id, v_registration.team_id)
    ON CONFLICT (season_id, team_id) DO NOTHING;
  END IF;

  UPDATE public.team_registrations
  SET status = p_decision,
      reviewed_by = auth.uid(),
      reviewed_at = now(),
      updated_at = now()
  WHERE id = p_registration_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.register_team_for_season(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.register_team_for_season(uuid, uuid) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.review_team_registration(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.review_team_registration(uuid, text) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.withdraw_team_registration(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.withdraw_team_registration(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.validate_competition_lifecycle()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_allowed boolean := false;
  v_team_count integer;
  v_stage_count integer;
  v_match_count integer;
  v_unresolved_matches integer;
  v_pending_registrations integer;
BEGIN
  IF NEW.max_teams IS NOT NULL AND NEW.max_teams < 1 THEN
    RAISE EXCEPTION 'O limite de times deve ser positivo' USING ERRCODE = '23514';
  END IF;

  IF TG_OP = 'INSERT' AND NEW.status <> 'DRAFT' THEN
    RAISE EXCEPTION 'Uma competição nova deve começar em rascunho' USING ERRCODE = '23514';
  END IF;

  IF TG_OP = 'UPDATE' AND NEW.max_teams IS DISTINCT FROM OLD.max_teams AND NEW.max_teams IS NOT NULL THEN
    IF EXISTS (
      SELECT 1
      FROM public.seasons s
      WHERE s.competition_id = NEW.id
        AND (
          (SELECT count(*) FROM public.season_teams st WHERE st.season_id = s.id) > NEW.max_teams
          OR (SELECT count(*) FROM public.team_registrations tr
              WHERE tr.season_id = s.id AND tr.status = 'PENDING') + 
             (SELECT count(*) FROM public.season_teams st WHERE st.season_id = s.id) > NEW.max_teams
        )
    ) THEN
      RAISE EXCEPTION 'O limite não pode ser menor que as inscrições aprovadas e pendentes' USING ERRCODE = '23514';
    END IF;
  END IF;

  IF TG_OP = 'UPDATE' AND NEW.status IS DISTINCT FROM OLD.status THEN
    v_allowed := CASE OLD.status
      WHEN 'DRAFT' THEN NEW.status IN ('UPCOMING', 'REGISTRATION', 'CANCELLED')
      WHEN 'UPCOMING' THEN NEW.status IN ('REGISTRATION', 'ACTIVE', 'CANCELLED')
      WHEN 'REGISTRATION' THEN NEW.status IN ('UPCOMING', 'ACTIVE', 'CANCELLED')
      WHEN 'ACTIVE' THEN NEW.status IN ('FINISHED', 'CANCELLED')
      WHEN 'FINISHED' THEN false
      WHEN 'CANCELLED' THEN false
      ELSE false
    END;
    IF NOT v_allowed THEN
      RAISE EXCEPTION 'Transição de status inválida: % -> %', OLD.status, NEW.status USING ERRCODE = '23514';
    END IF;

    IF NEW.status = 'ACTIVE' THEN
      SELECT count(*) INTO v_pending_registrations
      FROM public.team_registrations tr
      JOIN public.seasons s ON s.id = tr.season_id
      WHERE s.competition_id = NEW.id AND tr.status = 'PENDING';
      IF v_pending_registrations > 0 THEN
        RAISE EXCEPTION 'Revise ou rejeite todas as inscrições pendentes antes de iniciar' USING ERRCODE = '23514';
      END IF;

      SELECT count(*) INTO v_team_count
      FROM public.season_teams st
      JOIN public.seasons s ON s.id = st.season_id
      WHERE s.competition_id = NEW.id;
      IF v_team_count < 2 THEN
        RAISE EXCEPTION 'A competição precisa de ao menos dois times aprovados para começar' USING ERRCODE = '23514';
      END IF;
      SELECT count(*) INTO v_stage_count
      FROM public.stages stg
      JOIN public.seasons s ON s.id = stg.season_id
      WHERE s.competition_id = NEW.id;
      SELECT count(*) INTO v_match_count
      FROM public.matches m
      JOIN public.rounds r ON r.id = m.round_id
      JOIN public.stages stg ON stg.id = r.stage_id
      JOIN public.seasons s ON s.id = stg.season_id
      WHERE s.competition_id = NEW.id;
      IF v_stage_count = 0 OR v_match_count = 0 THEN
        RAISE EXCEPTION 'Crie uma fase e ao menos uma partida antes de iniciar a competição' USING ERRCODE = '23514';
      END IF;
    ELSIF NEW.status = 'FINISHED' THEN
      SELECT count(*) INTO v_pending_registrations
      FROM public.team_registrations tr
      JOIN public.seasons s ON s.id = tr.season_id
      WHERE s.competition_id = NEW.id AND tr.status = 'PENDING';
      IF v_pending_registrations > 0 THEN
        RAISE EXCEPTION 'Revise ou rejeite todas as inscrições pendentes antes de finalizar' USING ERRCODE = '23514';
      END IF;

      SELECT count(*) INTO v_stage_count
      FROM public.stages stg
      JOIN public.seasons s ON s.id = stg.season_id
      WHERE s.competition_id = NEW.id;
      SELECT count(*) INTO v_match_count
      FROM public.matches m
      JOIN public.rounds r ON r.id = m.round_id
      JOIN public.stages stg ON stg.id = r.stage_id
      JOIN public.seasons s ON s.id = stg.season_id
      WHERE s.competition_id = NEW.id;
      SELECT count(*) INTO v_unresolved_matches
      FROM public.matches m
      JOIN public.rounds r ON r.id = m.round_id
      JOIN public.stages st ON st.id = r.stage_id
      JOIN public.seasons s ON s.id = st.season_id
      WHERE s.competition_id = NEW.id
        AND m.status NOT IN ('FINISHED', 'CANCELLED');
      IF v_unresolved_matches > 0 THEN
        RAISE EXCEPTION 'Não é possível finalizar a competição com partidas pendentes' USING ERRCODE = '23514';
      END IF;
      IF v_stage_count = 0 OR v_match_count = 0 THEN
        RAISE EXCEPTION 'Não é possível finalizar uma competição sem fases e partidas' USING ERRCODE = '23514';
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS competitions_validate_lifecycle ON public.competitions;
CREATE TRIGGER competitions_validate_lifecycle
BEFORE INSERT OR UPDATE ON public.competitions
FOR EACH ROW EXECUTE FUNCTION public.validate_competition_lifecycle();

CREATE OR REPLACE FUNCTION public.validate_season_dates()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.starts_at IS NOT NULL AND NEW.ends_at IS NOT NULL AND NEW.ends_at < NEW.starts_at THEN
    RAISE EXCEPTION 'A data final da temporada não pode anteceder o início' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS seasons_validate_dates ON public.seasons;
CREATE TRIGGER seasons_validate_dates
BEFORE INSERT OR UPDATE ON public.seasons
FOR EACH ROW EXECUTE FUNCTION public.validate_season_dates();

CREATE OR REPLACE FUNCTION public.validate_match_integrity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_season_id uuid;
BEGIN
  SELECT st.season_id INTO v_season_id
  FROM public.rounds r
  JOIN public.stages st ON st.id = r.stage_id
  WHERE r.id = NEW.round_id;
  IF v_season_id IS NULL THEN
    RAISE EXCEPTION 'Rodada não encontrada' USING ERRCODE = '23503';
  END IF;

  IF NEW.home_team_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.season_teams
    WHERE id = NEW.home_team_id AND season_id = v_season_id
  ) THEN
    RAISE EXCEPTION 'O time mandante não está aprovado na temporada da fase' USING ERRCODE = '23514';
  END IF;
  IF NEW.away_team_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.season_teams
    WHERE id = NEW.away_team_id AND season_id = v_season_id
  ) THEN
    RAISE EXCEPTION 'O time visitante não está aprovado na temporada da fase' USING ERRCODE = '23514';
  END IF;
  IF NEW.home_team_id IS NOT NULL AND NEW.home_team_id = NEW.away_team_id THEN
    RAISE EXCEPTION 'Um time não pode enfrentar a si mesmo' USING ERRCODE = '23514';
  END IF;
  IF NEW.status = 'FINISHED' AND (NEW.home_score IS NULL OR NEW.away_score IS NULL) THEN
    RAISE EXCEPTION 'Uma partida finalizada precisa ter placar oficial' USING ERRCODE = '23514';
  END IF;
  IF NEW.duration_seconds IS NOT NULL AND NEW.duration_seconds <= 0 THEN
    RAISE EXCEPTION 'A duração da partida deve ser maior que zero' USING ERRCODE = '23514';
  END IF;
  IF NEW.duration_seconds IS NOT NULL AND EXISTS (
    SELECT 1
    FROM public.goalkeeper_participations gp
    WHERE gp.match_id = NEW.id
      AND (
        gp.started_at_seconds > NEW.duration_seconds
        OR gp.ended_at_seconds > NEW.duration_seconds
        OR gp.first_conceded_at_seconds > NEW.duration_seconds
      )
  ) THEN
    RAISE EXCEPTION 'A duração informada é menor que os tempos registrados para os goleiros' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS matches_validate_integrity ON public.matches;
CREATE TRIGGER matches_validate_integrity
BEFORE INSERT OR UPDATE ON public.matches
FOR EACH ROW EXECUTE FUNCTION public.validate_match_integrity();

CREATE OR REPLACE FUNCTION public.validate_stage_tie_breakers()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_valid_count integer;
BEGIN
  IF cardinality(NEW.tie_breakers) = 0 OR
     cardinality(NEW.tie_breakers) <> (SELECT count(DISTINCT value) FROM unnest(NEW.tie_breakers) AS criteria(value)) THEN
    RAISE EXCEPTION 'Os critérios de desempate precisam ser únicos e conter ao menos um item' USING ERRCODE = '23514';
  END IF;
  SELECT count(*) INTO v_valid_count
  FROM unnest(NEW.tie_breakers) AS criteria(value)
  WHERE value IN ('POINTS', 'WINS', 'GOAL_DIFF', 'GOALS_FOR', 'GOALS_AGAINST', 'TEAM_NAME');
  IF v_valid_count <> cardinality(NEW.tie_breakers) THEN
    RAISE EXCEPTION 'Critério de desempate inválido' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS stages_validate_tie_breakers ON public.stages;
CREATE TRIGGER stages_validate_tie_breakers
BEFORE INSERT OR UPDATE ON public.stages
FOR EACH ROW EXECUTE FUNCTION public.validate_stage_tie_breakers();

CREATE OR REPLACE FUNCTION public.validate_match_event()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_home_team_id uuid;
  v_away_team_id uuid;
  v_duration_seconds integer;
BEGIN
  SELECT home_team_id, away_team_id
       , duration_seconds
  INTO v_home_team_id, v_away_team_id, v_duration_seconds
  FROM public.matches
  WHERE id = NEW.match_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Partida não encontrada' USING ERRCODE = '23503';
  END IF;
  IF v_duration_seconds IS NOT NULL AND NEW.minute_seconds > v_duration_seconds THEN
    RAISE EXCEPTION 'O evento não pode ocorrer após a duração da partida' USING ERRCODE = '23514';
  END IF;
  IF NEW.team_id IS NULL
     OR (NEW.team_id IS DISTINCT FROM v_home_team_id AND NEW.team_id IS DISTINCT FROM v_away_team_id) THEN
    RAISE EXCEPTION 'O evento precisa pertencer a um dos times da partida' USING ERRCODE = '23514';
  END IF;
  IF NEW.player_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.rosters
    WHERE season_team_id = NEW.team_id AND player_id = NEW.player_id
  ) THEN
    RAISE EXCEPTION 'O jogador não pertence ao elenco do time informado' USING ERRCODE = '23514';
  END IF;
  IF NEW.related_player_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.rosters
    WHERE season_team_id = NEW.team_id AND player_id = NEW.related_player_id
  ) THEN
    RAISE EXCEPTION 'O jogador relacionado não pertence ao elenco do time informado' USING ERRCODE = '23514';
  END IF;
  IF NEW.event_type = 'SUBSTITUTION' AND
     (NEW.related_player_id IS NULL OR NEW.related_player_id = NEW.player_id) THEN
    RAISE EXCEPTION 'A substituição precisa indicar dois jogadores diferentes' USING ERRCODE = '23514';
  END IF;
  IF NEW.event_type = 'ASSIST' AND EXISTS (
    SELECT 1 FROM public.match_events e
    WHERE e.match_id = NEW.match_id
      AND e.event_type = 'ASSIST'
      AND e.minute_seconds = NEW.minute_seconds
      AND e.team_id = NEW.team_id
      AND e.player_id = NEW.player_id
      AND e.id IS DISTINCT FROM NEW.id
  ) THEN
    RAISE EXCEPTION 'Esta assistência já foi registrada' USING ERRCODE = '23505';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS match_events_validate ON public.match_events;
CREATE TRIGGER match_events_validate
BEFORE INSERT OR UPDATE ON public.match_events
FOR EACH ROW EXECUTE FUNCTION public.validate_match_event();

CREATE OR REPLACE FUNCTION public.validate_goalkeeper_participation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_home_team_id uuid;
  v_away_team_id uuid;
  v_duration_seconds integer;
  v_first_conceded integer;
BEGIN
  SELECT home_team_id, away_team_id
       , duration_seconds
  INTO v_home_team_id, v_away_team_id, v_duration_seconds
  FROM public.matches
  WHERE id = NEW.match_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Partida não encontrada' USING ERRCODE = '23503';
  END IF;
  IF NEW.team_id IS DISTINCT FROM v_home_team_id
     AND NEW.team_id IS DISTINCT FROM v_away_team_id THEN
    RAISE EXCEPTION 'O time do goleiro não participa desta partida' USING ERRCODE = '23514';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.rosters
    WHERE season_team_id = NEW.team_id AND player_id = NEW.player_id
  ) THEN
    RAISE EXCEPTION 'O goleiro não pertence ao elenco do time informado' USING ERRCODE = '23514';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.players
    WHERE id = NEW.player_id AND position = 'Goleiro'
  ) THEN
    RAISE EXCEPTION 'O jogador informado não está cadastrado como goleiro' USING ERRCODE = '23514';
  END IF;
  IF NEW.started_at_seconds > COALESCE(v_duration_seconds, NEW.started_at_seconds)
     OR (NEW.ended_at_seconds IS NOT NULL
         AND NEW.ended_at_seconds > COALESCE(v_duration_seconds, NEW.ended_at_seconds)) THEN
    RAISE EXCEPTION 'A participação excede a duração registrada da partida' USING ERRCODE = '23514';
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
    RAISE EXCEPTION 'As participações de goleiros do mesmo time não podem se sobrepor' USING ERRCODE = '23514';
  END IF;
  SELECT min(e.minute_seconds) INTO v_first_conceded
  FROM public.match_events e
  WHERE e.match_id = NEW.match_id
    AND e.event_type = 'GOAL'
    AND e.team_id IS NOT NULL
    AND e.team_id <> NEW.team_id
    AND e.minute_seconds >= NEW.started_at_seconds
    AND (NEW.ended_at_seconds IS NULL OR e.minute_seconds <= NEW.ended_at_seconds);
  NEW.first_conceded_at_seconds := v_first_conceded;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS goalkeeper_participations_validate ON public.goalkeeper_participations;
CREATE TRIGGER goalkeeper_participations_validate
BEFORE INSERT OR UPDATE ON public.goalkeeper_participations
FOR EACH ROW EXECUTE FUNCTION public.validate_goalkeeper_participation();

CREATE OR REPLACE FUNCTION public.recalculate_goalkeeper_concessions()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_match_id uuid;
  v_participation public.goalkeeper_participations%ROWTYPE;
  v_first_conceded integer;
BEGIN
  IF TG_OP = 'INSERT' AND NEW.event_type <> 'GOAL' THEN
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' AND OLD.event_type <> 'GOAL' THEN
    RETURN OLD;
  ELSIF TG_OP = 'UPDATE' THEN
    IF NEW.match_id IS DISTINCT FROM OLD.match_id THEN
      RAISE EXCEPTION 'Não é permitido mover um evento para outra partida' USING ERRCODE = '23514';
    END IF;
    IF NEW.event_type <> 'GOAL' AND OLD.event_type <> 'GOAL' THEN
      RETURN NEW;
    END IF;
  END IF;

  v_match_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.match_id ELSE NEW.match_id END;
  FOR v_participation IN
    SELECT * FROM public.goalkeeper_participations WHERE match_id = v_match_id
  LOOP
    SELECT min(e.minute_seconds) INTO v_first_conceded
    FROM public.match_events e
    WHERE e.match_id = v_participation.match_id
      AND e.event_type = 'GOAL'
      AND e.team_id IS NOT NULL
      AND e.team_id <> v_participation.team_id
      AND e.minute_seconds >= v_participation.started_at_seconds
      AND (v_participation.ended_at_seconds IS NULL OR e.minute_seconds <= v_participation.ended_at_seconds);

    UPDATE public.goalkeeper_participations
    SET first_conceded_at_seconds = v_first_conceded
    WHERE id = v_participation.id
      AND first_conceded_at_seconds IS DISTINCT FROM v_first_conceded;
  END LOOP;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS match_events_recalculate_goalkeeper_concessions ON public.match_events;
CREATE TRIGGER match_events_recalculate_goalkeeper_concessions
AFTER INSERT OR UPDATE OR DELETE ON public.match_events
FOR EACH ROW
EXECUTE FUNCTION public.recalculate_goalkeeper_concessions();

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
  ), 0)::integer AS points
FROM public.stages stg
JOIN public.seasons s ON s.id = stg.season_id
JOIN public.season_teams st ON st.season_id = s.id
JOIN public.teams t ON t.id = st.team_id
LEFT JOIN public.rounds r ON r.stage_id = stg.id
LEFT JOIN public.matches m
  ON m.round_id = r.id
  AND m.status = 'FINISHED'
  AND m.home_score IS NOT NULL
  AND m.away_score IS NOT NULL
  AND (m.home_team_id = st.id OR m.away_team_id = st.id)
GROUP BY stg.id, s.id, s.competition_id, st.id, t.id, t.name, t.logo_url;

CREATE OR REPLACE VIEW public.player_competition_statistics
WITH (security_invoker = true) AS
SELECT
  e.player_id,
  s.competition_id,
  s.id AS season_id,
  count(*) FILTER (WHERE e.event_type = 'GOAL')::integer AS goals,
  count(*) FILTER (WHERE e.event_type = 'ASSIST')::integer AS assists
FROM public.match_events e
JOIN public.matches m ON m.id = e.match_id
JOIN public.rounds r ON r.id = m.round_id
JOIN public.stages stg ON stg.id = r.stage_id
JOIN public.seasons s ON s.id = stg.season_id
WHERE e.player_id IS NOT NULL
  AND e.event_type IN ('GOAL', 'ASSIST')
  AND m.status = 'FINISHED'
  AND m.home_score IS NOT NULL
  AND m.away_score IS NOT NULL
GROUP BY e.player_id, s.competition_id, s.id;

CREATE OR REPLACE VIEW public.player_career_statistics
WITH (security_invoker = true) AS
SELECT
  player_id,
  sum(goals)::integer AS goals,
  sum(assists)::integer AS assists
FROM public.player_competition_statistics
GROUP BY player_id;

CREATE OR REPLACE VIEW public.team_competition_statistics
WITH (security_invoker = true) AS
WITH team_results AS (
  SELECT
    s.competition_id,
    s.id AS season_id,
    st.team_id,
    m.id AS match_id,
    m.home_score AS goals_for,
    m.away_score AS goals_against
  FROM public.matches m
  JOIN public.rounds r ON r.id = m.round_id
  JOIN public.stages stg ON stg.id = r.stage_id
  JOIN public.seasons s ON s.id = stg.season_id
  JOIN public.season_teams st ON st.id = m.home_team_id
  WHERE m.status = 'FINISHED' AND m.home_score IS NOT NULL AND m.away_score IS NOT NULL
  UNION ALL
  SELECT
    s.competition_id,
    s.id AS season_id,
    st.team_id,
    m.id AS match_id,
    m.away_score AS goals_for,
    m.home_score AS goals_against
  FROM public.matches m
  JOIN public.rounds r ON r.id = m.round_id
  JOIN public.stages stg ON stg.id = r.stage_id
  JOIN public.seasons s ON s.id = stg.season_id
  JOIN public.season_teams st ON st.id = m.away_team_id
  WHERE m.status = 'FINISHED' AND m.home_score IS NOT NULL AND m.away_score IS NOT NULL
)
SELECT
  competition_id,
  season_id,
  team_id,
  count(*)::integer AS played,
  count(*) FILTER (WHERE goals_for > goals_against)::integer AS wins,
  count(*) FILTER (WHERE goals_for = goals_against)::integer AS draws,
  count(*) FILTER (WHERE goals_for < goals_against)::integer AS losses,
  sum(goals_for)::integer AS goals_for,
  sum(goals_against)::integer AS goals_against,
  sum(goals_for - goals_against)::integer AS goal_difference
FROM team_results
GROUP BY competition_id, season_id, team_id;

CREATE OR REPLACE VIEW public.goalkeeper_clean_sheet_statistics
WITH (security_invoker = true) AS
WITH keeper_spells AS (
  SELECT
    gp.player_id,
    m.id AS match_id,
    s.competition_id,
    team.team_id,
    player.nickname,
    player.photo_url,
    team_record.name AS team_name,
    team_record.logo_url AS team_logo_url,
    gp.started_at_seconds,
    opponent_goal.minute_seconds AS first_conceded_at_seconds,
    gp.ended_at_seconds,
    m.duration_seconds
  FROM public.goalkeeper_participations gp
  JOIN public.matches m ON m.id = gp.match_id
  JOIN public.rounds r ON r.id = m.round_id
  JOIN public.stages stg ON stg.id = r.stage_id
  JOIN public.seasons s ON s.id = stg.season_id
  JOIN public.season_teams team ON team.id = gp.team_id
  JOIN public.teams team_record ON team_record.id = team.team_id
  JOIN public.players player ON player.id = gp.player_id
  LEFT JOIN LATERAL (
    SELECT min(e.minute_seconds) AS minute_seconds
    FROM public.match_events e
    WHERE e.match_id = gp.match_id
      AND e.event_type = 'GOAL'
      AND e.team_id IS NOT NULL
      AND e.team_id <> gp.team_id
      AND e.minute_seconds >= gp.started_at_seconds
      AND (gp.ended_at_seconds IS NULL OR e.minute_seconds <= gp.ended_at_seconds)
  ) opponent_goal ON true
  WHERE m.status = 'FINISHED'
    AND m.home_score IS NOT NULL
    AND m.away_score IS NOT NULL
),
completed_spells AS (
  SELECT *,
    COALESCE(first_conceded_at_seconds, ended_at_seconds, duration_seconds) AS interval_end_seconds
  FROM keeper_spells
  WHERE COALESCE(first_conceded_at_seconds, ended_at_seconds, duration_seconds) IS NOT NULL
)
SELECT
  player_id,
  competition_id,
  team_id,
  nickname,
  photo_url,
  team_name,
  team_logo_url,
  count(DISTINCT match_id)::integer AS games,
  count(*) FILTER (
    WHERE first_conceded_at_seconds IS NULL
      AND (ended_at_seconds IS NOT NULL OR duration_seconds IS NOT NULL)
  )::integer AS clean_sheets,
  sum(GREATEST(0, interval_end_seconds - started_at_seconds))::integer AS total_seconds
FROM completed_spells
GROUP BY player_id, competition_id, team_id, nickname, photo_url, team_name, team_logo_url;

GRANT SELECT ON public.stage_standings, public.player_competition_statistics, public.player_career_statistics,
  public.team_competition_statistics, public.goalkeeper_clean_sheet_statistics TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.generate_round_robin(p_stage_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_season_id uuid;
  v_stage_format text;
  v_rotation uuid[];
  v_next_rotation uuid[];
  v_team_count integer;
  v_size integer;
  v_round_index integer;
  v_pair_index integer;
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
  SELECT season_id, format INTO v_season_id, v_stage_format
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

  SELECT COALESCE(array_agg(id ORDER BY id), ARRAY[]::uuid[])
  INTO v_rotation
  FROM public.season_teams
  WHERE season_id = v_season_id;
  v_team_count := cardinality(v_rotation);
  IF v_team_count < 2 THEN
    RAISE EXCEPTION 'São necessários ao menos dois times aprovados' USING ERRCODE = '23514';
  END IF;

  v_expected_pairs := (v_team_count * (v_team_count - 1)) / 2;
  SELECT
    count(*),
    count(DISTINCT (LEAST(m.home_team_id, m.away_team_id), GREATEST(m.home_team_id, m.away_team_id)))
      FILTER (WHERE m.home_team_id IS NOT NULL AND m.away_team_id IS NOT NULL)
  INTO v_existing_matches, v_existing_pairs
  FROM public.matches m
  JOIN public.rounds r ON r.id = m.round_id
  WHERE r.stage_id = p_stage_id;
  IF v_existing_matches > 0 THEN
    IF v_existing_matches = v_expected_pairs AND v_existing_pairs = v_expected_pairs THEN
      RETURN jsonb_build_object('rounds', 0, 'matches', 0, 'already_generated', true);
    END IF;
    RAISE EXCEPTION 'A fase já possui partidas. Nenhum confronto existente foi alterado' USING ERRCODE = '23514';
  END IF;

  IF v_team_count % 2 = 1 THEN
    v_rotation := array_append(v_rotation, NULL::uuid);
  END IF;
  v_size := cardinality(v_rotation);
  SELECT COALESCE(max(round_order), 0) + 1
  INTO v_round_order
  FROM public.rounds
  WHERE stage_id = p_stage_id;

  FOR v_round_index IN 1..(v_size - 1) LOOP
    INSERT INTO public.rounds (stage_id, name, round_order)
    VALUES (p_stage_id, 'Rodada ' || (v_round_order + v_round_index - 1), v_round_order + v_round_index - 1)
    RETURNING id INTO v_round_id;
    v_created_rounds := v_created_rounds + 1;

    FOR v_pair_index IN 1..(v_size / 2) LOOP
      v_home := v_rotation[v_pair_index];
      v_away := v_rotation[v_size - v_pair_index + 1];
      IF v_home IS NOT NULL AND v_away IS NOT NULL THEN
        IF (v_round_index + v_pair_index) % 2 = 0 THEN
          INSERT INTO public.matches (round_id, home_team_id, away_team_id, status)
          VALUES (v_round_id, v_home, v_away, 'SCHEDULED');
        ELSE
          INSERT INTO public.matches (round_id, home_team_id, away_team_id, status)
          VALUES (v_round_id, v_away, v_home, 'SCHEDULED');
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

  IF v_created_matches <> v_expected_pairs THEN
    RAISE EXCEPTION 'A geração produziu um número inesperado de partidas' USING ERRCODE = '23514';
  END IF;
  RETURN jsonb_build_object('rounds', v_created_rounds, 'matches', v_created_matches, 'already_generated', false);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.generate_round_robin(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.generate_round_robin(uuid) TO authenticated;
