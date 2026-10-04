import { createHmac,randomBytes,randomUUID } from 'node:crypto';
import { readFile,readdir } from 'node:fs/promises';
import {fork} from 'node:child_process';
import { PGlite } from '@electric-sql/pglite';
import { afterAll,beforeAll,beforeEach,describe,expect,it,vi } from 'vitest';
import {Pool,type PoolClient} from 'pg';
import type { Redis } from 'ioredis';
import { MockRcsProvider,ProviderRegistry,activationChecks,type ProviderEvidence,type RcsProvider } from '@rcs/providers';
import { CredentialCipher } from '@rcs/security';
import type { AuthStore } from '../auth/domain/contracts.js';
import type { WorkspaceContext } from '../workspaces/domain/contracts.js';
import { createApp } from '../../app.js';
import { PgMessageStore } from '../messages/store.js';
import {validateMessageInput} from '../messages/validation.js';
import { PgCampaignStore } from './store.js';
import { validateCampaign } from './service.js';
import type { CampaignDraft } from './contracts.js';
import { CampaignSimulation } from './simulation.js';
import { SimulationOutbox } from '@rcs/database';
import { credentialVersion } from '../providers/infrastructure/credential-version.js';
import {PgEligibilityStore} from '../eligibility/store.js';
import { credentialContext } from '../providers/infrastructure/pg-provider-store.js';
import { CampaignDispatch } from './dispatch.js';
import { createDispatchRuntime,EventBus,JourneyService,JourneyRuntime,ScoringService,AnalyticsService,InboxService,WebhookActions,JourneyEntries,OperationsService,type JourneyGraph } from '@rcs/dispatch';
import { CampaignDispatchPreparation,type DispatchPreparationSnapshot } from './dispatch-preparation.js';
import { ContactConsents,type ConsentInput } from '../contacts/consents.js';
import { CampaignDispatchOutbox } from './dispatch-outbox.js';
import {HistoryMaintenance,ProviderMediaAccess,ProviderRequests} from '@rcs/dispatch';
describe('campaign domain SQL and HTTP on PostgreSQL WASM',() => {
  const native=process.env.RUN_NATIVE_DOMAIN_TESTS==='1';const schema=`domain_test_${randomUUID().replaceAll('-','')}`;
  const nativePool=native?new Pool({connectionString:process.env.DATABASE_URL,options:`-c search_path=${schema}`,max:12}):null;
  const database = nativePool ? {query:(sql:string,params?:unknown[])=>nativePool.query(sql,params),exec:(sql:string)=>nativePool.query(sql),close:()=>nativePool.end()} as unknown as PGlite : new PGlite(); let available = Promise.resolve();
  const query = async (sql: string,params?: unknown[]) => { const result = await database.query(sql,params); return { rows: result.rows,rowCount: result.rows.length || result.affectedRows || 0 }; };
  const pool = nativePool ?? { query,connect: async () => { const previous = available; let release!: () => void; available = new Promise<void>((resolve) => { release = resolve; }); await previous; return { query,release }; } } as unknown as Pool;
  const registry = { describe: () => ({ active: true,capabilities: { text: 'supported' },limits: { maxTextCharacters: 10000 } }) } as unknown as ProviderRegistry;
  const store = new PgCampaignStore(pool,registry); const messages = new PgMessageStore(pool);
  let clock = Date.now(); const engine = new CampaignSimulation(pool,() => clock);
  const outbox = new SimulationOutbox(pool,() => clock);
  let alice: WorkspaceContext; let bob: WorkspaceContext; let input: CampaignDraft;
  const basic = validateCampaign({ name: 'Launch',objective: 'Invite customers' });
  beforeAll(async () => {
    if(nativePool)await nativePool.query(`CREATE SCHEMA ${schema}`);
    const directory = new URL('../../../../../packages/database/migrations/',import.meta.url);
    for (const file of (await readdir(directory)).filter((file) => file.endsWith('.sql')).sort()) await database.exec(await readFile(new URL(file,directory),'utf-8'));
  },30000);
  beforeEach(async () => {
    await database.exec('TRUNCATE users,workspaces CASCADE');
    clock = Date.now();
    const seed = async (name: string): Promise<WorkspaceContext> => {
      const user = randomUUID(); const workspace = randomUUID();
      await database.query('INSERT INTO users (id,name,email,password_hash) VALUES ($1,$2,$3,$4)',[user,name,`${name}@example.test`,'unused']);
      await database.query('INSERT INTO workspaces (id,name,slug,created_by_user_id) VALUES ($1,$2,$3,$4)',[workspace,name,name,user]);
      await database.query("INSERT INTO workspace_members (workspace_id,user_id,role) VALUES ($1,$2,'owner')",[workspace,user]);
      return { user_id: user,workspace_id: workspace,role: 'owner',permissions: ['campaigns.manage','campaigns.view','messages.manage','messages.view'] };
    };
    alice = await seed('alice'); bob = await seed('bob');
    const version = await messages.create(alice,{ name: 'Greeting',purpose: 'marketing',content: { type: 'text',text: 'Private content' } });
    await messages.changeStatus(alice,version.message.id,1,'active');
    const provider = randomUUID(); const list = randomUUID();
    await database.query("INSERT INTO provider_connections (id,workspace_id,provider_id,name,environment,status,external_agent_id) VALUES ($1,$2,'fixture','Provider','test','connected','agent-a')",[provider,alice.workspace_id]);
    await database.query("INSERT INTO contact_lists (id,workspace_id,name) VALUES ($1,$2,'Audience')",[list,alice.workspace_id]);
    for (const phone of ['+5511912345678','+5511987654321']) {
      const contact = (await database.query<{ id: string }>('INSERT INTO contacts (workspace_id,phone_normalized) VALUES ($1,$2) RETURNING id',[alice.workspace_id,phone])).rows[0]!;
      await database.query('INSERT INTO contact_list_members (workspace_id,list_id,contact_id) VALUES ($1,$2,$3)',[alice.workspace_id,list,contact.id]);
    }
    await database.query('INSERT INTO opt_outs (workspace_id,phone_normalized) VALUES ($1,$2)',[alice.workspace_id,'+5511912345678']);
    input = { ...basic,providerConnectionId: provider,agentId: 'agent-a',audienceListId: list,messageVersionId: version.current.id };
  });
  afterAll(async () => {if(nativePool){if(!/^domain_test_[a-f0-9]{32}$/.test(schema))throw new Error('Invalid test schema');await nativePool.query(`DROP SCHEMA ${schema} CASCADE`);} await database.close(); });
  it('persists consumer failures with backoff, stops poison events and audits isolated manual recovery',async()=>{
    const f=await eventFixture();await f.bus.ingest('mock',input.providerConnectionId!,f.request);await f.bus.execute((await f.bus.due())[0]!);const job=(await f.bus.pendingCampaignEvents())[0]!;const effect=vi.fn(async()=>{throw new Error('private failure text');});
    for(let i=0;i<5;i++){await expect(f.bus.consume(alice.workspace_id,job.id,'campaigns',effect)).rejects.toThrow();expect(await f.bus.pendingCampaignEvents()).toEqual([]);clock+=30001;}
    expect(await f.bus.consume(alice.workspace_id,job.id,'campaigns',effect)).toBe(false);expect(effect).toHaveBeenCalledTimes(5);
    const ops=new OperationsService(pool,()=>clock);const snapshot=await ops.snapshot(alice);expect(snapshot.failures).toHaveLength(1);expect(JSON.stringify(snapshot)).not.toContain('private failure text');expect((await ops.snapshot(bob)).failures).toEqual([]);
    await expect(ops.requeue(bob,job.id,'campaigns')).rejects.toMatchObject({reason:'conflict'});expect(await ops.requeue(alice,job.id,'campaigns')).toEqual({requeued:true});expect((await f.bus.pendingCampaignEvents())[0]!.attempts).toBe(6);expect(await f.bus.consume(alice.workspace_id,job.id,'campaigns',async()=>{})).toBe(true);expect((await ops.snapshot(alice)).failures).toEqual([]);
    expect((await database.query("SELECT event FROM audit_logs WHERE event='event.consumer_requeued'")).rows).toHaveLength(1);
  });
  it('reports worker freshness without returning instance identities or another tenant data',async()=>{
    const ops=new OperationsService(pool,()=>clock);await database.query("INSERT INTO worker_heartbeats(instance_id,last_seen_at,status) VALUES($1,$2,'healthy')",[randomUUID(),new Date(clock)]);expect((await ops.snapshot(alice)).worker).toBe('healthy');clock+=31000;expect((await ops.snapshot(alice)).worker).toBe('unavailable');
  });
  it('restores the local PostgreSQL WASM archive with immutable journey versions and encrypted events',async()=>{
    const f=await eventFixture();await f.bus.ingest('mock',input.providerConnectionId!,f.request);await f.bus.execute((await f.bus.due())[0]!);const service=new JourneyService(pool,new ProviderRegistry());const journey=await service.create(alice,'Restore fixture');await service.save(alice,journey.id,1,'Restore fixture',journeyGraph());await service.publish(alice,journey.id,2);
    const archive=await database.dumpDataDir();expect(archive.size).toBeGreaterThan(0);const restored=new PGlite({loadDataDir:archive});try{expect((await restored.query<{count:number}>('SELECT count(*)::int AS count FROM canonical_events')).rows[0]!.count).toBe(1);expect((await restored.query<{count:number}>('SELECT count(*)::int AS count FROM journey_versions')).rows[0]!.count).toBe(1);await expect(restored.query('UPDATE journey_versions SET graph=$1',[JSON.stringify(journeyGraph())])).rejects.toThrow('immutable');const row=(await restored.query<{payload_ciphertext:string}>('SELECT payload_ciphertext FROM canonical_events')).rows[0]!;expect(row.payload_ciphertext).not.toContain('+5511987654321');}finally{await restored.close();}
  },30000);
  it('processes 100 independent leads through persisted entry and runtime batches without duplicate transitions',async()=>{
    const f=await eventFixture();await addRecipients(100);const service=new JourneyService(pool,new ProviderRegistry());const journey=await service.create(alice,'Load fixture');await service.save(alice,journey.id,1,'Load fixture',journeyGraph());await service.publish(alice,journey.id,2);await service.control(alice,journey.id,3,'activate');const entries=new JourneyEntries(pool,f.bus,()=>clock);const runtime=new JourneyRuntime(pool,new ProviderRegistry(),f.bus,()=>clock);await entries.batch(alice,journey.id,'contact_list',input.audienceListId!,randomUUID());
    for(let round=0;round<10;round++){for(const job of await entries.due()){await entries.execute(job);expect(await entries.execute(job)).toBe('ignored');}}
    for(let round=0;round<15;round++){for(const job of await runtime.due()){await runtime.execute(job);expect(await runtime.execute(job)).toBe('ignored');}}
    const snapshot=await runtime.list(alice,journey.id);expect(snapshot.enrollments).toHaveLength(50);const counts=(await database.query<{count:number}>("SELECT count(*)::int AS count FROM journey_enrollments WHERE journey_id=$1 AND status='completed'",[journey.id])).rows[0]!.count;expect(counts).toBe(101);expect((await database.query<{count:number}>('SELECT count(*)::int AS count FROM journey_transitions WHERE enrollment_id IN (SELECT id FROM journey_enrollments WHERE journey_id=$1)',[journey.id])).rows[0]!.count).toBe(202);
  },30000);
  const addRecipients = async (count: number) => {
    await database.query("INSERT INTO contacts (workspace_id,phone_normalized) SELECT $1,'+55119'||lpad(n::text,8,'0') FROM generate_series(1,$2::int) n",[alice.workspace_id,count]);
    await database.query('INSERT INTO contact_list_members (workspace_id,list_id,contact_id) SELECT $1,$2,id FROM contacts WHERE workspace_id=$1 ON CONFLICT DO NOTHING',[alice.workspace_id,input.audienceListId]);
  };
  const cachedReviewStore = (support: 'supported' | 'unknown' = 'supported') => new PgCampaignStore(pool,{ describe: () => ({ active: true,capabilities: { text: 'supported',rich_card: 'supported',media: 'supported',eligibility: support },limits: {} }),resolve: () => { throw new Error('Must not call providers'); } } as unknown as ProviderRegistry,() => clock);
  const seedCredentialVersion = async () => {
    await database.query("INSERT INTO provider_credentials (workspace_id,connection_id,ciphertext) VALUES ($1,$2,'private-opaque-test-ciphertext')",[alice.workspace_id,input.providerConnectionId]);
    const row = (await database.query<{ revision: string }>('SELECT EXTRACT(EPOCH FROM updated_at)::text AS revision FROM provider_connections WHERE id=$1',[input.providerConnectionId])).rows[0]!;
    return credentialVersion('private-opaque-test-ciphertext',row.revision);
  };
  const seedCheck = async (phone: string,status: string,version: string,expires = clock+300000,phoneSnapshot: string | null = phone) => {
    await database.query(`INSERT INTO eligibility_checks (workspace_id,connection_id,contact_id,credential_version,attempt_id,status,reason,checked_at,expires_at,phone_normalized) SELECT workspace_id,$2,id,$3,$4,$5,$6,$7,$8,$9 FROM contacts WHERE workspace_id=$1 AND phone_normalized=$10`,[alice.workspace_id,input.providerConnectionId,version,randomUUID(),status,status === 'unknown' ? 'provider_unavailable' : 'provider_checked',new Date(Math.min(clock,expires)-1000),new Date(expires),phoneSnapshot,phone]);
  };
  const dispatchFixture = async (mode: 'dispatch' | 'simulation' = 'dispatch',confirmed = true,grantConsent = true) => {
    const encryptionKey=randomBytes(32);const cipher = new CredentialCipher('test',{ test: encryptionKey });
    const credentials = { webhookSecret: 'synthetic-dispatch-secret-at-least-32-characters' };
    const connection = (await database.query<{ id: string; workspace_id: string; provider_id: string; environment: string; revision: string }>('SELECT id,workspace_id,provider_id,environment,EXTRACT(EPOCH FROM updated_at)::text AS revision FROM provider_connections WHERE id=$1',[input.providerConnectionId])).rows[0]!;
    const ciphertext = cipher.encrypt(JSON.stringify(credentials),credentialContext(connection));
    await database.query('INSERT INTO provider_credentials (workspace_id,connection_id,ciphertext) VALUES ($1,$2,$3)',[alice.workspace_id,connection.id,ciphertext]);
    await seedCheck('+5511987654321','eligible',credentialVersion(ciphertext,connection.revision));
    const mock = new MockRcsProvider(); const metadata = mock.getProviderMetadata(); const caps = { ...mock.getProviderCapabilities(),eligibility: 'supported' as const };
    const send = vi.fn<RcsProvider['send']>(async () => ({ accepted: true,providerMessageId: 'provider-accepted' }));
    const getAgent = vi.fn<RcsProvider['getAgent']>(async () => ({ id: 'agent-a',name: 'Fixture',status: 'active' }));
    const getAgentCapabilities = vi.fn<RcsProvider['getAgentCapabilities']>(async () => caps);
    const adapter = Object.assign(mock,{ getProviderMetadata: () => ({ ...metadata,id: 'fixture' }),getProviderCapabilities: () => caps,checkEligibility: async () => true,getExternalAgentId: () => 'agent-a',getAgent,getAgentCapabilities,send });
    const registry = new ProviderRegistry(); registry.register(adapter,{ documentPath: 'docs/providers/mock.md',reviewedAt: '2026-10-04',references: ['https://example.test/local-fixture'],checks: Object.fromEntries(activationChecks.map((key) => [key,true])) as ProviderEvidence['checks'] });
    const campaign = await store.create(alice,input);
    const preparation = new CampaignDispatchPreparation(pool,registry,() => clock);
    let snapshot: DispatchPreparationSnapshot;
    if (mode === 'simulation') {
      const simulation = await engine.prepare(alice,campaign.id,campaign.revision);
      snapshot = { runId: simulation.run.id,campaignId: campaign.id,revision: simulation.campaign.revision,status: simulation.campaign.status,confirmed: false,counts: { total: 2,eligible: 1,suppressed: 1,unavailable: 0 },executionAvailable: false };
    } else {
      const prepared = await preparation.prepare(alice,campaign.id,campaign.revision);
      snapshot = confirmed ? await preparation.confirm(alice,campaign.id,prepared.revision,prepared.runId,'dispatch') : prepared;
    }
    campaign.revision = snapshot.revision;
    const contact = (await database.query<{ id: string }>("SELECT id FROM contacts WHERE workspace_id=$1 AND phone_normalized='+5511987654321'",[alice.workspace_id])).rows[0]!.id;
    const consents = new ContactConsents(pool,() => clock);
    if (grantConsent) await consents.record(alice,contact,{ purpose: 'marketing',state: 'granted',source: 'manual_record',evidenceReference: 'synthetic-fixture-evidence',observedAt: new Date(clock-1000).toISOString(),expectedRevision: 0,expectedPhone: '+5511987654321' });
    const dispatchEngine = new CampaignDispatch(pool,registry,cipher,() => clock);
    const dispatch = (signal = new AbortController().signal) => dispatchEngine.dispatch(alice,campaign.id,contact,campaign.revision,signal);
    return { engine: dispatchEngine,dispatch,campaign,contact,send,getAgent,getAgentCapabilities,cipher,ciphertext,credentials,encryptionKey,preparation,snapshot,registry,consents,queue: new CampaignDispatchOutbox(pool,dispatchEngine,() => clock) };
  };
  const journeyGraph = (): JourneyGraph => ({ nodes: [{ id: 'start',type: 'start',position: { x: 0,y: 0 },config: {} },{ id: 'end',type: 'end',position: { x: 300,y: 0 },config: {} }],edges: [{ id: 'edge',source: 'start',target: 'end',port: 'next' }],viewport: { x: 0,y: 0,zoom: 1 } });
  it('paces the same connection across campaigns without consuming retries and finalizes processed campaigns',async()=>{
    const f=await dispatchFixture();await f.queue.enqueue(alice,f.campaign.id,f.campaign.revision,f.snapshot.runId);const second=await store.create(alice,input);const prepared=await f.preparation.prepare(alice,second.id,second.revision);const confirmed=await f.preparation.confirm(alice,second.id,prepared.revision,prepared.runId,'dispatch');await f.queue.enqueue(alice,second.id,confirmed.revision,confirmed.runId);const jobs=await f.queue.due();expect(jobs).toHaveLength(2);expect(await f.queue.execute(jobs[0]!)).toBe('completed');expect(await f.queue.execute(jobs[1]!)).toBe('pending');expect(f.send).toHaveBeenCalledOnce();expect((await database.query<{attempts:number}>('SELECT attempts FROM campaign_dispatch_outbox WHERE id=$1',[jobs[1]!.id])).rows[0]!.attempts).toBe(0);expect(await f.queue.due()).toEqual([]);clock+=1000;expect(await f.queue.execute((await f.queue.due())[0]!)).toBe('completed');expect(f.send).toHaveBeenCalledTimes(2);expect((await database.query<{status:string}>('SELECT status FROM campaigns WHERE id IN ($1,$2)',[f.campaign.id,second.id])).rows.every(row=>row.status==='completed')).toBe(true);
  });
  it('pauses and resumes unsent dispatch jobs with fresh revisions while preserving their snapshots',async()=>{
    const f=await dispatchFixture();const enqueued=await f.queue.enqueue(alice,f.campaign.id,f.campaign.revision,f.snapshot.runId);const old=(await f.queue.due())[0]!;
    expect(await f.queue.control(alice,f.campaign.id,enqueued.revision,'pause')).toMatchObject({status:'paused',revision:enqueued.revision+1});expect(await f.queue.due()).toEqual([]);expect(await f.queue.execute(old)).toBe('ignored');expect(f.send).not.toHaveBeenCalled();
    await expect(f.queue.control(alice,f.campaign.id,enqueued.revision,'resume')).rejects.toMatchObject({reason:'conflict'});const resumed=await f.queue.control(alice,f.campaign.id,enqueued.revision+1,'resume');expect(resumed.status).toBe('ready');expect(await f.queue.execute((await f.queue.due())[0]!)).toBe('completed');expect(f.send).toHaveBeenCalledOnce();expect((await database.query<{campaign_revision:number}>('SELECT campaign_revision FROM campaign_dispatch_attempts')).rows[0]!.campaign_revision).toBe(resumed.revision);
  });
  it('stops unsent dispatch permanently and isolates controls by workspace and current role',async()=>{
    const f=await dispatchFixture();const enqueued=await f.queue.enqueue(alice,f.campaign.id,f.campaign.revision,f.snapshot.runId);await expect(f.queue.control(bob,f.campaign.id,enqueued.revision,'stop')).rejects.toMatchObject({reason:'not_found'});
    await database.query("UPDATE workspace_members SET role='viewer' WHERE workspace_id=$1",[alice.workspace_id]);await expect(f.queue.control(alice,f.campaign.id,enqueued.revision,'stop')).rejects.toMatchObject({reason:'forbidden'});await database.query("UPDATE workspace_members SET role='owner' WHERE workspace_id=$1",[alice.workspace_id]);expect(await f.queue.control(alice,f.campaign.id,enqueued.revision,'stop')).toMatchObject({status:'cancelled'});expect(await f.queue.due()).toEqual([]);expect(f.send).not.toHaveBeenCalled();await expect(f.queue.control(alice,f.campaign.id,enqueued.revision+1,'resume')).rejects.toMatchObject({reason:'conflict'});
  });
  it('a pause during provider inspection preserves the reserved ledger and prevents the send',async()=>{
    const f=await dispatchFixture();const enqueued=await f.queue.enqueue(alice,f.campaign.id,f.campaign.revision,f.snapshot.runId);f.getAgent.mockImplementationOnce(async()=>{await f.queue.control(alice,f.campaign.id,enqueued.revision,'pause');return {id:'agent-a',name:'fixture',status:'active'};});expect(await f.queue.execute((await f.queue.due())[0]!)).toBe('completed');expect(f.send).not.toHaveBeenCalled();expect((await database.query<{status:string}>('SELECT status FROM campaign_dispatch_attempts')).rows[0]!.status).toBe('rejected');expect((await database.query<{status:string}>('SELECT status FROM campaigns WHERE id=$1',[f.campaign.id])).rows[0]!.status).toBe('paused');
  });
  it('rolls dispatch controls and job revisions back when audit cannot be committed',async()=>{
    const f=await dispatchFixture();const enqueued=await f.queue.enqueue(alice,f.campaign.id,f.campaign.revision,f.snapshot.runId);await database.exec("CREATE FUNCTION reject_dispatch_control() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.event='campaign.dispatch_controlled' THEN RAISE EXCEPTION 'audit unavailable'; END IF; RETURN NEW; END $$; CREATE TRIGGER reject_dispatch_control BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION reject_dispatch_control();");try{await expect(f.queue.control(alice,f.campaign.id,enqueued.revision,'pause')).rejects.toThrow('audit unavailable');expect((await database.query<{status:string;revision:number}>('SELECT status,revision FROM campaigns WHERE id=$1',[f.campaign.id])).rows[0]).toMatchObject({status:'ready',revision:enqueued.revision});expect((await database.query<{expected_revision:number}>('SELECT expected_revision FROM campaign_dispatch_outbox')).rows[0]!.expected_revision).toBe(enqueued.revision);}finally{await database.exec('DROP TRIGGER reject_dispatch_control ON audit_logs; DROP FUNCTION reject_dispatch_control()');}
  });
  const runtimeFixture = async (graph = journeyGraph()) => {
    const f = await dispatchFixture(); const bus = new EventBus(pool,f.registry,f.cipher,() => clock); const service = new JourneyService(pool,f.registry); const journey = await service.create(alice,'Lead funnel'); await service.save(alice,journey.id,1,'Lead funnel',graph); await service.publish(alice,journey.id,2); await service.control(alice,journey.id,3,'activate'); const runtime = new JourneyRuntime(pool,f.registry,bus,() => clock); return { ...f,bus,service,journey,runtime };
  };
  const messageJourneyFixture = async () => {
    const f = await dispatchFixture(); const graph = journeyGraph(); const config = { messageVersionId: input.messageVersionId!,connectionId: input.providerConnectionId!,agentId: 'agent-a' };
    graph.nodes.splice(1,0,{ id: 'first',type: 'message',position: { x: 100,y: 0 },config },{ id: 'second',type: 'message',position: { x: 200,y: 0 },config }); graph.edges = [{ id: 'a',source: 'start',target: 'first',port: 'next' },{ id: 'b',source: 'first',target: 'second',port: 'next' },{ id: 'c',source: 'second',target: 'end',port: 'next' }];
    const bus = new EventBus(pool,f.registry,f.cipher,() => clock); const service = new JourneyService(pool,f.registry); const journey = await service.create(alice,'Two messages'); await service.save(alice,journey.id,1,'Two messages',graph); await service.publish(alice,journey.id,2); await service.control(alice,journey.id,3,'activate'); const runtime = new JourneyRuntime(pool,f.registry,bus,() => clock); const enrollment = await runtime.enroll(alice,journey.id,f.contact); await runtime.execute((await runtime.due())[0]!); await runtime.execute((await runtime.due())[0]!); return { ...f,bus,service,journey,runtime,enrollment,graph };
  };
  const webhookJourneyFixture = async () => {
    const f = await runtimeFixture(); const transport = vi.fn<NonNullable<ConstructorParameters<typeof WebhookActions>[3]>>(async () => 204); const actions = new WebhookActions(pool,f.cipher,() => clock,transport); const endpoint = await actions.save(alice,{ name: 'CRM',expectedRevision: 0,status: 'active',config: { url: 'https://crm.example.com/hooks',authorization: 'Bearer synthetic-secret' } }); const graph=journeyGraph(); graph.nodes.splice(1,0,{ id: 'hook',type: 'webhook',position: { x: 100,y: 0 },config: { endpointId: endpoint.id } }); graph.edges[0]!.target='hook'; graph.edges.push({ id: 'after',source: 'hook',target: 'end',port: 'next' }); const journey=await f.service.create(alice,'CRM action'); await f.service.save(alice,journey.id,1,'CRM action',graph); await f.service.publish(alice,journey.id,2); await f.service.control(alice,journey.id,3,'activate'); const runtime = new JourneyRuntime(pool,f.registry,f.bus,() => clock,actions); const enrollment=await runtime.enroll(alice,journey.id,f.contact); await runtime.execute((await runtime.due())[0]!); await runtime.execute((await runtime.due())[0]!); return { ...f,journey,runtime,enrollment,actions,endpoint,transport };
  };
  it.skipIf(!native)('native independent processes reserve one durable dispatch and never repeat the provider send',async()=>{
    const f=await dispatchFixture();let sends=0;
    const inputData={schema,context:alice,campaignId:f.campaign.id,contactId:f.contact,revision:f.campaign.revision,key:f.encryptionKey.toString('base64'),clock};
    const results=await Promise.all(Array.from({length:6},()=>new Promise<string>((resolve,reject)=>{
      const child=fork(new URL('../../native-dispatch-child.mjs',import.meta.url),[],{stdio:['ignore','ignore','ignore','ipc']});const timeout=setTimeout(()=>{child.kill();reject(new Error('Child timeout'));},20000);
      child.on('message',(message:unknown)=>{const value=message as {type:string;status?:string};if(value.type==='send')sends++;if(value.type==='result'){clearTimeout(timeout);resolve(value.status!);}if(value.type==='error'){clearTimeout(timeout);resolve('error');}});child.on('error',reject);child.on('exit',code=>{if(code){clearTimeout(timeout);reject(new Error('Child exited'));}});child.send(inputData);
    })));
    expect(sends).toBe(1);expect(results).toHaveLength(6);expect(results.every(status=>['accepted','sending'].includes(status))).toBe(true);expect((await database.query('SELECT status FROM campaign_dispatch_attempts')).rows).toEqual([{status:'accepted'}]);
  },30000);
  it('pins outbound endpoint versions, encrypts secrets and posts an action at most once',async () => {
    const f=await webhookJourneyFixture(); await f.actions.save(alice,{ id: f.endpoint.id,name: 'CRM v2',expectedRevision: 1,status: 'active',config: { url: 'https://new-crm.example.com/hooks',authorization: 'Bearer new-secret' } }); const job=(await f.actions.due())[0]!; expect(await f.actions.execute(job,new AbortController().signal)).toBe('accepted'); expect(await f.actions.execute(job,new AbortController().signal)).toBe('ignored'); expect(f.transport).toHaveBeenCalledOnce(); expect(f.transport.mock.calls[0]![0]).toMatchObject({ url: 'https://crm.example.com/hooks' }); expect(JSON.stringify((await database.query('SELECT * FROM webhook_endpoint_versions')).rows)).not.toMatch(/synthetic-secret|new-secret|crm\.example/); clock+=2000; expect(await f.runtime.execute((await f.runtime.due())[0]!)).toBe('active'); expect(await f.runtime.execute((await f.runtime.due())[0]!)).toBe('completed'); await expect(database.query('DELETE FROM journey_webhook_actions')).rejects.toThrow('immutable');
  });
  it('holds unstarted outbound actions while paused and cancels when authority is revoked',async () => {
    const f=await webhookJourneyFixture(); await f.service.control(alice,f.journey.id,4,'pause'); expect(await f.actions.due()).toEqual([]); const job=(await database.query<{ id: string; workspace_id: string; attempts: number }>('SELECT id,workspace_id,0 AS attempts FROM journey_webhook_actions')).rows[0]!; expect(await f.actions.execute(job,new AbortController().signal)).toBe('ignored'); await f.service.control(alice,f.journey.id,5,'resume'); await database.query("UPDATE workspace_members SET role='viewer' WHERE workspace_id=$1",[alice.workspace_id]); expect(await f.actions.execute(job,new AbortController().signal)).toBe('ignored'); expect(f.transport).not.toHaveBeenCalled(); expect((await database.query<{ status: string }>('SELECT status FROM journey_webhook_actions')).rows[0]!.status).toBe('cancelled');
  });
  it('never automatically repeats an ambiguous outbound POST',async () => {
    const f=await webhookJourneyFixture(); f.transport.mockRejectedValue(new Error('Connection lost after POST')); const job=(await f.actions.due())[0]!; expect(await f.actions.execute(job,new AbortController().signal)).toBe('unknown'); expect(await f.actions.due()).toEqual([]); expect(await f.actions.execute(job,new AbortController().signal)).toBe('ignored'); clock+=2000; expect(await f.runtime.execute((await f.runtime.due())[0]!)).toBe('failed'); expect(f.transport).toHaveBeenCalledOnce();
  });
  it('recovers an interrupted outbound reservation without another POST',async () => {
    const f=await webhookJourneyFixture(); const job=(await f.actions.due())[0]!; await database.query("UPDATE journey_webhook_actions SET status='sending',updated_at=$2 WHERE id=$1",[job.id,new Date(clock-31000)]); expect((await f.actions.due())[0]).toMatchObject(job); expect(await f.actions.execute(job,new AbortController().signal)).toBe('ignored'); expect((await database.query<{ status: string }>('SELECT status FROM journey_webhook_actions')).rows[0]!.status).toBe('unknown'); expect(f.transport).not.toHaveBeenCalled();
  });
  it('rolls back outbound reservation before any network call when audit is unavailable',async () => {
    const f=await webhookJourneyFixture(); const job=(await f.actions.due())[0]!; await database.exec("CREATE FUNCTION reject_webhook_action_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.event='journey.webhook_reserved' THEN RAISE EXCEPTION 'audit unavailable'; END IF; RETURN NEW; END $$; CREATE TRIGGER reject_webhook_action_audit BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION reject_webhook_action_audit();"); try { await expect(f.actions.execute(job,new AbortController().signal)).rejects.toThrow('audit unavailable'); expect((await database.query<{ status: string }>('SELECT status FROM journey_webhook_actions')).rows[0]!.status).toBe('pending'); expect(f.transport).not.toHaveBeenCalled(); } finally { await database.exec('DROP TRIGGER reject_webhook_action_audit ON audit_logs; DROP FUNCTION reject_webhook_action_audit()'); }
  });
  it('queues list entries durably, rechecks opt-outs and ignores duplicate batches',async () => {
    const f=await runtimeFixture(); const entries=new JourneyEntries(pool,f.bus,() => clock); const requestId=randomUUID(); expect(await entries.batch(alice,f.journey.id,'contact_list',input.audienceListId!,requestId)).toEqual({ duplicate: false,queued: 2 }); expect(await entries.batch(alice,f.journey.id,'contact_list',input.audienceListId!,requestId)).toEqual({ duplicate: true,queued: 0 }); await expect(entries.batch(bob,f.journey.id,'contact_list',input.audienceListId!,randomUUID())).rejects.toMatchObject({ reason: 'conflict' });
    const statuses=[]; for (const job of await entries.due()) { statuses.push(await entries.execute(job)); expect(await entries.execute(job)).toBe('ignored'); } expect(statuses.sort()).toEqual(['completed','discarded']); expect((await f.runtime.list(alice,f.journey.id)).total).toBe(1); await expect(database.query('DELETE FROM journey_entry_outbox')).rejects.toThrow('immutable');
  });
  it('pins entry versions, pauses pending entries and rejects changed phone identities',async () => {
    const f=await runtimeFixture(); const entries=new JourneyEntries(pool,f.bus,() => clock); await entries.enqueueApi(alice,f.journey.id,f.contact,randomUUID()); const job=(await entries.due())[0]!; await f.service.control(alice,f.journey.id,4,'pause'); expect(await entries.due()).toEqual([]); expect(await entries.execute(job)).toBe('ignored'); await f.service.control(alice,f.journey.id,5,'resume'); await f.service.save(alice,f.journey.id,6,'New version',journeyGraph()); await f.service.publish(alice,f.journey.id,7); expect(await entries.execute(job)).toBe('completed'); expect((await database.query<{ version: number }>('SELECT v.version FROM journey_enrollments e JOIN journey_versions v ON v.workspace_id=e.workspace_id AND v.id=e.version_id')).rows[0]!.version).toBe(1);
    const another=(await database.query<{ id: string }>("INSERT INTO contacts(workspace_id,phone_normalized) VALUES($1,'+5511976543210') RETURNING id",[alice.workspace_id])).rows[0]!.id; await entries.enqueueApi(alice,f.journey.id,another,randomUUID()); await database.query("UPDATE contacts SET phone_normalized='+5511999999999' WHERE id=$1",[another]); expect(await entries.execute((await entries.due())[0]!)).toBe('discarded');
  });
  it('enrolls through tag events once and applies configurable duplicate policy to manual entries',async () => {
    const f=await runtimeFixture(); const entries=new JourneyEntries(pool,f.bus,() => clock); await entries.saveSettings(alice,f.journey.id,4,'interested','prevent_any_duplicate'); const id=await f.bus.publishDomain(pool as unknown as PoolClient,alice.workspace_id,'contact.tag_added',f.contact,randomUUID(),{ tag: 'interested' }); const job={ id,workspace_id: alice.workspace_id,attempts: 0 }; expect(await f.runtime.consumeEvent(job)).toBe(true); expect(await f.runtime.consumeEvent(job)).toBe(false); expect(await entries.execute((await entries.due())[0]!)).toBe('completed'); for (let i=0;i<2;i++) await f.runtime.execute((await f.runtime.due())[0]!); await expect(f.runtime.enroll(alice,f.journey.id,f.contact)).rejects.toMatchObject({ reason: 'conflict' });
    await entries.enqueueApi(alice,f.journey.id,f.contact,randomUUID()); expect(await entries.execute((await entries.due())[0]!)).toBe('discarded');
  });
  const eventWaitFixture=async () => {
    const f=await dispatchFixture(); const graph=journeyGraph(); graph.nodes.splice(1,0,{ id: 'message',type: 'message',position: { x: 100,y: 0 },config: { messageVersionId: input.messageVersionId!,connectionId: input.providerConnectionId!,agentId: 'agent-a' } },{ id: 'read',type: 'condition',position: { x: 200,y: 0 },config: { source: 'message_event',field: 'message.read',operator: 'exists',waitForEvent: true,timeoutMinutes: 1 } },{ id: 'goal',type: 'goal',position: { x: 300,y: 0 },config: { goal: 'read_offer',stop: true } }); graph.edges=[{ id: 'a',source: 'start',target: 'message',port: 'next' },{ id: 'b',source: 'message',target: 'read',port: 'next' },{ id: 'c',source: 'read',target: 'goal',port: 'true' },{ id: 'd',source: 'read',target: 'end',port: 'false' }]; const bus=new EventBus(pool,f.registry,f.cipher,() => clock); const service=new JourneyService(pool,f.registry); const journey=await service.create(alice,'Await read'); await service.save(alice,journey.id,1,'Await read',graph); await service.publish(alice,journey.id,2); await service.control(alice,journey.id,3,'activate'); const runtime=new JourneyRuntime(pool,f.registry,bus,() => clock); const enrollment=await runtime.enroll(alice,journey.id,f.contact); await runtime.execute((await runtime.due())[0]!); await runtime.execute((await runtime.due())[0]!); await f.queue.execute((await f.queue.due())[0]!); clock+=2000; await runtime.execute((await runtime.due())[0]!); expect(await runtime.execute((await runtime.due())[0]!)).toBe('waiting'); return { ...f,bus,service,journey,runtime,enrollment };
  };
  it('resumes a persisted event wait early and invalidates the previous timer generation',async () => {
    const f=await eventWaitFixture(); const old=(await database.query<{ enrollment_id: string; workspace_id: string; revision: number }>('SELECT id AS enrollment_id,workspace_id,revision FROM journey_enrollments')).rows[0]!; expect(await f.runtime.due()).toEqual([]); const event={ id: randomUUID(),type: 'message.read' as const,workspaceId: alice.workspace_id,connectionId: input.providerConnectionId!,providerId: 'fixture',occurredAt: new Date(clock).toISOString(),recipient: '+5511987654321',providerMessageId: 'provider-accepted' }; const adapter=f.registry.resolve('fixture'); vi.spyOn(adapter,'verifyWebhook').mockResolvedValue(true); vi.spyOn(adapter,'parseWebhook').mockResolvedValue([event]); vi.spyOn(adapter,'normalizeEvent').mockReturnValue(event); await f.bus.ingest('fixture',input.providerConnectionId!,{ rawBody: Buffer.from('{}'),headers: {} }); await f.bus.execute((await f.bus.due())[0]!); const id=(await database.query<{ id: string }>("SELECT id FROM canonical_events WHERE event_type='message.read'")).rows[0]!.id; await f.runtime.consumeEvent({ id,workspace_id: alice.workspace_id,attempts: 0 }); expect(await f.runtime.execute(old)).toBe('ignored'); expect(await f.runtime.execute((await f.runtime.due())[0]!)).toBe('active'); expect(await f.runtime.execute((await f.runtime.due())[0]!)).toBe('converted');
  });
  it('takes the false path only after the persisted event timeout',async () => {
    const f=await eventWaitFixture(); clock+=59999; expect(await f.runtime.due()).toEqual([]); clock+=1; expect(await new JourneyRuntime(pool,f.registry,f.bus,() => clock).execute((await f.runtime.due())[0]!)).toBe('active'); expect(await f.runtime.execute((await f.runtime.due())[0]!)).toBe('completed'); expect((await database.query('SELECT * FROM journey_goals')).rows).toHaveLength(0);
  });
  it('routes an explicit button destination only through a path in the pinned current journey node',async()=>{
    const graph=journeyGraph();graph.nodes.splice(1,0,{id:'choose',type:'branch',position:{x:100,y:0},config:{paths:[{key:'interested',condition:{source:'contact',field:'name',operator:'equals',value:'never-match'}}]}},{id:'goal',type:'goal',position:{x:200,y:0},config:{goal:'selected_path',stop:true}});graph.edges=[{id:'a',source:'start',target:'choose',port:'next'},{id:'b',source:'choose',target:'goal',port:'interested'},{id:'c',source:'choose',target:'end',port:'default'}];
    const f=await runtimeFixture(graph);const enrollment=await f.runtime.enroll(alice,f.journey.id,f.contact);await database.query('UPDATE journey_enrollments SET context=$2 WHERE id=$1',[enrollment.id,JSON.stringify({messageEvents:{actionPayload:`journey_branch:${f.journey.id}:choose:interested`}})]);await f.runtime.execute((await f.runtime.due())[0]!);await f.runtime.execute((await f.runtime.due())[0]!);expect(await f.runtime.execute((await f.runtime.due())[0]!)).toBe('converted');
    const next=await f.runtime.enroll(alice,f.journey.id,f.contact);await database.query('UPDATE journey_enrollments SET context=$2 WHERE id=$1',[next.id,JSON.stringify({messageEvents:{actionPayload:`journey_branch:${randomUUID()}:choose:interested`}})]);await f.runtime.execute((await f.runtime.due())[0]!);await f.runtime.execute((await f.runtime.due())[0]!);expect(await f.runtime.execute((await f.runtime.due())[0]!)).toBe('completed');
  });
  it('binds button replies to the latest accepted host attempt and refuses foreign or nonexistent attempts',async()=>{
    const f=await eventWaitFixture();const attempt=(await database.query<{id:string}>('SELECT id FROM campaign_dispatch_attempts')).rows[0]!.id;
    const event={id:randomUUID(),type:'action.selected' as const,workspaceId:alice.workspace_id,connectionId:input.providerConnectionId!,providerId:'fixture',occurredAt:new Date(clock).toISOString(),recipient:'+5511987654321',dispatchKey:`dispatch-${attempt}`,actionPayload:'yes'};
    const adapter=f.registry.resolve('fixture');vi.spyOn(adapter,'verifyWebhook').mockResolvedValue(true);vi.spyOn(adapter,'parseWebhook').mockResolvedValue([event]);vi.spyOn(adapter,'normalizeEvent').mockReturnValue(event);
    await f.bus.ingest('fixture',input.providerConnectionId!,{rawBody:Buffer.from('{}'),headers:{}});await f.bus.execute((await f.bus.due())[0]!);const id=(await database.query<{id:string}>("SELECT id FROM canonical_events WHERE event_type='action.selected'")).rows[0]!.id;
    await f.runtime.consumeEvent({id,workspace_id:alice.workspace_id,attempts:0});expect((await database.query<{context:{messageEvents:Record<string,boolean>}}>('SELECT context FROM journey_enrollments')).rows[0]!.context.messageEvents['action.selected']).toBe(true);
    const unknown={...event,id:randomUUID(),dispatchKey:`dispatch-${randomUUID()}`};vi.mocked(adapter.parseWebhook).mockResolvedValue([unknown]);vi.mocked(adapter.normalizeEvent).mockReturnValue(unknown);await f.bus.ingest('fixture',input.providerConnectionId!,{rawBody:Buffer.from('{"new":1}'),headers:{}});await f.bus.execute((await f.bus.due())[0]!);const foreign=(await database.query<{id:string}>("SELECT id FROM canonical_events WHERE provider_event_id=$1",[unknown.id])).rows[0]!.id;const before=(await database.query('SELECT revision FROM journey_enrollments')).rows;
    await f.runtime.consumeEvent({id:foreign,workspace_id:alice.workspace_id,attempts:0});expect((await database.query('SELECT revision FROM journey_enrollments')).rows).toEqual(before);
  });
  it('sends distinct journey messages as the lead advances using durable campaign attempts',async () => {
    const f = await messageJourneyFixture(); f.send.mockResolvedValueOnce({ accepted: true,providerMessageId: 'first-message' }).mockResolvedValueOnce({ accepted: true,providerMessageId: 'second-message' });
    expect((await f.runtime.list(alice,f.journey.id)).enrollments[0]!.status).toBe('waiting'); expect(f.send).not.toHaveBeenCalled();
    const firstJob = (await f.queue.due())[0]!; expect(await f.queue.execute(firstJob)).toBe('completed'); expect(await f.queue.execute(firstJob)).toBe('ignored'); clock+=2000;
    expect(await f.runtime.execute((await f.runtime.due())[0]!)).toBe('active'); expect(await f.runtime.execute((await f.runtime.due())[0]!)).toBe('waiting');
    expect(await f.queue.execute((await f.queue.due())[0]!)).toBe('completed'); clock+=2000; expect(await f.runtime.execute((await f.runtime.due())[0]!)).toBe('active'); expect(await f.runtime.execute((await f.runtime.due())[0]!)).toBe('completed');
    expect(f.send).toHaveBeenCalledTimes(2); expect(new Set(f.send.mock.calls.map((call) => call[1].idempotencyKey)).size).toBe(2);
    expect((await database.query('SELECT node_id FROM journey_message_actions ORDER BY node_id')).rows).toEqual([{ node_id: 'first' },{ node_id: 'second' }]);
  });
  it('holds unsent journey messages during pause and continues after explicit resume',async () => {
    const f = await messageJourneyFixture(); await f.service.control(alice,f.journey.id,4,'pause'); expect(await f.queue.due()).toEqual([]); expect(await f.runtime.due()).toEqual([]); expect(f.send).not.toHaveBeenCalled();
    await f.service.control(alice,f.journey.id,5,'resume'); expect(await f.queue.execute((await f.queue.due())[0]!)).toBe('completed'); expect(f.send).toHaveBeenCalledOnce();
  });
  it('blocks later journey messages when consent is revoked after the first accepted message',async () => {
    const f = await messageJourneyFixture(); await f.queue.execute((await f.queue.due())[0]!); clock+=2000; await f.runtime.execute((await f.runtime.due())[0]!);
    await f.consents.record(alice,f.contact,{ purpose: 'marketing',state: 'revoked',source: 'customer_request',evidenceReference: 'synthetic-revocation',observedAt: new Date(clock).toISOString(),expectedRevision: 1,expectedPhone: '+5511987654321' });
    expect(await f.runtime.execute((await f.runtime.due())[0]!)).toBe('failed'); expect(f.send).toHaveBeenCalledOnce(); expect(await f.queue.due()).toEqual([]);
  });
  it.each(['read','button'] as const)('correlates an early %s event even when its consumer runs before message-node advancement',async (kind) => {
    const f = await messageJourneyFixture(); const graph = journeyGraph(); graph.nodes.splice(1,0,{ id: 'message',type: 'message',position: { x: 100,y: 0 },config: f.graph.nodes[1]!.config },{ id: 'read',type: 'condition',position: { x: 200,y: 0 },config: { source: 'message_event',field: kind==='read'?'message.read':'actionPayload',operator: kind==='read'?'exists':'equals',...(kind==='button'?{value:'yes'}:{}) } },{ id: 'goal',type: 'goal',position: { x: 300,y: 0 },config: { goal: 'read_offer',stop: true } }); graph.edges = [{ id: 'a',source: 'start',target: 'message',port: 'next' },{ id: 'b',source: 'message',target: 'read',port: 'next' },{ id: 'c',source: 'read',target: 'goal',port: 'true' },{ id: 'd',source: 'read',target: 'end',port: 'false' }];
    const journey = await f.service.create(alice,'Read funnel'); await f.service.save(alice,journey.id,1,'Read funnel',graph); await f.service.publish(alice,journey.id,2); await f.service.control(alice,journey.id,3,'activate'); const enrollment = await f.runtime.enroll(alice,journey.id,f.contact);
    await f.runtime.execute((await f.runtime.due()).find((job) => job.enrollment_id===enrollment.id)!); await f.runtime.execute((await f.runtime.due()).find((job) => job.enrollment_id===enrollment.id)!);
    f.send.mockResolvedValue({ accepted: true,providerMessageId: 'read-target' });
    const ownJob = (await database.query<{ id: string; workspace_id: string; attempts: number }>('SELECT o.id,o.workspace_id,o.attempts FROM campaign_dispatch_outbox o JOIN journey_message_actions a ON a.workspace_id=o.workspace_id AND a.campaign_id=o.campaign_id WHERE a.enrollment_id=$1',[enrollment.id])).rows[0]!; await f.queue.execute(ownJob);
    const event = { id: randomUUID(),type: kind==='read'?'message.read' as const:'action.selected' as const,workspaceId: alice.workspace_id,connectionId: input.providerConnectionId!,providerId: 'fixture',occurredAt: new Date(clock).toISOString(),recipient: '+5511987654321',...(kind==='read'?{providerMessageId:'read-target'}:{dispatchKey:`dispatch-${(await database.query<{id:string}>("SELECT id FROM campaign_dispatch_attempts WHERE campaign_id=(SELECT campaign_id FROM journey_message_actions WHERE enrollment_id=$1)",[enrollment.id])).rows[0]!.id}`,actionPayload:'yes'}) };
    const adapter = f.registry.resolve('fixture'); vi.spyOn(adapter,'verifyWebhook').mockResolvedValue(true); vi.spyOn(adapter,'parseWebhook').mockResolvedValue(kind==='button'?[event,{...event,id:randomUUID(),providerMessageId:'read-target',dispatchKey:`dispatch-${randomUUID()}`,actionPayload:'wrong-attempt',occurredAt:new Date(clock+1).toISOString()}]:[event]); vi.spyOn(adapter,'normalizeEvent').mockImplementation((_context,value)=>value as typeof event);
    await f.bus.ingest('fixture',input.providerConnectionId!,{ rawBody: Buffer.from('{}'),headers: {} }); await f.bus.execute((await f.bus.due())[0]!);
    const eventId = (await database.query<{ id: string }>("SELECT id FROM canonical_events WHERE provider_event_id=$1",[event.id])).rows[0]!.id; await f.runtime.consumeEvent({ id: eventId,workspace_id: alice.workspace_id,attempts: 0 });
    clock+=2000; for (let index=0;index<3;index++) await f.runtime.execute((await f.runtime.due()).find((job) => job.enrollment_id===enrollment.id)!);
    expect((await f.runtime.list(alice,journey.id)).enrollments[0]!.status).toBe('converted');
  });
  it('advances one enrollment generation at a time and prevents active duplicates',async () => {
    const f = await runtimeFixture(); const enrollment = await f.runtime.enroll(alice,f.journey.id,f.contact); await expect(f.runtime.enroll(alice,f.journey.id,f.contact)).rejects.toMatchObject({ reason: 'conflict' });
    const job = (await f.runtime.due())[0]!; expect(await f.runtime.execute({ ...job,workspace_id: bob.workspace_id })).toBe('ignored'); expect(await f.runtime.execute(job)).toBe('active'); expect(await f.runtime.execute(job)).toBe('ignored');
    expect(await f.runtime.execute((await f.runtime.due())[0]!)).toBe('completed'); expect(await f.runtime.due()).toEqual([]); expect((await f.runtime.list(alice,f.journey.id)).enrollments[0]).toMatchObject({ id: enrollment.id,status: 'completed',revision: 3 });
    await expect(database.query('DELETE FROM journey_enrollments')).rejects.toThrow('immutable'); await expect(database.query('DELETE FROM journey_transitions')).rejects.toThrow('immutable');
    expect((await f.runtime.enroll(alice,f.journey.id,f.contact)).id).not.toBe(enrollment.id);
  });
  it('persists waits across instances and keeps enrollment bound to its original published version',async () => {
    const graph = journeyGraph(); graph.nodes.splice(1,0,{ id: 'wait',type: 'wait',position: { x: 100,y: 0 },config: { mode: 'duration',amount: 1,unit: 'minutes' } }); graph.edges[0]!.target='wait'; graph.edges.push({ id: 'after',source: 'wait',target: 'end',port: 'next' });
    const f = await runtimeFixture(graph); const enrollment = await f.runtime.enroll(alice,f.journey.id,f.contact); await f.runtime.execute((await f.runtime.due())[0]!); expect(await f.runtime.execute((await f.runtime.due())[0]!)).toBe('waiting'); expect(await f.runtime.due()).toEqual([]);
    await f.service.save(alice,f.journey.id,4,'New graph',journeyGraph()); await f.service.publish(alice,f.journey.id,5); clock+=60000;
    const restarted = new JourneyRuntime(pool,f.registry,f.bus,() => clock); expect(await restarted.execute((await restarted.due())[0]!)).toBe('active'); expect(await restarted.execute((await restarted.due())[0]!)).toBe('completed'); expect((await restarted.list(alice,f.journey.id)).enrollments[0]!.versionId).toBe(enrollment.versionId);
  });
  it('executes tag/score conditions and goals atomically without moving other enrolled contacts',async () => {
    const graph = journeyGraph(); graph.nodes = [graph.nodes[0]!,{ id: 'tag',type: 'tag',position: { x: 100,y: 0 },config: { action: 'add',tag: 'interested' } },{ id: 'score',type: 'score',position: { x: 200,y: 0 },config: { action: 'increase',value: 50 } },{ id: 'check',type: 'condition',position: { x: 300,y: 0 },config: { source: 'lead_score',field: 'score',operator: 'greater_or_equal',value: 50 } },{ id: 'goal',type: 'goal',position: { x: 400,y: 0 },config: { goal: 'sales_ready',stop: true } },graph.nodes[1]!]; graph.edges = [{ id: 'a',source: 'start',target: 'tag',port: 'next' },{ id: 'b',source: 'tag',target: 'score',port: 'next' },{ id: 'c',source: 'score',target: 'check',port: 'next' },{ id: 'd',source: 'check',target: 'goal',port: 'true' },{ id: 'e',source: 'check',target: 'end',port: 'false' }];
    const f = await runtimeFixture(graph); const first = await f.runtime.enroll(alice,f.journey.id,f.contact); const other = (await database.query<{ id: string }>("INSERT INTO contacts(workspace_id,phone_normalized) VALUES($1,'+5511976543210') RETURNING id",[alice.workspace_id])).rows[0]!.id; const second = await f.runtime.enroll(alice,f.journey.id,other);
    for (let index=0;index<5;index++) { const job = (await f.runtime.due()).find((value) => value.enrollment_id===first.id)!; await f.runtime.execute(job); }
    expect((await f.runtime.list(alice,f.journey.id)).enrollments).toEqual(expect.arrayContaining([expect.objectContaining({ id: first.id,status: 'converted' }),expect.objectContaining({ id: second.id,status: 'active',revision: 1 })]));
    expect((await database.query<{ score: number }>('SELECT score FROM lead_scores')).rows[0]!.score).toBe(50); expect((await database.query('SELECT tag FROM contact_tags')).rows).toEqual([{ tag: 'interested' }]); expect((await database.query('SELECT goal FROM journey_goals')).rows).toEqual([{ goal: 'sales_ready' }]); expect(f.send).not.toHaveBeenCalled();
  });
  it.each(['opt_out','phone','actor'] as const)('stops future journey work on %s changes',async (change) => {
    const f = await runtimeFixture(); await f.runtime.enroll(alice,f.journey.id,f.contact);
    if (change==='opt_out') await database.query("INSERT INTO opt_outs(workspace_id,phone_normalized) VALUES($1,'+5511987654321')",[alice.workspace_id]);
    if (change==='phone') await database.query("UPDATE contacts SET phone_normalized='+5511976543210' WHERE id=$1",[f.contact]);
    if (change==='actor') await database.query("UPDATE workspace_members SET role='viewer' WHERE workspace_id=$1",[alice.workspace_id]);
    expect(await f.runtime.execute((await f.runtime.due())[0]!)).toBe(change==='opt_out' ? 'opted_out' : change==='phone' ? 'failed' : 'stopped'); expect(await f.runtime.due()).toEqual([]);
  });
  it('rolls back enrollment advancement and canonical events when transition audit fails',async () => {
    const f = await runtimeFixture(); await f.runtime.enroll(alice,f.journey.id,f.contact); const job = (await f.runtime.due())[0]!;
    await database.exec("CREATE FUNCTION reject_transition_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.event='journey.transition' THEN RAISE EXCEPTION 'audit unavailable'; END IF; RETURN NEW; END $$; CREATE TRIGGER reject_transition_audit BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION reject_transition_audit();");
    try { await expect(f.runtime.execute(job)).rejects.toThrow('audit unavailable'); expect((await f.runtime.list(alice,f.journey.id)).enrollments[0]!.revision).toBe(1); expect((await database.query<{ count: number }>('SELECT count(*)::int AS count FROM journey_transitions')).rows[0]!.count).toBe(0); }
    finally { await database.exec('DROP TRIGGER reject_transition_audit ON audit_logs; DROP FUNCTION reject_transition_audit()'); }
    expect(await f.runtime.execute(job)).toBe('active');
  });
  it('publishes immutable journey versions while later drafts preserve earlier graphs',async () => {
    const service = new JourneyService(pool,new ProviderRegistry()); const journey = await service.create(alice,'Welcome funnel'); const first = await service.publish(alice,journey.id,1);
    const graph = journeyGraph(); graph.nodes.splice(1,0,{ id: 'tag',type: 'tag',position: { x: 150,y: 0 },config: { action: 'add',tag: 'interested' } }); graph.edges[0]!.target='tag'; graph.edges.push({ id: 'after',source: 'tag',target: 'end',port: 'next' });
    await service.save(alice,journey.id,2,'Welcome funnel',graph); const second = await service.publish(alice,journey.id,3); expect(first.version).toBe(1); expect(second.version).toBe(2);
    expect((await service.get(alice,journey.id,1)).graph.nodes).toHaveLength(2); expect((await service.get(alice,journey.id,2)).graph.nodes).toHaveLength(3);
    await expect(database.query<Record<string,unknown>>("UPDATE journey_versions SET graph='{}'")).rejects.toThrow('immutable'); await expect(database.query<Record<string,unknown>>('DELETE FROM journey_nodes')).rejects.toThrow('immutable');
    expect((await service.list(alice)).journeys[0]).toMatchObject({ published_version: 2,revision: 4 });
  });
  it('keeps invalid journey drafts editable but blocks publication and cycles',async () => {
    const service = new JourneyService(pool,new ProviderRegistry()); const journey = await service.create(alice,'Invalid funnel'); const graph = journeyGraph(); graph.edges.push({ id: 'loop',source: 'end',target: 'start',port: 'next' });
    await service.save(alice,journey.id,1,'Invalid funnel',graph); expect((await service.validate(alice,journey.id)).issues).toEqual(expect.arrayContaining([{ code: 'cycles_forbidden' }]));
    await expect(service.publish(alice,journey.id,2)).rejects.toMatchObject({ reason: 'conflict' });
    expect((await database.query<Record<string,unknown>>('SELECT count(*)::int AS count FROM journey_versions')).rows[0]!.count).toBe(0);
  });
  it('validates message-node references against current tenant, agent and adapter capabilities',async () => {
    const f = await dispatchFixture(); const service = new JourneyService(pool,f.registry); const journey = await service.create(alice,'Message funnel'); const graph = journeyGraph();
    graph.nodes.splice(1,0,{ id: 'message',type: 'message',position: { x: 150,y: 0 },config: { messageVersionId: input.messageVersionId!,connectionId: input.providerConnectionId!,agentId: 'agent-a' } }); graph.edges[0]!.target='message'; graph.edges.push({ id: 'after',source: 'message',target: 'end',port: 'next' });
    await service.save(alice,journey.id,1,'Message funnel',graph); expect((await service.validate(alice,journey.id)).issues).toEqual([]); expect((await service.publish(alice,journey.id,2)).version).toBe(1);
    graph.nodes[1]!.config.connectionId=randomUUID(); await service.save(alice,journey.id,3,'Message funnel',graph); expect((await service.validate(alice,journey.id)).issues).toContainEqual({ code: 'message_reference_unavailable',nodeId: 'message' });
    await expect(service.publish(alice,journey.id,4)).rejects.toMatchObject({ reason: 'conflict' }); expect(f.send).not.toHaveBeenCalled();
  });
  it('guards journey controls, revisions, tenant scope and fresh roles',async () => {
    const service = new JourneyService(pool,new ProviderRegistry()); const journey = await service.create(alice,'Controlled funnel');
    await expect(service.get(bob,journey.id)).rejects.toMatchObject({ reason: 'not_found' }); await expect(service.publish(alice,journey.id,2)).rejects.toMatchObject({ reason: 'conflict' });
    await service.publish(alice,journey.id,1); expect(await service.control(alice,journey.id,2,'activate')).toEqual({ status: 'active',revision: 3 });
    expect(await service.control(alice,journey.id,3,'pause')).toEqual({ status: 'paused',revision: 4 }); expect(await service.control(alice,journey.id,4,'resume')).toEqual({ status: 'active',revision: 5 });
    await database.query<Record<string,unknown>>("UPDATE workspace_members SET role='viewer' WHERE workspace_id=$1",[alice.workspace_id]); expect((await service.get(alice,journey.id)).journey.status).toBe('active');
    await expect(service.control(alice,journey.id,5,'archive')).rejects.toMatchObject({ reason: 'forbidden' }); await expect(service.save(alice,journey.id,5,'Edited',journeyGraph())).rejects.toMatchObject({ reason: 'forbidden' });
  });
  it('publishes journey graph, normalized nodes/edges and audit atomically',async () => {
    const service = new JourneyService(pool,new ProviderRegistry()); const journey = await service.create(alice,'Atomic funnel');
    await database.exec("CREATE FUNCTION reject_journey_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.event='journey.published' THEN RAISE EXCEPTION 'audit unavailable'; END IF; RETURN NEW; END $$; CREATE TRIGGER reject_journey_audit BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION reject_journey_audit();");
    try { await expect(service.publish(alice,journey.id,1)).rejects.toThrow('audit unavailable'); expect((await service.get(alice,journey.id)).journey).toMatchObject({ revision: 1,published_version: null }); expect((await database.query<Record<string,unknown>>('SELECT count(*)::int AS count FROM journey_nodes')).rows[0]!.count).toBe(0); }
    finally { await database.exec('DROP TRIGGER reject_journey_audit ON audit_logs; DROP FUNCTION reject_journey_audit()'); }
    expect((await service.publish(alice,journey.id,1)).version).toBe(1);
  });
  it('protects journey HTTP creation, publication and reader access with session/CSRF and strict input',async () => {
    const redis = { defineCommand: () => undefined,rateLimit: (_key: string,window: number,_max: number,_cont: boolean,_exp: boolean,callback: (error: null,value: number[]) => void) => callback(null,[1,window]) } as unknown as Redis;
    const authStore = { findSession: async () => ({ id: alice.user_id,name: 'Alice',email: 'alice@example.test' }) } as unknown as AuthStore;
    const app = createApp({ db: pool,redis,authStore },{ appUrl: 'http://localhost:3000',secureCookies: false }); const base = `/workspaces/${alice.workspace_id}/journeys`; const headers = { origin: 'http://localhost:3000','x-rcs-request': '1',cookie: `rcs_session=${'a'.repeat(43)}` };
    try {
      expect((await app.inject({ url: base })).statusCode).toBe(401); expect((await app.inject({ method: 'POST',url: base,headers: { cookie: headers.cookie },payload: { name: 'Test' } })).statusCode).toBe(403);
      expect((await app.inject({ method: 'POST',url: base,headers,payload: { name: 'Test',status: 'active' } })).statusCode).toBe(400);
      const created = await app.inject({ method: 'POST',url: base,headers,payload: { name: 'Test' } }); expect(created.statusCode).toBe(201); const id = created.json().journey.id;
      expect((await app.inject({ method: 'POST',url: `${base}/${id}/publish`,headers,payload: { expectedRevision: 1 } })).statusCode).toBe(201);
      expect((await app.inject({ url: `${base}/${id}?version=1`,headers })).json().version).toBe(1); expect((await app.inject({ url: `${base.replace(alice.workspace_id,bob.workspace_id)}/${id}`,headers })).statusCode).toBe(404);
      await database.query<Record<string,unknown>>("UPDATE workspace_members SET role='viewer' WHERE workspace_id=$1",[alice.workspace_id]); expect((await app.inject({ url: `${base}/${id}`,headers })).statusCode).toBe(200); expect((await app.inject({ method: 'POST',url: `${base}/${id}/publish`,headers,payload: { expectedRevision: 2 } })).statusCode).toBe(403);
    } finally { await app.close(); }
  });
  const eventFixture = async (sent = false) => {
    const f = await dispatchFixture(); if (sent) await f.dispatch(); const adapter = new MockRcsProvider({ now: () => clock });
    const registry = new ProviderRegistry(); registry.register(adapter,{ documentPath: 'docs/providers/mock.md',reviewedAt: '2026-10-04',references: ['https://example.test/local-fixture'],checks: Object.fromEntries(activationChecks.map((key) => [key,true])) as ProviderEvidence['checks'] });
    await database.query<Record<string,unknown>>("UPDATE provider_connections SET provider_id='mock' WHERE id=$1",[input.providerConnectionId]);
    const ciphertext = f.cipher.encrypt(JSON.stringify(f.credentials),credentialContext({ workspace_id: alice.workspace_id,id: input.providerConnectionId!,provider_id: 'mock',environment: 'test' }));
    await database.query<Record<string,unknown>>('UPDATE provider_credentials SET ciphertext=$2 WHERE connection_id=$1',[input.providerConnectionId,ciphertext]);
    const context = { workspaceId: alice.workspace_id,connectionId: input.providerConnectionId!,environment: 'test',credentials: f.credentials,signal: new AbortController().signal };
    const request = adapter.simulateWebhook(context,[{ type: 'message.delivered',recipient: '+5511987654321',providerMessageId: 'provider-accepted' }]);
    return { ...f,bus: new EventBus(pool,registry,f.cipher,() => clock),adapter,context,request,registry };
  };
  it('pins message categories per immutable version and rejects categories from another purpose',async()=>{
    const first=await messages.create(alice,validateMessageInput({name:'Launch',purpose:'marketing',archetype:'launch',content:{type:'text',text:'Hello'}}));expect(first.current.archetype).toBe('launch');await messages.changeStatus(alice,first.message.id,1,'active');
    const second=await messages.revise(alice,first.message.id,1,validateMessageInput({name:'Reminder',purpose:'transactional',archetype:'reminder',content:{type:'text',text:'Reminder'}}));expect(second.current.archetype).toBe('reminder');expect(second.active?.archetype).toBe('launch');expect(()=>validateMessageInput({name:'Invalid',purpose:'authentication',archetype:'offer',content:{type:'text',text:'Invalid'}})).toThrow();
    await expect(database.query("UPDATE message_versions SET archetype='offer' WHERE id=$1",[first.current.id])).rejects.toThrow('immutable');
  });
  it('applies asynchronous eligibility once and ignores superseded requests and changed phone snapshots',async()=>{
    const f=await eventFixture();const row=(await database.query<{ciphertext:string;revision:string}>('SELECT k.ciphertext,EXTRACT(EPOCH FROM p.updated_at)::text AS revision FROM provider_connections p JOIN provider_credentials k ON k.connection_id=p.id')).rows[0]!;
    const version=credentialVersion(row.ciphertext,row.revision);const eligibility=new PgEligibilityStore(pool);const id=await eligibility.begin(alice,input.providerConnectionId!,f.contact,version,'+5511987654321');expect(id).toBeTruthy();
    const adapter=f.registry.resolve('mock');adapter.normalizeEligibility=(_ctx,value)=>value as {requestId:string;recipient:string;eligible:boolean|null};vi.spyOn(adapter,'verifyWebhook').mockResolvedValue(true);const parse=vi.spyOn(adapter,'parseWebhook');
    const process=async(requestId:string,tag:string)=>{parse.mockResolvedValue([{requestId,recipient:'+5511987654321',eligible:true}]);await f.bus.ingest('mock',input.providerConnectionId!,{rawBody:Buffer.from(JSON.stringify({tag})),headers:{}});expect(await f.bus.execute((await f.bus.due())[0]!)).toBe('completed');};
    await process(id!,'first');expect((await database.query('SELECT status,reason FROM eligibility_checks WHERE contact_id=$1',[f.contact])).rows[0]).toMatchObject({status:'eligible',reason:'provider_checked'});expect((await database.query('SELECT 1 FROM canonical_events')).rows).toHaveLength(0);
    const next=await eligibility.begin(alice,input.providerConnectionId!,f.contact,version,'+5511987654321');await process(id!,'old');expect((await database.query('SELECT reason FROM eligibility_checks WHERE contact_id=$1',[f.contact])).rows[0]).toMatchObject({reason:'checking'});
    await database.query("UPDATE contacts SET phone_normalized='+5511987654322' WHERE id=$1",[f.contact]);await process(next!,'phone-change');expect((await database.query('SELECT status,reason FROM eligibility_checks WHERE contact_id=$1',[f.contact])).rows[0]).toMatchObject({status:'unknown',reason:'checking'});
  });
  it('reconciles ambiguous sends using authenticated remote IDs while preserving the final dispatch ledger',async()=>{
    const f=await dispatchFixture();const adapter=f.registry.resolve('fixture');adapter.getSendIdentity=()=> 'remote-stable-id';f.send.mockResolvedValueOnce({accepted:false,error:{code:'unknown',message:'Unknown',retryable:false}});
    expect(await f.dispatch()).toMatchObject({status:'unknown'});const attempt=(await database.query<{id:string}>('SELECT id FROM campaign_dispatch_attempts')).rows[0]!.id;expect((await database.query('SELECT provider_message_id FROM dispatch_correlations')).rows[0]).toMatchObject({provider_message_id:'remote-stable-id'});
    const bus=new EventBus(pool,f.registry,f.cipher,()=>clock);const event={id:randomUUID(),type:'message.delivered' as const,workspaceId:alice.workspace_id,connectionId:input.providerConnectionId!,providerId:'fixture',occurredAt:new Date(clock).toISOString(),recipient:'+5511987654321',providerMessageId:'remote-stable-id'};vi.spyOn(adapter,'verifyWebhook').mockResolvedValue(true);vi.spyOn(adapter,'parseWebhook').mockResolvedValue([event]);vi.spyOn(adapter,'normalizeEvent').mockReturnValue(event);
    await bus.ingest('fixture',input.providerConnectionId!,{rawBody:Buffer.from('{}'),headers:{}});await bus.execute((await bus.due())[0]!);const id=(await database.query<{id:string}>('SELECT id FROM canonical_events')).rows[0]!.id;await bus.consumeCampaignEvent({id,workspace_id:alice.workspace_id,attempts:0});expect((await database.query('SELECT attempt_id,event_type FROM campaign_message_events')).rows[0]).toMatchObject({attempt_id:attempt,event_type:'message.delivered'});expect((await database.query('SELECT status FROM campaign_dispatch_attempts')).rows[0]).toMatchObject({status:'unknown'});expect(await f.dispatch()).toMatchObject({status:'unknown'});expect(f.send).toHaveBeenCalledOnce();
  });
  it('rotates encrypted immutable history without changing payloads or invalidating credential snapshots',async()=>{
    const f=await eventFixture();const received=await f.bus.ingest('mock',input.providerConnectionId!,f.request);expect(await f.bus.execute((await f.bus.due())[0]!)).toBe('completed');
    const key=randomBytes(32);const cipher=new CredentialCipher('next',{next:key});
    const plaintext=f.cipher.decrypt((await database.query<{ciphertext:string}>('SELECT ciphertext FROM provider_credentials')).rows[0]!.ciphertext,credentialContext({workspace_id:alice.workspace_id,id:input.providerConnectionId!,provider_id:'mock',environment:'test'}));
    const current=new CredentialCipher('next',{test:f.encryptionKey,next:key});
    const revision=(await database.query<{revision:string}>('SELECT EXTRACT(EPOCH FROM updated_at)::text AS revision FROM provider_connections WHERE id=$1',[input.providerConnectionId])).rows[0]!.revision;
    const before=(await database.query<{ciphertext:string}>('SELECT ciphertext FROM provider_credentials')).rows[0]!.ciphertext;const version=credentialVersion(before,revision);
    const row=(await database.query<{id:string;payload_ciphertext:string}>('SELECT id,payload_ciphertext FROM canonical_events')).rows[0]!;const event=f.cipher.decrypt(row.payload_ciphertext,JSON.stringify(['canonical-event-v1',alice.workspace_id,row.id]));
    const service=new HistoryMaintenance(pool,current);expect(await service.rotate(alice)).toMatchObject({remaining:0,keyVersion:'next',counts:{provider_credentials:1,canonical_events:1,webhook_receipts:1}});
    const after=(await database.query<{ciphertext:string}>('SELECT ciphertext FROM provider_credentials')).rows[0]!.ciphertext;
    expect(cipher.decrypt(after,credentialContext({workspace_id:alice.workspace_id,id:input.providerConnectionId!,provider_id:'mock',environment:'test'}))).toBe(plaintext);expect(credentialVersion(after,revision)).toBe(version);expect(credentialVersion(after,revision+'1')).not.toBe(version);
    const rotated=(await database.query<{payload_ciphertext:string}>('SELECT payload_ciphertext FROM canonical_events')).rows[0]!.payload_ciphertext;expect(cipher.decrypt(rotated,JSON.stringify(['canonical-event-v1',alice.workspace_id,row.id]))).toBe(event);
    await expect(database.query('UPDATE canonical_events SET payload_ciphertext=$1 WHERE id=$2',['forged',row.id])).rejects.toThrow('immutable');expect((await database.query('SELECT 1 FROM cipher_maintenance_permits')).rows).toHaveLength(0);
    expect(await service.rotate(alice)).toMatchObject({remaining:0,counts:{canonical_events:0}});await expect(service.rotate(bob)).resolves.toMatchObject({remaining:0,counts:{canonical_events:0}});
    expect(await new EventBus(pool,f.registry,cipher,()=>clock).ingest('mock',input.providerConnectionId!,f.request)).toMatchObject({receiptId:received.receiptId,duplicate:true});
  });
  it('authorizes bounded retention and keeps recent, pending and foreign receipt bodies intact',async()=>{
    const f=await eventFixture();await f.bus.ingest('mock',input.providerConnectionId!,f.request);await f.bus.execute((await f.bus.due())[0]!);
    expect(await new HistoryMaintenance(pool).compact(alice,365)).toMatchObject({compacted:0});
    const old=randomUUID();await database.query("INSERT INTO webhook_receipts(id,workspace_id,connection_id,provider_id,credential_version,body_hash,ciphertext,status,received_at,updated_at) SELECT $1,workspace_id,connection_id,provider_id,credential_version,$2,ciphertext,'completed',now()-interval '400 days',now()-interval '400 days' FROM webhook_receipts LIMIT 1",[old,'b'.repeat(64)]);
    expect(await new HistoryMaintenance(pool).compact(alice,365)).toMatchObject({compacted:1});expect((await database.query('SELECT ciphertext FROM webhook_receipts WHERE id=$1',[old])).rows[0]).toMatchObject({ciphertext:null});expect((await database.query('SELECT 1 FROM canonical_events')).rows).toHaveLength(1);
    expect(()=>new HistoryMaintenance(pool).compact(alice,29)).toThrow();
    await database.query("UPDATE workspace_members SET role='admin' WHERE workspace_id=$1",[alice.workspace_id]);await expect(new HistoryMaintenance(pool,f.cipher).rotate(alice)).rejects.toMatchObject({reason:'forbidden'});await expect(new HistoryMaintenance(pool).compact(alice,365)).rejects.toMatchObject({reason:'forbidden'});
    expect((await database.query('SELECT 1 FROM webhook_receipts WHERE ciphertext IS NOT NULL')).rows).toHaveLength(1);
  });
  it('publishes only a pinned private asset for a reserved dispatch and expires provider access',async()=>{
    const f=await dispatchFixture();const id=randomUUID();const bytes=Buffer.from('synthetic-image');
    await database.query("INSERT INTO media_assets(id,workspace_id,name,mime_type,byte_size,width,height,sha256,created_by_user_id) VALUES($1,$2,'Image','image/png',$3,1,1,$4,$5)",[id,alice.workspace_id,bytes.length,'a'.repeat(64),alice.user_id]);await database.query('INSERT INTO media_contents(workspace_id,asset_id,content) VALUES($1,$2,$3)',[alice.workspace_id,id,bytes]);
    const message=await messages.create(alice,{name:'Card',purpose:'marketing',content:{type:'rich_card',card:{title:'Offer',body:'Details',media:{assetId:id,mimeType:'image/png'}}}});await messages.changeStatus(alice,message.message.id,1,'active');
    const campaign=await store.create(alice,{...input,messageVersionId:message.current.id});const prepared=await f.preparation.prepare(alice,campaign.id,1);const confirmed=await f.preparation.confirm(alice,campaign.id,prepared.revision,prepared.runId,'dispatch');
    let token='';f.send.mockImplementationOnce(async(ctx)=>{const value=await ctx.resolveMedia!({assetId:id,mimeType:'image/png'});token=new URL(value.url).pathname.split('/').pop()!;return {accepted:true,providerMessageId:'media-accepted'};});
    const dispatch=new CampaignDispatch(pool,f.registry,f.cipher,()=>clock,'https://app.example.test');expect(await dispatch.dispatch(alice,campaign.id,f.contact,confirmed.revision,new AbortController().signal)).toMatchObject({status:'accepted'});
    const media=new ProviderMediaAccess(pool);expect(await media.read(token)).toMatchObject({mimeType:'image/png',content:bytes});expect(await media.read('x'.repeat(43))).toBeNull();
    const attempt=(await database.query<{id:string}>('SELECT id FROM campaign_dispatch_attempts')).rows[0]!.id;await expect(new ProviderMediaAccess(pool,'https://app.example.test').grant(bob.workspace_id,input.providerConnectionId!,attempt,{assetId:id,mimeType:'image/png'})).rejects.toThrow();
    await database.query("UPDATE provider_media_grants SET created_at=now()-interval '8 days',expires_at=now()-interval '1 day'");expect(await media.read(token)).toBeNull();
    await new HistoryMaintenance(pool).compact(alice);expect((await database.query('SELECT 1 FROM provider_media_grants')).rows).toHaveLength(0);expect((await database.query('SELECT 1 FROM media_contents')).rows).toHaveLength(1);
  });
  it('shares request slots across instances and accounts and cancels waits before remote requests',async()=>{
    const credentials={accountSid:randomUUID()};const controller=new AbortController();const context={workspaceId:alice.workspace_id,connectionId:randomUUID(),environment:'test',credentials,signal:controller.signal};
    await new ProviderRequests(pool).context('twilio',context).beforeRequest!();
    const next=new ProviderRequests(pool).context('twilio',{...context,workspaceId:bob.workspace_id,connectionId:randomUUID()});const timer=setTimeout(()=>controller.abort(),50);
    try{await expect(next.beforeRequest!()).rejects.toThrow();}finally{clearTimeout(timer);}
    await next.rateLimited!(30);await expect(new ProviderRequests(pool).context('twilio',{...context,signal:new AbortController().signal}).beforeRequest!()).rejects.toThrow('budget');
  });
  it('aggregates persisted journey goals, transitions and state without tenant leakage',async () => {
    const graph = journeyGraph(); graph.nodes.splice(1,0,{ id: 'goal',type: 'goal',position: { x: 100,y: 0 },config: { goal: 'converted',stop: true } }); graph.edges[0]!.target='goal'; graph.nodes.pop(); const f = await runtimeFixture(graph); await f.runtime.enroll(alice,f.journey.id,f.contact); for (let i=0;i<2;i++) await f.runtime.execute((await f.runtime.due())[0]!);
    const analytics = new AnalyticsService(pool); expect(await analytics.journey(alice,f.journey.id)).toMatchObject({ total: 1,converted: 1,conversionRate: 1,states: [{ status: 'converted',count: 1 }],goals: [{ goal: 'converted',leads: 1 }],messages: { queued: 0,accepted: 0,delivered: 0,read: 0 } }); await expect(analytics.journey(bob,f.journey.id)).rejects.toMatchObject({ reason: 'not_found' }); expect((await analytics.journey(alice,f.journey.id,999)).total).toBe(0);
  });
  it('keeps provider acceptance separate from delivery and read analytics',async () => {
    const f = await messageJourneyFixture(); await f.queue.execute((await f.queue.due())[0]!); const report = await new AnalyticsService(pool).journey(alice,f.journey.id); expect(report.messages).toMatchObject({ queued: 1,accepted: 1,delivered: 0,read: 0 });
  });
  it('stores incoming conversations encrypted and consumes each callback once',async () => {
    const f = await eventFixture(); const request = f.adapter.simulateWebhook(f.context,[{ type: 'message.received',recipient: '+5511987654321',providerMessageId: 'inbound-1',message: { type: 'text',text: 'Private inbox response' } }]); await f.bus.ingest('mock',input.providerConnectionId!,request); await f.bus.execute((await f.bus.due())[0]!); const inbox = new InboxService(pool,f.bus,f.cipher); const job = (await f.bus.pendingConversationEvents())[0]!; expect(await inbox.consumeEvent(job)).toBe(true); expect(await inbox.consumeEvent(job)).toBe(false);
    const list = await inbox.list(alice); expect(list.total).toBe(1); const id = (list.conversations[0] as { id: string }).id; expect((await inbox.get(alice,id)).messages[0]!.content).toMatchObject({ message: { text: 'Private inbox response' } }); expect(JSON.stringify((await database.query('SELECT * FROM conversation_messages')).rows)).not.toContain('Private inbox response'); expect((await inbox.list(bob)).total).toBe(0); await expect(inbox.get(bob,id)).rejects.toMatchObject({ reason: 'not_found' }); await expect(database.query('DELETE FROM conversation_messages')).rejects.toThrow('immutable');
    const requestId=randomUUID(); const drafted=await inbox.replyDraft(alice,id,1,input.messageVersionId!,requestId); expect(await inbox.replyDraft(alice,id,1,input.messageVersionId!,requestId)).toMatchObject({ campaignId: drafted.campaignId,duplicate: true }); expect((await store.get(alice,drafted.campaignId))?.status).toBe('draft'); expect(f.send).not.toHaveBeenCalled();
    await inbox.control(alice,id,1,'closed',alice.user_id); await expect(inbox.control(alice,id,1,'open',null)).rejects.toMatchObject({ reason: 'conflict' }); await expect(inbox.control(alice,id,2,'open',bob.user_id)).rejects.toMatchObject({ reason: 'invalid' });
    await database.query("UPDATE contacts SET phone_normalized='+5511999999999' WHERE id=$1",[f.contact]); await expect(inbox.get(alice,id)).rejects.toMatchObject({ reason: 'not_found' });
  });
  it('scores correlated events once with immutable history and tenant isolation',async () => {
    const f = await eventFixture(true); const scoring = new ScoringService(pool,f.bus);
    await f.bus.ingest('mock',input.providerConnectionId!,f.request); await f.bus.execute((await f.bus.due())[0]!); const job = (await f.bus.pendingScoringEvents())[0]!;
    expect(await scoring.consumeEvent(job)).toBe(true); expect(await scoring.consumeEvent(job)).toBe(false); expect(await scoring.contact(alice,f.contact)).toMatchObject({ score: 1,classification: 'cold',history: [{ delta: 1,previous_score: 0,new_score: 1 }] });
    await expect(scoring.contact(bob,f.contact)).rejects.toMatchObject({ reason: 'not_found' }); await expect(database.query('DELETE FROM lead_score_history')).rejects.toThrow('immutable');
    for (const pending of await f.bus.pendingScoringEvents()) await scoring.consumeEvent(pending); expect((await scoring.contact(alice,f.contact)).score).toBe(1);
  });
  it('does not score uncorrelated delivery callbacks or changed recipient identities',async () => {
    const f = await eventFixture(); const scoring = new ScoringService(pool,f.bus); await f.bus.ingest('mock',input.providerConnectionId!,f.request); await f.bus.execute((await f.bus.due())[0]!); await scoring.consumeEvent((await f.bus.pendingScoringEvents())[0]!); expect((await scoring.contact(alice,f.contact)).score).toBe(0);
  });
  it('qualifies only on threshold crossing and clamps negative rules at zero',async () => {
    const f = await eventFixture(); const scoring = new ScoringService(pool,f.bus); await scoring.saveSettings(alice,0,[{ eventType: 'journey.goal_reached',goal: 'appointment_requested',delta: 30,enabled: true }]);
    for (let i=0;i<3;i++) { const id = await f.bus.publishDomain(pool as unknown as PoolClient,alice.workspace_id,'journey.goal_reached',f.contact,randomUUID(),{ goal: 'appointment_requested' }); await scoring.consumeEvent({ id,workspace_id: alice.workspace_id,attempts: 0 }); }
    expect(await scoring.contact(alice,f.contact)).toMatchObject({ score: 90,classification: 'sales_ready' }); expect((await database.query<{ count: number }>("SELECT count(*)::int AS count FROM canonical_events WHERE event_type='lead.qualified'")).rows[0]!.count).toBe(1);
    await scoring.saveSettings(alice,1,[{ eventType: 'journey.goal_reached',goal: 'appointment_requested',delta: -100,enabled: true }]); const id = await f.bus.publishDomain(pool as unknown as PoolClient,alice.workspace_id,'journey.goal_reached',f.contact,randomUUID(),{ goal: 'appointment_requested' }); await scoring.consumeEvent({ id,workspace_id: alice.workspace_id,attempts: 0 }); expect((await scoring.contact(alice,f.contact)).score).toBe(0);
  });
  it('rolls back scoring and consumption together when audit fails',async () => {
    const f = await eventFixture(true); const scoring = new ScoringService(pool,f.bus); await f.bus.ingest('mock',input.providerConnectionId!,f.request); await f.bus.execute((await f.bus.due())[0]!); const job = (await f.bus.pendingScoringEvents())[0]!;
    await database.exec("CREATE FUNCTION reject_scoring_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.event='lead.score_changed' THEN RAISE EXCEPTION 'audit unavailable'; END IF; RETURN NEW; END $$; CREATE TRIGGER reject_scoring_audit BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION reject_scoring_audit();");
    try { await expect(scoring.consumeEvent(job)).rejects.toThrow('audit unavailable'); expect((await scoring.contact(alice,f.contact)).score).toBe(0); expect((await database.query("SELECT event_id FROM event_consumptions WHERE consumer='scoring'")).rows).toHaveLength(0); }
    finally { await database.exec('DROP TRIGGER reject_scoring_audit ON audit_logs; DROP FUNCTION reject_scoring_audit()'); }
    expect(await scoring.consumeEvent(job)).toBe(false); clock+=30001;
    expect(await scoring.consumeEvent(job)).toBe(true);
  });
  it('rejects stale scoring settings and fresh read-only roles',async () => {
    const f = await eventFixture(); const scoring = new ScoringService(pool,f.bus); expect((await scoring.settings(alice)).revision).toBe(0); await scoring.saveSettings(alice,0,[]); await expect(scoring.saveSettings(alice,0,[])).rejects.toMatchObject({ reason: 'conflict' }); await database.query("UPDATE workspace_members SET role='viewer' WHERE workspace_id=$1",[alice.workspace_id]); expect((await scoring.settings(alice)).revision).toBe(1); await expect(scoring.saveSettings(alice,1,[])).rejects.toMatchObject({ reason: 'forbidden' });
  });
  it('persists only verified encrypted receipts and canonical events with replay deduplication',async () => {
    const f = await eventFixture(); const first = await f.bus.ingest('mock',input.providerConnectionId!,f.request); const replay = await f.bus.ingest('mock',input.providerConnectionId!,f.request);
    expect(replay).toEqual({ receiptId: first.receiptId,duplicate: true }); expect(first.duplicate).toBe(false);
    expect(JSON.stringify((await database.query<Record<string,unknown>>('SELECT * FROM webhook_receipts')).rows)).not.toMatch(/provider-accepted|synthetic|\+5511|x-mock-signature/);
    const job = (await f.bus.due())[0]!; expect(Object.keys(job).sort()).toEqual(['attempts','id','workspace_id']); expect(await f.bus.execute(job)).toBe('completed'); expect(await f.bus.execute(job)).toBe('ignored');
    const event = (await database.query<Record<string,unknown>>('SELECT * FROM canonical_events')).rows[0]!; expect(event.correlation_id).toBe(first.receiptId); expect(event.event_type).toBe('message.delivered');
    expect(JSON.stringify(event)).not.toMatch(/synthetic|\+5511/);
    await expect(database.query<Record<string,unknown>>("UPDATE canonical_events SET event_type='message.read'")).rejects.toThrow('immutable');
    await expect(database.query<Record<string,unknown>>('DELETE FROM webhook_receipts')).rejects.toThrow('immutable');
  });
  it('rejects unsigned, altered, foreign, wrong-provider and excessive receipts before persistence',async () => {
    const f = await eventFixture();
    for (const [provider,connection,request] of [['mock',input.providerConnectionId!,{ ...f.request,headers: {} }],['mock',input.providerConnectionId!,{ ...f.request,rawBody: Buffer.from('altered') }],['fixture',input.providerConnectionId!,f.request],['mock',randomUUID(),f.request],['mock',input.providerConnectionId!,{ ...f.request,rawBody: Buffer.alloc(65537) }]] as const) await expect(f.bus.ingest(provider,connection,request)).rejects.toMatchObject({ reason: 'invalid' });
    expect((await database.query<Record<string,unknown>>('SELECT count(*)::int AS count FROM webhook_receipts')).rows[0]!.count).toBe(0);
  });
  it('deduplicates event identities across distinct signed receipts and isolates consumer scope',async () => {
    const f = await eventFixture(); await f.bus.ingest('mock',input.providerConnectionId!,f.request); expect(await f.bus.execute((await f.bus.due())[0]!)).toBe('completed');
    clock++; const replay = f.adapter.simulateWebhook(f.context,[{ type: 'message.delivered',recipient: '+5511987654321',providerMessageId: 'other' }]);
    // Identical signed body with different JSON whitespace has a new receipt hash but the same event identity.
    const original = JSON.parse(Buffer.from(f.request.rawBody).toString()); const rawBody=Buffer.from(JSON.stringify(original,null,2)); const timestamp=replay.headers['x-mock-timestamp']!; const signature=createHmac('sha256',f.context.credentials.webhookSecret!).update(JSON.stringify([f.context.workspaceId,f.context.connectionId,f.context.environment,timestamp])).update('.').update(rawBody).digest('hex');
    await f.bus.ingest('mock',input.providerConnectionId!,{ rawBody,headers:{ 'x-mock-timestamp':timestamp,'x-mock-signature':signature } }); expect(await f.bus.execute((await f.bus.due())[0]!)).toBe('completed');
    expect((await database.query<Record<string,unknown>>('SELECT count(*)::int AS count FROM canonical_events')).rows[0]!.count).toBe(1);
    const eventId = (await database.query<Record<string,unknown>>('SELECT id FROM canonical_events')).rows[0]!.id as string; const effect = vi.fn(async () => {});
    await expect(f.bus.consume(bob.workspace_id,eventId,'journeys',effect)).rejects.toMatchObject({ reason: 'invalid' }); expect(effect).not.toHaveBeenCalled();
    expect(await f.bus.consume(alice.workspace_id,eventId,'journeys',effect)).toBe(true); expect(await f.bus.consume(alice.workspace_id,eventId,'journeys',effect)).toBe(false); expect(effect).toHaveBeenCalledOnce();
    expect(await f.bus.consume(alice.workspace_id,eventId,'analytics',effect)).toBe(true);
  });
  it('rolls back consumption markers with failed effects and receipt ingestion with failed audit',async () => {
    const f = await eventFixture(); await f.bus.ingest('mock',input.providerConnectionId!,f.request); await f.bus.execute((await f.bus.due())[0]!);
    const eventId = (await database.query<Record<string,unknown>>('SELECT id FROM canonical_events')).rows[0]!.id as string;
    await expect(f.bus.consume(alice.workspace_id,eventId,'scoring',async () => { throw new Error('effect failed'); })).rejects.toThrow('effect failed');
    expect((await database.query<Record<string,unknown>>('SELECT count(*)::int AS count FROM event_consumptions')).rows[0]!.count).toBe(0);
    await database.exec("CREATE FUNCTION reject_ingress_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.event='webhook.received' THEN RAISE EXCEPTION 'audit unavailable'; END IF; RETURN NEW; END $$; CREATE TRIGGER reject_ingress_audit BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION reject_ingress_audit();");
    const request = f.adapter.simulateWebhook(f.context,[{ type: 'contact.unsubscribe',recipient: '+5511987654321' }]);
    await expect(f.bus.ingest('mock',input.providerConnectionId!,request)).rejects.toThrow('audit unavailable');
    expect((await database.query<Record<string,unknown>>('SELECT count(*)::int AS count FROM webhook_receipts')).rows[0]!.count).toBe(1);
    await database.exec('DROP TRIGGER reject_ingress_audit ON audit_logs; DROP FUNCTION reject_ingress_audit()');
  });
  it('correlates tracking only to the exact connection, provider message ID and frozen phone',async () => {
    const f = await eventFixture(true);
    await f.bus.ingest('mock',input.providerConnectionId!,f.adapter.simulateWebhook(f.context,[{ type: 'message.delivered',recipient: '+5511912345678',providerMessageId: 'provider-accepted' }])); await f.bus.execute((await f.bus.due())[0]!); await f.bus.consumeCampaignEvent((await f.bus.pendingCampaignEvents())[0]!);
    expect((await database.query<Record<string,unknown>>('SELECT count(*)::int AS count FROM campaign_message_events')).rows[0]!.count).toBe(0);
    await f.bus.ingest('mock',input.providerConnectionId!,f.request); await f.bus.execute((await f.bus.due())[0]!); const job = (await f.bus.pendingCampaignEvents())[0]!;
    expect(await f.bus.consumeCampaignEvent(job)).toBe(true); expect(await f.bus.consumeCampaignEvent(job)).toBe(false);
    expect((await database.query<Record<string,unknown>>('SELECT event_type FROM campaign_message_events')).rows).toEqual([{ event_type: 'message.delivered' }]); expect(f.send).toHaveBeenCalledOnce();
    expect((await database.query<Record<string,unknown>>('SELECT status FROM campaign_dispatch_attempts')).rows[0]!.status).toBe('accepted');
  });
  it('rolls back canonical insertion and receipt finalization on audit failure for safe recovery',async () => {
    const f = await eventFixture(); await f.bus.ingest('mock',input.providerConnectionId!,f.request); const job = (await f.bus.due())[0]!;
    await database.exec("CREATE FUNCTION reject_normalized_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.event='event.normalized' THEN RAISE EXCEPTION 'audit unavailable'; END IF; RETURN NEW; END $$; CREATE TRIGGER reject_normalized_audit BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION reject_normalized_audit();");
    try { await expect(f.bus.execute(job)).rejects.toThrow('audit unavailable'); expect((await database.query<Record<string,unknown>>('SELECT status,attempts FROM webhook_receipts')).rows).toEqual([{ status: 'pending',attempts: 0 }]); expect((await database.query<Record<string,unknown>>('SELECT count(*)::int AS count FROM canonical_events')).rows[0]!.count).toBe(0); }
    finally { await database.exec('DROP TRIGGER reject_normalized_audit ON audit_logs; DROP FUNCTION reject_normalized_audit()'); }
    expect(await f.bus.execute(job)).toBe('completed');
  });
  it('discards batches whose normalizer changes the verified tenant identity',async () => {
    const f = await eventFixture(); await f.bus.ingest('mock',input.providerConnectionId!,f.request);
    const event = JSON.parse(Buffer.from(f.request.rawBody).toString())[0]; vi.spyOn(f.adapter,'normalizeEvent').mockReturnValue({ ...event,workspaceId: bob.workspace_id });
    expect(await f.bus.execute((await f.bus.due())[0]!)).toBe('discarded'); expect((await database.query<Record<string,unknown>>('SELECT count(*)::int AS count FROM canonical_events')).rows[0]!.count).toBe(0);
  });
  it('records signed unsubscribe globally, discards unsent work and never clears opt-out on subscribe',async () => {
    const f = await eventFixture(); await f.queue.enqueue(alice,f.campaign.id,3,f.snapshot.runId);
    const request = f.adapter.simulateWebhook(f.context,[{ type: 'contact.unsubscribe',recipient: '+5511987654321' }]);
    await f.bus.ingest('mock',input.providerConnectionId!,request); await f.bus.execute((await f.bus.due())[0]!);
    const job = (await f.bus.pendingCampaignEvents())[0]!; expect(await f.bus.consumeCampaignEvent(job)).toBe(true); expect(await f.bus.consumeCampaignEvent(job)).toBe(false);
    expect((await database.query<Record<string,unknown>>("SELECT status FROM campaign_dispatch_outbox")).rows[0]!.status).toBe('discarded');
    await f.bus.ingest('mock',input.providerConnectionId!,f.adapter.simulateWebhook(f.context,[{ type: 'contact.subscribe',recipient: '+5511987654321' }])); await f.bus.execute((await f.bus.due())[0]!); await f.bus.consumeCampaignEvent((await f.bus.pendingCampaignEvents())[0]!);
    expect((await database.query<Record<string,unknown>>("SELECT count(*)::int AS count FROM opt_outs WHERE phone_normalized='+5511987654321'")).rows[0]!.count).toBe(1); expect(f.send).not.toHaveBeenCalled();
  });
  it('discards receipts after credential rotation and rejects generation or workspace mismatches',async () => {
    const f = await eventFixture(); await f.bus.ingest('mock',input.providerConnectionId!,f.request); const job = (await f.bus.due())[0]!;
    expect(await f.bus.execute({ ...job,workspace_id: bob.workspace_id })).toBe('ignored'); expect(await f.bus.execute({ ...job,attempts: 1 })).toBe('ignored');
    await database.query<Record<string,unknown>>("UPDATE provider_credentials SET ciphertext='rotated' WHERE connection_id=$1",[input.providerConnectionId]);
    expect(await f.bus.execute(job)).toBe('discarded'); expect((await database.query<Record<string,unknown>>('SELECT count(*)::int AS count FROM canonical_events')).rows[0]!.count).toBe(0);
  });
  it('exhausts normalization failures without publishing partial canonical batches',async () => {
    const f = await eventFixture(); await f.bus.ingest('mock',input.providerConnectionId!,f.request); vi.spyOn(f.adapter,'parseWebhook').mockRejectedValue(new Error('synthetic parser failure'));
    for (let attempt=1;attempt<=5;attempt++) { expect(await f.bus.execute((await f.bus.due())[0]!)).toBe(attempt===5 ? 'dead' : 'pending'); clock+=5000*2**(attempt-1); }
    expect(await f.bus.due()).toEqual([]); expect((await database.query<Record<string,unknown>>('SELECT count(*)::int AS count FROM canonical_events')).rows[0]!.count).toBe(0);
  });
  it('accepts signed webhook raw bytes without session/CSRF only on the dedicated limited route',async () => {
    const f = await eventFixture(); const redis = { defineCommand: () => undefined,rateLimit: (_key: string,window: number,_max: number,_cont: boolean,_exp: boolean,callback: (error: null,value: number[]) => void) => callback(null,[1,window]) } as unknown as Redis;
    const app = createApp({ db: pool,redis,providerRegistry: f.registry,credentialCipher: f.cipher },{ appUrl: 'http://localhost:3000',secureCookies: false }); const url = `/webhooks/rcs/mock?connectionId=${input.providerConnectionId}`;
    try {
      const response = await app.inject({ method: 'POST',url,headers: { 'content-type': 'application/json',...f.request.headers },payload: Buffer.from(f.request.rawBody) }); expect(response.statusCode).toBe(202); expect(response.json().receiptId).toBeDefined();
      expect((await app.inject({ method: 'POST',url,headers: { 'content-type': 'application/json' },payload: Buffer.from(f.request.rawBody) })).statusCode).toBe(400);
      expect((await app.inject({ method: 'POST',url,headers: { 'content-type': 'application/json' },payload: Buffer.alloc(65537) })).statusCode).toBe(413);
      expect((await app.inject({ method: 'POST',url: '/auth/logout' })).statusCode).toBe(403);
      expect((await app.inject({ method: 'POST',url: '/webhooks/rcs/mock',headers: { 'content-type': 'application/json' },payload: '{}' })).statusCode).toBe(400);
    } finally { await app.close(); }
  });
  it('bootstraps one shared runtime for enqueue, worker execution and private summaries',async () => {
    const f = await dispatchFixture(); const runtime = createDispatchRuntime(pool,f.registry,f.cipher,() => clock);
    const summary = await runtime.summary(alice,f.campaign.id);
    expect(runtime.available()).toBe(true); expect(summary).toMatchObject({ revision: 3,runId: f.snapshot.runId,executionAvailable: true,counts: { pending: 0 } });
    expect(JSON.stringify(summary)).not.toMatch(/phone|credential|actor|Private content|synthetic/);
    const queued = await runtime.enqueue(alice,f.campaign.id,3,f.snapshot.runId); expect(queued).toMatchObject({ revision: 4,recipients: 1 }); expect(f.send).not.toHaveBeenCalled();
    const job = (await runtime.due())[0]!; expect(await runtime.execute(job)).toBe('completed'); expect(await runtime.execute(job)).toBe('ignored'); expect(f.send).toHaveBeenCalledOnce();
    expect((await runtime.summary(alice,f.campaign.id)).counts.completed).toBe(1);
  });
  it.each(['keys','registry'] as const)('keeps %s-disabled runtime from claiming existing dispatch intents',async (missing) => {
    const f = await dispatchFixture(); await f.queue.enqueue(alice,f.campaign.id,3,f.snapshot.runId); const job = (await f.queue.due())[0]!;
    const runtime = createDispatchRuntime(pool,missing === 'registry' ? new ProviderRegistry() : f.registry,missing === 'keys' ? undefined : f.cipher,() => clock);
    expect(runtime.available()).toBe(false); expect(await runtime.due()).toEqual([]); expect((await runtime.summary(alice,f.campaign.id)).executionAvailable).toBe(false);
    await expect(runtime.execute(job)).rejects.toMatchObject({ reason: 'conflict' });
    await expect(runtime.enqueue(alice,f.campaign.id,4,f.snapshot.runId)).rejects.toMatchObject({ reason: 'conflict' });
    expect((await database.query('SELECT status,attempts FROM campaign_dispatch_outbox')).rows).toEqual([{ status: 'pending',attempts: 0 }]); expect(f.send).not.toHaveBeenCalled();
  });
  it.each(['active','text','eligibility'] as const)('blocks runtime availability without provider %s support',async (field) => {
    const f = await dispatchFixture(); const descriptor = f.registry.describe('fixture')!;
    vi.spyOn(f.registry,'describe').mockReturnValue(field === 'active' ? { ...descriptor,active: false } : { ...descriptor,capabilities: { ...descriptor.capabilities,[field]: 'unsupported' } });
    const runtime = createDispatchRuntime(pool,f.registry,f.cipher,() => clock);
    expect(runtime.available()).toBe(false); expect((await runtime.summary(alice,f.campaign.id)).executionAvailable).toBe(false);
    await expect(runtime.enqueue(alice,f.campaign.id,3,f.snapshot.runId)).rejects.toMatchObject({ reason: 'conflict' }); expect(f.send).not.toHaveBeenCalled();
  });
  it('preserves unsent jobs during shutdown before and after a claim',async () => {
    const f = await dispatchFixture(); await f.queue.enqueue(alice,f.campaign.id,3,f.snapshot.runId); const job = (await f.queue.due())[0]!;
    const stopped = new AbortController(); stopped.abort(); expect(await f.queue.execute(job,stopped.signal)).toBe('ignored');
    expect((await database.query('SELECT status,attempts FROM campaign_dispatch_outbox')).rows).toEqual([{ status: 'pending',attempts: 0 }]);
    const stopping = new AbortController(); const queue = new CampaignDispatchOutbox(pool,{ dispatch: async () => { stopping.abort(); throw new Error('shutdown'); } },() => clock);
    expect(await queue.execute(job,stopping.signal)).toBe('pending');
    expect((await database.query('SELECT status,attempts FROM campaign_dispatch_outbox')).rows).toEqual([{ status: 'pending',attempts: 1 }]); expect(f.send).not.toHaveBeenCalled();
  });
  it('keeps unconfirmed and cancelled preparation unavailable to the shared runtime',async () => {
    const f = await dispatchFixture('dispatch',false); const runtime = createDispatchRuntime(pool,f.registry,f.cipher,() => clock);
    expect((await runtime.summary(alice,f.campaign.id)).executionAvailable).toBe(false);
    await expect(runtime.enqueue(alice,f.campaign.id,2,f.snapshot.runId)).rejects.toMatchObject({ reason: 'conflict' });
    await f.preparation.confirm(alice,f.campaign.id,2,f.snapshot.runId,'dispatch');
    await f.preparation.cancel(alice,f.campaign.id,3,f.snapshot.runId);
    expect((await runtime.summary(alice,f.campaign.id)).executionAvailable).toBe(false); expect(f.send).not.toHaveBeenCalled();
  });
  it('revalidates summary scope, reader access and enqueue revision/run identity',async () => {
    const f = await dispatchFixture(); const runtime = createDispatchRuntime(pool,f.registry,f.cipher,() => clock);
    await expect(runtime.summary(bob,f.campaign.id)).rejects.toMatchObject({ reason: 'not_found' });
    await expect(runtime.enqueue(alice,f.campaign.id,2,f.snapshot.runId)).rejects.toMatchObject({ reason: 'conflict' });
    await expect(runtime.enqueue(alice,f.campaign.id,3,randomUUID())).rejects.toMatchObject({ reason: 'conflict' });
    await database.query("UPDATE workspace_members SET role='viewer' WHERE workspace_id=$1",[alice.workspace_id]);
    expect((await runtime.summary(alice,f.campaign.id)).revision).toBe(3);
    await expect(runtime.enqueue(alice,f.campaign.id,3,f.snapshot.runId)).rejects.toMatchObject({ reason: 'forbidden' });
    await database.query("UPDATE users SET status='disabled',disabled_at=now() WHERE id=$1",[alice.user_id]);
    await expect(runtime.summary(alice,f.campaign.id)).rejects.toMatchObject({ reason: 'not_found' }); expect(f.send).not.toHaveBeenCalled();
  });
  it('protects dispatch HTTP summaries and enqueue with auth, CSRF, mode, strict body and revision',async () => {
    const f = await dispatchFixture();
    const redis = { defineCommand: () => undefined,rateLimit: (_key: string,window: number,_max: number,_cont: boolean,_exp: boolean,callback: (error: null,value: number[]) => void) => callback(null,[1,window]) } as unknown as Redis;
    const authStore = { findSession: async () => ({ id: alice.user_id,name: 'Alice',email: 'alice@example.test' }) } as unknown as AuthStore;
    const app = createApp({ db: pool,redis,authStore,providerRegistry: f.registry,credentialCipher: f.cipher },{ appUrl: 'http://localhost:3000',secureCookies: false });
    const base = `/workspaces/${alice.workspace_id}/campaigns/${f.campaign.id}/dispatch`; const url = `${base}/enqueue`;
    const headers = { origin: 'http://localhost:3000','x-rcs-request': '1',cookie: `rcs_session=${'a'.repeat(43)}` }; const payload = { mode: 'dispatch',expectedRevision: 3,runId: f.snapshot.runId };
    try {
      expect((await app.inject({ url: base })).statusCode).toBe(401);
      expect((await app.inject({ url: base,headers })).json().dispatch.executionAvailable).toBe(true);
      expect((await app.inject({ method: 'POST',url,headers: { cookie: headers.cookie },payload })).statusCode).toBe(403);
      for (const invalid of [{ ...payload,mode: 'simulation' },{ ...payload,expectedRevision: 0 },{ ...payload,expectedRevision: 2147483647 },{ ...payload,phone: '+5511987654321' },{ ...payload,runId: 'invalid' }]) expect((await app.inject({ method: 'POST',url,headers,payload: invalid })).statusCode).toBe(400);
      expect((await app.inject({ method: 'POST',url,headers: { ...headers,'content-type': 'application/json' },payload: 'x'.repeat(1025) })).statusCode).toBe(413);
      expect((await app.inject({ method: 'POST',url: url.replace(alice.workspace_id,bob.workspace_id),headers,payload })).statusCode).toBe(404);
      const response = await app.inject({ method: 'POST',url,headers,payload }); expect(response.statusCode).toBe(201); expect(response.json().dispatch).toMatchObject({ revision: 4,recipients: 1 }); expect(f.send).not.toHaveBeenCalled();
      expect(response.body).not.toMatch(/phone|Private content|credential|actor/);
      expect((await app.inject({ method: 'POST',url,headers,payload })).statusCode).toBe(409);
      await database.query("UPDATE workspace_members SET role='viewer' WHERE workspace_id=$1",[alice.workspace_id]);
      expect((await app.inject({ url: base,headers })).statusCode).toBe(200); expect((await app.inject({ method: 'POST',url,headers,payload })).statusCode).toBe(403);
    } finally { await app.close(); }
  });
  it('records accepted dispatch once with stable idempotency and immutable ledger identity',async () => {
    const f = await dispatchFixture(); const first = await f.dispatch(); const second = await f.dispatch();
    expect(first).toMatchObject({ status: 'accepted',providerMessageId: 'provider-accepted',errorCode: null }); expect(second).toEqual(first); expect(f.send).toHaveBeenCalledOnce();
    expect(f.send.mock.calls[0]![1]).toMatchObject({ agentId: 'agent-a',recipient: '+5511987654321',idempotencyKey: `dispatch-${first.id}`,message: { type: 'text',text: 'Private content' } });
    expect(JSON.stringify(first)).not.toMatch(/synthetic|Private content|\+5511|credential/);
    await expect(database.query("UPDATE campaign_dispatch_attempts SET status='sending' WHERE id=$1",[first.id])).rejects.toThrow('final');
    await expect(database.query("UPDATE campaign_dispatch_attempts SET phone_normalized='+5511999999999' WHERE id=$1",[first.id])).rejects.toThrow('immutable');
    await expect(database.query('DELETE FROM campaign_dispatch_attempts WHERE id=$1',[first.id])).rejects.toThrow('cannot be deleted');
    expect(JSON.stringify((await database.query("SELECT metadata FROM audit_logs WHERE event LIKE 'campaign.dispatch_%'")).rows)).not.toMatch(/synthetic|Private content|\+5511|provider-accepted/);
  });
  it('enqueues only frozen eligible recipients atomically and executes each ledger attempt once',async () => {
    const f = await dispatchFixture(); const queued = await f.queue.enqueue(alice,f.campaign.id,3,f.snapshot.runId);
    expect(queued).toMatchObject({ revision: 4,recipients: 1 }); expect(f.send).not.toHaveBeenCalled();
    const jobs = await f.queue.due(); expect(jobs).toHaveLength(1); expect(Object.keys(jobs[0]!).sort()).toEqual(['attempts','id','workspace_id']);
    expect(await f.queue.execute(jobs[0]!)).toBe('completed'); expect(await f.queue.execute(jobs[0]!)).toBe('ignored'); expect(await f.queue.due()).toEqual([]); expect(f.send).toHaveBeenCalledOnce();
    await expect(f.queue.enqueue(alice,f.campaign.id,4,f.snapshot.runId)).rejects.toMatchObject({ reason: 'conflict' });
    await expect(database.query('DELETE FROM campaign_dispatch_outbox')).rejects.toThrow('cannot be deleted');
    await expect(database.query("UPDATE campaign_dispatch_outbox SET status='pending'")).rejects.toThrow('final');
  });
  it('honors not-before and ignores foreign or stale transport generations',async () => {
    input.scheduledAt = new Date(clock+1000).toISOString(); const f = await dispatchFixture(); await f.queue.enqueue(alice,f.campaign.id,3,f.snapshot.runId);
    expect(await f.queue.due()).toEqual([]); clock+=1000; const job = (await f.queue.due())[0]!;
    expect(await f.queue.execute({ ...job,workspace_id: bob.workspace_id })).toBe('ignored'); expect(await f.queue.execute({ ...job,attempts: 1 })).toBe('ignored');
    expect(await f.queue.execute(job)).toBe('completed'); expect(f.send).toHaveBeenCalledOnce();
  });
  it.each(['role','user','revision','consent','phone'] as const)('blocks queued dispatch after %s changes',async (change) => {
    const f = await dispatchFixture(); await f.queue.enqueue(alice,f.campaign.id,3,f.snapshot.runId); const job = (await f.queue.due())[0]!;
    if (change === 'role') await database.query("UPDATE workspace_members SET role='viewer' WHERE workspace_id=$1",[alice.workspace_id]);
    if (change === 'user') await database.query("UPDATE users SET status='disabled' WHERE id=$1",[alice.user_id]);
    if (change === 'revision') await database.query('UPDATE campaigns SET revision=revision+1 WHERE id=$1',[f.campaign.id]);
    if (change === 'consent') await f.consents.record(alice,f.contact,consentInput({ state: 'revoked',expectedRevision: 1 }));
    if (change === 'phone') await database.query("UPDATE contacts SET phone_normalized='+5511999999999' WHERE id=$1",[f.contact]);
    expect(await f.queue.execute(job)).toBe('discarded'); expect(f.send).not.toHaveBeenCalled();
  });
  it('cancels pending outbox intents atomically before any dispatch attempt',async () => {
    const f = await dispatchFixture(); await f.queue.enqueue(alice,f.campaign.id,3,f.snapshot.runId);
    expect((await f.preparation.cancel(alice,f.campaign.id,4,f.snapshot.runId)).status).toBe('cancelled'); expect(await f.queue.due()).toEqual([]); expect((await database.query('SELECT status FROM campaign_dispatch_outbox')).rows).toEqual([{ status: 'discarded' }]); expect(f.send).not.toHaveBeenCalled();
  });
  it('recovers result-audit failure through the ledger without sending again',async () => {
    const f = await dispatchFixture(); await f.queue.enqueue(alice,f.campaign.id,3,f.snapshot.runId); const job = (await f.queue.due())[0]!;
    await database.exec("CREATE FUNCTION reject_outbox_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.event='campaign.dispatch_job_finalized' THEN RAISE EXCEPTION 'audit unavailable'; END IF; RETURN NEW; END $$; CREATE TRIGGER reject_outbox_audit BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION reject_outbox_audit();");
    try { await expect(f.queue.execute(job)).rejects.toThrow('audit unavailable'); expect(f.send).toHaveBeenCalledOnce(); expect((await database.query('SELECT status FROM campaign_dispatch_outbox')).rows).toEqual([{ status: 'processing' }]); }
    finally { await database.exec('DROP TRIGGER reject_outbox_audit ON audit_logs; DROP FUNCTION reject_outbox_audit()'); }
    clock+=30000; const recovery = (await f.queue.due())[0]!; expect(recovery.attempts).toBe(1); expect(await f.queue.execute(recovery)).toBe('completed'); expect(f.send).toHaveBeenCalledOnce();
  });
  it.each(['sending','unknown'] as const)('never retries an unresolved %s ledger outcome',async (state) => {
    const f = await dispatchFixture(); await f.queue.enqueue(alice,f.campaign.id,3,f.snapshot.runId); const job = (await f.queue.due())[0]!;
    if (state === 'unknown') f.send.mockRejectedValue(new Error('synthetic unavailable'));
    else await database.exec("CREATE FUNCTION reject_outbox_result() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.event='campaign.dispatch_result' THEN RAISE EXCEPTION 'audit unavailable'; END IF; RETURN NEW; END $$; CREATE TRIGGER reject_outbox_result BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION reject_outbox_result();");
    try { expect(await f.queue.execute(job)).toBe('unresolved'); expect(await f.queue.due()).toEqual([]); expect(f.send).toHaveBeenCalledOnce(); }
    finally { if (state === 'sending') await database.exec('DROP TRIGGER reject_outbox_result ON audit_logs; DROP FUNCTION reject_outbox_result()'); }
  });
  it('retries failures without a ledger with backoff and stops on the fifth claim',async () => {
    const f = await dispatchFixture(); const dispatch = vi.fn(async () => { throw new Error('synthetic database failure'); }); const queue = new CampaignDispatchOutbox(pool,{ dispatch },() => clock);
    await queue.enqueue(alice,f.campaign.id,3,f.snapshot.runId);
    for (let attempt = 1; attempt<=5; attempt++) { const job = (await queue.due())[0]!; expect(job.attempts).toBe(attempt-1); expect(await queue.execute(job)).toBe(attempt === 5 ? 'dead' : 'pending'); expect(await queue.due()).toEqual([]); clock+=5000*2**(attempt-1); }
    expect(dispatch).toHaveBeenCalledTimes(5); expect(f.send).not.toHaveBeenCalled(); expect((await database.query('SELECT attempts,status FROM campaign_dispatch_outbox')).rows).toEqual([{ attempts: 5,status: 'dead' }]);
  });
  it('rolls enqueue and claim back when audit cannot be stored',async () => {
    const f = await dispatchFixture(); await database.exec("CREATE FUNCTION reject_queue_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.event IN ('campaign.dispatch_enqueued','campaign.dispatch_job_claimed') THEN RAISE EXCEPTION 'audit unavailable'; END IF; RETURN NEW; END $$; CREATE TRIGGER reject_queue_audit BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION reject_queue_audit();");
    try { await expect(f.queue.enqueue(alice,f.campaign.id,3,f.snapshot.runId)).rejects.toThrow('audit unavailable'); expect((await database.query('SELECT id FROM campaign_dispatch_outbox')).rows).toEqual([]); expect((await store.get(alice,f.campaign.id))?.revision).toBe(3); }
    finally { await database.exec('DROP TRIGGER reject_queue_audit ON audit_logs; DROP FUNCTION reject_queue_audit()'); }
    await f.queue.enqueue(alice,f.campaign.id,3,f.snapshot.runId); const job = (await f.queue.due())[0]!;
    await database.exec("CREATE FUNCTION reject_queue_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.event='campaign.dispatch_job_claimed' THEN RAISE EXCEPTION 'audit unavailable'; END IF; RETURN NEW; END $$; CREATE TRIGGER reject_queue_audit BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION reject_queue_audit();");
    try { await expect(f.queue.execute(job)).rejects.toThrow('audit unavailable'); expect(f.send).not.toHaveBeenCalled(); expect((await database.query('SELECT attempts,status FROM campaign_dispatch_outbox')).rows).toEqual([{ attempts: 0,status: 'pending' }]); }
    finally { await database.exec('DROP TRIGGER reject_queue_audit ON audit_logs; DROP FUNCTION reject_queue_audit()'); }
  });
  const consentInput = (overrides: Partial<ConsentInput> = {}): ConsentInput => ({ purpose: 'marketing',state: 'granted',source: 'manual_record',evidenceReference: 'synthetic-proof-reference',observedAt: new Date(clock-500).toISOString(),expectedRevision: 0,expectedPhone: '+5511987654321',...overrides });
  it('keeps imported contacts unknown and records purpose-specific grant/revoke history without exposing evidence',async () => {
    const f = await dispatchFixture('dispatch',true,false);
    const unknown = await f.consents.get(alice,f.contact); expect(unknown.consents.every((item) => item.state === 'unknown' && item.revision === 0)).toBe(true);
    const granted = await f.consents.record(alice,f.contact,consentInput()); expect(granted.consents[0]).toMatchObject({ purpose: 'marketing',state: 'granted',revision: 1 }); expect(granted.consents[1]?.state).toBe('unknown');
    const revoked = await f.consents.record(alice,f.contact,consentInput({ state: 'revoked',expectedRevision: 1 })); expect(revoked.consents[0]).toMatchObject({ state: 'revoked',revision: 2 });
    expect(JSON.stringify(revoked)).not.toMatch(/evidence|synthetic|actor_user_id/);
    expect((await database.query('SELECT state FROM contact_rcs_consents ORDER BY revision')).rows).toEqual([{ state: 'granted' },{ state: 'revoked' }]);
    await expect(database.query("UPDATE contact_rcs_consents SET state='granted'")).rejects.toThrow('immutable'); await expect(database.query('DELETE FROM contact_rcs_consents')).rejects.toThrow('immutable');
    expect(JSON.stringify((await database.query("SELECT metadata FROM audit_logs WHERE event='contacts.rcs_consent_recorded'")).rows)).not.toMatch(/synthetic|\+5511|evidence/);
  });
  it.each(['unknown','revoked','wrong-purpose'] as const)('blocks %s consent before reservation or provider operations',async (condition) => {
    const f = await dispatchFixture('dispatch',true,false);
    if (condition !== 'unknown') await f.consents.record(alice,f.contact,consentInput({ state: condition === 'revoked' ? 'revoked' : 'granted',purpose: condition === 'wrong-purpose' ? 'authentication' : 'marketing' }));
    await expect(f.dispatch()).rejects.toMatchObject({ reason: 'conflict' }); expect(f.send).not.toHaveBeenCalled(); expect(f.getAgent).not.toHaveBeenCalled(); expect((await database.query('SELECT id FROM campaign_dispatch_attempts')).rows).toEqual([]);
  });
  it('rechecks consent revocation after reservation and agent lookup',async () => {
    const f = await dispatchFixture(); f.getAgentCapabilities.mockImplementation(async () => { await f.consents.record(alice,f.contact,consentInput({ state: 'revoked',expectedRevision: 1 })); return new MockRcsProvider().getProviderCapabilities(); });
    expect(await f.dispatch()).toMatchObject({ status: 'rejected',errorCode: 'rejected' }); expect(f.send).not.toHaveBeenCalled();
  });
  it('does not clear opt-out or transfer consent to a changed contact phone',async () => {
    const f = await dispatchFixture('dispatch',true,false); await database.query('INSERT INTO opt_outs (workspace_id,phone_normalized) VALUES ($1,$2)',[alice.workspace_id,'+5511987654321']);
    expect((await f.consents.record(alice,f.contact,consentInput())).optedOut).toBe(true); await expect(f.dispatch()).rejects.toMatchObject({ reason: 'conflict' });
    await database.query("UPDATE contacts SET phone_normalized='+5511999999999' WHERE id=$1",[f.contact]);
    expect((await f.consents.get(alice,f.contact)).consents.every((item) => item.state === 'unknown')).toBe(true);
    await expect(f.consents.record(alice,f.contact,consentInput())).rejects.toMatchObject({ reason: 'conflict' }); expect(f.send).not.toHaveBeenCalled();
  });
  it('rejects stale revisions and old observations, and serializes competing records',async () => {
    const f = await dispatchFixture('dispatch',true,false);
    const concurrent = await Promise.allSettled([f.consents.record(alice,f.contact,consentInput()),f.consents.record(alice,f.contact,consentInput())]); expect(concurrent.filter((item) => item.status === 'fulfilled')).toHaveLength(1);
    await f.consents.record(alice,f.contact,consentInput({ expectedRevision: 1,state: 'revoked' }));
    await expect(f.consents.record(alice,f.contact,consentInput({ expectedRevision: 2,observedAt: new Date(clock-1000).toISOString() }))).rejects.toMatchObject({ reason: 'conflict' });
    expect((await f.consents.get(alice,f.contact)).consents[0]?.state).toBe('revoked');
  });
  it.each([{ evidenceReference: ' ' },{ evidenceReference: 'private\ntext' },{ evidenceReference: 'x'.repeat(129) },{ observedAt: 'invalid' },{ observedAt: '2099-01-01T00:00:00.000Z' },{ expectedRevision: -1 },{ expectedPhone: 'invalid' }])('rejects invalid consent input %j',async (invalid) => {
    const f = await dispatchFixture('dispatch',true,false); await expect(f.consents.record(alice,f.contact,consentInput(invalid))).rejects.toMatchObject({ reason: 'invalid' }); expect((await database.query('SELECT id FROM contact_rcs_consents')).rows).toEqual([]);
  });
  it('rolls consent back when audit persistence fails and rechecks current access',async () => {
    const f = await dispatchFixture('dispatch',true,false);
    await expect(f.consents.get(bob,f.contact)).rejects.toMatchObject({ reason: 'not_found' });
    await database.exec("CREATE FUNCTION reject_consent_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.event='contacts.rcs_consent_recorded' THEN RAISE EXCEPTION 'audit unavailable'; END IF; RETURN NEW; END $$; CREATE TRIGGER reject_consent_audit BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION reject_consent_audit();");
    try { await expect(f.consents.record(alice,f.contact,consentInput())).rejects.toThrow('audit unavailable'); expect((await database.query('SELECT id FROM contact_rcs_consents')).rows).toEqual([]); }
    finally { await database.exec('DROP TRIGGER reject_consent_audit ON audit_logs; DROP FUNCTION reject_consent_audit()'); }
    await database.query("UPDATE workspace_members SET role='viewer' WHERE workspace_id=$1",[alice.workspace_id]); expect((await f.consents.get(alice,f.contact)).consents[0]?.state).toBe('unknown'); await expect(f.consents.record(alice,f.contact,consentInput())).rejects.toMatchObject({ reason: 'forbidden' });
  });
  it('enforces consent HTTP session, CSRF, workspace ownership, strict input and revisions',async () => {
    const f = await dispatchFixture('dispatch',true,false);
    const redis = { defineCommand: () => undefined,rateLimit: (_key: string,window: number,_max: number,_cont: boolean,_exp: boolean,callback: (error: null,value: number[]) => void) => callback(null,[1,window]) } as unknown as Redis;
    const authStore = { findSession: async () => ({ id: alice.user_id,name: 'Alice',email: 'alice@example.test' }) } as unknown as AuthStore;
    const app = createApp({ db: pool,redis,authStore },{ appUrl: 'http://localhost:3000',secureCookies: false });
    const base = `/workspaces/${alice.workspace_id}/contacts/${f.contact}/rcs-consents`; const headers = { origin: 'http://localhost:3000','x-rcs-request': '1',cookie: `rcs_session=${'a'.repeat(43)}` };
    try {
      expect((await app.inject({ url: base })).statusCode).toBe(401); expect((await app.inject({ url: base,headers })).json().consents[0].state).toBe('unknown');
      expect((await app.inject({ method: 'POST',url: base,headers: { cookie: headers.cookie },payload: consentInput() })).statusCode).toBe(403);
      for (const invalid of [{ ...consentInput(),source: 'forged' },{ ...consentInput(),extra: true },{ ...consentInput(),expectedPhone: undefined },{ ...consentInput(),expectedRevision: '0' }]) expect((await app.inject({ method: 'POST',url: base,headers,payload: invalid })).statusCode).toBe(400);
      const recorded = await app.inject({ method: 'POST',url: base,headers,payload: consentInput() }); expect(recorded.statusCode).toBe(201); expect(recorded.headers['cache-control']).toBe('no-store'); expect(recorded.body).not.toContain('synthetic-proof-reference');
      expect((await app.inject({ method: 'POST',url: base,headers,payload: consentInput() })).statusCode).toBe(409);
      expect((await app.inject({ url: base.replace(alice.workspace_id,bob.workspace_id),headers })).statusCode).toBe(404);
      await database.query("UPDATE workspace_members SET role='viewer' WHERE workspace_id=$1",[alice.workspace_id]); expect((await app.inject({ url: base,headers })).statusCode).toBe(200); expect((await app.inject({ method: 'POST',url: base,headers,payload: consentInput({ expectedRevision: 1 }) })).statusCode).toBe(403);
    } finally { await app.close(); }
  });
  it('freezes the complete audience and requires an explicit confirmation without provider calls',async () => {
    const f = await dispatchFixture('dispatch',false);
    expect(f.snapshot).toMatchObject({ revision: 2,confirmed: false,counts: { total: 2,eligible: 1,suppressed: 1,unavailable: 0 },executionAvailable: false });
    expect(JSON.stringify(f.snapshot)).not.toMatch(/phone|credential|Private content|synthetic/);
    await expect(f.dispatch()).rejects.toMatchObject({ reason: 'conflict' });
    expect(f.getAgent).not.toHaveBeenCalled(); expect(f.getAgentCapabilities).not.toHaveBeenCalled(); expect(f.send).not.toHaveBeenCalled();
    const confirmed = await f.preparation.confirm(alice,f.campaign.id,2,f.snapshot.runId,'dispatch');
    expect(confirmed).toMatchObject({ revision: 3,confirmed: true,executionAvailable: false });
    expect(f.getAgent).not.toHaveBeenCalled(); expect(f.send).not.toHaveBeenCalled();
    await expect(f.preparation.confirm(alice,f.campaign.id,3,f.snapshot.runId,'dispatch')).rejects.toMatchObject({ reason: 'conflict' });
    await expect(f.preparation.prepare(alice,f.campaign.id,3)).rejects.toMatchObject({ reason: 'conflict' });
  });
  it('does not admit new list members and continues using frozen members removed from the list',async () => {
    const f = await dispatchFixture(); await addRecipients(1);
    const extra = (await database.query<{ id: string }>("SELECT id FROM contacts WHERE phone_normalized='+5511900000001'")).rows[0]!.id;
    await seedCheck('+5511900000001','eligible',(await database.query<{ credential_version: string }>('SELECT credential_version FROM campaign_dispatch_runs')).rows[0]!.credential_version);
    await expect(f.engine.dispatch(alice,f.campaign.id,extra,f.campaign.revision,new AbortController().signal)).rejects.toMatchObject({ reason: 'conflict' });
    await database.query('DELETE FROM contact_list_members WHERE contact_id=$1',[f.contact]);
    expect((await f.dispatch()).status).toBe('accepted'); expect(f.send).toHaveBeenCalledOnce();
  });
  it('never promotes initially suppressed or unavailable recipients after preparation',async () => {
    await addRecipients(1); const f = await dispatchFixture();
    const version = (await database.query<{ credential_version: string }>('SELECT credential_version FROM campaign_dispatch_runs')).rows[0]!.credential_version;
    await database.query('DELETE FROM opt_outs'); await seedCheck('+5511912345678','eligible',version); await seedCheck('+5511900000001','eligible',version);
    for (const phone of ['+5511912345678','+5511900000001']) {
      const id = (await database.query<{ id: string }>('SELECT id FROM contacts WHERE phone_normalized=$1',[phone])).rows[0]!.id;
      await expect(f.engine.dispatch(alice,f.campaign.id,id,f.campaign.revision,new AbortController().signal)).rejects.toMatchObject({ reason: 'conflict' });
    }
    expect(f.send).not.toHaveBeenCalled();
  });
  it('rejects changed recipient phones instead of sending to the new or frozen phone',async () => {
    const f = await dispatchFixture(); await database.query("UPDATE contacts SET phone_normalized='+5511999999999' WHERE id=$1",[f.contact]);
    await expect(f.dispatch()).rejects.toMatchObject({ reason: 'conflict' }); expect(f.send).not.toHaveBeenCalled();
  });
  it.each(['revision','run','mode','rotated','expired','opted-out','archived','foreign','revoked'] as const)('rejects confirmation with %s and never calls the adapter',async (change) => {
    const f = await dispatchFixture('dispatch',false);
    if (change === 'rotated') await database.query("UPDATE provider_credentials SET ciphertext='changed' WHERE workspace_id=$1",[alice.workspace_id]);
    if (change === 'expired') clock+=300000;
    if (change === 'opted-out') await database.query('INSERT INTO opt_outs (workspace_id,phone_normalized) VALUES ($1,$2)',[alice.workspace_id,'+5511987654321']);
    if (change === 'archived') await database.query("UPDATE messages SET status='archived',active_version=NULL WHERE workspace_id=$1",[alice.workspace_id]);
    if (change === 'revoked') await database.query("UPDATE workspace_members SET role='viewer' WHERE workspace_id=$1",[alice.workspace_id]);
    await expect(f.preparation.confirm(change === 'foreign' ? bob : alice,f.campaign.id,change === 'revision' ? 1 : 2,change === 'run' ? randomUUID() : f.snapshot.runId,change === 'mode' ? 'simulation' as 'dispatch' : 'dispatch')).rejects.toMatchObject({ reason: change === 'foreign' ? 'not_found' : change === 'revoked' ? 'forbidden' : 'conflict' });
    expect((await database.query('SELECT * FROM campaign_dispatch_confirmations')).rows).toEqual([]); expect(f.getAgent).not.toHaveBeenCalled(); expect(f.send).not.toHaveBeenCalled();
  });
  it('protects run, audience and confirmation records from edits, deletion and late recipients',async () => {
    const f = await dispatchFixture();
    for (const table of ['campaign_dispatch_runs','campaign_dispatch_recipients','campaign_dispatch_confirmations']) {
      await expect(database.query(`DELETE FROM ${table}`)).rejects.toThrow('immutable');
      await expect(database.query(`UPDATE ${table} SET campaign_id=campaign_id`)).rejects.toThrow('immutable');
    }
    await expect(database.query("INSERT INTO campaign_dispatch_recipients (workspace_id,run_id,campaign_id,contact_id,phone_normalized,disposition) VALUES ($1,$2,$3,$4,'+5511987654321','eligible')",[alice.workspace_id,f.snapshot.runId,f.campaign.id,f.contact])).rejects.toThrow('requires draft');
  });
  it('rolls back preparation and confirmation entirely when their audit cannot be stored',async () => {
    const f = await dispatchFixture('dispatch',false);
    await database.exec("CREATE FUNCTION reject_preparation_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.event IN ('campaign.dispatch_prepared','campaign.dispatch_confirmed') THEN RAISE EXCEPTION 'audit unavailable'; END IF; RETURN NEW; END $$; CREATE TRIGGER reject_preparation_audit BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION reject_preparation_audit();");
    try {
      const draft = await store.create(alice,input);
      await expect(f.preparation.prepare(alice,draft.id,1)).rejects.toThrow('audit unavailable');
      expect((await store.get(alice,draft.id))?.status).toBe('draft');
      expect((await database.query('SELECT id FROM campaign_dispatch_runs WHERE campaign_id=$1',[draft.id])).rows).toEqual([]);
      await expect(f.preparation.confirm(alice,f.campaign.id,2,f.snapshot.runId,'dispatch')).rejects.toThrow('audit unavailable');
      expect((await store.get(alice,f.campaign.id))?.revision).toBe(2); expect((await database.query('SELECT * FROM campaign_dispatch_confirmations')).rows).toEqual([]);
    } finally { await database.exec('DROP TRIGGER reject_preparation_audit ON audit_logs; DROP FUNCTION reject_preparation_audit()'); }
  });
  it.each(['expired','limit','connection','agent','revoked'] as const)('rejects preparation with %s without freezing a partial audience',async (change) => {
    const f = await dispatchFixture('dispatch',false); const draft = await store.create(alice,input);
    if (change === 'expired') clock+=300000;
    if (change === 'limit') await addRecipients(5000);
    if (change === 'connection') await database.query('DELETE FROM provider_credentials WHERE workspace_id=$1',[alice.workspace_id]);
    if (change === 'agent') await database.query("UPDATE provider_connections SET external_agent_id='different-agent' WHERE id=$1",[input.providerConnectionId]);
    if (change === 'revoked') await database.query("UPDATE workspace_members SET role='viewer' WHERE workspace_id=$1",[alice.workspace_id]);
    await expect(f.preparation.prepare(alice,draft.id,1)).rejects.toMatchObject({ reason: change === 'revoked' ? 'forbidden' : 'conflict' });
    expect((await database.query('SELECT id FROM campaign_dispatch_runs WHERE campaign_id=$1',[draft.id])).rows).toEqual([]);
    expect((await database.query<{ status: string; execution_mode: string | null }>('SELECT status,execution_mode FROM campaigns WHERE id=$1',[draft.id])).rows[0]).toEqual({ status: 'draft',execution_mode: null });
    expect(f.getAgent).not.toHaveBeenCalled(); expect(f.send).not.toHaveBeenCalled();
  });
  it('blocks hand-bootstrapped dispatch campaigns that have no confirmed frozen run',async () => {
    const f = await dispatchFixture(); const draft = await store.create(alice,input);
    await database.query("UPDATE campaigns SET execution_mode='dispatch',status='ready' WHERE id=$1",[draft.id]);
    await expect(f.engine.dispatch(alice,draft.id,f.contact,1,new AbortController().signal)).rejects.toMatchObject({ reason: 'conflict' });
    expect(f.getAgent).not.toHaveBeenCalled(); expect(f.send).not.toHaveBeenCalled();
  });
  it.each([false,true])('cancels prepared dispatch with confirmed=%s while preserving its immutable history',async (confirmed) => {
    const f = await dispatchFixture('dispatch',confirmed);
    const cancelled = await f.preparation.cancel(alice,f.campaign.id,f.campaign.revision,f.snapshot.runId);
    expect(cancelled).toMatchObject({ status: 'cancelled',revision: f.campaign.revision+1,confirmed,executionAvailable: false,counts: f.snapshot.counts });
    expect(await f.preparation.get(alice,f.campaign.id)).toEqual(cancelled);
    await expect(f.dispatch()).rejects.toMatchObject({ reason: 'conflict' });
    await expect(f.preparation.confirm(alice,f.campaign.id,cancelled.revision,f.snapshot.runId,'dispatch')).rejects.toMatchObject({ reason: 'conflict' });
    await expect(f.preparation.cancel(alice,f.campaign.id,cancelled.revision,f.snapshot.runId)).rejects.toMatchObject({ reason: 'conflict' });
    expect((await database.query('SELECT id FROM campaign_dispatch_runs')).rows).toHaveLength(1);
    expect((await database.query('SELECT contact_id FROM campaign_dispatch_recipients')).rows).toHaveLength(2);
    expect(f.send).not.toHaveBeenCalled();
  });
  it.each(['accepted','sending','unknown'] as const)('refuses preparation cancellation after a %s dispatch attempt exists',async (status) => {
    const f = await dispatchFixture();
    if (status === 'sending') {
      await database.query(`INSERT INTO campaign_dispatch_attempts (workspace_id,campaign_id,contact_id,connection_id,message_version_id,actor_user_id,campaign_revision,credential_version,phone_normalized,agent_id,status) SELECT r.workspace_id,r.campaign_id,c.contact_id,r.connection_id,r.message_version_id,$1,$2,r.credential_version,c.phone_normalized,r.agent_id,'sending' FROM campaign_dispatch_runs r JOIN campaign_dispatch_recipients c ON c.workspace_id=r.workspace_id AND c.run_id=r.id WHERE c.contact_id=$3`,[alice.user_id,f.campaign.revision,f.contact]);
    } else { if (status === 'unknown') f.send.mockRejectedValue(new Error('synthetic timeout')); expect((await f.dispatch()).status).toBe(status); }
    await expect(f.preparation.cancel(alice,f.campaign.id,f.campaign.revision,f.snapshot.runId)).rejects.toMatchObject({ reason: 'conflict' });
    expect((await f.preparation.get(alice,f.campaign.id))?.status).toBe('ready');
  });
  it('rolls cancellation back on audit failure and rechecks revision, run and authorization',async () => {
    const f = await dispatchFixture('dispatch',false);
    await expect(f.preparation.cancel(alice,f.campaign.id,1,f.snapshot.runId)).rejects.toMatchObject({ reason: 'conflict' });
    await expect(f.preparation.cancel(alice,f.campaign.id,2,randomUUID())).rejects.toMatchObject({ reason: 'conflict' });
    await expect(f.preparation.cancel(bob,f.campaign.id,2,f.snapshot.runId)).rejects.toMatchObject({ reason: 'not_found' });
    await database.exec("CREATE FUNCTION reject_cancel_preparation_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.event='campaign.dispatch_preparation_cancelled' THEN RAISE EXCEPTION 'audit unavailable'; END IF; RETURN NEW; END $$; CREATE TRIGGER reject_cancel_preparation_audit BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION reject_cancel_preparation_audit();");
    try { await expect(f.preparation.cancel(alice,f.campaign.id,2,f.snapshot.runId)).rejects.toThrow('audit unavailable'); expect((await f.preparation.get(alice,f.campaign.id))?.revision).toBe(2); }
    finally { await database.exec('DROP TRIGGER reject_cancel_preparation_audit ON audit_logs; DROP FUNCTION reject_cancel_preparation_audit()'); }
    await database.query("UPDATE workspace_members SET role='viewer' WHERE workspace_id=$1",[alice.workspace_id]);
    expect((await f.preparation.get(alice,f.campaign.id))?.runId).toBe(f.snapshot.runId);
    await expect(f.preparation.cancel(alice,f.campaign.id,2,f.snapshot.runId)).rejects.toMatchObject({ reason: 'forbidden' });
    await database.query("UPDATE users SET status='disabled' WHERE id=$1",[alice.user_id]);
    await expect(f.preparation.get(alice,f.campaign.id)).rejects.toMatchObject({ reason: 'not_found' });
  });
  it('exposes preparation, confirmation, reading and cancellation through HTTP without provider or queue operations',async () => {
    const f = await dispatchFixture('dispatch',false); const draft = await store.create(alice,input);
    const redis = { defineCommand: () => undefined,rateLimit: (_key: string,window: number,_max: number,_cont: boolean,_exp: boolean,callback: (error: null,value: number[]) => void) => callback(null,[1,window]) } as unknown as Redis;
    const authStore = { findSession: async () => ({ id: alice.user_id,name: 'Alice',email: 'alice@example.test' }) } as unknown as AuthStore;
    const app = createApp({ db: pool,redis,authStore,providerRegistry: f.registry },{ appUrl: 'http://localhost:3000',secureCookies: false });
    const base = `/workspaces/${alice.workspace_id}/campaigns/${draft.id}/dispatch-preparation`;
    const headers = { origin: 'http://localhost:3000','x-rcs-request': '1',cookie: `rcs_session=${'a'.repeat(43)}` };
    try {
      expect((await app.inject({ url: base,headers })).json()).toEqual({ preparation: null });
      const prepared = await app.inject({ method: 'POST',url: `${base}/prepare`,headers,payload: { expectedRevision: 1,mode: 'dispatch' } });
      expect(prepared.statusCode).toBe(201); const runId = prepared.json().preparation.runId;
      expect(prepared.json().preparation).toMatchObject({ status: 'ready',confirmed: false,revision: 2,executionAvailable: false });
      expect((await app.inject({ method: 'POST',url: `${base}/prepare`,headers,payload: { expectedRevision: 1,mode: 'dispatch' } })).statusCode).toBe(409);
      const confirmed = await app.inject({ method: 'POST',url: `${base}/confirm`,headers,payload: { expectedRevision: 2,mode: 'dispatch',runId } });
      expect(confirmed.statusCode).toBe(200); expect(confirmed.json().preparation).toMatchObject({ confirmed: true,revision: 3,executionAvailable: false });
      const saved = await app.inject({ url: base,headers }); expect(saved.json()).toEqual(confirmed.json()); expect(saved.headers['cache-control']).toBe('no-store');
      expect((await app.inject({ method: 'POST',url: `${base}/confirm`,headers,payload: { expectedRevision: 3,mode: 'dispatch',runId } })).statusCode).toBe(409);
      const cancelled = await app.inject({ method: 'POST',url: `${base}/cancel`,headers,payload: { expectedRevision: 3,mode: 'dispatch',runId } });
      expect(cancelled.statusCode).toBe(200); expect(cancelled.json().preparation).toMatchObject({ status: 'cancelled',confirmed: true,revision: 4,executionAvailable: false });
      expect(cancelled.body).not.toMatch(/phone|credential|Private content|synthetic|actor_user_id/);
      expect(f.getAgent).not.toHaveBeenCalled(); expect(f.getAgentCapabilities).not.toHaveBeenCalled(); expect(f.send).not.toHaveBeenCalled();
      expect((await database.query('SELECT id FROM campaign_dispatch_attempts')).rows).toEqual([]); expect((await database.query('SELECT id FROM campaign_simulation_outbox')).rows).toEqual([]);
    } finally { await app.close(); }
  });
  it('requires session, CSRF, explicit mode, strict bodies, current send permission and workspace isolation on preparation HTTP',async () => {
    const f = await dispatchFixture('dispatch',false);
    const redis = { defineCommand: () => undefined,rateLimit: (_key: string,window: number,_max: number,_cont: boolean,_exp: boolean,callback: (error: null,value: number[]) => void) => callback(null,[1,window]) } as unknown as Redis;
    const authStore = { findSession: async () => ({ id: alice.user_id,name: 'Alice',email: 'alice@example.test' }) } as unknown as AuthStore;
    const app = createApp({ db: pool,redis,authStore,providerRegistry: f.registry },{ appUrl: 'http://localhost:3000',secureCookies: false });
    const base = `/workspaces/${alice.workspace_id}/campaigns/${f.campaign.id}/dispatch-preparation`;
    const headers = { origin: 'http://localhost:3000','x-rcs-request': '1',cookie: `rcs_session=${'a'.repeat(43)}` };
    try {
      expect((await app.inject({ url: base })).statusCode).toBe(401);
      expect((await app.inject({ url: base.replace(f.campaign.id,randomUUID()),headers })).statusCode).toBe(404);
      expect((await app.inject({ url: base.replace(alice.workspace_id,bob.workspace_id),headers })).statusCode).toBe(404);
      for (const operation of ['prepare','confirm','cancel']) {
        const payload = { expectedRevision: 2,mode: 'dispatch',...(operation === 'prepare' ? {} : { runId: f.snapshot.runId }) };
        expect((await app.inject({ method: 'POST',url: `${base}/${operation}`,headers: { origin: headers.origin,'x-rcs-request': '1' },payload })).statusCode).toBe(401);
        expect((await app.inject({ method: 'POST',url: `${base}/${operation}`,headers: { cookie: headers.cookie },payload })).statusCode).toBe(403);
        for (const invalid of [{ ...payload,mode: 'simulation' },{ ...payload,mode: undefined },{ ...payload,expectedRevision: '2' },{ ...payload,expectedRevision: 0 },{ ...payload,extra: true },{ ...payload,runId: 'bad-id' }]) expect((await app.inject({ method: 'POST',url: `${base}/${operation}`,headers,payload: invalid })).statusCode).toBe(400);
        if (operation !== 'prepare') expect((await app.inject({ method: 'POST',url: `${base}/${operation}`,headers,payload: { expectedRevision: 2,mode: 'dispatch' } })).statusCode).toBe(400);
        expect((await app.inject({ method: 'POST',url: `${base}/${operation}`,headers: { ...headers,'content-type': 'application/json' },payload: JSON.stringify({ text: 'x'.repeat(1025) }) })).statusCode).toBe(413);
        expect((await app.inject({ method: 'POST',url: `${base.replace(alice.workspace_id,bob.workspace_id)}/${operation}`,headers,payload })).statusCode).toBe(404);
      }
      await database.query("UPDATE workspace_members SET role='viewer' WHERE workspace_id=$1",[alice.workspace_id]);
      expect((await app.inject({ url: base,headers })).statusCode).toBe(200);
      for (const operation of ['prepare','confirm','cancel']) expect((await app.inject({ method: 'POST',url: `${base}/${operation}`,headers,payload: { expectedRevision: 2,mode: 'dispatch',runId: f.snapshot.runId } })).statusCode).toBe(403);
      expect(f.send).not.toHaveBeenCalled(); expect(f.getAgent).not.toHaveBeenCalled();
    } finally { await app.close(); }
  });
  it('returns an in-flight ledger entry on concurrent redelivery instead of invoking send twice',async () => {
    const f = await dispatchFixture(); let entered!: () => void; const started = new Promise<void>((resolve) => { entered = resolve; }); let finish!: (value: { accepted: true; providerMessageId: string }) => void;
    f.send.mockImplementation(() => { entered(); return new Promise((resolve) => { finish = resolve; }); });
    const first = f.dispatch(); await Promise.race([started,first.then(() => { throw new Error('Dispatch ended before send'); })]); const second = await f.dispatch(); expect(second.status).toBe('sending'); expect(f.send).toHaveBeenCalledOnce();
    finish({ accepted: true,providerMessageId: 'concurrent-result' }); expect((await first).status).toBe('accepted');
  });
  it.each(['simulation','paused','expired','opted-out'] as const)('rejects %s preflight before reserving or calling the provider',async (reason) => {
    const f = await dispatchFixture(reason === 'simulation' ? 'simulation' : 'dispatch');
    if (reason === 'paused') await database.query("UPDATE campaigns SET status='paused' WHERE id=$1",[f.campaign.id]);
    if (reason === 'expired') clock+=300000;
    if (reason === 'opted-out') await database.query('INSERT INTO opt_outs (workspace_id,phone_normalized) VALUES ($1,$2)',[alice.workspace_id,'+5511987654321']);
    await expect(f.dispatch()).rejects.toMatchObject({ reason: 'conflict' }); expect(f.send).not.toHaveBeenCalled(); expect(f.getAgent).not.toHaveBeenCalled(); expect((await database.query('SELECT id FROM campaign_dispatch_attempts')).rows).toEqual([]);
  });
  it('rechecks opt-out after agent lookup and blocks the actual send',async () => {
    const f = await dispatchFixture(); f.getAgentCapabilities.mockImplementation(async () => { await database.query('INSERT INTO opt_outs (workspace_id,phone_normalized) VALUES ($1,$2)',[alice.workspace_id,'+5511987654321']); return new MockRcsProvider().getProviderCapabilities(); });
    expect(await f.dispatch()).toMatchObject({ status: 'rejected',errorCode: 'rejected' }); expect(f.send).not.toHaveBeenCalled(); expect((await f.dispatch()).status).toBe('rejected');
  });
  it.each(['rotated','revoked','expired','cancelled'] as const)('blocks send when %s after the reservation and agent lookup',async (change) => {
    const f = await dispatchFixture(); f.getAgentCapabilities.mockImplementation(async () => {
      if (change === 'rotated') await database.query("UPDATE provider_credentials SET ciphertext='changed-after-reservation' WHERE workspace_id=$1",[alice.workspace_id]);
      if (change === 'revoked') await database.query("UPDATE workspace_members SET role='viewer' WHERE workspace_id=$1",[alice.workspace_id]);
      if (change === 'expired') clock+=300000;
      if (change === 'cancelled') await database.query("UPDATE campaigns SET status='cancelled',revision=revision+1 WHERE id=$1",[f.campaign.id]);
      return new MockRcsProvider().getProviderCapabilities();
    });
    const result = await f.dispatch(); expect(result.status).toBe(change === 'revoked' ? 'unknown' : 'rejected'); expect(f.send).not.toHaveBeenCalled();
  });
  it('does not dispatch for foreign tenants, revoked roles or cancelled caller signals',async () => {
    const f = await dispatchFixture(); await expect(f.engine.dispatch(bob,f.campaign.id,f.contact,1,new AbortController().signal)).rejects.toMatchObject({ reason: 'not_found' });
    await database.query("UPDATE workspace_members SET role='viewer' WHERE workspace_id=$1",[alice.workspace_id]); await expect(f.dispatch()).rejects.toMatchObject({ reason: 'forbidden' });
    await database.query("UPDATE workspace_members SET role='owner' WHERE workspace_id=$1",[alice.workspace_id]); await expect(f.dispatch(AbortSignal.abort())).rejects.toMatchObject({ reason: 'conflict' }); expect(f.send).not.toHaveBeenCalled();
  });
  it('never sends when reservation auditing fails and keeps sending if result auditing fails',async () => {
    const f = await dispatchFixture();
    await database.exec("CREATE FUNCTION reject_dispatch_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.event LIKE 'campaign.dispatch_%' THEN RAISE EXCEPTION 'audit unavailable'; END IF; RETURN NEW; END $$; CREATE TRIGGER reject_dispatch_audit BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION reject_dispatch_audit();");
    try { await expect(f.dispatch()).rejects.toThrow('audit unavailable'); expect(f.send).not.toHaveBeenCalled(); expect((await database.query('SELECT id FROM campaign_dispatch_attempts')).rows).toEqual([]); }
    finally { await database.exec('DROP TRIGGER reject_dispatch_audit ON audit_logs; DROP FUNCTION reject_dispatch_audit()'); }
    await database.exec("CREATE FUNCTION reject_dispatch_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.event='campaign.dispatch_result' THEN RAISE EXCEPTION 'audit unavailable'; END IF; RETURN NEW; END $$; CREATE TRIGGER reject_dispatch_audit BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION reject_dispatch_audit();");
    try { await expect(f.dispatch()).rejects.toThrow('audit unavailable'); expect((await f.dispatch()).status).toBe('sending'); expect(f.send).toHaveBeenCalledOnce(); }
    finally { await database.exec('DROP TRIGGER reject_dispatch_audit ON audit_logs; DROP FUNCTION reject_dispatch_audit()'); }
  });
  it.each(['unavailable','rate_limited'] as const)('persists %s results without automatic retries even if the adapter marks them retryable',async (code) => {
    const f = await dispatchFixture(); f.send.mockResolvedValue({ accepted: false,error: { code,message: 'private-provider-error',retryable: true } });
    const result = await f.dispatch(); expect(result).toMatchObject({ status: code === 'unavailable' ? 'unknown' : 'rejected',errorCode: code }); expect((await f.dispatch()).id).toBe(result.id); expect(f.send).toHaveBeenCalledOnce(); expect(JSON.stringify(result)).not.toContain('private-provider-error');
  });
  it('bounds an uncooperative send and does not replace unknown with a late success',async () => {
    const f = await dispatchFixture(); const deadline = new AbortController(); const timeout = vi.spyOn(AbortSignal,'timeout').mockReturnValue(deadline.signal);
    let entered!: () => void; const started = new Promise<void>((resolve) => { entered = resolve; }); let finish!: (value: { accepted: true; providerMessageId: string }) => void;
    f.send.mockImplementation(() => { entered(); return new Promise((resolve) => { finish = resolve; }); });
    try { const pending = f.dispatch(); await Promise.race([started,pending.then(() => { throw new Error('Dispatch ended before send'); })]); deadline.abort(); const result = await pending; expect(result.status).toBe('unknown'); finish({ accepted: true,providerMessageId: 'late-result' }); expect((await f.dispatch()).status).toBe('unknown'); expect(f.send).toHaveBeenCalledOnce(); } finally { timeout.mockRestore(); }
  });
  it('records the provider outcome even if the initiating role is revoked after invocation',async () => {
    const f = await dispatchFixture(); f.send.mockImplementation(async () => { await database.query("UPDATE workspace_members SET role='viewer' WHERE workspace_id=$1",[alice.workspace_id]); return { accepted: true,providerMessageId: 'accepted-before-revocation' }; });
    expect((await f.dispatch()).status).toBe('accepted'); await expect(f.dispatch()).rejects.toMatchObject({ reason: 'forbidden' }); expect(f.send).toHaveBeenCalledOnce();
  });
  it('aggregates saved eligibility into exclusive categories without calling providers or changing state',async () => {
    await addRecipients(4); const version = await seedCredentialVersion();
    await seedCheck('+5511987654321','eligible',version);
    await seedCheck('+5511900000001','ineligible',version); await seedCheck('+5511900000002','unknown',version); await seedCheck('+5511900000003','eligible',version,clock);
    const campaign = await store.create(alice,input); const before = (await database.query('SELECT id FROM audit_logs')).rows.length;
    const review = await cachedReviewStore().review(alice,campaign.id);
    expect(review.eligibility.counts).toEqual({ total: 6,blocked: 1,eligible: 1,ineligible: 1,unknown: 1,stale: 1,unchecked: 1 });
    expect(review.issues).toEqual(expect.arrayContaining(['eligibility_unchecked','eligibility_stale','eligibility_unknown','eligibility_ineligible','runtime_not_available'])); expect(review.issues).not.toContain('audience_no_cached_eligible');
    expect(review.executionAvailable).toBe(false); expect(review.campaign.revision).toBe(1); expect((await database.query('SELECT id FROM audit_logs')).rows).toHaveLength(before);
    expect(JSON.stringify(review)).not.toMatch(/phone_normalized|private-opaque|credential_version|\+5511/);
  });
  it('invalidates legacy, changed-phone, expired and rotated-credential cache entries',async () => {
    const version = await seedCredentialVersion(); await seedCheck('+5511987654321','eligible',version); const campaign = await store.create(alice,input); const reviewer = cachedReviewStore();
    expect((await reviewer.review(alice,campaign.id)).eligibility.counts.eligible).toBe(1);
    await database.query('UPDATE eligibility_checks SET phone_normalized=NULL'); expect((await reviewer.review(alice,campaign.id)).eligibility.counts.stale).toBe(1);
    await database.query("UPDATE eligibility_checks SET phone_normalized='+5511987654321'"); await database.query("UPDATE contacts SET phone_normalized='+5511999999999' WHERE phone_normalized='+5511987654321'"); expect((await reviewer.review(alice,campaign.id)).eligibility.counts.stale).toBe(1);
    await database.query("UPDATE contacts SET phone_normalized='+5511987654321' WHERE phone_normalized='+5511999999999'");
    clock+=300000; expect((await reviewer.review(alice,campaign.id)).eligibility.counts.stale).toBe(1); clock-=300000;
    await database.query("UPDATE provider_credentials SET ciphertext='rotated-private-ciphertext'"); expect((await reviewer.review(alice,campaign.id)).eligibility.counts.stale).toBe(1);
    await database.query('INSERT INTO opt_outs (workspace_id,phone_normalized) VALUES ($1,$2)',[alice.workspace_id,'+5511987654321']); expect((await reviewer.review(alice,campaign.id)).eligibility.counts).toMatchObject({ blocked: 2,stale: 0,eligible: 0 });
  });
  it('does not accept cached positives for unknown capability, disconnected or unbound connections',async () => {
    const version = await seedCredentialVersion(); await seedCheck('+5511987654321','eligible',version); const campaign = await store.create(alice,input);
    expect((await cachedReviewStore('unknown').review(alice,campaign.id)).eligibility.counts).toMatchObject({ unknown: 1,eligible: 0 });
    await database.query("UPDATE provider_connections SET status='disconnected',external_agent_id=NULL WHERE id=$1",[input.providerConnectionId]);
    const review = await cachedReviewStore().review(alice,campaign.id); expect(review.eligibility.counts).toMatchObject({ stale: 1,eligible: 0 }); expect(review.issues).toEqual(expect.arrayContaining(['agent_binding_missing','connection_not_verified']));
  });
  it('counts only checks from the selected workspace and connection and remains safe for readers',async () => {
    const version = await seedCredentialVersion(); await seedCheck('+5511987654321','eligible',version); const campaign = await store.create(alice,input);
    const other = randomUUID(); await database.query("INSERT INTO provider_connections (id,workspace_id,provider_id,name,environment) VALUES ($1,$2,'fixture','Other','test')",[other,alice.workspace_id]);
    const otherCampaign = await store.create(alice,{ ...input,providerConnectionId: other }); expect((await cachedReviewStore().review(alice,otherCampaign.id)).eligibility.counts).toMatchObject({ unchecked: 1,eligible: 0 });
    await expect(cachedReviewStore().review(bob,campaign.id)).rejects.toMatchObject({ reason: 'not_found' }); await database.query("UPDATE workspace_members SET role='viewer' WHERE workspace_id=$1",[alice.workspace_id]);
    expect((await cachedReviewStore().review(alice,campaign.id)).eligibility.counts.eligible).toBe(1);
  });
  it('reports private media as unpublished even when adapter media capability is declared supported',async () => {
    const asset = randomUUID(); await database.query("INSERT INTO media_assets (id,workspace_id,name,mime_type,byte_size,width,height,sha256,created_by_user_id) VALUES ($1,$2,'Image','image/png',1,1,1,$3,$4)",[asset,alice.workspace_id,'a'.repeat(64),alice.user_id]);
    const message = await messages.create(alice,{ name: 'Card',purpose: 'marketing',content: { type: 'rich_card',card: { title: 'Greeting',body: 'Image',media: { assetId: asset,mimeType: 'image/png' } } } }); await messages.changeStatus(alice,message.message.id,1,'active');
    const campaign = await store.create(alice,{ ...input,messageVersionId: message.current.id }); const review = await cachedReviewStore().review(alice,campaign.id);
    expect(review.issues).not.toContain('private_media_not_published'); expect(review.issues).not.toContain('message_unsupported_media'); expect(review.executionAvailable).toBe(false);
  });
  it('persists async intent and chains SQL-only batches without repeated results',async () => {
    await addRecipients(51); const campaign = await store.create(alice,input); await engine.prepare(alice,campaign.id,1);
    const enqueued = await engine.enqueue(alice,campaign.id,2); expect(enqueued.campaign.revision).toBe(3); expect(enqueued.automation?.status).toBe('pending');
    await expect(engine.enqueue(alice,campaign.id,3)).rejects.toMatchObject({ reason: 'conflict' });
    const first = (await outbox.due())[0]!; expect(await outbox.execute({ ...first,workspace_id: bob.workspace_id })).toBe('ignored');
    expect(await outbox.execute(first)).toBe('completed'); expect(await outbox.execute(first)).toBe('ignored');
    let snapshot = (await engine.get(alice,campaign.id))!; expect(snapshot.counts).toMatchObject({ simulated: 50,pending: 2 }); expect(snapshot.automation?.status).toBe('pending');
    const second = (await outbox.due())[0]!; expect(second.id).not.toBe(first.id);
    expect(await new SimulationOutbox(pool,() => clock).execute(second)).toBe('completed'); snapshot = (await engine.get(alice,campaign.id))!;
    expect(snapshot.campaign).toMatchObject({ status: 'completed',revision: 5 }); expect(snapshot.counts).toMatchObject({ simulated: 52,pending: 0 }); expect(snapshot.automation?.status).toBe('completed'); expect(await outbox.due()).toEqual([]);
  });
  it('holds scheduled outbox commands until due and rechecks the frozen phone opt-out',async () => {
    const campaign = await store.create(alice,{ ...input,scheduledAt: new Date(clock+60000).toISOString() }); await engine.prepare(alice,campaign.id,1); await engine.enqueue(alice,campaign.id,2);
    const row = (await database.query<{ id: string; workspace_id: string; attempts: number }>('SELECT id,workspace_id,attempts FROM campaign_simulation_outbox')).rows[0]!;
    expect(await outbox.due()).toEqual([]); expect(await outbox.execute(row)).toBe('ignored');
    await database.query('INSERT INTO opt_outs (workspace_id,phone_normalized) VALUES ($1,$2)',[alice.workspace_id,'+5511987654321']); clock+=60000;
    expect(await outbox.execute((await outbox.due())[0]!)).toBe('completed'); expect((await engine.get(alice,campaign.id))?.counts).toMatchObject({ simulated: 0,suppressed: 2,pending: 0 });
  });
  it('invalidates queued work on pause and requires an explicit new request after resume',async () => {
    const campaign = await store.create(alice,input); await engine.prepare(alice,campaign.id,1); await engine.enqueue(alice,campaign.id,2); const old = (await outbox.due())[0]!;
    const paused = await engine.control(alice,campaign.id,3,'pause'); expect(paused.automation?.status).toBe('discarded'); expect(await outbox.execute(old)).toBe('ignored');
    await engine.control(alice,campaign.id,4,'resume'); expect(await outbox.due()).toEqual([]); await engine.enqueue(alice,campaign.id,5);
    expect(await outbox.execute(old)).toBe('ignored'); expect(await outbox.execute((await outbox.due())[0]!)).toBe('completed');
  });
  it('manual steps and stop discard automatic successors without undoing finished results',async () => {
    await addRecipients(51); const campaign = await store.create(alice,input); await engine.prepare(alice,campaign.id,1); await engine.enqueue(alice,campaign.id,2); const old = (await outbox.due())[0]!;
    await engine.step(alice,campaign.id,3); expect(await outbox.execute(old)).toBe('ignored'); expect(await outbox.due()).toEqual([]);
    await engine.enqueue(alice,campaign.id,4); const next = (await outbox.due())[0]!; await engine.control(alice,campaign.id,5,'stop');
    expect(await outbox.execute(next)).toBe('ignored'); expect((await engine.get(alice,campaign.id))?.counts).toMatchObject({ simulated: 50,cancelled: 2,pending: 0 });
  });
  it('revalidates the initiating account, role and workspace before worker execution',async () => {
    for (const mutation of ["UPDATE workspace_members SET role='viewer' WHERE workspace_id=$1","UPDATE users SET disabled_at=now() WHERE id=$1","UPDATE workspaces SET status='suspended' WHERE id=$1"]) {
      const campaign = await store.create(alice,input); await engine.prepare(alice,campaign.id,1); await engine.enqueue(alice,campaign.id,2); const job = (await outbox.due())[0]!;
      await database.query(mutation,[mutation.startsWith('UPDATE users') ? alice.user_id : alice.workspace_id]);
      expect(await outbox.execute(job)).toBe('discarded'); expect((await database.query<{ count: number }>("SELECT count(*)::int AS count FROM campaign_recipients WHERE workspace_id=$1 AND status='simulated'",[alice.workspace_id])).rows[0]!.count).toBe(0);
      await database.query("UPDATE workspace_members SET role='owner' WHERE workspace_id=$1",[alice.workspace_id]); await database.query('UPDATE users SET disabled_at=NULL WHERE id=$1',[alice.user_id]); await database.query("UPDATE workspaces SET status='active' WHERE id=$1",[alice.workspace_id]);
    }
  });
  it('rolls back failed async batches, backs off durably and allows safe recovery from dead jobs',async () => {
    const campaign = await store.create(alice,input); await engine.prepare(alice,campaign.id,1);
    await database.exec("CREATE FUNCTION reject_async_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'audit unavailable'; END $$; CREATE TRIGGER reject_async_audit BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION reject_async_audit();");
    try { await expect(engine.enqueue(alice,campaign.id,2)).rejects.toThrow('audit unavailable'); expect((await database.query('SELECT id FROM campaign_simulation_outbox')).rows).toEqual([]); } finally { await database.exec('DROP TRIGGER reject_async_audit ON audit_logs'); }
    await engine.enqueue(alice,campaign.id,2); const initial = (await outbox.due())[0]!;
    await database.exec('CREATE TRIGGER reject_async_audit BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION reject_async_audit();');
    try {
      for (let attempt=0;attempt<5;attempt++) {
        const job = (await outbox.due())[0]!; expect(job.attempts).toBe(attempt); expect(await outbox.execute(job)).toBe(attempt === 4 ? 'dead' : 'retry');
        expect(await outbox.due()).toEqual([]); expect(await outbox.execute(initial)).toBe('ignored'); clock+=80001;
      }
      const snapshot = (await engine.get(alice,campaign.id))!; expect(snapshot.counts).toMatchObject({ simulated: 0,pending: 1 }); expect(snapshot.campaign.revision).toBe(3); expect(snapshot.automation).toMatchObject({ status: 'dead',attempts: 5 });
    } finally { await database.exec('DROP TRIGGER reject_async_audit ON audit_logs; DROP FUNCTION reject_async_audit()'); }
    await engine.enqueue(alice,campaign.id,3); expect(await outbox.execute((await outbox.due())[0]!)).toBe('completed'); expect((await engine.get(alice,campaign.id))?.counts.simulated).toBe(1);
  });
  it('discards obsolete campaign generations even if a queue delivery was already published',async () => {
    const campaign = await store.create(alice,input); await engine.prepare(alice,campaign.id,1); await engine.enqueue(alice,campaign.id,2); const job = (await outbox.due())[0]!;
    await database.query('UPDATE campaigns SET revision=revision+1 WHERE id=$1',[campaign.id]); expect(await outbox.execute(job)).toBe('discarded'); expect((await engine.get(alice,campaign.id))?.counts.simulated).toBe(0);
  });
  it('freezes audience and message snapshots in explicit local simulation',async () => {
    const campaign = await store.create(alice,{ ...input,providerConnectionId: null,agentId: null });
    const prepared = await engine.prepare(alice,campaign.id,1); expect(prepared.realSending).toBe(false); expect(prepared.campaign).toMatchObject({ status: 'ready',execution_mode: 'simulation',revision: 2 });
    expect(prepared.counts).toEqual({ total: 2,pending: 1,simulated: 0,suppressed: 1,cancelled: 0 });
    await expect(database.query('DELETE FROM campaign_recipients WHERE run_id=$1',[prepared.run.id])).rejects.toThrow('cannot be deleted');
    const recipient = (await database.query<{ contact_id: string; phone_normalized: string }>('SELECT contact_id,phone_normalized FROM campaign_recipients WHERE run_id=$1 LIMIT 1',[prepared.run.id])).rows[0]!;
    await expect(database.query("INSERT INTO campaign_recipients (workspace_id,run_id,contact_id,phone_normalized,status) VALUES ($1,$2,$3,$4,'pending')",[alice.workspace_id,prepared.run.id,recipient.contact_id,recipient.phone_normalized])).rejects.toThrow('frozen');
    await addRecipients(1);
    const version = (await database.query<{ message_id: string }>('SELECT message_id FROM message_versions WHERE id=$1',[input.messageVersionId])).rows[0]!;
    await messages.revise(alice,version.message_id,1,{ name: 'Changed',purpose: 'marketing',content: { type: 'text',text: 'Changed body' } }); await messages.changeStatus(alice,version.message_id,2,'active');
    const result = await engine.step(alice,campaign.id,2); expect(result.counts.total).toBe(2); expect(result.counts.simulated).toBe(1); expect(result.run.message_version_id).toBe(input.messageVersionId); expect(result.campaign.status).toBe('completed');
    await expect(database.query("UPDATE campaign_runs SET mode='simulation' WHERE id=$1",[result.run.id])).rejects.toThrow('immutable');
    await expect(database.query("UPDATE campaign_recipients SET status='pending',simulation_result_id=NULL WHERE run_id=$1 AND status='simulated'",[result.run.id])).rejects.toThrow('final');
  });
  it('processes bounded batches once and rejects replayed prepare/step revisions',async () => {
    await addRecipients(51); const campaign = await store.create(alice,input);
    const attempts = await Promise.allSettled([engine.prepare(alice,campaign.id,1),engine.prepare(alice,campaign.id,1)]); expect(attempts.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    const first = await engine.step(alice,campaign.id,2); expect(first.counts).toMatchObject({ total: 53,simulated: 50,pending: 2 }); expect(first.campaign.status).toBe('running');
    await expect(engine.step(alice,campaign.id,2)).rejects.toMatchObject({ reason: 'conflict' });
    const last = await engine.step(alice,campaign.id,3); expect(last.counts).toMatchObject({ pending: 0,simulated: 52,suppressed: 1 }); expect(last.campaign.status).toBe('completed');
    await expect(engine.step(alice,campaign.id,4)).rejects.toMatchObject({ reason: 'conflict' });
    expect((await database.query<{ count: number }>('SELECT count(DISTINCT simulation_result_id)::int AS count FROM campaign_recipients WHERE run_id=$1',[last.run.id])).rows[0]!.count).toBe(52);
  });
  it('rechecks opt-out after preparation and suppresses newly blocked recipients',async () => {
    const campaign = await store.create(alice,input); await engine.prepare(alice,campaign.id,1);
    await database.query("UPDATE contacts SET phone_normalized='+5511999999999' WHERE workspace_id=$1 AND phone_normalized='+5511987654321'",[alice.workspace_id]);
    await database.query('INSERT INTO opt_outs (workspace_id,phone_normalized) VALUES ($1,$2)',[alice.workspace_id,'+5511987654321']);
    const result = await engine.step(alice,campaign.id,2); expect(result.counts).toEqual({ total: 2,pending: 0,simulated: 0,suppressed: 2,cancelled: 0 });
  });
  it('honors the due date and persists pause/resume across engine instances',async () => {
    const scheduledAt = new Date(clock+3600000).toISOString(); const campaign = await store.create(alice,{ ...input,scheduledAt }); const run = await engine.prepare(alice,campaign.id,1);
    expect(run.campaign.status).toBe('scheduled'); await expect(engine.step(alice,campaign.id,2)).rejects.toMatchObject({ reason: 'conflict' });
    await engine.control(alice,campaign.id,2,'pause'); await expect(engine.step(alice,campaign.id,3)).rejects.toMatchObject({ reason: 'conflict' });
    expect((await engine.control(alice,campaign.id,3,'resume')).campaign.status).toBe('scheduled');
    clock += 3600001; const restarted = new CampaignSimulation(pool,() => clock); expect((await restarted.step(alice,campaign.id,4)).campaign.status).toBe('completed');
  });
  it('stops remaining work while preserving already simulated and suppressed results',async () => {
    await addRecipients(51); const campaign = await store.create(alice,input); await engine.prepare(alice,campaign.id,1); await engine.step(alice,campaign.id,2);
    await engine.control(alice,campaign.id,3,'pause'); expect((await engine.control(alice,campaign.id,4,'resume')).campaign.status).toBe('ready');
    const result = await engine.control(alice,campaign.id,5,'stop'); expect(result.campaign.status).toBe('cancelled'); expect(result.counts).toMatchObject({ simulated: 50,suppressed: 1,cancelled: 2,pending: 0 });
    await expect(engine.control(alice,campaign.id,6,'resume')).rejects.toMatchObject({ reason: 'conflict' });
  });
  it('rejects incomplete, stale-message, empty and excessive audiences',async () => {
    const partial = await store.create(alice,basic); await expect(engine.prepare(alice,partial.id,1)).rejects.toMatchObject({ reason: 'conflict' });
    const campaign = await store.create(alice,input); const version = (await database.query<{ message_id: string }>('SELECT message_id FROM message_versions WHERE id=$1',[input.messageVersionId])).rows[0]!;
    await messages.changeStatus(alice,version.message_id,1,'draft'); await expect(engine.prepare(alice,campaign.id,1)).rejects.toMatchObject({ reason: 'conflict' }); await messages.changeStatus(alice,version.message_id,1,'active');
    await database.query('INSERT INTO opt_outs (workspace_id,phone_normalized) VALUES ($1,$2)',[alice.workspace_id,'+5511987654321']); await expect(engine.prepare(alice,campaign.id,1)).rejects.toMatchObject({ reason: 'conflict' });
    await addRecipients(5001); await expect(engine.prepare(alice,campaign.id,1)).rejects.toMatchObject({ reason: 'conflict' }); expect(await engine.get(alice,campaign.id)).toBeNull();
  });
  it('isolates simulation snapshots and rechecks permissions for every operation',async () => {
    const campaign = await store.create(alice,input); await engine.prepare(alice,campaign.id,1);
    await expect(engine.get(bob,campaign.id)).rejects.toMatchObject({ reason: 'not_found' });
    await database.query("UPDATE workspace_members SET role='viewer' WHERE workspace_id=$1",[alice.workspace_id]);
    expect((await engine.get(alice,campaign.id))?.run.mode).toBe('simulation'); await expect(engine.step(alice,campaign.id,2)).rejects.toMatchObject({ reason: 'forbidden' });
    await database.query("UPDATE users SET status='disabled' WHERE id=$1",[alice.user_id]); await expect(engine.get(alice,campaign.id)).rejects.toMatchObject({ reason: 'not_found' });
  });
  it('rolls back simulation snapshots, results and controls when audit persistence fails',async () => {
    const campaign = await store.create(alice,input);
    await database.exec("CREATE FUNCTION reject_sim_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'audit unavailable'; END $$; CREATE TRIGGER reject_sim_audit BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION reject_sim_audit()");
    try { await expect(engine.prepare(alice,campaign.id,1)).rejects.toThrow(); expect(await engine.get(alice,campaign.id)).toBeNull(); } finally { await database.exec('DROP TRIGGER reject_sim_audit ON audit_logs'); }
    await engine.prepare(alice,campaign.id,1);
    await database.exec('CREATE TRIGGER reject_sim_audit BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION reject_sim_audit()');
    try {
      await expect(engine.step(alice,campaign.id,2)).rejects.toThrow(); await expect(engine.control(alice,campaign.id,2,'pause')).rejects.toThrow(); expect((await engine.get(alice,campaign.id))?.counts.pending).toBe(1);
    } finally { await database.exec('DROP TRIGGER reject_sim_audit ON audit_logs; DROP FUNCTION reject_sim_audit()'); }
    const result = await engine.step(alice,campaign.id,2); expect(result.counts.simulated).toBe(1);
    expect(JSON.stringify((await database.query("SELECT metadata FROM audit_logs WHERE event LIKE 'campaign.simulation_%'")).rows)).not.toMatch(/5511|Private content|agent-a/);
  });
  it('lists only workspace options and the active snapshot without credentials',async () => {
    const connections = await store.options(alice,'connections',0); expect(connections.options[0]).toEqual({ id: input.providerConnectionId,name: 'Provider',status: 'connected',agentId: 'agent-a' });
    expect((await store.options(alice,'audiences',0)).options[0]).toMatchObject({ id: input.audienceListId,contactCount: 2 });
    const first = (await store.options(alice,'messages',0)).options[0]!; expect(first.id).toBe(input.messageVersionId); expect(first.version).toBe(1);
    await messages.revise(alice,first.messageId!,1,{ name: 'New active snapshot',purpose: 'marketing',content: { type: 'text',text: 'Updated body' } });
    await messages.changeStatus(alice,first.messageId!,2,'active');
    const next = await store.options(alice,'messages',0); expect(next.options).toHaveLength(1); expect(next.options[0]?.version).toBe(2); expect(next.options[0]?.id).not.toBe(first.id);
    expect(JSON.stringify(connections)).not.toMatch(/ciphertext|credentials|environment/);
    for (const kind of ['messages','connections','audiences'] as const) expect((await store.options(bob,kind,0)).total).toBe(0);
  });
  it('bounds selection pages and rechecks revoked management access',async () => {
    for (let index = 0; index < 51; index++) await database.query('INSERT INTO contact_lists (workspace_id,name) VALUES ($1,$2)',[alice.workspace_id,`List ${index}`]);
    expect((await store.options(alice,'audiences',0)).options).toHaveLength(50); expect((await store.options(alice,'audiences',50)).options).toHaveLength(2);
    await database.query("UPDATE workspace_members SET role='operator' WHERE workspace_id=$1",[alice.workspace_id]); expect((await store.options(alice,'connections',0)).total).toBe(1);
    await database.query("UPDATE workspace_members SET role='viewer' WHERE workspace_id=$1",[alice.workspace_id]); await expect(store.options(alice,'messages',0)).rejects.toMatchObject({ reason: 'forbidden' });
  });
  it('pins a message snapshot and reviews opt-outs without reporting readiness or changing state',async () => {
    const campaign = await store.create(alice,input); const review = await store.review(alice,campaign.id);
    expect(review.audience).toEqual({ total: 2,optedOut: 1,remaining: 1 });
    expect(review.issues).toEqual(['provider_credentials_missing','eligibility_unchecked','audience_no_cached_eligible','runtime_not_available']); expect(review.executionAvailable).toBe(false); expect(review.campaign.status).toBe('draft');
    const version = (await database.query<{ message_id: string }>('SELECT message_id FROM message_versions WHERE id=$1',[input.messageVersionId])).rows[0]!;
    await messages.revise(alice,version.message_id,1,{ name: 'New',purpose: 'marketing',content: { type: 'text',text: 'Revised content' } });
    await messages.changeStatus(alice,version.message_id,2,'active');
    expect((await store.get(alice,campaign.id))?.message_version_id).toBe(input.messageVersionId);
    expect((await store.review(alice,campaign.id)).issues).toContain('message_version_not_active');
    expect(JSON.stringify((await database.query("SELECT metadata FROM audit_logs WHERE entity_type='campaign'")).rows)).not.toMatch(/Invite|Private|Revised/);
  });
  it('accepts partial drafts and reports missing configuration and changed bindings',async () => {
    const partial = await store.create(alice,basic);
    expect((await store.review(alice,partial.id)).issues).toEqual(expect.arrayContaining(['provider_missing','agent_missing','message_missing','audience_missing','audience_empty','runtime_not_available']));
    const full = await store.create(alice,{ ...input,agentId: 'agent-b' }); expect((await store.review(alice,full.id)).issues).toContain('agent_binding_mismatch');
    await database.query("UPDATE provider_connections SET status='disabled' WHERE id=$1",[input.providerConnectionId]);
    expect((await store.review(alice,full.id)).issues).toContain('connection_not_verified');
    await database.query('INSERT INTO opt_outs (workspace_id,phone_normalized) VALUES ($1,$2)',[alice.workspace_id,'+5511987654321']);
    await database.query("UPDATE campaigns SET scheduled_at='2000-01-01T00:00:00.000Z' WHERE id=$1",[full.id]);
    const review = await store.review(alice,full.id); expect(review.issues).toContain('audience_fully_opted_out'); expect(review.issues).toContain('schedule_in_past'); expect(review.audience.remaining).toBe(0);
    const unsupported = new PgCampaignStore(pool,{ describe: () => ({ active: false,capabilities: { text: 'unknown' },limits: { maxTextCharacters: 1 } }) } as unknown as ProviderRegistry);
    expect((await unsupported.review(alice,full.id)).issues).toEqual(expect.arrayContaining(['provider_inactive','message_unsupported_capability','message_text_limit']));
  });
  it('rejects foreign references in both application and composite SQL keys',async () => {
    for (const field of ['providerConnectionId','audienceListId','messageVersionId'] as const) await expect(store.create(bob,{ ...basic,[field]: input[field] })).rejects.toMatchObject({ reason: 'invalid' });
    const campaign = await store.create(bob,basic);
    await expect(database.query('UPDATE campaigns SET message_version_id=$1 WHERE id=$2',[input.messageVersionId,campaign.id])).rejects.toThrow();
    expect(await store.get(bob,(await store.create(alice,input)).id)).toBeNull();
    await expect(store.review(alice,campaign.id)).rejects.toMatchObject({ reason: 'not_found' });
  });
  it('rejects stale revisions, freezes cancelled campaigns and protects referenced lists',async () => {
    const campaign = await store.create(alice,input); await store.revise(alice,campaign.id,1,{ ...input,name: 'Edited' });
    await expect(store.revise(alice,campaign.id,1,input)).rejects.toMatchObject({ reason: 'conflict' });
    await expect(store.cancel(alice,campaign.id,1)).rejects.toMatchObject({ reason: 'conflict' });
    expect((await store.cancel(alice,campaign.id,2)).revision).toBe(3);
    await expect(store.revise(alice,campaign.id,3,input)).rejects.toMatchObject({ reason: 'conflict' });
    await expect(database.query("UPDATE campaigns SET name='Changed' WHERE id=$1",[campaign.id])).rejects.toThrow('frozen');
    await expect(database.query('DELETE FROM contact_lists WHERE id=$1',[input.audienceListId])).rejects.toThrow();
  });
  it('rechecks revoked roles and account state inside persistence',async () => {
    const campaign = await store.create(alice,basic);
    await database.query("UPDATE workspace_members SET role='viewer' WHERE workspace_id=$1",[alice.workspace_id]);
    expect((await store.get(alice,campaign.id))?.id).toBe(campaign.id);
    await expect(store.cancel(alice,campaign.id,1)).rejects.toMatchObject({ reason: 'forbidden' });
    await database.query("UPDATE users SET status='disabled' WHERE id=$1",[alice.user_id]);
    await expect(store.review(alice,campaign.id)).rejects.toMatchObject({ reason: 'not_found' });
  });
  it('rolls back creation, edits and cancellation when audit persistence fails',async () => {
    const campaign = await store.create(alice,basic);
    await database.exec("CREATE FUNCTION reject_campaign_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'audit unavailable'; END $$; CREATE TRIGGER reject_campaign_audit BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION reject_campaign_audit()");
    try {
      await expect(store.create(alice,basic)).rejects.toThrow(); await expect(store.revise(alice,campaign.id,1,input)).rejects.toThrow(); await expect(store.cancel(alice,campaign.id,1)).rejects.toThrow();
      expect((await store.get(alice,campaign.id))?.revision).toBe(1); expect((await store.list(alice,0)).total).toBe(1);
    } finally { await database.exec('DROP TRIGGER reject_campaign_audit ON audit_logs; DROP FUNCTION reject_campaign_audit()'); }
  });
  it('paginates and filters workspace campaign states',async () => {
    for (let index = 0; index < 51; index++) await store.create(alice,basic);
    const first = await store.list(alice,0); expect(first.campaigns).toHaveLength(50); expect(first.total).toBe(51); expect((await store.list(alice,50)).campaigns).toHaveLength(1);
    await store.cancel(alice,first.campaigns[0]!.id,1); expect((await store.list(alice,0,'cancelled')).total).toBe(1); expect((await store.list(bob,0)).total).toBe(0);
  });
  it('requires explicit simulation mode, CSRF and send permission at the HTTP boundary',async () => {
    const redis = { defineCommand: () => undefined,rateLimit: (_key: string,window: number,_max: number,_cont: boolean,_exp: boolean,callback: (error: null,value: number[]) => void) => callback(null,[1,window]) } as unknown as Redis;
    const authStore = { findSession: async () => ({ id: alice.user_id,name: 'Alice',email: 'alice@example.test' }) } as unknown as AuthStore;
    const app = createApp({ db: pool,redis,authStore },{ appUrl: 'http://localhost:3000',secureCookies: false });
    const campaign = await store.create(alice,input); const base = `/workspaces/${alice.workspace_id}/campaigns/${campaign.id}/simulation`;
    const headers = { origin: 'http://localhost:3000','x-rcs-request': '1',cookie: `rcs_session=${'a'.repeat(43)}` };
    try {
      expect((await app.inject({ url: base })).statusCode).toBe(401);
      expect((await app.inject({ url: base,headers })).json()).toEqual({ simulation: null });
      expect((await app.inject({ method: 'POST',url: `${base}/prepare`,headers: { cookie: headers.cookie },payload: { mode: 'simulation',expectedRevision: 1 } })).statusCode).toBe(403);
      for (const payload of [{ expectedRevision: 1 },{ expectedRevision: 1,mode: 'real' }]) expect((await app.inject({ method: 'POST',url: `${base}/prepare`,headers,payload })).statusCode).toBe(400);
      const prepared = await app.inject({ method: 'POST',url: `${base}/prepare`,headers,payload: { mode: 'simulation',expectedRevision: 1 } }); expect(prepared.statusCode).toBe(201); expect(prepared.json().simulation.realSending).toBe(false);
      expect((await app.inject({ method: 'POST',url: `${base}/control`,headers,payload: { action: 'pause',expectedRevision: 2 } })).statusCode).toBe(200);
      expect((await app.inject({ method: 'POST',url: `${base}/step`,headers,payload: { expectedRevision: 3 } })).statusCode).toBe(409);
      expect((await app.inject({ method: 'POST',url: `${base}/control`,headers,payload: { action: 'resume',expectedRevision: 3 } })).statusCode).toBe(200);
      const completed = await app.inject({ method: 'POST',url: `${base}/step`,headers,payload: { expectedRevision: 4 } }); expect(completed.statusCode).toBe(200); expect(completed.json().simulation.counts.simulated).toBe(1);
      expect(completed.body).not.toMatch(/phone_normalized|Private content|\+5511912345678|\+5511987654321/);
      expect((await app.inject({ url: base.replace(alice.workspace_id,bob.workspace_id),headers })).statusCode).toBe(404);
      await database.query("UPDATE workspace_members SET role='viewer' WHERE workspace_id=$1",[alice.workspace_id]);
      expect((await app.inject({ url: base,headers })).statusCode).toBe(200); expect((await app.inject({ method: 'POST',url: `${base}/control`,headers,payload: { action: 'stop',expectedRevision: 5 } })).statusCode).toBe(403);
    } finally { await app.close(); }
  });
  it('accepts async simulation only with explicit mode, CSRF and current send permission',async () => {
    const redis = { defineCommand: () => undefined,rateLimit: (_key: string,window: number,_max: number,_cont: boolean,_exp: boolean,callback: (error: null,value: number[]) => void) => callback(null,[1,window]) } as unknown as Redis;
    const authStore = { findSession: async () => ({ id: alice.user_id,name: 'Alice',email: 'alice@example.test' }) } as unknown as AuthStore;
    const app = createApp({ db: pool,redis,authStore },{ appUrl: 'http://localhost:3000',secureCookies: false });
    const campaign = await store.create(alice,input); await engine.prepare(alice,campaign.id,1);
    const url = `/workspaces/${alice.workspace_id}/campaigns/${campaign.id}/simulation/enqueue`;
    const headers = { origin: 'http://localhost:3000','x-rcs-request': '1',cookie: `rcs_session=${'a'.repeat(43)}` };
    try {
      expect((await app.inject({ method: 'POST',url,headers: { origin: headers.origin,'x-rcs-request': '1' },payload: { expectedRevision: 2,mode: 'simulation' } })).statusCode).toBe(401);
      expect((await app.inject({ method: 'POST',url,headers: { cookie: headers.cookie },payload: { expectedRevision: 2,mode: 'simulation' } })).statusCode).toBe(403);
      for (const mode of [undefined,'real']) expect((await app.inject({ method: 'POST',url,headers,payload: { expectedRevision: 2,mode } })).statusCode).toBe(400);
      const response = await app.inject({ method: 'POST',url,headers,payload: { expectedRevision: 2,mode: 'simulation' } }); expect(response.statusCode).toBe(202); expect(response.json().simulation).toMatchObject({ realSending: false,automation: { status: 'pending',attempts: 0 } }); expect(response.body).not.toMatch(/actor_user_id|phone_normalized|Private content/);
      expect((await app.inject({ method: 'POST',url,headers,payload: { expectedRevision: 3,mode: 'simulation' } })).statusCode).toBe(409);
      expect((await app.inject({ method: 'POST',url: url.replace(alice.workspace_id,bob.workspace_id),headers,payload: { expectedRevision: 3,mode: 'simulation' } })).statusCode).toBe(404);
      await database.query("UPDATE workspace_members SET role='viewer' WHERE workspace_id=$1",[alice.workspace_id]);
      expect((await app.inject({ method: 'POST',url,headers,payload: { expectedRevision: 3,mode: 'simulation' } })).statusCode).toBe(403);
    } finally { await app.close(); }
  });
  it('enforces HTTP session, CSRF, strict draft input, conflicts and reader access',async () => {
    const redis = { defineCommand: () => undefined,rateLimit: (_key: string,window: number,_max: number,_cont: boolean,_exp: boolean,callback: (error: null,value: number[]) => void) => callback(null,[1,window]) } as unknown as Redis;
    const authStore = { findSession: async () => ({ id: alice.user_id,name: 'Alice',email: 'alice@example.test' }) } as unknown as AuthStore;
    const app = createApp({ db: pool,redis,authStore },{ appUrl: 'http://localhost:3000',secureCookies: false });
    const base = `/workspaces/${alice.workspace_id}/campaigns`; const headers = { origin: 'http://localhost:3000','x-rcs-request': '1',cookie: `rcs_session=${'a'.repeat(43)}` };
    try {
      expect((await app.inject({ url: base })).statusCode).toBe(401);
      expect((await app.inject({ url: `${base}/options?kind=messages`,headers })).statusCode).toBe(200);
      expect((await app.inject({ url: `${base}/options?kind=credentials`,headers })).statusCode).toBe(400);
      expect((await app.inject({ method: 'POST',url: base,headers: { cookie: headers.cookie },payload: basic })).statusCode).toBe(403);
      expect((await app.inject({ method: 'POST',url: base,headers,payload: { ...basic,status: 'running' } })).statusCode).toBe(400);
      const created = await app.inject({ method: 'POST',url: base,headers,payload: input }); expect(created.statusCode).toBe(201); const id = created.json().campaign.id;
      expect((await app.inject({ method: 'DELETE',url: `/workspaces/${alice.workspace_id}/contact-lists/${input.audienceListId}`,headers })).statusCode).toBe(409);
      const review = await app.inject({ url: `${base}/${id}/review`,headers }); expect(review.statusCode).toBe(200); expect(review.json().executionAvailable).toBe(false);
      expect((await app.inject({ method: 'PUT',url: `${base}/${id}`,headers,payload: { ...input,expectedRevision: 1 } })).statusCode).toBe(200);
      expect((await app.inject({ method: 'PUT',url: `${base}/${id}`,headers,payload: { ...input,expectedRevision: 1 } })).statusCode).toBe(409);
      expect((await app.inject({ method: 'POST',url: `${base}/${id}/cancel`,headers,payload: { expectedRevision: 2 } })).statusCode).toBe(200);
      expect((await app.inject({ url: `${base.replace(alice.workspace_id,bob.workspace_id)}/${id}`,headers })).statusCode).toBe(404);
      await database.query("UPDATE workspace_members SET role='viewer' WHERE workspace_id=$1",[alice.workspace_id]);
      expect((await app.inject({ url: base,headers })).statusCode).toBe(200);
      expect((await app.inject({ url: `${base}/options?kind=connections`,headers })).statusCode).toBe(403);
      expect((await app.inject({ method: 'POST',url: base,headers,payload: basic })).statusCode).toBe(403);
    } finally { await app.close(); }
  });
});
