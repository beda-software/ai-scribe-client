import { failure, isSuccess, RemoteDataResult, success } from '@beda.software/remote-data';

import { getVoiceprintName, IdentifiedSpeakers, identifySpeakers, Voiceprint } from './speakers.js';
import type { DiarizedTranscript } from './types.js';

export interface KnownSpeaker {
    name: string;
    audioSamples: Int16Array;
}

export type FetchDiarization = (
    clip: Int16Array,
    knownSpeakers: KnownSpeaker[],
) => Promise<RemoteDataResult<DiarizedTranscript>>;

export interface DiarizationResult {
    transcript: DiarizedTranscript;
    speakerIds: IdentifiedSpeakers['speakerIdsByLabel'];
}

export interface DiarizerOptions {
    /** Kept for the whole visit: a longer phrase by the same voice never replaces them. */
    knownVoiceprints?: Voiceprint[];
    /** The diarizer accepts up to 4; each voiceprint adds input tokens to every call. */
    maxVoiceprints?: number;
}

export interface Diarizer {
    // Never rejects: a failed fetch, or a call still waiting when the diarizer is dropped, resolves to a failure.
    diarize: (clip: Int16Array) => Promise<RemoteDataResult<DiarizationResult>>;
    drop: () => void;
}

/** Runs calls one at a time until every voiceprint slot is taken, then in parallel: parallel calls could give one new voice two ids. */
export function createDiarizer(fetchDiarization: FetchDiarization, options: DiarizerOptions = {}): Diarizer {
    const { knownVoiceprints = [], maxVoiceprints = 1 } = options;
    let voiceprints: Voiceprint[] = knownVoiceprints;
    let queue: Promise<unknown> = Promise.resolve();
    let dropped = false;

    const diarizeNow = async (clip: Int16Array): Promise<RemoteDataResult<DiarizationResult>> => {
        if (dropped) {
            return failure('The diarizer was dropped');
        }

        const sentVoiceprints = voiceprints;
        const response = await fetchDiarization(
            clip,
            sentVoiceprints.map((voiceprint) => ({
                name: getVoiceprintName(voiceprint.speakerId),
                audioSamples: voiceprint.audioSamples,
            })),
        ).catch((error: unknown) => failure(error));
        if (!isSuccess(response)) {
            return response;
        }

        const identified = identifySpeakers(clip, response.data.segments, sentVoiceprints, maxVoiceprints);
        voiceprints = identified.voiceprints.map(
            (voiceprint) => knownVoiceprints.find((known) => known.speakerId === voiceprint.speakerId) ?? voiceprint,
        );
        return success({ transcript: response.data, speakerIds: identified.speakerIdsByLabel });
    };

    return {
        diarize: (clip) => {
            if (voiceprints.length >= maxVoiceprints) {
                return diarizeNow(clip);
            }

            const result = queue.then(() => diarizeNow(clip));
            queue = result.catch(() => undefined);
            return result;
        },
        drop: () => {
            dropped = true;
        },
    };
}
