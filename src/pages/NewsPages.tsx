// Notícias e comunicados oficiais: list (/noticias) and article
// (/noticias/:slug). Only published posts are readable by visitors (the
// database enforces it). The body is plain text rendered as paragraphs.
import { useEffect, useMemo, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { Megaphone, Newspaper, Pin } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { one } from '@/lib/relations';
import { useAdminDataVersion } from '@/lib/adminRefresh';
import { usePageTitle } from '@/lib/pageTitle';
import { excerpt, formatNewsDate, NEWS_KIND_LABEL, NEWS_PUBLIC_SELECT, paragraphs, type NewsKind, type NewsPost } from '@/lib/news';
import { usePublishedNews } from '@/lib/newsData';
import { EmptyState, LoadingCard, PageIntro } from '@/components/ui';

export function NewsCard({ post }: { post: NewsPost }) {
  const Icon = post.kind === 'OFFICIAL' ? Megaphone : Newspaper;
  const competition = one(post.competition ?? null);
  return (
    <article className={`news-card is-${post.kind.toLowerCase()}`}>
      <span className="news-kind"><Icon size={13} aria-hidden="true" /> {NEWS_KIND_LABEL[post.kind]}{post.pinned && <span className="news-pinned"><Pin size={12} aria-hidden="true" /> Destaque</span>}</span>
      <h3><Link to={`/noticias/${post.slug}`}>{post.title}</Link></h3>
      <p>{excerpt(post)}</p>
      <small>{formatNewsDate(post.published_at)}{competition ? ` · ${competition.name}` : ''}</small>
    </article>
  );
}

export function NewsListPage() {
  usePageTitle('Notícias');
  const [params, setParams] = useSearchParams();
  const kind = (params.get('tipo') ?? '') as NewsKind | '';
  const { loading, error, posts } = usePublishedNews();
  const visible = useMemo(() => posts.filter((p) => !kind || p.kind === kind), [posts, kind]);
  return (
    <>
      <PageIntro eyebrow="FBF informa" title="Notícias e comunicados" description="Comunicados oficiais da federação e notícias das competições." />
      <section className="container content-section news-page">
        <div className="news-filters" role="group" aria-label="Tipo de publicação">
          {([['', 'Todas'], ['OFFICIAL', 'Comunicados oficiais'], ['NEWS', 'Notícias']] as const).map(([value, label]) => (
            <button key={value} type="button" className="button button-outline button-small" aria-pressed={kind === value} onClick={() => setParams(value ? { tipo: value } : {}, { replace: true })}>{label}</button>
          ))}
        </div>
        {error ? <EmptyState icon={<Newspaper />} title="Não foi possível carregar as notícias" description="Tente atualizar a página em instantes." />
          : loading ? <LoadingCard />
          : visible.length === 0 ? <EmptyState icon={<Newspaper />} title="Nenhuma publicação ainda" description="Os comunicados oficiais e as notícias da FBF aparecem aqui quando forem publicados." />
          : <div className="news-grid">{visible.map((p) => <NewsCard key={p.id} post={p} />)}</div>}
      </section>
    </>
  );
}

export function NewsArticlePage() {
  const { slug } = useParams();
  const refreshVersion = useAdminDataVersion();
  const [state, setState] = useState<{ loading: boolean; post: NewsPost | null }>({ loading: true, post: null });
  useEffect(() => {
    let active = true;
    setState({ loading: true, post: null });
    void supabase.from('news_posts').select(NEWS_PUBLIC_SELECT).eq('slug', slug ?? '').eq('status', 'PUBLISHED').maybeSingle()
      .then(({ data }) => { if (active) setState({ loading: false, post: (data as unknown as NewsPost) ?? null }); });
    return () => { active = false; };
  }, [slug, refreshVersion]);
  usePageTitle(state.post?.title ?? (state.loading ? null : 'Notícia'));
  const post = state.post;
  const competition = one(post?.competition ?? null);
  return (
    <section className="container detail-section news-article">
      <Link to="/noticias" className="back-link">← Notícias e comunicados</Link>
      {state.loading ? <LoadingCard /> : !post ? (
        <EmptyState icon={<Newspaper />} title="Publicação não encontrada" description="Ela pode ter sido retirada do ar ou o endereço está incorreto." />
      ) : (
        <article>
          <span className={`news-kind is-${post.kind.toLowerCase()}`}>{post.kind === 'OFFICIAL' ? <Megaphone size={14} aria-hidden="true" /> : <Newspaper size={14} aria-hidden="true" />} {NEWS_KIND_LABEL[post.kind]}</span>
          <h1>{post.title}</h1>
          <p className="news-meta">
            Publicado em {formatNewsDate(post.first_published_at ?? post.published_at)}
            {post.edited_after_publication_at && <> · atualizado em {formatNewsDate(post.edited_after_publication_at)}</>}
            {competition && <> · <Link to={`/competicoes/${competition.id}`} className="inline-link">{competition.name}</Link></>}
          </p>
          {post.summary && <p className="news-summary">{post.summary}</p>}
          <div className="news-body">
            {paragraphs(post.body).map((lines, i) => <p key={i}>{lines.map((l, j) => <span key={j}>{l}{j < lines.length - 1 && <br />}</span>)}</p>)}
          </div>
        </article>
      )}
    </section>
  );
}
