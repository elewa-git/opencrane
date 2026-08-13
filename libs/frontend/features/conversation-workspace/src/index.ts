/*
 * Public entry point for the conversation workspace feature — the chat screen a signed-in
 * participant lands on after onboarding.
 *
 * Two things leave this package: the page component an app route renders, and the intent type that
 * page emits when the reader opens a child Agent thread. Everything else — the presenter, the list
 * and create controls, the mapper, and the feature-local view types — stays inside, because it is
 * composition detail that changes with the screen.
 *
 * Import through `@opencrane/features/conversation-workspace` and nothing deeper. That package name
 * is mapped in the root `tsconfig.json` to this file alone, so a deep path into `src/lib` does not
 * resolve through the package name and would have to reach across the library boundary the ESLint
 * module-boundary rules police.
 *
 * The page owns no navigation of its own. It reports where the reader wants to go and the app route
 * turns that into a URL, which is why the intent type is exported next to it.
 *
 * Used by: `apps/opencrane-ui/src/app/chats/conversation-workspace-route.component.ts`, which hosts
 * the page and drives the sign-in recovery step, and `conversation-workspace-route.state.ts`, which
 * turns a thread intent into router commands.
 */
export { ConversationWorkspacePageComponent } from "./lib/conversation-workspace-page.component.js";
export type { ConversationThreadNavigationIntent } from "./lib/conversation-workspace-feature.types.js";
