import { appendFileSync, writeFileSync } from "node:fs";

/** Render compact human output for terminals and GitHub summaries. */
export function renderMarkdown(result)
{
	const lines = [
		`## PR stack integrity: ${result.valid ? "PASS" : "FAIL"}`,
		"",
		`Snapshot: \`${result.evidence.snapshotDigest}\``,
		`Open PRs: ${result.evidence.pullRequests.length}`,
	];
	if (result.evidence.currentChain.length > 0)
	{
		lines.push(`Review chain: ${result.evidence.currentChain.map(function _PR(number) { return `#${number}`; }).join(" -> ")}`);
	}
	lines.push("", "Review levels:");
	for (let index = 0; index < result.evidence.reviewLevels.length; index += 1)
	{
		lines.push(`${index + 1}. ${result.evidence.reviewLevels[index].map(function _PR(number) { return `#${number}`; }).join(", ")}`);
	}
	if (result.evidence.findings.length > 0)
	{
		lines.push("", "Findings:");
		for (const finding of result.evidence.findings)
		{
			lines.push(`- **${finding.code}** — ${finding.message}`);
		}
	}
	return `${lines.join("\n")}\n`;
}

/** Persist evidence, append a CI summary, and emit terminal output. */
export function publishResult(result, output, files = {})
{
	if (files.evidencePath)
	{
		writeFileSync(files.evidencePath, `${JSON.stringify(result.evidence, null, 2)}\n`);
	}
	const markdown = renderMarkdown(result);
	if (files.summaryPath)
	{
		appendFileSync(files.summaryPath, markdown);
	}
	output(files.format === "json" ? `${JSON.stringify(result)}\n` : markdown);
}
