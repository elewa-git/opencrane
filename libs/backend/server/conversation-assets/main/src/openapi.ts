import { ConversationAssetDisposition, ConversationAssetLifecycle, ConversationAssetProvenance } from "@opencrane/models/conversation-assets";

/** Browser-safe conversation asset metadata shared by list and command responses. */
const _ConversationAssetSchema = {
	type: "object",
	additionalProperties: false,
	required: ["id", "conversationId", "messageId", "provenance", "state", "displayName", "mediaType", "byteLength", "disposition", "failureCode", "canRemove", "canRetry", "createdAt"],
	properties: {
		id: { type: "string" },
		conversationId: { type: "string" },
		messageId: { type: ["string", "null"] },
		provenance: { type: "string", enum: [ConversationAssetProvenance.ParticipantUpload, ConversationAssetProvenance.AgentOutput] },
		state: { type: "string", enum: [ConversationAssetLifecycle.Uploading, ConversationAssetLifecycle.Processing, ConversationAssetLifecycle.Ready, ConversationAssetLifecycle.Failed, ConversationAssetLifecycle.Cancelled, ConversationAssetLifecycle.Removed] },
		displayName: { type: "string" },
		mediaType: { type: "string" },
		byteLength: { type: ["integer", "null"], minimum: 1 },
		disposition: { type: ["string", "null"], enum: [ConversationAssetDisposition.Preview, ConversationAssetDisposition.Download, null] },
		failureCode: { type: ["string", "null"] },
		canRemove: { type: "boolean" },
		canRetry: { type: "boolean" },
		createdAt: { type: "string", format: "date-time" },
	},
} as const;

/** One successful upload command response. */
const _ConversationAssetCommandSchema = {
	type: "object",
	additionalProperties: false,
	required: ["outcome", "asset"],
	properties: { outcome: { type: "string", enum: ["accepted", "idempotent"] }, asset: _ConversationAssetSchema },
} as const;

/** One intentionally bounded public command rejection. */
const _ConversationAssetDeniedSchema = {
	type: "object",
	additionalProperties: false,
	required: ["outcome", "reason"],
	properties: { outcome: { type: "string", enum: ["denied"] }, reason: { type: "string", enum: ["invalid_request", "conversation_unavailable", "asset_unavailable", "upload_failed", "idempotency_conflict"] } },
} as const;

/** OpenAPI fragment for participant-bound conversation files. */
export const _ConversationAssetsOpenapiPaths = {
	"/me/conversations/{conversationId}/assets": {
		get: {
			operationId: "listMyConversationAssets",
			summary: "List one conversation's safe file metadata",
			description: "Returns participant-visible metadata only. Storage coordinates, leases, receipts, and scanner evidence never cross this boundary.",
			tags: ["Conversation assets"],
			parameters: [{ name: "conversationId", in: "path", required: true, schema: { type: "string" } }],
			responses: {
				200: { description: "Conversation asset metadata in stable creation order.", content: { "application/json": { schema: { type: "object", additionalProperties: false, required: ["assets"], properties: { assets: { type: "array", items: _ConversationAssetSchema } } } } } },
				401: { description: "Authentication required." },
				503: { description: "Conversation asset authority unavailable." },
			},
		},
		post: {
			operationId: "reserveMyConversationAssetUpload",
			summary: "Reserve one governed conversation upload",
			description: "The browser supplies an exact retry key and content digest. The server keeps the storage lease hidden and returns safe metadata only.",
			tags: ["Conversation assets"],
			parameters: [{ name: "conversationId", in: "path", required: true, schema: { type: "string" } }],
			requestBody: { required: true, content: { "application/json": { schema: { type: "object", additionalProperties: false, required: ["idempotencyKey", "displayName", "mediaType", "byteLength", "contentAddress"], properties: { idempotencyKey: { type: "string", minLength: 1, maxLength: 128 }, displayName: { type: "string", minLength: 1, maxLength: 255 }, mediaType: { type: "string" }, byteLength: { type: "integer", minimum: 1, maximum: 209715200 }, contentAddress: { type: "string", pattern: "^sha256:[a-f0-9]{64}$" } } } } } },
			responses: {
				201: { description: "Upload reserved.", content: { "application/json": { schema: _ConversationAssetCommandSchema } } },
				200: { description: "Exact reservation retry returned the same asset.", content: { "application/json": { schema: _ConversationAssetCommandSchema } } },
				400: { description: "Invalid reservation body.", content: { "application/json": { schema: _ConversationAssetDeniedSchema } } },
				401: { description: "Authentication required." },
				409: { description: "Conversation, retry, or asset conflict.", content: { "application/json": { schema: _ConversationAssetDeniedSchema } } },
				503: { description: "Conversation asset authority unavailable." },
			},
		},
	},
	"/me/conversations/{conversationId}/assets/{assetId}/content": {
		put: {
			operationId: "uploadMyConversationAssetContent",
			summary: "Upload exact bytes into quarantine",
			description: "A successful response means the bytes entered quarantine, not that preview or download is ready.",
			tags: ["Conversation assets"],
			parameters: [{ name: "conversationId", in: "path", required: true, schema: { type: "string" } }, { name: "assetId", in: "path", required: true, schema: { type: "string" } }],
			requestBody: { required: true, content: { "application/octet-stream": { schema: { type: "string", format: "binary" } } } },
			responses: {
				202: { description: "Exact bytes accepted into quarantine.", content: { "application/json": { schema: _ConversationAssetCommandSchema } } },
				401: { description: "Authentication required." },
				409: { description: "Upload unavailable or conflicting.", content: { "application/json": { schema: _ConversationAssetDeniedSchema } } },
				503: { description: "Conversation asset authority unavailable." },
			},
		},
	},
	"/me/conversations/{conversationId}/assets/{assetId}": {
		delete: {
			operationId: "removeMyConversationAsset",
			summary: "Remove one unlinked upload reservation",
			description: "Removal succeeds only while the returned canRemove capability is true. The response is a metadata-only tombstone.",
			tags: ["Conversation assets"],
			parameters: [{ name: "conversationId", in: "path", required: true, schema: { type: "string" } }, { name: "assetId", in: "path", required: true, schema: { type: "string" } }],
			responses: {
				200: { description: "Reservation removed or exact retry returned its tombstone.", content: { "application/json": { schema: _ConversationAssetCommandSchema } } },
				401: { description: "Authentication required." },
				409: { description: "Removal is unavailable at this lifecycle point.", content: { "application/json": { schema: _ConversationAssetDeniedSchema } } },
				503: { description: "Conversation asset authority unavailable." },
			},
		},
	},
} as const;
