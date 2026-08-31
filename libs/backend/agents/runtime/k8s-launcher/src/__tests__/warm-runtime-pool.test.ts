import type { V1Pod } from "@kubernetes/client-node";
import { describe, expect, it } from "vitest";

import { __AssertWarmRuntimePoolProfile, __WarmRuntimeGenericPodSelector, __WarmRuntimePodCandidate } from "../warm-runtime-pool";
import type { WarmRuntimePoolProfile } from "../warm-runtime-pool.types";

/** Returns one fixed personal warm-pool profile. */
function _Profile(): WarmRuntimePoolProfile
{
	return { namespace: "opencrane-runtime", deploymentName: "personal-warm", serviceAccountName: "warm-runtime", genericProfile: "generic", claimedProfile: "personal", image: `ghcr.io/elewa/opencrane-agent-runtime@sha256:${"a".repeat(64)}`, imagePullPolicy: "IfNotPresent", bindingPort: 8090, genericIdleSeconds: 900, scratchSize: "1Gi", resources: { requests: { cpu: "100m", memory: "128Mi" }, limits: { cpu: "1", memory: "1Gi" } } };
}

/** Returns one running Pod owned through the allowed ReplicaSet. */
function _Pod(): V1Pod
{
	return { metadata: { name: "personal-warm-abc", namespace: "opencrane-runtime", uid: "pod-uid", resourceVersion: "12", labels: { "opencrane.ai/warm-runtime-pool": "personal-warm", "opencrane.ai/warm-runtime-profile": "generic" }, ownerReferences: [{ apiVersion: "apps/v1", kind: "ReplicaSet", name: "personal-warm-aaa", uid: "rs-uid", controller: true }] }, spec: { serviceAccountName: "warm-runtime", containers: [] }, status: { phase: "Running", podIP: "10.42.0.10" } };
}

describe("warm runtime pool contract", function _WarmRuntimePoolContract()
{
	it("selects and validates only a generic Pod from the exact pool owner", function _AcceptsCandidate()
	{
		const profile = _Profile();
		expect(function _Validate(): void { __AssertWarmRuntimePoolProfile(profile); }).not.toThrow();
		expect(__WarmRuntimeGenericPodSelector(profile)).toBe("opencrane.ai/warm-runtime-pool=personal-warm,opencrane.ai/warm-runtime-profile=generic");
		expect(__WarmRuntimePodCandidate(_Pod(), profile, "deployment-uid", new Set(["rs-uid"]))).toEqual({ podName: "personal-warm-abc", podUid: "pod-uid", resourceVersion: "12", deploymentUid: "deployment-uid", podIp: "10.42.0.10" });
	});

	it("rejects a Pod from another ReplicaSet or an uploaded image profile", function _RejectsWrongClass()
	{
		expect(function _Owner(): void { __WarmRuntimePodCandidate(_Pod(), _Profile(), "deployment-uid", new Set(["other-rs"])); }).toThrow(/generic pool/);
		expect(function _Image(): void { __AssertWarmRuntimePoolProfile({ ..._Profile(), image: "uploaded-mcp:latest" }); }).toThrow(/immutable image/);
	});
});
