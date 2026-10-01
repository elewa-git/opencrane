import { Readable } from "node:stream";
import { ___DoWithTrace } from "@opencrane/backend/observability";
import { ___ParseAndValidateJson } from "@opencrane/util";

/** Build the private HTTP client for artifact-service promotion. */
export function _CreateArtifactServicePromotionPort(serviceUrl: string): { promote(lease: string, bytes: AsyncIterable<Uint8Array>): Promise<{ readonly receipt: string }> }
{
	return {
		async promote(lease: string, bytes: AsyncIterable<Uint8Array>): Promise<{ readonly receipt: string }>
		{
			return ___DoWithTrace("artifact.promote.fetch", {}, async function _Promote(): Promise<{ readonly receipt: string }>
			{
				const response = await fetch(`${serviceUrl}/v1/artifacts/promote`, { method: "POST", headers: { "x-opencrane-artifact-lease": lease }, body: Readable.toWeb(Readable.from(bytes)) as unknown as BodyInit, duplex: "half" } as RequestInit);
				if (!response.ok)
					throw new Error(`artifact service promotion failed with ${response.status}`);
				return ___ParseAndValidateJson(await response.text(), "artifact service promotion response", _PromotionReceipt);
			});
		},
	};
}

/** Validate the exact receipt returned after artifact promotion. */
function _PromotionReceipt(value: unknown): { readonly receipt: string }
{
	if (typeof value !== "object" || value === null || Array.isArray(value) || !("receipt" in value) || typeof value.receipt !== "string" || value.receipt.length === 0)
		throw new Error("artifact service promotion returned no receipt");
	return { receipt: value.receipt };
}
