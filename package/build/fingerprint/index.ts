/** Проверяет сохранённое свидетельство входов ревизии перед cache hit.

@packageDocumentation
*/
import PackageBuildPlanOwner from "@package-build/plan"
import BuildEnvironmentOwner from "@build/environment"
const createStorybookBuildInputFingerprintComputer = PackageBuildPlanOwner.computer
const validateStorybookSharedBrowserIdentity = BuildEnvironmentOwner.validate
import {realpathSync} from "node:fs"
import BuildInputs, {type BuildInputs as BuildInputsContract} from "@build/inputs"
type StorybookBuildInputFingerprint = BuildInputsContract.Output
import type {PackageBuildFingerprint} from "./contract"

export type {PackageBuildFingerprint} from "./contract"

/**
Создаёт fail-closed verifier для persisted receipt evidence.

Unknown/old/missing evidence, изменённый descriptor, source inventory, config,
toolchain либо ABI возвращают `null`: session сохраняет lastWorking artifact, но
не объявляет его cache hit и заказывает cold build. Compiler child не запускается.

Переименование поля контекста Repo в descriptor меняет descriptorDigest.
Сохранённое свидетельство получает cache miss без подмены проверенных digests;
строгость пакета и lastWorking artifact сохраняются восстановлением session.
*/
export default function createStorybookBuildInputFingerprintVerifier(
  options: PackageBuildFingerprint.Input,
): PackageBuildFingerprint.Output {
  const toolRoot = realpathSync(options.toolRoot)
  const browserEntryPath = realpathSync(options.browserEntryPath)
  const compute = createStorybookBuildInputFingerprintComputer()
  return (value, descriptor): StorybookBuildInputFingerprint | null => {
    const persisted = BuildInputs.parse(value)
    if (persisted === null) return null
    try {
      const current = compute({
        toolRoot,
        descriptor,
        browserEntryPath,
        ...(options.sharedBrowserIdentity === undefined
          ? {}
          : {sharedBrowserIdentity: validateStorybookSharedBrowserIdentity(options.sharedBrowserIdentity)}),
        additionalFilePaths: persisted.files.map(({path}) => path),
        resolutionDirectories: persisted.resolutionDirectories,
      })
      return BuildInputs.same(persisted, current) ? current : null
    } catch {
      return null
    }
  }
}
