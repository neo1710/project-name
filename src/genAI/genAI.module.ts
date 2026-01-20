import { Module } from "@nestjs/common";
import { SonarModelChat } from "./genAI.service";
import { GenAIController } from "./genAI.controller";



@Module({
    providers: [SonarModelChat],
    controllers: [GenAIController],
})
export class GenAIModule {}