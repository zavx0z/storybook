import type BuildInputs from "@build/inputs"
import type {BuildInputs as BuildInputsContract} from "@build/inputs"
import type {
  StorybookPackageBuildInputFingerprintPlan,
  StorybookPackageBuildInputFingerprintRequest,
} from "./types"

export declare namespace PackageBuildPlan {
  /** План и свидетельства одной пакетной ревизии используют одни входы. */
  type Output = Readonly<{
    scope(input: StorybookPackageBuildInputFingerprintRequest): StorybookPackageBuildInputFingerprintPlan["scope"]
    resolve(input: StorybookPackageBuildInputFingerprintRequest): StorybookPackageBuildInputFingerprintPlan
    compute(input: StorybookPackageBuildInputFingerprintRequest): BuildInputsContract.Output
    computer(): (input: StorybookPackageBuildInputFingerprintRequest) => BuildInputsContract.Output
    attest(input: StorybookPackageBuildInputFingerprintRequest): ReturnType<typeof BuildInputs.attest>
  }>
}
