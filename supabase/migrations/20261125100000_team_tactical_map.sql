/*
# Mapa tático dos clubes (presentation of a team's squad)

A tactical presentation of each team's squad per season: three starters placed
freely on a court, the rest on the bench, and a customizable avatar for each
player in that club. It is NOT an official match lineup: nothing here touches
match_participations, match sheets, events, goalkeepers, statistics or the
MVP. It only reads the existing registrations (teams, season_teams, rosters,
players).

Objects:
  - team_managers: who may edit a club's presentation, besides FBF admins.
    Only admins grant or revoke (set_team_manager), with a reason. A manager
    edits only the clubs he was granted.
  - team_formations: one per season team (the same entity as the season
    roster), so each season keeps its own formation. starters = up to 3
    {player_id, role, x, y} with x/y proportional to the court (0..1); bench =
    ordered player ids. A version number guards against concurrent edits.
  - team_player_avatars: the avatar a club gives to each of its players
    (colors, symbol, label, style), so one club never changes another club's
    look of the same player.
  - team_presentation_changes: append-only history of every change, with who
    and when.

Rules (checked here, whatever the site does):
  - only admins or the club's managers write, always through the functions;
  - every player saved must be in the roster of that season team; a player
    appears once (starter or bench), at most 3 starters, positions inside the
    court;
  - stale saves are refused (the formation changed since it was loaded).
  - These are presentation records: deleting a season team (safe reset)
    removes its formation with it (ON DELETE CASCADE); official data never
    depends on them.
*/

-- ------------------------------------------------------------ managers
CREATE TABLE IF NOT EXISTS public.team_managers (
  team_id uuid NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  granted_by uuid,
  granted_at timestamptz NOT NULL DEFAULT now(),
  reason text NOT NULL CHECK (length(btrim(reason)) >= 3),
  PRIMARY KEY (team_id, user_id)
);
CREATE INDEX IF NOT EXISTS team_managers_user_idx ON public.team_managers(user_id);
ALTER TABLE public.team_managers ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS team_managers_select ON public.team_managers;
CREATE POLICY team_managers_select ON public.team_managers FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.is_fbf_admin());
REVOKE ALL ON public.team_managers FROM anon, authenticated;
GRANT SELECT ON public.team_managers TO authenticated;

-- may the caller edit this club's presentation? (admins: any club)
CREATE OR REPLACE FUNCTION public.can_edit_team_presentation(p_team_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT auth.uid() IS NOT NULL AND (
    COALESCE(public.is_fbf_admin(), false)
    OR EXISTS (SELECT 1 FROM public.team_managers WHERE team_id = p_team_id AND user_id = auth.uid())
  );
$$;
REVOKE ALL ON FUNCTION public.can_edit_team_presentation(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_edit_team_presentation(uuid) TO authenticated;

-- ------------------------------------------------------------ formations
CREATE TABLE IF NOT EXISTS public.team_formations (
  season_team_id uuid PRIMARY KEY REFERENCES public.season_teams(id) ON DELETE CASCADE,
  starters jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(starters) = 'array' AND jsonb_array_length(starters) <= 3),
  bench jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(bench) = 'array'),
  version integer NOT NULL DEFAULT 1,
  updated_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.team_formations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS team_formations_public_select ON public.team_formations;
CREATE POLICY team_formations_public_select ON public.team_formations FOR SELECT TO anon, authenticated USING (true);
REVOKE ALL ON public.team_formations FROM anon, authenticated;
GRANT SELECT ON public.team_formations TO anon, authenticated;

-- ------------------------------------------------------------ avatars
CREATE TABLE IF NOT EXISTS public.team_player_avatars (
  team_id uuid NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
  player_id uuid NOT NULL REFERENCES public.players(id) ON DELETE CASCADE,
  config jsonb NOT NULL,
  updated_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (team_id, player_id)
);
ALTER TABLE public.team_player_avatars ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS team_player_avatars_public_select ON public.team_player_avatars;
CREATE POLICY team_player_avatars_public_select ON public.team_player_avatars FOR SELECT TO anon, authenticated USING (true);
REVOKE ALL ON public.team_player_avatars FROM anon, authenticated;
GRANT SELECT ON public.team_player_avatars TO anon, authenticated;

-- ------------------------------------------------------------ history
CREATE TABLE IF NOT EXISTS public.team_presentation_changes (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  team_id uuid NOT NULL,
  season_team_id uuid,
  entity text NOT NULL CHECK (entity IN ('FORMATION', 'AVATAR', 'MANAGER')),
  subject uuid,
  before jsonb,
  after jsonb,
  reason text,
  actor uuid,
  changed_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS team_presentation_changes_team_idx ON public.team_presentation_changes(team_id, id);
ALTER TABLE public.team_presentation_changes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS team_presentation_changes_select ON public.team_presentation_changes;
CREATE POLICY team_presentation_changes_select ON public.team_presentation_changes FOR SELECT TO authenticated
  USING (public.can_edit_team_presentation(team_id));
REVOKE ALL ON public.team_presentation_changes FROM anon, authenticated;
GRANT SELECT ON public.team_presentation_changes TO authenticated;

CREATE OR REPLACE FUNCTION public.prevent_team_presentation_changes_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  RAISE EXCEPTION 'O histórico do mapa tático é somente de acréscimo' USING ERRCODE = '55000';
END;
$$;
DROP TRIGGER IF EXISTS team_presentation_changes_append_only ON public.team_presentation_changes;
CREATE TRIGGER team_presentation_changes_append_only BEFORE UPDATE OR DELETE ON public.team_presentation_changes
FOR EACH ROW EXECUTE FUNCTION public.prevent_team_presentation_changes_mutation();

-- ------------------------------------------------------------ writes
/* Grant (p_grant = true) or revoke a club manager. Admins only, with a reason. */
CREATE OR REPLACE FUNCTION public.set_team_manager(p_team_id uuid, p_user_id uuid, p_grant boolean, p_reason text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_before jsonb;
BEGIN
  IF NOT COALESCE(public.is_fbf_admin(), false) THEN
    RAISE EXCEPTION 'Somente administradores designam responsáveis pelos clubes' USING ERRCODE = '42501';
  END IF;
  IF length(btrim(COALESCE(p_reason, ''))) < 3 THEN RAISE EXCEPTION 'Informe o motivo' USING ERRCODE = '22023'; END IF;
  IF p_grant IS NULL THEN RAISE EXCEPTION 'Informe se designa ou remove' USING ERRCODE = '22023'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.teams WHERE id = p_team_id) THEN RAISE EXCEPTION 'Time não encontrado' USING ERRCODE = 'P0002'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = p_user_id) THEN RAISE EXCEPTION 'Usuário não encontrado' USING ERRCODE = 'P0002'; END IF;
  SELECT to_jsonb(m) INTO v_before FROM public.team_managers m WHERE team_id = p_team_id AND user_id = p_user_id;
  IF p_grant THEN
    IF v_before IS NOT NULL THEN RETURN true; END IF;
    INSERT INTO public.team_managers (team_id, user_id, granted_by, reason) VALUES (p_team_id, p_user_id, auth.uid(), btrim(p_reason));
  ELSE
    IF v_before IS NULL THEN RETURN false; END IF;
    DELETE FROM public.team_managers WHERE team_id = p_team_id AND user_id = p_user_id;
  END IF;
  INSERT INTO public.team_presentation_changes (team_id, entity, subject, before, after, reason, actor)
  VALUES (p_team_id, 'MANAGER', p_user_id, v_before,
    CASE WHEN p_grant THEN (SELECT to_jsonb(m) FROM public.team_managers m WHERE team_id = p_team_id AND user_id = p_user_id) END,
    btrim(p_reason), auth.uid());
  RETURN p_grant;
END;
$$;
REVOKE ALL ON FUNCTION public.set_team_manager(uuid, uuid, boolean, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_team_manager(uuid, uuid, boolean, text) TO authenticated;

/* Save the formation of a season team.
   p_formation: {"starters":[{"player_id","role","x","y"}...≤3], "bench":["player_id",...]}
   p_expected_version: the version loaded (0 when there was none). Returns the new version. */
CREATE OR REPLACE FUNCTION public.save_team_formation(p_season_team_id uuid, p_expected_version integer, p_formation jsonb)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_team uuid;
  v_row public.team_formations%ROWTYPE;
  v_before jsonb;
  v_starters jsonb;
  v_bench jsonb;
  v_ids uuid[];
  v_s jsonb;
  v_x numeric;
  v_y numeric;
  v_role text;
  v_version integer;
BEGIN
  SELECT team_id INTO v_team FROM public.season_teams WHERE id = p_season_team_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Equipe da temporada não encontrada' USING ERRCODE = 'P0002'; END IF;
  IF NOT public.can_edit_team_presentation(v_team) THEN
    RAISE EXCEPTION 'Sem permissão para editar o mapa tático deste clube' USING ERRCODE = '42501';
  END IF;
  IF p_formation IS NULL OR jsonb_typeof(p_formation) <> 'object'
     OR jsonb_typeof(COALESCE(p_formation->'starters', '[]')) <> 'array' OR jsonb_typeof(COALESCE(p_formation->'bench', '[]')) <> 'array' THEN
    RAISE EXCEPTION 'Formação inválida' USING ERRCODE = '22023';
  END IF;
  v_starters := COALESCE(p_formation->'starters', '[]');
  v_bench := COALESCE(p_formation->'bench', '[]');
  IF jsonb_array_length(v_starters) > 3 THEN RAISE EXCEPTION 'No máximo três titulares' USING ERRCODE = '22023'; END IF;
  BEGIN
    v_ids := ARRAY(SELECT (s->>'player_id')::uuid FROM jsonb_array_elements(v_starters) s)
          || ARRAY(SELECT b::uuid FROM jsonb_array_elements_text(v_bench) b);
  EXCEPTION WHEN others THEN RAISE EXCEPTION 'Jogador inválido' USING ERRCODE = '22023';
  END;
  IF array_position(v_ids, NULL) IS NOT NULL THEN RAISE EXCEPTION 'Jogador inválido' USING ERRCODE = '22023'; END IF;
  IF cardinality(v_ids) <> (SELECT count(DISTINCT x) FROM unnest(v_ids) x) THEN
    RAISE EXCEPTION 'Um jogador não pode aparecer duas vezes (titular e reserva)' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (SELECT 1 FROM unnest(v_ids) x WHERE NOT EXISTS (SELECT 1 FROM public.rosters r WHERE r.season_team_id = p_season_team_id AND r.player_id = x)) THEN
    RAISE EXCEPTION 'Só jogadores do elenco desta temporada podem ser escalados' USING ERRCODE = '23514';
  END IF;
  FOR v_s IN SELECT value FROM jsonb_array_elements(v_starters) LOOP
    BEGIN
      v_x := (v_s->>'x')::numeric; v_y := (v_s->>'y')::numeric;
    EXCEPTION WHEN others THEN RAISE EXCEPTION 'Posição inválida' USING ERRCODE = '22023';
    END;
    IF v_x IS NULL OR v_y IS NULL OR v_x < 0.04 OR v_x > 0.96 OR v_y < 0.04 OR v_y > 0.96 THEN
      RAISE EXCEPTION 'O jogador precisa ficar dentro da quadra' USING ERRCODE = '22023';
    END IF;
    v_role := upper(btrim(COALESCE(v_s->>'role', '')));
    IF v_role !~ '^[A-Z0-9]{1,4}$' THEN RAISE EXCEPTION 'Posição na quadra inválida (de 1 a 4 letras)' USING ERRCODE = '22023'; END IF;
  END LOOP;
  -- normalized copy (rounded positions, upper-case roles, only known keys)
  v_starters := COALESCE((SELECT jsonb_agg(jsonb_build_object('player_id', s->>'player_id', 'role', upper(btrim(s->>'role')),
      'x', round((s->>'x')::numeric, 4), 'y', round((s->>'y')::numeric, 4)) ORDER BY ord)
    FROM jsonb_array_elements(v_starters) WITH ORDINALITY AS t(s, ord)), '[]');

  SELECT * INTO v_row FROM public.team_formations WHERE season_team_id = p_season_team_id FOR UPDATE;
  v_version := CASE WHEN FOUND THEN v_row.version ELSE 0 END;
  IF p_expected_version IS DISTINCT FROM v_version THEN
    RAISE EXCEPTION 'A formação foi alterada por outra pessoa enquanto você editava. Recarregue para ver a versão atual.' USING ERRCODE = '55000';
  END IF;
  v_before := CASE WHEN v_version > 0 THEN jsonb_build_object('starters', v_row.starters, 'bench', v_row.bench, 'version', v_row.version) END;
  INSERT INTO public.team_formations (season_team_id, starters, bench, version, updated_by, updated_at)
  VALUES (p_season_team_id, v_starters, v_bench, v_version + 1, auth.uid(), now())
  ON CONFLICT (season_team_id) DO UPDATE SET starters = EXCLUDED.starters, bench = EXCLUDED.bench,
    version = EXCLUDED.version, updated_by = EXCLUDED.updated_by, updated_at = EXCLUDED.updated_at;
  INSERT INTO public.team_presentation_changes (team_id, season_team_id, entity, subject, before, after, actor)
  VALUES (v_team, p_season_team_id, 'FORMATION', p_season_team_id, v_before,
    jsonb_build_object('starters', v_starters, 'bench', v_bench, 'version', v_version + 1), auth.uid());
  RETURN v_version + 1;
END;
$$;
REVOKE ALL ON FUNCTION public.save_team_formation(uuid, integer, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_team_formation(uuid, integer, jsonb) TO authenticated;

/* Save the avatar a club gives to one of its players (p_config NULL removes it, back to the default).
   p_config: {"background":"#rrggbb","border":"#rrggbb","symbol":<one of the list>,"label":"AB"(≤3),"show_number":bool,"style":"solid|ring|split"} */
CREATE OR REPLACE FUNCTION public.save_team_player_avatar(p_team_id uuid, p_player_id uuid, p_config jsonb)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_before jsonb;
  v_config jsonb;
BEGIN
  IF NOT public.can_edit_team_presentation(p_team_id) THEN
    RAISE EXCEPTION 'Sem permissão para editar os avatares deste clube' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.rosters r JOIN public.season_teams st ON st.id = r.season_team_id
                 WHERE st.team_id = p_team_id AND r.player_id = p_player_id) THEN
    RAISE EXCEPTION 'O jogador não pertence a nenhum elenco deste clube' USING ERRCODE = '23514';
  END IF;
  SELECT config INTO v_before FROM public.team_player_avatars WHERE team_id = p_team_id AND player_id = p_player_id;
  IF p_config IS NULL THEN
    DELETE FROM public.team_player_avatars WHERE team_id = p_team_id AND player_id = p_player_id;
  ELSE
    IF jsonb_typeof(p_config) <> 'object'
       OR COALESCE(p_config->>'background', '') !~ '^#[0-9a-fA-F]{6}$'
       OR COALESCE(p_config->>'border', '') !~ '^#[0-9a-fA-F]{6}$'
       OR COALESCE(p_config->>'symbol', '') NOT IN ('initial', 'number', 'ball', 'glove', 'star', 'shield', 'crown', 'bolt', 'flame', 'target')
       OR COALESCE(p_config->>'style', '') NOT IN ('solid', 'ring', 'split')
       OR length(COALESCE(p_config->>'label', '')) > 3
       OR COALESCE(p_config->>'label', '') ~ '[<>&"]'
       OR jsonb_typeof(COALESCE(p_config->'show_number', 'false'::jsonb)) <> 'boolean' THEN
      RAISE EXCEPTION 'Configuração de avatar inválida' USING ERRCODE = '22023';
    END IF;
    v_config := jsonb_build_object('background', lower(p_config->>'background'), 'border', lower(p_config->>'border'),
      'symbol', p_config->>'symbol', 'label', upper(btrim(COALESCE(p_config->>'label', ''))),
      'show_number', COALESCE((p_config->>'show_number')::boolean, false), 'style', p_config->>'style');
    INSERT INTO public.team_player_avatars (team_id, player_id, config, updated_by, updated_at)
    VALUES (p_team_id, p_player_id, v_config, auth.uid(), now())
    ON CONFLICT (team_id, player_id) DO UPDATE SET config = EXCLUDED.config, updated_by = EXCLUDED.updated_by, updated_at = EXCLUDED.updated_at;
  END IF;
  INSERT INTO public.team_presentation_changes (team_id, entity, subject, before, after, actor)
  VALUES (p_team_id, 'AVATAR', p_player_id, v_before, v_config, auth.uid());
  RETURN true;
END;
$$;
REVOKE ALL ON FUNCTION public.save_team_player_avatar(uuid, uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_team_player_avatar(uuid, uuid, jsonb) TO authenticated;
