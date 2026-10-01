import { readFileSync } from "node:fs";
import { join } from "node:path";

import { ChangeDetectionStrategy, Component, EventEmitter, type InputSignal, type Type, ɵInputSignalNode as InputSignalNode, ɵSIGNAL as SIGNAL } from "@angular/core";
import { TestBed } from "@angular/core/testing";
import { ButtonModule } from "primeng/button";
import { TableModule } from "primeng/table";

/** Keeps the heading's real action slot while source-mode tests do not compile its signal inputs. */
@Component({ selector: "wo-section-heading", standalone: true, inputs: ["title", "subtitle", "level"], template: "<h2>{{ title }}</h2><p>{{ subtitle }}</p><ng-content select='[heading-actions]' />", changeDetection: ChangeDetectionStrategy.OnPush })
class _HeadingStub
{
	/** Receives the rendered title. */
	public title = "";
	/** Receives the explanatory copy. */
	public subtitle = "";
	/** Retains the hierarchy binding for the production component. */
	public level: unknown;
}

/** Preserves the existing feedback input/output boundary without duplicating its production code. */
@Component({ selector: "wo-resource-feedback", standalone: true, inputs: ["loading", "loadingLabel", "error", "retryAvailable"], outputs: ["retryRequested"], template: "@if (loading) { <p role='status'>{{ loadingLabel }}</p> } @if (error) { <p role='alert'>{{ error }}</p> } @if (retryAvailable) { <button type='button' [disabled]='loading' (click)='retryRequested.emit()'>Try again</button> }", changeDetection: ChangeDetectionStrategy.OnPush })
class _FeedbackStub
{
	/** Receives read progress. */
	public loading = false;
	/** Receives progress copy. */
	public loadingLabel = "";
	/** Receives display-safe failure copy. */
	public error: string | null = null;
	/** Receives read-retry availability. */
	public retryAvailable = false;
	/** Emits the shared read-retry intent. */
	public readonly retryRequested = new EventEmitter<void>();
}

/** Mounts a real reporting template and real PrimeNG table with unrelated shared-input doubles. */
export function _CreateReportingFixture<T>(component: Type<T>, templatePath: string)
{
	TestBed.overrideComponent(component, { set: { templateUrl: undefined, template: readFileSync(join(process.cwd(), "src/lib", templatePath), "utf8"), styleUrl: undefined, styleUrls: [], styles: [], imports: [ButtonModule, TableModule, _HeadingStub, _FeedbackStub] } });
	return TestBed.createComponent(component);
}

/** Sets signal inputs directly because source-mode JIT cannot discover their generated metadata. */
export function _SetReportingInput<T>(target: InputSignal<T>, value: T): void
{
	const node = target[SIGNAL] as InputSignalNode<T, T>;
	node.applyValueToInputSignal(node, value);
}

/** Finds a rendered native button by its visible accessible name. */
export function _ReportingButton(element: HTMLElement, label: string): HTMLButtonElement
{
	const button = [...element.querySelectorAll("button")].find(candidate => candidate.textContent?.trim() === label);
	if (button === undefined)
		throw new Error(`Button not found: ${label}`);
	return button;
}
