import React, { useEffect, useRef, useState } from 'react';
import type { MediaFile } from '@otonom/shared-types';
import { ChevronDown, FolderOpen, Music } from './icons';

interface BackgroundMusicPickerProps {
  value: MediaFile | null;
  onChange: (track: MediaFile | null) => void;
}

interface LocalMusicTrack {
  id: string;
  label: string;
  file: File;
}

const AUDIO_EXTENSIONS = /\.(aac|flac|m4a|mp3|oga|ogg|opus|wav|wma)$/i;

function isAudioFile(file: File) {
  return file.type.startsWith('audio/') || AUDIO_EXTENSIONS.test(file.name);
}

function createTrack(file: File, index: number): LocalMusicTrack {
  const relativePath = (file as File & { webkitRelativePath?: string }).webkitRelativePath;
  const label = relativePath || file.name;
  const fingerprint = `${label}-${file.size}-${file.lastModified}-${index}`;

  return {
    id: `bgm-${encodeURIComponent(fingerprint)}`,
    label,
    file,
  };
}

export function BackgroundMusicPicker({ value, onChange }: BackgroundMusicPickerProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const activeUrlRef = useRef<string | null>(null);
  const [tracks, setTracks] = useState<LocalMusicTrack[]>([]);
  const [message, setMessage] = useState('');

  useEffect(() => {
    const input = inputRef.current;
    if (!input) return;

    input.setAttribute('webkitdirectory', '');
    input.setAttribute('directory', '');
  }, []);

  useEffect(() => {
    return () => {
      if (activeUrlRef.current) URL.revokeObjectURL(activeUrlRef.current);
    };
  }, []);

  useEffect(() => {
    if (!value && activeUrlRef.current) {
      URL.revokeObjectURL(activeUrlRef.current);
      activeUrlRef.current = null;
    }
  }, [value]);

  const selectTrack = (track: LocalMusicTrack | null) => {
    if (activeUrlRef.current) {
      URL.revokeObjectURL(activeUrlRef.current);
      activeUrlRef.current = null;
    }

    if (!track) {
      onChange(null);
      return;
    }

    const url = URL.createObjectURL(track.file);
    activeUrlRef.current = url;
    onChange({
      id: track.id,
      name: track.file.name,
      type: 'audio',
      mimeType: track.file.type || 'audio/mpeg',
      size: track.file.size,
      url,
    });
  };

  const handleFolderSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const audioTracks = Array.from(event.target.files || [])
      .filter(isAudioFile)
      .sort((a, b) => a.name.localeCompare(b.name, 'tr'))
      .map(createTrack);

    event.target.value = '';

    if (audioTracks.length === 0) {
      setMessage('Bu klasörde desteklenen bir ses dosyası bulunamadı.');
      return;
    }

    setTracks(audioTracks);
    setMessage(`${audioTracks.length} müzik bulundu — dosyalar yerel olarak listeleniyor`);
    // Klasör seçmek müziği kendiliğinden etkinleştirmesin; kullanıcı parçayı menüden seçsin.
    selectTrack(null);
  };

  const handleTrackChange = (event: React.ChangeEvent<HTMLSelectElement>) => {
    const track = tracks.find(item => item.id === event.target.value) || null;
    selectTrack(track);
  };

  return (
    <section
      aria-labelledby="background-music-title"
      className="mb-4 rounded-2xl border border-indigo-500/25 bg-indigo-950/10 p-3 shadow-lg"
    >
      <div className="flex flex-col gap-3 rounded-xl border border-slate-700/80 bg-[#080C17]/95 p-2 sm:flex-row sm:items-center">
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-slate-600 bg-slate-900 text-slate-400">
            <FolderOpen size={20} />
          </div>

          <div className="min-w-0 flex-1">
            <h2 id="background-music-title" className="mb-0.5 text-[10px] font-black tracking-wide text-slate-400">
              ARKA PLAN SESİ
            </h2>
            <div className="relative flex items-center gap-2">
              {value ? <Music size={14} className="shrink-0 text-indigo-400" /> : <span aria-hidden="true">🔇</span>}
              <span className="truncate text-xs font-bold text-white">
                {value?.name || 'Arka Ses Yok'}
              </span>
              <ChevronDown size={14} className="ml-auto shrink-0 text-slate-400" />
              <select
                aria-label="Arka plan müziği"
                value={value?.id || ''}
                onChange={handleTrackChange}
                className="absolute inset-0 h-full w-full cursor-pointer appearance-none opacity-0"
              >
                <option value="">Arka Ses Yok</option>
                {tracks.map(track => (
                  <option key={track.id} value={track.id}>{track.label}</option>
                ))}
              </select>
            </div>
          </div>
        </div>

        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          className="shrink-0 rounded-xl bg-violet-600 px-4 py-2 text-[10px] font-black text-white shadow-[0_8px_24px_rgba(124,58,237,0.24)] transition hover:bg-violet-500 focus:outline-none focus:ring-2 focus:ring-violet-400"
        >
          MÜZİK KLASÖRÜ SEÇ
        </button>

        <input
          ref={inputRef}
          type="file"
          multiple
          accept="audio/*,.aac,.flac,.m4a,.mp3,.oga,.ogg,.opus,.wav,.wma"
          onChange={handleFolderSelect}
          className="hidden"
        />
      </div>

      <p className={`mt-2 text-center text-[8px] ${message.startsWith('Bu klasörde') ? 'text-rose-400' : 'text-slate-500'}`}>
        {message || 'Müzik klasörü seçin — dosyalar yerel olarak listelenir'}
      </p>
    </section>
  );
}
