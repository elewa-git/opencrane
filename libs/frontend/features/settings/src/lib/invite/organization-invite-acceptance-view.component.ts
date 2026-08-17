import { ChangeDetectionStrategy, Component, input, output } from "@angular/core";
import { RouterLink } from "@angular/router";
import { ButtonModule } from "primeng/button";
import { MessageModule } from "primeng/message";
import { ProgressSpinnerModule } from "primeng/progressspinner";

import { OrganizationInviteAcceptanceStates, type OrganizationMember } from "@opencrane/state/organization/members";

/** Presentational invitation result that renders every acceptance state without consuming a token. */
@Component({ selector: "wo-organization-invite-acceptance-view", standalone: true, imports: [RouterLink, ButtonModule, MessageModule, ProgressSpinnerModule], templateUrl: "./organization-invite-acceptance-view.component.html", styleUrl: "./organization-invite-acceptance-view.component.scss", changeDetection: ChangeDetectionStrategy.OnPush })
export class OrganizationInviteAcceptanceViewComponent
{
	/** Current store-owned acceptance state. */
	public readonly state = input.required<OrganizationInviteAcceptanceStates>();
	/** Authoritative membership returned after successful acceptance. */
	public readonly member = input<OrganizationMember | null>(null);
	/** Browser-safe failure message for an unknown result. */
	public readonly error = input<string | null>(null);
	/** Requests the route-owned store to retry its retained token. */
	public readonly retryRequested = output<void>();
	/** Stable acceptance states exposed to explicit template branching. */
	protected readonly states = OrganizationInviteAcceptanceStates;
}
