export const purposeLabels = { marketing: 'Marketing',transactional: 'Transacional',authentication: 'Autenticação' };
export const sourceLabels = { manual_record: 'Registro manual',web_form: 'Formulário web',import_record: 'Registro de importação',customer_request: 'Solicitação do contato' };
export const consentStateLabels = { unknown: 'Sem registro',granted: 'Consentimento declarado',revoked: 'Consentimento revogado' };
export type ConsentPurpose = keyof typeof purposeLabels;
export type ConsentSource = keyof typeof sourceLabels;
export type ConsentSummary = { purpose: ConsentPurpose; state: keyof typeof consentStateLabels; revision: number; source: ConsentSource | null; observedAt: string | null };
export type ConsentSnapshot = { contactId: string; phone: string; optedOut: boolean; consents: ConsentSummary[] };
export type ConsentFields = { purpose: ConsentPurpose; state: 'granted' | 'revoked'; source: ConsentSource; evidenceReference: string; observedUtc: string };
export function consentRecord(snapshot: ConsentSnapshot,fields: ConsentFields,now = Date.now()) {
  const current = snapshot.consents.find((item) => item.purpose === fields.purpose);
  if (!current || !Object.hasOwn(sourceLabels,fields.source) || !['granted','revoked'].includes(fields.state)) throw new Error('Recarregue os registros antes de continuar.');
  if (!/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/.test(fields.evidenceReference)) throw new Error('Use uma referência de evidência de até 128 caracteres, começando com letra ou número, sem espaços.');
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?$/.test(fields.observedUtc)) throw new Error('Informe quando a declaração ou revogação foi observada, em UTC.');
  const observedAt = `${fields.observedUtc.length === 16 ? `${fields.observedUtc}:00` : fields.observedUtc}.000Z`;
  const date = new Date(observedAt);
  if (!Number.isFinite(date.getTime()) || date.toISOString() !== observedAt || date.getTime()>now) throw new Error('Informe uma data válida em UTC que já tenha ocorrido.');
  if (current.observedAt && date.getTime()<Date.parse(current.observedAt)) throw new Error('A observação não pode ser anterior ao último registro desta finalidade.');
  return { purpose: fields.purpose,state: fields.state,source: fields.source,evidenceReference: fields.evidenceReference,observedAt,expectedRevision: current.revision,expectedPhone: snapshot.phone };
}
export function consentError(status: number) {
  return status === 409 ? 'O telefone ou a revisão mudou, ou a observação é anterior ao último registro. Recarregue antes de registrar novamente.' : status === 403 ? 'Seu perfil não permite registrar consentimento. Recarregue para conferir seu acesso.' : status === 400 ? 'Confira a referência e a data da observação. Recarregue para conferir o estado salvo.' : 'Não foi possível confirmar a gravação. Recarregue os registros antes de tentar novamente.';
}
