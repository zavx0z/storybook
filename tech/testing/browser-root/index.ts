/** Детерминированная Browser Root seam для проверки жизненного цикла страницы без нового renderer.
@packageDocumentation
*/
import type {StorybookTechTestingBrowserRoot} from "./contract"
export type {StorybookTechTestingBrowserRoot} from "./contract"
import type {DOMConstruction, DOMRenderOptions} from "@zavx0z/immersive"
import type {JSX} from "@zavx0z/immersive/XReact"
import type {IntegrationOptions, IntegrationRoot, Presentation} from "@zavx0z/immersive"

/** Supplies a deterministic presentation behind the synchronous Browser root contract. */
export default function presentationRootFixture(factory: StorybookTechTestingBrowserRoot.Input): StorybookTechTestingBrowserRoot.Output {
  return (canvas: HTMLCanvasElement, options: IntegrationOptions = {}): IntegrationRoot => {
    let pending: Promise<Presentation> | null = null
    let current: (Presentation & {renderApplication?(app: DOMConstruction<any> | JSX.Element): void}) | null = null
    return {
      get document() {
        if (current === null) throw new Error("This shell fixture requires readiness before document access")
        return current.document
      },
      render(input?: unknown, props?: unknown, renderOptions: DOMRenderOptions = {}) {
        if (arguments.length === 0) {
          current?.render()
          return
        }
        const app = (typeof input === "function" ? {type: input, props, ...renderOptions} : input) as DOMConstruction<any> | JSX.Element
        if (app === null) throw new Error("This shell fixture expects an application")
        if (current?.renderApplication) {
          current.renderApplication(app)
          pending = Promise.resolve(current)
        } else pending = factory({...options, canvas, app}).then(root => {
          current = root
          return root
        })
      },
      whenReady() {
        if (!pending) throw new Error("render must precede shell readiness")
        return pending
      },
      unmount() { if (pending) void pending.then(root => root.unmount()) },
    }
  }
}
