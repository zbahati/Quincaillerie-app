"use client";

import { useEffect, useState } from "react";
import { Eye, LoaderCircle, Search } from "lucide-react";

import { salesApi, type SaleHistoryEntry, type SalesBranch } from "@/lib/api/sales-api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/shared/page-header";
import { SelectField } from "@/components/shared/select-field";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useAuthentication } from "@/modules/auth/auth-gate";

const PAGE_SIZE = 30;
const MONEY_SCALE = 100n;
const QUANTITY_SCALE = 1000n;

function localDate(date = new Date()): string {
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 10);
}

function dateThirtyDaysAgo(): string {
  const date = new Date();
  date.setDate(date.getDate() - 29);
  return localDate(date);
}

function formatMoney(value: number): string {
  if (!Number.isSafeInteger(value)) return "—";
  const amount = BigInt(value);
  const absolute = amount < 0n ? -amount : amount;
  const whole = absolute / MONEY_SCALE;
  const fraction = absolute % MONEY_SCALE;
  return `${amount < 0n ? "−" : ""}${new Intl.NumberFormat("en-RW").format(Number(whole))}${fraction === 0n ? "" : `.${fraction.toString().padStart(2, "0")}`} RWF`;
}

function formatQuantity(value: number): string {
  if (!Number.isSafeInteger(value)) return "—";
  const quantity = BigInt(value);
  const whole = quantity / QUANTITY_SCALE;
  const fraction = quantity % QUANTITY_SCALE;
  return fraction === 0n
    ? new Intl.NumberFormat("en-RW").format(Number(whole))
    : `${new Intl.NumberFormat("en-RW").format(Number(whole))}.${fraction.toString().padStart(3, "0").replace(/0+$/, "")}`;
}

function paymentMethodLabel(method: string): string {
  return ({
    cash: "Cash",
    mtn_mobile_money: "MTN Mobile Money",
    airtel_money: "Airtel Money",
    bank_transfer: "Bank transfer",
  } as Record<string, string>)[method] ?? method;
}

function timestamp(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleString("en-RW", {
        day: "2-digit",
        month: "short",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });
}

function errorText(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

export function SalesHistoryPage() {
  const { user, permissions } = useAuthentication();
  const canRead = user.role === "admin" || permissions.includes("sales.read");
  const [branches, setBranches] = useState<SalesBranch[]>([]);
  const [branchId, setBranchId] = useState(user.role === "manager" ? user.branch_id ?? "" : "");
  const [search, setSearch] = useState("");
  const [fromDate, setFromDate] = useState(dateThirtyDaysAgo);
  const [toDate, setToDate] = useState(localDate);
  const [page, setPage] = useState(0);
  const [history, setHistory] = useState<{
    items: SaleHistoryEntry[];
    total_count: number;
    completed_sales_total: number;
    collected_at_sale_total: number;
  } | null>(null);
  const [selectedSale, setSelectedSale] = useState<SaleHistoryEntry | null>(null);
  const [isLoadingBranches, setIsLoadingBranches] = useState(true);
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!canRead) {
      return;
    }
    let active = true;
    salesApi.branches()
      .then((result) => {
        if (!active) return;
        setBranches(result);
        setBranchId((current) =>
          result.some((branch) => branch.id === current) ? current : (result[0]?.id ?? ""),
        );
      })
      .catch((cause) => {
        if (active) setError(`Could not load sales branches. ${errorText(cause)}`);
      })
      .finally(() => {
        if (active) setIsLoadingBranches(false);
      });
    return () => { active = false; };
  }, [canRead]);

  useEffect(() => {
    if (!canRead || !branchId || !fromDate || !toDate || fromDate > toDate) {
      return;
    }
    let active = true;
    const timer = window.setTimeout(() => {
      setIsLoadingHistory(true);
      setError(null);
      salesApi.list({
        branchId,
        search: search.trim(),
        fromDate,
        toDate,
        offset: page * PAGE_SIZE,
        limit: PAGE_SIZE,
      })
        .then((result) => { if (active) setHistory(result); })
        .catch((cause) => {
          if (active) {
            setHistory(null);
            setError(`Could not load sales history. ${errorText(cause)}`);
          }
        })
        .finally(() => {
          if (active) setIsLoadingHistory(false);
        });
    }, search.trim() ? 250 : 0);
    return () => { active = false; window.clearTimeout(timer); };
  }, [canRead, branchId, fromDate, toDate, search, page]);

  if (!canRead) {
    return (
      <div className="mx-auto max-w-7xl space-y-6">
        <PageHeader eyebrow="Business" title="Sales history" description="Review recorded sales and payments." />
        <Card><CardContent className="py-6 text-sm text-muted-foreground">You do not have permission to view sales history.</CardContent></Card>
      </div>
    );
  }

  const totalPages = Math.max(1, Math.ceil((history?.total_count ?? 0) / PAGE_SIZE));
  const invalidRange = Boolean(fromDate && toDate && fromDate > toDate);

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <PageHeader eyebrow="Business" title="Sales history" description="Review recorded sales, customers, products and payments." />

      {error ? <div role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">{error}</div> : null}
      {invalidRange ? <div role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">The start date cannot be after the end date.</div> : null}

      <Card>
        <CardHeader><CardTitle>Find sales</CardTitle><CardDescription>Search by transaction, customer, product or SKU.</CardDescription></CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-[minmax(16rem,1fr)_repeat(3,minmax(9rem,12rem))]">
          <div className="space-y-1.5">
            <Label htmlFor="sale-history-search">Search</Label>
            <div className="relative"><Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" /><Input id="sale-history-search" className="pl-9" value={search} onChange={(event) => { setSearch(event.target.value); setPage(0); }} placeholder="Transaction, customer, product or SKU" /></div>
          </div>
          <div className="space-y-1.5"><Label htmlFor="sale-history-branch">Branch</Label><SelectField id="sale-history-branch" value={branchId} onChange={(event) => { setBranchId(event.target.value); setPage(0); }} disabled={user.role === "manager" || isLoadingBranches}>{branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}</SelectField></div>
          <div className="space-y-1.5"><Label htmlFor="sale-history-from">From date</Label><Input id="sale-history-from" type="date" value={fromDate} onChange={(event) => { setFromDate(event.target.value); setPage(0); }} /></div>
          <div className="space-y-1.5"><Label htmlFor="sale-history-to">To date</Label><Input id="sale-history-to" type="date" value={toDate} onChange={(event) => { setToDate(event.target.value); setPage(0); }} /></div>
        </CardContent>
      </Card>

      <div className="grid gap-4 sm:grid-cols-3">
        {[
          ["Matching sales", String(history?.total_count ?? 0)],
          ["Completed sales", formatMoney(history?.completed_sales_total ?? 0)],
          ["Collected at sale", formatMoney(history?.collected_at_sale_total ?? 0)],
        ].map(([label, value]) => (
          <Card key={label}><CardHeader className="pb-2"><CardDescription>{label}</CardDescription><CardTitle className="text-xl">{value}</CardTitle></CardHeader></Card>
        ))}
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div><CardTitle>Recorded sales</CardTitle><CardDescription>{history?.total_count ?? 0} matching sales</CardDescription></div>
          {isLoadingHistory ? <LoaderCircle className="size-5 animate-spin text-muted-foreground" /> : null}
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader><TableRow><TableHead>Sale</TableHead><TableHead>Customer</TableHead><TableHead>Date</TableHead><TableHead>Items</TableHead><TableHead className="text-right">Total</TableHead><TableHead className="text-right">Collected</TableHead><TableHead className="text-right">Balance</TableHead><TableHead /></TableRow></TableHeader>
            <TableBody>
              {history?.items.map((sale) => (
                <TableRow key={sale.id}>
                  <TableCell><p className="font-medium">{sale.transaction_number}</p><p className="text-xs text-muted-foreground">{sale.sold_by ?? "Unknown cashier"}</p></TableCell>
                  <TableCell>{sale.customer_name ?? "Walk-in customer"}</TableCell>
                  <TableCell>{timestamp(sale.created_at)}</TableCell>
                  <TableCell>{formatQuantity(sale.item_quantity)}</TableCell>
                  <TableCell className="text-right">{formatMoney(sale.total)}</TableCell>
                  <TableCell className="text-right">{formatMoney(sale.amount_paid)}</TableCell>
                  <TableCell className="text-right">{formatMoney(sale.balance_due)}</TableCell>
                  <TableCell className="text-right"><Button type="button" variant="outline" size="sm" onClick={() => setSelectedSale(sale)}><Eye />View</Button></TableCell>
                </TableRow>
              ))}
              {!isLoadingHistory && history?.items.length === 0 ? (
                <TableRow><TableCell colSpan={8} className="h-24 text-center text-muted-foreground">No sales match these filters.</TableCell></TableRow>
              ) : null}
            </TableBody>
          </Table>
          <div className="mt-4 flex items-center justify-between border-t pt-4">
            <p className="text-sm text-muted-foreground">Page {page + 1} of {totalPages}</p>
            <div className="flex gap-2">
              <Button type="button" variant="outline" size="sm" disabled={page === 0 || isLoadingHistory} onClick={() => setPage((value) => value - 1)}>Previous</Button>
              <Button type="button" variant="outline" size="sm" disabled={page + 1 >= totalPages || isLoadingHistory} onClick={() => setPage((value) => value + 1)}>Next</Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <Dialog open={selectedSale !== null} onOpenChange={(open) => !open && setSelectedSale(null)}>
        <DialogContent size="wide">
          {selectedSale ? (
            <>
              <DialogHeader><DialogTitle>{selectedSale.transaction_number}</DialogTitle><DialogDescription>{selectedSale.customer_name ?? "Walk-in customer"} · {timestamp(selectedSale.created_at)}</DialogDescription></DialogHeader>
              <div className="grid gap-6 lg:grid-cols-[minmax(0,1.5fr)_minmax(16rem,1fr)]">
                <div>
                  <h3 className="mb-2 text-sm font-semibold">Sale lines</h3>
                  <Table><TableHeader><TableRow><TableHead>Product</TableHead><TableHead>Quantity</TableHead><TableHead className="text-right">Unit price</TableHead><TableHead className="text-right">Total</TableHead></TableRow></TableHeader>
                    <TableBody>{selectedSale.items.map((item) => <TableRow key={`${selectedSale.id}-${item.sku}-${item.product_name}`}><TableCell><p className="font-medium">{item.product_name}</p><p className="text-xs text-muted-foreground">{item.sku}</p></TableCell><TableCell>{formatQuantity(item.quantity)} {item.unit_name}</TableCell><TableCell className="text-right">{formatMoney(item.unit_price)}</TableCell><TableCell className="text-right">{formatMoney(item.line_total)}</TableCell></TableRow>)}</TableBody>
                  </Table>
                </div>
                <div>
                  <h3 className="mb-2 text-sm font-semibold">Payments</h3>
                  {selectedSale.payments.length === 0 ? <p className="text-sm text-muted-foreground">No recorded payment.</p> : selectedSale.payments.map((payment, index) => <div key={`${payment.payment_method}-${index}`} className="flex justify-between border-b py-2 text-sm"><span>{paymentMethodLabel(payment.payment_method)}</span><span>{formatMoney(payment.amount)}</span></div>)}
                  <dl className="mt-4 space-y-2 border-t pt-3 text-sm">
                    <div className="flex justify-between"><dt>Total</dt><dd>{formatMoney(selectedSale.total)}</dd></div>
                    <div className="flex justify-between"><dt>Collected</dt><dd>{formatMoney(selectedSale.amount_paid)}</dd></div>
                    <div className="flex justify-between font-semibold"><dt>Balance due</dt><dd>{formatMoney(selectedSale.balance_due)}</dd></div>
                  </dl>
                  <Badge className="mt-4" variant="secondary">{selectedSale.status === "completed" ? "Completed" : "Cancelled"}</Badge>
                </div>
              </div>
            </>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}
