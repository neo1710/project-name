import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Groq from 'groq-sdk';
import type { ChatCompletionMessageParam } from 'groq-sdk/resources/chat/completions';
import { chat } from './dto/chatDto';
import { ragStore } from './dto/ragDto';
import { chatAgents } from './agents/agents';

// Fallback only: the Models API below is the source of truth for the picker.
// These current Groq model IDs still route to Groq if its catalogue endpoint is
// temporarily unreachable. Keep this list in sync with Groq's supported-models page.
const KNOWN_GROQ_MODEL_IDS = new Set([
  'llama-3.1-8b-instant',
  'llama-3.3-70b-versatile',
  'openai/gpt-oss-120b',
  'openai/gpt-oss-20b',
  'openai/gpt-oss-safeguard-20b',
  'groq/compound',
  'groq/compound-mini',
  'qwen/qwen3.6-27b',
  'meta-llama/llama-prompt-guard-2-22m',
  'meta-llama/llama-prompt-guard-2-86m',
  'canopylabs/orpheus-arabic-saudi',
  'canopylabs/orpheus-v1-english',
  'minimaxai/minimax-m2.7',
  'whisper-large-v3',
  'whisper-large-v3-turbo',
]);

@Injectable()
export class SonarModelChat {
  private readonly logger = new Logger(SonarModelChat.name);
  private readonly sonarUrl = "https://api.mistral.ai/v1/chat/completions";
  private groqModelsCache: Array<{ id: string; owned_by?: string; created?: number }> = [];
  private groqModelsCacheExpiresAt = 0;

  constructor(private agents: chatAgents, private configService: ConfigService) { }

  /** Live Groq catalogue for the client model picker (database-ready later). */
  async listModels() {
    const groqApiKey = this.configService.get<string>('GROQ_API_KEY');
    let groq: { available: boolean; models: Array<{ id: string; owned_by?: string; created?: number }>; error?: string };

    if (!groqApiKey) {
      groq = { available: false, models: [], error: 'GROQ_API_KEY is not configured' };
    } else {
      try {
        groq = { available: true, models: await this.getGroqModels() };
      } catch (error) {
        this.logger.warn(`Unable to list Groq models: ${this.getErrorMessage(error)}`);
        groq = { available: false, models: [], error: 'Groq models are temporarily unavailable' };
      }
    }

    const mistral = {
      available: Boolean(this.getMistralApiKey()),
      models: [{ id: 'mistral-small-latest' }],
    };

    return {
      // Use this directly in a frontend select/dropdown.
      models: [
        ...groq.models.map((model) => ({ ...model, provider: 'groq' as const })),
        ...mistral.models.map((model) => ({ ...model, provider: 'mistral' as const })),
      ],
      providers: { groq, mistral },
    };
  }

  // ✅ NON-STREAMING CHAT
  async chat(body: chat) {
    if (await this.resolveProvider(body) === 'groq') {
      return this.groqChat(body, await this.prepareAgentMessages(body, this.researchSystemPrompt()));
    }

    const apiKey = this.getMistralApiKey();
    if (!apiKey) {
      throw new Error('MISTRAL_API_KEY (or legacy MYSTRAL_API_KEY) is missing');
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
      model: body.model || 'mistral-small-latest',
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
    if (await this.resolveProvider(body) === 'groq') {
      return this.groqChatStream(body, res, await this.prepareAgentMessages(body, this.streamingSystemPrompt()));
    }

    const apiKey = this.getMistralApiKey();
    if (!apiKey) {
      throw new Error('MISTRAL_API_KEY (or legacy MYSTRAL_API_KEY) is missing');
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
      model: body.model || 'mistral-small-latest',
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

  private getMistralApiKey() {
    // Keep the existing misspelled variable working for deployed environments.
    return this.configService.get<string>('MISTRAL_API_KEY')
      || this.configService.get<string>('MYSTRAL_API_KEY');
  }

  private getGroqClient() {
    const apiKey = this.configService.get<string>('GROQ_API_KEY');
    if (!apiKey) throw new Error('GROQ_API_KEY is missing');
    return new Groq({ apiKey });
  }

  private async getGroqModels() {
    if (Date.now() < this.groqModelsCacheExpiresAt) return this.groqModelsCache;

    const page = await this.getGroqClient().models.list();
    this.groqModelsCache = page.data.map((model) => ({
      id: model.id,
      owned_by: model.owned_by,
      created: model.created,
    }));
    this.groqModelsCacheExpiresAt = Date.now() + 5 * 60 * 1000;
    return this.groqModelsCache;
  }

  private async resolveProvider(body: chat): Promise<'groq' | 'mistral'> {
    if (body.provider) return body.provider;
    if (!body.model || !this.configService.get<string>('GROQ_API_KEY')) return 'mistral';

    try {
      const groqModels = await this.getGroqModels();
      return groqModels.some((model) => model.id === body.model) || KNOWN_GROQ_MODEL_IDS.has(body.model)
        ? 'groq'
        : 'mistral';
    } catch {
      // Keep known Groq model IDs on the Groq request format during a temporary
      // Models API outage. Unknown IDs continue through the existing provider.
      return KNOWN_GROQ_MODEL_IDS.has(body.model) ? 'groq' : 'mistral';
    }
  }

  /** Applies the same agent/RAG prompt preparation before calling Groq. */
  private async prepareAgentMessages(body: chat, fallbackSystemPrompt: string): Promise<ChatCompletionMessageParam[]> {
    const messages = body.messages.map((message) => ({
      role: message.role as 'user' | 'assistant' | 'system',
      content: message.content,
    }));

    let systemPrompt = fallbackSystemPrompt;
    if (body.agent === 'ragAgent') {
      const lastMessage = messages.at(-1);
      if (!lastMessage) throw new Error('A message is required when using ragAgent');

      this.logger.log('Using RAG agent with Groq');
      const ragResult = await this.agents.ragAgent(lastMessage.content, messages, {
        provider: 'groq',
        model: body.model,
      });
      systemPrompt = ragResult.prompt;
      lastMessage.content = ragResult.ragQueryWithContext;
    } else if (body.agent) {
      const agent = (this.agents as unknown as Record<string, unknown>)[body.agent];
      if (typeof agent !== 'function') throw new Error(`Unknown agent: ${body.agent}`);

      this.logger.log(`Using agent with Groq: ${body.agent}`);
      systemPrompt = await (agent as () => Promise<string>).call(this.agents);
    }

    return [{ role: 'system', content: systemPrompt }, ...messages] as ChatCompletionMessageParam[];
  }

  private researchSystemPrompt() {
    return 'You are an expert researcher. Give clear, structured, helpful answers.';
  }

  private streamingSystemPrompt() {
    return `You are an expert researcher.

For all questions, respond in JSON format:
{
  "reasoning": "Your step-by-step thought process",
  "answer": "Clear, structured answer",
  "confidence": "high|medium|low"
}`;
  }

  private async groqChat(body: chat, messages: ChatCompletionMessageParam[]) {
    return this.getGroqClient().chat.completions.create({
      model: body.model || 'llama-3.3-70b-versatile',
      messages,
      stream: false,
    });
  }

  private async groqChatStream(body: chat, res: any, messages: ChatCompletionMessageParam[]) {
    const stream = await this.getGroqClient().chat.completions.create({
      model: body.model || 'llama-3.3-70b-versatile',
      messages,
      stream: true,
    });

    res.set({
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });

    try {
      for await (const chunk of stream) res.write(`data: ${JSON.stringify(chunk)}\n\n`);
      res.write('data: [DONE]\n\n');
    } finally {
      res.end();
    }
  }

  private getErrorMessage(error: unknown) {
    return error instanceof Error ? error.message : String(error);
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
