import type { ResumeAttemptCommand } from "@opencrane/contracts";

/** The resume command body, plus the ids of the rows to mark consumed once that command is saved. */
export interface RuntimeResumeInputLoad
{
	/** The resume body built from finished tool results and queued steering. */
	readonly resume: ResumeAttemptCommand;
	/** Result-delivery rows to mark consumed, but only after this body is saved. */
	readonly toolResultDeliveryIds: string[];
	/** Pending steering rows that went into this body. */
	readonly steeringRequestIds: string[];
}

/**
 * Loads the pending tool results and steering rows for a resume command.
 *
 * A port so dispatch never touches Prisma models directly. It returns null rather than an empty
 * body when there is nothing to resume with, which is how dispatch knows not to create a resume
 * command at all.
 *
 * Called by: `_mintCommandExtras` in prisma-runtime-dispatch-authority.ts, through
 * {@link RuntimeResumeInputUnitOfWork}. Implemented by `PrismaRuntimeResumeInputRepository`.
 */
export interface RuntimeResumeInputRepository
{
	/** Load the finished results and pending steering for one run attempt. */
	load(runId: string, attempt: number, inputGeneration: number): Promise<RuntimeResumeInputLoad | null>;
}

/** Builds the loader above from the caller's transaction. */
export interface RuntimeResumeInputUnitOfWork
{
	/** Load those rows on the dispatch transaction that is already open. */
	load(runId: string, attempt: number, inputGeneration: number): Promise<RuntimeResumeInputLoad | null>;
}
