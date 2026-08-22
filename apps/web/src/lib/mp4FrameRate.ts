interface Mp4Box {
  type: string;
  start: number;
  dataStart: number;
  end: number;
}

function boxType(view: DataView, offset: number) {
  return String.fromCharCode(
    view.getUint8(offset),
    view.getUint8(offset + 1),
    view.getUint8(offset + 2),
    view.getUint8(offset + 3),
  );
}

function readBoxes(view: DataView, start: number, end: number) {
  const boxes: Mp4Box[] = [];
  let offset = start;
  while (offset + 8 <= end) {
    const size32 = view.getUint32(offset);
    const type = boxType(view, offset + 4);
    let headerSize = 8;
    let size = size32;
    if (size32 === 1) {
      if (offset + 16 > end) break;
      const large = view.getBigUint64(offset + 8);
      if (large > BigInt(Number.MAX_SAFE_INTEGER)) break;
      size = Number(large);
      headerSize = 16;
    } else if (size32 === 0) {
      size = end - offset;
    }
    if (size < headerSize || offset + size > end) break;
    boxes.push({ type, start: offset, dataStart: offset + headerSize, end: offset + size });
    offset += size;
  }
  return boxes;
}

function child(view: DataView, parent: Mp4Box, type: string) {
  return readBoxes(view, parent.dataStart, parent.end).find(box => box.type === type);
}

function children(view: DataView, parent: Mp4Box, type: string) {
  return readBoxes(view, parent.dataStart, parent.end).filter(box => box.type === type);
}

function fullBoxFlags(view: DataView, box: Mp4Box) {
  if (box.dataStart + 4 > box.end) return 0;
  return view.getUint8(box.dataStart + 1) << 16
    | view.getUint8(box.dataStart + 2) << 8
    | view.getUint8(box.dataStart + 3);
}

function readVideoHandler(view: DataView, mdia: Mp4Box) {
  const hdlr = child(view, mdia, 'hdlr');
  return hdlr && hdlr.dataStart + 12 <= hdlr.end
    ? boxType(view, hdlr.dataStart + 8)
    : '';
}

function readTimescale(view: DataView, mdia: Mp4Box) {
  const mdhd = child(view, mdia, 'mdhd');
  if (!mdhd || mdhd.dataStart + 20 > mdhd.end) return 0;
  const version = view.getUint8(mdhd.dataStart);
  const offset = version === 1 ? mdhd.dataStart + 20 : mdhd.dataStart + 12;
  return offset + 4 <= mdhd.end ? view.getUint32(offset) : 0;
}

function readTrackId(view: DataView, trak: Mp4Box) {
  const tkhd = child(view, trak, 'tkhd');
  if (!tkhd) return 0;
  const version = view.getUint8(tkhd.dataStart);
  const offset = version === 1 ? tkhd.dataStart + 20 : tkhd.dataStart + 12;
  return offset + 4 <= tkhd.end ? view.getUint32(offset) : 0;
}

function readTrexDefaultDuration(view: DataView, moov: Mp4Box, trackId: number) {
  const mvex = child(view, moov, 'mvex');
  if (!mvex) return 0;
  for (const trex of children(view, mvex, 'trex')) {
    if (trex.dataStart + 20 > trex.end || view.getUint32(trex.dataStart + 4) !== trackId) continue;
    return view.getUint32(trex.dataStart + 12);
  }
  return 0;
}

function readTiming(view: DataView, mdia: Mp4Box) {
  const minf = child(view, mdia, 'minf');
  const stbl = minf && child(view, minf, 'stbl');
  const stts = stbl && child(view, stbl, 'stts');
  if (!stts || stts.dataStart + 8 > stts.end) return null;
  const entryCount = view.getUint32(stts.dataStart + 4);
  let sampleCount = 0;
  let mediaTicks = 0;
  let offset = stts.dataStart + 8;
  for (let index = 0; index < entryCount && offset + 8 <= stts.end; index += 1, offset += 8) {
    const count = view.getUint32(offset);
    const delta = view.getUint32(offset + 4);
    sampleCount += count;
    mediaTicks += count * delta;
  }
  return sampleCount > 0 && mediaTicks > 0 ? { sampleCount, mediaTicks } : null;
}

function readTfhd(view: DataView, traf: Mp4Box) {
  const tfhd = child(view, traf, 'tfhd');
  if (!tfhd || tfhd.dataStart + 8 > tfhd.end) return null;
  const flags = fullBoxFlags(view, tfhd);
  const trackId = view.getUint32(tfhd.dataStart + 4);
  let offset = tfhd.dataStart + 8;
  if (flags & 0x000001) offset += 8;
  if (flags & 0x000002) offset += 4;
  let defaultSampleDuration = 0;
  if (flags & 0x000008) {
    if (offset + 4 > tfhd.end) return null;
    defaultSampleDuration = view.getUint32(offset);
  }
  return { trackId, defaultSampleDuration };
}

function readFragmentedTiming(
  view: DataView,
  trackId: number,
  trexDefaultDuration: number,
) {
  let sampleCount = 0;
  let mediaTicks = 0;
  for (const moof of readBoxes(view, 0, view.byteLength).filter(box => box.type === 'moof')) {
    for (const traf of children(view, moof, 'traf')) {
      const tfhd = readTfhd(view, traf);
      if (!tfhd || tfhd.trackId !== trackId) continue;
      const defaultDuration = tfhd.defaultSampleDuration || trexDefaultDuration;
      for (const trun of children(view, traf, 'trun')) {
        if (trun.dataStart + 8 > trun.end) continue;
        const flags = fullBoxFlags(view, trun);
        const count = view.getUint32(trun.dataStart + 4);
        sampleCount += count;
        let offset = trun.dataStart + 8;
        if (flags & 0x000001) offset += 4;
        if (flags & 0x000004) offset += 4;
        if (flags & 0x000100) {
          for (let index = 0; index < count && offset + 4 <= trun.end; index += 1) {
            mediaTicks += view.getUint32(offset);
            offset += 4;
            if (flags & 0x000200) offset += 4;
            if (flags & 0x000400) offset += 4;
            if (flags & 0x000800) offset += 4;
          }
        } else {
          mediaTicks += count * defaultDuration;
        }
      }
    }
  }
  return sampleCount > 0 && mediaTicks > 0 ? { sampleCount, mediaTicks } : null;
}

export function readMp4AverageFrameRate(buffer: ArrayBuffer) {
  const view = new DataView(buffer);
  const moov = readBoxes(view, 0, view.byteLength).find(box => box.type === 'moov');
  if (!moov) return null;
  for (const trak of readBoxes(view, moov.dataStart, moov.end).filter(box => box.type === 'trak')) {
    const mdia = child(view, trak, 'mdia');
    if (!mdia || readVideoHandler(view, mdia) !== 'vide') continue;
    const timescale = readTimescale(view, mdia);
    const trackId = readTrackId(view, trak);
    const timing = readTiming(view, mdia)
      || readFragmentedTiming(view, trackId, readTrexDefaultDuration(view, moov, trackId));
    if (!timescale || !timing) return null;
    return timing.sampleCount * timescale / timing.mediaTicks;
  }
  return null;
}

export function isInstagramCompatibleFrameRate(frameRate: number | null) {
  return frameRate !== null && Number.isFinite(frameRate) && frameRate >= 23 && frameRate <= 60;
}
