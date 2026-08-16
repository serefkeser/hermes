import { describe, expect, it } from 'vitest';
import { buildDiagnosticLogText } from './diagnosticLog';

describe('diagnostic log formatter', () => {
  it('tanılama başlığını, sürümü ve olay ayrıntılarını metne yazar', () => {
    const text = buildDiagnosticLogText({
      schemaVersion: 1,
      runId: 'run-123',
      appVersion: '3.14.1',
      status: 'error',
      startedAt: '2026-08-16T10:00:00.000Z',
      endedAt: '2026-08-16T10:00:03.000Z',
      page: { url: 'https://example.test/hermes/' },
      environment: { userAgent: 'Chrome', language: 'tr-TR', platform: 'Windows', online: true },
      context: {
        outputType: 'video',
        inputType: 'media',
        config: { resolution: '4K' },
        media: [{ name: 'gazete.jpg', size: 42 }],
        customImageCount: 1,
        hasBackgroundMusic: true,
      },
      events: [{
        at: '2026-08-16T10:00:03.000Z',
        elapsedMs: 3000,
        level: 'error',
        phase: 'render',
        message: 'MediaRecorder durdu',
        details: { chunks: 0 },
      }],
    });

    expect(text).toContain('app_version=3.14.1');
    expect(text).toContain('status=error');
    expect(text).toContain('[ERROR] [render] MediaRecorder durdu');
    expect(text).toContain('"chunks":0');
  });
});
