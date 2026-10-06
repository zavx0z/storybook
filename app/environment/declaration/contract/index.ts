import type {StorybookPackageEnv} from "@zavx0z/storybook-package-env"
export declare namespace StorybookAppEnvironmentDeclaration {
  type Input = StorybookPackageEnv.Input & Readonly<{type?: "Project" | "Repo" | "Component" | "Container" | "Cluster" | "Domain" | "Contracts" | "TypeDoc" | "Specs"}>
  type Output = StorybookPackageEnv.Output
}
