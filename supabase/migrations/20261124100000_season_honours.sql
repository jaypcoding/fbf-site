/*
# Hall da Fama: official honours, award categories and editions before the system

What is stored here is only what the FBF decides and the data cannot say by
itself with certainty:
  - the champion, runner-up and third place of a season of the system,
    confirmed by an admin (the panel suggests them from the official final or
    standings);
  - the individual awards (best player, best goalkeeper, ...), from a list of
    categories the administration maintains (award_categories): a new category
    needs no code change and no migration, and no category is mandatory;
  - the honours of editions played BEFORE the system (historical_editions):
    there are no match sheets for them, so champion, runner-up, third place,
    awards and the top scorer are all records confirmed by the FBF, always
    shown as "registro anterior ao sistema".
Top scorers of seasons of the system are NOT stored: they come from the
official statistics (player_season_summary), and a TOP_SCORER record is refused
for them, so no parallel count can diverge from the match sheets.

Rules:
  - only admins write, always through the functions below, with a reason;
    every change goes to hall_of_fame_changes;
  - an honour starts as a DRAFT; visitors see it only when PUBLISHED. In the
    system, it can only be published when the competition is FINISHED; for an
    edition before the system, publishing is the admin's confirmation;
  - team honours of the system point to a team approved in that season;
    awards point to a player who took part in that season;
  - one champion, one runner-up and one third place per season/edition; an
    award may be shared; nothing is deleted once published (unpublish first);
  - a category used by a published honour cannot be renamed (deactivate it and
    create another); a category in use is never deleted.
*/

-- ------------------------------------------------------------ categories
CREATE TABLE IF NOT EXISTS public.award_categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL CHECK (length(btrim(name)) BETWEEN 3 AND 60),
  description text CHECK (description IS NULL OR length(description) <= 300),
  active boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 100,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS award_categories_name_key ON public.award_categories(lower(btrim(name)));
ALTER TABLE public.award_categories ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS award_categories_public_select ON public.award_categories;
CREATE POLICY award_categories_public_select ON public.award_categories FOR SELECT TO anon, authenticated USING (true);
REVOKE ALL ON public.award_categories FROM anon, authenticated;
GRANT SELECT ON public.award_categories TO anon, authenticated;

-- the six categories approved by the FBF on 2026-11-23 (none is mandatory)
INSERT INTO public.award_categories (name, sort_order) VALUES
  ('Melhor jogador', 10), ('Melhor goleiro', 20), ('Melhor volante', 30),
  ('Melhor pivô', 40), ('Revelação', 50), ('Craque da final', 60)
ON CONFLICT DO NOTHING;

-- ------------------------------------------------- editions before the system
CREATE TABLE IF NOT EXISTS public.historical_editions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  competition_name text NOT NULL CHECK (length(btrim(competition_name)) BETWEEN 2 AND 80),
  edition_name text CHECK (edition_name IS NULL OR length(btrim(edition_name)) BETWEEN 1 AND 80),
  category text CHECK (category IS NULL OR length(btrim(category)) BETWEEN 1 AND 40),
  edition_year integer CHECK (edition_year IS NULL OR edition_year BETWEEN 2000 AND 2100),
  started_on date,
  ended_on date,
  -- where the FBF confirmed the information (minutes, announcement, archive...)
  source text NOT NULL CHECK (length(btrim(source)) BETWEEN 3 AND 300),
  notes text CHECK (notes IS NULL OR length(notes) <= 500),
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT historical_editions_dates CHECK (started_on IS NULL OR ended_on IS NULL OR started_on <= ended_on)
);
ALTER TABLE public.historical_editions ENABLE ROW LEVEL SECURITY;
-- (the public policy is created after season_honours, which it reads)

-- --------------------------------------------------------------- honours
CREATE TABLE IF NOT EXISTS public.season_honours (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- exactly one: a season of the system or an edition before the system
  season_id uuid REFERENCES public.seasons(id) ON DELETE RESTRICT,
  historical_edition_id uuid REFERENCES public.historical_editions(id) ON DELETE RESTRICT,
  kind text NOT NULL CHECK (kind IN ('CHAMPION', 'RUNNER_UP', 'THIRD_PLACE', 'AWARD', 'TOP_SCORER')),
  award_category_id uuid REFERENCES public.award_categories(id) ON DELETE RESTRICT,
  -- team: the season team (system), or a registered team / a name (before the system)
  season_team_id uuid REFERENCES public.season_teams(id) ON DELETE RESTRICT,
  team_id uuid REFERENCES public.teams(id) ON DELETE RESTRICT,
  team_name text CHECK (team_name IS NULL OR length(btrim(team_name)) BETWEEN 2 AND 60),
  -- player: a registered player, or a name (before the system)
  player_id uuid REFERENCES public.players(id) ON DELETE RESTRICT,
  player_name text CHECK (player_name IS NULL OR length(btrim(player_name)) BETWEEN 2 AND 40),
  goals integer CHECK (goals IS NULL OR goals BETWEEN 0 AND 999),
  basis text NOT NULL DEFAULT 'MANUAL' CHECK (basis IN ('FINAL', 'STANDINGS', 'MANUAL')),
  notes text CHECK (notes IS NULL OR length(notes) <= 300),
  status text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'PUBLISHED')),
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  published_by uuid,
  published_at timestamptz,
  CONSTRAINT season_honours_scope CHECK (num_nonnulls(season_id, historical_edition_id) = 1),
  CONSTRAINT season_honours_system_shape CHECK (
    season_id IS NULL OR (team_id IS NULL AND team_name IS NULL AND player_name IS NULL AND goals IS NULL AND kind <> 'TOP_SCORER')
  ),
  CONSTRAINT season_honours_historical_shape CHECK (
    historical_edition_id IS NULL OR (season_team_id IS NULL AND basis = 'MANUAL')
  ),
  CONSTRAINT season_honours_kind_shape CHECK (
    (kind IN ('CHAMPION', 'RUNNER_UP', 'THIRD_PLACE')
      AND award_category_id IS NULL AND player_id IS NULL AND player_name IS NULL AND goals IS NULL
      AND num_nonnulls(season_team_id, team_id, team_name) = 1)
    OR (kind = 'AWARD'
      AND award_category_id IS NOT NULL AND goals IS NULL
      AND num_nonnulls(player_id, player_name) = 1 AND num_nonnulls(season_team_id, team_id, team_name) <= 1)
    OR (kind = 'TOP_SCORER'
      AND award_category_id IS NULL
      AND num_nonnulls(player_id, player_name) = 1 AND num_nonnulls(team_id, team_name) <= 1)
  )
);
CREATE UNIQUE INDEX IF NOT EXISTS season_honours_one_team_place
  ON public.season_honours(COALESCE(season_id, historical_edition_id), kind) WHERE kind IN ('CHAMPION', 'RUNNER_UP', 'THIRD_PLACE');
CREATE UNIQUE INDEX IF NOT EXISTS season_honours_one_award_per_player
  ON public.season_honours(COALESCE(season_id, historical_edition_id), award_category_id, COALESCE(player_id::text, lower(btrim(player_name)))) WHERE kind = 'AWARD';
CREATE UNIQUE INDEX IF NOT EXISTS season_honours_one_top_scorer_per_player
  ON public.season_honours(historical_edition_id, COALESCE(player_id::text, lower(btrim(player_name)))) WHERE kind = 'TOP_SCORER';
CREATE INDEX IF NOT EXISTS season_honours_season_idx ON public.season_honours(season_id);
CREATE INDEX IF NOT EXISTS season_honours_edition_idx ON public.season_honours(historical_edition_id);
CREATE INDEX IF NOT EXISTS season_honours_team_idx ON public.season_honours(season_team_id);
CREATE INDEX IF NOT EXISTS season_honours_hteam_idx ON public.season_honours(team_id);
CREATE INDEX IF NOT EXISTS season_honours_player_idx ON public.season_honours(player_id);
CREATE INDEX IF NOT EXISTS season_honours_category_idx ON public.season_honours(award_category_id);

ALTER TABLE public.season_honours ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS season_honours_public_select ON public.season_honours;
CREATE POLICY season_honours_public_select ON public.season_honours FOR SELECT TO anon, authenticated USING (
  status = 'PUBLISHED' AND (
    historical_edition_id IS NOT NULL
    OR EXISTS (
      SELECT 1 FROM public.seasons s JOIN public.competitions c ON c.id = s.competition_id
      WHERE s.id = season_honours.season_id AND c.status = 'FINISHED'
    )
  )
);
DROP POLICY IF EXISTS season_honours_admin_select ON public.season_honours;
CREATE POLICY season_honours_admin_select ON public.season_honours FOR SELECT TO authenticated USING (public.is_fbf_admin());
REVOKE ALL ON public.season_honours FROM anon, authenticated;
GRANT SELECT ON public.season_honours TO anon, authenticated;

-- an edition before the system is public only once it has a published honour
DROP POLICY IF EXISTS historical_editions_public_select ON public.historical_editions;
CREATE POLICY historical_editions_public_select ON public.historical_editions FOR SELECT TO anon, authenticated USING (
  EXISTS (SELECT 1 FROM public.season_honours h WHERE h.historical_edition_id = historical_editions.id AND h.status = 'PUBLISHED')
);
DROP POLICY IF EXISTS historical_editions_admin_select ON public.historical_editions;
CREATE POLICY historical_editions_admin_select ON public.historical_editions FOR SELECT TO authenticated USING (public.is_fbf_admin());
REVOKE ALL ON public.historical_editions FROM anon, authenticated;
GRANT SELECT ON public.historical_editions TO anon, authenticated;

-- ------------------------------------------------------------ history
CREATE TABLE IF NOT EXISTS public.hall_of_fame_changes (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  entity text NOT NULL CHECK (entity IN ('HONOUR', 'EDITION', 'CATEGORY')),
  entity_id uuid NOT NULL,
  -- no foreign keys: the history outlives what it describes (e.g. an audited restart)
  season_id uuid,
  historical_edition_id uuid,
  action text NOT NULL CHECK (action IN ('CREATE', 'UPDATE', 'PUBLISH', 'UNPUBLISH', 'DELETE')),
  reason text NOT NULL,
  before jsonb,
  after jsonb,
  actor uuid,
  changed_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS hall_of_fame_changes_entity_idx ON public.hall_of_fame_changes(entity, entity_id, id);
CREATE INDEX IF NOT EXISTS hall_of_fame_changes_season_idx ON public.hall_of_fame_changes(season_id, changed_at);
ALTER TABLE public.hall_of_fame_changes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS hall_of_fame_changes_admin_select ON public.hall_of_fame_changes;
CREATE POLICY hall_of_fame_changes_admin_select ON public.hall_of_fame_changes FOR SELECT TO authenticated USING (public.is_fbf_admin());
REVOKE ALL ON public.hall_of_fame_changes FROM anon, authenticated;
GRANT SELECT ON public.hall_of_fame_changes TO authenticated;

-- the history is append-only
CREATE OR REPLACE FUNCTION public.prevent_hall_of_fame_changes_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  RAISE EXCEPTION 'O histórico do Hall da Fama é somente de acréscimo' USING ERRCODE = '55000';
END;
$$;
DROP TRIGGER IF EXISTS hall_of_fame_changes_append_only ON public.hall_of_fame_changes;
CREATE TRIGGER hall_of_fame_changes_append_only BEFORE UPDATE OR DELETE ON public.hall_of_fame_changes
FOR EACH ROW EXECUTE FUNCTION public.prevent_hall_of_fame_changes_mutation();

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

CREATE OR REPLACE FUNCTION public._hof_log(p_entity text, p_id uuid, p_season uuid, p_edition uuid, p_action text, p_reason text, p_before jsonb, p_after jsonb)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  INSERT INTO public.hall_of_fame_changes (entity, entity_id, season_id, historical_edition_id, action, reason, before, after, actor)
  VALUES (p_entity, p_id, p_season, p_edition, p_action, btrim(p_reason), p_before, p_after, auth.uid());
$$;
REVOKE EXECUTE ON FUNCTION public._hof_log(text, uuid, uuid, uuid, text, text, jsonb, jsonb) FROM PUBLIC, anon, authenticated;

-- ------------------------------------------------------- categories: write
/* p_category: {"name", "description"?, "active"?, "sort_order"?}; p_id NULL creates. */
CREATE OR REPLACE FUNCTION public.save_award_category(p_id uuid, p_category jsonb, p_reason text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_row public.award_categories%ROWTYPE;
  v_before jsonb;
  v_name text;
BEGIN
  PERFORM public._honour_guard(p_reason);
  IF p_category IS NULL OR jsonb_typeof(p_category) <> 'object' THEN
    RAISE EXCEPTION 'Dados inválidos' USING ERRCODE = '22023';
  END IF;
  v_name := btrim(COALESCE(p_category->>'name', ''));
  IF length(v_name) < 3 OR length(v_name) > 60 THEN
    RAISE EXCEPTION 'O nome da premiação precisa ter de 3 a 60 caracteres' USING ERRCODE = '22023';
  END IF;
  IF p_id IS NULL THEN
    INSERT INTO public.award_categories (name, description, active, sort_order, created_by, updated_by)
    VALUES (v_name, NULLIF(btrim(COALESCE(p_category->>'description', '')), ''), COALESCE((p_category->>'active')::boolean, true),
      COALESCE((p_category->>'sort_order')::integer, 100), auth.uid(), auth.uid())
    RETURNING * INTO v_row;
    PERFORM public._hof_log('CATEGORY', v_row.id, NULL, NULL, 'CREATE', p_reason, NULL, to_jsonb(v_row));
    RETURN v_row.id;
  END IF;
  SELECT * INTO v_row FROM public.award_categories WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Premiação não encontrada' USING ERRCODE = 'P0002'; END IF;
  -- renaming would change honours already published: deactivate and create another
  IF lower(v_row.name) <> lower(v_name)
     AND EXISTS (SELECT 1 FROM public.season_honours WHERE award_category_id = p_id AND status = 'PUBLISHED') THEN
    RAISE EXCEPTION 'Esta premiação já foi publicada e não pode ser renomeada; desative-a e crie outra' USING ERRCODE = '55000';
  END IF;
  v_before := to_jsonb(v_row);
  UPDATE public.award_categories
  SET name = v_name, description = NULLIF(btrim(COALESCE(p_category->>'description', '')), ''),
      active = COALESCE((p_category->>'active')::boolean, active), sort_order = COALESCE((p_category->>'sort_order')::integer, sort_order),
      updated_by = auth.uid(), updated_at = now()
  WHERE id = p_id RETURNING * INTO v_row;
  PERFORM public._hof_log('CATEGORY', p_id, NULL, NULL, 'UPDATE', p_reason, v_before, to_jsonb(v_row));
  RETURN p_id;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.save_award_category(uuid, jsonb, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_award_category(uuid, jsonb, text) TO authenticated;

-- only a category never used (an honour keeps it through RESTRICT anyway)
CREATE OR REPLACE FUNCTION public.delete_award_category(p_id uuid, p_reason text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_row public.award_categories%ROWTYPE;
BEGIN
  PERFORM public._honour_guard(p_reason);
  SELECT * INTO v_row FROM public.award_categories WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Premiação não encontrada' USING ERRCODE = 'P0002'; END IF;
  IF EXISTS (SELECT 1 FROM public.season_honours WHERE award_category_id = p_id) THEN
    RAISE EXCEPTION 'Esta premiação já foi usada; desative-a em vez de excluir' USING ERRCODE = '55000';
  END IF;
  DELETE FROM public.award_categories WHERE id = p_id;
  PERFORM public._hof_log('CATEGORY', p_id, NULL, NULL, 'DELETE', p_reason, to_jsonb(v_row), NULL);
  RETURN true;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.delete_award_category(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delete_award_category(uuid, text) TO authenticated;

-- ------------------------------------------- editions before the system: write
/* p_edition: {"competition_name", "edition_name"?, "category"?, "edition_year"?, "started_on"?, "ended_on"?, "source", "notes"?} */
CREATE OR REPLACE FUNCTION public.save_historical_edition(p_id uuid, p_edition jsonb, p_reason text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_row public.historical_editions%ROWTYPE;
  v_before jsonb;
  v_year integer;
  v_start date;
  v_end date;
BEGIN
  PERFORM public._honour_guard(p_reason);
  IF p_edition IS NULL OR jsonb_typeof(p_edition) <> 'object' THEN
    RAISE EXCEPTION 'Dados inválidos' USING ERRCODE = '22023';
  END IF;
  IF length(btrim(COALESCE(p_edition->>'source', ''))) < 3 THEN
    RAISE EXCEPTION 'Informe a fonte em que a FBF confirmou a edição' USING ERRCODE = '22023';
  END IF;
  BEGIN
    v_year := NULLIF(p_edition->>'edition_year', '')::integer;
    v_start := NULLIF(p_edition->>'started_on', '')::date;
    v_end := NULLIF(p_edition->>'ended_on', '')::date;
  EXCEPTION WHEN others THEN
    RAISE EXCEPTION 'Ano ou data inválidos' USING ERRCODE = '22023';
  END;
  -- by definition played before the system: never in the future
  IF v_end > current_date OR v_start > current_date OR v_year > extract(year FROM current_date) THEN
    RAISE EXCEPTION 'Uma edição anterior ao sistema não pode ter data futura' USING ERRCODE = '22023';
  END IF;
  IF p_id IS NULL THEN
    INSERT INTO public.historical_editions (competition_name, edition_name, category, edition_year, started_on, ended_on, source, notes, created_by, updated_by)
    VALUES (btrim(COALESCE(p_edition->>'competition_name', '')), NULLIF(btrim(COALESCE(p_edition->>'edition_name', '')), ''),
      NULLIF(btrim(COALESCE(p_edition->>'category', '')), ''), v_year, v_start, v_end, btrim(p_edition->>'source'),
      NULLIF(btrim(COALESCE(p_edition->>'notes', '')), ''), auth.uid(), auth.uid())
    RETURNING * INTO v_row;
    PERFORM public._hof_log('EDITION', v_row.id, NULL, v_row.id, 'CREATE', p_reason, NULL, to_jsonb(v_row));
    RETURN v_row.id;
  END IF;
  SELECT * INTO v_row FROM public.historical_editions WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Edição não encontrada' USING ERRCODE = 'P0002'; END IF;
  IF EXISTS (SELECT 1 FROM public.season_honours WHERE historical_edition_id = p_id AND status = 'PUBLISHED') THEN
    RAISE EXCEPTION 'A edição tem registros publicados; despublique-os antes de alterar a edição' USING ERRCODE = '55000';
  END IF;
  v_before := to_jsonb(v_row);
  UPDATE public.historical_editions
  SET competition_name = btrim(COALESCE(p_edition->>'competition_name', '')), edition_name = NULLIF(btrim(COALESCE(p_edition->>'edition_name', '')), ''),
      category = NULLIF(btrim(COALESCE(p_edition->>'category', '')), ''), edition_year = v_year, started_on = v_start, ended_on = v_end,
      source = btrim(p_edition->>'source'), notes = NULLIF(btrim(COALESCE(p_edition->>'notes', '')), ''),
      updated_by = auth.uid(), updated_at = now()
  WHERE id = p_id RETURNING * INTO v_row;
  PERFORM public._hof_log('EDITION', p_id, NULL, p_id, 'UPDATE', p_reason, v_before, to_jsonb(v_row));
  RETURN p_id;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.save_historical_edition(uuid, jsonb, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_historical_edition(uuid, jsonb, text) TO authenticated;

-- only an edition without any honour (drafts are deleted first)
CREATE OR REPLACE FUNCTION public.delete_historical_edition(p_id uuid, p_reason text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_row public.historical_editions%ROWTYPE;
BEGIN
  PERFORM public._honour_guard(p_reason);
  SELECT * INTO v_row FROM public.historical_editions WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Edição não encontrada' USING ERRCODE = 'P0002'; END IF;
  IF EXISTS (SELECT 1 FROM public.season_honours WHERE historical_edition_id = p_id) THEN
    RAISE EXCEPTION 'Exclua ou mantenha os registros da edição antes de excluí-la' USING ERRCODE = '55000';
  END IF;
  DELETE FROM public.historical_editions WHERE id = p_id;
  PERFORM public._hof_log('EDITION', p_id, NULL, p_id, 'DELETE', p_reason, to_jsonb(v_row), NULL);
  RETURN true;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.delete_historical_edition(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delete_historical_edition(uuid, text) TO authenticated;

-- ---------------------------------------------------------- honours: write
/* Create or change a DRAFT honour.
   p_honour: {"season_id" | "historical_edition_id", "kind", "award_category_id"?, "season_team_id"?,
              "team_id"?, "team_name"?, "player_id"?, "player_name"?, "goals"?, "basis"?, "notes"?}
   team_id / team_name / player_name / goals / TOP_SCORER only for editions before the system.
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
  v_edition uuid;
  v_kind text;
  v_category uuid;
  v_st uuid;
  v_team uuid;
  v_team_name text;
  v_player uuid;
  v_player_name text;
  v_goals integer;
  v_basis text;
  v_notes text;
BEGIN
  PERFORM public._honour_guard(p_reason);
  IF p_honour IS NULL OR jsonb_typeof(p_honour) <> 'object' THEN
    RAISE EXCEPTION 'Dados inválidos' USING ERRCODE = '22023';
  END IF;
  BEGIN
    v_season := NULLIF(p_honour->>'season_id', '')::uuid;
    v_edition := NULLIF(p_honour->>'historical_edition_id', '')::uuid;
    v_category := NULLIF(p_honour->>'award_category_id', '')::uuid;
    v_st := NULLIF(p_honour->>'season_team_id', '')::uuid;
    v_team := NULLIF(p_honour->>'team_id', '')::uuid;
    v_player := NULLIF(p_honour->>'player_id', '')::uuid;
    v_goals := NULLIF(p_honour->>'goals', '')::integer;
  EXCEPTION WHEN others THEN
    RAISE EXCEPTION 'Identificador ou número inválido' USING ERRCODE = '22023';
  END;
  v_kind := p_honour->>'kind';
  v_team_name := NULLIF(btrim(COALESCE(p_honour->>'team_name', '')), '');
  v_player_name := NULLIF(btrim(COALESCE(p_honour->>'player_name', '')), '');
  v_notes := NULLIF(btrim(COALESCE(p_honour->>'notes', '')), '');
  v_basis := COALESCE(NULLIF(p_honour->>'basis', ''), 'MANUAL');
  IF num_nonnulls(v_season, v_edition) <> 1 THEN
    RAISE EXCEPTION 'Informe a temporada do sistema ou a edição anterior ao sistema' USING ERRCODE = '22023';
  END IF;

  IF v_season IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM public.seasons WHERE id = v_season) THEN
      RAISE EXCEPTION 'Temporada não encontrada' USING ERRCODE = 'P0002';
    END IF;
    IF v_kind = 'TOP_SCORER' THEN
      RAISE EXCEPTION 'A artilharia das competições do sistema vem das súmulas oficiais e não é registrada' USING ERRCODE = '23514';
    END IF;
    IF v_team IS NOT NULL OR v_team_name IS NOT NULL OR v_player_name IS NOT NULL OR v_goals IS NOT NULL THEN
      RAISE EXCEPTION 'Nas competições do sistema use a equipe da temporada e um jogador cadastrado' USING ERRCODE = '23514';
    END IF;
    IF v_st IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.season_teams WHERE id = v_st AND season_id = v_season) THEN
      RAISE EXCEPTION 'A equipe não participa desta temporada' USING ERRCODE = '23514';
    END IF;
    -- an individual award goes to someone who took part in that season (roster or proven participation)
    IF v_player IS NOT NULL AND NOT (
      EXISTS (SELECT 1 FROM public.rosters r JOIN public.season_teams st ON st.id = r.season_team_id
              WHERE st.season_id = v_season AND r.player_id = v_player AND (v_st IS NULL OR st.id = v_st))
      OR EXISTS (SELECT 1 FROM public.player_match_participation pmp
                 WHERE pmp.season_id = v_season AND pmp.player_id = v_player AND (v_st IS NULL OR pmp.season_team_id = v_st))
    ) THEN
      RAISE EXCEPTION 'O jogador não participou desta temporada por essa equipe' USING ERRCODE = '23514';
    END IF;
  ELSE
    IF NOT EXISTS (SELECT 1 FROM public.historical_editions WHERE id = v_edition) THEN
      RAISE EXCEPTION 'Edição não encontrada' USING ERRCODE = 'P0002';
    END IF;
    IF v_st IS NOT NULL THEN
      RAISE EXCEPTION 'Edições anteriores ao sistema não têm equipes de temporada; escolha a equipe cadastrada ou digite o nome' USING ERRCODE = '23514';
    END IF;
    v_basis := 'MANUAL';
  END IF;
  IF v_team IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.teams WHERE id = v_team) THEN
    RAISE EXCEPTION 'Equipe não encontrada' USING ERRCODE = 'P0002';
  END IF;
  IF v_player IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.players WHERE id = v_player) THEN
    RAISE EXCEPTION 'Jogador não encontrado' USING ERRCODE = 'P0002';
  END IF;
  IF v_kind = 'AWARD' THEN
    IF v_category IS NULL OR NOT EXISTS (SELECT 1 FROM public.award_categories WHERE id = v_category) THEN
      RAISE EXCEPTION 'Escolha a premiação' USING ERRCODE = '22023';
    END IF;
  ELSIF v_category IS NOT NULL THEN
    RAISE EXCEPTION 'Só premiações individuais têm categoria' USING ERRCODE = '22023';
  END IF;

  IF p_id IS NOT NULL THEN
    SELECT * INTO v_row FROM public.season_honours WHERE id = p_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Registro não encontrado' USING ERRCODE = 'P0002'; END IF;
    IF v_row.status = 'PUBLISHED' THEN
      RAISE EXCEPTION 'Despublique o registro antes de alterá-lo' USING ERRCODE = '55000';
    END IF;
    IF v_row.season_id IS DISTINCT FROM v_season OR v_row.historical_edition_id IS DISTINCT FROM v_edition THEN
      RAISE EXCEPTION 'Não é possível mudar a temporada ou a edição de um registro' USING ERRCODE = '23514';
    END IF;
    -- a category switched on a draft must still be active
    IF v_kind = 'AWARD' AND v_category IS DISTINCT FROM v_row.award_category_id
       AND NOT EXISTS (SELECT 1 FROM public.award_categories WHERE id = v_category AND active) THEN
      RAISE EXCEPTION 'Esta premiação está desativada' USING ERRCODE = '23514';
    END IF;
    v_before := to_jsonb(v_row);
    UPDATE public.season_honours SET kind = v_kind, award_category_id = v_category, season_team_id = v_st, team_id = v_team,
      team_name = v_team_name, player_id = v_player, player_name = v_player_name, goals = v_goals, basis = v_basis, notes = v_notes
    WHERE id = p_id RETURNING * INTO v_row;
    PERFORM public._hof_log('HONOUR', p_id, v_season, v_edition, 'UPDATE', p_reason, v_before, to_jsonb(v_row));
    RETURN p_id;
  END IF;

  IF v_kind = 'AWARD' AND NOT EXISTS (SELECT 1 FROM public.award_categories WHERE id = v_category AND active) THEN
    RAISE EXCEPTION 'Esta premiação está desativada' USING ERRCODE = '23514';
  END IF;
  INSERT INTO public.season_honours (season_id, historical_edition_id, kind, award_category_id, season_team_id, team_id, team_name,
    player_id, player_name, goals, basis, notes, created_by)
  VALUES (v_season, v_edition, v_kind, v_category, v_st, v_team, v_team_name, v_player, v_player_name, v_goals, v_basis, v_notes, auth.uid())
  RETURNING * INTO v_row;
  PERFORM public._hof_log('HONOUR', v_row.id, v_season, v_edition, 'CREATE', p_reason, NULL, to_jsonb(v_row));
  RETURN v_row.id;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.save_season_honour(uuid, jsonb, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_season_honour(uuid, jsonb, text) TO authenticated;

-- Publish (the admin's confirmation) or unpublish. A season of the system
-- must be FINISHED; an edition before the system has, by definition, ended.
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
  IF p_publish AND v_row.season_id IS NOT NULL THEN
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
  PERFORM public._hof_log('HONOUR', p_id, v_row.season_id, v_row.historical_edition_id,
    CASE WHEN p_publish THEN 'PUBLISH' ELSE 'UNPUBLISH' END, p_reason, v_before, to_jsonb(v_row));
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
  PERFORM public._hof_log('HONOUR', p_id, v_row.season_id, v_row.historical_edition_id, 'DELETE', p_reason, to_jsonb(v_row), NULL);
  RETURN true;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.delete_season_honour(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delete_season_honour(uuid, text) TO authenticated;

-- A team, player, season or category with a registered honour keeps its
-- history (same rule as rosters and matches): the RESTRICT foreign keys above
-- refuse the deletion, and the safe competition reset stops without deleting.
