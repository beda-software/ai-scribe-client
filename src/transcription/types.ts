import type { RemoteDataResult } from '@beda.software/remote-data';
import type { AxiosRequestConfig } from 'axios';

// An HTTP client already bound to the AI scribe service's base URL; requests carry only a path.
export type Service = <T>(config: AxiosRequestConfig) => Promise<RemoteDataResult<T>>;

// `start` and `end` are seconds from the start of the clip sent to the diarizer.
export interface TranscribeSegment {
    speaker: string;
    start: number;
    end: number;
    text: string;
}

export interface LlmUsage {
    inputTokens?: number | null;
    outputTokens?: number | null;
    cachedInputTokens?: number | null;
    audioSeconds?: number | null;
}

export interface LlmStats {
    durationSeconds: number;
    modelId: string;
    usage?: LlmUsage | null;
}

export interface DiarizedTranscript {
    text: string;
    segments: TranscribeSegment[];
    llmStats: LlmStats | null;
}
