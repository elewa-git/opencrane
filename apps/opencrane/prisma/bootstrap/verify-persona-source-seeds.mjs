import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

const _BASELINE = new URL("./target-baseline.sql", import.meta.url);
const _DESIGN_ROOT = new URL("../../../../docs/design/persona-archetypes/", import.meta.url);
const _EXPECTED_QUESTION_IDS = [
	"q1-decision-speed",
	"q2-response-preference",
	"q3-feedback-preference",
	"q4-meeting-energy",
	"q5-new-ideas",
	"q6-risk-appetite",
	"q7-suggestion-cadence",
	"q8-challenge-preference",
	"q9-relationship-model",
	"q10-tone-preference",
];
const _EXPECTED_TEMPLATES = new Set([
	"commander-explorer",
	"commander-guardian",
	"catalyst-explorer",
	"catalyst-guardian",
	"anchor-explorer",
	"anchor-guardian",
	"analyst-explorer",
	"analyst-guardian",
]);

/** Decode the limited PostgreSQL E-string escape vocabulary used by reviewed persona sources. */
function _DecodeEString(value)
{
	return value.replace(/''/gu, "'").replace(/\\n/gu, "\n");
}

/** Return a lowercase SHA-256 digest for one exact reviewed source payload. */
function _Digest(value)
{
	return createHash("sha256").update(value, "utf8").digest("hex");
}

/** Verify the reviewed ten-question set and every exact choice/weight coordinate. */
function _VerifyPolicy(baseline)
{
	const questionMatches = [...baseline.matchAll(/\('personal-agent-onboarding', 1, '(?<id>q\d+-[^']+)', '(?<category>[A-Z][a-z]+)', '[^']*(?:''[^']*)*', (?<ordinal>\d+)\)/gu)];
	const questionIds = questionMatches.map(function _QuestionId(match) { return match.groups?.id; });
	if (JSON.stringify(questionIds) !== JSON.stringify(_EXPECTED_QUESTION_IDS)) throw new Error("clean baseline must contain the exact ordered ten-question persona set");

	const weightMatches = [...baseline.matchAll(/\('personal-agent-scoring', 1, 'personal-agent-onboarding', 1, '(?<question>q\d+-[^']+)', '(?<choice>[a-d])', (?<red>\d+), (?<yellow>\d+), (?<green>\d+), (?<blue>\d+), (?<explorer>\d+), (?<guardian>\d+)\)/gu)];
	if (weightMatches.length !== 37) throw new Error("clean baseline must contain all 37 reviewed persona choice weights");
	const rows = weightMatches.map(function _Weight(match)
	{
		return {
			questionId: match.groups?.question,
			choiceId: match.groups?.choice,
			red: Number(match.groups?.red),
			yellow: Number(match.groups?.yellow),
			green: Number(match.groups?.green),
			blue: Number(match.groups?.blue),
			explorer: Number(match.groups?.explorer),
			guardian: Number(match.groups?.guardian),
		};
	});
	const policy = baseline.match(/\('personal-agent-scoring', 1, 'sha256:(?<digest>[a-f0-9]{64})', 'opencrane-clean-build'/u);
	if (policy?.groups?.digest !== _Digest(JSON.stringify(rows))) throw new Error("clean baseline persona scoring-policy digest is stale");
}

/** Verify the interpolation-map digest over its exact reviewed JSON source. */
function _VerifyInterpolationMap(baseline)
{
	const match = baseline.match(/\('personal-agent-interpolation', 1, 'sha256:(?<digest>[a-f0-9]{64})',\s+'(?<json>\{.*\})'::jsonb,/u);
	if (!match?.groups?.json || !match.groups.digest) throw new Error("clean baseline persona interpolation map is missing");
	const source = JSON.stringify(JSON.parse(match.groups.json));
	if (_Digest(source) !== match.groups.digest) throw new Error("clean baseline persona interpolation-map digest is stale");
}

/** Verify all eight SOUL templates exactly match their reviewed design files and digests. */
function _VerifyTemplates(baseline)
{
	const ids = [..._EXPECTED_TEMPLATES].join("|");
	const pattern = new RegExp(`\\('(?<id>${ids})', 1, 'sha256:(?<digest>[a-f0-9]{64})', '(?<display>[^']+)', '(?<colour>Red|Yellow|Green|Blue)', '(?<modifier>Explorer|Guardian)', E'(?<content>(?:[^']|'')*)', 'opencrane-clean-build'`, "gu");
	const matches = [...baseline.matchAll(pattern)];
	if (matches.length !== _EXPECTED_TEMPLATES.size) throw new Error("clean baseline must contain exactly the eight reviewed persona SOUL templates");
	const found = new Set();
	for (const match of matches)
	{
		const id = match.groups?.id;
		const digest = match.groups?.digest;
		const content = match.groups?.content;
		if (!id || !digest || content === undefined || !_EXPECTED_TEMPLATES.has(id) || found.has(id)) throw new Error("clean baseline persona template shape is invalid");
		found.add(id);
		const decoded = _DecodeEString(content);
		const reviewed = readFileSync(new URL(`soul-${id}.md`, _DESIGN_ROOT), "utf8");
		if (decoded !== reviewed) throw new Error(`persona template ${id} has drifted from its reviewed design source`);
		if (_Digest(decoded) !== digest) throw new Error(`persona template ${id} has a stale content digest`);
	}
}

/** Verify every governed clean-build persona source in the reviewed baseline. */
function _Verify()
{
	const baseline = readFileSync(_BASELINE, "utf8");
	_VerifyPolicy(baseline);
	_VerifyInterpolationMap(baseline);
	_VerifyTemplates(baseline);
}

_Verify();
