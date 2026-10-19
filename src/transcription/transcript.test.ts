import { describe, expect, it } from 'vite-plus/test';
import { failure, RemoteDataResult, success } from '@beda.software/remote-data';

import { convertMsToSamples } from './audio.js';
import type { DiarizationResult } from './diarization.js';
import {
    applyDiarization,
    createLiveMessage,
    createMessage,
    DiarizationOutcome,
    dropLiveMessages,
    getDiarizationOutcome,
    splitPhraseAudio,
    insertMessage,
    markMessageTranscribing,
    removeMessage,
    TranscriptMessage,
} from './transcript.js';
import type { DiarizedTranscript, TranscribeSegment } from './types.js';

const speakerIds = new Map([
    ['A', 'A'],
    ['B', 'B'],
]);

const buildTranscript = (segments: TranscribeSegment[]): DiarizedTranscript => ({
    text: segments.map((segment) => segment.text).join(' '),
    segments,
    llmStats: null,
});

const buildResult = (
    transcript: DiarizedTranscript,
    ids: ReadonlyMap<string, string>,
): RemoteDataResult<DiarizationResult> => success({ transcript, speakerIds: ids });

const buildMessage = (id: string, spokenAt: number): TranscriptMessage => ({
    id,
    text: id,
    spokenAt,
    status: 'processing',
});

describe('createMessage', () => {
    it('keys the message by its realtime item and stamps now when the spoken time is unknown', () => {
        const before = Date.now();
        const unknownTime = createMessage('item_1', 'Hi.', 'raw', undefined);
        expect(unknownTime.id).toBe('item_1');
        expect(unknownTime.spokenAt).toBeGreaterThanOrEqual(before);
        expect(createMessage('item_2', 'Hi.', 'raw', 5).spokenAt).toBe(5);
    });
});

describe('live messages', () => {
    const messages = [buildMessage('first', 1), createLiveMessage('live', 2), buildMessage('third', 3)];

    it('starts a live message with no text, and drops only live messages or the message asked for', () => {
        expect(createLiveMessage('item_1', 7)).toEqual({ id: 'item_1', text: '', spokenAt: 7, status: 'live' });
        expect(dropLiveMessages(messages).map((message) => message.id)).toEqual(['first', 'third']);
        expect(removeMessage(messages, 'first').map((message) => message.id)).toEqual(['live', 'third']);
    });

    it('marks only a live message as transcribing, and drops it like a live one', () => {
        const marked = markMessageTranscribing(markMessageTranscribing(messages, 'live'), 'first');
        expect(marked.map((message) => message.status)).toEqual(['processing', 'transcribing', 'processing']);
        expect(dropLiveMessages(marked).map((message) => message.id)).toEqual(['first', 'third']);
    });
});

describe('insertMessage', () => {
    const messages = [buildMessage('first', 1000), buildMessage('late', 50_000)];
    const getIdsAfterInsert = (spokenAt: number): string[] =>
        insertMessage(messages, buildMessage('new', spokenAt)).map((message) => message.id);

    it('places a message before the first one spoken after it, and after those spoken at the same time', () => {
        expect(getIdsAfterInsert(20_000)).toEqual(['first', 'new', 'late']);
        expect(getIdsAfterInsert(1000)).toEqual(['first', 'new', 'late']);
        expect(getIdsAfterInsert(60_000)).toEqual(['first', 'late', 'new']);
        expect(insertMessage([], buildMessage('new', 0)).map((message) => message.id)).toEqual(['new']);
    });

    it('takes the place of a message with the same id, placed by its own spoken time', () => {
        const withLive = [buildMessage('first', 1000), createLiveMessage('item', 60_000), buildMessage('late', 50_000)];
        const inserted = insertMessage(withLive, { ...buildMessage('item', 20_000), status: 'raw' });
        expect(inserted.map((message) => [message.id, message.status])).toEqual([
            ['first', 'processing'],
            ['item', 'raw'],
            ['late', 'processing'],
        ]);
    });
});

describe('getDiarizationOutcome', () => {
    const processingRow: TranscriptMessage = {
        id: 'message-1',
        text: 'Hi. Bye.',
        spokenAt: 1_000_000,
        status: 'processing',
    };

    it('pairs one message per segment that has words with that segment, timed from the phrase start', () => {
        const hi = { speaker: 'speaker_a', start: 0.2, end: 1.5, text: ' Hi. ' };
        const bye = { speaker: 'A', start: 2.5, end: 3.1, text: 'Bye.' };
        const outcome = getDiarizationOutcome(
            processingRow,
            buildResult(
                buildTranscript([hi, { speaker: 'B', start: 1.8, end: 2.4, text: '  ' }, bye]),
                new Map([
                    ['speaker_a', 'A'],
                    ['A', 'B'],
                    ['B', 'B'],
                ]),
            ),
        );
        expect(outcome).toEqual({
            type: 'replace',
            segments: [
                {
                    message: {
                        id: 'message-1-0',
                        text: 'Hi.',
                        spokenAt: 1_000_200,
                        status: 'diarized',
                        speakerId: 'A',
                    },
                    segment: hi,
                },
                {
                    message: {
                        id: 'message-1-1',
                        text: 'Bye.',
                        spokenAt: 1_002_500,
                        status: 'diarized',
                        speakerId: 'B',
                    },
                    segment: bye,
                },
            ],
        });
    });

    it('keeps the message raw when the transcript has words but no segment does', () => {
        const outcome = getDiarizationOutcome(
            processingRow,
            buildResult({ ...buildTranscript([]), text: 'Yes.' }, speakerIds),
        );
        expect(outcome).toEqual({ type: 'raw' });
    });

    it('removes the message when no segment has words', () => {
        const outcome = getDiarizationOutcome(
            processingRow,
            buildResult(buildTranscript([{ speaker: 'A', start: 0, end: 1, text: ' ' }]), speakerIds),
        );
        expect(outcome).toEqual({ type: 'remove' });
    });

    it('keeps the message raw when the call fails', () => {
        expect(getDiarizationOutcome(processingRow, failure({ message: 'timeout' }))).toEqual({
            type: 'raw',
        });
    });
});

describe('applyDiarization', () => {
    const messages = [buildMessage('first', 1), buildMessage('second', 2), buildMessage('third', 3)];
    const replace: DiarizationOutcome = {
        type: 'replace',
        segments: [
            {
                message: { id: 'second-0', text: 'Hi.', spokenAt: 2, status: 'diarized', speakerId: 'A' },
                segment: { speaker: 'A', start: 0, end: 1, text: 'Hi.' },
            },
        ],
    };
    const getIdsAfter = (outcome: DiarizationOutcome): string[] =>
        applyDiarization(messages, 'second', outcome).map((message) => message.id);

    it('replaces, removes or makes raw only the message it is for, in place', () => {
        expect(getIdsAfter(replace)).toEqual(['first', 'second-0', 'third']);
        expect(getIdsAfter({ type: 'remove' })).toEqual(['first', 'third']);
        expect(applyDiarization(messages, 'second', { type: 'raw' })[1]).toEqual({
            id: 'second',
            text: 'second',
            spokenAt: 2,
            status: 'raw',
        });
    });

    it('leaves the messages as they are when the message is gone', () => {
        expect(applyDiarization(messages, 'cleared', replace)).toBe(messages);
    });
});

describe('splitPhraseAudio', () => {
    const phrase = new Int16Array(convertMsToSamples(5000));
    const buildSegmentMessage = (
        id: string,
        start: number,
        end: number,
    ): { message: TranscriptMessage; segment: TranscribeSegment } => ({
        message: buildMessage(id, 0),
        segment: { speaker: 'A', start, end, text: id },
    });

    it("cuts each message's segment plus an 800 ms tail, stopping at the phrase end and skipping an empty cut", () => {
        const audio = splitPhraseAudio(phrase, [
            buildSegmentMessage('hi', 1, 2),
            buildSegmentMessage('bye', 4, 5),
            buildSegmentMessage('past', 6, 7),
        ]);
        const getStart = (samples: Int16Array): number => samples.byteOffset / Int16Array.BYTES_PER_ELEMENT;
        expect(audio.map(([messageId, samples]) => [messageId, getStart(samples), samples.length])).toEqual([
            ['hi', convertMsToSamples(1000), convertMsToSamples(1800)],
            ['bye', convertMsToSamples(4000), convertMsToSamples(1000)],
        ]);
    });
});
