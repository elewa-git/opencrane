/**
 * Default redaction paths applied by every logger created through this package.
 *
 * Pino replaces the value at each path with `[Redacted]` before serialisation,
 * so secrets and bearer tokens never reach stdout or a configured log backend
 * even when an object is logged wholesale.
 */

/**
 * Pino `redact.paths` entries covering the credential-bearing fields that flow
 * through the OpenCrane opencrane-ui and its clients (auth headers, LiteLLM
 * master keys, OIDC secrets, DB URLs, k8s secret payloads).
 */
export const REDACT_PATHS: readonly string[] = [
  "req.headers.authorization",
  "req.headers.cookie",
  "req.headers['last-event-id']",
  "res.headers['set-cookie']",
  "headers.authorization",
  "headers['last-event-id']",
  "authorization",
  "cursor",
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
  "reviewedToolArguments",
  "finalArguments",
  "arguments",
  "result",
  "*.cursor",
  "*.password",
  "*.token",
  "*.apiKey",
  "*.masterKey",
  "*.client_secret",
  "*.reviewedToolArguments",
  "*.finalArguments",
  "*.arguments",
  "*.result",
];
