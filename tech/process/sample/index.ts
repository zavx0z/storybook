/**
Читает системные сведения о процессах по явному запросу. Снимок сохраняет
отсутствующие значения CPU и RSS, поэтому ошибка наблюдения не превращается
в нулевую нагрузку. Фонового опроса и управления процессами нет.

@packageDocumentation
*/
import {spawnSync} from "node:child_process"
import parseProcessResourceRows from "./src/parse-rows"
import type {StorybookTechProcessSample} from "./contract"
import type {ResourceSampler} from "./src/sampler"

export type {StorybookTechProcessSample} from "./contract"

/**
Читает один системный снимок с ограничением времени и объёма вывода.

Класс не создаёт фонового опроса. Ошибка `ps` превращается в пустой снимок,
чтобы отсутствие данных не подменялось нулевой нагрузкой.
*/
export default class ProcessResourceSampler implements ResourceSampler {
  /** Читает CPU, RSS и время старта из ограниченного вызова системного `ps`. */
  sample(): StorybookTechProcessSample.Output {
    const result = spawnSync("/bin/ps", ["-axo", "pid=,ppid=,%cpu=,rss=,lstart="], {
      encoding: "utf8",
      env: {...process.env, LC_ALL: "C"},
      timeout: 1_000,
      maxBuffer: 4 * 1024 * 1024,
    })
    if (result.status !== 0 || result.error !== undefined || typeof result.stdout !== "string") {
      return Object.freeze([])
    }
    return parseProcessResourceRows(result.stdout)
  }
}
