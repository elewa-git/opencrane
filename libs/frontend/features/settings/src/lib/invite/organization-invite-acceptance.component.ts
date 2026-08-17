import { ChangeDetectionStrategy, Component, OnInit, inject } from "@angular/core";
import { ActivatedRoute, Router } from "@angular/router";

import { OrganizationInviteAcceptanceStore } from "@opencrane/state/organization/members";

import { OrganizationInviteAcceptanceViewComponent } from "./organization-invite-acceptance-view.component";

/** Guarded invitation-consumption route that removes its token from the address bar before use. */
@Component({ selector: "wo-organization-invite-acceptance", standalone: true, imports: [OrganizationInviteAcceptanceViewComponent], providers: [OrganizationInviteAcceptanceStore], templateUrl: "./organization-invite-acceptance.component.html", changeDetection: ChangeDetectionStrategy.OnPush })
export class OrganizationInviteAcceptanceComponent implements OnInit
{
	/** Current route snapshot used once to obtain the opaque token. */
	private readonly _route = inject(ActivatedRoute);
	/** Router used to replace the token-bearing URL before network submission. */
	private readonly _router = inject(Router);
	/** Component-scoped acceptance command owner. */
	protected readonly acceptance = inject(OrganizationInviteAcceptanceStore);

	/** Remove the token from browser history, then submit it as the signed-in identity. */
	public async ngOnInit(): Promise<void>
	{
		const token = this._route.snapshot.queryParamMap.get("token") ?? "";
		await this._router.navigate([], { relativeTo: this._route, queryParams: {}, replaceUrl: true });
		await this.acceptance.accept(token);
	}
}
