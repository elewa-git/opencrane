import { WrongExpectedVersionError } from "@kurrent/kurrentdb-client";

import { ___ConversationComputerEntrySchema, type ConversationEntry } from "@opencrane/contracts";
import type { HistoryStore } from "@opencrane/backend/server/infra/history-store";
import { ___DigestCanonicalJson, type JsonValue } from "@opencrane/util";

import type { BoundConversationWriterAppend, BoundConversationWriterBinding, BoundConversationWriterClock, BoundConversationWriterIntent, BoundConversationWriterLeaseFence, BoundConversationWriterRateLimiter, BoundConversationWriterVisibilityPolicy, ComputerConversationEntryDraft } from "./bound-conversation-writer.types";

/** Requires the source command to be a UUID usable as the durable event identifier. */
const _UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
/** Names the existing participant-visible computer entry schema. */
const _CONVERSATION_ENTRY_EVENT_TYPE = "opencrane.conversation-entry.v1";

/**
 * Prepares one exact entry and appends only that saved intent through its bound conversation.
 *
 * The turn owner persists preparation before calling append. Readback is limited to the next
 * position in this binding; a matching saved event proves acceptance, while an empty slot still
 * requires current visibility and lease authority. Acknowledgements alone never complete output.
 * Called by: ConversationComputerTurnAuthority through its bound writer factory.
 */
export class BoundConversationWriter
{
	/** Prevents overlapping preparation or append work on this short-lived writer. */
	private inFlight = false;
	/** Prevents this writer from stamping a second competing intent. */
	private prepared = false;
	/** Prevents this writer from completing a second physical append. */
	private appended = false;
	/** Rejects a substituted intent after an uncertain response without retaining another retry recipe. */
	private intentDigest: string | null = null;

	/** Bind exact history reads and writes to server-owned stamping and current-authority ports. */
	public constructor(private readonly historyStore: Pick<HistoryStore, "append" | "readStream">, private readonly binding: BoundConversationWriterBinding, private readonly clock: BoundConversationWriterClock, private readonly rateLimiter: BoundConversationWriterRateLimiter, private readonly visibilityPolicy: BoundConversationWriterVisibilityPolicy, private readonly leaseFence: BoundConversationWriterLeaseFence) {}

	/** Validate and stamp a draft once; the caller must save this returned intent before appending it. */
	public async prepare(command: BoundConversationWriterAppend): Promise<BoundConversationWriterIntent>
	{
		if (this.prepared || this.appended || this.inFlight)
			throw new Error("Bound conversation writer is single-use");
		if (!_UUID_PATTERN.test(command.sourceCommandId))
			throw new Error("Bound conversation writer requires a UUID source command identifier");
		const draft = structuredClone(command);
		this.inFlight = true;
		try
		{
			await this.rateLimiter.assertMayAppend(this.binding);
			await this.visibilityPolicy.assertMayUseVisibility(this.binding, draft.entry.visibility);
			const entry = this._stampEntry(draft.sourceCommandId, draft.entry);
			const intent = _ReadBoundConversationWriterIntent(this.binding, _Intent(this.binding, entry));
			this.prepared = true;
			return intent;
		}
		finally { this.inFlight = false; }
	}

	/**
	 * Recover exact acceptance or append the saved intent after current authority permits it.
	 *
	 * The caller must first verify the current Pod and lease even when the event already exists.
	 * An exact history match grants no permission to append later content. A different event, a
	 * malformed read, or unavailable history leaves the turn pending for inspection or retry.
	 * @param saved - Supplies the persisted winning intent, never a newly restamped retry.
	 */
	public async append(saved: BoundConversationWriterIntent): Promise<ConversationEntry>
	{
		if (this.appended || this.inFlight)
			throw new Error("Bound conversation writer is single-use");
		const intent = _ReadBoundConversationWriterIntent(this.binding, saved);
		const digest = ___DigestCanonicalJson(intent as unknown as JsonValue);
		if (this.intentDigest !== null && this.intentDigest !== digest)
			throw new Error("Bound conversation writer retries require the original saved intent");
		this.intentDigest = digest;
		this.inFlight = true;
		try
		{
			if (!await this._IsAccepted(intent))
			{
				await this.visibilityPolicy.assertMayUseVisibility(this.binding, intent.event.data.entry.visibility);
				await this.leaseFence.assertMayAppend(this.binding);
				try
				{
					await this.historyStore.append({ streamName: intent.streamName, expectedRevision: this.binding.expectedRevision, events: [intent.event] });
				}
				catch (error)
				{
					if (!(error instanceof WrongExpectedVersionError))
						throw error;
				}
				if (!await this._IsAccepted(intent))
					throw new Error("Bound conversation writer cannot confirm its saved output");
			}
			this.appended = true;
			return intent.event.data.entry;
		}
		finally { this.inFlight = false; }
	}

	/** Read only the frozen next position and compare the complete application event envelope. */
	private async _IsAccepted(intent: BoundConversationWriterIntent): Promise<boolean>
	{
		let accepted = false;
		for await (const event of this.historyStore.readStream({ streamName: intent.streamName, fromRevision: this.binding.expectedRevision + 1n, maxCount: 1 }))
		{
			if (accepted || event.streamName !== intent.streamName || event.revision !== this.binding.expectedRevision + 1n
				|| ___DigestCanonicalJson({ id: event.id, type: event.type, data: event.data, metadata: event.metadata } as JsonValue) !== ___DigestCanonicalJson(intent.event as unknown as JsonValue))
				throw new Error("Bound conversation writer found different history at its saved output position");
			accepted = true;
		}
		return accepted;
	}

	/** Stamp identity and position from the binding, and read the server clock exactly once. */
	private _stampEntry(sourceCommandId: string, draft: ComputerConversationEntryDraft): ConversationEntry
	{
		if (this.binding.expectedRevision < 0n)
			throw new Error("Bound conversation writer requires an immutable conversation genesis");
		const position = (this.binding.expectedRevision + 1n).toString();
		return { ...draft, schemaVersion: 1, id: sourceCommandId, conversationId: this.binding.conversationId, position, author: { kind: "agent", agentIdentityId: this.binding.agentIdentityId, agentServiceId: this.binding.agentServiceId, name: this.binding.agentName, avatarArtifactRevisionId: this.binding.agentAvatarArtifactRevisionId }, provenance: "agent-authored", visibility: draft.visibility as ConversationEntry["visibility"], runId: this.binding.runId, causationId: draft.causationId, correlationId: draft.correlationId, idempotencyKey: sourceCommandId, occurredAt: this.clock.now().toISOString(), attestation: null } as ConversationEntry;
	}
}

/** Build the sole wire envelope from a validated entry and its server-owned binding. */
function _Intent(binding: BoundConversationWriterBinding, entry: ConversationEntry): BoundConversationWriterIntent
{
	return { streamName: `conversation-${binding.conversationId}`, expectedRevision: binding.expectedRevision.toString(), event: { id: entry.id, type: _CONVERSATION_ENTRY_EVENT_TYPE, data: { entry }, metadata: { siloId: binding.siloId, conversationId: binding.conversationId, computerId: binding.computerId, leaseGeneration: String(binding.leaseGeneration), agentIdentityId: binding.agentIdentityId, runId: binding.runId, causationId: entry.causationId, correlationId: entry.correlationId, idempotencyKey: entry.idempotencyKey } } };
}

/**
 * Validate and copy a persisted intent without consulting a clock or admitting a new append.
 *
 * The complete envelope must equal the one this binding permits, including metadata, author,
 * position and schema fields. Parsing returns owned data so later awaits cannot observe caller
 * mutation. Called by: the turn store on write/read and BoundConversationWriter.append.
 */
export function _ReadBoundConversationWriterIntent(binding: BoundConversationWriterBinding, value: unknown): BoundConversationWriterIntent
{
	const candidate = structuredClone(value) as BoundConversationWriterIntent | null;
	const parsed = ___ConversationComputerEntrySchema.safeParse(candidate?.event?.data?.entry);
	if (!parsed.success)
		throw new Error("Bound conversation writer received an invalid saved entry");
	const entry = parsed.data;
	if (new TextEncoder().encode(JSON.stringify(entry)).byteLength > binding.maximumEntryBytes)
		throw new Error("Bound conversation writer entry exceeds its maximum byte size");
	if (binding.expectedRevision < 0n || !_UUID_PATTERN.test(entry.id) || entry.conversationId !== binding.conversationId
		|| entry.position !== (binding.expectedRevision + 1n).toString() || entry.idempotencyKey !== entry.id
		|| entry.author.kind !== "agent" || entry.author.agentIdentityId !== binding.agentIdentityId
		|| entry.author.agentServiceId !== binding.agentServiceId || entry.author.name !== binding.agentName
		|| entry.author.avatarArtifactRevisionId !== binding.agentAvatarArtifactRevisionId || entry.runId !== binding.runId
		|| entry.provenance !== "agent-authored" || entry.attestation !== null)
		throw new Error("Bound conversation writer saved intent crossed its immutable binding");
	const intent = _Intent(binding, entry);
	if (___DigestCanonicalJson(intent as unknown as JsonValue) !== ___DigestCanonicalJson(candidate as unknown as JsonValue))
		throw new Error("Bound conversation writer saved intent has a different event envelope");
	return intent;
}
