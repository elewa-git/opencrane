import { ChangeDetectionStrategy, Component, input, signal } from "@angular/core";
import { ButtonModule } from "primeng/button";
import { InputTextModule } from "primeng/inputtext";

/** Copy control for one server-authored invitation link. */
@Component({ selector: "wo-member-invite-link", standalone: true, imports: [ButtonModule, InputTextModule], templateUrl: "./member-invite-link.component.html", styleUrl: "./member-invite-link.component.scss", changeDetection: ChangeDetectionStrategy.OnPush })
export class MemberInviteLinkComponent
{
	/** Server-authored shareable link shown without browser-side modification. */
	public readonly link = input.required<string>();
	/** Whether the latest clipboard write completed. */
	protected readonly copied = signal(false);
	/** Whether clipboard access failed or is unavailable. */
	protected readonly copyFailed = signal(false);

	/** Copy the displayed link and announce the browser result. */
	protected async copy(): Promise<void>
	{
		this.copied.set(false);
		this.copyFailed.set(false);
		if (!globalThis.navigator?.clipboard)
		{
			this.copyFailed.set(true);
			return;
		}
		try
		{
			await globalThis.navigator.clipboard.writeText(this.link());
			this.copied.set(true);
		}
		catch
		{
			this.copyFailed.set(true);
		}
	}
}
