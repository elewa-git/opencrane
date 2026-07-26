import type { RevokeSkillRevisionCommand, RevokeSkillRevisionResult, SkillRevocationRepository } from "./skill-publication.types.js";

/** Revokes one published SkillRevision for future admissions without altering frozen run inputs. */
export async function __RevokeSkillRevision(repository: SkillRevocationRepository, command: RevokeSkillRevisionCommand): Promise<RevokeSkillRevisionResult>
{
	// 1. Reject caller-controlled malformed coordinates before the persistence boundary can widen scope.
	if (!command.siloId.trim() || !command.skillId.trim() || !command.skillRevisionId.trim() || !Number.isFinite(Date.parse(command.revokedAt))) return { outcome: "denied", reason: "invalid_command" };

	// 2. Make the guarded published-to-revoked transition and clear only the matching live pointer.
	const result = await repository.revokeAtomically(command);
	return result.status === "revoked" ? { outcome: "revoked" } : { outcome: "denied", reason: result.status === "not_found" ? "not_found" : result.status === "conflict" ? "conflict" : "not_published" };
}
