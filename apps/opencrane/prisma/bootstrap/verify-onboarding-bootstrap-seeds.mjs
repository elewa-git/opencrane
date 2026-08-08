import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

const _BASELINE = new URL("./target-baseline.sql", import.meta.url);
const _DESIGN_ROOT = new URL("../../../../docs/design/persona-archetypes/", import.meta.url);
const _ARCHETYPES = ["commander", "catalyst", "anchor", "analyst"];
const _REQUIRED_BASELINE_FRAGMENTS = [
	'CREATE TABLE "user_onboarding_bootstrap_content_revisions"',
	'CREATE TABLE "user_onboarding_bootstrap_questions"',
	'CREATE TABLE "user_onboarding_bootstrap_conversations"',
	'CREATE TABLE "user_onboarding_bootstrap_answers"',
	'"user_onboarding_bootstrap_conversations_onboarding_id_fkey"',
	'"user_onboarding_bootstrap_conversations_content_revision_fkey"',
	'"user_onboarding_bootstrap_conversations_persona_revision_id_fkey"',
	'"user_onboarding_bootstrap_answers_conversation_id_fkey"',
	'"user_onboardings_bootstrap_content_revision_fkey"',
	'"user_onboardings_bootstrap_conversation_id_fkey"',
	'CREATE TRIGGER "user_onboarding_bootstrap_conversations_immutable_provenance"',
	'CREATE TRIGGER "user_onboarding_bootstrap_answers_exact_sequence"',
];

/** Return a lowercase SHA-256 digest for exact UTF-8 source bytes. */
function _Digest(value)
{
	return createHash("sha256").update(value, "utf8").digest("hex");
}

/** Extract one named PostgreSQL dollar-quoted value from the clean baseline. */
function _DollarValue(baseline, tag)
{
	const opening = `$${tag}$`;
	const start = baseline.indexOf(opening);
	if (start < 0) throw new Error(`clean baseline is missing ${tag}`);
	const contentStart = start + opening.length;
	const end = baseline.indexOf(opening, contentStart);
	if (end < 0) throw new Error(`clean baseline has an unterminated ${tag}`);
	return baseline.slice(contentStart, end);
}

/** Derive only the owner-visible opening and question prompts from canonical Markdown. */
function _StructuredSource(source)
{
	const openingSection = source.match(/## Opening\n\n[\s\S]*?\n\n(?<quote>(?:>.*\n?)+)\n## First-session calibration/u)?.groups?.quote;
	if (openingSection === undefined) throw new Error("reviewed bootstrap source has no opening blockquote");
	const opening = openingSection.split("\n").map(function _QuoteLine(line) { return line === ">" ? "" : line.replace(/^> ?/u, ""); }).join("\n").trim();
	const questionSection = source.match(/## First-session calibration \(3 questions\)\n[\s\S]*?\n\n(?<questions>\*\*1\.[\s\S]*?)\n\n## After calibration/u)?.groups?.questions;
	if (questionSection === undefined) throw new Error("reviewed bootstrap source has no question section");
	const questions = [...questionSection.matchAll(/\*\*(?<ordinal>[1-3])\. (?<prompt>[^*]+)\*\*\n[\s\S]*?(?=\n\n\*\*[1-3]\. |$)/gu)].map(function _Question(match) { return { ordinal: Number(match.groups?.ordinal), prompt: match.groups?.prompt }; });
	if (questions.length !== 3) throw new Error("reviewed bootstrap source must contain exactly three questions");
	return { opening, questions };
}

/** Verify one archetype's exact canonical source, digest, and structured projection. */
function _VerifyArchetype(baseline, archetype)
{
	const label = `docs/design/persona-archetypes/bootstrap-${archetype}.md`;
	const source = readFileSync(new URL(`bootstrap-${archetype}.md`, _DESIGN_ROOT), "utf8");
	const digest = `sha256:${_Digest(source)}`;
	const marker = `-- ONBOARDING_BOOTSTRAP_SOURCE ${archetype} ${digest} ${label}`;
	if (!baseline.includes(marker)) throw new Error(`clean baseline marker or digest is stale for ${archetype}`);
	if (_DollarValue(baseline, `bootstrap_${archetype}`) !== source) throw new Error(`clean baseline canonical source has drifted for ${archetype}`);
	const structured = _StructuredSource(source);
	if (_DollarValue(baseline, `opening_${archetype}`) !== structured.opening) throw new Error(`clean baseline opening has drifted for ${archetype}`);
	for (const question of structured.questions)
	{
		if (_DollarValue(baseline, `prompt_${archetype}_${question.ordinal}`) !== question.prompt) throw new Error(`clean baseline question ${question.ordinal} has drifted for ${archetype}`);
	}
}

/** Verify schema, integrity wiring, and every exact reviewed bootstrap seed. */
function _Verify()
{
	const baseline = readFileSync(_BASELINE, "utf8");
	for (const fragment of _REQUIRED_BASELINE_FRAGMENTS)
	{
		if (!baseline.includes(fragment)) throw new Error(`clean baseline is missing required onboarding fragment: ${fragment}`);
	}
	for (const archetype of _ARCHETYPES) _VerifyArchetype(baseline, archetype);
	const markers = [...baseline.matchAll(/^-- ONBOARDING_BOOTSTRAP_SOURCE /gmu)];
	if (markers.length !== _ARCHETYPES.length) throw new Error("clean baseline must seed exactly four onboarding bootstrap sources");
}

_Verify();
