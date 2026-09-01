/** Follow closed base layers until an open PR or integration branch is reached, accepting each layer only when GitHub records its merge commit. */
function _MergedStackParent(pullRequest, byHead, mergedByHead, integrationBranches)
{
	let base = pullRequest.base;
	let bridged = false;
	const mergedLayers = [];
	const seen = new Set();
	while (!integrationBranches.has(base.ref))
	{
		const openParent = byHead.get(base.ref);
		if (openParent)
		{
			return { parent: openParent, base, bridged, mergedLayers };
		}
		const mergedParent = mergedByHead.get(base.ref)?.find(function _MergeCommitMatches(candidate) {
			return candidate.mergeCommitSha === base.sha;
		});
		if (!mergedParent || seen.has(mergedParent.number))
		{
			return undefined;
		}
		seen.add(mergedParent.number);
		bridged = true;
		mergedLayers.push(mergedParent);
		base = mergedParent.base;
	}
	return { parent: undefined, base, bridged, mergedLayers };
}

/** Build open-PR edges while treating merge-commit-pinned closed layers as bridges so a native stack remains reviewable after a parent merges. */
export function buildTopology(pullRequests, integrationBranches, mergedPullRequests = [])
{
	const findings = [];
	const byHead = new Map();
	const mergedByHead = new Map();
	const bridges = new Map();
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
	for (const pullRequest of mergedPullRequests)
	{
		const mergedLayers = mergedByHead.get(pullRequest.head.ref) ?? [];
		mergedLayers.push(pullRequest);
		mergedByHead.set(pullRequest.head.ref, mergedLayers);
	}

	const parents = new Map();
	for (const pullRequest of pullRequests)
	{
		const resolved = _MergedStackParent(pullRequest, byHead, mergedByHead, integrationBranches);
		const parent = resolved?.parent;
		if (resolved && resolved.mergedLayers.length > 0)
		{
			bridges.set(pullRequest.number, resolved.mergedLayers);
		}
		if (parent)
		{
			parents.set(pullRequest.number, parent.number);
			if (parent.number === pullRequest.number)
			{
				findings.push({ code: "SELF_BASE", message: `#${pullRequest.number} targets its own head branch.` });
			}
			if (!resolved.bridged && resolved.base.sha !== parent.head.sha)
			{
				findings.push({
					code: "STALE_PARENT_SHA",
					message: `#${pullRequest.number} records ${resolved.base.sha} for #${parent.number}, whose live head is ${parent.head.sha}.`,
				});
			}
		}
		else if (!resolved)
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
	return { findings, parents, byNumber, bridges };
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
