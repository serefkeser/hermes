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

  it('gazetede tek clickbait, en az beş başlık-detay, son söz ve outro sırasını korur', () => {
    const headlines = Array.from({ length: 5 }, (_, index) => ({
      sourceHeadlineId: `H${index + 1}`,
      baslik: `Doğrulanmış başlık ${index + 1}`,
      aciklama: `Doğrulanmış detay ${index + 1}.`,
      x: 0, y: index * 100, w: 500, h: 80,
    }));
    const scenes = buildRenderStoryboard({
      thumbnailText: 'GERÇEK NE?',
      sonSoz: 'Doğru haber, doğrulanmış bilgidir.',
      lastQuote: '',
      gununSorusu: '',
      gazeteBasliklari: headlines,
      videoSlides: headlines.map(item => ({
        sourceHeadlineId: item.sourceHeadlineId,
        sourceHeadline: item.baslik,
        topText: item.baslik,
        spokenText: `${item.baslik}. ${item.aciklama}`,
        imagePrompts: [],
      })),
    }, { ...config, yorum: '', sourceName: 'BirGün' }, new Date('2026-08-16T12:00:00Z'));

    expect(scenes.map(scene => scene.kind)).toEqual([
      'cover', 'content', 'content', 'content', 'content', 'content', 'final', 'outro',
    ]);
    expect(scenes[0].spokenText).toBe('GERÇEK NE?');
    expect(scenes[0].spokenText).not.toContain('BirGün');
    headlines.forEach((item, index) => {
      expect(scenes[index + 1].topText).toBe(item.baslik);
      expect(scenes[index + 1].spokenText).toBe(`${item.baslik}. ${item.aciklama}`);
    });
    expect(scenes.at(-2)?.kind).toBe('final');
    expect(scenes.at(-1)?.spokenText).toContain('Abone olmayı');
  });
});
