import { ChangeDetectionStrategy, Component, input, output } from "@angular/core";
import { ButtonModule } from "primeng/button";

import { AvatarCircleComponent, AvatarSizes, AvatarTones, ScopeChipAppearances, ScopeChipComponent, ScopeChipDensities } from "@opencrane/elements/ui";

import { MemberDirectoryRowKinds, type MemberDirectoryRowView } from "./member-directory.types";

/** One accessible member or invitation row with no data-access responsibility. */
@Component({ selector: "tr[wo-member-directory-row]", standalone: true, imports: [ButtonModule, AvatarCircleComponent, ScopeChipComponent], templateUrl: "./member-directory-row.component.html", styleUrl: "./member-directory-row.component.scss", changeDetection: ChangeDetectionStrategy.OnPush })
export class MemberDirectoryRowComponent
{
	/** Display-safe row supplied by the feature mapper. */
	public readonly row = input.required<MemberDirectoryRowView>();
	/** Emits the opaque invitation coordinate when resend is requested. */
	public readonly resendRequested = output<string>();
	/** Shared avatar sizes used by directory rows. */
	protected readonly avatarSizes = AvatarSizes;
	/** Shared avatar tones used by accepted and pending rows. */
	protected readonly avatarTones = AvatarTones;
	/** Shared chip appearance used by role and status labels. */
	protected readonly chipAppearances = ScopeChipAppearances;
	/** Readable directory-row chip density. */
	protected readonly chipDensities = ScopeChipDensities;
	/** Row kinds exposed for template semantics. */
	protected readonly rowKinds = MemberDirectoryRowKinds;
}
