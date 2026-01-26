import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { chat } from './dto/chatDto';
import { ragStore } from './dto/ragDto';
import { chatAgents } from './agents/agents';

@Injectable()
export class SonarModelChat {
  private readonly logger = new Logger(SonarModelChat.name);
  private readonly sonarUrl = 'https://api.perplexity.ai/chat/completions';

  constructor(private agents: chatAgents, private configService: ConfigService) { }

  // ✅ NON-STREAMING CHAT
  async chat(body: chat) {
    const apiKey = this.configService.get<string>('SONAR_API_KEY');
    if (!apiKey) {
      throw new Error('SONAR_API_KEY is missing');
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
    const apiKey = this.configService.get<string>('SONAR_API_KEY');
    if (!apiKey) {
      throw new Error('SONAR_API_KEY is missing');
    }

    const bodyAgent = body.agent ? true : false;
    let agentPrompt = '';
    if (bodyAgent && body.agent === 'ragAgent') {
      this.logger.log(`Using RAG agent: ${body.agent}`);
      this.logger.log(body, body.messages[body.messages.length - 1].content);
      agentPrompt = await this.agents.ragAgent(body.messages[body.messages.length - 1].content);
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
    this.logger.log('RAG Store function executed');
    const embeddingApi = this.configService.get<string>('EMBEDDING_API') || 'http://localhost:8001';

    try {
      const response = await fetch(`${embeddingApi}/store`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      });
      if (!response.ok) {
        const err = await response.text();
        throw new Error(`HTTP ${response.status}: ${err}`);
      }
      return response.json();
    } catch (error) {
      return { error: 'Error storing RAG data', details: error };
    }

  }
}
