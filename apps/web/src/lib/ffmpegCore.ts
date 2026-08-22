export interface FfmpegCoreSelection {
  corePath: string;
  mainName?: string;
  mode: 'multi-thread' | 'single-thread';
}

const MULTI_THREAD_CORE = 'https://unpkg.com/@ffmpeg/core@0.11.0/dist/ffmpeg-core.js';
const SINGLE_THREAD_CORE = 'https://unpkg.com/@ffmpeg/core-st@0.11.1/dist/ffmpeg-core.js';

export function selectFfmpegCore(hasSharedArrayBuffer: boolean): FfmpegCoreSelection {
  return hasSharedArrayBuffer
    ? { corePath: MULTI_THREAD_CORE, mode: 'multi-thread' }
    : { corePath: SINGLE_THREAD_CORE, mainName: 'main', mode: 'single-thread' };
}
