import PackageRevisionOwner from "@package/revision"
const createStorybookPackageRevisionGraphSnapshot = PackageRevisionOwner.create
import {afterEach, expect, test} from "bun:test"
import {mkdtemp, mkdir, realpath, rm} from "node:fs/promises"
import {tmpdir} from "node:os"
import {join} from "node:path"
import discoverStorybookPackages from "@repo/discovery"
import createExternalStorybookGraph from "@package-graph/create"
import WebNavigationOwner from "@web/navigation"
const deriveExternalStorybookNavigationTree = WebNavigationOwner.deriveExternalStorybookNavigationTree
const deriveExternalStorybookPackageTab = WebNavigationOwner.deriveExternalStorybookPackageTab

const roots: string[] = []
afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, {recursive: true, force: true})))
})

test.each(["index.ts", "index.tsx"])("категории и привязка предмета сохраняются при размещении в %s", async entry => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "storybook-categories-")))
  roots.push(root)
  await Bun.spawn(["git", "init", "--quiet", root]).exited
  await Bun.write(join(root, "package.json"), JSON.stringify({name: "@fixture/parameters", label: "Параметры", exports: {".": "./numeric/index.ts"}}))
  for (const dir of ["numeric/number/tests", "numeric/test/hidden/src", "src/base/src", "numeric/slider/src", "nested/child/src"]) await mkdir(join(root, dir), {recursive: true})
  if (entry === "index.ts") await mkdir(join(root, "numeric/number/src/private"), {recursive: true})
  await Bun.write(join(root, "numeric/index.ts"), '/**\nЧисловые параметры.\n@packageDocumentation\n*/\nexport * from "./number/index.ts"\nthrow new Error("Не исполнять")')
  await Bun.write(join(root, `numeric/number/${entry}`), '/**\nРедактирование числа.\n@packageDocumentation\n*/\nthrow new Error("Не исполнять")')
  await Bun.write(join(root, "numeric/slider/index.tsx"), '/**\nПолзунок с внутренним помощником.\n@packageDocumentation\n*/\nexport function Slider() { return <div /> }')
  await Bun.write(join(root, "nested/package.json"), JSON.stringify({name: "@fixture/child", label: "Child"}))
  const found = await discoverDirectories(root)
  expect(found.directories.map(dir => dir.relativePath), "index.tsx не требует src, index.ts категории не останавливает обход").toEqual([
    "numeric", "numeric/number", "numeric/slider",
  ])
  expect(found.directories[0]?.moduleDocumentation?.markdown, "Реэкспорты не меняют роль категории").toBe("Числовые параметры.")
  expect(found.inputs.some(file => file.includes("/test/hidden")), "Служебные test-директории не обходятся").toBeFalse()
  const graph = createExternalStorybookGraph(await discoverStorybookPackages([root]))
  const rows = deriveExternalStorybookNavigationTree(graph).filter(row =>
    row.id !== "package:@fixture/parameters" &&
    graph.nodes.find(node => node.id === row.id)?.packageId === "@fixture/parameters")
  expect(rows.map(row => row.label)).toEqual(["numeric", "number", "slider"])
  const module = graph.nodes.find(node => node.id === "directory:package:@fixture/parameters/numeric/number")!
  expect(module.kind).toBe("directory")
  expect(module.packageId).toBe("@fixture/parameters")
  expect(module.routePath).toBe("dir-numeric/dir-number")
  expect(module.parentId).toBe("directory:package:@fixture/parameters/numeric")
  expect(module.moduleDocumentation?.markdown).toBe("Редактирование числа.")
  expect(module.moduleDocumentation?.sourcePath).toBe(join(root, `numeric/number/${entry}`))
  expect(deriveExternalStorybookPackageTab(graph, "@fixture/parameters", "dir-numeric/dir-number").selectedNode.id).toBe(module.id)
  expect(createStorybookPackageRevisionGraphSnapshot(graph, "@fixture/parameters", "structural").nodes.some(node => node.id === module.id)).toBeTrue()
  const accepted = await discoverStorybookPackages([root])
  await Bun.write(join(root, "package.json"), "{invalid")
  const retained = await discoverStorybookPackages([root], accepted)
  expect(retained.scopes[0]?.resolutionError).toBeDefined()
  expect(createExternalStorybookGraph(retained).nodes.find(node => node.id === module.id)?.parentId).toBe(module.parentId)
})

/** Наблюдаемые директории и входы получены через публичное обнаружение пакета. */
async function discoverDirectories(root: string) {
  const catalog = await discoverStorybookPackages([root])
  const scope = catalog.scopes[0]!
  if (scope.resolutionError !== undefined) throw new Error(scope.resolutionError)
  return {directories: scope.directories ?? [], inputs: scope.structurePaths ?? [], rootMetadata: scope}
}
