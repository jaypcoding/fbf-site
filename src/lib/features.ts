// Activation switches of features under review. The source of truth is the
// database (table feature_flags, changed only by admins with a reason): the
// same switch protects the display here AND the public access to the data,
// which the database functions refuse while it is off. Nothing here can turn
// a feature on by itself.
import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';

let mvpEnabledRequest: Promise<boolean> | null = null;

/** Whether the MVP is published (feature_flags.mvp_public). Fails closed. */
export function fetchMvpEnabled(): Promise<boolean> {
  if (!mvpEnabledRequest) {
    mvpEnabledRequest = Promise.resolve(supabase.rpc('mvp_enabled')).then(
      ({ data, error }) => !error && data === true,
      () => false,
    );
  }
  return mvpEnabledRequest;
}

/** null while loading, then true/false. */
export function useMvpEnabled(): boolean | null {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  useEffect(() => {
    let active = true;
    fetchMvpEnabled().then((v) => { if (active) setEnabled(v); });
    return () => { active = false; };
  }, []);
  return enabled;
}

/** After an admin changes a switch, the next read asks the database again. */
export function resetFeatureCache() {
  mvpEnabledRequest = null;
}
