/**
 * Default redaction paths applied by every logger created through this package.
 *
 * Pino replaces the value at each path with `[Redacted]` before serialisation,
 * so secrets and bearer tokens never reach stdout or a configured log backend
 * even when an object is logged wholesale.
 */

/**
 * Field paths pino replaces with `[Redacted]` before a record is serialized.
 *
 * Covers auth headers and cookies, replay cursors, API and master keys, provider material and its
 * verifier, OIDC secrets, database URLs, and tool arguments and results. Each entry appears twice —
 * bare and `*.`-prefixed — so a field is caught both at the record root and one level down.
 *
 * This is the path-based half of the defence and it only matches these exact shapes. Arbitrary
 * nesting is handled separately by {@link _SanitizeLogFields}, so add a new sensitive field name
 * to BOTH or it will still be logged from an unexpected depth.
 */
export const REDACT_PATHS: readonly string[] = [
  "req.headers.authorization",
  "req.headers.cookie",
  "req.headers['last-event-id']",
  "req.headers['x-opencrane-scan-fence']",
  "req.headers['x-opencrane-artifact-lease']",
  "res.headers['set-cookie']",
  "headers.authorization",
  "headers['last-event-id']",
  "headers['x-opencrane-scan-fence']",
  "headers['x-opencrane-artifact-lease']",
  "authorization",
  "cursor",
  "claimFence",
  "password",
  "token",
  "accessToken",
  "refreshToken",
  "apiKey",
  "masterKey",
  "client_secret",
  "clientSecret",
  "DATABASE_URL",
  "databaseUrl",
  "providerKey",
  "materialVerifier",
  "reviewedToolArguments",
  "finalArguments",
  "arguments",
  "result",
  "*.cursor",
  "*.claimFence",
  "*.password",
  "*.token",
  "*.apiKey",
  "*.masterKey",
  "*.client_secret",
  "*.providerKey",
  "*.materialVerifier",
  "*.reviewedToolArguments",
  "*.finalArguments",
  "*.arguments",
  "*.result",
];
