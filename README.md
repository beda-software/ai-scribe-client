# @beda.software/ai-scribe-client

The client side of the AI scribe: framework-free TypeScript for web and React Native apps that capture a visit's
speech and turn it into a transcript with speakers, using the AI scribe service. It holds no UI and no app state.

## Installation

```sh
yarn add @beda.software/ai-scribe-client
```

Peer dependencies: `@beda.software/remote-data`, and optionally `axios` for the `Service` type.

## Transcription

`@beda.software/ai-scribe-client/transcription` (also re-exported from the package root).

| Area                   | What it does                                                                                                                                                                                                                                                                                                                                                                          |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `connectRealtime`      | Opens an OpenAI Realtime transcription session over WebSocket with an ephemeral token, streams microphone chunks (`sendChunk`), emits every server event, and keeps each phrase's clip (`takeClip`) even when transcripts arrive out of order.                                                                                                                                        |
| `createDiarizer`       | Diarizes a visit's phrase clips in batches sent `batchSeconds` (15; 0 for one call per phrase) after the earliest began, or on `flush()`; each phrase's promise resolves with its own part. Calls run one at a time until all `maxVoiceprints` (1) slots hold a voiceprint, then in parallel. `knownVoiceprints` fill slots for the whole visit and must use the visit's speaker ids. |
| `diarizeClip`          | Sends a clip and the voiceprints to recognise (`KnownVoiceprint`) to the AI scribe service's `/v3/transcribe` with diarization; `llmStats` lists every model call.                                                                                                                                                                                                                    |
| Transcript messages    | `insertMessage`, `getDiarizationOutcome`, `applyDiarization`, `removePhrase`, `splitPhraseClip` and friends: functions that take a message list and return a new one, for any store.                                                                                                                                                                                                  |
| `buildWav`, `getLevel` | A WAV from a clip's 24 kHz PCM16 samples, and a chunk's level.                                                                                                                                                                                                                                                                                                                        |
| `parseWav`             | The samples of a WAV in the format `buildWav` writes; throws on any other file.                                                                                                                                                                                                                                                                                                       |
| `cutSeconds`           | A view of a time range of 24 kHz samples.                                                                                                                                                                                                                                                                                                                                             |
| `resampleTo24k`        | Linear-interpolation resample of one Float32 microphone chunk to 24 kHz.                                                                                                                                                                                                                                                                                                              |
| `convertFloatToInt16`  | Float32 samples as PCM16.                                                                                                                                                                                                                                                                                                                                                             |
| `checkVoiceprint`      | Checks a clip of a script read aloud and cuts the voiceprint from it, through any `FetchDiarization`. `MIN_VOICEPRINT_CLIP_SECONDS` and `MAX_VOICEPRINT_CLIP_SECONDS` bound the clip.                                                                                                                                                                                                 |

The app supplies what differs per platform and backend: the microphone, the ephemeral token request, an HTTP client
bound to the AI scribe service's base URL (`service`, any `(axiosConfig) => Promise<RemoteDataResult>`), how a WAV is
attached to a form on React Native (`AttachWav`) and where messages are stored.

### Vocabulary

- **samples**: raw audio data, 24 kHz PCM16 (`Int16Array`); the name of every field that holds audio;
- **chunk**: a piece of microphone audio streamed to the realtime server as it is recorded;
- **clip**: a stretch of samples cut out for one purpose: a phrase's audio, what one diarization call sends, or a
  script read aloud for a voiceprint;
- **wav**: a clip encoded as a WAV file, as it is uploaded;
- **phrase**: what the realtime server's voice detection cuts between pauses, keyed by its `item_id`;
- **segment**: one speaker's part of a phrase, as the diarizer returns it;
- **message**: one transcript entry. A phrase is one message until it is diarized, then one message per segment;
- **voiceprint**: a few seconds of one speaker's voice, sent with every diarization call so the diarizer recognises
  them across calls; checked from a clip read aloud (`checkVoiceprint`) or cut from the visit;
- **speaker id**: a letter for the whole visit, `A`, `B`, …: one per voiceprint, and one shared by every other voice.
  A voice that can't be told apart yet gets none, and its segment becomes a raw message;
- **batch**: phrase clips joined, with 1.2 s of silence between them, into one diarization call.

## Commands

`@beda.software/ai-scribe-client/commands` (also re-exported from the package root).

| Area            | What it does                                                                                                                                                             |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `detectCommand` | Sends a text and the commands on offer to the AI scribe service's `/v3/detect-command`; returns the chosen command's payload merged with the said parameters, or `null`. |

A command's `payload` is echoed back and never sent to the model, so it carries the `action` to run, which every payload
needs; a parameter may not reuse a payload key. The app decides which commands to offer and runs the one returned.
`DetectedCommandOf` types the result per action from the commands' own `parameters`, as long as the list is kept
`as const` or written inline: typing it `Command<...>[]` widens the parameters away.

## Releasing

Publishing a GitHub release runs `.github/workflows/publish.yml`, which publishes to npm with provenance through npm
trusted publishing (no token). A release marked as a prerelease is published under the `alpha` tag, any other under
`latest`.

## Development

Prerequisites: Node `^22.18.0 || ^24.11.0 || >=26` and Corepack (pins Yarn 4 via `packageManager`).

```sh
corepack enable
yarn install
yarn typecheck
yarn check
yarn test
```
