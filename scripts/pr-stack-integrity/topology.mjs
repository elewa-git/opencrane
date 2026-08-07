/** Build direct open-PR parent edges and rule-coded structural findings. */
export function buildTopology(pullRequests, integrationBranches)
{
	const findings = [];
	const byHead = new Map();
	const byNumber = new Map(pullRequests.map(function _Entry(pullRequest) {
		return [pullRequest.number, pullRequest];
	}));
	for (const pullRequest of pullRequests)
	{
		if (byHead.has(pullRequest.head.ref))
		{
			findings.push({
				code: "DUPLICATE_HEAD_BRANCH",
				message: `#${pullRequest.number} and #${byHead.get(pullRequest.head.ref).number} use ${pullRequest.head.ref}.`,
			});
		}
		byHead.set(pullRequest.head.ref, pullRequest);
	}

	const parents = new Map();
	for (const pullRequest of pullRequests)
	{
		const parent = byHead.get(pullRequest.base.ref);
		if (parent)
		{
			parents.set(pullRequest.number, parent.number);
			if (parent.number === pullRequest.number)
			{
				findings.push({ code: "SELF_BASE", message: `#${pullRequest.number} targets its own head branch.` });
			}
			if (pullRequest.base.sha !== parent.head.sha)
			{
				findings.push({
					code: "STALE_PARENT_SHA",
					message: `#${pullRequest.number} records ${pullRequest.base.sha} for #${parent.number}, whose live head is ${parent.head.sha}.`,
				});
			}
		}
		else if (!integrationBranches.has(pullRequest.base.ref))
		{
			findings.push({
				code: "ORPHANED_BASE",
				message: `#${pullRequest.number} targets ${pullRequest.base.ref}, which is neither open nor an integration branch.`,
			});
		}
	}

	for (const pullRequest of pullRequests)
	{
		const seen = new Set();
		let cursor = pullRequest.number;
		while (parents.has(cursor))
		{
			if (seen.has(cursor))
			{
				findings.push({ code: "STACK_CYCLE", message: `The component containing #${pullRequest.number} contains a cycle.` });
				break;
			}
			seen.add(cursor);
			cursor = parents.get(cursor);
		}
	}
	return { findings, parents, byNumber };
}

/** Return the open ancestry chain from root to the selected PR. */
export function stackChain(currentNumber, parents)
{
	const chain = [];
	const seen = new Set();
	let cursor = currentNumber;
	while (cursor && !seen.has(cursor))
	{
		seen.add(cursor);
		chain.unshift(cursor);
		cursor = parents.get(cursor);
	}
	return chain;
}

/** Return deterministic topological review levels for every open component. */
export function reviewLevels(pullRequests, parents)
{
	const remaining = new Set(pullRequests.map(function _Number(pullRequest) { return pullRequest.number; }));
	const levels = [];
	while (remaining.size > 0)
	{
		const level = Array.from(remaining).filter(function _ParentResolved(number) {
			return !parents.has(number) || !remaining.has(parents.get(number));
		}).sort(function _Ascending(left, right) { return left - right; });
		if (level.length === 0)
		{
			break;
		}
		levels.push(level);
		for (const number of level)
		{
			remaining.delete(number);
		}
	}
	return levels;
}
