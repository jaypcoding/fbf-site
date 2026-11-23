// Notícias e comunicados oficiais: types and pure helpers. The body is plain
// text: the site splits it into paragraphs and never renders HTML from it.

export type NewsKind = 'OFFICIAL' | 'NEWS';
export type NewsPost = {
  id: string; slug: string; kind: NewsKind; title: string; summary: string | null; body: string;
  competition_id: string | null; pinned: boolean; status: 'DRAFT' | 'PUBLISHED';
  first_published_at: string | null; published_at: string | null; edited_after_publication_at: string | null;
  updated_at: string; version: number;
  competition?: { id: string; name: string } | { id: string; name: string }[] | null;
};

export const NEWS_KIND_LABEL: Record<NewsKind, string> = { OFFICIAL: 'Comunicado oficial', NEWS: 'Notícia' };
export const NEWS_PUBLIC_SELECT = 'id, slug, kind, title, summary, body, competition_id, pinned, status, first_published_at, published_at, edited_after_publication_at, updated_at, version, competition:competition_id ( id, name )';

/** paragraphs of a plain-text body: blank lines separate paragraphs; single line breaks are kept inside one */
export function paragraphs(body: string): string[][] {
  return body.replace(/\r\n/g, '\n').split(/\n\s*\n/).map((p) => p.split('\n').map((l) => l.trim()).filter(Boolean)).filter((p) => p.length > 0);
}

/** the summary, or the beginning of the body cut at a word boundary */
export function excerpt(post: Pick<NewsPost, 'summary' | 'body'>, max = 180): string {
  if (post.summary?.trim()) return post.summary.trim();
  const text = post.body.replace(/\s+/g, ' ').trim();
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  return `${cut.slice(0, Math.max(cut.lastIndexOf(' '), max - 20)).trimEnd()}…`;
}

/** pinned first, then newest publication first */
export function orderPosts<T extends Pick<NewsPost, 'pinned' | 'published_at'>>(posts: T[]): T[] {
  return [...posts].sort((a, b) => Number(b.pinned) - Number(a.pinned) || (b.published_at ?? '').localeCompare(a.published_at ?? ''));
}

export function formatNewsDate(iso: string | null): string {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' });
}
