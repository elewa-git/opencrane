import { ChangeDetectionStrategy, Component, inject } from "@angular/core";
import { ConfirmationService } from "primeng/api";
import { ConfirmDialogModule } from "primeng/confirmdialog";
import { ResourceFeedbackComponent, SectionHeadingComponent } from "@opencrane/elements/ui";
import type { ModelKeyRow } from "./model-keys-admin.types";
import { ModelKeyRowComponent } from "./model-key-row/model-key-row.component";
import { ModelKeysAdminStore } from "./state/model-keys-admin.store";

/** Composes provider forms and owns the removal confirmation as a browser interaction. */
@Component({ selector: "wo-model-keys-admin", standalone: true, imports: [SectionHeadingComponent, ResourceFeedbackComponent, ModelKeyRowComponent, ConfirmDialogModule], providers: [ConfirmationService, ModelKeysAdminStore], templateUrl: "./model-keys-admin.component.html", styleUrl: "./model-keys-admin.component.scss", changeDetection: ChangeDetectionStrategy.OnPush })
export class ModelKeysAdminComponent
{
	/** Scoped reads, secret drafts and per-provider command lifecycle. */
	public readonly store = inject(ModelKeysAdminStore);
	/** Confirmation overlay belongs to this page's browser interaction. */
	private readonly _confirm = inject(ConfirmationService);
	/** Requests explicit removal before dispatching the provider command. */
	public confirmRemove(row: ModelKeyRow): void
	{
		const store = this.store;
		if (store.isBusy(row.provider) || !store.canAdminister())
			return;
		this._confirm.confirm({
			header: "Remove key",
			message: `Remove the ${row.label} key? Models relying on it stop working until a new key is set.`,
			icon: "pi pi-exclamation-triangle",
			acceptLabel: "Remove",
			rejectLabel: "Cancel",
			accept: function _RemoveConfirmed() { void store.remove(row.provider); }
		});
	}
}
