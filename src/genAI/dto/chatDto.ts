import { Prop } from '@nestjs/mongoose';
import { IsBoolean, IsIn, IsOptional, IsString } from 'class-validator';

export class conversations {
  @IsString()
  role: string;

  @IsString()
  content: string;
}

export class chat {
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

  @IsOptional()
  @IsString()
  agent?: string;

  @IsOptional()
  @IsString()
  workflowName?: string;

  // Temporary ownership selector until Auth0 supplies this from the token.
  @IsOptional()
  @IsString()
  workflowOwnerId?: string;
}
