class TransmissionLimiter {
  private active = 0;
  private maxConcurrent = 1;
  private readonly waiters: Array<() => void> = [];

  setMax(maxConcurrent: number) {
    this.maxConcurrent = Math.max(1, Math.floor(maxConcurrent));
    this.drain();
  }

  async run<T>(fn: () => Promise<T>): Promise<T> {
    await this.acquire();
    try {
      return await fn();
    } finally {
      this.active -= 1;
      this.drain();
    }
  }

  private acquire() {
    if (this.active < this.maxConcurrent) {
      this.active += 1;
      return Promise.resolve();
    }

    return new Promise<void>((resolve) => {
      this.waiters.push(() => {
        this.active += 1;
        resolve();
      });
    });
  }

  private drain() {
    while (this.active < this.maxConcurrent && this.waiters.length > 0) {
      this.waiters.shift()?.();
    }
  }
}

const globalLimiter = globalThis as typeof globalThis & {
  __telegramDownloadTransmissionLimiter?: TransmissionLimiter;
};

export const transmissionLimiter =
  globalLimiter.__telegramDownloadTransmissionLimiter ??
  (globalLimiter.__telegramDownloadTransmissionLimiter = new TransmissionLimiter());
