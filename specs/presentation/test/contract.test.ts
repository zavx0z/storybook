import {expect, test} from "bun:test"
import {resolve} from "node:path"
import discoverStorybookPackages from "@zavx0z/storybook-repo-discovery"

test("публичные контракты сценариев проходят структурное обнаружение Storybook", async () => {
  const root = resolve(import.meta.dir, "..")
  const contract = resolve(import.meta.dir, "../contract/index.ts")
  const catalog = await discoverStorybookPackages([root])
  const owner = catalog.scopes.find(scope => scope.kind === "package" && scope.scopeRoot === root)
  expect(owner?.kind).toBe("package")
  if (owner?.kind !== "package") return
  expect(owner.contractDocumentation?.sources.map(source => source.sourcePath)).toContain(contract)
  expect(owner.contractDocumentation?.documents.flatMap(document => document.document.declarations.map(declaration => declaration.name)))
    .toEqual(["Zavx0zStorybookSpecsPresentation.Input", "Zavx0zStorybookSpecsPresentation.Output"])
})
