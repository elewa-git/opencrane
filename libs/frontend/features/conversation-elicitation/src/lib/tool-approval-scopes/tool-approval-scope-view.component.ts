import { DOCUMENT } from "@angular/common";
import { ChangeDetectionStrategy, Component, computed, effect, inject, input, output, signal } from "@angular/core";
import { ConfirmationService } from "primeng/api";
import { ButtonModule } from "primeng/button";
import { ConfirmDialogModule } from "primeng/confirmdialog";
import { MessageModule } from "primeng/message";
import { SkeletonModule } from "primeng/skeleton";
import { TableModule } from "primeng/table";

import { ResourceFeedbackComponent, SectionHeadingComponent, SectionHeadingLevels } from "@opencrane/elements/ui";
import { ToolApprovalScopeReadStates } from "@opencrane/state/conversation/elicitation";

import { ToolApprovalScopeRowComponent } from "./tool-approval-scope-row.component";
import type { ToolApprovalScopeRowView, ToolApprovalScopeViewModel } from "./tool-approval-scope-view.types";

/** Present standing approvals, local confirmation and typed list/revoke intents. */
@Component({ selector: "wo-tool-approval-scope-view", standalone: true, imports: [ButtonModule, ConfirmDialogModule, MessageModule, ResourceFeedbackComponent, SectionHeadingComponent, SkeletonModule, TableModule, ToolApprovalScopeRowComponent], providers: [ConfirmationService], templateUrl: "./tool-approval-scope-view.component.html", styleUrl: "./tool-approval-scope-view.component.scss", changeDetection: ChangeDetectionStrategy.OnPush })
export class ToolApprovalScopeViewComponent
{
	/** Complete presentation projection supplied by the routed coordinator. */
	public readonly view = input.required<ToolApprovalScopeViewModel>();
	/** Requests a first-page authority read. */
	public readonly refreshRequested = output<void>();
	/** Requests the next server-owned opaque page. */
	public readonly loadMoreRequested = output<void>();
	/** Emits one confirmed opaque revocation target. */
	public readonly revokeRequested = output<string>();
	/** Shared heading hierarchy. */
	protected readonly headingLevels = SectionHeadingLevels;
	/** Read-state enum exposed to the template. */
	protected readonly readStates = ToolApprovalScopeReadStates;
	/** Mutable copy required by PrimeNG without giving it ownership of the controlled projection. */
	protected readonly rows = computed(() => [...this.view().rows]);
	/** PrimeNG confirmation owner. */
	private readonly _confirmation = inject(ConfirmationService);
	/** Browser focus owner used to return focus after cancellation. */
	private readonly _document = inject(DOCUMENT);
	/** Row awaiting local confirmation. */
	private readonly _targetId = signal<string | null>(null);
	/** Safe row currently named by the confirmation dialog. */
	protected readonly target = computed(this._Target.bind(this));

	/** Close a stale confirmation when the row changes, becomes revoked or starts its command. */
	public constructor()
	{
		effect(() =>
		{
			const target = this.target();
			if (this._targetId() !== null && (target === null || !target.canRevoke || target.busy))
			{
				this._targetId.set(null);
				this._confirmation.close();
			}
		});
	}

	/** Ask for explicit confirmation against the currently displayed safe summary. */
	protected confirmRevocation(scopeId: string): void
	{
		const target = this.view().rows.find(row => row.id === scopeId);
		if (!target?.canRevoke || target.busy || this._targetId() !== null)
			return;
		const origin = this._document.activeElement;
		this._targetId.set(scopeId);
		this._confirmation.confirm({ key: "standing-approval-revocation", header: "Revoke standing approval", message: "", icon: "pi pi-exclamation-triangle", defaultFocus: "reject", acceptButtonProps: { label: "Revoke approval", severity: "danger" }, rejectButtonProps: { label: "Cancel", severity: "secondary", outlined: true },
			accept: () =>
			{
				const current = this.target();
				if (this._targetId() !== scopeId || !current?.canRevoke || current.busy)
					return;
				this._targetId.set(null);
				this.revokeRequested.emit(scopeId);
			},
			reject: () =>
			{
				const returnFocus = this._targetId() === scopeId;
				this._targetId.set(null);
				if (returnFocus && origin instanceof HTMLElement && origin.isConnected)
					origin.focus();
			}
		});
	}

	/** Find the current target in the newest controlled projection. */
	private _Target(): ToolApprovalScopeRowView | null
	{
		const targetId = this._targetId();
		return targetId === null ? null : this.view().rows.find(row => row.id === targetId) ?? null;
	}
}
