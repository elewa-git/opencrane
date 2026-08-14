import type { ArtifactPreprocessSourceBroker, ArtifactPreprocessSourceLeaseIssuer } from "@opencrane/backend/server/agents/artifacts";
import { ___DoWithTrace } from "@opencrane/backend/observability";

import { _CreateArtifactReadLeaseSigner } from "./artifact-read-lease-signer.factory";
import { _CreateArtifactServiceReadPort, _InternalArtifactServiceUrl } from "./artifact-service-read-port.factory";

/**
 * Compose the server-side preprocessing source broker from the named
 * catalogue, signing, and byte-transport responsibilities.
 *
 * The returned broker exposes source bytes only after the durable claim fence
 * creates exact, expiring read claims. Neither the worker nor the router sees
 * the storage coordinate or signed read lease.
 * @param sourceLeaseIssuer - Narrow durable port guarded by the current claim fence.
 * @param environment - Server configuration containing service and key paths.
 * @returns Source broker for the workload-authenticated preprocessor router.
 */
export function _CreateArtifactPreprocessSourceBroker(sourceLeaseIssuer: ArtifactPreprocessSourceLeaseIssuer, environment: NodeJS.ProcessEnv = process.env): ArtifactPreprocessSourceBroker
{
	const serviceUrl = _InternalArtifactServiceUrl(environment.ARTIFACT_SERVICE_URL ?? "");
	const signLease = _CreateArtifactReadLeaseSigner(environment);
	const readPort = _CreateArtifactServiceReadPort(serviceUrl);
	return _CreateArtifactPreprocessSourceReader(sourceLeaseIssuer, signLease, readPort);
}

/**
 * Create the operation that turns one current preprocess claim into verified
 * server-brokered source bytes.
 *
 * It owns the post-transaction expiry check and metadata cross-check. It does
 * not choose a revision, extend a claim, or expose a lease outside this server.
 * @param sourceLeaseIssuer - Durable source-lease issuer guarded by the current claim fence.
 * @param signLease - Server-only signer for the exact issued read claims.
 * @param readPort - Private artifact-service byte transport.
 * @returns Fence-aware source byte reader.
 */
function _CreateArtifactPreprocessSourceReader(sourceLeaseIssuer: ArtifactPreprocessSourceLeaseIssuer, signLease: ReturnType<typeof _CreateArtifactReadLeaseSigner>, readPort: ReturnType<typeof _CreateArtifactServiceReadPort>): ArtifactPreprocessSourceBroker
{
	return {
		async read(command)
		{
			return ___DoWithTrace("artifact-preprocessor.source.broker", { jobId: command.jobId, attempt: command.attempt }, async function _ReadSource()
			{
				// 1. Allocate exact read claims under the current database-owned fence and its old deadline.
				const source = await sourceLeaseIssuer.issueSourceLeaseAtomically(command);
				if (source === null) return null;

				// 2. Refuse a claim that expired after the transaction, then sign without extending its authority.
				if (source.readLease.expiresAtEpochSeconds <= Math.floor(Date.now() / 1_000)) return null;
				const compactLease = signLease(source.readLease);

				// 3. Cross-check storage metadata before proxying bytes without exposing the lease.
				const response = await readPort.read(compactLease);
				if (response.body === null || response.headers.get("content-length") !== String(source.byteLength) || response.headers.get("content-type") !== source.mediaType) throw new Error("artifact service read metadata did not match the claimed source");
				return { byteLength: source.byteLength, mediaType: source.mediaType, bytes: response.body as unknown as AsyncIterable<Uint8Array> };
			});
		},
	};
}
