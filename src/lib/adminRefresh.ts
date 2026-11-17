import { useEffect, useState } from 'react';

export const ADMIN_DATA_CHANGED_EVENT = 'fbf:admin-data-changed';

export function refreshAdminData() {
  window.dispatchEvent(new Event(ADMIN_DATA_CHANGED_EVENT));
}

export function useAdminDataVersion() {
  const [version, setVersion] = useState(0);

  useEffect(() => {
    const refresh = () => setVersion((current) => current + 1);
    window.addEventListener(ADMIN_DATA_CHANGED_EVENT, refresh);
    return () => window.removeEventListener(ADMIN_DATA_CHANGED_EVENT, refresh);
  }, []);

  return version;
}
