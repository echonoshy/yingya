import { describe, expect, it } from 'vitest';
import { invoiceSchema, invoiceCsv, money } from './billing';

describe('equivalent API billing', () => {
  it('keeps tiny positive costs visible', () => {
    expect(money(0)).toBe('$0.00');
    expect(money(0.0000002)).toBe('<$0.000001');
    expect(money(1.32)).toBe('$1.32');
  });
  it('exports exact counts, preserves fractional dollars and neutralizes CSV formulas', () => {
    const totals={calls:1,knownCalls:1,pendingCalls:0,inputTokens:1234567,outputTokens:1,cachedInputTokens:0,inputCostUsd:0.0000002,outputCostUsd:0.0000012,totalCostUsd:0.0000014};
    const invoice=invoiceSchema.parse({id:'YY-test',userId:'user',createdAt:1,month:'2026-09',since:0,until:1,currency:'USD',timeZone:'Asia/Shanghai',priceVersion:'test',prices:[],users:[],totals,lines:[{userId:'user',email:'=CMD@example.test',model:'gpt-5.6-luna',priceVersion:'test',inputPerMillion:0.2,cachedInputPerMillion:0.02,outputPerMillion:1.2,totals}]});
    const csv=invoiceCsv(invoice);
    expect(csv).toContain('"1234567"');
    expect(csv).toContain('"0.000001400"');
    expect(csv).toContain('"\'=CMD@example.test"');
    expect(csv).not.toContain('1.23M');
  });
});
