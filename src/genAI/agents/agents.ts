import { Global, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { conversations } from '../dto/chatDto';

@Injectable() @Global()
export class chatAgents {
    private readonly logger = new Logger(chatAgents.name);
    private readonly sonarUrl = 'https://api.perplexity.ai/chat/completions';

    constructor(private configService: ConfigService) { }

    async critiqueAgent() {

        this.logger.log('Critique agent function executed');

        const critiquePrompt = `
        You are a critique agent. Your task is to evaluate the user query and provide feedback.

        Instructions:
        1. Analyze the user query for clarity and completeness.
        2. Suggest improvements or additional information needed.
        3. Try to kill user query if it is not well defined.
        4. Provide your feedback in a concise manner.
        `;

        return critiquePrompt;
    }

    async ragAgent(query: string, messages: conversations[]) {
        this.logger.log('RAG agent function executed', query);
        const embeddingApi = this.configService.get<string>('EMBEDDING_API');
        try {

            // const perfectQuery = ;

            const response = await fetch(`${embeddingApi}/search?query=${query}`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
            });
            if (!response.ok) {
                const err = await response.text();
                throw new Error(`HTTP ${response.status}: ${err}`);
            }
            const data = await response.json();
            this.logger.log('RAG agent retrieved contexts', data.results);
            const ragPrompt = `You are a helpful assistant that answers questions based on the provided context.

**Retrieved Context:**
${data.results}

**Instructions:**
1. Answer the user's question using ONLY the information from the context above
2. If the context contains relevant information, provide a clear and direct answer
3. If the context does NOT contain enough information to answer the question, respond with "I don't have enough information in the provided context to answer this question"
4. Do not make assumptions or add information not present in the context
5. If you're partially certain, indicate what you know and what's missing

**Response Format (JSON):**
{
  "answer": "Your direct answer to the user's question",
  "reasoning": "Brief explanation of how you derived the answer from the context",
  "confidence": "high|medium|low"
}

**Confidence Levels:**
- high: Answer is directly stated in context
- medium: Answer requires light inference from context
- low: Context only partially addresses the question
`;
            return ragPrompt;
        } catch (error) {
            this.logger.error('Error in RAG agent:', error);
            throw error;
        }


    }
}