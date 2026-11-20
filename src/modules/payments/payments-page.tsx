"use client";

import { useEffect, useState, type FormEvent } from "react";
import { LoaderCircle, Wallet } from "lucide-react";

import {
  customerDebtApi,
  type CustomerDebt,
  type CustomerDebtPaymentAccount,
} from "@/lib/api/customer-debt-api";
import { inventoryApi, type InventoryBranch } from "@/lib/api/inventory-api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PageHeader } from "@/components/shared/page-header";
import { SelectField } from "@/components/shared/select-field";
import { useAuthentication } from "@/modules/auth/auth-gate";

type PaymentMethod = "cash" | "mtn_mobile_money" | "airtel_money" | "bank_transfer";

function parseMoney(value: string): number | null {
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(value.trim());
  if (!match) return null;
  const scaled = BigInt(match[1]) * 100n + BigInt((match[2] ?? "").padEnd(2, "0"));
  return scaled <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(scaled) : null;
}

function formatMoney(value: number): string {
  if (!Number.isSafeInteger(value) || value < 0) return "Invalid amount";
  const amount = BigInt(value);
  const whole = amount / 100n;
  const fraction = amount % 100n;
  return `${new Intl.NumberFormat("en-RW").format(Number(whole))}${fraction === 0n ? "" : `.${fraction.toString().padStart(2, "0")}`} RWF`;
}

function accountsForPaymentMethod(
  accounts: CustomerDebtPaymentAccount[],
  method: PaymentMethod,
): CustomerDebtPaymentAccount[] {
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

export function PaymentsPage() {
  const { user, permissions } = useAuthentication();
  const canRead = user.role === "admin" || permissions.includes("customer_debts.read");
  const canManage = user.role === "admin" || permissions.includes("customer_payments.manage");
  const [branches, setBranches] = useState<InventoryBranch[]>([]);
  const [branchScope, setBranchScope] = useState(user.role === "manager" ? user.branch_id ?? "" : "");
  const [debts, setDebts] = useState<CustomerDebt[]>([]);
  const [paymentAccounts, setPaymentAccounts] = useState<CustomerDebtPaymentAccount[]>([]);
  const [selectedDebtId, setSelectedDebtId] = useState("");
  const [cashAccountId, setCashAccountId] = useState("");
  const [amount, setAmount] = useState("");
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("cash");
  const [isLoading, setIsLoading] = useState(user.role !== "manager" || Boolean(user.branch_id));
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (user.role !== "admin") return;
    let active = true;
    inventoryApi.branches()
      .then((result) => {
        if (!active) return;
        const activeBranches = result.filter((branch) => branch.is_active);
        setBranches(activeBranches);
        if (activeBranches.length === 0) setIsLoading(false);
        setBranchScope((current) =>
          activeBranches.some((branch) => branch.id === current)
            ? current
            : activeBranches[0]?.id ?? "",
        );
      })
      .catch((cause) => {
        if (active) setError(`Could not load customer debts. ${errorText(cause)}`);
      })
    return () => { active = false; };
  }, [user.role]);

  useEffect(() => {
    if (!canRead || !branchScope) {
      return;
    }
    let active = true;
    Promise.all([
      customerDebtApi.list(branchScope),
      canManage ? customerDebtApi.paymentAccounts(branchScope) : Promise.resolve([]),
    ])
      .then(([result, accounts]) => {
        if (!active) return;
        setDebts(result);
        setPaymentAccounts(accounts);
        setSelectedDebtId((current) =>
          result.some((debt) => debt.id === current && debt.balance_due > 0)
            ? current
            : (result.find((debt) => debt.balance_due > 0)?.id ?? ""),
        );
      })
      .catch((cause) => {
        if (active) setError(`Could not load customer debts. ${errorText(cause)}`);
      })
      .finally(() => {
        if (active) setIsLoading(false);
      });
    return () => { active = false; };
  }, [canManage, canRead, branchScope]);

  const selectedDebt = debts.find((debt) => debt.id === selectedDebtId);
  const outstandingTotal = debts.reduce((sum, debt) => sum + debt.balance_due, 0);
  const availablePaymentAccounts = accountsForPaymentMethod(paymentAccounts, paymentMethod);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canManage || !selectedDebt) return;
    const parsedAmount = parseMoney(amount);
    if (parsedAmount === null || parsedAmount <= 0) {
      setError("Enter a valid repayment amount greater than zero.");
      return;
    }
    if (parsedAmount > selectedDebt.balance_due) {
      setError("Repayment cannot exceed the selected outstanding balance.");
      return;
    }
    const selectedAccount = availablePaymentAccounts.find((account) => account.id === cashAccountId);
    if (!selectedAccount) {
      setError("Select an active, opened account matching the payment method.");
      return;
    }
    setError(null);
    setNotice(null);
    setIsSaving(true);
    try {
      const payment = await customerDebtApi.repay(selectedDebt.id, {
        branchId: selectedDebt.branch_id,
        paymentMethod,
        amount: parsedAmount,
        cashAccountId: selectedAccount.id,
      });
      setDebts((current) => current.map((debt) =>
        debt.id === selectedDebt.id
          ? {
              ...debt,
              amount_paid: debt.amount_paid + payment.amount,
              balance_due: payment.balance_due,
            }
          : debt,
      ));
      setAmount("");
      setNotice(`Recorded ${formatMoney(payment.amount)} repayment for ${payment.customer_name} into ${selectedAccount.name}.`);
    } catch (cause) {
      setError(`Could not record repayment. ${errorText(cause)}`);
    } finally {
      setIsSaving(false);
    }
  }

  if (!canRead) {
    return (
      <div className="mx-auto max-w-7xl space-y-6">
        <PageHeader eyebrow="Business" title="Customer payments" description="Record repayments against customer credit." />
        <Card><CardContent className="py-6 text-sm text-muted-foreground">You do not have permission to view customer debts.</CardContent></Card>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <PageHeader eyebrow="Business" title="Customer payments" description="Record repayments against customer credit balances." />
      {error ? <div role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">{error}</div> : null}
      {notice ? <div role="status" className="rounded-lg border border-border bg-muted/50 p-4 text-sm">{notice}</div> : null}
      {user.role === "admin" ? (
        <div className="max-w-sm space-y-2">
          <Label htmlFor="debt-branch">Branch</Label>
          <SelectField
            id="debt-branch"
            value={branchScope}
            onChange={(event) => {
              const nextBranchId = event.target.value;
              setBranchScope(nextBranchId);
              setDebts([]);
              setPaymentAccounts([]);
              setCashAccountId("");
              setIsLoading(Boolean(nextBranchId));
              setSelectedDebtId("");
              setError(null);
            }}
          >
            <option value="">Select a branch</option>
            {branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}
          </SelectField>
        </div>
      ) : null}
      <div className="grid gap-6 xl:grid-cols-[minmax(20rem,0.8fr)_minmax(0,1.2fr)]">
        {canManage ? (
          <Card>
            <CardHeader><CardTitle>Record repayment</CardTitle><CardDescription>Repayments reduce one selected credit sale.</CardDescription></CardHeader>
            <CardContent>
              {isLoading ? (
                <div className="flex items-center gap-2 py-4 text-sm text-muted-foreground"><LoaderCircle className="size-4 animate-spin" />Loading customer debts...</div>
              ) : (
                <form className="space-y-4" onSubmit={handleSubmit}>
                  <div className="space-y-2">
                    <Label htmlFor="debt-selection">Outstanding debt</Label>
                    <SelectField id="debt-selection" value={selectedDebtId} onChange={(event) => { setSelectedDebtId(event.target.value); setAmount(""); setNotice(null); }}>
                      <option value="">Select outstanding debt</option>
                      {debts.filter((debt) => debt.balance_due > 0).map((debt) => <option key={debt.id} value={debt.id}>{debt.customer_name} · {debt.transaction_number} · {formatMoney(debt.balance_due)}</option>)}
                    </SelectField>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="debt-payment-method">Payment method</Label>
                    <SelectField
                      id="debt-payment-method"
                      value={paymentMethod}
                      onChange={(event) => {
                        setPaymentMethod(event.target.value as PaymentMethod);
                        setCashAccountId("");
                      }}
                    >
                      <option value="cash">Cash</option>
                      <option value="mtn_mobile_money">MTN Mobile Money</option>
                      <option value="airtel_money">Airtel Money</option>
                      <option value="bank_transfer">Bank transfer</option>
                    </SelectField>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="debt-payment-account">Deposit to account</Label>
                    <SelectField
                      id="debt-payment-account"
                      value={cashAccountId}
                      disabled={isLoading || availablePaymentAccounts.length === 0}
                      onChange={(event) => setCashAccountId(event.target.value)}
                    >
                      <option value="">Select an active, opened account</option>
                      {availablePaymentAccounts.map((account) => (
                        <option key={account.id} value={account.id}>{account.name}</option>
                      ))}
                    </SelectField>
                    {!isLoading && availablePaymentAccounts.length === 0 ? (
                      <p className="text-xs text-amber-700">
                        Ask the Admin to activate and open an account matching this payment method.
                      </p>
                    ) : null}
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="debt-payment-amount">Repayment amount (RWF)</Label>
                    <Input id="debt-payment-amount" inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} placeholder="0.00" />
                  </div>
                  {selectedDebt ? <p className="text-sm text-muted-foreground">Outstanding: {formatMoney(selectedDebt.balance_due)}</p> : null}
                  <Button
                    type="submit"
                    disabled={
                      isSaving ||
                      isLoading ||
                      !selectedDebt ||
                      !amount.trim() ||
                      !availablePaymentAccounts.some((account) => account.id === cashAccountId)
                    }
                  >
                    {isSaving ? <LoaderCircle className="animate-spin" /> : <Wallet />}
                    {isSaving ? "Recording..." : "Record repayment"}
                  </Button>
                </form>
              )}
            </CardContent>
          </Card>
        ) : null}

        <Card>
          <CardHeader><CardTitle>Outstanding credit</CardTitle><CardDescription>{formatMoney(outstandingTotal)} across customer sales</CardDescription></CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="flex items-center gap-2 py-4 text-sm text-muted-foreground"><LoaderCircle className="size-4 animate-spin" />Loading customer debts...</div>
            ) : debts.length === 0 ? (
              <p className="py-4 text-sm text-muted-foreground">No customer credit sales are recorded.</p>
            ) : (
              <ul className="divide-y">
                {debts.map((debt) => (
                  <li key={debt.id} className="flex items-start justify-between gap-3 py-4 first:pt-0">
                    <div><div className="flex flex-wrap items-center gap-2"><p className="font-medium">{debt.customer_name}</p><Badge variant={debt.balance_due > 0 ? "outline" : "secondary"}>{debt.balance_due > 0 ? "Outstanding" : "Paid"}</Badge></div><p className="text-sm text-muted-foreground">Sale: {debt.transaction_number}</p><p className="text-sm text-muted-foreground">Original: {formatMoney(debt.original_amount)} · Repaid: {formatMoney(debt.amount_paid)}</p></div>
                    <p className="text-sm font-semibold">{formatMoney(debt.balance_due)}</p>
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
