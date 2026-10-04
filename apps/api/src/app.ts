import Fastify, { type FastifyBaseLogger, type FastifyError } from 'fastify';
import { timingSafeEqual } from 'node:crypto';
import { isIP } from 'node:net';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import type { Pool } from 'pg';
import type { Redis } from 'ioredis';
import { createLogger } from '@rcs/observability';
import { registerSecurity } from './modules/auth/presentation/security.js';
import { registerAuthRoutes } from './modules/auth/presentation/routes.js';
import type { AuthStore } from './modules/auth/domain/contracts.js';
import { PgAuthStore } from './modules/auth/infrastructure/pg-auth-store.js';
import type { WorkspaceStore } from './modules/workspaces/domain/contracts.js';
import { PgWorkspaceStore } from './modules/workspaces/infrastructure/pg-workspace-store.js';
import { registerWorkspaceRoutes } from './modules/workspaces/presentation/routes.js';
import { WorkspaceAccessError, WorkspaceService } from './modules/workspaces/application/workspace-service.js';
import { ProviderRegistry, documentedProviderRegistry } from '@rcs/providers';
import type { CredentialCipher } from '@rcs/security';
import { PgProviderStore } from './modules/providers/infrastructure/pg-provider-store.js';
import { ProviderInputError, ProviderService } from './modules/providers/application/provider-service.js';
import { registerProviderRoutes } from './modules/providers/presentation/routes.js';
import { ProviderBindingError } from './modules/providers/domain/contracts.js';
import { ContactInputError,ContactListInUseError } from './modules/contacts/contracts.js';
import { ContactService } from './modules/contacts/service.js';
import { PgContactStore } from './modules/contacts/store.js';
import { registerContactRoutes } from './modules/contacts/routes.js';
import { ContactConsents,ConsentInputError } from './modules/contacts/consents.js';
import { registerConsentRoutes } from './modules/contacts/consent-routes.js';
import { EligibilityInputError } from './modules/eligibility/contracts.js';
import { EligibilityService } from './modules/eligibility/service.js';
import { PgEligibilityStore } from './modules/eligibility/store.js';
import { registerEligibilityRoutes } from './modules/eligibility/routes.js';
import { MediaInputError } from './modules/media/contracts.js';
import { MediaService } from './modules/media/service.js';
import { PgMediaStore } from './modules/media/store.js';
import { registerMediaRoutes } from './modules/media/routes.js';
import { MessageInputError } from './modules/messages/contracts.js';
import { MessageService } from './modules/messages/service.js';
import { PgMessageStore } from './modules/messages/store.js';
import { registerMessageRoutes } from './modules/messages/routes.js';
import { registerCampaignRoutes } from './modules/campaigns/routes.js';
import { CampaignService } from './modules/campaigns/service.js';
import { PgCampaignStore } from './modules/campaigns/store.js';
import { CampaignInputError } from './modules/campaigns/contracts.js';
import { CampaignSimulation } from './modules/campaigns/simulation.js';
import { registerCampaignSimulationRoutes } from './modules/campaigns/simulation-routes.js';
import { CampaignDispatchPreparation } from './modules/campaigns/dispatch-preparation.js';
import { registerCampaignDispatchPreparationRoutes } from './modules/campaigns/dispatch-preparation-routes.js';
import { createDispatchRuntime } from '@rcs/dispatch';
import { registerCampaignDispatchRoutes } from './modules/campaigns/dispatch-routes.js';
import { EventBus,EventIngressError } from '@rcs/dispatch';
import { registerEventRoutes } from './modules/events/routes.js';
import { JourneyService,JourneyInputError } from '@rcs/dispatch';
import { registerJourneyRoutes } from './modules/journeys/routes.js';
import { JourneyRuntime } from '@rcs/dispatch';
import { registerJourneyRuntimeRoutes } from './modules/journeys/runtime-routes.js';
import { ScoringService } from '@rcs/dispatch';
import { registerScoringRoutes } from './modules/scoring/routes.js';
import { AnalyticsService } from '@rcs/dispatch';
import { registerAnalyticsRoutes } from './modules/analytics/routes.js';
import { InboxService } from '@rcs/dispatch';
import { registerInboxRoutes } from './modules/inbox/routes.js';
import { WebhookActions } from '@rcs/dispatch';
import { registerWebhookActionRoutes } from './modules/webhooks/routes.js';
import { JourneyEntries } from '@rcs/dispatch';
import { registerJourneyEntryRoutes } from './modules/journeys/entry-routes.js';
import { OperationsService } from '@rcs/dispatch';
import { ProviderMediaAccess,ProviderRequests,HistoryMaintenance } from '@rcs/dispatch';
import { registerOperationsRoutes } from './modules/analytics/operations-routes.js';

export function createApp(deps: { db: Pool; redis: Redis; authStore?: AuthStore; workspaceStore?: WorkspaceStore; providerRegistry?: ProviderRegistry; credentialCipher?: CredentialCipher },
  auth: { appUrl: string; secureCookies: boolean; proxySecret?: string }) {
  if (auth.proxySecret && !/^[a-f0-9]{64}$/.test(auth.proxySecret)) throw new Error('Segredo de proxy inválido');
  const app = Fastify({ loggerInstance: createLogger('api') as FastifyBaseLogger, bodyLimit: 1_048_576,
    trustProxy: auth.proxySecret ? (address) => ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(address) : false,
    ajv: { customOptions: { removeAdditional: false, coerceTypes: false } } });

  app.addHook('onRequest', async (request, reply) => {
    if (!auth.proxySecret || request.headers['x-forwarded-for'] === undefined) return;
    const token = request.headers['x-rcs-proxy-token'];
    const ip = request.headers['x-forwarded-for'];
    if (!['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(request.socket.remoteAddress ?? '')
      || typeof token !== 'string' || !/^[a-f0-9]{64}$/.test(token)
      || !timingSafeEqual(Buffer.from(token), Buffer.from(auth.proxySecret))
      || typeof ip !== 'string' || !isIP(ip) || ip.includes('%')) {
      return reply.code(403).header('Cache-Control', 'no-store').send({ message: 'Proxy não autorizado.' });
    }
  });

  app.register(helmet);
  app.register(rateLimit, {
    redis: deps.redis,
    max: 100,
    timeWindow: '1 minute',
    skipOnError: false
  });

  app.setErrorHandler<FastifyError>((error, request, reply) => {
    if (error instanceof JourneyInputError) return reply.code(error.reason === 'invalid' ? 400 : error.reason === 'not_found' ? 404 : 409).send({ message: 'A jornada mudou ou não permite esta operação. Recarregue e confira a validação.' });
    if (error instanceof EventIngressError) return reply.code(error.reason === 'invalid' ? 400 : 503).send({ message: 'Webhook indisponível.' });
    if (error instanceof ConsentInputError) return reply.code(error.reason === 'invalid' ? 400 : error.reason === 'not_found' ? 404 : 409).send({ message: error.reason === 'conflict' ? 'O registro mudou. Recarregue antes de registrar novamente.' : 'Registro de consentimento indisponível.' });
    if (error instanceof MessageInputError) return reply.code(error.reason === 'invalid' ? 400 : error.reason === 'not_found' ? 404 : 409)
      .send({ message: error.reason === 'invalid' ? 'Dados da mensagem inválidos.' : error.reason === 'conflict' ? 'A mensagem mudou ou não permite esta operação. Recarregue e tente novamente.' : 'Mensagem indisponível.' });
    if (error instanceof MediaInputError) return reply.code(error.reason === 'busy' ? 429 : 400).send({ message: error.reason === 'busy' ? 'Aguarde e tente enviar a mídia novamente.' : 'Imagem inválida ou fora dos limites permitidos.' });
    if (error instanceof EligibilityInputError) return reply.code(error.reason === 'not_found' ? 404 : 409).send({ message: 'Consulta de elegibilidade indisponível.' });
    if (error instanceof ContactInputError) return reply.code(400).send({ message: 'Dados de contatos inválidos.' });
    if (error instanceof ProviderBindingError) return reply.code(409).send({ message: 'Vínculo de agente indisponível.' });
    if (error instanceof ProviderInputError) return reply.code(error.reason === 'not_found' ? 404 : error.reason === 'invalid' ? 400 : 409)
      .send({ message: error.reason === 'invalid' ? 'Dados da conexão inválidos.' : 'Provedor ou conexão indisponível.' });
    if (error instanceof ContactListInUseError) return reply.code(409).send({ message: 'A lista é usada por uma campanha e precisa ser preservada.' });
    if (error instanceof CampaignInputError) return reply.code(error.reason === 'invalid' ? 400 : error.reason === 'not_found' ? 404 : 409).send({ message: error.reason === 'invalid' ? 'Dados da campanha inválidos.' : error.reason === 'not_found' ? 'Campanha indisponível.' : 'A campanha mudou ou não permite esta operação. Recarregue e tente novamente.' });
    if (error instanceof WorkspaceAccessError) return reply.code(error.reason === 'not_found' ? 404 : 403)
      .send({ message: error.reason === 'not_found' ? 'Workspace indisponível.' : 'Permissão insuficiente.' });
    if (error.validation) return reply.code(400).send({ message: 'Dados inválidos.' });
    if (error.statusCode && error.statusCode >= 400 && error.statusCode < 500) {
      return reply.code(error.statusCode).send({ message: error.statusCode === 429
        ? 'Muitas tentativas. Tente novamente em um minuto.' : 'Requisição inválida.' });
    }
    request.log.error({ code: error.code ?? 'SERVICE_ERROR' }, 'Falha no processamento da requisição');
    return reply.code(503).send({ message: 'Serviço temporariamente indisponível.' });
  });
  const authStore = deps.authStore ?? new PgAuthStore(deps.db);
  const workspaceStore = deps.workspaceStore ?? new PgWorkspaceStore(deps.db);
  registerSecurity(app, authStore, workspaceStore, auth);
  // Register routes after plugins so their rate-limit onRoute hooks are installed.
  app.after(() => {
    registerAuthRoutes(app, authStore, auth);
    registerWorkspaceRoutes(app, new WorkspaceService(workspaceStore));
    registerOperationsRoutes(app,new OperationsService(deps.db),new HistoryMaintenance(deps.db,deps.credentialCipher));
    registerContactRoutes(app, new ContactService(new PgContactStore(deps.db)));
    registerConsentRoutes(app,new ContactConsents(deps.db));
    registerMediaRoutes(app,new MediaService(new PgMediaStore(deps.db)));
    app.get<{Params:{token:string}}>('/provider-media/:token',{config:{providerMedia:true},schema:{params:{type:'object',additionalProperties:false,required:['token'],properties:{token:{type:'string',pattern:'^[A-Za-z0-9_-]{43}$'}}}}},async(request,reply)=>{
      const media = await new ProviderMediaAccess(deps.db).read(request.params.token);
      if (!media) return reply.code(404).send({message:'Mídia indisponível.'});
      return reply.header('cache-control','private, no-store').header('x-content-type-options','nosniff').header('referrer-policy','no-referrer').type(media.mimeType).send(media.content);
    });
    const registry = deps.providerRegistry ?? documentedProviderRegistry();
    registerEventRoutes(app,new EventBus(deps.db,registry,deps.credentialCipher));
    registerJourneyRoutes(app,new JourneyService(deps.db,registry));
    registerJourneyEntryRoutes(app,new JourneyEntries(deps.db,new EventBus(deps.db,registry,deps.credentialCipher)));
    const webhookActions = new WebhookActions(deps.db,deps.credentialCipher);
    registerWebhookActionRoutes(app,webhookActions);
    registerScoringRoutes(app,new ScoringService(deps.db,new EventBus(deps.db,registry,deps.credentialCipher)));
    registerAnalyticsRoutes(app,new AnalyticsService(deps.db));
    registerInboxRoutes(app,new InboxService(deps.db,new EventBus(deps.db,registry,deps.credentialCipher),deps.credentialCipher));
    registerJourneyRuntimeRoutes(app,new JourneyRuntime(deps.db,registry,new EventBus(deps.db,registry,deps.credentialCipher),Date.now,webhookActions));
    registerMessageRoutes(app,new MessageService(new PgMessageStore(deps.db)),registry);
    registerCampaignRoutes(app,new CampaignService(new PgCampaignStore(deps.db,registry)));
    registerCampaignSimulationRoutes(app,new CampaignSimulation(deps.db));
    registerCampaignDispatchPreparationRoutes(app,new CampaignDispatchPreparation(deps.db,registry));
    registerCampaignDispatchRoutes(app,createDispatchRuntime(deps.db,registry,deps.credentialCipher,Date.now,auth.appUrl));
    const providerStore = new PgProviderStore(deps.db, deps.credentialCipher);
    const requests=new ProviderRequests(deps.db);
    registerProviderRoutes(app, new ProviderService(registry, providerStore,requests.context.bind(requests)));
    registerEligibilityRoutes(app, new EligibilityService(registry, providerStore, new PgEligibilityStore(deps.db),requests.context.bind(requests)));
  });

  app.get('/health/live', { config: { rateLimit: false } }, async () => ({ status: 'ok' }));

  app.get('/health/ready', { config: { rateLimit: false } }, async (_request, reply) => {
    try {
      await Promise.all([deps.db.query('SELECT 1'), deps.redis.ping()]);
      return { status: 'ready' };
    } catch {
      return reply.code(503).send({ status: 'unavailable' });
    }
  });

  return app;
}
