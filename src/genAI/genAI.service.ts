import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { chat } from './dto/chatDto';

@Injectable()
export class SonarModelChat {
  private readonly logger = new Logger(SonarModelChat.name);
  private readonly sonarUrl = 'https://api.perplexity.ai/chat/completions';

  constructor(private configService: ConfigService) { }

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

    const systemPrompt = `
You are an expert researcher who thinks about the user question and gives the best answer possible.

You must follow two main rules:
You should always first think about the question before answering and give your thought process as well and for separating thought with answer you should start with thoughts: and when that's done start answer like answer:

Example:
"Thoughts: To answer this question, I need to consider...

Answer: Answer content goes here."

--------------------------------------------------------------------------
Some small instructions:
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
}
