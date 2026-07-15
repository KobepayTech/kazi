// Minimal in-memory rate limiter.
//
// Because the server pays for every Claude call (server-key model), a public
// deployment MUST cap usage or a single visitor can burn the operator's
// budget. This is a per-IP sliding-window limiter with no external deps.
//
// For a single instance this is enough. If you scale to multiple instances,
// move this to Redis / Upstash and key on the same window logic.

const buckets = new Map(); // ip -> number[] (timestamps, ms)

/**
 * @param {object} opts
 * @param {number} opts.windowMs   Length of the window in ms.
 * @param {number} opts.max        Max requests allowed per window.
 */
export function createRateLimiter({ windowMs, max }) {
  return function rateLimit(req, res, next) {
    const ip =
      (req.headers["x-forwarded-for"] || "").split(",")[0].trim() ||
      req.socket.remoteAddress ||
      "unknown";
    const now = Date.now();
    const hits = (buckets.get(ip) || []).filter((t) => now - t < windowMs);

    if (hits.length >= max) {
      const retryMs = windowMs - (now - hits[0]);
      res.setHeader("Retry-After", Math.ceil(retryMs / 1000));
      return res.status(429).json({
        error: "Rate limit reached",
        message: `Too many requests. Try again in about ${Math.ceil(
          retryMs / 1000,
        )} seconds.`,
      });
    }

    hits.push(now);
    buckets.set(ip, hits);
    next();
  };
}

// Opportunistic cleanup so the map does not grow unbounded.
setInterval(
  () => {
    const cutoff = Date.now() - 60 * 60 * 1000;
    for (const [ip, hits] of buckets) {
      const live = hits.filter((t) => t > cutoff);
      if (live.length === 0) buckets.delete(ip);
      else buckets.set(ip, live);
    }
  },
  10 * 60 * 1000,
).unref();
