import { Module } from "@nestjs/common";
import { SonarModelChat } from "./genAI.service";
import { GenAIController } from "./genAI.controller";
import { chatAgents } from "./agents/agents";



@Module({
    providers: [SonarModelChat, chatAgents],
    controllers: [GenAIController],
})
export class GenAIModule {}