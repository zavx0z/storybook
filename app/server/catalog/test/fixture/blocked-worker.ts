import {parentPort, workerData} from "node:worker_threads"

const gate = workerData.gate as Int32Array
parentPort!.postMessage({type: "analysis", kind: "contract"})
// Блокируется поток вычисления. Главный поток должен обслуживать запросы до его освобождения.
while (Atomics.load(gate, 0) === 0) Atomics.wait(gate, 0, 0)
parentPort!.postMessage({type: "result", result: {kind: "discovered", catalog: {schemaVersion: 1, rootIds: [], scopes: []}}})
parentPort!.close()
