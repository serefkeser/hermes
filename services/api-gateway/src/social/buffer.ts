const BUFFER_GRAPHQL_ENDPOINT = 'https://api.buffer.com';

export interface BufferChannel {
  id: string;
  name: string;
  service: string;
  isQueuePaused?: boolean;
  metadata?: {
    boards?: Array<{ serviceId: string; name: string }>;
  } | null;
}

export interface BufferPostResult {
  channelId: string;
  channelName: string;
  service: string;
  ok: boolean;
  postId?: string;
  dueAt?: string | null;
  status?: string;
  message?: string;
}

interface BufferGraphqlEnvelope<T> {
  data?: T;
  errors?: Array<{ message?: string }>;
}

type FetchLike = typeof fetch;

function bufferErrorMessage(payload: BufferGraphqlEnvelope<unknown> | null, status: number) {
  const message = payload?.errors?.map(error => error.message).filter(Boolean).join(' · ');
  if (message) return message;
  if (status === 401 || status === 403) return 'Buffer API anahtarı geçersiz veya yetkisiz.';
  return `Buffer API yanıt vermedi (HTTP ${status}).`;
}

async function bufferGraphql<T>(
  apiKey: string,
  query: string,
  variables: Record<string, unknown> = {},
  fetchImpl: FetchLike = fetch,
): Promise<T> {
  const response = await fetchImpl(BUFFER_GRAPHQL_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({ query, variables }),
  });
  const payload = await response.json().catch(() => null) as BufferGraphqlEnvelope<T> | null;
  if (!response.ok || !payload?.data || payload.errors?.length) {
    throw new Error(bufferErrorMessage(payload, response.status));
  }
  return payload.data;
}

export async function getBufferChannels(apiKey: string, fetchImpl: FetchLike = fetch) {
  const organizations = await bufferGraphql<{
    account: { organizations: Array<{ id: string; name: string }> };
  }>(apiKey, `
    query GetOrganizations {
      account { organizations { id name } }
    }
  `, {}, fetchImpl);

  const channels: BufferChannel[] = [];
  for (const organization of organizations.account.organizations || []) {
    const response = await bufferGraphql<{ channels: BufferChannel[] }>(apiKey, `
      query GetChannels($organizationId: OrganizationId!) {
        channels(input: { organizationId: $organizationId }) {
          id
          name
          service
          isQueuePaused
          metadata {
            ... on PinterestMetadata {
              boards { serviceId name }
            }
          }
        }
      }
    `, { organizationId: organization.id }, fetchImpl);
    channels.push(...(response.channels || []));
  }

  return channels.filter((channel, index, all) => (
    channel.id && all.findIndex(candidate => candidate.id === channel.id) === index
  ));
}

function splitCaption(caption: string) {
  const normalized = caption.replace(/\r\n/g, '\n').replace(/[ \t]+/g, ' ').trim();
  const lines = normalized.split('\n');
  const hashtagIndex = lines.findIndex(line => /^\s*#/.test(line));
  return {
    body: (hashtagIndex >= 0 ? lines.slice(0, hashtagIndex) : lines).join('\n').trim(),
    hashtags: (hashtagIndex >= 0 ? lines.slice(hashtagIndex) : []).join(' ').replace(/\s+/g, ' ').trim(),
  };
}

export function fitCaptionForService(caption: string, service: string) {
  const limits: Record<string, number> = {
    // Buffer/X, bağlantı ve medya işleme sırasında ilave ağırlık uygulayabildiği için
    // resmi 280 sınırının altında güvenli pay bırakılır.
    twitter: 240,
    bluesky: 300,
    mastodon: 500,
    threads: 500,
    pinterest: 500,
    instagram: 2_200,
    tiktok: 2_200,
    linkedin: 3_000,
    youtube: 5_000,
  };
  const limit = limits[service] || 2_000;
  return fitCaptionToLimit(caption, limit);
}

function codePointLength(value: string) {
  return Array.from(value).length;
}

function sliceCodePoints(value: string, limit: number) {
  return Array.from(value).slice(0, Math.max(0, limit)).join('');
}

function fitCaptionToLimit(caption: string, limit: number) {
  const normalized = caption.trim();
  if (codePointLength(normalized) <= limit) return normalized;

  const { body, hashtags } = splitCaption(normalized);
  const suffix = hashtags && codePointLength(hashtags) < limit - 20 ? `\n\n${hashtags}` : '';
  const bodyLimit = Math.max(1, limit - codePointLength(suffix) - 1);
  return sliceCodePoints(`${sliceCodePoints(body, bodyLimit).trimEnd()}…${suffix}`, limit);
}

function twitterRetryCaption(caption: string) {
  const { body, hashtags } = splitCaption(caption);
  const firstLine = body.split(/\n+/).map(line => line.trim()).find(Boolean) || 'OTONOM gündem özeti';
  const safeTags = hashtags.split(/\s+/).filter(tag => tag.startsWith('#')).slice(0, 2).join(' ');
  return fitCaptionToLimit([firstLine, safeTags || '#OTONOM'].filter(Boolean).join('\n\n'), 180);
}

function titleFromCaption(caption: string) {
  const firstLine = caption.split(/\n+/).map(line => line.trim()).find(Boolean) || 'OTONOM gündem özeti';
  return firstLine.slice(0, 100);
}

export function buildBufferPostInput(options: {
  channel: BufferChannel;
  caption: string;
  mediaUrl: string;
  mediaType: 'video' | 'image';
  shareMode?: 'addToQueue' | 'shareNow';
  youtubeCategoryId?: string;
}) {
  const { channel, mediaUrl, mediaType } = options;
  const title = titleFromCaption(options.caption);
  const input: Record<string, unknown> = {
    text: fitCaptionForService(options.caption, channel.service),
    channelId: channel.id,
    schedulingType: 'automatic',
    mode: options.shareMode || 'addToQueue',
    aiAssisted: true,
    needsApproval: false,
    source: 'otonom',
    assets: mediaType === 'video'
      ? [{ video: { url: mediaUrl, metadata: { thumbnailOffset: 2_000, title } } }]
      : [{ image: { url: mediaUrl, metadata: { altText: title } } }],
  };

  if (mediaType === 'video' && channel.service === 'instagram') {
    input.metadata = { instagram: { type: 'reel', shouldShareToFeed: true, isAiGenerated: true } };
  } else if (mediaType === 'video' && channel.service === 'facebook') {
    input.metadata = { facebook: { type: 'reel' } };
  } else if (channel.service === 'tiktok') {
    input.metadata = { tiktok: { isAiGenerated: true } };
  } else if (channel.service === 'twitter') {
    input.metadata = { twitter: { isAiGenerated: true } };
  } else if (mediaType === 'video' && channel.service === 'youtube') {
    input.metadata = {
      youtube: {
        title,
        categoryId: options.youtubeCategoryId || '25',
        type: 'short',
        privacy: 'public',
        madeForKids: false,
        notifySubscribers: true,
        embeddable: true,
        isAiGenerated: true,
      },
    };
  } else if (channel.service === 'pinterest') {
    const boardServiceId = channel.metadata?.boards?.[0]?.serviceId;
    if (!boardServiceId) throw new Error('Pinterest kanalı için kullanılabilir pano bulunamadı.');
    input.metadata = { pinterest: { boardServiceId, title } };
  }

  return input;
}

export async function createBufferPost(options: {
  apiKey: string;
  channel: BufferChannel;
  caption: string;
  mediaUrl: string;
  mediaType: 'video' | 'image';
  shareMode?: 'addToQueue' | 'shareNow';
  youtubeCategoryId?: string;
  fetchImpl?: FetchLike;
}): Promise<BufferPostResult> {
  const { channel } = options;
  try {
    const submit = (input: Record<string, unknown>) => bufferGraphql<{
      createPost: {
        __typename?: string;
        message?: string;
        post?: { id: string; dueAt?: string | null; status?: string };
      };
    }>(options.apiKey, `
      mutation CreateOtonomPost($input: CreatePostInput!) {
        createPost(input: $input) {
          __typename
          ... on PostActionSuccess {
            post { id dueAt status }
          }
          ... on MutationError { message }
        }
      }
    `, { input }, options.fetchImpl || fetch);

    let input = buildBufferPostInput(options);
    let response = await submit(input);
    let result = response.createPost;
    if (!result?.post?.id
      && channel.service === 'twitter'
      && /280|cannot exceed|too long|karakter/i.test(result?.message || '')) {
      input = { ...input, text: twitterRetryCaption(options.caption) };
      response = await submit(input);
      result = response.createPost;
    }
    if (!result?.post?.id) {
      throw new Error(result?.message || 'Buffer gönderiyi kabul etmedi.');
    }
    return {
      channelId: channel.id,
      channelName: channel.name,
      service: channel.service,
      ok: true,
      postId: result.post.id,
      dueAt: result.post.dueAt,
      status: result.post.status || 'scheduled',
    };
  } catch (error) {
    return {
      channelId: channel.id,
      channelName: channel.name,
      service: channel.service,
      ok: false,
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function publishToBufferChannels(options: {
  apiKey: string;
  channels: BufferChannel[];
  caption: string;
  mediaUrl: string;
  mediaType: 'video' | 'image';
  shareMode?: 'addToQueue' | 'shareNow';
  youtubeCategoryId?: string;
  fetchImpl?: FetchLike;
}) {
  const results: BufferPostResult[] = [];
  for (const channel of options.channels) {
    results.push(await createBufferPost({ ...options, channel }));
  }
  return results;
}
