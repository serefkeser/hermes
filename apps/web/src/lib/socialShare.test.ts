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
    expect(caption).toContain('Cumhuriyet gazetesinin');
    expect(caption).toContain('• Adli yargıda dosya alarmı');
    expect(caption).toContain('#OTONOM');
  });
});
