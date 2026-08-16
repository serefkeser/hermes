import { describe, expect, it } from 'vitest';
import { buildSocialCaption } from './socialShare';

describe('social share copy', () => {
  it('kaynak, hook, başlıklar ve etiketleri paylaşım metnine ekler', () => {
    const caption = buildSocialCaption({
      sourceName: 'Cumhuriyet',
      hook: 'Yargıda alarm büyüyor',
      headlines: ['Adli yargıda dosya alarmı', 'Yarımız borçlu'],
    });
    expect(caption).toContain('Yargıda alarm büyüyor');
    expect(caption).toContain('Cumhuriyet kaynağından doğrulanmış');
    expect(caption).toContain('• Adli yargıda dosya alarmı');
    expect(caption).toContain('#OTONOM');
  });

  it('riskli hook ve başlığı sosyal medya metnine taşımaz', () => {
    const caption = buildSocialCaption({
      sourceName: 'Günlük Haber',
      hook: 'Onu öldürün',
      headlines: ['Mehmet kesin suçlu', 'Trabzonspor 1-1 berabere kaldı'],
    });
    expect(caption).toContain('Günün doğrulanmış gündemi');
    expect(caption).toContain('Trabzonspor 1-1 berabere kaldı');
    expect(caption).not.toContain('öldürün');
    expect(caption).not.toContain('kesin suçlu');
  });
});
