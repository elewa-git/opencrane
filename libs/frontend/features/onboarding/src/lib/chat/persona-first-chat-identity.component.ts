import { NgClass } from "@angular/common";
import { ChangeDetectionStrategy, Component, input } from "@angular/core";

import { AvatarCircleComponent, AvatarSizes, AvatarTones, PersonaArchetypeTones, ScopeChipAppearances, ScopeChipComponent, ScopeChipTones } from "@opencrane/elements/ui";

import { PersonaFirstChatArchetypeClasses, type PersonaFirstChatIdentity, type PersonaFirstChatProvenance } from "./persona-first-chat.types";

/** Map the shared archetype vocabulary to the sole feature-owned provenance class. */
export function _PersonaFirstChatArchetypeClass(archetype: PersonaArchetypeTones): PersonaFirstChatArchetypeClasses
{
	switch (archetype)
	{
		case PersonaArchetypeTones.Commander: return PersonaFirstChatArchetypeClasses.Commander;
		case PersonaArchetypeTones.Catalyst: return PersonaFirstChatArchetypeClasses.Catalyst;
		case PersonaArchetypeTones.Anchor: return PersonaFirstChatArchetypeClasses.Anchor;
		case PersonaArchetypeTones.Analyst: return PersonaFirstChatArchetypeClasses.Analyst;
	}
}

/** Approved persona identity and immutable bootstrap provenance shown above the transcript. */
@Component({
	selector: "wo-persona-first-chat-identity",
	standalone: true,
	imports: [AvatarCircleComponent, NgClass, ScopeChipComponent],
	templateUrl: "./persona-first-chat-identity.component.html",
	styleUrl: "./persona-first-chat-identity.component.scss",
	changeDetection: ChangeDetectionStrategy.OnPush
})
export class PersonaFirstChatIdentityComponent
{
	/** Shared avatar treatments exposed to the template. */
	public readonly avatarTones = AvatarTones;

	/** Shared avatar sizes exposed to the template. */
	public readonly avatarSizes = AvatarSizes;

	/** Shared chip tones exposed to the template. */
	public readonly chipTones = ScopeChipTones;

	/** Shared chip appearances exposed to the template. */
	public readonly chipAppearances = ScopeChipAppearances;

	/** Approved personal-agent identity shown beside the shared avatar. */
	public readonly identity = input.required<PersonaFirstChatIdentity>();

	/** Exact persona and reviewed bootstrap source references. */
	public readonly provenance = input.required<PersonaFirstChatProvenance>();

	/** Approved archetype class selected without exposing arbitrary styling input. */
	public provenanceArchetypeClass(): PersonaFirstChatArchetypeClasses
	{
		return _PersonaFirstChatArchetypeClass(this.identity().archetype);
	}
}
