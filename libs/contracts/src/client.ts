import createFetchClient from "openapi-fetch";

import type { paths } from "./generated/api.js";

/**
 * Re-export the typed path map so consumers can type-check their own fetch calls.
 * `paths` = the per-silo clustertenant-manager API.
 */
export type { paths };

/**
 * Create a typed HTTP client for the per-silo clustertenant-manager (opencrane-ui) API.
 *
 * Usage:
 *   import { ___CreateControlPlaneClient } from "@opencrane/contracts";
 *   const client = ___CreateControlPlaneClient("http://localhost:8080/api/v1");
 *   const { data, error } = await client.GET("/tenants");
 *
 * @param baseUrl - Full base URL including the /api/v1 prefix.
 */
export function ___CreateControlPlaneClient(baseUrl: string)
{
  // 1. Seed the default headers with the content-type all API endpoints expect.
  const headers: Record<string, string> = { "content-type": "application/json" };

  // 2. Return a typed same-origin client so browser OIDC session cookies travel with requests.
  return createFetchClient<paths>({ baseUrl, headers, credentials: "include" });
}
