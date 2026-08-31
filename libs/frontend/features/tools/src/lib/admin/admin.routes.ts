import { Routes } from "@angular/router";

/**
 * MCP governance routes (catalogue governance and model keys), mounted by the operator app under
 * `/admin`. Each screen uses the server-derived administration capability for presentation; the
 * control plane rechecks the current Organization/Administer grant.
 */
export const MCP_ADMIN_ROUTES: Routes =
[
	{
		path: "catalogue",
		loadComponent: function loadCatalogueAdmin()
		{
			return import("./catalogue-admin/catalogue-admin.component").then(function pick(m)
			{
				return m.CatalogueAdminComponent;
			});
		}
	},
	{
		path: "model-keys",
		loadComponent: function loadModelKeysAdmin()
		{
			return import("./model-keys-admin/model-keys-admin.component").then(function pick(m)
			{
				return m.ModelKeysAdminComponent;
			});
		}
	},
	{
		path: "",
		pathMatch: "full",
		redirectTo: "catalogue"
	}
];
