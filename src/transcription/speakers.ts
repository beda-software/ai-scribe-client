import { cutSeconds } from './audio.js';
import type { TranscribeSegment } from './types.js';

const MIN_PHRASE_VOICEPRINT_SECONDS = 2;
export const MAX_VOICEPRINT_SECONDS = 5;

// The diarizer names voices anew in every call: 'speaker_a' for a sent voiceprint, 'A', 'B', … for any other voice.
type DiarizerLabel = string;
type SpeakerId = string;

export interface Voiceprint {
    speakerId: SpeakerId;
    audioSamples: Int16Array;
}

export interface IdentifiedSpeakers {
    speakerIdsByLabel: ReadonlyMap<DiarizerLabel, SpeakerId>;
    voiceprints: Voiceprint[];
}

export function identifySpeakers(
    clip: Int16Array,
    segments: TranscribeSegment[],
    sentVoiceprints: Voiceprint[],
    maxVoiceprints: number,
): IdentifiedSpeakers {
    const ids = listSpeakerIds(maxVoiceprints);
    const spokenSegments = segments.filter((segment) => segment.text.trim());
    const cutLabel = (label: DiarizerLabel) => cutVoiceprintFromPhrase(clip, spokenSegments, label);
    const labels = listLabelsInSpeakingOrder(spokenSegments);
    const sentIds = new Map(
        sentVoiceprints.map((voiceprint) => [getVoiceprintName(voiceprint.speakerId), voiceprint.speakerId]),
    );
    const newVoiceprints = takeNewVoiceprints(
        labels.filter((label) => !sentIds.has(label)),
        cutLabel,
        sentVoiceprints,
        ids,
    );
    const voiceprints = [
        ...sentVoiceprints.map((voiceprint) =>
            lengthenVoiceprint(voiceprint, cutLabel(getVoiceprintName(voiceprint.speakerId))),
        ),
        ...newVoiceprints.values(),
    ];
    const otherVoicesId = findOtherVoicesId(voiceprints, ids);
    const speakerIdsByLabel = new Map(
        labels.flatMap((label) => {
            const speakerId = sentIds.get(label) ?? newVoiceprints.get(label)?.speakerId ?? otherVoicesId;
            return speakerId ? [[label, speakerId] as const] : [];
        }),
    );

    return { speakerIdsByLabel, voiceprints };
}

/** Throws unless the known voiceprints fit the slots, each with its own letter among the visit's ids. */
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

function cutVoiceprintFromPhrase(
    clip: Int16Array,
    segments: TranscribeSegment[],
    label: DiarizerLabel,
): Int16Array | undefined {
    const longest = findLongestSegment(segments.filter((segment) => segment.speaker === label));
    if (!longest || longest.end - longest.start < MIN_PHRASE_VOICEPRINT_SECONDS) {
        return undefined;
    }

    // A copy: a voiceprint is kept for the whole visit, and a view would keep the whole phrase's audio alive.
    return cutSeconds(clip, longest.start, Math.min(longest.end, longest.start + MAX_VOICEPRINT_SECONDS)).slice();
}

function listLabelsInSpeakingOrder(segments: TranscribeSegment[]): DiarizerLabel[] {
    const inSpeakingOrder = [...segments].sort((first, second) => first.start - second.start);
    return [...new Set(inSpeakingOrder.map((segment) => segment.speaker))];
}

// Not the bare letter: the diarizer labels voices it doesn't recognise with letters, which would collide.
export function getVoiceprintName(speakerId: SpeakerId): DiarizerLabel {
    return `speaker_${speakerId.toLowerCase()}`;
}

/** Takes free ids in speaking order, so a voice heard before one with a voiceprint keeps the id before it. */
function takeNewVoiceprints(
    newLabels: DiarizerLabel[],
    cutLabel: (label: DiarizerLabel) => Int16Array | undefined,
    sentVoiceprints: Voiceprint[],
    ids: SpeakerId[],
): Map<DiarizerLabel, Voiceprint> {
    const freeIds = ids.filter(
        (speakerId) => !sentVoiceprints.some((voiceprint) => voiceprint.speakerId === speakerId),
    );
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
            return [label, { speakerId: freeIds[Math.min(position, lastIdLeft)]!, audioSamples: cut }];
        }),
    );
}

function lengthenVoiceprint(voiceprint: Voiceprint, cut: Int16Array | undefined): Voiceprint {
    return cut && cut.length > voiceprint.audioSamples.length ? { ...voiceprint, audioSamples: cut } : voiceprint;
}

/** None until every voiceprint slot is taken: given out before that, it would go to whichever voice speaks next. */
function findOtherVoicesId(voiceprints: Voiceprint[], ids: SpeakerId[]): SpeakerId | undefined {
    const idsWithoutVoiceprint = ids.filter(
        (speakerId) => !voiceprints.some((voiceprint) => voiceprint.speakerId === speakerId),
    );
    return idsWithoutVoiceprint.length === 1 ? idsWithoutVoiceprint[0] : undefined;
}

function findLongestSegment(segments: TranscribeSegment[]): TranscribeSegment | undefined {
    return segments.reduce<TranscribeSegment | undefined>(
        (longest, segment) =>
            !longest || segment.end - segment.start > longest.end - longest.start ? segment : longest,
        undefined,
    );
}
