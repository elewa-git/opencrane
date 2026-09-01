import { ConversationElicitationEntryKinds, ConversationElicitationEntryStates, ConversationEntryKinds, type ConversationEntry, type ElicitationRequestEntry, type ElicitationResolutionEntry } from "@opencrane/contracts";
import { describe, expect, it, vi } from "vitest";

import { ConversationComputerElicitationInterruptReader } from "../conversation-computer-elicitation-interrupt-reader";

/** Fixes the target request's server-owned expiry boundary. */
const _NOW = new Date("2026-09-01T00:01:00.000Z");

/** Creates one valid target RuntimeInput request addressed to the normal participant fixture. */
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
		attestation: { serviceId: "opencrane", receiptId: "request-1", domainStream: "conversation-computer-computer-1", domainRevision: "2", decisionEvidenceId: "audit-request-1" },
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

/** Creates the terminal entry that closes one request without leaving a browser overlay. */
function _Resolution(overrides: Partial<ElicitationResolutionEntry> = {}): ElicitationResolutionEntry
{
	return {
		schemaVersion: 1,
		id: "resolution-1",
		conversationId: "conversation-1",
		position: "8",
		author: { kind: "system", systemId: "opencrane", name: "OpenCrane" },
		provenance: "service-attested",
		visibility: { audience: "participant_subset", participantIds: ["participant-1"] },
		causationId: "request-1",
		correlationId: "correlation-1",
		idempotencyKey: "resolution-1",
		occurredAt: "2026-09-01T00:01:00.000Z",
		attestation: { serviceId: "opencrane", receiptId: "resolution-1", domainStream: "conversation-computer-computer-1", domainRevision: "2", decisionEvidenceId: "audit-resolution-1" },
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

/** Builds independent observable ports for the target browser interrupt reader. */
function _Reader(overrides: { readonly entries?: readonly ConversationEntry[]; readonly participantId?: string | null; readonly execution?: { readonly computerId: string; readonly executionId: string; readonly leaseGeneration: number } | null; readonly now?: Date; readonly presentation?: { readonly message: string; readonly responseSchema: Readonly<Record<string, unknown>> } } = {})
{
	const read = vi.fn().mockResolvedValue({ streamName: "conversation-conversation-1", entries: overrides.entries ?? [_Request()] });
	const resolvedParticipant = _ResolvedParticipant(overrides.participantId);
	const resolve = vi.fn().mockResolvedValue(resolvedParticipant);
	const resolvedExecution = _ResolvedExecution(overrides.execution);
	const resolveExecution = vi.fn().mockResolvedValue(resolvedExecution);
	const readRequestForParticipant = vi.fn().mockResolvedValue(overrides.presentation ?? { message: "May I continue?", responseSchema: { type: "object", additionalProperties: false } });
	const reader = new ConversationComputerElicitationInterruptReader({ read } as never, { resolve }, { resolve: resolveExecution }, { readRequestForParticipant }, { now: function _Now(): Date { return overrides.now ?? _NOW; } });
	return { reader, read, resolve, resolveExecution, readRequestForParticipant };
}

/** Returns the configured participant result without compressing three authority outcomes. */
function _ResolvedParticipant(participantId: string | null | undefined): { readonly participantId: string } | null
{
	if (participantId === undefined)
		return { participantId: "participant-1" };
	if (participantId === null)
		return null;
	return { participantId };
}

/** Returns the configured active execution result without using a browser-selected coordinate. */
function _ResolvedExecution(execution: { readonly computerId: string; readonly executionId: string; readonly leaseGeneration: number } | null | undefined): { readonly computerId: string; readonly executionId: string; readonly leaseGeneration: number } | null
{
	if (execution === undefined)
		return { computerId: "computer-1", executionId: "execution-1", leaseGeneration: 3 };
	return execution;
}

describe("ConversationComputerElicitationInterruptReader", function _Suite()
{
	it("derives the addressed participant, verifies its protected presentation, and uses computer execution as opaque AG-UI correlation", async function _ReadsTargetInterrupt()
	{
		const subject = _Reader();

		await expect(subject.reader.readOpen({ siloId: "silo-1", conversationId: "conversation-1", subjectId: "subject-1" })).resolves.toEqual([expect.objectContaining({ conversationId: "conversation-1", runId: "execution-1", payload: { interrupt: expect.objectContaining({ id: "request-1", message: "May I continue?", expiresAt: "2026-09-01T00:05:00.000Z" }) } })]);
		expect(subject.resolve).toHaveBeenCalledWith({ siloId: "silo-1", conversationId: "conversation-1", subjectId: "subject-1" });
		expect(subject.readRequestForParticipant).toHaveBeenCalledWith(expect.objectContaining({ siloId: "silo-1", conversationId: "conversation-1", participantId: "participant-1", request: expect.objectContaining({ requestPayloadDigest: `sha256:${"a".repeat(64)}` }) }));
	});

	it("returns no request detail when the authenticated subject no longer resolves to a participant", async function _HidesRevokedParticipant()
	{
		const subject = _Reader({ participantId: null });

		await expect(subject.reader.readOpen({ siloId: "silo-1", conversationId: "conversation-1", subjectId: "subject-1" })).resolves.toEqual([]);
		expect(subject.read).not.toHaveBeenCalled();
		expect(subject.readRequestForParticipant).not.toHaveBeenCalled();
	});

	it("returns no request detail when the conversation no longer has a current active computer execution", async function _HidesColdComputer()
	{
		const subject = _Reader({ execution: null });

		await expect(subject.reader.readOpen({ siloId: "silo-1", conversationId: "conversation-1", subjectId: "subject-1" })).resolves.toEqual([]);
		expect(subject.read).not.toHaveBeenCalled();
		expect(subject.readRequestForParticipant).not.toHaveBeenCalled();
	});

	it("omits resolved, expired, and differently addressed target requests before protected payload access", async function _OmitsClosedRequests()
	{
		const subject = _Reader({ entries: [_Request(), _Resolution(), _Request({ id: "request-2", idempotencyKey: "request-2", position: "9", addressedParticipantId: "participant-2" }), _Request({ id: "request-3", idempotencyKey: "request-3", position: "10", expiresAt: "2026-09-01T00:00:30.000Z" })] });

		await expect(subject.reader.readOpen({ siloId: "silo-1", conversationId: "conversation-1", subjectId: "subject-1" })).resolves.toEqual([]);
		expect(subject.readRequestForParticipant).not.toHaveBeenCalled();
	});

	it("restores only the request fenced to the current computer execution when historical executions overlap", async function _FencesSupersededExecution()
	{
		const subject = _Reader({ entries: [_Request({ id: "request-old", idempotencyKey: "request-old", computerExecutionId: "execution-old", leaseGeneration: 2 }), _Request()] });

		await expect(subject.reader.readOpen({ siloId: "silo-1", conversationId: "conversation-1", subjectId: "subject-1" })).resolves.toEqual([expect.objectContaining({ runId: "execution-1", payload: { interrupt: expect.objectContaining({ id: "request-1" }) } })]);
		expect(subject.readRequestForParticipant).toHaveBeenCalledTimes(1);
		expect(subject.readRequestForParticipant).toHaveBeenCalledWith(expect.objectContaining({ request: expect.objectContaining({ id: "request-1" }) }));
	});

	it("fails closed when the protected payload boundary returns an invalid browser presentation", async function _RejectsInvalidPresentation()
	{
		const subject = _Reader({ presentation: { message: "  ", responseSchema: {} } });

		await expect(subject.reader.readOpen({ siloId: "silo-1", conversationId: "conversation-1", subjectId: "subject-1" })).rejects.toThrow("invalid protected presentation");
	});

	it("rejects browser coordinates that have not come from a trusted socket adapter", async function _RejectsInvalidCoordinates()
	{
		const subject = _Reader();

		await expect(subject.reader.readOpen({ siloId: "silo-1", conversationId: " conversation-1 ", subjectId: "subject-1" })).rejects.toThrow("trusted socket coordinates");
		expect(subject.resolve).not.toHaveBeenCalled();
	});
});
