/*
# Sync profiles with sign-ups and add admin role management

1. New Behavior
- Every new account automatically gets a row in `profiles` with its display name, so admins can see and manage users.
- Existing accounts are backfilled into `profiles` once.
- New function `set_user_role` lets an ADMIN promote a user to USER, ORGANIZER or ADMIN.

2. Security
- The sync function is not callable by app users.
- `set_user_role` checks that the caller is an ADMIN, blocks invalid roles, and prevents an admin from removing their own admin role.
- Role changes still cannot be made through normal profile updates.

3. Important notes
- Only the `profiles.role` column is changed by `set_user_role`; no data is deleted.
*/

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, display_name)
  VALUES (NEW.id, NULLIF(NEW.raw_user_meta_data->>'display_name', ''))
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
AFTER INSERT ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

INSERT INTO public.profiles (id, display_name)
SELECT id, NULLIF(raw_user_meta_data->>'display_name', '')
FROM auth.users
ON CONFLICT (id) DO NOTHING;

CREATE OR REPLACE FUNCTION public.set_user_role(target_user uuid, new_role text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_fbf_admin() THEN
    RAISE EXCEPTION 'Apenas administradores podem alterar papéis' USING ERRCODE = '42501';
  END IF;
  IF new_role NOT IN ('USER', 'ORGANIZER', 'ADMIN') THEN
    RAISE EXCEPTION 'Papel inválido';
  END IF;
  IF target_user = auth.uid() AND new_role <> 'ADMIN' THEN
    RAISE EXCEPTION 'Você não pode remover seu próprio acesso de administrador';
  END IF;
  UPDATE public.profiles SET role = new_role, updated_at = now() WHERE id = target_user;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.set_user_role(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_user_role(uuid, text) TO authenticated;

DROP POLICY IF EXISTS "competition_organizers_manager_insert" ON public.competition_organizers;
CREATE POLICY "competition_organizers_admin_insert" ON public.competition_organizers FOR INSERT TO authenticated WITH CHECK (public.is_fbf_admin());
