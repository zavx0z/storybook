/**
Обновление оболочки требуется только платформам живых browser leases и явных
запросов. Неиспользуемая история ревизий не блокирует независимое применение.
*/
export function sharedHostEpochs(
  snapshots: readonly Readonly<{revisions?: readonly Readonly<{leases: number; sharedModuleEpoch?: string}>[]}>[],
  requested: Iterable<string>,
): readonly string[] {
  return [...new Set([...requested, ...snapshots.flatMap(snapshot =>
    snapshot.revisions?.flatMap(revision => revision.leases > 0 && revision.sharedModuleEpoch ? [revision.sharedModuleEpoch] : []) ?? [])])]
}
