import type { PersonaDraftInterviewAnswer, PersonaDraftSelectedTemplate, PersonaDraftTemplateCandidate, PersonaDraftTemplateSelectionRule, PersonaDraftTemplateSource } from "./persona-draft-persistence.types.js";

/**
 * Select a reviewed template rule that the approval trigger will independently enforce.
 * Templates must retain Prisma's database-supplied identifier/version order; an equal-priority
 * ambiguity inside the winning template fails closed because JSON rule IDs cannot be delegate-sorted.
 */
export function _SelectPersonaDraftTemplate(templates: readonly PersonaDraftTemplateSource[], answers: readonly PersonaDraftInterviewAnswer[]): PersonaDraftSelectedTemplate | null
{
	// 1. Parse and match every rule while preserving the database's template/version order.
	const answersByQuestion = new Map(answers.map(function _byQuestion(answer) { return [answer.questionId, answer]; }));
	const candidates: PersonaDraftTemplateCandidate[] = [];
	for (const template of templates)
	{
		const rules = _selectionRules(template.selectionRules);
		if (rules === null) return null;
		for (const rule of rules)
		{
			const selectionAnswerIds = _matchingAnswerIds(rule, answers, answersByQuestion);
			if (selectionAnswerIds === null) continue;
			candidates.push({ templateId: template.id, templateVersion: template.version, templateDigest: template.digest, content: template.content, selectionRuleId: rule.id, selectionAnswerIds, priority: rule.priority });
		}
	}

	// 2. Keep only the highest priority so the first candidate retains database ordering authority.
	const highestPriority = candidates.reduce<number | null>(function _highestPriority(highest, candidate) { return highest === null || candidate.priority > highest ? candidate.priority : highest; }, null);
	if (highestPriority === null) return null;
	const highestCandidates = candidates.filter(function _atHighestPriority(candidate) { return candidate.priority === highestPriority; });
	const winningTemplate = highestCandidates[0];
	if (winningTemplate === undefined) return null;

	// 3. Refuse the one tie-break Prisma cannot delegate instead of guessing with JavaScript collation.
	const winningRules = highestCandidates.filter(function _sameTemplate(candidate) { return candidate.templateId === winningTemplate.templateId && candidate.templateVersion === winningTemplate.templateVersion; });
	if (winningRules.length !== 1) return null;
	const winner = winningRules[0];
	return winner === undefined ? null : { templateId: winner.templateId, templateVersion: winner.templateVersion, templateDigest: winner.templateDigest, content: winner.content, selectionRuleId: winner.selectionRuleId, selectionAnswerIds: winner.selectionAnswerIds };
}

/** Parse every database-validated rule again at the untyped Prisma JSON edge. */
function _selectionRules(value: unknown): readonly PersonaDraftTemplateSelectionRule[] | null
{
	if (!Array.isArray(value) || value.length === 0) return null;
	const rules: PersonaDraftTemplateSelectionRule[] = [];
	for (const item of value)
	{
		const rule = _selectionRule(item);
		if (rule === null) return null;
		rules.push(rule);
	}
	return rules;
}

/** Parse one exact-answer selection rule without trusting its JSON representation. */
function _selectionRule(value: unknown): PersonaDraftTemplateSelectionRule | null
{
	const rule = _record(value);
	if (rule === null || typeof rule["id"] !== "string" || !rule["id"].trim()) return null;
	const priority = _priority(rule["priority"]);
	const answerValues = _record(rule["answers"]);
	if (priority === null || answerValues === null) return null;
	const answers: Record<string, string> = {};
	for (const [questionId, answer] of Object.entries(answerValues))
	{
		if (!questionId || typeof answer !== "string") return null;
		answers[questionId] = answer;
	}
	return Object.keys(answers).length === 0 ? null : { id: rule["id"], priority, answers };
}

/** Return an object-like JSON value without accepting arrays or null. */
function _record(value: unknown): Record<string, unknown> | null
{
	return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

/** Parse the PostgreSQL INTEGER priority representation accepted by the baseline trigger. */
function _priority(value: unknown): number | null
{
	const parsed = typeof value === "string" && /^-?[0-9]+$/u.test(value) ? Number(value) : value;
	if (typeof parsed !== "number" || !Number.isInteger(parsed) || parsed < -2147483648 || parsed > 2147483647) return null;
	return parsed;
}

/** Return exact required answer identifiers in the database-supplied answer order. */
function _matchingAnswerIds(rule: PersonaDraftTemplateSelectionRule, answers: readonly PersonaDraftInterviewAnswer[], answersByQuestion: ReadonlyMap<string, PersonaDraftInterviewAnswer>): readonly string[] | null
{
	for (const [questionId, expectedValue] of Object.entries(rule.answers))
	{
		const answer = answersByQuestion.get(questionId);
		if (answer === undefined || answer.value !== expectedValue) return null;
	}
	const requiredQuestions = new Set(Object.keys(rule.answers));
	return answers.filter(function _isRequired(answer) { return requiredQuestions.has(answer.questionId); }).map(function _answerId(answer) { return answer.id; });
}
