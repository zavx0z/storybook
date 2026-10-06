import {expect, test} from "bun:test"
import {mkdir, writeFile} from "node:fs/promises"
import {resolve} from "node:path"
import readProject from "@zavx0z/storybook-project"
import {createProjectFixture} from "./fixture"

test("Неверный workspace package не скрывает исходный Repo", async () => {
  const fixture = await createProjectFixture([{key: "repo", path: "sources/repo", name: "@fixture/repo"}])
  try {
    const repo = resolve(fixture.directory, "sources/repo")
    await writeFile(resolve(repo, "package.json"), JSON.stringify({name: "@fixture/repo", workspaces: ["packages/*"], exports: {".": "./index.js"}}))
    await mkdir(resolve(repo, "packages/broken"), {recursive: true})
    await writeFile(resolve(repo, "packages/broken/package.json"), "{")
    const result = await readProject(fixture.props)
    expect(result.repositories,
      "Вложенный манифест не читается; exports скрывает package.json от module resolution, но не от чтения состава")
      .toEqual([{root: repo, name: "@fixture/repo"}])
  } finally {
    await fixture.cleanup()
  }
})
