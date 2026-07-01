import express from 'express';
import 'dotenv/config';
import { keysRouter } from './routes/keys.js';
import { usageRouter } from './routes/usage.js';
import { exampleRouter } from './routes/example.js';

const app = express();
app.use(express.json());

// --- Dashboard endpoints: your users manage their own keys and see usage. ---
// Auth here is the placeholder `x-user-email` header -- swap in real session/JWT auth.
app.use('/dashboard/keys', keysRouter);
app.use('/dashboard/usage', usageRouter);

// --- Public API: consumers call these using their API key. ---
app.use('/v1', exampleRouter);

app.get('/health', (req, res) => res.json({ status: 'ok' }));

app.use((req, res) => res.status(404).json({ error: 'not_found' }));

// Central error handler, so a thrown error anywhere doesn't crash the process.
app.use((err, req, res, next) => {
  console.error('[unhandled]', err);
  res.status(500).json({ error: 'internal_error' });
});

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`API key system listening on http://localhost:${port}`);
});
