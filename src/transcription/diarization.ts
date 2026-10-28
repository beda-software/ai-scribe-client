import { failure, isSuccess, RemoteDataResult, success } from '@beda.software/remote-data';

import { ClipInterval, convertSamplesToMs, joinClips } from './audio.js';
import { getVoiceprintLabel, identifySpeakers, validateKnownVoiceprints, Voiceprint } from './speakers.js';
import type { DiarizedTranscript, TranscriptSegment } from './types.js';

// The AI scribe service merges one speaker's segments split by a pause under 1 s; a longer gap keeps phrases apart.
const GAP_SECONDS = 1.2;

const DROPPED: RemoteDataResult<never> = failure('The diarizer was dropped');

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
    /** A batch is sent this long after its earliest phrase began; 0 sends every phrase on its own. */
    batchSeconds?: number;
}

export interface Diarizer {
    /** Never rejects: a failed fetch, or a call still waiting when the diarizer is dropped, resolves to a failure. */
    diarize: (clip: Int16Array) => Promise<RemoteDataResult<DiarizationResult>>;
    /** Sends the phrases collected so far without waiting `batchSeconds`. */
    flush: () => void;
    drop: () => void;
}

interface PendingPhrase {
    clip: Int16Array;
    resolve: (result: RemoteDataResult<DiarizationResult>) => void;
}

/** Runs calls one at a time until every voiceprint slot is taken, then in parallel: parallel calls could give one new voice two ids. */
export function createDiarizer(fetchDiarization: FetchDiarization, options: DiarizerOptions = {}): Diarizer {
    const { knownVoiceprints = [], maxVoiceprints = 1, batchSeconds = 15 } = options;
    validateKnownVoiceprints(knownVoiceprints, maxVoiceprints);
    let voiceprints: Voiceprint[] = knownVoiceprints;
    let queue: Promise<unknown> = Promise.resolve();
    let dropped = false;

    const diarizeNow = async (clip: Int16Array): Promise<RemoteDataResult<DiarizationResult>> => {
        if (dropped) {
            return DROPPED;
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

        if (!response.data.segments.length && response.data.text.trim()) {
            return failure('The diarizer returned words without segments');
        }

        const identified = identifySpeakers(clip, response.data.segments, sentVoiceprints, maxVoiceprints);
        voiceprints = identified.voiceprints.map((voiceprint) =>
            pickVoiceprint(voiceprints, knownVoiceprints, voiceprint),
        );
        return success({ transcript: response.data, speakerIds: identified.speakerIds });
    };

    const diarizeInTurn: Diarizer['diarize'] = (clip) => {
        const diarizeSafely = () => diarizeNow(clip).catch((error: unknown) => failure(error));
        if (voiceprints.length >= maxVoiceprints) {
            return diarizeSafely();
        }

        const result = queue.then(diarizeSafely);
        queue = result;
        return result;
    };

    const batcher = batchSeconds > 0 ? createBatcher(diarizeInTurn, batchSeconds) : undefined;
    return {
        diarize: batcher?.diarize ?? diarizeInTurn,
        flush: () => batcher?.flush(),
        drop: () => {
            dropped = true;
            batcher?.drop();
        },
    };
}

/** A known voiceprint stays for the whole visit; any other one is replaced only by a longer one. */
function pickVoiceprint(current: Voiceprint[], knownVoiceprints: Voiceprint[], next: Voiceprint): Voiceprint {
    const known = knownVoiceprints.find((voiceprint) => voiceprint.speakerId === next.speakerId);
    if (known) {
        return known;
    }

    const kept = current.find((voiceprint) => voiceprint.speakerId === next.speakerId);
    return kept && kept.samples.length >= next.samples.length ? kept : next;
}

/** Collects phrases and diarizes them as one clip `batchSeconds` after the earliest of them began. */
function createBatcher(diarize: Diarizer['diarize'], batchSeconds: number): Diarizer {
    let pending: PendingPhrase[] = [];
    let timer: ReturnType<typeof setTimeout> | undefined;
    let batchStartedAt: number | undefined;
    let dropped = false;

    const flush = () => {
        clearTimeout(timer);
        timer = undefined;
        batchStartedAt = undefined;
        const batch = pending;
        pending = [];
        if (!batch.length) {
            return;
        }

        const { clip, intervals } = joinClips(
            batch.map((phrase) => phrase.clip),
            GAP_SECONDS,
        );
        void diarize(clip)
            .then((result) => resolveBatch(batch, intervals, result))
            .catch((error: unknown) => resolveBatch(batch, intervals, failure(error)));
    };

    const diarizeInBatch: Diarizer['diarize'] = (clip) =>
        new Promise((resolve) => {
            if (dropped) {
                resolve(DROPPED);
                return;
            }

            pending.push({ clip, resolve });
            const now = Date.now();
            const spokenAt = now - convertSamplesToMs(clip.length);
            batchStartedAt = Math.min(batchStartedAt ?? spokenAt, spokenAt);
            const waitMs = batchStartedAt + batchSeconds * 1000 - now;
            clearTimeout(timer);
            if (waitMs <= 0) {
                flush();
                return;
            }

            timer = setTimeout(flush, waitMs);
        });

    return {
        diarize: diarizeInBatch,
        flush,
        drop: () => {
            dropped = true;
            clearTimeout(timer);
            pending.forEach((phrase) => phrase.resolve(DROPPED));
            pending = [];
        },
    };
}

function resolveBatch(
    batch: PendingPhrase[],
    intervals: ClipInterval[],
    result: RemoteDataResult<DiarizationResult>,
): void {
    if (!isSuccess(result)) {
        batch.forEach((phrase) => phrase.resolve(result));
        return;
    }

    const transcripts = splitTranscript(result.data.transcript, intervals);
    batch.forEach((phrase, index) =>
        phrase.resolve(success({ transcript: transcripts[index]!, speakerIds: result.data.speakerIds })),
    );
}

/** One transcript per phrase, as if it had been diarized alone; the batch's stats go to the first. */
export function splitTranscript(transcript: DiarizedTranscript, intervals: ClipInterval[]): DiarizedTranscript[] {
    const phraseIndexes = transcript.segments.map((segment) => getPhraseIndex(segment, intervals));

    return intervals.map((interval, index) => {
        const segments = transcript.segments
            .filter((_, segmentIndex) => phraseIndexes[segmentIndex] === index)
            .map((segment) => clampToPhrase(segment, interval));
        return {
            text: segments.map((segment) => segment.text).join(' '),
            segments,
            llmStats: index === 0 ? transcript.llmStats : [],
        };
    });
}

/** The phrase the segment overlaps most; a segment lying in a gap goes to the phrase before it. */
function getPhraseIndex(segment: TranscriptSegment, intervals: ClipInterval[]): number {
    const overlaps = intervals.map(({ start, end }) => Math.min(end, segment.end) - Math.max(start, segment.start));
    const largestOverlap = Math.max(...overlaps);
    if (largestOverlap > 0) {
        return overlaps.indexOf(largestOverlap);
    }

    return intervals.reduce((found, { start }, index) => (start <= segment.start ? index : found), 0);
}

/** Times the segment from the phrase's start, cut to the phrase. */
function clampToPhrase(segment: TranscriptSegment, { start, end }: ClipInterval): TranscriptSegment {
    const clamp = (seconds: number) => Math.min(Math.max(seconds - start, 0), end - start);
    return { ...segment, start: clamp(segment.start), end: clamp(segment.end) };
}
