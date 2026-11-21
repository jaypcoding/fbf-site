BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = public, extensions;

SELECT plan(9);

INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at)
VALUES
  ('1f000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'logo-admin@example.invalid', '', now()),
  ('1f000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'logo-user@example.invalid', '', now())
ON CONFLICT (id) DO NOTHING;
UPDATE public.profiles SET role = 'ADMIN' WHERE id = '1f000000-0000-0000-0000-000000000001';

-- The checks live in a function so that environments without the storage
-- schema (the CI local stack applies migrations before Storage starts) skip
-- them instead of failing to parse; hosted projects (staging) run all nine.
CREATE FUNCTION pg_temp.team_logos_checks() RETURNS SETOF text LANGUAGE plpgsql AS $$
DECLARE
  v_try text;
BEGIN
  IF to_regclass('storage.buckets') IS NULL THEN
    RETURN NEXT skip('storage schema not available in this environment', 9);
    RETURN;
  END IF;

  RETURN NEXT is((SELECT public FROM storage.buckets WHERE id = 'team-logos'), true, 'the team-logos bucket exists and is public');
  RETURN NEXT is((SELECT file_size_limit FROM storage.buckets WHERE id = 'team-logos'), 2097152::bigint, 'files up to 2 MB');
  RETURN NEXT is((SELECT allowed_mime_types FROM storage.buckets WHERE id = 'team-logos'), ARRAY['image/png', 'image/webp', 'image/jpeg'], 'PNG, WebP or JPEG only (no SVG)');
  RETURN NEXT is((SELECT count(*) FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname LIKE 'team_logos_admin_%'), 3::bigint,
    'insert, update and delete policies exist');
  RETURN NEXT is((SELECT count(*) FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname LIKE 'team_logos_%' AND 'anon' = ANY (roles)), 0::bigint,
    'no policy for visitors without login');

  SET LOCAL ROLE anon;
  RETURN NEXT throws_ok($q$ INSERT INTO storage.objects (bucket_id, name) VALUES ('team-logos', 'anon.png') $q$, '42501', NULL, 'visitors cannot upload logos');
  RESET ROLE;

  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claim.sub', '1f000000-0000-0000-0000-000000000002', true);
  PERFORM set_config('request.jwt.claims', '{"sub":"1f000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
  RETURN NEXT throws_ok($q$ INSERT INTO storage.objects (bucket_id, name) VALUES ('team-logos', 'user.png') $q$, '42501', NULL, 'a common user cannot upload logos');
  PERFORM set_config('request.jwt.claim.sub', '1f000000-0000-0000-0000-000000000001', true);
  PERFORM set_config('request.jwt.claims', '{"sub":"1f000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
  RETURN NEXT lives_ok($q$ INSERT INTO storage.objects (bucket_id, name) VALUES ('team-logos', 'admin-test.png') $q$, 'an admin can add a logo');
  RETURN NEXT throws_ok($q$ INSERT INTO storage.objects (bucket_id, name) VALUES ('fbf-backups-x', 'admin-test.png') $q$, '42501', NULL,
    'the admin policy only covers the team-logos bucket');
  RESET ROLE;
END;
$$;

SELECT * FROM pg_temp.team_logos_checks();

SELECT * FROM finish();
ROLLBACK;
