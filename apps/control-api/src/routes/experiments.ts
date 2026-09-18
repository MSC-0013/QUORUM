import { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { ExperimentRepository, ExperimentWorkloadConfig, ExperimentFaultEvent } from '../repository/experimentRepository.js';
import { ClusterRepository } from '../repository/clusterRepository.js';

export interface ExperimentRouteOptions {
  experimentRepo: ExperimentRepository;
  clusterRepo: ClusterRepository;
}

export const experimentRoutes: FastifyPluginAsync<ExperimentRouteOptions> = async (
  fastify: FastifyInstance,
  opts: ExperimentRouteOptions
) => {
  const { experimentRepo, clusterRepo } = opts;

  // POST /v1/experiments
  fastify.post('/v1/experiments', async (request, reply) => {
    const body = request.body as {
      id?: string;
      projectId: string;
      clusterId: string;
      name: string;
      description?: string;
      workload: ExperimentWorkloadConfig;
      faultTimeline?: ExperimentFaultEvent[];
    };

    if (!body || !body.projectId || !body.clusterId || !body.name || !body.workload) {
      return reply.status(400).send({
        error: 'Required fields: projectId, clusterId, name, workload'
      });
    }

    const cluster = clusterRepo.getCluster(body.clusterId);
    if (!cluster) {
      return reply.status(404).send({ error: `Cluster ${body.clusterId} not found` });
    }

    try {
      const experiment = experimentRepo.createExperiment({
        id: body.id,
        projectId: body.projectId,
        clusterId: body.clusterId,
        name: body.name,
        description: body.description,
        workload: body.workload,
        faultTimeline: body.faultTimeline
      });

      return reply.status(201).send(experiment);
    } catch (err: any) {
      return reply.status(400).send({ error: err.message });
    }
  });

  // GET /v1/experiments
  fastify.get('/v1/experiments', async (request, reply) => {
    const query = request.query as { clusterId?: string };
    return reply.send(experimentRepo.listExperiments(query.clusterId));
  });

  // GET /v1/experiments/:id
  fastify.get('/v1/experiments/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const experiment = experimentRepo.getExperiment(id);
    if (!experiment) {
      return reply.status(404).send({ error: `Experiment ${id} not found` });
    }
    return reply.send(experiment);
  });

  // POST /v1/experiments/:id/runs (first-class experiment run trigger / queue)
  fastify.post('/v1/experiments/:id/runs', async (request, reply) => {
    const { id } = request.params as { id: string };
    const experiment = experimentRepo.getExperiment(id);
    if (!experiment) {
      return reply.status(404).send({ error: `Experiment ${id} not found` });
    }

    const cluster = clusterRepo.getCluster(experiment.clusterId);
    if (!cluster) {
      return reply.status(404).send({ error: `Cluster ${experiment.clusterId} not found` });
    }

    const body = (request.body ?? {}) as { runId?: string; rootSeed?: string };

    try {
      // Snapshot policy and membership at time of run (never mutable after start)
      const run = experimentRepo.createRun({
        id: body.runId,
        experimentId: experiment.id,
        clusterId: experiment.clusterId,
        rootSeed: body.rootSeed,
        clusterPolicySnapshot: cluster.policy,
        membershipSnapshot: {
          version: cluster.membershipVersion,
          members: [...cluster.members],
          hash: cluster.membershipHash
        }
      });

      return reply.status(201).send(run);
    } catch (err: any) {
      return reply.status(400).send({ error: err.message });
    }
  });

  // GET /v1/experiments/:id/runs
  fastify.get('/v1/experiments/:id/runs', async (request, reply) => {
    const { id } = request.params as { id: string };
    return reply.send(experimentRepo.listRuns(id));
  });

  // GET /v1/runs/:runId
  fastify.get('/v1/runs/:runId', async (request, reply) => {
    const { runId } = request.params as { runId: string };
    const run = experimentRepo.getRun(runId);
    if (!run) {
      return reply.status(404).send({ error: `Experiment run ${runId} not found` });
    }
    return reply.send(run);
  });

  // PATCH /v1/runs/:runId (worker updates status / results)
  fastify.patch('/v1/runs/:runId', async (request, reply) => {
    const { runId } = request.params as { runId: string };
    const body = request.body as {
      status?: 'QUEUED' | 'RUNNING' | 'COMPLETED' | 'FAILED' | 'ABORTED';
      startedAt?: string;
      completedAt?: string;
      result?: any;
    };

    if (!body || !body.status) {
      return reply.status(400).send({ error: 'status is required' });
    }

    try {
      const updated = experimentRepo.updateRunStatus(runId, body.status as any, {
        startedAt: body.startedAt,
        completedAt: body.completedAt,
        result: body.result
      });
      return reply.send(updated);
    } catch (err: any) {
      return reply.status(404).send({ error: err.message });
    }
  });

  // POST /v1/runs/:runId/execute (idempotent run execution dispatch)
  fastify.post('/v1/runs/:runId/execute', async (request, reply) => {
    const { runId } = request.params as { runId: string };
    const idempotencyHeader = request.headers['idempotency-key'] as string | undefined;
    const body = (request.body ?? {}) as {
      executionId?: string;
      artifact?: {
        uri: string;
        sha256: string;
        mediaType: string;
      };
      seed?: number;
      options?: {
        durationMs?: number;
        concurrency?: number;
      };
    };

    const executionId = body.executionId ?? idempotencyHeader ?? `exec-${Date.now()}`;

    try {
      const updated = experimentRepo.requestRunExecution(runId, {
        executionId,
        idempotencyKey: idempotencyHeader ?? executionId,
        artifact: body.artifact,
        seed: body.seed,
        options: body.options
      });
      return reply.status(202).send(updated);
    } catch (err: any) {
      if (err.message.includes('not found')) {
        return reply.status(404).send({ error: err.message });
      }
      if (err.message.includes('Conflict')) {
        return reply.status(409).send({ error: err.message });
      }
      return reply.status(400).send({ error: err.message });
    }
  });

  // POST /v1/runs/:runId/cancel (safe run cancellation)
  fastify.post('/v1/runs/:runId/cancel', async (request, reply) => {
    const { runId } = request.params as { runId: string };
    const body = (request.body ?? {}) as { reason?: string };

    try {
      const cancelled = experimentRepo.cancelRun(runId, body.reason);
      return reply.status(200).send(cancelled);
    } catch (err: any) {
      if (err.message.includes('not found')) {
        return reply.status(404).send({ error: err.message });
      }
      if (err.message.includes('terminal status')) {
        return reply.status(409).send({ error: err.message });
      }
      return reply.status(400).send({ error: err.message });
    }
  });
};
