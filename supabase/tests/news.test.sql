BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = public, extensions;

-- Notícias e comunicados oficiais (migration 20261124140000_news.sql).

INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at) VALUES
  ('1c000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'news-admin@example.invalid', '', now()),
  ('1c000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'news-org@example.invalid', '', now()),
  ('1c000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'news-user@example.invalid', '', now())
ON CONFLICT (id) DO NOTHING;
UPDATE public.profiles SET role = 'ADMIN' WHERE id = '1c000000-0000-0000-0000-000000000001';
UPDATE public.profiles SET role = 'ORGANIZER' WHERE id = '1c000000-0000-0000-0000-000000000002';
INSERT INTO public.competitions (id, name, category, format, status) VALUES
  ('2c000000-0000-0000-0000-000000000001', 'News Copa', 'Test', 'Pontos corridos', 'DRAFT'),
  ('2c000000-0000-0000-0000-000000000002', 'News Outra', 'Test', 'Pontos corridos', 'DRAFT');
INSERT INTO public.competition_organizers (competition_id, user_id) VALUES ('2c000000-0000-0000-0000-000000000001', '1c000000-0000-0000-0000-000000000002');

CREATE FUNCTION pg_temp.as_user(uid text) RETURNS void LANGUAGE sql AS $$ SELECT set_config('request.jwt.claim.sub', uid, true) $$;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA pg_temp TO anon, authenticated;

SELECT plan(26);

SET LOCAL ROLE anon;
SELECT throws_ok($$SELECT public.save_news_post(NULL, '{"kind":"NEWS","title":"Título qualquer","body":"x"}', 'teste')$$, '42501', NULL, 'visitors cannot write');
RESET ROLE;

SET LOCAL ROLE authenticated;
-- a common user
DO $$ BEGIN PERFORM pg_temp.as_user('1c000000-0000-0000-0000-000000000003'); END $$;
SELECT throws_ok($$SELECT public.save_news_post(NULL, '{"kind":"NEWS","title":"Notícia de usuário","body":"x","competition_id":"2c000000-0000-0000-0000-000000000001"}', 'teste')$$,
  '42501', NULL, 'a common user cannot write news');

-- organizer: drafts of NEWS of his competitions only
DO $$ BEGIN PERFORM pg_temp.as_user('1c000000-0000-0000-0000-000000000002'); END $$;
SELECT throws_ok($$SELECT public.save_news_post(NULL, '{"kind":"OFFICIAL","title":"Comunicado do organizador","body":"x"}', 'teste')$$,
  '42501', NULL, 'an organizer cannot write official communiqués');
SELECT throws_ok($$SELECT public.save_news_post(NULL, '{"kind":"NEWS","title":"Notícia de outra competição","body":"x","competition_id":"2c000000-0000-0000-0000-000000000002"}', 'teste')$$,
  '42501', NULL, 'an organizer cannot write news of a competition he does not organize');
SELECT throws_ok($$SELECT public.save_news_post(NULL, '{"kind":"NEWS","title":"Notícia sem competição","body":"x"}', 'teste')$$,
  '42501', NULL, 'an organizer writes news linked to his competition');
SELECT lives_ok($$SELECT set_config('news.org', public.save_news_post(NULL, '{"kind":"NEWS","title":"Rodada 3 confirmada","summary":"Datas","body":"Primeiro parágrafo.\n\nSegundo parágrafo.","competition_id":"2c000000-0000-0000-0000-000000000001"}', 'rascunho')::text, true)$$,
  'an organizer writes a draft of his competition');
SELECT is((SELECT slug FROM public.news_posts WHERE id = current_setting('news.org')::uuid), 'rodada-3-confirmada', 'the address comes from the title');
SELECT throws_ok(format($$SELECT public.publish_news_post(%L, true, 'publicar')$$, current_setting('news.org')), '42501', NULL, 'an organizer does not publish');
SELECT throws_ok(format($$SELECT public.save_news_post(%L, '{"kind":"NEWS","title":"Rodada 3 confirmada","body":"x","competition_id":"2c000000-0000-0000-0000-000000000001","pinned":true}', 'destacar')$$, current_setting('news.org')),
  '42501', NULL, 'an organizer does not pin posts');
SELECT throws_ok($$SELECT public.save_news_post(NULL, '{"kind":"NEWS","title":"abc","body":"x","competition_id":"2c000000-0000-0000-0000-000000000001"}', 'curto')$$,
  '22023', NULL, 'the title has a minimum size');
SELECT throws_ok($$SELECT public.save_news_post(NULL, '{"kind":"NEWS","title":"Sem motivo aqui","body":"x","competition_id":"2c000000-0000-0000-0000-000000000001"}', '')$$,
  '22023', NULL, 'a reason is required');
RESET ROLE;

-- visitors do not see drafts
SET LOCAL ROLE anon;
SELECT is((SELECT count(*)::integer FROM public.news_posts WHERE id = current_setting('news.org')::uuid), 0, 'visitors do not see drafts');
RESET ROLE;

-- admin reviews and publishes; edits a published post with history
SET LOCAL ROLE authenticated;
DO $$ BEGIN PERFORM pg_temp.as_user('1c000000-0000-0000-0000-000000000001'); END $$;
SELECT lives_ok($$SELECT set_config('news.off', public.save_news_post(NULL, '{"kind":"OFFICIAL","title":"Comunicado oficial: regulamento","body":"Texto do regulamento.","pinned":true}', 'comunicado')::text, true)$$,
  'the admin writes an official communiqué');
SELECT is(public.publish_news_post(current_setting('news.org')::uuid, true, 'revisado pela administração'), 'PUBLISHED', 'the admin publishes the organizer draft');
SELECT is(public.publish_news_post(current_setting('news.off')::uuid, true, 'aprovado'), 'PUBLISHED', 'the admin publishes the communiqué');
SELECT lives_ok(format($$SELECT public.save_news_post(%L, '{"kind":"NEWS","title":"Rodada 3 confirmada para sábado","body":"Primeiro parágrafo corrigido.","competition_id":"2c000000-0000-0000-0000-000000000001"}', 'correção de data')$$, current_setting('news.org')),
  'the admin corrects a published post');
SELECT is((SELECT slug || '|' || version || '|' || (edited_after_publication_at IS NOT NULL) FROM public.news_posts WHERE id = current_setting('news.org')::uuid),
  'rodada-3-confirmada|2|true', 'the address stays after publication; the edit is marked');
SELECT throws_ok(format($$SELECT public.delete_news_post(%L, 'apagar')$$, current_setting('news.org')), '55000', NULL, 'a post that was published is never deleted');
SELECT is(public.publish_news_post(current_setting('news.org')::uuid, false, 'retirar do ar'), 'DRAFT', 'the admin unpublishes');
RESET ROLE;

-- the organizer cannot change a published post; can delete a draft never published
SET LOCAL ROLE authenticated;
DO $$ BEGIN PERFORM pg_temp.as_user('1c000000-0000-0000-0000-000000000002'); END $$;
SELECT throws_ok(format($$SELECT public.save_news_post(%L, '{"kind":"OFFICIAL","title":"Comunicado alterado","body":"x"}', 'mudar')$$, current_setting('news.off')),
  '42501', NULL, 'an organizer cannot change the official communiqué');
SELECT is((SELECT count(*)::integer FROM public.news_posts WHERE id = current_setting('news.off')::uuid), 1, '... although he can read it once published');
SELECT lives_ok($$SELECT public.delete_news_post(public.save_news_post(NULL, '{"kind":"NEWS","title":"Rascunho descartado","body":"x","competition_id":"2c000000-0000-0000-0000-000000000001"}', 'teste'), 'escrito por engano')$$,
  'a draft never published can be deleted');
RESET ROLE;

SET LOCAL ROLE anon;
SELECT is((SELECT string_agg(kind, ',') FROM public.news_posts WHERE id IN (current_setting('news.org')::uuid, current_setting('news.off')::uuid)), 'OFFICIAL', 'visitors see only what is published');
SELECT throws_ok($$SELECT count(*) FROM public.news_post_changes$$, '42501', NULL, 'visitors do not read the history');
RESET ROLE;

SELECT is((SELECT string_agg(action, ',' ORDER BY id) FROM public.news_post_changes WHERE post_id = current_setting('news.org')::uuid),
  'CREATE,PUBLISH,UPDATE,UNPUBLISH', 'every change is in the history');
SELECT throws_ok($$DELETE FROM public.news_post_changes$$, '55000', NULL, 'the history is append-only');

SELECT * FROM finish();
ROLLBACK;
