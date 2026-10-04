import type { FastifyInstance } from 'fastify';
import type { OperationsService,HistoryMaintenance } from '@rcs/dispatch';
export function registerOperationsRoutes(app: FastifyInstance,service: OperationsService,maintenance?:HistoryMaintenance) {
  if(maintenance){
    app.post('/workspaces/:workspaceId/operations/rotate-cipher',{config:{permission:'audit.view'},bodyLimit:256,schema:{body:{type:'object',additionalProperties:false,maxProperties:0}}},async(request)=>maintenance.rotate(request.workspaceContext!));
    app.post<{Body:{retainDays:number}}>('/workspaces/:workspaceId/operations/compact-history',{config:{permission:'audit.view'},bodyLimit:256,schema:{body:{type:'object',additionalProperties:false,required:['retainDays'],properties:{retainDays:{type:'integer',minimum:30,maximum:3650}}}}},async(request)=>maintenance.compact(request.workspaceContext!,request.body.retainDays));
  }
  app.get('/workspaces/:workspaceId/operations',{ config:{ permission:'audit.view' } },async(request)=>service.snapshot(request.workspaceContext!));
  app.post<{ Body:{ eventId:string;consumer:string } }>('/workspaces/:workspaceId/operations/requeue',{ config:{ permission:'audit.view' },bodyLimit:1024,schema:{ body:{ type:'object',additionalProperties:false,required:['eventId','consumer'],properties:{ eventId:{ type:'string',pattern:'^[a-fA-F0-9]{8}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{12}$' },consumer:{ type:'string',enum:['campaigns','journeys','scoring','conversations'] } } } } },async(request)=>service.requeue(request.workspaceContext!,request.body.eventId,request.body.consumer));
}
