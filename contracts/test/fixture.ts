import {cp, mkdir, mkdtemp, realpath, rm} from "node:fs/promises"
import {basename, dirname, relative, resolve} from "node:path"

/** Создаёт изолированные исходники; удаление затрагивает только принадлежащую этому тесту временную директорию. */
export async function createFixture(base = "component") {
  const temporary = resolve(import.meta.dir, "fixture")
  await mkdir(temporary, {recursive: true})
  const root = await realpath(await mkdtemp(resolve(temporary, ".contract-")))
  try {
    if (base === "empty") {
      await Bun.write(resolve(root, "package.json"), '{"name":"@contract-fixture/domain","type":"module","exports":{".":"./index.ts"}}')
      await Bun.write(resolve(root, "tsconfig.json"), '{"compilerOptions":{"target":"ESNext","module":"Preserve","moduleResolution":"bundler","types":[],"strict":true,"noEmit":true},"include":["**/*.ts"]}')
    } else {
      await cp(resolve(import.meta.dir, "../spec/fixture", base), root, {recursive: true})
    }
  } catch (error) {
    await rm(root, {recursive: true, force: true})
    throw error
  }
  return {
    root,
    namespaceName: [basename(resolve(import.meta.dir, "../..")), relative(resolve(import.meta.dir, "../.."), root)]
      .join("/").split(/[^a-zA-Z0-9]+/u).filter(Boolean).map(part => part[0]!.toUpperCase() + part.slice(1)).join(""),
    namingDiagnostic(name: string, child = "") {
      const owner = resolve(root, child)
      const repo = resolve(import.meta.dir, "../..")
      const expected = [basename(repo), relative(repo, owner)].join("/")
        .split(/[^a-zA-Z0-9]+/u).filter(Boolean).map(part => part[0]!.toUpperCase() + part.slice(1)).join("")
      return {
        severity: "warning" as const,
        code: "namespace-name",
        path: resolve(owner, "contract/index.ts"),
        message: `Namespace ${name} по пути исходного владельца от Repo ожидается с именем ${expected}`,
      }
    },
    async write(path: string, text: string) {
      const target = resolve(root, path)
      await mkdir(dirname(target), {recursive: true})
      await Bun.write(target, text)
      return target
    },
    async close() {
      await rm(root, {recursive: true, force: true})
    },
  }
}
