/**
 * Carries the identity facts selected by an explicit local deployment profile.
 * The admission service projects this tuple into the existing Principal and standalone-owner
 * authorities; request data cannot select or change these values.
 */
export interface DevelopmentIdentityAdmission
{
	/** Human-readable name shown by the development session. */
	readonly displayName: string;
	/** Deployment-selected email used for standalone owner admission. */
	readonly email: string;
	/** Stable issuer owned by the selected development profile. */
	readonly issuer: string;
	/** Silo that owns the admitted development Principal. */
	readonly siloId: string;
	/** Stable issuer-scoped subject selected by the development profile. */
	readonly subject: string;
}
