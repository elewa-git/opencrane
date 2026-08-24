import { ChangeDetectionStrategy, Component, Signal, computed, inject, input, linkedSignal, resource } from "@angular/core";
import { FormsModule } from "@angular/forms";
import { RouterLink } from "@angular/router";

import { McpAccessPolicy, McpApprovalStatus, McpDirectory, McpEntitledGroup, McpEntitledUser, McpServer } from "@opencrane/core";
import { MCP_GATEWAY } from "@opencrane/state/mcp/adapter";
import { SessionStore } from "@opencrane/state/core";
import { AvatarCircleComponent, AvatarSizes, AvatarTones, ScopeChipComponent, SectionHeadingComponent } from "@opencrane/elements/ui";

import { MCP_TYPE_CHIPS } from "../../mcp-chip.constants";

/**
 * Access-policy management — maps servers → users / groups.
 *
 * Two-pane: a server list and, for the selected server, its entitlements
 * (everyone-in-org, groups, users) with add/remove. The selected server seeds
 * from the `server` query param (bound via `withComponentInputBinding`), so the
 * catalogue's "Assign access" deep-links straight in. Writes go through the
 * gateway's AccessPolicy update; gated in-component on the admin capability.
 */
@Component({
	selector: "wo-access-policy",
	standalone: true,
	imports: [SectionHeadingComponent, ScopeChipComponent, AvatarCircleComponent, FormsModule, RouterLink],
	templateUrl: "./access-policy.component.html",
	styleUrl: "./access-policy.component.scss",
	changeDetection: ChangeDetectionStrategy.OnPush
})
export class AccessPolicyComponent
{
	/** Finite avatar tones exposed for the template's neutral user identity. */
	public readonly avatarTones = AvatarTones;

	/** Finite avatar sizes exposed for dense entitlement chips. */
	public readonly avatarSizes = AvatarSizes;

	/** Active MCP data source (live OpenCrane when bound; mock in dev). */
	private readonly _gateway = inject(MCP_GATEWAY);

	/** App-wide session/identity (drives the admin capability gate). */
	private readonly _session = inject(SessionStore);

	/** Server id from the `?server=` query param (deep link from the catalogue). */
	public readonly server = input<string | undefined>(undefined);

	/** Full catalogue, for the server list. */
	private readonly _catalogue = resource({
		loader: (): Promise<McpServer[]> => this._gateway.listCatalogue()
	});

	/** Assignable users + groups, for the add controls. */
	private readonly _directory = resource({
		loader: (): Promise<McpDirectory> => this._gateway.getDirectory()
	});

	/** Whether the session may administer (else a denied state shows). */
	public readonly canAdminister: Signal<boolean> = computed((): boolean => this._session.capabilities().customerAdmin);

	/** Feature-owned labels and semantic tones for server-type chips. */
	public readonly typeChips = MCP_TYPE_CHIPS;

	/** All catalogue servers. */
	public readonly servers: Signal<McpServer[]> = computed((): McpServer[] => (this._catalogue.hasValue() ? this._catalogue.value() : []));

	/** Selected server id: seeds from the query param, else the first server; locally settable. */
	public readonly selectedId = linkedSignal<string | undefined>((): string | undefined => this.server() ?? this.servers()[0]?.id);

	/** Access policy for the selected server (reloads when the selection changes). */
	private readonly _policy = resource({
		params: (): string | undefined => this.selectedId(),
		loader: ({ params }: { params: string }): Promise<McpAccessPolicy> => this._gateway.getAccessPolicy(params)
	});

	/** The selected server's catalogue detail. */
	public readonly selectedServer: Signal<McpServer | undefined> = computed((): McpServer | undefined =>
	{
		const id = this.selectedId();
		return this.servers().find(function byId(server: McpServer): boolean { return server.id === id; });
	});

	/** The current policy, or null while loading. */
	public readonly policy: Signal<McpAccessPolicy | null> = computed((): McpAccessPolicy | null => (this._policy.hasValue() ? this._policy.value() : null));

	/** Groups not yet entitled, for the "add group" select. */
	public readonly availableGroups: Signal<McpEntitledGroup[]> = computed((): McpEntitledGroup[] =>
	{
		const directory = this._directory.hasValue() ? this._directory.value().groups : [];
		const current = this.policy()?.groups ?? [];
		return directory.filter(function _NotGranted(group: McpEntitledGroup): boolean { return !current.some(function _Same(candidate): boolean { return candidate.id === group.id; }); });
	});

	/** Users not yet entitled, for the "add user" select. */
	public readonly availableUsers: Signal<McpEntitledUser[]> = computed((): McpEntitledUser[] =>
	{
		const directory = this._directory.hasValue() ? this._directory.value().users : [];
		const current = this.policy()?.users ?? [];
		return directory.filter(function notGranted(user: McpEntitledUser): boolean { return !current.some(function same(granted: McpEntitledUser): boolean { return granted.id === user.id; }); });
	});

	/** Short entitlement count for a server row in the list. */
	public entitlementCount(server: McpServer): string
	{
		if (server.approvalStatus === McpApprovalStatus.Disabled)
		{
			return "off";
		}
		return server.entitlementSummary;
	}

	/** Select a server in the list. */
	public select(server: McpServer): void
	{
		this.selectedId.set(server.id);
	}

	/** Add a group entitlement from the select. */
	public async addGroup(event: Event): Promise<void>
	{
		const groupId = (event.target as HTMLSelectElement).value;
		(event.target as HTMLSelectElement).value = "";
		const group = this.availableGroups().find(function _ById(candidate): boolean { return candidate.id === groupId; });
		if (group)
		{
			await this._save(function _WithGroup(policy: McpAccessPolicy): McpAccessPolicy { return { ...policy, groups: [...policy.groups, group] }; });
		}
	}

	/** Remove a group entitlement. */
	public async removeGroup(groupId: string): Promise<void>
	{
		await this._save(function _WithoutGroup(policy: McpAccessPolicy): McpAccessPolicy
		{
			return { ...policy, groups: policy.groups.filter(function _Keep(candidate): boolean { return candidate.id !== groupId; }) };
		});
	}

	/** Add a user entitlement from the select. */
	public async addUser(event: Event): Promise<void>
	{
		const userId = (event.target as HTMLSelectElement).value;
		(event.target as HTMLSelectElement).value = "";
		const user = this.availableUsers().find(function byId(candidate: McpEntitledUser): boolean { return candidate.id === userId; });
		if (user)
		{
			await this._save(function withUser(policy: McpAccessPolicy): McpAccessPolicy { return { ...policy, users: [...policy.users, user] }; });
		}
	}

	/** Remove a user entitlement. */
	public async removeUser(userId: string): Promise<void>
	{
		await this._save(function withoutUser(policy: McpAccessPolicy): McpAccessPolicy
		{
			return { ...policy, users: policy.users.filter(function keep(candidate: McpEntitledUser): boolean { return candidate.id !== userId; }) };
		});
	}

	/** Apply a transform to the current policy, persist it, and refresh. */
	private async _save(transform: (policy: McpAccessPolicy) => McpAccessPolicy): Promise<void>
	{
		const current = this.policy();
		if (!current)
		{
			return;
		}
		await this._gateway.updateAccessPolicy(current.serverId, transform(current));
		this._policy.reload();
	}
}
