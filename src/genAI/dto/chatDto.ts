import { Prop } from "@nestjs/mongoose";
import { IsBoolean, IsIn, IsOptional, IsString } from "class-validator";


export class conversations{
    @IsString()
    role: string;

    @IsString()
    content: string;
}

export class chat{
    @Prop([conversations])
    messages: conversations[];
   
    @IsOptional()
    @IsString()
    model?: string;

    @IsOptional()
    @IsIn(['groq', 'mistral'])
    provider?: 'groq' | 'mistral';

    @IsOptional()
    @IsBoolean()
    stream?: boolean;

    @IsString()
    agent?: string;

}
