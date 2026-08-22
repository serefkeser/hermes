import { describe, expect, it } from 'vitest';
import { selectFfmpegCore } from './ffmpegCore';

describe('FFmpeg core selection', () => {
  it('SharedArrayBuffer olmayan tablette resmi tek iş parçacıklı çekirdeği kullanır', () => {
    expect(selectFfmpegCore(false)).toEqual({
      corePath: 'https://unpkg.com/@ffmpeg/core-st@0.11.1/dist/ffmpeg-core.js',
      mainName: 'main',
      mode: 'single-thread',
    });
  });

  it('cross-origin isolated tarayıcıda hızlı çok iş parçacıklı çekirdeği korur', () => {
    expect(selectFfmpegCore(true)).toEqual({
      corePath: 'https://unpkg.com/@ffmpeg/core@0.11.0/dist/ffmpeg-core.js',
      mode: 'multi-thread',
    });
  });
});
