import { Injectable, Global, Logger } from "@nestjs/common";
import { conversations } from "../dto/chatDto";
import { ConfigService } from "@nestjs/config/dist/config.service";


@Injectable() @Global()
export class SonarApiTools {
  private readonly logger = new Logger(SonarApiTools.name);
  private readonly sonarUrl = "https://api.mistral.ai/v1/chat/completions";

  constructor(private configService: ConfigService) { }

  async queryRewriter(messages: conversations[]) {
    const apiKey = this.configService.get<string>('MYSTRAL_API_KEY');
    const rewriterPrompt = `
You are a query rewriter. You take the user query and rewrite it to be more clear and concise for RAG retrieval.

Instructions:
1. Rewrite the query based ONLY on what is explicitly mentioned in the user query and conversation history.
2. NEVER assume, infer, or add any specific names, context, or details that are not directly present in the conversation.
3. Only split into multiple queries if the question genuinely contains multiple distinct questions that need separate answers.
4. If the query is already clear, return it as-is with minimal changes.

Rules:
- If user says "who is neeraj", rewrite as "Who is neeraj?" — do NOT expand to "Who is Neeraj Chopra?" or any other assumption.
- Only use context from the conversation history to resolve ambiguous pronouns (e.g., "he", "it", "that").
- Do not add adjectives, last names, titles, or any words not present in the original query or conversation history.

Important:
- Always return the rewritten query in an array format, even if there is only one query. For example, if the user query is "What is the capital of France?", return ["What is the capital of France?"].
- Always Answer the rewritten question only nothing else Do not try to answer the question or add any context or information that is not explicitly mentioned in the user query or conversation history.

Example 1 — Split only when needed:
User query: "What is the capital of France and who is the president?"
Rewritten: ["What is the capital of France?", "Who is the president of France?"]

Example 2 — Do NOT split:
User query: "Who is neeraj?"
Rewritten: ["Who is neeraj?"]

Example 3 — Do NOT add context:
User query: "Who is neeraj?"
Wrong: ["Who is Neeraj Chopra?"] ❌
Correct: ["Who is neeraj?"] ✅
`;
    try {
      const response = await fetch(this.sonarUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: 'mistral-small-latest',
          messages: [
            { role: 'system', content: rewriterPrompt },
            ...messages,
          ],
          stream: false,
        }),
      });
      if (!response.ok) {
        const err = await response.text();
        throw new Error(`HTTP ${response.status}: ${err}`);
      } else {
        const data = await response.json();
        this.logger.log('Query rewriter response', data.choices[0].message.content);
        return data.choices[0].message.content;
      }
    } catch (error) {
      console.error('Error in query rewriter:', error);
      throw error;
    }

  }


}  