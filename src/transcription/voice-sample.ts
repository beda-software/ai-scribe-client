import { mapSuccess, RemoteDataResult, success } from '@beda.software/remote-data';

import { convertMsToSamples, cutSeconds } from './audio.js';
import type { FetchDiarization } from './diarization.js';
import type { TranscribeSegment } from './types.js';

export const MIN_TAKE_SECONDS = 5;
export const MAX_TAKE_SECONDS = 10;
const SAMPLE_SECONDS = 5;
const MIN_MATCH_SCORE = 0.7;
// Fewer recognised words than this means the mic caught next to no speech.
const MIN_RECOGNISED_WORDS = 3;

export type VoiceSampleCheck =
    | { status: 'accepted'; sample: Int16Array }
    | { status: 'too-short' | 'too-quiet' | 'mismatch' };

type ReadingCheck = 'match' | 'mismatch' | 'too-quiet';

/** Checks a read-aloud take against its script and cuts the sample to keep; a failure means the call itself failed. */
export async function checkVoiceSample(
    take: Int16Array,
    script: string,
    fetchDiarization: FetchDiarization,
): Promise<RemoteDataResult<VoiceSampleCheck>> {
    if (take.length < convertMsToSamples(MIN_TAKE_SECONDS * 1000)) {
        return success({ status: 'too-short' });
    }

    const response = await fetchDiarization(take, []);
    return mapSuccess(response, ({ text, segments }): VoiceSampleCheck => {
        const reading = checkReading(text, script);
        if (reading !== 'match') {
            return { status: reading };
        }

        const sample = cutVoiceSample(take, segments);
        return sample ? { status: 'accepted', sample } : { status: 'too-short' };
    });
}

export function checkReading(recognised: string, script: string): ReadingCheck {
    const recognisedWords = splitWords(recognised);
    if (recognisedWords.length < MIN_RECOGNISED_WORDS) {
        return 'too-quiet';
    }

    return getReadingScore(recognisedWords, splitWords(script)) >= MIN_MATCH_SCORE ? 'match' : 'mismatch';
}

export function splitWords(text: string): string[] {
    return text
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, '')
        .split(/\s+/)
        .filter(Boolean);
}

/** The share of recognised words that follow the script in order: their longest common subsequence over their count. */
export function getReadingScore(recognisedWords: string[], scriptWords: string[]): number {
    if (!recognisedWords.length) {
        return 0;
    }

    let previousRow = new Array<number>(scriptWords.length + 1).fill(0);
    for (const recognisedWord of recognisedWords) {
        const row = [0];
        scriptWords.forEach((scriptWord, index) => {
            row.push(
                recognisedWord === scriptWord
                    ? previousRow[index]! + 1
                    : Math.max(previousRow[index + 1]!, row[index]!),
            );
        });
        previousRow = row;
    }

    return previousRow[scriptWords.length]! / recognisedWords.length;
}

/** The sample to keep: SAMPLE_SECONDS from the first segment on, or `undefined` when the speech is shorter. */
export function cutVoiceSample(samples: Int16Array, segments: TranscribeSegment[]): Int16Array | undefined {
    const speechStart = segments[0]?.start;
    const speechEnd = segments[segments.length - 1]?.end;
    if (speechStart === undefined || speechEnd === undefined || speechEnd - speechStart < SAMPLE_SECONDS) {
        return undefined;
    }

    return cutSeconds(samples, speechStart, speechStart + SAMPLE_SECONDS);
}
