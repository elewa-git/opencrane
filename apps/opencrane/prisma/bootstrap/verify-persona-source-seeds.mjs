import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

const _BASELINE = new URL("./target-baseline.sql", import.meta.url);
const _EXPECTED_TEMPLATES = new Set(["direct-partner", "supportive-partner"]);

/** Decode the limited PostgreSQL E-string escape vocabulary used by the reviewed persona source. */
function _DecodeEString(value)
{
	return value.replace(/''/gu, "'").replace(/\\n/gu, "\n");
}

/** Verify every clean-build SOUL template has an exact digest over its stored source content. */
function _Verify()
{
	const baseline = readFileSync(_BASELINE, "utf8");
	const matches = [...baseline.matchAll(/\('(?<id>direct-partner|supportive-partner)', 1, 'sha256:(?<digest>[a-f0-9]{64})', E'(?<content>(?:[^']|'')*)', '\[\{/gu)];
	if (matches.length !== _EXPECTED_TEMPLATES.size) throw new Error("clean baseline must contain exactly the two reviewed persona SOUL templates");
	const found = new Set();
	for (const match of matches)
	{
		const id = match.groups?.id;
		const digest = match.groups?.digest;
		const content = match.groups?.content;
		if (!id || !digest || content === undefined || !_EXPECTED_TEMPLATES.has(id) || found.has(id)) throw new Error("clean baseline persona template shape is invalid");
		found.add(id);
		const actual = createHash("sha256").update(_DecodeEString(content), "utf8").digest("hex");
		if (actual !== digest) throw new Error(`persona template ${id} has a stale content digest`);
	}
}

_Verify();
