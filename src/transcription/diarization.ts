import { failure, isSuccess, RemoteDataResult, success } from '@beda.software/remote-data';

import { getVoiceprintLabel, identifySpeakers, validateKnownVoiceprints, Voiceprint } from './speakers.js';
import type { DiarizedTranscript } from './types.js';

/** A voiceprint the diarizer should recognise: `label` is what it calls that voice in its answer. */
export interface KnownVoiceprint {
    label: string;
    samples: Int16Array;
}

export type FetchDiarization = (
    clip: Int16Array,
    knownVoiceprints: KnownVoiceprint[],
) => Promise<RemoteDataResult<DiarizedTranscript>>;

export interface DiarizationResult {
    transcript: DiarizedTranscript;
    /** Each diarizer label → the speaker's id in this visit; a voice that can't be told yet has none. */
    speakerIds: ReadonlyMap<string, string>;
}

export interface DiarizerOptions {
    /** Kept for the whole visit; each has its own speaker id among the first `maxVoiceprints + 1`, or the diarizer throws. */
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
    validateKnownVoiceprints(knownVoiceprints, maxVoiceprints);
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
                label: getVoiceprintLabel(voiceprint.speakerId),
                samples: voiceprint.samples,
            })),
        ).catch((error: unknown) => failure(error));
        if (!isSuccess(response)) {
            return response;
        }

        const identified = identifySpeakers(clip, response.data.segments, sentVoiceprints, maxVoiceprints);
        voiceprints = identified.voiceprints.map(
            (voiceprint) => knownVoiceprints.find((known) => known.speakerId === voiceprint.speakerId) ?? voiceprint,
        );
        return success({ transcript: response.data, speakerIds: identified.speakerIds });
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
