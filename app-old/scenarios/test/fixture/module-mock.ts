import {mock as observe} from "bun:test"

observe.module("./unexecuted-module", () => ({}))
