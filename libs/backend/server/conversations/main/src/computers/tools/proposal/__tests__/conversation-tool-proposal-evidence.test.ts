import { AgentRunState, type Prisma } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

import { ___ExecutionSubjectSchema, ExecutionSubjectMembershipKinds } from "@opencrane/contracts";
import { ProductAuthorizationActions, ProductAuthorizationResourceKinds } from "@opencrane/models/authorization";
import { ___DigestCanonicalJson, type JsonValue } from "@opencrane/util";

import type { ConversationComputerTurnCandidate, FrozenConversationComputerTurn } from "../../../turns/conversation-computer-turn.types";
import type { PreparedConversationToolProposal } from "../conversation-tool-proposal.types";
import { _CreateConversationToolProposalIntent } from "../conversation-tool-proposal-intent";
import { PrismaConversationToolProposalRunRepository } from "../prisma-conversation-tool-proposal-run-reader";

/** Supply valid saved evidence while keeping the database rows independently replaceable. */
function _fixture()
{
	const now = "2026-09-09T00:00:00.000Z";
	const membership = {
		kind: ExecutionSubjectMembershipKinds.Standalone,
		principalId: "person-1", siloId: "silo-1", issuer: "https://identity.example.test", subjectId: "user-1",
		membershipId: "membership-1", membershipUpdatedAt: now, observedAt: now, trustedUntil: "2026-09-09T00:01:00.000Z",
	};
	const subject = ___ExecutionSubjectSchema.parse({
		schemaVersion: 1, siloId: "silo-1", agentIdentityId: "identity-1", principalId: "person-1",
		identity: {
			agentIdentityId: "identity-1", principalId: "person-1", siloId: "silo-1", headRevision: "0",
			headDigest: ___DigestCanonicalJson("identity"), decisionEvidenceId: "identity-decision", verifiedAt: now,
		},
		membership,
		capability: {
			agentIdentityId: "identity-1", computerId: "computer-1", capabilitySetDigest: ___DigestCanonicalJson("capabilities"),
			effectiveContractDigest: ___DigestCanonicalJson("contract"), decisionEvidenceId: "capability-decision", decidedAt: now,
		},
		runScope: { siloId: "silo-1", runId: "run-1", attempt: 1, agentServiceId: "service-1", agentRevisionId: "revision-1" },
		computerScope: { siloId: "silo-1", computerId: "computer-1", leaseId: "lease-1", leaseGeneration: 1 },
		requester: { membership, siloId: "silo-1", requesterPrincipalId: "person-1", requestIdempotencyKey: "request-1", authenticatedAt: now },
		admission: { authorizingPrincipalId: "person-1", decisionEvidenceId: "admission-decision", admittedAt: now },
	});
	const schema = { type: "object", properties: { query: { type: "string" } }, required: ["query"], additionalProperties: false };
	const tool = {
		toolRevisionId: "tool-1", name: "records.read", description: "Read a record", requiresApproval: false,
		parametersSchema: schema, parametersSchemaDigest: ___DigestCanonicalJson(schema),
	};
	const proposal: PreparedConversationToolProposal = {
		proposalId: "proposal-1", tool, arguments: { query: "record" }, argumentsDigest: ___DigestCanonicalJson({ query: "record" }),
		assignmentDigest: ___DigestCanonicalJson("assignment"), requestFingerprint: ___DigestCanonicalJson("request"),
	};
	const turn = {
		siloId: "silo-1", computerId: "computer-1", bootstrapId: "bootstrap-1",
		compile: { runId: "run-1", attempt: 1 },
		binding: { conversationId: "conversation-1", agentIdentityId: "identity-1", agentServiceId: "service-1" },
	} as FrozenConversationComputerTurn;
	const budgetPolicy = { wallClockDeadlineEpochMs: Date.parse(now) + 60_000, maxToolInvocations: 1 };
	const candidate = { compiledInput: { budget: budgetPolicy } } as ConversationComputerTurnCandidate;
	const run = { executionSubject: subject, agentRevisionId: "revision-1", inputSnapshotDigest: ___DigestCanonicalJson("snapshot") };
	const snapshot = {
		executionSubject: subject, budgetPolicy,
		mcpTools: [{ toolRevisionId: tool.toolRevisionId, name: tool.name, description: tool.description, inputSchema: schema, inputSchemaDigest: tool.parametersSchemaDigest }],
	};
	const transaction = {
		agentRun: { findFirst: vi.fn().mockResolvedValue(run) },
		runInputSnapshot: { findFirst: vi.fn().mockResolvedValue(snapshot) },
		mcpToolRevision: { findFirst: vi.fn().mockResolvedValue({ name: tool.name, description: tool.description, serverRevision: { server: { name: "Records" } } }) },
		toolInvocation: { findUnique: vi.fn().mockResolvedValue(null), count: vi.fn().mockResolvedValue(0) },
	};
	const reader = new PrismaConversationToolProposalRunRepository(transaction as unknown as Prisma.TransactionClient);
	return { reader, transaction, turn, candidate, proposal, subject, run, snapshot };
}

describe("proposal run and slot evidence", function _suite()
{
	it("reads the running attempt and saved snapshot using their complete identity coordinates", async function _boundReads()
	{
		const f = _fixture();
		f.proposal = { ...f.proposal, tool: { ...f.proposal.tool, requiresApproval: true } };
		await expect(f.reader.load(f.turn, f.candidate, f.proposal)).resolves.toEqual({ subject: f.subject, agentRevisionId: "revision-1", approvalDisclosure: { toolName: "records.read", toolDescription: "Read a record", serverName: "Records" } });
		expect(f.transaction.agentRun.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: {
			id: "run-1", attempt: 1, siloId: "silo-1", state: AgentRunState.Running,
			conversationId: "conversation-1", agentIdentityId: "identity-1", agentServiceId: "service-1",
		} }));
		expect(f.transaction.runInputSnapshot.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: {
			runId: "run-1", attempt: 1, digest: f.run.inputSnapshotDigest, siloId: "silo-1",
			agentRevisionId: "revision-1", agentIdentityId: "identity-1", principalId: "person-1", conversationId: "conversation-1",
		} }));
		expect(f.transaction.mcpToolRevision.findFirst).toHaveBeenCalledWith({ where: { id: "tool-1", siloId: "silo-1" }, select: { name: true, description: true, serverRevision: { select: { server: { select: { name: true } } } } } });
	});

	it("lets an identical retry use its occupied slot but refuses a changed request", async function _savedSlot()
	{
		const f = _fixture();
		f.transaction.toolInvocation.count.mockResolvedValue(1);
		await expect(f.reader.load(f.turn, f.candidate, f.proposal)).rejects.toThrow("conversation_tool_proposal_denied");
		f.transaction.toolInvocation.findUnique.mockResolvedValue({ id: "saved-call", requestFingerprint: f.proposal.requestFingerprint });
		await expect(f.reader.load(f.turn, f.candidate, f.proposal)).resolves.toMatchObject({ agentRevisionId: "revision-1" });
		f.transaction.toolInvocation.findUnique.mockResolvedValue({ id: "saved-call", requestFingerprint: "different-request" });
		await expect(f.reader.load(f.turn, f.candidate, f.proposal)).rejects.toThrow("conversation_tool_proposal_conflict");
	});

	it("rejects a substituted execution identity before reading the proposal slot", async function _changedSubject()
	{
		const f = _fixture();
		f.transaction.runInputSnapshot.findFirst.mockResolvedValue({ ...f.snapshot, executionSubject: { ...f.subject, principalId: "another-person" } });
		await expect(f.reader.load(f.turn, f.candidate, f.proposal)).rejects.toThrow("conversation_tool_proposal_denied");
		expect(f.transaction.toolInvocation.findUnique).not.toHaveBeenCalled();
	});

	it("requires the same tool schema and budget that were saved for the run", async function _changedInput()
	{
		const f = _fixture();
		f.transaction.runInputSnapshot.findFirst.mockResolvedValue({ ...f.snapshot, budgetPolicy: { ...f.snapshot.budgetPolicy, maxToolInvocations: 2 } });
		await expect(f.reader.load(f.turn, f.candidate, f.proposal)).rejects.toThrow("conversation_tool_proposal_denied");
		f.transaction.runInputSnapshot.findFirst.mockResolvedValue(f.snapshot);
		const proposal = { ...f.proposal, tool: { ...f.proposal.tool, parametersSchemaDigest: ___DigestCanonicalJson("another-schema") } };
		await expect(f.reader.load(f.turn, f.candidate, proposal)).rejects.toThrow("conversation_tool_proposal_invalid");
		expect(f.transaction.toolInvocation.findUnique).not.toHaveBeenCalled();
	});

	it("rejects changed descriptive metadata before opening an approval", async function _ChangedApprovalMetadata()
	{
		const f = _fixture();
		f.proposal = { ...f.proposal, tool: { ...f.proposal.tool, requiresApproval: true } };
		f.transaction.runInputSnapshot.findFirst.mockResolvedValue({ ...f.snapshot, mcpTools: [{ ...f.snapshot.mcpTools[0], description: "A different description" }] });
		await expect(f.reader.load(f.turn, f.candidate, f.proposal)).rejects.toThrow("conversation_tool_proposal_invalid");
		expect(f.transaction.mcpToolRevision.findFirst).not.toHaveBeenCalled();
		f.transaction.runInputSnapshot.findFirst.mockResolvedValue(f.snapshot);
		f.transaction.mcpToolRevision.findFirst.mockResolvedValue({ name: f.proposal.tool.name, description: f.proposal.tool.description, serverRevision: { server: { name: "Another silo's server" } } });
		await expect(f.reader.load(f.turn, f.candidate, f.proposal)).resolves.toMatchObject({ approvalDisclosure: { serverName: "Another silo's server" } });
		expect(f.transaction.mcpToolRevision.findFirst).toHaveBeenLastCalledWith(expect.objectContaining({ where: { id: "tool-1", siloId: "silo-1" } }));
	});

	it("rejects missing or changed stored tool metadata for an approval", async function _MissingApprovalMetadata()
	{
		const f = _fixture();
		f.proposal = { ...f.proposal, tool: { ...f.proposal.tool, requiresApproval: true } };
		f.transaction.mcpToolRevision.findFirst.mockResolvedValue(null);
		await expect(f.reader.load(f.turn, f.candidate, f.proposal)).rejects.toThrow("conversation_tool_proposal_invalid");
		f.transaction.mcpToolRevision.findFirst.mockResolvedValue({ name: "changed.name", description: f.proposal.tool.description, serverRevision: { server: { name: "Records" } } });
		await expect(f.reader.load(f.turn, f.candidate, f.proposal)).rejects.toThrow("conversation_tool_proposal_invalid");
	});

	it("propagates an unavailable database instead of treating it as a refused proposal", async function _failedRead()
	{
		const f = _fixture();
		f.transaction.runInputSnapshot.findFirst.mockRejectedValue(new Error("database unavailable"));
		await expect(f.reader.load(f.turn, f.candidate, f.proposal)).rejects.toThrow("database unavailable");
	});
});

describe("proposal permission evidence", function _evidence()
{
	it("binds each new permission decision without changing the saved retry identity", function _retryEvidence()
	{
		const f = _fixture();
		const run = { subject: f.subject, agentRevisionId: "revision-1", approvalDisclosure: null };
		const proposal = { ...f.proposal, tool: { ...f.proposal.tool, requiresApproval: true } };
		const coordinate = { resource: { kind: ProductAuthorizationResourceKinds.McpToolRevision, id: "tool-1" }, action: ProductAuthorizationActions.Invoke } as const;
		const first = _CreateConversationToolProposalIntent(f.turn, run, proposal, coordinate, ___DigestCanonicalJson("first-decision"));
		const next = _CreateConversationToolProposalIntent(f.turn, run, proposal, coordinate, ___DigestCanonicalJson("next-decision"));
		expect(next.requestFingerprint).toBe(first.requestFingerprint);
		expect(next.requestIdentity).toEqual(first.requestIdentity);
		expect(next.authorizationEvidence.evidenceDigest).not.toBe(first.authorizationEvidence.evidenceDigest);
		const { evidenceDigest, ...binding } = first.authorizationEvidence;
		expect(evidenceDigest).toBe(___DigestCanonicalJson({ ...binding, agentRevisionId: first.agentRevisionId, runId: first.runId, attempt: first.attempt, argumentsDigest: first.argumentsDigest } as unknown as JsonValue));
		expect(first.authorizationEvidence.executionSubject).toBe(f.subject);
		expect(first.authorizationEvidence.coordinates).toEqual([coordinate]);
		expect(first.approvalRequired).toBe(true);
	});
});
