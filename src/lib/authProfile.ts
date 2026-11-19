type SessionLike = { user?: { id?: string | null } | null } | null | undefined;

/**
 * Identity used to decide when the profile must be (re)loaded.
 *
 * Supabase emits a new session object on TOKEN_REFRESHED and when the tab
 * regains focus (SIGNED_IN for the same user). Keying the profile on the
 * user id instead of the session object keeps the profile — and every
 * screen that depends on it, such as the admin panel — mounted across
 * those renewals.
 */
export function profileUserKey(session: SessionLike): string | null {
  return session?.user?.id ?? null;
}

/** The blocking loader is only needed while no profile is available yet. */
export function shouldBlockOnProfile(profileLoading: boolean, hasProfile: boolean): boolean {
  return profileLoading && !hasProfile;
}
