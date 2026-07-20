import { ___IsSha256ContentAddress } from "@opencrane/models/artifacts";

import type { PublishSkillRevisionCommand, PublishSkillRevisionResult, SkillAuthorityRepository } from "./skill-publication.types.js";

/** Publishes one reviewed, signed SkillRevision backed by exact ArtifactStore content. */
export async function __PublishSkillRevision(repository: SkillAuthorityRepository, command: PublishSkillRevisionCommand): Promise<PublishSkillRevisionResult>
{
	// 1. Require complete review evidence and exact immutable artifact coordinates.
	const evidenceIsComplete = command.evidence.signature.trim()
		&& command.evidence.signerKeyId.trim()
		&& command.evidence.testReport["passed"] === true
		&& command.evidence.scanResult["passed"] === true;
	if (!command.skillId.trim() || !command.skillRevisionId.trim() || !command.artifactRevisionId.trim() || !___IsSha256ContentAddress(command.artifactContentAddress) || !command.reviewedBy.trim() || !Number.isFinite(Date.parse(command.publishedAt)) || !evidenceIsComplete)
	{
		return { outcome: "denied", reason: "invalid_command" };
	}

	// 2. Verify the revision is under review and still pins a published ArtifactRevision.
	const snapshot = await repository.getPublicationSnapshot(command);
	if (snapshot === null) return { outcome: "denied", reason: "not_found" };
	if (snapshot.state !== "review") return { outcome: "denied", reason: "not_in_review" };
	if (!snapshot.artifactPublished) return { outcome: "denied", reason: "artifact_unpublished" };
	if (snapshot.artifactContentAddress !== command.artifactContentAddress) return { outcome: "denied", reason: "artifact_mismatch" };

	// 3. Recheck revision and artifact authority while publication and current-pointer update commit.
	const result = await repository.publishAtomically(command);
	return result.status === "published" ? { outcome: "published" } : { outcome: "denied", reason: result.status === "not_found" ? "not_found" : "conflict" };
}
