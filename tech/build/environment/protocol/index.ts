/**
Общая константа browser realm identity без доступа к Node и файловой системе.

@packageDocumentation
*/
import type {BuildEnvironmentProtocol} from "./contract"
export type {BuildEnvironmentProtocol} from "./contract"

const protocol: BuildEnvironmentProtocol.Output = "storybook-shared-browser-identity/1"


export default protocol
