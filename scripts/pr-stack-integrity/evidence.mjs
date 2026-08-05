import { createHash } from "node:crypto";

import { reviewLevels } from "./topology.mjs";

/** Return a stable SHA-256 digest for JSON-compatible evidence. */
export function digestEvidence(value)
{
	return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

/** Project an evaluation into deterministic, SHA-bound evidence. */
export function buildEvidence(input, evaluation)
{
	const findings = evaluation.findings.sort(function _ByFinding(left, right) {
		return left.code.localeCompare(right.code) || left.message.localeCompare(right.message);
	});
	return {
		repository: input.repository,
		snapshotDigest: digestEvidence(input.pullRequests),
		event: input.event ?? null,
		pullRequests: input.pullRequests.map(function _EvidencePullRequest(pullRequest) {
			return {
				number: pullRequest.number,
				base: pullRequest.base,
				liveBaseHeadSha: input.baseHeads?.get(pullRequest.base.ref) ?? null,
				head: pullRequest.head,
				incrementalDiffDigest: input.diffDigests.get(pullRequest.number) ?? null,
				patchId: input.patchIds.get(pullRequest.number) ?? null,
			};
		}),
		edges: Array.from(evaluation.topology.parents, function _Edge([child, parent]) { return { parent, child }; })
			.sort(function _ByChild(left, right) { return left.child - right.child; }),
		reviewLevels: reviewLevels(input.pullRequests, evaluation.topology.parents),
		currentChain: evaluation.currentChain,
		current: evaluation.current ? {
			number: evaluation.current.number,
			base: evaluation.current.base,
			head: evaluation.current.head,
		} : null,
		findings,
	};
}

/** Evaluate and return the public validation result. */
export function validationResult(input, evaluation)
{
	const evidence = buildEvidence(input, evaluation);
	return { valid: evidence.findings.length === 0, evidence };
}
