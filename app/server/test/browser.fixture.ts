import type {Zavx0zStorybookAppServer} from "../contract"

/** Проверяет серверный протокол применения через управляемый browser adapter, без запуска Chrome. */
export function readyBrowser(getServer: () => Zavx0zStorybookAppServer.Output): NonNullable<Zavx0zStorybookAppServer.Input["browserLifecycle"]> {
  const views = new Map<string, {viewId: string, packageId: string, route: string, title: string, revision: string}>()
  const identity = (view: {packageId: string, route: string, revision: string}) => ({
    protocol: "external-storybook-agent-bridge/1" as const, ...view,
    graphDigest: getServer().sessions.session(view.packageId).revisionGraphSnapshot(view.revision)!.packageGraphDigest,
    ready: true, presented: true, frameSequence: 2, timeOrigin: 1, consoleErrors: [],
  })
  return {
    async listViews(_origin, _signal, _packages, packageId) { return [...views.values()].filter(view => !packageId || view.packageId === packageId) },
    async openPackage(input) {
      const view = {viewId: `storybook-view-v1_${Buffer.from(input.packageId).toString("base64url").padEnd(43, "a").slice(0, 43)}`,
        packageId: input.packageId, route: input.route, revision: input.expectedRevision!, title: input.packageLabel ?? input.packageId}
      views.set(view.viewId, view)
      return {view, identity: identity(view), reused: false}
    },
    async applyRevision(viewId, revision) {
      const view = views.get(viewId)!
      view.revision = revision
      return {...identity(view), inPageApplied: true}
    },
    getView(viewId) { const view = views.get(viewId)
      if (!view) throw new Error("Unknown test view")
      return view },
    async inspect(viewId) { return identity(views.get(viewId)!) },
    async close(viewId) { return {closed: views.delete(viewId), viewId} },
    async interact() { throw new Error("unused") },
    async capture() { throw new Error("unused") },
    readCapture() { throw new Error("unused") },
  }
}
