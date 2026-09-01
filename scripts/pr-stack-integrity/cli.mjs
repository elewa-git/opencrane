import { digestEvidence, validationResult } from "./evidence.mjs";
import { createGitHubAdapter } from "./github.mjs";
import { createGitAdapter } from "./git.mjs";
import { inspectStableStack } from "./inspection.mjs";
import { evaluateStack } from "./policy.mjs";
import { createCommandRunner } from "./process.mjs";
import { publishResult } from "./report.mjs";

const _DefaultIntegrationBranches = ["main", "develop", "own-personal-ai-agent-setup"];

/** Return a CLI option value when present. */
function _Option(arguments_, name)
{
	const index = arguments_.indexOf(name);
	return index === -1 ? undefined : arguments_[index + 1];
}

/** Build a deterministic failure result for transport or inspection errors. */
function _Failure(repository, event, error)
{
	const message = error instanceof Error ? error.message : String(error);
	return {
		valid: false,
		evidence: {
			repository: repository ?? "unknown",
			snapshotDigest: null,
			event,
			pullRequests: [],
			edges: [],
			mergedBridges: [],
			reviewLevels: [],
			currentChain: [],
			current: null,
			findings: [{ code: "INSPECTION_FAILED", message }],
		},
	};
}

/** Run the PR-stack CLI and return its process exit code. */
export function runCli(arguments_, dependencies = {})
{
	const commands = dependencies.commands ?? createCommandRunner();
	const github = dependencies.github ?? createGitHubAdapter(commands);
	const git = dependencies.git ?? createGitAdapter(commands);
	const output = dependencies.output ?? function _Stdout(value) { process.stdout.write(value); };
	let repository = _Option(arguments_, "--repository") ?? null;
	const eventNumber = Number(_Option(arguments_, "--event-pr") ?? 0);
	const event = eventNumber ? {
		number: eventNumber,
		action: _Option(arguments_, "--event-action") ?? "manual",
		headSha: _Option(arguments_, "--event-head"),
	} : undefined;
	const files = {
		evidencePath: _Option(arguments_, "--evidence"),
		summaryPath: _Option(arguments_, "--summary"),
		format: _Option(arguments_, "--format"),
	};
	try
	{
		repository ??= github.repositoryName();
		const inspection = inspectStableStack({
			repository,
			currentBranch: _Option(arguments_, "--current-branch"),
			event,
			github,
			git,
		});
		if (inspection.skipped)
		{
			const result = {
				valid: true,
				evidence: {
					repository,
					snapshotDigest: digestEvidence({
						pullRequests: inspection.pullRequests,
						mergedPullRequests: inspection.mergedPullRequests ?? [],
					}),
					event: null,
					pullRequests: inspection.pullRequests,
					edges: [],
					mergedBridges: [],
					reviewLevels: [],
					currentChain: [],
					current: null,
					findings: [],
					skipped: inspection.skipped,
				},
			};
			publishResult(result, output, files);
			return 0;
		}
		const integrationBranches = new Set(_DefaultIntegrationBranches);
		for (const branch of (_Option(arguments_, "--integration-branches") ?? "").split(",").filter(Boolean))
		{
			integrationBranches.add(branch);
		}
		const policyInput = { repository, integrationBranches, ...inspection };
		const result = validationResult(policyInput, evaluateStack(policyInput));
		publishResult(result, output, files);
		return result.valid ? 0 : 1;
	}
	catch (error)
	{
		const result = _Failure(repository, event ?? null, error);
		publishResult(result, output, files);
		return 1;
	}
}
