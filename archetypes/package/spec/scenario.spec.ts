import {expect, test} from "bun:test"
import {mkdir, mkdtemp, realpath, rm} from "node:fs/promises"
import {tmpdir} from "node:os"
import {dirname, join, relative} from "node:path"
import {resolveExternalStorybookDeclarations} from "../../../discovery/declarations.ts"

/**
 Проверяет состав пакета на временных файловых примерах через действующее обнаружение.
 Каждая строка задаёт исходные файлы в props, ожидаемый состав в expected
 и сообщение проверки в fail.
 Исходники примеров не исполняются; временная директория удаляется после проверки.
 */
test.each([
  {
    name: "Минимальный пакет",
    fail: "Должен быть обнаружен минимальный пакет с ожидаемым составом",
    props: {
      files: {
        "package.json": JSON.stringify({name: "@fixture/package", label: "Пакет", exports: {".": "./index.ts"}}),
        "README.md": "# Пакет\n\nНазначение пакета.",
        "index.ts": "",
      },
    },
    expected: {
      ".": {name: "@fixture/package", readme: "README.md", directories: [], packages: []},
    },
  },
  {
    name: "Пакет с вложенным пакетом",
    fail: "Родительский и вложенный пакеты должны быть обнаружены с ожидаемой принадлежностью",
    props: {
      files: {
        "package.json": JSON.stringify({
          name: "@fixture/package",
          label: "Пакет",
          exports: {".": "./index.ts"},
          workspaces: ["child"]
        }),
        "README.md": "# Пакет\n\nПакет объединяет вложенные пакеты.",
        "index.ts": "",
        "child/package.json": JSON.stringify({
          name: "@fixture/child",
          label: "Вложенный пакет",
          exports: {".": "./index.ts"}
        }),
        "child/README.md": "# Вложенный пакет\n\nСамостоятельная ответственность.",
        "child/index.ts": "",
      },
    },
    expected: {
      ".": {name: "@fixture/package", readme: "README.md", directories: [], packages: ["package:@fixture/child"]},
      child: {name: "@fixture/child", readme: "README.md", directories: [], packages: []},
    },
  },
])("[PACKAGE-COMPOSITION] $name", async ({props, expected, fail}) => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "package-composition-")))
  try {
    for (const [path, source] of Object.entries(props.files)) {
      const destination = join(root, path)
      await mkdir(dirname(destination), {recursive: true})
      await Bun.write(destination, source)
    }
    const catalog = await resolveExternalStorybookDeclarations([root])
    const actual = Object.fromEntries(catalog.scopes.map(scope => {
      if (scope.kind !== "package") throw new Error(`Ожидался пакет: ${scope.id}`)
      const directories: readonly string[] = (scope.directories ?? []).map(directory => directory.relativePath)
      return [relative(root, scope.scopeRoot) || ".", {
        name: scope.packageName,
        readme: scope.readmePath === null ? null : relative(scope.scopeRoot, scope.readmePath),
        directories,
        packages: scope.packageIds ?? [],
      }]
    }))
    expect(actual, fail).toEqual(expected)
  } finally {
    await rm(root, {recursive: true, force: true})
  }
})
