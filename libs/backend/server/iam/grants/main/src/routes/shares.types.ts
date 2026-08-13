/** A valid API payload-type string for a share. */
export type SharePayloadType = "mcp-server";
/** A valid API recipient-kind string for a share. */
export type ShareRecipientType = "user" | "group";
/** A valid API scope string for a share (mirrors GrantScope; defaults to personal). */
export type ShareScope = "org" | "department" | "project" | "personal";

/**
 * Raw request body for creating a share. Every field is optional and typed as a plain string because
 * this is what arrived over HTTP; the route checks each one against its closed set before touching
 * the database, so a missing or unknown value becomes a 400 rather than a bad grant.
 */
export interface CreateShareBody
{
  payloadType?: string;
  payloadId?: string;
  recipientType?: string;
  recipientId?: string;
  scope?: string;
  note?: string;
}
