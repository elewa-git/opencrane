import { describe, expect, it, vi } from "vitest";

import { ExternalActionClaimKinds, ToolInvocationStates, __FindToolInvocationInTransaction } from "@opencrane/backend/server/iam/authorization";
import { ___DigestCanonicalJson } from "@opencrane/util";

import { PrismaConversationToolDispatchAuthority } from "../../dispatch/prisma-conversation-tool-dispatch-authority";
import type { ConversationToolRunningNotificationCommand } from "../../../turns/tool-progress-notifications/conversation-tool-progress-notification.types";
import { PrismaConversationToolRunningNotificationEvidenceReader } from "../prisma-conversation-tool-running-evidence";

vi.mock("@opencrane/backend/server/iam/authorization", async function _Authorization(importOriginal)
{
	const actual = await importOriginal<typeof import("@opencrane/backend/server/iam/authorization")>();
	return { ...actual, __FindToolInvocationInTransaction: vi.fn() };
});

const _NOW = new Date("2026-09-11T10:00:00.000Z");
const _COMMAND: ConversationToolRunningNotificationCommand = {
	executionId: "execution-1", companionClaimFence: "companion-fence-1", invocationId: "invocation-row-1",
	siloId: "silo-1", conversationId: "conversation-1", runId: "run-1", attempt: 1, toolInvocationId: "invoke-1",
	requestIdentity: { runtimeInstanceId: "computer-1", commandId: "turn-1", candidateId: "invoke-1" },
	toolClaim: { invocationId: "invocation-row-1", kind: ExternalActionClaimKinds.Dispatch, fence: 2, revision: 5 },
	workload: { audience: "mcp-executor", namespace: "mcp-executor", serviceAccountName: "mcp-executor", workloadKind: "job", workloadUid: "job-1", podUid: "pod-1" },
};

/** Build read-only transaction seams around the already-tested dispatch authority. */
function _Fixture()
{
	vi.restoreAllMocks();
	const invocation = { id: "invocation-row-1", siloId: "silo-1", runId: "run-1", attempt: 1, mcpTaskId: null, toolInvocationId: "invoke-1", toolRevisionId: "tool-revision-1", requestIdentity: _COMMAND.requestIdentity, state: ToolInvocationStates.Claimed, claimKind: ExternalActionClaimKinds.Dispatch, claimFence: 2, revision: 5, claimExpiresAt: new Date(_NOW.getTime() + 60_000) };
	vi.mocked(__FindToolInvocationInTransaction).mockReset().mockResolvedValue(invocation as never);
	const execution = { id: "execution-1", companionClaimExpiresAt: new Date(_NOW.getTime() + 60_000) };
	const transaction = {
		mcpRuntimeClock: { findUnique: vi.fn().mockResolvedValue({ now: _NOW }) },
		mcpRuntimeExecution: { findFirst: vi.fn().mockResolvedValue(execution) },
		agentRun: { findFirst: vi.fn().mockResolvedValue({ inputSnapshotDigest: "sha256:snapshot" }) },
		runInputSnapshot: { findFirst: vi.fn().mockResolvedValue({ mcpTools: [{ toolRevisionId: "tool-revision-1", name: "records.read", description: null, inputSchema: { type: "object" }, inputSchemaDigest: ___DigestCanonicalJson({ type: "object" }) }] }) },
		toolInvocation: { findUnique: vi.fn().mockResolvedValue({ createdAt: new Date("2026-09-11T09:59:00.000Z") }) },
	};
	const prisma = { $transaction: vi.fn(async function _Transaction(work: (value: typeof transaction) => Promise<unknown>) { return work(transaction); }) };
	const admit = vi.spyOn(PrismaConversationToolDispatchAuthority.prototype, "admit").mockResolvedValue({ conversationId: "conversation-1", subject: { agentIdentityId: "identity-1", principalId: "principal-1" }, notAfterEpochMs: _NOW.getTime() + 60_000 } as never);
	const reader = new PrismaConversationToolRunningNotificationEvidenceReader(prisma as never, {} as never);
	return { admit, execution, invocation, reader, transaction };
}

describe("Prisma conversation tool running evidence", function _Suite()
{
	it("checks the same committed claim before and after current dispatch admission", async function _Current()
	{
		const fixture = _Fixture();
		await expect(fixture.reader.readCurrent(_COMMAND)).resolves.toEqual({ bootstrapId: "turn-1", siloId: "silo-1", conversationId: "conversation-1", runId: "run-1", attempt: 1, toolInvocationId: "invoke-1", toolName: "records.read", toolKind: "mcp", occurredAt: "2026-09-11T09:59:00.000Z" });
		expect(fixture.transaction.mcpRuntimeExecution.findFirst).toHaveBeenCalledTimes(2);
		expect(__FindToolInvocationInTransaction).toHaveBeenCalledTimes(2);
		expect(fixture.admit).toHaveBeenCalledWith(expect.objectContaining({ id: "invocation-row-1" }), _NOW, _COMMAND.workload);
	});

	it("refuses a claim that becomes terminal during the dispatch admission read", async function _FinalClaimLost()
	{
		const fixture = _Fixture();
		vi.mocked(__FindToolInvocationInTransaction).mockResolvedValueOnce(fixture.invocation as never).mockResolvedValueOnce({ ...fixture.invocation, state: ToolInvocationStates.Succeeded, claimKind: null, revision: 6 } as never);
		await expect(fixture.reader.readCurrent(_COMMAND)).resolves.toBeNull();
	});

	it("refuses a companion lease that expires during the dispatch admission read", async function _FinalCompanionLease()
	{
		const fixture = _Fixture();
		fixture.transaction.mcpRuntimeExecution.findFirst.mockResolvedValueOnce(fixture.execution).mockResolvedValueOnce(null);
		await expect(fixture.reader.readCurrent(_COMMAND)).resolves.toBeNull();
	});

	it("refuses a lease that expires during the final mutable-claim read", async function _DelayedFinalRead()
	{
		const fixture = _Fixture();
		fixture.transaction.mcpRuntimeExecution.findFirst.mockResolvedValueOnce(fixture.execution).mockResolvedValueOnce({ ...fixture.execution, companionClaimExpiresAt: new Date(_NOW.getTime() + 5) });
		vi.spyOn(performance, "now").mockReturnValueOnce(100).mockReturnValueOnce(110);
		await expect(fixture.reader.readCurrent(_COMMAND)).resolves.toBeNull();
	});

	it("refuses task-owned work before current dispatch admission", async function _TaskOwned()
	{
		const fixture = _Fixture();
		vi.mocked(__FindToolInvocationInTransaction).mockResolvedValue({ ...fixture.invocation, runId: null, attempt: null, mcpTaskId: "task-1" } as never);
		await expect(fixture.reader.readCurrent(_COMMAND)).resolves.toBeNull();
		expect(fixture.admit).not.toHaveBeenCalled();
	});
});
