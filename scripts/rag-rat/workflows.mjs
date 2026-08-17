const _MODEL = "minishlab/potion-retrieval-32M";
const _WORKFLOWS = Object.freeze({
	setup: Object.freeze([
		Object.freeze(["index", "--full"]),
		Object.freeze(["models", "install", _MODEL]),
		Object.freeze(["reconcile", "--until-clean", "--changed-first"]),
		Object.freeze(["hooks", "install"]),
		Object.freeze(["doctor"]),
	]),
	refresh: Object.freeze([
		Object.freeze(["index", "--discover"]),
		Object.freeze(["reconcile", "--changed-first", "--max-seconds", "60"]),
	]),
	doctor: Object.freeze([
		Object.freeze(["doctor"]),
		Object.freeze(["hooks", "status"]),
		Object.freeze(["reconcile", "--plan"]),
	]),
});

/**
 * Dispatches one named workspace workflow or passes a native rag-rat command through unchanged.
 *
 * Named workflows stop on the first failure so later hooks or health reports cannot hide an
 * incomplete index or model reconciliation.
 *
 * Called by: the rag-rat CLI composition root after it creates the verified process boundary.
 *
 * @param {string | undefined} command Workspace workflow or native rag-rat command.
 * @param {readonly string[]} arguments_ Remaining command-line arguments.
 * @param {(arguments_: readonly string[]) => number} runRagRat Verified native command boundary.
 * @returns {number} First failing status, or zero after every command succeeds.
 * @throws {Error} When the injected native command boundary throws instead of returning a status.
 * @see https://github.com/cq27-dev/rag-rat/tree/81bf9d1891c2a94a52d6edb69d4a09688ca9116b — the pinned v0.23.0 command behavior.
 */
export function ___RunRagRatWorkflow(command, arguments_, runRagRat)
{
	const workflow = command ? _WORKFLOWS[command] : undefined;
	if (!workflow)
	{
		return runRagRat(command ? [command, ...arguments_] : ["--help"]);
	}

	for (const workflowCommand of workflow)
	{
		const status = runRagRat(workflowCommand);
		if (status !== 0)
		{
			return status;
		}
	}

	return 0;
}
