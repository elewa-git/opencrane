import type * as k8s from "@kubernetes/client-node";
import type { Logger } from "pino";
import type { PrismaClient, ProviderCredential as PrismaProviderCredential } from "@prisma/client";

/**
 * Everything `_ProvisionByokKey` needs to set a provider's raw BYOK key.
 *
 * `apiKey` is the only raw secret here. It reaches exactly two places — the provider's Kubernetes
 * Secret and LiteLLM's `/credentials` store — and is never logged, never stored in Postgres, and
 * never returned. Only the Secret's NAME is recorded on the `ProviderCredential` row.
 *
 * @see {@link ProvisionByokKeyResult} for what comes back, and `requireLiveModels` below for the
 *      one option that changes whether failures throw.
 */
export interface ProvisionByokKeyOptions
{
  /** Prisma client for credential and model rows. */
  prisma: PrismaClient;
  /** Kubernetes Core V1 API used to persist the provider key Secret. */
  coreApi: k8s.CoreV1Api;
  /** Namespace containing the silo's provider key Secrets. */
  operatorNamespace: string;
  /** Provider identifier, such as `openai`. */
  provider: string;
  /** Raw upstream API key, which must never be logged or echoed. */
  apiKey: string;
  /** Scoped logger for best-effort registration warnings. */
  log: Logger;
  /**
   * Turns model registration from warn-on-failure into throw-on-failure.
   *
   * Left false (the interactive `PUT /providers/byok/:provider` route): if LiteLLM is unconfigured
   * or down, the key is still set and the failure is only a log line, so an operator setting a key
   * from the UI is not blocked by a flaky LiteLLM.
   *
   * Set true (apps/opencrane/src/app/initial-model-bootstrap.ts): referenced and non-placeholder
   * definitions must retain their exact stored deployment id in the live inventory. Unreferenced
   * placeholders may be registered and updated before a revision freezes them. New model and
   * embedding registrations must return a live id, and the first failure throws out of
   * `_ProvisionByokKey` instead of deferring discovery until traffic arrives.
   *
   * Either way the Secret and the `ProviderCredential` row are already written by the time a throw
   * can happen — this switch changes when you find out, not what was stored.
   */
  requireLiveModels?: boolean;
}

/** Everything `_DeprovisionByokKey` needs to remove a provider's key. No `log` here, because removal has no best-effort step to warn about — every failure throws. */
export interface DeprovisionByokKeyOptions
{
  /** Prisma client for the credential row. */
  prisma: PrismaClient;
  /** Kubernetes Core V1 API used to remove the provider key Secret. */
  coreApi: k8s.CoreV1Api;
  /** Namespace containing the silo's provider key Secrets. */
  operatorNamespace: string;
  /** Provider whose key must be removed. */
  provider: string;
}

/**
 * What `_ProvisionByokKey` reports back after a successful set.
 *
 * Reaching this result means the Secret and the `ProviderCredential` row were both written. It
 * does NOT mean LiteLLM took the key: check `litellmRegistered`. When that is false the key works
 * only through LiteLLM's environment-variable baseline, and models bound to the credential name
 * will not resolve until a later set succeeds.
 */
export interface ProvisionByokKeyResult
{
  /** True when LiteLLM's `/credentials` accepted the key (false means Secret-only / env baseline). */
  litellmRegistered: boolean;
  /** The upserted Global ProviderCredential row. */
  row: PrismaProviderCredential;
}
