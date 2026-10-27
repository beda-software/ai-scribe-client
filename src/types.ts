import type { RemoteDataResult } from '@beda.software/remote-data';
import type { AxiosRequestConfig } from 'axios';

// An HTTP client already bound to the AI scribe service's base URL; requests carry only a path.
export type Service = <T>(config: AxiosRequestConfig) => Promise<RemoteDataResult<T>>;

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
