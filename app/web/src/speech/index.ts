// The microphone and speech for the speaking puzzle types (docs/app-games.md, "Speaking puzzles").
//   <SpeakPanel query={{ scene, line }} maxRecordMs={…} state={state} dispatch={dispatch} playOriginal={…} originalMs={…} practiceCtx={…} />
// or, for a puzzle type that drives the microphone itself: useRecorder(onTake) with <MicControl rec={rec} …/>
// (the one microphone control) and <MicNotice/>, sendSpeech / askSpeech, and the pure WAV helpers.
export { MicError, MicRecorder, micSupported, takeLimitMs, type MicFailure, type RecordOptions, type Take } from './recorder';
export { askSpeech, devTestTranscript, sendSpeech, SPEECH_TIMEOUT_MS } from './send';
export { keepAboveDock, micDocked } from './dock';
export { TargetStrip, replayMissing, unitCredit, type TargetStripProps } from './TargetStrip';
export { CantSpeak, MicDock, MicNotice, SpeakPanel, type MicNoticeWords, type PlayOriginal, type SpeakPanelProps } from './SpeakPanel';
export { MicControl, micLook, type MicControlProps, type MicLook } from './MicControl';
export { isNotice, UNHEARD_LIMIT, useRecorder, type RecorderOptions, type RecorderStatus, type TakeClock, type TakeOptions, type UseRecorder } from './useRecorder';
export { encodeWav, judgeRecording, LiveVoice, lookAt, resample, SPEECH_RATE, sliceWav, trimToVoice, VOICE, wavSeconds } from './wav';
