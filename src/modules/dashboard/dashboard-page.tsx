"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ArrowRight, Boxes, CircleDollarSign, LoaderCircle, Package, ShoppingCart, TriangleAlert } from "lucide-react";

import { dashboardApi, type DashboardData } from "@/lib/api/dashboard-api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/shared/page-header";
import { SelectField } from "@/components/shared/select-field";
import { useAuthentication } from "@/modules/auth/auth-gate";

const QUANTITY_SCALE = 1000n;
const MONEY_SCALE = 100n;

function formatQuantity(value: number): string {
  const scaled = BigInt(value);
  const whole = scaled / QUANTITY_SCALE;
  const fraction = scaled % QUANTITY_SCALE;
  return fraction === 0n
    ? new Intl.NumberFormat("en-RW").format(whole)
    : `${new Intl.NumberFormat("en-RW").format(whole)}.${fraction.toString().padStart(3, "0").replace(/0+$/, "")}`;
}

function formatMoney(value: number): string {
  const amount = BigInt(value);
  const whole = amount / MONEY_SCALE;
  const fraction = amount % MONEY_SCALE;
  return `${new Intl.NumberFormat("en-RW").format(whole)}${fraction === 0n ? "" : `.${fraction.toString().padStart(2, "0")}`} RWF`;
}

export function DashboardPage() {
  const { user } = useAuthentication();
  const [branchId, setBranchId] = useState(user.role === "manager" ? user.branch_id ?? "" : "");
  const [branches, setBranches] = useState<Array<{ id: string; name: string; is_active: boolean }>>([]);
  const [dashboard, setDashboard] = useState<DashboardData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    dashboardApi.branches()
      .then((result) => {
        if (!active) return;
        setBranches(result);
        setBranchId((current) =>
          result.some((branch) => branch.id === current)
            ? current
            : (result[0]?.id ?? ""),
        );
      })
      .catch((cause) => {
        if (active) setError(cause instanceof Error ? cause.message : "Could not load dashboard branches.");
      });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!branchId) return;
    let active = true;
    dashboardApi.get(branchId)
      .then((result) => { if (active) setDashboard(result); })
      .catch((cause) => {
        if (active) {
          setDashboard(null);
          setError(cause instanceof Error ? cause.message : "Could not load the dashboard.");
        }
      })
      .finally(() => {
        if (active) setIsLoading(false);
      });
    return () => { active = false; };
  }, [branchId]);

  const inventory = dashboard?.inventory;
  const stockAlerts = inventory?.items.filter(
    (item) => item.quantity_on_hand === 0 || item.quantity_on_hand <= item.min_stock_quantity,
  ) ?? [];

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <PageHeader
        eyebrow="Overview"
        title="Business dashboard"
        description={dashboard ? `A live inventory overview for ${dashboard.business.name}.` : "A live overview of your shop's inventory."}
        actions={
          <div className="flex flex-wrap items-end gap-3">
            {dashboard && user.role === "admin" ? (
              <div className="w-full space-y-1.5 sm:w-56">
                <label htmlFor="dashboard-branch" className="text-xs font-medium text-muted-foreground">Branch</label>
                <SelectField id="dashboard-branch" value={branchId} onChange={(event) => setBranchId(event.target.value)}>
                  {branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}
                </SelectField>
              </div>
            ) : null}
            <Button asChild><Link href="/pos"><ShoppingCart />New sale</Link></Button>
          </div>
        }
      />

      {error ? <div role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">{error}</div> : null}

      {isLoading ? (
        <Card><CardContent className="flex items-center gap-2 py-8 text-sm text-muted-foreground"><LoaderCircle className="size-4 animate-spin" />Loading dashboard...</CardContent></Card>
      ) : dashboard && inventory ? (
        <>
          <section aria-label="Inventory summary" className="grid gap-4 xl:grid-cols-3">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2"><CardDescription>Inventory value</CardDescription><CircleDollarSign className="size-4 text-muted-foreground" /></CardHeader>
              <CardContent><p className="data-number text-2xl font-semibold tracking-tight">{formatMoney(inventory.total_stock_value)}</p><p className="mt-1 text-xs text-muted-foreground">Remaining stock at recorded FIFO purchase costs</p></CardContent>
            </Card>
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2"><CardDescription>Active products</CardDescription><Package className="size-4 text-muted-foreground" /></CardHeader>
              <CardContent><p className="data-number text-2xl font-semibold tracking-tight">{inventory.total_count.toLocaleString("en-RW")}</p><p className="mt-1 text-xs text-muted-foreground">Products in this branch catalogue</p></CardContent>
            </Card>
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2"><CardDescription>Stock needing attention</CardDescription><TriangleAlert className="size-4 text-muted-foreground" /></CardHeader>
              <CardContent><p className="data-number text-2xl font-semibold tracking-tight">{(inventory.low_stock_count + inventory.out_of_stock_count).toLocaleString("en-RW")}</p><p className="mt-1 text-xs text-muted-foreground">{inventory.low_stock_count} low · {inventory.out_of_stock_count} out of stock</p></CardContent>
            </Card>
          </section>

          <section className="grid gap-4 xl:grid-cols-[minmax(0,1.5fr)_minmax(18rem,0.8fr)]">
            <Card>
              <CardHeader className="flex flex-row items-start justify-between gap-4">
                <div><CardTitle>Stock overview</CardTitle><CardDescription className="mt-1">Current on-hand quantity and FIFO value by product.</CardDescription></div>
                <Button asChild variant="outline" size="sm"><Link href="/inventory">View inventory <ArrowRight /></Link></Button>
              </CardHeader>
              <CardContent>
                {inventory.items.length === 0 ? (
                  <div className="py-8 text-center"><Boxes className="mx-auto mb-2 size-7 text-muted-foreground" /><p className="text-sm text-muted-foreground">No active products to display.</p><Button asChild variant="link" className="mt-2"><Link href="/products">Add products</Link></Button></div>
                ) : (
                  <div className="divide-y">{inventory.items.map((item) => {
                    const low = item.quantity_on_hand <= item.min_stock_quantity;
                    return (
                      <div key={item.product_id} className="flex items-center justify-between gap-4 py-3 first:pt-0 last:pb-0">
                        <div className="min-w-0"><p className="truncate text-sm font-medium">{item.name}</p><p className="mt-0.5 text-xs text-muted-foreground">{item.sku}</p></div>
                        <div className="flex shrink-0 items-center gap-5">
                          <div className="text-right"><p className="data-number text-sm font-medium">{formatQuantity(item.quantity_on_hand)} <span className="text-muted-foreground">{item.base_unit_name}</span></p><p className="data-number text-xs text-muted-foreground">{formatMoney(item.stock_value)}</p></div>
                          <Badge
                            variant={item.quantity_on_hand === 0 ? "destructive" : low ? "outline" : "secondary"}
                            className={low && item.quantity_on_hand > 0
                              ? "border-amber-500/40 bg-amber-500/10 text-amber-800 dark:text-amber-300"
                              : undefined}
                          >
                            {item.quantity_on_hand === 0 ? "Out" : low ? "Low" : "In stock"}
                          </Badge>
                        </div>
                      </div>
                    );
                  })}</div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader><CardTitle>Quick actions</CardTitle><CardDescription>Shortcuts to common shop tasks.</CardDescription></CardHeader>
              <CardContent className="grid gap-2">
                <Button asChild variant="outline" className="h-auto justify-between py-3"><Link href="/pos"><span className="flex items-center gap-3"><ShoppingCart className="size-4 text-primary" />Start a sale</span><ArrowRight /></Link></Button>
                <Button asChild variant="outline" className="h-auto justify-between py-3"><Link href="/inventory"><span className="flex items-center gap-3"><Boxes className="size-4 text-primary" />Receive or adjust stock</span><ArrowRight /></Link></Button>
                <Button asChild variant="outline" className="h-auto justify-between py-3"><Link href="/products"><span className="flex items-center gap-3"><Package className="size-4 text-primary" />Manage products</span><ArrowRight /></Link></Button>
              </CardContent>
            </Card>
          </section>

          {stockAlerts.length > 0 ? (
            <section>
              <div className="mb-3 flex items-end justify-between gap-4"><div><h2 className="text-base font-semibold">Stock alerts in this preview</h2><p className="mt-1 text-sm text-muted-foreground">Low and out-of-stock products among the first items shown.</p></div><Button asChild variant="link" size="sm"><Link href="/inventory">Review all alerts <ArrowRight /></Link></Button></div>
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{stockAlerts.slice(0, 4).map((item) => (
                <Card key={item.product_id} size="sm"><CardContent className="flex items-center justify-between gap-3"><p className="truncate text-sm font-medium">{item.name}</p><Badge variant={item.quantity_on_hand === 0 ? "destructive" : "outline"}>{item.quantity_on_hand === 0 ? "Out" : `${formatQuantity(item.quantity_on_hand)} left`}</Badge></CardContent></Card>
              ))}</div>
            </section>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
