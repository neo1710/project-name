import { Global, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { conversations } from '../dto/chatDto';
import { SonarApiTools } from '../tools/sonarApiTools';

@Injectable() @Global()
export class chatAgents {
    private readonly logger = new Logger(chatAgents.name);
    private readonly sonarUrl = "https://api.mistral.ai/v1/chat/completions";

    constructor(private sonarApiTools: SonarApiTools, private configService: ConfigService) { }

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

            const perfectQuery = await this.sonarApiTools.queryRewriter(messages);
            this.logger.log('RAG agent got rewritten query', perfectQuery);

            if (!embeddingApi) {
                throw new Error('EMBEDDING_API is missing or not configured');
            }

            let queryToUse = query;
            if (perfectQuery) {
                try {
                    const parsed = JSON.parse(perfectQuery);
                    if (Array.isArray(parsed) && parsed.length > 0 && typeof parsed[0] === 'string') {
                        queryToUse = parsed[0];
                    } else if (typeof parsed === 'string') {
                        queryToUse = parsed;
                    } else {
                        queryToUse = perfectQuery;
                    }
                } catch {
                    queryToUse = perfectQuery;
                }
            }

            const searchUrl = `${embeddingApi}/search?query=${encodeURIComponent(queryToUse)}`;
            let response: Response | null = null;
            const maxRetries = 3;

            for (let attempt = 1; attempt <= maxRetries; attempt++) {
                response = await fetch(searchUrl, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                });

                if (response.status !== 429) {
                    break;
                }

                const retryAfterHeader = response.headers.get('Retry-After');
                const retryAfterMs = retryAfterHeader ? Number(retryAfterHeader) * 1000 : 1000 * attempt;
                this.logger.warn(`RAG search rate limited, retrying attempt ${attempt}/${maxRetries} after ${retryAfterMs}ms`);
                await new Promise((resolve) => setTimeout(resolve, retryAfterMs));
            }

            if (!response || !response.ok) {
                const err = response ? await response.text() : 'No response received';
                throw new Error(`HTTP ${response?.status ?? 'UNKNOWN'}: ${err}`);
            }

            const data = await response.json();
            this.logger.log('RAG agent retrieved contexts', data.results);
            const ragPrompt = `You are a retrieval-based answer engine. Your ONLY source of truth is the context below.

**Retrieved Context:**
Retrieved results from rag will be provided with the user query. Use ONLY this context to answer the question. Do NOT use any external knowledge or assumptions.

---

**STRICT RULES — NO EXCEPTIONS:**
- Answer using ONLY the exact information present in the retrieved context above
- Do NOT use any research any external knowledge only use the retrieved context from above nothing else Strictly.
- Do NOT infer, extrapolate, or reason beyond what is explicitly stated
- Do NOT paraphrase in ways that introduce new meaning
- If the context is empty, irrelevant, or insufficient → return "insufficient_context"

---

**Response Format (JSON only — no prose outside this block):**
{
  "answer": "Direct answer using only context verbatim or near-verbatim, OR null if context is insufficient",
  "reasoning": "Show your steps in the context that led to the answer, quoting specific sentences. If insufficient context, explain what is missing.",
  "confidence": "high|low|insufficient_context",
}

**Confidence Levels:**
- high: Answer is explicitly and unambiguously stated in the context
- low: Context mentions the topic but does not fully answer the question
- insufficient_context: Context does not contain the information needed to answer

**Examples of what NOT to do:**
- Do NOT say "Based on my knowledge..." 
- Do NOT say "Generally speaking..."
- Do NOT fill gaps with assumed facts
- Also use the context to related question like if asked about Neeraj and Context has info about Neeraj Dubey then also you can answer.
- Do NOT answer if context is empty or is undefined/null
`;
            return {
                prompt:ragPrompt,
                ragQueryWithContext: `User query: ${query}
                retrieved context: ${data.results}
                `
            };
        } catch (error) {
            this.logger.error('Error in RAG agent:', error);
            throw error;
        }


    }
}