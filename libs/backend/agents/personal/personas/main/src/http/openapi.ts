import { PersonaOnboardingApiStates } from "../profile/persona-lifecycle.types";
import { PersonaColourValues, PersonaModifierValues, PersonaTieKinds } from "../scoring/persona-scorer.types";

/** Stable colour values exposed by persona score and review schemas. */
const _COLOUR_VALUES: readonly PersonaColourValues[] = Object.values(PersonaColourValues);

/** Stable modifier values exposed by persona score and review schemas. */
const _MODIFIER_VALUES: readonly PersonaModifierValues[] = Object.values(PersonaModifierValues);

/** Stable tie boundaries exposed by persona resolution schemas. */
const _TIE_KINDS: readonly PersonaTieKinds[] = Object.values(PersonaTieKinds);

/** Colour-score schema, including the `total` the four counters add up to. */
const _COLOUR_SCORES = { type: "object", required: ["red", "yellow", "green", "blue", "total"], properties: { red: { type: "integer", minimum: 0 }, yellow: { type: "integer", minimum: 0 }, green: { type: "integer", minimum: 0 }, blue: { type: "integer", minimum: 0 }, total: { type: "integer", minimum: 1 } } } as const;

/** Modifier-score schema, including the `total` the two counters add up to. */
const _OPENNESS_SCORES = { type: "object", required: ["explorer", "guardian", "total"], properties: { explorer: { type: "integer", minimum: 0 }, guardian: { type: "integer", minimum: 0 }, total: { type: "integer", minimum: 1 } } } as const;

/** Schema for the next tie the owner must break. */
const _RESOLUTION = { type: "object", nullable: true, required: ["kind", "candidates"], properties: { kind: { type: "string", enum: _TIE_KINDS }, candidates: { type: "array", minItems: 2, items: { type: "string", enum: [..._COLOUR_VALUES, ..._MODIFIER_VALUES] } } } } as const;

/** Reviewable persona result without compiled runtime instructions. */
const _RESULT = { type: "object", nullable: true, required: ["displayName", "primaryColour", "secondaryColour", "modifier", "colourScores", "opennessScores", "insights", "instructionPreview"], properties: { displayName: { type: "string", description: "Reviewed template name after drafting; a generic result label before a draft exists." }, primaryColour: { type: "string", enum: _COLOUR_VALUES }, secondaryColour: { type: "string", enum: _COLOUR_VALUES }, modifier: { type: "string", enum: _MODIFIER_VALUES }, colourScores: _COLOUR_SCORES, opennessScores: _OPENNESS_SCORES, insights: { type: "array", maxItems: 5, items: { type: "string" } }, instructionPreview: { type: "string", nullable: true } } } as const;

/** Schema for one pinned question and its choices, so a browser can resume on any device. */
const _QUESTION = { type: "object", required: ["id", "category", "prompt", "ordinal", "choices", "selectedChoiceId"], properties: { id: { type: "string" }, category: { type: "string" }, prompt: { type: "string" }, ordinal: { type: "integer", minimum: 1 }, choices: { type: "array", minItems: 2, items: { type: "object", required: ["id", "label", "ordinal"], properties: { id: { type: "string" }, label: { type: "string" }, ordinal: { type: "integer", minimum: 1 } } } }, selectedChoiceId: { type: "string", nullable: true } } } as const;

/** Complete owner-visible persona journey status. */
const _STATUS = { type: "object", required: ["state", "interviewId", "answeredQuestionCount", "questionCount", "personaRevisionId", "questions", "resolution", "result"], properties: { state: { type: "string", enum: [PersonaOnboardingApiStates.Interview, PersonaOnboardingApiStates.Resolution, PersonaOnboardingApiStates.Review, PersonaOnboardingApiStates.Ready] }, interviewId: { type: "string", nullable: true }, answeredQuestionCount: { type: "integer", minimum: 0 }, questionCount: { type: "integer", minimum: 0 }, personaRevisionId: { type: "string", nullable: true }, questions: { type: "array", items: _QUESTION }, resolution: _RESOLUTION, result: _RESULT } } as const;

/** Shared error response for every persona route. */
const _ERROR = { description: "The owner-bound persona transition was rejected.", content: { "application/json": { schema: { type: "object", required: ["error"], properties: { error: { type: "string" } } } } } } as const;

/** Reusable empty transition body. */
const _EMPTY_BODY = { required: true, content: { "application/json": { schema: { type: "object", additionalProperties: false } } } } as const;

/** OpenAPI paths for the routes an owner uses to complete their own persona onboarding. */
export const _PersonaOnboardingOpenapiPaths = {
	"/me/persona": {
		get: {
			operationId: "getMyPersonaStatus",
			summary: "Return the signed-in owner's resumable persona state",
			responses: { 200: { description: "Frozen questions, progress, tie state, and review result.", content: { "application/json": { schema: _STATUS } } }, 401: _ERROR, 503: _ERROR },
		},
	},
	"/me/persona/interview": {
		post: {
			operationId: "startMyPersonaInterview",
			summary: "Start or resume the reviewed sorting interview",
			requestBody: _EMPTY_BODY,
			responses: { 200: _InterviewResponse("The exact frozen interview revision."), 400: _ERROR, 401: _ERROR, 404: _ERROR, 409: _ERROR, 422: _ERROR, 503: _ERROR },
		},
	},
	"/me/persona/refreshes/{configurationChangeId}/interview": {
		post: {
			operationId: "startMyPersonaRefreshInterview",
			summary: "Start or resume an accepted persona refresh interview",
			parameters: [_PathParameter("configurationChangeId")],
			requestBody: _EMPTY_BODY,
			responses: { 200: _InterviewResponse("The exact proposal-bound interview revision."), 400: _ERROR, 401: _ERROR, 404: _ERROR, 409: _ERROR, 503: _ERROR },
		},
	},
	"/me/persona/interviews/{interviewId}/answers/{questionId}": {
		post: {
			operationId: "answerMyPersonaQuestion",
			summary: "Append one exact reviewed choice",
			parameters: [_PathParameter("interviewId"), _PathParameter("questionId")],
			requestBody: _StringBody("choiceId"),
			responses: { 201: _IdentifierResponse("Immutable answer evidence appended.", "answerId"), 400: _ERROR, 401: _ERROR, 404: _ERROR, 409: _ERROR, 503: _ERROR },
		},
	},
	"/me/persona/interviews/{interviewId}/complete": {
		post: {
			operationId: "completeMyPersonaInterview",
			summary: "Freeze and score a fully answered interview",
			parameters: [_PathParameter("interviewId")],
			requestBody: _EMPTY_BODY,
			responses: { 200: _ScoreResponse("Lossless score and any required tie boundary."), 400: _ERROR, 401: _ERROR, 404: _ERROR, 409: _ERROR, 503: _ERROR },
		},
	},
	"/me/persona/interviews/{interviewId}/resolutions/{kind}": {
		post: {
			operationId: "resolveMyPersonaTie",
			summary: "Append one explicit persona tie choice",
			parameters: [_PathParameter("interviewId"), { ..._PathParameter("kind"), schema: { type: "string", enum: _TIE_KINDS } }],
			requestBody: _StringBody("selectedValue"),
			responses: { 201: _ScoreResponse("Tie evidence appended and result replayed."), 400: _ERROR, 401: _ERROR, 404: _ERROR, 409: _ERROR, 503: _ERROR },
		},
	},
	"/me/persona/interviews/{interviewId}/draft": {
		post: {
			operationId: "draftMyPersona",
			summary: "Compile a reviewable persona revision",
			parameters: [_PathParameter("interviewId")],
			requestBody: _EMPTY_BODY,
			responses: { 201: _RevisionResponse("Reviewable immutable draft created.", PersonaOnboardingApiStates.Draft), 400: _ERROR, 401: _ERROR, 404: _ERROR, 409: _ERROR, 503: _ERROR },
		},
	},
	"/me/persona/drafts/{personaRevisionId}/approve": {
		post: {
			operationId: "approveMyPersona",
			summary: "Approve and activate the exact reviewed persona draft",
			parameters: [_PathParameter("personaRevisionId")],
			requestBody: _EMPTY_BODY,
			responses: { 200: _RevisionResponse("Persona revision approved and activated.", PersonaOnboardingApiStates.Approved), 400: _ERROR, 401: _ERROR, 404: _ERROR, 409: _ERROR, 503: _ERROR },
		},
	},
} as const;

/** Build one required string path parameter. */
function _PathParameter(name: string)
{
	return { in: "path", name, required: true, schema: { type: "string" } } as const;
}

/** Build one exact single-string request body. */
function _StringBody(name: string)
{
	return { required: true, content: { "application/json": { schema: { type: "object", additionalProperties: false, required: [name], properties: { [name]: { type: "string" } } } } } } as const;
}

/** Build the frozen interview start response. */
function _InterviewResponse(description: string)
{
	return { description, content: { "application/json": { schema: { type: "object", required: ["interviewId", "state", "reused", "questions"], properties: { interviewId: { type: "string" }, state: { type: "string", enum: [PersonaOnboardingApiStates.InProgress] }, reused: { type: "boolean" }, questions: { type: "array", items: _QUESTION } } } } } } as const;
}

/** Build one score-transition response. */
function _ScoreResponse(description: string)
{
	return { description, content: { "application/json": { schema: { type: "object", required: ["interviewId", "state", "resolution", "result"], properties: { interviewId: { type: "string" }, state: { type: "string", enum: [PersonaOnboardingApiStates.Resolution, PersonaOnboardingApiStates.Completed] }, resolution: _RESOLUTION, result: _RESULT } } } } } as const;
}

/** Build one single-identifier response. */
function _IdentifierResponse(description: string, name: string)
{
	return { description, content: { "application/json": { schema: { type: "object", required: [name], properties: { [name]: { type: "string" } } } } } } as const;
}

/** Build one persona-revision lifecycle response. */
function _RevisionResponse(description: string, state: PersonaOnboardingApiStates.Draft | PersonaOnboardingApiStates.Approved)
{
	return { description, content: { "application/json": { schema: { type: "object", required: ["personaRevisionId", "state"], properties: { personaRevisionId: { type: "string" }, state: { type: "string", enum: [state] } } } } } } as const;
}
