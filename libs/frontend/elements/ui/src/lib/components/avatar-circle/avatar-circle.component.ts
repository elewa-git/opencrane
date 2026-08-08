import { ChangeDetectionStrategy, Component, input } from "@angular/core";

import { AvatarSizes, AvatarTones } from "./avatar-circle.types";

/** Initials avatar circle with a solid background colour. */
@Component({
	selector: "wo-avatar-circle",
	standalone: true,
	templateUrl: "./avatar-circle.component.html",
	styleUrl: "./avatar-circle.component.scss",
	changeDetection: ChangeDetectionStrategy.OnPush
})
export class AvatarCircleComponent
{
	/** Tone enum exposed to the template for typed class selection. */
	public readonly tones = AvatarTones;

	/** Size enum exposed to the template for typed class selection. */
	public readonly sizes = AvatarSizes;

	/** Initials to render. */
	public readonly initials = input.required<string>();

	/** Semantic colour treatment; raw colour values are deliberately rejected. */
	public readonly tone = input<AvatarTones>(AvatarTones.Brand);

	/** Finite size treatment; raw pixel values are deliberately rejected. */
	public readonly size = input<AvatarSizes>(AvatarSizes.Medium);

	/** Accessible identity label; omit only when adjacent text already names the person. */
	public readonly label = input<string | undefined>(undefined);
}
