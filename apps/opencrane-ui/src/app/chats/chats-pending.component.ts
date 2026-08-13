import { ChangeDetectionStrategy, Component } from "@angular/core";
import { MessageModule } from "primeng/message";

/**
 * Renders a placeholder `/chats` page saying the conversation workspace is not in this build yet.
 *
 * `/chats` has to exist because the Agent-thread route already leads there: the page's "Chats"
 * breadcrumb, a restoration coordinate that does not match the current parent, and the return after
 * access to a child is revoked all navigate to it. Rather than leave those paths dead, this component
 * answers them with a page that names no conversation and confirms nothing about what the reader may
 * open — the same non-disclosing stance the Agent-thread `Unavailable` route state takes.
 *
 * #351 replaces this with the direct and group conversation workspace. Child Agent-thread URLs stay
 * as they are, so that swap is a component change and not a routing change.
 *
 * Called by: apps/opencrane-ui/src/app/app.routes.ts, as the lazy `loadComponent` for the `chats`
 * path behind `___OperatorAccessGuard`.
 */
@Component({ selector: "wo-chats-pending", standalone: true, imports: [MessageModule], templateUrl: "./chats-pending.component.html", styleUrl: "./chats-pending.component.scss", changeDetection: ChangeDetectionStrategy.OnPush })
export class ChatsPendingComponent {}
