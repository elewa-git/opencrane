/** OpenAPI path fragment for the owner-only personal asset catalogue. */
export const _PersonalArtifactsOpenapiPaths = {
	"/me/assets": {
		get: {
			operationId: "listMyAssets",
			summary: "List the signed-in owner's assets",
			description: "The server derives the owner and silo from the browser session and request host. It returns at most fifty non-deleted asset metadata records, never bytes, content addresses, provenance, leases, receipts, or outbox data.",
			tags: ["Personal assets"],
			responses: {
				200: { description: "Owner-bound personal asset metadata.", content: { "application/json": { schema: { type: "object", required: ["assets"], properties: { assets: { type: "array", items: { type: "object", required: ["id", "kind", "state", "currentRevisionId", "mediaType", "byteLength", "indexState", "createdAt", "updatedAt"], properties: { id: { type: "string" }, kind: { type: "string", enum: ["document", "generated", "skill", "upload"] }, state: { type: "string", enum: ["active", "deletion_pending"] }, currentRevisionId: { type: ["string", "null"] }, mediaType: { type: ["string", "null"] }, byteLength: { type: ["string", "null"], pattern: "^(0|[1-9][0-9]*)$" }, indexState: { type: ["string", "null"], enum: ["pending", "indexed", "failed", "removal_pending", "removed", null] }, createdAt: { type: "string", format: "date-time" }, updatedAt: { type: "string", format: "date-time" } } } } } } } } },
				401: { description: "No browser session owns the request.", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
				503: { description: "Personal asset metadata could not be read.", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
			},
		},
	},
};
