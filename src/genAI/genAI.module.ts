import { Module } from "@nestjs/common";
import { SonarModelChat } from "./genAI.service";
import { GenAIController } from "./genAI.controller";
import { chatAgents } from "./agents/agents";
import { SonarApiTools } from "./tools/sonarApiTools";



@Module({
    providers: [SonarModelChat, chatAgents, SonarApiTools],
    controllers: [GenAIController],
})
export class GenAIModule {}