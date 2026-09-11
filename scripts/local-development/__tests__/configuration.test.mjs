import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

import { createLocalDevelopmentConfiguration } from "../configuration.mjs";

/** Escape one reviewed image coordinate before matching its YAML owner. */
function _Pattern(value)
{
	return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

test("Tier 2 operand images stay aligned with the current deployment profiles", function _OperandPins()
{
	const repositoryRoot = path.resolve(import.meta.dirname, "../../..");
	const configuration = createLocalDevelopmentConfiguration({ profile: "core" }, repositoryRoot, {});
	const deploymentValues = fs.readFileSync(path.join(repositoryRoot, "apps/_infra/deploy-k8s/values.yaml"), "utf8");
	const smokeValues = fs.readFileSync(path.join(repositoryRoot, "apps/_infra/deploy-k8s/platform/tests/develop-smoke-values.yaml"), "utf8");
	const [kurrentRepository, kurrentDigest] = configuration.kurrentImage.split("@");
	const [liteLLMTaggedRepository, liteLLMDigest] = configuration.liteLLMImage.split("@");
	const tagSeparator = liteLLMTaggedRepository.lastIndexOf(":");
	const liteLLMRepository = liteLLMTaggedRepository.slice(0, tagSeparator);
	const liteLLMTag = liteLLMTaggedRepository.slice(tagSeparator + 1);

	assert.match(deploymentValues, new RegExp(`repository: ${_Pattern(kurrentRepository)}`, "u"));
	assert.match(smokeValues, new RegExp(`digest: ${_Pattern(kurrentDigest)}`, "u"));
	assert.match(deploymentValues, new RegExp(`repository: ${_Pattern(liteLLMRepository)}`, "u"));
	assert.match(deploymentValues, new RegExp(`tag: ${_Pattern(liteLLMTag)}`, "u"));
	assert.match(liteLLMDigest, /^sha256:[a-f0-9]{64}$/u);
	assert.equal(configuration.liteLLMImage, "ghcr.io/berriai/litellm-non_root:main-v1.81.0-stable@sha256:39718a9cc9138c99ec812bcde24896411cf54502967a36b19897c539b796fdc7");
});
