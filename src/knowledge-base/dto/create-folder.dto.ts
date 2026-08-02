import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class CreateFolderDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  ownerId: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  name: string;
}
