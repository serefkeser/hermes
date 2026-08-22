import { describe, expect, it } from 'vitest';
import { isInstagramCompatibleFrameRate, readMp4AverageFrameRate } from './mp4FrameRate';

function u32(value: number) {
  return [value >>> 24, value >>> 16 & 255, value >>> 8 & 255, value & 255];
}

function ascii(value: string) {
  return [...value].map(character => character.charCodeAt(0));
}

function box(type: string, payload: number[]) {
  return [...u32(payload.length + 8), ...ascii(type), ...payload];
}

function testMp4(sampleCount: number, sampleDelta: number, timescale: number) {
  const mdhd = box('mdhd', [0, 0, 0, 0, ...u32(0), ...u32(0), ...u32(timescale), ...u32(sampleCount * sampleDelta)]);
  const hdlr = box('hdlr', [0, 0, 0, 0, ...u32(0), ...ascii('vide'), ...u32(0), ...u32(0), ...u32(0)]);
  const stts = box('stts', [0, 0, 0, 0, ...u32(1), ...u32(sampleCount), ...u32(sampleDelta)]);
  const stbl = box('stbl', stts);
  const minf = box('minf', stbl);
  const mdia = box('mdia', [...mdhd, ...hdlr, ...minf]);
  const trak = box('trak', mdia);
  return new Uint8Array(box('moov', trak)).buffer;
}

function fragmentedTestMp4(sampleCount: number, sampleDelta: number, timescale: number) {
  const tkhd = box('tkhd', [0, 0, 0, 7, ...u32(0), ...u32(0), ...u32(1), ...u32(0)]);
  const mdhd = box('mdhd', [0, 0, 0, 0, ...u32(0), ...u32(0), ...u32(timescale), ...u32(0)]);
  const hdlr = box('hdlr', [0, 0, 0, 0, ...u32(0), ...ascii('vide'), ...u32(0), ...u32(0), ...u32(0)]);
  const stbl = box('stbl', box('stts', [0, 0, 0, 0, ...u32(0)]));
  const mdia = box('mdia', [...mdhd, ...hdlr, ...box('minf', stbl)]);
  const moov = box('moov', box('trak', [...tkhd, ...mdia]));
  const tfhd = box('tfhd', [0, 0, 0, 8, ...u32(1), ...u32(sampleDelta)]);
  const trun = box('trun', [0, 0, 0, 0, ...u32(sampleCount)]);
  const moof = box('moof', box('traf', [...tfhd, ...trun]));
  return new Uint8Array([...moov, ...moof]).buffer;
}

describe('MP4 frame-rate verification', () => {
  it('video track zaman tablosundan ortalama FPS değerini okur', () => {
    expect(readMp4AverageFrameRate(testMp4(300, 1000, 30_000))).toBe(30);
    expect(readMp4AverageFrameRate(testMp4(100, 3000, 30_000))).toBe(10);
  });

  it('Chrome MediaRecorder parçalı MP4 kare hızını moof/trun zamanlamasından okur', () => {
    expect(readMp4AverageFrameRate(fragmentedTestMp4(300, 1000, 30_000))).toBe(30);
    expect(readMp4AverageFrameRate(fragmentedTestMp4(100, 3000, 30_000))).toBe(10);
  });

  it('Instagram Reels için 23-60 FPS aralığını zorunlu tutar', () => {
    expect(isInstagramCompatibleFrameRate(30)).toBe(true);
    expect(isInstagramCompatibleFrameRate(10)).toBe(false);
    expect(isInstagramCompatibleFrameRate(null)).toBe(false);
  });
});
