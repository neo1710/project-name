import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { SandboxService } from './sandbox.service';

describe('SandboxService', () => {
  let service: SandboxService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SandboxService,
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string) => {
              if (key === 'SANDBOX_SERVICE_URL') return 'http://localhost:8001';
              return null;
            }),
          },
        },
      ],
    }).compile();

    service = module.get<SandboxService>(SandboxService);
  });

  it('should be defined and return correct base URL', () => {
    expect(service).toBeDefined();
    expect(service.getBaseUrl()).toBe('http://localhost:8001');
  });

  it('parseSseStream parses multiline SSE events and ignores comments', async () => {
    const rawSse = [
      ': keep-alive 3.2s\n\n',
      'event: start\ndata: {"status":"Process started","run_id":"test-1"}\n\n',
      'event: stdout\ndata: {"line":"Step 1: Ingesting dataset"}\n\n',
      ': keep-alive\n\n',
      'event: file_created\ndata: {"filename":"report.xlsx","relative_path":"output/report.xlsx"}\n\n',
      'event: complete\ndata: {"success":true,"exit_code":0}\n\n',
    ].join('');

    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode(rawSse));
        controller.close();
      },
    });

    const mockResponse = new Response(stream, {
      headers: { 'Content-Type': 'text/event-stream' },
    });

    const events: any[] = [];
    for await (const sse of service.parseSseStream(mockResponse)) {
      events.push(sse);
    }

    expect(events.length).toBe(4);
    expect(events[0]).toEqual({
      event: 'start',
      data: '{"status":"Process started","run_id":"test-1"}',
      parsed: { status: 'Process started', run_id: 'test-1' },
    });
    expect(events[1]).toEqual({
      event: 'stdout',
      data: '{"line":"Step 1: Ingesting dataset"}',
      parsed: { line: 'Step 1: Ingesting dataset' },
    });
    expect(events[2]).toEqual({
      event: 'file_created',
      data: '{"filename":"report.xlsx","relative_path":"output/report.xlsx"}',
      parsed: { filename: 'report.xlsx', relative_path: 'output/report.xlsx' },
    });
    expect(events[3]).toEqual({
      event: 'complete',
      data: '{"success":true,"exit_code":0}',
      parsed: { success: true, exit_code: 0 },
    });
  });

  it('proxies stream directly to client response', async () => {
    const rawSse = 'event: test\ndata: {"ok":true}\n\n';
    const encoder = new TextEncoder();
    const mockFetch = jest.spyOn(global, 'fetch').mockResolvedValue(
      new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(encoder.encode(rawSse));
            controller.close();
          },
        }),
        { status: 200, headers: { 'Content-Type': 'text/event-stream' } },
      ),
    );

    const written: string[] = [];
    const clientRes = {
      setHeader: jest.fn(),
      flushHeaders: jest.fn(),
      flush: jest.fn(),
      write: jest.fn((chunk: Uint8Array) => {
        written.push(new TextDecoder().decode(chunk));
      }),
      end: jest.fn(),
    };

    await service.proxyStream('/agent/run/stream', { action: 'test' }, clientRes);

    expect(clientRes.setHeader).toHaveBeenCalledWith('Content-Type', 'text/event-stream');
    expect(written.join('')).toBe(rawSse);
    expect(clientRes.end).toHaveBeenCalled();

    mockFetch.mockRestore();
  });
});

