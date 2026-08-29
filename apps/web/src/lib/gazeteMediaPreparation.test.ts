import { describe, expect, it, vi } from 'vitest';
import { prepareGazeteMedia } from './gazeteMediaPreparation';

describe('gazete media preparation', () => {
  it('3.14.36 Cumhuriyet yarışında yerel kopya hazır olmadan medyayı döndürmez', async () => {
    let finishLocalization!: (value: string) => void;
    const localize = vi.fn(() => new Promise<string>(resolve => {
      finishLocalization = resolve;
    }));
    let prepared = false;
    const pending = prepareGazeteMedia({
      id: 'cumhuriyet',
      name: 'Cumhuriyet',
      src: 'https://img.example.test/cumhuriyet.jpg',
    }, localize).then(result => {
      prepared = true;
      return result;
    });

    await Promise.resolve();
    expect(prepared).toBe(false);

    finishLocalization('data:image/jpeg;base64,Q1VNSFVSSVlFVA==');
    const result = await pending;

    expect(result.media.url).toBe(result.localSrc);
    expect(result.media.url).toMatch(/^data:image\/jpeg/);
    expect(localize).toHaveBeenCalledTimes(1);
  });

  it('uzak URL geri dönerse medyayı hazır kabul etmez', async () => {
    await expect(prepareGazeteMedia({
      id: 'cumhuriyet',
      name: 'Cumhuriyet',
      src: 'https://img.example.test/cumhuriyet.jpg',
    }, async src => src)).rejects.toThrow('yerel kopyası oluşturulamadı');
  });

  it('gazete bulunamadı yer tutucusunu gerçek tam sayfa olarak kabul etmez', async () => {
    await expect(prepareGazeteMedia({
      id: 'cumhuriyet',
      name: 'Cumhuriyet',
      src: 'data:image/svg+xml,placeholder',
    }, async src => src)).rejects.toThrow('yer tutucu görsel kullanılamaz');
  });
});
