import { Global, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { conversations } from '../dto/chatDto';
import { SonarApiTools } from '../tools/sonarApiTools';

@Injectable() @Global()
export class chatAgents {
    private readonly logger = new Logger(chatAgents.name);
    private readonly sonarUrl = 'https://api.perplexity.ai/chat/completions';

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
            const ragPrompt = `You are a retrieval-based answer engine. Your ONLY source of truth is the context below.

**Retrieved Context:**
${data.results}

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
- Do NOT answer if context is empty or \`${data.results}\` is undefined/null
`;
            return ragPrompt;
        } catch (error) {
            this.logger.error('Error in RAG agent:', error);
            throw error;
        }


    }
}