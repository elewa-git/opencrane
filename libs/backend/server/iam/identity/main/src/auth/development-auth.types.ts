/**
 * Defines the complete fixed identity and trust material for one disposable Tier 3 silo.
 *
 * The application reads this only from validated startup values and mounted Secret files. Requests
 * cannot replace any identity coordinate, host, proof, or lifetime in this object.
 *
 * Called by: the OpenCrane Tier 3 composition when it constructs {@link Tier3DevelopmentAuthService}.
 */
export interface Tier3DevelopmentAuthenticationConfig
{
	/** Displays the fixed identity in the browser without granting authority by name. */
	readonly displayName: string;
	/** Records the installation-selected Owner email in the bounded session. */
	readonly email: string;
	/** Restricts proof-backed login to the exact reserved ingress authority. */
	readonly expectedHost: string;
	/** Namespaces the fixed subject outside every production identity provider. */
	readonly issuer: string;
	/** Authenticates the local Tier 3 coordinator on exact login endpoints. */
	readonly proxySecret: string;
	/** Bounds cached authentication and authorization facts for one browser session. */
	readonly sessionMaxAgeMilliseconds: number;
	/** Selects the standalone silo receiving the durable Principal and Owner projection. */
	readonly siloId: string;
	/** Supplies the stable subject stored in Principal and Owner records. */
	readonly subject: string;
}
