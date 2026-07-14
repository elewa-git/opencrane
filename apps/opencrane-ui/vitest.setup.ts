import "@angular/compiler";

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { ɵresolveComponentResources } from "@angular/core";
import { getTestBed } from "@angular/core/testing";
import { BrowserTestingModule, platformBrowserTesting } from "@angular/platform-browser/testing";

/** Initializes Angular's browser test platform once for app-local component tests. */
getTestBed().initTestEnvironment(BrowserTestingModule, platformBrowserTesting(), { teardown: { destroyAfterEach: true } });

/** External component resources exercised by app-local unit tests. */
const RESOURCES: Readonly<Record<string, string>> =
{
	"./app-sidebar.component.html": "apps/opencrane-ui/src/app/shared/components/app-sidebar/app-sidebar.component.html",
	"./app-sidebar.component.scss": "apps/opencrane-ui/src/app/shared/components/app-sidebar/app-sidebar.component.scss",
	"./avatar.component.html": "apps/opencrane-ui/src/app/shared/components/avatar/avatar.component.html",
	"./avatar.component.scss": "apps/opencrane-ui/src/app/shared/components/avatar/avatar.component.scss",
	"./progress-meter.component.html": "apps/opencrane-ui/src/app/shared/components/progress-meter/progress-meter.component.html",
	"./progress-meter.component.scss": "apps/opencrane-ui/src/app/shared/components/progress-meter/progress-meter.component.scss",
	"./settings-row.component.html": "apps/opencrane-ui/src/app/shared/components/settings-row/settings-row.component.html",
	"./settings-row.component.scss": "apps/opencrane-ui/src/app/shared/components/settings-row/settings-row.component.scss",
	"./toggle-field.component.html": "apps/opencrane-ui/src/app/shared/components/toggle-field/toggle-field.component.html",
	"./toggle-field.component.scss": "apps/opencrane-ui/src/app/shared/components/toggle-field/toggle-field.component.scss"
};

/** Resolves one external template or style without an Angular CLI test builder. */
async function _ResolveTestResource(url: string): Promise<string>
{
	const resource = RESOURCES[url];
	if (!resource)
	{
		throw new Error(`Unregistered Angular test resource: ${url}`);
	}
	return resource.endsWith(".scss") ? "" : readFile(resolve(process.cwd(), resource), "utf8");
}

/** Resolves queued external component resources after a spec imports its components. */
export async function _ResolveTestResources(): Promise<void>
{
	await ɵresolveComponentResources(_ResolveTestResource);
}
