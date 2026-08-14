import createFetchClient from "openapi-fetch";

import type { paths } from "./generated/api";

/**
 * Re-export the typed path map so consumers can type-check their own fetch calls.
 * `paths` = the per-silo clustertenant-manager API.
 */
export type { paths };

/**
 * Create a typed HTTP client for the per-silo control-plane API.
 *
 * Requests are sent same-origin with credentials, so a browser's OIDC session cookie travels
 * with them and no token needs to be threaded through calls. Every path and response type comes
 * from the generated OpenAPI types, so a wrong path fails to compile.
 *
 * Usage:
 *   import { ___CreateControlPlaneClient } from "@opencrane/contracts";
 *   const client = ___CreateControlPlaneClient("http://localhost:8080/api/v1");
 *   const { data, error } = await client.GET("/tenants");
 *
 * No caller in this repo yet — grep found none outside this file, so treat it as a published
 * entry point for consumers of `@opencrane/contracts`.
 * @param baseUrl - Full base URL including the `/api/v1` prefix.
 * @returns A client whose methods never throw on an HTTP error; check the returned `error`.
 * @see {@link ControlPlaneClient}
 */
export function ___CreateControlPlaneClient(baseUrl: string)
{
  // 1. Seed the default headers with the content-type all API endpoints expect.
  const headers: Record<string, string> = { "content-type": "application/json" };

  // 2. Return a typed same-origin client so browser OIDC session cookies travel with requests.
  return createFetchClient<paths>({ baseUrl, headers, credentials: "include" });
}
