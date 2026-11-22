-- Match sheets ("súmulas") produced from HaxBall recordings (.hbr2).
--
-- Additive only: new tables, a private Storage bucket, policies and functions.
-- No existing table, row, function or policy is changed.
--
-- Flow (the unit of validation is the MATCH; files are evidence):
--   1. a manager uploads one or more .hbr2 files of a match to the private
--      bucket "match-replays" (path <match_id>/<sha256>.hbr2) and registers
--      each one with register_match_replay();
--   2. the Edge Function "replay-process" (service role) re-reads the stored
--      file, checks its SHA-256, analyses it and writes match_replays.analysis;
--      it then consolidates every file of the match into the draft review
--      (sheet, official payload, public report and their hash). Those columns
--      are written only by the service role, never by the browser;
--   3. the manager resolves pending items (decisions are saved with
--      save_match_replay_decisions and audited) and confirms with
--      confirm_match_replay_review(match, hash): the function re-validates
--      everything against the database and writes the official result in one
--      transaction (goals, assists, goalkeepers, duration, report).
--
-- Rollback: the objects created here can be dropped in reverse order
-- (functions, policies, tables, bucket) as long as no match was confirmed
-- from a recording; confirmed results live in match_events like any other.

-- 1. Tables ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.match_replays (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  match_id uuid NOT NULL REFERENCES public.matches(id) ON DELETE RESTRICT,
  storage_path text NOT NULL,
  original_name text NOT NULL CHECK (char_length(original_name) BETWEEN 1 AND 255),
  size_bytes bigint NOT NULL CHECK (size_bytes > 0 AND size_bytes <= 20971520),
  sha256 text NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  file_last_modified timestamptz,
  status text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'ANALYZED', 'FAILED', 'REMOVED')),
  replay_version integer,
  total_frames integer,
  duration_seconds numeric,
  analyzer_version text,
  analysis jsonb,
  error text,
  uploaded_by uuid REFERENCES auth.users(id) ON DELETE SET NULL DEFAULT auth.uid(),
  uploaded_at timestamptz NOT NULL DEFAULT now(),
  analyzed_at timestamptz,
  removed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  removed_at timestamptz,
  removal_reason text
);
CREATE UNIQUE INDEX IF NOT EXISTS match_replays_match_sha_idx
  ON public.match_replays(match_id, sha256) WHERE status <> 'REMOVED';
CREATE INDEX IF NOT EXISTS match_replays_sha_idx ON public.match_replays(sha256);

CREATE TABLE IF NOT EXISTS public.match_replay_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  match_id uuid NOT NULL REFERENCES public.matches(id) ON DELETE RESTRICT,
  status text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'CONFIRMED', 'CANCELLED')),
  decisions jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(decisions) = 'object'),
  sheet jsonb,
  official jsonb,
  report jsonb,
  sheet_hash text,
  sheet_built_at timestamptz,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  confirmed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  confirmed_at timestamptz,
  cancelled_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  cancelled_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS match_replay_reviews_draft_idx
  ON public.match_replay_reviews(match_id) WHERE status = 'DRAFT';
CREATE UNIQUE INDEX IF NOT EXISTS match_replay_reviews_confirmed_idx
  ON public.match_replay_reviews(match_id) WHERE status = 'CONFIRMED';

-- Public statistics of a match validated from recordings.
CREATE TABLE IF NOT EXISTS public.match_replay_reports (
  match_id uuid PRIMARY KEY REFERENCES public.matches(id) ON DELETE RESTRICT,
  review_id uuid NOT NULL UNIQUE REFERENCES public.match_replay_reviews(id) ON DELETE RESTRICT,
  report jsonb NOT NULL,
  files_count integer NOT NULL CHECK (files_count > 0),
  analyzer_version text NOT NULL,
  confirmed_at timestamptz NOT NULL DEFAULT now()
);

-- Alternative nicknames of registered players (learned when an administrator
-- associates a recording nickname to a player).
CREATE TABLE IF NOT EXISTS public.player_aliases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id uuid NOT NULL REFERENCES public.players(id) ON DELETE CASCADE,
  alias text NOT NULL CHECK (char_length(alias) BETWEEN 1 AND 100),
  alias_normalized text NOT NULL,
  source_match_id uuid REFERENCES public.matches(id) ON DELETE SET NULL,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (player_id, alias_normalized)
);
CREATE INDEX IF NOT EXISTS player_aliases_normalized_idx ON public.player_aliases(alias_normalized);

CREATE TABLE IF NOT EXISTS public.match_replay_audit (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  match_id uuid NOT NULL REFERENCES public.matches(id) ON DELETE RESTRICT,
  review_id uuid REFERENCES public.match_replay_reviews(id) ON DELETE RESTRICT,
  replay_id uuid REFERENCES public.match_replays(id) ON DELETE RESTRICT,
  actor uuid DEFAULT auth.uid(),
  action text NOT NULL,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS match_replay_audit_match_idx ON public.match_replay_audit(match_id, created_at);

CREATE OR REPLACE FUNCTION public.normalize_player_alias(p_alias text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT lower(regexp_replace(btrim(normalize(p_alias, NFKC)), '\s+', ' ', 'g'));
$$;

CREATE OR REPLACE FUNCTION public.set_player_alias_normalized()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.alias_normalized := public.normalize_player_alias(NEW.alias);
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS player_aliases_normalize ON public.player_aliases;
CREATE TRIGGER player_aliases_normalize
BEFORE INSERT OR UPDATE ON public.player_aliases
FOR EACH ROW EXECUTE FUNCTION public.set_player_alias_normalized();

-- The audit trail cannot be changed or removed.
CREATE OR REPLACE FUNCTION public.prevent_match_replay_audit_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'O histórico da súmula por gravação não pode ser alterado' USING ERRCODE = '42501';
END;
$$;
DROP TRIGGER IF EXISTS match_replay_audit_immutable ON public.match_replay_audit;
CREATE TRIGGER match_replay_audit_immutable
BEFORE UPDATE OR DELETE ON public.match_replay_audit
FOR EACH ROW EXECUTE FUNCTION public.prevent_match_replay_audit_mutation();

-- A confirmed review and its report are final.
CREATE OR REPLACE FUNCTION public.guard_confirmed_match_replay_review()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Revisões de súmula não podem ser excluídas' USING ERRCODE = '42501';
  END IF;
  IF OLD.status IN ('CONFIRMED', 'CANCELLED') THEN
    RAISE EXCEPTION 'Esta revisão de súmula já foi encerrada e não pode ser alterada' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS match_replay_reviews_guard ON public.match_replay_reviews;
CREATE TRIGGER match_replay_reviews_guard
BEFORE UPDATE OR DELETE ON public.match_replay_reviews
FOR EACH ROW EXECUTE FUNCTION public.guard_confirmed_match_replay_review();

CREATE OR REPLACE FUNCTION public.prevent_match_replay_report_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'O relatório de uma súmula validada não pode ser alterado' USING ERRCODE = '42501';
END;
$$;
DROP TRIGGER IF EXISTS match_replay_reports_immutable ON public.match_replay_reports;
CREATE TRIGGER match_replay_reports_immutable
BEFORE UPDATE OR DELETE ON public.match_replay_reports
FOR EACH ROW EXECUTE FUNCTION public.prevent_match_replay_report_mutation();

-- Recording files are never deleted (removal is a status, kept for audit).
CREATE OR REPLACE FUNCTION public.guard_match_replay_changes()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Gravações de partidas não podem ser excluídas; use a remoção da análise' USING ERRCODE = '42501';
  END IF;
  IF NEW.match_id IS DISTINCT FROM OLD.match_id OR NEW.sha256 IS DISTINCT FROM OLD.sha256
     OR NEW.storage_path IS DISTINCT FROM OLD.storage_path OR NEW.size_bytes IS DISTINCT FROM OLD.size_bytes THEN
    RAISE EXCEPTION 'A identificação de uma gravação não pode ser alterada' USING ERRCODE = '42501';
  END IF;
  IF OLD.status = 'REMOVED' AND NEW.status IS DISTINCT FROM 'REMOVED' THEN
    RAISE EXCEPTION 'Uma gravação removida não volta para a análise; envie o arquivo novamente' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS match_replays_guard ON public.match_replays;
CREATE TRIGGER match_replays_guard
BEFORE UPDATE OR DELETE ON public.match_replays
FOR EACH ROW EXECUTE FUNCTION public.guard_match_replay_changes();

-- 2. Row level security ---------------------------------------------------
ALTER TABLE public.match_replays ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.match_replay_reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.match_replay_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.player_aliases ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.match_replay_audit ENABLE ROW LEVEL SECURITY;

-- Managers of the match read files, reviews and audit; every change goes
-- through the SECURITY DEFINER functions below or the service role.
DROP POLICY IF EXISTS match_replays_manager_select ON public.match_replays;
CREATE POLICY match_replays_manager_select ON public.match_replays
  FOR SELECT TO authenticated USING (public.can_manage_match(match_id));
DROP POLICY IF EXISTS match_replay_reviews_manager_select ON public.match_replay_reviews;
CREATE POLICY match_replay_reviews_manager_select ON public.match_replay_reviews
  FOR SELECT TO authenticated USING (public.can_manage_match(match_id));
DROP POLICY IF EXISTS match_replay_audit_manager_select ON public.match_replay_audit;
CREATE POLICY match_replay_audit_manager_select ON public.match_replay_audit
  FOR SELECT TO authenticated USING (public.can_manage_match(match_id));
DROP POLICY IF EXISTS player_aliases_manager_select ON public.player_aliases;
CREATE POLICY player_aliases_manager_select ON public.player_aliases
  FOR SELECT TO authenticated USING (public.is_fbf_manager());
DROP POLICY IF EXISTS player_aliases_admin_delete ON public.player_aliases;
CREATE POLICY player_aliases_admin_delete ON public.player_aliases
  FOR DELETE TO authenticated USING (public.is_fbf_admin());

-- Reports are public once the match is finished.
DROP POLICY IF EXISTS match_replay_reports_public_select ON public.match_replay_reports;
CREATE POLICY match_replay_reports_public_select ON public.match_replay_reports
  FOR SELECT TO anon, authenticated
  USING (EXISTS (SELECT 1 FROM public.matches m WHERE m.id = match_id AND m.status = 'FINISHED'));

REVOKE ALL ON public.match_replays, public.match_replay_reviews, public.match_replay_audit FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public.match_replays, public.match_replay_reviews, public.match_replay_audit, public.match_replay_reports FROM authenticated;
REVOKE INSERT, UPDATE ON public.player_aliases FROM authenticated;
REVOKE ALL ON public.player_aliases FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public.match_replay_reports FROM anon;
GRANT SELECT ON public.match_replays, public.match_replay_reviews, public.match_replay_audit, public.player_aliases TO authenticated;
GRANT DELETE ON public.player_aliases TO authenticated;
GRANT SELECT ON public.match_replay_reports TO anon, authenticated;

-- 3. Private Storage bucket -----------------------------------------------
-- Object path: <match_id>/<sha256>.hbr2. Upload and (signed) download only
-- for managers of that match; nothing can be replaced or deleted by users.
CREATE OR REPLACE FUNCTION public.match_replay_object_match(p_name text)
RETURNS uuid
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN p_name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{64}\.hbr2$'
    THEN split_part(p_name, '/', 1)::uuid
  END;
$$;

DO $migration$
BEGIN
  IF to_regclass('storage.buckets') IS NULL OR to_regclass('storage.objects') IS NULL THEN
    RAISE NOTICE 'storage schema not available yet: match-replays bucket not created in this environment';
    RETURN;
  END IF;

  INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  VALUES ('match-replays', 'match-replays', false, 20971520, ARRAY['application/octet-stream'])
  ON CONFLICT (id) DO UPDATE
  SET public = false,
      file_size_limit = EXCLUDED.file_size_limit,
      allowed_mime_types = EXCLUDED.allowed_mime_types;

  DROP POLICY IF EXISTS match_replays_manager_insert ON storage.objects;
  DROP POLICY IF EXISTS match_replays_manager_read ON storage.objects;

  CREATE POLICY match_replays_manager_insert ON storage.objects
    FOR INSERT TO authenticated
    WITH CHECK (
      bucket_id = 'match-replays'
      AND public.match_replay_object_match(name) IS NOT NULL
      AND public.can_manage_match(public.match_replay_object_match(name))
    );
  CREATE POLICY match_replays_manager_read ON storage.objects
    FOR SELECT TO authenticated
    USING (
      bucket_id = 'match-replays'
      AND public.match_replay_object_match(name) IS NOT NULL
      AND public.can_manage_match(public.match_replay_object_match(name))
    );
END
$migration$;

-- 4. Functions ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._match_replay_draft(p_match_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_id uuid;
BEGIN
  SELECT id INTO v_id FROM public.match_replay_reviews WHERE match_id = p_match_id AND status = 'DRAFT';
  IF v_id IS NULL THEN
    INSERT INTO public.match_replay_reviews (match_id, created_by) VALUES (p_match_id, auth.uid())
    RETURNING id INTO v_id;
  END IF;
  RETURN v_id;
END;
$$;
REVOKE EXECUTE ON FUNCTION public._match_replay_draft(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.register_match_replay(
  p_match_id uuid,
  p_storage_path text,
  p_original_name text,
  p_size_bytes bigint,
  p_sha256 text,
  p_file_last_modified timestamptz
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_match public.matches%ROWTYPE;
  v_replay_id uuid;
  v_review_id uuid;
  v_other boolean;
BEGIN
  SELECT * INTO v_match FROM public.matches WHERE id = p_match_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Partida não encontrada' USING ERRCODE = 'P0002'; END IF;
  IF NOT public.can_manage_match(p_match_id) THEN
    RAISE EXCEPTION 'Sem permissão para gerenciar esta partida' USING ERRCODE = '42501';
  END IF;
  IF v_match.status = 'CANCELLED' THEN
    RAISE EXCEPTION 'A partida foi cancelada' USING ERRCODE = '23514';
  END IF;
  IF v_match.home_team_id IS NULL OR v_match.away_team_id IS NULL THEN
    RAISE EXCEPTION 'A partida precisa ter as duas equipes definidas' USING ERRCODE = '23514';
  END IF;
  IF EXISTS (SELECT 1 FROM public.match_replay_reviews WHERE match_id = p_match_id AND status = 'CONFIRMED') THEN
    RAISE EXCEPTION 'A súmula desta partida já foi validada a partir das gravações' USING ERRCODE = '23514';
  END IF;
  p_sha256 := lower(coalesce(p_sha256, ''));
  IF p_sha256 !~ '^[0-9a-f]{64}$' THEN RAISE EXCEPTION 'Hash do arquivo inválido' USING ERRCODE = '22023'; END IF;
  IF p_storage_path IS DISTINCT FROM p_match_id::text || '/' || p_sha256 || '.hbr2' THEN
    RAISE EXCEPTION 'Caminho de armazenamento inválido' USING ERRCODE = '22023';
  END IF;
  IF to_regclass('storage.objects') IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM storage.objects WHERE bucket_id = 'match-replays' AND name = p_storage_path
  ) THEN
    RAISE EXCEPTION 'O arquivo não foi encontrado no armazenamento; envie novamente' USING ERRCODE = 'P0002';
  END IF;
  IF EXISTS (SELECT 1 FROM public.match_replays WHERE match_id = p_match_id AND sha256 = p_sha256 AND status <> 'REMOVED') THEN
    RAISE EXCEPTION 'Este arquivo já foi enviado para esta partida' USING ERRCODE = '23505';
  END IF;
  SELECT EXISTS (SELECT 1 FROM public.match_replays WHERE sha256 = p_sha256 AND match_id <> p_match_id AND status <> 'REMOVED') INTO v_other;

  v_review_id := public._match_replay_draft(p_match_id);
  -- a file removed earlier from this match may be sent again (new row; the old one stays for audit)
  INSERT INTO public.match_replays (match_id, storage_path, original_name, size_bytes, sha256, file_last_modified, uploaded_by)
  VALUES (
    p_match_id, p_storage_path, left(btrim(p_original_name), 255), p_size_bytes, p_sha256, p_file_last_modified, auth.uid()
  )
  RETURNING id INTO v_replay_id;
  UPDATE public.match_replay_reviews SET sheet_hash = NULL, updated_at = now() WHERE id = v_review_id;
  INSERT INTO public.match_replay_audit (match_id, review_id, replay_id, action, details)
  VALUES (p_match_id, v_review_id, v_replay_id, 'UPLOAD', jsonb_build_object(
    'name', p_original_name, 'sha256', p_sha256, 'size_bytes', p_size_bytes, 'used_in_other_match', v_other));
  RETURN jsonb_build_object('replay_id', v_replay_id, 'review_id', v_review_id, 'used_in_other_match', v_other);
END;
$$;

CREATE OR REPLACE FUNCTION public.remove_match_replay(p_replay_id uuid, p_reason text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_replay public.match_replays%ROWTYPE;
  v_review_id uuid;
BEGIN
  SELECT * INTO v_replay FROM public.match_replays WHERE id = p_replay_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Gravação não encontrada' USING ERRCODE = 'P0002'; END IF;
  IF NOT public.can_manage_match(v_replay.match_id) THEN
    RAISE EXCEPTION 'Sem permissão para gerenciar esta partida' USING ERRCODE = '42501';
  END IF;
  IF EXISTS (SELECT 1 FROM public.match_replay_reviews WHERE match_id = v_replay.match_id AND status = 'CONFIRMED') THEN
    RAISE EXCEPTION 'A súmula já foi validada; as gravações ficam guardadas como comprovante' USING ERRCODE = '23514';
  END IF;
  IF v_replay.status = 'REMOVED' THEN RETURN; END IF;
  UPDATE public.match_replays
  SET status = 'REMOVED', removed_by = auth.uid(), removed_at = now(), removal_reason = NULLIF(left(btrim(coalesce(p_reason, '')), 500), '')
  WHERE id = p_replay_id;
  v_review_id := public._match_replay_draft(v_replay.match_id);
  UPDATE public.match_replay_reviews SET sheet_hash = NULL, updated_at = now() WHERE id = v_review_id;
  INSERT INTO public.match_replay_audit (match_id, review_id, replay_id, action, details)
  VALUES (v_replay.match_id, v_review_id, p_replay_id, 'REMOVE_FILE', jsonb_build_object('name', v_replay.original_name, 'reason', p_reason));
END;
$$;

CREATE OR REPLACE FUNCTION public.save_match_replay_decisions(p_match_id uuid, p_decisions jsonb)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_review_id uuid;
  v_old jsonb;
BEGIN
  IF NOT public.can_manage_match(p_match_id) THEN
    RAISE EXCEPTION 'Sem permissão para gerenciar esta partida' USING ERRCODE = '42501';
  END IF;
  IF jsonb_typeof(p_decisions) IS DISTINCT FROM 'object' OR octet_length(p_decisions::text) > 200000 THEN
    RAISE EXCEPTION 'Decisões da súmula inválidas' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (SELECT 1 FROM public.match_replay_reviews WHERE match_id = p_match_id AND status = 'CONFIRMED') THEN
    RAISE EXCEPTION 'A súmula desta partida já foi validada' USING ERRCODE = '23514';
  END IF;
  v_review_id := public._match_replay_draft(p_match_id);
  SELECT decisions INTO v_old FROM public.match_replay_reviews WHERE id = v_review_id FOR UPDATE;
  IF v_old = p_decisions THEN RETURN v_review_id; END IF;
  UPDATE public.match_replay_reviews
  SET decisions = p_decisions, sheet_hash = NULL, updated_at = now()
  WHERE id = v_review_id;
  INSERT INTO public.match_replay_audit (match_id, review_id, action, details)
  VALUES (p_match_id, v_review_id, 'DECISIONS', jsonb_build_object('before', v_old, 'after', p_decisions));
  RETURN v_review_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.cancel_match_replay_review(p_match_id uuid, p_reason text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_review public.match_replay_reviews%ROWTYPE;
BEGIN
  IF NOT public.can_manage_match(p_match_id) THEN
    RAISE EXCEPTION 'Sem permissão para gerenciar esta partida' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_review FROM public.match_replay_reviews WHERE match_id = p_match_id AND status = 'DRAFT' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Não há análise em andamento para esta partida' USING ERRCODE = 'P0002'; END IF;
  UPDATE public.match_replays
  SET status = 'REMOVED', removed_by = auth.uid(), removed_at = now(), removal_reason = 'Análise cancelada'
  WHERE match_id = p_match_id AND status <> 'REMOVED';
  UPDATE public.match_replay_reviews
  SET status = 'CANCELLED', cancelled_by = auth.uid(), cancelled_at = now(), updated_at = now()
  WHERE id = v_review.id;
  INSERT INTO public.match_replay_audit (match_id, review_id, action, details)
  VALUES (p_match_id, v_review.id, 'CANCEL', jsonb_build_object('reason', p_reason, 'decisions', v_review.decisions));
END;
$$;

-- Official registration of a match sheet built by the server.
CREATE OR REPLACE FUNCTION public.confirm_match_replay_review(p_match_id uuid, p_sheet_hash text)
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
    RAISE EXCEPTION 'A súmula mudou desde que foi exibida; confira a versão atual antes de confirmar' USING ERRCODE = '40001';
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
  IF v_match.status NOT IN ('SCHEDULED', 'POSTPONED') THEN
    RAISE EXCEPTION 'Esta partida já tem resultado registrado; a súmula por gravação vale para partidas agendadas ou adiadas' USING ERRCODE = '23514';
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
    RAISE EXCEPTION 'As gravações da partida mudaram; gere a súmula novamente' USING ERRCODE = '40001';
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
  IF v_match.status = 'POSTPONED' THEN
    UPDATE public.matches SET status = 'SCHEDULED' WHERE id = p_match_id;
  END IF;
  UPDATE public.matches
  SET duration_seconds = v_duration, duration_is_presumed = false, recorded_retroactively = true
  WHERE id = p_match_id;
  UPDATE public.matches SET status = 'LIVE' WHERE id = p_match_id;

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

  UPDATE public.matches SET status = 'FINISHED' WHERE id = p_match_id
  RETURNING home_score, away_score INTO v_home_score, v_away_score;
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
  VALUES (p_match_id, v_review.id, 'CONFIRM', jsonb_build_object('sheet_hash', p_sheet_hash, 'official', v_official, 'decisions', v_review.decisions));

  RETURN jsonb_build_object('home_score', v_home_score, 'away_score', v_away_score, 'goals', v_goals,
    'goalkeepers', v_keepers, 'duration_seconds', v_duration, 'files', cardinality(v_files));
END;
$$;

REVOKE EXECUTE ON FUNCTION public.register_match_replay(uuid, text, text, bigint, text, timestamptz) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.remove_match_replay(uuid, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.save_match_replay_decisions(uuid, jsonb) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.cancel_match_replay_review(uuid, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.confirm_match_replay_review(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.register_match_replay(uuid, text, text, bigint, text, timestamptz) TO authenticated;
GRANT EXECUTE ON FUNCTION public.remove_match_replay(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.save_match_replay_decisions(uuid, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_match_replay_review(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.confirm_match_replay_review(uuid, text) TO authenticated;
