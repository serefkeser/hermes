import { APP_VERSION } from '../version';
import type { MediaFile, RenderConfig } from '@otonom/shared-types';
import type { SystemLogEntry } from '@otonom/shared-utils';

const ACTIVE_LOG_STORAGE_KEY = 'otonom_diagnostic_active_v1';
const LAST_LOG_STORAGE_KEY = 'otonom_diagnostic_last_v1';
const MAX_ENTRIES = 2_000;
const MAX_STRING_LENGTH = 2_000;

type DiagnosticStatus = 'running' | 'success' | 'error' | 'interrupted';
type DiagnosticLevel = SystemLogEntry['type'];

interface DiagnosticEvent {
  at: string;
  elapsedMs: number;
  level: DiagnosticLevel;
  phase: string;
  message: string;
  details?: unknown;
}

interface DiagnosticRun {
  schemaVersion: 1;
  runId: string;
  appVersion: string;
  status: DiagnosticStatus;
  startedAt: string;
  endedAt?: string;
  page: {
    url: string;
  };
  environment: {
    userAgent: string;
    language: string;
    platform: string;
    hardwareConcurrency?: number;
    deviceMemoryGb?: number;
    online: boolean;
  };
  context: {
    outputType: 'image' | 'video';
    inputType: string;
    config: Record<string, unknown>;
    media: Array<Record<string, unknown>>;
    customImageCount: number;
    hasBackgroundMusic: boolean;
  };
  events: DiagnosticEvent[];
}

interface DiagnosticStartOptions {
  outputType: 'image' | 'video';
  inputType: string;
  config: RenderConfig;
  media: MediaFile[];
  customImageCount: number;
  hasBackgroundMusic: boolean;
}

let activeRun: DiagnosticRun | null = null;
let lastProgressBucket = -1;
let lastProgressStatus = '';

function getCleanPageUrl() {
  if (typeof window === 'undefined') return '';
  return `${window.location.origin}${window.location.pathname}`;
}

function getEnvironment(): DiagnosticRun['environment'] {
  if (typeof navigator === 'undefined') {
    return { userAgent: '', language: '', platform: '', online: true };
  }
  const extendedNavigator = navigator as Navigator & { deviceMemory?: number; userAgentData?: { platform?: string } };
  return {
    userAgent: navigator.userAgent,
    language: navigator.language,
    platform: extendedNavigator.userAgentData?.platform || navigator.platform || '',
    hardwareConcurrency: navigator.hardwareConcurrency,
    deviceMemoryGb: extendedNavigator.deviceMemory,
    online: navigator.onLine,
  };
}

function redactString(value: string) {
  const truncated = value.length > MAX_STRING_LENGTH
    ? `${value.slice(0, MAX_STRING_LENGTH)}…[${value.length - MAX_STRING_LENGTH} karakter kısaltıldı]`
    : value;
  return truncated
    .replace(/(bearer\s+)[a-z0-9._~+\/-]+=*/gi, '$1[REDACTED]')
    .replace(/((?:api[_ -]?key|access[_ -]?token|jwt[_ -]?secret|authorization)\s*[:=]\s*)\S+/gi, '$1[REDACTED]');
}

function sanitize(value: unknown, key = '', depth = 0): unknown {
  if (depth > 5) return '[MAX_DEPTH]';
  if (/token|secret|authorization|api.?key|base64|\bdata\b/i.test(key)) return '[REDACTED]';
  if (typeof value === 'string') {
    if (/^data:/i.test(value)) return `[DATA_URL_REDACTED length=${value.length}]`;
    if (/^blob:/i.test(value)) return '[BLOB_URL]';
    return redactString(value);
  }
  if (typeof value === 'number' || typeof value === 'boolean' || value == null) return value;
  if (Array.isArray(value)) return value.slice(0, 100).map(item => sanitize(item, key, depth + 1));
  if (typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .slice(0, 100)
      .map(([childKey, childValue]) => [childKey, sanitize(childValue, childKey, depth + 1)]));
  }
  return String(value);
}

function snapshotConfig(config: RenderConfig) {
  return sanitize({
    duration: config.duration,
    aspectRatio: config.aspectRatio,
    videoStyle: config.videoStyle,
    fontStyle: config.fontStyle,
    imageStyle: config.imageStyle,
    language: config.language,
    subtitles: config.subtitles,
    resolution: config.resolution,
    transition: config.transition,
    videoFormat: config.videoFormat,
    analysisMode: config.analysisMode,
    tip: config.tip,
    sourceName: config.sourceName,
    hasComment: Boolean(config.yorum?.trim()),
    backgroundMusicVolume: config.backgroundMusicVolume,
  }) as Record<string, unknown>;
}

function snapshotMedia(media: MediaFile[]) {
  return media.map(item => sanitize({
    name: item.name,
    type: item.type,
    mimeType: item.mimeType,
    size: item.size,
    source: item.url?.startsWith('data:') ? 'data-url' : item.url?.startsWith('blob:') ? 'blob-url' : item.url ? 'remote-url' : 'none',
  }) as Record<string, unknown>);
}

function persist(key: string, run: DiagnosticRun) {
  try {
    localStorage.setItem(key, JSON.stringify(run));
  } catch {
    // Bellekteki günlük yine indirilebilir; depolama yoksa kesintiden kurtarma kullanılamaz.
  }
}

function removeStored(key: string) {
  try { localStorage.removeItem(key); } catch { /* storage unavailable */ }
}

function appendEvent(level: DiagnosticLevel, phase: string, message: string, details?: unknown) {
  if (!activeRun) return;
  const started = Date.parse(activeRun.startedAt);
  activeRun.events.push({
    at: new Date().toISOString(),
    elapsedMs: Math.max(0, Date.now() - started),
    level,
    phase: redactString(phase),
    message: redactString(message),
    ...(details === undefined ? {} : { details: sanitize(details) }),
  });
  if (activeRun.events.length > MAX_ENTRIES) activeRun.events.splice(0, activeRun.events.length - MAX_ENTRIES);
  persist(ACTIVE_LOG_STORAGE_KEY, activeRun);
}

function safeFilePart(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9._-]/g, '_')
    .replace(/_+/g, '_');
}

export function buildDiagnosticLogText(run: DiagnosticRun) {
  const header = [
    '# OTONOM VIDEO URETIM TANILAMA LOGU',
    `schema=${run.schemaVersion}`,
    `run_id=${run.runId}`,
    `app_version=${run.appVersion}`,
    `status=${run.status}`,
    `started_at=${run.startedAt}`,
    `ended_at=${run.endedAt || ''}`,
    `environment=${JSON.stringify(run.environment)}`,
    `context=${JSON.stringify(run.context)}`,
    '',
    '# OLAYLAR',
  ];
  const events = run.events.map(event => {
    const details = event.details === undefined ? '' : ` | ${JSON.stringify(event.details)}`;
    return `[${event.at}] +${event.elapsedMs}ms [${event.level.toUpperCase()}] [${event.phase}] ${event.message}${details}`;
  });
  return [...header, ...events, ''].join('\n');
}

function downloadRun(run: DiagnosticRun) {
  if (typeof document === 'undefined') return;
  const blob = new Blob([buildDiagnosticLogText(run)], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  const stamp = run.startedAt.replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
  link.href = url;
  link.download = safeFilePart(`OTONOM_${run.appVersion}_${run.runId}_${stamp}_${run.status}.log`);
  link.style.display = 'none';
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

export function startDiagnosticRun(options: DiagnosticStartOptions) {
  if (activeRun) finishDiagnosticRun('interrupted', { reason: 'Yeni üretim önceki aktif üretimin üzerine başladı.' }, false);
  const startedAt = new Date().toISOString();
  activeRun = {
    schemaVersion: 1,
    runId: crypto.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
    appVersion: APP_VERSION,
    status: 'running',
    startedAt,
    page: { url: getCleanPageUrl() },
    environment: getEnvironment(),
    context: {
      outputType: options.outputType,
      inputType: options.inputType,
      config: snapshotConfig(options.config),
      media: snapshotMedia(options.media),
      customImageCount: options.customImageCount,
      hasBackgroundMusic: options.hasBackgroundMusic,
    },
    events: [],
  };
  lastProgressBucket = -1;
  lastProgressStatus = '';
  appendEvent('info', 'run', 'Üretim tanılama kaydı başlatıldı.');
  return activeRun.runId;
}

export function captureSystemLog(entry: SystemLogEntry) {
  appendEvent(entry.type, 'system', entry.text, { uiTimestamp: entry.timestamp });
}

export function recordDiagnosticEvent(
  phase: string,
  message: string,
  level: DiagnosticLevel = 'info',
  details?: unknown,
) {
  appendEvent(level, phase, message, details);
}

export function recordDiagnosticProgress(progress: number, status: string) {
  const bucket = Math.floor(Math.max(0, Math.min(100, progress)) / 5);
  if (bucket === lastProgressBucket && status === lastProgressStatus) return;
  lastProgressBucket = bucket;
  lastProgressStatus = status;
  appendEvent('info', 'progress', status, { progress: Math.round(progress) });
}

export function finishDiagnosticRun(
  status: Exclude<DiagnosticStatus, 'running'>,
  details?: unknown,
  autoDownload = true,
) {
  if (!activeRun) return null;
  appendEvent(status === 'success' ? 'success' : 'error', 'run',
    status === 'success' ? 'Üretim tamamlandı.' : status === 'error' ? 'Üretim hatayla durdu.' : 'Üretim yarıda kesildi.',
    details);
  activeRun.status = status;
  activeRun.endedAt = new Date().toISOString();
  persist(LAST_LOG_STORAGE_KEY, activeRun);
  removeStored(ACTIVE_LOG_STORAGE_KEY);
  const completed = activeRun;
  activeRun = null;
  if (autoDownload) downloadRun(completed);
  return completed;
}

export function markDiagnosticRunInterrupted(reason: string) {
  if (!activeRun) return;
  appendEvent('error', 'lifecycle', reason);
  activeRun.status = 'interrupted';
  activeRun.endedAt = new Date().toISOString();
  persist(ACTIVE_LOG_STORAGE_KEY, activeRun);
}

export function recoverInterruptedDiagnosticRun() {
  if (activeRun) return false;
  try {
    const raw = localStorage.getItem(ACTIVE_LOG_STORAGE_KEY);
    if (!raw) return false;
    const recovered = JSON.parse(raw) as DiagnosticRun;
    if (!recovered?.runId || !Array.isArray(recovered.events)) {
      removeStored(ACTIVE_LOG_STORAGE_KEY);
      return false;
    }
    recovered.status = 'interrupted';
    recovered.endedAt ||= new Date().toISOString();
    recovered.events.push({
      at: new Date().toISOString(),
      elapsedMs: Math.max(0, Date.now() - Date.parse(recovered.startedAt)),
      level: 'error',
      phase: 'recovery',
      message: 'Önceki üretim tamamlanmadan sayfa veya tarayıcı kapandı; günlük sonraki açılışta kurtarıldı.',
    });
    persist(LAST_LOG_STORAGE_KEY, recovered);
    removeStored(ACTIVE_LOG_STORAGE_KEY);
    downloadRun(recovered);
    return true;
  } catch {
    removeStored(ACTIVE_LOG_STORAGE_KEY);
    return false;
  }
}

export function downloadLastDiagnosticRun() {
  try {
    const raw = localStorage.getItem(LAST_LOG_STORAGE_KEY);
    if (!raw) return false;
    downloadRun(JSON.parse(raw) as DiagnosticRun);
    return true;
  } catch {
    return false;
  }
}

export function installDiagnosticErrorCapture() {
  if (typeof window === 'undefined') return () => undefined;
  const onError = (event: ErrorEvent) => recordDiagnosticEvent('window.error', event.message || 'Yakalanmamış tarayıcı hatası', 'error', {
    filename: event.filename,
    line: event.lineno,
    column: event.colno,
    stack: event.error instanceof Error ? event.error.stack : undefined,
  });
  const onRejection = (event: PromiseRejectionEvent) => {
    const reason = event.reason instanceof Error
      ? { message: event.reason.message, stack: event.reason.stack }
      : { reason: String(event.reason) };
    recordDiagnosticEvent('unhandledrejection', 'Yakalanmamış Promise hatası', 'error', reason);
  };
  window.addEventListener('error', onError);
  window.addEventListener('unhandledrejection', onRejection);
  return () => {
    window.removeEventListener('error', onError);
    window.removeEventListener('unhandledrejection', onRejection);
  };
}
