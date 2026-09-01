/**
 * Everything the app and the onboarding screens may use to drive onboarding: the two gateway ports
 * and their injection tokens, the persona and first-chat services and stores, the live
 * generated-client adapter, and the small types a caller has to name to use them.
 *
 * The projection values — route states, persona, transcript and snapshot types — are deliberately
 * not here. They moved to the pure `@opencrane/models/user-onboarding` package, and screens read them
 * through `@opencrane/state/onboarding/projection`, so presenting onboarding no longer means
 * importing the package that can also command it.
 *
 * Import from this barrel only; the `lib/` files are not a public surface, and the first-chat route
 * and conflict-envelope parsers stay internal on purpose — the adapter is the only thing that should
 * ever run them. The app's gateway profile binds {@link PERSONA_FIRST_CHAT_GATEWAY} and
 * PERSONA_GATEWAY before routed features load; tests override those same tokens instead of
 * stubbing HTTP.
 *
 * @see libs/frontend/state/onboarding/README.md for what this package owns and refuses to own.
 */
export * from "./lib/persona-gateway.types";
export * from "./lib/persona-onboarding.service";
export * from "./lib/persona-onboarding.store";
export { PERSONA_FIRST_CHAT_GATEWAY, PersonaFirstChatConflictError } from "./lib/persona-first-chat.types";
export type { PersonaFirstChatAnswerCommand, PersonaFirstChatGateway, UserOnboardingRouteSnapshot } from "./lib/persona-first-chat.types";
export * from "./lib/opencrane-persona-first-chat.gateway";
export * from "./lib/persona-first-chat.service";
export * from "./lib/persona-first-chat.store";
export { PersonaFirstChatCommandPhases } from "./lib/persona-first-chat.store.types";
