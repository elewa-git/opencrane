import { ChangeDetectionStrategy, Component, computed, input } from "@angular/core";

import { ScopeLevel } from "@opencrane/core";
import { LedgerCardKinds } from "./ledger-card.types";
import { ScopeChipComponent } from "../scope-chip/scope-chip.component";
import { ScopeChipTones } from "../scope-chip/scope-chip.types";

/** Shared-chip tone for each knowledge scope rendered by ledger metadata. */
const _SCOPE_TONES: Record<ScopeLevel, ScopeChipTones> =
{
	[ScopeLevel.Org]: ScopeChipTones.Organization,
	[ScopeLevel.Dept]: ScopeChipTones.Department,
	[ScopeLevel.Project]: ScopeChipTones.Project,
	[ScopeLevel.Personal]: ScopeChipTones.Personal
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

	/** Knowledge scope of the entry. */
	public readonly scope = input<ScopeLevel | undefined>(undefined);

	/** Source reference. */
	public readonly entryRef = input<string | undefined>(undefined);

	/** Entry status chip text. */
	public readonly status = input<string | null | undefined>(undefined);

	/** Dim the label (resolved entries). */
	public readonly dimmed = input<boolean>(false);

	/** Semantic scope treatment for the scope chip. */
	public readonly scopeTone = computed<ScopeChipTones>(() =>
	{
		const level = this.scope();
		return level ? _SCOPE_TONES[level] : ScopeChipTones.Neutral;
	});
}
