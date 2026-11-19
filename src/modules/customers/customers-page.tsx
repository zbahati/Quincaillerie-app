"use client";

import { useEffect, useState, type FormEvent } from "react";
import { FileText, LoaderCircle, Pencil, Plus, Search, Save, UserRound, X } from "lucide-react";

import { customersApi, type Customer } from "@/lib/api/relationships-api";
import { customerDebtApi, type CustomerStatement } from "@/lib/api/customer-debt-api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PageHeader } from "@/components/shared/page-header";
import { SelectField } from "@/components/shared/select-field";
import { useAuthentication } from "@/modules/auth/auth-gate";

type CustomerType = Customer["customer_type"];

interface CustomerForm {
  name: string;
  phone: string;
  address: string;
  customerType: CustomerType;
  creditLimit: string;
  isActive: boolean;
}

const EMPTY_FORM: CustomerForm = {
  name: "",
  phone: "",
  address: "",
  customerType: "individual",
  creditLimit: "0",
  isActive: true,
};

const MONEY_SCALE = 100n;
const MAX_SAFE_INTEGER = BigInt(Number.MAX_SAFE_INTEGER);

function errorText(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

function parseCreditLimit(value: string): number | null {
  const normalized = value.trim();
  if (normalized.length > 17 || !/^\d+(?:\.\d{1,2})?$/.test(normalized)) {
    return null;
  }
  const [whole, fraction = ""] = normalized.split(".");
  const scaled = BigInt(whole) * MONEY_SCALE + BigInt(fraction.padEnd(2, "0"));
  if (scaled > MAX_SAFE_INTEGER) {
    return null;
  }
  return Number(scaled);
}

function creditLimitInputValue(scaledAmount: number): string {
  const amount = BigInt(scaledAmount);
  const whole = amount / MONEY_SCALE;
  const fraction = amount % MONEY_SCALE;
  return fraction === 0n ? whole.toString() : `${whole}.${fraction.toString().padStart(2, "0")}`;
}

function formatMoney(scaledAmount: number): string {
  const amount = BigInt(scaledAmount);
  const whole = amount / MONEY_SCALE;
  const fraction = amount % MONEY_SCALE;
  const formattedWhole = new Intl.NumberFormat("en-RW").format(Number(whole));
  return `${formattedWhole}${fraction === 0n ? "" : `.${fraction.toString().padStart(2, "0")}`} RWF`;
}

function formFromCustomer(customer: Customer): CustomerForm {
  return {
    name: customer.name,
    phone: customer.phone ?? "",
    address: customer.address ?? "",
    customerType: customer.customer_type,
    creditLimit: creditLimitInputValue(customer.credit_limit),
    isActive: customer.is_active,
  };
}

export function CustomersPage() {
  const { user, permissions } = useAuthentication();
  const canReadCustomers = user.role === "admin" || permissions.includes("customers.read");
  const canManageCustomers = user.role === "admin" || permissions.includes("customers.manage");
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [form, setForm] = useState<CustomerForm>(EMPTY_FORM);
  const [search, setSearch] = useState("");
  const [editingCustomerId, setEditingCustomerId] = useState<string | null>(null);
  const [statementCustomerId, setStatementCustomerId] = useState<string | null>(null);
  const [statement, setStatement] = useState<CustomerStatement | null>(null);
  const [isLoadingStatement, setIsLoadingStatement] = useState(false);
  const [isLoadingCustomers, setIsLoadingCustomers] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!canReadCustomers) {
      return;
    }

    let active = true;
    customersApi.list()
      .then((result) => {
        if (active) {
          setCustomers(result);
        }
      })
      .catch((cause: unknown) => {
        if (active) {
          setError(`Could not load customers. ${errorText(cause)}`);
        }
      })
      .finally(() => {
        if (active) {
          setIsLoadingCustomers(false);
        }
      });

    return () => {
      active = false;
    };
  }, [canReadCustomers]);

  function resetForm() {
    setEditingCustomerId(null);
    setForm(EMPTY_FORM);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const creditLimit = parseCreditLimit(form.creditLimit);
    if (!canManageCustomers || !form.name.trim()) {
      return;
    }
    if (creditLimit === null) {
      setError("Enter a non-negative credit limit with no more than 2 decimal places.");
      return;
    }

    setError(null);
    setIsSaving(true);
    const fields = {
      name: form.name.trim(),
      phone: form.phone.trim() || null,
      address: form.address.trim() || null,
      customerType: form.customerType,
      creditLimit,
    };
    try {
      if (editingCustomerId) {
        const customer = await customersApi.update(editingCustomerId, {
          ...fields,
          isActive: form.isActive,
        });
        setCustomers((current) =>
          current
            .map((item) => item.id === customer.id ? customer : item)
            .sort((left, right) =>
              Number(right.is_active) - Number(left.is_active) ||
              left.name.localeCompare(right.name),
            ),
        );
      } else {
        const customer = await customersApi.create(fields);
        setCustomers((current) =>
          [...current, customer].sort((left, right) =>
            Number(right.is_active) - Number(left.is_active) ||
            left.name.localeCompare(right.name),
          ),
        );
      }
      resetForm();
    } catch (cause) {
      setError(`Could not save the customer. ${errorText(cause)}`);
    } finally {
      setIsSaving(false);
    }
  }

  function editCustomer(customer: Customer) {
    setEditingCustomerId(customer.id);
    setForm(formFromCustomer(customer));
    setError(null);
  }

  async function viewStatement(customer: Customer) {
    setStatementCustomerId(customer.id);
    setStatement(null);
    setIsLoadingStatement(true);
    setError(null);
    try {
      setStatement(await customerDebtApi.statement(customer.id));
    } catch (cause) {
      setError(`Could not load the customer statement. ${errorText(cause)}`);
    } finally {
      setIsLoadingStatement(false);
    }
  }

  const normalizedSearch = search.trim().toLocaleLowerCase();
  const filteredCustomers = customers.filter((customer) =>
    [customer.name, customer.phone ?? "", customer.address ?? ""]
      .some((value) => value.toLocaleLowerCase().includes(normalizedSearch)),
  );
  const pageHeader = (
    <PageHeader
      eyebrow="Relationships"
      title="Customers"
      description="Keep customer contact details and credit limits organized for your business."
    />
  );

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      {pageHeader}

      {error ? (
        <div role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
          {error}
        </div>
      ) : null}

      {!canReadCustomers ? (
        <Card>
          <CardContent className="py-6 text-sm text-muted-foreground">
            You do not have permission to view customers.
          </CardContent>
        </Card>
      ) : (
        <>
          <div className={`grid gap-6 ${canManageCustomers ? "xl:grid-cols-[minmax(20rem,0.8fr)_minmax(0,1.2fr)]" : ""}`}>
            {canManageCustomers ? (
              <Card>
                <CardHeader>
                  <CardTitle>{editingCustomerId ? "Edit customer" : "Add customer"}</CardTitle>
                  <CardDescription>
                    Customer records and credit limits are managed for your business.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <form className="space-y-4" onSubmit={handleSubmit}>
                    <div className="space-y-2">
                      <Label htmlFor="customer-name">Customer name</Label>
                      <Input
                        id="customer-name"
                        maxLength={160}
                        required
                        value={form.name}
                        onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
                        placeholder="e.g. Aline Mukamana"
                      />
                    </div>
                    <div className="grid gap-4 sm:grid-cols-2">
                      <div className="space-y-2">
                        <Label htmlFor="customer-type">Customer type</Label>
                        <SelectField
                          id="customer-type"
                          value={form.customerType}
                          onChange={(event) =>
                            setForm((current) => ({
                              ...current,
                              customerType: event.target.value === "business" ? "business" : "individual",
                            }))
                          }
                        >
                          <option value="individual">Individual</option>
                          <option value="business">Business</option>
                        </SelectField>
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="customer-phone">Phone (optional)</Label>
                        <Input
                          id="customer-phone"
                          type="tel"
                          maxLength={80}
                          value={form.phone}
                          onChange={(event) => setForm((current) => ({ ...current, phone: event.target.value }))}
                        />
                      </div>
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="customer-address">Address (optional)</Label>
                      <Input
                        id="customer-address"
                        maxLength={500}
                        value={form.address}
                        onChange={(event) => setForm((current) => ({ ...current, address: event.target.value }))}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="customer-credit-limit">Credit limit (RWF)</Label>
                      <Input
                        id="customer-credit-limit"
                        type="number"
                        min="0"
                        step="0.01"
                        inputMode="decimal"
                        required
                        value={form.creditLimit}
                        onChange={(event) => setForm((current) => ({ ...current, creditLimit: event.target.value }))}
                      />
                      <p className="text-xs leading-5 text-muted-foreground">
                        Credit sales will be checked against this limit when the sales workflow is available.
                      </p>
                    </div>
                    {editingCustomerId ? (
                      <label className="flex items-center gap-2 text-sm">
                        <input
                          type="checkbox"
                          checked={form.isActive}
                          onChange={(event) => setForm((current) => ({ ...current, isActive: event.target.checked }))}
                        />
                        Customer is active
                      </label>
                    ) : null}
                    <div className="flex flex-wrap gap-2">
                      <Button type="submit" disabled={isSaving || !form.name.trim()}>
                        {isSaving ? <LoaderCircle className="animate-spin" /> : editingCustomerId ? <Save /> : <Plus />}
                        {isSaving ? "Saving..." : editingCustomerId ? "Save changes" : "Add customer"}
                      </Button>
                      {editingCustomerId ? (
                        <Button type="button" variant="outline" onClick={resetForm} disabled={isSaving}>
                          <X />
                          Cancel
                        </Button>
                      ) : null}
                    </div>
                  </form>
                </CardContent>
              </Card>
            ) : null}

            <Card>
              <CardHeader>
                <CardTitle>Customer directory</CardTitle>
                <CardDescription>
                  {filteredCustomers.length} of {customers.length} {customers.length === 1 ? "customer" : "customers"}
                </CardDescription>
                <div className="relative mt-3">
                  <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    aria-label="Search customers"
                    className="pl-9"
                    placeholder="Search name, phone, or address"
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                  />
                </div>
              </CardHeader>
              <CardContent>
                {isLoadingCustomers ? (
                  <div className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
                    <LoaderCircle className="size-4 animate-spin" />
                    Loading customers...
                  </div>
                ) : filteredCustomers.length === 0 ? (
                  <div className="flex items-center gap-3 py-4 text-sm text-muted-foreground">
                    <UserRound className="size-4 shrink-0" />
                    {customers.length === 0
                      ? "No customers have been added for this business."
                      : "No customers match your search."}
                  </div>
                ) : (
                  <ul className="divide-y">
                    {filteredCustomers.map((customer) => (
                      <li key={customer.id} className="flex flex-col gap-3 py-4 first:pt-0 sm:flex-row sm:items-start sm:justify-between">
                        <div className="min-w-0 space-y-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <h2 className="font-medium">{customer.name}</h2>
                            <Badge variant={customer.is_active ? "secondary" : "outline"}>
                              {customer.is_active ? "Active" : "Inactive"}
                            </Badge>
                            <Badge variant="outline">
                              {customer.customer_type === "business" ? "Business" : "Individual"}
                            </Badge>
                          </div>
                          {customer.phone ? (
                            <p className="text-sm text-muted-foreground">Phone: {customer.phone}</p>
                          ) : null}
                          {customer.address ? (
                            <p className="text-sm text-muted-foreground">{customer.address}</p>
                          ) : null}
                          <p className="text-sm text-muted-foreground">
                            Credit limit: {formatMoney(customer.credit_limit)}
                          </p>
                        </div>
                        <div className="flex shrink-0 gap-2">
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            disabled={isLoadingStatement}
                            onClick={() => void viewStatement(customer)}
                          >
                            <FileText />
                            Statement
                          </Button>
                          {canManageCustomers ? (
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              onClick={() => editCustomer(customer)}
                            >
                              <Pencil />
                              Edit
                            </Button>
                          ) : null}
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>
          </div>
          <Card>
            <CardContent className="flex items-start gap-3 py-4 text-sm text-muted-foreground">
              <UserRound className="mt-0.5 size-4 shrink-0" />
              Statements reconcile sales, payment-at-sale entries and later repayments.
            </CardContent>
          </Card>
        </>
      )}
      <Dialog open={statementCustomerId !== null} onOpenChange={(open) => !open && setStatementCustomerId(null)}>
        <DialogContent size="wide">
          <DialogHeader>
            <DialogTitle>{statement?.customer.name ?? "Customer statement"}</DialogTitle>
            <DialogDescription>Sales, payments and running outstanding balance.</DialogDescription>
          </DialogHeader>
          {isLoadingStatement ? (
            <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground"><LoaderCircle className="size-4 animate-spin" />Loading statement...</div>
          ) : statement ? (
            <div className="space-y-5">
              <div className="grid gap-3 sm:grid-cols-3">
                <Card><CardHeader className="pb-2"><CardDescription>Total sales</CardDescription><CardTitle>{formatMoney(statement.total_sales)}</CardTitle></CardHeader></Card>
                <Card><CardHeader className="pb-2"><CardDescription>Total payments</CardDescription><CardTitle>{formatMoney(statement.total_payments)}</CardTitle></CardHeader></Card>
                <Card><CardHeader className="pb-2"><CardDescription>Outstanding</CardDescription><CardTitle>{formatMoney(statement.outstanding_balance)}</CardTitle></CardHeader></Card>
              </div>
              {statement.entries.length === 0 ? (
                <p className="py-6 text-center text-sm text-muted-foreground">No sales or repayments have been recorded.</p>
              ) : (
                <ul className="divide-y rounded-lg border">
                  {statement.entries.map((entry) => (
                    <li key={`${entry.entry_type}-${entry.id}`} className="flex items-start justify-between gap-3 px-3 py-3 text-sm">
                      <div><p className="font-medium">{entry.transaction_number}</p><p className="text-xs text-muted-foreground">{entry.entry_type === "sale" ? "Sale" : entry.entry_type === "sale_payment" ? "Payment at sale" : "Repayment"}{entry.payment_method ? ` · ${entry.payment_method}` : ""}</p></div>
                      <div className="text-right"><p>{formatMoney(entry.amount)}</p><p className="text-xs text-muted-foreground">Balance {formatMoney(entry.balance_after)}</p></div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}
