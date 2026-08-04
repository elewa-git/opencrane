import { describe, expect, it } from "vitest";

import type { PersonaDraftInterviewAnswer, PersonaDraftTemplateSource } from "../persona-draft-persistence.types.js";
import { _SelectPersonaDraftTemplate } from "../persona-draft-template-selection.js";

/** Build one immutable interview answer for template-selection tests. */
function _Answer(id: string, questionId: string, value: string): PersonaDraftInterviewAnswer
{
	return { id, questionSetId: "onboarding", questionSetVersion: 1, questionId, value };
}

/** Build one reviewed template source around the supplied selection rules. */
function _Template(id: string, version: number, selectionRules: unknown): PersonaDraftTemplateSource
{
	return { id, version, digest: `sha256:${id}-${version}`, content: `Template ${id} ${version}`, selectionRules };
}

describe("_SelectPersonaDraftTemplate", function _DescribeSelectPersonaDraftTemplate()
{
	it("applies priority before the database-supplied template and version order", function _AppliesDeterministicOrdering()
	{
		const answers = [_Answer("answer-1", "question-1", "one"), _Answer("answer-2", "question-2", "two")];
		const templates = [
			_Template("0-lower-priority", 9, [{ id: "rule", priority: 19, answers: { "question-1": "one" } }]),
			_Template("a-template", 2, [{ id: "a-rule", priority: 20, answers: { "question-2": "two", "question-1": "one" } }]),
			_Template("a-template", 1, [{ id: "rule", priority: 20, answers: { "question-1": "one" } }]),
			_Template("b-template", 9, [{ id: "rule", priority: 20, answers: { "question-1": "one" } }]),
		];

		expect(_SelectPersonaDraftTemplate(templates, answers)).toEqual({ templateId: "a-template", templateVersion: 2, templateDigest: "sha256:a-template-2", content: "Template a-template 2", selectionRuleId: "a-rule", selectionAnswerIds: ["answer-1", "answer-2"] });
	});

	it("fails closed when the winning template has ambiguous equal-priority rules", function _RejectsAmbiguousRules()
	{
		const ambiguous = _Template("direct", 1, [{ id: "a-rule", priority: 20, answers: { "question-1": "one" } }, { id: "b-rule", priority: 20, answers: { "question-1": "one" } }]);

		expect(_SelectPersonaDraftTemplate([ambiguous], [_Answer("answer-1", "question-1", "one")])).toBeNull();
	});

	it("requires every exact answer named by a rule", function _RequiresExactAnswers()
	{
		const template = _Template("direct", 1, [{ id: "rule", priority: 20, answers: { "question-1": "one", "question-2": "two" } }]);

		expect(_SelectPersonaDraftTemplate([template], [_Answer("answer-1", "question-1", "one"), _Answer("answer-2", "question-2", "different")])).toBeNull();
	});

	it("fails closed when reviewed rule JSON is unreadable", function _RejectsMalformedRules()
	{
		const malformed = _Template("direct", 1, [{ id: "rule", priority: "not-an-integer", answers: { "question-1": "one" } }]);

		expect(_SelectPersonaDraftTemplate([malformed], [_Answer("answer-1", "question-1", "one")])).toBeNull();
	});
});
