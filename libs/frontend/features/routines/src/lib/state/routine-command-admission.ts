import { Injectable } from "@angular/core";

/** Identifies the two command owners that share one routine detail screen. */
export enum RoutineCommandOwners
{
	/** Create or revise form command. */
	Editor = "editor",
	/** Pause, resume, retire, or run-now command. */
	Control = "control",
}

/** Prevents editor and lifecycle controls from admitting conflicting commands on one screen. */
@Injectable({ providedIn: "root" })
export class RoutineCommandAdmission
{
	private _owner: RoutineCommandOwners | null = null;

	/** Admits the first owner and permits only that owner's explicit retry until release. */
	public admit(owner: RoutineCommandOwners): boolean
	{
		if (this._owner !== null && this._owner !== owner)
			return false;
		this._owner = owner;
		return true;
	}

	/** Releases only the owner that currently holds the command boundary. */
	public release(owner: RoutineCommandOwners): void
	{
		if (this._owner === owner)
			this._owner = null;
	}
}
