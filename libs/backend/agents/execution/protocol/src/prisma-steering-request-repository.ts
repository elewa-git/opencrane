import { AgentRunState, Prisma, RuntimeCommandKind, type PrismaClient } from "@prisma/client";

import type { SubmitSteeringRequestCommand, SubmitSteeringRequestResult, SteeringRequestRepository } from "./steering-request.types.js";

/** Prisma-backed owner-bound queue for steering that a runtime consumes only at a safe boundary. */
export class PrismaSteeringRequestRepository implements SteeringRequestRepository
{
	/** Canonical OpenCrane product-authority database client. */
	private readonly _prisma: PrismaClient;

	/** Construct the queue repository around the server-owned Prisma client. */
	constructor(prisma: PrismaClient)
	{
		this._prisma = prisma;
	}

	/** Queue one instruction after proving the current run belongs to the caller in this silo. */
	async submitAtomically(command: SubmitSteeringRequestCommand): Promise<SubmitSteeringRequestResult>
	{
		return this._prisma.$transaction(async function _submit(transaction): Promise<SubmitSteeringRequestResult>
		{
			await transaction.$queryRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${command.runId}, 0))`);
			await transaction.$queryRaw(Prisma.sql`SELECT "id" FROM "agent_runs" WHERE "id" = ${command.runId} FOR UPDATE`);
			const run = await transaction.agentRun.findFirst({ where: { id: command.runId, siloId: command.siloId, delegatedUserId: command.subjectId }, select: { attempt: true, state: true } });
			if (run === null) return { outcome: "not_found_or_not_owner" };
			if (run.state !== AgentRunState.Assigned && run.state !== AgentRunState.Running && run.state !== AgentRunState.WaitingForApproval) return { outcome: "run_not_steerable" };
			const priorResume = await transaction.runtimeDispatchedCommand.findFirst({ where: { runId: command.runId, attempt: run.attempt, kind: RuntimeCommandKind.ResumeAttempt }, select: { id: true } });
			if (priorResume !== null) return { outcome: "run_not_steerable" };
			const content = command.content === null ? Prisma.JsonNull : command.content as Prisma.InputJsonValue;
			const created = await transaction.runtimeSteeringRequest.create({ data: { runId: command.runId, attempt: run.attempt, siloId: command.siloId, subjectId: command.subjectId, content, digest: command.digest, submittedAt: command.submittedAt } });
			return { outcome: "queued", steeringRequestId: created.id, attempt: run.attempt };
		});
	}
}
