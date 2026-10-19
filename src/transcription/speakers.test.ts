import { describe, expect, it } from 'vite-plus/test';
import { convertMsToSamples } from './audio.js';
import { assignSpeakerIds, getSampleName, updateSpeakerSamples } from './speakers.js';

const buildClip = (seconds: number): Int16Array =>
    Int16Array.from({ length: convertMsToSamples(seconds * 1000) }, (_, i) => i);

describe('assignSpeakerIds', () => {
    it('takes the earliest voice as A before a sample exists, and every other voice as B', () => {
        const speakerIds = assignSpeakerIds(
            [
                { speaker: 'B', start: 1, end: 2, text: 'Fine.' },
                { speaker: 'A', start: 0, end: 1, text: 'Hi.' },
                { speaker: 'C', start: 2, end: 3, text: 'Me too.' },
            ],
            [],
        );
        expect(Object.fromEntries(speakerIds)).toEqual({ A: 'A', B: 'B', C: 'B' });
    });

    it("keeps a sampled voice's id and moves the diarizer's own letters to B", () => {
        const speakerIds = assignSpeakerIds(
            [
                { speaker: 'A', start: 0, end: 1, text: 'Hi.' },
                { speaker: getSampleName('A'), start: 1, end: 2, text: 'Hello.' },
            ],
            [{ speakerId: 'A', samples: buildClip(3) }],
        );
        expect(Object.fromEntries(speakerIds)).toEqual({ A: 'B', [getSampleName('A')]: 'A' });
    });
});

describe('updateSpeakerSamples', () => {
    const clip = buildClip(10);
    const speakerIds = new Map([
        ['A', 'A'],
        ['B', 'B'],
    ]);

    it("cuts a sampled speaker's longest segment to 5 s, and none for a speaker past the limit", () => {
        const samples = updateSpeakerSamples(
            [],
            clip,
            [
                { speaker: 'A', start: 0, end: 2.5, text: 'Short.' },
                { speaker: 'B', start: 2.5, end: 9, text: 'Not sampled.' },
                { speaker: 'A', start: 3, end: 10, text: 'Long.' },
            ],
            speakerIds,
        );
        expect(samples).toEqual([
            { speakerId: 'A', samples: clip.slice(convertMsToSamples(3000), convertMsToSamples(8000)) },
        ]);
        expect(samples[0]!.samples.buffer).not.toBe(clip.buffer);
    });

    it('skips a segment under 2 s', () => {
        expect(updateSpeakerSamples([], clip, [{ speaker: 'A', start: 0, end: 1.9, text: 'Hi.' }], speakerIds)).toEqual(
            [],
        );
    });

    it('replaces a sample only with a longer one, so a 5 s sample is final', () => {
        const segments = [{ speaker: 'A', start: 0, end: 4, text: 'Four seconds.' }];
        const threeSeconds = { speakerId: 'A', samples: buildClip(3) };
        const fourSeconds = { speakerId: 'A', samples: buildClip(4) };
        const fiveSeconds = { speakerId: 'A', samples: buildClip(5) };
        expect(updateSpeakerSamples([threeSeconds], clip, segments, speakerIds)[0]!.samples).toHaveLength(
            convertMsToSamples(4000),
        );
        expect(updateSpeakerSamples([fourSeconds], clip, segments, speakerIds)).toEqual([fourSeconds]);
        expect(
            updateSpeakerSamples([fiveSeconds], clip, [{ speaker: 'A', start: 0, end: 9, text: 'Long.' }], speakerIds),
        ).toEqual([fiveSeconds]);
    });
});
