import type { RoutineCreationOptionsResponse, RoutineFiringListItem, RoutineListItem, RoutineSchedulePreviewResponse } from "@opencrane/contracts";
import type { AgentRunTerminalReason, RoutineFiringTrigger } from "@opencrane/models/agents";

import type { EncryptedRoutineProjection, ReadRoutineCommand, RoutineCaller } from "./routine-authority.types";

/** Position of the last database candidate examined by a bounded read page. */
export interface RoutinePagePosition
{
	/** Creation time used as the first descending sort key. */
	readonly createdAt: string;
	/** Stable identifier used as the second descending sort key. */
	readonly id: string;
}

/** Authenticated context that prevents a page token from moving between readers or endpoints. */
export interface RoutinePageCursorContext
{
	/** Authenticated caller whose page may consume the token. */
	readonly caller: RoutineCaller;
	/** Separates routine pages from firing-history pages. */
	readonly endpoint: RoutinePageCursorEndpoints;
	/** Routine bound to a history cursor, or null for the routine list. */
	readonly routineId: string | null;
}

/** Closed cursor purposes interpreted by the scheduling authority and its cipher adapter. */
export enum RoutinePageCursorEndpoints
{
	/** Pages the caller's readable routine definitions. */
	Routines = "routines",
	/** Pages one authorized routine's firing history. */
	Firings = "firings",
}

/** Encrypts continuation positions outside retryable database transactions. */
export interface RoutinePageCursorCodec
{
	/** Decrypts and validates a token for the supplied authenticated context. */
	decode(token: string, context: RoutinePageCursorContext): Promise<RoutinePagePosition>;
	/** Encrypts a validated position for the supplied authenticated context. */
	encode(position: RoutinePagePosition, context: RoutinePageCursorContext): Promise<string>;
}

/** List query after the authority has decrypted its optional continuation token. */
export interface RoutineListPersistenceQuery
{
	/** Authenticated audience member requesting the page. */
	readonly caller: RoutineCaller;
	/** Maximum number of database candidates examined before returning. */
	readonly limit: number;
	/** Last examined candidate from the previous page. */
	readonly after: RoutinePagePosition | null;
}

/** Firing-history query after the authority has decrypted its optional continuation token. */
export interface RoutineFiringListPersistenceQuery extends RoutineListPersistenceQuery
{
	/** Authorized routine whose immutable occurrences are requested. */
	readonly routineId: string;
}

/** Bounded authorized list projection before its continuation is encrypted. */
export interface RoutineListPersistencePage
{
	/** Readable items among the bounded database candidates. */
	readonly items: readonly RoutineListItem[];
	/** Last examined candidate when another scan window exists. */
	readonly next: RoutinePagePosition | null;
}

/** Bounded authorized firing projection before its continuation is encrypted. */
export interface RoutineFiringListPersistencePage
{
	/** Safe firing rows from the bounded database candidates. */
	readonly items: readonly RoutineFiringListItem[];
	/** Last examined candidate when another scan window exists. */
	readonly next: RoutinePagePosition | null;
}

/** Transaction-scoped participant choices and Principal mappings owned by conversations. */
export interface RoutineConversationDirectory<Transaction>
{
	/** Resolves selected opaque membership references to external Principals in one current destination. */
	resolveAudience(caller: RoutineCaller, destinationConversationId: string, participantRefs: readonly string[], now: Date): Promise<{ readonly participantRefs: readonly string[]; readonly principalIds: readonly string[] } | null>;
	/** Projects every frozen external Principal back to one durable organisation membership reference. */
	projectAudience(caller: RoutineCaller, destinationConversationId: string, principalIds: readonly string[]): Promise<readonly { readonly participantRef: string; readonly displayName: string; readonly isSelf: boolean }[]>;
	/** Lists current destination participants that can be reviewed for routine creation. */
	creationAudience(caller: RoutineCaller, destinationConversationId: string, now: Date): Promise<readonly { readonly participantRef: string; readonly displayName: string; readonly isSelf: boolean }[] | null>;
	/** Filters occurrence conversations through current participation and Conversation Read. */
	readableConversationIds(caller: RoutineCaller, conversationIds: readonly string[], now: Date): Promise<readonly string[]>;
}

/** Builds the conversation-owned directory over the exact routine transaction. */
export type RoutineConversationDirectoryFactory<Transaction> = (transaction: Transaction) => RoutineConversationDirectory<Transaction>;

/** Transaction-scoped managed-service choices and eligibility owned by agent services. */
export interface RoutineManagedServiceDirectory
{
	/** Lists services the caller may currently discover, read, and invoke. */
	list(caller: Pick<RoutineCaller, "siloId" | "principalId">): Promise<readonly { readonly agentServiceId: string; readonly name: string }[]>;
	/** Checks the selected service without recording an effect admission. */
	eligible(caller: Pick<RoutineCaller, "siloId" | "principalId">, serviceId: string): Promise<{ readonly agentServiceId: string } | null>;
}

/** Builds the managed-service directory over the exact routine transaction. */
export type RoutineManagedServiceDirectoryFactory<Transaction> = (transaction: Transaction) => RoutineManagedServiceDirectory;

/** Coordinates supplied to the execution-owned checked run-history adapter. */
export interface RoutineRunHistoryRequest
{
	readonly runId: string;
	readonly siloId: string;
	readonly routineId: string;
	readonly routineRevision: number;
	readonly firingId: string;
	readonly conversationId: string;
	readonly trigger: RoutineFiringTrigger;
	readonly scheduledSlot: string | null;
}

/** Checked execution facts accepted by scheduling's authorized history projection. */
export interface RoutineRunHistoryFact
{
	readonly runId: string;
	readonly terminalReason: AgentRunTerminalReason | null;
	readonly actualCost: { readonly amount: string; readonly currency: string } | null;
}

/** Structural port implemented by the execution-runs package without reversing dependency direction. */
export interface RoutineRunHistoryRepository
{
	read(requests: readonly RoutineRunHistoryRequest[]): Promise<readonly RoutineRunHistoryFact[]>;
}

/** Builds the execution-owned historical run reader over the exact routine transaction. */
export type RoutineRunHistoryRepositoryFactory<Transaction> = (transaction: Transaction) => RoutineRunHistoryRepository;

/** Read operations implemented by the routine transaction owner. */
export interface RoutineReadPersistence
{
	/** Reads one authorized encrypted routine definition. */
	read(command: ReadRoutineCommand): Promise<EncryptedRoutineProjection | null>;
	/** Returns a bounded sparse page of routines the caller may currently read. */
	list(query: RoutineListPersistenceQuery): Promise<RoutineListPersistencePage>;
	/** Returns a bounded firing-history page after authorizing its routine. */
	firings(query: RoutineFiringListPersistenceQuery): Promise<RoutineFiringListPersistencePage>;
	/** Returns destination participants and managed services currently eligible for creation. */
	creationOptions(caller: RoutineCaller, destinationConversationId: string): Promise<RoutineCreationOptionsResponse>;
	/** Reads the database clock used for a schedule preview. */
	previewClock(): Promise<Date>;
}

/** Preview output before transport mapping. */
export type RoutineSchedulePreview = RoutineSchedulePreviewResponse;
