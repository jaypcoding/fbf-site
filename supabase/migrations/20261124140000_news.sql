/*
# Notícias e comunicados oficiais

news_posts holds the texts published by the FBF; news_post_changes keeps every
change (append-only), with the version before and after and the reason.

Kinds:
  - OFFICIAL: comunicado oficial da FBF (rules, decisions, punishments...).
  - NEWS: news of the federation or of one competition.

Permissions (checked here, whatever the site does):
  - visitors read only PUBLISHED posts;
  - ADMIN: creates, edits, publishes, unpublishes and deletes drafts of any post;
  - ORGANIZER: writes and edits DRAFTS of NEWS linked to a competition he
    organizes; he never publishes, never writes OFFICIAL posts and never edits
    a published post (an admin reviews and publishes). This is the safe
    default; letting organizers publish would be a one-line change here.

Rules:
  - title, summary and body have size limits; the body is plain text (the site
    renders paragraphs, never HTML);
  - the address (slug) is created from the title and never changes after the
    first publication, so shared links keep working;
  - editing a published post (admin only) needs a reason and keeps the
    previous version in the history; the page shows "atualizado em";
  - a post that was ever published is never deleted: it is unpublished;
  - every write goes through the functions below, with a reason.
*/

CREATE TABLE IF NOT EXISTS public.news_posts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' AND length(slug) <= 90),
  kind text NOT NULL CHECK (kind IN ('OFFICIAL', 'NEWS')),
  title text NOT NULL CHECK (length(btrim(title)) BETWEEN 5 AND 140),
  summary text CHECK (summary IS NULL OR length(summary) <= 300),
  body text NOT NULL CHECK (length(btrim(body)) BETWEEN 1 AND 20000),
  competition_id uuid REFERENCES public.competitions(id) ON DELETE RESTRICT,
  pinned boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'PUBLISHED')),
  first_published_at timestamptz,
  published_at timestamptz,
  published_by uuid,
  edited_after_publication_at timestamptz,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now(),
  version integer NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS news_posts_public_idx ON public.news_posts(status, published_at DESC);
CREATE INDEX IF NOT EXISTS news_posts_competition_idx ON public.news_posts(competition_id);

ALTER TABLE public.news_posts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS news_posts_public_select ON public.news_posts;
CREATE POLICY news_posts_public_select ON public.news_posts FOR SELECT TO anon, authenticated USING (status = 'PUBLISHED');
DROP POLICY IF EXISTS news_posts_manager_select ON public.news_posts;
CREATE POLICY news_posts_manager_select ON public.news_posts FOR SELECT TO authenticated USING (
  public.is_fbf_admin()
  OR (kind = 'NEWS' AND competition_id IS NOT NULL AND public.can_manage_competition(competition_id))
);
REVOKE ALL ON public.news_posts FROM anon, authenticated;
GRANT SELECT ON public.news_posts TO anon, authenticated;

CREATE TABLE IF NOT EXISTS public.news_post_changes (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  post_id uuid NOT NULL,
  action text NOT NULL CHECK (action IN ('CREATE', 'UPDATE', 'PUBLISH', 'UNPUBLISH', 'DELETE')),
  reason text NOT NULL,
  before jsonb,
  after jsonb,
  actor uuid,
  actor_role text,
  changed_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS news_post_changes_post_idx ON public.news_post_changes(post_id, id);
ALTER TABLE public.news_post_changes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS news_post_changes_manager_select ON public.news_post_changes;
CREATE POLICY news_post_changes_manager_select ON public.news_post_changes FOR SELECT TO authenticated USING (
  public.is_fbf_admin()
  OR EXISTS (SELECT 1 FROM public.news_posts p WHERE p.id = news_post_changes.post_id
             AND p.kind = 'NEWS' AND p.competition_id IS NOT NULL AND public.can_manage_competition(p.competition_id))
);
REVOKE ALL ON public.news_post_changes FROM anon, authenticated;
GRANT SELECT ON public.news_post_changes TO authenticated;

CREATE OR REPLACE FUNCTION public.prevent_news_post_changes_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  RAISE EXCEPTION 'O histórico das notícias é somente de acréscimo' USING ERRCODE = '55000';
END;
$$;
DROP TRIGGER IF EXISTS news_post_changes_append_only ON public.news_post_changes;
CREATE TRIGGER news_post_changes_append_only BEFORE UPDATE OR DELETE ON public.news_post_changes
FOR EACH ROW EXECUTE FUNCTION public.prevent_news_post_changes_mutation();

-- ------------------------------------------------------------- helpers
CREATE OR REPLACE FUNCTION public._news_slug(p_title text, p_ignore uuid)
RETURNS text
LANGUAGE plpgsql
STABLE
SET search_path = public, pg_temp
AS $$
DECLARE
  v_base text;
  v_slug text;
  v_n integer := 1;
BEGIN
  v_base := lower(translate(btrim(p_title),
    'áàâãäåéèêëíìîïóòôõöúùûüçñÁÀÂÃÄÅÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇÑ', 'aaaaaaeeeeiiiiooooouuuucnaaaaaaeeeeiiiiooooouuuucn'));
  v_base := btrim(regexp_replace(v_base, '[^a-z0-9]+', '-', 'g'), '-');
  v_base := left(v_base, 80);
  v_base := btrim(v_base, '-');
  IF v_base = '' THEN v_base := 'comunicado'; END IF;
  v_slug := v_base;
  WHILE EXISTS (SELECT 1 FROM public.news_posts WHERE slug = v_slug AND id IS DISTINCT FROM p_ignore) LOOP
    v_n := v_n + 1;
    v_slug := v_base || '-' || v_n;
  END LOOP;
  RETURN v_slug;
END;
$$;
REVOKE ALL ON FUNCTION public._news_slug(text, uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public._news_log(p_post uuid, p_action text, p_reason text, p_before jsonb, p_after jsonb)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  INSERT INTO public.news_post_changes (post_id, action, reason, before, after, actor, actor_role)
  VALUES (p_post, p_action, btrim(p_reason), p_before, p_after, auth.uid(), (SELECT role FROM public.profiles WHERE id = auth.uid()));
$$;
REVOKE ALL ON FUNCTION public._news_log(uuid, text, text, jsonb, jsonb) FROM PUBLIC, anon, authenticated;

-- may the caller write (draft) this kind of post for this competition?
CREATE OR REPLACE FUNCTION public._news_can_write(p_kind text, p_competition uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT public.is_fbf_admin()
    OR (p_kind = 'NEWS' AND p_competition IS NOT NULL AND COALESCE(public.can_manage_competition(p_competition), false));
$$;
REVOKE ALL ON FUNCTION public._news_can_write(text, uuid) FROM PUBLIC, anon, authenticated;

-- ------------------------------------------------------------- write
/* p_post: {"kind", "title", "summary"?, "body", "competition_id"?, "pinned"?}; p_id NULL creates a draft. */
CREATE OR REPLACE FUNCTION public.save_news_post(p_id uuid, p_post jsonb, p_reason text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_row public.news_posts%ROWTYPE;
  v_before jsonb;
  v_kind text;
  v_title text;
  v_summary text;
  v_body text;
  v_comp uuid;
  v_pinned boolean;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Entre com sua conta' USING ERRCODE = '42501'; END IF;
  IF length(btrim(COALESCE(p_reason, ''))) < 3 THEN RAISE EXCEPTION 'Informe o motivo da alteração' USING ERRCODE = '22023'; END IF;
  IF p_post IS NULL OR jsonb_typeof(p_post) <> 'object' THEN RAISE EXCEPTION 'Dados inválidos' USING ERRCODE = '22023'; END IF;
  v_kind := p_post->>'kind';
  v_title := btrim(COALESCE(p_post->>'title', ''));
  v_summary := NULLIF(btrim(COALESCE(p_post->>'summary', '')), '');
  v_body := btrim(COALESCE(p_post->>'body', ''));
  v_pinned := COALESCE((p_post->>'pinned')::boolean, false);
  BEGIN
    v_comp := NULLIF(p_post->>'competition_id', '')::uuid;
  EXCEPTION WHEN others THEN RAISE EXCEPTION 'Competição inválida' USING ERRCODE = '22023';
  END;
  IF v_kind NOT IN ('OFFICIAL', 'NEWS') OR v_kind IS NULL THEN RAISE EXCEPTION 'Tipo inválido' USING ERRCODE = '22023'; END IF;
  IF length(v_title) < 5 OR length(v_title) > 140 THEN RAISE EXCEPTION 'O título precisa ter de 5 a 140 caracteres' USING ERRCODE = '22023'; END IF;
  IF length(v_body) < 1 THEN RAISE EXCEPTION 'Escreva o texto' USING ERRCODE = '22023'; END IF;
  IF v_comp IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.competitions WHERE id = v_comp) THEN
    RAISE EXCEPTION 'Competição não encontrada' USING ERRCODE = 'P0002';
  END IF;
  IF NOT public._news_can_write(v_kind, v_comp) THEN
    RAISE EXCEPTION 'Sem permissão: comunicados oficiais são da administração; organizadores escrevem notícias das suas competições' USING ERRCODE = '42501';
  END IF;
  IF v_pinned AND NOT public.is_fbf_admin() THEN
    RAISE EXCEPTION 'Só a administração destaca publicações' USING ERRCODE = '42501';
  END IF;

  IF p_id IS NULL THEN
    INSERT INTO public.news_posts (slug, kind, title, summary, body, competition_id, pinned, created_by, updated_by)
    VALUES (public._news_slug(v_title, NULL), v_kind, v_title, v_summary, v_body, v_comp, v_pinned, auth.uid(), auth.uid())
    RETURNING * INTO v_row;
    PERFORM public._news_log(v_row.id, 'CREATE', p_reason, NULL, to_jsonb(v_row));
    RETURN v_row.id;
  END IF;

  SELECT * INTO v_row FROM public.news_posts WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Publicação não encontrada' USING ERRCODE = 'P0002'; END IF;
  -- the caller must be allowed on the post as it is AND as it will be
  IF NOT public._news_can_write(v_row.kind, v_row.competition_id) THEN
    RAISE EXCEPTION 'Sem permissão para alterar esta publicação' USING ERRCODE = '42501';
  END IF;
  IF v_row.status = 'PUBLISHED' AND NOT public.is_fbf_admin() THEN
    RAISE EXCEPTION 'Uma publicação no ar só é alterada pela administração' USING ERRCODE = '42501';
  END IF;
  IF v_row.pinned IS DISTINCT FROM v_pinned AND NOT public.is_fbf_admin() THEN
    RAISE EXCEPTION 'Só a administração destaca publicações' USING ERRCODE = '42501';
  END IF;
  v_before := to_jsonb(v_row);
  UPDATE public.news_posts
  SET kind = v_kind, title = v_title, summary = v_summary, body = v_body, competition_id = v_comp, pinned = v_pinned,
      -- the address never changes after the first publication
      slug = CASE WHEN first_published_at IS NULL THEN public._news_slug(v_title, p_id) ELSE slug END,
      edited_after_publication_at = CASE WHEN status = 'PUBLISHED' THEN now() ELSE edited_after_publication_at END,
      updated_by = auth.uid(), updated_at = now(), version = version + 1
  WHERE id = p_id RETURNING * INTO v_row;
  PERFORM public._news_log(p_id, 'UPDATE', p_reason, v_before, to_jsonb(v_row));
  RETURN p_id;
END;
$$;
REVOKE ALL ON FUNCTION public.save_news_post(uuid, jsonb, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_news_post(uuid, jsonb, text) TO authenticated;

-- publish / unpublish: administration only
CREATE OR REPLACE FUNCTION public.publish_news_post(p_id uuid, p_publish boolean, p_reason text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_row public.news_posts%ROWTYPE;
  v_before jsonb;
BEGIN
  IF NOT public.is_fbf_admin() THEN RAISE EXCEPTION 'Só a administração publica ou despublica' USING ERRCODE = '42501'; END IF;
  IF length(btrim(COALESCE(p_reason, ''))) < 3 THEN RAISE EXCEPTION 'Informe o motivo da alteração' USING ERRCODE = '22023'; END IF;
  IF p_publish IS NULL THEN RAISE EXCEPTION 'Informe se publica ou despublica' USING ERRCODE = '22023'; END IF;
  SELECT * INTO v_row FROM public.news_posts WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Publicação não encontrada' USING ERRCODE = 'P0002'; END IF;
  IF (v_row.status = 'PUBLISHED') = p_publish THEN RETURN v_row.status; END IF;
  v_before := to_jsonb(v_row);
  UPDATE public.news_posts
  SET status = CASE WHEN p_publish THEN 'PUBLISHED' ELSE 'DRAFT' END,
      first_published_at = COALESCE(first_published_at, CASE WHEN p_publish THEN now() END),
      published_at = CASE WHEN p_publish THEN COALESCE(published_at, now()) ELSE published_at END,
      published_by = CASE WHEN p_publish THEN auth.uid() ELSE published_by END,
      updated_by = auth.uid(), updated_at = now()
  WHERE id = p_id RETURNING * INTO v_row;
  PERFORM public._news_log(p_id, CASE WHEN p_publish THEN 'PUBLISH' ELSE 'UNPUBLISH' END, p_reason, v_before, to_jsonb(v_row));
  RETURN v_row.status;
END;
$$;
REVOKE ALL ON FUNCTION public.publish_news_post(uuid, boolean, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.publish_news_post(uuid, boolean, text) TO authenticated;

-- delete: only a draft never published (a published one is unpublished instead)
CREATE OR REPLACE FUNCTION public.delete_news_post(p_id uuid, p_reason text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_row public.news_posts%ROWTYPE;
BEGIN
  IF length(btrim(COALESCE(p_reason, ''))) < 3 THEN RAISE EXCEPTION 'Informe o motivo da alteração' USING ERRCODE = '22023'; END IF;
  SELECT * INTO v_row FROM public.news_posts WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Publicação não encontrada' USING ERRCODE = 'P0002'; END IF;
  IF NOT public._news_can_write(v_row.kind, v_row.competition_id) THEN
    RAISE EXCEPTION 'Sem permissão para excluir esta publicação' USING ERRCODE = '42501';
  END IF;
  IF v_row.first_published_at IS NOT NULL THEN
    RAISE EXCEPTION 'Uma publicação que já foi ao ar não é excluída; despublique-a' USING ERRCODE = '55000';
  END IF;
  DELETE FROM public.news_posts WHERE id = p_id;
  PERFORM public._news_log(p_id, 'DELETE', p_reason, to_jsonb(v_row), NULL);
  RETURN true;
END;
$$;
REVOKE ALL ON FUNCTION public.delete_news_post(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delete_news_post(uuid, text) TO authenticated;
