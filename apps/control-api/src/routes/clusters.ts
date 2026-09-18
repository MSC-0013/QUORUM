import { FastifyInstance, FastifyPluginAsync } from 'fastify';
import {
  ClusterPolicyConfig,
  validateClusterPolicyConfig,
  CapabilityMilestoneError
} from '@quorum-lab/contracts';
import { ClusterRepository } from '../repository/clusterRepository.js';

export interface ClusterRouteOptions {
  clusterRepo: ClusterRepository;
}

export const clusterRoutes: FastifyPluginAsync<ClusterRouteOptions> = async (
  fastify: FastifyInstance,
  opts: ClusterRouteOptions
) => {
  const { clusterRepo } = opts;

  // POST /v1/clusters
  fastify.post('/v1/clusters', async (request, reply) => {
    const body = request.body as {
      id?: string;
      projectId: string;
      name: string;
      members: string[];
      policy: ClusterPolicyConfig;
    };

    if (!body || !body.projectId || !body.name || !Array.isArray(body.members) || !body.policy) {
      return reply.status(400).send({
        error: 'Required fields: projectId, name, members (array), policy (object)'
      });
    }

    try {
      // Validate policy against Q5 capability matrix and resolve quorum numbers
      const { quorumNumbers } = validateClusterPolicyConfig(
        body.policy,
        body.members.length,
        5,
        'Q5'
      );

      const cluster = clusterRepo.createCluster({
        id: body.id,
        projectId: body.projectId,
        name: body.name.trim(),
        members: body.members,
        policy: body.policy,
        resolvedQuorum: quorumNumbers
      });

      return reply.status(201).send(cluster);
    } catch (err: any) {
      if (err instanceof CapabilityMilestoneError) {
        return reply.status(422).send({
          error: 'FEATURE_NOT_AVAILABLE_IN_MILESTONE',
          message: err.message,
          firstValidMilestone: err.firstValidMilestone
        });
      }
      return reply.status(400).send({ error: err.message });
    }
  });

  // GET /v1/clusters
  fastify.get('/v1/clusters', async (request, reply) => {
    const query = request.query as { projectId?: string };
    return reply.send(clusterRepo.listClusters(query.projectId));
  });

  // GET /v1/clusters/:id
  fastify.get('/v1/clusters/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const cluster = clusterRepo.getCluster(id);
    if (!cluster) {
      return reply.status(404).send({ error: `Cluster ${id} not found` });
    }
    return reply.send(cluster);
  });

  // POST /v1/clusters/:id/nodes
  fastify.post('/v1/clusters/:id/nodes', async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = request.body as { nodeId: string; grpcAddress: string };

    if (!body || !body.nodeId || !body.grpcAddress) {
      return reply.status(400).send({ error: 'nodeId and grpcAddress are required' });
    }

    try {
      const node = clusterRepo.addNode({
        clusterId: id,
        nodeId: body.nodeId,
        grpcAddress: body.grpcAddress
      });
      return reply.status(201).send(node);
    } catch (err: any) {
      return reply.status(404).send({ error: err.message });
    }
  });

  // GET /v1/clusters/:id/nodes
  fastify.get('/v1/clusters/:id/nodes', async (request, reply) => {
    const { id } = request.params as { id: string };
    const cluster = clusterRepo.getCluster(id);
    if (!cluster) {
      return reply.status(404).send({ error: `Cluster ${id} not found` });
    }
    return reply.send(clusterRepo.listNodes(id));
  });

  // POST /v1/clusters/:id/policies
  fastify.post('/v1/clusters/:id/policies', async (request, reply) => {
    const { id } = request.params as { id: string };
    const cluster = clusterRepo.getCluster(id);
    if (!cluster) {
      return reply.status(404).send({ error: `Cluster ${id} not found` });
    }

    const body = request.body as { policy: ClusterPolicyConfig };
    if (!body || !body.policy) {
      return reply.status(400).send({ error: 'policy object is required' });
    }

    try {
      const { quorumNumbers } = validateClusterPolicyConfig(
        body.policy,
        cluster.members.length,
        5,
        'Q5'
      );

      const updated = clusterRepo.updatePolicy(id, body.policy, quorumNumbers);
      return reply.send(updated);
    } catch (err: any) {
      if (err instanceof CapabilityMilestoneError) {
        return reply.status(422).send({
          error: 'FEATURE_NOT_AVAILABLE_IN_MILESTONE',
          message: err.message,
          firstValidMilestone: err.firstValidMilestone
        });
      }
      return reply.status(400).send({ error: err.message });
    }
  });
};
