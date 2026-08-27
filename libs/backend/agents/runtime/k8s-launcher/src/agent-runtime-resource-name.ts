import { createHash } from "node:crypto";

/** Derive the deterministic name used only to clean up a retired AgentRun Job projection. */
export function __AgentRuntimeAttemptResourceName(siloId: string, runId: string, attempt: number): string
{
	if (!Number.isSafeInteger(attempt) || attempt < 1 || ![siloId, runId].every(function _Coordinate(value) { return value.length > 0 && value.length <= 256 && !/[\u0000-\u001f\u007f]/u.test(value); }))
	{
		throw new Error("runtime cleanup requires bounded run coordinates and a positive attempt");
	}
	const digest = createHash("sha256").update(`${siloId}\u0000${runId}\u0000${attempt}`).digest("hex").slice(0, 24);
	return `agent-runtime-a${attempt}-${digest}`;
}
