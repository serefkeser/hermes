# Hermes ücretsiz AI sağlayıcıları

Hermes, analiz isteklerini tek bir sağlayıcıya bağlamaz. Cloudflare Worker içindeki yönlendirici, görev türüne ve tanımlı anahtarlara göre sağlayıcıları sırayla dener. Kota, hız sınırı veya geçici servis hatasında sıradaki sağlayıcıya geçer.

## Varsayılan yönlendirme

| Görev | Sağlayıcı sırası | Varsayılan model |
|---|---|---|
| Metin/senaryo | Groq → OpenCode Zen → NVIDIA → Gemini | `openai/gpt-oss-120b` → `deepseek-v4-flash-free` → `nvidia/nemotron-3-nano-30b-a3b` → `gemini-2.5-flash` |
| Görsel/OCR | Groq → NVIDIA → Gemini | `qwen/qwen3.6-27b` → `nvidia/nemotron-3-nano-omni-30b-a3b-reasoning` → `gemini-2.5-flash` |
| Türkçe seslendirme | Gemini | `gemini-2.5-flash-preview-tts`, ses `Aoede` |

OpenCode Zen yalnız metin yedeğidir. Seçilen ücretsiz model görsel girişi için kullanılmaz.

## Worker secret'ları

Anahtarların değerlerini repoya, `.env` dosyasına veya frontend koduna yazmayın. Worker dizininde aşağıdaki komutları çalıştırın:

```bash
cd services/api-gateway
npx wrangler secret put GROQ_API_KEY
npx wrangler secret put NVIDIA_API_KEY
npx wrangler secret put OPENCODE_API_KEY
npx wrangler secret put GEMINI_API_KEY
```

`AI_ACCESS_TOKEN` isteğe bağlıdır ve yalnız sunucudan sunucuya kullanım içindir:

```bash
npx wrangler secret put AI_ACCESS_TOKEN
```

Statik web uygulamasına `AI_ACCESS_TOKEN` gömmeyin. Kişisel kullanım için siteyi ve Worker alan adını Cloudflare Access ile kimlik doğrulamasına almak daha güvenlidir.

GitHub Actions ile dağıtımda aynı adları **Settings → Secrets and variables → Actions** altında repository secret olarak ekleyin. Mevcut iş akışı `GEMINI_API_KEY` değerini otomatik olarak Worker secret'ına aktarır. Groq, NVIDIA ve OpenCode anahtarları eklenene kadar yönlendirici bu sağlayıcıları atlar ve Gemini ile çalışır; anahtarlar hazır olduğunda dağıtım iş akışındaki `secrets` ve `env` listelerine adları ekleyin.

## Değiştirilebilir ayarlar

Model adları ve sıra `services/api-gateway/wrangler.toml` içindeki secret olmayan değişkenlerle değiştirilebilir:

```toml
AI_TEXT_PROVIDER_ORDER = "groq,opencode,nvidia,gemini"
AI_VISION_PROVIDER_ORDER = "groq,nvidia,gemini"
GROQ_TEXT_MODEL = "openai/gpt-oss-120b"
GROQ_VISION_MODEL = "qwen/qwen3.6-27b"
NVIDIA_TEXT_MODEL = "nvidia/nemotron-3-nano-30b-a3b"
NVIDIA_VISION_MODEL = "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning"
OPENCODE_TEXT_MODEL = "deepseek-v4-flash-free"
GEMINI_ANALYSIS_MODEL = "gemini-2.5-flash"
GEMINI_TTS_MODEL = "gemini-2.5-flash-preview-tts"
```

Bir anahtar tanımlı değilse o sağlayıcı otomatik olarak atlanır.

## API uçları

| Yöntem | Uç | Amaç |
|---|---|---|
| `GET` | `/api/ai/health` | Etkin sağlayıcıları anahtar değerlerini göstermeden listeler |
| `POST` | `/api/ai/analyze` | Metin, gazete sayfası veya en fazla üç görseli analiz eder |
| `POST` | `/api/ai/tts` | Türkçe anlatım sesi üretir |

Analiz yanıtı kullanılan sağlayıcıyı, modeli ve başarısız fallback denemelerini döndürür. Gizli anahtarlar yanıta veya loglara eklenmez.

## Ücretsiz kullanım sınırları

- Groq ücretsiz planı hız ve günlük token kotalarına tabidir; sınır aşılırsa fallback devreye girer.
- OpenCode Zen'deki `*-free` modeller geçici olabilir ve sağlayıcının veri kullanım koşullarına tabidir. Model adı gerektiğinde ayardan değiştirilebilir.
- NVIDIA ücretsiz NIM uçları prototip, araştırma, geliştirme ve test içindir. Bu nedenle production ortamında varsayılan olarak kapalıdır. Yalnız koşulları kabul ederek deneme amacıyla `ALLOW_NVIDIA_TRIAL = "true"` yapılmalıdır.
- Gemini ücretsiz kota bölgeye ve modele göre değişebilir. TTS için şu an ayrı bir ücretsiz Türkçe yedek bulunmadığından seslendirme yalnız Gemini kullanır.

## Depolamasız mimari

Üretilen veya yüklenen medya sunucuda kalıcı olarak saklanmaz:

1. Kullanıcı dosyayı tarayıcıda seçer.
2. Analiz için gerekli küçültülmüş içerik Worker üzerinden modele gönderilir.
3. Ses, altyazı ve video tarayıcıda oluşturulur.
4. Son dosya doğrudan kullanıcının cihazına indirilir.
5. Geçici `Blob` URL'leri sayfa kapandığında bırakılır.

Bu akışta R2, KV tabanlı iş durumu, Cloudflare Queue, veritabanı veya ücretli render sunucusu gerekmez. Worker yalnız anahtarları koruyan ince bir AI geçidi olarak çalışır.
