#!/usr/bin/env node

import { execFileSync, spawnSync } from "node:child_process";
import { appendFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

/** Run Git against the checked-out commit without modifying the repository. */
function _Git(cwd, args)
{
	return execFileSync("git", args, { cwd, encoding: "utf8", timeout: 30_000, stdio: ["ignore", "pipe", "pipe"] }).trim();
}

/** Return whether Git finds a ref or ancestry, while reporting unexpected command failures. */
function _GitMatches(cwd, args)
{
	const result = spawnSync("git", args, { cwd, encoding: "utf8", timeout: 30_000 });
	if (result.status === 0)
		return true;
	if (result.status === 1)
		return false;
	throw new Error(`Comparison ancestry check failed: ${result.error?.message ?? result.stderr.trim()}`);
}

/**
 * Resolve the comparison commit after nx-set-shas looks for successful push validation.
 *
 * A branch without that evidence compares all work since its integration ancestor. The action's
 * previous-commit fallback would omit earlier unqualified changes. Main has no integration parent;
 * missing ancestry fails preparation because the policy guards require a real comparison commit.
 *
 * Called by: docker.yml preparation and the affected-deployables regression suite.
 * @param {object} input Action outputs, current ref name, and optional test repository directory.
 * @returns {string} A commit SHA ancestral to the workflow checkout.
 * @throws {Error} When the action selected a non-ancestor or no integration ancestor exists.
 */
export function resolveAffectedComparisonBase({ candidateBase, headSha, noPreviousBuild, refName, cwd = process.cwd() })
{
	if (!/^[0-9a-f]{40}$/u.test(headSha ?? ""))
		throw new Error("The affected comparison requires a full workflow head SHA.");
	_Git(cwd, ["rev-parse", "--verify", `${headSha}^{commit}`]);
	if (!noPreviousBuild)
	{
		if (!/^[0-9a-f]{40}$/u.test(candidateBase ?? "") || !_GitMatches(cwd, ["merge-base", "--is-ancestor", candidateBase, headSha]))
			throw new Error("The selected affected base is not an ancestor of the workflow head.");
		return candidateBase;
	}

	const integrationBranches = ["develop", "main"];
	for (const branch of integrationBranches)
	{
		if (refName === "main" || (refName === "develop" && branch === "develop"))
			continue;
		const ref = `refs/remotes/origin/${branch}`;
		if (!_GitMatches(cwd, ["show-ref", "--verify", "--quiet", ref]))
			continue;
		const ancestry = spawnSync("git", ["merge-base", ref, headSha], { cwd, encoding: "utf8", timeout: 30_000 });
		if (ancestry.status === 1)
			continue;
		if (ancestry.status !== 0)
			throw new Error(`Integration comparison failed: ${ancestry.error?.message ?? ancestry.stderr.trim()}`);
		const base = ancestry.stdout.trim();
		if (base !== headSha)
			return base;
	}
	throw new Error("No successful push or usable integration ancestor exists; refusing a previous-commit comparison.");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
{
	const headSha = process.env.NX_CANDIDATE_HEAD;
	const base = resolveAffectedComparisonBase({
		candidateBase: process.env.NX_CANDIDATE_BASE,
		headSha,
		noPreviousBuild: process.env.NO_PREVIOUS_BUILD === "true",
		refName: process.env.GITHUB_REF_NAME,
	});
	const variables = `NX_BASE=${base}\nNX_HEAD=${headSha}\n`;
	if (process.env.GITHUB_ENV)
		appendFileSync(process.env.GITHUB_ENV, variables);
	process.stdout.write(variables);
}
