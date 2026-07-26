import { describe, expect, it, vi } from "vitest";

import { __PublishSkillRevision } from "../skill-publication.js";

describe("skill publication", function ()
{
	it("publishes a reviewed revision pinned to exact ArtifactStore content", async function ()
	{
		const getPublicationSnapshot = vi.fn().mockResolvedValue({ skillState: "active", currentRevisionId: null, state: "review", artifactPublished: true, artifactContentAddress: `sha256:${"a".repeat(64)}`, evidence: { testReport: { passed: true }, scanResult: { passed: true }, signature: "signature", signerKeyId: "key-1" } });
		const publishAtomically = vi.fn().mockResolvedValue({ status: "published" });
		const result = await __PublishSkillRevision({ getPublicationSnapshot, publishAtomically }, { siloId: "silo-1", skillId: "skill-1", skillRevisionId: "skill-revision-1", artifactRevisionId: "artifact-revision-1", artifactContentAddress: `sha256:${"a".repeat(64)}`, reviewedBy: "user-1", publishedAt: "2026-07-18T09:00:00.000Z" });
		expect(result).toEqual({ outcome: "published" });
		expect(publishAtomically).toHaveBeenCalledOnce();
	});

	it("rejects an artifact digest mismatch", async function ()
	{
		const getPublicationSnapshot = vi.fn().mockResolvedValue({ skillState: "active", currentRevisionId: null, state: "review", artifactPublished: true, artifactContentAddress: `sha256:${"b".repeat(64)}`, evidence: { testReport: { passed: true }, scanResult: { passed: true }, signature: "signature", signerKeyId: "key-1" } });
		const publishAtomically = vi.fn();
		const result = await __PublishSkillRevision({ getPublicationSnapshot, publishAtomically }, { siloId: "silo-1", skillId: "skill-1", skillRevisionId: "skill-revision-1", artifactRevisionId: "artifact-revision-1", artifactContentAddress: `sha256:${"a".repeat(64)}`, reviewedBy: "user-1", publishedAt: "2026-07-18T09:00:00.000Z" });
		expect(result).toEqual({ outcome: "denied", reason: "artifact_mismatch" });
		expect(publishAtomically).not.toHaveBeenCalled();
	});

	it("denies publication when the isolated review job has not recorded complete evidence", async function _RequiresStoredEvidence()
	{
		const getPublicationSnapshot = vi.fn().mockResolvedValue({ skillState: "active", currentRevisionId: null, state: "review", artifactPublished: true, artifactContentAddress: `sha256:${"a".repeat(64)}`, evidence: null });
		const publishAtomically = vi.fn();
		const result = await __PublishSkillRevision({ getPublicationSnapshot, publishAtomically }, { siloId: "silo-1", skillId: "skill-1", skillRevisionId: "skill-revision-1", artifactRevisionId: "artifact-revision-1", artifactContentAddress: `sha256:${"a".repeat(64)}`, reviewedBy: "user-1", publishedAt: "2026-07-18T09:00:00.000Z" });
		expect(result).toEqual({ outcome: "denied", reason: "review_evidence_missing" });
		expect(publishAtomically).not.toHaveBeenCalled();
	});

	it("denies a retired skill before its reviewed revision can publish", async function _RejectsRetiredSkill()
	{
		const getPublicationSnapshot = vi.fn().mockResolvedValue({ skillState: "retired", currentRevisionId: null, state: "review", artifactPublished: true, artifactContentAddress: `sha256:${"a".repeat(64)}`, evidence: { testReport: { passed: true }, scanResult: { passed: true }, signature: "signature", signerKeyId: "key-1" } });
		const publishAtomically = vi.fn();
		const result = await __PublishSkillRevision({ getPublicationSnapshot, publishAtomically }, { siloId: "silo-1", skillId: "skill-1", skillRevisionId: "skill-revision-1", artifactRevisionId: "artifact-revision-1", artifactContentAddress: `sha256:${"a".repeat(64)}`, reviewedBy: "user-1", publishedAt: "2026-07-18T09:00:00.000Z" });
		expect(result).toEqual({ outcome: "denied", reason: "skill_retired" });
		expect(publishAtomically).not.toHaveBeenCalled();
	});
});
