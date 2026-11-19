"use client";

import { useEffect, useState } from "react";
import { Printer } from "lucide-react";

import { financialStatementsApi, type IncomeStatement } from "@/lib/api/financial-statements-api";
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
  return `${amount < 0n ? "−" : ""}${new Intl.NumberFormat("en-RW").format(whole)}${fraction === 0n ? "" : `.${fraction.toString().padStart(2, "0")}`} RWF`;
}

export function IncomeStatementPage() {
  const { user } = useAuthentication();
  const [branches, setBranches] = useState<InventoryBranch[]>([]);
  const [branchId, setBranchId] = useState(user.role === "manager" ? user.branch_id ?? "" : "");
  const [fromDate, setFromDate] = useState(localDate);
  const [toDate, setToDate] = useState(localDate);
  const [report, setReport] = useState<IncomeStatement | null>(null);
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
    financialStatementsApi.income(branchId, fromDate, toDate)
      .then((result) => { if (active) setReport(result); })
      .catch((cause) => {
        if (active) {
          setReport(null);
          setError(cause instanceof Error ? cause.message : "Could not calculate the income statement.");
        }
      })
      .finally(() => { if (active) setIsLoading(false); });
    return () => { active = false; };
  }, [branchId, fromDate, toDate]);

  return (
    <div className="daily-report mx-auto max-w-7xl space-y-6">
      <PageHeader
        eyebrow="Finance & reporting"
        title="Business income statement"
        description="Revenue, cost of goods sold and operating expenses."
        actions={
          <div className="flex flex-wrap gap-2 print:hidden">
            {user.role === "admin" ? (
              <SelectField value={branchId} onChange={(event) => setBranchId(event.target.value)} aria-label="Branch">
                {branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}
              </SelectField>
            ) : null}
            <Input type="date" value={fromDate} onChange={(event) => setFromDate(event.target.value)} aria-label="From date" />
            <Input type="date" value={toDate} onChange={(event) => setToDate(event.target.value)} aria-label="To date" />
            <Button variant="outline" onClick={() => window.print()}><Printer />Print</Button>
          </div>
        }
      />
      {error ? <div role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">{error}</div> : null}
      {fromDate > toDate ? <div role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">From date must be before or equal to to date.</div> : null}
      {isLoading ? <Card><CardContent className="py-10 text-sm text-muted-foreground">Calculating income statement...</CardContent></Card> : null}
      {report ? (
        <article className="report-paper space-y-6">
          <header className="border-b-2 border-primary pb-5">
            <p className="text-sm font-medium uppercase tracking-wide text-muted-foreground">Business income statement</p>
            <h2 className="font-heading text-2xl font-semibold">{report.business_name}</h2>
            <p className="text-sm text-muted-foreground">{report.branch_name} · {fromDate} — {toDate}</p>
          </header>
          <Card>
            <CardHeader><CardTitle>Income statement</CardTitle><CardDescription>Completed product sales and branch-assigned or shared operating expenses for the selected period.</CardDescription></CardHeader>
            <CardContent>
              <table className="w-full text-sm"><tbody>
                <tr className="border-b"><td className="py-3">Sales revenue ({report.sale_count} completed sales)</td><td className="py-3 text-right">{formatMoney(report.sales_total)}</td></tr>
                <tr className="border-b"><td className="py-3">Cost of goods sold</td><td className="py-3 text-right">{formatMoney(report.cost_of_goods_sold)}</td></tr>
                <tr className="border-b bg-muted/40 font-semibold"><td className="py-3">Gross profit</td><td className="py-3 text-right">{formatMoney(report.gross_profit)}</td></tr>
                <tr className="border-b"><td className="py-3">Operating expenses</td><td className="py-3 text-right">{formatMoney(report.expenses_total)}</td></tr>
                <tr className="bg-primary/10 text-base font-bold"><td className="py-3">Net operating profit / loss</td><td className="py-3 text-right">{formatMoney(report.operating_result)}</td></tr>
              </tbody></table>
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle>Operating expenses by category</CardTitle></CardHeader>
            <CardContent>
              {report.expenses_by_category.length === 0 ? <p className="text-sm text-muted-foreground">No operating expenses recorded.</p> : (
                <table className="w-full text-sm"><tbody>{report.expenses_by_category.map((item) => <tr className="border-b last:border-0" key={item.category}><td className="py-2">{item.category}</td><td className="py-2 text-right">{formatMoney(item.amount)}</td></tr>)}</tbody></table>
              )}
            </CardContent>
          </Card>
        </article>
      ) : null}
    </div>
  );
}
