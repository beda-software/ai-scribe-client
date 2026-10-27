import { isSuccess, RemoteDataResult } from '@beda.software/remote-data';

import { cutSeconds } from './audio.js';
import type { DiarizationResult } from './diarization.js';
import type { TranscribeSegment } from './types.js';

// `listening` is a phrase still being spoken, `transcribing` one that is waiting for its transcript.
export type TranscriptMessage =
    | { id: string; text: string; spokenAt: number; status: 'listening' | 'transcribing' | 'processing' | 'raw' }
    | { id: string; text: string; spokenAt: number; status: 'diarized'; speakerId: string };

export interface DiarizedSegment {
    message: TranscriptMessage;
    segment: TranscribeSegment;
}

export type DiarizationOutcome =
    | { type: 'replace'; segments: DiarizedSegment[] }
    | { type: 'remove' }
    | { type: 'raw' };

// A diarized segment ends before its last word fades out.
const SEGMENT_TAIL_SECONDS = 0.8;

export function createListeningMessage(itemId: string, spokenAt: number): TranscriptMessage {
    return { id: itemId, text: '', spokenAt, status: 'listening' };
}

export function createMessage(
    itemId: string,
    text: string,
    status: 'processing' | 'raw',
    spokenAt: number | undefined,
): TranscriptMessage {
    return { id: itemId, text, spokenAt: spokenAt ?? Date.now(), status };
}

export function markMessageTranscribing(messages: readonly TranscriptMessage[], id: string): TranscriptMessage[] {
    return messages.map((message) =>
        message.id === id && message.status === 'listening' ? { ...message, status: 'transcribing' } : message,
    );
}

export function removeMessage(messages: readonly TranscriptMessage[], id: string): TranscriptMessage[] {
    return messages.filter((message) => message.id !== id);
}

/** Removes a phrase's message and, once diarized, every speaker segment it was split into. */
export function removePhrase(messages: readonly TranscriptMessage[], id: string): TranscriptMessage[] {
    return messages.filter((message) => !isPhrasePart(message.id, id));
}

/** Whether a message is the phrase itself or one of the speaker segments it was split into. */
export function isPhrasePart(messageId: string, phraseId: string): boolean {
    return messageId === phraseId || messageId.startsWith(`${phraseId}-`);
}

// For a cleared audio buffer or a new session: their phrases never get a transcript.
export function dropUntranscribedMessages(messages: readonly TranscriptMessage[]): TranscriptMessage[] {
    return messages.filter((message) => message.status !== 'listening' && message.status !== 'transcribing');
}

/**
 * Inserts by spoken time, in place of a message with the same id: a long phrase's transcript can arrive after a
 * shorter one spoken later, and a phrase's listening message becomes its transcript.
 */
export function insertMessage(messages: readonly TranscriptMessage[], message: TranscriptMessage): TranscriptMessage[] {
    const others = removeMessage(messages, message.id);
    const index = getInsertIndex(others, message.spokenAt);
    return [...others.slice(0, index), message, ...others.slice(index)];
}

function getInsertIndex(messages: readonly TranscriptMessage[], spokenAt: number): number {
    const laterIndex = messages.findIndex((message) => message.spokenAt > spokenAt);
    return laterIndex === -1 ? messages.length : laterIndex;
}

/** No words at all means the transcription model heard noise as words; a failed call, or words without speaker segments, keeps the raw message. */
export function getDiarizationOutcome(
    message: TranscriptMessage,
    result: RemoteDataResult<DiarizationResult>,
): DiarizationOutcome {
    if (!isSuccess(result)) {
        return { type: 'raw' };
    }

    const { transcript, speakerIds } = result.data;
    const segments = transcript.segments.filter((segment) => segment.text.trim());
    if (segments.length) {
        return { type: 'replace', segments: buildDiarizedSegments(message, segments, speakerIds) };
    }

    return transcript.text.trim() ? { type: 'raw' } : { type: 'remove' };
}

function buildDiarizedSegments(
    message: TranscriptMessage,
    segments: TranscribeSegment[],
    speakerIds: ReadonlyMap<string, string>,
): DiarizedSegment[] {
    return segments.map((segment, index) => ({
        message: {
            id: `${message.id}-${index}`,
            text: segment.text.trim(),
            spokenAt: message.spokenAt + segment.start * 1000,
            status: 'diarized',
            speakerId: speakerIds.get(segment.speaker)!,
        },
        segment,
    }));
}

export function applyDiarization(
    messages: readonly TranscriptMessage[],
    id: string,
    outcome: DiarizationOutcome,
): readonly TranscriptMessage[] {
    const index = messages.findIndex((message) => message.id === id);
    if (index === -1) {
        return messages;
    }

    const message = messages[index]!;
    const replacement: TranscriptMessage[] =
        outcome.type === 'replace'
            ? outcome.segments.map((diarized) => diarized.message)
            : outcome.type === 'raw'
              ? [{ id: message.id, text: message.text, spokenAt: message.spokenAt, status: 'raw' }]
              : [];
    return [...messages.slice(0, index), ...replacement, ...messages.slice(index + 1)];
}

export function splitPhraseAudio(
    phrase: Int16Array,
    segments: DiarizedSegment[],
): Array<[messageId: string, samples: Int16Array]> {
    return segments
        .map(({ message, segment }): [string, Int16Array] => [
            message.id,
            cutSeconds(phrase, segment.start, segment.end + SEGMENT_TAIL_SECONDS),
        ])
        .filter(([, samples]) => samples.length > 0);
}
