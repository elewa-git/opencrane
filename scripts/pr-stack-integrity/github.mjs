/** Translate one GitHub API PR payload into the checker-owned DTO. */
function _PullRequest(payload)
{
	return {
		number: payload.number,
		url: payload.html_url ?? payload.url,
		draft: Boolean(payload.draft),
		body: payload.body ?? "",
		head: { ref: payload.head.ref, sha: payload.head.sha },
		base: { ref: payload.base.ref, sha: payload.base.sha },
		mergedAt: payload.merged_at ?? null,
		mergeCommitSha: payload.merge_commit_sha ?? null,
	};
}

/** Create a GitHub adapter over an injected bounded command runner. */
export function createGitHubAdapter(commands)
{
	/** Follow closed base branches so a native stack remains connected after a parent PR merges. */
	function _MergedPullRequests(repository, pullRequests)
	{
		const owner = repository.split("/", 1)[0];
		const openHeads = new Set(pullRequests.map(function _Head(pullRequest) { return pullRequest.head.ref; }));
		const pending = new Set(pullRequests.map(function _Base(pullRequest) { return pullRequest.base.ref; }));
		const inspected = new Set();
		const mergedPullRequests = [];
		while (pending.size > 0)
		{
			const head = Array.from(pending).sort()[0];
			pending.delete(head);
			if (openHeads.has(head) || inspected.has(head))
			{
				continue;
			}
			inspected.add(head);
			const response = JSON.parse(commands.run("gh", [
				"api",
				"--paginate",
				"--slurp",
				`repos/${repository}/pulls?state=closed&head=${encodeURIComponent(`${owner}:${head}`)}&per_page=100`,
			]));
			for (const pullRequest of response.flat().map(_PullRequest).filter(function _Merged(candidate) {
				return candidate.mergedAt !== null && candidate.mergeCommitSha !== null;
			}))
			{
				mergedPullRequests.push(pullRequest);
				if (!openHeads.has(pullRequest.base.ref))
				{
					pending.add(pullRequest.base.ref);
				}
			}
		}
		return mergedPullRequests.sort(function _ByNumber(left, right) { return left.number - right.number; });
	}

	return {
		repositoryName()
		{
			return commands.run("gh", ["repo", "view", "--json", "nameWithOwner", "--jq", ".nameWithOwner"]);
		},
		openPullRequests(repository)
		{
			const response = JSON.parse(commands.run("gh", [
				"api",
				"--paginate",
				"--slurp",
				`repos/${repository}/pulls?state=open&per_page=100`,
			]));
			return response.flat().map(_PullRequest)
				.sort(function _ByNumber(left, right) { return left.number - right.number; });
		},
		mergedPullRequests(repository, pullRequests)
		{
			return _MergedPullRequests(repository, pullRequests);
		},
	};
}
