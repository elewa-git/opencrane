import { DOCUMENT } from "@angular/common";
import { ChangeDetectionStrategy, Component, computed, effect, inject, input, output, signal, viewChild, type ElementRef } from "@angular/core";
import { ConfirmationService } from "primeng/api";
import { ButtonModule } from "primeng/button";
import { ConfirmDialogModule } from "primeng/confirmdialog";
import { MessageModule } from "primeng/message";
import { SkeletonModule } from "primeng/skeleton";

import { SectionHeadingComponent, SectionHeadingLevels } from "@opencrane/elements/ui";
import { OrganizationMemberDirectoryStates } from "@opencrane/state/organization/members";

import { MemberDirectoryComponent } from "./member-directory.component";
import type { MemberInviteSubmitIntent, MembersViewModel } from "./member-directory.types";
import { MemberInviteFormComponent } from "./member-invite-form.component";
import { MemberInviteLinkComponent } from "./member-invite-link.component";

/** Presents directory state and local confirmation; only the route owns commands and data access. */
@Component({ selector: "wo-members-view", standalone: true, imports: [ButtonModule, ConfirmDialogModule, MessageModule, SkeletonModule, SectionHeadingComponent, MemberDirectoryComponent, MemberInviteFormComponent, MemberInviteLinkComponent], providers: [ConfirmationService], templateUrl: "./members-view.component.html", styleUrl: "./members-view.component.scss", changeDetection: ChangeDetectionStrategy.OnPush })
export class MembersViewComponent
{
	public readonly view = input.required<MembersViewModel>();
	public readonly refreshRequested = output<void>();
	public readonly inviteSubmitted = output<MemberInviteSubmitIntent>();
	public readonly inviteReset = output<void>();
	public readonly resendRequested = output<string>();
	public readonly removalRequested = output<string>();
	public readonly searchChanged = output<string>();
	protected readonly inviteOpen = signal(false);
	protected readonly headingLevels = SectionHeadingLevels;
	protected readonly directoryStates = OrganizationMemberDirectoryStates;
	private readonly _confirmation = inject(ConfirmationService);
	private readonly _document = inject(DOCUMENT);
	private readonly _target = signal<string | null>(null);
	private readonly _outcome = viewChild<ElementRef<HTMLElement>>("outcome");
	/** Reads display text from the current projection, never from unescaped dialog HTML. */
	protected readonly removalTarget = computed(() => this.view().activeRows.find(row => row.id === this._target()) ?? null);
	/** Controls disappear as soon as authority denies the directory. */
	protected readonly accessDenied = computed(() => this.view().directoryState === OrganizationMemberDirectoryStates.Forbidden);

	/** Closes private drafts and stale confirmation when the current projection changes. */
	public constructor()
	{
		effect(() =>
		{
			if (this.accessDenied())
				this.inviteOpen.set(false);
			const target = this.removalTarget();
			if (this._target() !== null && (this.accessDenied() || !target?.canRemove || target.removing))
			{
				this._target.set(null);
				this._confirmation.close();
			}
		});
		effect(() =>
		{
			if (this.view().removalMessage && !this.accessDenied())
				queueMicrotask(() => { this._outcome()?.nativeElement.focus(); });
		});
	}

	/** Opens only a currently offered target; acceptance rechecks that exact projected row. */
	protected confirmRemoval(membershipId: string): void
	{
		const row = this.view().activeRows.find(member => member.id === membershipId);
		if (this.accessDenied() || !row?.canRemove || row.removing || this._target() !== null)
			return;
		const origin = this._document.activeElement;
		this._target.set(membershipId);
		this._confirmation.confirm({ key: "member-removal", header: "Remove access", message: "", icon: "pi pi-exclamation-triangle", defaultFocus: "reject", acceptButtonProps: { label: "Remove access", severity: "danger" }, rejectButtonProps: { label: "Cancel", severity: "secondary", outlined: true },
			accept: () =>
			{
				const current = this.removalTarget();
				if (this._target() !== membershipId || this.accessDenied() || !current?.canRemove || current.removing)
					return;
				this._target.set(null);
				this.removalRequested.emit(membershipId);
			},
			reject: () =>
			{
				const canReturn = this._target() === membershipId && !this.accessDenied() && this.removalTarget()?.canRemove;
				this._target.set(null);
				if (canReturn && origin instanceof HTMLElement && origin.isConnected)
					origin.focus();
			}
		});
	}

	/** Opens a new local invite draft only while the current directory is not denied. */
	protected openInvite(): void
	{
		if (this.accessDenied())
			return;
		this.inviteReset.emit();
		this.inviteOpen.set(true);
	}

	/** Discards the locally mounted form. */
	protected closeInvite(): void { this.inviteOpen.set(false); }
}
