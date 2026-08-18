/** Parsed coordinates carried by an authenticated invitation bearer token. */
export interface OrganizationInvitationTokenCoordinates
{
	/** Invitation row selected after the token signature verifies. */
	readonly invitationId: string;
	/** Generation that must still be current on the row. */
	readonly generation: number;
	/** Random per-generation value stored with the invitation. */
	readonly nonce: string;
}

/** Signs and verifies opaque invitation tokens with deployment-held key material. */
export interface OrganizationInvitationTokenAuthority
{
	/** Creates a bearer token for coordinates already stored in the database. */
	issue(coordinates: OrganizationInvitationTokenCoordinates): string;
	/** Verifies and parses a bearer token without consulting request-supplied identity. */
	verify(token: string): OrganizationInvitationTokenCoordinates | null;
}
