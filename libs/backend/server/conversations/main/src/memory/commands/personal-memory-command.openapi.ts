import { PersonalMemoryOperationKinds } from "@opencrane/backend/agents/personal/memory";

import { PersonalMemoryCommandStates } from "./personal-memory-command-authority.types";

/** Public source coordinates accepted by personal-memory commands. */
const _SourceSchema = { type: "object", additionalProperties: false, required: ["conversationId", "messageId", "messagePosition"], properties: { conversationId: { type: "string", minLength: 1, maxLength: 128 }, messageId: { type: "string", minLength: 1, maxLength: 128 }, messagePosition: { type: "string", pattern: "^[1-9][0-9]{0,18}$", description: "Positive immutable message position no greater than 9223372036854775807." } } } as const;
/** Public body schema with one closed variant for each user intent. */
const _CommandSchema = { oneOf: [
	{ type: "object", additionalProperties: false, required: ["commandId", "kind", "source"], properties: { commandId: { type: "string", format: "uuid" }, kind: { const: PersonalMemoryOperationKinds.Remember }, source: _SourceSchema } },
	{ type: "object", additionalProperties: false, required: ["commandId", "kind", "source", "targetFactId", "expectedFactRevision"], properties: { commandId: { type: "string", format: "uuid" }, kind: { const: PersonalMemoryOperationKinds.Correct }, source: _SourceSchema, targetFactId: { type: "string", minLength: 1, maxLength: 128 }, expectedFactRevision: { type: "integer", minimum: 1, maximum: 2147483647 } } },
	{ type: "object", additionalProperties: false, required: ["commandId", "kind", "targetFactId", "expectedFactRevision"], properties: { commandId: { type: "string", format: "uuid" }, kind: { const: PersonalMemoryOperationKinds.Forget }, targetFactId: { type: "string", minLength: 1, maxLength: 128 }, expectedFactRevision: { type: "integer", minimum: 1, maximum: 2147483647 } } },
] } as const;
/** Safe receipt projection shared by admission and status responses. */
const _ReceiptSchema = { type: "object", additionalProperties: false, required: ["commandId", "operationId", "kind", "state", "revision", "resultFactId"], properties: { commandId: { type: "string", format: "uuid" }, operationId: { type: "string", format: "uuid" }, kind: { type: "string", enum: Object.values(PersonalMemoryOperationKinds) }, state: { type: "string", enum: Object.values(PersonalMemoryCommandStates) }, revision: { type: "integer", minimum: 1 }, resultFactId: { type: ["string", "null"], description: "The created or corrected fact identifier after completion; null for pending, needs_attention, and forget operations." } } } as const;
/** Shared public failures for the personal-memory command surface. */
const _Failures = { 400: { description: "Malformed command, command identifier, or unsupported query parameter." }, 401: { description: "Authentication required." }, 404: { description: "Personal memory command or already provisioned personal dataset is unavailable." }, 503: { description: "Personal memory command authority unavailable." } } as const;

/** OpenAPI paths for authenticated personal-memory command admission and status reads. */
export const _PersonalMemoryCommandOpenapiPaths = {
	"/me/memory/commands": {
		post: { operationId: "admitMyPersonalMemoryCommand", summary: "Request one personal-memory change", description: "Admits one explicit Remember, Correct, or Forget request for the caller's existing active personal dataset. Remember and Correct require current MemoryScope Manage plus Conversation Read and an own authored source message; Forget requires current MemoryScope Forget for the own fact. The first dataset is not created by this route; retry an uncertain response with the same commandId. The response proves admission only and does not provide manual retry or recovery controls.", tags: ["Personal memory"], requestBody: { required: true, content: { "application/json": { schema: _CommandSchema } } }, responses: { 202: { description: "New command admitted.", content: { "application/json": { schema: { type: "object", additionalProperties: false, required: ["outcome", "receipt"], properties: { outcome: { const: "accepted" }, receipt: _ReceiptSchema } } } } }, 200: { description: "Exact command retry recovered its saved receipt.", content: { "application/json": { schema: { type: "object", additionalProperties: false, required: ["outcome", "receipt"], properties: { outcome: { const: "idempotent" }, receipt: _ReceiptSchema } } } } }, 409: { description: "The command UUID conflicts with previously saved action evidence." }, ..._Failures } },
	},
	"/me/memory/commands/{commandId}": {
		get: { operationId: "readMyPersonalMemoryCommand", summary: "Read personal-memory command status", description: "Reads the caller's saved personal-memory command receipt after current membership, active dataset, and MemoryScope Read authorization checks. This route never dispatches, retries, or changes the operation.", tags: ["Personal memory"], parameters: [{ name: "commandId", in: "path", required: true, schema: { type: "string", format: "uuid" } }], responses: { 200: { description: "Safe command receipt.", content: { "application/json": { schema: _ReceiptSchema } } }, ..._Failures } },
	},
} as const;
