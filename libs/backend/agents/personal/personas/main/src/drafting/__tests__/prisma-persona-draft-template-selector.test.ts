import { describe, expect, it } from "vitest";

import { _CompilePersonaDraftInstructions } from "../persona-draft-instruction-compiler.js";
import { PrismaPersonaDraftTemplateSelectorRepository } from "../prisma-persona-draft-template-selector.js";

/** Creates one narrow template-selector client from reviewed templates and completed interview answers. */
function _Client(templates: readonly { readonly id: string; readonly version: number; readonly digest: string; readonly content: string; readonly selectionRules: unknown }[], answers: readonly { readonly id: string; readonly questionId: string; readonly value: string }[]): never
{
	return {
		personaSoulTemplate: { findMany: async function _templates() { return templates; } },
		personaInterviewAnswer: { findMany: async function _answers() { return answers; } },
	} as never;
}

/** Builds one reviewed deterministic selection rule. */
function _Rule(id: string, priority: number, answers: Readonly<Record<string, string>>): { readonly id: string; readonly priority: number; readonly answers: Readonly<Record<string, string>> }
{
	return { id, priority, answers };
}

describe("PrismaPersonaDraftTemplateSelector", function _DescribePrismaPersonaDraftTemplateSelector()
{
	it("selects direct and supportive templates from exact reviewed answer evidence", async function _SelectsReviewedTemplates()
	{
		const client = _Client([
			{ id: "direct", version: 1, digest: "sha256:direct", content: "# Direct", selectionRules: [_Rule("direct-rule", 20, { role: "partner" })] },
			{ id: "supportive", version: 1, digest: "sha256:supportive", content: "# Supportive", selectionRules: [_Rule("supportive-rule", 21, { role: "partner", challenge: "support" })] },
		], [{ id: "answer-role", questionId: "role", value: "partner" }, { id: "answer-challenge", questionId: "challenge", value: "support" }]);
		const selector = new PrismaPersonaDraftTemplateSelectorRepository(client);

		await expect(selector.select("interview-1")).resolves.toEqual({ templateId: "supportive", templateVersion: 1, templateDigest: "sha256:supportive", content: "# Supportive", selectionRuleId: "supportive-rule", selectionAnswerIds: ["answer-challenge", "answer-role"] });
	});

	it("preserves Prisma's template ordering when equal-priority matches cross templates", async function _PreservesOrdering()
	{
		const client = _Client([
			{ id: "a-template", version: 2, digest: "sha256:a2", content: "# A2", selectionRules: [_Rule("rule", 10, { role: "partner" })] },
			{ id: "a-template", version: 1, digest: "sha256:a1", content: "# A1", selectionRules: [_Rule("rule", 10, { role: "partner" })] },
			{ id: "z-template", version: 1, digest: "sha256:z", content: "# Z", selectionRules: [_Rule("rule", 10, { role: "partner" })] },
		], [{ id: "answer-role", questionId: "role", value: "partner" }]);
		const selector = new PrismaPersonaDraftTemplateSelectorRepository(client);

		await expect(selector.select("interview-1")).resolves.toMatchObject({ templateId: "a-template", templateVersion: 2 });
	});

	it("fails closed when a reviewed template contains malformed selection JSON", async function _RejectsMalformedRules()
	{
		const client = _Client([{ id: "invalid", version: 1, digest: "sha256:invalid", content: "# Invalid", selectionRules: { id: "not-an-array" } }], []);
		const selector = new PrismaPersonaDraftTemplateSelectorRepository(client);

		await expect(selector.select("interview-1")).resolves.toBeNull();
	});

	it("compiles the reviewed source and insight statements into one exact immutable instruction document", function _CompilesInstructions()
	{
		expect(_CompilePersonaDraftInstructions("# SOUL\n", [{ statement: "  Be concise. " }, { statement: "Ask before acting." }])).toBe("# SOUL\n\n## Interview insights\n- Be concise.\n- Ask before acting.\n");
	});
});
