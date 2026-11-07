export const SESSION_COOKIE = "rh_session";

/**
 * Demo mode skips sign-in, so it only works in a local dev server
 * (`npm run dev:demo`): never in a production build, never with a real database.
 */
export const isDemo = () => process.env.DEMO_MODE === "1" && !process.env.DATABASE_URL && process.env.NODE_ENV !== "production";
