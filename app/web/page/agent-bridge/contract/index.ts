import type {Zavx0zStorybookAppWebProtocol} from "@zavx0z/storybook-app-web-protocol"
import type {Request} from "./request"
import type {Shell} from "./shell"

type ClientNode = ReturnType<Zavx0zStorybookAppWebProtocol.Output["clientSnapshot"]>["nodes"][number]

export declare namespace Zavx0zStorybookAppWebPageAgentBridge {
  /**
Связи bridge с уже существующей страницей и её committed scope.

@property shell - Диагностика и ввод общего Experience; bridge не создаёт Root или Canvas.

@property [waitForStableScope] - Ожидает transition; после HMR возвращает нового владельца bridge.
*/
  export type Input = Readonly<{
    packageId: string
    revision: string
    graphDigest: string
    shell: Shell
    getRoute(): string
    getModel(): Readonly<{selectedNode: Pick<ClientNode, "id" | "kind">, tabActiveId: string}>
    navigate(route: string): Promise<void>
    selectScenario?(value: string): void
    applyRevision(revision: string): Promise<void>
    canApplyRevision?(): boolean
    waitForStableScope?(): Promise<Output | void>
  }>

  /** Действующий bridge страницы; dispose освобождает inspector и свой global binding. */
  export type Output = Readonly<{
    protocol: "external-storybook-agent-bridge/1"
    call(method: "identity" | "inspect" | "interact" | "capture" | "applyRevision", params?: unknown): Promise<unknown>
    invoke(request: Request): Promise<unknown>
    updateIdentity(packageId: string, revision: string, graphDigest: string): void
    dispose(): void
  }>
}
