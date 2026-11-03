/*
# Add streamers and match commentary links

1. New Tables
- `streamers`: people who narrate matches. Each has a display name, a platform (TWITCH or YOUTUBE) and the channel identifier (Twitch login or YouTube channel ID).
- `match_streamers`: links a streamer to a match they will narrate.

2. Security
- Everyone (including visitors) can read streamers and their match links, so the live player works on every page.
- Only administrators and organizers can create, edit or remove streamers and links.
- Row level security is enabled on both tables with separate policies per operation.

3. Important notes
- Live player visibility is derived from matches with status LIVE; nothing is stored separately.
*/

CREATE TABLE IF NOT EXISTS public.streamers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  display_name text NOT NULL,
  platform text NOT NULL CHECK (platform IN ('TWITCH', 'YOUTUBE')),
  channel text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.match_streamers (
  match_id uuid NOT NULL REFERENCES public.matches(id) ON DELETE CASCADE,
  streamer_id uuid NOT NULL REFERENCES public.streamers(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (match_id, streamer_id)
);

CREATE INDEX IF NOT EXISTS match_streamers_streamer_id_idx ON public.match_streamers(streamer_id);

ALTER TABLE public.streamers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.match_streamers ENABLE ROW LEVEL SECURITY;

GRANT SELECT ON public.streamers TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON public.streamers TO authenticated;
GRANT SELECT ON public.match_streamers TO anon, authenticated;
GRANT INSERT, DELETE ON public.match_streamers TO authenticated;

DROP POLICY IF EXISTS "streamers_public_select" ON public.streamers;
CREATE POLICY "streamers_public_select" ON public.streamers FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "streamers_manager_insert" ON public.streamers;
CREATE POLICY "streamers_manager_insert" ON public.streamers FOR INSERT TO authenticated WITH CHECK (public.is_fbf_manager());
DROP POLICY IF EXISTS "streamers_manager_update" ON public.streamers;
CREATE POLICY "streamers_manager_update" ON public.streamers FOR UPDATE TO authenticated USING (public.is_fbf_manager()) WITH CHECK (public.is_fbf_manager());
DROP POLICY IF EXISTS "streamers_manager_delete" ON public.streamers;
CREATE POLICY "streamers_manager_delete" ON public.streamers FOR DELETE TO authenticated USING (public.is_fbf_manager());

DROP POLICY IF EXISTS "match_streamers_public_select" ON public.match_streamers;
CREATE POLICY "match_streamers_public_select" ON public.match_streamers FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "match_streamers_manager_insert" ON public.match_streamers;
CREATE POLICY "match_streamers_manager_insert" ON public.match_streamers FOR INSERT TO authenticated WITH CHECK (public.is_fbf_manager());
DROP POLICY IF EXISTS "match_streamers_manager_delete" ON public.match_streamers;
CREATE POLICY "match_streamers_manager_delete" ON public.match_streamers FOR DELETE TO authenticated USING (public.is_fbf_manager());
