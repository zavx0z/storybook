import {expect, test} from "bun:test"
import readProjectMcp from "@zavx0z/storybook-project-mcp"

test.each(["", " ", "\t\n"])("Пустое имя Project: %j", projectName => {
  expect(() => readProjectMcp({projectName, entries: []}),
    "Отсутствие имени Project не заменяется именем Repo или выдуманной подписью")
    .toThrow(new TypeError("Project name must be non-empty text"))
})
