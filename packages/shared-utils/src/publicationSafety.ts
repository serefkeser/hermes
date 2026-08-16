export const PUBLICATION_SAFETY_POLICY_VERSION = '2026-08-16.1';

export type PublicationRiskCode =
  | 'VIOLENCE_OR_THREAT'
  | 'HATE_OR_DEHUMANIZATION'
  | 'HARASSMENT_OR_INSULT'
  | 'UNQUALIFIED_CRIMINAL_ALLEGATION'
  | 'PRIVATE_OR_PERSONAL_DATA'
  | 'MISLEADING_PUBLIC_SAFETY_CLAIM'
  | 'HARMFUL_HEALTH_OR_FINANCE_CLAIM'
  | 'DANGEROUS_INSTRUCTION'
  | 'SELF_HARM_PROMOTION'
  | 'CHILD_SEXUAL_SAFETY';

export interface PublicationSafetyFinding {
  code: PublicationRiskCode;
  message: string;
  legalRisk: string;
}

export interface PublicationSafetyResult {
  allowed: boolean;
  policyVersion: string;
  findings: PublicationSafetyFinding[];
}

function bounded(pattern: string) {
  return new RegExp(`(?:^|[^\\p{L}\\p{N}_])(?:${pattern})(?=$|[^\\p{L}\\p{N}_])`, 'iu');
}

const violentThreat = new RegExp(
  `(?:${bounded(String.raw`(?:seni|sizi|onu|onları|hepinizi).{0,36}(?:öldürece(?:ğim|ğiz|k)|vuracağ(?:ım|ız)|dövece(?:ğim|ğiz)|gebert(?:eceğim|iriz)|ateşe\s+verece(?:ğim|ğiz))`).source})|(?:${bounded(String.raw`öldürün|vurun|dövün|gebertin|linç\s+edin|ateşe\s+verin|kanını\s+dökün`).source})`,
  'iu',
);
const protectedGroup = bounded('kadınlar|erkekler|çocuklar|müslümanlar|hristiyanlar|yahudiler|aleviler|sünniler|türkler|kürtler|araplar|romanlar|göçmenler|mülteciler|eşcinseller|translar|engelliler|yaşlılar');
const hatefulPredicate = bounded(String.raw`aşağılık|haşere|mikrop|insan\s+değil|yok\s+edilmeli|öldürülmeli|kovulmalı|sürülmeli|temizlenmeli|yaşamamalı`);
const targetedInsult = bounded(String.raw`şerefsiz(?:ler)?|haysiyetsiz(?:ler)?|namussuz(?:lar)?|geri\s+zek[aâ]lı|aptal|salak|pislik|it\s+oğlu|orospu|pezevenk`);
const criminalLabel = bounded('hırsız|katil|dolandırıcı|terörist|tecavüzcü|rüşvetçi|kaçakçı|suçlu');
const legalQualification = bounded(String.raw`iddia\s+edildi|iddiası|öne\s+sürüldü|savcılığa\s+göre|mahkemeye\s+göre|mahkeme\s+kararıyla|kesinleşmiş\s+(?:karar|hüküm)|hüküm\s+giydi|şüpheli|sanık|tutuklandı|gözaltına\s+alındı|hakkında\s+soruşturma|suçlamasıyla|suçlaması`);
const definitiveGuilt = bounded(String.raw`kesin\s+suçlu|suçu\s+(?:kesin\s+olarak\s+)?kanıtlandı|suçluluğu\s+kesin`);
const phoneNumber = /(?:^|\D)(?:\+?90[\s.-]*)?0?5\d{2}(?:[\s.-]*\d{3})(?:[\s.-]*\d{2})(?:[\s.-]*\d{2})(?!\d)/u;
const emailAddress = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/iu;
const iban = /\bTR\s*\d{2}(?:\s*\d{4}){5}\s*\d{2}\b/iu;
const exposedAddress = bounded(String.raw`(?:ev|ikamet|konut)\s+adresi\s*(?::|şu|budur|aşağıda)`);
const publicSafetyTopic = bounded(String.raw`deprem|salgın|pandemi|aşı|seçim|savaş|terör\s+saldırısı|banka\s+krizi|genel\s+sağlık|kamu\s+düzeni|iç\s+güvenlik|dış\s+güvenlik`);
const unsupportedCertainty = bounded(String.raw`kesinlikle|şüphesiz|yüzde\s+yüz|kanıtlandı|gizlenen\s+gerçek|saklanan\s+gerçek`);
const sourceAttribution = bounded(String.raw`resm[iî]\s+açıklamaya\s+göre|bakanlığın\s+açıklamasına\s+göre|kurumun\s+açıklamasına\s+göre|mahkeme\s+kararına\s+göre|rapora\s+göre|verilere\s+göre|kaynağa\s+göre|iddia`);
const harmfulClaim = bounded(String.raw`mucize\s+tedavi|kesin\s+tedavi|ilaç\s+yerine|doktorsuz\s+tedavi|garantili\s+kazanç|risksiz\s+yatırım|kesin\s+kazan[çc]|bir\s+günde\s+zengin`);
const dangerousInstruction = bounded(String.raw`bomba\s+(?:nasıl\s+)?yapılır|patlayıcı\s+(?:yapımı|tarifi)|silah\s+yapımı|uyuşturucu\s+(?:üretimi|nasıl\s+yapılır)|kart\s+kopyalama|hesap\s+şifresi\s+kırma`);
const selfHarmPromotion = bounded(String.raw`intihar\s+et|kendini\s+öldür|canına\s+kıy|bileğini\s+kes`);
const childTerms = bounded(String.raw`çocuk|çocuğa|çocuklara|reşit\s+olmayan|minör`);
const sexualExploitation = bounded(String.raw`cinsel\s+istismar|çıplak\s+görüntü|pornografi|seks\s+görüntüsü|cinsel\s+içerik`);

function isValidTurkishIdentityNumber(value: string) {
  if (!/^\d{11}$/.test(value) || value[0] === '0') return false;
  const digits = [...value].map(Number);
  const odd = digits[0] + digits[2] + digits[4] + digits[6] + digits[8];
  const even = digits[1] + digits[3] + digits[5] + digits[7];
  const tenth = ((odd * 7) - even) % 10;
  const eleventh = digits.slice(0, 10).reduce((sum, digit) => sum + digit, 0) % 10;
  return digits[9] === (tenth + 10) % 10 && digits[10] === eleventh;
}

function containsTurkishIdentityNumber(text: string) {
  return (text.match(/(?<!\d)\d{11}(?!\d)/gu) || []).some(isValidTurkishIdentityNumber);
}

export function evaluatePublicationText(value: unknown): PublicationSafetyResult {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  const findings: PublicationSafetyFinding[] = [];
  const add = (code: PublicationRiskCode, message: string, legalRisk: string) => {
    if (!findings.some(item => item.code === code)) findings.push({ code, message, legalRisk });
  };

  if (!text) return { allowed: true, policyVersion: PUBLICATION_SAFETY_POLICY_VERSION, findings };

  if (violentThreat.test(text)) {
    add('VIOLENCE_OR_THREAT', 'Tehdit veya şiddete çağrı niteliğinde ifade bulundu.', 'TCK m.106 ve platform şiddet kuralları');
  }
  if (protectedGroup.test(text) && hatefulPredicate.test(text)) {
    add('HATE_OR_DEHUMANIZATION', 'Korunan bir gruba yönelik nefret, aşağılama veya hedef gösterme bulundu.', 'TCK m.216 ve platform nefret söylemi kuralları');
  }
  if (targetedInsult.test(text)) {
    add('HARASSMENT_OR_INSULT', 'Hakaret, küçük düşürme veya taciz riski taşıyan ifade bulundu.', 'TCK m.125 ve platform taciz kuralları');
  }
  if (definitiveGuilt.test(text) || (criminalLabel.test(text) && !legalQualification.test(text))) {
    add('UNQUALIFIED_CRIMINAL_ALLEGATION', 'Kesinleşmiş karar veya açık hukuki atıf olmadan suç isnadı bulundu.', 'TCK m.125 ve m.267; masumiyet karinesi ve kişilik hakları');
  }
  if (phoneNumber.test(text) || emailAddress.test(text) || iban.test(text) || exposedAddress.test(text) || containsTurkishIdentityNumber(text)) {
    add('PRIVATE_OR_PERSONAL_DATA', 'Telefon, e-posta, kimlik, IBAN veya özel adres niteliğinde veri bulundu.', 'TCK m.134-136 ve platform gizlilik kuralları');
  }
  if (publicSafetyTopic.test(text) && unsupportedCertainty.test(text) && !sourceAttribution.test(text)) {
    add('MISLEADING_PUBLIC_SAFETY_CLAIM', 'Kamu güvenliği veya genel sağlık konusunda kaynaksız kesinlik iddiası bulundu.', 'TCK m.217/A ve platform yanıltıcı bilgi kuralları');
  }
  if (harmfulClaim.test(text)) {
    add('HARMFUL_HEALTH_OR_FINANCE_CLAIM', 'Zararlı sağlık önerisi veya garantili finansal sonuç vaadi bulundu.', 'Platform zararlı içerik ve dolandırıcılık kuralları');
  }
  if (dangerousInstruction.test(text)) {
    add('DANGEROUS_INSTRUCTION', 'Suç veya ciddi zarar doğurabilecek uygulama talimatı bulundu.', 'Platform tehlikeli faaliyet ve suç kolaylaştırma kuralları');
  }
  if (selfHarmPromotion.test(text)) {
    add('SELF_HARM_PROMOTION', 'Kendine zarar vermeyi teşvik eden ifade bulundu.', 'Platform kendine zarar verme güvenliği kuralları');
  }
  if (childTerms.test(text) && sexualExploitation.test(text)) {
    add('CHILD_SEXUAL_SAFETY', 'Çocukların cinsel istismarına ilişkin yayınlanamaz içerik riski bulundu.', 'Çocuk güvenliği ve platform sıfır tolerans kuralları');
  }

  return {
    allowed: findings.length === 0,
    policyVersion: PUBLICATION_SAFETY_POLICY_VERSION,
    findings,
  };
}

export function publicationSafetySummary(result: PublicationSafetyResult) {
  return result.findings.map(finding => `${finding.code}: ${finding.message}`).join(' · ');
}
