/** Untrusted request body accepted by the resource-sharing route. */
export interface ResourceShareRequestBody
{
  /** Requested resource family before validation. */
  resourceType?: string;
  /** Requested resource identifier before validation. */
  resourceId?: string;
  /** Stable local Principal identifier that should receive access. */
  recipientPrincipalId?: string;
}

/** Resource-share projection returned by the API. */
export interface ResourceShareResponse
{
  /** Stable ResourceShare identifier used for recipient management. */
  id: string;
  /** Governed resource family. */
  resourceType: string;
  /** Exact governed resource identifier. */
  resourceId: string;
  /** Local Principal that owns the resource's personal boundary. */
  ownerPrincipalId: string;
  /** Local Principals with explicit recipient relations and grants. */
  recipientPrincipalIds: readonly string[];
}
