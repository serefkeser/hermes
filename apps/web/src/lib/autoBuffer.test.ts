import { describe, expect, it } from 'vitest';
import { summarizeAutoBufferResult } from './autoBuffer';

describe('automatic Buffer publishing summary', () => {
  it('lists only successfully queued channels', () => {
    expect(summarizeAutoBufferResult({
      mediaUrl: 'https://example.com/video.mp4',
      filename: 'video.mp4',
      queuedCount: 2,
      failedCount: 1,
      results: [
        { channelId: '1', channelName: 'Haber', service: 'instagram', ok: true },
        { channelId: '2', channelName: 'Gündem', service: 'tiktok', ok: true },
        { channelId: '3', channelName: 'YT', service: 'youtube', ok: false, message: 'limit' },
      ],
    })).toBe('2 kanal kuyruğa alındı: Haber (instagram), Gündem (tiktok)');
  });
});
