import { describe, expect, it, vi } from 'vitest';
import { buildBufferPostInput, fitCaptionForService, getBufferChannels } from './buffer';

describe('Buffer integration helpers', () => {
  it('keeps short captions and preserves hashtags while fitting X limits', () => {
    expect(fitCaptionForService('Kısa haber\n\n#Gündem', 'twitter')).toBe('Kısa haber\n\n#Gündem');
    const fitted = fitCaptionForService(`${'A'.repeat(400)}\n\n#Gündem #OTONOM`, 'twitter');
    expect(fitted.length).toBeLessThanOrEqual(280);
    expect(fitted).toContain('#OTONOM');
  });

  it('creates Instagram Reel and YouTube Short metadata', () => {
    const instagram = buildBufferPostInput({
      channel: { id: 'ig-1', name: 'Instagram', service: 'instagram' },
      caption: 'Büyük haber', mediaUrl: 'https://example.com/video.mp4', mediaType: 'video',
    });
    expect(instagram.metadata).toEqual({
      instagram: { type: 'reel', shouldShareToFeed: true, isAiGenerated: true },
    });

    const youtube = buildBufferPostInput({
      channel: { id: 'yt-1', name: 'YouTube', service: 'youtube' },
      caption: 'Günün gündemi', mediaUrl: 'https://example.com/video.mp4', mediaType: 'video',
    });
    expect(youtube.metadata).toMatchObject({
      youtube: { type: 'short', categoryId: '25', title: 'Günün gündemi', privacy: 'public' },
    });
  });

  it('retrieves and deduplicates channels from all organizations', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        data: { account: { organizations: [{ id: 'org-1', name: 'OTONOM' }] } },
      }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        data: { channels: [
          { id: 'ig-1', name: 'Instagram', service: 'instagram' },
          { id: 'tt-1', name: 'TikTok', service: 'tiktok' },
        ] },
      }), { status: 200, headers: { 'Content-Type': 'application/json' } }));

    const channels = await getBufferChannels('test-key', fetchMock as typeof fetch);
    expect(channels.map(channel => channel.id)).toEqual(['ig-1', 'tt-1']);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const requestHeaders = fetchMock.mock.calls[0][1]?.headers as Record<string, string>;
    expect(requestHeaders.Authorization).toBe('Bearer test-key');
  });
});
