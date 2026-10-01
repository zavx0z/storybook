/**
Repo объединяет чтение Git-границы и обнаружение подключённых физических
пакетов. Читатель и обнаружение сохраняют собственные контракты и исполнение.

@packageDocumentation
*/
export {default as readRepo} from "@archetypes/repo"
export type {ArchetypesRepo} from "@archetypes/repo"
export {default as discoverStorybookPackages} from "@repo/discovery"
export type {RepoDiscovery} from "@repo/discovery"
