import { cutSeconds } from './audio.js';
import type { TranscribeSegment } from './types.js';

const MIN_SAMPLE_SECONDS = 2;
const MAX_SAMPLE_SECONDS = 5;

// The diarizer names voices anew in every call: 'speaker_a' for a sent sample, 'A', 'B', … for any other voice.
type DiarizerLabel = string;
type SpeakerId = string;

export interface SpeakerSample {
    speakerId: SpeakerId;
    samples: Int16Array;
}

export interface IdentifiedSpeakers {
    speakerIdsByLabel: ReadonlyMap<DiarizerLabel, SpeakerId>;
    speakerSamples: SpeakerSample[];
}

export function identifySpeakers(
    clip: Int16Array,
    segments: TranscribeSegment[],
    sentSamples: SpeakerSample[],
    maxSampledSpeakers: number,
): IdentifiedSpeakers {
    const ids = listSpeakerIds(maxSampledSpeakers);
    const spokenSegments = segments.filter((segment) => segment.text.trim());
    const cutLabel = (label: DiarizerLabel) => cutSample(clip, spokenSegments, label);
    const labels = listLabelsInSpeakingOrder(spokenSegments);
    const sentIds = new Map(sentSamples.map((sample) => [getSampleName(sample.speakerId), sample.speakerId]));
    const newSamples = sampleNewLabels(
        labels.filter((label) => !sentIds.has(label)),
        cutLabel,
        sentSamples,
        ids,
    );
    const speakerSamples = [
        ...sentSamples.map((sample) => lengthenSample(sample, cutLabel(getSampleName(sample.speakerId)))),
        ...newSamples.values(),
    ];
    const sharedId = findSharedId(speakerSamples, ids);
    const speakerIdsByLabel = new Map(
        labels.flatMap((label) => {
            const speakerId = sentIds.get(label) ?? newSamples.get(label)?.speakerId ?? sharedId;
            return speakerId ? [[label, speakerId] as const] : [];
        }),
    );

    return { speakerIdsByLabel, speakerSamples };
}

/** One id per sampled voice, and one shared by every voice past them. */
function listSpeakerIds(maxSampledSpeakers: number): SpeakerId[] {
    return Array.from({ length: maxSampledSpeakers + 1 }, (_, index) => String.fromCharCode('A'.charCodeAt(0) + index));
}

function cutSample(clip: Int16Array, segments: TranscribeSegment[], label: DiarizerLabel): Int16Array | undefined {
    const longest = findLongestSegment(segments.filter((segment) => segment.speaker === label));
    if (!longest || longest.end - longest.start < MIN_SAMPLE_SECONDS) {
        return undefined;
    }

    // A copy: a sample is kept for the whole visit, and a view would keep the whole phrase's audio alive.
    return cutSeconds(clip, longest.start, Math.min(longest.end, longest.start + MAX_SAMPLE_SECONDS)).slice();
}

function listLabelsInSpeakingOrder(segments: TranscribeSegment[]): DiarizerLabel[] {
    const inSpeakingOrder = [...segments].sort((first, second) => first.start - second.start);
    return [...new Set(inSpeakingOrder.map((segment) => segment.speaker))];
}

// Not the bare letter: the diarizer labels voices it doesn't recognise with letters, which would collide.
export function getSampleName(speakerId: SpeakerId): DiarizerLabel {
    return `speaker_${speakerId.toLowerCase()}`;
}

/** Takes free ids in speaking order, so a voice heard before a sampled one keeps the id before it. */
function sampleNewLabels(
    newLabels: DiarizerLabel[],
    cutLabel: (label: DiarizerLabel) => Int16Array | undefined,
    sentSamples: SpeakerSample[],
    ids: SpeakerId[],
): Map<DiarizerLabel, SpeakerSample> {
    const freeIds = ids.filter((speakerId) => !sentSamples.some((sample) => sample.speakerId === speakerId));
    const freeSlots = freeIds.length - 1;
    const cuts = newLabels
        .flatMap((label, position) => {
            const cut = cutLabel(label);
            return cut ? [{ label, position, cut }] : [];
        })
        .slice(0, freeSlots);

    return new Map(
        cuts.map(({ label, position, cut }, index) => {
            const lastIdLeft = freeIds.length - cuts.length + index;
            return [label, { speakerId: freeIds[Math.min(position, lastIdLeft)]!, samples: cut }];
        }),
    );
}

function lengthenSample(sample: SpeakerSample, cut: Int16Array | undefined): SpeakerSample {
    return cut && cut.length > sample.samples.length ? { ...sample, samples: cut } : sample;
}

/** None until every sample slot is taken: given out before that, it would go to whichever voice speaks next. */
function findSharedId(speakerSamples: SpeakerSample[], ids: SpeakerId[]): SpeakerId | undefined {
    const unsampledIds = ids.filter((speakerId) => !speakerSamples.some((sample) => sample.speakerId === speakerId));
    return unsampledIds.length === 1 ? unsampledIds[0] : undefined;
}

function findLongestSegment(segments: TranscribeSegment[]): TranscribeSegment | undefined {
    return segments.reduce<TranscribeSegment | undefined>(
        (longest, segment) =>
            !longest || segment.end - segment.start > longest.end - longest.start ? segment : longest,
        undefined,
    );
}
