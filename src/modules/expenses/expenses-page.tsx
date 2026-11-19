"use client";

import { useEffect, useState, type FormEvent } from "react";
import { LoaderCircle, Receipt } from "lucide-react";

import { ledgerApi, type CashAccount, type Expense } from "@/lib/api/ledger-api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PageHeader } from "@/components/shared/page-header";
import { SelectField } from "@/components/shared/select-field";
import { useAuthentication } from "@/modules/auth/auth-gate";

const categories = ["rent","electricity","transport","salaries","internet","repairs","security","other"];
const methods = [
  ["cash","Cash"], ["mtn_mobile_money","MTN Mobile Money"],
  ["airtel_money","Airtel Money"], ["bank_transfer","Bank transfer"],
] as const;

function parseMoney(value: string): number | null {
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(value.trim());
  if (!match) return null;
  const amount = BigInt(match[1]) * 100n + BigInt((match[2] ?? "").padEnd(2, "0"));
  return amount > 0n && amount <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(amount) : null;
}

function formatMoney(value: number): string {
  const amount = BigInt(value);
  const whole = amount / 100n;
  const fraction = amount % 100n;
  return `${new Intl.NumberFormat("en-RW").format(Number(whole))}${fraction === 0n ? "" : `.${fraction.toString().padStart(2,"0")}`} RWF`;
}

export function ExpensesPage() {
  const { user, permissions } = useAuthentication();
  const canRead = user.role === "admin" || permissions.includes("expenses.read");
  const canManage = user.role === "admin" || permissions.includes("expenses.manage");
  const [accounts, setAccounts] = useState<CashAccount[]>([]);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [category, setCategory] = useState("other");
  const [amount, setAmount] = useState("");
  const [expenseDate, setExpenseDate] = useState(new Date().toISOString().slice(0, 10));
  const [paymentMethod, setPaymentMethod] = useState("cash");
  const [accountId, setAccountId] = useState("");
  const [description, setDescription] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (!canRead) { return; }
    let active = true;
    Promise.all([ledgerApi.accounts(), ledgerApi.expenses()])
      .then(([accountResult, expenseResult]) => {
        if (!active) return;
        setAccounts(accountResult.filter((account) => account.is_active));
        setExpenses(expenseResult.items);
      })
      .catch((cause) => { if (active) setError(cause instanceof Error ? cause.message : "Could not load expenses."); })
      .finally(() => { if (active) setIsLoading(false); });
    return () => { active = false; };
  }, [canRead]);

  const matchingAccounts = accounts.filter((account) =>
    (paymentMethod === "cash" && account.account_type === "cash_drawer") ||
    (paymentMethod === "mtn_mobile_money" && account.account_type === "mtn_wallet") ||
    (paymentMethod === "airtel_money" && account.account_type === "airtel_wallet") ||
    (paymentMethod === "bank_transfer" && account.account_type === "bank"),
  );

  if (!canRead) return <div className="mx-auto max-w-7xl"><PageHeader eyebrow="Operations" title="Expenses" description="Record and review operating costs." /><Card><CardContent className="py-6 text-sm text-muted-foreground">You do not have permission to view expenses.</CardContent></Card></div>;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const scaled = parseMoney(amount);
    if (!scaled || !accountId || !description.trim()) {
      setError("Select an opened account and enter a valid amount and description.");
      return;
    }
    setError(null); setNotice(null); setIsSaving(true);
    try {
      await ledgerApi.createExpense({
        branchId: matchingAccounts.find((account) => account.id === accountId)?.branch_id ?? null,
        category,
        amount: scaled,
        expenseDate,
        paymentMethod,
        cashAccountId: accountId,
        description: description.trim(),
        responsibleName: user.full_name,
      });
      setAmount(""); setDescription(""); setNotice("Expense and cash movement recorded.");
      setExpenses((await ledgerApi.expenses()).items);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not record expense.");
    } finally { setIsSaving(false); }
  }

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <PageHeader eyebrow="Operations" title="Expenses" description="Record account-backed operating costs." />
      {error ? <div role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">{error}</div> : null}
      {notice ? <div role="status" className="rounded-lg border border-border bg-muted/50 p-4 text-sm">{notice}</div> : null}
      <div className="grid gap-6 xl:grid-cols-[22rem_1fr]">
        {canManage ? (
          <Card><CardHeader><CardTitle>New expense</CardTitle><CardDescription>Verified account funds are required.</CardDescription></CardHeader><CardContent>
            <form className="space-y-4" onSubmit={submit}>
              <div className="space-y-2"><Label>Category</Label><SelectField value={category} onChange={(event) => setCategory(event.target.value)}>{categories.map((item) => <option key={item} value={item}>{item}</option>)}</SelectField></div>
              <div className="space-y-2"><Label>Amount RWF</Label><Input inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} /></div>
              <div className="space-y-2"><Label>Expense date</Label><Input type="date" value={expenseDate} onChange={(event) => setExpenseDate(event.target.value)} /></div>
              <div className="space-y-2"><Label>Payment method</Label><SelectField value={paymentMethod} onChange={(event) => { setPaymentMethod(event.target.value); setAccountId(""); }}>{methods.map(([value,label]) => <option key={value} value={value}>{label}</option>)}</SelectField></div>
              <div className="space-y-2"><Label>Cash account</Label><SelectField value={accountId} onChange={(event) => setAccountId(event.target.value)}><option value="">Select opened account</option>{matchingAccounts.map((account) => <option key={account.id} value={account.id}>{account.name} · {formatMoney(account.available_balance ?? 0)}</option>)}</SelectField></div>
              <div className="space-y-2"><Label>Description</Label><Input value={description} maxLength={1000} onChange={(event) => setDescription(event.target.value)} /></div>
              <Button type="submit" disabled={isSaving || !accountId}><Receipt />{isSaving ? "Recording..." : "Record expense"}</Button>
            </form>
          </CardContent></Card>
        ) : null}
        <Card><CardHeader><CardTitle>Expense history</CardTitle><CardDescription>{expenses.length} recent records</CardDescription></CardHeader><CardContent>{isLoading ? <div className="flex items-center gap-2 text-sm text-muted-foreground"><LoaderCircle className="size-4 animate-spin" />Loading expenses...</div> : expenses.length === 0 ? <p className="text-sm text-muted-foreground">No expenses recorded.</p> : <ul className="divide-y">{expenses.map((expense) => <li key={expense.id} className="flex justify-between gap-3 py-3"><div><p className="font-medium">{expense.description}</p><p className="text-xs text-muted-foreground">{expense.category} · {expense.expense_date} · {expense.responsible_name}</p></div><p className="font-semibold">{formatMoney(expense.amount)}</p></li>)}</ul>}</CardContent></Card>
      </div>
    </div>
  );
}
