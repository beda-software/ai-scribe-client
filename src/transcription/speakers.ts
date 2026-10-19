import { convertMsToSamples, cutSeconds } from './audio.js';
import type { TranscribeSegment } from './types.js';

// The diarizer accepts up to 4; each sample adds input tokens, not audio seconds, to every call.
export const MAX_SAMPLED_SPEAKERS = 1;
const MIN_SAMPLE_LENGTH = convertMsToSamples(2000);
const MAX_SAMPLE_SECONDS = 5;

export interface SpeakerSample {
    speakerId: string;
    samples: Int16Array;
}

/**
 * Maps each diarizer label to a speaker id: a sampled voice keeps its id, a new voice takes the first id that has
 * no sample yet, and every voice past those shares the id after the sampled ones.
 */
export function assignSpeakerIds(segments: TranscribeSegment[], sentSamples: SpeakerSample[]): Map<string, string> {
    const freeIds = getSampledIds().filter((speakerId) => !sentSamples.some((s) => s.speakerId === speakerId));
    const otherId = getSpeakerId(MAX_SAMPLED_SPEAKERS);
    const speakerIds = new Map<string, string>();
    for (const { speaker } of [...segments].sort((first, second) => first.start - second.start)) {
        if (speakerIds.has(speaker)) {
            continue;
        }

        const sampled = sentSamples.find((sample) => getSampleName(sample.speakerId) === speaker);
        speakerIds.set(speaker, sampled?.speakerId ?? freeIds.shift() ?? otherId);
    }
    return speakerIds;
}

export function updateSpeakerSamples(
    current: SpeakerSample[],
    clip: Int16Array,
    segments: TranscribeSegment[],
    speakerIds: ReadonlyMap<string, string>,
): SpeakerSample[] {
    return getSampledIds().flatMap((speakerId) => {
        const existing = current.find((sample) => sample.speakerId === speakerId);
        const longest = findLongestSegment(segments.filter((segment) => speakerIds.get(segment.speaker) === speakerId));
        // A copy: a sample is kept for the whole visit, and a view would keep the whole phrase's audio alive.
        const cut =
            longest &&
            cutSeconds(clip, longest.start, Math.min(longest.end, longest.start + MAX_SAMPLE_SECONDS)).slice();
        if (cut && cut.length >= MIN_SAMPLE_LENGTH && cut.length > (existing?.samples.length ?? 0)) {
            return [{ speakerId, samples: cut }];
        }

        return existing ? [existing] : [];
    });
}

function findLongestSegment(segments: TranscribeSegment[]): TranscribeSegment | undefined {
    return segments.reduce<TranscribeSegment | undefined>(
        (longest, segment) =>
            !longest || segment.end - segment.start > longest.end - longest.start ? segment : longest,
        undefined,
    );
}

// Not the bare letter: the diarizer labels voices it doesn't recognise with letters, which would collide.
export function getSampleName(speakerId: string): string {
    return `speaker_${speakerId.toLowerCase()}`;
}

function getSampledIds(): string[] {
    return Array.from({ length: MAX_SAMPLED_SPEAKERS }, (_, index) => getSpeakerId(index));
}

function getSpeakerId(index: number): string {
    return String.fromCharCode('A'.charCodeAt(0) + index);
}
