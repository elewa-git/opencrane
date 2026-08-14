import { describe, expect, it } from "vitest";

import { _ParseUserOnboardingAnswerBody } from "../user-onboarding.http.validator";

/** Build one valid answer at the lower question boundary. */
function _AnswerBody(): Record<string, unknown>
{
	return { expectedConversationId: "conversation-a", expectedQuestionOrdinal: 1, text: "Answer", idempotencyKey: "key-a" };
}

describe("_ParseUserOnboardingAnswerBody", function _UserOnboardingAnswerBodySuite()
{
	it("accepts exact fields at both bounded question and string limits", function _AcceptsBoundaries()
	{
		expect(_ParseUserOnboardingAnswerBody({ expectedConversationId: "c".repeat(128), expectedQuestionOrdinal: 1, text: "a".repeat(4000), idempotencyKey: "k".repeat(128) })).not.toBeNull();
		expect(_ParseUserOnboardingAnswerBody({ ..._AnswerBody(), expectedQuestionOrdinal: 3 })).not.toBeNull();
	});

	it("rejects extra, missing, and wrong-type fields", function _RejectsInvalidShapes()
	{
		expect(_ParseUserOnboardingAnswerBody({ ..._AnswerBody(), personaRevisionId: "browser-choice" })).toBeNull();
		const { text: _missing, ...missingText } = _AnswerBody();
		expect(_ParseUserOnboardingAnswerBody(missingText)).toBeNull();
		expect(_ParseUserOnboardingAnswerBody({ ..._AnswerBody(), expectedQuestionOrdinal: "1" })).toBeNull();
	});

	it("rejects empty and out-of-bounds coordinates, answers, and retry keys", function _RejectsBounds()
	{
		expect(_ParseUserOnboardingAnswerBody({ ..._AnswerBody(), expectedConversationId: " " })).toBeNull();
		expect(_ParseUserOnboardingAnswerBody({ ..._AnswerBody(), expectedConversationId: "c".repeat(129) })).toBeNull();
		expect(_ParseUserOnboardingAnswerBody({ ..._AnswerBody(), expectedQuestionOrdinal: 0 })).toBeNull();
		expect(_ParseUserOnboardingAnswerBody({ ..._AnswerBody(), expectedQuestionOrdinal: 4 })).toBeNull();
		expect(_ParseUserOnboardingAnswerBody({ ..._AnswerBody(), text: "" })).toBeNull();
		expect(_ParseUserOnboardingAnswerBody({ ..._AnswerBody(), text: "a".repeat(4001) })).toBeNull();
		expect(_ParseUserOnboardingAnswerBody({ ..._AnswerBody(), idempotencyKey: "" })).toBeNull();
		expect(_ParseUserOnboardingAnswerBody({ ..._AnswerBody(), idempotencyKey: "k".repeat(129) })).toBeNull();
	});
});
