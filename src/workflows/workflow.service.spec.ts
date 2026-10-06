import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { BadRequestException } from '@nestjs/common';
import { WorkflowService } from './workflow.service';
import { Workflow } from './schemas/workflow.schema';

describe('WorkflowService', () => {
  let service: WorkflowService;
  let model: {
    create: jest.Mock;
    find: jest.Mock;
    findOne: jest.Mock;
    findOneAndUpdate: jest.Mock;
    deleteOne: jest.Mock;
  };

  beforeEach(async () => {
    model = {
      create: jest.fn(),
      find: jest.fn(),
      findOne: jest.fn(),
      findOneAndUpdate: jest.fn(),
      deleteOne: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WorkflowService,
        {
          provide: getModelToken(Workflow.name),
          useValue: model,
        },
      ],
    }).compile();

    service = module.get<WorkflowService>(WorkflowService);
  });

  it('allows creating a workflow with an output node without value', async () => {
    model.create.mockImplementation((doc) => Promise.resolve(doc));

    const result = await service.create({
      name: 'Draft with output',
      ownerId: 'owner-1',
      status: 'draft',
      nodes: [
        { name: 'Input', type: 'input', position: { x: 0, y: 0 } },
        { name: 'Output', type: 'output', position: { x: 100, y: 0 } },
      ],
      edges: [{ from: 'Input', to: 'Output' }],
    });

    expect(result.name).toBe('Draft with output');
    expect(result.nodes).toHaveLength(2);
  });

  it('throws BadRequestException if output node value is not a string when provided', async () => {
    await expect(
      service.create({
        name: 'Invalid Output Value',
        ownerId: 'owner-1',
        nodes: [
          { name: 'Input', type: 'input', position: { x: 0, y: 0 } },
          {
            name: 'Output',
            type: 'output',
            position: { x: 100, y: 0 },
            value: 123 as any,
          },
        ],
        edges: [{ from: 'Input', to: 'Output' }],
      }),
    ).rejects.toThrow(BadRequestException);
  });
});

