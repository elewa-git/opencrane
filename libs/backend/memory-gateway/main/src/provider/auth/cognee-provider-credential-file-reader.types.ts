/** Fixed mounted-file locations for the per-silo Cognee service user. */
export interface CogneeProviderCredentialFileOptions
{
	/** Absolute file path containing only the service-user email. */
	readonly emailPath: string;
	/** Absolute file path containing only the service-user password. */
	readonly passwordPath: string;
}
