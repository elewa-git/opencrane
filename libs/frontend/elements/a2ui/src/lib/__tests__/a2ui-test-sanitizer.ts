/** Escape fixture text so A2UI tests and stories never need a frontend-state dependency. */
export function __A2uiTestSanitizer(markdown: string): string
{
	const escaped = markdown
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;")
		.replaceAll("\"", "&quot;")
		.replaceAll("'", "&#039;");
	return escaped.startsWith("### ") ? `<h3>${escaped.slice(4)}</h3>` : escaped;
}
