BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = public, extensions;

-- Status "Ao vivo" of a streamer (migration 20261126100000_streamer_live_status.sql).

INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at) VALUES
  ('1a000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'live-admin@example.invalid', '', now()),
  ('1a000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'live-org@example.invalid', '', now())
ON CONFLICT (id) DO NOTHING;
UPDATE public.profiles SET role = 'ADMIN' WHERE id = '1a000000-0000-0000-0000-000000000001';
UPDATE public.profiles SET role = 'ORGANIZER' WHERE id = '1a000000-0000-0000-0000-000000000002';
INSERT INTO public.streamers (id, display_name, platform, channel) VALUES ('5a000000-0000-0000-0000-000000000001', 'Live Teste', 'TWITCH', 'liveteste');

CREATE FUNCTION pg_temp.as_user(uid text) RETURNS void LANGUAGE sql AS $$ SELECT set_config('request.jwt.claim.sub', uid, true) $$;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA pg_temp TO anon, authenticated;

SELECT plan(9);

SELECT is((SELECT is_live FROM public.streamers WHERE id = '5a000000-0000-0000-0000-000000000001'), false, 'a streamer starts off the air');

SET LOCAL ROLE anon;
UPDATE public.streamers SET is_live = true WHERE id = '5a000000-0000-0000-0000-000000000001';
SELECT is((SELECT count(*)::integer FROM public.streamers WHERE id = '5a000000-0000-0000-0000-000000000001' AND is_live), 0, 'a visitor cannot put a streamer on the air');
SELECT is((SELECT count(*)::integer FROM public.streamers WHERE id = '5a000000-0000-0000-0000-000000000001'), 1, 'visitors read the streamers (public transmissions)');
RESET ROLE;

SET LOCAL ROLE authenticated;
DO $$ BEGIN PERFORM pg_temp.as_user('1a000000-0000-0000-0000-000000000002'); END $$;
UPDATE public.streamers SET is_live = true WHERE id = '5a000000-0000-0000-0000-000000000001';
RESET ROLE;
SELECT is((SELECT is_live FROM public.streamers WHERE id = '5a000000-0000-0000-0000-000000000001'), false, 'an organizer cannot either (admins manage streamers)');

SET LOCAL ROLE authenticated;
DO $$ BEGIN PERFORM pg_temp.as_user('1a000000-0000-0000-0000-000000000001'); END $$;
UPDATE public.streamers SET is_live = true, live_since = '2000-01-01' WHERE id = '5a000000-0000-0000-0000-000000000001';
SELECT is((SELECT is_live FROM public.streamers WHERE id = '5a000000-0000-0000-0000-000000000001'), true, 'an admin puts the streamer on the air');
SELECT ok((SELECT live_since > now() - interval '1 minute' FROM public.streamers WHERE id = '5a000000-0000-0000-0000-000000000001'), 'the start time is set by the database (a value sent is ignored)');
UPDATE public.streamers SET display_name = 'Live Teste 2' WHERE id = '5a000000-0000-0000-0000-000000000001';
SELECT ok((SELECT live_since > now() - interval '1 minute' AND is_live FROM public.streamers WHERE id = '5a000000-0000-0000-0000-000000000001'), 'editing the name keeps it on the air with the same start');
UPDATE public.streamers SET is_live = false WHERE id = '5a000000-0000-0000-0000-000000000001';
SELECT is((SELECT live_since FROM public.streamers WHERE id = '5a000000-0000-0000-0000-000000000001'), NULL::timestamptz, 'taking it off the air clears the start time');
RESET ROLE;
SELECT is((SELECT count(*)::integer FROM public.match_streamers WHERE streamer_id = '5a000000-0000-0000-0000-000000000001'), 0, 'no match link is needed or created');

SELECT * FROM finish();
ROLLBACK;
