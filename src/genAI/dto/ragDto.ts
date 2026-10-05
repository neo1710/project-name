import { IsString } from 'class-validator';

export class ragStore {
  @IsString()
  doc: string;
}
