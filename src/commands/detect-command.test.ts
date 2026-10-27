import { describe, expect, expectTypeOf, it } from 'vite-plus/test';
import { success } from '@beda.software/remote-data';
import type { AxiosRequestConfig } from 'axios';

import type { Service } from '../types.js';
import { Command, DetectedCommandOf, detectCommand } from './detect-command.js';

const encounterCommands = [
    { description: 'Open the patient list', payload: { action: 'openPatients', view: 'list' } },
    {
        description: 'Find encounters',
        parameters: {
            practitionerName: { type: 'string', description: 'Practitioner' },
            since: { type: 'date', description: 'From' },
            count: { type: 'number', description: 'How many' },
            includeCancelled: { type: 'boolean', description: 'Cancelled too' },
        },
        payload: { action: 'findEncounters' },
    },
] as const;

describe('detectCommand', () => {
    it('posts the text and commands to v3 and returns the merged payload with every llmStats entry', async () => {
        const requests: AxiosRequestConfig[] = [];
        const text = "show doctor House's encounters";
        const reply = {
            command: { action: 'findEncounters', practitionerName: 'House' },
            confidence: 1,
            llmStats: [
                { durationSeconds: 0.2, modelId: 'decide', usage: { inputTokens: 698 } },
                { durationSeconds: 0.9, modelId: 'parameters', usage: { inputTokens: 300 } },
            ],
        };
        const service = (async (config: AxiosRequestConfig) => {
            requests.push(config);
            return success(reply);
        }) as Service;

        const response = await detectCommand(service, text, encounterCommands);
        expect(response).toEqual(success(reply));
        expect(requests).toEqual([
            { method: 'POST', url: '/v3/detect-command', data: { text, commands: encounterCommands } },
        ]);
    });
});

describe('DetectedCommandOf', () => {
    it('types each action with its own payload and the parameters it declares', () => {
        type Detected = DetectedCommandOf<typeof encounterCommands>;
        expectTypeOf<Extract<Detected, { action: 'findEncounters' }>>().toEqualTypeOf<{
            action: 'findEncounters';
            practitionerName?: string;
            since?: string;
            count?: number;
            includeCancelled?: boolean;
        }>();
        expectTypeOf<Extract<Detected, { action: 'openPatients' }>>().toEqualTypeOf<{
            action: 'openPatients';
            view: 'list';
        }>();
    });

    it('keeps both sides of a combined list', () => {
        type AppointmentPayload = { action: 'openAppointment'; appointmentId: string };
        type Detected = DetectedCommandOf<[...Command<AppointmentPayload>[], ...typeof encounterCommands]>;
        expectTypeOf<Extract<Detected, { action: 'openAppointment' }>>().toEqualTypeOf<AppointmentPayload>();
        expectTypeOf<Extract<Detected, { action: 'findEncounters' }>['count']>().toEqualTypeOf<number | undefined>();
    });

    it('drops the parameter types of a list typed Command<...>[]', () => {
        expectTypeOf<DetectedCommandOf<Command<{ action: 'findEncounters' }>[]>>().toEqualTypeOf<{
            action: 'findEncounters';
        }>();
    });
});
