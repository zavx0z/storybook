/**
Собирает публичные возможности чтения, проверки, представления и объяснения спецификаций.
Каждая реализация и её контракт остаются у непосредственного владельца.

@packageDocumentation
*/
export {default as readSpec} from "@archetypes/spec-reader"
export {default as readScenario} from "@archetypes/scenario-reader"
export {default as validateScenario} from "@archetypes/scenario-validation"
export {default as readSpecGuide} from "@specs/guide"
export {default as readScenarioGuide} from "@archetypes/scenario-guide"
export {default as createScenarioGuide} from "@archetypes/scenario-document"
export {default as readScenarios} from "@mcp-rest/scenarios"
export {default as readPackageNode} from "@mcp-rest/package"

export type {ArchetypesSpecReader} from "@archetypes/spec-reader"
export type {ArchetypesScenarioReader} from "@archetypes/scenario-reader"
export type {ArchetypesScenarioValidation} from "@archetypes/scenario-validation"
export type {SpecsGuide} from "@specs/guide"
export type {ArchetypesScenarioGuide} from "@archetypes/scenario-guide"
export type {ArchetypesScenarioDocument} from "@archetypes/scenario-document"
export type {McpRestScenarios} from "@mcp-rest/scenarios"
export type {McpRestPackage} from "@mcp-rest/package"
