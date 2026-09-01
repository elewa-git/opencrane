import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { validationResult } from "../pr-stack-integrity/evidence.mjs";
import { createGitHubAdapter } from "../pr-stack-integrity/github.mjs";
import { createGitAdapter } from "../pr-stack-integrity/git.mjs";
import { inspectLiveStack, inspectStableStack } from "../pr-stack-integrity/inspection.mjs";
import { evaluateStack } from "../pr-stack-integrity/policy.mjs";
import { COMMAND_OUTPUT_MAX_BYTES, createCommandRunner } from "../pr-stack-integrity/process.mjs";
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
		mergedPullRequests: options.mergedPullRequests ?? [],
		integrationBranches: new Set(["develop"]),
		baseHeads: new Map(pullRequests.map(function _BaseHead(pr) { return [pr.base.ref, pr.base.sha]; })),
		ancestry: options.ancestry ?? new Set(),
		diffDigests: new Map(pullRequests.map(function _Diff(pr) { return [pr.number, `diff-${pr.number}`]; })),
		patchIds: options.patchIds ?? new Map(pullRequests.map(function _Patch(pr) { return [pr.number, `patch-${pr.number}`]; })),
		event: options.event,
	};
	return validationResult(input, evaluateStack(input));
}

/** Create a merged native-stack PR fixture that can bridge open layers. */
function _MergedPullRequest(number, headRef, headSha, baseRef, baseSha, mergeCommitSha)
{
	return {
		..._PullRequest(number, headRef, headSha, baseRef, baseSha),
		mergedAt: "2026-09-01T00:00:00Z",
		mergeCommitSha,
	};
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

test("queries only unresolved base branches for merged native stack layers", function _RelevantMergedQueries()
{
	const calls = [];
	const github = createGitHubAdapter({
		run(command, arguments_)
		{
			calls.push([command, arguments_]);
			return JSON.stringify([[]]);
		},
	});
	github.mergedPullRequests("example/opencrane", [
		_PullRequest(1, "feat/one", "a", "develop", "d"),
		_PullRequest(2, "feat/two", "b", "feat/one", "a"),
		_PullRequest(3, "feat/three", "c", "feat/deleted", "m"),
	]);
	assert.equal(calls.length, 2);
	assert.ok(calls.some(function _DeletedBase(call) {
		return call[1].at(-1).includes("head=example%3Afeat%2Fdeleted");
	}));
	assert.ok(calls.some(function _IntegrationBase(call) {
		return call[1].at(-1).includes("head=example%3Adevelop");
	}));
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

test("bridges only merge-commit-pinned native stack layers", function _MergedStackBridge()
{
	const pullRequests = [
		_PullRequest(1, "feat/one", "merged-tip", "develop", "d"),
		_PullRequest(3, "feat/three", "c", "feat/two", "merged-tip", "## Review order\n\n1. #1\n2. #3"),
	];
	const mergedPullRequests = [_MergedPullRequest(2, "feat/two", "merged-tip", "feat/one", "previous-tip", "merged-tip")];
	const result = _Validate(pullRequests, {
		mergedPullRequests,
		ancestry: new Set(["1:3"]),
		event: { number: 3, action: "synchronize", headSha: "c" },
	});
	assert.equal(result.valid, true);
	assert.deepEqual(result.evidence.currentChain, [1, 3]);
	assert.deepEqual(result.evidence.mergedBridges, [{
		child: 3,
		mergedLayers: [{
			number: 2,
			head: { ref: "feat/two", sha: "merged-tip" },
			base: { ref: "feat/one", sha: "previous-tip" },
			mergeCommitSha: "merged-tip",
		}],
	}]);
});

test("selects a merged stack layer by its recorded merge commit", function _RepeatedMergedHead()
{
	const pullRequests = [
		_PullRequest(1, "feat/one", "merged-tip", "develop", "d"),
		_PullRequest(3, "feat/three", "c", "feat/two", "merged-tip", "## Review order\n\n1. #1\n2. #3"),
	];
	const mergedPullRequests = [
		_MergedPullRequest(2, "feat/two", "old-tip", "develop", "d", "old-tip"),
		_MergedPullRequest(4, "feat/two", "merged-tip", "feat/one", "previous-tip", "merged-tip"),
	];
	const result = _Validate(pullRequests, {
		mergedPullRequests,
		ancestry: new Set(["1:3"]),
	});
	assert.equal(result.valid, true);
});

test("binds merged stack layers into the inspection snapshot digest", function _MergedSnapshotDigest()
{
	const pullRequests = [_PullRequest(3, "feat/three", "c", "feat/two", "merged-tip")];
	const matching = _Validate(pullRequests, {
		mergedPullRequests: [_MergedPullRequest(2, "feat/two", "merged-tip", "develop", "d", "merged-tip")],
	});
	const missing = _Validate(pullRequests);
	assert.equal(matching.valid, true);
	assert.deepEqual(matching.evidence.mergedBridges.map(function _Child(bridge) { return bridge.child; }), [3]);
	assert.notEqual(matching.evidence.snapshotDigest, missing.evidence.snapshotDigest);
});

test("rejects a merged-layer base that is not pinned to its merge commit", function _UnpinnedMergedStackBase()
{
	const pullRequests = [_PullRequest(3, "feat/three", "c", "feat/two", "stale-tip")];
	const mergedPullRequests = [_MergedPullRequest(2, "feat/two", "merged-tip", "develop", "d", "merged-tip")];
	const result = _Validate(pullRequests, { mergedPullRequests });
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

test("retries a transient merge-time base-ref drift with a fresh full inspection", function _TransientBaseDrift()
{
	const pullRequests = [_PullRequest(1, "feat/one", "a", "develop", "d")];
	let fetches = 0;
	const inspection = inspectStableStack({
		repository: "example/opencrane",
		event: { number: 99, action: "closed", headSha: "merged" },
		github: { openPullRequests() { return pullRequests; } },
		git: {
			fetchAndVerify()
			{
				fetches += 1;
				return new Map([["develop", fetches === 1 ? "before" : "after"]]);
			},
			remoteBaseHeads() { return new Map([["develop", "after"]]); },
			evidence() { return { ancestry: new Set(), diffDigests: new Map(), patchIds: new Map() }; },
		},
	});
	assert.equal(fetches, 2);
	assert.equal(inspection.baseHeads.get("develop"), "after");
});

test("fails closed after bounded repeated base-ref drift", function _RepeatedBaseDrift()
{
	const pullRequests = [_PullRequest(1, "feat/one", "a", "develop", "d")];
	let fetches = 0;
	assert.throws(function _Inspect() {
		inspectStableStack({
			repository: "example/opencrane",
			event: { number: 1, action: "edited", headSha: "a" },
			github: { openPullRequests() { return pullRequests; } },
			git: {
				fetchAndVerify()
				{
					fetches += 1;
					return new Map([["develop", "before"]]);
				},
				remoteBaseHeads() { return new Map([["develop", "after"]]); },
			},
		});
	}, /BASE_REF_DRIFT/u);
	assert.equal(fetches, 3);
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

test("does not fetch a deleted merged parent branch", function _DeletedMergedBase()
{
	const calls = [];
	const git = createGitAdapter({
		run(command, arguments_)
		{
			calls.push([command, arguments_]);
			if (arguments_[0] === "rev-parse")
			{
				return "child";
			}
			return "";
		},
	});
	git.fetchAndVerify([_PullRequest(3, "feat/three", "child", "feat/deleted-merged", "merge")]);
	const fetch = calls.find(function _Fetch(call) { return call[1][0] === "fetch"; });
	assert.ok(fetch);
	assert.equal(fetch[1].some(function _DeletedBase(argument) {
		return argument.includes("refs/heads/feat/deleted-merged");
	}), false);
});

test("keeps distinct binary identities without buffering patch payloads", function _BinaryDiffMetadata()
{
	const firstDiff = Buffer.from("diff --git a/image.png b/image.png\nindex 0000000000000000000000000000000000000000..1111111111111111111111111111111111111111 100644\nBinary files differ\n");
	const secondDiff = Buffer.from("diff --git a/image.png b/image.png\nindex 2222222222222222222222222222222222222222..3333333333333333333333333333333333333333 100644\nBinary files differ\n");
	const diffArguments = [];
	const commands = {
		run(command, arguments_, options)
		{
			assert.equal(command, "git");
			assert.deepEqual(arguments_, ["patch-id", "--stable"]);
			return options.input === firstDiff ? "patch-one 0000000" : "patch-two 0000000";
		},
		runBuffer(command, arguments_)
		{
			assert.equal(command, "git");
			diffArguments.push(arguments_);
			return arguments_.at(-1) === "base-one...head-one" ? firstDiff : secondDiff;
		},
		status() { return 1; },
	};
	const evidence = createGitAdapter(commands).evidence([
		_PullRequest(1, "feat/one", "head-one", "develop", "base-one"),
		_PullRequest(2, "feat/two", "head-two", "develop", "base-two"),
	]);

	assert.deepEqual(diffArguments, [
		["diff", "--full-index", "--no-textconv", "base-one...head-one"],
		["diff", "--full-index", "--no-textconv", "base-two...head-two"],
	]);
	assert.equal(evidence.diffDigests.get(1), "d924fbc2f75baa1bba45c91bb33f0ba1dec1e83ba11286be8ade5adf5755d2ff");
	assert.equal(evidence.diffDigests.get(2), "9f16cb7bfed85ee08080967d7d4a30688ce675a2457cc9ba44af889e31dd4bba");
	assert.notEqual(evidence.diffDigests.get(1), evidence.diffDigests.get(2));
	assert.equal(evidence.patchIds.get(1), "patch-one");
	assert.equal(evidence.patchIds.get(2), "patch-two");
});

test("real Git assigns distinct stable patch IDs to different binary contents", function _RealBinaryPatchIdentity(context)
{
	const directory = mkdtempSync(join(tmpdir(), "opencrane-binary-patch-"));
	context.after(function _Cleanup() { rmSync(directory, { recursive: true, force: true }); });
	const git = function _Git(arguments_, options = {}) {
		return execFileSync("git", arguments_, {
			cwd: directory,
			encoding: "utf8",
			...options,
		}).trim();
	};

	git(["init", "--quiet"]);
	git(["config", "commit.gpgsign", "false"]);
	git(["config", "user.email", "stack-check@example.test"]);
	git(["config", "user.name", "Stack Check"]);
	writeFileSync(join(directory, "image.bin"), Buffer.from([0, 1, 2, 3]));
	git(["add", "image.bin"]);
	git(["commit", "--quiet", "-m", "base"]);
	const base = git(["rev-parse", "HEAD"]);

	writeFileSync(join(directory, "image.bin"), Buffer.from([0, 4, 5, 6]));
	git(["commit", "--quiet", "-am", "first"]);
	const first = git(["rev-parse", "HEAD"]);
	git(["checkout", "--quiet", "--detach", base]);
	writeFileSync(join(directory, "image.bin"), Buffer.from([0, 7, 8, 9]));
	git(["commit", "--quiet", "-am", "second"]);
	const second = git(["rev-parse", "HEAD"]);

	const firstDiff = git(["diff", "--full-index", "--no-textconv", `${base}...${first}`]);
	const secondDiff = git(["diff", "--full-index", "--no-textconv", `${base}...${second}`]);
	const firstPatchId = git(["patch-id", "--stable"], { input: firstDiff }).split(/\s+/u)[0];
	const secondPatchId = git(["patch-id", "--stable"], { input: secondDiff }).split(/\s+/u)[0];

	assert.notEqual(firstPatchId, secondPatchId);
});

test("bounds external commands and surfaces timeouts", function _CommandTimeout()
{
	const commands = createCommandRunner(10);
	assert.throws(function _Timeout() {
		commands.run(process.execPath, ["-e", "setTimeout(function () {}, 1000)"]);
	}, /timed out|ETIMEDOUT/iu);
});

test("captures broad PR diffs beyond the Node child-process default", function _BroadDiffBuffer()
{
	const commands = createCommandRunner();
	const bytes = 2 * 1024 * 1024;
	const script = `process.stdout.write(Buffer.alloc(${bytes}))`;
	assert.equal(commands.run(process.execPath, ["-e", script]).length, bytes);
	assert.equal(commands.runBuffer(process.execPath, ["-e", script]).length, bytes);
});

test("enforces the command output cap for string and buffer callers", function _BoundedOutput()
{
	const commands = createCommandRunner();
	const bytes = COMMAND_OUTPUT_MAX_BYTES + 1;
	const script = `process.stdout.write(Buffer.alloc(${bytes}))`;
	assert.throws(function _StringOutput() {
		commands.run(process.execPath, ["-e", script], { maxBuffer: bytes * 2 });
	}, /ENOBUFS/u);
	assert.throws(function _BufferOutput() {
		commands.runBuffer(process.execPath, ["-e", script]);
	}, /ENOBUFS/u);
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

test("binds successful checks to validated heads and paginates failure invalidation", function _WorkflowPublication()
{
	const workflow = readFileSync(".github/workflows/pr-stack-integrity.yml", "utf8");
	assert.match(workflow, /set -euo pipefail/u);
	assert.match(workflow, /\.pullRequests\[\]\.head\.sha/u);
	assert.match(workflow, /gh api \\\n\s+--paginate/u);
	assert.match(workflow, /--jq '\.\[\] \| \.head\.sha'/u);
	assert.doesNotMatch(workflow, /--slurp/u);
	assert.doesNotMatch(workflow, /gh pr list/u);
	assert.doesNotMatch(workflow, /--limit 100/u);
});
