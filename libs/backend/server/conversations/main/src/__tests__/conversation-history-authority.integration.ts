import { randomUUID } from "node:crypto";

import { KurrentDBClient } from "@kurrent/kurrentdb-client";
import { HistoryExpectedRevisions, _KurrentHistoryStore } from "@opencrane/backend/server/infra/history-store";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { ConversationHistoryAuthority } from "../conversation-history-authority";
import { ConversationHistoryAppendOutcomes, type ConversationHistoryActivationAppendCommand, type ConversationHistoryAppendCommand } from "../conversation-history-authority.types";

/**
 * Live proofs that `ConversationHistoryAuthority` turns real KurrentDB conflicts into retryable outcomes.
 *
 * The unit tests hand the authority a `WrongExpectedVersionError` they construct themselves. This file lets the
 * real `@kurrent/kurrentdb-client` raise the error for a stale conversation head and for a stale activation queue
 * head, and checks that posting reports `ExpectedHeadConflict` instead of throwing (which would be a 500).
 *
 * Set `KURRENTDB_INTEGRATION_URL` to run it; the history-store `test:integration` target collects this file.
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
	return { ..._command(siloId, conversationId, expectedRevision), activation: { computerId: "computer-1", generation: 1, eventId: randomUUID(), queueExpectedRevision } };
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
});
