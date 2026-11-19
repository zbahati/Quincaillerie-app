"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import { AlertTriangle, CreditCard, History, LoaderCircle, PackagePlus, ReceiptText, Truck } from "lucide-react";
import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PageHeader } from "@/components/shared/page-header";
import { SelectField } from "@/components/shared/select-field";
import { useAuthentication } from "@/modules/auth/auth-gate";
import { suppliersApi, type Supplier } from "@/lib/api/relationships-api";
import {
  purchasesApi,
  type Purchase,
  type PurchaseBranch,
  type PurchasePaymentOption,
  type PurchaseProduct,
} from "@/lib/api/purchases-api";

const QUANTITY_SCALE = 1000n;
const MONEY_SCALE = 100n;
const MAX_SAFE_INTEGER = BigInt(Number.MAX_SAFE_INTEGER);
const PAYMENT_METHODS: { value: Purchase["payments"][number]["payment_method"]; label: string }[] = [
  { value: "cash", label: "Cash" },
  { value: "mtn_mobile_money", label: "MTN Mobile Money" },
  { value: "airtel_money", label: "Airtel Money" },
  { value: "bank_transfer", label: "Bank transfer" },
];

interface DraftLine {
  productId: string;
  quantity: string;
  unitCost: string;
}

function parseQuantity(value: string, decimals: boolean): number | null {
  if (!decimals ? !/^\d+$/.test(value) : !/^\d+(?:\.\d{1,3})?$/.test(value)) return null;
  const [whole, fraction = ""] = value.split(".");
  const scaled = BigInt(whole) * QUANTITY_SCALE + BigInt(fraction.padEnd(3, "0") || "0");
  return scaled > 0n && scaled <= MAX_SAFE_INTEGER ? Number(scaled) : null;
}

function parseUnitCost(value: string): number | null {
  if (!/^\d+$/.test(value)) return null;
  const scaled = BigInt(value) * MONEY_SCALE;
  return scaled <= MAX_SAFE_INTEGER ? Number(scaled) : null;
}

function parsePaymentAmount(value: string): number | null {
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(value);
  if (!match) return null;
  const fraction = (match[2] ?? "").padEnd(2, "0");
  const amount = BigInt(match[1]) * MONEY_SCALE + BigInt(fraction || "0");
  return amount > 0n && amount <= MAX_SAFE_INTEGER ? Number(amount) : null;
}

function moneyInputValue(value: number): string {
  const amount = BigInt(value);
  return `${amount / MONEY_SCALE}.${(amount % MONEY_SCALE).toString().padStart(2, "0")}`;
}

function formatQuantity(value: number): string {
  const quantity = BigInt(value);
  const whole = quantity / QUANTITY_SCALE;
  const fraction = quantity % QUANTITY_SCALE;
  return fraction === 0n
    ? new Intl.NumberFormat("en-RW").format(whole)
    : `${new Intl.NumberFormat("en-RW").format(whole)}.${fraction.toString().padStart(3, "0").replace(/0+$/, "")}`;
}

function formatMoney(value: number): string {
  if (!Number.isSafeInteger(value) || value < 0) return "Invalid amount";
  const amount = BigInt(value);
  const whole = amount / MONEY_SCALE;
  const fraction = amount % MONEY_SCALE;
  return `${new Intl.NumberFormat("en-RW").format(whole)}${fraction === 0n ? "" : `.${fraction.toString().padStart(2, "0")}`} RWF`;
}

function lineTotal(quantity: string, unitCost: string, decimals: boolean): bigint | null {
  const scaledQuantity = parseQuantity(quantity, decimals);
  const scaledUnitCost = parseUnitCost(unitCost);
  if (scaledQuantity === null || scaledUnitCost === null) return null;
  return (BigInt(scaledQuantity) * BigInt(scaledUnitCost) + 500n) / QUANTITY_SCALE;
}

function statusLabel(status: Purchase["status"]): string {
  if (status === "received") return "Fully received";
  if (status === "partially_received") return "Partially received";
  return "Awaiting delivery";
}

function paymentMethodLabel(method: Purchase["payments"][number]["payment_method"]): string {
  return PAYMENT_METHODS.find((item) => item.value === method)?.label ?? method;
}

function accountsForPaymentMethod(
  accounts: PurchasePaymentOption[],
  method: Purchase["payments"][number]["payment_method"],
): PurchasePaymentOption[] {
  const accountType =
    method === "cash" ? "cash_drawer"
      : method === "bank_transfer" ? "bank"
        : method === "mtn_mobile_money" ? "mtn_wallet"
          : "airtel_wallet";
  return accounts.filter((account) => account.account_type === accountType);
}

function errorText(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

export function PurchasesPage() {
  const { user, permissions } = useAuthentication();
  const canRead = user.role === "admin" || permissions.includes("purchases.read");
  const canManage = user.role === "admin" || permissions.includes("purchases.manage");
  const [branches, setBranches] = useState<PurchaseBranch[]>([]);
  const [branchId, setBranchId] = useState(user.role === "manager" ? user.branch_id ?? "" : "");
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [products, setProducts] = useState<PurchaseProduct[]>([]);
  const [purchases, setPurchases] = useState<Purchase[]>([]);
  const [paymentOptionsState, setPaymentOptionsState] = useState<{
    branchId: string;
    accounts: PurchasePaymentOption[];
  } | null>(null);
  const [supplierId, setSupplierId] = useState("");
  const [invoiceNumber, setInvoiceNumber] = useState("");
  const [draftLines, setDraftLines] = useState<DraftLine[]>([]);
  const [draftProductId, setDraftProductId] = useState("");
  const [duplicateWarning, setDuplicateWarning] = useState<string | null>(null);
  const [authorizeDuplicate, setAuthorizeDuplicate] = useState(false);
  const [expandedPurchaseId, setExpandedPurchaseId] = useState<string | null>(null);
  const [deliveryReference, setDeliveryReference] = useState("");
  const [deliveryNotes, setDeliveryNotes] = useState("");
  const [receiptDraft, setReceiptDraft] = useState<Record<string, string>>({});
  const [paymentAmounts, setPaymentAmounts] = useState<Record<string, string>>({});
  const [paymentMethods, setPaymentMethods] = useState<Record<string, Purchase["payments"][number]["payment_method"]>>({});
  const [paymentAccountIds, setPaymentAccountIds] = useState<Record<string, string>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [payingPurchaseId, setPayingPurchaseId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const canReadPaymentAccounts = user.role === "admin" || permissions.includes("cash_accounts.balance.read");
  const cashAccounts = paymentOptionsState?.branchId === branchId ? paymentOptionsState.accounts : [];
  const isLoadingCashAccounts = Boolean(
    branchId && canManage && canReadPaymentAccounts && paymentOptionsState?.branchId !== branchId,
  );

  useEffect(() => {
    let active = true;
    Promise.all([purchasesApi.branches(), suppliersApi.list(), purchasesApi.products()])
      .then(([branchResult, supplierResult, productResult]) => {
        if (!active) return;
        setBranches(branchResult);
        setSuppliers(supplierResult.filter((supplier) => supplier.is_active));
        setProducts(productResult);
        setBranchId((current) =>
          branchResult.some((branch) => branch.id === current)
            ? current
            : (branchResult[0]?.id ?? ""),
        );
      })
      .catch((cause) => {
        if (active) setError(`Could not load purchasing data. ${errorText(cause)}`);
      })
      .finally(() => {
        if (active) setIsLoading(false);
      });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!branchId || !canRead) return;
    let active = true;
    purchasesApi.list(branchId)
      .then((result) => { if (active) setPurchases(result); })
      .catch((cause) => { if (active) setError(`Could not load purchases. ${errorText(cause)}`); });
    return () => { active = false; };
  }, [branchId, canRead]);

  useEffect(() => {
    if (!branchId || !canManage || !canReadPaymentAccounts) return;
    let active = true;
    purchasesApi.paymentOptions(branchId)
      .then((result) => { if (active) setPaymentOptionsState({ branchId, accounts: result }); })
      .catch((cause) => {
        if (active) {
          setPaymentOptionsState({ branchId, accounts: [] });
          setError(`Could not load supplier payment accounts. ${errorText(cause)}`);
        }
      });
    return () => { active = false; };
  }, [branchId, canManage, canReadPaymentAccounts]);

  const draftTotal = useMemo(() => draftLines.reduce((sum, line) => {
    const product = products.find((item) => item.id === line.productId);
    const total = product ? lineTotal(line.quantity, line.unitCost, product.base_unit_allows_decimals) : null;
    return total === null ? sum : sum + total;
  }, 0n), [draftLines, products]);

  const validDraft = draftLines.length > 0 && draftLines.every((line) => {
    const product = products.find((item) => item.id === line.productId);
    return Boolean(product && parseQuantity(line.quantity, product.base_unit_allows_decimals) !== null &&
      parseUnitCost(line.unitCost) !== null);
  });

  function addDraftLine() {
    const product = products.find((item) => item.id === draftProductId);
    if (!product || draftLines.some((line) => line.productId === product.id)) return;
    setDraftLines((current) => [...current, {
      productId: product.id,
      quantity: "",
      unitCost: String(Math.floor(product.purchase_price / 100)),
    }]);
  }

  async function handleCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!branchId || !supplierId || !invoiceNumber.trim() || !validDraft || isSaving) return;
    setError(null);
    setDuplicateWarning(null);
    setIsSaving(true);
    try {
      const purchase = await purchasesApi.create({
        branchId,
        supplierId,
        supplierInvoiceNumber: invoiceNumber.trim(),
        authorizeDuplicate,
        items: draftLines.map((line) => {
          const product = products.find((item) => item.id === line.productId);
          if (!product) throw new Error("A selected product is unavailable.");
          const quantity = parseQuantity(line.quantity, product.base_unit_allows_decimals);
          const unitCost = parseUnitCost(line.unitCost);
          if (quantity === null || unitCost === null) throw new Error("A purchase line is invalid.");
          return { productId: line.productId, orderedQuantity: quantity, unitCost };
        }),
      });
      setPurchases((current) => [purchase, ...current]);
      setSupplierId("");
      setInvoiceNumber("");
      setDraftLines([]);
      setAuthorizeDuplicate(false);
    } catch (cause) {
      const text = errorText(cause);
      if (text.toLowerCase().includes("duplicate")) {
        setDuplicateWarning("This supplier already has a purchase with that invoice number. Confirm only if this is genuinely a separate duplicate invoice.");
      } else {
        setError(`Could not create purchase. ${text}`);
      }
    } finally {
      setIsSaving(false);
    }
  }

  async function receivePurchase(purchase: Purchase) {
    if (!branchId || isSaving) return;
    const items = purchase.items
      .filter((item) => item.received_quantity < item.ordered_quantity)
      .map((item) => ({ purchaseItemId: item.id, quantity: parseQuantity(receiptDraft[item.id] ?? "", item.base_unit_allows_decimals) }))
      .filter((item): item is { purchaseItemId: string; quantity: number } => item.quantity !== null);
    if (items.length === 0) {
      setError("Enter at least one remaining quantity to receive.");
      return;
    }
    setError(null);
    setIsSaving(true);
    try {
      await purchasesApi.receive(purchase.id, {
        branchId,
        deliveryReference: deliveryReference.trim() || null,
        notes: deliveryNotes.trim() || null,
        items,
      });
      const updated = await purchasesApi.list(branchId);
      setPurchases(updated);
      setExpandedPurchaseId(null);
      setDeliveryReference("");
      setDeliveryNotes("");
      setReceiptDraft({});
    } catch (cause) {
      setError(`Could not receive delivery. ${errorText(cause)}`);
    } finally {
      setIsSaving(false);
    }
  }

  async function handleRecordPayment(event: FormEvent<HTMLFormElement>, purchase: Purchase) {
    event.preventDefault();
    if (!branchId || payingPurchaseId) return;
    const amount = parsePaymentAmount(paymentAmounts[purchase.id]?.trim() ?? "");
    if (amount === null || amount > purchase.balance_due) {
      setError(`Enter a valid payment up to ${formatMoney(purchase.balance_due)}.`);
      return;
    }
    const paymentMethod = paymentMethods[purchase.id] ?? "cash";
    const accounts = accountsForPaymentMethod(cashAccounts, paymentMethod);
    const accountId = accounts.some((account) => account.id === paymentAccountIds[purchase.id])
      ? paymentAccountIds[purchase.id]
      : accounts[0]?.id;
    if (!accountId) {
      setError("Ask the Owner/Admin to set up an account and authorize its opening balance before paying this supplier.");
      return;
    }

    setError(null);
    setPayingPurchaseId(purchase.id);
    try {
      await purchasesApi.recordPayment(purchase.id, {
        branchId,
        amount,
        paymentMethod,
        cashAccountId: accountId,
      });
      setPaymentAmounts((current) => ({ ...current, [purchase.id]: "" }));
      try {
        setPurchases(await purchasesApi.list(branchId));
      } catch (cause) {
        setError(`Supplier payment was recorded, but purchase balances could not be refreshed. ${errorText(cause)}`);
      }
      try {
        setPaymentOptionsState({
          branchId,
          accounts: await purchasesApi.paymentOptions(branchId),
        });
      } catch (cause) {
        setPaymentOptionsState({ branchId, accounts: [] });
        setError(`Supplier payment was recorded, but account balances could not be refreshed. ${errorText(cause)}`);
      }
    } catch (cause) {
      setError(`Could not record the supplier payment. ${errorText(cause)}`);
    } finally {
      setPayingPurchaseId(null);
    }
  }

  if (!canRead) {
    return (
      <div className="mx-auto max-w-7xl space-y-6">
        <PageHeader eyebrow="Purchasing" title="Purchases" description="Create supplier invoices and receive deliveries." />
        <Card><CardContent className="py-6 text-sm text-muted-foreground">You do not have permission to view purchases.</CardContent></Card>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <PageHeader
        eyebrow="Purchasing"
        title="Purchases"
        description="Create supplier invoices and receive partial or complete deliveries."
        actions={
          <Link href="/purchase-history" className="inline-flex">
            <Button variant="outline"><History />Purchase history</Button>
          </Link>
        }
      />

      {error ? <div role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">{error}</div> : null}

      <div className="grid gap-6 xl:grid-cols-[minmax(22rem,0.85fr)_minmax(0,1.15fr)]">
        {canManage ? (
          <Card>
            <CardHeader>
              <CardTitle>New purchase</CardTitle>
              <CardDescription>Record a supplier invoice before receiving stock.</CardDescription>
            </CardHeader>
            <CardContent>
              {isLoading ? (
                <div className="flex items-center gap-2 py-4 text-sm text-muted-foreground"><LoaderCircle className="size-4 animate-spin" />Loading purchasing data...</div>
              ) : (
                <form className="space-y-5" onSubmit={handleCreate}>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="space-y-2">
                      <Label htmlFor="purchase-branch">Branch</Label>
                      <SelectField id="purchase-branch" value={branchId} onChange={(event) => setBranchId(event.target.value)} disabled={user.role === "manager"}>
                        {branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}
                      </SelectField>
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="purchase-supplier">Supplier</Label>
                      <SelectField id="purchase-supplier" value={supplierId} onChange={(event) => setSupplierId(event.target.value)} required>
                        <option value="">Select supplier</option>
                        {suppliers.map((supplier) => <option key={supplier.id} value={supplier.id}>{supplier.name}</option>)}
                      </SelectField>
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="purchase-invoice">Supplier invoice number</Label>
                    <Input id="purchase-invoice" maxLength={200} required value={invoiceNumber} onChange={(event) => { setInvoiceNumber(event.target.value); setDuplicateWarning(null); setAuthorizeDuplicate(false); }} />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="draft-product">Add product</Label>
                    <div className="flex gap-2">
                      <SelectField id="draft-product" value={draftProductId} onChange={(event) => setDraftProductId(event.target.value)}>
                        <option value="">Select product</option>
                        {products.filter((product) => !draftLines.some((line) => line.productId === product.id)).map((product) => (
                          <option key={product.id} value={product.id}>{product.name} · {product.sku}</option>
                        ))}
                      </SelectField>
                      <Button type="button" variant="outline" onClick={addDraftLine} disabled={!draftProductId}><PackagePlus />Add</Button>
                    </div>
                  </div>
                  {draftLines.map((line, index) => {
                    const product = products.find((item) => item.id === line.productId);
                    if (!product) return null;
                    const total = lineTotal(line.quantity, line.unitCost, product.base_unit_allows_decimals);
                    return (
                      <div key={line.productId} className="rounded-lg border p-3">
                        <div className="mb-3 flex items-start justify-between gap-3">
                          <div><p className="font-medium">{product.name}</p><p className="text-xs text-muted-foreground">{product.sku} · {product.base_unit_name}</p></div>
                          <Button type="button" variant="ghost" size="sm" onClick={() => setDraftLines((current) => current.filter((item) => item.productId !== line.productId))}>Remove</Button>
                        </div>
                        <div className="grid gap-3 sm:grid-cols-3">
                          <div className="space-y-1"><Label htmlFor={`quantity-${index}`}>Quantity</Label><Input id={`quantity-${index}`} inputMode="decimal" value={line.quantity} onChange={(event) => setDraftLines((current) => current.map((item) => item.productId === line.productId ? { ...item, quantity: event.target.value } : item))} /></div>
                          <div className="space-y-1"><Label htmlFor={`cost-${index}`}>Unit cost RWF</Label><Input id={`cost-${index}`} inputMode="decimal" value={line.unitCost} onChange={(event) => setDraftLines((current) => current.map((item) => item.productId === line.productId ? { ...item, unitCost: event.target.value } : item))} /></div>
                          <div className="space-y-1"><Label>Line total</Label><p className="flex h-9 items-center text-sm font-medium">{total === null ? "—" : `${formatMoney(Number(total))}`}</p></div>
                        </div>
                      </div>
                    );
                  })}
                  {duplicateWarning ? (
                    <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
                      <div className="flex gap-2"><AlertTriangle className="size-4 shrink-0" /><p>{duplicateWarning}</p></div>
                      <label className="mt-3 flex items-center gap-2">
                        <input type="checkbox" checked={authorizeDuplicate} onChange={(event) => setAuthorizeDuplicate(event.target.checked)} />
                        I confirm this duplicate invoice is intentional.
                      </label>
                    </div>
                  ) : null}
                  <div className="flex items-center justify-between border-t pt-4">
                    <p className="text-sm text-muted-foreground">Subtotal</p>
                    <p className="text-lg font-semibold">{formatMoney(Number(draftTotal))}</p>
                  </div>
                  <Button type="submit" disabled={isSaving || !branchId || !supplierId || !invoiceNumber.trim() || !validDraft || (duplicateWarning !== null && !authorizeDuplicate)}>
                    {isSaving ? <LoaderCircle className="animate-spin" /> : <ReceiptText />}
                    {isSaving ? "Saving..." : "Save purchase"}
                  </Button>
                </form>
              )}
            </CardContent>
          </Card>
        ) : null}

        <Card>
          <CardHeader>
            <CardTitle>Open purchases</CardTitle>
            <CardDescription>Invoices and deliveries for the selected branch.</CardDescription>
          </CardHeader>
          <CardContent>
            {purchases.length === 0 ? (
              <p className="py-6 text-sm text-muted-foreground">No purchases have been recorded for this branch.</p>
            ) : (
              <ul className="divide-y">
                {purchases.map((purchase) => (
                  <li key={purchase.id} className="py-4 first:pt-0">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <h2 className="font-medium">{purchase.supplier_name}</h2>
                          <Badge variant={purchase.status === "received" ? "secondary" : "outline"}>{statusLabel(purchase.status)}</Badge>
                          {purchase.duplicate_authorized ? <Badge variant="outline">Authorized duplicate</Badge> : null}
                        </div>
                        <p className="text-sm text-muted-foreground">Invoice: {purchase.supplier_invoice_number}</p>
                        <p className="text-sm text-muted-foreground">Total: {formatMoney(purchase.subtotal)}</p>
                        <p className="text-sm text-muted-foreground">Paid: {formatMoney(purchase.amount_paid)} · Balance due: {formatMoney(purchase.balance_due)}</p>
                        {purchase.duplicate_of_purchase_id ? <p className="text-xs text-muted-foreground">Duplicate of an existing supplier invoice</p> : null}
                      </div>
                      {canManage && purchase.status !== "received" ? (
                        <Button type="button" variant="outline" size="sm" onClick={() => setExpandedPurchaseId((current) => current === purchase.id ? null : purchase.id)}>
                          <Truck />Receive
                        </Button>
                      ) : null}
                    </div>
                    {purchase.balance_due > 0 && canManage ? (
                      canReadPaymentAccounts ? (
                        <form
                          className="mt-4 grid gap-3 rounded-lg border p-3 sm:grid-cols-2 xl:grid-cols-[1fr_1fr_1fr_auto]"
                          onSubmit={(event) => void handleRecordPayment(event, purchase)}
                        >
                          <div className="space-y-1">
                            <Label htmlFor={`payment-amount-${purchase.id}`}>Payment amount (RWF)</Label>
                            <Input
                              id={`payment-amount-${purchase.id}`}
                              type="number"
                              min="0.01"
                              max={moneyInputValue(purchase.balance_due)}
                              step="0.01"
                              value={paymentAmounts[purchase.id] ?? ""}
                              onChange={(event) => setPaymentAmounts((current) => ({
                                ...current,
                                [purchase.id]: event.target.value,
                              }))}
                            />
                          </div>
                          <div className="space-y-1">
                            <Label htmlFor={`payment-method-${purchase.id}`}>Payment method</Label>
                            <SelectField
                              id={`payment-method-${purchase.id}`}
                              value={paymentMethods[purchase.id] ?? "cash"}
                              onChange={(event) => {
                                const method = PAYMENT_METHODS.find((item) => item.value === event.target.value)?.value;
                                if (method) {
                                  setPaymentMethods((current) => ({ ...current, [purchase.id]: method }));
                                  setPaymentAccountIds((current) => ({
                                    ...current,
                                    [purchase.id]: accountsForPaymentMethod(cashAccounts, method)[0]?.id ?? "",
                                  }));
                                }
                              }}
                            >
                              {PAYMENT_METHODS.map((method) => (
                                <option key={method.value} value={method.value}>{method.label}</option>
                              ))}
                            </SelectField>
                          </div>
                          <div className="space-y-1">
                            <Label htmlFor={`payment-account-${purchase.id}`}>Pay from account</Label>
                            <SelectField
                              id={`payment-account-${purchase.id}`}
                              value={(() => {
                                const options = accountsForPaymentMethod(
                                  cashAccounts,
                                  paymentMethods[purchase.id] ?? "cash",
                                );
                                return options.some((account) => account.id === paymentAccountIds[purchase.id])
                                  ? paymentAccountIds[purchase.id]
                                  : options[0]?.id ?? "";
                              })()}
                              disabled={isLoadingCashAccounts}
                              onChange={(event) => setPaymentAccountIds((current) => ({
                                ...current,
                                [purchase.id]: event.target.value,
                              }))}
                            >
                              <option value="">Select opened account</option>
                              {accountsForPaymentMethod(
                                cashAccounts,
                                paymentMethods[purchase.id] ?? "cash",
                              ).map((account) => (
                                <option key={account.id} value={account.id}>
                                  {account.name} · Available {formatMoney(account.available_balance)}
                                </option>
                              ))}
                            </SelectField>
                            {accountsForPaymentMethod(
                              cashAccounts,
                              paymentMethods[purchase.id] ?? "cash",
                            ).length === 0 ? (
                              <p className="text-xs text-amber-700">
                                An authorized opening balance is required before payment.
                              </p>
                            ) : null}
                          </div>
                          <Button
                            type="submit"
                            className="self-end"
                            disabled={payingPurchaseId !== null || isLoadingCashAccounts || accountsForPaymentMethod(
                              cashAccounts,
                              paymentMethods[purchase.id] ?? "cash",
                            ).length === 0}
                          >
                            {payingPurchaseId === purchase.id
                              ? <LoaderCircle className="animate-spin" />
                              : <CreditCard />}
                            {payingPurchaseId === purchase.id ? "Recording..." : "Record payment"}
                          </Button>
                        </form>
                      ) : (
                        <p className="mt-3 text-sm text-amber-700">
                          You need permission to view cash-account balances before recording a supplier payment.
                        </p>
                      )
                    ) : purchase.balance_due === 0 ? (
                      <Badge className="mt-3" variant="secondary">Invoice fully paid</Badge>
                    ) : null}
                    {purchase.payments.length > 0 ? (
                      <div className="mt-4 space-y-2">
                        <h3 className="text-sm font-medium">Payment history</h3>
                        <ul className="divide-y rounded-lg border px-3">
                          {purchase.payments.map((payment) => (
                            <li key={payment.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                              <span>{paymentMethodLabel(payment.payment_method)} · {new Date(payment.created_at).toLocaleString()}</span>
                              <span className="font-medium">{formatMoney(payment.amount)}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    ) : null}
                    {expandedPurchaseId === purchase.id ? (
                      <div className="mt-4 rounded-lg border p-3">
                        <div className="grid gap-3 sm:grid-cols-2">
                          <div className="space-y-1"><Label htmlFor="delivery-reference">Delivery reference</Label><Input id="delivery-reference" maxLength={200} value={deliveryReference} onChange={(event) => setDeliveryReference(event.target.value)} /></div>
                          <div className="space-y-1"><Label htmlFor="delivery-notes">Notes</Label><Input id="delivery-notes" maxLength={500} value={deliveryNotes} onChange={(event) => setDeliveryNotes(event.target.value)} /></div>
                        </div>
                        <div className="mt-3 space-y-2">
                          {purchase.items.filter((item) => item.received_quantity < item.ordered_quantity).map((item) => (
                            <div key={item.id} className="grid gap-2 rounded-md bg-muted/40 p-3 sm:grid-cols-[1fr_12rem]">
                              <div><p className="text-sm font-medium">{item.product_name}</p><p className="text-xs text-muted-foreground">Remaining: {formatQuantity(item.ordered_quantity - item.received_quantity)} {item.unit_name}</p></div>
                              <Input aria-label={`Receive ${item.product_name}`} inputMode="decimal" placeholder="Quantity" value={receiptDraft[item.id] ?? ""} onChange={(event) => setReceiptDraft((current) => ({ ...current, [item.id]: event.target.value }))} />
                            </div>
                          ))}
                        </div>
                        <Button className="mt-3" type="button" disabled={isSaving} onClick={() => void receivePurchase(purchase)}>
                          {isSaving ? <LoaderCircle className="animate-spin" /> : <Truck />}
                          Record delivery
                        </Button>
                      </div>
                    ) : null}
                    {purchase.deliveries.length > 0 ? (
                      <div className="mt-3 text-xs text-muted-foreground">
                        {purchase.deliveries.length} {purchase.deliveries.length === 1 ? "delivery" : "deliveries"} recorded
                      </div>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
