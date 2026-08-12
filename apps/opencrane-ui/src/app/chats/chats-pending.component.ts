import { ChangeDetectionStrategy, Component } from "@angular/core";
import { MessageModule } from "primeng/message";

/** Safe chat-index fallback until #351 composes the full direct/group workspace. */
@Component({ selector: "wo-chats-pending", standalone: true, imports: [MessageModule], templateUrl: "./chats-pending.component.html", styleUrl: "./chats-pending.component.scss", changeDetection: ChangeDetectionStrategy.OnPush })
export class ChatsPendingComponent {}
