import { Prop } from "@nestjs/mongoose";
import { IsBoolean, IsString, isString } from "class-validator";


class conversations{
    @IsString()
    role: string;

    @IsString()
    content: string;
}

export class chat{
    @Prop([conversations])
    messages: conversations[];
   
    @IsString()
    model: string;

    @IsBoolean()
    stream: boolean;

    @IsString()
    agent?: string;

}