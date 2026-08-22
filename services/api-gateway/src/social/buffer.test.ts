import { describe, expect, it, vi } from 'vitest';
import {
  buildBufferPostInput,
  createBufferPost,
  fitCaptionForService,
  getBufferChannels,
} from './buffer';

describe('Buffer integration helpers', () => {
  it('keeps short captions and preserves hashtags while fitting X limits', () => {
    expect(fitCaptionForService('Kısa haber\n\n#Gündem', 'twitter')).toBe('Kısa haber\n\n#Gündem');
    const fitted = fitCaptionForService(`${'A'.repeat(400)}\n\n#Gündem #OTONOM`, 'twitter');
    expect(Array.from(fitted).length).toBeLessThanOrEqual(240);
    expect(fitted).toContain('#OTONOM');
    expect(fitted).not.toContain('…');
  });

  it('platform sınırı hukuki atfı keserse gönderiyi kapalı varsayımla durdurur', () => {
    const caption = `Günün gündemi\nMehmet hırsız\n${'A'.repeat(300)}\niddia edildi.\n\n#Gündem`;
    expect(() => buildBufferPostInput({
      channel: { id: 'x-risk', name: 'X', service: 'twitter' },
      caption,
      mediaUrl: 'https://example.com/video.mp4',
      mediaType: 'video',
    })).toThrow('platforma özel son metin güvenlik kontrolünde durduruldu');
  });

  it('Buffer X yine uzunluk hatası verirse 180 karakterlik metinle bir kez yeniden dener', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        data: { createPost: { __typename: 'MutationError', message: 'Twitter / X posts cannot exceed 280 characters.' } },
      }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        data: { createPost: { __typename: 'PostActionSuccess', post: { id: 'x-post', status: 'scheduled' } } },
      }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    const result = await createBufferPost({
      apiKey: 'test-key',
      channel: { id: 'x-1', name: 'serefkeser', service: 'twitter' },
      caption: `${'Uzun gündem metni '.repeat(30)}\n\n#Gündem #OTONOM`,
      mediaUrl: 'https://example.com/video.mp4',
      mediaType: 'video',
      fetchImpl: fetchMock as typeof fetch,
    });
    expect(result.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const retryBody = JSON.parse(String(fetchMock.mock.calls[1][1]?.body));
    expect(Array.from(retryBody.variables.input.text).length).toBeLessThanOrEqual(180);
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
