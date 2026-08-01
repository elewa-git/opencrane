import type { RateLimitOptions } from "@opencrane/server/_infra/http";

/** A valid API payload-type string for a share. */
export type SharePayloadType = "mcp-server";
/** A valid API recipient-kind string for a share. */
export type ShareRecipientType = "user" | "group";
/** A valid API scope string for a share (mirrors GrantScope; defaults to personal). */
export type ShareScope = "org" | "department" | "project" | "personal";

/** Request body for creating a share. */
export interface CreateShareBody
{
  payloadType?: string;
  payloadId?: string;
  recipientType?: string;
  recipientId?: string;
  scope?: string;
  note?: string;
}

/** Configuration for the sharing HTTP boundary. The production default remains the shared API limit. */
export interface SharesRouterOptions
{
	/** Optional bounded limiter tuning for an isolated router composition, primarily test compositions. */
	readonly rateLimit?: RateLimitOptions;
}
