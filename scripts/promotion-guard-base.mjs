#!/usr/bin/env node

import { execFileSync, spawnSync } from "node:child_process";
import { appendFileSync } from "node:fs";

import { selectGuardComparisonBase, selectPromotionSource } from "./promotion-guard-base.core.mjs";

/** Run a bounded command and return trimmed stdout. */
function _Run(command, arguments_)
{
	return execFileSync(command, arguments_, { encoding: "utf8", timeout: 30_000 }).trim();
}

/** Return whether a bounded command completed successfully. */
function _Succeeds(command, arguments_)
{
	return spawnSync(command, arguments_, { encoding: "utf8", timeout: 30_000 }).status === 0;
}

/** Write one GitHub Actions output or a local diagnostic. */
function _Output(name, value)
{
	if (process.env.GITHUB_OUTPUT)
	{
		appendFileSync(process.env.GITHUB_OUTPUT, `${name}=${value}\n`);
		return;
	}
	process.stdout.write(`${name}=${value}\n`);
}

/** Resolve merge facts required to recognize an unchanged develop promotion on main. */
function _PushFacts(eventName, ref, headSha)
{
	if (eventName !== "push" || ref !== "refs/heads/main")
	{
		return { parentShas: [], sourceInDevelop: false, headTree: "", sourceTree: "" };
	}
	_Run("git", ["fetch", "--quiet", "--no-tags", "origin", "+refs/heads/develop:refs/remotes/origin/develop"]);
	const revision = _Run("git", ["rev-list", "--parents", "-n", "1", headSha]).split(/\s+/u);
	const parentShas = revision.slice(1);
	const sourceSha = parentShas[1];
	if (!sourceSha)
	{
		return { parentShas, sourceInDevelop: false, headTree: "", sourceTree: "" };
	}
	return {
		parentShas,
		sourceInDevelop: _Succeeds("git", ["merge-base", "--is-ancestor", sourceSha, "refs/remotes/origin/develop"]),
		headTree: _Run("git", ["rev-parse", `${headSha}^{tree}`]),
		sourceTree: _Run("git", ["rev-parse", `${sourceSha}^{tree}`]),
	};
}

/** Read exact-SHA develop validation runs from GitHub. */
function _ValidationRuns(repository, sourceSha)
{
	if (!sourceSha)
	{
		return [];
	}
	const query = new URLSearchParams({ branch: "develop", event: "push", head_sha: sourceSha, per_page: "100" });
	const response = _Run("gh", ["api", `repos/${repository}/actions/workflows/docker.yml/runs?${query.toString()}`]);
	return JSON.parse(response).workflow_runs ?? [];
}

const nxBase = process.env.NX_BASE;
const nxHead = process.env.NX_HEAD;
if (!nxBase || !nxHead)
{
	throw new Error("NX_BASE and NX_HEAD must be set before selecting the policy comparison base.");
}

const eventName = process.env.GITHUB_EVENT_NAME ?? "local";
const ref = process.env.GITHUB_REF ?? "";
const push = _PushFacts(eventName, ref, nxHead);
const promotionSourceSha = selectPromotionSource({
	eventName,
	ref,
	baseRef: process.env.GITHUB_BASE_REF ?? "",
	headRef: process.env.GITHUB_HEAD_REF ?? "",
	pullRequestHeadSha: process.env.PULL_REQUEST_HEAD_SHA ?? "",
	pushParentShas: push.parentShas,
	pushSourceInDevelop: push.sourceInDevelop,
	pushHeadTree: push.headTree,
	pushSourceTree: push.sourceTree,
});
const guardBase = selectGuardComparisonBase({
	nxBase,
	promotionSourceSha,
	validationRuns: _ValidationRuns(process.env.GITHUB_REPOSITORY ?? "", promotionSourceSha),
});

_Output("guard_base", guardBase);
