import { Prop } from "@nestjs/mongoose";
import { IsBoolean, IsString, isString } from "class-validator";


export class ragStore{
    @Prop([String])
    texts: string[];
}