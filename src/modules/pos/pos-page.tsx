"use client";

import { useEffect, useMemo, useState } from "react";
import { LoaderCircle, Plus, Search, ShoppingCart, Trash2 } from "lucide-react";

import {
  posApi,
  type PosBranch,
  type PosPaymentAccount,
  type PosProduct,
  type SaleReceipt,
} from "@/lib/api/pos-api";
import { customersApi, type Customer } from "@/lib/api/relationships-api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PageHeader } from "@/components/shared/page-header";
import { SelectField } from "@/components/shared/select-field";
import { useAuthentication } from "@/modules/auth/auth-gate";

const QUANTITY_SCALE = 1000n;
const MONEY_SCALE = 100n;
const MAX_SAFE_INTEGER = BigInt(Number.MAX_SAFE_INTEGER);

type PaymentMethod = "cash" | "mtn_mobile_money" | "airtel_money" | "bank_transfer";

interface CartItem {
  product: PosProduct;
  quantity: string;
  sellingPrice: string;
  priceChangeReason: string;
  belowCostReasonRequired: boolean;
}

interface PaymentLine {
  id: string;
  method: PaymentMethod;
  amount: string;
  cashAccountId: string;
}

function accountTypeForMethod(method: PaymentMethod): PosPaymentAccount["account_type"] {
  switch (method) {
    case "cash": return "cash_drawer";
    case "bank_transfer": return "bank";
    case "mtn_mobile_money": return "mtn_wallet";
    case "airtel_money": return "airtel_wallet";
  }
}

function paymentAccountsForMethod(
  accounts: PosPaymentAccount[],
  method: PaymentMethod,
): PosPaymentAccount[] {
  const accountType = accountTypeForMethod(method);
  return accounts.filter((account) => account.account_type === accountType);
}

function errorText(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

function parseQuantity(value: string, decimals: boolean): bigint | null {
  if (!decimals ? !/^\d+$/.test(value) : !/^\d+(?:\.\d{1,3})?$/.test(value)) return null;
  const [whole, fraction = ""] = value.split(".");
  const scaled = BigInt(whole) * QUANTITY_SCALE + BigInt(fraction.padEnd(3, "0") || "0");
  return scaled > 0n && scaled <= MAX_SAFE_INTEGER ? scaled : null;
}

function parseMoney(value: string): bigint | null {
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(value);
  if (!match) return null;
  const scaled = BigInt(match[1]) * MONEY_SCALE + BigInt((match[2] ?? "").padEnd(2, "0"));
  return scaled <= MAX_SAFE_INTEGER ? scaled : null;
}

function formatQuantity(value: number): string {
  const quantity = BigInt(value);
  const whole = quantity / QUANTITY_SCALE;
  const fraction = quantity % QUANTITY_SCALE;
  return fraction === 0n
    ? new Intl.NumberFormat("en-RW").format(whole)
    : `${new Intl.NumberFormat("en-RW").format(whole)}.${fraction.toString().padStart(3, "0").replace(/0+$/, "")}`;
}

function formatMoney(value: bigint | number): string {
  const amount = typeof value === "number" ? BigInt(value) : value;
  const whole = amount / MONEY_SCALE;
  const fraction = amount % MONEY_SCALE;
  return `${new Intl.NumberFormat("en-RW").format(whole)}${fraction === 0n ? "" : `.${fraction.toString().padStart(2, "0")}`} RWF`;
}

function moneyInput(value: number): string {
  const amount = BigInt(value);
  const whole = amount / MONEY_SCALE;
  const fraction = amount % MONEY_SCALE;
  return fraction === 0n ? whole.toString() : `${whole}.${fraction.toString().padStart(2, "0")}`;
}

function lineTotal(item: CartItem): bigint | null {
  const quantity = parseQuantity(item.quantity, item.product.base_unit_allows_decimals);
  const price = parseMoney(item.sellingPrice);
  if (quantity === null || price === null || quantity > BigInt(item.product.quantity_on_hand)) return null;
  return (quantity * price + 500n) / QUANTITY_SCALE;
}

export function PosPage() {
  const { user, permissions } = useAuthentication();
  const canUse = user.role === "admin" || permissions.includes("pos.use");
  const [branches, setBranches] = useState<PosBranch[]>([]);
  const [branchId, setBranchId] = useState(user.role === "manager" ? user.branch_id ?? "" : "");
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [customerId, setCustomerId] = useState("");
  const [products, setProducts] = useState<PosProduct[]>([]);
  const [paymentAccounts, setPaymentAccounts] = useState<PosPaymentAccount[]>([]);
  const [paymentAccountsLoadingForBranch, setPaymentAccountsLoadingForBranch] = useState(
    user.role === "manager" ? user.branch_id ?? "" : "",
  );
  const isLoadingPaymentAccounts = Boolean(branchId && paymentAccountsLoadingForBranch === branchId);
  const [search, setSearch] = useState("");
  const [cart, setCart] = useState<CartItem[]>([]);
  const [paymentLines, setPaymentLines] = useState<PaymentLine[]>([
    { id: crypto.randomUUID(), method: "cash", amount: "", cashAccountId: "" },
  ]);
  const [completedSale, setCompletedSale] = useState<SaleReceipt | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isCheckingOut, setIsCheckingOut] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    posApi.branches()
      .then((branchResult) => {
        if (!active) return;
        setBranches(branchResult);
        const preferredBranchId = user.role === "manager" ? user.branch_id ?? "" : "";
        const selectedBranchId = branchResult.some((branch) => branch.id === preferredBranchId)
          ? preferredBranchId
          : branchResult[0]?.id ?? "";
        setBranchId(selectedBranchId);
        if (selectedBranchId) setPaymentAccountsLoadingForBranch(selectedBranchId);
      })
      .catch((cause) => {
        if (active) setError(`Could not load POS data. ${errorText(cause)}`);
      })
      .finally(() => {
        if (active) setIsLoading(false);
      });
    return () => { active = false; };
  }, [user.branch_id, user.role]);

  useEffect(() => {
    if (!branchId) return;
    let active = true;
    customersApi.list(branchId)
      .then((result) => {
        if (active) setCustomers(result.filter((customer) => customer.is_active));
      })
      .catch((cause) => {
        if (active) setError(`Could not load branch customers. ${errorText(cause)}`);
      });
    return () => { active = false; };
  }, [branchId]);

  useEffect(() => {
    if (!branchId) return;
    let active = true;
    const timer = window.setTimeout(() => {
      posApi.products({ branchId, search: search.trim(), offset: 0, limit: 30 })
        .then((result) => { if (active) setProducts(result.items); })
        .catch((cause) => { if (active) setError(`Could not search products. ${errorText(cause)}`); });
    }, 150);
    return () => { active = false; window.clearTimeout(timer); };
  }, [branchId, search]);

  useEffect(() => {
    if (!branchId) return;
    let active = true;
    posApi.paymentAccounts(branchId)
      .then((accounts) => {
        if (!active) return;
        setPaymentAccounts(accounts);
        setPaymentLines((current) => current.map((line) => {
          const eligible = paymentAccountsForMethod(accounts, line.method);
          const selected = eligible.some((account) => account.id === line.cashAccountId)
            ? line.cashAccountId
            : eligible.length === 1 ? eligible[0].id : "";
          return { ...line, cashAccountId: selected };
        }));
      })
      .catch((cause) => {
        if (active) setError(`Could not load active cash accounts. ${errorText(cause)}`);
      })
      .finally(() => {
        if (active) {
          setPaymentAccountsLoadingForBranch((current) =>
            current === branchId ? "" : current,
          );
        }
      });
    return () => { active = false; };
  }, [branchId]);

  const cartTotal = useMemo(
    () => cart.reduce((total, item) => total + (lineTotal(item) ?? 0n), 0n),
    [cart],
  );

  const hasInvalidCart = cart.some((item) => {
    const price = parseMoney(item.sellingPrice);
    const listed = BigInt(item.product.selling_price);
    const changed = price !== null && price !== listed;
    return lineTotal(item) === null ||
      ((changed || item.belowCostReasonRequired) && !item.priceChangeReason.trim());
  });

  function addToCart(product: PosProduct) {
    if (product.quantity_on_hand <= 0) {
      setError(`There is no stock available for ${product.name}.`);
      return;
    }
    setError(null);
    const existing = cart.find((item) => item.product.id === product.id);
    if (existing) {
      const quantity = parseQuantity(existing.quantity, product.base_unit_allows_decimals);
      if (quantity === null) return;
      const next = quantity + QUANTITY_SCALE;
      if (next > BigInt(product.quantity_on_hand)) {
        setError(`Not enough stock for ${product.name}.`);
        return;
      }
      setCart((current) => current.map((item) =>
        item.product.id === product.id
          ? { ...item, quantity: formatQuantity(Number(next)) }
          : item,
      ));
      return;
    }
    setCart((current) => [...current, {
      product,
      quantity: "1",
      sellingPrice: moneyInput(product.selling_price),
      priceChangeReason: "",
      belowCostReasonRequired: false,
    }]);
  }

  function updateCart(productId: string, patch: Partial<Pick<CartItem, "quantity" | "sellingPrice" | "priceChangeReason">>) {
    setCart((current) => current.map((item) =>
      item.product.id === productId
        ? { ...item, ...patch, belowCostReasonRequired: false }
        : item,
    ));
  }

  function addPaymentLine() {
    const accounts = paymentAccountsForMethod(paymentAccounts, "cash");
    setPaymentLines((current) => [...current, {
      id: crypto.randomUUID(),
      method: "cash",
      amount: "",
      cashAccountId: accounts.length === 1 ? accounts[0].id : "",
    }]);
  }

  async function handleCheckout() {
    if (!branchId || cart.length === 0 || hasInvalidCart || isCheckingOut) return;
    let amountPaid = 0n;
    const payments: Array<{ paymentMethod: PaymentMethod; amount: number; cashAccountId: string }> = [];
    for (const line of paymentLines) {
      if (!line.amount.trim()) continue;
      const amount = parseMoney(line.amount);
      if (amount === null || amount <= 0n) {
        setError("Enter a valid payment amount greater than zero.");
        return;
      }
      if (!paymentAccountsForMethod(paymentAccounts, line.method).some((account) => account.id === line.cashAccountId)) {
        setError(`Select an active, opened account that matches ${line.method.replace(/_/g, " ")}.`);
        return;
      }
      amountPaid += amount;
      payments.push({
        paymentMethod: line.method,
        amount: Number(amount),
        cashAccountId: line.cashAccountId,
      });
    }
    if (payments.length === 0) {
      const defaultLine = paymentLines[0];
      if (!defaultLine || !paymentAccountsForMethod(paymentAccounts, defaultLine.method)
        .some((account) => account.id === defaultLine.cashAccountId)) {
        setError(`Select an active, opened account that matches ${defaultLine?.method.replace(/_/g, " ") ?? "cash"}.`);
        return;
      }
      payments.push({
        paymentMethod: defaultLine.method,
        amount: Number(cartTotal),
        cashAccountId: defaultLine.cashAccountId,
      });
      amountPaid = cartTotal;
    }
    if (amountPaid > cartTotal) {
      setError("Payments cannot exceed the sale total.");
      return;
    }
    if (amountPaid < cartTotal && !customerId) {
      setError("Select a customer to record the unpaid balance as credit.");
      return;
    }

    const items = cart.map((item) => {
      const quantity = parseQuantity(item.quantity, item.product.base_unit_allows_decimals);
      const sellingPrice = parseMoney(item.sellingPrice);
      return {
        productId: item.product.id,
        quantity: quantity === null ? 0 : Number(quantity),
        sellingPrice: sellingPrice === null ? null : Number(sellingPrice),
        priceChangeReason: item.priceChangeReason.trim() || null,
      };
    });
    if (items.some((item) => item.quantity === 0 || item.sellingPrice === null)) {
      setError("Enter a valid quantity and selling price for every cart item.");
      return;
    }

    setIsCheckingOut(true);
    setError(null);
    try {
      const receipt = await posApi.checkout({
        branchId,
        customerId: customerId || null,
        items,
        payments,
      });
      setCompletedSale(receipt);
      setCart([]);
      const cashAccounts = paymentAccountsForMethod(paymentAccounts, "cash");
      setPaymentLines([{
        id: crypto.randomUUID(),
        method: "cash",
        amount: "",
        cashAccountId: cashAccounts.length === 1 ? cashAccounts[0].id : "",
      }]);
      const refreshed = await posApi.products({ branchId, search: search.trim(), offset: 0, limit: 30 });
      setProducts(refreshed.items);
    } catch (cause) {
      const text = errorText(cause);
      if (text.includes("BELOW_FIFO_COST")) {
        setCart((current) => current.map((item) => ({
          ...item,
          belowCostReasonRequired: text.includes(item.product.id),
        })));
        setError("This sale is below the actual FIFO purchase cost. Enter a reason to authorize the loss.");
      } else {
        setError(`Could not complete the sale. ${text}`);
      }
    } finally {
      setIsCheckingOut(false);
    }
  }

  if (!canUse) {
    return (
      <div className="mx-auto max-w-7xl space-y-6">
        <PageHeader eyebrow="Sales" title="Point of Sale" description="Find products, take payment and save sales." />
        <Card><CardContent className="py-6 text-sm text-muted-foreground">You do not have permission to use Point of Sale.</CardContent></Card>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <PageHeader
        eyebrow="Sales"
        title="Point of Sale"
        description="Find products, take payment and save sales with stock movements."
      />
      {error ? <div role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">{error}</div> : null}
      <div className="grid gap-6 xl:grid-cols-[minmax(18rem,0.8fr)_minmax(22rem,1.2fr)]">
        <Card>
          <CardHeader>
            <CardTitle>Products</CardTitle>
            <CardDescription>Branch stock available for this sale.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-1">
              <div className="space-y-2">
                <Label htmlFor="pos-branch">Branch</Label>
                <SelectField id="pos-branch" value={branchId} onChange={(event) => { const selectedBranchId = event.target.value; setPaymentAccountsLoadingForBranch(selectedBranchId); setBranchId(selectedBranchId); setCustomerId(""); setCustomers([]); setCart([]); setPaymentAccounts([]); setPaymentLines((current) => current.map((line) => ({ ...line, cashAccountId: "" }))); }} disabled={user.role === "manager"}>
                  {branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}
                </SelectField>
              </div>
              <div className="space-y-2">
                <Label htmlFor="pos-search">Search</Label>
                <div className="relative"><Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" /><Input id="pos-search" className="pl-9" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Name, SKU or barcode" /></div>
              </div>
            </div>
            {isLoading ? (
              <div className="flex items-center gap-2 py-4 text-sm text-muted-foreground"><LoaderCircle className="size-4 animate-spin" />Loading POS...</div>
            ) : products.length === 0 ? (
              <p className="py-4 text-sm text-muted-foreground">No active products match this search.</p>
            ) : (
              <ul className="max-h-[32rem] divide-y overflow-y-auto">
                {products.map((product) => (
                  <li key={product.id} className="flex items-center justify-between gap-3 py-3 first:pt-0">
                    <div className="min-w-0"><p className="font-medium">{product.name}</p><p className="text-xs text-muted-foreground">{product.sku} · {formatQuantity(product.quantity_on_hand)} {product.base_unit_name} · {formatMoney(product.selling_price)}</p></div>
                    <Button type="button" size="sm" variant="outline" disabled={product.quantity_on_hand <= 0} onClick={() => addToCart(product)}><Plus />Add</Button>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Cart</CardTitle>
            <CardDescription>{cart.length} {cart.length === 1 ? "item" : "items"} · {formatMoney(cartTotal)}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {cart.length === 0 ? (
              <div className="flex items-center gap-3 py-8 text-sm text-muted-foreground"><ShoppingCart className="size-5" />Add products to begin a sale.</div>
            ) : (
              cart.map((item) => (
                <div key={item.product.id} className="rounded-lg border p-3">
                  <div className="mb-3 flex items-start justify-between gap-3">
                    <div><p className="font-medium">{item.product.name}</p><p className="text-xs text-muted-foreground">{item.product.sku} · Listed {formatMoney(item.product.selling_price)}</p></div>
                    <Button type="button" variant="ghost" size="sm" onClick={() => setCart((current) => current.filter((cartItem) => cartItem.product.id !== item.product.id))}><Trash2 />Remove</Button>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-3">
                    <div className="space-y-1"><Label>Quantity</Label><Input inputMode="decimal" value={item.quantity} onChange={(event) => updateCart(item.product.id, { quantity: event.target.value })} /></div>
                    <div className="space-y-1"><Label>Selling price RWF</Label><Input inputMode="decimal" value={item.sellingPrice} onChange={(event) => updateCart(item.product.id, { sellingPrice: event.target.value })} /></div>
                    <div className="space-y-1"><Label>Line total</Label><p className="flex h-9 items-center text-sm font-medium">{lineTotal(item) === null ? "—" : formatMoney(lineTotal(item)!)}</p></div>
                  </div>
                  {parseMoney(item.sellingPrice) !== BigInt(item.product.selling_price) || item.belowCostReasonRequired ? (
                    <div className="mt-3 space-y-1"><Label>Price change or below-cost reason</Label><Input maxLength={500} value={item.priceChangeReason} onChange={(event) => updateCart(item.product.id, { priceChangeReason: event.target.value })} /></div>
                  ) : null}
                </div>
              ))
            )}

            <div className="space-y-2 border-t pt-4">
              <Label htmlFor="pos-customer">Customer for credit</Label>
              <SelectField id="pos-customer" value={customerId} onChange={(event) => setCustomerId(event.target.value)}>
                <option value="">Walk-in customer / paid in full</option>
                {customers.map((customer) => <option key={customer.id} value={customer.id}>{customer.name}</option>)}
              </SelectField>
            </div>

            {paymentLines.map((line, index) => {
              const eligibleAccounts = paymentAccountsForMethod(paymentAccounts, line.method);
              return (
                <div key={line.id} className="grid gap-3 rounded-lg border p-3 sm:grid-cols-[1fr_1fr_1fr_auto]">
                  <div className="space-y-1">
                    <Label htmlFor={`pos-payment-method-${line.id}`}>Payment method</Label>
                    <SelectField
                      id={`pos-payment-method-${line.id}`}
                      value={line.method}
                      onChange={(event) => {
                        const method = event.target.value as PaymentMethod;
                        const accounts = paymentAccountsForMethod(paymentAccounts, method);
                        setPaymentLines((current) => current.map((item) => item.id === line.id
                          ? { ...item, method, cashAccountId: accounts.length === 1 ? accounts[0].id : "" }
                          : item));
                      }}
                    >
                      <option value="cash">Cash</option>
                      <option value="mtn_mobile_money">MTN Mobile Money</option>
                      <option value="airtel_money">Airtel Money</option>
                      <option value="bank_transfer">Bank transfer</option>
                    </SelectField>
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor={`pos-payment-account-${line.id}`}>Receive into account</Label>
                    <SelectField
                      id={`pos-payment-account-${line.id}`}
                      value={line.cashAccountId}
                      disabled={isLoadingPaymentAccounts || eligibleAccounts.length === 0}
                      onChange={(event) => setPaymentLines((current) => current.map((item) => item.id === line.id
                        ? { ...item, cashAccountId: event.target.value }
                        : item))}
                    >
                      <option value="">
                        {isLoadingPaymentAccounts ? "Loading accounts..." :
                          eligibleAccounts.length === 0 ? "No active, opened account" : "Select an account"}
                      </option>
                      {eligibleAccounts.map((account) => (
                        <option key={account.id} value={account.id}>{account.name}</option>
                      ))}
                    </SelectField>
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor={`pos-payment-amount-${line.id}`}>Amount RWF</Label>
                    <Input
                      id={`pos-payment-amount-${line.id}`}
                      inputMode="decimal"
                      value={line.amount}
                      onChange={(event) => setPaymentLines((current) => current.map((item) => item.id === line.id
                        ? { ...item, amount: event.target.value }
                        : item))}
                      placeholder={index === 0 ? "Blank = full payment" : ""}
                    />
                  </div>
                  {paymentLines.length > 1 ? (
                    <Button type="button" variant="ghost" className="self-end" onClick={() => setPaymentLines((current) => current.filter((item) => item.id !== line.id))}>
                      <Trash2 />Remove
                    </Button>
                  ) : null}
                </div>
              );
            })}
            <div className="flex flex-wrap items-center justify-between gap-3">
              <Button type="button" variant="outline" onClick={addPaymentLine}><Plus />Split payment</Button>
              <div className="text-right"><p className="text-sm text-muted-foreground">Cart total</p><p className="text-xl font-semibold">{formatMoney(cartTotal)}</p></div>
            </div>
            <Button type="button" className="w-full" disabled={isCheckingOut || isLoadingPaymentAccounts || cart.length === 0 || hasInvalidCart} onClick={() => void handleCheckout()}>
              {isCheckingOut ? <LoaderCircle className="animate-spin" /> : <Badge variant="secondary">Pay</Badge>}
              {isCheckingOut ? "Completing sale..." : "Complete sale"}
            </Button>
          </CardContent>
        </Card>
      </div>

      <Dialog open={completedSale !== null} onOpenChange={(open) => !open && setCompletedSale(null)}>
        <DialogContent size="wide">
          {completedSale ? (
            <>
              <DialogHeader><DialogTitle>Sale receipt · {completedSale.transaction_number}</DialogTitle><DialogDescription>{completedSale.customer_name ?? "Walk-in customer"} · {completedSale.payment_method}</DialogDescription></DialogHeader>
              <div className="grid gap-4 sm:grid-cols-3"><Card><CardHeader className="pb-2"><CardDescription>Total</CardDescription><CardTitle>{formatMoney(completedSale.total)}</CardTitle></CardHeader></Card><Card><CardHeader className="pb-2"><CardDescription>Paid</CardDescription><CardTitle>{formatMoney(completedSale.amount_paid)}</CardTitle></CardHeader></Card><Card><CardHeader className="pb-2"><CardDescription>Credit due</CardDescription><CardTitle>{formatMoney(completedSale.balance_due)}</CardTitle></CardHeader></Card></div>
              <ul className="divide-y rounded-lg border">{completedSale.items.map((item) => <li key={`${item.sku}-${item.product_name}`} className="flex justify-between gap-3 px-3 py-3 text-sm"><div><p className="font-medium">{item.product_name}</p><p className="text-xs text-muted-foreground">{formatQuantity(item.quantity)} {item.unit_name} · {formatMoney(item.unit_price)}</p></div><p className="font-medium">{formatMoney(item.line_total)}</p></li>)}</ul>
            </>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}
