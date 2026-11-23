// Published news for visitors (the database returns only PUBLISHED posts to them).
import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useAdminDataVersion } from '@/lib/adminRefresh';
import { NEWS_PUBLIC_SELECT, orderPosts, type NewsPost } from '@/lib/news';

export function usePublishedNews(limit?: number) {
  const refreshVersion = useAdminDataVersion();
  const [state, setState] = useState<{ loading: boolean; error: boolean; posts: NewsPost[] }>({ loading: true, error: false, posts: [] });
  useEffect(() => {
    let active = true;
    let q = supabase.from('news_posts').select(NEWS_PUBLIC_SELECT).eq('status', 'PUBLISHED').order('pinned', { ascending: false }).order('published_at', { ascending: false });
    if (limit) q = q.limit(limit);
    void q.then(({ data, error }) => { if (active) setState({ loading: false, error: Boolean(error), posts: orderPosts((data ?? []) as unknown as NewsPost[]) }); });
    return () => { active = false; };
  }, [limit, refreshVersion]);
  return state;
}

