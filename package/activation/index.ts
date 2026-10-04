/**
Проверяет результат динамического обновления до подтверждения рабочей ревизии.
Свидетельство приходит от браузерной инспекции; опубликованный факт хранится
у владельца сессии. Подготовленный bundle сам по себе не подтверждает применение.
@packageDocumentation
*/
import type {Zavx0zStorybookPackageActivation} from "./contract"
export type {Zavx0zStorybookPackageActivation} from "./contract"

/** Проверяет точную цель, видимый кадр и отсутствие новых ошибок до commit. */
export default async function activateRevision(input: Zavx0zStorybookPackageActivation.Input): Promise<Zavx0zStorybookPackageActivation.Output> {
  input.signal.throwIfAborted()
  const evidence = await input.inspect()
  input.signal.throwIfAborted()
  const expected = input.expected
  const frameSequence = evidence.frameSequence
  if (evidence.packageId !== expected.packageId || evidence.revision !== expected.revision ||
    evidence.route !== expected.route || evidence.graphDigest !== expected.graphDigest ||
    evidence.ready !== true || evidence.presented !== true || typeof frameSequence !== "number" ||
    !Number.isSafeInteger(frameSequence) || frameSequence < 1 ||
    !Array.isArray(evidence.consoleErrors) || evidence.consoleErrors.length > 0) {
    throw new Error(`Package candidate did not pass activation verification: ${expected.packageId}`)
  }
  const result = Object.freeze({...expected, frameSequence})
  await input.commit?.(result)
  return result
}
