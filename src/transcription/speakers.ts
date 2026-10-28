import { cutSeconds } from './audio.js';
import type { TranscriptSegment } from './types.js';

const MIN_SEGMENT_VOICEPRINT_SECONDS = 2;
export const MAX_VOICEPRINT_SECONDS = 5;

// The diarizer names voices anew in every call: 'speaker_a' for a sent voiceprint, 'A', 'B', … for any other voice.
type DiarizerLabel = string;
type SpeakerId = string;

export interface Voiceprint {
    speakerId: SpeakerId;
    samples: Int16Array;
}

export interface IdentifiedSpeakers {
    speakerIds: ReadonlyMap<DiarizerLabel, SpeakerId>;
    voiceprints: Voiceprint[];
}

export function identifySpeakers(
    clip: Int16Array,
    segments: TranscriptSegment[],
    sentVoiceprints: Voiceprint[],
    maxVoiceprints: number,
): IdentifiedSpeakers {
    const ids = listSpeakerIds(maxVoiceprints);
    const spokenSegments = segments.filter((segment) => segment.text.trim());
    const cutVoiceprintOf = (label: DiarizerLabel) => cutVoiceprintFromSegments(clip, spokenSegments, label);
    const labels = listLabelsInSpeakingOrder(spokenSegments);
    const sentIds = new Map(
        sentVoiceprints.map((voiceprint) => [getVoiceprintLabel(voiceprint.speakerId), voiceprint.speakerId]),
    );
    const newVoiceprints = takeNewVoiceprints(
        labels.filter((label) => !sentIds.has(label)),
        cutVoiceprintOf,
        sentVoiceprints,
        ids,
    );
    const voiceprints = [
        ...sentVoiceprints.map((voiceprint) =>
            lengthenVoiceprint(voiceprint, cutVoiceprintOf(getVoiceprintLabel(voiceprint.speakerId))),
        ),
        ...newVoiceprints.values(),
    ];
    const otherVoicesId = findOtherVoicesId(voiceprints, ids);
    const speakerIds = new Map(
        labels.flatMap((label) => {
            const speakerId = sentIds.get(label) ?? newVoiceprints.get(label)?.speakerId ?? otherVoicesId;
            return speakerId ? [[label, speakerId] as const] : [];
        }),
    );

    return { speakerIds, voiceprints };
}

/** Throws unless the known voiceprints fit the slots, each with its own speaker id among the visit's ids. */
export function validateKnownVoiceprints(knownVoiceprints: Voiceprint[], maxVoiceprints: number): void {
    const ids = listSpeakerIds(maxVoiceprints);
    const knownIds = knownVoiceprints.map((voiceprint) => voiceprint.speakerId);
    const fits =
        knownIds.length <= maxVoiceprints &&
        new Set(knownIds).size === knownIds.length &&
        knownIds.every((speakerId) => ids.includes(speakerId));
    if (!fits) {
        throw new Error(
            `Known voiceprints need distinct speaker ids among ${ids.join(', ')}, at most ${maxVoiceprints}; ` +
                `got ${knownIds.join(', ')}`,
        );
    }
}

/** One id per voice with a voiceprint, and one shared by every voice past them. */
function listSpeakerIds(maxVoiceprints: number): SpeakerId[] {
    return Array.from({ length: maxVoiceprints + 1 }, (_, index) => String.fromCharCode('A'.charCodeAt(0) + index));
}

function cutVoiceprintFromSegments(
    clip: Int16Array,
    segments: TranscriptSegment[],
    label: DiarizerLabel,
): Int16Array | undefined {
    const longest = findLongestSegment(segments.filter((segment) => segment.speaker === label));
    if (!longest || longest.end - longest.start < MIN_SEGMENT_VOICEPRINT_SECONDS) {
        return undefined;
    }

    // A copy: a voiceprint is kept for the whole visit, and a view would keep the whole clip alive.
    return cutSeconds(clip, longest.start, Math.min(longest.end, longest.start + MAX_VOICEPRINT_SECONDS)).slice();
}

function listLabelsInSpeakingOrder(segments: TranscriptSegment[]): DiarizerLabel[] {
    const inSpeakingOrder = [...segments].sort((first, second) => first.start - second.start);
    return [...new Set(inSpeakingOrder.map((segment) => segment.speaker))];
}

// Not the bare letter: the diarizer labels voices it doesn't recognise with letters, which would collide.
export function getVoiceprintLabel(speakerId: SpeakerId): DiarizerLabel {
    return `speaker_${speakerId.toLowerCase()}`;
}

/** Takes free ids in speaking order, so a voice heard before one with a voiceprint keeps the id before it. */
function takeNewVoiceprints(
    newLabels: DiarizerLabel[],
    cutVoiceprintOf: (label: DiarizerLabel) => Int16Array | undefined,
    sentVoiceprints: Voiceprint[],
    ids: SpeakerId[],
): Map<DiarizerLabel, Voiceprint> {
    const freeIds = ids.filter(
        (speakerId) => !sentVoiceprints.some((voiceprint) => voiceprint.speakerId === speakerId),
    );
    const freeSlots = freeIds.length - 1;
    const candidates = newLabels
        .flatMap((label, position) => {
            const samples = cutVoiceprintOf(label);
            return samples ? [{ label, position, samples }] : [];
        })
        .slice(0, freeSlots);

    return new Map(
        candidates.map(({ label, position, samples }, index) => {
            const lastIdLeft = freeIds.length - candidates.length + index;
            return [label, { speakerId: freeIds[Math.min(position, lastIdLeft)]!, samples }];
        }),
    );
}

function lengthenVoiceprint(voiceprint: Voiceprint, samples: Int16Array | undefined): Voiceprint {
    return samples && samples.length > voiceprint.samples.length ? { ...voiceprint, samples } : voiceprint;
}

/** None until every voiceprint slot is taken: given out before that, it would go to whichever voice speaks next. */
function findOtherVoicesId(voiceprints: Voiceprint[], ids: SpeakerId[]): SpeakerId | undefined {
    const idsWithoutVoiceprint = ids.filter(
        (speakerId) => !voiceprints.some((voiceprint) => voiceprint.speakerId === speakerId),
    );
    return idsWithoutVoiceprint.length === 1 ? idsWithoutVoiceprint[0] : undefined;
}

function findLongestSegment(segments: TranscriptSegment[]): TranscriptSegment | undefined {
    return segments.reduce<TranscriptSegment | undefined>(
        (longest, segment) =>
            !longest || segment.end - segment.start > longest.end - longest.start ? segment : longest,
        undefined,
    );
}
