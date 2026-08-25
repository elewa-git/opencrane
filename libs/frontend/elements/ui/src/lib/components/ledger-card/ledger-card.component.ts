import { ChangeDetectionStrategy, Component, computed, input } from "@angular/core";

import { ResourceBoundaryKind } from "@opencrane/core";
import { LedgerCardKinds } from "./ledger-card.types";
import { ScopeChipComponent } from "../scope-chip/scope-chip.component";
import { ScopeChipTones } from "../scope-chip/scope-chip.types";

/** Shared-chip tone for each resource boundary kind rendered by ledger metadata. */
const _SCOPE_TONES: Record<ResourceBoundaryKind, ScopeChipTones> =
{
	[ResourceBoundaryKind.Group]: ScopeChipTones.Organization,
	[ResourceBoundaryKind.Personal]: ScopeChipTones.Personal
};

/** Observation / policy / action ledger card (used in chat and ledger tab). */
@Component({
	selector: "wo-ledger-card",
	standalone: true,
	imports: [ScopeChipComponent],
	templateUrl: "./ledger-card.component.html",
	styleUrl: "./ledger-card.component.scss",
	changeDetection: ChangeDetectionStrategy.OnPush
})
export class LedgerCardComponent
{
	/** Entry-kind enum exposed to the template for typed class selection. */
	public readonly kinds = LedgerCardKinds;

	/** Entry id (e.g. "R1"). */
	public readonly entryId = input.required<string>();

	/** Finite semantic entry kind; arbitrary visual values are deliberately rejected. */
	public readonly kind = input.required<LedgerCardKinds>();

	/** Entry label text. */
	public readonly label = input.required<string>();

	/** Resource boundary kind of the entry. */
	public readonly boundaryKind = input<ResourceBoundaryKind | undefined>(undefined);

	/** Source reference. */
	public readonly entryRef = input<string | undefined>(undefined);

	/** Entry status chip text. */
	public readonly status = input<string | null | undefined>(undefined);

	/** Dim the label (resolved entries). */
	public readonly dimmed = input<boolean>(false);

	/** Semantic scope treatment for the scope chip. */
	public readonly scopeTone = computed<ScopeChipTones>(() =>
	{
		const boundaryKind = this.boundaryKind();
		return boundaryKind ? _SCOPE_TONES[boundaryKind] : ScopeChipTones.Neutral;
	});
}
