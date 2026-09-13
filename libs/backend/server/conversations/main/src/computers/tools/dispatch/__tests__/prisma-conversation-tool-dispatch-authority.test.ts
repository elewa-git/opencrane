import { afterEach, describe, expect, it, vi } from "vitest";

import { PrismaAuthorizationAuthority, type ProductAuthorizationWorkloadContext, type ToolInvocationRecord } from "@opencrane/backend/server/iam/authorization";
import { AuthorizationDecisionOutcomes, ProductAuthorizationActions, ProductAuthorizationResourceKinds } from "@opencrane/models/authorization";

import { ConversationToolComputerEvidenceReader } from "../conversation-tool-computer-evidence";
import type { ConversationToolComputerEvidence, ConversationToolRunEvidence } from "../conversation-tool-dispatch-evidence.types";
import { PrismaConversationToolAccessAuthority } from "../prisma-conversation-tool-access";
import { PrismaConversationToolDispatchAuthority } from "../prisma-conversation-tool-dispatch-authority";
import { PrismaConversationToolRunEvidenceRepository } from "../prisma-conversation-tool-run-evidence";

const _NOW = new Date("2026-09-13T11:00:00.000Z");
const _INVOCATION = { id: "invocation-1" } as ToolInvocationRecord;
const _WORKLOAD = { podUid: "mcp-pod" } as ProductAuthorizationWorkloadContext;

/** Keep the existing evidence owners observable while testing the public admission projection. */
function _Fixture()
{
	vi.spyOn(Date, "now").mockReturnValue(_NOW.getTime());
	const run = {
		conversationId: "conversation-1", deadlineEpochMs: _NOW.getTime() + 30_000,
		subject: { membership: { trustedUntil: new Date(_NOW.getTime() + 50_000).toISOString() }, requester: { membership: { trustedUntil: new Date(_NOW.getTime() + 40_000).toISOString() } } },
	} as ConversationToolRunEvidence;
	const computer = { identity: { kind: "proxied" }, leaseExpiresAtEpochMs: _NOW.getTime() + 20_000 } as ConversationToolComputerEvidence;
	const runs = vi.spyOn(PrismaConversationToolRunEvidenceRepository.prototype, "load").mockResolvedValue(run);
	const computers = vi.spyOn(ConversationToolComputerEvidenceReader.prototype, "load").mockResolvedValue(computer);
	const access = vi.spyOn(PrismaConversationToolAccessAuthority.prototype, "admitUntil").mockResolvedValue({ requesterSubjectId: "requester-subject-1", notAfterEpochMs: _NOW.getTime() + 10_000 });
	const authority = new PrismaConversationToolDispatchAuthority({} as never, {} as never);
	return { run, computer, runs, computers, access, authority };
}

afterEach(function _Restore() { vi.restoreAllMocks(); });

describe("current conversation tool admission", function _Suite()
{
	it("returns evidence only after all existing owners admit the current workload", async function _AdmittedEvidence()
	{
		const f = _Fixture();
		await expect(f.authority.admit(_INVOCATION, _NOW, _WORKLOAD)).resolves.toEqual({ conversationId: "conversation-1", requesterSubjectId: "requester-subject-1", identity: f.computer.identity, subject: f.run.subject, notAfterEpochMs: _NOW.getTime() + 10_000 });
		expect(f.runs).toHaveBeenCalledWith(_INVOCATION, _NOW);
		expect(f.access).toHaveBeenCalledWith(f.run, f.computer.identity, { actorKind: "workload", actorId: "mcp-pod", workload: _WORKLOAD }, _NOW.getTime());
	});

	it("attributes server recovery to one fixed system profile on the same evaluation path", async function _SystemEvidence()
	{
		const f = _Fixture();
		await expect(f.authority.admitSystem(_INVOCATION, _NOW, "opencrane-server/conversation-generated-file-v1")).resolves.toEqual(expect.objectContaining({ conversationId: "conversation-1" }));
		expect(f.access).toHaveBeenCalledWith(f.run, f.computer.identity, { actorKind: "system", actorId: "opencrane-server/conversation-generated-file-v1" }, _NOW.getTime());
	});

	it.each(["", "mcp-pod", "opencrane-server/generated file-v1", "opencrane-server/generated-v0"])('rejects invalid system actor profile "%s" before reading current state', async function _InvalidSystemActor(actorId)
	{
		const f = _Fixture();
		await expect(f.authority.admitSystem(_INVOCATION, _NOW, actorId)).rejects.toThrow("system actor is invalid");
		expect(f.runs).not.toHaveBeenCalled();
		expect(f.access).not.toHaveBeenCalled();
	});

	it("records system tool authorization without workload evidence", async function _SystemAudit()
	{
		const run = {
			siloId: "silo-1", conversationId: "conversation-1", toolRevisionId: "tool-revision-1", argumentsDigest: `sha256:${"a".repeat(64)}`, deadlineEpochMs: _NOW.getTime() + 10_000,
			authorization: { coordinates: [{ resource: { kind: ProductAuthorizationResourceKinds.McpToolRevision, id: "tool-revision-1" }, action: ProductAuthorizationActions.Invoke }] },
			subject: { principalId: "principal-1", runScope: { siloId: "silo-1", runId: "run-1", attempt: 2, agentServiceId: "service-1", agentRevisionId: "revision-1" } },
		} as unknown as ConversationToolRunEvidence;
		const access = new PrismaConversationToolAccessAuthority({} as never, { toolEligibility: function _Tools() { return { isEligible: vi.fn().mockResolvedValue(true) }; } } as never);
		const internals = access as unknown as { _LoadMembership: ReturnType<typeof vi.fn>; _AdmitRequester: ReturnType<typeof vi.fn> };
		vi.spyOn(internals, "_LoadMembership").mockResolvedValue({ requester: { trustedUntil: new Date(_NOW.getTime() + 10_000).toISOString() }, executionTrustedUntil: new Date(_NOW.getTime() + 10_000).toISOString() });
		vi.spyOn(internals, "_AdmitRequester").mockResolvedValue("requester-subject");
		const admission = vi.spyOn(PrismaAuthorizationAuthority.prototype, "admitPrincipal").mockResolvedValue({ outcome: AuthorizationDecisionOutcomes.Allow, reason: "winning_allow", grantIds: ["grant-1"], rule: {} as never, evidence: { decisionDigest: `sha256:${"b".repeat(64)}`, policyRevisionHash: `sha256:${"c".repeat(64)}`, effectiveAuthorizationDigest: `sha256:${"d".repeat(64)}` } });

		await access.admitUntil(run, { kind: "proxied" } as never, { actorKind: "system", actorId: "opencrane-server/conversation-generated-file-v1" }, _NOW.getTime());

		expect(admission).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ actorKind: "system", actorId: "opencrane-server/conversation-generated-file-v1", principalId: "principal-1", run: { runId: "run-1", attempt: 2, agentServiceId: "service-1", agentRevisionId: "revision-1" } }));
		expect("workload" in admission.mock.calls[0]![0]).toBe(false);
	});

	it("keeps the narrow dispatch deadline on the same evaluation path", async function _DeadlineProjection()
	{
		const f = _Fixture();
		await expect(f.authority.admitUntil(_INVOCATION, _NOW, _WORKLOAD)).resolves.toBe(_NOW.getTime() + 10_000);
		expect(f.runs).toHaveBeenCalledOnce();
		expect(f.computers).toHaveBeenCalledOnce();
		expect(f.access).toHaveBeenCalledOnce();
	});

	it("does not return evidence after current participation or tool permission ends", async function _PermissionEnded()
	{
		const f = _Fixture();
		f.access.mockResolvedValue(null);
		await expect(f.authority.admit(_INVOCATION, _NOW, _WORKLOAD)).resolves.toBeNull();
	});

	it("does not return evidence after the current lease expires during history reads", async function _ExpiredDuringRead()
	{
		const f = _Fixture();
		vi.spyOn(Date, "now").mockReturnValue(_NOW.getTime() + 20_000);
		await expect(f.authority.admit(_INVOCATION, _NOW, _WORKLOAD)).resolves.toBeNull();
	});

	it("propagates unavailable history so capture cannot commit after an incomplete check", async function _UnavailableHistory()
	{
		const f = _Fixture();
		f.computers.mockRejectedValue(new Error("history unavailable"));
		await expect(f.authority.admit(_INVOCATION, _NOW, _WORKLOAD)).rejects.toThrow("history unavailable");
		expect(f.access).not.toHaveBeenCalled();
	});
});
