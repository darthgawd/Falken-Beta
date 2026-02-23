import express from 'express';
import cors from 'cors';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { server, TOOLS, handleToolCall } from 'mcp-server';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

const app = express();
app.use(cors());
app.use(express.json());

const transports: SSEServerTransport[] = [];

/**
 * Gateway Info
 */
app.get('/', (req, res) => {
  res.json({
    name: "BOTBYTE MCP Gateway",
    status: "active",
    endpoints: {
      sse: "/sse",
      rest: "/tools",
      health: "/health"
    },
    documentation: "https://github.com/your-repo/botbyte"
  });
});

/**
 * SSE Transport (Standard MCP)
 */
app.get('/sse', async (req, res) => {
  const transport = new SSEServerTransport('/message', res);
  transports.push(transport);
  await server.connect(transport);
  
  req.on('close', () => {
    const index = transports.indexOf(transport);
    if (index > -1) transports.splice(index, 1);
  });
});

app.post('/message', async (req, res) => {
  const transport = transports.find(t => t.sessionId === req.query.sessionId);
  if (transport) {
    await transport.handlePostMessage(req, res);
  } else {
    res.status(404).send('Session not found');
  }
});

/**
 * REST API (ChatGPT Actions Compatible)
 */

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// List available tools
app.get('/tools', async (req, res) => {
  res.json({ tools: TOOLS });
});

// Call a specific tool
app.post('/tools/:name', async (req, res) => {
  try {
    const result = await handleToolCall(req.params.name, req.body);
    res.json(result);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`🚀 BOTBYTE MCP Proxy active`);
  console.log(`   SSE (Standard): http://localhost:${PORT}/sse`);
  console.log(`   REST (ChatGPT): http://localhost:${PORT}/tools`);
});
