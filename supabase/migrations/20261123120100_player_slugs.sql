/*
# Stable public address of each player (Phase 1 of the expansion)

Adds `players.slug`, used by the public profile URL (/jogadores/<slug>).
- Generated from the nickname when the player is created; repeated nicknames
  get a numeric suffix (night, night-2...). No player is merged or changed.
- Never changes afterwards (also when the nickname changes), so links shared
  on Discord/WhatsApp keep working. /jogadores/<id> keeps working too.
- Existing players are filled in creation order (deterministic).
Additive: one new column + unique index + trigger; no other data is touched.
*/

ALTER TABLE public.players ADD COLUMN IF NOT EXISTS slug text;

CREATE OR REPLACE FUNCTION public.player_slug_base(p_nickname text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT COALESCE(NULLIF(left(btrim(regexp_replace(lower(translate(COALESCE(p_nickname, ''),
    'áàâãäåéèêëíìîïóòôõöúùûüçñýÿÁÀÂÃÄÅÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇÑÝ',
    'aaaaaaeeeeiiiiooooouuuucnyyAAAAAAEEEEIIIIOOOOOUUUUCNY')), '[^a-z0-9]+', '-', 'g'), '-'), 40), ''), 'jogador');
$$;

CREATE OR REPLACE FUNCTION public.next_player_slug(p_nickname text, p_player_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_base text := public.player_slug_base(p_nickname);
  v_slug text := v_base;
  v_n integer := 1;
BEGIN
  -- a slug can never look like an id (ids keep working in the same route)
  IF v_slug ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN v_base := 'jogador-' || left(v_base, 8); v_slug := v_base; END IF;
  WHILE EXISTS (SELECT 1 FROM public.players WHERE slug = v_slug AND id IS DISTINCT FROM p_player_id) LOOP
    v_n := v_n + 1;
    v_slug := v_base || '-' || v_n;
  END LOOP;
  RETURN v_slug;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.next_player_slug(text, uuid) FROM PUBLIC, anon, authenticated;

-- fill existing players in creation order (first registered keeps the plain slug)
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT id, nickname FROM public.players WHERE slug IS NULL ORDER BY created_at, id LOOP
    UPDATE public.players SET slug = public.next_player_slug(r.nickname, r.id) WHERE id = r.id;
  END LOOP;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS players_slug_key ON public.players(slug);
ALTER TABLE public.players ALTER COLUMN slug SET NOT NULL;

CREATE OR REPLACE FUNCTION public.set_player_slug()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.slug := public.next_player_slug(NEW.nickname, NEW.id);
  ELSE
    NEW.slug := OLD.slug; -- permanent address
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS players_set_slug ON public.players;
CREATE TRIGGER players_set_slug
BEFORE INSERT OR UPDATE ON public.players
FOR EACH ROW EXECUTE FUNCTION public.set_player_slug();
