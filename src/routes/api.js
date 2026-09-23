const express = require('express');
const { rateLimiter } = require('../middleware/rateLimiter');

const router = express.Router();

// Apply rate limiter to all routes by default
router.use(rateLimiter({ maxRequests: 100, windowMs: 60000 }));

// Public endpoint - no rate limiting
router.get('/api/public', (req, res) => {
  res.json({ message: 'Public endpoint' });
});

// Protected endpoint - rate limited
router.get('/api/protected', (req, res) => {
  res.json({ message: 'Protected endpoint' });
});

// POST endpoint - rate limited
router.post('/api/protected', (req, res) => {
  res.status(201).json({ message: 'Created resource' });
});

// Health check - no rate limiting
router.get('/api/health', (req, res) => {
  res.json({ status: 'ok' });
});

module.exports = router;
