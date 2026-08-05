import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { selectAffectedDeployables, selectApiContractChanged, selectDevelopSmokeRequired, selectGuardInputsChanged } from "../affected-deployables.core.mjs";

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

test("keeps the blocking smoke on develop and ahead of image publication", function _ProtectsDevelopSmokeWiring()
{
	const workflow = _Workflow();
	assert.match(workflow, /github\.ref == 'refs\/heads\/develop'/u);
	assert.match(workflow, /run: \.\/apps\/_infra\/deploy-k8s\/platform\/tests\/develop-smoke\.sh/u);
	assert.match(workflow, /needs: \[prepare, test, develop_smoke\]/u);
	assert.match(workflow, /needs\.develop_smoke\.result == 'success'/u);
	assert.match(workflow, /K3D_LINUX_AMD64_SHA256: [0-9a-f]{64}/u);
	assert.match(workflow, /sha256sum --check/u);
});
