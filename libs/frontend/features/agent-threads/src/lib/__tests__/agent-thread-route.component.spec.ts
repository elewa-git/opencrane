// @vitest-environment jsdom

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { Location } from "@angular/common";
import { ɵInputSignalNode as InputSignalNode, type InputSignal, ɵresolveComponentResources as resolveComponentResources, ɵSIGNAL as SIGNAL } from "@angular/core";
import { TestBed } from "@angular/core/testing";
import { BrowserDynamicTestingModule, platformBrowserDynamicTesting } from "@angular/platform-browser-dynamic/testing";
import { Router } from "@angular/router";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import type { AgentThreadParentRestoreIntent } from "@opencrane/state/conversation/agent-threads";

import { AgentThreadRouteComponent } from "../agent-thread-route.component.js";
import type { AgentThreadProjectionPurgeIntent } from "../agent-thread-feature.types.js";

interface AgentThreadRouteTestSubject
{
	readonly parentConversationId: InputSignal<string>;
	readonly childConversationId: InputSignal<string>;
	readonly focusTarget: () => unknown;
	readonly parentRestore: () => AgentThreadParentRestoreIntent | null;
	restoreParent(intent: AgentThreadParentRestoreIntent): void;
	openChats(): Promise<void>;
	purgeChildProjection(intent: AgentThreadProjectionPurgeIntent): void;
}

function _SetInput<TValue>(target: InputSignal<TValue>, value: TValue): void
{
	const node = target[SIGNAL] as InputSignalNode<TValue, TValue>;
	node.applyValueToInputSignal(node, value);
}

beforeAll(async function _InitializeAngularTesting()
{
	TestBed.initTestEnvironment(BrowserDynamicTestingModule, platformBrowserDynamicTesting());
	await resolveComponentResources(async function _ResolveResource(url): Promise<string>
	{
		if (url.endsWith("agent-thread-route.component.html")) return readFileSync(join(process.cwd(), "src/lib/agent-thread-route.component.html"), "utf8");
		return "";
	});
});

afterEach(function _ResetTestBed() { TestBed.resetTestingModule(); });
afterAll(function _ResetAngularTesting() { TestBed.resetTestEnvironment(); });

describe("Agent-thread route coordinator", function _AgentThreadRouteCoordinator()
{
	it("restores only the parent named by the current route", async function _RestoresMatchingParent()
	{
		const location = { back: vi.fn(), getState: vi.fn().mockReturnValue({ parentRestore: { parentConversationId: "parent", parentMessageId: "message", parentScrollAnchor: "anchor" } }), path: vi.fn().mockReturnValue("/chats/parent/threads/child"), replaceState: vi.fn() };
		const router = { navigateByUrl: vi.fn().mockResolvedValue(true) };
		TestBed.configureTestingModule({ imports: [AgentThreadRouteComponent], providers: [{ provide: Location, useValue: location }, { provide: Router, useValue: router }] });
		TestBed.overrideComponent(AgentThreadRouteComponent, { set: { imports: [], template: "" } });
		const subject = TestBed.createComponent(AgentThreadRouteComponent).componentInstance as unknown as AgentThreadRouteTestSubject;
		_SetInput(subject.parentConversationId, "parent");
		_SetInput(subject.childConversationId, "child");
		expect(subject.parentRestore()).toEqual({ parentConversationId: "parent", parentMessageId: "message", parentScrollAnchor: "anchor" });
		subject.restoreParent({ parentConversationId: "parent", parentMessageId: "message", parentScrollAnchor: "anchor" });
		expect(location.back).toHaveBeenCalledOnce();
		subject.restoreParent({ parentConversationId: "other", parentMessageId: "message", parentScrollAnchor: "anchor" });
		await Promise.resolve();
		expect(router.navigateByUrl).toHaveBeenCalledWith("/chats");
	});

	it("purges the matching child and preserves Angular history coordinates", function _PurgesMatchingChild()
	{
		const location = { back: vi.fn(), getState: vi.fn().mockReturnValue({ navigationId: 7, focusTarget: { kind: "thread", id: "origin" } }), path: vi.fn().mockReturnValue("/chats/parent/threads/child?tab=activity"), replaceState: vi.fn() };
		TestBed.configureTestingModule({ imports: [AgentThreadRouteComponent], providers: [{ provide: Location, useValue: location }, { provide: Router, useValue: { navigateByUrl: vi.fn() } }] });
		TestBed.overrideComponent(AgentThreadRouteComponent, { set: { imports: [], template: "" } });
		const subject = TestBed.createComponent(AgentThreadRouteComponent).componentInstance as unknown as AgentThreadRouteTestSubject;
		_SetInput(subject.parentConversationId, "parent");
		_SetInput(subject.childConversationId, "child");
		subject.purgeChildProjection({ generation: 1, parentConversationId: "parent", childConversationId: "child" });
		expect(subject.focusTarget()).toBeNull();
		expect(location.replaceState).toHaveBeenCalledWith("/chats/parent/threads/child?tab=activity", "", { navigationId: 7 });
		subject.purgeChildProjection({ generation: 1, parentConversationId: "parent", childConversationId: "child" });
		expect(location.replaceState).toHaveBeenCalledOnce();
	});
});
