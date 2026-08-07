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
	};
}

/** Create a GitHub adapter over an injected bounded command runner. */
export function createGitHubAdapter(commands)
{
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
	};
}
