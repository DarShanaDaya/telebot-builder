// Small in-process guard for abuse-prone endpoints. It intentionally does not
// claim to be a distributed rate limiter; production multi-instance deployments
// should enforce equivalent limits at the gateway/edge as well.
export function rateLimit({ windowMs, max, key = (req) => req.ip || req.socket?.remoteAddress || 'unknown' }) {
  const buckets = new Map();
  return (req, res, next) => {
    const now = Date.now();
    const bucketKey = key(req);
    const existing = buckets.get(bucketKey);
    const bucket = !existing || now >= existing.resetAt
      ? { count: 0, resetAt: now + windowMs }
      : existing;
    bucket.count += 1;
    buckets.set(bucketKey, bucket);
    if (bucket.count > max) {
      res.setHeader('Retry-After', Math.max(1, Math.ceil((bucket.resetAt - now) / 1000)));
      return res.status(429).json({ error: 'Too many requests. Please try again later.' });
    }
    // Bound memory when many one-off IPs appear.
    if (buckets.size > 10000) {
      for (const [entryKey, entry] of buckets) if (now >= entry.resetAt) buckets.delete(entryKey);
    }
    next();
  };
}
