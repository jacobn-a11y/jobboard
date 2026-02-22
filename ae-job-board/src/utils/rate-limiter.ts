import { logger } from "./logger.ts";

export class RateLimiter {
  private timestamps: number[] = [];
  private readonly maxRequests: number;
  private readonly windowMs: number;
  private readonly name: string;

  constructor(maxRequests: number, windowMs: number, name: string = "API") {
    this.maxRequests = maxRequests;
    this.windowMs = windowMs;
    this.name = name;
  }

  async acquire(): Promise<void> {
    while (true) {
      const now = Date.now();
      // Remove timestamps outside the window
      this.timestamps = this.timestamps.filter((t) => now - t < this.windowMs);

      if (this.timestamps.length < this.maxRequests) {
        this.timestamps.push(now);
        return;
      }

      const oldestInWindow = this.timestamps[0];
      const waitTime = this.windowMs - (now - oldestInWindow) + 100; // +100ms buffer
      logger.info(
        `${this.name} rate limit reached, waiting ${Math.ceil(waitTime / 1000)}s`
      );
      await new Promise((resolve) => setTimeout(resolve, waitTime));
    }
  }
}
