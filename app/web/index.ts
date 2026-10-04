/**
Соединяет страницу, подготовку артефактов и выпуск Web-интерфейса приложения.
Web владеет текущей опубликованной оболочкой. Старые страницы читают свои
готовые файлы до явного обновления пакета. Сервер доставляет готовые результаты и события, сохраняя собственные
HTTP-соединения, каталог и пакетные сессии. Подготовка интерфейса использует
готовую платформу; её явная смена проходит отдельную проверку среды.

@packageDocumentation
*/
import Build from "@zavx0z/storybook-app-web-build"
import createRelease from "@zavx0z/storybook-app-web-release"
import {join} from "node:path"
import {describeHost, message} from "./src/host"
import type {Zavx0zStorybookAppWeb} from "./contract"
import type {WebAssets, WebFailure, WebHost, WebPreparation} from "./contract/types"
export type {Zavx0zStorybookAppWeb} from "./contract"

/**
Создаёт одного владельца Web-выпуска без запуска сервера или компиляции.

@param input - Общая очередь, снимки ревизий и доставка событий приложения.
@returns Управление текущими артефактами и одной операцией выпуска интерфейса.
@throws При повреждённой конфигурации хранилища или входов установленного Build.
*/
export default function createWeb(input: Zavx0zStorybookAppWeb.Input): Zavx0zStorybookAppWeb.Output {
  const artifactRoot = join(input.artifactRoot, "shared")
  const build = input.build ?? Build.runWorker
  const entries = {
    landingEntryPath: input.landingEntryPath ?? Build.sources.browserEntry,
    fallbackEntryPath: input.fallbackEntryPath ?? Build.sources.browserEntry,
  }
  const restored = Build.readPublishedReceipt({root: artifactRoot, toolRoot: input.toolRoot,
    ...entries, stagingDirectory: join(artifactRoot, ".receipt-check")})
  let disposed = false
  let closing: Promise<void> | null = null
  let rebuilding: Promise<WebPreparation> | null = null
  let rebuildApply = false
  let rebuildStarted = false
  const lifetime = new AbortController()
  let preparationTail: Promise<void> = Promise.resolve()
  let checking: Readonly<{
    controller: AbortController
    callers: Set<Readonly<{apply: boolean}>>
    promise: Promise<WebPreparation>
  }> | null = null
  // Кандидат не меняется между подготовкой и атомарной публикацией.
  const serial = <Result>(operation: () => Promise<Result>): Promise<Result> => {
    const pending = preparationTail.then(operation)
    preparationTail = pending.then(() => {}, () => {})
    return pending
  }
  let failure: WebFailure | null = null
  const failed = (error: unknown): void => {
    failure = Object.freeze({message: message(error).slice(0, 4096), at: new Date().toISOString()})
    input.publish?.({type: "shared.failed", message: failure.message})
  }
  const assets = new Build.Assets({
    ...(restored === null ? {} : {initial: restored}),
    build: signal => input.scheduler().run({packageId: null, owner: "shared",
      reason: "explicit-build",
      generation: null}, async context => {
      if (input.preparePlatform === undefined) throw new Error("Явная подготовка платформы не подключена приложением")
      const platform = await input.preparePlatform({root: artifactRoot, toolRoot: input.toolRoot}, context)
      context.signal.throwIfAborted()
      const result = await build({root: artifactRoot, toolRoot: input.toolRoot, ...entries,
        sharedKernel: platform.identity, kernelArtifacts: platform.artifacts}, context)
      failure = null
      return result
    }, signal),
    commit: value => Build.saveReceipt(value),
    updated: value => {
      const host = describeHost(value)
      input.publish?.({type: "shared.updated", host, entry: host.pageEntryUrl})
    },
    failed,
  })
  const current = (preview = false): WebAssets => preview ? assets.prepared() ?? assets.current() : assets.current()
  const prepare = async (signal: AbortSignal, webOnly: boolean): Promise<readonly WebAssets[]> => {
    if (disposed) throw new Error("Web is stopping")
    signal.throwIfAborted()
    let next: WebAssets
    if (webOnly) {
      const identity = assets.current().browserIdentity
      if (identity === undefined) throw new Error("Сначала явно подготовьте среду Storybook")
      try {
        next = await input.scheduler().run({packageId: null, owner: "shared", reason: "explicit-build", generation: null},
          context => build({root: artifactRoot, toolRoot: input.toolRoot, ...entries, sharedKernel: identity,
            kernelArtifacts: assets.current().artifactDigests!.filter(artifact => artifact.path.startsWith("kernel/"))}, context), signal)
      } catch (error) {
        failed(error)
        throw error
      }
      signal.throwIfAborted()
      assets.stageHost(next)
    } else {
      next = await assets.ensure()
      signal.throwIfAborted()
    }
    failure = null
    return [next]
  }
  const release = createRelease({
    prepare: signal => prepare(signal, true),
    versions: hosts => hosts.map(host => ({platform: host.browserIdentity!.epoch, web: host.browserIdentity!.hostModuleEpoch})),
    publish: hosts => { assets.publish(hosts[0]) },
  })
  const unsubscribe = release.subscribe(state => input.publish?.({type: "app.web", state}))
  const result = (hosts: readonly WebAssets[], published: boolean): WebPreparation => {
    const descriptions = hosts.map(describeHost)
    return Object.freeze({ok: true, shared: descriptions[0], hosts: descriptions,
      packages: Object.freeze([]) as readonly [], published, applied: false})
  }
  return Object.freeze({
    artifactRoot,
    packageEntryPath: Build.sources.packageEntry,
    readStyleSheets: () => Build.readTheme(input.toolRoot),
    get platform() { try { return assets.current().browserIdentity } catch { return undefined } },
    get error() { return failure },
    assets: current,
    host(epoch?: string, preview = false): WebHost {
      const selected = current(preview)
      if (epoch === undefined || epoch === selected.browserIdentity?.epoch) return describeHost(selected)
      // Старая страница сохраняет готовый host своей платформы до явного обновления пакета.
      const previous = Build.readEpoch(artifactRoot, epoch)
      if (!previous) throw new Error(`Нет сохранённой платформы ${epoch}; выполните проверку пакета для перехода на текущую среду`)
      return describeHost(previous)
    },
    rebuild(options = {}) {
      if (disposed) return Promise.reject(new Error("Web is stopping"))
      rebuildApply ||= options.apply === true
      if (rebuildStarted) {
        // Присоединяем intent к исполняемому release, не создавая новую подготовку.
        void release.rebuild(options).catch(() => {})
      }
      rebuilding ??= serial(async () => {
        lifetime.signal.throwIfAborted()
        rebuildStarted = true
        const state = await release.rebuild({apply: rebuildApply}).finally(() => { rebuildStarted = false })
        const next = assets.prepared() ?? assets.current()
        const hosts = [next]
        return {...result(hosts, state.phase === "published"), web: state}
      }).finally(() => {
        rebuilding = null
        rebuildApply = false
        rebuildStarted = false
      })
      return rebuilding
    },
    async check(options, signal) {
      if (disposed) return Promise.reject(new Error("Web is stopping"))
      signal.throwIfAborted()
      if (checking === null || checking.controller.signal.aborted) {
        const controller = new AbortController()
        const callers = new Set<Readonly<{apply: boolean}>>()
        const promise = serial(async () => {
          const preparationSignal = AbortSignal.any([lifetime.signal, controller.signal])
          const hosts = await prepare(preparationSignal, false)
          preparationSignal.throwIfAborted()
          const publish = [...callers].some(caller => caller.apply)
          if (publish) assets.publish(hosts[0])
          return result(hosts, publish)
        }).finally(() => {
          if (checking?.promise === promise) checking = null
        })
        checking = {controller, callers, promise}
      }
      const operation = checking
      const caller = Object.freeze({apply: options.apply === true})
      operation.callers.add(caller)
      return new Promise<WebPreparation>((resolve, reject) => {
        const cleanup = () => {
          signal.removeEventListener("abort", cancel)
          operation.callers.delete(caller)
        }
        const cancel = () => {
          cleanup()
          // Уход последнего клиента отменяет набор подготовки, но не общий worker.
          if (operation.callers.size === 0) operation.controller.abort(signal.reason)
          reject(signal.reason)
        }
        signal.addEventListener("abort", cancel, {once: true})
        if (signal.aborted) cancel()
        operation.promise.then(value => {
          cleanup()
          if (signal.aborted) reject(signal.reason)
          else resolve(value)
        }, error => {
          cleanup()
          reject(error)
        })
      })
    },
    read: release.read,
    subscribe: release.subscribe,
    canRefresh(packageId, revision) {
      if (packageId === null || revision === null) return true
      const epoch = input.revisions().find(value => value.packageId === packageId)?.revisions?.find(value => value.revision === revision)?.sharedModuleEpoch
      if (epoch === undefined) return false
      try {
        const selected = assets.current()
        return selected.browserIdentity?.epoch === epoch
      } catch { return false }
    },
    dispose() {
      closing ??= (async () => {
        disposed = true
        lifetime.abort(new DOMException("Web is stopping", "AbortError"))
        await Promise.all([release.dispose(), assets.dispose(), preparationTail])
        unsubscribe()
      })()
      return closing
    },
  })
}
