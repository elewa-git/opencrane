import type { Prisma, PrismaClient } from "@prisma/client";

import type { PersonaDraftTemplateSelection, PersonaDraftTemplateSelectorRepository } from "./persona-draft-template-selector.types.js";

/** Prisma read adapter that deterministically selects reviewed SOUL source evidence without raw SQL. */
export class PrismaPersonaDraftTemplateSelector implements PersonaDraftTemplateSelectorRepository
{
	/** Select the matching template using priority desc, then template id asc, version desc, and rule id asc. */
	async select(client: PrismaClient | Prisma.TransactionClient, interviewId: string): Promise<PersonaDraftTemplateSelection | null>
	{
		const [templates, answers] = await Promise.all([
			client.personaSoulTemplate.findMany({ select: { id: true, version: true, digest: true, content: true, selectionRules: true }, orderBy: [{ id: "asc" }, { version: "desc" }] }),
			client.personaInterviewAnswer.findMany({ where: { interviewId }, select: { id: true, questionId: true, value: true }, orderBy: { id: "asc" } }),
		]);
		const answersByQuestion = new Map(answers.map(function _toAnswerEntry(answer) { return [answer.questionId, answer]; }));
		const candidates: PersonaDraftTemplateCandidate[] = [];

		for (const template of templates)
		{
			const rules = _SelectionRules(template.selectionRules);
			if (rules === null) return null;
			for (const rule of rules)
			{
				const matchedAnswers = _MatchedAnswers(rule.answers, answersByQuestion);
				if (matchedAnswers === null) continue;
				candidates.push({ templateId: template.id, templateVersion: template.version, templateDigest: template.digest, content: template.content, selectionRuleId: rule.id, selectionAnswerIds: matchedAnswers.map(function _toId(answer) { return answer.id; }).sort(), priority: rule.priority });
			}
		}

		candidates.sort(_CompareSelections);
		const selected = candidates[0];
		if (selected === undefined) return null;
		const { priority: _priority, ...selection } = selected;
		return selection;
	}
}

/** Parsed reviewed rule with only the fields the deterministic selector is allowed to interpret. */
interface PersonaDraftTemplateRule
{
	/** Stable rule identifier used as the last deterministic tie breaker. */
	readonly id: string;
	/** Higher priorities outrank lower priorities. */
	readonly priority: number;
	/** Exact question-to-answer values required by the rule. */
	readonly answers: Readonly<Record<string, string>>;
}

/** Internal selected-template candidate retaining priority only until deterministic ordering completes. */
interface PersonaDraftTemplateCandidate extends PersonaDraftTemplateSelection
{
	/** Reviewed rule priority used before durable identity tie breakers. */
	readonly priority: number;
}

/** Validate all persisted rule JSON before it can influence a draft; malformed source fails closed. */
function _SelectionRules(value: unknown): readonly PersonaDraftTemplateRule[] | null
{
	if (!Array.isArray(value)) return null;
	const rules = value.map(_SelectionRule);
	return rules.every(function _isRule(rule) { return rule !== null; }) ? rules as readonly PersonaDraftTemplateRule[] : null;
}

/** Parse one persisted rule according to the reviewed catalogue contract. */
function _SelectionRule(value: unknown): PersonaDraftTemplateRule | null
{
	if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
	const record = value as Record<string, unknown>;
	const priority = _Priority(record["priority"]);
	const answers = _Answers(record["answers"]);
	return typeof record["id"] === "string" && record["id"].trim() && priority !== null && answers !== null ? { id: record["id"], priority, answers } : null;
}

/** Parse the integer priority accepted by PostgreSQL's reviewed selection-rule expression. */
function _Priority(value: unknown): number | null
{
	const text = typeof value === "number" || typeof value === "string" ? String(value) : "";
	return /^-?\d+$/.test(text) ? Number(text) : null;
}

/** Parse exact string answer predicates without coercing malformed catalogue data. */
function _Answers(value: unknown): Readonly<Record<string, string>> | null
{
	if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
	return Object.entries(value).every(function _isString(entry) { return typeof entry[1] === "string"; }) ? value as Readonly<Record<string, string>> : null;
}

/** Return all exact matching persisted answers, or null when one required answer does not match. */
function _MatchedAnswers(ruleAnswers: Readonly<Record<string, string>>, answers: ReadonlyMap<string, { readonly id: string; readonly value: string }>): readonly { readonly id: string; readonly value: string }[] | null
{
	const matched = Object.entries(ruleAnswers).map(function _matchingAnswer(entry) { const answer = answers.get(entry[0]); return answer?.value === entry[1] ? answer : null; });
	return matched.every(function _isMatched(answer) { return answer !== null; }) ? matched as readonly { readonly id: string; readonly value: string }[] : null;
}

/** Preserve the reviewed SQL ordering for matching template candidates. */
function _CompareSelections(left: PersonaDraftTemplateCandidate, right: PersonaDraftTemplateCandidate): number
{
	return right.priority - left.priority || left.templateId.localeCompare(right.templateId) || right.templateVersion - left.templateVersion || left.selectionRuleId.localeCompare(right.selectionRuleId);
}
