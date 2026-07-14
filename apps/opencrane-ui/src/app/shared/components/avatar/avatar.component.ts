import { ChangeDetectionStrategy, Component, input } from "@angular/core";
import { AvatarModule } from "primeng/avatar";

/** Accessible initials avatar shared by the sidebar, messages, and Settings. */
@Component({
	selector: "oc-avatar",
	imports: [AvatarModule],
	templateUrl: "./avatar.component.html",
	styleUrl: "./avatar.component.scss",
	changeDetection: ChangeDetectionStrategy.OnPush
})
export class AvatarComponent
{
	/** Initials displayed inside the avatar. */
	public readonly initials = input.required<string>();

	/** Accessible identity label. */
	public readonly label = input.required<string>();

	/** Avatar diameter in pixels. */
	public readonly size = input<number>(32);

	/** Stable zero-based palette index. */
	public readonly palette = input<number>(0);
}
