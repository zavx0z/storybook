import type {Zavx0zStorybookSpecsScenariosReader} from "@zavx0z/storybook-specs-scenarios-reader"

type Preview = NonNullable<Zavx0zStorybookSpecsScenariosReader.Output["preview"]>

export type GeneratedScenario = Preview & Readonly<{nodeId: string}>
export type LoaderInput = Readonly<{revisionUrl: string; scenarios?: readonly GeneratedScenario[]}>
export type RevisionPayloadInput = Readonly<{
  packageId: string
  candidateRevision: string
  sharedModuleEpoch: string
  graphSnapshot: unknown
}>
