/** Детерминированная Browser Root seam для проверки жизненного цикла страницы без нового renderer.
@packageDocumentation
*/
import type {WebBrowserFixture} from "./contract"
export type {WebBrowserFixture} from "./contract"
import type {ComponentValue} from "@zavx0z/component"
import type {JSX} from "@jsx-compiler/session"
import type {IntegrationOptions, IntegrationRoot, Presentation} from "@zavx0z/browser/integration"

/** Supplies a deterministic presentation behind the synchronous Browser root contract. */
export default function presentationRootFixture(factory: WebBrowserFixture.Input): WebBrowserFixture.Output {
  return (canvas: HTMLCanvasElement, options: IntegrationOptions = {}): IntegrationRoot => {
    let pending: Promise<Presentation> | null = null
    let current: (Presentation & {renderApplication?(app: ComponentValue | JSX.Element): void}) | null = null
    return {
      render(app) {
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
