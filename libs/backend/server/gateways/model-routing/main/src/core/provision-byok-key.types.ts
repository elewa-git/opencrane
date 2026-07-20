import type * as k8s from "@kubernetes/client-node";
import type { Logger } from "pino";
import type { PrismaClient, ProviderCredential as PrismaProviderCredential } from "@prisma/client";

/** Inputs required to persist and register a provider's BYOK key. */
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
}

/** Inputs required to remove a provider's BYOK key. */
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

/** Outcome of provisioning a provider's BYOK key. */
export interface ProvisionByokKeyResult
{
  /** True when LiteLLM's `/credentials` accepted the key (false means Secret-only / env baseline). */
  litellmRegistered: boolean;
  /** The upserted Global ProviderCredential row. */
  row: PrismaProviderCredential;
}
