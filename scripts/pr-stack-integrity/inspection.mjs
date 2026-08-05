/** Return stable sorted entries for comparing live base-ref snapshots. */
function _Entries(heads)
{
	return Array.from(heads).sort(function _ByRef(left, right) { return left[0].localeCompare(right[0]); });
}

/** Inspect a race-free live PR graph through injected GitHub and Git adapters. */
export function inspectLiveStack(input)
{
	const snapshotA = input.github.openPullRequests(input.repository);
	let selectedEventNumber = input.event?.number ?? 0;
	if (!selectedEventNumber && input.currentBranch)
	{
		selectedEventNumber = snapshotA.find(function _Current(pullRequest) {
			return pullRequest.head.ref === input.currentBranch;
		})?.number ?? 0;
		if (!selectedEventNumber)
		{
			return {
				skipped: `Branch ${input.currentBranch} has no open PR.`,
				pullRequests: snapshotA,
			};
		}
	}

	const baseHeads = input.git.fetchAndVerify(snapshotA);
	const snapshotB = input.github.openPullRequests(input.repository);
	if (JSON.stringify(snapshotA) !== JSON.stringify(snapshotB))
	{
		throw new Error("SNAPSHOT_DRIFT: the live PR graph changed during inspection; rerun against a stable snapshot.");
	}
	const remoteBaseHeads = input.git.remoteBaseHeads(Array.from(baseHeads.keys()).sort());
	if (JSON.stringify(_Entries(baseHeads)) !== JSON.stringify(_Entries(remoteBaseHeads)))
	{
		throw new Error("BASE_REF_DRIFT: a live base branch changed during inspection; rerun against a stable snapshot.");
	}
	return {
		pullRequests: snapshotA,
		baseHeads,
		...input.git.evidence(snapshotA),
		event: selectedEventNumber ? {
			number: selectedEventNumber,
			action: input.event?.action ?? "manual",
			headSha: input.event?.headSha,
		} : undefined,
	};
}
