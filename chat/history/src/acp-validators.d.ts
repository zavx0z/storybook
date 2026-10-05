import type {ValidateFunction} from "ajv"
import type {ContentBlock, SessionUpdate} from "@agentclientprotocol/sdk"

/** Native ACP validators, созданные official Ajv standalone без runtime compilation. */
export declare const validateContent: ValidateFunction<ContentBlock>
export declare const validateUpdate: ValidateFunction<SessionUpdate>
