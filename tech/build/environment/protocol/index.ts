/**
Общая константа browser realm identity без доступа к Node и файловой системе.

@packageDocumentation
*/
import type {StorybookTechBuildEnvironmentProtocol} from "./contract"
export type {StorybookTechBuildEnvironmentProtocol} from "./contract"

const protocol: StorybookTechBuildEnvironmentProtocol.Output = "storybook-shared-browser-identity/1"


export default protocol
