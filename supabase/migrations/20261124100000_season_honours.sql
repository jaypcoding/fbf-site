/*
# Hall da Fama: official honours of each season

What is stored here is only what the FBF decides and the data cannot say by
itself with certainty: the champion, runner-up and third place confirmed by an
admin (the panel suggests them from the official final or standings), and the
individual awards (best player, best goalkeeper, ...). Top scorers are NOT
stored: they come from the official statistics (player_season_summary).

Rules:
  - only admins write, always through the functions below, with a reason;
    every change goes to season_honour_changes;
  - an honour starts as a DRAFT; visitors see it only when PUBLISHED, and it
    can only be published when the competition is FINISHED;
  - team honours point to a team approved in that season; individual awards
    point to a player (optionally with his team in the season);
  - one champion, one runner-up and one third place per season; an award may
    be shared (several players with the same award name);
  - nothing is deleted once published: unpublish first (history kept).
*/

CREATE TABLE IF NOT EXISTS public.season_honours (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  season_id uuid NOT NULL REFERENCES public.seasons(id) ON DELETE RESTRICT,
  kind text NOT NULL CHECK (kind IN ('CHAMPION', 'RUNNER_UP', 'THIRD_PLACE', 'AWARD')),
  award_name text,
  season_team_id uuid REFERENCES public.season_teams(id) ON DELETE RESTRICT,
  player_id uuid REFERENCES public.players(id) ON DELETE RESTRICT,
  basis text NOT NULL DEFAULT 'MANUAL' CHECK (basis IN ('FINAL', 'STANDINGS', 'MANUAL')),
  notes text,
  status text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'PUBLISHED')),
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  published_by uuid,
  published_at timestamptz,
  CONSTRAINT season_honours_shape CHECK (
    (kind = 'AWARD' AND award_name IS NOT NULL AND length(btrim(award_name)) BETWEEN 3 AND 60 AND player_id IS NOT NULL)
    OR (kind <> 'AWARD' AND award_name IS NULL AND season_team_id IS NOT NULL AND player_id IS NULL)
  ),
  CONSTRAINT season_honours_notes_length CHECK (notes IS NULL OR length(notes) <= 300)
);
CREATE UNIQUE INDEX IF NOT EXISTS season_honours_one_team_place ON public.season_honours(season_id, kind) WHERE kind <> 'AWARD';
CREATE UNIQUE INDEX IF NOT EXISTS season_honours_one_award_per_player ON public.season_honours(season_id, lower(btrim(award_name)), player_id) WHERE kind = 'AWARD';
CREATE INDEX IF NOT EXISTS season_honours_team_idx ON public.season_honours(season_team_id);
CREATE INDEX IF NOT EXISTS season_honours_player_idx ON public.season_honours(player_id);

ALTER TABLE public.season_honours ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS season_honours_public_select ON public.season_honours;
CREATE POLICY season_honours_public_select ON public.season_honours FOR SELECT TO anon, authenticated USING (
  status = 'PUBLISHED' AND EXISTS (
    SELECT 1 FROM public.seasons s JOIN public.competitions c ON c.id = s.competition_id
    WHERE s.id = season_honours.season_id AND c.status = 'FINISHED'
  )
);
DROP POLICY IF EXISTS season_honours_admin_select ON public.season_honours;
CREATE POLICY season_honours_admin_select ON public.season_honours FOR SELECT TO authenticated USING (public.is_fbf_admin());
REVOKE ALL ON public.season_honours FROM anon, authenticated;
GRANT SELECT ON public.season_honours TO anon, authenticated;

CREATE TABLE IF NOT EXISTS public.season_honour_changes (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  honour_id uuid NOT NULL,
  season_id uuid NOT NULL REFERENCES public.seasons(id) ON DELETE RESTRICT,
  action text NOT NULL CHECK (action IN ('CREATE', 'UPDATE', 'PUBLISH', 'UNPUBLISH', 'DELETE')),
  reason text NOT NULL,
  before jsonb,
  after jsonb,
  actor uuid,
  changed_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS season_honour_changes_season_idx ON public.season_honour_changes(season_id, changed_at);
ALTER TABLE public.season_honour_changes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS season_honour_changes_admin_select ON public.season_honour_changes;
CREATE POLICY season_honour_changes_admin_select ON public.season_honour_changes FOR SELECT TO authenticated USING (public.is_fbf_admin());
REVOKE ALL ON public.season_honour_changes FROM anon, authenticated;
GRANT SELECT ON public.season_honour_changes TO authenticated;

-- shared checks of the writing functions
CREATE OR REPLACE FUNCTION public._honour_guard(p_reason text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT public.is_fbf_admin() THEN
    RAISE EXCEPTION 'Somente administradores registram títulos e premiações' USING ERRCODE = '42501';
  END IF;
  IF length(btrim(COALESCE(p_reason, ''))) < 3 THEN
    RAISE EXCEPTION 'Informe o motivo da alteração' USING ERRCODE = '22023';
  END IF;
END;
$$;
REVOKE EXECUTE ON FUNCTION public._honour_guard(text) FROM PUBLIC, anon, authenticated;

/* Create or change a DRAFT honour.
   p_honour: {"season_id", "kind", "award_name"?, "season_team_id"?, "player_id"?, "basis"?, "notes"?}
   p_id NULL creates; otherwise updates that draft (a published honour must be unpublished first). */
CREATE OR REPLACE FUNCTION public.save_season_honour(p_id uuid, p_honour jsonb, p_reason text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_row public.season_honours%ROWTYPE;
  v_before jsonb;
  v_season uuid;
  v_kind text;
  v_team uuid;
  v_player uuid;
  v_award text;
  v_id uuid;
BEGIN
  PERFORM public._honour_guard(p_reason);
  IF p_honour IS NULL OR jsonb_typeof(p_honour) <> 'object' THEN
    RAISE EXCEPTION 'Dados inválidos' USING ERRCODE = '22023';
  END IF;
  BEGIN
    v_season := (p_honour->>'season_id')::uuid;
    v_team := NULLIF(p_honour->>'season_team_id', '')::uuid;
    v_player := NULLIF(p_honour->>'player_id', '')::uuid;
  EXCEPTION WHEN others THEN
    RAISE EXCEPTION 'Identificador inválido' USING ERRCODE = '22023';
  END;
  v_kind := p_honour->>'kind';
  v_award := NULLIF(btrim(COALESCE(p_honour->>'award_name', '')), '');
  IF NOT EXISTS (SELECT 1 FROM public.seasons WHERE id = v_season) THEN
    RAISE EXCEPTION 'Temporada não encontrada' USING ERRCODE = 'P0002';
  END IF;
  IF v_team IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.season_teams WHERE id = v_team AND season_id = v_season) THEN
    RAISE EXCEPTION 'A equipe não participa desta temporada' USING ERRCODE = '23514';
  END IF;
  IF v_player IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.players WHERE id = v_player) THEN
    RAISE EXCEPTION 'Jogador não encontrado' USING ERRCODE = 'P0002';
  END IF;
  -- an individual award goes to someone who took part in that season (roster or proven participation)
  IF v_player IS NOT NULL AND NOT (
    EXISTS (SELECT 1 FROM public.rosters r JOIN public.season_teams st ON st.id = r.season_team_id
            WHERE st.season_id = v_season AND r.player_id = v_player AND (v_team IS NULL OR st.id = v_team))
    OR EXISTS (SELECT 1 FROM public.player_match_participation pmp
               WHERE pmp.season_id = v_season AND pmp.player_id = v_player AND (v_team IS NULL OR pmp.season_team_id = v_team))
  ) THEN
    RAISE EXCEPTION 'O jogador não participou desta temporada por essa equipe' USING ERRCODE = '23514';
  END IF;

  IF p_id IS NOT NULL THEN
    SELECT * INTO v_row FROM public.season_honours WHERE id = p_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Registro não encontrado' USING ERRCODE = 'P0002'; END IF;
    IF v_row.status = 'PUBLISHED' THEN
      RAISE EXCEPTION 'Despublique o registro antes de alterá-lo' USING ERRCODE = '55000';
    END IF;
    IF v_row.season_id <> v_season THEN
      RAISE EXCEPTION 'Não é possível mudar a temporada de um registro' USING ERRCODE = '23514';
    END IF;
    v_before := to_jsonb(v_row);
    UPDATE public.season_honours SET kind = v_kind, award_name = v_award, season_team_id = v_team, player_id = v_player,
      basis = COALESCE(p_honour->>'basis', 'MANUAL'), notes = NULLIF(btrim(COALESCE(p_honour->>'notes', '')), '')
    WHERE id = p_id RETURNING * INTO v_row;
    v_id := p_id;
    INSERT INTO public.season_honour_changes (honour_id, season_id, action, reason, before, after, actor)
    VALUES (v_id, v_season, 'UPDATE', btrim(p_reason), v_before, to_jsonb(v_row), auth.uid());
  ELSE
    INSERT INTO public.season_honours (season_id, kind, award_name, season_team_id, player_id, basis, notes, created_by)
    VALUES (v_season, v_kind, v_award, v_team, v_player, COALESCE(p_honour->>'basis', 'MANUAL'),
      NULLIF(btrim(COALESCE(p_honour->>'notes', '')), ''), auth.uid())
    RETURNING * INTO v_row;
    v_id := v_row.id;
    INSERT INTO public.season_honour_changes (honour_id, season_id, action, reason, before, after, actor)
    VALUES (v_id, v_season, 'CREATE', btrim(p_reason), NULL, to_jsonb(v_row), auth.uid());
  END IF;
  RETURN v_id;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.save_season_honour(uuid, jsonb, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_season_honour(uuid, jsonb, text) TO authenticated;

-- Publish (only when the competition is FINISHED) or unpublish.
CREATE OR REPLACE FUNCTION public.publish_season_honour(p_id uuid, p_publish boolean, p_reason text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_row public.season_honours%ROWTYPE;
  v_before jsonb;
  v_status text;
BEGIN
  PERFORM public._honour_guard(p_reason);
  SELECT * INTO v_row FROM public.season_honours WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Registro não encontrado' USING ERRCODE = 'P0002'; END IF;
  IF p_publish IS NULL THEN RAISE EXCEPTION 'Informe se publica ou despublica' USING ERRCODE = '22023'; END IF;
  IF p_publish THEN
    SELECT c.status INTO v_status FROM public.seasons s JOIN public.competitions c ON c.id = s.competition_id WHERE s.id = v_row.season_id;
    IF v_status <> 'FINISHED' THEN
      RAISE EXCEPTION 'Títulos e premiações só são publicados depois que a competição é encerrada' USING ERRCODE = '23514';
    END IF;
  END IF;
  IF (v_row.status = 'PUBLISHED') = p_publish THEN RETURN v_row.status; END IF;
  v_before := to_jsonb(v_row);
  UPDATE public.season_honours
  SET status = CASE WHEN p_publish THEN 'PUBLISHED' ELSE 'DRAFT' END,
      published_by = CASE WHEN p_publish THEN auth.uid() END,
      published_at = CASE WHEN p_publish THEN now() END
  WHERE id = p_id RETURNING * INTO v_row;
  INSERT INTO public.season_honour_changes (honour_id, season_id, action, reason, before, after, actor)
  VALUES (p_id, v_row.season_id, CASE WHEN p_publish THEN 'PUBLISH' ELSE 'UNPUBLISH' END, btrim(p_reason), v_before, to_jsonb(v_row), auth.uid());
  RETURN v_row.status;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.publish_season_honour(uuid, boolean, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.publish_season_honour(uuid, boolean, text) TO authenticated;

-- Delete a DRAFT (a published honour is unpublished first; the history stays).
CREATE OR REPLACE FUNCTION public.delete_season_honour(p_id uuid, p_reason text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_row public.season_honours%ROWTYPE;
BEGIN
  PERFORM public._honour_guard(p_reason);
  SELECT * INTO v_row FROM public.season_honours WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Registro não encontrado' USING ERRCODE = 'P0002'; END IF;
  IF v_row.status = 'PUBLISHED' THEN
    RAISE EXCEPTION 'Despublique o registro antes de excluí-lo' USING ERRCODE = '55000';
  END IF;
  DELETE FROM public.season_honours WHERE id = p_id;
  INSERT INTO public.season_honour_changes (honour_id, season_id, action, reason, before, after, actor)
  VALUES (p_id, v_row.season_id, 'DELETE', btrim(p_reason), to_jsonb(v_row), NULL, auth.uid());
  RETURN true;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.delete_season_honour(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delete_season_honour(uuid, text) TO authenticated;

-- A team or a player with a registered honour keeps his history (same rule as
-- rosters and matches): the RESTRICT foreign keys above already refuse it.
