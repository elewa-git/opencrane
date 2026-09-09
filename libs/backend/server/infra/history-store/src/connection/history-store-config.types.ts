/** TLS-only KurrentDB coordinates owned by the HistoryStore deployment boundary. */
export interface OpenCraneHistoryStoreConfig
{
	/** File path of the mounted KurrentDB certificate authority bundle. */
	readonly caCertificatePath: string;
	/** Silo-local KurrentDB host and port without a scheme or credentials. */
	readonly endpoint: string;
	/** File path of the mounted least-privilege KurrentDB service password. */
	readonly passwordPath: string;
	/** File path of the mounted least-privilege KurrentDB service username. */
	readonly usernamePath: string;
}
