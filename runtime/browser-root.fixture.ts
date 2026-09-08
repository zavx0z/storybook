import type {ComponentValue} from "@zavx0z/component"
import type {JsxSourceElement} from "@zavx0z/template/jsx-runtime"
import type {IntegrationOptions, IntegrationRoot, Presentation} from "@zavx0z/browser/integration"

export type PresentationFixtureOptions = IntegrationOptions & {
  canvas: HTMLCanvasElement
  app: ComponentValue | JsxSourceElement
}

/** Supplies a deterministic presentation behind the synchronous Browser root contract. */
export function presentationRootFixture(factory: (options: PresentationFixtureOptions) => Promise<Presentation>) {
  return (canvas: HTMLCanvasElement, options: IntegrationOptions = {}): IntegrationRoot => {
    let pending: Promise<Presentation> | null = null
    return {
      render(app) {
        if (app === null) throw new Error("This shell fixture expects an application")
        pending = factory({...options, canvas, app})
      },
      whenReady() {
        if (!pending) throw new Error("render must precede shell readiness")
        return pending
      },
      unmount() { if (pending) void pending.then(root => root.unmount()) },
    }
  }
}
