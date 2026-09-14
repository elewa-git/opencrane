/** Fixed identity facts selected by an explicit local deployment profile. */
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
