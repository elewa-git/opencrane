import type { Prisma } from "@prisma/client";

import type { PersonaDraftTemplateSelection, PersonaDraftTemplateSelectorRepository } from "./persona-draft-template-selector.types.js";
import { _ParsePersonaDraftTemplateRules } from "./persona-draft-template-selector.validator.js";

/** Prisma read adapter that deterministically selects reviewed SOUL source evidence without raw SQL. */
export class PrismaPersonaDraftTemplateSelectorRepository implements PersonaDraftTemplateSelectorRepository
{
	/** Transaction-scoped ORM client supplied only by the persona unit of work. */
	private readonly transaction: Prisma.TransactionClient;

	/** Binds template selection and answer evidence to one transaction snapshot. */
	constructor(transaction: Prisma.TransactionClient)
	{
		this.transaction = transaction;
	}

	/** Select the highest-priority match while preserving Prisma's template id/version ordering for ties. */
	async select(interviewId: string): Promise<PersonaDraftTemplateSelection | null>
	{
		const [templates, answers] = await Promise.all([
			this.transaction.personaSoulTemplate.findMany({ select: { id: true, version: true, digest: true, content: true, selectionRules: true }, orderBy: [{ id: "asc" }, { version: "desc" }] }),
			this.transaction.personaInterviewAnswer.findMany({ where: { interviewId }, select: { id: true, questionId: true, value: true }, orderBy: { id: "asc" } }),
		]);
		const answersByQuestion = new Map(answers.map(function _toAnswerEntry(answer) { return [answer.questionId, answer]; }));
		let selected: PersonaDraftTemplateCandidate | null = null;

		// Prisma owns the template-id/version ordering. The database rejects duplicate priorities within
		// one template, so replacing only on a strictly higher priority preserves every reachable SQL tie.
		for (const template of templates)
		{
			const rules = _ParsePersonaDraftTemplateRules(template.selectionRules);
			if (rules === null) return null;
			for (const rule of rules)
			{
				const matchedAnswers = _MatchedAnswers(rule.answers, answersByQuestion);
				if (matchedAnswers === null) continue;
				if (selected === null || rule.priority > selected.priority)
				{
					selected = { templateId: template.id, templateVersion: template.version, templateDigest: template.digest, content: template.content, selectionRuleId: rule.id, selectionAnswerIds: matchedAnswers.map(function _toId(answer) { return answer.id; }).sort(), priority: rule.priority };
				}
			}
		}

		if (selected === null) return null;
		const { priority: _priority, ...selection } = selected;
		return selection;
	}
}

/** Internal selected-template candidate retaining priority only until deterministic ordering completes. */
interface PersonaDraftTemplateCandidate extends PersonaDraftTemplateSelection
{
	/** Reviewed rule priority used before durable identity tie breakers. */
	readonly priority: number;
}

/** Return all exact matching persisted answers, or null when one required answer does not match. */
function _MatchedAnswers(ruleAnswers: Readonly<Record<string, string>>, answers: ReadonlyMap<string, { readonly id: string; readonly value: string }>): readonly { readonly id: string; readonly value: string }[] | null
{
	const matched = Object.entries(ruleAnswers).map(function _matchingAnswer(entry) { const answer = answers.get(entry[0]); return answer?.value === entry[1] ? answer : null; });
	return matched.every(function _isMatched(answer) { return answer !== null; }) ? matched as readonly { readonly id: string; readonly value: string }[] : null;
}
