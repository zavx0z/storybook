import {expect, test} from "bun:test"
import {resolve} from "node:path"
import {AjvJsonSchemaValidator} from "@modelcontextprotocol/server/validators/ajv"
import discoverStorybookPackages from "@repo/discovery"

test("схемы реального владельца принимает штатный валидатор MCP", async () => {
  const owner = resolve(import.meta.dir, "../spec/fixture/library/text/trim")
  const library = resolve(owner, "../..")
  const catalog = await discoverStorybookPackages([library])
  const scope = catalog.scopes.find(item => item.kind === "package" && item.scopeRoot === library)
  if (scope?.kind !== "package") throw new Error("Владелец контракта отсутствует в каталоге")
  const directory = scope.directories?.find(item => item.path === owner && item.relativePath === "text/trim")
  const input = directory?.contractDocumentation?.documents.find(document => document.direction === "input")?.document.declarations[0]?.schema
  const output = directory?.contractDocumentation?.documents.find(document => document.direction === "output")?.document.declarations[0]?.schema
  if (input === undefined || output === undefined) throw new Error("Каталог не подготовил обе схемы контракта")
  const validator = new AjvJsonSchemaValidator()
  const acceptsInput = validator.getValidator({...input})
  const acceptsOutput = validator.getValidator({...output})
  expect(input).toMatchObject({type: "string"})
  expect(output).toMatchObject({type: "string"})
  expect(acceptsInput("  текст  ").valid).toBeTrue()
  expect(acceptsInput(42).valid).toBeFalse()
  expect(acceptsOutput("текст").valid).toBeTrue()
  expect(acceptsOutput({value: "текст"}).valid).toBeFalse()
}, 30000)
