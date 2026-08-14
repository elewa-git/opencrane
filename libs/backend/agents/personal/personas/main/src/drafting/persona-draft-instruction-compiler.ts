import { PersonaTemplateVariable, type PersonaTemplateVariables } from "./persona-draft-instruction-compiler.types";

/** The placeholders every persona SOUL template must contain, each exactly once. */
const PERSONA_TEMPLATE_VARIABLES: readonly PersonaTemplateVariable[] = Object.values(PersonaTemplateVariable);

/** Fills in a SOUL template's placeholders. Returns null when a placeholder is missing, repeated, unknown, or still unfilled afterwards. */
export function _CompilePersonaDraftInstructions(templateContent: string, variables: PersonaTemplateVariables): string | null
{
	const runtimeTemplate = _WithoutDisplayHeading(templateContent);
	let compiled = runtimeTemplate;
	const found = [...runtimeTemplate.matchAll(/\{\{([a-z_]+)\}\}/g)].map(function _Variable(match) { return match[1] ?? ""; });
	if (found.length !== PERSONA_TEMPLATE_VARIABLES.length || !PERSONA_TEMPLATE_VARIABLES.every(function _ExactlyOnce(variable) { return found.filter(function _Same(candidate) { return candidate === variable; }).length === 1; })) return null;
	if (found.some(function _Unknown(variable) { return !PERSONA_TEMPLATE_VARIABLES.includes(variable as (typeof PERSONA_TEMPLATE_VARIABLES)[number]); })) return null;
	for (const variable of PERSONA_TEMPLATE_VARIABLES)
	{
		const value = variables[variable].trim();
		if (!value || /\{\{|\}\}/.test(value)) return null;
		compiled = compiled.replace(`{{${variable}}}`, value);
	}
	return /\{\{[^}]+\}\}/.test(compiled) ? null : `${compiled.trim()}\n`;
}

/** Remove the display-only Markdown title before producing runtime instructions. */
function _WithoutDisplayHeading(templateContent: string): string
{
	const lines = templateContent.split("\n");
	if (!/^#\s+SOUL\s+[—-]\s+\S/u.test(lines[0] ?? "")) return templateContent;
	return lines.slice(1).join("\n").trimStart();
}
