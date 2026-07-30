import { createMcpExpressApp } from '@modelcontextprotocol/express';
import { NodeStreamableHTTPServerTransport } from '@modelcontextprotocol/node';
import { McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod/v4';

const PORT = Number(process.env.PORT ?? 3001);
const HOST = process.env.HOST ?? '127.0.0.1';

const server = new McpServer({
    name: 'Commerce Operations MCP',  
    version: '1.0.0',
});

server.registerTool(
  'investigate_order',
  {
    title: 'Investigate Order',
    description: 'Placeholder for order investigation.',
    inputSchema: z.object({}),
  },
  async () => ({
    content: [{ type: 'text', text: 'investigate_order is not implemented.' }],
  }),
);

const transport = new NodeStreamableHTTPServerTransport({
  sessionIdGenerator: undefined,
});

await server.connect(transport);

const app = createMcpExpressApp({ host: HOST });

app.all('/mcp', async (req, res) => {
  await transport.handleRequest(req, res, req.body);
});

const httpServer = app.listen(PORT, HOST, () => {
  console.log(`MCP server listening at http://${HOST}:${PORT}/mcp`);
});

process.on('SIGINT', async () => {
  httpServer.close();
  await transport.close();
  await server.close();
  process.exit(0);
});
