import {expect, test} from "bun:test"
import {sharedHostEpochs} from "./shared-host-epochs.ts"

test("история без browser leases не требует обновления оболочки", () => {
  expect(sharedHostEpochs([{revisions: [
    {leases: 0, sharedModuleEpoch: "obsolete"},
    {leases: 2, sharedModuleEpoch: "visible"},
    {leases: 1, sharedModuleEpoch: "visible"},
  ]}], ["requested"])).toEqual(["requested", "visible"])
})
