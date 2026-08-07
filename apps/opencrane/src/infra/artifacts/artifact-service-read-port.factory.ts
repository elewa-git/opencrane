import { ___DoWithTrace } from "@opencrane/backend/observability";

/**
 * Require the credential-free internal endpoint that is allowed to receive
 * artifact read leases from this server process.
 * @param value - Configured ArtifactStore service origin.
 * @returns Normalised cluster-local HTTP origin.
 */
export function _InternalArtifactServiceUrl(value: string): string
{
	const parsed = new URL(value);
	if (parsed.protocol !== "http:" || parsed.username || parsed.password || !parsed.hostname.endsWith(".svc.cluster.local")) throw new Error("ARTIFACT_SERVICE_URL must be a credential-free cluster-local HTTP URL");
	return parsed.toString().replace(/\/$/u, "");
}

/**
 * Build the server-only HTTP client that retrieves bytes covered by one
 * immutable read lease.
 * @param serviceUrl - Validated same-silo artifact-service origin.
 * @returns Read port that preserves the lease inside the server process.
 */
export function _CreateArtifactServiceReadPort(serviceUrl: string): { read(lease: string): Promise<Response> }
{
	return {
		async read(lease: string): Promise<Response>
		{
			return ___DoWithTrace("artifact.read.fetch", { service: "artifact-service" }, async function _FetchArtifact(): Promise<Response>
			{
				const response = await fetch(`${serviceUrl}/v1/artifacts/read`, { redirect: "error", headers: { "x-opencrane-artifact-read-lease": lease } });
				if (!response.ok || response.body === null) throw new Error(`artifact service read failed with ${response.status}`);
				return response;
			});
		},
	};
}
