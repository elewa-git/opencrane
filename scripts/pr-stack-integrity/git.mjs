import { createHash } from "node:crypto";

/** Create the Git evidence adapter over an injected bounded command runner. */
export function createGitAdapter(commands)
{
	return {
		fetchAndVerify(pullRequests)
		{
			const refspecs = pullRequests.map(function _Head(pullRequest) {
				return `+refs/pull/${pullRequest.number}/head:refs/remotes/origin/open-pr/${pullRequest.number}`;
			});
			const baseRefs = Array.from(new Set(pullRequests.map(function _Base(pullRequest) {
				return pullRequest.base.ref;
			}))).sort();
			for (const baseRef of baseRefs)
			{
				refspecs.push(`+refs/heads/${baseRef}:refs/remotes/origin/${baseRef}`);
			}
			commands.run("git", ["fetch", "--quiet", "--no-tags", "origin", ...refspecs]);
			const baseHeads = new Map();
			for (const pullRequest of pullRequests)
			{
				const fetchedHead = commands.run("git", ["rev-parse", `refs/remotes/origin/open-pr/${pullRequest.number}`]);
				if (fetchedHead !== pullRequest.head.sha)
				{
					throw new Error(`FETCHED_HEAD_DRIFT: #${pullRequest.number} fetched ${fetchedHead}, expected ${pullRequest.head.sha}.`);
				}
				commands.run("git", ["cat-file", "-e", `${pullRequest.base.sha}^{commit}`]);
				baseHeads.set(pullRequest.base.ref, commands.run("git", ["rev-parse", `refs/remotes/origin/${pullRequest.base.ref}`]));
			}
			return baseHeads;
		},
		remoteBaseHeads(baseRefs)
		{
			const references = baseRefs.map(function _Reference(baseRef) { return `refs/heads/${baseRef}`; });
			const output = commands.run("git", ["ls-remote", "--refs", "origin", ...references]);
			const remoteHeads = new Map();
			for (const line of output.split("\n").filter(Boolean))
			{
				const [sha, reference] = line.split(/\s+/u);
				remoteHeads.set(reference.slice("refs/heads/".length), sha);
			}
			return remoteHeads;
		},
		evidence(pullRequests)
		{
			const ancestry = new Set();
			const diffDigests = new Map();
			const patchIds = new Map();
			for (const possibleAncestor of pullRequests)
			{
				for (const possibleDescendant of pullRequests)
				{
					if (possibleAncestor.number !== possibleDescendant.number
						&& commands.status("git", ["merge-base", "--is-ancestor", possibleAncestor.head.sha, possibleDescendant.head.sha]) === 0)
					{
						ancestry.add(`${possibleAncestor.number}:${possibleDescendant.number}`);
					}
				}
				const diff = commands.runBuffer("git", [
					"diff",
					"--full-index",
					"--no-textconv",
					`${possibleAncestor.base.sha}...${possibleAncestor.head.sha}`,
				]);
				diffDigests.set(possibleAncestor.number, createHash("sha256").update(diff).digest("hex"));
				if (diff.length > 0)
				{
					const patchOutput = commands.run("git", ["patch-id", "--stable"], { input: diff });
					patchIds.set(possibleAncestor.number, patchOutput.split(/\s+/u)[0]);
				}
			}
			return { ancestry, diffDigests, patchIds };
		},
	};
}
