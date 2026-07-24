import type { CreatePersonaDraftCommand, CreatePersonaDraftResult, PersonaDraftRepository } from "./persona-draft-authority.types.js";

/** Create one immutable, reviewable persona draft from completed onboarding evidence. */
export async function __CreatePersonaDraft(repository: PersonaDraftRepository, command: CreatePersonaDraftCommand): Promise<CreatePersonaDraftResult>
{
	// 1. Reject malformed owner and evidence coordinates before the repository can read a broader scope.
	if (!_isValidCommand(command)) return { outcome: "denied", reason: "invalid_command" };

	// 2. Delegate all template, revision, and provenance derivation to the one atomic persistence authority.
	const result = await repository.createAtomically(command);
	return result.status === "created" ? { outcome: "created", personaRevisionId: result.personaRevisionId } : { outcome: "denied", reason: result.status };
}

/** Return whether a draft request contains closed, user-reviewable insight evidence. */
function _isValidCommand(command: CreatePersonaDraftCommand): boolean
{
	if (!command.siloId.trim() || !command.userId.trim() || !command.personaProfileId.trim() || !command.interviewId.trim() || !Number.isFinite(Date.parse(command.authoredAt)) || command.insights.length < 3 || command.insights.length > 5)
	{
		return false;
	}
	const answerIds = new Set<string>();
	return command.insights.every(function _isValidInsight(insight)
	{
		if (!insight.answerId.trim() || !insight.statement.trim() || insight.statement.length > 4_000 || answerIds.has(insight.answerId)) return false;
		answerIds.add(insight.answerId);
		return true;
	});
}
