import { readFileSync } from "node:fs";
import { join } from "node:path";

import { CUSTOM_ELEMENTS_SCHEMA, NO_ERRORS_SCHEMA, signal, ɵresolveComponentResources as resolveComponentResources, type Type } from "@angular/core";
import { TestBed } from "@angular/core/testing";
import { BrowserDynamicTestingModule, platformBrowserDynamicTesting } from "@angular/platform-browser-dynamic/testing";
import { ActivatedRoute, convertToParamMap, Router } from "@angular/router";
import { of } from "rxjs";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { ROUTINE_GATEWAY, ROUTINE_SESSION, type RoutineGateway } from "@opencrane/state/routines";

import { RoutineShellComponent } from "../components/routine-shell/routine-shell.component";
import { RoutineCreateRouteComponent } from "../routes/routine-create-route.component";
import { RoutineDetailRouteComponent } from "../routes/routine-detail-route.component";
import { RoutineListRouteComponent } from "../routes/routine-list-route.component";
import { _RouteCoordinate } from "../routes/routine-route-coordinate";
import { ROUTINE_ROUTES } from "../routines.routes";
import { RoutineReadStates, RoutineSubmitOutcomes } from "../routine-presentation.types";
import { RoutineEditorStore } from "../state/routine-editor.store";

const _ROUTE_TEMPLATES: ReadonlyArray<readonly [string, Type<unknown>, string]> = [
	["shell", RoutineShellComponent, "src/lib/components/routine-shell/routine-shell.component.html"],
	["list", RoutineListRouteComponent, "src/lib/routes/routine-list-route.component.html"],
	["create", RoutineCreateRouteComponent, "src/lib/routes/routine-create-route.component.html"],
	["detail", RoutineDetailRouteComponent, "src/lib/routes/routine-detail-route.component.html"],
];

beforeAll(async function _InitializeAngularTesting(): Promise<void>
{
	TestBed.initTestEnvironment(BrowserDynamicTestingModule, platformBrowserDynamicTesting());
	await resolveComponentResources(async function _ResolveResource(): Promise<string> { return ""; });
});

afterEach(function _ResetTestBed(): void
{
	TestBed.resetTestingModule();
});

afterAll(function _ResetAngularTesting(): void
{
	TestBed.resetTestEnvironment();
});

describe("routine routes", function _RoutineRoutesSuite()
{
	it("keeps the static creation route before the routine-id parameter route", function _StaticRouteOrder()
	{
		const children = ROUTINE_ROUTES[0]?.children ?? [];
		const newIndex = children.findIndex(route => route.path === "new");
		const routineIdIndex = children.findIndex(route => route.path === ":routineId");

		expect(newIndex).toBeGreaterThanOrEqual(0);
		expect(routineIdIndex).toBeGreaterThan(newIndex);
	});

	it.each([null, "", " ", " routine-1", "routine-1 ", "x".repeat(201)] as const)("rejects invalid route coordinate %s", function _InvalidCoordinate(value)
	{
		expect(_RouteCoordinate(value)).toBeNull();
	});

	it("retains a bounded opaque route coordinate exactly", function _ValidCoordinate()
	{
		expect(_RouteCoordinate("routine-1")).toBe("routine-1");
	});

	it("rejects a create destination when the query contains duplicate coordinates", function _DuplicateDestination()
	{
		TestBed.overrideComponent(RoutineCreateRouteComponent, { set: { templateUrl: undefined, template: "", styleUrl: undefined, styleUrls: [], styles: [], imports: [] } });
		TestBed.configureTestingModule({ imports: [RoutineCreateRouteComponent], providers: _Providers(["one", "two"]) });
		const fixture = TestBed.createComponent(RoutineCreateRouteComponent);
		fixture.detectChanges();

		const destination = (fixture.componentInstance as unknown as { destination: () => string | null }).destination;
		expect(destination()).toBeNull();
	});

	it("passes the opaque proposal reference while retaining the query destination only as a hint", function _ProposalRouteInput()
	{
		const store = { optionsState: signal(RoutineReadStates.Idle), proposalState: signal(null), acceptedRoutineId: signal(null), proposalError: signal(null), destinationConversationId: signal(null), retryOptions: vi.fn(), retryProposal: vi.fn(), cancelProposal: vi.fn(), startCreate: vi.fn() } as unknown as RoutineEditorStore;
		TestBed.overrideComponent(RoutineCreateRouteComponent, { set: { templateUrl: undefined, template: "", styleUrl: undefined, styleUrls: [], styles: [], imports: [], providers: [{ provide: RoutineEditorStore, useValue: store }] } });
		TestBed.configureTestingModule({ imports: [RoutineCreateRouteComponent], providers: _Providers(["query-conversation"], ["proposal-opaque"]) });
		const fixture = TestBed.createComponent(RoutineCreateRouteComponent);
		fixture.detectChanges();

		expect(store.startCreate).toHaveBeenCalledWith("query-conversation", "proposal-opaque");
	});

	it("does not navigate after a pending create resolves after route destruction", async function _DestroyedCreateDoesNotNavigate()
	{
		const pending = _Deferred<{ readonly outcome: RoutineSubmitOutcomes; readonly routineId?: string }>();
		const store = { startCreate: vi.fn(), submitCreate: vi.fn().mockReturnValue(pending.promise) } as unknown as RoutineEditorStore;
		const navigate = vi.fn().mockResolvedValue(true);
		TestBed.overrideComponent(RoutineCreateRouteComponent, { set: { templateUrl: undefined, template: "", styleUrl: undefined, styleUrls: [], styles: [], imports: [], providers: [{ provide: RoutineEditorStore, useValue: store }] } });
		TestBed.configureTestingModule({ imports: [RoutineCreateRouteComponent], providers: [..._Providers(["one"]), { provide: Router, useValue: { navigate } }] });
		const fixture = TestBed.createComponent(RoutineCreateRouteComponent);
		fixture.detectChanges();
		const submit = (fixture.componentInstance as unknown as { submit: () => Promise<void> }).submit.bind(fixture.componentInstance);
		const operation = submit();
		fixture.destroy();
		pending.resolve({ outcome: RoutineSubmitOutcomes.Committed, routineId: "routine-1" });
		await operation;

		expect(navigate).not.toHaveBeenCalled();
	});

	it("does not describe an idle purged creation screen as still preparing", function _PurgedCreationCopy()
	{
		const template = readFileSync(join(process.cwd(), "src/lib/routes/routine-create-route.component.html"), "utf8");
		const store = { optionsState: signal(RoutineReadStates.Idle), proposalState: signal(null), acceptedRoutineId: signal(null), proposalError: signal(null), destinationConversationId: signal(null), retryOptions: vi.fn(), retryProposal: vi.fn(), cancelProposal: vi.fn(), startCreate: vi.fn() } as unknown as RoutineEditorStore;
		TestBed.overrideComponent(RoutineCreateRouteComponent, { set: { templateUrl: undefined, template, styleUrl: undefined, styleUrls: [], styles: [], imports: [], schemas: [NO_ERRORS_SCHEMA], providers: [{ provide: RoutineEditorStore, useValue: store }] } });
		TestBed.configureTestingModule({ imports: [RoutineCreateRouteComponent], providers: _Providers(["conversation-1"]) });
		const fixture = TestBed.createComponent(RoutineCreateRouteComponent);
		fixture.detectChanges();
		const text = fixture.nativeElement.textContent as string;
		expect(text).toContain("Routine setup unavailable");
		expect(text).toContain("Return to chat");
		expect(text).not.toContain("Preparing routine choices");
	});

	it.each(_ROUTE_TEMPLATES)("compiles the %s route template", function _CompilesTemplate(_name, component, templatePath)
	{
		const template = readFileSync(join(process.cwd(), templatePath), "utf8");
		TestBed.overrideComponent(component, { set: { templateUrl: undefined, template, styleUrl: undefined, styleUrls: [], styles: [], imports: [], schemas: [CUSTOM_ELEMENTS_SCHEMA] } });
		TestBed.configureTestingModule({ imports: [component], providers: _Providers() });

		const fixture = TestBed.createComponent(component);
		expect(() => fixture.detectChanges()).not.toThrow();
	});
});

function _Providers(destinationValues: readonly string[] = [], proposalValues: readonly string[] = []): unknown[]
{
	const unavailable = vi.fn().mockRejectedValue(new Error("Unexpected route test gateway call"));
	const gateway: RoutineGateway = { list: unavailable, read: unavailable, firings: unavailable, creationOptions: unavailable, proposal: unavailable, cancelProposal: unavailable, preview: unavailable, create: unavailable, revise: unavailable, pause: unavailable, resume: unavailable, retire: unavailable, runNow: unavailable };
	const queryParamMap = convertToParamMap({ ..._OptionalQuery("destination", destinationValues), ..._OptionalQuery("proposalRef", proposalValues) });
	const route: Partial<ActivatedRoute> = { paramMap: of(convertToParamMap({})), queryParamMap: of(queryParamMap), snapshot: { paramMap: convertToParamMap({}), queryParamMap } as ActivatedRoute["snapshot"] };

	return [{ provide: ROUTINE_GATEWAY, useValue: gateway }, { provide: ROUTINE_SESSION, useValue: () => null }, { provide: Router, useValue: { navigate: vi.fn() } }, { provide: ActivatedRoute, useValue: route }];
}

/** Adds one route query only when its fixture supplies values. */
function _OptionalQuery(key: string, values: readonly string[]): Record<string, readonly string[]>
{
	if (values.length === 0)
		return {};
	return { [key]: values };
}

function _Deferred<T>(): { readonly promise: Promise<T>; resolve(value: T): void }
{
	let resolvePromise: ((value: T) => void) | null = null;
	const promise = new Promise<T>(resolve => { resolvePromise = resolve; });
	return { promise, resolve(value: T): void { resolvePromise?.(value); } };
}
