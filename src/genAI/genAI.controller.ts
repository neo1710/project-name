import { Controller, Get, Post, Body, Res } from "@nestjs/common";
import { SonarModelChat } from "./genAI.service";
import { chat } from "./dto/chatDto";
import { ragStore } from "./dto/ragDto";




@Controller('genAI')
export class GenAIController {
    constructor(private readonly sonarModelChat: SonarModelChat) {}

    @Post('chat')
    async chat(
        @Body() body: chat,
        @Res() res: any
    ) {
         // Streaming responses must be handled manually
    if (body.stream) {
      return this.sonarModelChat.chatStream(body, res);
    }

    // Normal JSON response (NestJS handles it automatically)
    const data = await this.sonarModelChat.chat(body);
    return res.json(data);
    }

    /** Live model catalogue for the model-selection UI. */
    @Get('models')
    async models() {
        return this.sonarModelChat.listModels();
    }

    @Post('ragStore')
    async ragStore(@Body() body: ragStore) {
        return this.sonarModelChat.ragStore(body);
    }
}
