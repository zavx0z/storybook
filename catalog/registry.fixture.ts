import {join} from "node:path"
import type {StorybookCatalog, StorybookPackage} from "./catalog.t.ts"

/** Проверенный структурный каталог невизуального пакета для тестов реестра. */
export function documentationCatalog(root: string): StorybookCatalog {
  const packageJsonPath = join(root, "package.json")
  const modulePath = join(root, "identity/index.ts")
  return Object.freeze({
    schemaVersion: 1,
    rootIds: Object.freeze(["package:@fixture/structure"]),
    scopes: Object.freeze([{
      schemaVersion: 1,
      canonicalId: "package:@fixture/structure",
      kind: "package",
      id: "@fixture/structure",
      label: "Преобразования",
      source: Object.freeze({path: packageJsonPath, pointer: ""}),
      scopeRoot: root,
      readmePath: null,
      digest: "package-input-1",
      packageJsonPath,
      packageName: "@fixture/structure",
      packageIds: Object.freeze([]),
      structurePaths: Object.freeze([packageJsonPath, modulePath]),
      directories: Object.freeze([{
        path: join(root, "identity"),
        relativePath: "identity",
        name: "identity",
        structuralRole: "module",
        readmePath: null,
        moduleDocumentation: Object.freeze({
          sourcePath: modulePath,
          sourceDigest: "module-input-1",
          markdown: "Тождественное преобразование.",
        }),
      }]),
    } satisfies StorybookPackage]),
  })
}
