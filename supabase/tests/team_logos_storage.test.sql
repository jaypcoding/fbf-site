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

SELECT is((SELECT public FROM storage.buckets WHERE id = 'team-logos'), true, 'the team-logos bucket exists and is public');
SELECT is((SELECT file_size_limit FROM storage.buckets WHERE id = 'team-logos'), 2097152::bigint, 'files up to 2 MB');
SELECT is((SELECT allowed_mime_types FROM storage.buckets WHERE id = 'team-logos'), ARRAY['image/png', 'image/webp', 'image/jpeg'], 'PNG, WebP or JPEG only (no SVG)');
SELECT is((SELECT count(*) FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname LIKE 'team_logos_admin_%'), 3::bigint,
  'insert, update and delete policies exist');
SELECT is((SELECT count(*) FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname LIKE 'team_logos_%' AND 'anon' = ANY (roles)), 0::bigint,
  'no policy for visitors without login');

SET LOCAL ROLE anon;
SELECT throws_ok($$ INSERT INTO storage.objects (bucket_id, name) VALUES ('team-logos', 'anon.png') $$, '42501', NULL, 'visitors cannot upload logos');
RESET ROLE;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '1f000000-0000-0000-0000-000000000002', true);
SELECT set_config('request.jwt.claims', '{"sub":"1f000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
SELECT throws_ok($$ INSERT INTO storage.objects (bucket_id, name) VALUES ('team-logos', 'user.png') $$, '42501', NULL, 'a common user cannot upload logos');
SELECT set_config('request.jwt.claim.sub', '1f000000-0000-0000-0000-000000000001', true);
SELECT set_config('request.jwt.claims', '{"sub":"1f000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
SELECT lives_ok($$ INSERT INTO storage.objects (bucket_id, name) VALUES ('team-logos', 'admin-test.png') $$, 'an admin can add a logo');
SELECT throws_ok($$ INSERT INTO storage.objects (bucket_id, name) VALUES ('fbf-backups-x', 'admin-test.png') $$, '42501', NULL,
  'the admin policy only covers the team-logos bucket');
RESET ROLE;

SELECT * FROM finish();
ROLLBACK;
