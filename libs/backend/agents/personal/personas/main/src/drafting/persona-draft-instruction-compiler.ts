/** Compiles immutable reviewed template content and explicit interview insights into one draft instruction document. */
export function _CompilePersonaDraftInstructions(templateContent: string, insights: readonly { readonly statement: string }[]): string
{
	return `${templateContent.trim()}\n\n## Interview insights\n${insights.map(function _renderInsight(insight) { return `- ${insight.statement.trim()}`; }).join("\n")}\n`;
}
