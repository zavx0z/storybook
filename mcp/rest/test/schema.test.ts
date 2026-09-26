import {expect, test} from "bun:test"
import {resolve} from "node:path"
import {AjvJsonSchemaValidator} from "@modelcontextprotocol/server/validators/ajv"
import {readContractDocumentation} from "../../../discovery/contract-documentation"

test("схемы реального руководства принимает штатный валидатор MCP", async () => {
  const root = resolve(import.meta.dir, "../../..")
  const owner = resolve(root, "archetypes/specs/scenarios")
  const input = (await readContractDocumentation(root, resolve(owner, "contract/input.ts"))).document.declarations[0]!.schema!
  const output = (await readContractDocumentation(root, resolve(owner, "contract/output.ts"))).document.declarations[0]!.schema!
  const validator = new AjvJsonSchemaValidator()
  const acceptsInput = validator.getValidator({...input})
  const acceptsOutput = validator.getValidator({...output})
  expect(input).toMatchObject({type: "object", required: ["path"], properties: {
    path: {type: "string", description: expect.stringContaining("Путь к spec/scenario.spec.ts")},
  }})
  expect(acceptsInput({path: "spec/scenario.spec.ts"}).valid).toBeTrue()
  expect(acceptsInput({}).valid).toBeFalse()
  expect(acceptsInput({path: 42}).valid).toBeFalse()
  const valid = {kind: "scenario-guide", files: [{path: "spec/scenario.spec.ts", role: "scenario"}], examples: [], checks: []}
  expect(acceptsOutput(valid).valid).toBeTrue()
  expect(acceptsOutput({...valid, kind: "wrong"}).valid).toBeFalse()
  expect(acceptsOutput({...valid, files: [{path: "x", role: "unknown"}]}).valid).toBeFalse()
}, 30000)
