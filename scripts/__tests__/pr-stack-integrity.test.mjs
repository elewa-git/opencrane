import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { validationResult } from "../pr-stack-integrity/evidence.mjs";
import { createGitHubAdapter } from "../pr-stack-integrity/github.mjs";
import { createGitAdapter } from "../pr-stack-integrity/git.mjs";
import { inspectLiveStack } from "../pr-stack-integrity/inspection.mjs";
import { evaluateStack } from "../pr-stack-integrity/policy.mjs";
import { createCommandRunner } from "../pr-stack-integrity/process.mjs";
import { publishResult, renderMarkdown } from "../pr-stack-integrity/report.mjs";
import { parseReviewOrder } from "../pr-stack-integrity/review-order.mjs";

/** Create one GitHub-shaped pull request fixture. */
function _PullRequest(number, headRef, headSha, baseRef, baseSha, body = "")
{
	return {
		number,
		html_url: `https://example.test/pull/${number}`,
		draft: false,
		body,
		head: { ref: headRef, sha: headSha },
		base: { ref: baseRef, sha: baseSha },
	};
}

/** Validate fixtures with stable, distinct diff evidence. */
function _Validate(pullRequests, options = {})
{
	const input = {
		repository: "example/opencrane",
		pullRequests,
		integrationBranches: new Set(["develop"]),
		baseHeads: new Map(pullRequests.map(function _BaseHead(pr) { return [pr.base.ref, pr.base.sha]; })),
		ancestry: options.ancestry ?? new Set(),
		diffDigests: new Map(pullRequests.map(function _Diff(pr) { return [pr.number, `diff-${pr.number}`]; })),
		patchIds: options.patchIds ?? new Map(pullRequests.map(function _Patch(pr) { return [pr.number, `patch-${pr.number}`]; })),
		event: options.event,
	};
	return validationResult(input, evaluateStack(input));
}

test("canonicalizes GitHub API order and parses only the Review order section", function _CanonicalEvidence()
{
	const first = _PullRequest(2, "feat/two", "b", "feat/one", "a", "## Review order\n\n1. #1\n2. #2\n\n## Notes\n\nSee #77.");
	const second = _PullRequest(1, "feat/one", "a", "develop", "d");
	const github = createGitHubAdapter({
		run() { return JSON.stringify([[first, second]]); },
	});
	assert.deepEqual(github.openPullRequests("example/opencrane").map(function _Number(pr) { return pr.number; }), [1, 2]);
	assert.deepEqual(parseReviewOrder(first.body), [1, 2]);
});

test("accepts an independent integration-root PR", function _Independent()
{
	const result = _Validate([_PullRequest(1, "feat/one", "a", "develop", "d")], {
		event: { number: 1, action: "opened", headSha: "a" },
	});
	assert.equal(result.valid, true);
	assert.deepEqual(result.evidence.reviewLevels, [[1]]);
});

test("accepts a stack with historical closed review-order entries", function _Stack()
{
	const pullRequests = [
		_PullRequest(1, "feat/one", "a", "develop", "d"),
		_PullRequest(2, "feat/two", "b", "feat/one", "a", "## Review order\n\n1. #99\n2. #1\n3. #2"),
		_PullRequest(3, "feat/three", "c", "feat/two", "b", "## Review order\n\n1. #99\n2. #1\n3. #2\n4. #3"),
	];
	const result = _Validate(pullRequests, {
		ancestry: new Set(["1:2", "1:3", "2:3"]),
		event: { number: 3, action: "synchronize", headSha: "c" },
	});
	assert.equal(result.valid, true);
	assert.deepEqual(result.evidence.currentChain, [1, 2, 3]);
});

test("rejects stale parent SHAs and non-ancestral stack edges", function _StaleParent()
{
	const pullRequests = [
		_PullRequest(1, "feat/one", "new-a", "develop", "d"),
		_PullRequest(2, "feat/two", "b", "feat/one", "old-a", "## Review order\n\n1. #1\n2. #2"),
	];
	const result = _Validate(pullRequests, { event: { number: 2, action: "edited", headSha: "b" } });
	assert.equal(result.valid, false);
	assert.deepEqual(result.evidence.findings.map(function _Code(finding) { return finding.code; }), [
		"NON_ANCESTRAL_PARENT",
		"STALE_PARENT_SHA",
	]);
});

test("rejects a feature base whose predecessor is no longer open", function _OrphanedBase()
{
	const result = _Validate([_PullRequest(2, "feat/two", "b", "feat/merged-one", "a")]);
	assert.equal(result.valid, false);
	assert.equal(result.evidence.findings[0].code, "ORPHANED_BASE");
});

test("rejects cycles and duplicate head branches", function _InvalidGraph()
{
	const cycle = _Validate([
		_PullRequest(1, "feat/one", "a", "feat/two", "b"),
		_PullRequest(2, "feat/two", "b", "feat/one", "a"),
	], { ancestry: new Set(["1:2", "2:1"]) });
	assert.ok(cycle.evidence.findings.some(function _Code(finding) { return finding.code === "STACK_CYCLE"; }));

	const duplicate = _Validate([
		_PullRequest(1, "feat/shared", "a", "develop", "d"),
		_PullRequest(2, "feat/shared", "b", "develop", "d"),
	]);
	assert.ok(duplicate.evidence.findings.some(function _Code(finding) { return finding.code === "DUPLICATE_HEAD_BRANCH"; }));
});

test("rejects an open predecessor absorbed outside the declared base chain", function _Absorption()
{
	const pullRequests = [
		_PullRequest(1, "feat/one", "a", "develop", "d"),
		_PullRequest(2, "feat/two", "b", "develop", "d"),
	];
	const result = _Validate(pullRequests, { ancestry: new Set(["1:2"]) });
	assert.equal(result.valid, false);
	assert.equal(result.evidence.findings[0].code, "UNDECLARED_ABSORPTION");
});

test("rejects rebased or cherry-picked duplicate incremental patches", function _PatchReplay()
{
	const pullRequests = [
		_PullRequest(1, "feat/one", "a", "develop", "d"),
		_PullRequest(2, "feat/two", "b", "develop", "d"),
	];
	const result = _Validate(pullRequests, { patchIds: new Map([[1, "same"], [2, "same"]]) });
	assert.equal(result.valid, false);
	assert.equal(result.evidence.findings[0].code, "DUPLICATE_PATCH");
});

test("rejects missing, reversed, duplicate, and unrelated open review entries", function _ReviewOrder()
{
	const pullRequests = [
		_PullRequest(1, "feat/one", "a", "develop", "d"),
		_PullRequest(2, "feat/two", "b", "feat/one", "a", "## Review order\n\n1. #2\n2. #2\n3. #3"),
		_PullRequest(3, "feat/independent", "c", "develop", "d"),
	];
	const result = _Validate(pullRequests, {
		ancestry: new Set(["1:2"]),
		event: { number: 2, action: "edited", headSha: "b" },
	});
	const codes = new Set(result.evidence.findings.map(function _Code(finding) { return finding.code; }));
	assert.deepEqual(codes, new Set([
		"CROSS_COMPONENT_REVIEW_ENTRY",
		"DUPLICATE_REVIEW_ENTRY",
		"MISSING_REVIEW_ENTRY",
		"REVERSED_REVIEW_ORDER",
	]));
});

test("checks every open stack review order even when another PR triggered the event", function _GlobalReviewOrder()
{
	const pullRequests = [
		_PullRequest(1, "feat/one", "a", "develop", "d"),
		_PullRequest(2, "feat/two", "b", "feat/one", "a", "## Review order\n\n1. #2"),
		_PullRequest(3, "feat/independent", "c", "develop", "d"),
	];
	const result = _Validate(pullRequests, {
		ancestry: new Set(["1:2"]),
		event: { number: 3, action: "edited", headSha: "c" },
	});
	assert.ok(result.evidence.findings.some(function _Missing(finding) {
		return finding.code === "MISSING_REVIEW_ENTRY" && finding.message.includes("#2");
	}));
});

test("rejects event-head drift while allowing a closed event to audit globally", function _EventDrift()
{
	const pullRequests = [_PullRequest(1, "feat/one", "a", "develop", "d")];
	const drift = _Validate(pullRequests, { event: { number: 1, action: "synchronize", headSha: "stale" } });
	assert.equal(drift.evidence.findings[0].code, "EVENT_HEAD_DRIFT");
	const closed = _Validate(pullRequests, { event: { number: 99, action: "closed", headSha: "gone" } });
	assert.equal(closed.valid, true);
});

test("skips a local branch with no open PR without touching Git", function _NoOpenPullRequest()
{
	const pullRequest = _PullRequest(1, "feat/one", "a", "develop", "d");
	const result = inspectLiveStack({
		repository: "example/opencrane",
		currentBranch: "feat/local-only",
		github: { openPullRequests() { return [pullRequest]; } },
		git: { fetchAndVerify() { throw new Error("Git must not run"); } },
	});
	assert.match(result.skipped, /has no open PR/u);
});

test("fails when the GitHub snapshot changes during inspection", function _SnapshotDrift()
{
	const first = [_PullRequest(1, "feat/one", "a", "develop", "d")];
	const second = [_PullRequest(1, "feat/one", "changed", "develop", "d")];
	let calls = 0;
	assert.throws(function _Inspect() {
		inspectLiveStack({
			repository: "example/opencrane",
			event: { number: 1, action: "synchronize", headSha: "a" },
			github: { openPullRequests() { calls += 1; return calls === 1 ? first : second; } },
			git: { fetchAndVerify() { return new Map([["develop", "d"]]); } },
		});
	}, /SNAPSHOT_DRIFT/u);
});

test("fails when a live base ref changes during inspection", function _BaseDrift()
{
	const pullRequests = [_PullRequest(1, "feat/one", "a", "develop", "d")];
	assert.throws(function _Inspect() {
		inspectLiveStack({
			repository: "example/opencrane",
			event: { number: 1, action: "edited", headSha: "a" },
			github: { openPullRequests() { return pullRequests; } },
			git: {
				fetchAndVerify() { return new Map([["develop", "before"]]); },
				remoteBaseHeads() { return new Map([["develop", "after"]]); },
			},
		});
	}, /BASE_REF_DRIFT/u);
});

test("fails when the graph changes while Git evidence is computed", function _FinalSnapshotDrift()
{
	const first = [_PullRequest(1, "feat/one", "a", "develop", "d")];
	const changed = [_PullRequest(1, "feat/one", "new-a", "develop", "d")];
	let calls = 0;
	assert.throws(function _Inspect() {
		inspectLiveStack({
			repository: "example/opencrane",
			event: { number: 1, action: "synchronize", headSha: "a" },
			github: { openPullRequests() { calls += 1; return calls < 3 ? first : changed; } },
			git: {
				fetchAndVerify() { return new Map([["develop", "d"]]); },
				remoteBaseHeads() { return new Map([["develop", "d"]]); },
				evidence() { return { ancestry: new Set(), diffDigests: new Map(), patchIds: new Map() }; },
			},
		});
	}, /FINAL_SNAPSHOT_DRIFT/u);
});

test("fails when a fetched PR ref does not match GitHub's head SHA", function _FetchedHeadDrift()
{
	const commands = {
		run(_command, arguments_)
		{
			if (arguments_[0] === "rev-parse" && arguments_[1].includes("open-pr")) return "wrong";
			return "";
		},
	};
	const git = createGitAdapter(commands);
	assert.throws(function _Fetch() {
		git.fetchAndVerify([_PullRequest(1, "feat/one", "expected", "develop", "d")]);
	}, /FETCHED_HEAD_DRIFT/u);
});

test("bounds external commands and surfaces timeouts", function _CommandTimeout()
{
	const commands = createCommandRunner(10);
	assert.throws(function _Timeout() {
		commands.run(process.execPath, ["-e", "setTimeout(function () {}, 1000)"]);
	}, /timed out|ETIMEDOUT/iu);
});

test("publishes deterministic JSON evidence and matching Markdown", function _Publish(context)
{
	const directory = mkdtempSync(join(tmpdir(), "opencrane-stack-report-"));
	context.after(function _Cleanup() { rmSync(directory, { recursive: true, force: true }); });
	const evidencePath = join(directory, "evidence.json");
	const summaryPath = join(directory, "summary.md");
	const result = _Validate([_PullRequest(1, "feat/one", "a", "develop", "d")]);
	let output = "";
	publishResult(result, function _Output(value) { output += value; }, {
		evidencePath,
		summaryPath,
		format: "json",
	});
	assert.deepEqual(JSON.parse(readFileSync(evidencePath, "utf8")), result.evidence);
	assert.equal(readFileSync(summaryPath, "utf8"), renderMarkdown(result));
	assert.deepEqual(JSON.parse(output), result);
});
