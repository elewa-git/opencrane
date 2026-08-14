import type { ArtifactScanSourceBroker, ArtifactScanSourceRead } from "@opencrane/backend/server/agents/artifacts";
import { ___DoWithTrace } from "@opencrane/backend/observability";

import { _CreateArtifactReadLeaseSigner } from "./artifact-read-lease-signer.factory";
import { _CreateArtifactServiceReadPort, _InternalArtifactServiceUrl } from "./artifact-service-read-port.factory";

/**
 * Compose the scanner's server-only ArtifactStore byte broker.
 *
 * The scanner receives streamed bytes, never the immutable storage coordinate or signed read lease.
 * @param environment - Server configuration containing the private service URL and lease key path.
 * @returns Source broker used only by the workload-authenticated scanner router.
 */
export function _CreateArtifactScanSourceBroker(environment: NodeJS.ProcessEnv = process.env): ArtifactScanSourceBroker
{
	const serviceUrl = _InternalArtifactServiceUrl(environment.ARTIFACT_SERVICE_URL ?? "");
	const signLease = _CreateArtifactReadLeaseSigner(environment);
	const readPort = _CreateArtifactServiceReadPort(serviceUrl);
	return _CreateArtifactScanSourceReader(signLease, readPort);
}

/** Build the exact metadata-checking reader from named app-owned ports. */
function _CreateArtifactScanSourceReader(signLease: ReturnType<typeof _CreateArtifactReadLeaseSigner>, readPort: ReturnType<typeof _CreateArtifactServiceReadPort>): ArtifactScanSourceBroker
{
	return {
		async open(source: ArtifactScanSourceRead): Promise<AsyncIterable<Uint8Array>>
		{
			return ___DoWithTrace("artifact-scanner.source.broker", { artifactRevisionId: source.readLease.artifactRevisionId, byteLength: source.byteLength }, async function _ReadSource(): Promise<AsyncIterable<Uint8Array>>
			{
				// 1. Refuse authority that expired after the database transaction without extending it.
				if (source.readLease.expiresAtEpochSeconds <= Math.floor(Date.now() / 1_000)) throw new Error("artifact scanner source claim expired");
				const compactLease = signLease(source.readLease);

				// 2. Cross-check immutable storage metadata before proxying the private response body.
				const response = await readPort.read(compactLease);
				if (response.body === null || response.headers.get("content-length") !== String(source.byteLength) || response.headers.get("content-type") !== source.mediaType) throw new Error("artifact service read metadata did not match the scan source");
				return response.body as unknown as AsyncIterable<Uint8Array>;
			});
		},
	};
}
