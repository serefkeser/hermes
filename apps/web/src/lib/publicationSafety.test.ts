import { describe, expect, it } from 'vitest';
import { evaluatePublicationText, PUBLICATION_SAFETY_POLICY_VERSION } from '@otonom/shared-utils';
import { PublicationSafetyBlockedError, securePublicationPlan } from './publicationSafety';

describe('publication safety policy', () => {
  it('doğrulanabilir, tarafsız haber cümlelerini değiştirmeden geçirir', () => {
    const result = evaluatePublicationText('Trabzonspor karşılaşmadan 1-1 beraberlikle ayrıldı.');
    expect(result.allowed).toBe(true);
    expect(result.policyVersion).toBe(PUBLICATION_SAFETY_POLICY_VERSION);
  });

  it.each([
    ['Onu öldürün.', 'VIOLENCE_OR_THREAT'],
    ['Mülteciler insan değil.', 'HATE_OR_DEHUMANIZATION'],
    ['Bu şerefsiz adam hesap verecek.', 'HARASSMENT_OR_INSULT'],
    ['Mehmet kesin suçlu ve dolandırıcı.', 'UNQUALIFIED_CRIMINAL_ALLEGATION'],
    ['T.C. kimlik numarası 10000000146.', 'PRIVATE_OR_PERSONAL_DATA'],
    ['Deprem konusunda gizlenen gerçek kesinlikle bu.', 'MISLEADING_PUBLIC_SAFETY_CLAIM'],
    ['Bu yöntem garantili kazanç sağlar.', 'HARMFUL_HEALTH_OR_FINANCE_CLAIM'],
    ['Bomba nasıl yapılır, adım adım anlatalım.', 'DANGEROUS_INSTRUCTION'],
    ['Kendini öldür.', 'SELF_HARM_PROMOTION'],
  ])('%s ifadesini %s gerekçesiyle durdurur', (text, code) => {
    const result = evaluatePublicationText(text);
    expect(result.allowed).toBe(false);
    expect(result.findings.map(item => item.code)).toContain(code);
  });

  it('açık hukuki statü içeren haber dilini suçlu ilanı saymaz', () => {
    const result = evaluatePublicationText('Savcılığa göre olayın şüphelisi dolandırıcı olduğu iddiasıyla gözaltına alındı.');
    expect(result.allowed).toBe(true);
  });

  it('riskli sahneyi atlar, güvenli sahneyi ve tarafsız kapanışı korur', () => {
    const result = securePublicationPlan({
      script: {
        thumbnailText: 'GÜNDEM',
        sonSoz: 'Bu şerefsizler kaybedecek.',
        lastQuote: 'Gelişmeleri izliyoruz.',
        videoSlides: [
          { sourceHeadlineId: 'H1', topText: 'SUÇLU BULUNDU', spokenText: 'Mehmet kesin suçlu.', imagePrompts: [] },
          { sourceHeadlineId: 'H2', topText: 'MAÇ BERABERE', spokenText: 'Trabzonspor 1-1 berabere kaldı.', imagePrompts: [] },
        ],
      },
      userComment: 'Onu vurun.',
    });

    expect(result.script.videoSlides.map(item => item.sourceHeadlineId)).toEqual(['H2']);
    expect(result.script.sonSoz).toBe('Doğru haber, doğrulanmış bilgidir.');
    expect(result.userComment).toBe('');
    expect(result.blocked.map(item => item.kind)).toEqual(expect.arrayContaining(['slide', 'closing', 'user-comment']));
  });

  it('bütün sahneler riskliyse üretimi kapalı varsayımla durdurur', () => {
    expect(() => securePublicationPlan({
      script: {
        videoSlides: [{ topText: 'HEDEF', spokenText: 'Onu öldürün.', imagePrompts: [] }],
      },
    })).toThrow(PublicationSafetyBlockedError);
  });
});
