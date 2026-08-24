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
