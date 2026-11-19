"use client";

import { useEffect, useState } from "react";
import { Printer } from "lucide-react";

import { financialStatementsApi, type BalanceSheet } from "@/lib/api/financial-statements-api";
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

function accountLabel(value: string): string {
  return value.split("_").map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(" ");
}

export function BalanceSheetPage() {
  const { user } = useAuthentication();
  const [branches, setBranches] = useState<InventoryBranch[]>([]);
  const [branchId, setBranchId] = useState(user.role === "manager" ? user.branch_id ?? "" : "");
  const [reportDate, setReportDate] = useState(localDate);
  const [report, setReport] = useState<BalanceSheet | null>(null);
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
    if (!branchId || !reportDate) return;
    let active = true;
    financialStatementsApi.balanceSheet(branchId, reportDate)
      .then((result) => { if (active) setReport(result); })
      .catch((cause) => {
        if (active) {
          setReport(null);
          setError(cause instanceof Error ? cause.message : "Could not calculate the balance sheet.");
        }
      })
      .finally(() => { if (active) setIsLoading(false); });
    return () => { active = false; };
  }, [branchId, reportDate]);

  return (
    <div className="daily-report mx-auto max-w-7xl space-y-6">
      <PageHeader
        eyebrow="Finance & reporting"
        title="Business balance sheet"
        description="Financial position as of the selected date."
        actions={
          <div className="flex flex-wrap gap-2 print:hidden">
            {user.role === "admin" ? (
              <SelectField value={branchId} onChange={(event) => setBranchId(event.target.value)} aria-label="Branch">
                {branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}
              </SelectField>
            ) : null}
            <Input type="date" value={reportDate} onChange={(event) => setReportDate(event.target.value)} aria-label="Report date" />
            <Button variant="outline" onClick={() => window.print()}><Printer />Print</Button>
          </div>
        }
      />
      {error ? <div role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">{error}</div> : null}
      {isLoading ? <Card><CardContent className="py-10 text-sm text-muted-foreground">Calculating balance sheet...</CardContent></Card> : null}
      {report ? (
        <article className="report-paper space-y-6">
          <header className="border-b-2 border-primary pb-5">
            <p className="text-sm font-medium uppercase tracking-wide text-muted-foreground">Balance sheet</p>
            <h2 className="font-heading text-2xl font-semibold">{report.business_name}</h2>
            <p className="text-sm text-muted-foreground">{report.branch_name} · {report.report_date}</p>
          </header>
          <div className="grid gap-6 xl:grid-cols-2">
            <Card>
              <CardHeader><CardTitle>Assets</CardTitle><CardDescription>Resources controlled by the business.</CardDescription></CardHeader>
              <CardContent>
                <table className="w-full text-sm"><tbody>
                  {report.cash_accounts.map((account) => (
                    <tr className="border-b" key={`${account.accountType}-${account.name}`}>
                      <td className="py-2">{account.name} <span className="text-muted-foreground">({accountLabel(account.accountType)})</span></td>
                      <td className="py-2 text-right">{formatMoney(account.balance)}</td>
                    </tr>
                  ))}
                  <tr className="border-b font-medium"><td className="py-2">Total cash and bank</td><td className="py-2 text-right">{formatMoney(report.cash_and_bank)}</td></tr>
                  <tr className="border-b"><td className="py-2">Inventory</td><td className="py-2 text-right">{formatMoney(report.inventory)}</td></tr>
                  <tr className="border-b"><td className="py-2">Accounts receivable</td><td className="py-2 text-right">{formatMoney(report.accounts_receivable)}</td></tr>
                  <tr className="bg-primary/10 text-base font-bold"><td className="py-3">Total assets</td><td className="py-3 text-right">{formatMoney(report.total_assets)}</td></tr>
                </tbody></table>
              </CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle>Liabilities and equity</CardTitle><CardDescription>Obligations and owner claims; owner equity is calculated as the balancing figure.</CardDescription></CardHeader>
              <CardContent>
                <table className="w-full text-sm"><tbody>
                  <tr className="border-b"><td className="py-2">Accounts payable</td><td className="py-2 text-right">{formatMoney(report.accounts_payable)}</td></tr>
                  <tr className="border-b font-medium"><td className="py-2">Total liabilities</td><td className="py-2 text-right">{formatMoney(report.total_liabilities)}</td></tr>
                  <tr className="border-b"><td className="py-2">Retained earnings</td><td className="py-2 text-right">{formatMoney(report.retained_earnings)}</td></tr>
                  <tr className="border-b"><td className="py-2">Owner equity (balancing figure)</td><td className="py-2 text-right">{formatMoney(report.owner_equity)}</td></tr>
                  <tr className="border-b font-medium"><td className="py-2">Total equity</td><td className="py-2 text-right">{formatMoney(report.total_equity)}</td></tr>
                  <tr className="bg-primary/10 text-base font-bold"><td className="py-3">Total liabilities and equity</td><td className="py-3 text-right">{formatMoney(report.total_liabilities_and_equity)}</td></tr>
                </tbody></table>
              </CardContent>
            </Card>
          </div>
          <Card>
            <CardHeader><CardTitle>Accounting note</CardTitle></CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">
                Unassigned business-wide expenses are included in this branch view. The zero balance difference is arithmetic, not an independent reconciliation: owner contributions and withdrawals are not recorded, and loan accounts are not supported.
              </p>
            </CardContent>
          </Card>
        </article>
      ) : null}
    </div>
  );
}
