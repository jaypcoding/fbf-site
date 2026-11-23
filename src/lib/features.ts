// Features under review: visible in staging, and in production only when the
// publication explicitly turns them on (VITE_FEATURE_*=true in the build env).
// The MVP formula is approved, but showing MVPs of past matches in production
// is a publication decision of the FBF.
const env = import.meta.env as Record<string, string | undefined>;

export const FEATURE_MVP = env.MODE === 'staging' || env.VITE_FEATURE_MVP === 'true';
