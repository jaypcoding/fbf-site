-- Team logos hosted in Supabase Storage.
--
-- Until now teams.logo_url pointed to Discord attachment links, which expire
-- after about 24 hours (10 of the 24 logos stopped loading). The logos move to
-- a public bucket of this project:
--   * anyone can read (public bucket: the site shows the images to visitors);
--   * only FBF admins can add, replace or remove files;
--   * PNG, WebP or JPEG only (no SVG), up to 2 MB.
-- teams.logo_url itself is not changed here.

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('team-logos', 'team-logos', true, 2097152, ARRAY['image/png', 'image/webp', 'image/jpeg'])
ON CONFLICT (id) DO UPDATE
SET public = EXCLUDED.public,
    file_size_limit = EXCLUDED.file_size_limit,
    allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS team_logos_admin_insert ON storage.objects;
DROP POLICY IF EXISTS team_logos_admin_update ON storage.objects;
DROP POLICY IF EXISTS team_logos_admin_delete ON storage.objects;

CREATE POLICY team_logos_admin_insert ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'team-logos' AND public.is_fbf_admin());
CREATE POLICY team_logos_admin_update ON storage.objects
  FOR UPDATE TO authenticated
  USING (bucket_id = 'team-logos' AND public.is_fbf_admin())
  WITH CHECK (bucket_id = 'team-logos' AND public.is_fbf_admin());
CREATE POLICY team_logos_admin_delete ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'team-logos' AND public.is_fbf_admin());
