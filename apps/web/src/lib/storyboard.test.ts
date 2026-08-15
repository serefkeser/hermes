import { describe, expect, it } from 'vitest';
import type { RenderConfig } from '@otonom/shared-types';
import { buildRenderStoryboard, getStoryboardNarration } from './storyboard';

const config = {
  duration: '30', aspectRatio: '9:16', videoStyle: 'cinematic', fontStyle: 'modern',
  imageStyle: 'cinematic', language: 'tr', subtitles: 'on', resolution: '1K',
  transition: 'none', videoFormat: 'webm', analysisMode: 'yorumsuz', tip: 'haber',
  sourceName: 'Diriliş Postası', yorum: 'Bu konu takip edilmeli.',
} satisfies RenderConfig;

describe('buildRenderStoryboard', () => {
  it('kapak, içerik, son söz ve outro sahnelerini eksiksiz kurar', () => {
    const scenes = buildRenderStoryboard({
      thumbnailText: 'DAVA TARTIŞMASI',
      sonSoz: 'Adalet mülkün temelidir.',
      lastQuote: 'Gelişmeleri takip etmeyi unutmayın.',
      videoSlides: [{ topText: 'GÜNDEM', spokenText: 'Dava bugün görüldü.', imagePrompts: [] }],
    }, config, new Date('2026-08-16T12:00:00Z'));

    expect(scenes.map(scene => scene.kind)).toEqual(['cover', 'content', 'final', 'outro']);
    expect(scenes[0].spokenText).toContain('Diriliş Postası');
    expect(scenes[2].spokenText).toContain('Adalet mülkün temelidir');
    expect(scenes[2].spokenText).toContain('Bu konu takip edilmeli');
    expect(getStoryboardNarration(scenes)).toContain('Abone olmayı');
  });

  it('AI son sözü son haber cümlesiyle tekrarlarsa güvenli son söz kullanır', () => {
    const scenes = buildRenderStoryboard({
      sonSoz: 'Gerçek ortaya çıktı.',
      videoSlides: [{ topText: 'SONUÇ', spokenText: 'Gerçek ortaya çıktı.', imagePrompts: [] }],
    }, config);
    expect(scenes.find(scene => scene.kind === 'final')?.spokenText).toContain('er ya da geç');
  });
});
