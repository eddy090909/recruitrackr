/** Sign-in errors are passed to /login as a code; only these fixed messages are ever shown. */
export const LOGIN_ERRORS = {
  cancelled: "Google sign-in was cancelled.",
  state: "Sign-in failed (state mismatch). Try again.",
  not_allowed: "This Google account isn't allowed to use this Recruitrackr.",
  config: "Google sign-in isn't configured. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET.",
  failed: "Sign-in failed. Try again.",
} as const;

export type LoginError = keyof typeof LOGIN_ERRORS;

export const loginErrorMessage = (code: string | undefined): string | null =>
  code && Object.hasOwn(LOGIN_ERRORS, code) ? LOGIN_ERRORS[code as LoginError] : null;
