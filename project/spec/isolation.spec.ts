import {expect, test} from "bun:test"
import {mkdir, writeFile} from "node:fs/promises"
import {resolve} from "node:path"
import readProject from "@zavx0z/storybook-project"
import {createProjectFixture} from "./fixture"

test("Неверный workspace package не скрывает участвующий Repo", async () => {
  const fixture = await createProjectFixture([{section: "repo", path: "repo", name: "@fixture/repo"}])
  try {
    const repo = resolve(fixture.root, "repo")
    await writeFile(resolve(repo, "package.json"), JSON.stringify({name: "@fixture/repo", workspaces: ["packages/*"]}))
    await mkdir(resolve(repo, "packages/broken"), {recursive: true})
    await writeFile(resolve(repo, "packages/broken/package.json"), "{")
    const result = await readProject({path: fixture.root})
    expect(result.repositories.map(repository => repository.root),
      "Неверный манифест вложенного пакета не меняет объявленное участие Repo; отдельной диагностикой child владеет Repo discovery")
      .toEqual([repo])
  } finally {
    await fixture.cleanup()
  }
})
