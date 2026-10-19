import { describe, expect, it } from 'vite-plus/test';
import { convertMsToSamples } from './audio.js';
import { createPhraseTracker } from './phrases.js';

const sendChunks = (tracker: ReturnType<typeof createPhraseTracker>, count: number): void => {
    for (let chunk = 0; chunk < count; chunk++) {
        tracker.addSentAudio(new Int16Array(convertMsToSamples(100)).fill(chunk), false);
    }
};

const markSpeech = (
    tracker: ReturnType<typeof createPhraseTracker>,
    itemId: string,
    startMs: number,
    endMs: number,
): void => {
    tracker.handleEvent({ type: 'input_audio_buffer.speech_started', item_id: itemId, audio_start_ms: startMs });
    tracker.handleEvent({ type: 'input_audio_buffer.speech_stopped', item_id: itemId, audio_end_ms: endMs });
};

describe('createPhraseTracker', () => {
    it('gives each phrase its own audio when the later transcript arrives first', () => {
        const tracker = createPhraseTracker();
        sendChunks(tracker, 10);
        markSpeech(tracker, 'long', 0, 500);
        markSpeech(tracker, 'short', 600, 800);

        const short = tracker.takeClip('short');
        const long = tracker.takeClip('long');
        expect(short?.samples).toHaveLength(convertMsToSamples(200));
        expect(short?.samples[0]).toBe(6);
        expect(long?.samples).toHaveLength(convertMsToSamples(500));
        expect(long?.samples[0]).toBe(0);
    });

    it('gives no clip to a phrase that has not stopped, or was dropped as the open phrase', () => {
        const tracker = createPhraseTracker();
        sendChunks(tracker, 5);
        tracker.handleEvent({ type: 'input_audio_buffer.speech_started', item_id: 'open', audio_start_ms: 100 });
        expect(tracker.takeClip('open')).toBeUndefined();

        tracker.handleEvent({ type: 'input_audio_buffer.speech_started', item_id: 'cleared', audio_start_ms: 200 });
        tracker.dropOpenPhrase();
        tracker.handleEvent({ type: 'input_audio_buffer.speech_stopped', item_id: 'cleared', audio_end_ms: 400 });
        expect(tracker.takeClip('cleared')).toBeUndefined();
    });
});
