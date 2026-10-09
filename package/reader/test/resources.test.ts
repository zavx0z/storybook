import {expect, test} from "bun:test"
import {mkdtemp, mkdir, realpath, rm} from "node:fs/promises"
import {tmpdir} from "node:os"
import {join} from "node:path"
import readPackage from "@zavx0z/storybook-package-reader"

test("ambient-тип HTML не меняет физического владельца ресурса", async () => {
  const temporary = await mkdtemp(join(tmpdir(), "storybook-resource-owner-"))
  const root = await realpath(temporary)
  try {
    await mkdir(join(root, "ambient"))
    await Bun.write(join(root, "package.json"), JSON.stringify({name: "@fixture/view", type: "module", exports: {".": "./index.ts"}}))
    await Bun.write(join(root, "ambient/package.json"), JSON.stringify({name: "@fixture/ambient"}))
    await Bun.write(join(root, "ambient/index.d.ts"), 'declare module "*.html" { const page: {kind: "html"}; export default page }')
    await Bun.write(join(root, "tsconfig.json"), JSON.stringify({compilerOptions: {module: "ESNext", moduleResolution: "Bundler", noEmit: true}, files: ["index.ts", "ambient/index.d.ts"]}))
    await Bun.write(join(root, "index.ts"), 'import page from "./view.html"\nexport default function view() { return page }\n')
    await Bun.write(join(root, "view.html"), "<main>Собственный ресурс</main>")
    const result = await readPackage({path: root})
    const reference = result.code.flatMap(file => file.references).find(item => item.module === "./view.html")!
    expect(reference.path, "Импорт указывает на ресурс, а не декларацию ambient-типа").toBe(join(root, "view.html"))
    expect(reference.owner, "HTML принадлежит пакету, в котором находится").toEqual({path: root, name: "@fixture/view"})
    expect(reference.public, "Внутренний ресурс допустим для собственного входа").toBeTrue()
    expect(result.code.map(file => file.path), "HTML не передаётся TypeScript как исполняемый исходник").toEqual([join(root, "index.ts")])
  } finally {
    await rm(temporary, {recursive: true, force: true})
  }
}, 30_000)
