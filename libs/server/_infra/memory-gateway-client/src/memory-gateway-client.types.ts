/** One recalled memory fact returned by the memory gateway. */
export interface MemoryFact
{
	/** Opaque identifier minted by the gateway; never locally synthesized. */
	readonly factId: string;
	/** Stored fact text as held by the gateway. */
	readonly content: string;
}

/** Request to recall personal-memory facts for one subject within a silo. */
export interface MemoryQueryCommand
{
	/** Silo that owns the memory scope. */
	readonly siloId: string;
	/** Gateway-native personal dataset identifier frozen in the admitted run snapshot. */
	readonly cogneeDatasetId: string;
	/** Subject whose personal memory is being queried. */
	readonly subjectId: string;
	/** Free-text recall query. */
	readonly query: string;
	/** Upper bound on the number of facts to return. */
	readonly maxResults: number;
}

/** Facts recalled by the memory gateway for a query. */
export interface MemoryQueryResult
{
	/** Facts the gateway matched, in gateway-defined order. */
	readonly facts: readonly MemoryFact[];
}

/** Request to durably retain one authenticated subject's personal-memory fact. */
export interface PersonalMemoryRecordCommand
{
	/** Silo that owns the personal-memory dataset. */
	readonly siloId: string;
	/** Authenticated subject whose personal memory may receive this fact. */
	readonly subjectId: string;
	/** Gateway-native dataset identifier; OpenCrane's catalog id never crosses this boundary. */
	readonly cogneeDatasetId: string;
	/** Exact durable fact content, sent only to the remote memory gateway. */
	readonly content: string;
	/** Stable delivery key: it may be replayed only with byte-identical content in this subject and dataset. */
	readonly idempotencyKey: string;
}

/** Gateway evidence returned only after a personal fact has durably been accepted. */
export type PersonalMemoryRecordResult = PersonalMemoryRecorded | PersonalMemoryRecordDenied;

/** Gateway evidence returned only after a personal fact has durably been accepted. */
export interface PersonalMemoryRecorded
{
	/** Durable gateway acceptance outcome. */
	readonly outcome: "recorded";
	/** True when an identical earlier delivery already retained this exact content. */
	readonly idempotent: boolean;
	/** Stable fact identifier minted by the remote memory gateway. */
	readonly cogneeExternalId: string;
	/** Canonical lowercase sha256: content address computed over accepted durable content. */
	readonly contentDigest: string;
}

/** Gateway denial that leaves no new durable personal-memory fact. */
export interface PersonalMemoryRecordDenied
{
	/** Durable gateway denial outcome. */
	readonly outcome: "denied";
	/** Reused delivery key names content different from its already accepted request. */
	readonly reason: "idempotency_conflict";
}

/** Request to correct the content of one stored fact. */
export interface MemoryCorrectionCommand
{
	/** Silo that owns the memory scope. */
	readonly siloId: string;
	/** Subject whose personal memory is being corrected. */
	readonly subjectId: string;
	/** Gateway-minted fact reference to correct. */
	readonly factId: string;
	/** Replacement content to store for the fact. */
	readonly correctedContent: string;
}

/** Request to forget one stored fact. */
export interface MemoryForgetCommand
{
	/** Silo that owns the memory scope. */
	readonly siloId: string;
	/** Subject whose personal memory is being pruned. */
	readonly subjectId: string;
	/** Gateway-minted fact reference to forget. */
	readonly factId: string;
}

/**
 * Provenance stamped on every record a central agent injects into a shared knowledge scope.
 *
 * A scoped write is only ever attributable when it names the central agent, the exact revision, the
 * run that produced it, when it was recorded, and the upstream source it derived from. All fields
 * are required; an incomplete provenance fails closed rather than writing an unattributable fact.
 */
export interface MemoryProvenance
{
	/** Managed agent-service id that produced the record. */
	readonly centralAgentId: string;
	/** Immutable agent revision executing when the record was produced. */
	readonly agentRevisionId: string;
	/** Run id that produced the record. */
	readonly runId: string;
	/** ISO-8601 instant the record was recorded. */
	readonly recordedAt: string;
	/** Opaque reference to the upstream source the record derived from. */
	readonly sourceRef: string;
}

/** Request to recall facts from a knowledge SCOPE (not a single subject's personal memory). */
export interface ScopedMemoryRecallCommand
{
	/** Silo that owns the scope. */
	readonly siloId: string;
	/** Canonical containment scope being recalled from. */
	readonly scope: string;
	/** Canonical principal type of the scope target. */
	readonly subjectType: string;
	/** Identifier of the scope target within the silo. */
	readonly subjectId: string;
	/** Free-text recall query. */
	readonly query: string;
	/** Upper bound on the number of facts to return. */
	readonly maxResults: number;
}

/** One recalled scoped fact, carrying the provenance stamped when it was injected. */
export interface ScopedMemoryFact extends MemoryFact
{
	/** Provenance recorded with the fact. */
	readonly provenance: MemoryProvenance;
}

/** Facts recalled from one knowledge scope. */
export interface ScopedMemoryRecallResult
{
	/** Facts the gateway matched, in gateway-defined order. */
	readonly facts: readonly ScopedMemoryFact[];
}

/** Request to inject one record into a knowledge scope with mandatory provenance. */
export interface ScopedMemoryInjectionCommand
{
	/** Silo that owns the scope. */
	readonly siloId: string;
	/** Canonical containment scope being written to. */
	readonly scope: string;
	/** Canonical principal type of the scope target. */
	readonly subjectType: string;
	/** Identifier of the scope target within the silo. */
	readonly subjectId: string;
	/** Record content to store. */
	readonly content: string;
	/** Mandatory provenance stamped on the injected record. */
	readonly provenance: MemoryProvenance;
}

/** Runtime-neutral boundary for the personal-memory and scoped-knowledge gateway authority. */
export interface MemoryGatewayClient
{
	/** Recalls facts for a subject and returns only gateway-originated results. */
	query(command: MemoryQueryCommand): Promise<MemoryQueryResult>;
	/** Retains one fact for the authenticated subject and returns gateway-minted evidence. */
	recordPersonalFact(command: PersonalMemoryRecordCommand): Promise<PersonalMemoryRecordResult>;
	/** Corrects one stored fact's content remotely. */
	correct(command: MemoryCorrectionCommand): Promise<void>;
	/** Forgets one stored fact remotely. */
	forget(command: MemoryForgetCommand): Promise<void>;
	/** Recalls provenance-carrying facts from one knowledge scope. */
	recallScoped(command: ScopedMemoryRecallCommand): Promise<ScopedMemoryRecallResult>;
	/** Injects one record into a knowledge scope; the provenance is mandatory and validated. */
	injectScoped(command: ScopedMemoryInjectionCommand): Promise<void>;
}
