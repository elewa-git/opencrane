import { describe, expect, it } from "vitest";

import { ___IsArtifact, ___IsArtifactRevision, ___IsSha256ContentAddress, ___IsSkillRevision, ___SkillRevisionMatchesArtifactRevision } from "../artifact-invariants.js";
import type { Artifact, ArtifactRevision, SkillRevision } from "../artifact.types.js";

const _DIGEST = `sha256:${"a".repeat(64)}`;

/** Build a valid immutable artifact revision for focused invariant tests. */
function _artifactRevision(): ArtifactRevision
{
	return {
		id: "revision-1",
		artifactId: "artifact-1",
		content: { contentAddress: _DIGEST, byteLength: 42, mediaType: "application/zip" },
		parentRevisionIds: [],
		createdAt: "2026-07-18T08:00:00.000Z",
	};
}

/** Build a valid skill revision that pins the canonical artifact revision. */
function _skillRevision(): SkillRevision
{
	return {
		id: "skill-revision-1",
		skillId: "skill-1",
		bundle: { artifactId: "artifact-1", revisionId: "revision-1", contentAddress: _DIGEST },
		createdAt: "2026-07-18T08:01:00.000Z",
	};
}

describe("artifact model invariants", function _suite()
{
	it("accepts only canonical lowercase SHA-256 content addresses", function _acceptsDigest()
	{
		expect(___IsSha256ContentAddress(_DIGEST)).toBe(true);
		expect(___IsSha256ContentAddress(`sha256:${"A".repeat(64)}`)).toBe(false);
		expect(___IsSha256ContentAddress(`sha256:${"a".repeat(63)}`)).toBe(false);
		expect(___IsSha256ContentAddress(`s3://${"a".repeat(64)}`)).toBe(false);
	});

	it("validates a storage-neutral logical artifact", function _validatesArtifact()
	{
		const artifact: Artifact = {
			id: "artifact-1",
			ownerPrincipalId: "user-1",
			kind: "document",
			currentRevision: { artifactId: "artifact-1", revisionId: "revision-1", contentAddress: _DIGEST },
			createdAt: "2026-07-18T08:00:00.000Z",
		};

		expect(___IsArtifact(artifact)).toBe(true);
		expect(___IsArtifact({ ...artifact, ownerPrincipalId: " " })).toBe(false);
		expect(___IsArtifact({ ...artifact, currentRevision: { ...artifact.currentRevision!, contentAddress: "invalid" } })).toBe(false);
		expect(___IsArtifact({ ...artifact, currentRevision: { ...artifact.currentRevision!, artifactId: "artifact-2" } })).toBe(false);
		expect(___IsArtifact({ ...artifact, createdAt: "18 July" })).toBe(false);
		expect(___IsArtifact(null)).toBe(false);
	});

	it("rejects mutable or ambiguous artifact revision metadata", function _rejectsInvalidRevision()
	{
		const revision = _artifactRevision();

		expect(___IsArtifactRevision(revision)).toBe(true);
		expect(___IsArtifactRevision({ ...revision, content: { ...revision.content, byteLength: -1 } })).toBe(false);
		expect(___IsArtifactRevision({ ...revision, parentRevisionIds: ["revision-0", "revision-0"] })).toBe(false);
		expect(___IsArtifactRevision({ ...revision, parentRevisionIds: [revision.id] })).toBe(false);
		expect(___IsArtifactRevision({ ...revision, content: { ...revision.content, mediaType: "zip" } })).toBe(false);
		expect(___IsArtifactRevision({ id: "incomplete" })).toBe(false);
	});

	it("requires a skill revision to pin the exact canonical bundle", function _pinsBundle()
	{
		const artifact = _artifactRevision();
		const skill = _skillRevision();

		expect(___IsSkillRevision(skill)).toBe(true);
		expect(___SkillRevisionMatchesArtifactRevision(skill, artifact)).toBe(true);
		expect(___SkillRevisionMatchesArtifactRevision({ ...skill, bundle: { ...skill.bundle, contentAddress: `sha256:${"b".repeat(64)}` } }, artifact)).toBe(false);
		expect(___SkillRevisionMatchesArtifactRevision({ ...skill, bundle: { ...skill.bundle, revisionId: "revision-2" } }, artifact)).toBe(false);
	});
});
