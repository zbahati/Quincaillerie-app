"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, LoaderCircle, Printer } from "lucide-react";

import { reportsApi, type DailyReport } from "@/lib/api/reports-api";
import { Button } from "@/components/ui/button";

function formatMoney(value: number): string {
  const amount = BigInt(value);
  const whole = amount / 100n;
  const fraction = amount % 100n;
  return `${new Intl.NumberFormat("en-RW").format(whole)}${fraction === 0n ? "" : `.${fraction.toString().padStart(2, "0")}`} RWF`;
}

export function DailyReportPrintPage() {
  const searchParams = useSearchParams();
  const branchId = searchParams.get("branchId") ?? "";
  const fromDate = searchParams.get("fromDate") ?? "";
  const toDate = searchParams.get("toDate") ?? "";
  const [report, setReport] = useState<DailyReport | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!branchId || !fromDate || !toDate) {
      return;
    }
    reportsApi.daily(branchId, fromDate, toDate)
      .then(setReport)
      .catch((cause) => setError(cause instanceof Error ? cause.message : "Could not calculate the report."));
  }, [branchId, fromDate, toDate]);

  useEffect(() => {
    document.title = "Quincaillerie_Daily_Report";
    return () => { document.title = "Quincaillerie Manager"; };
  }, []);

  if (!branchId || !fromDate || !toDate) {
    return <main className="print-report-error"><p>A branch and report date range are required.</p><Link href="/reports">Return to Reports</Link></main>;
  }
  if (error) return <main className="print-report-error"><p>{error}</p><Link href="/reports">Return to Reports</Link></main>;
  if (!report) return <main className="print-report-loading"><LoaderCircle className="animate-spin" />Preparing printable report...</main>;

  return (
    <main className="print-report-page">
      <div className="print-report-actions">
        <Button variant="outline" asChild><Link href="/reports"><ArrowLeft />Back to Reports</Link></Button>
        <Button variant="outline" onClick={() => window.print()}><Printer />Print</Button>
      </div>
      <article className="print-report-document">
        <header className="cashbook-header">
          <div><p className="print-report-kicker">Daily reconciliation</p><h1>{report.business_name}</h1><p>{report.branch_name} · RWF</p></div>
          <div className="print-report-meta"><span>Reporting range</span><strong>{report.report_date}</strong></div>
        </header>
        <section className="cashbook-ledger">
          <table className="cashbook-table">
            <thead><tr><th>Description</th><th>Amount</th><th>Reference</th></tr></thead>
            <tbody>
              <tr className="is-emphasis"><td>Opening physical cash</td><td>{formatMoney(report.opening_physical_cash)}</td><td>Cash drawer ledger</td></tr>
              <tr className="is-emphasis"><td>Period cash inflow</td><td>{formatMoney(report.cash_inflow)}</td><td>Cash drawer movements</td></tr>
              <tr className="is-emphasis"><td>Period cash outflow</td><td>{formatMoney(report.cash_outflow)}</td><td>Cash drawer movements</td></tr>
              <tr className="is-emphasis"><td>Calculated physical cash</td><td>{formatMoney(report.calculated_physical_cash)}</td><td>Opening + drawer inflow - drawer outflow</td></tr>
              <tr><td>Sales total</td><td>{formatMoney(report.sales_total)}</td><td>{report.sale_count} completed sales</td></tr>
              <tr><td>Collected at sale</td><td>{formatMoney(report.collected_at_sale)}</td><td>Sale payments</td></tr>
              <tr><td>Credit sales</td><td>{formatMoney(report.credit_sales)}</td><td>Customer debt</td></tr>
              <tr><td>Customer repayments</td><td>{formatMoney(report.customer_repayments)}</td><td>Later repayments</td></tr>
              <tr><td>Expenses</td><td>{formatMoney(report.expenses_total)}</td><td>Operating costs</td></tr>
              <tr><td>Purchases received</td><td>{formatMoney(report.purchases_received)}</td><td>Stock receipts</td></tr>
            </tbody>
          </table>
        </section>
        <footer className="print-report-footer"><span>Quincaillerie Manager · {report.report_date}</span></footer>
      </article>
    </main>
  );
}
