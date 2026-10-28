import type { LlmStats } from '../types.js';

// `start` and `end` are seconds from the start of the clip sent to the diarizer.
export interface TranscriptSegment {
    speaker: string;
    start: number;
    end: number;
    text: string;
}

export interface DiarizedTranscript {
    text: string;
    segments: TranscriptSegment[];
    llmStats: LlmStats[];
}
