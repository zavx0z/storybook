import type {ArchetypesScenarioReader} from "@archetypes/scenario-reader"

type Preview = NonNullable<ArchetypesScenarioReader.Output["preview"]>

export type GeneratedScenario = Preview & Readonly<{nodeId: string}>
export type LoaderInput = Readonly<{revisionUrl: string; scenarios?: readonly GeneratedScenario[]}>
export type RevisionPayloadInput = Readonly<{
  packageId: string
  candidateRevision: string
  sharedModuleEpoch: string
  graphSnapshot: unknown
}>
