import { z } from 'zod';

export const billingTotalsSchema = z.object({ calls:z.number(),knownCalls:z.number(),pendingCalls:z.number(),inputTokens:z.number(),outputTokens:z.number(),cachedInputTokens:z.number(),inputCostUsd:z.number(),outputCostUsd:z.number(),totalCostUsd:z.number() });
const priceSchema = z.object({model:z.string(),inputPerMillion:z.number(),cachedInputPerMillion:z.number(),outputPerMillion:z.number(),source:z.string()});
const lineSchema = z.object({userId:z.string(),email:z.string(),model:z.string(),priceVersion:z.string().nullable(),inputPerMillion:z.number().nullable(),cachedInputPerMillion:z.number().nullable(),outputPerMillion:z.number().nullable(),totals:billingTotalsSchema});
export const billSchema = z.object({month:z.string(),since:z.number(),until:z.number(),currency:z.literal('USD'),timeZone:z.string(),priceVersion:z.string(),prices:z.array(priceSchema),totals:billingTotalsSchema,users:z.array(z.object({userId:z.string(),email:z.string(),totals:billingTotalsSchema})),lines:z.array(lineSchema)});
export const invoiceSchema = billSchema.extend({id:z.string(),createdAt:z.number(),userId:z.string().nullable()});
export const billingReportSchema = billSchema.extend({invoices:z.array(z.object({id:z.string(),userId:z.string().nullable(),createdAt:z.number(),totalCostUsd:z.number(),pendingCalls:z.number()}))});
export type Bill = z.infer<typeof billSchema>;
export type Invoice = z.infer<typeof invoiceSchema>;
export type BillingReport = z.infer<typeof billingReportSchema>;

const currency = new Intl.NumberFormat('en-US', {style:'currency',currency:'USD',minimumFractionDigits:2,maximumFractionDigits:6});
export const money = (amount:number) => amount>0&&amount<0.000001?'<$0.000001':currency.format(amount);
export const modelName = (id:string) => ({'gpt-6-astra':'GPT-6 Astra','gpt-5.6-sol':'GPT-5.6 Sol','gpt-5.6-terra':'GPT-5.6 Terra','gpt-5.6-luna':'GPT-5.6 Luna',unknown:'未记录模型'}[id]||id);
export const billingMonth = () => new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit'}).format(new Date());

export function invoiceCsv(invoice: Invoice): string {
  const rows: (string|number)[][] = [
    ['账单编号',invoice.id],['账期',invoice.month],['时区',invoice.timeZone],['币种','USD'],['类型','API 等价估算，非实际扣款'],
    ['待核对调用',invoice.totals.pendingCalls],['已核对金额 USD',invoice.totals.totalCostUsd.toFixed(9)],
    ['邮箱','模型','计价版本','调用次数','待核对次数','输入 Token（含缓存）','缓存输入 Token','输出 Token','普通输入 USD/1M','缓存输入 USD/1M','输出 USD/1M','输入金额 USD','输出金额 USD','小计 USD'],
    ...invoice.lines.map(line=>[line.email,line.model,line.priceVersion||'未计价',line.totals.calls,line.totals.pendingCalls,line.totals.inputTokens,line.totals.cachedInputTokens,line.totals.outputTokens,line.inputPerMillion??'',line.cachedInputPerMillion??'',line.outputPerMillion??'',line.totals.knownCalls?line.totals.inputCostUsd.toFixed(9):'',line.totals.knownCalls?line.totals.outputCostUsd.toFixed(9):'',line.totals.knownCalls?line.totals.totalCostUsd.toFixed(9):'']),
  ];
  return '\ufeff'+rows.map(row=>row.map(value=>{
    let text=String(value);if(/^[=+\-@\t\r]/.test(text))text=`'${text}`;
    return `"${text.replace(/"/g,'""')}"`;
  }).join(',')).join('\r\n');
}

export function downloadInvoice(invoice: Invoice) {
  const url=URL.createObjectURL(new Blob([invoiceCsv(invoice)],{type:'text/csv;charset=utf-8'}));
  const anchor=document.createElement('a');anchor.href=url;anchor.download=`${invoice.id}.csv`;anchor.click();
  window.setTimeout(()=>URL.revokeObjectURL(url),1000);
}
