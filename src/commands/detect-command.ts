import type { RemoteDataResult } from '@beda.software/remote-data';

import type { LlmStats, Service } from '../types.js';

export interface CommandParameter {
    type: 'string' | 'number' | 'boolean' | 'date';
    description: string;
}

// The payload is echoed back with the parameter values merged in, so no parameter may share a name with a payload key,
// `action` included.
export interface CommandPayload {
    action: string;
}

// The model never sees `payload`; only `description` and `parameters` steer detection.
export interface Command<Payload extends CommandPayload> {
    description: string;
    parameters?: Record<string, CommandParameter>;
    payload: Payload;
}

export interface DetectedCommand<Detected> {
    command: Detected | null;
    confidence: number | null;
    llmStats: LlmStats[];
}

// A list typed `Command<...>[]` widens `parameters` to a Record, so only a list kept `as const` or inline types them.
export type DetectedCommandOf<Commands extends readonly Command<CommandPayload>[]> = DetectedOf<Commands[number]>;

type DetectedOf<C> = C extends { payload: infer Payload; parameters: infer Parameters }
    ? Flatten<Mutable<Payload> & { -readonly [Name in keyof Parameters]?: ParameterValue<Parameters[Name]> }>
    : C extends { payload: infer Payload }
      ? Mutable<Payload>
      : never;

type Mutable<T> = { -readonly [Key in keyof T]: T[Key] };

type Flatten<T> = { [Key in keyof T]: T[Key] };

interface ParameterValues {
    string: string;
    date: string;
    number: number;
    boolean: boolean;
}

type ParameterValue<Parameter> = Parameter extends { type: infer Type extends keyof ParameterValues }
    ? ParameterValues[Type]
    : never;

type DetectResponse<Commands extends readonly Command<CommandPayload>[]> = DetectedCommand<DetectedCommandOf<Commands>>;

/** Asks the AI scribe which of `commands` the text says; `command` is null when it says none of them. */
export function detectCommand<const Commands extends readonly Command<CommandPayload>[]>(
    service: Service,
    text: string,
    commands: Commands,
): Promise<RemoteDataResult<DetectResponse<Commands>>> {
    return service<DetectResponse<Commands>>({
        method: 'POST',
        url: '/v3/detect-command',
        data: { text, commands },
    });
}
