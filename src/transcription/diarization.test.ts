import { afterEach, describe, expect, it, vi } from 'vite-plus/test';
import { isSuccess, RemoteDataResult, success } from '@beda.software/remote-data';

import { convertMsToSamples } from './audio.js';
import {
    createDiarizer,
    DiarizationResult,
    FetchDiarization,
    KnownVoiceprint,
    splitTranscript,
} from './diarization.js';
import { getVoiceprintLabel } from './speakers.js';
import type { DiarizedTranscript } from './types.js';

const buildClip = (seconds: number): Int16Array => new Int16Array(convertMsToSamples(seconds * 1000));

const buildTranscriptOfTurns = (...turns: Array<[speaker: string, seconds: number]>): DiarizedTranscript => {
    let start = 0;
    const segments = turns.map(([speaker, seconds]) => {
        const segment = { speaker, start, end: start + seconds, text: 'Words.' };
        start = segment.end;
        return segment;
    });
    return { text: segments.map((segment) => segment.text).join(' '), segments, llmStats: [] };
};

const getSpeakerIds = (result: RemoteDataResult<DiarizationResult>): Record<string, string> | null =>
    isSuccess(result) ? Object.fromEntries(result.data.speakerIds) : null;

const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

const onePerPhrase = { batchSeconds: 0 };

describe('createDiarizer, one call per phrase', () => {
    it('sends the next call only once the previous one has answered, with the voiceprint it cut', async () => {
        const sentVoiceprints: KnownVoiceprint[][] = [];
        let answerFirst!: () => void;
        const fetchDiarization: FetchDiarization = (_clip, knownVoiceprints) => {
            sentVoiceprints.push(knownVoiceprints);
            return sentVoiceprints.length === 1
                ? new Promise((resolve) => (answerFirst = () => resolve(success(buildTranscriptOfTurns(['A', 3])))))
                : Promise.resolve(success(buildTranscriptOfTurns([getVoiceprintLabel('A'), 1])));
        };
        const diarizer = createDiarizer(fetchDiarization, onePerPhrase);

        const first = diarizer.diarize(buildClip(3));
        const second = diarizer.diarize(buildClip(1));
        await settle();
        expect(sentVoiceprints).toHaveLength(1);

        answerFirst();
        const results = await Promise.all([first, second]);
        expect(sentVoiceprints).toEqual([[], [{ label: getVoiceprintLabel('A'), samples: buildClip(3) }]]);
        expect(
            results.map((result) => (isSuccess(result) ? Object.fromEntries(result.data.speakerIds) : null)),
        ).toEqual([{ A: 'A' }, { [getVoiceprintLabel('A')]: 'A' }]);
    });

    it('sends calls in parallel once every voiceprint slot is taken', async () => {
        let callCount = 0;
        const fetchDiarization: FetchDiarization = () => {
            callCount += 1;
            return callCount === 1
                ? Promise.resolve(success(buildTranscriptOfTurns(['A', 3])))
                : new Promise(() => undefined);
        };
        const diarizer = createDiarizer(fetchDiarization, onePerPhrase);
        await diarizer.diarize(buildClip(3));

        void diarizer.diarize(buildClip(1));
        void diarizer.diarize(buildClip(1));
        await settle();
        expect(callCount).toBe(3);
    });

    it('sends a known voiceprint from the first call, in parallel, and keeps it over a longer phrase', async () => {
        const sentVoiceprints: KnownVoiceprint[][] = [];
        const fetchDiarization: FetchDiarization = (_clip, knownVoiceprints) => {
            sentVoiceprints.push(knownVoiceprints);
            return Promise.resolve(success(buildTranscriptOfTurns([getVoiceprintLabel('A'), 5])));
        };
        const knownVoiceprintSamples = buildClip(1);
        const diarizer = createDiarizer(fetchDiarization, {
            ...onePerPhrase,
            knownVoiceprints: [{ speakerId: 'A', samples: knownVoiceprintSamples }],
        });

        const results = await Promise.all([diarizer.diarize(buildClip(5)), diarizer.diarize(buildClip(5))]);
        expect(
            results.map((result) => (isSuccess(result) ? Object.fromEntries(result.data.speakerIds) : null)),
        ).toEqual([{ [getVoiceprintLabel('A')]: 'A' }, { [getVoiceprintLabel('A')]: 'A' }]);

        await diarizer.diarize(buildClip(5));
        expect(sentVoiceprints).toEqual(
            Array(3).fill([{ label: getVoiceprintLabel('A'), samples: knownVoiceprintSamples }]),
        );
    });

    it('gives every voice besides a known voiceprint the other id', async () => {
        const fetchDiarization: FetchDiarization = () =>
            Promise.resolve(
                success({
                    text: 'Words.',
                    segments: [
                        { speaker: getVoiceprintLabel('A'), start: 0, end: 1, text: 'Words.' },
                        { speaker: 'A', start: 1, end: 2, text: 'Words.' },
                        { speaker: 'B', start: 2, end: 3, text: 'Words.' },
                    ],
                    llmStats: [],
                }),
            );
        const diarizer = createDiarizer(fetchDiarization, {
            ...onePerPhrase,
            knownVoiceprints: [{ speakerId: 'A', samples: buildClip(5) }],
        });

        const result = await diarizer.diarize(buildClip(3));
        expect(isSuccess(result) ? Object.fromEntries(result.data.speakerIds) : null).toEqual({
            [getVoiceprintLabel('A')]: 'A',
            A: 'B',
            B: 'B',
        });
    });

    it('gives no voice an id until one leaves a voiceprint', async () => {
        const sentVoiceprints: KnownVoiceprint[][] = [];
        const fetchDiarization: FetchDiarization = (_clip, knownVoiceprints) => {
            sentVoiceprints.push(knownVoiceprints);
            return Promise.resolve(success(buildTranscriptOfTurns(['A', 1])));
        };
        const diarizer = createDiarizer(fetchDiarization, onePerPhrase);

        expect(getSpeakerIds(await diarizer.diarize(buildClip(1)))).toEqual({});
        await diarizer.diarize(buildClip(1));
        expect(sentVoiceprints).toEqual([[], []]);
    });

    it('gives two short voices no id while neither leaves a voiceprint', async () => {
        const diarizer = createDiarizer(
            () => Promise.resolve(success(buildTranscriptOfTurns(['A', 1], ['B', 1]))),
            onePerPhrase,
        );

        expect(getSpeakerIds(await diarizer.diarize(buildClip(2)))).toEqual({});
    });

    it('gives a short first voice A and takes a voiceprint of the long voice after it as B', async () => {
        const sentVoiceprints: KnownVoiceprint[][] = [];
        const fetchDiarization: FetchDiarization = (_clip, knownVoiceprints) => {
            sentVoiceprints.push(knownVoiceprints);
            return Promise.resolve(success(buildTranscriptOfTurns(['A', 1], ['B', 3])));
        };
        const diarizer = createDiarizer(fetchDiarization, onePerPhrase);

        expect(getSpeakerIds(await diarizer.diarize(buildClip(4)))).toEqual({ A: 'A', B: 'B' });
        await diarizer.diarize(buildClip(4));
        expect(sentVoiceprints[1]).toEqual([{ label: getVoiceprintLabel('B'), samples: buildClip(3) }]);
    });

    it('resolves an answer with words but no segments as a failure', async () => {
        const diarizer = createDiarizer(
            () => Promise.resolve(success({ text: 'Yes.', segments: [], llmStats: [] })),
            onePerPhrase,
        );

        expect((await diarizer.diarize(buildClip(1))).status).toBe('Failure');
    });

    it('resolves a throw while handling the answer as a failure', async () => {
        const malformed = { text: 'Hi.', segments: undefined as unknown as [], llmStats: [] };
        const diarizer = createDiarizer(() => Promise.resolve(success(malformed)), onePerPhrase);

        expect((await diarizer.diarize(buildClip(1))).status).toBe('Failure');
    });

    it('resolves a fetch that throws as a failure', async () => {
        const result = await createDiarizer(() => Promise.reject(new Error('offline')), onePerPhrase).diarize(
            buildClip(1),
        );
        expect(result.status).toBe('Failure');
    });

    it('resolves calls still waiting as a failure once dropped, without sending them', async () => {
        let callCount = 0;
        let answerFirst!: () => void;
        const fetchDiarization: FetchDiarization = () => {
            callCount += 1;
            return new Promise((resolve) => (answerFirst = () => resolve(success(buildTranscriptOfTurns(['A', 1])))));
        };
        const diarizer = createDiarizer(fetchDiarization, onePerPhrase);

        void diarizer.diarize(buildClip(1));
        const waiting = diarizer.diarize(buildClip(1));
        await settle();
        diarizer.drop();
        answerFirst();
        expect((await waiting).status).toBe('Failure');
        expect(callCount).toBe(1);
    });
});

describe('createDiarizer, in batches', () => {
    afterEach(() => {
        vi.useRealTimers();
    });

    const recordClips =
        (sentClips: Int16Array[]): FetchDiarization =>
        (clip) => {
            sentClips.push(clip);
            return Promise.resolve(success(buildTranscriptOfTurns()));
        };

    it('sends the phrases as one clip with gaps once 15 s have passed since the first one began', async () => {
        vi.useFakeTimers();
        const sentClips: Int16Array[] = [];
        const diarizer = createDiarizer(recordClips(sentClips));

        void diarizer.diarize(buildClip(3));
        void diarizer.diarize(buildClip(2));
        await vi.advanceTimersByTimeAsync(11_900);
        expect(sentClips).toHaveLength(0);

        await vi.advanceTimersByTimeAsync(100);
        expect(sentClips.map((clip) => clip.length)).toEqual([convertMsToSamples(6200)]);
    });

    it('sends a phrase as long as the batch at once, and the phrases so far on a flush', async () => {
        const sentClips: Int16Array[] = [];
        const diarizer = createDiarizer(recordClips(sentClips), { batchSeconds: 2 });

        void diarizer.diarize(buildClip(3));
        await settle();
        expect(sentClips).toHaveLength(1);

        void diarizer.diarize(buildClip(1));
        diarizer.flush();
        await settle();
        expect(sentClips).toHaveLength(2);
    });

    it('sends at once when a later phrase began more than 15 s ago', async () => {
        const sentClips: Int16Array[] = [];
        const diarizer = createDiarizer(recordClips(sentClips));

        void diarizer.diarize(buildClip(1));
        void diarizer.diarize(buildClip(16));
        await settle();
        expect(sentClips).toHaveLength(1);
    });

    it('resolves each phrase with its own segments and gives the batch stats to the first', async () => {
        const stats = { durationSeconds: 1, modelId: 'gpt-4o-transcribe-diarize' };
        const diarizer = createDiarizer(() =>
            Promise.resolve(
                success({
                    text: 'Hi. Hello.',
                    segments: [
                        { speaker: 'A', start: 0, end: 3, text: 'Hi.' },
                        { speaker: 'B', start: 4.2, end: 6.2, text: 'Hello.' },
                    ],
                    llmStats: [stats],
                }),
            ),
        );

        const results = Promise.all([buildClip(3), buildClip(2), buildClip(1)].map(diarizer.diarize));
        diarizer.flush();
        const transcripts = (await results).map((result) => (isSuccess(result) ? result.data.transcript : null));
        expect(transcripts.map((transcript) => [transcript?.text, transcript?.llmStats])).toEqual([
            ['Hi.', [stats]],
            ['Hello.', []],
            ['', []],
        ]);
        expect(getSpeakerIds((await results)[1]!)).toEqual({ A: 'A', B: 'B' });
    });

    it('fails every phrase of a failed batch', async () => {
        const diarizer = createDiarizer(() => Promise.reject(new Error('offline')));

        const results = Promise.all([buildClip(1), buildClip(1)].map(diarizer.diarize));
        diarizer.flush();
        expect((await results).map((result) => result.status)).toEqual(['Failure', 'Failure']);
    });

    it('fails the collected phrases without sending them once dropped', async () => {
        const sentClips: Int16Array[] = [];
        const diarizer = createDiarizer(recordClips(sentClips));

        const waiting = diarizer.diarize(buildClip(1));
        diarizer.drop();
        expect((await waiting).status).toBe('Failure');
        expect(sentClips).toHaveLength(0);

        expect((await diarizer.diarize(buildClip(1))).status).toBe('Failure');
    });

    it('sends nothing on a flush with no phrases collected', async () => {
        const sentClips: Int16Array[] = [];
        const diarizer = createDiarizer(recordClips(sentClips));

        diarizer.flush();
        await settle();
        expect(sentClips).toHaveLength(0);
    });

    it('fails every phrase when the answer has words but no segments to place them by', async () => {
        const diarizer = createDiarizer(() => Promise.resolve(success({ text: 'Yes.', segments: [], llmStats: [] })));

        const results = Promise.all([buildClip(1), buildClip(1)].map(diarizer.diarize));
        diarizer.flush();
        expect((await results).map((result) => result.status)).toEqual(['Failure', 'Failure']);
    });

    it('fails every phrase when handling the answer throws', async () => {
        const malformed = { text: 'Hi.', segments: undefined as unknown as [], llmStats: [] };
        const diarizer = createDiarizer(() => Promise.resolve(success(malformed)));

        const results = Promise.all([buildClip(1), buildClip(1)].map(diarizer.diarize));
        diarizer.flush();
        expect((await results).map((result) => result.status)).toEqual(['Failure', 'Failure']);
    });
});

describe('splitTranscript', () => {
    const intervals = [
        { start: 0, end: 3 },
        { start: 4.5, end: 6.5 },
        { start: 7.5, end: 8.5 },
    ];
    const stats = { durationSeconds: 1, modelId: 'gpt-4o-transcribe-diarize' };

    it('gives each segment to the phrase it overlaps most, timed from that phrase and cut to it', () => {
        const transcripts = splitTranscript(
            {
                text: 'Hi. Hello. Hm.',
                segments: [
                    { speaker: 'A', start: 0.25, end: 3.25, text: 'Hi.' },
                    { speaker: 'B', start: 4.25, end: 6.25, text: 'Hello.' },
                    { speaker: 'B', start: 6.75, end: 7.25, text: 'Hm.' },
                ],
                llmStats: [stats],
            },
            intervals,
        );
        expect(transcripts).toEqual([
            {
                text: 'Hi.',
                segments: [{ speaker: 'A', start: 0.25, end: 3, text: 'Hi.' }],
                llmStats: [stats],
            },
            {
                text: 'Hello. Hm.',
                segments: [
                    { speaker: 'B', start: 0, end: 1.75, text: 'Hello.' },
                    { speaker: 'B', start: 2, end: 2, text: 'Hm.' },
                ],
                llmStats: [],
            },
            { text: '', segments: [], llmStats: [] },
        ]);
    });

    it('gives a segment the server merged across two phrases to the earlier one, leaving the later one empty', () => {
        const transcripts = splitTranscript(
            {
                text: 'Hello world.',
                segments: [{ speaker: 'A', start: 2, end: 5.5, text: 'Hello world.' }],
                llmStats: [],
            },
            intervals,
        );
        expect(transcripts.map((transcript) => [transcript.text, transcript.segments])).toEqual([
            ['Hello world.', [{ speaker: 'A', start: 2, end: 3, text: 'Hello world.' }]],
            ['', []],
            ['', []],
        ]);
    });
});
