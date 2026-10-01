import { ChangeDetectionStrategy, Component, input, output } from "@angular/core";
import { ButtonModule } from "primeng/button";
import { MessageModule } from "primeng/message";

/** Presents asynchronous progress and failures while the consumer retains ownership of its data. */
@Component({ selector: "wo-resource-feedback", standalone: true, imports: [ButtonModule, MessageModule], templateUrl: "./resource-feedback.component.html", styleUrl: "./resource-feedback.component.scss", changeDetection: ChangeDetectionStrategy.OnPush })
export class ResourceFeedbackComponent
{
	/** Whether a read is pending, including refreshes with retained data. */
	public readonly loading = input(false);
	/** Context-specific progress copy. */
	public readonly loadingLabel = input("Loading…");
	/** Failure from the latest read or command, without private diagnostic details. */
	public readonly error = input<string | null>(null);
	/** Whether the owner can retry the failed read. */
	public readonly retryAvailable = input(false);
	/** Requests a read retry; it never repeats a write itself. */
	public readonly retryRequested = output<void>();
}
