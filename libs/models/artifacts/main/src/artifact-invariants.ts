import type { Artifact, ArtifactContentReference, ArtifactRevision, ArtifactRevisionReference, SkillRevision } from "./artifact.types.js";

/** Canonical lowercase SHA-256 content-address pattern. */
export const ___SHA256_CONTENT_ADDRESS_PATTERN = /^sha256:[a-f0-9]{64}$/;

/** Determine whether an unknown value is a record with inspectable fields. */
function _isRecord(value: unknown): value is Record<string, unknown>
{
	return typeof value === "object" && value !== null;
}

/** Determine whether a value is a non-empty identifier or label. */
function _isNonBlank(value: unknown): value is string
{
	return typeof value === "string" && value.trim().length > 0;
}

/** Determine whether a value is a canonical ISO-8601 timestamp. */
function _isCanonicalTimestamp(value: unknown): value is string
{
	if (typeof value !== "string")
	{
		return false;
	}

	const timestamp = Date.parse(value);
	return Number.isFinite(timestamp) && new Date(timestamp).toISOString() === value;
}

/** Determine whether a value is a supported product artifact kind. */
function _isArtifactKind(value: unknown): boolean
{
	return value === "document" || value === "generated" || value === "skill" || value === "upload";
}

/** Determine whether a value is a canonical SHA-256 content address. */
export function ___IsSha256ContentAddress(value: unknown): value is string
{
	return typeof value === "string" && ___SHA256_CONTENT_ADDRESS_PATTERN.test(value);
}

/** Determine whether immutable artifact content metadata is internally valid. */
export function ___IsArtifactContentReference(value: unknown): value is ArtifactContentReference
{
	return _isRecord(value)
		&& ___IsSha256ContentAddress(value["contentAddress"])
		&& Number.isSafeInteger(value["byteLength"])
		&& typeof value["byteLength"] === "number"
		&& value["byteLength"] >= 0
		&& _isNonBlank(value["mediaType"])
		&& value["mediaType"].includes("/");
}

/** Determine whether a logical artifact satisfies the target model invariants. */
export function ___IsArtifact(value: unknown): value is Artifact
{
	return _isRecord(value)
		&& _isNonBlank(value["id"])
		&& _isNonBlank(value["ownerPrincipalId"])
		&& _isArtifactKind(value["kind"])
		&& (value["currentRevision"] === null || (___IsArtifactRevisionReference(value["currentRevision"]) && value["currentRevision"].artifactId === value["id"]))
		&& _isCanonicalTimestamp(value["createdAt"]);
}

/** Determine whether a storage-neutral artifact revision reference pins immutable content. */
export function ___IsArtifactRevisionReference(value: unknown): value is ArtifactRevisionReference
{
	return _isRecord(value)
		&& _isNonBlank(value["artifactId"])
		&& _isNonBlank(value["revisionId"])
		&& ___IsSha256ContentAddress(value["contentAddress"]);
}

/** Determine whether an immutable artifact revision is content-addressed and well formed. */
export function ___IsArtifactRevision(value: unknown): value is ArtifactRevision
{
	if (!_isRecord(value) || !Array.isArray(value["parentRevisionIds"]))
	{
		return false;
	}

	const uniqueParents = new Set(value["parentRevisionIds"]);
	return _isNonBlank(value["id"])
		&& _isNonBlank(value["artifactId"])
		&& ___IsArtifactContentReference(value["content"])
		&& value["parentRevisionIds"].every(_isNonBlank)
		&& uniqueParents.size === value["parentRevisionIds"].length
		&& !uniqueParents.has(value["id"])
		&& _isCanonicalTimestamp(value["createdAt"]);
}

/** Determine whether an immutable skill revision pins one content-addressed bundle revision. */
export function ___IsSkillRevision(value: unknown): value is SkillRevision
{
	return _isRecord(value)
		&& _isRecord(value["bundle"])
		&& _isNonBlank(value["id"])
		&& _isNonBlank(value["skillId"])
		&& ___IsArtifactRevisionReference(value["bundle"])
		&& _isCanonicalTimestamp(value["createdAt"]);
}

/** Determine whether a skill bundle reference matches the canonical artifact revision exactly. */
export function ___SkillRevisionMatchesArtifactRevision(skill: SkillRevision, artifact: ArtifactRevision): boolean
{
	return ___IsSkillRevision(skill)
		&& ___IsArtifactRevision(artifact)
		&& skill.bundle.artifactId === artifact.artifactId
		&& skill.bundle.revisionId === artifact.id
		&& skill.bundle.contentAddress === artifact.content.contentAddress;
}
