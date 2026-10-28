import { mapSuccess, RemoteDataResult, success } from '@beda.software/remote-data';

import { convertMsToSamples, cutSeconds } from './audio.js';
import type { FetchDiarization } from './diarization.js';
import { MAX_VOICEPRINT_SECONDS } from './speakers.js';
import type { TranscribeSegment } from './types.js';

export const MIN_VOICEPRINT_TAKE_SECONDS = 5;
export const MAX_VOICEPRINT_TAKE_SECONDS = 10;
const MIN_MATCH_SCORE = 0.7;
// Fewer recognised words than this means the mic caught next to no speech.
const MIN_RECOGNISED_WORDS = 3;

export type VoiceprintCheck =
    | { status: 'accepted'; audioSamples: Int16Array }
    | { status: 'too-short' | 'too-quiet' | 'mismatch' };

type ReadingCheck = 'match' | 'mismatch' | 'too-quiet';

/** Checks a read-aloud take against its script and cuts the voiceprint's audio; a failure means the call itself failed. */
export async function checkVoiceprint(
    take: Int16Array,
    script: string,
    fetchDiarization: FetchDiarization,
): Promise<RemoteDataResult<VoiceprintCheck>> {
    if (take.length < convertMsToSamples(MIN_VOICEPRINT_TAKE_SECONDS * 1000)) {
        return success({ status: 'too-short' });
    }

    const response = await fetchDiarization(take, []);
    return mapSuccess(response, ({ text, segments }): VoiceprintCheck => {
        const reading = checkReading(text, script);
        if (reading !== 'match') {
            return { status: reading };
        }

        const audioSamples = cutVoiceprintFromTake(take, segments);
        return audioSamples ? { status: 'accepted', audioSamples } : { status: 'too-short' };
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

/** The voiceprint's audio: MAX_VOICEPRINT_SECONDS from the first segment on, or `undefined` when the speech is shorter. */
export function cutVoiceprintFromTake(take: Int16Array, segments: TranscribeSegment[]): Int16Array | undefined {
    const speechStart = segments[0]?.start;
    const speechEnd = segments[segments.length - 1]?.end;
    if (speechStart === undefined || speechEnd === undefined || speechEnd - speechStart < MAX_VOICEPRINT_SECONDS) {
        return undefined;
    }

    return cutSeconds(take, speechStart, speechStart + MAX_VOICEPRINT_SECONDS);
}
