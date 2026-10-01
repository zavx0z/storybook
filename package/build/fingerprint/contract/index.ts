import {type PackageSession as PackageSessionContract} from "@package/session"
import {type BuildEnvironment as BuildEnvironmentContract} from "@build/environment"
type StorybookPackageBuildDescriptor = PackageSessionContract.Input[0]
type StorybookSharedBrowserIdentity = ReturnType<BuildEnvironmentContract.Output["identity"]>
import type {BuildInputs} from "@build/inputs"

/** Контракт проверки сохранённого fingerprint пакетной ревизии. */
export declare namespace PackageBuildFingerprint {
  /** Tool root, browser entry и уже проверенная identity общей платформы. */
  type Input = Readonly<{
    toolRoot: string
    browserEntryPath: string
    sharedBrowserIdentity?: StorybookSharedBrowserIdentity
  }>

  /** Возвращает текущий fingerprint только при полном совпадении, иначе `null`. */
  type Output = (value: unknown, descriptor: StorybookPackageBuildDescriptor) => BuildInputs.Output | null
}
