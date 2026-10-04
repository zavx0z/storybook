import {type Zavx0zStorybookRepoDiscovery as RepoDiscoveryContract} from "@zavx0z/storybook-repo-discovery"
type StorybookCatalog = RepoDiscoveryContract.Output
type StorybookPackage = Extract<RepoDiscoveryContract.Output["scopes"][number], {kind: "package"}>
import {join} from "node:path"

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
        moduleDocumentation: Object.freeze({
          sourcePath: modulePath,
          sourceDigest: "module-input-1",
          markdown: "Тождественное преобразование.",
        }),
      }]),
    } satisfies StorybookPackage]),
  })
}
