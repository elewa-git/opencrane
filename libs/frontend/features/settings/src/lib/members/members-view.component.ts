import { ChangeDetectionStrategy, Component, input, output, signal } from "@angular/core";
import { ButtonModule } from "primeng/button";
import { MessageModule } from "primeng/message";
import { SkeletonModule } from "primeng/skeleton";

import { SectionHeadingComponent, SectionHeadingLevels } from "@opencrane/elements/ui";
import { OrganizationMemberDirectoryStates } from "@opencrane/state/organization/members";

import { MemberDirectoryComponent } from "./member-directory.component";
import type { MemberInviteSubmitIntent, MembersViewModel } from "./member-directory.types";
import { MemberInviteFormComponent } from "./member-invite-form.component";
import { MemberInviteLinkComponent } from "./member-invite-link.component";

/** Complete presentational members screen with explicit read, refresh, and command states. */
@Component({ selector: "wo-members-view", standalone: true, imports: [ButtonModule, MessageModule, SkeletonModule, SectionHeadingComponent, MemberDirectoryComponent, MemberInviteFormComponent, MemberInviteLinkComponent], templateUrl: "./members-view.component.html", styleUrl: "./members-view.component.scss", changeDetection: ChangeDetectionStrategy.OnPush })
export class MembersViewComponent
{
	/** Pure presentation projection from the route mapper. */
	public readonly view = input.required<MembersViewModel>();
	/** Requests the independent directory read store to retry or refresh. */
	public readonly refreshRequested = output<void>();
	/** Sends the local form draft to the create store. */
	public readonly inviteSubmitted = output<MemberInviteSubmitIntent>();
	/** Requests create-store feedback reset when the form opens. */
	public readonly inviteReset = output<void>();
	/** Sends an opaque invitation coordinate to the resend store. */
	public readonly resendRequested = output<string>();
	/** Emits controlled search text for pure row mapping. */
	public readonly searchChanged = output<string>();
	/** Whether the local draft form is mounted. */
	protected readonly inviteOpen = signal(false);
	/** Stable page heading level. */
	protected readonly headingLevels = SectionHeadingLevels;
	/** Stable directory states for explicit template branching. */
	protected readonly directoryStates = OrganizationMemberDirectoryStates;

	/** Open a fresh form and clear feedback from the previous draft. */
	protected openInvite(): void
	{
		this.inviteReset.emit();
		this.inviteOpen.set(true);
	}

	/** Close the locally owned form after its store admits no active command. */
	protected closeInvite(): void { this.inviteOpen.set(false); }
}
