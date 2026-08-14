/*
 * Public entry point for the conversation workspace feature — the chat screen a signed-in
 * participant lands on after onboarding.
 *
 * The application mounts this package's child route table at `/chats`; the feature then owns its
 * index and selected-conversation route coordination. The page and navigation intent remain public
 * for typed feature composition. Its presenter, controls, mapper, and view types stay internal.
 *
 * Import through `@opencrane/features/conversation-workspace` and nothing deeper. That package name
 * is mapped in the root `tsconfig.json` to this file alone, so a deep path into `src/lib` does not
 * resolve through the package name and would have to reach across the library boundary the ESLint
 * module-boundary rules police.
 *
 * Used by: `apps/opencrane-ui/src/app/app.routes.ts`, which supplies the guarded mount, while the
 * feature route hosts the page and turns its typed intents into canonical URLs.
 */
export { CONVERSATION_WORKSPACE_ROUTES } from "./lib/conversation-workspace-route/conversation-workspace.routes";
export { ConversationWorkspacePageComponent } from "./lib/components/conversation-workspace-page/conversation-workspace-page.component";
export type { ConversationThreadNavigationIntent } from "./lib/conversation-workspace-feature.types";
