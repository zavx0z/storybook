import {cp, mkdir, mkdtemp, realpath, rm} from "node:fs/promises"
import {dirname, resolve} from "node:path"

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
