import type { CompiledRunInput, RunInputSnapshot } from "@opencrane/contracts";

/**
 * Compiles one admitted immutable snapshot through a bounded control-plane read transaction.
 *
 * Called by: application admission recovery when the durable run already exists.
 * @see PrismaPromptCompilerUnitOfWork for the Prisma implementation.
 */
export interface PromptCompilerUnitOfWork
{
	/** Resolve every immutable reference once and return the sealed runtime input. */
	compile(snapshot: RunInputSnapshot, attempt: number): Promise<CompiledRunInput>;
}
