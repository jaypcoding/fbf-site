// "Notícias" in the panel. Admins write, edit, publish, unpublish and delete
// drafts of any post. Organizers write and edit DRAFTS of news of the
// competitions they organize; an admin reviews and publishes. Every action
// needs a reason and goes to the history (shown below the editor). The
// database checks all of it again (save/publish/delete_news_post).
import { useEffect, useState } from 'react';
import { CheckCircle2, History, Megaphone, Newspaper, Plus } from 'lucide-react';
import { supabase, type Profile } from '@/lib/supabase';
import { useManagedCompetitions } from '@/lib/hooks';
import { refreshAdminData } from '@/lib/adminRefresh';
import { NEWS_KIND_LABEL, type NewsKind, type NewsPost } from '@/lib/news';
import { FormError, FormField, FormInput, FormSelect } from '@/components/ui';

type Change = { id: number; action: string; reason: string; changed_at: string; actor_role: string | null };
const EMPTY = { kind: 'NEWS' as NewsKind, title: '', summary: '', body: '', competition_id: '', pinned: false };
const ACTION_LABEL: Record<string, string> = { CREATE: 'Criada', UPDATE: 'Editada', PUBLISH: 'Publicada', UNPUBLISH: 'Despublicada', DELETE: 'Excluída' };

export function NewsTab({ profile }: { profile: Profile | null }) {
  const isAdmin = profile?.role === 'ADMIN';
  const { competitions } = useManagedCompetitions();
  const [posts, setPosts] = useState<NewsPost[]>([]);
  const [selected, setSelected] = useState<string>('');
  const [form, setForm] = useState(EMPTY);
  const [reason, setReason] = useState('');
  const [history, setHistory] = useState<Change[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function loadPosts() {
    const { data } = await supabase.from('news_posts').select('id, slug, kind, title, summary, body, competition_id, pinned, status, first_published_at, published_at, edited_after_publication_at, updated_at, version').order('updated_at', { ascending: false });
    setPosts((data ?? []) as NewsPost[]);
  }
  useEffect(() => { void loadPosts(); }, []);
  const post = posts.find((p) => p.id === selected) ?? null;
  useEffect(() => {
    setForm(post ? { kind: post.kind, title: post.title, summary: post.summary ?? '', body: post.body, competition_id: post.competition_id ?? '', pinned: post.pinned } : { ...EMPTY, kind: isAdmin ? 'OFFICIAL' : 'NEWS' });
    setHistory([]);
    if (post) void supabase.from('news_post_changes').select('id, action, reason, changed_at, actor_role').eq('post_id', post.id).order('id', { ascending: false }).then(({ data }) => setHistory((data ?? []) as Change[]));
  }, [selected, posts]); // eslint-disable-line react-hooks/exhaustive-deps

  const locked = post?.status === 'PUBLISHED' && !isAdmin;
  async function run(action: () => PromiseLike<{ data: unknown; error: { message: string } | null }>, ok: string, after?: (data: unknown) => void) {
    if (reason.trim().length < 3) { setError('Informe o motivo (vale para a próxima ação).'); return; }
    setBusy(true); setError(null); setDone(null);
    const { data, error: err } = await action();
    setBusy(false);
    if (err) { setError(err.message); return; }
    setDone(ok);
    after?.(data);
    await loadPosts();
    refreshAdminData();
  }
  const payload = { ...form, competition_id: form.competition_id || null, summary: form.summary.trim() || null };

  return (
    <div className="news-admin">
      <p className="admin-hint">
        {isAdmin
          ? 'Comunicados oficiais e notícias. Só a administração publica e despublica. Uma publicação que já foi ao ar não é excluída: é despublicada, e toda alteração fica no histórico.'
          : 'Você pode escrever e editar rascunhos de notícias das competições que organiza. A administração revisa e publica.'}
      </p>
      <div className="news-admin-layout">
        <aside className="news-admin-list">
          <button type="button" className="button button-outline button-small" onClick={() => setSelected('')}><Plus size={14} aria-hidden="true" /> Nova publicação</button>
          {posts.length === 0 ? <p className="admin-empty-text">Nenhuma publicação.</p> : (
            <ul>
              {posts.map((p) => (
                <li key={p.id}>
                  <button type="button" aria-pressed={p.id === selected} onClick={() => setSelected(p.id)}>
                    {p.kind === 'OFFICIAL' ? <Megaphone size={13} aria-hidden="true" /> : <Newspaper size={13} aria-hidden="true" />}
                    <span>{p.title}</span>
                    <small className={`hof-status is-${p.status === 'PUBLISHED' ? 'published' : 'draft'}`}>{p.status === 'PUBLISHED' ? 'No ar' : p.first_published_at ? 'Despublicada' : 'Rascunho'}</small>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </aside>
        <section className="news-admin-editor">
          <h3>{post ? 'Editar publicação' : 'Nova publicação'}</h3>
          {locked && <p className="lineup-source is-missing">Esta publicação está no ar; só a administração pode alterá-la.</p>}
          <div className="news-admin-fields">
            <FormField label="Tipo">
              <FormSelect value={form.kind} disabled={locked || !isAdmin} onChange={(e) => setForm((f) => ({ ...f, kind: e.target.value as NewsKind }))}>
                {isAdmin && <option value="OFFICIAL">{NEWS_KIND_LABEL.OFFICIAL}</option>}
                <option value="NEWS">{NEWS_KIND_LABEL.NEWS}</option>
              </FormSelect>
            </FormField>
            <FormField label={isAdmin ? 'Competição (opcional)' : 'Competição'}>
              <FormSelect value={form.competition_id} disabled={locked} onChange={(e) => setForm((f) => ({ ...f, competition_id: e.target.value }))}>
                <option value="">{isAdmin ? 'Nenhuma (FBF)' : 'Escolha'}</option>
                {competitions.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </FormSelect>
            </FormField>
            <FormField label="Título"><FormInput value={form.title} disabled={locked} maxLength={140} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} /></FormField>
            <FormField label="Resumo (opcional)"><FormInput value={form.summary} disabled={locked} maxLength={300} onChange={(e) => setForm((f) => ({ ...f, summary: e.target.value }))} /></FormField>
          </div>
          <label className="news-admin-body">
            <span>Texto (linha em branco separa parágrafos)</span>
            <textarea className="form-input" rows={12} value={form.body} disabled={locked} maxLength={20000} onChange={(e) => setForm((f) => ({ ...f, body: e.target.value }))} />
          </label>
          {isAdmin && <label className="news-admin-pin"><input type="checkbox" checked={form.pinned} onChange={(e) => setForm((f) => ({ ...f, pinned: e.target.checked }))} /> Destacar no topo</label>}
          <FormField label="Motivo da alteração"><FormInput value={reason} maxLength={300} placeholder="Ex.: correção da data da rodada" onChange={(e) => setReason(e.target.value)} /></FormField>
          <FormError message={error} />
          {done && <p className="lineup-saved"><CheckCircle2 size={14} aria-hidden="true" /> {done} Registrado no histórico.</p>}
          <div className="hof-admin-actions">
            {!locked && (
              <button type="button" className="button button-primary button-small" disabled={busy || form.title.trim().length < 5 || !form.body.trim() || (!isAdmin && !form.competition_id)}
                onClick={() => void run(() => supabase.rpc('save_news_post', { p_id: post?.id ?? null, p_post: payload, p_reason: reason.trim() }), post ? (post.status === 'PUBLISHED' ? 'Alteração publicada.' : 'Rascunho salvo.') : 'Rascunho criado.', (id) => { if (!post && typeof id === 'string') setSelected(id); })}>
                {post ? (post.status === 'PUBLISHED' ? 'Salvar alteração (no ar)' : 'Salvar rascunho') : 'Criar rascunho'}
              </button>
            )}
            {isAdmin && post && post.status !== 'PUBLISHED' && <button type="button" className="button button-primary button-small" disabled={busy} onClick={() => void run(() => supabase.rpc('publish_news_post', { p_id: post.id, p_publish: true, p_reason: reason.trim() }), 'Publicada.')}>Publicar</button>}
            {isAdmin && post?.status === 'PUBLISHED' && <button type="button" className="button button-outline button-small" disabled={busy} onClick={() => void run(() => supabase.rpc('publish_news_post', { p_id: post.id, p_publish: false, p_reason: reason.trim() }), 'Despublicada.')}>Despublicar</button>}
            {post && !post.first_published_at && !locked && <button type="button" className="button button-outline button-small" disabled={busy} onClick={() => void run(() => supabase.rpc('delete_news_post', { p_id: post.id, p_reason: reason.trim() }), 'Rascunho excluído.', () => setSelected(''))}>Excluir rascunho</button>}
            {post?.status === 'PUBLISHED' && <a className="inline-link" href={`/noticias/${post.slug}`} target="_blank" rel="noreferrer">Ver no site</a>}
          </div>
          {post && (
            <div className="news-admin-history">
              <h4><History size={14} aria-hidden="true" /> Histórico</h4>
              <ol>{history.map((h) => <li key={h.id}><strong>{ACTION_LABEL[h.action] ?? h.action}</strong> · {new Date(h.changed_at).toLocaleString('pt-BR')}{h.actor_role ? ` · ${h.actor_role === 'ADMIN' ? 'administração' : 'organização'}` : ''} — {h.reason}</li>)}</ol>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
