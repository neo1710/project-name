import { Injectable, Global } from "@nestjs/common";
import { conversations } from "../dto/chatDto";


@Injectable() @Global()
export class SonarApiTools {
  private readonly sonarUrl = 'https://api.perplexity.ai/chat/completions';

  async queryRewriter(messages: conversations[]) {
    const rewriterPrompt = `
        You are a query rewriter. You take the user query and rewrite it to be more clear and concise for rag retrieval.

        Instructions:
        1. Analyze the user query for clarity and completeness.
        2. Rewrite the query by analyzing the conversation history and extracting the main intent.
        3. If the query retrieval requery it be splitted into multiple queries do that and return as an array.

        Example:
        User query: "What is the capital of France and who is the president?"

        Rewritten query: ["What is the capital of France?", "Who is the president of France?"]
        `
    try {
      const response = await fetch(this.sonarUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'sonar',
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
        return data.choices[0].message.content;
      }
    } catch (error) {
      console.error('Error in query rewriter:', error);
      throw error;
    }

  }


}  