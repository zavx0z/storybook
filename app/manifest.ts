/**
Repository-owned self-documentation application.

The app derives contract routes from the typed documentation registry and the
live Workbench routes from its package-owned story registry. Local server and
static build therefore consume the same page graph.

@packageDocumentation
*/

import {join} from "node:path"
import {defineStorybookApp, type StorybookAppManifest} from "@zavx0z/storybook/app"
import {STORYBOOK_DOCUMENTATION_CATALOG} from "./workbench/catalog.ts"

export type StorybookDocumentationAppOptions = Readonly<{
  publicBasePath?: string
}>

const workbenchRoot = join(import.meta.dir, "workbench")

/**
Creates the exact page graph used by local and static self documentation.

@param options - Optional public mount such as `/storybook`; omission keeps
local development at the origin root.
*/
export function createStorybookDocumentationApp(
  options: StorybookDocumentationAppOptions = {},
): StorybookAppManifest {
  return defineStorybookApp({
    id: "storybook",
    title: "@zavx0z/storybook · Документация",
    basePath: options.publicBasePath ?? "",
    home: {path: "/", label: "Главная", ariaLabel: "На главную документации Storybook"},
    footer: {
      lead: "Создано для",
      owner: {label: "MetaFor", href: "https://github.com/zavx0z/metafor"},
      detail: "общая Storybook-инфраструктура",
    },
    head: {meta: [{
      kind: "public-path",
      name: "engine-default-font",
      path: "/fonts/jetbrains-mono-bold.ttf",
    }]},
    pages: [{
      id: "documentation",
      title: "@zavx0z/storybook · Документация",
      mountPath: "/",
      entrypoint: join(workbenchRoot, "entry.ts"),
      stylePath: join(workbenchRoot, "style.css"),
      body: {kind: "canvas", canvasId: "storybook-canvas"},
      capability: "webgpu-diagnostic",
      readiness: {dataset: "storybookDocs", value: "ready"},
      canvas: {id: "storybook-canvas", evidence: "non-black"},
      routeTree: STORYBOOK_DOCUMENTATION_CATALOG.routeTree,
    }],
  })
}
