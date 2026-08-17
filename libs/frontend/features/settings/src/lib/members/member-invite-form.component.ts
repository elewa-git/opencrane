import { ChangeDetectionStrategy, Component, computed, input, output, signal } from "@angular/core";
import { FormsModule } from "@angular/forms";
import { AutoCompleteModule } from "primeng/autocomplete";
import { ButtonModule } from "primeng/button";
import { MessageModule } from "primeng/message";
import { SelectModule } from "primeng/select";

import { OrganizationInviteCommandStates, OrganizationMemberRoles, type OrganizationInviteIssue } from "@opencrane/state/organization/members";

import type { MemberInviteSubmitIntent, MemberRoleOption } from "./member-directory.types";
import { MemberInviteLinkComponent } from "./member-invite-link.component";

/** Free-entry multi-recipient form that owns draft tokens and role without owning validation policy. */
@Component({ selector: "wo-member-invite-form", standalone: true, imports: [FormsModule, AutoCompleteModule, ButtonModule, MessageModule, SelectModule, MemberInviteLinkComponent], templateUrl: "./member-invite-form.component.html", styleUrl: "./member-invite-form.component.scss", changeDetection: ChangeDetectionStrategy.OnPush })
export class MemberInviteFormComponent
{
	/** Store-owned validation/create lifecycle. */
	public readonly state = input.required<OrganizationInviteCommandStates>();
	/** Store-translated recipient issues. */
	public readonly issues = input<readonly OrganizationInviteIssue[]>([]);
	/** Browser-safe create failure. */
	public readonly error = input<string | null>(null);
	/** Server-authored links returned by authority. */
	public readonly links = input<readonly string[]>([]);
	/** Requests form dismissal; admitted commands cannot emit it. */
	public readonly cancelled = output<void>();
	/** Emits the exact local draft for store validation and create admission. */
	public readonly submitted = output<MemberInviteSubmitIntent>();
	/** Free-entry recipient tokens owned only by this form. */
	protected readonly emails = signal<string[]>([]);
	/** Assignable role owned only by this form. */
	protected readonly role = signal<Exclude<OrganizationMemberRoles, OrganizationMemberRoles.Owner>>(OrganizationMemberRoles.Member);
	/** Stable role choices; Owner is deliberately absent. */
	protected readonly roleOptions: MemberRoleOption[] = [
		{ label: "Member", value: OrganizationMemberRoles.Member },
		{ label: "Admin", value: OrganizationMemberRoles.Admin }
	];
	/** Empty suggestions because AutoComplete is used for its accessible free-entry token mode. */
	protected readonly suggestions: string[] = [];
	/** Typed command states exposed to the template. */
	protected readonly states = OrganizationInviteCommandStates;
	/** Whether validation or create authority is handling this draft. */
	protected readonly busy = computed(this._Busy.bind(this));
	/** Dynamic primary action label. */
	protected readonly submitLabel = computed(this._SubmitLabel.bind(this));

	/** Adopt PrimeNG's mutable form value into the local signal draft. */
	protected updateEmails(value: unknown): void
	{
		if (!Array.isArray(value)) return;
		this.emails.set(value.filter(function strings(candidate: unknown): candidate is string { return typeof candidate === "string"; }));
	}

	/** Adopt one assignable role selected through PrimeNG. */
	protected updateRole(value: unknown): void
	{
		if (value === OrganizationMemberRoles.Admin || value === OrganizationMemberRoles.Member) this.role.set(value);
	}

	/** Emit the exact current draft without validating or normalizing it locally. */
	protected submit(): void { if (!this.busy()) this.submitted.emit({ emails: this.emails(), role: this.role() }); }

	/** Dismiss the form only while no command is admitted. */
	protected cancel(): void { if (!this.busy()) this.cancelled.emit(); }

	/** Return true only during the store's two admitted command phases. */
	private _Busy(): boolean
	{
		return this.state() === OrganizationInviteCommandStates.Validating || this.state() === OrganizationInviteCommandStates.Submitting;
	}

	/** Describe the exact create action against the current number of tokens. */
	private _SubmitLabel(): string
	{
		const count = this.emails().length;
		return count === 1 ? "Create 1 invite" : `Create ${count} invites`;
	}
}
