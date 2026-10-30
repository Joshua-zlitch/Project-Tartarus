import express from 'express';
import { createServer as createViteServer } from 'vite';
import path from 'path';
import { GoogleGenAI, Type } from '@google/genai';

const ZEUS_SYSTEM_INSTRUCTION =
  'You are Zeus. Analyze the task and return a strict JSON array of required agents based on these roles: hephaestus (database/backend), helios (frontend), hades (systems/security), poseidon (API/network), athena (conversational/chat). If the user\'s prompt is conversational, general knowledge, a greeting, or non-technical (not related to databases, frontends, or networking), you must output ["athena"] in your strict JSON array.';

const VALID_ROLES = new Set([
  'hephaestus',
  'helios',
  'hades',
  'poseidon',
  'athena',
]);

let sharedAiClient: GoogleGenAI | null = null;
function getAiClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY is not configured in environment.');
  }
  if (!sharedAiClient) {
    sharedAiClient = new GoogleGenAI({
      apiKey,
      httpOptions: { headers: { 'User-Agent': 'aistudio-build' } },
    });
  }
  return sharedAiClient;
}

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());

  // Ultra-fast server-side Gemini endpoint using gemini-3.1-flash-lite (minimal thinking overhead)
  app.post('/api/zeus-orchestrate', async (req, res) => {
    const prompt = String(req.body?.prompt || '').trim();
    if (!prompt) {
      res.status(400).json({ error: 'Task prompt is required.' });
      return;
    }

    try {
      const ai = getAiClient();

      const response = await ai.models.generateContent({
        model: 'gemini-3.1-flash-lite',
        contents: prompt,
        config: {
          systemInstruction: ZEUS_SYSTEM_INSTRUCTION,
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.ARRAY,
            items: {
              type: Type.STRING,
            },
          },
        },
      });

      const rawText = (response.text || '[]').trim();
      const parsed = JSON.parse(rawText);
      const agents: string[] = [];

      if (Array.isArray(parsed)) {
        for (const item of parsed) {
          const normalized = String(item)
            .trim()
            .toLowerCase()
            .replace(/^agent-/, '');
          if (VALID_ROLES.has(normalized) && !agents.includes(normalized)) {
            agents.push(normalized);
          }
        }
      }

      res.json({
        agents: agents.length > 0 ? agents : ['athena'],
      });
    } catch (error) {
      console.error('[Zeus Orchestrator API Error]:', error);
      res.status(500).json({
        error:
          error instanceof Error ? error.message : 'Failed to analyze task.',
      });
    }
  });

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*all', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Project Tartarus server running on http://localhost:${PORT}`);
  });
}

startServer();
