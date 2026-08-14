import { ConversationLifecycles, ConversationModes, MessageContentBlockKinds, MessageRoles, MessageSources, MessageStates } from "@opencrane/models/conversations";

import { ConversationAuthorityOutcomes } from "./types/conversation-authority-result.types";
import { PersonalAgentDirectoryStatuses } from "./types/conversation-directory.types";

/**
 * OpenAPI description of the live replay route, owned by this package rather than by the
 * central spec file, so the route and its documentation move together.
 *
 * Merged into the full document by `_DomainOpenapiPaths`
 * (libs/backend/server/api-spec/main/src/domain-openapi-paths.ts) and served at
 * `/api/v1/openapi.json`. The paths are relative to that `/api/v1` prefix and must match what
 * `__CreateSelfConversationReplayRouter` actually mounts — a mismatch here ships a wrong
 * generated client, since the same document generates the frontend SDK.
 *
 * @see https://html.spec.whatwg.org/multipage/server-sent-events.html — the 200 response is a
 * `text/event-stream`, which is why `Last-Event-ID` appears as a documented request header.
 */
export const _SelfConversationReplayOpenapiPaths = {
	"/me/conversations/{conversationId}/events": {
		get: {
			operationId: "replayMyConversationEvents",
			summary: "Replay the signed-in participant's canonical conversation events",
			description: "The server derives the participant and silo from the browser session. It streams display-safe canonical events only when that participant belongs to the selected conversation.",
			tags: ["Conversations"],
			parameters: [
				{ name: "conversationId", in: "path", required: true, schema: { type: "string" }, description: "Opaque conversation identifier." },
				{ name: "cursor", in: "query", required: false, schema: { type: "string" }, description: "Opaque canonical event cursor. The Last-Event-ID header is an equivalent resume mechanism." },
				{ name: "Last-Event-ID", in: "header", required: false, schema: { type: "string" }, description: "Opaque canonical event cursor. It must match cursor when both are supplied." },
			],
			responses: {
				200: { description: "A bounded text/event-stream replay. An empty stream does not disclose whether the conversation exists or belongs to another participant.", content: { "text/event-stream": { schema: { type: "string" } } } },
				400: { description: "The conversation identifier or replay cursor is malformed.", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
				401: { description: "No authenticated browser session owns the request.", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
				503: { description: "Canonical history could not be read.", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
			},
		},
	},
};

/**
 * Shared participant conversation summary schema kept local to the owning OpenAPI fragment.
 *
 * `participantRefs` holds opaque OrgMembership row identifiers, not login subjects: the query
 * repository translates every subject through `_membershipReferences` before projecting a summary.
 * The field was called `participantUserIds` and carried the OIDC subject until this slice, so a
 * generated client that still reads that name is out of date, and the two identifier spaces must
 * not be mixed: a `participantRef` is only meaningful inside the caller's own silo.
 */
const _ConversationSummarySchema = {
	type: "object",
	additionalProperties: false,
	required: ["id", "mode", "lifecycle", "agentServiceId", "participantRefs", "archivedAt", "readThroughPosition", "updatedAt"],
	properties: {
		id: { type: "string" },
		mode: { type: "string", enum: [ConversationModes.AgentSession, ConversationModes.Direct, ConversationModes.Group] },
		lifecycle: { type: "string", enum: [ConversationLifecycles.Open, ConversationLifecycles.Closed] },
		agentServiceId: { type: ["string", "null"] },
		participantRefs: { type: "array", items: { type: "string" } },
		archivedAt: { type: ["string", "null"], format: "date-time" },
		readThroughPosition: { type: "string", pattern: "^(0|[1-9][0-9]*)$" },
		updatedAt: { type: "string", format: "date-time" },
	},
} as const;

/** Canonical display-safe content block returned inside participant-visible messages. */
const _ConversationMessageBlockSchema = {
	type: "object",
	additionalProperties: false,
	required: ["id", "kind", "value"],
	properties: {
		id: { type: "string" },
		kind: { type: "string", enum: [MessageContentBlockKinds.Text, MessageContentBlockKinds.Artifact, MessageContentBlockKinds.ToolCall, MessageContentBlockKinds.ToolResult] },
		value: { type: "string" },
	},
} as const;

/** Immutable breadcrumb coordinates returned for an Agent-targeted group message. */
const _AgentThreadOriginSchema = {
	type: "object", additionalProperties: false,
	required: ["childConversationId", "parentConversationId", "rootConversationId", "parentMessageId", "initiatorUserId", "agentServiceId", "personaRevisionId", "firstRunId"],
	properties: { childConversationId: { type: "string" }, parentConversationId: { type: "string" }, rootConversationId: { type: "string" }, parentMessageId: { type: "string" }, initiatorUserId: { type: "string" }, agentServiceId: { type: "string" }, personaRevisionId: { type: "string" }, firstRunId: { type: "string" } },
} as const;

/**
 * Canonical participant-visible message schema shared by detail and submission responses.
 *
 * `participantRef` names the author with the same opaque membership reference as
 * {@link _ConversationSummarySchema}, replacing the `userId` field that used to carry the OIDC
 * subject. It is null for anything a person did not write, and never for participant input: the
 * reviewed baseline's `conversation_messages_provenance_check` requires `user_id` on `user_input`
 * rows and forbids it on model output, tool results, and platform messages. So a client may read
 * null as "the Agent or the platform wrote this", not as "unknown user".
 */
const _ConversationMessageSchema = {
	type: "object",
	additionalProperties: false,
	required: ["id", "position", "role", "state", "source", "blocks", "runId", "participantRef", "createdAt", "completedAt", "agentThread"],
	properties: {
		id: { type: "string" },
		position: { type: "string", pattern: "^(0|[1-9][0-9]*)$" },
		role: { type: "string", enum: [MessageRoles.User, MessageRoles.Assistant, MessageRoles.Tool, MessageRoles.System] },
		state: { type: "string", enum: [MessageStates.Pending, MessageStates.Streaming, MessageStates.Completed, MessageStates.Failed, MessageStates.Cancelled] },
		source: { type: "string", enum: [MessageSources.UserInput, MessageSources.ModelOutput, MessageSources.ToolResult, MessageSources.Platform] },
		blocks: { type: "array", items: _ConversationMessageBlockSchema },
		runId: { type: ["string", "null"] },
		participantRef: { type: ["string", "null"] },
		createdAt: { type: "string", format: "date-time" },
		completedAt: { type: ["string", "null"], format: "date-time" },
		agentThread: { oneOf: [{ type: "null" }, _AgentThreadOriginSchema] },
	},
} as const;

/** Participant-visible conversation detail including its bounded canonical history. */
const _ConversationDetailSchema = {
	type: "object",
	additionalProperties: false,
	required: [..._ConversationSummarySchema.required, "visibleFromPosition", "accessEndedPosition", "messages"],
	properties: {
		..._ConversationSummarySchema.properties,
		visibleFromPosition: { type: "string", pattern: "^(0|[1-9][0-9]*)$" },
		accessEndedPosition: { type: ["string", "null"], pattern: "^(0|[1-9][0-9]*)$" },
		messages: { type: "array", items: _ConversationMessageSchema },
	},
} as const;

/** Exact envelope returned when an endpoint projects one conversation detail. */
const _ConversationDetailEnvelopeSchema = {
	type: "object",
	additionalProperties: false,
	required: ["conversation"],
	properties: { conversation: _ConversationDetailSchema },
} as const;

/** Exact accepted-message response, distinct from an idempotent replay. */
const _AcceptedConversationMessageEnvelopeSchema = {
	type: "object",
	additionalProperties: false,
	required: ["outcome", "message", "agentThread"],
	properties: { outcome: { type: "string", enum: ["accepted"] }, message: _ConversationMessageSchema, agentThread: { oneOf: [{ type: "null" }, _AgentThreadOriginSchema] } },
} as const;

/** Exact idempotent-message response, distinct from a newly accepted write. */
const _IdempotentConversationMessageEnvelopeSchema = {
	type: "object",
	additionalProperties: false,
	required: ["outcome", "message", "agentThread"],
	properties: { outcome: { type: "string", enum: ["idempotent"] }, message: _ConversationMessageSchema, agentThread: { oneOf: [{ type: "null" }, _AgentThreadOriginSchema] } },
} as const;

/** Child message schema that omits participant login identifiers and nested authority. */
const _AgentThreadMessageSchema = {
	type: "object",
	additionalProperties: false,
	required: ["id", "position", "role", "state", "source", "blocks", "runId", "createdAt", "completedAt"],
	properties: {
		id: { type: "string" },
		position: { type: "string", pattern: "^(0|[1-9][0-9]*)$" },
		role: { type: "string", enum: [MessageRoles.User, MessageRoles.Assistant, MessageRoles.Tool, MessageRoles.System] },
		state: { type: "string", enum: [MessageStates.Pending, MessageStates.Streaming, MessageStates.Completed, MessageStates.Failed, MessageStates.Cancelled] },
		source: { type: "string", enum: [MessageSources.UserInput, MessageSources.ModelOutput, MessageSources.ToolResult, MessageSources.Platform] },
		blocks: { type: "array", items: _ConversationMessageBlockSchema },
		runId: { type: ["string", "null"] },
		createdAt: { type: "string", format: "date-time" },
		completedAt: { type: ["string", "null"], format: "date-time" },
	},
} as const;

/** Bounded Agent-thread read model that omits participant login identifiers. */
const _AgentThreadSnapshotSchema = {
	type: "object", additionalProperties: false,
	required: ["parentConversationId", "childConversationId", "rootConversationId", "parentMessageId", "agentServiceId", "agentName", "ask", "createdAt", "lifecycle", "participantCount", "readThroughPosition", "latestPosition", "representedThroughPosition", "messageCount", "unreadMessageCount", "cursor", "messages", "runs", "deliveries"],
	properties: {
		parentConversationId: { type: "string" }, childConversationId: { type: "string" }, rootConversationId: { type: "string" }, parentMessageId: { type: "string" }, agentServiceId: { type: "string" }, agentName: { type: "string" }, ask: { type: "string" }, createdAt: { type: "string", format: "date-time" }, lifecycle: { type: "string", enum: [ConversationLifecycles.Open, ConversationLifecycles.Closed] }, participantCount: { type: "integer", minimum: 1 }, readThroughPosition: { type: "string", pattern: "^(0|[1-9][0-9]*)$" }, latestPosition: { type: "string", pattern: "^(0|[1-9][0-9]*)$" }, representedThroughPosition: { type: "string", pattern: "^(0|[1-9][0-9]*)$" }, messageCount: { type: "integer", minimum: 0 }, unreadMessageCount: { type: "integer", minimum: 0 }, cursor: { type: ["string", "null"] }, messages: { type: "array", items: _AgentThreadMessageSchema },
		runs: { type: "array", items: { type: "object", additionalProperties: false, required: ["id", "ordinal", "attempt", "state", "acceptedAt", "finishedAt"], properties: { id: { type: "string" }, ordinal: { type: "integer", minimum: 1 }, attempt: { type: "integer", minimum: 1 }, state: { type: "string", enum: ["queued", "working", "waiting", "retrying", "completed", "failed", "cancelled"] }, acceptedAt: { type: "string", format: "date-time" }, finishedAt: { type: ["string", "null"], format: "date-time" } } } },
		deliveries: { type: "array", items: { type: "object", additionalProperties: false, required: ["id", "childConversationId", "parentConversationId", "runId", "kind", "label", "detail", "assetId", "createdAt"], properties: { id: { type: "string" }, childConversationId: { type: "string" }, parentConversationId: { type: "string" }, runId: { type: "string" }, kind: { type: "string", enum: ["status", "question", "approval", "result", "failure", "asset"] }, label: { type: "string" }, detail: { type: "string" }, assetId: { type: ["string", "null"] }, createdAt: { type: "string", format: "date-time" } } } },
	},
} as const;

/**
 * OpenAPI description of the ten conversation operations, kept beside the router that serves them.
 *
 * Merged into the full document by `_DomainOpenapiPaths`
 * (libs/backend/server/api-spec/main/src/domain-openapi-paths.ts) and used to generate the
 * frontend client, so the documented statuses must match `_STATUS_BY_DENIAL` in
 * self-conversations.router.ts. In particular the message route documents 201 for a new message
 * and 200 for an identical retry — two different bodies, distinguished by the `outcome` field.
 * The run-retry route repeats that pair, and `_runRetryDenialStatus` maps its denials.
 *
 * @see {@link _SelfConversationReplayOpenapiPaths} for the live stream on the same path prefix.
 */
export const _SelfConversationsOpenapiPaths = {
	// The directory is what a client must call before it can create anything: creation now accepts
	// only references issued here, never a login subject. `openapi.test.ts` asserts this response
	// schema contains neither `subject` nor `email`.
	//
	// There is no 404 and no 403. A caller whose organisation membership has been revoked makes
	// `PrismaConversationQueryRepository.directory` throw, and the router turns any throw into 503 —
	// so a revoked user sees "unavailable", not a distinct "you were removed" answer.
	"/me/conversations/directory": {
		get: {
			operationId: "getMyConversationCreationDirectory",
			summary: "List self-scoped conversation creation choices",
			description: "Returns opaque active-member references and the caller's personal Agent only when exactly one active service matches their approved persona. It never returns login subjects, emails, roles, or memory identity.",
			tags: ["Conversations"],
			responses: { 200: { description: "Privacy-safe creation choices.", content: { "application/json": { schema: { type: "object", additionalProperties: false, required: ["directory"], properties: { directory: { type: "object", additionalProperties: false, required: ["participants", "personalAgentStatus", "personalAgent"], properties: { participants: { type: "array", items: { type: "object", additionalProperties: false, required: ["participantRef", "isSelf"], properties: { participantRef: { type: "string" }, isSelf: { type: "boolean" } } } }, personalAgentStatus: { type: "string", enum: Object.values(PersonalAgentDirectoryStatuses) }, personalAgent: { oneOf: [{ type: "null" }, { type: "object", additionalProperties: false, required: ["personalAgentRef", "displayName"], properties: { personalAgentRef: { type: "string" }, displayName: { type: "string" } } }] } } } } } } } }, 401: { description: "Authentication required." }, 503: { description: "Conversation directory unavailable." } },
		},
	},
	"/me/conversations": {
		get: {
			operationId: "listMyConversations",
			summary: "List the signed-in participant's conversations",
			tags: ["Conversations"],
			parameters: [{ name: "includeArchived", in: "query", required: false, schema: { type: "boolean", default: false } }],
			responses: { 200: { description: "Participant-bound conversation summaries.", content: { "application/json": { schema: { type: "object", additionalProperties: false, required: ["conversations"], properties: { conversations: { type: "array", items: _ConversationSummarySchema } } } } } }, 401: { description: "Authentication required." }, 503: { description: "Conversation authority unavailable." } },
		},
		post: {
			operationId: "createMyConversation",
			summary: "Create one immutable-mode conversation",
			tags: ["Conversations"],
			requestBody: { required: true, content: { "application/json": { schema: { oneOf: [
				{ type: "object", additionalProperties: false, required: ["mode", "personalAgentRef"], properties: { mode: { type: "string", enum: [ConversationModes.AgentSession] }, personalAgentRef: { type: "string" } } },
				{ type: "object", additionalProperties: false, required: ["mode", "participantRefs"], properties: { mode: { type: "string", enum: [ConversationModes.Direct] }, participantRefs: { type: "array", items: { type: "string" }, minItems: 1, maxItems: 1 } } },
				{ type: "object", additionalProperties: false, required: ["mode", "participantRefs"], properties: { mode: { type: "string", enum: [ConversationModes.Group] }, participantRefs: { type: "array", items: { type: "string" }, minItems: 1, maxItems: 99 } } },
			] } } } },
			responses: { 201: { description: "Conversation created with its bounded canonical history.", content: { "application/json": { schema: _ConversationDetailEnvelopeSchema } } }, 400: { description: "Invalid immutable-mode request." }, 401: { description: "Authentication required." }, 404: { description: "A participant or agent service is unavailable." }, 503: { description: "Conversation authority unavailable." } },
		},
	},
"/me/conversations/{conversationId}": {
		get: {
			operationId: "openMyConversation",
			summary: "Open one participant-bound conversation",
			tags: ["Conversations"],
			parameters: [{ name: "conversationId", in: "path", required: true, schema: { type: "string" } }],
			responses: { 200: { description: "Conversation detail with bounded canonical message history.", content: { "application/json": { schema: _ConversationDetailEnvelopeSchema } } }, 401: { description: "Authentication required." }, 404: { description: "Conversation unavailable." }, 503: { description: "Conversation authority unavailable." } },
		},
	},
	"/me/conversations/{parentConversationId}/agent-threads/{childConversationId}": {
		get: {
			operationId: "openMyAgentThread",
			summary: "Open one authorized child Agent-thread read model",
			description: "Composes a bounded view from canonical conversation, run, and parent-delivery authorities. It creates no second ledger and requires current participant access in both parent and child.",
			tags: ["Conversations"],
			parameters: [{ name: "parentConversationId", in: "path", required: true, schema: { type: "string" } }, { name: "childConversationId", in: "path", required: true, schema: { type: "string" } }],
			responses: { 200: { description: "Authorized Agent-thread snapshot.", content: { "application/json": { schema: { type: "object", additionalProperties: false, required: ["agentThread"], properties: { agentThread: _AgentThreadSnapshotSchema } } } } }, 401: { description: "Authentication required." }, 404: { description: "Agent thread unavailable." }, 503: { description: "Conversation authority unavailable." } },
		},
	},
	"/me/conversations/{parentConversationId}/agent-threads/{childConversationId}/read-through": {
		put: {
			operationId: "markMyAgentThreadRead",
			summary: "Advance this participant's Agent-thread read position",
			description: "Idempotently advances one participant-local coordinate only after current parent and child access are rechecked. The observed position cannot exceed the current child timeline.",
			tags: ["Conversations"],
			parameters: [{ name: "parentConversationId", in: "path", required: true, schema: { type: "string" } }, { name: "childConversationId", in: "path", required: true, schema: { type: "string" } }],
			requestBody: { required: true, content: { "application/json": { schema: { type: "object", additionalProperties: false, required: ["observedPosition"], properties: { observedPosition: { type: "string", pattern: "^(0|[1-9][0-9]*)$", maxLength: 19 } } } } } },
			responses: { 200: { description: "Participant read coordinate changed or was already at least this position.", content: { "application/json": { schema: { type: "object", additionalProperties: false, required: ["outcome", "readThroughPosition"], properties: { outcome: { type: "string", enum: [ConversationAuthorityOutcomes.Changed, ConversationAuthorityOutcomes.Idempotent] }, readThroughPosition: { type: "string", pattern: "^(0|[1-9][0-9]*)$" } } } } } }, 400: { description: "Malformed observed position." }, 401: { description: "Authentication required." }, 404: { description: "Agent thread unavailable." }, 409: { description: "Observed position exceeds the current child timeline." }, 503: { description: "Conversation authority unavailable." } },
		},
	},
	"/me/conversations/{conversationId}/messages": {
		post: {
			operationId: "submitMyConversationMessage",
			summary: "Submit participant input through the immutable mode strategy",
			description: "Agent-session input is committed atomically with a governed run. Direct and ordinary group input is committed without creating an AgentRun.",
			tags: ["Conversations"],
			parameters: [{ name: "conversationId", in: "path", required: true, schema: { type: "string" } }],
			requestBody: {
				required: true,
				content: {
					"application/json": {
						schema: {
							type: "object",
							additionalProperties: false,
							required: ["idempotencyKey", "blocks"],
							properties: {
								idempotencyKey: { type: "string", maxLength: 128 },
								blocks: {
									type: "array",
									minItems: 1,
									maxItems: 32,
									items: {
										type: "object",
										additionalProperties: false,
										required: ["id", "kind", "value"],
										properties: { id: { type: "string" }, kind: { type: "string", enum: [MessageContentBlockKinds.Text, MessageContentBlockKinds.Artifact] }, value: { type: "string", maxLength: 32000 } },
									},
								},
								agentTarget: { type: "object", additionalProperties: false, required: ["agentServiceId"], properties: { agentServiceId: { type: "string", maxLength: 128 } }, description: "In a group only, create a child Agent session using the caller's active approved persona." },
							},
						},
					},
				},
			},
			responses: { 201: { description: "Message accepted.", content: { "application/json": { schema: _AcceptedConversationMessageEnvelopeSchema } } }, 200: { description: "Exact idempotent retry returned the canonical message.", content: { "application/json": { schema: _IdempotentConversationMessageEnvelopeSchema } } }, 400: { description: "Invalid message body." }, 401: { description: "Authentication required." }, 404: { description: "Conversation unavailable." }, 409: { description: "Closed, active-run, mode, or idempotency conflict." }, 429: { description: "Conversation admission capacity is currently full; retry later." }, 503: { description: "Admission authority unavailable." } },
		},
	},
	// Retry increases the attempt counter on the SAME run rather than creating a second one, which
	// is why the success bodies return `attempt` with a minimum of 2 and why `expectedAttempt` is
	// required: `__StartNextRunAttempt` uses it as a compare-and-swap guard, so two clients racing
	// on the same failed attempt cannot both start one.
	//
	// 200 versus 201 is the client's only way to tell a fresh start from a replay of the same retry
	// key, and 404 deliberately covers both "no such run" and "that run is not in a conversation you
	// participate in" so the route cannot be used to discover other people's runs.
	"/me/conversations/{conversationId}/runs/{runId}/retry": {
		post: {
			operationId: "retryMyConversationRun",
			summary: "Start a fresh attempt for one failed conversation run",
			description: "Requires current organisation membership, active conversation participation, the exact terminal attempt, the still-active Agent revision, and a fresh retry key. Repeating the same key returns the same new attempt.",
			tags: ["Conversations"],
			parameters: [{ name: "conversationId", in: "path", required: true, schema: { type: "string" } }, { name: "runId", in: "path", required: true, schema: { type: "string" } }],
			requestBody: { required: true, content: { "application/json": { schema: { type: "object", additionalProperties: false, required: ["expectedAttempt", "idempotencyKey"], properties: { expectedAttempt: { type: "integer", minimum: 1 }, idempotencyKey: { type: "string", minLength: 1, maxLength: 128 } } } } } },
			responses: { 201: { description: "Fresh attempt started.", content: { "application/json": { schema: { type: "object", additionalProperties: false, required: ["outcome", "runId", "attempt"], properties: { outcome: { type: "string", enum: ["started"] }, runId: { type: "string" }, attempt: { type: "integer", minimum: 2 } } } } } }, 200: { description: "The same retry key already started this attempt.", content: { "application/json": { schema: { type: "object", additionalProperties: false, required: ["outcome", "runId", "attempt"], properties: { outcome: { type: "string", enum: ["idempotent"] }, runId: { type: "string" }, attempt: { type: "integer", minimum: 2 } } } } } }, 400: { description: "Malformed retry request." }, 401: { description: "Authentication required." }, 404: { description: "Conversation run unavailable to this participant." }, 409: { description: "Attempt, terminal state, active Agent service, or revision no longer permits retry." }, 503: { description: "Retry authority unavailable." } },
		},
	},
	"/me/conversations/{conversationId}/archive": {
		patch: {
			operationId: "archiveMyConversation",
			summary: "Change participant-local archive visibility",
			tags: ["Conversations"],
			parameters: [{ name: "conversationId", in: "path", required: true, schema: { type: "string" } }],
			requestBody: { required: true, content: { "application/json": { schema: { type: "object", additionalProperties: false, required: ["archived"], properties: { archived: { type: "boolean" } } } } } },
			responses: { 200: { description: "Participant archive visibility changed.", content: { "application/json": { schema: _ConversationDetailEnvelopeSchema } } }, 400: { description: "Invalid archive request." }, 401: { description: "Authentication required." }, 404: { description: "Conversation unavailable." }, 503: { description: "Conversation authority unavailable." } },
		},
	},
	"/me/conversations/{conversationId}/close": {
		post: {
			operationId: "closeMyConversation",
			summary: "Permanently close one conversation",
			tags: ["Conversations"],
			parameters: [{ name: "conversationId", in: "path", required: true, schema: { type: "string" } }],
			responses: { 200: { description: "Conversation permanently closed.", content: { "application/json": { schema: _ConversationDetailEnvelopeSchema } } }, 401: { description: "Authentication required." }, 404: { description: "Conversation unavailable." }, 409: { description: "An active foreground run prevents closure." }, 503: { description: "Conversation authority unavailable." } },
		},
	},
} as const;
