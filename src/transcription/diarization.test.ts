import { describe, expect, it } from 'vite-plus/test';
import { isSuccess, success } from '@beda.software/remote-data';

import { convertMsToSamples } from './audio.js';
import { createDiarizer, FetchDiarization, KnownSpeaker } from './diarization.js';
import { getSampleName } from './speakers.js';
import type { DiarizedTranscript } from './types.js';

const buildClip = (seconds: number): Int16Array => new Int16Array(convertMsToSamples(seconds * 1000));

const buildTranscriptBy = (speaker: string, seconds: number): DiarizedTranscript => ({
    text: 'Words.',
    segments: [{ speaker, start: 0, end: seconds, text: 'Words.' }],
    llmStats: null,
});

const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

describe('createDiarizer', () => {
    it('sends the next call only once the previous one has answered, with the sample it cut', async () => {
        const sentSpeakers: KnownSpeaker[][] = [];
        let answerFirst!: () => void;
        const fetchDiarization: FetchDiarization = (_clip, knownSpeakers) => {
            sentSpeakers.push(knownSpeakers);
            return sentSpeakers.length === 1
                ? new Promise((resolve) => (answerFirst = () => resolve(success(buildTranscriptBy('A', 3)))))
                : Promise.resolve(success(buildTranscriptBy(getSampleName('A'), 1)));
        };
        const diarizer = createDiarizer(fetchDiarization);

        const first = diarizer.diarize(buildClip(3));
        const second = diarizer.diarize(buildClip(1));
        await settle();
        expect(sentSpeakers).toHaveLength(1);

        answerFirst();
        const results = await Promise.all([first, second]);
        expect(sentSpeakers).toEqual([[], [{ name: getSampleName('A'), samples: buildClip(3) }]]);
        expect(
            results.map((result) => (isSuccess(result) ? Object.fromEntries(result.data.speakerIds) : null)),
        ).toEqual([{ A: 'A' }, { [getSampleName('A')]: 'A' }]);
    });

    it('sends calls in parallel once every sample slot is taken', async () => {
        let callCount = 0;
        const fetchDiarization: FetchDiarization = () => {
            callCount += 1;
            return callCount === 1 ? Promise.resolve(success(buildTranscriptBy('A', 3))) : new Promise(() => undefined);
        };
        const diarizer = createDiarizer(fetchDiarization);
        await diarizer.diarize(buildClip(3));

        void diarizer.diarize(buildClip(1));
        void diarizer.diarize(buildClip(1));
        await settle();
        expect(callCount).toBe(3);
    });

    it('resolves a fetch that throws as a failure', async () => {
        const result = await createDiarizer(() => Promise.reject(new Error('offline'))).diarize(buildClip(1));
        expect(result.status).toBe('Failure');
    });

    it('resolves calls still waiting as a failure once dropped, without sending them', async () => {
        let callCount = 0;
        let answerFirst!: () => void;
        const fetchDiarization: FetchDiarization = () => {
            callCount += 1;
            return new Promise((resolve) => (answerFirst = () => resolve(success(buildTranscriptBy('A', 1)))));
        };
        const diarizer = createDiarizer(fetchDiarization);

        void diarizer.diarize(buildClip(1));
        const waiting = diarizer.diarize(buildClip(1));
        await settle();
        diarizer.drop();
        answerFirst();
        expect((await waiting).status).toBe('Failure');
        expect(callCount).toBe(1);
    });
});
