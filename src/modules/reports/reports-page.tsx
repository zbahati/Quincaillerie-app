"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Printer } from "lucide-react";

import { reportsApi, type DailyReport } from "@/lib/api/reports-api";
import { inventoryApi, type InventoryBranch } from "@/lib/api/inventory-api";
import { PageHeader } from "@/components/shared/page-header";
import { SelectField } from "@/components/shared/select-field";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useAuthentication } from "@/modules/auth/auth-gate";

function localDate(): string {
  return new Date().toISOString().slice(0, 10);
}

function formatMoney(value: number): string {
  const amount = BigInt(value);
  const whole = amount / 100n;
  const fraction = amount % 100n;
  return `${new Intl.NumberFormat("en-RW").format(whole)}${fraction === 0n ? "" : `.${fraction.toString().padStart(2, "0")}`} RWF`;
}

export function ReportsPage() {
  const { user } = useAuthentication();
  const [branches, setBranches] = useState<InventoryBranch[]>([]);
  const [branchId, setBranchId] = useState(user.role === "manager" ? user.branch_id ?? "" : "");
  const [fromDate, setFromDate] = useState(localDate);
  const [toDate, setToDate] = useState(localDate);
  const [report, setReport] = useState<DailyReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let active = true;
    inventoryApi.branches()
      .then((result) => {
        if (!active) return;
        setBranches(result);
        setBranchId((current) => result.some((branch) => branch.id === current) ? current : (result[0]?.id ?? ""));
      })
      .catch((cause) => { if (active) setError(cause instanceof Error ? cause.message : "Could not load branches."); });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!branchId || !fromDate || !toDate || fromDate > toDate) return;
    let active = true;
    reportsApi.daily(branchId, fromDate, toDate)
      .then((result) => { if (active) setReport(result); })
      .catch((cause) => {
        if (active) {
          setReport(null);
          setError(cause instanceof Error ? cause.message : "Could not calculate the report.");
        }
      })
      .finally(() => { if (active) setIsLoading(false); });
    return () => { active = false; };
  }, [branchId, fromDate, toDate]);

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <PageHeader
        eyebrow="Finance & reporting"
        title="Financial reconciliation report"
        description="Cash, sales, expenses, purchases and customer balances."
        actions={
          <div className="flex flex-wrap gap-2">
            {user.role === "admin" ? (
              <SelectField value={branchId} onChange={(event) => setBranchId(event.target.value)} aria-label="Branch">
                {branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}
              </SelectField>
            ) : null}
            <Input type="date" value={fromDate} onChange={(event) => setFromDate(event.target.value)} aria-label="From date" />
            <Input type="date" value={toDate} onChange={(event) => setToDate(event.target.value)} aria-label="To date" />
          </div>
        }
      />
      {error ? <div role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">{error}</div> : null}
      {fromDate > toDate ? <div role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">From date must be before or equal to to date.</div> : null}
      {isLoading ? <Card><CardContent className="py-10 text-sm text-muted-foreground">Calculating report range...</CardContent></Card> : null}
      {report ? (
        <article className="report-paper space-y-6">
          <header className="flex flex-wrap items-start justify-between gap-4 border-b-2 border-primary pb-5">
            <div><p className="text-sm font-medium uppercase tracking-wide text-muted-foreground">Daily business calculation</p><h2 className="font-heading text-2xl font-semibold">{report.business_name}</h2><p className="text-sm text-muted-foreground">{report.branch_name} · {report.report_date}</p></div>
            <Button asChild variant="outline"><Link href={`/reports/daily/print?branchId=${encodeURIComponent(branchId)}&fromDate=${encodeURIComponent(fromDate)}&toDate=${encodeURIComponent(toDate)}`}><Printer />Print view</Link></Button>
          </header>
          <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {[
              ["Sales total", formatMoney(report.sales_total), `${report.sale_count} completed sales`],
              ["Collected at sale", formatMoney(report.collected_at_sale), "Cash and account collections"],
              ["Credit sales", formatMoney(report.credit_sales), "Customer debt created"],
              ["Expenses", formatMoney(report.expenses_total), "Recorded operating costs"],
            ].map(([title, value, detail]) => (
              <Card key={title}><CardHeader className="pb-2"><CardDescription>{title}</CardDescription></CardHeader><CardContent><p className="text-xl font-semibold">{value}</p><p className="mt-1 text-xs text-muted-foreground">{detail}</p></CardContent></Card>
            ))}
          </section>
          <div className="grid gap-6 xl:grid-cols-2">
            <Card>
              <CardHeader><CardTitle>Cash reconciliation</CardTitle><CardDescription>Opening, movements and calculated physical closing cash.</CardDescription></CardHeader>
              <CardContent>
                <table className="w-full text-sm"><tbody>
                  <tr className="border-b"><td className="py-2">Opening physical cash</td><td className="py-2 text-right font-medium">{formatMoney(report.opening_physical_cash)}</td></tr>
                  <tr className="border-b"><td className="py-2">Period cash inflow</td><td className="py-2 text-right font-medium">{formatMoney(report.cash_inflow)}</td></tr>
                  <tr className="border-b"><td className="py-2">Period cash outflow</td><td className="py-2 text-right font-medium">{formatMoney(report.cash_outflow)}</td></tr>
                  <tr className="border-b font-semibold"><td className="py-2">Calculated physical cash</td><td className="py-2 text-right">{formatMoney(report.calculated_physical_cash)}</td></tr>
                </tbody></table>
              </CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle>Customer and purchase balances</CardTitle><CardDescription>Opening and closing credit plus deliveries.</CardDescription></CardHeader>
              <CardContent>
                <table className="w-full text-sm"><tbody>
                  <tr className="border-b"><td className="py-2">Customer debt opening</td><td className="py-2 text-right font-medium">{formatMoney(report.opening_customer_outstanding)}</td></tr>
                  <tr className="border-b"><td className="py-2">Customer debt closing</td><td className="py-2 text-right font-medium">{formatMoney(report.closing_customer_outstanding)}</td></tr>
                  <tr className="border-b"><td className="py-2">Customer repayments</td><td className="py-2 text-right font-medium">{formatMoney(report.customer_repayments)}</td></tr>
                  <tr><td className="py-2">Purchases received</td><td className="py-2 text-right font-medium">{formatMoney(report.purchases_received)}</td></tr>
                </tbody></table>
              </CardContent>
            </Card>
          </div>
          <Card>
            <CardHeader><CardTitle>Expenses by category</CardTitle><CardDescription>{formatMoney(report.expenses_total)} total</CardDescription></CardHeader>
            <CardContent>
              {report.expenses_by_category.length === 0 ? <p className="text-sm text-muted-foreground">No expenses recorded for this period.</p> : (
                <table className="w-full text-sm"><tbody>{report.expenses_by_category.map((item) => <tr key={item.category} className="border-b last:border-0"><td className="py-2">{item.category}</td><td className="py-2 text-right font-medium">{formatMoney(item.amount)}</td></tr>)}</tbody></table>
              )}
            </CardContent>
          </Card>
        </article>
      ) : null}
    </div>
  );
}
