/** Return the exact source SHA when this event is a verifiable develop-to-main promotion. */
export function selectPromotionSource(input)
{
	if (input.eventName === "pull_request")
	{
		if (input.baseRef !== "main" || input.headRef !== "develop")
		{
			return null;
		}
		if (!input.pullRequestHeadSha)
		{
			throw new Error("PROMOTION_HEAD_MISSING: a develop-to-main pull request must expose its source SHA.");
		}
		return input.pullRequestHeadSha;
	}
	if (input.eventName !== "push" || input.ref !== "refs/heads/main")
	{
		return null;
	}
	if (input.pushParentShas.length !== 2 || !input.pushSourceInDevelop || input.pushHeadTree !== input.pushSourceTree)
	{
		return null;
	}
	return input.pushParentShas[1];
}

/** Return whether the exact source SHA completed the authoritative develop push workflow. */
export function hasSuccessfulDevelopValidation(runs, sourceSha)
{
	return runs.some(function _Successful(run) {
		return run.path === ".github/workflows/docker.yml"
			&& run.head_branch === "develop"
			&& run.head_sha === sourceSha
			&& run.event === "push"
			&& run.status === "completed"
			&& run.conclusion === "success";
	});
}

/** Select the diff-policy base without trusting an unvalidated promotion source. */
export function selectGuardComparisonBase(input)
{
	if (!input.promotionSourceSha)
	{
		return input.nxBase;
	}
	if (!hasSuccessfulDevelopValidation(input.validationRuns, input.promotionSourceSha))
	{
		throw new Error(`PROMOTION_SOURCE_UNVALIDATED: develop ${input.promotionSourceSha} has no successful push validation.`);
	}
	return input.promotionSourceSha;
}
