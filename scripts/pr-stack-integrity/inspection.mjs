/** Return stable sorted entries for comparing live base-ref snapshots. */
function _Entries(heads)
{
	return Array.from(heads).sort(function _ByRef(left, right) { return left[0].localeCompare(right[0]); });
}

const _RetryableInspectionFailure = /^(?:SNAPSHOT_DRIFT|BASE_REF_DRIFT|FINAL_SNAPSHOT_DRIFT|FINAL_BASE_REF_DRIFT):/u;

/** Return whether a fresh full inspection can resolve this failure. */
function _IsRetryable(error)
{
	return error instanceof Error && _RetryableInspectionFailure.test(error.message);
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
	const gitEvidence = input.git.evidence(snapshotA);
	const snapshotC = input.github.openPullRequests(input.repository);
	if (JSON.stringify(snapshotA) !== JSON.stringify(snapshotC))
	{
		throw new Error("FINAL_SNAPSHOT_DRIFT: the live PR graph changed while Git evidence was computed; rerun against a stable snapshot.");
	}
	const finalBaseHeads = input.git.remoteBaseHeads(Array.from(baseHeads.keys()).sort());
	if (JSON.stringify(_Entries(baseHeads)) !== JSON.stringify(_Entries(finalBaseHeads)))
	{
		throw new Error("FINAL_BASE_REF_DRIFT: a live base branch changed while Git evidence was computed; rerun against a stable snapshot.");
	}
	return {
		pullRequests: snapshotA,
		baseHeads,
		...gitEvidence,
		event: selectedEventNumber ? {
			number: selectedEventNumber,
			action: input.event?.action ?? "manual",
			headSha: input.event?.headSha,
		} : undefined,
	};
}

/** Retry a transient snapshot race while preserving a bounded fail-closed result. */
export function inspectStableStack(input, maximumAttempts = 3)
{
	let attempts = 0;
	while (attempts < maximumAttempts)
	{
		attempts += 1;
		try
		{
			return inspectLiveStack(input);
		}
		catch (error)
		{
			if (!_IsRetryable(error) || attempts >= maximumAttempts)
			{
				throw error;
			}
		}
	}
	throw new Error("INSPECTION_ATTEMPTS_INVALID: at least one inspection attempt is required.");
}
