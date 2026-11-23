BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = public, extensions;

SELECT plan(5);

SELECT lives_ok(
  $$INSERT INTO public.streamers (display_name, platform, channel) VALUES ('Narrador Twitch', 'TWITCH', 'fbf_twitch')$$,
  'Twitch streamers are still accepted'
);
SELECT lives_ok(
  $$INSERT INTO public.streamers (display_name, platform, channel) VALUES ('Narrador YouTube', 'YOUTUBE', 'UCaaaaaaaaaaaaaaaaaaaaaa')$$,
  'YouTube streamers are still accepted'
);
SELECT lives_ok(
  $$INSERT INTO public.streamers (display_name, platform, channel) VALUES ('Narrador Kick', 'KICK', 'fbf-kick')$$,
  'Kick streamers are accepted'
);
SELECT throws_ok(
  $$INSERT INTO public.streamers (display_name, platform, channel) VALUES ('Outro', 'FACEBOOK', 'x')$$,
  '23514', NULL,
  'unknown platforms are still refused'
);

-- visitors keep reading streamers (live player) and still cannot write
SET LOCAL ROLE anon;
SELECT throws_ok(
  $$INSERT INTO public.streamers (display_name, platform, channel) VALUES ('Anon', 'KICK', 'anon')$$,
  '42501', NULL,
  'visitors cannot create streamers'
);
RESET ROLE;

SELECT * FROM finish();
ROLLBACK;
