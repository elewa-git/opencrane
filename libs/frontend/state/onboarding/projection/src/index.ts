/**
 * The onboarding values the onboarding screens are allowed to see, and nothing else.
 *
 * Route states, persona, transcript and snapshot types are owned by the pure
 * `@opencrane/models/user-onboarding` package. This barrel re-exports only those, so the onboarding
 * feature can render them without importing `@opencrane/state/onboarding` — which owns the stores,
 * the gateway and the commands — and without the feature being allowed to import any model package
 * it likes.
 *
 * Do not reach past this barrel. There is no parser, store, command, gateway or HTTP adapter here,
 * and none may be added: runtime data is validated by the model owner before onboarding state hands
 * it over. A screen that needs to *change* onboarding injects a store from
 * `@opencrane/state/onboarding` instead of widening this file.
 *
 * Imported by: features/onboarding — persona-onboarding-page.component,
 * chat/persona-first-chat-page.component and chat/persona-first-chat.view.
 *
 * @see libs/frontend/state/onboarding/projection/README.md for the boundary this barrel keeps.
 */
export { PersonaFirstChatArchetypes, PersonaFirstChatColours, PersonaFirstChatTranscriptKinds, PersonaFirstChatTranscriptRoles, UserOnboardingRouteStates } from "@opencrane/models/user-onboarding";
export { PersonaColours, PersonaModifiers, PersonaOnboardingStates, PersonaResolutionKinds } from "@opencrane/models/user-onboarding";
export type { PersonaColourScores, PersonaFirstChatContentRevision, PersonaFirstChatCurrentQuestion, PersonaFirstChatPersona, PersonaFirstChatSnapshot, PersonaFirstChatTranscriptEntry, PersonaOnboardingSnapshot, PersonaOpennessScores, PersonaQuestion, PersonaQuestionChoice, PersonaResolution, PersonaResult } from "@opencrane/models/user-onboarding";
