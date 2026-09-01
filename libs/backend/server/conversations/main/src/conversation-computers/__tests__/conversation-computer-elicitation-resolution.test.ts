import { ConversationElicitationEntryKinds, ConversationElicitationEntryStates, ConversationEntryKinds, type ConversationEntry, type ElicitationRequestEntry, type ElicitationResolutionEntry } from "@opencrane/contracts";
import { AuthorizationDecisionOutcomes } from "@opencrane/models/authorization";
import { describe, expect, it, vi } from "vitest";

import { ConversationComputerElicitationResolutionAuthority } from "../conversation-computer-elicitation-resolution";

/** Names the retry key used by the normal participant resolution fixture. */
const _RESOLUTION_ID = "41c1f1dc-0010-4f13-9c2f-d3841ffd6651";
/** Fixes the server clock so terminal state and attestation assertions remain deterministic. */
const _NOW = new Date("2026-09-01T00:01:00.000Z");

/** Creates the transport-safe input used by one addressed participant. */
function _Command()
{
	return { caller: { siloId: "silo-1", principalId: "principal-1", actorId: "user-1" }, conversationId: "conversation-1", requestEntryId: "request-1", resolutionId: _RESOLUTION_ID, response: { answer: "yes" } };
}

/** Creates the durable RuntimeInput request that target participant resolution must fence. */
function _Request(overrides: Partial<ElicitationRequestEntry> = {}): ElicitationRequestEntry
{
	return {
		schemaVersion: 1,
		id: "request-1",
		conversationId: "conversation-1",
		position: "7",
		author: { kind: "system", systemId: "opencrane", name: "OpenCrane" },
		provenance: "service-attested",
		visibility: { audience: "participant_subset", participantIds: ["participant-1"] },
		causationId: "cause-1",
		correlationId: "correlation-1",
		idempotencyKey: "request-1",
		occurredAt: "2026-09-01T00:00:00.000Z",
		attestation: { serviceId: "opencrane", receiptId: "request-1", domainStream: "computer-computer-1", domainRevision: "2", decisionEvidenceId: "audit-request-1" },
		kind: ConversationEntryKinds.Elicitation,
		elicitationId: "elicitation-1",
		computerId: "computer-1",
		computerExecutionId: "execution-1",
		leaseGeneration: 3,
		elicitationKind: ConversationElicitationEntryKinds.RuntimeInput,
		state: ConversationElicitationEntryStates.Requested,
		profileRevisionId: "profile-1",
		addressedParticipantId: "participant-1",
		requestPayloadRef: "payload://request-1",
		requestPayloadDigest: `sha256:${"a".repeat(64)}`,
		expiresAt: "2026-09-01T00:05:00.000Z",
		...overrides,
	};
}

/** Creates the one terminal entry needed to exercise response-lost retry behavior. */
function _Resolution(overrides: Partial<ElicitationResolutionEntry> = {}): ElicitationResolutionEntry
{
	return {
		schemaVersion: 1,
		id: _RESOLUTION_ID,
		conversationId: "conversation-1",
		position: "8",
		author: { kind: "system", systemId: "opencrane", name: "OpenCrane" },
		provenance: "service-attested",
		visibility: { audience: "participant_subset", participantIds: ["participant-1"] },
		causationId: "request-1",
		correlationId: "correlation-1",
		idempotencyKey: _RESOLUTION_ID,
		occurredAt: _NOW.toISOString(),
		attestation: { serviceId: "opencrane", receiptId: _RESOLUTION_ID, domainStream: "computer-computer-1", domainRevision: "2", decisionEvidenceId: "audit-resolution-1" },
		kind: ConversationEntryKinds.Elicitation,
		elicitationId: "elicitation-1",
		computerId: "computer-1",
		computerExecutionId: "execution-1",
		leaseGeneration: 3,
		elicitationKind: ConversationElicitationEntryKinds.RuntimeInput,
		state: ConversationElicitationEntryStates.Answered,
		requestEntryId: "request-1",
		responsePayloadRef: "payload://response-1",
		responsePayloadDigest: `sha256:${"b".repeat(64)}`,
		...overrides,
	};
}

/** Builds a fully fenced authority with independently observable target ports. */
function _Authority(overrides: { readonly entries?: readonly ConversationEntry[]; readonly participantId?: string; readonly now?: Date; readonly authorizationOutcome?: AuthorizationDecisionOutcomes } = {})
{
	const appendAtomic = vi.fn().mockResolvedValue([{ streamName: "conversation-conversation-1", revision: 8n }]);
	const loadActiveExecutionForRuntime = vi.fn().mockResolvedValue({ streamName: "computer-computer-1", revision: 2n, computer: { id: "computer-1", agentIdentityId: "identity-1" }, lease: { generation: 3 }, execution: { id: "execution-1" } });
	const loadActiveAuthorization = vi.fn().mockResolvedValue({ identity: { id: "identity-1" }, expectedIdentityHeads: [{ streamName: "agent-identity-identity-1", revision: 4n }] });
	const readCurrent = vi.fn().mockResolvedValue({ streamName: "conversation-conversation-1", expectedRevision: 7n, entries: overrides.entries ?? [_Request()] });
	const resolve = vi.fn().mockResolvedValue({ participantId: overrides.participantId ?? "participant-1" });
	const prepareResponse = vi.fn().mockResolvedValue({ responseDigest: `sha256:${"b".repeat(64)}`, payload: { answer: "yes" } });
	const storeResponse = vi.fn().mockResolvedValue({ responsePayloadRef: "payload://response-1", responsePayloadDigest: `sha256:${"b".repeat(64)}` });
	const admitPrincipal = vi.fn().mockResolvedValue({ outcome: overrides.authorizationOutcome ?? AuthorizationDecisionOutcomes.Allow, evidence: (overrides.authorizationOutcome ?? AuthorizationDecisionOutcomes.Allow) === AuthorizationDecisionOutcomes.Allow ? { decisionEvidenceId: "audit-resolution-1" } : null });
	const clock = { now: function _Now(): Date { return overrides.now ?? _NOW; } };
	return { authority: new ConversationComputerElicitationResolutionAuthority({ appendAtomic }, { loadActiveExecutionForRuntime } as never, { loadActiveAuthorization } as never, { readCurrent } as never, { resolve }, { prepareResponse, storeResponse }, { admitPrincipal } as never, clock), appendAtomic, loadActiveExecutionForRuntime, loadActiveAuthorization, readCurrent, resolve, prepareResponse, storeResponse, admitPrincipal };
}

describe("ConversationComputerElicitationResolutionAuthority", function ()
{
	it("derives the addressed participant and atomically appends an attested typed answer under all checked heads", async function ()
	{
		const subject = _Authority();

		await expect(subject.authority.resolve(_Command())).resolves.toEqual({ receipt: { streamName: "conversation-conversation-1", revision: 8n }, state: "answered" });
		expect(subject.resolve).toHaveBeenCalledWith({ caller: _Command().caller, conversationId: "conversation-1" });
		expect(subject.prepareResponse).toHaveBeenCalledWith(expect.objectContaining({ request: expect.objectContaining({ requestPayloadDigest: `sha256:${"a".repeat(64)}` }), participantId: "participant-1", response: { answer: "yes" } }));
		expect(subject.storeResponse).toHaveBeenCalledWith(expect.objectContaining({ resolutionId: _RESOLUTION_ID, participantId: "participant-1" }));
		expect(subject.appendAtomic).toHaveBeenCalledWith(expect.objectContaining({ expectedHeads: [{ streamName: "computer-computer-1", revision: 2n }, { streamName: "conversation-conversation-1", revision: 7n }, { streamName: "agent-identity-identity-1", revision: 4n }] }));
		const entry = subject.appendAtomic.mock.calls[0][0].appends[0].events[0].data.entry;
		expect(entry).toMatchObject({ author: { kind: "system", systemId: "opencrane" }, causationId: "request-1", requestEntryId: "request-1", computerExecutionId: "execution-1", leaseGeneration: 3, state: ConversationElicitationEntryStates.Answered, responsePayloadRef: "payload://response-1", attestation: { decisionEvidenceId: "audit-resolution-1" } });
	});

	it("records a decline without preparing or storing a response payload", async function ()
	{
		const subject = _Authority();

		await expect(subject.authority.resolve({ ..._Command(), response: null })).resolves.toEqual({ receipt: { streamName: "conversation-conversation-1", revision: 8n }, state: "declined" });
		expect(subject.prepareResponse).not.toHaveBeenCalled();
		expect(subject.storeResponse).not.toHaveBeenCalled();
		expect(subject.appendAtomic.mock.calls[0][0].appends[0].events[0].data.entry).toMatchObject({ state: ConversationElicitationEntryStates.Declined, responsePayloadRef: null, responsePayloadDigest: null });
	});

	it("expires an overdue request without accepting the late participant response", async function ()
	{
		const subject = _Authority({ now: new Date("2026-09-01T00:06:00.000Z") });

		await expect(subject.authority.resolve(_Command())).resolves.toEqual({ receipt: { streamName: "conversation-conversation-1", revision: 8n }, state: "expired" });
		expect(subject.prepareResponse).not.toHaveBeenCalled();
		expect(subject.storeResponse).not.toHaveBeenCalled();
		expect(subject.appendAtomic.mock.calls[0][0].appends[0].events[0].data.entry.state).toBe(ConversationElicitationEntryStates.Expired);
	});

	it("rejects a caller that does not currently resolve to the addressed participant before it reads payloads or authorizes", async function ()
	{
		const subject = _Authority({ participantId: "participant-2" });

		await expect(subject.authority.resolve(_Command())).rejects.toThrow("not the addressed participant");
		expect(subject.prepareResponse).not.toHaveBeenCalled();
		expect(subject.admitPrincipal).not.toHaveBeenCalled();
		expect(subject.appendAtomic).not.toHaveBeenCalled();
	});

	it("denies a revoked caller before protected request payload validation begins", async function ()
	{
		const subject = _Authority({ authorizationOutcome: AuthorizationDecisionOutcomes.Deny });

		await expect(subject.authority.resolve(_Command())).rejects.toThrow("denied by current authorization");
		expect(subject.prepareResponse).not.toHaveBeenCalled();
		expect(subject.storeResponse).not.toHaveBeenCalled();
		expect(subject.appendAtomic).not.toHaveBeenCalled();
	});

	it("returns only an exact authorized response-lost retry without rechecking runtime heads or appending", async function ()
	{
		const subject = _Authority({ entries: [_Request(), _Resolution()] });

		await expect(subject.authority.resolve(_Command())).resolves.toEqual({ receipt: { streamName: "conversation-conversation-1", revision: 8n }, state: "answered" });
		expect(subject.admitPrincipal).toHaveBeenCalledTimes(1);
		expect(subject.prepareResponse).toHaveBeenCalledTimes(1);
		expect(subject.loadActiveExecutionForRuntime).not.toHaveBeenCalled();
		expect(subject.storeResponse).not.toHaveBeenCalled();
		expect(subject.appendAtomic).not.toHaveBeenCalled();
	});

	it("keeps an earlier accepted answer retryable after its request deadline passes", async function ()
	{
		const subject = _Authority({ entries: [_Request(), _Resolution()], now: new Date("2026-09-01T00:06:00.000Z") });

		await expect(subject.authority.resolve(_Command())).resolves.toEqual({ receipt: { streamName: "conversation-conversation-1", revision: 8n }, state: "answered" });
		expect(subject.appendAtomic).not.toHaveBeenCalled();
	});

	it("rejects a changed answer shape that reuses an earlier decline identifier", async function ()
	{
		const subject = _Authority({ entries: [_Request(), _Resolution({ state: ConversationElicitationEntryStates.Declined, responsePayloadRef: null, responsePayloadDigest: null })] });

		await expect(subject.authority.resolve(_Command())).rejects.toThrow("already owns different terminal facts");
		expect(subject.prepareResponse).not.toHaveBeenCalled();
		expect(subject.appendAtomic).not.toHaveBeenCalled();
	});

	it("rejects a different resolution identifier after a terminal winner exists", async function ()
	{
		const subject = _Authority({ entries: [_Request(), _Resolution()] });

		await expect(subject.authority.resolve({ ..._Command(), resolutionId: "51c1f1dc-0010-4f13-9c2f-d3841ffd6651" })).rejects.toThrow("already has a terminal resolution");
		expect(subject.appendAtomic).not.toHaveBeenCalled();
	});

	it("propagates a checked-head conflict without reporting a terminal winner", async function ()
	{
		const subject = _Authority();
		subject.appendAtomic.mockRejectedValueOnce(new Error("stale expected conversation head"));

		await expect(subject.authority.resolve(_Command())).rejects.toThrow("stale expected conversation head");
		expect(subject.appendAtomic).toHaveBeenCalledTimes(1);
	});

	it("retries the exact payload storage coordinates after an atomic conflict", async function ()
	{
		const subject = _Authority();
		subject.appendAtomic.mockRejectedValueOnce(new Error("stale expected conversation head"));

		await expect(subject.authority.resolve(_Command())).rejects.toThrow("stale expected conversation head");
		await expect(subject.authority.resolve(_Command())).resolves.toEqual({ receipt: { streamName: "conversation-conversation-1", revision: 8n }, state: "answered" });
		expect(subject.storeResponse).toHaveBeenCalledTimes(2);
		expect(subject.storeResponse.mock.calls[0][0]).toEqual(subject.storeResponse.mock.calls[1][0]);
	});

	it("rejects malformed resolution identifiers before it reads durable history", async function ()
	{
		const subject = _Authority();

		await expect(subject.authority.resolve({ ..._Command(), resolutionId: "not-a-uuid" })).rejects.toThrow("UUID resolution identifier");
		expect(subject.readCurrent).not.toHaveBeenCalled();
	});
});
