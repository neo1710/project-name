import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { randomUUID } from 'crypto';
import { isValidObjectId, Model } from 'mongoose';
import { CreateWorkflowDto } from './dto/create-workflow.dto';
import { UpdateWorkflowDto } from './dto/update-workflow.dto';
import { Workflow, WorkflowDocument } from './schemas/workflow.schema';
import { WorkflowEdge, WorkflowNode } from './workflow.types';

@Injectable()
export class WorkflowService {
  constructor(
    @InjectModel(Workflow.name) private readonly workflows: Model<Workflow>,
  ) {}

  async create(input: CreateWorkflowDto) {
    const name = input.name?.trim();
    if (!name) {
      throw new BadRequestException('Workflow name is required');
    }
    const nodes = input.nodes ?? [];
    const edges = input.edges ?? [];
    const status = input.status || 'draft';

    this.validateGraph(nodes, edges, status);

    const workflow = await this.workflows.create({
      workflowId: randomUUID(),
      ownerId: input.ownerId,
      name,
      description: input.description?.trim(),
      status,
      version: 1,
      nodes,
      edges,
    });
    return this.serialize(workflow);
  }

  async list(ownerId?: string, skip = 0, limit?: number) {
    const filter = ownerId ? { ownerId } : {};
    let query = this.workflows.find(filter).sort({ updatedAt: -1 }).skip(skip);
    if (limit !== undefined) query = query.limit(limit);
    return (await query.lean()).map((workflow) => this.serialize(workflow));
  }

  async get(workflowId: string) {
    return this.serialize(await this.find(workflowId));
  }

  async findForExecution(
    name: string,
    ownerId?: string,
  ): Promise<WorkflowDocument> {
    const filter = ownerId ? { name, ownerId } : { name };
    const matches = await this.workflows
      .find(filter)
      .sort({ updatedAt: -1 })
      .limit(2);
    if (!matches.length)
      throw new NotFoundException(`Workflow named ${name} was not found`);
    if (matches.length > 1) {
      throw new ConflictException(
        `More than one workflow is named ${name}. Send workflowOwnerId to select one.`,
      );
    }
    return matches[0];
  }

  async update(workflowId: string, input: UpdateWorkflowDto) {
    const current = await this.find(workflowId);

    if (
      input.version !== undefined &&
      input.version !== null &&
      input.version !== ''
    ) {
      const versionNum = Number(input.version);
      if (!Number.isNaN(versionNum) && versionNum !== current.version) {
        throw new ConflictException(
          'This workflow changed elsewhere. Reload it before saving.',
        );
      }
    }

    const newStatus = input.status ?? current.status;
    const nodes = input.nodes !== undefined ? input.nodes : current.nodes;
    const edges = input.edges !== undefined ? input.edges : current.edges;

    const graphChanged =
      input.nodes !== undefined || input.edges !== undefined;
    const statusChanged =
      input.status !== undefined && input.status !== current.status;

    if (graphChanged || (statusChanged && newStatus === 'published')) {
      this.validateGraph(nodes, edges, newStatus);
    }

    const update: Record<string, unknown> = {};
    if (input.name !== undefined) {
      const trimmed = input.name.trim();
      if (!trimmed) {
        throw new BadRequestException('Workflow name cannot be empty');
      }
      update.name = trimmed;
    }
    if (input.description !== undefined) {
      update.description = input.description.trim();
    }
    if (input.status !== undefined) {
      if (!['draft', 'published'].includes(input.status)) {
        throw new BadRequestException(
          'Status must be either "draft" or "published"',
        );
      }
      update.status = input.status;
    }
    if (input.nodes !== undefined) {
      update.nodes = input.nodes;
    }
    if (input.edges !== undefined) {
      update.edges = input.edges;
    }

    if (Object.keys(update).length > 0) {
      update.version = current.version + 1;
    }

    const workflow = await this.workflows.findOneAndUpdate(
      { workflowId: current.workflowId },
      update,
      { new: true },
    );
    if (!workflow) {
      throw new NotFoundException(`Workflow ${workflowId} was not found`);
    }
    return this.serialize(workflow);
  }

  async delete(workflowId: string) {
    const current = await this.find(workflowId);
    await this.workflows.deleteOne({ workflowId: current.workflowId });
    return {
      message: 'Workflow deleted successfully',
      workflowId: current.workflowId,
      deletedWorkflow: this.serialize(current),
    };
  }

  private validateGraph(
    nodes: WorkflowNode[],
    edges: WorkflowEdge[],
    status: 'draft' | 'published' = 'draft',
  ) {
    if (!Array.isArray(nodes) || !Array.isArray(edges)) {
      throw new BadRequestException('nodes and edges must be arrays');
    }

    if (status === 'published' && !nodes.length) {
      throw new BadRequestException(
        'A published workflow needs at least one node',
      );
    }

    if (nodes.length === 0) {
      if (edges.length > 0) {
        throw new BadRequestException('Edges cannot exist without nodes');
      }
      return;
    }

    const names = new Set<string>();
    nodes.forEach((node) => this.validateNode(node, names));

    if (status === 'published') {
      this.validatePublishedEdges(nodes, edges, names);
    } else {
      this.validateDraftEdges(nodes, edges, names);
    }
  }

  private validateNode(node: WorkflowNode, names: Set<string>) {
    if (!node) {
      throw new BadRequestException('Node cannot be empty');
    }
    if (!node.name && (node as any).id) {
      node.name = (node as any).id;
    }
    if (
      !node?.name?.trim() ||
      !node.type ||
      !node.position ||
      !Number.isFinite(Number(node.position.x)) ||
      !Number.isFinite(Number(node.position.y))
    ) {
      throw new BadRequestException(
        'Every node needs name, type, and numeric position.x / position.y',
      );
    }
    node.position.x = Number(node.position.x);
    node.position.y = Number(node.position.y);

    if (names.has(node.name)) {
      throw new BadRequestException(`Duplicate node name: ${node.name}`);
    }
    names.add(node.name);

    if (
      !['input', 'agent', 'tool', 'condition', 'output'].includes(node.type)
    ) {
      throw new BadRequestException(`Unsupported node type: ${node.type}`);
    }
    if (node.type === 'agent' && typeof node.agentType !== 'string') {
      throw new BadRequestException(`Agent node ${node.name} needs agentType`);
    }
    if (node.type === 'tool' && typeof node.tool !== 'string') {
      throw new BadRequestException(`Tool node ${node.name} needs tool`);
    }
    if (node.type === 'condition' && typeof node.expression !== 'string') {
      throw new BadRequestException(
        `Condition node ${node.name} needs expression`,
      );
    }
    if (node.type === 'output' && typeof node.value !== 'string') {
      throw new BadRequestException(`Output node ${node.name} needs value`);
    }
  }

  private validateDraftEdges(
    nodes: WorkflowNode[],
    edges: WorkflowEdge[],
    names: Set<string>,
  ) {
    const incoming = new Map(nodes.map((node) => [node.name, 0]));
    const outgoing = new Map(nodes.map((node) => [node.name, [] as string[]]));
    const edgeKeys = new Set<string>();

    for (const edge of edges) {
      if (!names.has(edge.from) || !names.has(edge.to)) {
        throw new BadRequestException(
          `Edge ${edge.from} -> ${edge.to} references an unknown node`,
        );
      }
      if (edge.from === edge.to) {
        throw new BadRequestException('A node cannot connect to itself');
      }
      const key = `${edge.from}\u0000${edge.to}\u0000${edge.when || ''}`;
      if (edgeKeys.has(key)) {
        throw new BadRequestException(
          `Duplicate edge: ${edge.from} -> ${edge.to}`,
        );
      }
      edgeKeys.add(key);
      incoming.set(edge.to, (incoming.get(edge.to) || 0) + 1);
      outgoing.get(edge.from)!.push(edge.to);
    }

    const inputNodes = nodes.filter((node) => node.type === 'input');
    for (const input of inputNodes) {
      if (incoming.get(input.name)) {
        throw new BadRequestException(
          'The input node cannot have incoming edges',
        );
      }
    }

    for (const output of nodes.filter((node) => node.type === 'output')) {
      if (outgoing.get(output.name)!.length) {
        throw new BadRequestException(
          'An output node cannot have outgoing edges',
        );
      }
    }

    const visited = new Set<string>();
    const active = new Set<string>();
    const visit = (name: string) => {
      if (active.has(name)) {
        throw new BadRequestException('Workflow cycles are not supported');
      }
      if (visited.has(name)) return;
      active.add(name);
      for (const next of outgoing.get(name) || []) {
        visit(next);
      }
      active.delete(name);
      visited.add(name);
    };

    for (const node of nodes) {
      if (!visited.has(node.name)) {
        visit(node.name);
      }
    }
  }

  private validatePublishedEdges(
    nodes: WorkflowNode[],
    edges: WorkflowEdge[],
    names: Set<string>,
  ) {
    this.validateDraftEdges(nodes, edges, names);

    const inputNodes = nodes.filter((node) => node.type === 'input');
    if (inputNodes.length !== 1) {
      throw new BadRequestException(
        'A published workflow needs exactly one input node',
      );
    }
    if (!nodes.some((node) => node.type !== 'input')) {
      throw new BadRequestException(
        'A published workflow needs at least one node after input',
      );
    }

    const outgoing = new Map(nodes.map((node) => [node.name, [] as string[]]));
    for (const edge of edges) {
      outgoing.get(edge.from)!.push(edge.to);
    }

    const input = inputNodes[0];
    const visited = new Set<string>();
    const active = new Set<string>();
    const visit = (name: string) => {
      if (active.has(name)) {
        throw new BadRequestException('Workflow cycles are not supported');
      }
      if (visited.has(name)) return;
      active.add(name);
      for (const next of outgoing.get(name) || []) {
        visit(next);
      }
      active.delete(name);
      visited.add(name);
    };
    visit(input.name);

    if (visited.size !== nodes.length) {
      throw new BadRequestException(
        'Every node must be reachable from the input node in a published workflow',
      );
    }
  }

  private async find(workflowId: string): Promise<WorkflowDocument> {
    let workflow = await this.workflows.findOne({ workflowId });
    if (!workflow && isValidObjectId(workflowId)) {
      workflow = await this.workflows.findById(workflowId);
    }
    if (!workflow) {
      throw new NotFoundException(`Workflow ${workflowId} was not found`);
    }
    return workflow;
  }

  private serialize(workflow: Workflow | Record<string, unknown>) {
    const value =
      typeof (workflow as any).toObject === 'function'
        ? (workflow as any).toObject()
        : workflow;
    const { _id, __v, ...rest } = value as Record<string, unknown>;
    return rest;
  }
}
