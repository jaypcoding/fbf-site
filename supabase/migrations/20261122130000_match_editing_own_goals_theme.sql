-- Editing registered matches, own goals in the statistics, theme preference.
--
-- Additive: new table, new functions, new columns at the end of two views and
-- of profiles, new allowed status of a replay review. No data is changed.
--
-- 1. edit_match_sheet(): authorised managers (admins, organizers of the
--    competition) correct a FINISHED match (goals, authors, assists, own goals,
--    goalkeepers, duration and the replay statistics) in one transaction. The
--    complete previous and new states are kept in match_edit_history
--    (immutable). Standings, top scorers and every view are derived from the
--    events, so they follow automatically.
-- 2. A sheet confirmed from recordings can be reopened (status SUPERSEDED) and
--    a finished match can be corrected from recordings: confirmation with
--    replacement of the current goals, assists and goalkeepers (history kept).
-- 3. own_goals in player_competition_statistics and player_career_statistics.
-- 4. profiles.theme_preference ('light' | 'dark') saved with
--    set_my_theme_preference().

-- 1. History -----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.match_edit_history (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  match_id uuid NOT NULL REFERENCES public.matches(id) ON DELETE RESTRICT,
  actor uuid DEFAULT auth.uid(),
  source text NOT NULL CHECK (source IN ('MANUAL', 'REPLAY')),
  reason text NOT NULL,
  before jsonb NOT NULL,
  after jsonb NOT NULL,
  changes jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS match_edit_history_match_idx ON public.match_edit_history(match_id, created_at);
ALTER TABLE public.match_edit_history ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS match_edit_history_manager_select ON public.match_edit_history;
CREATE POLICY match_edit_history_manager_select ON public.match_edit_history
  FOR SELECT TO authenticated USING (public.can_manage_match(match_id));
REVOKE ALL ON public.match_edit_history FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public.match_edit_history FROM authenticated;
GRANT SELECT ON public.match_edit_history TO authenticated;

CREATE OR REPLACE FUNCTION public.prevent_match_edit_history_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'O histórico de alterações da partida não pode ser alterado' USING ERRCODE = '42501';
END;
$$;
DROP TRIGGER IF EXISTS match_edit_history_immutable ON public.match_edit_history;
CREATE TRIGGER match_edit_history_immutable
BEFORE UPDATE OR DELETE ON public.match_edit_history
FOR EACH ROW EXECUTE FUNCTION public.prevent_match_edit_history_mutation();

-- Complete state of a match sheet (match columns, events, replay report).
CREATE OR REPLACE FUNCTION public._match_sheet_snapshot(p_match_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT jsonb_build_object(
    'match', (SELECT jsonb_build_object('status', m.status, 'home_score', m.home_score, 'away_score', m.away_score,
        'home_penalty_score', m.home_penalty_score, 'away_penalty_score', m.away_penalty_score,
        'duration_seconds', m.duration_seconds, 'recorded_retroactively', m.recorded_retroactively, 'scheduled_at', m.scheduled_at)
      FROM public.matches m WHERE m.id = p_match_id),
    'events', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', e.id, 'event_type', e.event_type, 'minute_seconds', e.minute_seconds,
        'period', e.period, 'team_id', e.team_id, 'player_id', e.player_id, 'related_player_id', e.related_player_id,
        'is_own_goal', e.is_own_goal, 'goal_event_id', e.goal_event_id, 'metadata', e.metadata)
        ORDER BY e.minute_seconds, e.event_type, e.id)
      FROM public.match_events e WHERE e.match_id = p_match_id), '[]'::jsonb),
    'report', (SELECT r.report FROM public.match_replay_reports r WHERE r.match_id = p_match_id)
  );
$$;
REVOKE EXECUTE ON FUNCTION public._match_sheet_snapshot(uuid) FROM PUBLIC, anon, authenticated;

-- Version of a match sheet shown in the editor (detects concurrent edits).
CREATE OR REPLACE FUNCTION public.match_sheet_fingerprint(p_match_id uuid)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT public.can_manage_match(p_match_id) THEN
    RAISE EXCEPTION 'Sem permissão para gerenciar esta partida' USING ERRCODE = '42501';
  END IF;
  RETURN md5(public._match_sheet_snapshot(p_match_id)::text);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.match_sheet_fingerprint(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.match_sheet_fingerprint(uuid) TO authenticated;

-- Goalkeeper periods opened by events on an already finished match are closed
-- at the end of the match (or at the next period of the same team) by the
-- existing rule of validate_goalkeeper_participation, applied by a touch.
CREATE OR REPLACE FUNCTION public._close_open_goalkeeper_periods(p_match_id uuid)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  UPDATE public.goalkeeper_participations SET started_at_seconds = started_at_seconds
  WHERE match_id = p_match_id AND ended_at_seconds IS NULL;
$$;
REVOKE EXECUTE ON FUNCTION public._close_open_goalkeeper_periods(uuid) FROM PUBLIC, anon, authenticated;

-- Replay report: changed only by the edit and confirmation functions (marker).
CREATE OR REPLACE FUNCTION public.prevent_match_replay_report_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF COALESCE(current_setting('fbf.match_edit', true), '') = (CASE WHEN TG_OP = 'DELETE' THEN OLD.match_id ELSE NEW.match_id END)::text THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'O relatório de uma súmula validada só muda pela edição da partida' USING ERRCODE = '42501';
END;
$$;

-- 2. Editing a registered match ----------------------------------------------
CREATE OR REPLACE FUNCTION public.edit_match_sheet(
  p_match_id uuid,
  p_fingerprint text,
  p_payload jsonb,
  p_reason text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_match public.matches%ROWTYPE;
  v_competition_status text;
  v_before jsonb;
  v_after jsonb;
  v_goal jsonb;
  v_keeper jsonb;
  v_team uuid;
  v_player uuid;
  v_assist uuid;
  v_own boolean;
  v_minute integer;
  v_period text;
  v_metadata jsonb;
  v_goal_event_id uuid;
  v_duration integer;
  v_expected_home integer;
  v_expected_away integer;
  v_home integer;
  v_away integer;
  v_needs_retroactive boolean := false;
  v_patch jsonb;
  v_key text;
  v_value jsonb;
  v_index integer;
  v_report jsonb;
  v_history_id bigint;
  v_allowed text[] := ARRAY['kicks', 'passes', 'shots', 'shotsOnTarget', 'possessionTicks', 'touches', 'playedTicks'];
BEGIN
  SELECT * INTO v_match FROM public.matches WHERE id = p_match_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Partida não encontrada' USING ERRCODE = 'P0002'; END IF;
  IF NOT public.can_manage_match(p_match_id) THEN
    RAISE EXCEPTION 'Sem permissão para editar esta partida' USING ERRCODE = '42501';
  END IF;
  IF v_match.status <> 'FINISHED' THEN
    RAISE EXCEPTION 'Somente partidas finalizadas são editadas por aqui; para registrar um resultado use "Registrar resultado"' USING ERRCODE = '23514';
  END IF;
  SELECT c.status INTO v_competition_status
  FROM public.rounds r JOIN public.stages stg ON stg.id = r.stage_id
  JOIN public.seasons s ON s.id = stg.season_id JOIN public.competitions c ON c.id = s.competition_id
  WHERE r.id = v_match.round_id;
  IF v_competition_status NOT IN ('UPCOMING', 'REGISTRATION', 'ACTIVE') AND NOT public.is_fbf_admin() THEN
    RAISE EXCEPTION 'Partidas de competições encerradas só podem ser editadas por administradores' USING ERRCODE = '42501';
  END IF;
  IF length(btrim(COALESCE(p_reason, ''))) < 3 THEN
    RAISE EXCEPTION 'Informe o motivo da correção' USING ERRCODE = '22023';
  END IF;
  IF jsonb_typeof(p_payload) IS DISTINCT FROM 'object' OR jsonb_typeof(p_payload->'goals') IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'Dados da correção inválidos' USING ERRCODE = '22023';
  END IF;
  v_before := public._match_sheet_snapshot(p_match_id);
  IF p_fingerprint IS DISTINCT FROM md5(v_before::text) THEN
    RAISE EXCEPTION 'A partida foi alterada por outra pessoa enquanto você editava; recarregue e confira antes de salvar' USING ERRCODE = '55000';
  END IF;
  v_expected_home := (p_payload->'score'->>'home')::integer;
  v_expected_away := (p_payload->'score'->>'away')::integer;
  IF v_expected_home IS NULL OR v_expected_away IS NULL OR v_expected_home < 0 OR v_expected_away < 0 THEN
    RAISE EXCEPTION 'Informe o placar corrigido' USING ERRCODE = '22023';
  END IF;
  v_duration := COALESCE(NULLIF(p_payload->>'duration_seconds', '')::integer, v_match.duration_seconds);
  IF v_duration IS NOT NULL AND v_duration <= 0 THEN
    RAISE EXCEPTION 'A duração da partida deve ser maior que zero' USING ERRCODE = '22023';
  END IF;

  -- validate every goal before changing anything
  FOR v_goal IN SELECT value FROM jsonb_array_elements(p_payload->'goals')
  LOOP
    v_team := NULLIF(v_goal->>'team_id', '')::uuid;
    v_player := NULLIF(v_goal->>'player_id', '')::uuid;
    v_assist := NULLIF(v_goal->>'assist_player_id', '')::uuid;
    v_own := COALESCE((v_goal->>'is_own_goal')::boolean, false);
    v_period := COALESCE(NULLIF(v_goal->>'period', ''), 'REGULATION');
    v_minute := NULLIF(v_goal->>'minute_seconds', '')::integer;
    IF v_team IS DISTINCT FROM v_match.home_team_id AND v_team IS DISTINCT FROM v_match.away_team_id THEN
      RAISE EXCEPTION 'Cada gol precisa pertencer a uma das equipes da partida' USING ERRCODE = '23514';
    END IF;
    IF v_period NOT IN ('REGULATION', 'EXTRA_TIME', 'PENALTY_SHOOTOUT') THEN
      RAISE EXCEPTION 'Período de gol inválido' USING ERRCODE = '22023';
    END IF;
    IF v_own AND (v_assist IS NOT NULL OR v_period = 'PENALTY_SHOOTOUT') THEN
      RAISE EXCEPTION 'Gol contra não tem assistência nem vale na disputa de pênaltis' USING ERRCODE = '23514';
    END IF;
    IF v_assist IS NOT NULL AND (v_player IS NULL OR v_assist = v_player) THEN
      RAISE EXCEPTION 'A assistência precisa de um autor diferente do assistente' USING ERRCODE = '23514';
    END IF;
    IF v_player IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.rosters WHERE season_team_id = v_team AND player_id = v_player) THEN
      RAISE EXCEPTION 'O autor de um gol não pertence ao elenco da equipe informada (no gol contra, informe a equipe do jogador que o marcou)' USING ERRCODE = '23514';
    END IF;
    IF v_assist IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.rosters WHERE season_team_id = v_team AND player_id = v_assist) THEN
      RAISE EXCEPTION 'O autor de uma assistência não pertence ao elenco da equipe' USING ERRCODE = '23514';
    END IF;
    IF v_minute IS NOT NULL AND (v_minute < 0 OR (v_duration IS NOT NULL AND v_minute > v_duration)) THEN
      RAISE EXCEPTION 'O tempo de um gol está fora da duração da partida' USING ERRCODE = '23514';
    END IF;
    IF v_player IS NULL AND v_period <> 'PENALTY_SHOOTOUT' THEN v_needs_retroactive := true; END IF;
  END LOOP;

  PERFORM set_config('fbf.retroactive_match', p_match_id::text, true);
  PERFORM set_config('fbf.match_edit', p_match_id::text, true);
  DELETE FROM public.match_events WHERE match_id = p_match_id AND event_type = 'ASSIST';
  DELETE FROM public.match_events WHERE match_id = p_match_id AND event_type = 'GOAL';
  IF p_payload ? 'goalkeepers' THEN
    DELETE FROM public.match_events WHERE match_id = p_match_id AND event_type IN ('GOALKEEPER_IN', 'GOALKEEPER_OUT');
  END IF;
  UPDATE public.matches
  SET duration_seconds = v_duration,
      duration_is_presumed = CASE WHEN p_payload ? 'duration_seconds' THEN false ELSE duration_is_presumed END,
      recorded_retroactively = recorded_retroactively OR v_needs_retroactive
  WHERE id = p_match_id;

  IF p_payload ? 'goalkeepers' THEN
    FOR v_keeper IN SELECT value FROM jsonb_array_elements(COALESCE(p_payload->'goalkeepers', '[]'::jsonb))
    LOOP
      INSERT INTO public.match_events (match_id, event_type, minute_seconds, period, team_id, player_id, metadata)
      VALUES (p_match_id, 'GOALKEEPER_IN', COALESCE((v_keeper->>'started_at_seconds')::integer, 0), 'REGULATION',
        (v_keeper->>'team_id')::uuid, (v_keeper->>'player_id')::uuid, jsonb_build_object('source', 'EDIT'));
    END LOOP;
  END IF;

  FOR v_goal IN SELECT value FROM jsonb_array_elements(p_payload->'goals')
  LOOP
    v_minute := NULLIF(v_goal->>'minute_seconds', '')::integer;
    v_metadata := jsonb_build_object('source', 'EDIT');
    IF v_minute IS NULL THEN
      v_minute := 0;
      v_metadata := v_metadata || jsonb_build_object('minute_unknown', true);
    END IF;
    IF jsonb_typeof(v_goal->'metadata') = 'object' THEN
      -- parentheses: in PostgreSQL '-' binds tighter than '->'
      v_metadata := ((v_goal->'metadata') - 'minute_unknown'::text - 'source'::text) || v_metadata || jsonb_build_object('previous_source', (v_goal->'metadata')->'source');
    END IF;
    v_period := COALESCE(NULLIF(v_goal->>'period', ''), 'REGULATION');
    INSERT INTO public.match_events (match_id, event_type, minute_seconds, period, team_id, player_id, is_own_goal, metadata)
    VALUES (p_match_id, 'GOAL', v_minute, v_period, (v_goal->>'team_id')::uuid, NULLIF(v_goal->>'player_id', '')::uuid,
      COALESCE((v_goal->>'is_own_goal')::boolean, false), v_metadata)
    RETURNING id INTO v_goal_event_id;
    IF NULLIF(v_goal->>'assist_player_id', '') IS NOT NULL THEN
      INSERT INTO public.match_events (match_id, event_type, minute_seconds, period, team_id, player_id, goal_event_id, metadata)
      VALUES (p_match_id, 'ASSIST', v_minute, v_period, (v_goal->>'team_id')::uuid, (v_goal->>'assist_player_id')::uuid, v_goal_event_id, v_metadata);
    END IF;
  END LOOP;
  PERFORM public._close_open_goalkeeper_periods(p_match_id);

  SELECT home_score, away_score INTO v_home, v_away FROM public.matches WHERE id = p_match_id;
  IF v_home IS DISTINCT FROM v_expected_home OR v_away IS DISTINCT FROM v_expected_away THEN
    RAISE EXCEPTION 'Os gols informados resultam em % × %, mas o placar corrigido é % × %; nada foi alterado',
      v_home, v_away, v_expected_home, v_expected_away USING ERRCODE = '23514';
  END IF;

  -- statistics extracted from recordings (only when the match has a replay report)
  v_patch := p_payload->'report_patch';
  IF jsonb_typeof(v_patch) = 'object' THEN
    SELECT report INTO v_report FROM public.match_replay_reports WHERE match_id = p_match_id;
    IF v_report IS NULL THEN
      RAISE EXCEPTION 'Esta partida não tem estatísticas de gravação para corrigir' USING ERRCODE = '23514';
    END IF;
    FOR v_index, v_value IN SELECT (x->>'index')::integer, x->'stats' FROM jsonb_array_elements(COALESCE(v_patch->'players', '[]'::jsonb)) x
    LOOP
      IF v_index IS NULL OR v_index < 0 OR v_index >= jsonb_array_length(v_report->'players') THEN
        RAISE EXCEPTION 'Jogador inválido na correção de estatísticas' USING ERRCODE = '22023';
      END IF;
      FOR v_key IN SELECT jsonb_object_keys(v_value)
      LOOP
        IF NOT v_key = ANY (v_allowed) OR jsonb_typeof(v_value->v_key) <> 'number' OR (v_value->>v_key)::numeric < 0 THEN
          RAISE EXCEPTION 'Estatística inválida: %', v_key USING ERRCODE = '22023';
        END IF;
        v_report := jsonb_set(v_report, ARRAY['players', v_index::text, 'stats', v_key], to_jsonb(round((v_value->>v_key)::numeric)));
      END LOOP;
    END LOOP;
    FOR v_key IN SELECT unnest(ARRAY['home', 'away'])
    LOOP
      IF jsonb_typeof(v_patch->'teams'->v_key) = 'object' THEN
        DECLARE v_stat text; BEGIN
          FOR v_stat IN SELECT jsonb_object_keys(v_patch->'teams'->v_key)
          LOOP
            IF NOT v_stat = ANY (ARRAY['kicks', 'passes', 'shots', 'shotsOnTarget', 'possessionTicks'])
               OR jsonb_typeof(v_patch->'teams'->v_key->v_stat) <> 'number' OR (v_patch->'teams'->v_key->>v_stat)::numeric < 0 THEN
              RAISE EXCEPTION 'Estatística de equipe inválida: %', v_stat USING ERRCODE = '22023';
            END IF;
            v_report := jsonb_set(v_report, ARRAY['teams', v_key, v_stat], to_jsonb(round((v_patch->'teams'->v_key->>v_stat)::numeric)));
          END LOOP;
        END;
      END IF;
    END LOOP;
    v_report := jsonb_set(v_report, '{edited}', 'true'::jsonb);
    UPDATE public.match_replay_reports SET report = v_report WHERE match_id = p_match_id;
  END IF;

  v_after := public._match_sheet_snapshot(p_match_id);
  INSERT INTO public.match_edit_history (match_id, source, reason, before, after, changes)
  VALUES (p_match_id, 'MANUAL', btrim(p_reason), v_before, v_after, jsonb_build_object(
    'score_before', jsonb_build_array(v_before->'match'->'home_score', v_before->'match'->'away_score'),
    'score_after', jsonb_build_array(v_home, v_away),
    'goals_before', (SELECT count(*) FROM jsonb_array_elements(v_before->'events') x WHERE x->>'event_type' = 'GOAL'),
    'goals_after', (SELECT count(*) FROM jsonb_array_elements(v_after->'events') x WHERE x->>'event_type' = 'GOAL'),
    'duration_before', v_before->'match'->'duration_seconds',
    'duration_after', v_after->'match'->'duration_seconds',
    'goalkeepers_changed', p_payload ? 'goalkeepers',
    'statistics_changed', jsonb_typeof(v_patch) = 'object'))
  RETURNING id INTO v_history_id;
  PERFORM set_config('fbf.retroactive_match', '', true);
  PERFORM set_config('fbf.match_edit', '', true);
  RETURN jsonb_build_object('home_score', v_home, 'away_score', v_away, 'history_id', v_history_id, 'fingerprint', md5(v_after::text));
END;
$$;
REVOKE EXECUTE ON FUNCTION public.edit_match_sheet(uuid, text, jsonb, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.edit_match_sheet(uuid, text, jsonb, text) TO authenticated;

-- 3. Replay sheets: reopening and correction of finished matches -------------
ALTER TABLE public.match_replay_reviews DROP CONSTRAINT IF EXISTS match_replay_reviews_status_check;
ALTER TABLE public.match_replay_reviews ADD CONSTRAINT match_replay_reviews_status_check
  CHECK (status IN ('DRAFT', 'CONFIRMED', 'CANCELLED', 'SUPERSEDED'));

CREATE OR REPLACE FUNCTION public.guard_confirmed_match_replay_review()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Revisões de súmula não podem ser excluídas' USING ERRCODE = '42501';
  END IF;
  IF OLD.status = 'CONFIRMED' AND NEW.status = 'SUPERSEDED'
     AND COALESCE(current_setting('fbf.match_edit', true), '') = OLD.match_id::text THEN
    RETURN NEW;
  END IF;
  IF OLD.status IN ('CONFIRMED', 'CANCELLED', 'SUPERSEDED') THEN
    RAISE EXCEPTION 'Esta revisão de súmula já foi encerrada e não pode ser alterada' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.reopen_match_replay_review(p_match_id uuid, p_reason text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_review_id uuid;
  v_draft uuid;
BEGIN
  IF NOT public.can_manage_match(p_match_id) THEN
    RAISE EXCEPTION 'Sem permissão para gerenciar esta partida' USING ERRCODE = '42501';
  END IF;
  IF length(btrim(COALESCE(p_reason, ''))) < 3 THEN
    RAISE EXCEPTION 'Informe o motivo da reabertura' USING ERRCODE = '22023';
  END IF;
  PERFORM 1 FROM public.matches WHERE id = p_match_id FOR UPDATE;
  SELECT id INTO v_review_id FROM public.match_replay_reviews WHERE match_id = p_match_id AND status = 'CONFIRMED' FOR UPDATE;
  IF v_review_id IS NULL THEN
    RAISE EXCEPTION 'Esta partida não tem súmula por gravação validada' USING ERRCODE = 'P0002';
  END IF;
  PERFORM set_config('fbf.match_edit', p_match_id::text, true);
  UPDATE public.match_replay_reviews SET status = 'SUPERSEDED', updated_at = now() WHERE id = v_review_id;
  PERFORM set_config('fbf.match_edit', '', true);
  v_draft := public._match_replay_draft(p_match_id);
  INSERT INTO public.match_replay_audit (match_id, review_id, action, details)
  VALUES (p_match_id, v_review_id, 'REOPEN', jsonb_build_object('reason', btrim(p_reason), 'new_review_id', v_draft));
  RETURN v_draft;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.reopen_match_replay_review(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reopen_match_replay_review(uuid, text) TO authenticated;

-- Confirmation that can replace the goals, assists and goalkeepers of a finished match.
CREATE OR REPLACE FUNCTION public.confirm_match_replay_review(p_match_id uuid, p_sheet_hash text, p_replace_existing boolean)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_match public.matches%ROWTYPE;
  v_review public.match_replay_reviews%ROWTYPE;
  v_competition_status text;
  v_official jsonb;
  v_goal jsonb;
  v_keeper jsonb;
  v_alias jsonb;
  v_goal_event_id uuid;
  v_team uuid;
  v_side text;
  v_player uuid;
  v_assist uuid;
  v_minute integer;
  v_duration integer;
  v_home integer := 0;
  v_away integer := 0;
  v_home_score integer;
  v_away_score integer;
  v_files uuid[];
  v_expected_files uuid[];
  v_metadata jsonb;
  v_goals integer := 0;
  v_keepers integer := 0;
  v_replacing boolean := false;
  v_before jsonb;
  v_history_id bigint;
BEGIN
  SELECT * INTO v_match FROM public.matches WHERE id = p_match_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Partida não encontrada' USING ERRCODE = 'P0002'; END IF;
  IF NOT public.can_manage_match(p_match_id) THEN
    RAISE EXCEPTION 'Sem permissão para gerenciar esta partida' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_review FROM public.match_replay_reviews WHERE match_id = p_match_id AND status = 'DRAFT' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Não há súmula em revisão para esta partida' USING ERRCODE = 'P0002'; END IF;
  IF v_review.sheet_hash IS NULL OR v_review.official IS NULL OR v_review.sheet IS NULL THEN
    RAISE EXCEPTION 'A súmula ainda está sendo preparada; aguarde a análise terminar' USING ERRCODE = '23514';
  END IF;
  IF p_sheet_hash IS DISTINCT FROM v_review.sheet_hash THEN
    RAISE EXCEPTION 'A súmula mudou desde que foi exibida; confira a versão atual antes de confirmar' USING ERRCODE = '55000';
  END IF;
  IF COALESCE((v_review.sheet->>'canConfirm')::boolean, false) IS NOT TRUE THEN
    RAISE EXCEPTION 'Resolva as pendências da súmula antes de confirmar' USING ERRCODE = '23514';
  END IF;
  v_official := v_review.official;
  IF (v_official->>'matchId')::uuid IS DISTINCT FROM p_match_id THEN
    RAISE EXCEPTION 'A súmula não corresponde a esta partida' USING ERRCODE = '23514';
  END IF;

  SELECT c.status INTO v_competition_status
  FROM public.rounds r JOIN public.stages stg ON stg.id = r.stage_id
  JOIN public.seasons s ON s.id = stg.season_id JOIN public.competitions c ON c.id = s.competition_id
  WHERE r.id = v_match.round_id;
  IF v_competition_status NOT IN ('UPCOMING', 'REGISTRATION', 'ACTIVE') THEN
    RAISE EXCEPTION 'Resultados só podem ser registrados em competições publicadas e não encerradas' USING ERRCODE = '23514';
  END IF;
  IF v_match.status = 'FINISHED' AND COALESCE(p_replace_existing, false) THEN
    v_replacing := true;
  ELSIF v_match.status NOT IN ('SCHEDULED', 'POSTPONED') THEN
    RAISE EXCEPTION 'Esta partida já tem resultado registrado; confirme a substituição dos gols, assistências e goleiros atuais pelos da gravação' USING ERRCODE = '23514';
  END IF;
  IF v_match.home_team_id IS NULL OR v_match.away_team_id IS NULL THEN
    RAISE EXCEPTION 'A partida precisa ter as duas equipes definidas' USING ERRCODE = '23514';
  END IF;

  -- the files used are exactly the analysed, non-removed files of the match
  SELECT COALESCE(array_agg(DISTINCT value::uuid), ARRAY[]::uuid[]) INTO v_files
  FROM jsonb_array_elements_text(COALESCE(v_official->'files', '[]'::jsonb));
  SELECT COALESCE(array_agg(id), ARRAY[]::uuid[]) INTO v_expected_files
  FROM public.match_replays WHERE match_id = p_match_id AND status <> 'REMOVED';
  IF cardinality(v_files) = 0 OR cardinality(v_files) <> cardinality(v_expected_files)
     OR EXISTS (SELECT unnest(v_files) EXCEPT SELECT unnest(v_expected_files)) THEN
    RAISE EXCEPTION 'As gravações da partida mudaram; gere a súmula novamente' USING ERRCODE = '55000';
  END IF;
  IF EXISTS (SELECT 1 FROM public.match_replays WHERE match_id = p_match_id AND status IN ('PENDING', 'FAILED')) THEN
    RAISE EXCEPTION 'Há gravações sem análise concluída' USING ERRCODE = '23514';
  END IF;

  v_duration := (v_official->>'durationSeconds')::integer;
  IF v_duration IS NULL OR v_duration <= 0 THEN
    RAISE EXCEPTION 'A duração da partida extraída das gravações é inválida' USING ERRCODE = '23514';
  END IF;

  -- re-validate every goal against the database
  FOR v_goal IN SELECT value FROM jsonb_array_elements(COALESCE(v_official->'goals', '[]'::jsonb))
  LOOP
    v_team := (v_goal->>'team_id')::uuid;
    v_side := v_goal->>'side';
    v_player := NULLIF(v_goal->>'player_id', '')::uuid;
    v_assist := NULLIF(v_goal->>'assist_player_id', '')::uuid;
    v_minute := (v_goal->>'minute_seconds')::integer;
    IF v_team IS DISTINCT FROM v_match.home_team_id AND v_team IS DISTINCT FROM v_match.away_team_id THEN
      RAISE EXCEPTION 'Um gol da súmula não pertence às equipes da partida' USING ERRCODE = '23514';
    END IF;
    IF v_side NOT IN ('home', 'away')
       OR (v_side = 'home') IS DISTINCT FROM ((v_team = v_match.home_team_id) <> COALESCE((v_goal->>'is_own_goal')::boolean, false)) THEN
      RAISE EXCEPTION 'Um gol da súmula tem equipe inconsistente' USING ERRCODE = '23514';
    END IF;
    IF v_minute IS NULL OR v_minute < 0 OR v_minute > v_duration THEN
      RAISE EXCEPTION 'Um gol da súmula está fora da duração da partida' USING ERRCODE = '23514';
    END IF;
    IF v_player IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.rosters WHERE season_team_id = v_team AND player_id = v_player) THEN
      RAISE EXCEPTION 'Um autor de gol não pertence ao elenco da equipe' USING ERRCODE = '23514';
    END IF;
    IF v_assist IS NOT NULL AND (
      v_player IS NULL OR v_assist = v_player OR COALESCE((v_goal->>'is_own_goal')::boolean, false)
      OR NOT EXISTS (SELECT 1 FROM public.rosters WHERE season_team_id = v_team AND player_id = v_assist)
    ) THEN
      RAISE EXCEPTION 'Uma assistência da súmula é inválida' USING ERRCODE = '23514';
    END IF;
    IF v_side = 'home' THEN v_home := v_home + 1; ELSE v_away := v_away + 1; END IF;
  END LOOP;
  IF v_home IS DISTINCT FROM (v_official->'score'->>'home')::integer OR v_away IS DISTINCT FROM (v_official->'score'->>'away')::integer THEN
    RAISE EXCEPTION 'Os gols da súmula não batem com o placar consolidado' USING ERRCODE = '23514';
  END IF;
  FOR v_keeper IN SELECT value FROM jsonb_array_elements(COALESCE(v_official->'goalkeepers', '[]'::jsonb))
  LOOP
    v_team := CASE v_keeper->>'side' WHEN 'home' THEN v_match.home_team_id WHEN 'away' THEN v_match.away_team_id END;
    v_player := (v_keeper->>'player_id')::uuid;
    IF v_team IS NULL OR NOT EXISTS (
      SELECT 1 FROM public.rosters ro JOIN public.players pl ON pl.id = ro.player_id
      WHERE ro.season_team_id = v_team AND ro.player_id = v_player AND pl.position = 'Goleiro'
    ) OR COALESCE((v_keeper->>'started_at_seconds')::integer, 0) NOT BETWEEN 0 AND v_duration THEN
      RAISE EXCEPTION 'Goleiro da súmula inválido' USING ERRCODE = '23514';
    END IF;
  END LOOP;

  -- official registration (same path as a result recorded after the match)
  PERFORM set_config('fbf.retroactive_match', p_match_id::text, true);
  IF v_replacing THEN
    -- finished match corrected from recordings: the previous goals, assists and
    -- goalkeepers are replaced; the previous state is kept in match_edit_history
    v_before := public._match_sheet_snapshot(p_match_id);
    DELETE FROM public.match_events WHERE match_id = p_match_id AND event_type = 'ASSIST';
    DELETE FROM public.match_events WHERE match_id = p_match_id AND event_type IN ('GOAL', 'GOALKEEPER_IN', 'GOALKEEPER_OUT');
    UPDATE public.matches
    SET duration_seconds = v_duration, duration_is_presumed = false, recorded_retroactively = true
    WHERE id = p_match_id;
    PERFORM set_config('fbf.match_edit', p_match_id::text, true);
    DELETE FROM public.match_replay_reports WHERE match_id = p_match_id;
  ELSE
    IF v_match.status = 'POSTPONED' THEN
      UPDATE public.matches SET status = 'SCHEDULED' WHERE id = p_match_id;
    END IF;
    UPDATE public.matches
    SET duration_seconds = v_duration, duration_is_presumed = false, recorded_retroactively = true
    WHERE id = p_match_id;
    UPDATE public.matches SET status = 'LIVE' WHERE id = p_match_id;
  END IF;

  FOR v_keeper IN SELECT value FROM jsonb_array_elements(COALESCE(v_official->'goalkeepers', '[]'::jsonb))
  LOOP
    INSERT INTO public.match_events (match_id, event_type, minute_seconds, period, team_id, player_id, metadata)
    VALUES (
      p_match_id, 'GOALKEEPER_IN', COALESCE((v_keeper->>'started_at_seconds')::integer, 0), 'REGULATION',
      CASE v_keeper->>'side' WHEN 'home' THEN v_match.home_team_id ELSE v_match.away_team_id END,
      (v_keeper->>'player_id')::uuid,
      jsonb_build_object('source', 'REPLAY', 'review_id', v_review.id)
    );
    v_keepers := v_keepers + 1;
  END LOOP;

  FOR v_goal IN SELECT value FROM jsonb_array_elements(COALESCE(v_official->'goals', '[]'::jsonb))
  LOOP
    v_metadata := jsonb_build_object('source', 'REPLAY', 'review_id', v_review.id);
    IF v_goal->>'source' = 'not_recorded' THEN
      v_metadata := v_metadata || jsonb_build_object('not_recorded', true);
    END IF;
    INSERT INTO public.match_events (match_id, event_type, minute_seconds, period, team_id, player_id, is_own_goal, metadata)
    VALUES (
      p_match_id, 'GOAL', (v_goal->>'minute_seconds')::integer, 'REGULATION', (v_goal->>'team_id')::uuid,
      NULLIF(v_goal->>'player_id', '')::uuid, COALESCE((v_goal->>'is_own_goal')::boolean, false), v_metadata
    ) RETURNING id INTO v_goal_event_id;
    IF NULLIF(v_goal->>'assist_player_id', '') IS NOT NULL THEN
      INSERT INTO public.match_events (match_id, event_type, minute_seconds, period, team_id, player_id, goal_event_id, metadata)
      VALUES (
        p_match_id, 'ASSIST', (v_goal->>'minute_seconds')::integer, 'REGULATION', (v_goal->>'team_id')::uuid,
        (v_goal->>'assist_player_id')::uuid, v_goal_event_id, v_metadata
      );
    END IF;
    v_goals := v_goals + 1;
  END LOOP;

  IF v_replacing THEN
    SELECT home_score, away_score INTO v_home_score, v_away_score FROM public.matches WHERE id = p_match_id;
    PERFORM public._close_open_goalkeeper_periods(p_match_id);
  ELSE
    UPDATE public.matches SET status = 'FINISHED' WHERE id = p_match_id
    RETURNING home_score, away_score INTO v_home_score, v_away_score;
  END IF;
  IF v_home_score IS DISTINCT FROM v_home OR v_away_score IS DISTINCT FROM v_away THEN
    RAISE EXCEPTION 'Os gols registrados resultam em % × %, mas a súmula indica % × %; nada foi registrado',
      v_home_score, v_away_score, v_home, v_away USING ERRCODE = '23514';
  END IF;
  PERFORM set_config('fbf.retroactive_match', '', true);

  FOR v_alias IN SELECT value FROM jsonb_array_elements(COALESCE(v_official->'aliases', '[]'::jsonb))
  LOOP
    IF EXISTS (
      SELECT 1 FROM public.rosters
      WHERE player_id = (v_alias->>'player_id')::uuid AND season_team_id IN (v_match.home_team_id, v_match.away_team_id)
    ) THEN
      INSERT INTO public.player_aliases (player_id, alias, alias_normalized, source_match_id)
      VALUES ((v_alias->>'player_id')::uuid, left(v_alias->>'alias', 100), public.normalize_player_alias(left(v_alias->>'alias', 100)), p_match_id)
      ON CONFLICT (player_id, alias_normalized) DO NOTHING;
    END IF;
  END LOOP;

  INSERT INTO public.match_replay_reports (match_id, review_id, report, files_count, analyzer_version)
  VALUES (p_match_id, v_review.id, COALESCE(v_review.report, '{}'::jsonb), cardinality(v_files), COALESCE(v_review.sheet->>'analyzer', 'fbf-replay'));
  UPDATE public.match_replay_reviews
  SET status = 'CONFIRMED', confirmed_by = auth.uid(), confirmed_at = now(), updated_at = now()
  WHERE id = v_review.id;
  INSERT INTO public.match_replay_audit (match_id, review_id, action, details)
  VALUES (p_match_id, v_review.id, 'CONFIRM', jsonb_build_object('sheet_hash', p_sheet_hash, 'official', v_official, 'decisions', v_review.decisions, 'replaced_existing', v_replacing));
  IF v_replacing THEN
    INSERT INTO public.match_edit_history (match_id, source, reason, before, after, changes)
    VALUES (p_match_id, 'REPLAY', 'Súmula refeita a partir das gravações da partida', v_before, public._match_sheet_snapshot(p_match_id),
      jsonb_build_object('score_before', jsonb_build_array(v_before->'match'->'home_score', v_before->'match'->'away_score'), 'score_after', jsonb_build_array(v_home_score, v_away_score), 'review_id', v_review.id))
    RETURNING id INTO v_history_id;
  END IF;

  RETURN jsonb_build_object('home_score', v_home_score, 'away_score', v_away_score, 'goals', v_goals,
    'goalkeepers', v_keepers, 'duration_seconds', v_duration, 'files', cardinality(v_files), 'replaced_existing', v_replacing, 'history_id', v_history_id);
END;
$$;
-- The two-argument confirmation keeps its behaviour (scheduled or postponed matches only).
CREATE OR REPLACE FUNCTION public.confirm_match_replay_review(p_match_id uuid, p_sheet_hash text)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT public.confirm_match_replay_review(p_match_id, p_sheet_hash, false);
$$;
REVOKE EXECUTE ON FUNCTION public.confirm_match_replay_review(uuid, text, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.confirm_match_replay_review(uuid, text, boolean) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.confirm_match_replay_review(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.confirm_match_replay_review(uuid, text) TO authenticated;

-- 4. Own goals in the statistics (new column at the end of the views) ---------
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
  )::integer AS assists,
  count(*) FILTER (
    WHERE e.event_type = 'GOAL'
      AND e.is_own_goal
      AND e.period <> 'PENALTY_SHOOTOUT'
  )::integer AS own_goals
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

CREATE OR REPLACE VIEW public.player_career_statistics
WITH (security_invoker = true) AS
SELECT
  player_id,
  sum(goals)::integer AS goals,
  sum(assists)::integer AS assists,
  sum(own_goals)::integer AS own_goals
FROM public.player_competition_statistics
GROUP BY player_id;

-- 5. Theme preference ------------------------------------------------------------
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS theme_preference text;
ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_theme_preference_valid;
ALTER TABLE public.profiles ADD CONSTRAINT profiles_theme_preference_valid
  CHECK (theme_preference IS NULL OR theme_preference IN ('light', 'dark'));

CREATE OR REPLACE FUNCTION public.set_my_theme_preference(p_theme text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Entre na sua conta' USING ERRCODE = '42501'; END IF;
  IF p_theme IS NOT NULL AND p_theme NOT IN ('light', 'dark') THEN
    RAISE EXCEPTION 'Tema inválido' USING ERRCODE = '22023';
  END IF;
  UPDATE public.profiles SET theme_preference = p_theme WHERE id = auth.uid();
END;
$$;
REVOKE EXECUTE ON FUNCTION public.set_my_theme_preference(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_my_theme_preference(text) TO authenticated;
