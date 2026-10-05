import {expect, test} from "bun:test"
import {resolve} from "node:path"
import Ajv from "ajv"
import discoverStorybookPackages from "@zavx0z/storybook-package-metadata-collect"

test("схемы реального владельца проверяются независимо от транспорта", async () => {
  const owner = resolve(import.meta.dir, "../spec/fixture/library/text/trim")
  const library = resolve(owner, "../..")
  const catalog = await discoverStorybookPackages([library])
  const scope = catalog.scopes.find(item => item.kind === "package" && item.scopeRoot === library)
  if (scope?.kind !== "package") throw new Error("Владелец контракта отсутствует в каталоге")
  const directory = scope.directories?.find(item => item.path === owner && item.relativePath === "text/trim")
  const input = directory?.contractDocumentation?.documents.find(document => document.direction === "input")?.document.declarations[0]?.schema
  const output = directory?.contractDocumentation?.documents.find(document => document.direction === "output")?.document.declarations[0]?.schema
  if (input === undefined || output === undefined) throw new Error("Каталог не подготовил обе схемы контракта")
  const validator = new Ajv()
  const acceptsInput = validator.compile({...input})
  const acceptsOutput = validator.compile({...output})
  expect(input).toMatchObject({type: "string"})
  expect(output).toMatchObject({type: "string"})
  expect(acceptsInput("  текст  ")).toBeTrue()
  expect(acceptsInput(42)).toBeFalse()
  expect(acceptsOutput("текст")).toBeTrue()
  expect(acceptsOutput({value: "текст"})).toBeFalse()
}, 30000)
