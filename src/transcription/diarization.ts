import { failure, isSuccess, RemoteDataResult, success } from '@beda.software/remote-data';

import {
    assignSpeakerIds,
    getSampleName,
    MAX_SAMPLED_SPEAKERS,
    SpeakerSample,
    updateSpeakerSamples,
} from './speakers.js';
import type { DiarizedTranscript } from './types.js';

export interface KnownSpeaker {
    name: string;
    samples: Int16Array;
}

export type FetchDiarization = (
    clip: Int16Array,
    knownSpeakers: KnownSpeaker[],
) => Promise<RemoteDataResult<DiarizedTranscript>>;

export interface DiarizationResult {
    transcript: DiarizedTranscript;
    // Each diarizer label → the speaker's id in this visit.
    speakerIds: ReadonlyMap<string, string>;
}

export interface DiarizerOptions {
    /** Kept for the whole visit: a longer phrase by the same voice never replaces them. */
    knownSamples?: SpeakerSample[];
}

export interface Diarizer {
    // Never rejects: a failed fetch, or a call still waiting when the diarizer is dropped, resolves to a failure.
    diarize: (clip: Int16Array) => Promise<RemoteDataResult<DiarizationResult>>;
    drop: () => void;
}

/** Runs calls one at a time until every sample slot is taken, then in parallel: parallel calls could give one new voice two ids. */
export function createDiarizer(fetchDiarization: FetchDiarization, options: DiarizerOptions = {}): Diarizer {
    const knownSamples = options.knownSamples ?? [];
    let samples: SpeakerSample[] = knownSamples;
    let queue: Promise<unknown> = Promise.resolve();
    let dropped = false;

    const diarizeNow = async (clip: Int16Array): Promise<RemoteDataResult<DiarizationResult>> => {
        if (dropped) {
            return failure('The diarizer was dropped');
        }

        const sentSamples = samples;
        const response = await fetchDiarization(
            clip,
            sentSamples.map((sample) => ({ name: getSampleName(sample.speakerId), samples: sample.samples })),
        ).catch((error: unknown) => failure(error));
        if (!isSuccess(response)) {
            return response;
        }

        const speakerIds = assignSpeakerIds(response.data.segments, sentSamples);
        samples = updateSpeakerSamples(samples, clip, response.data.segments, speakerIds).map(
            (sample) => knownSamples.find((known) => known.speakerId === sample.speakerId) ?? sample,
        );
        return success({ transcript: response.data, speakerIds });
    };

    return {
        diarize: (clip) => {
            if (samples.length >= MAX_SAMPLED_SPEAKERS) {
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
