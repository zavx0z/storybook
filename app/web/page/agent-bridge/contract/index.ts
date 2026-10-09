import type {StorybookAppWebProtocol} from "@zavx0z/storybook-app-web-protocol"
import type {Request} from "./request"
import type {Shell} from "./shell"

type ClientNode = ReturnType<StorybookAppWebProtocol.Output["clientSnapshot"]>["nodes"][number]

export declare namespace StorybookAppWebPageAgentBridge {
  /**
Связи bridge с уже существующей страницей и её committed scope.

@property shell - Диагностика и ввод общего Experience; bridge не создаёт Root или Canvas.

@property [waitForStableScope] - Ожидает transition; после HMR возвращает нового владельца bridge.
*/
  export type Input = Readonly<{
    packageId: string | null
    revision: string | null
    graphDigest: string
    shell: Shell
    getRoute(): string
    getModel(): Readonly<{selectedNode: Pick<ClientNode, "id" | "kind">, tabActiveId: string}> | null
    navigateWorkspace?(input: Readonly<{expectedPackageId: string | null; packageId: string | null; route: string; revision?: string; url?: string; followEnvironment?: true}>): Promise<void>
    navigate(route: string): Promise<void>
    selectScenario?(value: string): void
    applyRevision(revision: string): Promise<void>
    canApplyRevision?(): boolean
    waitForStableScope?(): Promise<Output | void>
  }>

  /** Действующий bridge страницы; dispose освобождает inspector и свой global binding. */
  export type Output = Readonly<{
    protocol: "external-storybook-agent-bridge/1"
    call(method: "identity" | "inspect" | "interact" | "capture" | "applyRevision" | "navigate", params?: unknown): Promise<unknown>
    invoke(request: Request): Promise<unknown>
    updateIdentity(packageId: string | null, revision: string | null, graphDigest: string): void
    dispose(): void
  }>
}
