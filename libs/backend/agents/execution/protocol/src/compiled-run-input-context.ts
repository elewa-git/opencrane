import type { CompiledRunInput, RunInputSnapshot } from "@opencrane/contracts";

import type { RunInputCompiler } from "./prisma-runtime-dispatch-authority.types";

/** Compile against the authoritative live attempt and reject any injected compiler drift. */
export async function _CompileRunInputForContext(context: { readonly runId: string; readonly attempt: number; readonly snapshot: RunInputSnapshot }, transaction: Parameters<RunInputCompiler>[2], compileRunInput: RunInputCompiler): Promise<CompiledRunInput>
{
	const compiled = await compileRunInput(context.snapshot, context.attempt, transaction);
	if (compiled.runId !== context.runId || compiled.attempt !== context.attempt) throw new Error("compiled run input does not match its live dispatch context");
	return compiled;
}
