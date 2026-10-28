import { describe, expect, it } from 'vite-plus/test';
import { success } from '@beda.software/remote-data';

import { convertMsToSamples } from './audio.js';
import type { LlmStats, Service } from '../types.js';
import { AttachWav, buildDiarizeForm, diarizeClip } from './services.js';

const llmStats: LlmStats = { durationSeconds: 1, modelId: 'diarize', usage: { inputTokens: 10, audioSeconds: 2.5 } };

describe('diarizeClip', () => {
    it('asks the v3 transcribe endpoint and returns its llmStats list as the service reports it', async () => {
        const urls: Array<string | undefined> = [];
        const transcript = { text: 'Hi.', segments: [], llmStats: [llmStats] };
        const service = (<T>(config: { url?: string }) => {
            urls.push(config.url);
            return Promise.resolve(success(transcript as T));
        }) as Service;
        const response = await diarizeClip(
            service,
            new Int16Array(convertMsToSamples(2500)),
            [{ name: 'speaker_a', audioSamples: new Int16Array(convertMsToSamples(5000)) }],
            () => undefined,
        );
        expect(response).toEqual(success(transcript));
        expect(urls).toEqual(['/v3/transcribe']);
    });
});

describe('buildDiarizeForm', () => {
    const clip = new Int16Array(10);
    const knownSpeakers = [{ name: 'speaker_a', audioSamples: new Int16Array(5) }];

    it('sends the clip as file, then each known speaker as a name and voiceprint pair, and asks for diarization', () => {
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
