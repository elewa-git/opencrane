import { AgentRunState, ApprovalRequestState, ToolInvocationState, ToolResultDeliveryState, type Prisma } from "@prisma/client";

import { _ToolInvocationRecord } from "../tool-invocation-persistence-mapping";
import { RunToolResultPendingKinds, RunToolResultReadOutcomes, type ConsumeRunToolResultCommand, type ReadRunToolResultCommand, type ReadRunToolResultResult, type RunToolResultDeliveryRepository } from "../run-tool-result-delivery.types";
import { _CopyReadRunToolResultCommand, _ReadExactRunToolResultPayload } from "../run-tool-result-delivery.validator";
import type { ToolInvocationRecord } from "../tool-invocation.types";

/**
 * Owns exact run-result reads and acknowledgement on the caller's existing transaction.
 * The invocation lifecycle owner still creates terminal payloads. This repository checks that
 * delivery against the immutable invocation and preserves the first acknowledgement timestamp.
 * The caller must prove durable continuation and current authority before consuming a result.
 */
export class PrismaRunToolResultDeliveryRepository implements RunToolResultDeliveryRepository
{
	/** Holds the caller's transaction for every result relation read and acknowledgement. */
	private readonly transaction: Prisma.TransactionClient;

	/** Binds every result operation to the same caller transaction. */
	public constructor(transaction: Prisma.TransactionClient)
	{
		this.transaction = transaction;
	}

	/** Supplies the package transaction API with the result owner without a barrel-level repository export. */
	static inTransaction(transaction: Prisma.TransactionClient): RunToolResultDeliveryRepository
	{
		return new PrismaRunToolResultDeliveryRepository(transaction);
	}

	/** Reads exact run-owned result evidence without consuming it or granting current use permission. */
	public async read(command: ReadRunToolResultCommand): Promise<ReadRunToolResultResult>
	{
		const coordinates = _CopyReadRunToolResultCommand(command);
		if (coordinates === null)
			return { outcome: RunToolResultReadOutcomes.Unavailable };
		const row = await this.transaction.toolInvocation.findFirst({
			where: { ...coordinates, mcpTaskId: null, run: { is: { id: coordinates.runId, siloId: coordinates.siloId, attempt: coordinates.attempt, state: { in: [AgentRunState.Running, AgentRunState.WaitingForInput] } } } },
			include: { run: { select: { id: true, siloId: true, attempt: true, state: true } }, resultDelivery: true },
		});
		if (row === null || row.mcpTaskId !== null || row.siloId !== coordinates.siloId || row.runId !== coordinates.runId || row.attempt !== coordinates.attempt
			|| row.toolInvocationId !== coordinates.toolInvocationId || row.runtimeInstanceId !== coordinates.runtimeInstanceId || row.commandId !== coordinates.commandId || row.requestFingerprint !== coordinates.requestFingerprint
			|| row.run === null || row.run.id !== coordinates.runId || row.run.siloId !== coordinates.siloId || row.run.attempt !== coordinates.attempt
			|| row.run.state !== AgentRunState.Running && !(row.run.state === AgentRunState.WaitingForInput && row.state === ToolInvocationState.AwaitingApproval))
			return { outcome: RunToolResultReadOutcomes.Unavailable };
		const delivery = row.resultDelivery;
		if (row.state !== ToolInvocationState.Succeeded && row.state !== ToolInvocationState.Failed)
		{
			const pendingStates: readonly ToolInvocationState[] = [ToolInvocationState.Preparing, ToolInvocationState.AwaitingApproval, ToolInvocationState.Ready, ToolInvocationState.Claimed, ToolInvocationState.Reconciling];
			const pending = delivery === null && row.completedAt === null && row.result === null && pendingStates.includes(row.state);
			if (!pending)
				return { outcome: RunToolResultReadOutcomes.Unavailable };
			const approval = row.state === ToolInvocationState.AwaitingApproval && this.transaction.approvalRequest !== undefined
				? await this.transaction.approvalRequest.findFirst({ where: { toolInvocationRowId: row.id, state: ApprovalRequestState.Pending }, select: { expiresAt: true } })
				: null;
			return approval === null || approval === undefined
				? { outcome: RunToolResultReadOutcomes.Pending }
				: { outcome: RunToolResultReadOutcomes.Pending, pendingKind: RunToolResultPendingKinds.Approval, pendingUntilEpochMs: approval.expiresAt.getTime() };
		}
		if (delivery === null || delivery.toolInvocationId !== row.id || !(row.completedAt instanceof Date) || !Number.isFinite(row.completedAt.getTime())
			|| row.claimKind !== null || row.claimExpiresAt !== null
			|| delivery.state !== ToolResultDeliveryState.Pending && delivery.state !== ToolResultDeliveryState.Consumed
			|| delivery.state === ToolResultDeliveryState.Pending && delivery.consumedAt !== null
			|| delivery.state === ToolResultDeliveryState.Consumed && (!(delivery.consumedAt instanceof Date) || !Number.isFinite(delivery.consumedAt.getTime())))
			return { outcome: RunToolResultReadOutcomes.Unavailable };
		let invocation: ToolInvocationRecord;
		try { invocation = structuredClone(_ToolInvocationRecord(row)); }
		catch { return { outcome: RunToolResultReadOutcomes.Unavailable }; }
		const payload = _ReadExactRunToolResultPayload(invocation, delivery.payload, delivery.payloadDigest);
		if (payload === null)
			return { outcome: RunToolResultReadOutcomes.Unavailable };
		return { outcome: RunToolResultReadOutcomes.Available, invocation, payload, payloadDigest: delivery.payloadDigest, occurredAt: row.completedAt.toISOString(), consumed: delivery.state === ToolResultDeliveryState.Consumed };
	}

	/** Acknowledges the exact stored result in the caller's already-authorized continuation transaction. */
	public async consume(command: ConsumeRunToolResultCommand, now: Date): Promise<ReadRunToolResultResult>
	{
		const coordinates = _CopyReadRunToolResultCommand(command);
		const payloadDigest = command.payloadDigest;
		const consumedAt = new Date(now.getTime());
		if (coordinates === null || typeof payloadDigest !== "string" || !/^sha256:[0-9a-f]{64}$/u.test(payloadDigest) || !Number.isFinite(consumedAt.getTime()))
			return { outcome: RunToolResultReadOutcomes.Unavailable };
		const result = await this.read(coordinates);
		if (result.outcome !== RunToolResultReadOutcomes.Available || result.payloadDigest !== payloadDigest)
			return { outcome: RunToolResultReadOutcomes.Unavailable };
		if (!result.consumed)
			await this.transaction.toolResultDelivery.updateMany({
				where: { toolInvocationId: result.invocation.id, payloadDigest, state: ToolResultDeliveryState.Pending, consumedAt: null,
					invocation: { is: { ...coordinates, mcpTaskId: null, run: { is: { id: coordinates.runId, siloId: coordinates.siloId, attempt: coordinates.attempt, state: AgentRunState.Running } } } } },
				data: { state: ToolResultDeliveryState.Consumed, consumedAt },
			});
		const accepted = await this.read(coordinates);
		return accepted.outcome === RunToolResultReadOutcomes.Available && accepted.consumed && accepted.payloadDigest === payloadDigest
			? accepted : { outcome: RunToolResultReadOutcomes.Unavailable };
	}
}
