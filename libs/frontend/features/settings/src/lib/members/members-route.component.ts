import { ChangeDetectionStrategy, Component, computed, effect, inject, signal } from "@angular/core";

import { OrganizationInvitationCreateStore, OrganizationInvitationResendStore, OrganizationMemberRemovalStore, OrganizationMemberDirectoryStore } from "@opencrane/state/organization/members";

import type { MemberInviteSubmitIntent } from "./member-directory.types";
import { _MapMembersView } from "./members.mapper";
import { MembersViewComponent } from "./members-view.component";

/** Thin routed coordinator that composes independent read, create, resend, mapper, and view owners. */
@Component({ selector: "wo-members-route", standalone: true, imports: [MembersViewComponent], providers: [OrganizationMemberDirectoryStore, OrganizationInvitationCreateStore, OrganizationInvitationResendStore, OrganizationMemberRemovalStore], templateUrl: "./members-route.component.html", changeDetection: ChangeDetectionStrategy.OnPush })
export class MembersRouteComponent
{
	/** Independent directory read/refresh owner. */
	protected readonly directory = inject(OrganizationMemberDirectoryStore);
	/** Independent recipient validation and batch-create owner. */
	protected readonly create = inject(OrganizationInvitationCreateStore);
	/** Independent per-row resend owner. */
	protected readonly resend = inject(OrganizationInvitationResendStore);
	/** Exact membership command owner. */
	protected readonly removal = inject(OrganizationMemberRemovalStore);
	/** Controlled search text; filtering remains a pure mapper concern. */
	protected readonly searchQuery = signal("");
	/** One display-only projection assembled from the three narrow stores. */
	protected readonly view = computed(this._View.bind(this));

	/** Discards private search text when membership authority is lost. */
	public constructor()
	{
		effect(() =>
		{
			if (this.directory.accessGeneration() > 0)
				this.searchQuery.set("");
		});
	}

	/** Delegate the form draft to the create store. */
	protected async invite(intent: MemberInviteSubmitIntent): Promise<void>
	{
		const generation = this.directory.accessGeneration();
		const result = await this.create.invite(intent.emails, intent.role);
		if (result !== null && generation === this.directory.accessGeneration())
			this.directory.refresh();
	}

	/** Delegate one opaque row coordinate to the resend store. */
	protected async resendInvitation(invitationId: string): Promise<void>
	{
		const generation = this.directory.accessGeneration();
		if (await this.resend.resend(invitationId) && generation === this.directory.accessGeneration())
			this.directory.refresh();
	}

	/** Build presentation without changing any server-owned decision. */
	private _View()
	{
		const createResult = this.create.result();
		return _MapMembersView({
			directory: this.directory.directory(),
			directoryState: this.directory.state(),
			searchQuery: this.searchQuery(),
			refreshError: this.directory.refreshError(),
			inviteState: this.create.state(),
			inviteIssues: this.create.issues(),
			inviteError: this.create.error(),
			inviteLinks: createResult?.inviteLinks ?? [],
			resendingInvitationIds: this.resend.busyIds(),
			returnedInvitations: [...(createResult?.invitations ?? []), ...this.resend.invitations()],
			resentInviteLink: this.resend.link(),
			resendError: this.resend.error(),
			removingMembershipIds: this.removal.busyIds(),
			removalMessage: this.removal.message(),
			removalError: this.removal.error()
		});
	}
}
