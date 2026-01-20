import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { GenAIModule } from './genAI/genAI.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    MongooseModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: async (configService: ConfigService) => {
        const uri = configService.get<string>('MONGODB_DATABASE_URI') || 'mongodb://localhost:27017/mydatabase';
        console.log(`Connecting to MongoDB at ${uri}`);
        return { uri };
      },
    }),
      GenAIModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
