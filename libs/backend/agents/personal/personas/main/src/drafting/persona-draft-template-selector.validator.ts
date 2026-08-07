// This validator is the persisted-template trust boundary, so the rule model and accepted JSON evolve together.
import { z } from "zod";

import type { PersonaDraftTemplateRule, PersonaDraftTemplateRuleJson } from "./persona-draft-template-selector.types.js";

/** Integer priority accepted from the reviewed persisted JSON representation. */
const _PrioritySchema = z.union([z.number().int().safe(), z.string().regex(/^-?\d+$/)]).transform(function _toPriority(value) { return Number(value); }).refine(function _isSafePriority(value) { return Number.isSafeInteger(value); }, "must be a safe integer");

/** Strict rule schema that rejects catalogue fields the selector does not own. */
const _PersonaDraftTemplateRuleSchema: z.ZodType<PersonaDraftTemplateRule, z.ZodTypeDef, PersonaDraftTemplateRuleJson> = z.object({
	id: z.string().refine(function _isNonBlank(value) { return value.trim().length > 0; }, "must not be blank"),
	priority: _PrioritySchema,
	answers: z.record(z.string()),
}).strict();

/** Strict persisted rule-list schema used before any catalogue value can affect selection. */
const _PersonaDraftTemplateRulesSchema: z.ZodType<readonly PersonaDraftTemplateRule[], z.ZodTypeDef, PersonaDraftTemplateRuleJson[]> = z.array(_PersonaDraftTemplateRuleSchema);

/** Parse reviewed persisted selection rules, returning null so malformed catalogue state fails closed. */
export function _ParsePersonaDraftTemplateRules(value: unknown): readonly PersonaDraftTemplateRule[] | null
{
	const parsed = _PersonaDraftTemplateRulesSchema.safeParse(value);
	return parsed.success ? parsed.data : null;
}
