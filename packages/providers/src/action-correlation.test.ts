import {describe,expect,it} from 'vitest';
import {actionData,actionFields,correlateActions} from './action-correlation.js';
describe('host action correlation',()=>{
  it('round-trips the host attempt while preserving the original immutable message',()=>{
    const key='dispatch-11111111-1111-4111-8111-111111111111';const message={type:'rich_card' as const,card:{title:'A',body:'B',suggestions:[{type:'reply' as const,text:'Yes',payload:'interested'}]}};
    const prepared=correlateActions(message,key);expect(prepared.type).toBe('rich_card');if(prepared.type!=='rich_card')throw new Error();const item=prepared.card.suggestions![0]!;if(item.type!=='reply')throw new Error();expect(actionFields(item.payload)).toEqual({dispatchKey:key,actionPayload:'interested'});expect(message.card.suggestions[0]!.payload).toBe('interested');
    expect(actionFields(actionData('invalid','value'))).not.toHaveProperty('dispatchKey');expect(actionFields('external-choice')).toEqual({actionPayload:'external-choice'});
  });
});
