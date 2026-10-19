import { describe, expect, it } from 'vite-plus/test';
import { success } from '@beda.software/remote-data';

import { convertMsToSamples } from './audio.js';
import type { LlmStats, Service } from './types.js';
import { AttachWav, buildDiarizeForm, diarizeClip } from './services.js';

const llmStats: LlmStats = { durationSeconds: 1, modelId: 'diarize', usage: { inputTokens: 10 } };

const respondWith =
    (stats: LlmStats | null): Service =>
    <T>() =>
        Promise.resolve(success({ text: 'Hi.', segments: [], llmStats: stats } as T));

const fetchUsage = async (stats: LlmStats | null): Promise<unknown> => {
    const response = await diarizeClip(
        respondWith(stats),
        new Int16Array(convertMsToSamples(2500)),
        [{ name: 'speaker_a', samples: new Int16Array(convertMsToSamples(5000)) }],
        () => undefined,
    );
    return response.status === 'Success' ? response.data.llmStats?.usage : undefined;
};

describe('diarizeClip', () => {
    it('fills in the clip length as audio seconds, leaving out the speaker samples', async () => {
        expect(await fetchUsage(llmStats)).toEqual({ inputTokens: 10, audioSeconds: 2.5 });
    });

    it("keeps the service's own audio seconds and a missing report as they are", async () => {
        expect(await fetchUsage({ ...llmStats, usage: { audioSeconds: 7 } })).toEqual({ audioSeconds: 7 });
        expect(await fetchUsage(null)).toBeUndefined();
    });
});

describe('buildDiarizeForm', () => {
    const clip = new Int16Array(10);
    const knownSpeakers = [{ name: 'speaker_a', samples: new Int16Array(5) }];

    it('sends the clip as file, then each known speaker as a name and sample pair, and asks for diarization', () => {
        const attachName: AttachWav = (form, field) => form.append(field, 'wav');
        const { form } = buildDiarizeForm(clip, knownSpeakers, attachName);
        expect([...form.keys()]).toEqual(['file', 'speaker', 'sample', 'diarize']);
        expect(form.get('speaker')).toBe('speaker_a');
        expect(form.get('diarize')).toBe('true');
    });

    it('cleans up what it attached when a later attach throws', () => {
        const released: string[] = [];
        const attachOnce: AttachWav = (_form, field) => {
            if (field === 'sample') {
                throw new Error('disk full');
            }

            return () => released.push(field);
        };
        expect(() => buildDiarizeForm(clip, knownSpeakers, attachOnce)).toThrow('disk full');
        expect(released).toEqual(['file']);
    });
});
