import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
	selectAffectedDeployables,
	selectApiContractChanged,
	selectDevelopSmokeImages,
	selectDevelopSmokeInputsChanged,
	selectDevelopSmokeProjects,
	selectDevelopSmokeStorageMode,
	selectForcedContainerProjects,
	selectGuardInputsChanged,
	selectImageSmokeProjects,
} from "../affected-deployables.core.mjs";
import { hasCompleteDevelopSmokeBaseline } from "../develop-smoke-baseline.core.mjs";
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

/** Reads the remote-only current-silo smoke implementation. */
function _DevelopSmoke()
{
	const path = fileURLToPath(new URL("../../apps/_infra/deploy-k8s/platform/tests/develop-smoke.sh", import.meta.url));
	return readFileSync(path, "utf8");
}

/** Reads the storage owner sourced by the current-silo smoke test. */
function _DevelopSmokeImageStorage()
{
	const path = fileURLToPath(new URL("../../apps/_infra/deploy-k8s/platform/tests/develop-smoke-image-storage.sh", import.meta.url));
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

test("preserves an app-owned Docker target in the publication matrix", function _SelectsDockerTarget()
{
	const project = {
		name: "opencrane-prisma-migrator",
		targets: { container: { metadata: { release: { image: "opencrane-prisma-migrator", dockerfile: "apps/opencrane/deploy/Dockerfile", target: "migration" } } } },
	};
	assert.deepEqual(selectAffectedDeployables([project]), [{
		project: "opencrane-prisma-migrator",
		image: "opencrane-prisma-migrator",
		dockerfile: "apps/opencrane/deploy/Dockerfile",
		target: "migration",
	}]);
	assert.match(_Workflow(), /target: \$\{\{ matrix\.target \}\}/u);
});

test("selects the complete current-silo image set from app-owned container metadata", function _SelectsDevelopSmokeImages()
{
	const projects = [
		["opencrane", "opencrane-server", "apps/opencrane/deploy/Dockerfile"],
		["opencrane-ui", "opencrane-ui", "apps/opencrane-ui/deploy/Dockerfile"],
		["channel-proxy", "opencrane-channel-proxy", "apps/channel-proxy/deploy/Dockerfile"],
		["cognee", "opencrane-cognee", "apps/_infra/cognee/deploy/Dockerfile"],
		["memory-gateway", "opencrane-memory-gateway", "apps/memory-gateway/deploy/Dockerfile"],
		["artifact-service", "opencrane-artifact-service", "apps/artifact-service/deploy/Dockerfile"],
	].map(function _Project([name, image, dockerfile]) {
		return { name, targets: { container: { metadata: { release: { image, dockerfile } } } } };
	});
	assert.deepEqual(selectDevelopSmokeImages(projects), [
		{ project: "artifact-service", image: "opencrane-artifact-service", dockerfile: "apps/artifact-service/deploy/Dockerfile" },
		{ project: "channel-proxy", image: "opencrane-channel-proxy", dockerfile: "apps/channel-proxy/deploy/Dockerfile" },
		{ project: "cognee", image: "opencrane-cognee", dockerfile: "apps/_infra/cognee/deploy/Dockerfile" },
		{ project: "memory-gateway", image: "opencrane-memory-gateway", dockerfile: "apps/memory-gateway/deploy/Dockerfile" },
		{ project: "opencrane", image: "opencrane-server", dockerfile: "apps/opencrane/deploy/Dockerfile" },
		{ project: "opencrane-ui", image: "opencrane-ui", dockerfile: "apps/opencrane-ui/deploy/Dockerfile" },
	]);
	assert.throws(
		function _MissingOwner() { selectDevelopSmokeImages(projects.filter(function _WithoutServer(project) { return project.name !== "opencrane"; })); },
		/current-silo smoke project 'opencrane' must own a container target/u,
	);
});

test("uses Nx affected container owners to select current-silo rebuilds", function _SelectsDevelopSmokeProjects()
{
	assert.deepEqual(
		selectDevelopSmokeProjects(["skill-authoring", "opencrane-ui", "cognee", "channel-proxy", "opencrane-ui"]),
		["channel-proxy", "cognee", "opencrane-ui"],
	);
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
	assert.deepEqual(selectForcedContainerProjects("all", ["skill-authoring", "opencrane", "skill-authoring"]), ["opencrane", "skill-authoring"]);
	assert.deepEqual(selectForcedContainerProjects("bootstrap"), ["channel-proxy", "memory-gateway"]);
	assert.deepEqual(selectForcedContainerProjects("artifact"), ["artifact-service"]);
	assert.deepEqual(selectForcedContainerProjects("qualification"), ["artifact-service", "channel-proxy", "cognee", "memory-gateway", "opencrane", "opencrane-ui", "postgres"]);
	assert.deepEqual(selectForcedContainerProjects("server"), ["opencrane"]);
	assert.deepEqual(selectForcedContainerProjects("ui"), ["opencrane-ui"]);
	assert.equal(selectForcedContainerProjects(""), null);
	assert.throws(function _UnknownForce() { selectForcedContainerProjects("everything"); }, /unsupported FORCE_DEPLOYABLES value: everything/u);
});

test("selects affected image smokes unless manual qualification expands to every owner", function _SelectsImageSmokes()
{
	const affected = ["skill-authoring", "skill-authoring"];
	const all = ["mcp-executor", "skill-authoring"];
	assert.deepEqual(selectImageSmokeProjects(affected, all, ""), [{ project: "skill-authoring" }]);
	assert.deepEqual(selectImageSmokeProjects(affected, all, "k3d"), [{ project: "skill-authoring" }]);
	const allProjects = [{ project: "mcp-executor" }, { project: "skill-authoring" }];
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

test("only classifies explicit non-deployment paths as safe current-silo inputs", function _SelectsDevelopSmokeInputs()
{
	assert.equal(selectDevelopSmokeInputsChanged(["website/guide.md", "docs/agents/infra.md"]), false);
	assert.equal(selectDevelopSmokeInputsChanged(["README.md", "plan.md"]), false);
	assert.equal(selectDevelopSmokeInputsChanged(["apps/opencrane/README.md"]), true);
	assert.equal(selectDevelopSmokeInputsChanged(["apps/_infra/deploy-k8s/templates/review-proof.md"]), true);
	assert.equal(selectDevelopSmokeInputsChanged(["apps/_infra/deploy-k8s/values.yaml"]), true);
	assert.equal(selectDevelopSmokeInputsChanged(["apps/opencrane/helm/templates/_deployment.tpl"]), true);
	assert.equal(selectDevelopSmokeInputsChanged(["apps/opencrane/deploy/Dockerfile"]), true);
	assert.equal(selectDevelopSmokeInputsChanged(["apps/agent-runtime/src/runtime.py"]), true);
	assert.equal(selectDevelopSmokeInputsChanged(["package-lock.json"]), true);
	assert.equal(selectDevelopSmokeInputsChanged(["scripts/affected-deployables.core.mjs"]), true);
	assert.equal(selectDevelopSmokeInputsChanged(["unclassified/new-input.xyz"]), true);
});

test("reuses only an exact-SHA baseline with a successful current-silo k3d job", function _SelectsBaselineReuse()
{
	const baseSha = "a".repeat(40);
	const qualifications = [{
		workflowPath: ".github/workflows/docker.yml",
		headSha: baseSha,
		runEvent: "workflow_dispatch",
		runStatus: "completed",
		runConclusion: "success",
		jobName: "k3d current-silo smoke test",
		jobStatus: "completed",
		jobConclusion: "success",
	}];
	const eligible = {
		eventName: "pull_request",
		baseSha,
		deploymentInputsChanged: false,
		affectedContainerProjects: [],
		qualifications,
	};
	assert.equal(hasCompleteDevelopSmokeBaseline(eligible), true);
	assert.equal(hasCompleteDevelopSmokeBaseline({ ...eligible, eventName: "push" }), false);
	assert.equal(hasCompleteDevelopSmokeBaseline({ ...eligible, baseSha: "short" }), false);
	assert.equal(hasCompleteDevelopSmokeBaseline({ ...eligible, deploymentInputsChanged: true }), false);
	assert.equal(hasCompleteDevelopSmokeBaseline({ ...eligible, affectedContainerProjects: ["skill-authoring"] }), false);
	assert.equal(hasCompleteDevelopSmokeBaseline({ ...eligible, qualifications: [] }), false);
	assert.equal(hasCompleteDevelopSmokeBaseline({
		...eligible,
		qualifications: [{ ...qualifications[0], runEvent: "pull_request" }],
	}), false);
	assert.equal(hasCompleteDevelopSmokeBaseline({
		...eligible,
		qualifications: [{ ...qualifications[0], jobConclusion: "skipped" }],
	}), false);
});

test("overlaps image preparation and keeps the fast direct k3d batch", function _ProtectsFastSmokeOrchestration()
{
	const smoke = _DevelopSmoke();
	const imageStorage = _DevelopSmokeImageStorage();
	assert.match(smoke, /_reset_smoke_storage[\s\S]*?_prepare_images &[\s\S]*?k3d cluster create "\$CLUSTER_NAME"/u);
	assert.match(smoke, /_prepare_images &[\s\S]*?IMAGE_PREPARATION_PID=\$!/u);
	assert.match(smoke, /if ! wait "\$IMAGE_PREPARATION_PID"/u);
	assert.match(smoke, /cert-manager jetstack\/cert-manager[\s\S]*?&[\s\S]*?CERT_MANAGER_INSTALL_PID=\$![\s\S]*?cnpg cnpg\/cloudnative-pg/u);
	assert.match(smoke, /if ! wait "\$CERT_MANAGER_INSTALL_PID"/u);
	assert.match(smoke, /docker buildx build --load/u);
	assert.match(smoke, /--cache-from "type=registry,ref=\$\{SMOKE_BUILD_CACHE\}:\$\{project\}"/u);
	assert.match(smoke, /--cache-to "type=registry,ref=\$\{SMOKE_BUILD_CACHE_EXPORT\}:\$\{project\},mode=max"/u);
	// The six image preparations must stay concurrent — serially they dominated the smoke.
	assert.match(smoke, /_prepare_image "\$project" "\$local_image" "\$remote_image" "\$dockerfile" \\\n\s+>"\$log_dir\/\$project\.log" 2>&1 &/u);
	assert.match(imageStorage, /k3d image import "\$\{SMOKE_IMAGES\[@\]\}" --cluster "\$CLUSTER_NAME" --mode direct/u);
	assert.match(imageStorage, /SMOKE_HOST_PROFILE" == "recommended"[\s\S]*?k3d image import "\$\{SMOKE_IMAGES\[@\]\}"/u);
});

test("executes the current-silo image storage contract", function _ExecutesImageStorageContract()
{
	const path = fileURLToPath(new URL("../../apps/_infra/deploy-k8s/platform/tests/develop-smoke-image-storage-contract.sh", import.meta.url));
	const output = execFileSync("bash", [path], { encoding: "utf8" });

	assert.match(output, /develop-smoke image storage contract: PASS/u);
});

test("keeps the storage expansion proof targeted while preserving protected qualification", function _SelectsStorageMode()
{
	assert.equal(selectDevelopSmokeStorageMode(["apps/opencrane/src/main.ts"], "pull_request", "refs/pull/1/merge", ""), "fast");
	assert.equal(selectDevelopSmokeStorageMode(["apps/postgres/helm/values.yaml"], "pull_request", "refs/pull/1/merge", ""), "full");
	assert.equal(selectDevelopSmokeStorageMode(["apps/_infra/deploy-k8s/platform/tests/develop-smoke.sh"], "pull_request", "refs/pull/1/merge", ""), "full");
	assert.equal(selectDevelopSmokeStorageMode(["apps/_infra/deploy-k8s/platform/tests/develop-smoke-image-storage.sh"], "pull_request", "refs/pull/1/merge", ""), "full");
	assert.equal(selectDevelopSmokeStorageMode([], "push", "refs/heads/develop", ""), "full");
	assert.equal(selectDevelopSmokeStorageMode([], "workflow_dispatch", "refs/heads/feature", "k3d"), "full");
});

test("keeps heavyweight remote qualification ahead of image publication", function _ProtectsHeavyQualificationWiring()
{
	const workflow = _Workflow();
	const developSmokeJob = workflow.match(/\n  develop_smoke:[\s\S]*?\n  image_smoke:/u);
	const imageSmokeJob = workflow.match(/\n  image_smoke:[\s\S]*?\n  build-and-push:/u);
	const publishSmokeImagesJob = workflow.match(/\n  publish-develop-smoke-images:[\s\S]*$/u);
	assert.ok(developSmokeJob, "develop smoke job must remain independently inspectable");
	assert.ok(imageSmokeJob, "image smoke job must remain independently inspectable");
	assert.ok(publishSmokeImagesJob, "develop must publish a complete immutable smoke image set");
	assert.match(workflow, /heavy_qualification:[\s\S]*?- image-smoke[\s\S]*?- k3d[\s\S]*?- all/u);
	assert.match(workflow, /publish_deployables:[\s\S]*?- all[\s\S]*?- qualification/u);
	assert.match(workflow, /validation_override_sha:[\s\S]*?required: false[\s\S]*?type: string[\s\S]*?default: ""/u);
	assert.match(workflow, /github\.ref == 'refs\/heads\/develop'/u);
	assert.match(workflow, /run: \.\/apps\/_infra\/deploy-k8s\/platform\/tests\/develop-smoke\.sh/u);
	assert.match(workflow, /inputs\.heavy_qualification == 'k3d'/u);
	assert.match(workflow, /inputs\.heavy_qualification == 'all'/u);
	assert.match(workflow, /needs: \[prepare, test, database, api_contract, storybook_visual, develop_smoke, image_smoke\]/u);
	assert.match(developSmokeJob[0], /needs: prepare/u);
	assert.match(developSmokeJob[0], /needs\.prepare\.outputs\.develop_smoke_can_skip != 'true'/u);
	assert.match(workflow, /continue-on-error: true[\s\S]*?run: node scripts\/develop-smoke-baseline\.mjs/u);
	assert.match(imageSmokeJob[0], /needs: prepare/u);
	assert.match(workflow, /needs\.develop_smoke\.result == 'success'/u);
	assert.match(workflow, /needs\.image_smoke\.result == 'success'/u);
	assert.match(workflow, /inputs\.validation_override_sha != ''[\s\S]*?inputs\.validation_override_sha == github\.sha/u);
	assert.match(
		workflow,
		/name: Publish the manifest-bound CloudNativePG operand tag[\s\S]*?\.database\.operandImage[\s\S]*?docker buildx imagetools create --tag/u,
	);
	assert.match(workflow, /K3D_LINUX_AMD64_SHA256: [0-9a-f]{64}/u);
	assert.match(workflow, /sha256sum --check/u);
	assert.match(developSmokeJob[0], /uses: actions\/setup-node@v6/u);
	assert.match(
		developSmokeJob[0],
		/key: node-modules-\$\{\{ runner\.os \}\}-node24-\$\{\{ hashFiles\('package-lock\.json'\) \}\}/u,
	);
	assert.match(developSmokeJob[0], /name: Install deploy validation dependencies[\s\S]*?run: npm ci/u);
	assert.match(developSmokeJob[0], /SMOKE_AFFECTED_PROJECTS: \$\{\{ needs\.prepare\.outputs\.develop_smoke_projects \}\}/u);
	assert.match(developSmokeJob[0], /SMOKE_BASE_SHA: \$\{\{ needs\.prepare\.outputs\.nx_base \}\}/u);
	assert.match(developSmokeJob[0], /SMOKE_STORAGE_MODE: \$\{\{ needs\.prepare\.outputs\.develop_smoke_storage_mode \}\}/u);
	assert.match(developSmokeJob[0], /SMOKE_BUILD_CACHE: \$\{\{ env\.REGISTRY \}\}\/\$\{\{ github\.repository_owner \}\}\/\$\{\{ env\.BUILD_CACHE_IMAGE \}\}/u);
	assert.match(developSmokeJob[0], /SMOKE_BUILD_CACHE_EXPORT: /u);
	assert.match(imageSmokeJob[0], /matrix: \$\{\{ fromJSON\(needs\.prepare\.outputs\.image_smokes\) \}\}/u);
	assert.match(
		imageSmokeJob[0],
		/IMAGE_SMOKE_PROJECT: \$\{\{ matrix\.project \}\}[\s\S]*?npx nx run "\$IMAGE_SMOKE_PROJECT:image-smoke"/u,
	);
	assert.match(
		workflow,
		/type=registry,ref=\$\{\{ env\.REGISTRY \}\}\/\$\{\{ github\.repository_owner \}\}\/\$\{\{ env\.BUILD_CACHE_IMAGE \}\}:\$\{\{ matrix\.project \}\}/u,
	);
	assert.match(workflow, /type=raw,value=sha-\$\{\{ github\.sha \}\}/u);
	assert.match(publishSmokeImagesJob[0], /github\.ref == 'refs\/heads\/develop'/u);
	assert.match(publishSmokeImagesJob[0], /matrix: \$\{\{ fromJSON\(needs\.prepare\.outputs\.develop_smoke_images\) \}\}/u);
	assert.match(publishSmokeImagesJob[0], /current_ref="\$\{REMOTE_REPOSITORY\}:sha-\$\{GITHUB_SHA\}"/u);
	assert.match(publishSmokeImagesJob[0], /docker buildx imagetools create --tag "\$CURRENT_REF" "\$BASE_REF"/u);
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
	assert.match(workflow, /check:release-versioning/u);
	assert.match(workflow, /check:prisma-boundaries -- --diff "\$GUARD_BASE"/u);
	assert.match(workflow, /npx nx affected -t build test lint/u);
});
