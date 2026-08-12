import { z } from "zod";

import { PersonaColourValues } from "../scoring/persona-scorer.types.js";

import type { PersonaDraftDirectives } from "./persona-draft-source-deriver.types.js";

/** Directive text; must not be blank. */
const _DirectiveSchema = z.string().refine(function _NonBlank(value) { return value.trim().length > 0; }, "must not be blank");

/**
 * Schema for the stored interpolation map.
 *
 * An unexpected field at the top level, or an unexpected secondary-colour key, is rejected rather
 * than dropped: either one means the stored catalogue and this code no longer agree.
 */
const _PersonaDraftDirectivesSchema: z.ZodType<PersonaDraftDirectives> = z.object({
	byChoice: z.record(_DirectiveSchema).refine(function _HasChoiceDirective(value) { return Object.keys(value).length > 0; }, "must contain at least one reviewed choice directive"),
	secondaryBlend: z.object({
		[PersonaColourValues.Red]: _DirectiveSchema,
		[PersonaColourValues.Yellow]: _DirectiveSchema,
		[PersonaColourValues.Green]: _DirectiveSchema,
		[PersonaColourValues.Blue]: _DirectiveSchema,
	}).strict(),
}).strict();

/** Parses the stored interpolation map. Returns null when it is malformed or carries a field this code does not expect. */
export function _ParsePersonaDraftDirectives(value: unknown): PersonaDraftDirectives | null
{
	const parsed = _PersonaDraftDirectivesSchema.safeParse(value);
	return parsed.success ? parsed.data : null;
}
