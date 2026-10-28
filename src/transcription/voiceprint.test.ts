import { describe, expect, it } from 'vite-plus/test';
import { failure, success } from '@beda.software/remote-data';

import { convertMsToSamples } from './audio.js';
import type { FetchDiarization } from './diarization.js';
import type { DiarizedTranscript, TranscribeSegment } from './types.js';
import { checkReading, checkVoiceprint, cutVoiceprintFromTake, getReadingScore, splitWords } from './voiceprint.js';

const SCRIPT =
    'The quick brown fox jumps over the lazy dog. A gentle breeze moves through the tall green trees, and the ' +
    'river runs slowly past the old stone bridge.';
const READING = 'The quick brown fox jumps over the lazy dog, a gentle breeze moves through the trees.';
const SAMPLE_RATE = 24000;

const buildTake = (seconds: number): Int16Array =>
    Int16Array.from({ length: convertMsToSamples(seconds * 1000) }, (_, i) => i % 1000);

const buildSegment = (start: number, end: number): TranscribeSegment => ({ speaker: 'A', start, end, text: 'Words.' });

const buildTranscript = (text: string, segments = [buildSegment(0, 8)]): DiarizedTranscript => ({
    text,
    segments,
    llmStats: [],
});

describe('checkVoiceprint', () => {
    it('rejects a take under the minimum without calling the service', async () => {
        let calls = 0;
        const fetchDiarization: FetchDiarization = () => {
            calls += 1;
            return Promise.resolve(success(buildTranscript(READING)));
        };

        expect(await checkVoiceprint(buildTake(4.9), SCRIPT, fetchDiarization)).toEqual(
            success({ status: 'too-short' }),
        );
        expect(calls).toBe(0);
    });

    it('accepts a faithful reading and keeps the cut voiceprint', async () => {
        const take = buildTake(10);
        const fetchDiarization: FetchDiarization = () =>
            Promise.resolve(success(buildTranscript(READING, [buildSegment(1, 9)])));

        expect(await checkVoiceprint(take, SCRIPT, fetchDiarization)).toEqual(
            success({ status: 'accepted', audioSamples: take.subarray(1 * SAMPLE_RATE, 6 * SAMPLE_RATE) }),
        );
    });

    it('reports a failed reading by its reason and a failed call as a failure', async () => {
        const mismatch: FetchDiarization = () => Promise.resolve(success(buildTranscript('The patient has a fever.')));
        const shortSpeech: FetchDiarization = () =>
            Promise.resolve(success(buildTranscript(READING, [buildSegment(1, 3)])));
        const failed: FetchDiarization = () => Promise.resolve(failure('offline'));

        expect(await checkVoiceprint(buildTake(10), SCRIPT, mismatch)).toEqual(success({ status: 'mismatch' }));
        expect(await checkVoiceprint(buildTake(10), SCRIPT, shortSpeech)).toEqual(success({ status: 'too-short' }));
        expect(await checkVoiceprint(buildTake(10), SCRIPT, failed)).toEqual(failure('offline'));
    });
});

describe('splitWords', () => {
    it('lowercases and drops punctuation, apostrophes included', () => {
        expect(splitWords("Good morning. I'm ready, I’ll  speak!")).toEqual([
            'good',
            'morning',
            'im',
            'ready',
            'ill',
            'speak',
        ]);
    });
});

describe('getReadingScore', () => {
    it('scores the in-order common words over the recognised word count', () => {
        expect(getReadingScore(['a', 'b', 'c', 'd'], ['a', 'b', 'c', 'd'])).toBe(1);
        expect(getReadingScore(['a', 'x', 'c', 'y'], ['a', 'b', 'c', 'd'])).toBe(0.5);
        expect(getReadingScore(['d', 'c', 'b', 'a'], ['a', 'b', 'c', 'd'])).toBe(0.25);
        expect(getReadingScore([], ['a'])).toBe(0);
    });
});

describe('checkReading', () => {
    it('passes a partial but faithful reading of the script', () => {
        expect(checkReading(READING, SCRIPT)).toBe('match');
    });

    it('fails a recognised text that is not the script', () => {
        expect(checkReading('The patient has had a fever since Tuesday night.', SCRIPT)).toBe('mismatch');
    });

    it('treats an empty or near-empty transcription as too quiet', () => {
        expect(checkReading('', SCRIPT)).toBe('too-quiet');
        expect(checkReading('The fox.', SCRIPT)).toBe('too-quiet');
    });
});

describe('cutVoiceprintFromTake', () => {
    const take = Int16Array.from({ length: 10 * SAMPLE_RATE }, (_, i) => i % 1000);

    it('keeps five seconds from the first segment on', () => {
        const audioSamples = cutVoiceprintFromTake(take, [buildSegment(1.5, 4), buildSegment(4, 8)]);
        expect(audioSamples).toEqual(take.subarray(1.5 * SAMPLE_RATE, 6.5 * SAMPLE_RATE));
    });

    it('rejects speech shorter than five seconds, or none', () => {
        expect(cutVoiceprintFromTake(take, [buildSegment(1, 3), buildSegment(3, 5.9)])).toBeUndefined();
        expect(cutVoiceprintFromTake(take, [])).toBeUndefined();
    });
});
