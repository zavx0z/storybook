/**
Соединяет страницу, подготовку артефактов и выпуск Web-интерфейса приложения.
Web владеет опубликованной оболочкой и её совместимостью с платформами открытых
страниц. Сервер доставляет готовые результаты и события, сохраняя собственные
HTTP-соединения, каталог и пакетные сессии. Подготовка интерфейса использует
готовую платформу; её явная смена проходит отдельную проверку среды.

@packageDocumentation
*/
import Build from "@app-web/build"
import createRelease from "@web/release"
import Limits from "@tech/limits"
import {join} from "node:path"
import {describeHost, message} from "./src/host"
import {sharedHostEpochs} from "./src/host-epochs"
import type {AppWeb} from "./contract"
import type {WebAssets, WebFailure, WebHost, WebPreparation} from "./contract/types"
export type {AppWeb} from "./contract"

/**
Создаёт одного владельца Web-выпуска без запуска сервера или компиляции.

@param input - Общая очередь, снимки ревизий и доставка событий приложения.
@returns Управление совместимыми артефактами и одной операцией выпуска интерфейса.
@throws При повреждённой конфигурации хранилища или входов установленного Build.
*/
export default function createWeb(input: AppWeb.Input): AppWeb.Output {
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
  let failure: WebFailure | null = null
  const unavailable = new Map<string, string>()
  const requested = new Set<string>()
  const prepared = new Map<string, WebAssets>()
  const retained = new Map<string, InstanceType<typeof Build.Assets>>()
  const failed = (error: unknown): void => {
    failure = Object.freeze({message: message(error).slice(0, 4096), at: new Date().toISOString()})
    input.publish?.({type: "shared.failed", message: failure.message})
  }
  const assets = new Build.Assets({
    ...(restored === null ? {} : {initial: restored}),
    build: signal => input.scheduler().run({packageId: null, owner: "shared",
      reason: "explicit-build",
      generation: null}, async context => {
      const result = await build({root: artifactRoot, toolRoot: input.toolRoot, ...entries}, context, Limits.STORYBOOK_SHARED_COMPILE_TIMEOUT_MS)
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
  const prepareRetained = (identity: NonNullable<WebAssets["browserIdentity"]>): Promise<WebAssets> => {
    if (disposed) return Promise.reject(new Error("Web is stopping"))
    let owner = retained.get(identity.epoch)
    if (owner === undefined) {
      owner = new Build.Assets({
        build: signal => input.scheduler().run({packageId: null, owner: "shared", reason: "explicit-build", generation: null},
          context => build({root: artifactRoot, toolRoot: input.toolRoot, ...entries, sharedKernel: identity}, context,
            Limits.STORYBOOK_SHARED_COMPILE_TIMEOUT_MS), signal),
        updated() {},
        failed,
      })
      retained.set(identity.epoch, owner)
    }
    return owner.ensure()
  }
  const prepare = async (signal: AbortSignal, webOnly: boolean): Promise<readonly WebAssets[]> => {
    if (disposed) throw new Error("Web is stopping")
    const published = webOnly ? assets.current() : null
    if (webOnly && published?.browserIdentity === undefined) throw new Error("Сначала явно подготовьте среду Storybook")
    const next = webOnly ? await prepareRetained(published!.browserIdentity!) : await assets.ensure()
    const hosts = [next]
    unavailable.clear()
    for (const epoch of sharedHostEpochs(input.revisions(), requested)) {
      signal.throwIfAborted()
      if (epoch === next.browserIdentity?.epoch) continue
      const reasons: string[] = []
      const previous = Build.readEpoch(artifactRoot, epoch, undefined, reason => { reasons.push(reason) })
      if (!previous?.browserIdentity) {
        unavailable.set(epoch, `Сохранённая платформа ${epoch} не подтверждена: ${reasons.join("; ")}`)
        continue
      }
      const compatible = await prepareRetained(previous.browserIdentity)
      signal.throwIfAborted()
      hosts.push(compatible)
    }
    signal.throwIfAborted()
    if (webOnly) assets.stageHost(next)
    requested.clear()
    failure = unavailable.size === 0 ? null : Object.freeze({message: [...unavailable.values()].join("\n").slice(0, 4096), at: new Date().toISOString()})
    prepared.clear()
    for (const host of hosts) if (host.browserIdentity) prepared.set(host.browserIdentity.epoch, host)
    return hosts
  }
  const release = createRelease({
    prepare: signal => prepare(signal, true),
    versions: hosts => hosts.map(host => ({platform: host.browserIdentity!.epoch, web: host.browserIdentity!.hostModuleEpoch})),
    publish: hosts => {
      if (unavailable.size > 0) throw new Error(failure?.message ?? "Не все открытые платформы готовы")
      assets.publish(hosts.slice(1), hosts[0])
    },
  })
  const unsubscribe = release.subscribe(state => input.publish?.({type: "app.web", state}))
  const result = (hosts: readonly WebAssets[], published: boolean): WebPreparation => {
    const descriptions = hosts.map(describeHost)
    return Object.freeze({ok: unavailable.size === 0, shared: descriptions[0], hosts: descriptions,
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
      const published = selected.compatibleHosts?.find(host => host.sharedModuleEpoch === epoch)
      const compatible = preview ? prepared.get(epoch) : published ? Build.readEpoch(artifactRoot, epoch, published.hostModuleEpoch) : null
      const previous = compatible ?? Build.readEpoch(artifactRoot, epoch)
      if (!previous) throw new Error(`Нет сохранённой identity платформы ${epoch}; автоматическая замена зависимостей недопустима`)
      requested.add(epoch)
      if (!compatible) {
        throw new Error(`Текущая оболочка для платформы ${epoch} ещё не подготовлена; выполните storybook_check со scope storybook:shared`)
      }
      return describeHost(compatible)
    },
    rebuild(options = {}) {
      const operation = release.rebuild(options)
      rebuilding ??= operation.then(state => {
        const next = assets.prepared() ?? assets.current()
        const hosts = [next, ...[...prepared.values()].filter(value => value.browserIdentity?.epoch !== next.browserIdentity?.epoch)]
        return {...result(hosts, state.phase === "published"), web: state}
      }).finally(() => { rebuilding = null })
      return rebuilding
    },
    async check(options, signal) {
      const hosts = await prepare(signal, false)
      const publish = options.apply === true && unavailable.size === 0
      if (publish) assets.publish(hosts.slice(1), hosts[0])
      return result(hosts, publish)
    },
    read: release.read,
    subscribe: release.subscribe,
    canRefresh(packageId, revision) {
      if (packageId === null || revision === null) return true
      const epoch = input.revisions().find(value => value.packageId === packageId)?.revisions?.find(value => value.revision === revision)?.sharedModuleEpoch
      if (epoch === undefined || unavailable.has(epoch)) return false
      if (prepared.has(epoch)) return true
      try {
        const selected = assets.current()
        return selected.browserIdentity?.epoch === epoch || selected.compatibleHosts?.some(host => host.sharedModuleEpoch === epoch) === true
      } catch { return false }
    },
    dispose() {
      closing ??= (async () => {
        disposed = true
        await Promise.all([release.dispose(), assets.dispose(), ...[...retained.values()].map(owner => owner.dispose())])
        unsubscribe()
        retained.clear()
      })()
      return closing
    },
  })
}
