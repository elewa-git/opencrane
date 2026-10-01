/** Environment selected by the disposable hosted generated-file qualification. */
export interface HostedGeneratedFileQualificationConfig
{
	readonly activationText: string;
	readonly baseUrl: URL;
	readonly baseTransportAddress: string;
	readonly databaseUrl: string | null;
	readonly evidencePath: string;
	readonly expectedCsvPath: string;
	readonly expectedToolName: string;
	readonly ociLayoutZipPath: string;
	readonly namespace: string;
	readonly oidcEmail: string;
	readonly oidcIssuer: string;
	readonly oidcSubject: string;
	readonly oidcTransportBaseUrl: URL | null;
	readonly ownerOidcEmail: string;
	readonly ownerOidcSubject: string;
	readonly prerequisitesPath: string;
	readonly providerApiBaseUrl: string;
	readonly siloId: string;
	readonly timeoutMilliseconds: number;
}

/** Public personal-agent tool selection returned by the production owner. */
export interface HostedGeneratedFileToolSelection
{
	readonly agentServiceId: string;
	readonly activeRevisionId: string;
	readonly toolRevisionIds: readonly string[];
}

/** Exact tool coordinate whose public discovery, publication, and install have completed. */
export interface HostedGeneratedFileInstalledTool
{
	readonly state: "discovered-published-installed";
	readonly toolRevisionId: string;
}

/** Redacted state retained between qualification and restart verification. */
export interface HostedGeneratedFileRestartCheckpoint
{
	readonly schemaVersion: 1;
	readonly conversationId: string;
	readonly activationText: string;
	readonly activationIdempotencyKey: string;
	readonly activationOutcome: string;
	readonly activationPosition: string;
	readonly expectedCsvContentAddress: string;
	readonly expectedCsvByteLength: number;
	readonly finalPosition: string;
	readonly outputAssetId: string;
	readonly outputArtifactId: string;
	readonly outputArtifactRevisionId: string;
	readonly outputDisplayName: string;
	readonly outputMediaType: string;
	readonly uploadAssetId: string;
	readonly runId: string;
	readonly runAttempt: number;
	readonly runAgentRevisionId: string;
	readonly principalId: string;
	readonly siloId: string;
	readonly oci: HostedGeneratedFileEvidence["oci"];
}

/** Existing product prerequisites established before the governed browser journey starts. */
export interface HostedGeneratedFilePrerequisites
{
	readonly personalAgentRef: string;
	readonly expectedModelDefinitionId: string;
	readonly expectedPrincipalId: string;
	readonly expectedSiloId: string;
}

/** Browser-safe uploaded asset fields used to bind OCI admission to exact bytes. */
export interface HostedGeneratedFileAsset
{
	readonly id: string;
	readonly artifactId: string | null;
	readonly artifactRevisionId: string | null;
	readonly byteLength: number | null;
	readonly displayName: string;
	readonly mediaType: string;
	readonly messageId: string | null;
	readonly provenance: string;
	readonly state: string;
}

/** Exact public run projection retained for restart comparison. */
export interface HostedGeneratedFileRun
{
	readonly runId: string;
	readonly attempt: number;
	readonly state: string;
	readonly conversationId: string | null;
	readonly agentRevisionId: string;
	readonly finishedAt: string | null;
}

/** Public OCI validation evidence returned by the production server. */
export interface HostedGeneratedFileOciValidation
{
	readonly id: string;
	readonly artifactId: string;
	readonly artifactRevisionId: string;
	readonly byteLength: number;
	readonly configDigest: string | null;
	readonly contentAddress: string;
	readonly imageManifestDigest: string | null;
	readonly indexDigest: string | null;
	readonly mediaType: string;
	readonly registryReference: string | null;
	readonly state: string;
}

/** Immutable coordinates created before the one activation Start command. */
export interface HostedGeneratedFileAdmissionCoordinates
{
	readonly conversationId: string;
	readonly messageIdempotencyKey: string;
	readonly personalAgentRef: string;
	readonly serverId: string;
	readonly serverRevisionId: string;
	readonly toolRevisionId: string;
	readonly uploadAssetId: string;
	readonly uploadArtifactId: string;
	readonly uploadArtifactRevisionId: string;
	readonly validationId: string;
}

/** Redacted proof emitted for the platform orchestrator and later CI collection. */
export interface HostedGeneratedFileEvidence
{
	readonly schemaVersion: 1;
	readonly activation: {
		readonly idempotencyKey: string;
		readonly firstOutcome: string;
		readonly replayOutcome: string;
		readonly position: string;
	};
	readonly conversation: {
		readonly id: string;
		readonly finalPosition: string;
		readonly answerCount: number;
		readonly runId: string;
		readonly runAttempt: number;
		readonly runAgentRevisionId: string;
		readonly outputAssetId: string;
		readonly outputArtifactId: string;
		readonly outputArtifactRevisionId: string;
		readonly outputDisplayName: string;
	};
	readonly download: {
		readonly byteLength: number;
		readonly contentAddress: string;
		readonly mediaType: string;
		readonly cacheControl: string;
	};
	readonly identity: {
		readonly principalId: string;
		readonly siloId: string;
	};
	readonly oci: {
		readonly archiveByteLength: number;
		readonly archiveContentAddress: string;
		readonly artifactId: string;
		readonly artifactRevisionId: string;
		readonly configDigest: string;
		readonly imageManifestDigest: string;
		readonly indexDigest: string;
		readonly registryReference: string;
		readonly serverId: string;
		readonly serverRevisionId: string;
		readonly toolRevisionId: string;
		readonly validationId: string;
	};
}

/** Minimal response wrapper used by the qualification HTTP adapter. */
export interface HostedGeneratedFileHttpResponse
{
	readonly status: number;
	readonly headers: Headers;
	arrayBuffer(): Promise<ArrayBuffer>;
	json(): Promise<unknown>;
}

/** Injectable Fetch shape used by synthetic offline contract tests. */
export type HostedGeneratedFileFetch = (input: string | URL, init?: RequestInit) => Promise<HostedGeneratedFileHttpResponse>;
