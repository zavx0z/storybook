import {join} from "node:path"
import type {StorybookCatalog, StorybookPackage} from "./catalog.t.ts"

/** Каталог обычного невизуального пакета, полученный без JSON-декларации Storybook. */
export function documentationCatalog(root: string): StorybookCatalog {
  const packageJsonPath = join(root, "package.json")
  const sourcePath = join(root, "identity.ts")
  return Object.freeze({
    schemaVersion: 1,
    rootIds: Object.freeze(["package:@fixture/structure"]),
    scopes: Object.freeze([{
      schemaVersion: 1,
      canonicalId: "package:@fixture/structure",
      kind: "package",
      id: "@fixture/structure",
      label: "Преобразования",
      source: Object.freeze({path: packageJsonPath, pointer: "/name"}),
      scopeRoot: root,
      readmePath: null,
      digest: "package-input-1",
      packageJsonPath,
      packageName: "@fixture/structure",
      authorStyleSheets: Object.freeze([]),
      widgetContributions: null,
      runtime: null,
      catalog: Object.freeze({
        schemaVersion: 1,
        sourcePaths: Object.freeze([sourcePath]),
        digest: "module-input-1",
        categories: Object.freeze([{
          id: "transformations",
          route: "transformations",
          label: "Преобразования",
          kind: null,
          apiName: null,
          group: null,
          source: Object.freeze({path: sourcePath, pointer: "module"}),
          subjects: Object.freeze([{
            id: "identity",
            route: "transformations/identity",
            kind: "function",
            label: "Тождественное преобразование",
            apiName: "identity",
            readmePath: null,
            tags: Object.freeze(["identity"]),
            aliases: Object.freeze([]),
            presentation: Object.freeze({
              protocol: "story-presentation/1",
              projection: "display",
              widgets: Object.freeze(["source"]),
            }),
            variants: Object.freeze([]),
            source: Object.freeze({path: sourcePath, pointer: "export:identity"}),
          }]),
        }]),
      }),
    } satisfies StorybookPackage]),
  })
}
