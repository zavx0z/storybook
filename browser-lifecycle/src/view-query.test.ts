import {expect, test} from "bun:test"
import {validStorybookViewQuery} from "./view-query.ts"

test.each(["", "?inspector=input", "?inspector=output&preview=revision-a", "?preview=a&inspector=source", "?variant=Круг&preview=a&inspector=source", "?view=scenarios&variant=Круг", "?view=overview", "?view=contract", "?view=dependencies"])(
  "адрес рабочего пространства принимает %s", query => {
    expect(validStorybookViewQuery(new URL(`http://localhost/pkg-a/contract${query}`))).toBe(true)
  },
)
test.each(["?inspector=", "?inspector=input&inspector=output", "?preview=a&preview=b", "?foreign=x", "?inspector=%00", "?variant=", "?variant=a&variant=b", "?variant=%00", "?view=", "?view=foreign", "?view=scenarios&view=contract"])(
  "адрес рабочего пространства отклоняет %s", query => {
    expect(validStorybookViewQuery(new URL(`http://localhost/pkg-a/contract${query}`))).toBe(false)
  },
)
