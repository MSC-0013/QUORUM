import { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { ProjectRepository } from '../repository/projectRepository.js';

export interface ProjectRouteOptions {
  projectRepo: ProjectRepository;
}

export const projectRoutes: FastifyPluginAsync<ProjectRouteOptions> = async (
  fastify: FastifyInstance,
  opts: ProjectRouteOptions
) => {
  const { projectRepo } = opts;

  fastify.post('/v1/projects', async (request, reply) => {
    const body = request.body as { id?: string; name: string; description?: string };
    if (!body || !body.name || typeof body.name !== 'string') {
      return reply.status(400).send({ error: 'Project name is required' });
    }

    try {
      const project = projectRepo.create({
        id: body.id,
        name: body.name.trim(),
        description: body.description?.trim()
      });
      return reply.status(201).send(project);
    } catch (err: any) {
      return reply.status(409).send({ error: err.message });
    }
  });

  fastify.get('/v1/projects', async (_request, reply) => {
    return reply.send(projectRepo.list());
  });

  fastify.get('/v1/projects/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const project = projectRepo.get(id);
    if (!project) {
      return reply.status(404).send({ error: `Project ${id} not found` });
    }
    return reply.send(project);
  });
};
