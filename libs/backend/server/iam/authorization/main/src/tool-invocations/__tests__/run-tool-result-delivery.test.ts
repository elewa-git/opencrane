import { AgentRunState, ExternalActionClaimKind, ExternalActionRecoveryMode, Prisma, ToolInvocationState, ToolResultDeliveryState } from "@prisma/client";
import { ___DigestCanonicalJson, type JsonValue } from "@opencrane/util";
import { describe, expect, it, vi } from "vitest";

import { PrismaToolInvocationRepository } from "../persistence/prisma-tool-invocation-repository";
import { RunToolResultPendingKinds, RunToolResultReadOutcomes, type ReadRunToolResultCommand } from "../run-tool-result-delivery.types";
import { ExternalActionClaimKinds } from "../tool-invocation-lifecycle.types";
import { __ConsumeRunToolResultInTransaction, __ReadRunToolResultInTransaction } from "../persistence/tool-invocation-transaction";
import type { ToolResultDeliveryPayload } from "../tool-invocation.types";

const _NOW = new Date("2026-09-09T04:00:00.000Z");
const _COMMAND: ReadRunToolResultCommand = {
	siloId: "silo-1", runId: "run-1", attempt: 1, toolInvocationId: "public-tool-1", runtimeInstanceId: "computer-1", commandId: "bootstrap-1", requestFingerprint: `sha256:${"a".repeat(64)}`,
};

/** Creates the linked terminal rows returned by a single repository relation read. */
function _row()
{
	const payload = { toolInvocationId: _COMMAND.toolInvocationId, outcome: "succeeded", result: { record: { name: "Private result" } } };
	return {
		id: "internal-invocation-1", ..._COMMAND, mcpTaskId: null, agentServiceId: "service-1", agentRevisionId: "revision-1", agentIdentityId: "identity-1", principalId: "principal-1",
		candidateId: "candidate-1", toolRevisionId: "tool-revision-1", arguments: { query: "record" }, argumentsDigest: "sha256:arguments", effectiveArguments: { query: "record" }, effectiveArgumentsDigest: "sha256:arguments",
		authorizationActorKind: null, authorizationExecutionSubject: null, authorizationCoordinates: null, authorizationDecisionDigests: [], authorizationAssignmentDigest: null, authorizationEvidenceDigest: null,
		requestIdentity: { runtimeInstanceId: _COMMAND.runtimeInstanceId, commandId: _COMMAND.commandId, candidateId: "candidate-1" },
		approvalRequired: false, recoveryMode: ExternalActionRecoveryMode.Manual, recoveryKey: null,
		state: ToolInvocationState.Succeeded, preparationAttempt: 1, retryDeadlineAt: new Date(_NOW.getTime() + 60_000), nextPreparationAttemptAt: _NOW,
		claimAttempt: 1, claimKind: null, claimFence: 1, claimExpiresAt: null, revision: 3, recoveryRequiredAt: null,
		result: payload.result as JsonValue | null, failureCode: null as string | null, completedAt: _NOW as Date | null, createdAt: _NOW, updatedAt: _NOW,
		run: { id: _COMMAND.runId, siloId: _COMMAND.siloId, attempt: _COMMAND.attempt, state: AgentRunState.Running as AgentRunState },
		resultDelivery: { id: "delivery-1", toolInvocationId: "internal-invocation-1", state: ToolResultDeliveryState.Pending, payload: payload as JsonValue, payloadDigest: ___DigestCanonicalJson(payload), createdAt: _NOW, consumedAt: null as Date | null },
	};
}

/** Exposes no write or transaction API, so an accidental acknowledgement fails the read tests. */
function _reader(row: unknown)
{
	const findFirst = vi.fn().mockResolvedValue(row);
	return { findFirst, transaction: { toolInvocation: { findFirst } } as unknown as Prisma.TransactionClient };
}

describe("__ReadRunToolResultInTransaction", function _resultReader()
{
	it("selects all saved coordinates and links the public ID to the internal delivery FK", async function _exactRead()
	{
		const row = _row();
		const fixture = _reader(row);
		const result = await __ReadRunToolResultInTransaction(fixture.transaction, _COMMAND);
		expect(result).toMatchObject({ outcome: RunToolResultReadOutcomes.Available, invocation: { id: row.id, toolInvocationId: _COMMAND.toolInvocationId }, payload: row.resultDelivery.payload, payloadDigest: row.resultDelivery.payloadDigest, consumed: false });
		expect(fixture.findFirst).toHaveBeenCalledExactlyOnceWith({ where: { ..._COMMAND, mcpTaskId: null, run: { is: { id: _COMMAND.runId, siloId: _COMMAND.siloId, attempt: _COMMAND.attempt, state: { in: [AgentRunState.Running, AgentRunState.WaitingForInput] } } } }, include: { run: { select: { id: true, siloId: true, attempt: true, state: true } }, resultDelivery: true } });
		expect(row.resultDelivery.state).toBe(ToolResultDeliveryState.Pending);
		expect(row.resultDelivery.consumedAt).toBeNull();
	});

	it.each(["siloId", "runId", "attempt", "toolInvocationId", "runtimeInstanceId", "commandId", "requestFingerprint", "mcpTaskId"])("returns no content for mismatched invocation %s", async function _coordinateMismatch(field)
	{
		const row = { ..._row(), [field]: field === "attempt" ? 2 : "foreign-value" };
		const fixture = _reader(row);
		await expect(__ReadRunToolResultInTransaction(fixture.transaction, _COMMAND)).resolves.toEqual({ outcome: RunToolResultReadOutcomes.Unavailable });
	});

	it.each(["id", "siloId", "attempt", "state"])("requires the current related run %s", async function _runMismatch(field)
	{
		const row = _row();
		const fixture = _reader({ ...row, run: { ...row.run, [field]: field === "attempt" ? 2 : "different" } });
		await expect(__ReadRunToolResultInTransaction(fixture.transaction, _COMMAND)).resolves.toEqual({ outcome: RunToolResultReadOutcomes.Unavailable });
	});

	it.each([null, { ..._row(), run: null }])("returns unavailable for missing linkage %#", async function _missing(row)
	{
		await expect(__ReadRunToolResultInTransaction(_reader(row).transaction, _COMMAND)).resolves.toEqual({ outcome: RunToolResultReadOutcomes.Unavailable });
	});

	it.each([{ attempt: 0 }, { attempt: 1.5 }, { siloId: "" }, { runId: " run-1" }, { toolInvocationId: "" }, { runtimeInstanceId: "" }, { commandId: "" }, { requestFingerprint: "not-a-digest" }])("does not query with invalid saved coordinates %j", async function _invalidCommand(overrides)
	{
		const fixture = _reader(_row());
		await expect(__ReadRunToolResultInTransaction(fixture.transaction, { ..._COMMAND, ...overrides })).resolves.toEqual({ outcome: RunToolResultReadOutcomes.Unavailable });
		expect(fixture.findFirst).not.toHaveBeenCalled();
	});

	it.each([ToolInvocationState.Preparing, ToolInvocationState.AwaitingApproval, ToolInvocationState.Ready, ToolInvocationState.Claimed, ToolInvocationState.Reconciling])("reports nonterminal %s as pending without a payload", async function _pending(state)
	{
		const row = { ..._row(), state, result: null, completedAt: null, resultDelivery: null };
		await expect(__ReadRunToolResultInTransaction(_reader(row).transaction, _COMMAND)).resolves.toEqual({ outcome: RunToolResultReadOutcomes.Pending });
	});

	it("retains the approval deadline for the conversation workflow timeout", async function _ApprovalDeadline()
	{
		const row = { ..._row(), state: ToolInvocationState.AwaitingApproval, result: null, completedAt: null, resultDelivery: null, run: { ..._row().run, state: AgentRunState.WaitingForInput } };
		const findFirst = vi.fn().mockResolvedValueOnce(row).mockResolvedValueOnce({ expiresAt: new Date(_NOW.getTime() + 30_000) });
		const transaction = { toolInvocation: { findFirst }, approvalRequest: { findFirst } } as unknown as Prisma.TransactionClient;

		await expect(__ReadRunToolResultInTransaction(transaction, _COMMAND)).resolves.toEqual({ outcome: RunToolResultReadOutcomes.Pending, pendingKind: RunToolResultPendingKinds.Approval, pendingUntilEpochMs: _NOW.getTime() + 30_000 });
	});

	it("keeps an ambiguous provider outcome unavailable instead of inventing a result", async function _recoveryRequired()
	{
		const row = { ..._row(), state: ToolInvocationState.RecoveryRequired, result: null, completedAt: null, resultDelivery: null };
		await expect(__ReadRunToolResultInTransaction(_reader(row).transaction, _COMMAND)).resolves.toEqual({ outcome: RunToolResultReadOutcomes.Unavailable });
	});

	it.each(["missing-delivery", "wrong-fk", "public-in-fk", "internal-in-payload", "missing-completion", "active-claim", "nonterminal-delivery", "digest", "result", "wrong-outcome", "extra-field", "unsafe-code"])("rejects inconsistent durable evidence: %s", async function _invalidEvidence(kind)
	{
		const row = _row();
		const altered = { ...row, resultDelivery: { ...row.resultDelivery } } as Record<string, unknown>;
		const delivery = altered["resultDelivery"] as typeof row.resultDelivery;
		if (kind === "missing-delivery")
			altered["resultDelivery"] = null;
		if (kind === "wrong-fk")
			delivery.toolInvocationId = "different-internal-id";
		if (kind === "public-in-fk")
			delivery.toolInvocationId = _COMMAND.toolInvocationId;
		if (kind === "internal-in-payload")
			delivery.payload = { ...(delivery.payload as Record<string, JsonValue>), toolInvocationId: row.id };
		if (kind === "missing-completion")
			altered["completedAt"] = null;
		if (kind === "active-claim")
			altered["claimKind"] = ExternalActionClaimKind.Dispatch;
		if (kind === "nonterminal-delivery")
			altered["state"] = ToolInvocationState.Ready;
		if (kind === "result")
			delivery.payload = { toolInvocationId: _COMMAND.toolInvocationId, outcome: "succeeded", result: { leaked: "different private result" } };
		if (kind === "wrong-outcome")
			delivery.payload = { toolInvocationId: _COMMAND.toolInvocationId, outcome: "failed", failureCode: "provider_failed" };
		if (kind === "extra-field")
			delivery.payload = { ...(delivery.payload as Record<string, JsonValue>), unreviewed: "extra" };
		if (kind === "unsafe-code")
		{
			altered["state"] = ToolInvocationState.Failed;
			altered["result"] = null;
			altered["failureCode"] = "raw provider error with secret";
			delivery.payload = { toolInvocationId: _COMMAND.toolInvocationId, outcome: "failed", failureCode: "raw provider error with secret" };
		}
		delivery.payloadDigest = kind === "digest" ? `sha256:${"b".repeat(64)}` : ___DigestCanonicalJson(delivery.payload);
		await expect(__ReadRunToolResultInTransaction(_reader(altered).transaction, _COMMAND)).resolves.toEqual({ outcome: RunToolResultReadOutcomes.Unavailable });
	});

	it.each([
		{ state: ToolResultDeliveryState.Pending, consumedAt: _NOW },
		{ state: ToolResultDeliveryState.Consumed, consumedAt: null },
		{ state: ToolResultDeliveryState.Consumed, consumedAt: new Date(NaN) },
		{ state: "other", consumedAt: null },
	])("rejects incoherent delivery status %#", async function _deliveryStatus(status)
	{
		const row = _row();
		await expect(__ReadRunToolResultInTransaction(_reader({ ...row, resultDelivery: { ...row.resultDelivery, ...status } }).transaction, _COMMAND)).resolves.toEqual({ outcome: RunToolResultReadOutcomes.Unavailable });
	});

	it("returns the identical consumed result for restart verification without rewriting acknowledgement", async function _consumed()
	{
		const row = _row();
		const consumedAt = new Date(_NOW.getTime() + 1_000);
		const fixture = _reader({ ...row, resultDelivery: { ...row.resultDelivery, state: ToolResultDeliveryState.Consumed, consumedAt } });
		await expect(__ReadRunToolResultInTransaction(fixture.transaction, _COMMAND)).resolves.toMatchObject({ outcome: RunToolResultReadOutcomes.Available, consumed: true, payload: row.resultDelivery.payload });
		expect(consumedAt.getTime()).toBe(_NOW.getTime() + 1_000);
	});

	it("returns detached invocation and delivery bodies without references to storage or each other", async function _detached()
	{
		const row = _row();
		const result = await __ReadRunToolResultInTransaction(_reader(row).transaction, _COMMAND);
		expect(result.outcome).toBe(RunToolResultReadOutcomes.Available);
		if (result.outcome !== RunToolResultReadOutcomes.Available || result.payload.outcome !== "succeeded")
			throw new Error("expected stored success");
		(result.payload.result as { record: { name: string } }).record.name = "caller mutation";
		expect(row.result).toEqual({ record: { name: "Private result" } });
		expect(result.invocation.result).toEqual(row.result);
	});

	it("accepts a successful JSON-null result without confusing it with a missing delivery", async function _jsonNull()
	{
		const row = _row();
		row.result = null;
		row.resultDelivery.payload = { toolInvocationId: _COMMAND.toolInvocationId, outcome: "succeeded", result: null };
		row.resultDelivery.payloadDigest = ___DigestCanonicalJson(row.resultDelivery.payload);
		await expect(__ReadRunToolResultInTransaction(_reader(row).transaction, _COMMAND)).resolves.toMatchObject({ outcome: RunToolResultReadOutcomes.Available, payload: row.resultDelivery.payload });
	});

	it("retains coordinates copied before an asynchronous query", async function _commandMutation()
	{
		const command = { ..._COMMAND };
		const fixture = _reader(_row());
		fixture.findFirst.mockImplementation(async function _mutateCaller() { command.runId = "foreign"; return _row(); });
		await expect(__ReadRunToolResultInTransaction(fixture.transaction, command)).resolves.toMatchObject({ outcome: RunToolResultReadOutcomes.Available });
	});

	it("leaves a database failure as an error rather than claiming work is pending", async function _databaseFailure()
	{
		const fixture = _reader(null);
		const failure = new Error("database unavailable");
		fixture.findFirst.mockRejectedValue(failure);
		await expect(__ReadRunToolResultInTransaction(fixture.transaction, _COMMAND)).rejects.toBe(failure);
	});

	it.each(["succeeded", "failed"] as const)("reads %s delivery written by the actual fenced completion owner", async function _writerAndReader(outcome)
	{
		const terminal = _row();
		let row = { ...terminal, state: ToolInvocationState.Claimed, result: null, failureCode: null, completedAt: null, claimKind: ExternalActionClaimKind.Dispatch, claimExpiresAt: new Date(_NOW.getTime() + 60_000), resultDelivery: null } as unknown as typeof terminal;
		const createDelivery = vi.fn(async function _createDelivery({ data }: { data: typeof terminal.resultDelivery }) { row.resultDelivery = { ...data, id: "delivery-created", consumedAt: null }; return row.resultDelivery; });
		const transaction = {
			toolInvocation: {
				findUnique: vi.fn(async function _find() { return row; }), findFirst: vi.fn(async function _findExact() { return row; }),
				updateMany: vi.fn(async function _complete({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> })
				{
					if (where["id"] !== row.id || where["state"] !== row.state || where["claimFence"] !== row.claimFence || where["revision"] !== row.revision)
						return { count: 0 };
					row = { ...row, ...data, result: data["result"] === Prisma.DbNull ? null : data["result"], revision: row.revision + 1 } as typeof terminal;
					return { count: 1 };
				}),
			},
			toolResultDelivery: { create: createDelivery },
		} as unknown as Prisma.TransactionClient;
		const payload: ToolResultDeliveryPayload = outcome === "succeeded"
			? { toolInvocationId: _COMMAND.toolInvocationId, outcome, result: { record: "actual completion" } }
			: { toolInvocationId: _COMMAND.toolInvocationId, outcome, failureCode: "tool_dispatch_authority_denied" };
		const repository = new PrismaToolInvocationRepository(transaction);
		await expect(repository.complete({ invocationId: terminal.id, kind: ExternalActionClaimKinds.Dispatch, fence: row.claimFence, revision: row.revision }, payload, _NOW)).resolves.toMatchObject({ outcome: "completed" });
		expect(createDelivery).toHaveBeenCalledTimes(1);
		await expect(__ReadRunToolResultInTransaction(transaction, _COMMAND)).resolves.toMatchObject({ outcome: RunToolResultReadOutcomes.Available, payload, payloadDigest: ___DigestCanonicalJson(payload as unknown as JsonValue), consumed: false });
	});
});


/** Applies only a matching acknowledgement and exposes hooks for deterministic storage races. */
function _consumer()
{
	const row = { ..._row(), resultDelivery: { ..._row().resultDelivery, state: ToolResultDeliveryState.Pending as ToolResultDeliveryState } };
	const findFirst = vi.fn(async function _Read() { return structuredClone(row); });
	const updateMany = vi.fn(async function _Consume(command: Prisma.ToolResultDeliveryUpdateManyArgs)
	{
		expect(command.where).toMatchObject({ toolInvocationId: row.id, payloadDigest: row.resultDelivery.payloadDigest, state: ToolResultDeliveryState.Pending, consumedAt: null,
			invocation: { is: { ..._COMMAND, mcpTaskId: null, run: { is: { id: _COMMAND.runId, siloId: _COMMAND.siloId, attempt: 1, state: AgentRunState.Running } } } } });
		if (row.resultDelivery.state !== ToolResultDeliveryState.Pending)
			return { count: 0 };
		row.resultDelivery.state = ToolResultDeliveryState.Consumed;
		row.resultDelivery.consumedAt = command.data.consumedAt as Date;
		return { count: 1 };
	});
	const transaction = { toolInvocation: { findFirst }, toolResultDelivery: { updateMany } } as unknown as Prisma.TransactionClient;
	const command = { ..._COMMAND, payloadDigest: row.resultDelivery.payloadDigest };
	return { row, findFirst, updateMany, transaction, command };
}

describe("__ConsumeRunToolResultInTransaction", function _consumeResult()
{
	it("acknowledges the exact internal row and returns its unchanged payload after readback", async function _consume()
	{
		const f = _consumer();
		await expect(__ConsumeRunToolResultInTransaction(f.transaction, f.command, _NOW)).resolves.toMatchObject({ outcome: RunToolResultReadOutcomes.Available, consumed: true, payloadDigest: f.command.payloadDigest });
		expect(f.updateMany).toHaveBeenCalledOnce();
		expect(f.findFirst).toHaveBeenCalledTimes(2);
		expect(f.row.resultDelivery.consumedAt).toEqual(_NOW);
	});

	it("preserves the first timestamp on an exact consumed replay", async function _repeat()
	{
		const f = _consumer();
		await __ConsumeRunToolResultInTransaction(f.transaction, f.command, _NOW);
		await expect(__ConsumeRunToolResultInTransaction(f.transaction, f.command, new Date(_NOW.getTime() + 5_000))).resolves.toMatchObject({ outcome: RunToolResultReadOutcomes.Available, consumed: true });
		expect(f.updateMany).toHaveBeenCalledOnce();
		expect(f.row.resultDelivery.consumedAt).toEqual(_NOW);
	});

	it.each(["digest", "state", "coordinate", "invalid-digest", "invalid-time"])("does not acknowledge mismatching evidence %s", async function _mismatch(kind)
	{
		const f = _consumer();
		if (kind === "state")
			f.row.run.state = AgentRunState.Failed;
		let payloadDigest: string = f.command.payloadDigest;
		if (kind === "invalid-digest")
			payloadDigest = "bad";
		if (kind === "digest")
			payloadDigest = `sha256:${"c".repeat(64)}`;
		const command = { ...f.command, runId: kind === "coordinate" ? "different" : f.command.runId, payloadDigest };
		await expect(__ConsumeRunToolResultInTransaction(f.transaction, command, kind === "invalid-time" ? new Date(NaN) : _NOW)).resolves.toEqual({ outcome: RunToolResultReadOutcomes.Unavailable });
		expect(f.updateMany).not.toHaveBeenCalled();
	});

	it("does not accept a zero-row acknowledgement while the exact result remains pending", async function _lostUpdate()
	{
		const f = _consumer();
		f.updateMany.mockResolvedValueOnce({ count: 0 });
		await expect(__ConsumeRunToolResultInTransaction(f.transaction, f.command, _NOW)).resolves.toEqual({ outcome: RunToolResultReadOutcomes.Unavailable });
	});

	it("accepts a concurrent exact acknowledgement without overwriting its timestamp", async function _race()
	{
		const f = _consumer();
		const first = new Date(_NOW.getTime() - 1_000);
		f.updateMany.mockImplementationOnce(async function _OtherConsumer() { f.row.resultDelivery.state = ToolResultDeliveryState.Consumed; f.row.resultDelivery.consumedAt = first; return { count: 0 }; });
		await expect(__ConsumeRunToolResultInTransaction(f.transaction, f.command, _NOW)).resolves.toMatchObject({ outcome: RunToolResultReadOutcomes.Available, consumed: true });
		expect(f.row.resultDelivery.consumedAt).toEqual(first);
	});

	it("propagates an uncertain write response instead of claiming acknowledgement", async function _writeLoss()
	{
		const f = _consumer();
		f.updateMany.mockRejectedValueOnce(new Error("database unavailable"));
		await expect(__ConsumeRunToolResultInTransaction(f.transaction, f.command, _NOW)).rejects.toThrow("database unavailable");
	});
});
