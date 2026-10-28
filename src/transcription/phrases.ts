import { appendToChunkBuffer, createChunkBuffer, cutClip, dropChunksBefore, getEndMs, getSpokenAt } from './audio.js';

// `audio_start_ms` lands up to `prefix_padding_ms` before the speech the server detects, and the event arrives later.
const IDLE_AUDIO_KEPT_MS = 3000;

export type RealtimeEvent = { type?: string; [key: string]: any };

// 24 kHz PCM16; `spokenAt` is the clock time the speech began.
export interface PhraseClip {
    samples: Int16Array;
    spokenAt: number;
}

export interface PhraseTracker {
    // Every chunk sent to the server, in order; `isSilence` marks made-up padding.
    addSentChunk: (samples: Int16Array, isSilence: boolean) => void;
    handleEvent: (event: RealtimeEvent) => void;
    // Call it for every transcribed phrase so the buffer trims.
    takeClip: (itemId: string) => PhraseClip | undefined;
    // For `input_audio_buffer.clear`: the server discards the phrase in progress, so it never gets a transcript.
    dropOpenPhrase: () => void;
}

// `ms` and `endMs` are positions in the session audio; `spokenAt` is the clock time.
interface SpeechMark {
    start?: { ms: number; spokenAt: number };
    endMs?: number;
}

/** Keeps the session audio each phrase still waiting for its transcript needs, so out-of-order transcripts each get theirs. */
export function createPhraseTracker(): PhraseTracker {
    const chunkBuffer = createChunkBuffer();
    const speechMarks = new Map<string, SpeechMark>();

    const dropUnneededChunks = (): void => {
        const pendingStarts = [...speechMarks.values()]
            .map((mark) => mark.start?.ms)
            .filter((startMs): startMs is number => startMs !== undefined);
        const endMs = getEndMs(chunkBuffer);
        dropChunksBefore(chunkBuffer, pendingStarts.length ? Math.min(...pendingStarts) : endMs - IDLE_AUDIO_KEPT_MS);
    };

    return {
        addSentChunk: (samples, isSilence) => {
            appendToChunkBuffer(chunkBuffer, { samples, sentAt: Date.now(), isSilence });
            dropUnneededChunks();
        },
        handleEvent: (event) => {
            if (event.type === 'input_audio_buffer.speech_started') {
                speechMarks.set(event.item_id, {
                    start: {
                        ms: event.audio_start_ms,
                        spokenAt: getSpokenAt(chunkBuffer, event.audio_start_ms, Date.now()),
                    },
                });
            }
            if (event.type === 'input_audio_buffer.speech_stopped') {
                speechMarks.set(event.item_id, { ...speechMarks.get(event.item_id), endMs: event.audio_end_ms });
            }
            if (event.type === 'conversation.item.input_audio_transcription.failed') {
                speechMarks.delete(event.item_id);
                dropUnneededChunks();
            }
        },
        takeClip: (itemId) => {
            const mark = speechMarks.get(itemId);
            speechMarks.delete(itemId);
            if (mark?.start === undefined || mark.endMs === undefined) {
                return undefined;
            }

            const samples = cutClip(chunkBuffer, mark.start.ms, mark.endMs);
            dropUnneededChunks();
            return { samples, spokenAt: mark.start.spokenAt };
        },
        dropOpenPhrase: () => {
            speechMarks.forEach((mark, itemId) => mark.endMs === undefined && speechMarks.delete(itemId));
            dropUnneededChunks();
        },
    };
}
