/** Выбирает объявленный состав знаний и возможностей предмета для исполнителя.
@packageDocumentation
*/
import packageEnvironment from "@zavx0z/storybook-package-env"
import project from "@zavx0z/storybook-project-env"
import repo from "@zavx0z/storybook-repo-env"
import component from "@zavx0z/storybook-component-env"
import container from "@zavx0z/storybook-container-env"
import cluster from "@zavx0z/storybook-cluster-env"
import domain from "@zavx0z/storybook-domain-env"
import contracts from "@zavx0z/storybook-contracts-env"
import typedoc from "@zavx0z/storybook-typedoc-env"
import specs from "@zavx0z/storybook-specs-env"
import type {StorybookAppEnvironmentDeclaration as Contract} from "./contract"
export type {StorybookAppEnvironmentDeclaration} from "./contract"

/** Собирает декларацию выбранного предмета, не подключая реализации инструментов. */
export default function declaration({type, ...input}: Contract.Input = {}): Contract.Output {
  const owners = {Project: project, Repo: repo, Component: component, Container: container, Cluster: cluster, Domain: domain, Contracts: contracts, TypeDoc: typedoc, Specs: specs}
  return (type === undefined ? packageEnvironment : owners[type])(input)
}
