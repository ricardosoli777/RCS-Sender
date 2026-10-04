import { Card } from '../ui';
export type ScoreSnapshot = { score: number; classification: string; history: { id: string; source: string; delta: number; previous_score: number; new_score: number; created_at: string }[] };
export default function ContactScore({ snapshot }: { snapshot: ScoreSnapshot | null }) {
  const names: Record<string,string> = { cold: 'Frio',warm: 'Morno',hot: 'Quente',sales_ready: 'Pronto para vendas' };
  return <Card><h2>Pontuação do lead</h2>{snapshot ? <><p><strong>{snapshot.score} pontos</strong> · {names[snapshot.classification]}</p><div className="tableScroll"><table><caption>Últimas 50 alterações</caption><thead><tr><th>Origem</th><th>Pontos</th><th>Total</th><th>Data em UTC</th></tr></thead><tbody>{snapshot.history.map((row) => <tr key={row.id}><td>{row.source==='canonical_event' ? 'Interação' : 'Jornada'}</td><td>{row.delta>0 ? '+' : ''}{row.delta}</td><td>{row.new_score}</td><td>{row.created_at.slice(0,19).replace('T',' ')}</td></tr>)}</tbody></table></div>{!snapshot.history.length && <p>Nenhuma alteração de pontuação registrada.</p>}</> : <p role="alert">Pontuação indisponível.</p>}</Card>;
}
