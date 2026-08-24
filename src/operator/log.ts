export function operatorLog(event: string, fields: Record<string, unknown> = {}): void {
  console.log(JSON.stringify({ event, ts: new Date().toISOString(), ...fields }));
}
