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

| Area                   | What it does                                                                                                                                                                                                                     |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `connectRealtime`      | Opens an OpenAI Realtime transcription session over WebSocket with an ephemeral token, streams microphone chunks, emits every server event, and keeps each phrase's clip (`takeClip`) even when transcripts arrive out of order. |
| `createDiarizer`       | Diarizes phrases against one visit's speaker samples: one call at a time until every sample slot is taken, then in parallel. `knownSamples` seeds slots with samples recorded beforehand, kept for the whole visit; `maxSampledSpeakers` (1 by default) sets the slot count.              |
| `diarizeClip`          | Sends a clip and the known speakers' samples to the AI scribe service's `/v3/transcribe` with diarization; `llmStats` lists every model call.                                                                                    |
| Transcript messages    | `insertMessage`, `getDiarizationOutcome`, `applyDiarization`, `removePhrase`, `splitPhraseAudio` and friends: functions that take a message list and return a new one, for any store.                                            |
| `buildWav`, `getLevel` | A WAV file from 24 kHz PCM16 samples, and a chunk's level.                                                                                                                                                                       |
| `parseWav`             | The samples of a WAV in the format `buildWav` writes; throws on any other file.                                                                                                                                                  |
| `cutSeconds`           | A view of a time range of 24 kHz samples.                                                                                                                                                                                        |
| `resampleTo24k`        | Linear-interpolation resample of one Float32 microphone chunk to 24 kHz.                                                                                                                                                         |
| `convertFloatToInt16`  | Float32 samples as PCM16.                                                                                                                                                                                                        |
| `checkVoiceSample`     | Checks a read-aloud take of a script and cuts the speaker sample to keep, through any `FetchDiarization`. `MIN_TAKE_SECONDS` and `MAX_TAKE_SECONDS` bound the take.                                                              |

The app supplies what differs per platform and backend: the microphone, the ephemeral token request, an HTTP client
bound to the AI scribe service's base URL (`service`, any `(axiosConfig) => Promise<RemoteDataResult>`), how a WAV is
attached to a form on React Native (`AttachWav`) and where messages are stored.

### Vocabulary

- **phrase**: one realtime item, the speech server voice detection cuts between pauses, keyed by `item_id`;
- **segment**: one speaker's part of a phrase, as the diarizer returns it;
- **message**: one transcript entry. A phrase is one message until it is diarized, then one message per segment.

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
