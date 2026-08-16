import { writeSystemLog } from '@otonom/shared-utils';

const API_BASE = (import.meta.env.VITE_API_URL || '/api').replace(/\/$/, '');
const ACCESS_TOKEN_STORAGE_KEY = 'hermes_ai_access_token';

export interface BufferDispatchResult {
  channelId: string;
  channelName: string;
  service: string;
  ok: boolean;
  postId?: string;
  dueAt?: string | null;
  status?: string;
  message?: string;
}

export interface AutoBufferPublishResult {
  mediaUrl: string;
  filename: string;
  queuedCount: number;
  failedCount: number;
  results: BufferDispatchResult[];
}

interface ApiEnvelope {
  success: boolean;
  data?: AutoBufferPublishResult;
  error?: { code?: string; message?: string };
}

export class AutoBufferPublishError extends Error {
  readonly code: string;
  readonly status: number;
  readonly result?: AutoBufferPublishResult;

  constructor(message: string, code = 'AUTO_BUFFER_FAILED', status = 0, result?: AutoBufferPublishResult) {
    super(message);
    this.name = 'AutoBufferPublishError';
    this.code = code;
    this.status = status;
    this.result = result;
  }
}

function requestPublish(options: {
  blob: Blob;
  filename: string;
  caption: string;
  accessToken?: string;
  onProgress?: (percent: number) => void;
}) {
  return new Promise<AutoBufferPublishResult>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `${API_BASE}/social/publish`);
    xhr.timeout = 15 * 60 * 1_000;
    xhr.responseType = 'json';
    xhr.setRequestHeader('Content-Type', options.blob.type || 'video/mp4');
    xhr.setRequestHeader('X-OTONOM-Filename', encodeURIComponent(options.filename));
    xhr.setRequestHeader('X-OTONOM-Caption', encodeURIComponent(options.caption));
    if (options.accessToken) xhr.setRequestHeader('X-Hermes-Access', options.accessToken);

    xhr.upload.onprogress = event => {
      if (!event.lengthComputable || !event.total) return;
      options.onProgress?.(Math.min(99, Math.round((event.loaded / event.total) * 100)));
    };
    xhr.onerror = () => reject(new AutoBufferPublishError('R2 yükleme bağlantısı kurulamadı.', 'NETWORK_ERROR'));
    xhr.ontimeout = () => reject(new AutoBufferPublishError('R2 yüklemesi 15 dakika içinde tamamlanamadı.', 'UPLOAD_TIMEOUT'));
    xhr.onabort = () => reject(new AutoBufferPublishError('R2 yüklemesi iptal edildi.', 'UPLOAD_ABORTED'));
    xhr.onload = () => {
      const payload = (xhr.response && typeof xhr.response === 'object'
        ? xhr.response
        : (() => { try { return JSON.parse(xhr.responseText); } catch { return null; } })()) as ApiEnvelope | null;
      if (xhr.status >= 200 && xhr.status < 300 && payload?.success && payload.data) {
        options.onProgress?.(100);
        resolve(payload.data);
        return;
      }
      reject(new AutoBufferPublishError(
        payload?.error?.message || `Buffer otomasyonu yanıt vermedi (HTTP ${xhr.status}).`,
        payload?.error?.code || 'AUTO_BUFFER_FAILED',
        xhr.status,
        payload?.data,
      ));
    };
    xhr.send(options.blob);
  });
}

export async function autoPublishGeneratedMedia(options: {
  blob: Blob;
  filename: string;
  caption: string;
  onProgress?: (percent: number) => void;
}, allowTokenPrompt = true): Promise<AutoBufferPublishResult> {
  const accessToken = localStorage.getItem(ACCESS_TOKEN_STORAGE_KEY)?.trim();
  writeSystemLog(`BUFFER AUTO: R2 yüklemesi başlatılıyor · ${options.filename} · ${(options.blob.size / 1024 / 1024).toFixed(1)} MB.`);
  try {
    const result = await requestPublish({ ...options, accessToken });
    writeSystemLog(
      `BUFFER AUTO: ${result.queuedCount} kanal kuyruğa alındı${result.failedCount ? ` · ${result.failedCount} kanal başarısız` : ''}.`,
      result.failedCount ? 'warn' : 'success',
    );
    result.results.forEach(item => writeSystemLog(
      `Buffer ${item.channelName} (${item.service}): ${item.ok ? `kuyrukta · post ${item.postId || '-'}` : item.message || 'başarısız'}`,
      item.ok ? 'success' : 'warn',
    ));
    return result;
  } catch (error) {
    if (error instanceof AutoBufferPublishError && error.status === 401 && allowTokenPrompt) {
      localStorage.removeItem(ACCESS_TOKEN_STORAGE_KEY);
      const supplied = window.prompt('Hermes erişim anahtarını girin. Bu değer yalnızca bu tarayıcıda saklanır.');
      if (supplied?.trim()) {
        localStorage.setItem(ACCESS_TOKEN_STORAGE_KEY, supplied.trim());
        return autoPublishGeneratedMedia(options, false);
      }
    }
    throw error;
  }
}

export function summarizeAutoBufferResult(result: AutoBufferPublishResult) {
  const successful = result.results.filter(item => item.ok);
  if (!successful.length) return 'Buffer kuyruğuna gönderilemedi.';
  const names = successful.map(item => {
    const dueAt = item.dueAt
      ? new Date(item.dueAt).toLocaleString('tr-TR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
      : '';
    return `${item.channelName} (${item.service})${dueAt ? ` · ${dueAt}` : ''}`;
  }).join(', ');
  return `${successful.length} kanal Buffer kuyruğuna alındı: ${names}`;
}
