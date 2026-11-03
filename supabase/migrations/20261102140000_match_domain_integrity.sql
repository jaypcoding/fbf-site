ALTER TABLE public.matches
  ADD COLUMN IF NOT EXISTS home_penalty_score integer,
  ADD COLUMN IF NOT EXISTS away_penalty_score integer,
  ADD COLUMN IF NOT EXISTS score_source text NOT NULL DEFAULT 'LEGACY';

ALTER TABLE public.match_events
  ADD COLUMN IF NOT EXISTS period text NOT NULL DEFAULT 'REGULATION',
  ADD COLUMN IF NOT EXISTS is_own_goal boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS goal_event_id uuid;

ALTER TABLE public.goalkeeper_participations
  ADD COLUMN IF NOT EXISTS source_event_id uuid,
  ADD COLUMN IF NOT EXISTS exit_event_id uuid;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.matches'::regclass
      AND conname = 'matches_score_source_valid'
  ) THEN
    ALTER TABLE public.matches
      ADD CONSTRAINT matches_score_source_valid
      CHECK (score_source IN ('EVENTS', 'LEGACY'));
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.matches'::regclass
      AND conname = 'matches_penalty_scores_valid'
  ) THEN
    ALTER TABLE public.matches
      ADD CONSTRAINT matches_penalty_scores_valid
      CHECK (
        (home_penalty_score IS NULL AND away_penalty_score IS NULL)
        OR (
          home_penalty_score >= 0
          AND away_penalty_score >= 0
          AND home_score = away_score
        )
      );
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.match_events'::regclass
      AND conname = 'match_events_period_valid'
  ) THEN
    ALTER TABLE public.match_events
      ADD CONSTRAINT match_events_period_valid
      CHECK (period IN ('REGULATION', 'EXTRA_TIME', 'PENALTY_SHOOTOUT'));
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.match_events'::regclass
      AND conname = 'match_events_goal_link_fk'
  ) THEN
    ALTER TABLE public.match_events
      ADD CONSTRAINT match_events_goal_link_fk
      FOREIGN KEY (goal_event_id) REFERENCES public.match_events(id) ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.goalkeeper_participations'::regclass
      AND conname = 'goalkeeper_participations_source_event_fk'
  ) THEN
    ALTER TABLE public.goalkeeper_participations
      ADD CONSTRAINT goalkeeper_participations_source_event_fk
      FOREIGN KEY (source_event_id) REFERENCES public.match_events(id) ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.goalkeeper_participations'::regclass
      AND conname = 'goalkeeper_participations_exit_event_fk'
  ) THEN
    ALTER TABLE public.goalkeeper_participations
      ADD CONSTRAINT goalkeeper_participations_exit_event_fk
      FOREIGN KEY (exit_event_id) REFERENCES public.match_events(id) ON DELETE SET NULL;
  END IF;
END
$$;

ALTER TABLE public.match_events
  DROP CONSTRAINT IF EXISTS match_events_event_type_check;
ALTER TABLE public.match_events
  ADD CONSTRAINT match_events_event_type_check
  CHECK (event_type IN ('GOAL', 'ASSIST', 'SUBSTITUTION', 'GOALKEEPER_IN', 'GOALKEEPER_OUT'));

CREATE OR REPLACE FUNCTION public.validate_match_integrity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
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
  IF TG_OP = 'UPDATE'
     AND OLD.status NOT IN ('SCHEDULED', 'POSTPONED')
     AND (
       NEW.round_id IS DISTINCT FROM OLD.round_id
       OR NEW.home_team_id IS DISTINCT FROM OLD.home_team_id
       OR NEW.away_team_id IS DISTINCT FROM OLD.away_team_id
       OR NEW.scheduled_at IS DISTINCT FROM OLD.scheduled_at
     ) THEN
    RAISE EXCEPTION 'Não é permitido alterar confronto/data após o início ou encerramento da partida'
      USING ERRCODE = '23514';
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

CREATE UNIQUE INDEX IF NOT EXISTS match_events_goal_identity_idx
  ON public.match_events(match_id, period, team_id, player_id, minute_seconds)
  WHERE event_type = 'GOAL';
CREATE UNIQUE INDEX IF NOT EXISTS match_events_assist_goal_idx
  ON public.match_events(goal_event_id)
  WHERE event_type = 'ASSIST' AND goal_event_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS match_events_substitution_identity_idx
  ON public.match_events(match_id, period, team_id, event_type, player_id, related_player_id, minute_seconds)
  NULLS NOT DISTINCT
  WHERE event_type IN ('SUBSTITUTION', 'GOALKEEPER_IN', 'GOALKEEPER_OUT');
CREATE UNIQUE INDEX IF NOT EXISTS goalkeeper_participations_source_event_idx
  ON public.goalkeeper_participations(source_event_id)
  WHERE source_event_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.match_status_history (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  match_id uuid NOT NULL REFERENCES public.matches(id) ON DELETE RESTRICT,
  previous_status text CHECK (
    previous_status IS NULL
    OR previous_status IN ('SCHEDULED', 'LIVE', 'FINISHED', 'POSTPONED', 'CANCELLED')
  ),
  new_status text NOT NULL CHECK (
    new_status IN ('SCHEDULED', 'LIVE', 'FINISHED', 'POSTPONED', 'CANCELLED')
  ),
  changed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  changed_at timestamptz NOT NULL DEFAULT now(),
  source text NOT NULL CHECK (source IN ('APPLICATION', 'MIGRATION_BASELINE'))
);

CREATE INDEX IF NOT EXISTS match_status_history_match_time_idx
  ON public.match_status_history(match_id, changed_at);

ALTER TABLE public.match_status_history ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.match_status_history FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.match_status_history TO authenticated;
DROP POLICY IF EXISTS "match_status_history_scoped_select" ON public.match_status_history;
CREATE POLICY "match_status_history_scoped_select"
  ON public.match_status_history FOR SELECT TO authenticated
  USING (public.can_manage_match(match_id));

CREATE OR REPLACE FUNCTION public.prevent_match_status_history_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  RAISE EXCEPTION 'O histórico de status das partidas é somente de acréscimo'
    USING ERRCODE = '55000';
END;
$$;

DROP TRIGGER IF EXISTS match_status_history_immutable ON public.match_status_history;
CREATE TRIGGER match_status_history_immutable
BEFORE UPDATE OR DELETE ON public.match_status_history
FOR EACH ROW EXECUTE FUNCTION public.prevent_match_status_history_mutation();

INSERT INTO public.match_status_history (match_id, previous_status, new_status, changed_at, source)
SELECT m.id, NULL, m.status, m.created_at, 'MIGRATION_BASELINE'
FROM public.matches m
WHERE NOT EXISTS (
  SELECT 1 FROM public.match_status_history h WHERE h.match_id = m.id
);

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
      RAISE EXCEPTION 'Uma partida nova deve começar como agendada'
        USING ERRCODE = '23514';
    END IF;
    NEW.score_source := 'EVENTS';
    NEW.home_score := NULL;
    NEW.away_score := NULL;
    NEW.home_penalty_score := NULL;
    NEW.away_penalty_score := NULL;
    RETURN NEW;
  END IF;

  IF NEW.score_source IS DISTINCT FROM OLD.score_source THEN
    RAISE EXCEPTION 'A origem do placar é controlada pelo banco'
      USING ERRCODE = '42501';
  END IF;

  IF OLD.score_source = 'EVENTS'
     AND (
       NEW.home_score IS DISTINCT FROM OLD.home_score
       OR NEW.away_score IS DISTINCT FROM OLD.away_score
       OR NEW.home_penalty_score IS DISTINCT FROM OLD.home_penalty_score
       OR NEW.away_penalty_score IS DISTINCT FROM OLD.away_penalty_score
     )
     AND pg_trigger_depth() < 2 THEN
    RAISE EXCEPTION 'O placar oficial é derivado dos eventos da partida'
      USING ERRCODE = '42501';
  END IF;
  IF OLD.score_source = 'LEGACY'
     AND (
     NEW.home_score IS DISTINCT FROM OLD.home_score
     OR NEW.away_score IS DISTINCT FROM OLD.away_score
     OR NEW.home_penalty_score IS DISTINCT FROM OLD.home_penalty_score
     OR NEW.away_penalty_score IS DISTINCT FROM OLD.away_penalty_score
     )
     AND pg_trigger_depth() < 2 THEN
    RAISE EXCEPTION 'O placar legado precisa ser reconciliado por um processo autorizado'
    USING ERRCODE = '42501';
  END IF;

  IF NEW.status IS DISTINCT FROM OLD.status THEN
    IF NOT CASE OLD.status
      WHEN 'SCHEDULED' THEN NEW.status IN ('LIVE', 'POSTPONED', 'CANCELLED')
      WHEN 'LIVE' THEN NEW.status IN ('FINISHED', 'POSTPONED', 'CANCELLED')
      WHEN 'POSTPONED' THEN NEW.status IN ('SCHEDULED', 'CANCELLED')
      ELSE false
    END THEN
      RAISE EXCEPTION 'Transição de status inválida: % -> %', OLD.status, NEW.status
        USING ERRCODE = '23514';
    END IF;

    IF NEW.status = 'FINISHED' THEN
      SELECT
        count(*) FILTER (
          WHERE e.event_type = 'GOAL'
            AND e.period <> 'PENALTY_SHOOTOUT'
            AND (
              (e.team_id = m.home_team_id AND NOT e.is_own_goal)
              OR (e.team_id = m.away_team_id AND e.is_own_goal)
            )
        )::integer,
        count(*) FILTER (
          WHERE e.event_type = 'GOAL'
            AND e.period <> 'PENALTY_SHOOTOUT'
            AND (
              (e.team_id = m.away_team_id AND NOT e.is_own_goal)
              OR (e.team_id = m.home_team_id AND e.is_own_goal)
            )
        )::integer,
        count(*) FILTER (
          WHERE e.event_type = 'GOAL'
            AND e.period = 'PENALTY_SHOOTOUT'
            AND e.team_id = m.home_team_id
            AND NOT e.is_own_goal
        )::integer,
        count(*) FILTER (
          WHERE e.event_type = 'GOAL'
            AND e.period = 'PENALTY_SHOOTOUT'
            AND e.team_id = m.away_team_id
            AND NOT e.is_own_goal
        )::integer
      INTO v_home_score, v_away_score, v_home_penalties, v_away_penalties
      FROM public.matches m
      LEFT JOIN public.match_events e ON e.match_id = m.id
      WHERE m.id = NEW.id
      GROUP BY m.id;

      IF OLD.score_source = 'LEGACY'
         AND OLD.home_score IS NOT NULL
         AND OLD.away_score IS NOT NULL
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
           AND OLD.home_score IS NOT NULL
           AND OLD.away_score IS NOT NULL
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

      IF NEW.home_penalty_score IS NOT NULL AND NEW.home_score <> NEW.away_score THEN
        RAISE EXCEPTION 'A disputa de pênaltis só pode decidir uma partida empatada no tempo normal/prorrogação'
          USING ERRCODE = '23514';
      END IF;
      IF NEW.home_penalty_score IS NOT NULL
         AND NEW.home_penalty_score = NEW.away_penalty_score THEN
        RAISE EXCEPTION 'A disputa de pênaltis precisa ter um vencedor'
          USING ERRCODE = '23514';
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS matches_validate_status_and_score ON public.matches;
CREATE TRIGGER matches_validate_status_and_score
BEFORE INSERT OR UPDATE ON public.matches
FOR EACH ROW EXECUTE FUNCTION public.validate_match_status_and_score();

CREATE OR REPLACE FUNCTION public.record_match_status_history()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.match_status_history (match_id, previous_status, new_status, changed_by, source)
    VALUES (NEW.id, NULL, NEW.status, auth.uid(), 'APPLICATION');
  ELSIF NEW.status IS DISTINCT FROM OLD.status THEN
    INSERT INTO public.match_status_history (match_id, previous_status, new_status, changed_by, source)
    VALUES (NEW.id, OLD.status, NEW.status, auth.uid(), 'APPLICATION');
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS matches_record_status_history ON public.matches;
CREATE TRIGGER matches_record_status_history
AFTER INSERT OR UPDATE OF status ON public.matches
FOR EACH ROW EXECUTE FUNCTION public.record_match_status_history();

CREATE OR REPLACE FUNCTION public.prevent_match_deletion()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'Partidas não podem ser excluídas; use o status CANCELLED para preservar o histórico'
    USING ERRCODE = '55000';
END;
$$;

DROP TRIGGER IF EXISTS matches_prevent_delete ON public.matches;
CREATE TRIGGER matches_prevent_delete
BEFORE DELETE ON public.matches
FOR EACH ROW EXECUTE FUNCTION public.prevent_match_deletion();

REVOKE DELETE ON public.matches FROM anon, authenticated;
DROP POLICY IF EXISTS "matches_scoped_delete" ON public.matches;
DROP POLICY IF EXISTS "matches_admin_delete" ON public.matches;

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
  IF NEW.player_id IS NULL OR NOT EXISTS (
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

DROP TRIGGER IF EXISTS match_events_validate ON public.match_events;
CREATE TRIGGER match_events_validate
BEFORE INSERT OR UPDATE ON public.match_events
FOR EACH ROW EXECUTE FUNCTION public.validate_match_event();

CREATE OR REPLACE FUNCTION public.invalidate_assists_for_corrected_goal()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.event_type = 'GOAL'
     AND (
       NEW.event_type IS DISTINCT FROM OLD.event_type
       OR NEW.period IS DISTINCT FROM OLD.period
       OR NEW.is_own_goal IS DISTINCT FROM OLD.is_own_goal
       OR NEW.team_id IS DISTINCT FROM OLD.team_id
       OR NEW.player_id IS DISTINCT FROM OLD.player_id
       OR NEW.minute_seconds IS DISTINCT FROM OLD.minute_seconds
     ) THEN
    DELETE FROM public.match_events a
    WHERE a.goal_event_id = OLD.id
      AND NOT (
        NEW.event_type = 'GOAL'
        AND NOT NEW.is_own_goal
        AND NEW.period <> 'PENALTY_SHOOTOUT'
        AND a.player_id <> NEW.player_id
        AND a.match_id = NEW.match_id
        AND a.team_id = NEW.team_id
        AND a.period = NEW.period
        AND a.minute_seconds = NEW.minute_seconds
      );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS match_events_invalidate_assists ON public.match_events;
CREATE TRIGGER match_events_invalidate_assists
BEFORE UPDATE ON public.match_events
FOR EACH ROW EXECUTE FUNCTION public.invalidate_assists_for_corrected_goal();

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

DROP TRIGGER IF EXISTS goalkeeper_participations_validate ON public.goalkeeper_participations;
CREATE TRIGGER goalkeeper_participations_validate
BEFORE INSERT OR UPDATE OR DELETE ON public.goalkeeper_participations
FOR EACH ROW EXECUTE FUNCTION public.validate_goalkeeper_participation();

CREATE OR REPLACE FUNCTION public.sync_goalkeeper_participations_from_events(p_match_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_event public.match_events%ROWTYPE;
  v_in_is_goalkeeper boolean;
  v_out_is_goalkeeper boolean;
  v_active_id uuid;
BEGIN
  DELETE FROM public.goalkeeper_participations
  WHERE match_id = p_match_id AND source_event_id IS NOT NULL;

  UPDATE public.goalkeeper_participations
  SET ended_at_seconds = NULL, exit_event_id = NULL
  WHERE match_id = p_match_id AND exit_event_id IS NOT NULL;

  FOR v_event IN
    SELECT *
    FROM public.match_events
    WHERE match_id = p_match_id
      AND event_type IN ('SUBSTITUTION', 'GOALKEEPER_IN', 'GOALKEEPER_OUT')
    ORDER BY minute_seconds, id
  LOOP
    v_in_is_goalkeeper := false;
    v_out_is_goalkeeper := false;

    IF v_event.event_type = 'GOALKEEPER_IN' THEN
      v_in_is_goalkeeper := true;
    ELSIF v_event.event_type = 'GOALKEEPER_OUT' THEN
      v_out_is_goalkeeper := true;
    ELSE
      SELECT position = 'Goleiro' INTO v_in_is_goalkeeper
      FROM public.players WHERE id = v_event.player_id;
      SELECT position = 'Goleiro' INTO v_out_is_goalkeeper
      FROM public.players WHERE id = v_event.related_player_id;
    END IF;

    IF v_out_is_goalkeeper THEN
      SELECT gp.id INTO v_active_id
      FROM public.goalkeeper_participations gp
      WHERE gp.match_id = p_match_id
        AND gp.team_id = v_event.team_id
        AND gp.player_id = CASE
          WHEN v_event.event_type = 'GOALKEEPER_OUT' THEN v_event.player_id
          ELSE v_event.related_player_id
        END
        AND gp.started_at_seconds <= v_event.minute_seconds
        AND gp.ended_at_seconds IS NULL
      FOR UPDATE;
      IF v_active_id IS NULL THEN
        RAISE EXCEPTION 'Não há participação ativa para o goleiro que está saindo'
          USING ERRCODE = '23514';
      END IF;
      UPDATE public.goalkeeper_participations
      SET ended_at_seconds = v_event.minute_seconds, exit_event_id = v_event.id
      WHERE id = v_active_id;
    END IF;

    IF v_in_is_goalkeeper THEN
      IF EXISTS (
        SELECT 1 FROM public.goalkeeper_participations gp
        WHERE gp.match_id = p_match_id
          AND gp.team_id = v_event.team_id
          AND gp.ended_at_seconds IS NULL
      ) THEN
        RAISE EXCEPTION 'Finalize a participação ativa antes de iniciar outro goleiro'
          USING ERRCODE = '23514';
      END IF;
      INSERT INTO public.goalkeeper_participations (
        match_id, team_id, player_id, started_at_seconds, source_event_id
      )
      VALUES (
        p_match_id, v_event.team_id, v_event.player_id, v_event.minute_seconds, v_event.id
      );
    END IF;
  END LOOP;

  UPDATE public.goalkeeper_participations gp
  SET ended_at_seconds = m.duration_seconds
  FROM public.matches m
  WHERE gp.match_id = p_match_id
    AND m.id = p_match_id
    AND m.status = 'FINISHED'
    AND m.duration_seconds IS NOT NULL
    AND gp.ended_at_seconds IS NULL;

END;
$$;

REVOKE EXECUTE ON FUNCTION public.sync_goalkeeper_participations_from_events(uuid)
  FROM PUBLIC, anon, authenticated;

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

DROP TRIGGER IF EXISTS match_events_sync_derived_data ON public.match_events;
CREATE TRIGGER match_events_sync_derived_data
AFTER INSERT OR UPDATE OR DELETE ON public.match_events
FOR EACH ROW EXECUTE FUNCTION public.sync_match_events_to_derived_data();

DROP TRIGGER IF EXISTS match_events_recalculate_goalkeeper_concessions ON public.match_events;

CREATE OR REPLACE FUNCTION public.close_goalkeeper_participations_on_match_finish()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.status = 'FINISHED'
     AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM NEW.status
          OR OLD.duration_seconds IS DISTINCT FROM NEW.duration_seconds) THEN
    IF EXISTS (
      SELECT 1 FROM public.goalkeeper_participations gp
      WHERE gp.match_id = NEW.id
    ) AND NEW.duration_seconds IS NULL THEN
      RAISE EXCEPTION 'Informe a duração da partida para concluir as participações dos goleiros'
        USING ERRCODE = '23514';
    END IF;
    UPDATE public.goalkeeper_participations
    SET ended_at_seconds = NEW.duration_seconds
    WHERE match_id = NEW.id
      AND ended_at_seconds IS NULL
      AND NEW.duration_seconds IS NOT NULL;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS matches_close_goalkeeper_participations ON public.matches;
CREATE TRIGGER matches_close_goalkeeper_participations
AFTER INSERT OR UPDATE OF status, duration_seconds ON public.matches
FOR EACH ROW EXECUTE FUNCTION public.close_goalkeeper_participations_on_match_finish();

CREATE OR REPLACE FUNCTION public.guard_match_structure_changes()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_TABLE_NAME = 'rounds'
     AND NEW.stage_id IS DISTINCT FROM OLD.stage_id
     AND EXISTS (SELECT 1 FROM public.matches WHERE round_id = OLD.id) THEN
    RAISE EXCEPTION 'Não é permitido mover uma rodada que já possui partidas'
      USING ERRCODE = '23514';
  ELSIF TG_TABLE_NAME = 'stages'
     AND (
       NEW.season_id IS DISTINCT FROM OLD.season_id
       OR NEW.format IS DISTINCT FROM OLD.format
     )
     AND EXISTS (
       SELECT 1 FROM public.rounds r
       JOIN public.matches m ON m.round_id = r.id
       WHERE r.stage_id = OLD.id
     ) THEN
    RAISE EXCEPTION 'Não é permitido alterar temporada/formato de uma fase com partidas'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS rounds_guard_match_structure ON public.rounds;
CREATE TRIGGER rounds_guard_match_structure
BEFORE UPDATE OF stage_id ON public.rounds
FOR EACH ROW EXECUTE FUNCTION public.guard_match_structure_changes();
DROP TRIGGER IF EXISTS stages_guard_match_structure ON public.stages;
CREATE TRIGGER stages_guard_match_structure
BEFORE UPDATE OF season_id, format ON public.stages
FOR EACH ROW EXECUTE FUNCTION public.guard_match_structure_changes();

CREATE TABLE IF NOT EXISTS public.round_robin_pair_claims (
  stage_id uuid NOT NULL REFERENCES public.stages(id) ON DELETE RESTRICT,
  team_low_id uuid NOT NULL REFERENCES public.season_teams(id) ON DELETE RESTRICT,
  team_high_id uuid NOT NULL REFERENCES public.season_teams(id) ON DELETE RESTRICT,
  match_id uuid NOT NULL UNIQUE REFERENCES public.matches(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (stage_id, team_low_id, team_high_id),
  CHECK (team_low_id < team_high_id)
);

ALTER TABLE public.round_robin_pair_claims ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.round_robin_pair_claims FROM PUBLIC, anon, authenticated;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.matches m
    JOIN public.rounds r ON r.id = m.round_id
    JOIN public.stages s ON s.id = r.stage_id
    WHERE s.format = 'Pontos corridos'
      AND m.home_team_id IS NOT NULL
      AND m.away_team_id IS NOT NULL
    GROUP BY s.id, LEAST(m.home_team_id, m.away_team_id), GREATEST(m.home_team_id, m.away_team_id)
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'Há confrontos duplicados em fases de pontos corridos; corrija-os antes de aplicar esta migration';
  END IF;
END
$$;

INSERT INTO public.round_robin_pair_claims (stage_id, team_low_id, team_high_id, match_id)
SELECT s.id, LEAST(m.home_team_id, m.away_team_id), GREATEST(m.home_team_id, m.away_team_id), m.id
FROM public.matches m
JOIN public.rounds r ON r.id = m.round_id
JOIN public.stages s ON s.id = r.stage_id
WHERE s.format = 'Pontos corridos'
  AND m.home_team_id IS NOT NULL
  AND m.away_team_id IS NOT NULL
ON CONFLICT (stage_id, team_low_id, team_high_id) DO NOTHING;

CREATE OR REPLACE FUNCTION public.claim_round_robin_match_pair()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_old_stage_id uuid;
  v_new_stage_id uuid;
  v_format text;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Partidas não podem ser excluídas; cancele a partida para preservar o histórico'
      USING ERRCODE = '55000';
  END IF;

  SELECT stage_id INTO v_new_stage_id FROM public.rounds WHERE id = NEW.round_id;
  SELECT format INTO v_format FROM public.stages WHERE id = v_new_stage_id;

  IF TG_OP = 'UPDATE' THEN
    SELECT stage_id INTO v_old_stage_id FROM public.rounds WHERE id = OLD.round_id;
    IF (v_old_stage_id, OLD.home_team_id, OLD.away_team_id)
       IS NOT DISTINCT FROM (v_new_stage_id, NEW.home_team_id, NEW.away_team_id) THEN
      RETURN NEW;
    END IF;
    DELETE FROM public.round_robin_pair_claims WHERE match_id = OLD.id;
  END IF;

  IF v_format = 'Pontos corridos'
     AND NEW.home_team_id IS NOT NULL
     AND NEW.away_team_id IS NOT NULL THEN
    INSERT INTO public.round_robin_pair_claims (stage_id, team_low_id, team_high_id, match_id)
    VALUES (
      v_new_stage_id,
      LEAST(NEW.home_team_id, NEW.away_team_id),
      GREATEST(NEW.home_team_id, NEW.away_team_id),
      NEW.id
    );
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS matches_claim_round_robin_pair ON public.matches;
CREATE TRIGGER matches_claim_round_robin_pair
AFTER INSERT OR UPDATE ON public.matches
FOR EACH ROW EXECUTE FUNCTION public.claim_round_robin_match_pair();

DROP POLICY IF EXISTS "teams_manager_insert" ON public.teams;
DROP POLICY IF EXISTS "teams_manager_update" ON public.teams;
DROP POLICY IF EXISTS "teams_admin_insert" ON public.teams;
DROP POLICY IF EXISTS "teams_admin_update" ON public.teams;
CREATE POLICY "teams_admin_insert"
  ON public.teams FOR INSERT TO authenticated
  WITH CHECK (public.is_fbf_admin());
CREATE POLICY "teams_admin_update"
  ON public.teams FOR UPDATE TO authenticated
  USING (public.is_fbf_admin())
  WITH CHECK (public.is_fbf_admin());

DROP POLICY IF EXISTS "players_manager_insert" ON public.players;
DROP POLICY IF EXISTS "players_manager_update" ON public.players;
DROP POLICY IF EXISTS "players_admin_insert" ON public.players;
DROP POLICY IF EXISTS "players_admin_update" ON public.players;
CREATE POLICY "players_admin_insert"
  ON public.players FOR INSERT TO authenticated
  WITH CHECK (public.is_fbf_admin());
CREATE POLICY "players_admin_update"
  ON public.players FOR UPDATE TO authenticated
  USING (public.is_fbf_admin())
  WITH CHECK (public.is_fbf_admin());

DROP POLICY IF EXISTS "streamers_manager_insert" ON public.streamers;
DROP POLICY IF EXISTS "streamers_manager_update" ON public.streamers;
DROP POLICY IF EXISTS "streamers_manager_delete" ON public.streamers;
DROP POLICY IF EXISTS "streamers_admin_insert" ON public.streamers;
DROP POLICY IF EXISTS "streamers_admin_update" ON public.streamers;
DROP POLICY IF EXISTS "streamers_admin_delete" ON public.streamers;
CREATE POLICY "streamers_admin_insert"
  ON public.streamers FOR INSERT TO authenticated
  WITH CHECK (public.is_fbf_admin());
CREATE POLICY "streamers_admin_update"
  ON public.streamers FOR UPDATE TO authenticated
  USING (public.is_fbf_admin())
  WITH CHECK (public.is_fbf_admin());
CREATE POLICY "streamers_admin_delete"
  ON public.streamers FOR DELETE TO authenticated
  USING (public.is_fbf_admin());

CREATE OR REPLACE FUNCTION public.prevent_deleting_referenced_shared_data()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_TABLE_NAME = 'teams' AND EXISTS (
    SELECT 1 FROM public.season_teams WHERE team_id = OLD.id
  ) THEN
    RAISE EXCEPTION 'Não é possível excluir um time com histórico de temporadas'
      USING ERRCODE = '23503';
  ELSIF TG_TABLE_NAME = 'players' AND (
    EXISTS (SELECT 1 FROM public.rosters WHERE player_id = OLD.id)
    OR EXISTS (SELECT 1 FROM public.match_events WHERE player_id = OLD.id OR related_player_id = OLD.id)
    OR EXISTS (SELECT 1 FROM public.goalkeeper_participations WHERE player_id = OLD.id)
  ) THEN
    RAISE EXCEPTION 'Não é possível excluir um jogador com histórico de elenco ou partidas'
      USING ERRCODE = '23503';
  ELSIF TG_TABLE_NAME = 'streamers' AND EXISTS (
    SELECT 1 FROM public.match_streamers WHERE streamer_id = OLD.id
  ) THEN
    RAISE EXCEPTION 'Não é possível excluir um streamer vinculado ao histórico de partidas'
      USING ERRCODE = '23503';
  END IF;
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS teams_prevent_referenced_delete ON public.teams;
CREATE TRIGGER teams_prevent_referenced_delete
BEFORE DELETE ON public.teams
FOR EACH ROW EXECUTE FUNCTION public.prevent_deleting_referenced_shared_data();
DROP TRIGGER IF EXISTS players_prevent_referenced_delete ON public.players;
CREATE TRIGGER players_prevent_referenced_delete
BEFORE DELETE ON public.players
FOR EACH ROW EXECUTE FUNCTION public.prevent_deleting_referenced_shared_data();
DROP TRIGGER IF EXISTS streamers_prevent_referenced_delete ON public.streamers;
CREATE TRIGGER streamers_prevent_referenced_delete
BEFORE DELETE ON public.streamers
FOR EACH ROW EXECUTE FUNCTION public.prevent_deleting_referenced_shared_data();

CREATE OR REPLACE FUNCTION public.validate_match_event_assistance_and_goalkeeper_event()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_position text;
  v_out_position text;
BEGIN
  IF NEW.event_type = 'SUBSTITUTION' THEN
    SELECT position INTO v_position FROM public.players WHERE id = NEW.player_id;
    SELECT position INTO v_out_position FROM public.players WHERE id = NEW.related_player_id;
    IF v_position = 'Goleiro' AND v_out_position = 'Goleiro' AND NOT EXISTS (
      SELECT 1 FROM public.goalkeeper_participations gp
      WHERE gp.match_id = NEW.match_id
        AND gp.team_id = NEW.team_id
        AND gp.player_id = NEW.related_player_id
        AND gp.started_at_seconds <= NEW.minute_seconds
        AND gp.ended_at_seconds IS NULL
    ) THEN
      RAISE EXCEPTION 'O goleiro substituído precisa ter participação ativa'
        USING ERRCODE = '23514';
    END IF;
  ELSIF NEW.event_type = 'GOALKEEPER_OUT' THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.goalkeeper_participations gp
      WHERE gp.match_id = NEW.match_id
        AND gp.team_id = NEW.team_id
        AND gp.player_id = NEW.player_id
        AND gp.started_at_seconds <= NEW.minute_seconds
        AND gp.ended_at_seconds IS NULL
    ) THEN
      RAISE EXCEPTION 'O goleiro precisa ter participação ativa antes de sair'
        USING ERRCODE = '23514';
    END IF;
  ELSIF NEW.event_type = 'GOALKEEPER_IN' THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.players WHERE id = NEW.player_id AND position = 'Goleiro'
    ) THEN
      RAISE EXCEPTION 'O jogador que entra precisa estar cadastrado como goleiro'
        USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS match_events_validate_goalkeeper_event ON public.match_events;
CREATE TRIGGER match_events_validate_goalkeeper_event
BEFORE INSERT OR UPDATE ON public.match_events
FOR EACH ROW EXECUTE FUNCTION public.validate_match_event_assistance_and_goalkeeper_event();

CREATE OR REPLACE VIEW public.player_competition_statistics
WITH (security_invoker = true) AS
SELECT
  e.player_id,
  s.competition_id,
  s.id AS season_id,
  count(*) FILTER (
    WHERE e.event_type = 'GOAL'
      AND NOT e.is_own_goal
      AND e.period <> 'PENALTY_SHOOTOUT'
  )::integer AS goals,
  count(*) FILTER (
    WHERE e.event_type = 'ASSIST'
      AND e.goal_event_id IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM public.match_events goal
        WHERE goal.id = e.goal_event_id
          AND goal.match_id = e.match_id
          AND goal.event_type = 'GOAL'
          AND NOT goal.is_own_goal
          AND goal.period <> 'PENALTY_SHOOTOUT'
          AND goal.team_id = e.team_id
          AND goal.player_id <> e.player_id
          AND goal.minute_seconds = e.minute_seconds
          AND goal.period = e.period
      )
  )::integer AS assists
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
  AND m.score_source = 'EVENTS'
GROUP BY e.player_id, s.competition_id, s.id;

CREATE OR REPLACE VIEW public.goalkeeper_match_clean_sheet_statistics
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
    m.score_source,
    CASE
      WHEN m.score_source = 'LEGACY' THEN
        CASE
          WHEN gp.team_id = m.home_team_id THEN m.away_score
          ELSE m.home_score
        END
      ELSE NULL
    END AS legacy_goals_against,
    CASE
      WHEN m.score_source = 'LEGACY' THEN NULL
      ELSE opponent_goal.minute_seconds
    END AS first_conceded_at_seconds,
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
      AND m.score_source = 'EVENTS'
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
          gp.ended_at_seconds = m.duration_seconds
          AND gp.started_at_seconds < gp.ended_at_seconds
          AND e.minute_seconds = gp.ended_at_seconds
        )
      )
  ) opponent_goal ON true
  WHERE m.status = 'FINISHED'
    AND m.home_score IS NOT NULL
    AND m.away_score IS NOT NULL
    AND m.duration_seconds IS NOT NULL
    AND gp.ended_at_seconds IS NOT NULL
    AND gp.started_at_seconds <= gp.ended_at_seconds
    AND gp.ended_at_seconds <= m.duration_seconds
),
completed_spells AS (
  SELECT
    *,
    CASE
      WHEN score_source = 'LEGACY' THEN legacy_goals_against = 0
      ELSE first_conceded_at_seconds IS NULL
    END AS clean_spell,
    CASE
      WHEN score_source = 'LEGACY' AND legacy_goals_against > 0 THEN 0
      WHEN score_source = 'LEGACY' THEN GREATEST(0, ended_at_seconds - started_at_seconds)
      ELSE GREATEST(
        0,
        COALESCE(first_conceded_at_seconds, ended_at_seconds) - started_at_seconds
      )
    END AS clean_seconds
  FROM keeper_spells
  WHERE ended_at_seconds IS NOT NULL
    AND ended_at_seconds >= started_at_seconds
),
keeper_match_totals AS (
  SELECT
    player_id,
    match_id,
    competition_id,
    team_id,
    nickname,
    photo_url,
    team_name,
    team_logo_url,
    bool_or(clean_spell) AS earned_clean_sheet,
    sum(clean_seconds)::integer AS clean_seconds
  FROM completed_spells
  GROUP BY player_id, match_id, competition_id, team_id, nickname, photo_url, team_name, team_logo_url
)
SELECT
  player_id,
  match_id,
  competition_id,
  team_id,
  nickname,
  photo_url,
  team_name,
  team_logo_url,
  earned_clean_sheet AS clean_sheet,
  clean_seconds AS total_seconds
FROM keeper_match_totals
;

CREATE OR REPLACE VIEW public.goalkeeper_clean_sheet_statistics
WITH (security_invoker = true) AS
SELECT
  player_id,
  competition_id,
  team_id,
  nickname,
  photo_url,
  team_name,
  team_logo_url,
  count(*)::integer AS games,
  count(*) FILTER (WHERE clean_sheet)::integer AS clean_sheets,
  sum(total_seconds)::integer AS total_seconds
FROM public.goalkeeper_match_clean_sheet_statistics
GROUP BY player_id, competition_id, team_id, nickname, photo_url, team_name, team_logo_url;

GRANT SELECT ON public.player_competition_statistics, public.goalkeeper_match_clean_sheet_statistics,
  public.goalkeeper_clean_sheet_statistics
  TO anon, authenticated;
