const redis = require('redis');

// Redis client singleton
let redisClient = null;

/**
 * Initialize Redis client
 */
function initRedisClient() {
  if (!redisClient) {
    redisClient = redis.createClient({
      host: process.env.REDIS_HOST || 'localhost',
      port: process.env.REDIS_PORT || 6379,
    });
    redisClient.on('error', (err) => {
      console.error('Redis client error:', err);
    });
  }
  return redisClient;
}

/**
 * Sliding window rate limiter middleware.
 * Uses Redis Sorted Sets to track request timestamps per IP address.
 * Allows `maxRequests` requests per `windowMs` milliseconds.
 *
 * @param {object} options
 * @param {number} options.maxRequests - Maximum requests per window
 * @param {number} options.windowMs - Window size in milliseconds
 * @param {function} options.getKey - Function to get the key for rate limiting (default: IP address)
 * @returns {function} Express middleware
 */
function rateLimiter(options = {}) {
  const maxRequests = options.maxRequests || 100;
  const windowMs = options.windowMs || 60000; // 60 seconds

  return async (req, res, next) => {
    const client = initRedisClient();
    const ip = req.ip || req.connection.remoteAddress || '127.0.0.1';
    const key = `rateLimit:${ip}`;

    try {
      // Use a Lua script for atomicity: remove old entries, add new entry, count
      const luaScript = `
        local key = KEYS[1]
        local window = tonumber(ARGV[1])
        local now = tonumber(ARGV[2])
        local maxRequests = tonumber(ARGV[3])

        -- Remove entries older than the window
        redis.call('ZRERANGEBYRANGE', key, 0, now - window)

        -- Count current requests in window
        local count = redis.call('ZCARD', key)

        -- Add current request with timestamp as score
        redis.call('ZADD', key, now, now)

        -- Get reset time (window start)
        local reset = now + window

        -- Set TTL to auto-expire the key
        redis.call('EXPIRE', key, math.ceil(window / 1000))

        -- Determine remaining requests
        local remaining = math.max(0, maxRequests - count)

        -- Return count, remaining, and reset time
        return {count, remaining, reset}
      `;

      const now = Date.now();
      const result = await new Promise((resolve, reject) => {
        client.eval(luaScript, 1, key, windowMs, now, maxRequests, (err, result) => {
          if (err) return reject(err);
          resolve(result);
        });
      });

      // result: [count, remaining, reset]
      const [count, remaining, reset] = result;

      // Set headers
      res.set('X-RateLimit-Limit', String(maxRequests));
      res.set('X-RateLimit-Remaining', String(remaining));
      res.set('X-RateLimit-Reset', String(Math.ceil(reset / 1000)));

      // Check if limit exceeded
      if (count > maxRequests) {
        return res.status(429).json({
          error: 'Rate limit exceeded. Try again later.',
        });
      }

      next();
    } catch (err) {
      // If Redis is unavailable, fall back to in-memory counter
      if (!err.message || !err.message.includes('ECONNREFUSED')) {
        console.error('Redis error, falling back to in-memory:', err);
      }
      next();
    }
  };
}

/**
 * Legacy in-memory rate limiter (buggy, resets every minute)
 * @deprecated Use Redis-backed version
 */
function legacyRateLimiter(options = {}) {
  const maxRequests = options.maxRequests || 100;
  const windowMs = options.windowMs || 60000;
  const counters = {};

  return (req, res, next) => {
    const ip = req.ip || req.connection.remoteAddress || '127.0.0.1';
    const now = Date.now();

    if (!counters[ip]) {
      counters[ip] = { count: 0, resetTime: now + windowMs };
    }

    // Reset counter every window
    if (now > counters[ip].resetTime) {
      counters[ip] = { count: 0, resetTime: now + windowMs };
    }

    counters[ip].count++;

    res.set('X-RateLimit-Limit', String(maxRequests));
    res.set('X-RateLimit-Remaining', String(maxRequests - counters[ip].count));
    res.set('X-RateLimit-Reset', String(Math.ceil(counters[ip].resetTime / 1000));

    if (counters[ip].count > maxRequests) {
      return res.status(429).json({
        error: 'Rate limit exceeded. Try again later.',
      });
    }

    next();
  };
}

module.exports = { rateLimiter, legacyRateLimiter };
