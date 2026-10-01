import { randomUUID } from "node:crypto";

import { KurrentDBClient } from "@kurrent/kurrentdb-client";
import { HistoryExpectedRevisions, _KurrentHistoryStore } from "@opencrane/backend/server/infra/history-store";
import { ConversationEntryKinds } from "@opencrane/contracts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { ConversationHistoryAuthority } from "../conversation-history-authority";
import { ConversationHistoryAppendOutcomes, type ConversationHistoryActivationAppendCommand, type ConversationHistoryAppendCommand, type ConversationHistoryAttestedAppendCommand } from "../conversation-history-authority.types";

/**
 * Live proofs that `ConversationHistoryAuthority` turns real KurrentDB conflicts into retryable outcomes.
 *
 * The unit tests hand the authority a `WrongExpectedVersionError` they construct themselves. This file lets the
 * real `@kurrent/kurrentdb-client` raise the error for a stale conversation head and for a stale activation queue
 * head, and checks that posting reports `ExpectedHeadConflict` instead of throwing (which would be a 500).
 *
 * Set `KURRENTDB_INTEGRATION_URL` to run it through backend-server-conversations:test:integration.
 * @see ../../../../infra/history-store/src/__tests__/kurrent-history-store.integration.ts for the adapter-level proofs.
 */

/** Names the one environment variable that opts a machine into the live suite. */
const _URL_VARIABLE = "KURRENTDB_INTEGRATION_URL";
/** Holds the connection string, or undefined when the suite must skip. */
const _URL = process.env[_URL_VARIABLE];

/** Names a silo, conversation, or computer that no earlier run can have used. */
function _identifier(prefix: string): string
{
	return `${prefix}-${randomUUID()}`;
}

/** Builds a valid server-stamped entry whose position follows the expected revision, as the authority requires. */
function _command(siloId: string, conversationId: string, expectedRevision: bigint): ConversationHistoryAppendCommand
{
	const id = randomUUID();
	return {
		siloId,
		conversationId,
		expectedRevision,
		entry: {
			schemaVersion: 1,
			id,
			conversationId,
			position: (expectedRevision + 1n).toString(),
			author: { kind: "agent", agentIdentityId: "identity-1", agentServiceId: "service-1", name: "Archive", avatarArtifactRevisionId: null },
			provenance: "agent-authored",
			visibility: { audience: "conversation" },
			runId: "run-1",
			causationId: "source-1",
			correlationId: "request-1",
			idempotencyKey: id,
			occurredAt: "2026-09-01T00:00:00.000Z",
			attestation: null,
			kind: "a2ui",
			surfaceId: "surface-1",
			a2uiSchemaVersion: "0.8",
			operation: "remove",
			payloadRef: null,
			payloadDigest: null,
		},
	};
}

/** Adds the activation coordinates that `appendWithActivation` checks against the silo queue head. */
function _activationCommand(siloId: string, conversationId: string, expectedRevision: bigint, queueExpectedRevision: HistoryExpectedRevisions.NoStream | bigint): ConversationHistoryActivationAppendCommand
{
	const command = _command(siloId, conversationId, expectedRevision);
	if (command.entry.kind !== ConversationEntryKinds.A2UI)
		throw new Error("test fixture requires an A2UI entry");
	const { surfaceId: _surface, a2uiSchemaVersion: _schema, operation: _operation, payloadRef: _payload, payloadDigest: _digest, ...common } = command.entry;
	const entry = { ...common, author: { kind: "human" as const, principalId: "principal-1", participantId: "subject-1", issuer: "https://issuer.test", authenticatedAt: "2026-09-01T00:00:00.000Z", name: "Jente", avatarArtifactRevisionId: null }, provenance: "human-authored" as const, runId: null, kind: "message" as const, state: "completed" as const, blocks: [{ id: `block-${command.entry.id}`, kind: "text" as const, payloadRef: `payload-${command.entry.id}`, ciphertextDigest: `sha256:${command.entry.id}` }], replyToEntryId: null, addressedAgentIdentityId: null, activation: "start" as const };
	return { ...command, entry, activation: { computerId: "computer-1", generation: 1, eventId: randomUUID(), queueExpectedRevision } };
}

/** Builds one system log whose attestation points to the receipt committed beside it. */
function _attestedCommand(siloId: string, conversationId: string, expectedRevision: bigint, approvalId: string): ConversationHistoryAttestedAppendCommand
{
	const receiptId = randomUUID();
	const streamName = `conversation-approval-notification-${approvalId}`;
	const base = _command(siloId, conversationId, expectedRevision);
	return { ...base, entry: { schemaVersion: 1, id: approvalId, conversationId, position: (expectedRevision + 1n).toString(), author: { kind: "system", systemId: "opencrane", name: "OpenCrane" }, provenance: "service-attested", visibility: { audience: "participant_subset", participantIds: ["participant-1"] }, runId: "run-1", causationId: approvalId, correlationId: "run-1", idempotencyKey: approvalId, occurredAt: "2026-09-01T00:00:00.000Z", attestation: { serviceId: "opencrane", receiptId, domainStream: streamName, domainRevision: "0", decisionEvidenceId: null }, kind: "log", logKind: "approval", approvalId, action: "Invoke tool", phase: "requested", summary: "Approval requested", detailsRef: null }, attestation: { streamName, event: { id: receiptId, type: "opencrane.conversation-approval-notification.v1", data: { approvalId }, metadata: { siloId, conversationId } } } };
}

it.skipIf(_URL !== undefined)(`skips the live ConversationHistoryAuthority proofs because ${_URL_VARIABLE} is unset`, function ()
{
	expect(_URL).toBeUndefined();
});

describe.skipIf(_URL === undefined)("ConversationHistoryAuthority against a live KurrentDB", function ()
{
	let client: KurrentDBClient;
	let store: _KurrentHistoryStore;
	let authority: ConversationHistoryAuthority;

	beforeAll(function _connect()
	{
		client = KurrentDBClient.connectionString(_URL ?? "");
		store = new _KurrentHistoryStore(client);
		authority = new ConversationHistoryAuthority(store);
	});

	afterAll(async function _disconnect()
	{
		await client.dispose();
	});

	/** Creates the immutable genesis for one fresh conversation and returns its coordinates. */
	async function _createConversation(siloId: string): Promise<string>
	{
		const conversationId = _identifier("conversation");
		const genesis = authority.genesisAppend({ schemaVersion: 1, conversationId, siloId, mode: "direct", agentServiceId: null, createdByPrincipalId: "principal-1", createdAt: new Date().toISOString() }, randomUUID());
		await store.append(genesis);
		return conversationId;
	}

	it("appends a first entry at the genesis head and reports a stale writer as ExpectedHeadConflict", async function ()
	{
		const siloId = _identifier("silo");
		const conversationId = await _createConversation(siloId);

		const appended = await authority.append(_command(siloId, conversationId, 0n));
		const stale = await authority.append(_command(siloId, conversationId, 0n));

		expect(appended).toEqual({ outcome: ConversationHistoryAppendOutcomes.Appended, receipt: { streamName: `conversation-${conversationId}`, revision: 1n } });
		expect(stale).toEqual({ outcome: ConversationHistoryAppendOutcomes.ExpectedHeadConflict });
		expect(await store.readHead(`conversation-${conversationId}`)).toEqual({ streamName: `conversation-${conversationId}`, revision: 1n });
	});

	it("appends a message with its activation request and reports a stale activation queue as ExpectedHeadConflict", async function ()
	{
		const siloId = _identifier("silo");
		const conversationId = await _createConversation(siloId);
		const queueStreamName = `computer-activations-${siloId}`;

		const appended = await authority.appendWithActivation(_activationCommand(siloId, conversationId, 0n, HistoryExpectedRevisions.NoStream));
		const staleQueue = await authority.appendWithActivation(_activationCommand(siloId, conversationId, 1n, HistoryExpectedRevisions.NoStream));
		const staleConversation = await authority.appendWithActivation(_activationCommand(siloId, conversationId, 0n, 0n));

		expect(appended).toEqual({ outcome: ConversationHistoryAppendOutcomes.Appended, receipt: { streamName: `conversation-${conversationId}`, revision: 1n } });
		expect(staleQueue).toEqual({ outcome: ConversationHistoryAppendOutcomes.ExpectedHeadConflict });
		expect(staleConversation).toEqual({ outcome: ConversationHistoryAppendOutcomes.ExpectedHeadConflict });
		expect(await store.readHead(`conversation-${conversationId}`)).toEqual({ streamName: `conversation-${conversationId}`, revision: 1n });
		expect(await store.readHead(queueStreamName)).toEqual({ streamName: queueStreamName, revision: 0n });
	});

	it("atomically commits an attestation receipt with one conversation entry", async function _AttestedAppend()
	{
		const siloId = _identifier("silo");
		const conversationId = await _createConversation(siloId);
		const approvalId = randomUUID();
		const command = _attestedCommand(siloId, conversationId, 0n, approvalId);

		const appended = await authority.appendWithAttestation(command);
		const replay = await authority.appendWithAttestation(command);

		expect(appended).toEqual({ outcome: ConversationHistoryAppendOutcomes.Appended, receipt: { streamName: `conversation-${conversationId}`, revision: 1n } });
		expect(replay).toEqual({ outcome: ConversationHistoryAppendOutcomes.Appended, receipt: { streamName: `conversation-${conversationId}`, revision: 1n } });
		expect(await store.readHead(command.attestation.streamName)).toEqual({ streamName: command.attestation.streamName, revision: 0n });
		expect(await store.readHead(`conversation-${conversationId}`)).toEqual({ streamName: `conversation-${conversationId}`, revision: 1n });
	});
});
