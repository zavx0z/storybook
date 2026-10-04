import type {DiscoveryFixtureNamespaceContract} from "./contract"

/** Минимальная собственная runtime-реализация пакета для проверки документации контракта. */
export default function inspectNamespaceContract(input: DiscoveryFixtureNamespaceContract.Input): DiscoveryFixtureNamespaceContract.Output {
  return {values: input.options.enabled === false ? [] : [input.source].slice(0, input.options.limit), complete: true}
}

export type {DiscoveryFixtureNamespaceContract} from "./contract"
