import { AgentRunState, Prisma, RuntimeCommandKind, type PrismaClient } from "@prisma/client";

import type { SubmitSteeringRequestCommand, SubmitSteeringRequestResult, SteeringRequestRepository } from "./steering-request.types.js";

/**
 * Queues steering in Postgres for the run's owner, checking ownership in the same transaction.
 *
 * It takes the advisory lock and then the run row lock - the same order every other writer of a run
 * uses, so no two writers can deadlock - and only then confirms the run is owned by this subject in
 * this silo and is still steerable. The runtime picks queued rows up later, at a safe boundary;
 * nothing here interrupts a model call.
 *
 * Called by: `_CreateSteeringIngestRouter` (prisma-steering-ingest.router.ts), which
 * apps/opencrane/src/app/routes.ts mounts at /api/v1/me/runs.
 *
 * @implements SteeringRequestRepository
 */
export class PrismaSteeringRequestRepository implements SteeringRequestRepository
{
	/** Client for the main OpenCrane database. */
	private readonly _prisma: PrismaClient;

	/** Construct the queue repository around the server-owned Prisma client. */
	constructor(prisma: PrismaClient)
	{
		this._prisma = prisma;
	}

	/**
	 * Queue one instruction after proving the run belongs to this caller in this silo.
	 *
	 * @param command - Run, silo, subject, instruction, digest, and submission time.
	 * @returns `queued` with the new row's id and the attempt it belongs to.
	 * `not_found_or_not_owner` when no run matches all three of id, silo, and owner - the two cases are
	 * deliberately not distinguished. `run_not_steerable` when the run is in a state that cannot take
	 * steering, or a resume command has already been sent for this attempt.
	 */
	async submitAtomically(command: SubmitSteeringRequestCommand): Promise<SubmitSteeringRequestResult>
	{
		return this._prisma.$transaction(async function _submit(transaction): Promise<SubmitSteeringRequestResult>
		{
			await transaction.$queryRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${command.runId}, 0))`);
			await transaction.$queryRaw(Prisma.sql`SELECT "id" FROM "agent_runs" WHERE "id" = ${command.runId} FOR UPDATE`);
			const run = await transaction.agentRun.findFirst({ where: { id: command.runId, siloId: command.siloId, delegatedUserId: command.subjectId }, select: { attempt: true, state: true } });
			if (run === null) return { outcome: "not_found_or_not_owner" };
			if (run.state !== AgentRunState.Assigned && run.state !== AgentRunState.Running && run.state !== AgentRunState.WaitingForInput) return { outcome: "run_not_steerable" };
			const priorResume = await transaction.runtimeDispatchedCommand.findFirst({ where: { runId: command.runId, attempt: run.attempt, kind: RuntimeCommandKind.ResumeAttempt }, select: { id: true } });
			if (priorResume !== null) return { outcome: "run_not_steerable" };
			const content = command.content === null ? Prisma.JsonNull : command.content as Prisma.InputJsonValue;
			const created = await transaction.runtimeSteeringRequest.create({ data: { runId: command.runId, attempt: run.attempt, siloId: command.siloId, subjectId: command.subjectId, content, digest: command.digest, submittedAt: command.submittedAt } });
			return { outcome: "queued", steeringRequestId: created.id, attempt: run.attempt };
		});
	}
}
