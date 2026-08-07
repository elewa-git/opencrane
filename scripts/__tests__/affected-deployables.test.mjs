import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { selectAffectedDeployables, selectApiContractChanged, selectForcedContainerProjects, selectGuardInputsChanged } from "../affected-deployables.core.mjs";

/** Reads the stable selector fixture. */
function _Fixture()
{
	const path = fileURLToPath(new URL("./fixtures/affected-deployables/selection.json", import.meta.url));
	return JSON.parse(readFileSync(path, "utf8"));
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

test("uses all affected projects for contract verification and changed files for guard fixtures", function _SelectsPipelineInputs()
{
	const fixture = _Fixture();
	assert.equal(selectApiContractChanged(fixture.affectedProjects), true);
	assert.equal(selectGuardInputsChanged(fixture.changedFiles), true);
	assert.equal(selectApiContractChanged(["skill-authoring"]), false);
	assert.equal(selectGuardInputsChanged(["apps/skill-authoring/src/authoring_worker.py"]), false);
});
