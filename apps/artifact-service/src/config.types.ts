/** Fully validated artifact-service process configuration. */
export interface ArtifactServiceProcessConfig
{
	/** Private HTTP listener port. */
	port: number;
	/** Mounted persistent volume used only for canonical artifact bytes. */
	artifactRoot: string;
	/** Hard maximum from request start to promotion, independently capped by lease expiry. */
	maxUploadDurationMilliseconds: number;
	/** OpenCrane public key used only to verify short-lived internal write leases. */
	leasePublicKeyPem: string;
	/** Artifact-service private key used only to sign promotion receipts. */
	receiptPrivateKeyPem: string;
}
