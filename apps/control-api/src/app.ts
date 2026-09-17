import Fastify, { FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import { ProjectRepository } from './repository/projectRepository.js';
import { ClusterRepository } from './repository/clusterRepository.js';
import { ExperimentRepository } from './repository/experimentRepository.js';
import { projectRoutes } from './routes/projects.js';
import { clusterRoutes } from './routes/clusters.js';
import { experimentRoutes } from './routes/experiments.js';

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

  return app;
}
