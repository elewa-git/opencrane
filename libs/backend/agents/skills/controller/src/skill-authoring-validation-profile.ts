import { __BuildGovernedSkillWorkloadJob, SkillWorkloadKinds } from "@opencrane/backend/agents/skills/k8s-launcher";
import type { SkillWorkloadJobProfile } from "@opencrane/backend/agents/skills/k8s-launcher";

/** Return whether a value is a plain object whose own keys can be validated. */
function _IsRecord(value: unknown): value is Readonly<Record<string, unknown>>
{
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Return whether an object contains exactly the expected own-property names. */
function _HasOnlyKeys(value: Readonly<Record<string, unknown>>, expected: readonly string[]): boolean
{
	return Object.keys(value).length === expected.length && expected.every(function _HasKey(key): boolean { return Object.prototype.hasOwnProperty.call(value, key); });
}

/** Rebuild a resource map with only CPU and memory quantities. */
function _ResourceMap(value: unknown): Readonly<Record<"cpu" | "memory", string>> | null
{
	if (!_IsRecord(value) || !_HasOnlyKeys(value, ["cpu", "memory"]) || typeof value["cpu"] !== "string" || typeof value["memory"] !== "string")
	{
		return null;
	}
	return { cpu: value["cpu"], memory: value["memory"] };
}

/** Validate the sole deployment-owned skill-authoring Job profile. */
export function __ValidateSkillAuthoringValidationProfile(value: unknown): SkillWorkloadJobProfile & { readonly kind: "authoring" }
{
	const keys = ["kind", "image", "imagePullPolicy", "serverNamespace", "namespace", "serviceAccountName", "capabilityTokenAudience", "bootstrapUrl", "capabilityTokenPath", "bootstrapReferencePath", "scratchSize", "activeDeadlineSeconds", "ttlSecondsAfterFinished", "resources"];
	if (!_IsRecord(value) || !_HasOnlyKeys(value, keys) || value["kind"] !== SkillWorkloadKinds.Authoring)
	{
		throw new Error("skill authoring profile must be one complete authoring object");
	}
	if (typeof value["image"] !== "string" || (value["imagePullPolicy"] !== "Always" && value["imagePullPolicy"] !== "IfNotPresent" && value["imagePullPolicy"] !== "Never") || typeof value["serverNamespace"] !== "string" || typeof value["namespace"] !== "string" || typeof value["serviceAccountName"] !== "string" || typeof value["capabilityTokenAudience"] !== "string" || typeof value["bootstrapUrl"] !== "string" || typeof value["capabilityTokenPath"] !== "string" || typeof value["bootstrapReferencePath"] !== "string" || typeof value["scratchSize"] !== "string" || typeof value["activeDeadlineSeconds"] !== "number" || typeof value["ttlSecondsAfterFinished"] !== "number")
	{
		throw new Error("skill authoring profile must be one complete bounded object");
	}
	const resources = value["resources"];
	if (!_IsRecord(resources) || !_HasOnlyKeys(resources, ["requests", "limits"]))
	{
		throw new Error("skill authoring profile must contain bounded resources");
	}
	const requests = _ResourceMap(resources["requests"]);
	const limits = _ResourceMap(resources["limits"]);
	if (requests === null || limits === null)
	{
		throw new Error("skill authoring profile must contain bounded resources");
	}
	const profile: SkillWorkloadJobProfile & { readonly kind: "authoring" } = { kind: "authoring", image: value["image"], imagePullPolicy: value["imagePullPolicy"], serverNamespace: value["serverNamespace"], namespace: value["namespace"], serviceAccountName: value["serviceAccountName"], capabilityTokenAudience: value["capabilityTokenAudience"], bootstrapUrl: value["bootstrapUrl"], capabilityTokenPath: value["capabilityTokenPath"], bootstrapReferencePath: value["bootstrapReferencePath"], scratchSize: value["scratchSize"], activeDeadlineSeconds: value["activeDeadlineSeconds"], ttlSecondsAfterFinished: value["ttlSecondsAfterFinished"], resources: { requests, limits } };
	__BuildGovernedSkillWorkloadJob({ jobId: "profile-validation", siloId: "profile-validation", namespace: profile.namespace, capabilityReference: `skill-bootstrap-v1_${"0".repeat(64)}` }, profile);
	return profile;
}
