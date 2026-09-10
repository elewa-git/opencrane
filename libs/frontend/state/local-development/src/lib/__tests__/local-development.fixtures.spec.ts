import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { PersonaFirstChatArchetypes } from "@opencrane/models/user-onboarding";

import { __LOCAL_DEVELOPMENT_BOOTSTRAPS } from "../local-development.fixtures";
import { _CreateLocalDevelopmentQuestions, _LOCAL_DEVELOPMENT_SCORING_WEIGHTS } from "../local-development.persona-fixtures";
import { _ScoreLocalDevelopmentPersona } from "../local-development.scoring";

/** Splits one SQL values tuple while decoding doubled apostrophes. */
function _SqlFields(tuple: string): readonly string[]
{
	const fields: string[] = [];
	let field = "";
	let quoted = false;
	for (let index = 0; index < tuple.length; index += 1)
	{
		const character = tuple[index]!;
		if (character === "'" && quoted && tuple[index + 1] === "'")
		{
			field += "'";
			index += 1;
		}
		else if (character === "'")
		{
			quoted = !quoted;
		}
		else if (character === "," && !quoted)
		{
			fields.push(field.trim());
			field = "";
		}
		else
		{
			field += character;
		}
	}
	fields.push(field.trim());
	return fields;
}

/** Extracts the exact ordered values rows for one named baseline insert. */
function _InsertRows(baseline: string, table: string): readonly (readonly string[])[]
{
	const marker = `INSERT INTO "${table}"`;
	const insertStart = baseline.indexOf(marker);
	const valuesStart = baseline.indexOf(" VALUES", insertStart);
	const insertEnd = baseline.indexOf(";", valuesStart);
	if (insertStart < 0 || valuesStart < 0 || insertEnd < 0)
	{
		throw new Error(`The target baseline has no complete ${table} insert.`);
	}
	const block = baseline.slice(valuesStart + " VALUES".length, insertEnd);
	return [...block.matchAll(/\(([^()]*)\)/gu)].map(function _Row(match) { return _SqlFields(match[1]!); });
}

describe("Tier 1 reviewed archetype fixtures", function _DescribeFixtures()
{
	it.each(Object.values(PersonaFirstChatArchetypes))("matches the current target baseline for %s", function _MatchesBaseline(archetype)
	{
		const fixture = __LOCAL_DEVELOPMENT_BOOTSTRAPS[archetype];
		const repositoryRoot = resolve(process.cwd(), "../../../..");
		const baseline = readFileSync(resolve(repositoryRoot, "apps/opencrane/prisma/bootstrap/target-baseline.sql"), "utf8");
		const source = readFileSync(resolve(repositoryRoot, fixture.sourceLabel), "utf8");
		const normalizedSource = source.replace(/^>\s?/gmu, "").replace(/\*\*/gu, "").replace(/\s+/gu, " ");
		const normalizedOpening = fixture.opening.replace(/\s+/gu, " ");
		expect(baseline).toContain(fixture.revisionId);
		expect(baseline).toContain(fixture.digest);
		expect(baseline).toContain(fixture.sourceLabel);
		expect(normalizedSource).toContain(normalizedOpening);
		for (const question of fixture.questions)
		{
			expect(normalizedSource).toContain(question);
		}
	});

	it("matches every reviewed question, choice, ordinal, and scoring row exactly", function _MatchesScoringPolicy()
	{
		const repositoryRoot = resolve(process.cwd(), "../../../..");
		const baseline = readFileSync(resolve(repositoryRoot, "apps/opencrane/prisma/bootstrap/target-baseline.sql"), "utf8");
		const questions = _CreateLocalDevelopmentQuestions();
		const expectedQuestions = questions.map(function _Question(question)
		{
			return ["personal-agent-onboarding", "1", question.id, question.category, question.prompt, String(question.ordinal)];
		});
		const expectedChoices = questions.flatMap(function _Question(question)
		{
			return question.choices.map(function _Choice(choice) { return ["personal-agent-onboarding", "1", question.id, choice.id, choice.label, String(choice.ordinal)]; });
		});
		const expectedWeights = Object.entries(_LOCAL_DEVELOPMENT_SCORING_WEIGHTS).map(function _Weight(entry)
		{
			const [coordinate, weight] = entry;
			const separator = coordinate.lastIndexOf(":");
			const questionId = coordinate.slice(0, separator);
			const choiceId = coordinate.slice(separator + 1);
			return ["personal-agent-scoring", "1", "personal-agent-onboarding", "1", questionId, choiceId, String(weight.red), String(weight.yellow), String(weight.green), String(weight.blue), String(weight.explorer), String(weight.guardian)];
		});

		expect(_InsertRows(baseline, "persona_questions")).toEqual(expectedQuestions);
		expect(_InsertRows(baseline, "persona_question_choices")).toEqual(expectedChoices);
		expect(_InsertRows(baseline, "persona_scoring_weights")).toEqual(expectedWeights);

		const selected = questions.map(function _Select(question, index)
		{
			return { ...question, selectedChoiceId: index === 9 ? "b" : "a" };
		});
		const score = _ScoreLocalDevelopmentPersona(selected, []);
		expect(score.colours).toEqual({ red: 20, yellow: 6, green: 0, blue: 7, total: 33 });
		expect(score.openness).toEqual({ explorer: 6, guardian: 0, total: 6 });
	});
});
