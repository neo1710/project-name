import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { chat } from './dto/chatDto';
import { ragStore } from './dto/ragDto';
import { chatAgents } from './agents/agents';

@Injectable()
export class SonarModelChat {
  private readonly logger = new Logger(SonarModelChat.name);
  private readonly sonarUrl = "https://api.mistral.ai/v1/chat/completions";

  constructor(private agents: chatAgents, private configService: ConfigService) { }

  // ✅ NON-STREAMING CHAT
  async chat(body: chat) {
    const apiKey = this.configService.get<string>('MYSTRAL_API_KEY');
    if (!apiKey) {
      throw new Error('MYSTRAL_API_KEY is missing');
    }

    const systemPrompt = `
You are an expert researcher who thinks about the user question and gives the best answer possible.

Instructions:
1. Always be polite and ask if the answer is understandable.
2. Use bullet points.
3. Treat the user as a beginner unless stated otherwise.
4. Return a structured response and add a relevant quote if possible.
`;

    const requestBody = {
      model: body.model || 'sonar',
      messages: [
        { role: 'system', content: systemPrompt },
        ...body.messages,
      ],
      stream: false,
    };

    const response = await fetch(this.sonarUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`HTTP ${response.status}: ${err}`);
    }

    return response.json();
  }

  // ✅ STREAMING CHAT (SSE)
  async chatStream(body: chat, res: any) {
    const apiKey = this.configService.get<string>('MYSTRAL_API_KEY');
    if (!apiKey) {
      throw new Error('MYSTRAL_API_KEY is missing');
    }

    const bodyAgent = body.agent ? true : false;
    let agentPrompt = '';
    let userQuery = body.messages[body.messages.length - 1].content;
    if (bodyAgent && body.agent === 'ragAgent') {
      this.logger.log(`Using RAG agent: ${body.agent}`);
      const ragResult = await this.agents.ragAgent(body.messages[body.messages.length - 1].content, body.messages);
      agentPrompt = ragResult.prompt;
      userQuery = ragResult.ragQueryWithContext;
      body.messages[body.messages.length - 1].content = userQuery;
    } else if (bodyAgent) {
      this.logger.log(`Using agent: ${body.agent}`);
      agentPrompt = await this.agents[`${body.agent}`]();
    }

    const systemPrompt = `You are an expert researcher.

For all questions, respond in JSON format:
{
  "reasoning": "Your step-by-step thought process",
  "answer": "Clear, structured answer",
  "confidence": "high|medium|low",
}`;

    const requestBody = {
      model: body.model || 'sonar',
      messages: [
        { role: 'system', content: bodyAgent ? agentPrompt : systemPrompt },
        ...body.messages,
      ],
      stream: true,
    };

    const response = await fetch(this.sonarUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok || !response.body) {
      const err = await response.text();
      throw new Error(`HTTP ${response.status}: ${err}`);
    }

    // 🔥 REQUIRED FOR STREAMING
    res.set({
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });

    this.logger.log('Streaming response started');

    // Pipe Perplexity stream directly to client
    const reader = response.body.getReader();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        res.write(value);
      }
    } finally {
      reader.releaseLock();
      res.end();
    }
  }

  async ragStore(body: ragStore) {
    this.logger.log('RAG Store function executed', JSON.stringify(body));
    const embeddingApi = this.configService.get<string>('EMBEDDING_API') || 'http://localhost:8001';

    const maxRetries = 3;
    const timeoutMs = 10000; // 10s per request

    // Build a safe payload that the embedding service expects (fallback to { doc })
    let payload: any;
    try {
      const anyBody: any = body as any;
      if (anyBody && anyBody.doc) payload = anyBody;
      else if (anyBody && anyBody.text) payload = { doc: anyBody.text };
      else if (typeof anyBody === 'string') payload = { doc: anyBody };
      else payload = { doc: anyBody };
    } catch (e) {
      payload = { doc: JSON.stringify(body) };
    }

    const url = `${embeddingApi.replace(/\/$/, '')}/store`;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const response = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
          signal: controller.signal,
        });
        clearTimeout(timeout as any);

        const text = await response.text();
        if (!response.ok) {
          this.logger.error(`ragStore failed attempt ${attempt}: ${response.status} ${response.statusText} - ${text}`);
          if (attempt < maxRetries) {
            await new Promise((r) => setTimeout(r, 500 * attempt));
            continue;
          }
          return { ok: false, status: response.status, error: text };
        }

        try {
          const json = JSON.parse(text);
          return { ok: true, data: json };
        } catch {
          return { ok: true, data: text };
        }
      } catch (err: any) {
        clearTimeout(timeout as any);
        const isAbort = err && err.name === 'AbortError';
        this.logger.error(`ragStore exception attempt ${attempt}: ${isAbort ? 'timeout' : err}`, err);
        if (attempt < maxRetries) {
          await new Promise((r) => setTimeout(r, 500 * attempt));
          continue;
        }
        return { ok: false, error: isAbort ? 'timeout' : 'exception', details: err };
      }
    }
    return { ok: false, error: 'unreachable' };

  }
}
