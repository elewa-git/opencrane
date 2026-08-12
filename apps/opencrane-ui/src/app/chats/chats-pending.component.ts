import { ChangeDetectionStrategy, Component } from "@angular/core";
import { MessageModule } from "primeng/message";

/** Safe chat-index fallback until #351 composes the full direct/group workspace. */
@Component({ selector: "wo-chats-pending", standalone: true, imports: [MessageModule], template: `<main class="chats-pending"><p-message severity="secondary"><h1>Chats</h1><p>Your conversation workspace is not available in this build yet.</p></p-message></main>`, styles: [`.chats-pending{display:grid;min-height:100dvh;place-items:center;padding:1rem}`], changeDetection: ChangeDetectionStrategy.OnPush })
export class ChatsPendingComponent {}
