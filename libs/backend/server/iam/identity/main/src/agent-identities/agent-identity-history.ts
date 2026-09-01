import { AgentIdentityStates, type AgentIdentity } from "@opencrane/contracts";
import { HistoryExpectedRevisions, type HistoryAppend, type HistoryAppendReceipt, type HistoryStore } from "@opencrane/backend/server/infra/history-store";
import { ___DigestCanonicalJson, type JsonValue } from "@opencrane/util";

import type { AgentIdentityAppendCommand, AgentIdentityCurrentCommand, CurrentAgentIdentity } from "./agent-identity-history.types";
import { _AgentIdentityPrincipalId, _AgentIdentityStreamName, _AssertAgentIdentityCurrentCoordinates, _SameAgentIdentityCoordinates, _ValidatedAgentIdentity, _ValidatedAgentIdentityStreamEvent, _ValidateCurrentAgentIdentityCommand } from "./agent-identity-history-validation";
/** Recognizes UUID event identifiers without treating an ordinary identity coordinate as an idempotency key. */
const _UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Persists and loads KurrentDB history for one AgentIdentity.
 *
 * ADR 0016 requires admission to bind the subject to a checked identity head. This authority
 * derives stream names from trusted coordinates, validates each discriminated snapshot, and
 * returns the head alongside current state. It does not evaluate grants or inherit parent/sub-chat
 * capabilities; it checks parent linkage so a child cannot use a parent's principal or append
 * after that parent changed.
 *
 * @see `docs/adr/0016-conversation-history-and-computers.md` for the admission decision.
 */
export class AgentIdentityHistory
{
	/** Connects this authority to the narrow checked KurrentDB port. */
	public constructor(private readonly historyStore: Pick<HistoryStore, "append" | "appendAtomic" | "readHead" | "readStream">) {}

	/**
	 * Appends one complete identity snapshot at the caller-observed stream revision.
	 *
	 * @param command - Supplies a closed identity snapshot, UUID event key, and checked stream head.
	 * @returns The KurrentDB receipt for the deterministic identity stream.
	 * @throws {Error} Rejects malformed identity data and propagates checked-append conflicts unchanged.
	 */
	public async append(command: AgentIdentityAppendCommand): Promise<HistoryAppendReceipt>
	{
		const identity = _ValidatedAgentIdentity(command.identity);
		if (!_ExpectedRevision(command.expectedRevision))
			throw new Error("Agent identity history append requires a nonnegative expected revision");
		if (!_UUID_PATTERN.test(command.eventId))
			throw new Error("Agent identity history append requires a UUID event identifier");

		const streamName = _AgentIdentityStreamName(identity.id);
		const append = _IdentityAppend(command, identity, streamName);
		const parents = await this._ParentBinding(identity, new Set([identity.id]));
		if (parents.length === 0)
			return this.historyStore.append(append);
		const receipts = await this.historyStore.appendAtomic({ expectedHeads: [{ streamName, revision: command.expectedRevision }, ...parents.map(parent => ({ streamName: parent.streamName, revision: parent.revision }))], appends: [append] });
		const receipt = receipts.find(candidate => candidate.streamName === streamName);
		if (!receipt)
			throw new Error("Agent identity history atomic append omitted its identity receipt");
		return receipt;
	}

	/**
	 * Loads the checked current snapshot for exactly one trusted identity coordinate tuple.
	 *
	 * @param command - Supplies the silo, identity, service, and acting principal that must all match.
	 * @returns Current validated state plus its stream head, or null when the identity stream is absent.
	 * @throws {Error} Rejects malformed, foreign, noncontiguous, or concurrently changed stream history.
	 */
	public async load(command: AgentIdentityCurrentCommand): Promise<CurrentAgentIdentity | null>
	{
		_ValidateCurrentAgentIdentityCommand(command);
		const current = await this._ReadCurrent(command.agentIdentityId);
		if (current === null)
			return null;
		_AssertAgentIdentityCurrentCoordinates(current.identity, command);
		await this._ParentBinding(current.identity, new Set([current.identity.id]));
		return current;
	}

	/** Loads the current snapshot from one deterministic stream before caller coordinates are checked. */
	private async _ReadCurrent(identityId: string): Promise<CurrentAgentIdentity | null>
	{
		const streamName = _AgentIdentityStreamName(identityId);
		let expectedRevision = 0n;
		let firstIdentity: AgentIdentity | null = null;
		let currentIdentity: AgentIdentity | null = null;
		let currentHeadDigest: string | null = null;

		for await (const event of this.historyStore.readStream({ streamName }))
		{
			const identity = _ValidatedAgentIdentityStreamEvent(event, streamName, expectedRevision);
			if (firstIdentity === null)
				firstIdentity = identity;
			else if (!_SameAgentIdentityCoordinates(firstIdentity, identity))
				throw new Error("Agent identity history changed stable identity coordinates");
			currentIdentity = identity;
			currentHeadDigest = _IdentityEventDigest(event);
			expectedRevision += 1n;
		}

		const head = await this.historyStore.readHead(streamName);
		if (currentIdentity === null)
		{
			if (head.revision !== null)
				throw new Error("Agent identity history omitted a stream event before its reported head");
			return null;
		}
		if (head.streamName !== streamName || head.revision !== expectedRevision - 1n)
			throw new Error("Agent identity history changed while loading its current state");

		if (currentHeadDigest === null)
			throw new Error("Agent identity history did not preserve its current event digest");
		return { streamName, revision: head.revision, headDigest: currentHeadDigest, identity: currentIdentity };
}

	/** Resolves the active parent chain and returns every checked parent head for an atomic child append. */
	private async _ParentBinding(identity: AgentIdentity, visited: ReadonlySet<string>): Promise<readonly CurrentAgentIdentity[]>
	{
		if (identity.kind !== "managed_subchat")
			return [];
		if (visited.has(identity.parentAgentIdentityId))
			throw new Error("Agent identity history detected a managed sub-chat parent cycle");
		const parent = await this._ReadCurrent(identity.parentAgentIdentityId);
		if (parent === null)
			throw new Error("Agent identity history cannot bind a managed sub-chat to a missing parent identity");
		if (parent.identity.siloId !== identity.siloId)
			throw new Error("Agent identity history cannot bind a managed sub-chat to a parent in a different silo");
		if (parent.identity.state !== AgentIdentityStates.Active)
			throw new Error("Agent identity history cannot bind a managed sub-chat to a non-active parent identity");
		if (_AgentIdentityPrincipalId(parent.identity) !== identity.parentPrincipalId)
			throw new Error("Agent identity history cannot bind a managed sub-chat to a parent with a different principal");
		return [parent, ...await this._ParentBinding(parent.identity, new Set([...visited, parent.identity.id]))];
	}

	/**
	 * Loads an identity only when it may request fresh protected work.
	 *
	 * @param command - Supplies the trusted coordinates that must match the current snapshot.
	 * @returns Current active identity state and stream-head evidence.
	 * @throws {Error} Rejects missing, suspended, revoked, or unlinked sub-chat identities without
	 * inheriting parent capabilities.
	 */
	public async loadActive(command: AgentIdentityCurrentCommand): Promise<CurrentAgentIdentity>
	{
		const current = await this.load(command);
		if (current === null)
			throw new Error("Agent identity history cannot authorize a missing identity");
		if (current.identity.state !== AgentIdentityStates.Active)
			throw new Error("Agent identity history cannot authorize a non-active identity");
		return current;
	}
}

/** Digests the exact typed Kurrent event that supplied the current identity head. */
function _IdentityEventDigest(event: { readonly id: string; readonly type: string; readonly data: unknown; readonly metadata: unknown; readonly revision: bigint; readonly recordedAt: Date }): string
{
	return ___DigestCanonicalJson({ id: event.id, type: event.type, data: event.data, metadata: event.metadata, revision: event.revision.toString(10), recordedAt: event.recordedAt.toISOString() } as JsonValue);
}

/** Builds the immutable event envelope that represents one checked identity snapshot append. */
function _IdentityAppend(command: AgentIdentityAppendCommand, identity: AgentIdentity, streamName: string): HistoryAppend
{
	return {
		streamName,
		expectedRevision: command.expectedRevision,
		events: [{
			id: command.eventId,
			type: "opencrane.agent-identity.v1",
			data: { identity },
			metadata: {
				siloId: identity.siloId,
				agentIdentityId: identity.id,
				agentServiceId: identity.agentServiceId,
				principalId: _AgentIdentityPrincipalId(identity),
				kind: identity.kind,
			},
		}],
	};
}

/** Checks the only expected revisions accepted by the HistoryStore append contract. */
function _ExpectedRevision(value: AgentIdentityAppendCommand["expectedRevision"]): boolean
{
	return value === HistoryExpectedRevisions.NoStream || (typeof value === "bigint" && value >= 0n);
}
