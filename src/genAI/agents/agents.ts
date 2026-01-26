import { Global, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

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

    async ragAgent(query: string) {
        this.logger.log('RAG agent function executed', query);
        const embeddingApi = this.configService.get<string>('EMBEDDING_API');
        try {
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
            const ragPrompt = `
             You are a RAG agent you have to respond the user query based on these retrieved contexts.
                Contexts: ${data.results}
            `;
            return ragPrompt;
        } catch (error) {
            this.logger.error('Error in RAG agent:', error);
            throw error;
        }


    }
}