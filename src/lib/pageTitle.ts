import { useEffect } from 'react';

export const SITE_NAME = 'FBF — Federação Brasileira de Futsal';

export function pageTitle(title?: string | null): string {
  const clean = title?.trim();
  return clean ? `${clean} · FBF` : SITE_NAME;
}

export function usePageTitle(title?: string | null) {
  useEffect(() => {
    document.title = pageTitle(title);
  }, [title]);
}
