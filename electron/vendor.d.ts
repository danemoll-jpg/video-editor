// Ambient module declarations for vendor packages that ship no types of their
// own — both are trivial "resolve to a binary path" packages (see
// videoRuntime.ts, the only place that imports them).

declare module 'ffmpeg-static' {
  const ffmpegPath: string
  export default ffmpegPath
}

declare module 'ffprobe-static' {
  const ffprobeStatic: { path: string }
  export default ffprobeStatic
}
