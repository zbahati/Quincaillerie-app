"use client";

import { useEffect, useState, type FormEvent } from "react";
import { Landmark, LoaderCircle, Plus } from "lucide-react";

import { ledgerApi, type CashAccount, type CashTransfer } from "@/lib/api/ledger-api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PageHeader } from "@/components/shared/page-header";
import { SelectField } from "@/components/shared/select-field";
import { useAuthentication } from "@/modules/auth/auth-gate";

const types = [
  ["cash_drawer","Cash drawer"], ["bank","Bank"], ["mtn_wallet","MTN Wallet"],
  ["airtel_wallet","Airtel Wallet"], ["other","Other"],
] as const;

function parseMoney(value: string): number | null {
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(value.trim());
  if (!match) return null;
  const amount = BigInt(match[1]) * 100n + BigInt((match[2] ?? "").padEnd(2, "0"));
  return amount <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(amount) : null;
}

function formatMoney(value: number | null): string {
  if (value === null) return "Not opened";
  const amount = BigInt(value);
  const whole = amount / 100n;
  const fraction = amount % 100n;
  return `${new Intl.NumberFormat("en-RW").format(Number(whole))}${fraction === 0n ? "" : `.${fraction.toString().padStart(2,"0")}`} RWF`;
}

export function CashAccountsPage() {
  const { user, permissions } = useAuthentication();
  const canRead = user.role === "admin" || permissions.includes("cash_accounts.balance.read");
  const canManage = user.role === "admin" || permissions.includes("cash_accounts.manage");
  const [accounts, setAccounts] = useState<CashAccount[]>([]);
  const [accountType, setAccountType] = useState("cash_drawer");
  const [name, setName] = useState("");
  const [opening, setOpening] = useState<Record<string,string>>({});
  const [transfers, setTransfers] = useState<CashTransfer[]>([]);
  const [fromAccountId, setFromAccountId] = useState("");
  const [toAccountId, setToAccountId] = useState("");
  const [transferAmount, setTransferAmount] = useState("");
  const [confirmationReference, setConfirmationReference] = useState<Record<string,string>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function reload() {
    setAccounts(await ledgerApi.accounts());
    setTransfers(await ledgerApi.transfers());
  }

  useEffect(() => {
    if (!canRead) { return; }
    let active = true;
    ledgerApi.accounts()
      .then(async (result) => {
        if (!active) return;
        setAccounts(result);
        setTransfers(await ledgerApi.transfers());
      })
      .catch((cause) => { if (active) setError(cause instanceof Error ? cause.message : "Could not load accounts."); })
      .finally(() => { if (active) setIsLoading(false); });
    return () => { active = false; };
  }, [canRead]);

  async function createAccount(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!name.trim()) return;
    setError(null); setNotice(null); setIsSaving(true);
    try {
      await ledgerApi.createAccount({
        branchId: accountType === "cash_drawer" ? (user.branch_id ?? null) : null,
        accountType,
        name: name.trim(),
      });
      setName("");
      await reload();
      setNotice("Cash account created.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not create account.");
    } finally { setIsSaving(false); }
  }

  async function openAccount(account: CashAccount) {
    const amount = parseMoney(opening[account.id] ?? "");
    if (amount === null) {
      setError("Enter a valid opening balance.");
      return;
    }
    setError(null); setNotice(null); setIsSaving(true);
    try {
      await ledgerApi.openAccount(account.id, amount);
      await reload();
      setOpening((current) => ({ ...current, [account.id]: "" }));
      setNotice(`Opening balance recorded for ${account.name}.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not open account.");
    } finally { setIsSaving(false); }
  }

  async function createTransfer(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const amount = parseMoney(transferAmount);
    if (!fromAccountId || !toAccountId || fromAccountId === toAccountId || amount === null || amount <= 0) {
      setError("Select two different accounts and enter a valid transfer amount.");
      return;
    }
    setError(null); setNotice(null); setIsSaving(true);
    try {
      await ledgerApi.createTransfer({ fromAccountId, toAccountId, amount });
      setTransferAmount(""); setFromAccountId(""); setToAccountId("");
      await reload();
      setNotice("Transfer prepared. It will affect balances only after Admin confirmation.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not create transfer.");
    } finally { setIsSaving(false); }
  }

  async function confirmTransfer(transfer: CashTransfer) {
    setError(null); setNotice(null); setIsSaving(true);
    try {
      await ledgerApi.confirmTransfer(transfer.id, confirmationReference[transfer.id]?.trim() || null);
      await reload();
      setNotice("Transfer confirmed and both account movements were recorded.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not confirm transfer.");
    } finally { setIsSaving(false); }
  }

  if (!canRead) return <div className="mx-auto max-w-7xl"><PageHeader eyebrow="Finance" title="Cash accounts" description="Manage business funds and openings." /><Card><CardContent className="py-6 text-sm text-muted-foreground">You do not have permission to view cash accounts.</CardContent></Card></div>;

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <PageHeader eyebrow="Finance" title="Cash accounts" description="Manage account types, openings and available funds." />
      {error ? <div role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">{error}</div> : null}
      {notice ? <div role="status" className="rounded-lg border border-border bg-muted/50 p-4 text-sm">{notice}</div> : null}
      {canManage ? (
        <Card><CardHeader><CardTitle>New account</CardTitle><CardDescription>Opening balances are authorized and immutable.</CardDescription></CardHeader><CardContent>
          <form className="grid gap-4 md:grid-cols-[12rem_1fr_auto] md:items-end" onSubmit={createAccount}>
            <div className="space-y-2"><Label>Account type</Label><SelectField value={accountType} onChange={(event) => setAccountType(event.target.value)}>{types.map(([value,label]) => <option key={value} value={value}>{label}</option>)}</SelectField></div>
            <div className="space-y-2"><Label>Account name</Label><Input value={name} maxLength={120} onChange={(event) => setName(event.target.value)} placeholder="Main cash drawer" /></div>
            <Button type="submit" disabled={isSaving || !name.trim()}><Plus />Create account</Button>
          </form>
        </CardContent></Card>
      ) : null}
      {canManage ? (
        <Card>
          <CardHeader><CardTitle>Transfer funds</CardTitle><CardDescription>Pending transfers do not change account balances.</CardDescription></CardHeader>
          <CardContent>
            <form className="grid gap-4 md:grid-cols-[1fr_1fr_12rem_auto] md:items-end" onSubmit={createTransfer}>
              <div className="space-y-2"><Label>From account</Label><SelectField value={fromAccountId} onChange={(event) => setFromAccountId(event.target.value)}><option value="">Select source</option>{accounts.filter((account) => account.is_active && account.opening_amount !== null).map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}</SelectField></div>
              <div className="space-y-2"><Label>To account</Label><SelectField value={toAccountId} onChange={(event) => setToAccountId(event.target.value)}><option value="">Select destination</option>{accounts.filter((account) => account.is_active && account.opening_amount !== null).map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}</SelectField></div>
              <div className="space-y-2"><Label>Amount RWF</Label><Input inputMode="decimal" value={transferAmount} onChange={(event) => setTransferAmount(event.target.value)} /></div>
              <Button type="submit" disabled={isSaving || !fromAccountId || !toAccountId || !transferAmount.trim()}>Prepare transfer</Button>
            </form>
          </CardContent>
        </Card>
      ) : null}
      {transfers.length > 0 ? (
        <Card>
          <CardHeader><CardTitle>Transfer history</CardTitle><CardDescription>Pending transfers require Admin confirmation.</CardDescription></CardHeader>
          <CardContent>
            <ul className="divide-y">{transfers.map((transfer) => {
              const from = accounts.find((account) => account.id === transfer.from_account_id)?.name ?? transfer.from_account_id;
              const to = accounts.find((account) => account.id === transfer.to_account_id)?.name ?? transfer.to_account_id;
              return (
                <li key={transfer.id} className="grid gap-3 py-4 md:grid-cols-[1fr_16rem]">
                  <div><p className="font-medium">{from} → {to}</p><p className="text-sm text-muted-foreground">{formatMoney(transfer.amount)} · {transfer.status}</p></div>
                  {transfer.status === "pending" && user.role === "admin" ? (
                    <div className="flex gap-2"><Input placeholder="Confirmation reference" value={confirmationReference[transfer.id] ?? ""} onChange={(event) => setConfirmationReference((current) => ({ ...current, [transfer.id]: event.target.value }))} /><Button type="button" variant="outline" disabled={isSaving} onClick={() => void confirmTransfer(transfer)}>Confirm</Button></div>
                  ) : null}
                </li>
              );
            })}</ul>
          </CardContent>
        </Card>
      ) : null}
      <Card><CardHeader><CardTitle>Accounts</CardTitle><CardDescription>Available balances include all recorded movements.</CardDescription></CardHeader><CardContent>
        {isLoading ? <div className="flex items-center gap-2 text-sm text-muted-foreground"><LoaderCircle className="size-4 animate-spin" />Loading accounts...</div> : accounts.length === 0 ? <p className="text-sm text-muted-foreground">No cash accounts created.</p> : <ul className="divide-y">{accounts.map((account) => (
          <li key={account.id} className="grid gap-3 py-4 first:pt-0 md:grid-cols-[1fr_12rem_16rem] md:items-end">
            <div><div className="flex flex-wrap items-center gap-2"><p className="font-medium">{account.name}</p><Badge variant={account.is_active ? "secondary" : "outline"}>{account.is_active ? "Active" : "Inactive"}</Badge></div><p className="text-sm text-muted-foreground">{account.account_type.replace("_"," ")}</p></div>
            <div><p className="text-xs text-muted-foreground">Available balance</p><p className="font-semibold">{formatMoney(account.available_balance)}</p></div>
            {canManage && account.opening_amount === null ? <div className="flex gap-2"><Input inputMode="decimal" placeholder="Opening RWF" value={opening[account.id] ?? ""} onChange={(event) => setOpening((current) => ({ ...current, [account.id]: event.target.value }))} /><Button type="button" variant="outline" disabled={isSaving} onClick={() => void openAccount(account)}><Landmark />Open</Button></div> : null}
          </li>
        ))}</ul>}
      </CardContent></Card>
    </div>
  );
}
