// Queue utilities

export interface QueueConsumerOptions {
  batchSize?: number;
  maxConcurrency?: number;
  retryDelayMs?: number;
  deadLetterQueue?: string;
}

export interface QueuedJob<T = unknown> {
  id: string;
  type: string;
  payload: T;
  timestamp: number;
  retries: number;
  maxRetries: number;
  priority?: 'low' | 'normal' | 'high';
}

export class QueueConsumer<T = unknown> {
  private queue: QueuedJob<T>[] = [];
  private processing = false;
  private options: Required<QueueConsumerOptions>;

  constructor(
    private handler: (job: QueuedJob<T>) => Promise<void>,
    options: QueueConsumerOptions = {}
  ) {
    this.options = {
      batchSize: options.batchSize ?? 10,
      maxConcurrency: options.maxConcurrency ?? 1,
      retryDelayMs: options.retryDelayMs ?? 5000,
      deadLetterQueue: options.deadLetterQueue ?? 'dead-letter',
    };
  }

  enqueue(job: Omit<QueuedJob<T>, 'id' | 'timestamp' | 'retries'>): string {
    const id = `q_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const queuedJob: QueuedJob<T> = {
      ...job,
      id,
      timestamp: Date.now(),
      retries: 0,
    };
    this.queue.push(queuedJob);
    this.queue.sort((a, b) => {
      const priorityOrder = { high: 0, normal: 1, low: 2 };
      const pDiff = priorityOrder[a.priority || 'normal'] - priorityOrder[b.priority || 'normal'];
      if (pDiff !== 0) return pDiff;
      return a.timestamp - b.timestamp;
    });
    this.process();
    return id;
  }

  private async process(): Promise<void> {
    if (this.processing || this.queue.length === 0) return;
    this.processing = true;

    while (this.queue.length > 0) {
      const batch = this.queue.splice(0, this.options.batchSize);
      await Promise.all(
        batch.map(async (job) => {
          try {
            await this.handler(job);
          } catch (error) {
            job.retries++;
            if (job.retries < job.maxRetries) {
              // Re-queue with delay
              setTimeout(() => this.queue.unshift(job), this.options.retryDelayMs);
            } else {
              // Move to dead letter queue
              console.error(`[QUEUE] Job ${job.id} moved to DLQ after ${job.maxRetries} retries:`, error);
            }
          }
        })
      );
    }

    this.processing = false;
  }

  getStats(): { pending: number; processing: boolean } {
    return { pending: this.queue.length, processing: this.processing };
  }

  clear(): void {
    this.queue = [];
  }
}

// Cloudflare Queues integration helper
export interface CloudflareQueueMessage<T = unknown> {
  id: string;
  body: T;
  timestamp: number;
  retries: number;
}

export function createQueueMessage<T>(body: T, options?: { retries?: number; delayMs?: number }): CloudflareQueueMessage<T> {
  return {
    id: `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
    body,
    timestamp: Date.now(),
    retries: options?.retries ?? 0,
  };
}

export function parseQueueMessage<T>(message: unknown): CloudflareQueueMessage<T> | null {
  if (!message || typeof message !== 'object') return null;
  const msg = message as Record<string, unknown>;
  if (!msg.id || !msg.body || typeof msg.timestamp !== 'number') return null;
  return msg as unknown as CloudflareQueueMessage<T>;
}

// ============================================================================
// EXPORTS
// ============================================================================

export * from './retry';
