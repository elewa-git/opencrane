import { AuthorizationDecisionOutcomes } from "@opencrane/models/authorization";
import { HistoryExpectedRevisions } from "@opencrane/backend/server/infra/history-store";
import { describe, expect, it, vi } from "vitest";

import { ConversationComputerRuntimeInputElicitationAuthority } from "../conversation-computer-runtime-input-elicitation";

const _REQUEST_ID = "31c1f1dc-0010-4f13-9c2f-d3841ffd6651";
const _NOW = new Date("2026-09-01T00:00:00.000Z");

function _Command()
{
	return { siloId: "silo-1", computerId: "computer-1", conversationId: "conversation-1", profileRevisionId: "profile-1", requestId: _REQUEST_ID, elicitationId: "elicitation-1", requestPayloadRef: "payload://request-1", requestPayloadDigest: `sha256:${"a".repeat(64)}` as const, causationId: "cause-1", correlationId: "correlation-1" };
}

function _Authority(overrides: { readonly conversationRevision?: bigint | HistoryExpectedRevisions.NoStream; readonly outcome?: AuthorizationDecisionOutcomes } = {})
{
	const appendAtomic = vi.fn().mockResolvedValue([{ streamName: "conversation-conversation-1", revision: 8n }]);
	const loadActiveExecutionForRuntime = vi.fn().mockResolvedValue({ streamName: "conversation-computer-computer-1", revision: 2n, computer: { id: "computer-1", agentIdentityId: "identity-1" }, lease: { generation: 3 }, execution: { id: "execution-1" } });
	const loadActiveAuthorization = vi.fn().mockResolvedValue({ identity: { id: "identity-1" }, principalId: "principal-1", actorKind: "agent-service", actorId: "identity-1", expectedIdentityHeads: [{ streamName: "agent-identity-identity-1", revision: 4n }] });
	const readCurrent = vi.fn().mockResolvedValue({ streamName: "conversation-conversation-1", expectedRevision: overrides.conversationRevision ?? 7n, entries: [] });
	const resolve = vi.fn().mockResolvedValue({ participantId: "participant-1" });
	const admitPrincipal = vi.fn().mockResolvedValue({ outcome: overrides.outcome ?? AuthorizationDecisionOutcomes.Allow, evidence: (overrides.outcome ?? AuthorizationDecisionOutcomes.Allow) === AuthorizationDecisionOutcomes.Allow ? { decisionEvidenceId: "audit-1" } : null });
	return { authority: new ConversationComputerRuntimeInputElicitationAuthority({ appendAtomic }, { loadActiveExecutionForRuntime } as never, { loadActiveAuthorization } as never, { readCurrent } as never, { resolve }, { admitPrincipal } as never, { now: function _Now(): Date { return _NOW; } }), appendAtomic, loadActiveExecutionForRuntime, loadActiveAuthorization, readCurrent, resolve, admitPrincipal };
}

describe("ConversationComputerRuntimeInputElicitationAuthority", function ()
{
	it("derives every authority coordinate and atomically appends a server-attested request at the conversation head", async function ()
	{
		const subject = _Authority();
		await expect(subject.authority.request(_Command())).resolves.toEqual({ receipt: { streamName: "conversation-conversation-1", revision: 8n } });
		expect(subject.loadActiveExecutionForRuntime).toHaveBeenCalledWith({ siloId: "silo-1", computerId: "computer-1", conversationId: "conversation-1", profileRevisionId: "profile-1", nowEpochMilliseconds: _NOW.getTime() });
		expect(subject.loadActiveAuthorization).toHaveBeenCalledWith({ siloId: "silo-1", agentIdentityId: "identity-1" });
		expect(subject.resolve).toHaveBeenCalledWith({ siloId: "silo-1", conversationId: "conversation-1", computerId: "computer-1", agentIdentityId: "identity-1" });
		expect(subject.appendAtomic).toHaveBeenCalledWith(expect.objectContaining({ expectedHeads: [{ streamName: "conversation-computer-computer-1", revision: 2n }, { streamName: "conversation-conversation-1", revision: 7n }, { streamName: "agent-identity-identity-1", revision: 4n }] }));
		const entry = subject.appendAtomic.mock.calls[0][0].appends[0].events[0].data.entry;
		expect(entry).toMatchObject({ position: "8", author: { kind: "system", systemId: "opencrane" }, computerExecutionId: "execution-1", leaseGeneration: 3, addressedParticipantId: "participant-1", attestation: { decisionEvidenceId: "audit-1" }, expiresAt: "2026-09-01T00:05:00.000Z" });
	});

	it("uses the no-stream conversation position and never appends after a current authorization denial", async function ()
	{
		const noStream = _Authority({ conversationRevision: HistoryExpectedRevisions.NoStream });
		await noStream.authority.request(_Command());
		expect(noStream.appendAtomic.mock.calls[0][0].appends[0].events[0].data.entry.position).toBe("0");
		const denied = _Authority({ outcome: AuthorizationDecisionOutcomes.Deny });
		await expect(denied.authority.request(_Command())).rejects.toThrow("denied by current authorization");
		expect(denied.appendAtomic).not.toHaveBeenCalled();
	});

	it("rejects malformed runtime input before loading any durable authority", async function ()
	{
		const subject = _Authority();
		await expect(subject.authority.request({ ..._Command(), requestId: "not-a-uuid" })).rejects.toThrow("valid request coordinates");
		expect(subject.loadActiveExecutionForRuntime).not.toHaveBeenCalled();
	});
});
