// The public model boundary exports the persona and first-chat projection types plus one parser for
// each untrusted API response family.
//
// Each validator exports a single parser on purpose. Its schemas and per-state rules stay private so
// a consumer cannot assemble another definition of a valid projection; every adapter that accepts
// untrusted API data applies the same model-owned checks.
export * from "./persona-first-chat.types";
export { ___ParsePersonaFirstChatSnapshot } from "./persona-first-chat.validator";
export * from "./persona-onboarding.types";
export { ___ParsePersonaOnboardingSnapshot } from "./persona-onboarding.validator";
