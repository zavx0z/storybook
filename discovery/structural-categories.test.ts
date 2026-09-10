import {afterEach, expect, test} from "bun:test"
import {mkdtemp, mkdir, realpath, rm} from "node:fs/promises"
import {tmpdir} from "node:os"
import {join} from "node:path"
import {discoverStorybookDirectories} from "./directories.ts"
import {resolveExternalStorybookDeclarations} from "./declarations.ts"
import {createExternalStorybookGraph} from "../catalog/graph.ts"
import {deriveExternalStorybookPackageContents, deriveExternalStorybookPackageTab} from "../runtime/model.ts"
import {createStorybookPackageRevisionGraphSnapshot} from "../sessions/package-revision.ts"

const roots: string[] = []
afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, {recursive: true, force: true})))
})

test.each(["index.ts", "index.tsx"])("категории и привязка предмета сохраняются при размещении в %s", async entry => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "storybook-categories-")))
  roots.push(root)
  await Bun.spawn(["git", "init", "--quiet", root]).exited
  await Bun.write(join(root, "package.json"), JSON.stringify({name: "@fixture/parameters", label: "Параметры", exports: {".": "./numeric/index.ts"}}))
  for (const dir of ["numeric/number/tests", "numeric/shared/hidden/src", "shared/base/src", "numeric/slider/src", "nested/child/src"]) await mkdir(join(root, dir), {recursive: true})
  if (entry === "index.ts") await mkdir(join(root, "numeric/number/src/private"), {recursive: true})
  await Bun.write(join(root, "numeric/index.ts"), '/**\nЧисловые параметры.\n@packageDocumentation\n*/\nexport * from "./number/index.ts"\nthrow new Error("Не исполнять")')
  await Bun.write(join(root, `numeric/number/${entry}`), '/**\nРедактирование числа.\n@packageDocumentation\n*/\nthrow new Error("Не исполнять")')
  await Bun.write(join(root, "numeric/slider/index.tsx"), '/**\nПолзунок с внутренним помощником.\n@packageDocumentation\n*/\nexport function Slider() { return <div /> }')
  await Bun.write(join(root, "nested/package.json"), JSON.stringify({name: "@fixture/child", label: "Child"}))
  const found = await discoverStorybookDirectories(root, new Set())
  expect(found.directories.map(dir => [dir.relativePath, dir.structuralRole]), "index.tsx не требует src, index.ts категории не останавливает обход").toEqual([
    ["numeric", "category"], ["numeric/number", "module"], ["numeric/slider", "module"],
  ])
  expect(found.directories[0]?.moduleDocumentation?.markdown, "Реэкспорты не меняют роль категории").toBe("Числовые параметры.")
  expect(found.watchPaths.some(file => file.includes("/shared/hidden")), "Служебный shared не обходится").toBeFalse()
  await Bun.write(join(root, ".storybook/catalog.json"), JSON.stringify({schemaVersion: 1, categories: [{id: "legacy", label: "Legacy", subjects: [{
    id: "number", kind: "component", label: "Число", directory: "numeric/number", route: "parameters/number", presentation: {protocol: "story-presentation/1", projection: "display", widgets: ["source", "diagnostics"]},
    variants: [{id: "default", label: "Обычное", route: "parameters/number/default"}],
  }]}]}))
  await Bun.write(join(root, ".storybook/manifest.json"), JSON.stringify({schemaVersion: 1, catalog: "./catalog.json"}))
  const graph = createExternalStorybookGraph(await resolveExternalStorybookDeclarations([root]))
  const rows = deriveExternalStorybookPackageContents(graph, "@fixture/parameters")
  expect(rows.map(row => row.label), "Предмет не дублируется директорией и старой категорией").toEqual(["numeric", "number", "slider"])
  const subject = graph.nodes.find(node => node.kind === "subject")!
  expect(subject.id).toBe("subject:@fixture/parameters/legacy/number")
  expect(subject.packageId).toBe("@fixture/parameters")
  expect(subject.routePath).toBe("parameters/number")
  expect(subject.parentId, "Принадлежность определяется директорией категории").toBe("directory:package:@fixture/parameters/numeric")
  expect(subject.moduleDocumentation?.markdown, "Описание берётся из публичного файла компонента").toBe("Редактирование числа.")
  expect(subject.moduleDocumentation?.sourcePath).toBe(join(root, `numeric/number/${entry}`))
  expect(deriveExternalStorybookPackageTab(graph, "@fixture/parameters", "parameters/number/default").variants, "Сценарии остаются в манифесте").toHaveLength(1)
  expect(createStorybookPackageRevisionGraphSnapshot(graph, "@fixture/parameters", "structural").nodes.some(node => node.id === subject.id), "Снимок ревизии содержит тот же предмет").toBeTrue()
  const accepted = await resolveExternalStorybookDeclarations([root])
  const catalogFile = Bun.file(join(root, ".storybook/catalog.json"))
  const catalog = await catalogFile.json()
  for (const invalid of ["shared/base", "numeric", "numeric/missing", "numeric/number/src/private"]) {
    catalog.categories[0].subjects[0].directory = invalid
    await Bun.write(catalogFile, JSON.stringify(catalog))
    await expect(resolveExternalStorybookDeclarations([root]), "Скрытая или несуществующая директория не создаётся декларацией").rejects.toThrow("existing discovered module")
    const retained = await resolveExternalStorybookDeclarations([root], accepted)
    expect(retained.scopes[0]?.resolutionError, "Ошибка остаётся локальной диагностикой владельца").toContain("existing discovered module")
    expect(createExternalStorybookGraph(retained).nodes.find(node => node.id === subject.id)?.parentId, "Последняя проверенная структура сохраняется").toBe(subject.parentId)
  }
})
