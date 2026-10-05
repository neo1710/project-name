import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { CreateWorkflowDto } from './dto/create-workflow.dto';
import { UpdateWorkflowDto } from './dto/update-workflow.dto';
import { WorkflowRegistryService } from './workflow-registry.service';
import { WorkflowService } from './workflow.service';

@Controller('workflows')
export class WorkflowController {
  constructor(
    private readonly workflows: WorkflowService,
    private readonly registry: WorkflowRegistryService,
  ) {}

  @Get('registry')
  registryDefinition() {
    return this.registry.definitions();
  }

  @Post()
  create(@Body() body: CreateWorkflowDto) {
    return this.workflows.create(body);
  }

  @Get()
  list(
    @Query('ownerId') ownerId?: string,
    @Query('skip') skip?: string,
    @Query('limit') limit?: string,
  ) {
    return this.workflows.list(
      ownerId,
      this.parseNonNegativeInteger('skip', skip) ?? 0,
      this.parsePositiveInteger('limit', limit),
    );
  }

  @Get(':workflowId')
  get(@Param('workflowId') workflowId: string) {
    return this.workflows.get(workflowId);
  }

  @Patch(':workflowId')
  update(
    @Param('workflowId') workflowId: string,
    @Body() body: UpdateWorkflowDto,
  ) {
    return this.workflows.update(workflowId, body);
  }

  @Put(':workflowId')
  saveOrUpdate(
    @Param('workflowId') workflowId: string,
    @Body() body: UpdateWorkflowDto,
  ) {
    return this.workflows.update(workflowId, body);
  }

  @Delete(':workflowId')
  delete(@Param('workflowId') workflowId: string) {
    return this.workflows.delete(workflowId);
  }

  private parseNonNegativeInteger(name: string, value?: string) {
    if (value === undefined) return undefined;
    if (!/^\d+$/.test(value))
      throw new BadRequestException(`${name} must be a non-negative integer`);
    return Number(value);
  }

  private parsePositiveInteger(name: string, value?: string) {
    if (value === undefined) return undefined;
    if (!/^[1-9]\d*$/.test(value))
      throw new BadRequestException(`${name} must be a positive integer`);
    return Number(value);
  }
}
