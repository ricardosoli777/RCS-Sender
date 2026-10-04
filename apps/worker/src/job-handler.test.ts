import { describe,expect,it,vi } from 'vitest';
import { createJobHandler } from './job-handler.js';
const job = { id: 'a3a89226-3aef-4fc8-b5e6-12fae6ed1149',workspace_id: 'b3a89226-3aef-4fc8-b5e6-12fae6ed1149',attempts: 0 };
describe('worker job routing',() => {
  it('routes dispatch independently with shutdown signal and never marks it simulated',async () => {
    const simulation = { execute: vi.fn(async () => 'simulated') }; const dispatch = { execute: vi.fn(async () => 'unresolved') }; const controller = new AbortController();
    const handler = createJobHandler(simulation,dispatch,controller.signal);
    expect(await handler({ name: 'campaign.dispatch.recipient',data: job })).toEqual({ status: 'unresolved' });
    expect(dispatch.execute).toHaveBeenCalledWith(job,controller.signal); expect(simulation.execute).not.toHaveBeenCalled();
    expect(await handler({ name: 'campaign.simulation.batch',data: job })).toEqual({ status: 'simulated',realSending: false });
    expect(await handler({ name: 'health.ping',data: {} })).toEqual({ status: 'ok' });
  });
  it('rejects unknown jobs and dispatch payloads before invoking the runtime',async () => {
    const simulation = { execute: vi.fn(async () => 'ignored') }; const dispatch = { execute: vi.fn(async () => 'ignored') }; const handler = createJobHandler(simulation,dispatch,new AbortController().signal);
    await expect(handler({ name: 'campaign.dispatch.recipient',data: { ...job,phone: 'private' } })).rejects.toThrow('Invalid dispatch job');
    await expect(handler({ name: 'unknown',data: job })).rejects.toThrow('Tipo de tarefa'); expect(dispatch.execute).not.toHaveBeenCalled(); expect(simulation.execute).not.toHaveBeenCalled();
  });
  it('propagates failures for queue recovery without inventing success',async () => {
    const failure = new Error('unavailable'); const dispatch = { execute: vi.fn(async () => { throw failure; }) };
    const handler = createJobHandler({ execute: vi.fn(async () => 'ignored') },dispatch,new AbortController().signal);
    await expect(handler({ name: 'campaign.dispatch.recipient',data: job })).rejects.toBe(failure);
  });
});
