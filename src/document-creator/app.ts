import Fastify, { type FastifyInstance } from 'fastify';
import { registerCreatorRoutes, type CreatorRouteOptions } from './routes.js';

export interface BuildCreatorAppOptions extends CreatorRouteOptions {
  logger?: boolean;
}

export async function buildCreatorApp(options: BuildCreatorAppOptions = {}): Promise<FastifyInstance> {
  const app = Fastify({ logger: options.logger ?? false });

  app.get('/health/live', async () => ({
    status: 'ok',
    mode: 'document',
    service: 'kb-document-creator'
  }));

  app.get('/health/ready', async () => ({
    status: 'ready',
    mode: 'document',
    service: 'kb-document-creator'
  }));

  registerCreatorRoutes(app, {
    ...options,
    redirectRootToCreator: options.redirectRootToCreator ?? true
  });

  return app;
}
