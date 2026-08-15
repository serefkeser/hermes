// MediaUpload component
import React, { useCallback, useRef } from 'react';
import { UploadCloud, Trash2, FileText, Film, Music, ImagePlus, Layers } from './icons';
import { RENDER_CONFIG } from '@otonom/shared-config';
import type { MediaFile } from '@otonom/shared-types';

interface MediaUploadProps {
  files: MediaFile[];
  onChange: (files: MediaFile[]) => void;
  customImages: string[];
  onCustomImagesChange: (images: string[]) => void;
}

export function MediaUpload({ files, onChange, customImages, onCustomImagesChange }: MediaUploadProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const customInputRef = useRef<HTMLInputElement>(null);

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFiles = Array.from(e.target.files || []);
    if (selectedFiles.length === 0) return;

    if (selectedFiles.length > 100) {
      alert('Maksimum 100 dosya seçebilirsiniz.');
      return;
    }

    const validFiles = selectedFiles.filter(f => f.size <= 50 * 1024 * 1024);
    if (validFiles.length !== selectedFiles.length) {
      alert('Bazı dosyalar 50MB sınırını aşıyor, atlandı.');
    }

    const processedFiles = validFiles.map(file => ({
      name: file.name,
      type: file.type,
      size: file.size,
      data: URL.createObjectURL(file),
    }));

    onChange([...files, ...processedFiles]);
    if (e.target) e.target.value = '';
  }, [files, onChange]);

  const handleCustomImageSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFiles = Array.from(e.target.files || []);
    if (selectedFiles.length === 0) return;

    const availableSlots = RENDER_CONFIG.MAX_CUSTOM_SCENE_IMAGES - customImages.length;
    const filesToProcess = selectedFiles.slice(0, availableSlots);

    const readers = filesToProcess.map(file => {
      return new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
    });

    Promise.all(readers).then(newImages => {
      onCustomImagesChange([...customImages, ...newImages].slice(0, RENDER_CONFIG.MAX_CUSTOM_SCENE_IMAGES));
    });

    if (e.target) e.target.value = '';
  }, [customImages, onCustomImagesChange]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    e.currentTarget.classList.add('border-indigo-400', 'bg-indigo-500/20');
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!e.currentTarget.contains(e.relatedTarget as Node)) {
      e.currentTarget.classList.remove('border-indigo-400', 'bg-indigo-500/20');
    }
  }, []);

  const handleDrop = useCallback((e: React.DragEvent, type: 'media' | 'custom') => {
    e.preventDefault();
    e.stopPropagation();
    e.currentTarget.classList.remove('border-indigo-400', 'bg-indigo-500/20');

    const droppedFiles = Array.from(e.dataTransfer.files);
    if (droppedFiles.length === 0) return;

    if (type === 'custom') {
      const imageFiles = droppedFiles.filter(f => f.type.startsWith('image/'));
      if (imageFiles.length === 0) return;
      
      const availableSlots = RENDER_CONFIG.MAX_CUSTOM_SCENE_IMAGES - customImages.length;
      const filesToProcess = imageFiles.slice(0, availableSlots);

      const readers = filesToProcess.map(file => {
        return new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result as string);
          reader.onerror = reject;
          reader.readAsDataURL(file);
        });
      });

      Promise.all(readers).then(newImages => {
        onCustomImagesChange([...customImages, ...newImages].slice(0, RENDER_CONFIG.MAX_CUSTOM_SCENE_IMAGES));
      });
    } else {
      const validFiles = droppedFiles.filter(f => f.size <= 50 * 1024 * 1024);
      const processedFiles = validFiles.map(file => ({
        name: file.name,
        type: file.type,
        size: file.size,
        data: URL.createObjectURL(file),
      }));
      onChange([...files, ...processedFiles]);
    }
  }, [files, customImages, onChange, onCustomImagesChange]);

  const removeFile = (index: number) => {
    onChange(files.filter((_, i) => i !== index));
  };

  const removeCustomImage = (index: number) => {
    onCustomImagesChange(customImages.filter((_, i) => i !== index));
  };

  const getFileIcon = (type: string) => {
    if (type.startsWith('image/')) return <ImagePlus size={16} />;
    if (type.startsWith('video/')) return <Film size={16} />;
    if (type.startsWith('audio/')) return <Music size={16} />;
    return <FileText size={16} />;
  };

  const formatSize = (bytes: number) => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
  };

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-3">
      {/* SABİT GÖRSELLER */}
      <div
        className="bg-cyan-950/20 border border-cyan-500/20 rounded-xl p-2.5 shadow-lg transition-colors"
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={e => handleDrop(e, 'custom')}
      >
        <h2 className="text-[10px] font-black text-cyan-400 mb-1 flex items-center gap-1.5">
          <Layers size={12} /> SABİT GÖRSELLER (MAKS {RENDER_CONFIG.MAX_CUSTOM_SCENE_IMAGES})
        </h2>
        <div className="flex flex-wrap gap-2">
          {customImages.map((img, idx) => (
            <div key={idx} className="relative w-14 h-14 rounded-lg overflow-hidden border border-slate-700 shadow-md group">
              <img src={img} className="w-full h-full object-cover" alt={`Sabit ${idx}`} />
              <button
                onClick={() => removeCustomImage(idx)}
                className="absolute top-0.5 right-0.5 bg-rose-500/80 group-hover:opacity-100 hover:bg-rose-500 text-white p-0.5 rounded transition opacity-0 shadow-lg"
              >
                <Trash2 size={10} />
              </button>
              <div className="absolute bottom-0 left-0 bg-black/70 w-full text-center text-[7px] font-bold py-0.5 text-cyan-400 backdrop-blur-sm tracking-wider">
                S{idx + 1}
              </div>
            </div>
          ))}

          {customImages.length < RENDER_CONFIG.MAX_CUSTOM_SCENE_IMAGES && (
            <label
              className="w-14 h-14 rounded-lg border-2 border-dashed border-cyan-500/50 hover:border-cyan-400 hover:bg-cyan-500/10 flex flex-col items-center justify-center cursor-pointer transition text-cyan-400"
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={e => handleDrop(e, 'custom')}
            >
              <UploadCloud size={16} className="mb-0.5 opacity-80" />
              <span className="text-[7px] font-bold uppercase tracking-wider opacity-80">Ekle</span>
              <input
                ref={customInputRef}
                type="file"
                multiple
                accept="image/*"
                className="hidden"
                onChange={handleCustomImageSelect}
              />
            </label>
          )}

          {customImages.length === 0 && (
            <span className="text-[8px] text-cyan-500/70 font-bold uppercase tracking-wider self-center ml-1 hidden md:inline">
              ← Buraya sürükleyin
            </span>
          )}
        </div>
      </div>

      {/* MEDYA YÜKLE */}
      <div
        className="bg-black/30 border border-slate-800 rounded-xl p-2.5 shadow-lg transition-colors"
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={e => handleDrop(e, 'media')}
      >
        <h2 className="text-[10px] font-black text-indigo-400 mb-1 flex items-center gap-1.5">
          <UploadCloud size={12} /> MEDYA YÜKLE
        </h2>
        <div className="flex flex-wrap gap-2">
          {files.slice(0, 5).map((file, idx) => (
            <div key={idx} className="relative w-14 h-14 rounded-lg overflow-hidden border border-slate-700 shadow-md group">
              {file.type.startsWith('image/') ? (
                <img src={file.data} className="w-full h-full object-cover" alt={`Medya ${idx}`} />
              ) : (
                <div className="w-full h-full flex items-center justify-center text-[7px] font-bold text-indigo-400 bg-slate-900">
                  {file.name.split('.').pop()?.toUpperCase()}
                </div>
              )}
              <button
                onClick={() => removeFile(idx)}
                className="absolute top-0.5 right-0.5 bg-rose-500/80 group-hover:opacity-100 hover:bg-rose-500 text-white p-0.5 rounded transition opacity-0 shadow-lg"
              >
                <Trash2 size={10} />
              </button>
              <div className="absolute bottom-0 left-0 bg-black/70 w-full text-center text-[7px] font-bold py-0.5 text-indigo-400 backdrop-blur-sm tracking-wider">
                M{idx + 1}
              </div>
            </div>
          ))}

          <label
            className="w-14 h-14 rounded-lg border-2 border-dashed border-indigo-500/50 hover:border-indigo-400 hover:bg-indigo-500/10 flex flex-col items-center justify-center cursor-pointer transition text-indigo-400"
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={e => handleDrop(e, 'media')}
          >
            <UploadCloud size={16} className="mb-0.5 opacity-80" />
            <span className="text-[7px] font-bold uppercase tracking-wider opacity-80">Ekle</span>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept="*/*"
              className="hidden"
              onChange={handleFileSelect}
            />
          </label>

          {files.length > 5 && (
            <div className="w-14 h-14 rounded-lg bg-slate-800/50 flex items-center justify-center text-[9px] text-slate-400 font-bold border border-slate-700">
              +{files.length - 5}
            </div>
          )}

          {files.length === 0 && (
            <span className="text-[8px] text-indigo-500/70 font-bold uppercase tracking-wider self-center ml-1 hidden md:inline">
              ← Buraya sürükleyin
            </span>
          )}
        </div>

        {files.length > 0 && (
          <div className="mt-2 text-[9px] text-slate-500">
            Toplam: {files.length} dosya • {formatSize(files.reduce((a, b) => a + b.size, 0))}
          </div>
        )}
      </div>
    </div>
  );
}