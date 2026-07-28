import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class StoreDocumentDto {
  // Text should come from your S3 ingestion worker after it extracts a PDF/DOCX/TXT.
  @IsString()
  @IsNotEmpty()
  @MaxLength(5_000_000)
  text: string;
}
