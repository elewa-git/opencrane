import { RoutineFiringReasons, RoutineProposalStates } from "@opencrane/contracts";
import { AgentRunTerminalReasons, RoutineFiringDisposition, RoutineFiringTrigger, RoutineStatus } from "@opencrane/models/agents";

/** Opaque public identifier shared by routine paths and payloads. */
const _IdentifierSchema = { type: "string", minLength: 1, maxLength: 200 } as const;

/** Caller retry key shared by every routine mutation. */
const _IdempotencyKeySchema = _IdentifierSchema;

/** Positive revision counter used for optimistic command checks. */
const _RevisionSchema = { type: "integer", minimum: 1, maximum: Number.MAX_SAFE_INTEGER } as const;

/** Five-field cron expression and named timezone accepted by the routine model. */
const _ScheduleSchema = { type: "object", additionalProperties: false, required: ["expression", "timezone"], properties: { expression: { type: "string", minLength: 1, maxLength: 256 }, timezone: { type: "string", minLength: 1, maxLength: 128 } } } as const;

/** Fields returned after a definition or lifecycle command. */
const _DefinitionSchema = { type: "object", additionalProperties: false, required: ["routineId", "currentRevision", "status", "lifecycleRevision", "nextAutomaticOccurrence"], properties: { routineId: _IdentifierSchema, currentRevision: _RevisionSchema, status: { type: "string", enum: Object.values(RoutineStatus) }, lifecycleRevision: _RevisionSchema, nextAutomaticOccurrence: { type: ["string", "null"], format: "date-time" } } } as const;

/** Fields returned after an authorized routine read. */
const _ParticipantChoiceSchema = { type: "object", additionalProperties: false, required: ["participantRef", "displayName", "isSelf"], properties: { participantRef: _IdentifierSchema, displayName: { type: "string", minLength: 1, maxLength: 200 }, isSelf: { type: "boolean" } } } as const;
const _ManagedServiceSchema = { type: "object", additionalProperties: false, required: ["managedServiceId", "displayName"], properties: { managedServiceId: _IdentifierSchema, displayName: { type: "string", minLength: 1, maxLength: 200 } } } as const;
const _CapabilitiesSchema = { type: "object", additionalProperties: false, required: ["revise", "pause", "resume", "retire", "runNow"], properties: { revise: { type: "boolean" }, pause: { type: "boolean" }, resume: { type: "boolean" }, retire: { type: "boolean" }, runNow: { type: "boolean" } } } as const;
const _LastFiringSchema = { type: "object", additionalProperties: false, required: ["firingId", "routineRevision", "trigger", "disposition", "scheduledSlot", "finishedAt"], properties: { firingId: _IdentifierSchema, routineRevision: _RevisionSchema, trigger: { type: "string", enum: Object.values(RoutineFiringTrigger) }, disposition: { type: "string", enum: Object.values(RoutineFiringDisposition) }, scheduledSlot: { type: ["string", "null"], format: "date-time" }, finishedAt: { type: ["string", "null"], format: "date-time" } } } as const;
const _ListItemSchema = { type: "object", additionalProperties: false, required: ["routineId", "currentRevision", "status", "lifecycleRevision", "ownership", "destinationConversationId", "selectedManagedService", "schedule", "lastAutomaticOccurrence", "nextAutomaticOccurrence", "lastFiring", "capabilities"], properties: { ..._DefinitionSchema.properties, ownership: { type: "string", enum: ["owner", "audience"] }, destinationConversationId: _IdentifierSchema, selectedManagedService: _ManagedServiceSchema, schedule: _ScheduleSchema, lastAutomaticOccurrence: { type: ["string", "null"], format: "date-time" }, lastFiring: { anyOf: [_LastFiringSchema, { type: "null" }] }, capabilities: _CapabilitiesSchema } } as const;
const _DetailsSchema = { type: "object", additionalProperties: false, required: [...Object.keys(_ListItemSchema.properties), "audienceParticipantRefs", "audienceChoices", "instruction"], properties: { ..._ListItemSchema.properties, audienceParticipantRefs: { type: "array", minItems: 1, maxItems: 100, uniqueItems: true, items: _IdentifierSchema }, audienceChoices: { type: "array", minItems: 1, maxItems: 100, items: _ParticipantChoiceSchema }, instruction: { type: "string", minLength: 1, maxLength: 20_000 } } } as const;

/** Fields returned after a manual firing command. */
const _FiringSchema = { type: "object", additionalProperties: false, required: ["firingId", "routineId", "routineRevision", "trigger", "disposition", "scheduledSlot", "reason"], properties: { firingId: _IdentifierSchema, routineId: _IdentifierSchema, routineRevision: _RevisionSchema, trigger: { type: "string", enum: Object.values(RoutineFiringTrigger) }, disposition: { type: "string", enum: Object.values(RoutineFiringDisposition) }, scheduledSlot: { type: ["string", "null"], format: "date-time" }, reason: { type: ["string", "null"], enum: [...Object.values(RoutineFiringReasons), null] } } } as const;
const _HistoryFiringSchema = { type: "object", additionalProperties: false, required: ["firingId", "routineRevision", "trigger", "disposition", "scheduledSlot", "createdAt", "finishedAt", "reason", "runTerminalReason", "resultConversationId", "actualCost"], properties: { firingId: _IdentifierSchema, routineRevision: _RevisionSchema, trigger: { type: "string", enum: Object.values(RoutineFiringTrigger) }, disposition: { type: "string", enum: Object.values(RoutineFiringDisposition) }, scheduledSlot: { type: ["string", "null"], format: "date-time" }, createdAt: { type: "string", format: "date-time" }, finishedAt: { type: ["string", "null"], format: "date-time" }, reason: { type: ["string", "null"], enum: [...Object.values(RoutineFiringReasons), null] }, runTerminalReason: { type: ["string", "null"], enum: [...Object.values(AgentRunTerminalReasons), null] }, resultConversationId: { type: ["string", "null"], minLength: 1, maxLength: 200 }, actualCost: { anyOf: [{ type: "object", additionalProperties: false, required: ["amount", "currency"], properties: { amount: { type: "string", minLength: 1, maxLength: 64 }, currency: { type: "string", minLength: 1, maxLength: 16 } } }, { type: "null" }] } } } as const;

/** Routine definition response envelope. */
const _DefinitionResponseSchema = { type: "object", additionalProperties: false, required: ["routine"], properties: { routine: _DefinitionSchema } } as const;

/** Authorized routine detail response envelope. */
const _DetailsResponseSchema = { type: "object", additionalProperties: false, required: ["routine"], properties: { routine: _DetailsSchema } } as const;

/** Routine firing response envelope. */
const _FiringResponseSchema = { type: "object", additionalProperties: false, required: ["firing"], properties: { firing: _FiringSchema } } as const;
const _ListQueryParameters = [{ name: "limit", in: "query", required: false, schema: { type: "integer", minimum: 1, maximum: 25, default: 20 } }, { name: "cursor", in: "query", required: false, schema: { type: "string", minLength: 1, maxLength: 2_048, pattern: "^[A-Za-z0-9_-]+$" } }] as const;
function _PageSchema(item: unknown)
{
	return { type: "object", additionalProperties: false, required: ["items", "limit"], properties: { items: { type: "array", items: item }, limit: { type: "integer", minimum: 1, maximum: 25 }, nextCursor: { type: "string", minLength: 1, maxLength: 2_048 } } } as const;
}
const _CreationOptionsSchema = { type: "object", additionalProperties: false, required: ["destinationConversationId", "audienceChoices", "managedServiceChoices"], properties: { destinationConversationId: _IdentifierSchema, audienceChoices: { type: "array", items: _ParticipantChoiceSchema }, managedServiceChoices: { type: "array", items: _ManagedServiceSchema } } } as const;
const _PreviewRequestSchema = { type: "object", additionalProperties: false, required: ["schedule"], properties: { schedule: _ScheduleSchema } } as const;
const _PreviewResponseSchema = { type: "object", additionalProperties: false, required: ["schedule", "calculatedAt", "nextOccurrences"], properties: { schedule: _ScheduleSchema, calculatedAt: { type: "string", format: "date-time" }, nextOccurrences: { type: "array", minItems: 5, maxItems: 5, items: { type: "string", format: "date-time" } } } } as const;

/** Requester-only proposal projection with accepted routine identity constrained to its state. */
const _ProposalBaseProperties = { proposalRef: _IdentifierSchema, sourceConversationId: _IdentifierSchema, suggestion: { type: "object", additionalProperties: false, required: ["instruction", "schedule"], properties: { instruction: { type: "string", minLength: 1, maxLength: 20_000 }, schedule: _ScheduleSchema } }, expiresAt: { type: "string", format: "date-time" } } as const;
const _ProposalSchema = { oneOf: [
	{ type: "object", additionalProperties: false, required: [...Object.keys(_ProposalBaseProperties), "state"], properties: { ..._ProposalBaseProperties, state: { const: RoutineProposalStates.Pending } } },
	{ type: "object", additionalProperties: false, required: [...Object.keys(_ProposalBaseProperties), "state", "acceptedRoutineId"], properties: { ..._ProposalBaseProperties, state: { const: RoutineProposalStates.Accepted }, acceptedRoutineId: _IdentifierSchema } },
	{ type: "object", additionalProperties: false, required: [...Object.keys(_ProposalBaseProperties), "state"], properties: { ..._ProposalBaseProperties, state: { enum: [RoutineProposalStates.Cancelled, RoutineProposalStates.Expired] } } },
], discriminator: { propertyName: "state" } } as const;

/** Request that creates a reviewed routine. */
const _CreateRequestSchema = { type: "object", additionalProperties: false, required: ["destinationConversationId", "audienceParticipantRefs", "selectedManagedServiceId", "schedule", "instruction", "idempotencyKey"], properties: { destinationConversationId: _IdentifierSchema, audienceParticipantRefs: { type: "array", minItems: 1, maxItems: 100, uniqueItems: true, items: _IdentifierSchema }, selectedManagedServiceId: _IdentifierSchema, schedule: _ScheduleSchema, instruction: { type: "string", minLength: 1, maxLength: 20_000 }, idempotencyKey: _IdempotencyKeySchema, proposalRef: _IdentifierSchema } } as const;

/** Request that replaces a routine schedule and instruction. */
const _ReviseRequestSchema = { type: "object", additionalProperties: false, required: ["expectedRevision", "expectedLifecycleRevision", "schedule", "instruction", "idempotencyKey"], properties: { expectedRevision: _RevisionSchema, expectedLifecycleRevision: _RevisionSchema, schedule: _ScheduleSchema, instruction: { type: "string", minLength: 1, maxLength: 20_000 }, idempotencyKey: _IdempotencyKeySchema } } as const;

/** Request shared by lifecycle and run-now commands. */
const _ControlRequestSchema = { type: "object", additionalProperties: false, required: ["expectedLifecycleRevision", "idempotencyKey"], properties: { expectedLifecycleRevision: _RevisionSchema, idempotencyKey: _IdempotencyKeySchema } } as const;

/** Shared response descriptions for authenticated routine operations. */
const _Errors = {
	400: { description: "The path or request body does not satisfy the routine command contract." },
	401: { description: "A current authenticated Principal and authentication instant are required." },
	404: { description: "The routine or another protected resource is unavailable to this caller." },
	409: { description: "The saved revision, lifecycle state or idempotency key conflicts with this command." },
	503: { description: "A routine dependency is unavailable or saved state failed validation. Read current state before retrying an uncertain mutation." },
} as const;

/** Builds the shared OpenAPI operation for a lifecycle command. */
function _ControlOperation(operationId: string, summary: string)
{
	return { operationId, summary, tags: ["Routines"], parameters: [_RoutineIdParameter], requestBody: { required: true, content: { "application/json": { schema: _ControlRequestSchema } } }, responses: { 200: { description: "Committed or recovered routine definition.", content: { "application/json": { schema: _DefinitionResponseSchema } } }, ..._Errors } } as const;
}

/** Routine identifier supplied by every resource-specific operation. */
const _RoutineIdParameter = { name: "routineId", in: "path", required: true, schema: _IdentifierSchema, description: "Stable routine identifier returned by creation." } as const;
const _ProposalRefParameter = { name: "proposalRef", in: "path", required: true, schema: _IdentifierSchema, description: "Opaque routine proposal reference from the requester notification." } as const;

/** Authenticated routine paths contributed to the complete API specification. */
export const _RoutineOpenapiPaths = {
	"/me/routines": {
		get: {
			operationId: "listRoutines", summary: "List authorized routines", tags: ["Routines"], parameters: _ListQueryParameters,
			responses: { 200: { description: "Authorized routine page.", content: { "application/json": { schema: _PageSchema(_ListItemSchema) } } }, ..._Errors },
		},
		post: {
			operationId: "createRoutine", summary: "Create a reviewed routine", tags: ["Routines"],
			description: "Creates one active routine from a caller-reviewed conversation, audience, managed assistant, schedule and instruction. The server derives caller identity from the authenticated request and encrypts the instruction before the transaction.",
			requestBody: { required: true, content: { "application/json": { schema: _CreateRequestSchema } } },
			responses: { 201: { description: "Committed or recovered routine definition.", content: { "application/json": { schema: _DefinitionResponseSchema } } }, ..._Errors },
		},
	},
	"/me/routines/creation-options": {
		get: {
			operationId: "getRoutineCreationOptions", summary: "Get routine creation options", tags: ["Routines"], parameters: [{ name: "destinationConversationId", in: "query", required: true, schema: _IdentifierSchema }],
			responses: { 200: { description: "Authorized routine creation options.", content: { "application/json": { schema: _CreationOptionsSchema } } }, ..._Errors },
		},
	},
	"/me/routines/schedule-preview": {
		post: {
			operationId: "previewRoutineSchedule", summary: "Preview upcoming routine slots", tags: ["Routines"], requestBody: { required: true, content: { "application/json": { schema: _PreviewRequestSchema } } },
			responses: { 200: { description: "Five upcoming schedule slots.", content: { "application/json": { schema: _PreviewResponseSchema } } }, ..._Errors },
		},
	},
	"/me/routines/proposals/{proposalRef}": {
		get: {
			operationId: "getRoutineProposal", summary: "Read a routine proposal", tags: ["Routines"], parameters: [_ProposalRefParameter],
			description: "Returns decrypted suggestion content only to the original requester while current source-conversation access remains valid. A database-clock expiry is committed before return.",
			responses: { 200: { description: "Current requester-owned proposal.", content: { "application/json": { schema: _ProposalSchema } } }, 400: _Errors[400], 401: _Errors[401], 404: _Errors[404], 503: _Errors[503] },
		},
		delete: {
			operationId: "cancelRoutineProposal", summary: "Cancel a routine proposal", tags: ["Routines"], parameters: [_ProposalRefParameter],
			description: "Closes a pending proposal without creating a routine, or returns the durable terminal winner after concurrent acceptance, cancellation or expiry.",
			responses: { 200: { description: "Durable proposal state.", content: { "application/json": { schema: _ProposalSchema } } }, 400: _Errors[400], 401: _Errors[401], 404: _Errors[404], 503: _Errors[503] },
		},
	},
	"/me/routines/{routineId}": {
		get: {
			operationId: "getRoutine", summary: "Read an authorized routine", tags: ["Routines"], parameters: [_RoutineIdParameter],
			description: "Returns the decrypted current instruction and fixed reviewed audience only after current routine and destination access checks. Requester identity and encrypted storage fields are never returned.",
			responses: { 200: { description: "Authorized routine details.", content: { "application/json": { schema: _DetailsResponseSchema } } }, 400: _Errors[400], 401: _Errors[401], 404: _Errors[404], 503: _Errors[503] },
		},
	},
	"/me/routines/{routineId}/firings": {
		get: {
			operationId: "listRoutineFirings", summary: "List routine firing history", tags: ["Routines"], parameters: [_RoutineIdParameter, ..._ListQueryParameters],
			responses: { 200: { description: "Authorized firing history page.", content: { "application/json": { schema: _PageSchema(_HistoryFiringSchema) } } }, ..._Errors },
		},
	},
	"/me/routines/{routineId}/revise": {
		post: {
			operationId: "reviseRoutine", summary: "Replace a routine schedule and instruction", tags: ["Routines"], parameters: [_RoutineIdParameter],
			description: "The original requester appends an immutable revision under the reviewed definition and lifecycle counters. The fixed destination, audience and managed assistant do not change.",
			requestBody: { required: true, content: { "application/json": { schema: _ReviseRequestSchema } } },
			responses: { 200: { description: "Committed or recovered routine definition.", content: { "application/json": { schema: _DefinitionResponseSchema } } }, ..._Errors },
		},
	},
	"/me/routines/{routineId}/pause": { post: _ControlOperation("pauseRoutine", "Pause automatic routine firings") },
	"/me/routines/{routineId}/resume": { post: _ControlOperation("resumeRoutine", "Resume automatic routine firings") },
	"/me/routines/{routineId}/retire": { post: _ControlOperation("retireRoutine", "Retire a routine permanently") },
	"/me/routines/{routineId}/run-now": {
		post: {
			operationId: "runRoutineNow", summary: "Admit an immediate routine firing", tags: ["Routines"], parameters: [_RoutineIdParameter],
			description: "Creates or recovers a manual firing without moving the automatic schedule cursor. A retired or currently unauthorized firing is returned as a saved refused disposition.",
			requestBody: { required: true, content: { "application/json": { schema: _ControlRequestSchema } } },
			responses: { 200: { description: "Saved manual firing decision.", content: { "application/json": { schema: _FiringResponseSchema } } }, ..._Errors },
		},
	},
} as const;
