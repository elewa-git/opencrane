import { ChangeDetectionStrategy, Component, inject } from "@angular/core";
import { ResourceFeedbackComponent, SectionHeadingComponent } from "@opencrane/elements/ui";
import { CatalogueAdminRowComponent } from "./catalogue-admin-row/catalogue-admin-row.component";
import { CatalogueAdminStore } from "./state/catalogue-admin.store";

/** Composes permission-aware governance rows and delegates all commands to its route store. */
@Component({ selector: "wo-catalogue-admin", standalone: true, imports: [SectionHeadingComponent, ResourceFeedbackComponent, CatalogueAdminRowComponent], providers: [CatalogueAdminStore], templateUrl: "./catalogue-admin.component.html", styleUrl: "./catalogue-admin.component.scss", changeDetection: ChangeDetectionStrategy.OnPush })
export class CatalogueAdminComponent
{
	/** Scoped authority reads and per-server command admission. */
	public readonly store = inject(CatalogueAdminStore);
}
