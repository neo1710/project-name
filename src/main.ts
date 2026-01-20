import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // Add a simple GET route at "/"
  app.getHttpAdapter().get('/', (req, res) => {
    res.send('hello I am setup for this');
  });

    // Enable CORS for all origins
  app.enableCors({
    origin: '*', // Allow all origins
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  });


  await app.listen(process.env.PORT ?? 3000);
}
bootstrap();