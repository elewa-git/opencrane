/**
 * Whether a thrown value is a Kubernetes API error with this HTTP status code.
 *
 * `@kubernetes/client-node` (^1.0.0) reports failures in several shapes depending on the
 * call — `statusCode`, `code`, `response.statusCode`, or `body.code` — so checking one
 * field misses real matches. This checks all of them, and returns false for anything that
 * is not an object, so it is safe to call on an unknown catch value.
 *
 * Called by: {@link _IsK8sNotFound} and {@link _IsK8sConflict} in this file; those two are
 * what callers use. `_IsK8sNotFound` is used by
 * libs/backend/server/infra/auth/src/per-org-client.ts.
 *
 * @param err  - The value from a `catch`; any type is accepted.
 * @param code - The HTTP status code to look for, for example 404.
 * @returns True when any of those fields equals the code.
 */
export function _IsK8sStatus(err: unknown, code: number): boolean
{
  if (typeof err !== "object" || err === null) return false;
  const e = err as { statusCode?: unknown; code?: unknown; body?: { code?: unknown }; response?: { statusCode?: unknown } };
  if (e.statusCode === code || e.code === code) return true;
  if (e.response && (e.response as { statusCode?: unknown }).statusCode === code) return true;
  return typeof e.body === "object" && e.body !== null && (e.body as { code?: unknown }).code === code;
}

/** Whether the error is a Kubernetes 404 NotFound. */
export function _IsK8sNotFound(err: unknown): boolean
{
  return _IsK8sStatus(err, 404);
}

/** Whether the error is a Kubernetes 409 AlreadyExists / Conflict. */
export function _IsK8sConflict(err: unknown): boolean
{
  return _IsK8sStatus(err, 409);
}
