import type {StorybookSpecsScenariosReader} from "@storybook-specs-scenarios/reader"

type Preview = NonNullable<StorybookSpecsScenariosReader.Output["preview"]>

export type GeneratedScenario = Preview & Readonly<{nodeId: string}>
export type LoaderInput = Readonly<{revisionUrl: string; scenarios?: readonly GeneratedScenario[]}>
export type RevisionPayloadInput = Readonly<{
  packageId: string
  candidateRevision: string
  sharedModuleEpoch: string
  graphSnapshot: unknown
}>
