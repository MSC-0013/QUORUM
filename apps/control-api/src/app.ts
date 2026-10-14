import Fastify, { FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import { ProjectRepository } from './repository/projectRepository.js';
import { ClusterRepository } from './repository/clusterRepository.js';
import { ExperimentRepository } from './repository/experimentRepository.js';
import { projectRoutes } from './routes/projects.js';
import { clusterRoutes } from './routes/clusters.js';
import { experimentRoutes } from './routes/experiments.js';
import { renderQuorumDashboard } from './dashboardTemplate.js';

export interface AppDependencies {
  projectRepo?: ProjectRepository;
  clusterRepo?: ClusterRepository;
  experimentRepo?: ExperimentRepository;
}

export function buildApp(deps?: AppDependencies): FastifyInstance {
  const app = Fastify({
    logger: false
  });

  app.register(cors, {
    origin: true
  });

  const projectRepo = deps?.projectRepo ?? new ProjectRepository();
  const clusterRepo = deps?.clusterRepo ?? new ClusterRepository();
  const experimentRepo = deps?.experimentRepo ?? new ExperimentRepository();

  app.register(projectRoutes, { projectRepo });
  app.register(clusterRoutes, { clusterRepo });
  app.register(experimentRoutes, { experimentRepo, clusterRepo });

  app.get('/health', async () => ({ status: 'UP' }));

  app.get('/', async (req, reply) => {
    const accept = req.headers.accept || '';
    const query = req.query as Record<string, string> | undefined;
    const wantsJson = (accept.includes('application/json') && !accept.includes('text/html')) || query?.format === 'json';

    if (wantsJson) {
      return reply.status(200).send({
        service: 'QUORUM LAB Control API',
        status: 'ONLINE',
        version: '1.0.0',
        description: 'Distributed consensus, quorum policy verification, and fault injection platform',
        endpoints: {
          health: '/health',
          projects: '/v1/projects',
          clusters: '/v1/clusters',
          experiments: '/v1/experiments'
        }
      });
    }

    return reply.type('text/html; charset=utf-8').status(200).send(renderQuorumDashboard());
  });

  return app;
}

