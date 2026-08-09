import { ChangeDetectionStrategy, Component, Signal, computed, inject, resource } from "@angular/core";
import { Router } from "@angular/router";

import { McpApprovalStatus, McpServer } from "@opencrane/core";
import { MCP_GATEWAY } from "@opencrane/state/mcp/adapter";
import { SessionStore } from "@opencrane/state/core";
import { ScopeChipComponent, SectionHeadingComponent } from "@opencrane/elements/ui";

import { MCP_APPROVAL_CHIPS, MCP_TYPE_CHIPS } from "../../mcp-chip.constants";

/**
 * Catalogue — admin governance view.
 *
 * The org admin's source of truth for **every** server, including pending and
 * disabled ones users never see. Drives each server through its lifecycle
 * (approve → publish, reject, disable/re-enable) and deep-links to the
 * access-policy editor. Access is gated in-component on
 * {@link SessionStore.capabilities}`().customerAdmin`; the control plane remains
 * the real enforcement point.
 */
@Component({
	selector: "wo-catalogue-admin",
	standalone: true,
	imports: [SectionHeadingComponent, ScopeChipComponent],
	templateUrl: "./catalogue-admin.component.html",
	styleUrl: "./catalogue-admin.component.scss",
	changeDetection: ChangeDetectionStrategy.OnPush
})
export class CatalogueAdminComponent
{
	/** Active MCP data source (live OpenCrane when bound; mock in dev). */
	private readonly _gateway = inject(MCP_GATEWAY);

	/** App-wide session/identity (drives the admin capability gate). */
	private readonly _session = inject(SessionStore);

	/** Router, for the "Assign access" deep link. */
	private readonly _router = inject(Router);

	/** Full catalogue incl. pending/disabled (admin scope). */
	private readonly _catalogue = resource({
		loader: (): Promise<McpServer[]> => this._gateway.listCatalogue()
	});

	/** Whether the session may use the admin console (else a denied state shows). */
	public readonly canAdminister: Signal<boolean> = computed((): boolean => this._session.capabilities().customerAdmin);

	/** Feature-owned labels and semantic tones for approval-status chips. */
	public readonly approvalChips = MCP_APPROVAL_CHIPS;

	/** Feature-owned labels and semantic tones for server-type chips. */
	public readonly typeChips = MCP_TYPE_CHIPS;

	/** Approval-status enum for the template. */
	public readonly status = McpApprovalStatus;

	/** All catalogue servers. */
	public readonly servers: Signal<McpServer[]> = computed((): McpServer[] => (this._catalogue.hasValue() ? this._catalogue.value() : []));

	/** Count of servers awaiting review, for the heading subtitle. */
	public readonly pendingCount: Signal<number> = computed((): number =>
	{
		return this.servers().filter(function isPending(server: McpServer): boolean { return server.approvalStatus === McpApprovalStatus.PendingReview; }).length;
	});

	/** Approve a pending server, then refresh. */
	public async approve(server: McpServer): Promise<void>
	{
		await this._gateway.approve(server.id);
		this._catalogue.reload();
	}

	/** Publish an approved server, then refresh. */
	public async publish(server: McpServer): Promise<void>
	{
		await this._gateway.publish(server.id);
		this._catalogue.reload();
	}

	/** Reject a pending server, then refresh. */
	public async reject(server: McpServer): Promise<void>
	{
		await this._gateway.reject(server.id);
		this._catalogue.reload();
	}

	/** Toggle a published/disabled server's enabled state, then refresh. */
	public async setEnabled(server: McpServer, enabled: boolean): Promise<void>
	{
		await this._gateway.setEnabled(server.id, enabled);
		this._catalogue.reload();
	}

	/** Deep-link to the access-policy editor with the server pre-selected. */
	public assignAccess(server: McpServer): void
	{
		void this._router.navigate(["/admin/access-policy"], { queryParams: { server: server.id } });
	}
}
