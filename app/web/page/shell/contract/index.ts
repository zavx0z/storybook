import type {Presentation as Root, RootLinkedAuthorStyleSheet, RootProjection} from "@zavx0z/immersive-browser/integration"
import type {loadDocumentDefaultFont} from "@zavx0z/immersive-engine/default-font"
import type {DisplayElement} from "@zavx0z/immersive-dom/display"
import type {HUDElement} from "@zavx0z/immersive-dom/hud"
import type {SpaceElement} from "@zavx0z/immersive-dom/space"
import type {ViewPointElement} from "@zavx0z/immersive-dom/viewpoint"
import type {HTMLElement as SemanticHTMLElement, Document as SemanticDocument, Node as SemanticNode} from "@zavx0z/immersive-dom"
import type {StorybookAppWebPageShellWorkbench} from "@zavx0z/storybook-app-web-page-shell-workbench"
import type {StorybookContractNavigationReady, StorybookContractSelection} from "./contract-view"
import type {StorybookContractDocument, StorybookDependencyCase} from "./documents"
import type {StorybookOverviewAction} from "./overview-action"
import type {StorybookPreviewBounds, StorybookSpacePreviewRegistration, StorybookSpacePreview} from "./preview"
import type {ExternalStorybookRootFactory, ExternalStorybookNativeKey, StorybookShellUserState, StorybookRetainedRoot, StorybookShellSubject} from "./types"

type Workbench = StorybookAppWebPageShellWorkbench.Output
type WorkbenchPresentationUpdate = Parameters<Workbench["present"]>[0]

/** Публичный контракт @page/shell. */
export declare namespace StorybookAppWebPageShell {
  type Input = Readonly<{
    retainedRoot?: StorybookRetainedRoot
    userState?: StorybookShellUserState
    title: string
    browserDocument?: globalThis.Document
    canvas?: HTMLCanvasElement
    statusOwner?: string
    loadFont?: typeof loadDocumentDefaultFont
    createRoot?: ExternalStorybookRootFactory
    authorStyleSheetSources?: readonly RootLinkedAuthorStyleSheet[]
  }>

  type Output = Readonly<{
    /** Repo имеют самостоятельные Display; пакеты внутри Repo сохраняют собственный UI в общей поверхности. */
    configureSubjects(items: readonly StorybookShellSubject[], onSelect: (id: string, focus?: boolean) => void, onDemand?: (id: string) => void): void
    createSubjectView(options: Readonly<{id: string; title: string; userState?: StorybookShellUserState}>): Output
    selectSubject(id: string, focus?: boolean): void
    readonly followEnvironment: boolean
    setFollowEnvironment(enabled: boolean): void
    subscribeFollowEnvironment(listener: () => void): () => void
    releaseSubjectView(id: string): void
    document: SemanticDocument
    browserDocument: globalThis.Document
    canvas: HTMLCanvasElement
    root: Root
    space: SpaceElement
    viewPoint: ViewPointElement
    display: DisplayElement
    hud: HUDElement
    workbench: Workbench
    readonly presentedFrameSequence: number
    projectionFor(node: SemanticNode): RootProjection
    present(value: WorkbenchPresentationUpdate): void
    mountPreview(label: string, node: SemanticNode): void
    showMessage(label: string, title: string, detail: string, action?: StorybookOverviewAction): SemanticHTMLElement
    showMarkdown(label: string, source: string, baseUrl?: string, action?: StorybookOverviewAction): SemanticHTMLElement
    showContract(label: string, documents: readonly StorybookContractDocument[], signal: AbortSignal, onReady?: StorybookContractNavigationReady, onScroll?: () => void, selection?: StorybookContractSelection): Promise<SemanticHTMLElement>
    showDependencies(label: string, cases: readonly StorybookDependencyCase[], signal: AbortSignal): Promise<SemanticHTMLElement>
    reportDiagnostic(value: unknown): void
    clearDiagnostics(): void
    /** Обновляет уведомление этого Display в нижнем левом углу общего HUD. */
    updateStatus(detail: string): void
    requestRender(): void
    presentFrame(): number
    waitForPresentedFrame(afterSequence: number, signal?: AbortSignal, timeoutMs?: number): Promise<number>
    captureLastPresentedFramePng(): Promise<Blob | null>
    subscribePreviewBounds(listener: (bounds: StorybookPreviewBounds | null) => void): () => void
    mountSpacePreview(label: string, registration: StorybookSpacePreviewRegistration): StorybookSpacePreview
    dispatchNativeKey(target: SemanticHTMLElement, input: ExternalStorybookNativeKey): void
    /** Передаёт текст штатному input owner; false означает отказ редактирования. */
    dispatchNativeText(target: SemanticHTMLElement, text: string): boolean
    captureUserState(): StorybookShellUserState
    releaseRoot(): StorybookRetainedRoot
    dispose(): void
  }>
}
