import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
	selectAffectedDeployables,
	selectApiContractChanged,
	selectDevelopSmokeRequired,
	selectForcedContainerProjects,
	selectGuardInputsChanged,
	selectImageSmokeProjects,
} from "../affected-deployables.core.mjs";
import { hasSuccessfulDevelopValidation, selectGuardComparisonBase, selectPromotionSource } from "../promotion-guard-base.core.mjs";

/** Reads the stable selector fixture. */
function _Fixture()
{
	const path = fileURLToPath(new URL("./fixtures/affected-deployables/selection.json", import.meta.url));
	return JSON.parse(readFileSync(path, "utf8"));
}

/** Reads the publish workflow whose affected selector this suite protects. */
function _Workflow()
{
	const path = fileURLToPath(new URL("../../.github/workflows/docker.yml", import.meta.url));
	return readFileSync(path, "utf8");
}

test("selects sorted release descriptors owned by affected container apps", function _SelectsDescriptors()
{
	const fixture = _Fixture();
	assert.deepEqual(selectAffectedDeployables(fixture.containerProjects), [
		{ project: "opencrane-ui", image: "opencrane-ui", dockerfile: "apps/opencrane-ui/deploy/Dockerfile" },
		{ project: "skill-authoring", image: "opencrane-skill-authoring", dockerfile: "apps/skill-authoring/deploy/Dockerfile" },
	]);
});

test("fails closed when a container target is not publishable", function _RejectsUndescribedTarget()
{
	assert.throws(function _Selection() {
		selectAffectedDeployables([{ name: "smoke-only", targets: { container: { options: { command: "bash test.sh" } } } }]);
	}, /must declare targets\.container\.metadata\.release\.image and dockerfile/u);
});

test("uses an explicit publication set and makes manual dispatch validation-only by default", function _SelectsForcedProjects()
{
	assert.deepEqual(selectForcedContainerProjects("none"), []);
	assert.deepEqual(selectForcedContainerProjects("bootstrap"), ["channel-proxy", "memory-gateway"]);
	assert.deepEqual(selectForcedContainerProjects("artifact"), ["artifact-service"]);
	assert.deepEqual(selectForcedContainerProjects("server"), ["opencrane"]);
	assert.deepEqual(selectForcedContainerProjects("ui"), ["opencrane-ui"]);
	assert.equal(selectForcedContainerProjects(""), null);
	assert.throws(function _UnknownForce() { selectForcedContainerProjects("all"); }, /unsupported FORCE_DEPLOYABLES value: all/u);
});

test("selects affected image smokes unless manual qualification expands to every owner", function _SelectsImageSmokes()
{
	const affected = ["skill-authoring", "skill-authoring"];
	const all = ["tool-runner", "skill-authoring"];
	assert.deepEqual(selectImageSmokeProjects(affected, all, ""), [{ project: "skill-authoring" }]);
	assert.deepEqual(selectImageSmokeProjects(affected, all, "k3d"), [{ project: "skill-authoring" }]);
	const allProjects = [{ project: "skill-authoring" }, { project: "tool-runner" }];
	assert.deepEqual(selectImageSmokeProjects(affected, all, "image-smoke"), allProjects);
	assert.deepEqual(selectImageSmokeProjects(affected, all, "all"), allProjects);
	assert.throws(
		function _UnknownForce() { selectImageSmokeProjects(affected, all, "everything"); },
		/unsupported FORCE_HEAVY_QUALIFICATION value/u,
	);
});

test("uses all affected projects for contract verification and changed files for guard fixtures", function _SelectsPipelineInputs()
{
	const fixture = _Fixture();
	assert.equal(selectApiContractChanged(fixture.affectedProjects), true);
	assert.equal(selectGuardInputsChanged(fixture.changedFiles), true);
	assert.equal(selectApiContractChanged(["skill-authoring"]), false);
	assert.equal(selectGuardInputsChanged(["apps/skill-authoring/src/authoring_worker.py"]), false);
});

test("runs the develop smoke for deployment surfaces and not ordinary application sources", function _SelectsDevelopSmokeInputs()
{
	assert.equal(selectDevelopSmokeRequired(["apps/_infra/deploy-k8s/values.yaml"]), true);
	assert.equal(selectDevelopSmokeRequired(["apps/opencrane/helm/templates/_deployment.tpl"]), true);
	assert.equal(selectDevelopSmokeRequired(["apps/opencrane/deploy/Dockerfile"]), true);
	assert.equal(selectDevelopSmokeRequired([".github/workflows/docker.yml"]), true);
	assert.equal(selectDevelopSmokeRequired(["apps/opencrane/src/main.ts"]), false);
	assert.equal(selectDevelopSmokeRequired(["website/guide.md"]), false);
});

test("keeps heavyweight remote qualification ahead of image publication", function _ProtectsHeavyQualificationWiring()
{
	const workflow = _Workflow();
	const developSmokeJob = workflow.match(/\n  develop_smoke:[\s\S]*?\n  image_smoke:/u);
	const imageSmokeJob = workflow.match(/\n  image_smoke:[\s\S]*?\n  build-and-push:/u);
	assert.ok(developSmokeJob, "develop smoke job must remain independently inspectable");
	assert.ok(imageSmokeJob, "image smoke job must remain independently inspectable");
	assert.match(workflow, /heavy_qualification:[\s\S]*?- image-smoke[\s\S]*?- k3d[\s\S]*?- all/u);
	assert.match(workflow, /github\.ref == 'refs\/heads\/develop'/u);
	assert.match(workflow, /run: \.\/apps\/_infra\/deploy-k8s\/platform\/tests\/develop-smoke\.sh/u);
	assert.match(workflow, /inputs\.heavy_qualification == 'k3d'/u);
	assert.match(workflow, /inputs\.heavy_qualification == 'all'/u);
	assert.match(workflow, /needs: \[prepare, test, develop_smoke, image_smoke\]/u);
	assert.match(workflow, /needs\.develop_smoke\.result == 'success'/u);
	assert.match(workflow, /needs\.image_smoke\.result == 'success'/u);
	assert.match(workflow, /K3D_LINUX_AMD64_SHA256: [0-9a-f]{64}/u);
	assert.match(workflow, /sha256sum --check/u);
	assert.match(developSmokeJob[0], /uses: actions\/setup-node@v6/u);
	assert.match(
		developSmokeJob[0],
		/key: node-modules-\$\{\{ runner\.os \}\}-node24-\$\{\{ hashFiles\('package-lock\.json'\) \}\}/u,
	);
	assert.match(developSmokeJob[0], /name: Install deploy validation dependencies[\s\S]*?run: npm ci/u);
	assert.match(imageSmokeJob[0], /matrix: \$\{\{ fromJSON\(needs\.prepare\.outputs\.image_smokes\) \}\}/u);
	assert.match(
		imageSmokeJob[0],
		/IMAGE_SMOKE_PROJECT: \$\{\{ matrix\.project \}\}[\s\S]*?npx nx run "\$IMAGE_SMOKE_PROJECT:image-smoke"/u,
	);
});

test("trusts only an exact develop-to-main promotion source", function _SelectsPromotionSource()
{
	const pullRequest = selectPromotionSource({
		eventName: "pull_request",
		baseRef: "main",
		headRef: "develop",
		pullRequestHeadSha: "develop-head",
		pushParentShas: [],
	});
	assert.equal(pullRequest, "develop-head");
	assert.equal(selectPromotionSource({
		eventName: "pull_request",
		baseRef: "main",
		headRef: "feat/untrusted",
		pullRequestHeadSha: "feature-head",
		pushParentShas: [],
	}), null);

	const push = selectPromotionSource({
		eventName: "push",
		ref: "refs/heads/main",
		pushParentShas: ["old-main", "develop-head"],
		pushSourceInDevelop: true,
		pushHeadTree: "release-tree",
		pushSourceTree: "release-tree",
	});
	assert.equal(push, "develop-head");
	assert.equal(selectPromotionSource({
		eventName: "push",
		ref: "refs/heads/main",
		pushParentShas: ["old-main", "feature-head"],
		pushSourceInDevelop: false,
		pushHeadTree: "release-tree",
		pushSourceTree: "release-tree",
	}), null);
	assert.equal(selectPromotionSource({
		eventName: "push",
		ref: "refs/heads/main",
		pushParentShas: ["old-main", "develop-head"],
		pushSourceInDevelop: true,
		pushHeadTree: "merge-adjusted-tree",
		pushSourceTree: "release-tree",
	}), null);
});

test("requires a successful exact-SHA develop push before narrowing policy guards", function _RequiresValidatedPromotion()
{
	const sourceSha = "develop-head";
	const successfulRun = {
		path: ".github/workflows/docker.yml",
		head_branch: "develop",
		head_sha: sourceSha,
		event: "push",
		status: "completed",
		conclusion: "success",
	};
	assert.equal(hasSuccessfulDevelopValidation([successfulRun], sourceSha), true);
	assert.equal(selectGuardComparisonBase({
		nxBase: "old-main",
		promotionSourceSha: sourceSha,
		validationRuns: [successfulRun],
	}), sourceSha);
	assert.equal(selectGuardComparisonBase({
		nxBase: "ordinary-base",
		promotionSourceSha: null,
		validationRuns: [],
	}), "ordinary-base");
	assert.throws(function _PendingSource() {
		selectGuardComparisonBase({
			nxBase: "old-main",
			promotionSourceSha: sourceSha,
			validationRuns: [{ ...successfulRun, conclusion: null, status: "pending" }],
		});
	}, /PROMOTION_SOURCE_UNVALIDATED/u);
	assert.equal(hasSuccessfulDevelopValidation([{ ...successfulRun, event: "pull_request" }], sourceSha), false);
	assert.equal(hasSuccessfulDevelopValidation([{ ...successfulRun, head_sha: "other-head" }], sourceSha), false);
});

test("uses the validated promotion base only for diff-scoped policy guards", function _ProtectsPromotionWiring()
{
	const workflow = _Workflow();
	assert.match(workflow, /guard_base: \$\{\{ steps\.guard-base\.outputs\.guard_base \}\}/u);
	assert.match(workflow, /run: node scripts\/promotion-guard-base\.mjs/u);
	assert.match(workflow, /GUARD_BASE: \$\{\{ needs\.prepare\.outputs\.guard_base \}\}/u);
	assert.match(workflow, /agent-style-check\.sh --diff "\$GUARD_BASE"/u);
	assert.match(workflow, /check:module-growth -- --diff "\$GUARD_BASE"/u);
	assert.match(workflow, /check:release-versioning -- --base "\$GUARD_BASE"/u);
	assert.match(workflow, /check:prisma-boundaries -- --diff "\$GUARD_BASE"/u);
	assert.match(workflow, /npx nx affected -t build test lint/u);
});
