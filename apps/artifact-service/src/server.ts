import { mkdir } from "node:fs/promises";
import { createServer } from "node:http";
import type { Server } from "node:http";

import { __FilesystemArtifactStore } from "@opencrane/backend/artifacts/filesystem";
import { __SignArtifactPromotionReceipt, __VerifyArtifactWriteLease } from "@opencrane/backend/artifacts/authorization";
import { ___DoWithTrace } from "@opencrane/observability";

import type { ArtifactServiceProcessConfig } from "./config.types.js";
import { _log as log } from "./log.js";

/** Prepare the mounted canonical-byte root before admitting health traffic. */
export async function _PrepareArtifactStore(config: ArtifactServiceProcessConfig): Promise<__FilesystemArtifactStore>
{
	return ___DoWithTrace("artifact-service.prepare-store", { artifactRoot: config.artifactRoot }, async function _prepareStore()
	{
		await mkdir(config.artifactRoot, { recursive: true, mode: 0o700 });
		return new __FilesystemArtifactStore({ rootPath: config.artifactRoot });
	});
}

/** Create the private server, which accepts only OpenCrane-signed, bounded write leases. */
export function _CreateServer(config: ArtifactServiceProcessConfig, store: __FilesystemArtifactStore): Server
{
	return createServer(function _handle(request, response)
	{
		const path = new URL(request.url ?? "/", "http://localhost").pathname;
		void ___DoWithTrace("artifact-service.request", { method: request.method ?? "UNKNOWN", path }, async function _handleRequest()
		{
			if (path === "/livez" || path === "/readyz")
			{
				response.writeHead(204);
				response.end();
				return;
			}
			if (path !== "/v1/artifacts/promote" || request.method !== "POST")
			{
				response.writeHead(404, { "content-type": "application/json" });
				response.end(JSON.stringify({ error: "not_found" }));
				return;
			}
			const compactLease = request.headers["x-opencrane-artifact-lease"];
			const lease = typeof compactLease === "string" ? __VerifyArtifactWriteLease(compactLease, config.leasePublicKeyPem, Math.floor(Date.now() / 1_000)) : null;
			if (lease === null || lease.expectedContentAddress === null || lease.expectedByteLength === null)
			{
				response.writeHead(403, { "content-type": "application/json" });
				response.end(JSON.stringify({ error: "invalid_artifact_lease" }));
				return;
			}
			const contentLength = request.headers["content-length"];
			if (typeof contentLength === "string" && (!/^\d+$/u.test(contentLength) || Number(contentLength) > lease.expectedByteLength))
			{
				response.writeHead(413, { "content-type": "application/json" });
				response.end(JSON.stringify({ error: "artifact_body_exceeds_lease" }));
				request.destroy();
				return;
			}
			const maximumLeaseDuration = (lease.expiresAtEpochSeconds * 1_000) - Date.now();
			const maximumUploadDuration = Math.min(config.maxUploadDurationMilliseconds, maximumLeaseDuration);
			if (maximumUploadDuration < 1)
			{
				response.writeHead(403, { "content-type": "application/json" });
				response.end(JSON.stringify({ error: "expired_artifact_lease" }));
				return;
			}
			let deadlineExceeded = false;
			const deadline = setTimeout(function _abortDeadlineExceeded()
			{
				deadlineExceeded = true;
				request.destroy(new Error("artifact upload exceeded its absolute lease-bound deadline"));
			}, maximumUploadDuration);
			try
			{
				const staged = await store.stage({ lease, bytes: request, expectedContentAddress: lease.expectedContentAddress, expectedByteLength: lease.expectedByteLength, mediaType: lease.mediaType });
				if (deadlineExceeded || Date.now() >= lease.expiresAtEpochSeconds * 1_000) throw new Error("artifact upload exceeded its absolute lease-bound deadline");
				const promotion = await store.promote(staged);
				if (deadlineExceeded || Date.now() >= lease.expiresAtEpochSeconds * 1_000) throw new Error("artifact upload exceeded its absolute lease-bound deadline");
				const receipt = __SignArtifactPromotionReceipt({ leaseId: promotion.leaseId, contentAddress: promotion.contentAddress, byteLength: promotion.byteLength, mediaType: promotion.mediaType, issuedAtEpochSeconds: Math.floor(Date.now() / 1_000) }, config.receiptPrivateKeyPem);
				response.writeHead(201, { "content-type": "application/json", "cache-control": "no-store" });
				response.end(JSON.stringify({ ...promotion, receipt }));
			}
			finally
			{
				clearTimeout(deadline);
			}
		}).catch(function _onRequestFailure(err)
		{
			log.error({ err, method: request.method, path }, "artifact service request failed");
			response.destroy(err instanceof Error ? err : new Error("artifact service request failed"));
		});
	});
}
