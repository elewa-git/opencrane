import { z } from "zod";

import { PersonaColourValues } from "../scoring/persona-scorer.types.js";

import type { PersonaDraftDirectives } from "./persona-draft-source-deriver.types.js";

/** Non-blank reviewed directive text accepted from the persisted catalogue. */
const _DirectiveSchema = z.string().refine(function _NonBlank(value) { return value.trim().length > 0; }, "must not be blank");

/**
 * Strict persisted interpolation schema.
 *
 * Unknown outer fields and unknown secondary-colour fields are rejected instead of stripped,
 * because either means the reviewed catalogue and the runtime model have drifted.
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

/** Parse persisted interpolation directives, failing closed on malformed or model-drifted JSON. */
export function _ParsePersonaDraftDirectives(value: unknown): PersonaDraftDirectives | null
{
	const parsed = _PersonaDraftDirectivesSchema.safeParse(value);
	return parsed.success ? parsed.data : null;
}
