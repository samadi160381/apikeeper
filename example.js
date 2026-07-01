import { Router } from 'express';
import { apiKeyAuth } from '../middleware/apiKeyAuth.js';

export const exampleRouter = Router();

// This is the pattern for every real endpoint you expose to API consumers:
// protect it with apiKeyAuth() and declare the scopes it needs.
exampleRouter.get('/ping', apiKeyAuth(['read']), (req, res) => {
  res.json({
    message: 'pong',
    key_id: req.apiKey.id,
    plan: req.apiKey.planId,
    over_quota_billable: req.apiKey.overQuota,
  });
});

exampleRouter.post('/widgets', apiKeyAuth(['write']), (req, res) => {
  res.status(201).json({ message: 'widget created (demo)', owner_key: req.apiKey.id });
});
