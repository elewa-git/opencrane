import { Injectable, effect, inject, signal } from "@angular/core";

import { _CreateInviteCommand, _DuplicateInviteIssues, _InviteRecipientIssue, _NormalizeInviteEmails } from "./invitation-command.utils";
import { OrganizationMemberDirectoryStore } from "./organization-member-directory.store";
import { OrganizationMemberDirectoryStates } from "./organization-member-directory.types";
import { OrganizationMembersGatewayError } from "./organization-members.errors";
import { OrganizationMembersGatewayErrorKinds } from "./organization-members-gateway.types";
import { ORGANIZATION_MEMBERS_GATEWAY } from "./organization-members.gateway";
import { _OrganizationMembersCommandMessage } from "./organization-members-error-mapper";
import { OrganizationInviteCommandStates, type CreateOrganizationInvitationsCommand, type CreateOrganizationInvitationsResult, type OrganizationInviteIssue } from "./organization-invitations.types";
import { OrganizationMemberRoles } from "./organization-member-directory.types";

/**
 * Owns recipient validation and idempotent batch creation for one locally owned invite draft.
 * Keeping this command separate preserves one retry key for an unchanged failed draft without
 * blocking directory refreshes or per-row resend commands.
 */
@Injectable()
export class OrganizationInvitationCreateStore
{
	/** Ordinary user-session membership port. */
	private readonly _gateway = inject(ORGANIZATION_MEMBERS_GATEWAY);
	private readonly _directory = inject(OrganizationMemberDirectoryStore);
	private _generation = this._directory.accessGeneration();
	/** Current validation/create lifecycle. */
	private readonly _state = signal(OrganizationInviteCommandStates.Editing);
	/** Per-recipient validation issues. */
	private readonly _issues = signal<readonly OrganizationInviteIssue[]>([]);
	/** Browser-safe create failure. */
	private readonly _error = signal<string | null>(null);
	/** Latest authoritative create result. */
	private readonly _result = signal<CreateOrganizationInvitationsResult | null>(null);
	/** Exact unresolved command whose key must survive a retry. */
	private _pending: CreateOrganizationInvitationsCommand | null = null;

	/** Public validation/create lifecycle. */
	public readonly state = this._state.asReadonly();
	/** Public recipient issues. */
	public readonly issues = this._issues.asReadonly();
	/** Public create failure. */
	public readonly error = this._error.asReadonly();
	/** Public authoritative create result, including server-authored links. */
	public readonly result = this._result.asReadonly();

	/** Clears returned links, drafts and command locks when current access is lost. */
	public constructor()
	{
		effect(() => { this._SyncAccess(); });
	}

	/** Reset command feedback when the presentational form opens or closes. */
	public reset(): void
	{
		if (this._Busy())
			return;
		this._state.set(OrganizationInviteCommandStates.Editing);
		this._issues.set([]);
		this._error.set(null);
		this._result.set(null);
		this._pending = null;
	}

	/** Validates and creates the current draft while retaining its server idempotency key across retries. */
	public async invite(emails: readonly string[], role: Exclude<OrganizationMemberRoles, OrganizationMemberRoles.Owner>): Promise<CreateOrganizationInvitationsResult | null>
	{
		this._SyncAccess();
		if (this._directory.state() === OrganizationMemberDirectoryStates.Forbidden || this._Busy())
			return null;
		const generation = this._generation;
		const normalizedDraft = _NormalizeInviteEmails(emails);
		const localIssues = _DuplicateInviteIssues(normalizedDraft);
		if (normalizedDraft.length === 0 || localIssues.length > 0)
		{
			this._issues.set(normalizedDraft.length === 0 ? [{ email: "", message: "Enter at least one email address." }] : localIssues);
			this._state.set(OrganizationInviteCommandStates.Invalid);
			return null;
		}

		this._state.set(OrganizationInviteCommandStates.Validating);
		this._issues.set([]);
		this._error.set(null);
		this._result.set(null);
		try
		{
			const validation = await this._gateway.validate(normalizedDraft);
			if (generation !== this._directory.accessGeneration())
				return null;
			const issues = validation.recipients.filter(recipient => !recipient.valid).map(_InviteRecipientIssue);
			if (issues.length > 0)
			{
				this._issues.set(issues);
				this._state.set(OrganizationInviteCommandStates.Invalid);
				return null;
			}
			const normalizedEmails = validation.recipients.map(recipient => recipient.normalizedEmail);
			const command = _CreateInviteCommand(this._pending, normalizedEmails, role);
			this._pending = command;
			this._state.set(OrganizationInviteCommandStates.Submitting);
			const result = await this._gateway.invite(command);
			if (generation !== this._directory.accessGeneration())
				return null;
			this._result.set(result);
			this._pending = null;
			this._state.set(result.invitations.length === normalizedEmails.length ? OrganizationInviteCommandStates.Success : OrganizationInviteCommandStates.Partial);
			return result;
		}
		catch (error)
		{
			if (generation !== this._directory.accessGeneration())
				return null;
			if (error instanceof OrganizationMembersGatewayError && error.kind === OrganizationMembersGatewayErrorKinds.Forbidden)
			{
				this._directory.forbid();
				this._SyncAccess();
				return null;
			}
			this._state.set(OrganizationInviteCommandStates.Failure);
			this._error.set(_OrganizationMembersCommandMessage(error, "OpenCrane could not create these invitations. Retry without changing the draft."));
			return null;
		}
	}

	/** Whether validation or create authority is already handling this draft. */
	private _Busy(): boolean
	{
		return this._state() === OrganizationInviteCommandStates.Validating || this._state() === OrganizationInviteCommandStates.Submitting;
	}

	/** Invalidates in-flight callbacks before clearing private invitation state. */
	private _SyncAccess(): void
	{
		const generation = this._directory.accessGeneration();
		if (generation === this._generation)
			return;
		this._generation = generation;
		this._state.set(OrganizationInviteCommandStates.Editing);
		this._issues.set([]);
		this._error.set(null);
		this._result.set(null);
		this._pending = null;
	}
}
