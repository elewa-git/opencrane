// The whole public surface of @opencrane/models/user-onboarding: the first-chat projection types and
// the one function that turns an untrusted response into one of them.
//
// The types are re-exported wholesale, but the validator exports a single name on purpose. The schemas
// and the per-state rules behind it stay private so a consumer cannot assemble its own variant of a
// valid first chat — every reader has to go through the same check.
export * from "./persona-first-chat.types";
export { ___ParsePersonaFirstChatSnapshot } from "./persona-first-chat.validator";
