/** Lists the kinds of server-stamped authors that can appear in participant-visible history. */
export type ConversationAuthor = HumanConversationAuthor | AgentConversationAuthor | ServiceConversationAuthor | SystemConversationAuthor;

/** Represents the authenticated participant who authored one human conversation entry. */
export interface HumanConversationAuthor
{
	/** Selects the human author handler. */
	readonly kind: "human";
	/** Identifies the principal that authored the entry. */
	readonly principalId: string;
	/** Identifies the conversation participant represented by this author. */
	readonly participantId: string;
	/** Captures the display name at append time. */
	readonly name: string;
	/** Identifies the optional immutable avatar artifact revision. */
	readonly avatarArtifactRevisionId: string | null;
}

/** Represents the stable agent identity that authored one entry. */
export interface AgentConversationAuthor
{
	/** Selects the agent author handler. */
	readonly kind: "agent";
	/** Identifies the agent identity used for current authorization. */
	readonly agentIdentityId: string;
	/** Identifies the agent service represented by this identity. */
	readonly agentServiceId: string;
	/** Captures the participant-facing agent name at append time. */
	readonly name: string;
	/** Identifies the optional immutable avatar artifact revision. */
	readonly avatarArtifactRevisionId: string | null;
}

/** Represents an OpenCrane service that authored a safe participant-visible entry. */
export interface ServiceConversationAuthor
{
	/** Selects the service author handler. */
	readonly kind: "service";
	/** Identifies the service that owns the attested fact. */
	readonly serviceId: string;
	/** Captures the service display name at append time. */
	readonly name: string;
}

/** Represents a platform-generated entry backed by an OpenCrane service attestation. */
export interface SystemConversationAuthor
{
	/** Selects the system author handler. */
	readonly kind: "system";
	/** Fixes the sole system identifier accepted by this contract. */
	readonly systemId: "opencrane";
	/** Fixes the historical system display name. */
	readonly name: "OpenCrane";
}

/** Limits an entry to all participants or to one explicit participant subset. */
export type ConversationEntryVisibility = ConversationVisibility | ParticipantSubsetVisibility;

/** Makes an entry visible to every participant authorized at its position. */
export interface ConversationVisibility
{
	/** Selects the whole-conversation audience. */
	readonly audience: "conversation";
}

/** Makes an entry visible only to the listed participant identifiers. */
export interface ParticipantSubsetVisibility
{
	/** Selects an explicit participant subset. */
	readonly audience: "participant_subset";
	/** Lists the participants that may receive this entry. */
	readonly participantIds: readonly string[];
}

/**
 * Identifies the service-owned receipt that a boundary must verify before it treats an entry as
 * service-attested.
 *
 * The coordinates let a receipt transformer make the participant-visible record idempotent without
 * copying the protected domain fact into the conversation stream.
 */
export interface ServiceAttestation
{
	/** Identifies the service that owns the attested fact. */
	readonly serviceId: string;
	/** Identifies the immutable receipt emitted by that service. */
	readonly receiptId: string;
	/** Names the canonical service stream that holds the receipt. */
	readonly domainStream: string;
	/** Identifies the stream revision that records the receipt. */
	readonly domainRevision: string;
	/** Identifies decision evidence when the service recorded it. */
	readonly decisionEvidenceId: string | null;
}

/** Holds the coordinates every versioned participant-visible entry shares. */
export interface ConversationEntryBase
{
	/** Names the persisted contract shape. */
	readonly schemaVersion: 1;
	/** Identifies this immutable conversation entry. */
	readonly id: string;
	/** Identifies the one conversation stream that owns this entry. */
	readonly conversationId: string;
	/** Stores the server-assigned position in the conversation stream. */
	readonly position: string;
	/** Identifies the one server-stamped author. */
	readonly author: ConversationAuthor;
	/** States whether a human, computer, or receipt-transforming service created this entry. */
	readonly provenance: "human-authored" | "agent-authored" | "service-attested";
	/** Limits which participants may receive this entry. */
	readonly visibility: ConversationEntryVisibility;
	/** Identifies the related fenced run when one exists. */
	readonly runId: string | null;
	/** Identifies the direct cause that produced this entry. */
	readonly causationId: string;
	/** Identifies the request or workflow shared by related entries. */
	readonly correlationId: string;
	/** Deduplicates the source command or source event. */
	readonly idempotencyKey: string;
	/** Records when the server accepted this entry. */
	readonly occurredAt: string;
	/** Links service-attestation coordinates, or stays null when the entry has none. */
	readonly attestation: ServiceAttestation | null;
}

/** Holds the stable identifier every message content block shares. */
export interface MessageContentBlockBase
{
	/** Identifies this block within its immutable message entry. */
	readonly id: string;
}

/** Lists the safe payload references a participant-visible message may contain. */
export type MessageContentBlock = TextMessageContentBlock | ArtifactMessageContentBlock | MentionMessageContentBlock;

/**
 * Selects how a history reader decodes a persisted conversation entry.
 *
 * The validator accepts this closed set when it reads `conversation-{id}`. A new member therefore
 * needs a reader and validator change before any writer may append it.
 */
export enum ConversationEntryKinds
{
	/** Records a participant-visible message. */
	Message = "message",
	/** Records a structured execution or policy fact. */
	Log = "log",
	/** Records a server-attested request for participant input or its resolution. */
	Elicitation = "elicitation",
	/** Records a participant-visible A2UI surface mutation. */
	A2ui = "a2ui",
}

/** References encrypted text without embedding plaintext in the event ledger. */
export interface TextMessageContentBlock extends MessageContentBlockBase
{
	/** Selects the encrypted text block handler. */
	readonly kind: "text";
	/** Identifies the private payload containing the encrypted text. */
	readonly payloadRef: string;
	/** Identifies the ciphertext digest verified by the payload store. */
	readonly ciphertextDigest: string;
}

/** References one immutable artifact revision that is safe to display. */
export interface ArtifactMessageContentBlock extends MessageContentBlockBase
{
	/** Selects the artifact block handler. */
	readonly kind: "artifact";
	/** Identifies the artifact logical record. */
	readonly artifactId: string;
	/** Identifies the immutable artifact revision. */
	readonly artifactRevisionId: string;
	/** Captures the display name at append time. */
	readonly name: string;
	/** States the artifact media type. */
	readonly mediaType: string;
}

/** References one human or agent mentioned by this message. */
export interface MentionMessageContentBlock extends MessageContentBlockBase
{
	/** Selects the mention block handler. */
	readonly kind: "mention";
	/** States whether the target identifies a human or agent. */
	readonly targetKind: "human" | "agent";
	/** Identifies the mentioned human or agent. */
	readonly targetId: string;
	/** Captures the target display name at append time. */
	readonly name: string;
}

/**
 * Represents a participant-visible message and its ordered safe content blocks.
 *
 * Text keeps an opaque encrypted-payload reference while artifacts keep immutable revision
 * coordinates. Neither shape carries a plaintext body or a storage capability in the event stream.
 */
export interface MessageEntry extends ConversationEntryBase
{
	/** Selects the message entry handler. */
	readonly kind: "message";
	/** States the current immutable message lifecycle representation. */
	readonly state: "pending" | "streaming" | "completed" | "failed" | "cancelled";
	/** Lists the ordered safe content blocks. */
	readonly blocks: readonly MessageContentBlock[];
	/** Identifies the entry this message replies to when one exists. */
	readonly replyToEntryId: string | null;
	/** Identifies the agent addressed by this message when one exists. */
	readonly addressedAgentIdentityId: string | null;
	/** States whether this message starts or interrupts agent work. */
	readonly activation: "none" | "start" | "interrupt";
}

/**
 * Lists every explicit participant-visible operational log subtype.
 *
 * Consumers branch on the log kind to render a safe progress fact without treating a log as the
 * authoritative domain event that caused it.
 */
export type LogEntry = RunLogEntry | ModelLogEntry | ToolCallLogEntry | ArtifactLogEntry | MemoryLogEntry | ApprovalLogEntry;

/** Holds the safe common fields for a structured participant-visible log. */
export interface LogEntryBase extends ConversationEntryBase
{
	/** Selects the structured log entry handler. */
	readonly kind: "log";
	/** Stores the safe participant-visible summary. */
	readonly summary: string;
	/** References optional safe technical details outside the event ledger. */
	readonly detailsRef: string | null;
}

/** Records a fenced run lifecycle change. */
export interface RunLogEntry extends LogEntryBase
{
	/** Selects the run log handler. */
	readonly logKind: "run";
	/** Identifies the fenced run represented by this log. */
	readonly runId: string;
	/** States the safe run lifecycle phase. */
	readonly phase: "queued" | "started" | "interrupted" | "completed" | "failed" | "recovery_required";
}

/** Records one model-call lifecycle change. */
export interface ModelLogEntry extends LogEntryBase
{
	/** Selects the model log handler. */
	readonly logKind: "model";
	/** Identifies the model call represented by this log. */
	readonly modelCallId: string;
	/** States the safe model-call lifecycle phase. */
	readonly phase: "started" | "streaming" | "completed" | "failed" | "cancelled";
}

/** Records one local, MCP, or isolated OCI tool-call lifecycle change. */
export interface ToolCallLogEntry extends LogEntryBase
{
	/** Selects the tool-call log handler. */
	readonly logKind: "tool_call";
	/** Identifies the tool call represented by this log. */
	readonly toolCallId: string;
	/** States whether the tool runs locally, through MCP, or in OCI isolation. */
	readonly toolKind: "local" | "mcp" | "oci";
	/** Captures the admitted tool display name. */
	readonly toolName: string;
	/** States the safe tool-call lifecycle phase. */
	readonly phase: "requested" | "running" | "completed" | "failed" | "cancelled" | "recovery_required";
	/** Identifies the immutable result artifact revision when one exists. */
	readonly resultArtifactRevisionId: string | null;
}

/** Records an artifact publication lifecycle change. */
export interface ArtifactLogEntry extends LogEntryBase
{
	/** Selects the artifact log handler. */
	readonly logKind: "artifact";
	/** Identifies the artifact represented by this log. */
	readonly artifactId: string;
	/** Identifies the immutable artifact revision when one exists. */
	readonly artifactRevisionId: string | null;
	/** States the safe artifact lifecycle phase. */
	readonly phase: "uploading" | "scanning" | "published" | "rejected" | "failed";
}

/** Records a memory-gateway operation without embedding memory content. */
export interface MemoryLogEntry extends LogEntryBase
{
	/** Selects the memory log handler. */
	readonly logKind: "memory";
	/** States whether the operation recalled or wrote a memory fact. */
	readonly operation: "recall" | "write";
	/** States the safe memory-operation lifecycle phase. */
	readonly phase: "requested" | "completed" | "failed" | "denied";
}

/** Records a request for or resolution of one governed approval. */
export interface ApprovalLogEntry extends LogEntryBase
{
	/** Selects the approval log handler. */
	readonly logKind: "approval";
	/** Identifies the approval represented by this log. */
	readonly approvalId: string;
	/** Captures the admitted action display name. */
	readonly action: string;
	/** States the safe approval lifecycle phase. */
	readonly phase: "requested" | "granted" | "denied" | "expired" | "revoked";
}

/**
 * States where an elicitation request ended up in conversation history.
 *
 * Readers branch on this closed set to decide whether the request still awaits a server-accepted
 * resolution. The validator rejects an unknown state instead of letting a projector guess whether
 * the request is still open.
 */
export enum ConversationElicitationEntryStates
{
	/** The request awaits a server-accepted resolution before its deadline. */
	Requested = "requested",
	/** The addressed participant supplied a server-accepted response payload. */
	Answered = "answered",
	/** The server accepted that the addressed participant declined the request. */
	Declined = "declined",
	/** The response window ended before an answer was accepted. */
	Expired = "expired",
	/** The server cancelled the request for its fenced computer before it accepted a response. */
	Cancelled = "cancelled",
}

/**
 * Names the interaction a ConversationComputer asks the server to present.
 *
 * The server records the selected member in immutable history, so projectors can render the right
 * private payload without inferring an interaction from a free-form prompt. The validator rejects
 * any member outside this set.
 */
export enum ConversationElicitationEntryKinds
{
	/** Requests ordinary participant input for the model loop. */
	RuntimeInput = "runtime_input",
	/** Requests a decision for one governed tool operation. */
	ToolApproval = "tool_approval",
	/** Requests one-use permission before a personal-memory operation. */
	PersonalMemoryPermission = "personal_memory_permission",
	/** Requests confirmation before the server applies an A2UI action. */
	A2uiAction = "a2ui_action",
}

/** Lists the durable request and terminal-response entries for one computer elicitation. */
export type ElicitationEntry = ElicitationRequestEntry | ElicitationResolutionEntry;

/** Holds the conversation coordinates that no longer identify a retired AgentRun. */
export type ConversationComputerEntryBase = Omit<ConversationEntryBase, "runId">;

/**
 * Holds the coordinates shared by every immutable elicitation entry.
 *
 * The service-attested entry binds a request and its resolution to the computer execution and
 * lease generation that opened it. A later command authority uses those coordinates to reject a
 * response from another execution or lease.
 */
export interface ElicitationEntryBase extends ConversationComputerEntryBase
{
	/** Selects the conversation elicitation entry handler. */
	readonly kind: ConversationEntryKinds.Elicitation;
	/** Identifies the request whose lifecycle this entry records. */
	readonly elicitationId: string;
	/** Identifies the computer that owns the elicitation. */
	readonly computerId: string;
	/** Identifies the fenced execution instance that opened the elicitation. */
	readonly computerExecutionId: string;
	/** Fences this interaction to the computer lease generation that opened it. */
	readonly leaseGeneration: number;
	/** Names the interaction selected by the server. */
	readonly elicitationKind: ConversationElicitationEntryKinds;
}

/**
 * Records an opaque request that the server accepted from an active ConversationComputer.
 *
 * The history entry names an addressed participant but does not give that participant a writer.
 * The later command authority authorizes a response and appends its separate service-attested
 * resolution entry.
 */
export interface ElicitationRequestEntry extends ElicitationEntryBase
{
	/** States that the request remains open for the addressed participant. */
	readonly state: ConversationElicitationEntryStates.Requested;
	/** Identifies the participant whose response the server must authorize. */
	readonly addressedParticipantId: string;
	/** Identifies the private request payload outside immutable history. */
	readonly requestPayloadRef: string;
	/** Stores the request payload digest. */
	readonly requestPayloadDigest: string;
	/** Records the server-owned deadline after which no answer may be accepted. */
	readonly expiresAt: string;
}

/**
 * Records the server-accepted answer or terminal no-answer outcome for one request.
 *
 * The addressed participant never appends this entry directly. The service attestation records the
 * authorization result separately from the private response payload.
 */
export interface ElicitationResolutionEntry extends ElicitationEntryBase
{
	/** States the accepted answer or terminal non-answer outcome. */
	readonly state: ConversationElicitationEntryStates.Answered | ConversationElicitationEntryStates.Declined | ConversationElicitationEntryStates.Expired | ConversationElicitationEntryStates.Cancelled;
	/** Identifies the earlier request entry that this terminal entry resolves. */
	readonly requestEntryId: string;
	/** References the private response payload when the addressed participant answered. */
	readonly responsePayloadRef: string | null;
	/** Stores the response payload digest when the addressed participant answered. */
	readonly responsePayloadDigest: string | null;
}

/**
 * Lists append-only A2UI surface mutations a conversation stream may carry.
 *
 * Each event holds a governed payload reference or records a removal, so replay can reconstruct the
 * participant surface without retaining obsolete payload coordinates.
 */
export type A2UIEntry = A2UIWriteEntry | A2UIRemoveEntry;

/** Holds common coordinates for an A2UI surface mutation. */
export interface A2UIEntryBase extends ConversationEntryBase
{
	/** Selects the A2UI entry handler. */
	readonly kind: "a2ui";
	/** Identifies the surface updated by this entry. */
	readonly surfaceId: string;
	/** Names the admitted A2UI schema version. */
	readonly a2uiSchemaVersion: string;
}

/** Replaces or patches one A2UI surface with a verified private payload. */
export interface A2UIWriteEntry extends A2UIEntryBase
{
	/** States whether this entry replaces or patches the surface. */
	readonly operation: "replace" | "patch";
	/** Identifies the private payload holding the A2UI mutation. */
	readonly payloadRef: string;
	/** Identifies the verified private payload digest. */
	readonly payloadDigest: string;
}

/** Removes one A2UI surface without carrying an obsolete payload reference. */
export interface A2UIRemoveEntry extends A2UIEntryBase
{
	/** Selects a surface removal. */
	readonly operation: "remove";
	/** States that a removal has no payload. */
	readonly payloadRef: null;
	/** States that a removal has no payload digest. */
	readonly payloadDigest: null;
}

/**
 * Lists every participant-visible event stored in a conversation stream.
 *
 * This closed union gives the socket projector one public shape to replay in stream order. It does
 * not grant a writer access to another conversation or let an entry claim an external effect without
 * the service-attestation boundary.
 */
export type ConversationEntry = MessageEntry | LogEntry | ElicitationEntry | A2UIEntry;
