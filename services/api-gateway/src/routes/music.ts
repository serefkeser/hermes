import { Hono } from 'hono';

const DRIVE_FOLDER_ID = '19bbiNUvhdq5FyCdPYDsfVEN7RpFajJMY';

const NEWS_MUSIC = [
  ['1kdgUgmlRaed9AkdSYLweQo6SdFfC8fBu', 'breaking-news-intro-background-music-408079.mp3'],
  ['1CnKlT1Fa7aqLsltxGA2MRFVgoOWpBYd9', 'the-headline-news-256136.mp3'],
  ['19utdLJ7Y-0ixLYwpnScSHqs6Xyar6Dse', 'epic-news-breaking-news-loop-405851.mp3'],
  ['1kSNJERW_-QuGTWsGW-2utaswE4WfY6Mt', 'breaking-news-intro-background-music-368192.mp3'],
  ['1W0VYqxpUQzqCjb8nrcn1oEmDAuEUf7lH', 'great-news-epic-optimistic-orchestral-421013.mp3'],
  ['1Ngakfb5um-rOGYxHYU6KEHp4mY4k2OzJ', 'epic-news-60-seconds-breaking-news-412683.mp3'],
  ['1YHrtO1wI5Vd91Au0WYLJWoHXULz97wp7', 'news-intro-344332.mp3'],
  ['1956OBUDOf7oW7xqyYW6KhwAqHuEgntrn', 'news-intro-background-music-423124.mp3'],
  ['1vRIzca_zUUVuT-1VRrEwAfEEd8XWujKX', 'suspended-news-256135.mp3'],
  ['1J0rcpQeMlbwPBMO1B6OG6_TXZd7QTK-q', 'this-is-news-396456.mp3'],
  ['1cxC2rPv9CKSdk7X3t9F2RH21ldKg4d-O', 'breaking-news-intro-logo-154189.mp3'],
  ['1eI2_7hbQfTDtc9zl6v65ksMOuPSvgkrC', 'super-news-393141.mp3'],
] as const;

export const musicRoutes = new Hono();

musicRoutes.get('/catalog', c => c.json({
  success: true,
  data: {
    folderId: DRIVE_FOLDER_ID,
    tracks: NEWS_MUSIC.map(([id, name]) => ({
      id,
      name,
      mimeType: 'audio/mpeg',
      url: `${new URL(c.req.url).origin}/music/${id}`,
    })),
  },
}));

musicRoutes.get('/:id', async c => {
  const id = c.req.param('id');
  const track = NEWS_MUSIC.find(([trackId]) => trackId === id);
  if (!track) return c.json({ success: false, error: { code: 'MUSIC_NOT_FOUND', message: 'Müzik bulunamadı.' } }, 404);

  const source = await fetch(`https://drive.usercontent.google.com/download?id=${encodeURIComponent(id)}&export=download&confirm=t`, {
    redirect: 'follow',
  });
  if (!source.ok || !source.body) {
    return c.json({
      success: false,
      error: { code: 'DRIVE_MUSIC_FETCH_FAILED', message: `Google Drive müziği alınamadı (HTTP ${source.status}).` },
    }, 502);
  }

  return new Response(source.body, {
    headers: {
      'Content-Type': 'audio/mpeg',
      'Content-Disposition': `inline; filename="${track[1].replace(/["\\]/g, '_')}"`,
      'Cache-Control': 'public, max-age=3600',
      'X-Content-Type-Options': 'nosniff',
    },
  });
});

export { DRIVE_FOLDER_ID, NEWS_MUSIC };
