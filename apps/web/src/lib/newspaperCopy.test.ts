import { describe, expect, it } from 'vitest';
import { buildNewspaperNarration, limitNewspaperHook } from './newspaperCopy';

describe('newspaper copy', () => {
  it('clickbait hook metnini en fazla dört kelimeyle sınırlar', () => {
    expect(limitNewspaperHook('Okul yolunda beklenmedik büyük tehlike', 'Okul yolu')).toBe('Okul yolunda beklenmedik büyük');
    expect(limitNewspaperHook('', 'Yol çok zorlu')).toBe('Yol çok zorlu');
  });

  it('kaynak, özgün başlık ve ayrıntıyı doğru sırayla seslendirir', () => {
    const narration = buildNewspaperNarration({
      sourceName: 'Nefes',
      headline: 'Okul yolu çok zorlu',
      detail: 'Okul yolu çok zorlu. Veliler çözüm bekliyor.',
    });
    expect(narration).toBe('Nefes gazetesinden. Okul yolu çok zorlu. Veliler çözüm bekliyor.');
  });
});
