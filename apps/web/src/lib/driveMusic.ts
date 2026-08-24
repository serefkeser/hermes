import type { MediaFile } from '@otonom/shared-types';
import { writeSystemLog } from '@otonom/shared-utils';
import { fetchWithNetworkRetry } from './networkRetry';

const API_BASE = (import.meta.env.VITE_API_URL || '/api').replace(/\/$/, '');

interface DriveMusicCatalog {
  success: boolean;
  data?: {
    folderId: string;
    tracks: Array<{ id: string; name: string; mimeType: string; url: string }>;
  };
  error?: { message?: string };
}

let activeAutomaticUrl: string | null = null;

function chooseTrack<T>(tracks: T[]) {
  if (!tracks.length) return null;
  const random = new Uint32Array(1);
  crypto.getRandomValues(random);
  return tracks[random[0] % tracks.length];
}

export async function loadAutomaticDriveMusic(): Promise<MediaFile> {
  const catalogResponse = await fetchWithNetworkRetry(`${API_BASE}/music/catalog`, {}, {
    endpoint: '/music/catalog',
  });
  const catalog = await catalogResponse.json().catch(() => null) as DriveMusicCatalog | null;
  if (!catalogResponse.ok || !catalog?.success || !catalog.data?.tracks.length) {
    throw new Error(catalog?.error?.message || `Google Drive müzik kataloğu alınamadı (HTTP ${catalogResponse.status}).`);
  }

  const selected = chooseTrack(catalog.data.tracks);
  if (!selected) throw new Error('Google Drive klasöründe kullanılabilir haber müziği bulunamadı.');
  writeSystemLog(`Google Drive müziği seçildi: ${selected.name}`);

  const audioResponse = await fetchWithNetworkRetry(selected.url, { cache: 'no-store' }, {
    endpoint: `/music/${selected.id}`,
  });
  if (!audioResponse.ok) throw new Error(`Google Drive müziği indirilemedi (HTTP ${audioResponse.status}).`);
  const blob = await audioResponse.blob();
  if (!blob.size || !blob.type.startsWith('audio/')) throw new Error('Google Drive yanıtı geçerli bir ses dosyası değil.');

  if (activeAutomaticUrl) URL.revokeObjectURL(activeAutomaticUrl);
  activeAutomaticUrl = URL.createObjectURL(blob);
  writeSystemLog(`Google Drive müziği hazır: ${selected.name} · ${(blob.size / 1024 / 1024).toFixed(1)} MB`, 'success');
  return {
    id: `drive-${selected.id}`,
    name: selected.name,
    type: 'audio',
    mimeType: blob.type || selected.mimeType || 'audio/mpeg',
    size: blob.size,
    url: activeAutomaticUrl,
  };
}
