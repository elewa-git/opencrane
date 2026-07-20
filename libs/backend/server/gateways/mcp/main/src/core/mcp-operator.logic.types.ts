/**
 * Identity + entitlement context of the caller of a user-facing endpoint.
 *
 * `devOpen` mirrors the platform's fail-open dev posture: when no session is
 * established and no real auth is configured, the caller sees the full published
 * catalogue so a fresh local install / the OPEN dev backend isn't locked out.
 */
export interface McpOperatorCaller
{
  /** Stable caller identifier (`authUser.sub ?? authUser.email`, or a dev fallback). */
  userId: string;
  /** IdP-verified group claims used for group-based entitlement. */
  groups: string[];
  /** True only when unauthenticated under dev-auth-mode — bypasses entitlement filtering. */
  devOpen: boolean;
}
