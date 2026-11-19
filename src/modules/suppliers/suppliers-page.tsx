"use client";

import { useEffect, useState, type FormEvent } from "react";
import { Factory, LoaderCircle, Pencil, Plus, Save, X } from "lucide-react";

import { suppliersApi, type Supplier } from "@/lib/api/relationships-api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PageHeader } from "@/components/shared/page-header";
import { useAuthentication } from "@/modules/auth/auth-gate";

interface SupplierForm {
  name: string;
  contactPerson: string;
  phone: string;
  email: string;
  address: string;
  taxId: string;
  isActive: boolean;
}

const EMPTY_FORM: SupplierForm = {
  name: "",
  contactPerson: "",
  phone: "",
  email: "",
  address: "",
  taxId: "",
  isActive: true,
};

function errorText(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

function formFromSupplier(supplier: Supplier): SupplierForm {
  return {
    name: supplier.name,
    contactPerson: supplier.contact_person ?? "",
    phone: supplier.phone ?? "",
    email: supplier.email ?? "",
    address: supplier.address ?? "",
    taxId: supplier.tax_id ?? "",
    isActive: supplier.is_active,
  };
}

export function SuppliersPage() {
  const { user, permissions } = useAuthentication();
  const canReadSuppliers = user.role === "admin" || permissions.includes("suppliers.read");
  const canManageSuppliers = user.role === "admin" || permissions.includes("suppliers.manage");
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [form, setForm] = useState<SupplierForm>(EMPTY_FORM);
  const [editingSupplierId, setEditingSupplierId] = useState<string | null>(null);
  const [isLoadingSuppliers, setIsLoadingSuppliers] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!canReadSuppliers) {
      return;
    }

    let active = true;
    suppliersApi.list()
      .then((result) => {
        if (active) {
          setSuppliers(result);
        }
      })
      .catch((cause: unknown) => {
        if (active) {
          setError(`Could not load suppliers. ${errorText(cause)}`);
        }
      })
      .finally(() => {
        if (active) {
          setIsLoadingSuppliers(false);
        }
      });
    return () => {
      active = false;
    };
  }, [canReadSuppliers]);

  function resetForm() {
    setEditingSupplierId(null);
    setForm(EMPTY_FORM);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canManageSuppliers || !form.name.trim()) {
      return;
    }

    setError(null);
    setIsSaving(true);
    const fields = {
      name: form.name.trim(),
      contactPerson: form.contactPerson.trim() || null,
      phone: form.phone.trim() || null,
      email: form.email.trim() || null,
      address: form.address.trim() || null,
      taxId: form.taxId.trim() || null,
    };
    try {
      if (editingSupplierId) {
        const supplier = await suppliersApi.update(editingSupplierId, {
          ...fields,
          isActive: form.isActive,
        });
        setSuppliers((current) =>
          current
            .map((item) => item.id === supplier.id ? supplier : item)
            .sort((left, right) =>
              Number(right.is_active) - Number(left.is_active) ||
              left.name.localeCompare(right.name),
            ),
        );
      } else {
        const supplier = await suppliersApi.create(fields);
        setSuppliers((current) =>
          [...current, supplier].sort((left, right) => left.name.localeCompare(right.name)),
        );
      }
      resetForm();
    } catch (cause) {
      setError(`Could not save the supplier. ${errorText(cause)}`);
    } finally {
      setIsSaving(false);
    }
  }

  function editSupplier(supplier: Supplier) {
    setEditingSupplierId(supplier.id);
    setForm(formFromSupplier(supplier));
    setError(null);
  }

  const pageHeader = (
    <PageHeader
      eyebrow="Purchasing"
      title="Suppliers"
      description="Keep supplier contact and tax details ready for purchase invoices."
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

      {!canReadSuppliers ? (
        <Card>
          <CardContent className="py-6 text-sm text-muted-foreground">
            You do not have permission to view suppliers.
          </CardContent>
        </Card>
      ) : (
        <>
          <div className={`grid gap-6 ${canManageSuppliers ? "xl:grid-cols-[minmax(20rem,0.8fr)_minmax(0,1.2fr)]" : ""}`}>
            {canManageSuppliers ? (
              <Card>
              <CardHeader>
                <CardTitle>{editingSupplierId ? "Edit supplier" : "Add supplier"}</CardTitle>
                <CardDescription>
                  Supplier details are kept separate for your business.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <form className="space-y-4" onSubmit={handleSubmit}>
                  <div className="space-y-2">
                    <Label htmlFor="supplier-name">Supplier name</Label>
                    <Input
                      id="supplier-name"
                      maxLength={160}
                      required
                      value={form.name}
                      onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
                      placeholder="e.g. Kigali Building Supplies"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="supplier-contact-person">Contact person (optional)</Label>
                    <Input
                      id="supplier-contact-person"
                      maxLength={160}
                      value={form.contactPerson}
                      onChange={(event) => setForm((current) => ({ ...current, contactPerson: event.target.value }))}
                    />
                  </div>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="space-y-2">
                      <Label htmlFor="supplier-phone">Phone (optional)</Label>
                      <Input
                        id="supplier-phone"
                        type="tel"
                        maxLength={80}
                        value={form.phone}
                        onChange={(event) => setForm((current) => ({ ...current, phone: event.target.value }))}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="supplier-email">Email (optional)</Label>
                      <Input
                        id="supplier-email"
                        type="email"
                        maxLength={254}
                        value={form.email}
                        onChange={(event) => setForm((current) => ({ ...current, email: event.target.value }))}
                      />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="supplier-address">Address (optional)</Label>
                    <Input
                      id="supplier-address"
                      maxLength={500}
                      value={form.address}
                      onChange={(event) => setForm((current) => ({ ...current, address: event.target.value }))}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="supplier-tax-id">Tax identification number (optional)</Label>
                    <Input
                      id="supplier-tax-id"
                      maxLength={100}
                      value={form.taxId}
                      onChange={(event) => setForm((current) => ({ ...current, taxId: event.target.value }))}
                    />
                  </div>
                  {editingSupplierId ? (
                    <label className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={form.isActive}
                        onChange={(event) => setForm((current) => ({ ...current, isActive: event.target.checked }))}
                      />
                      Supplier is active
                    </label>
                  ) : null}
                  <div className="flex flex-wrap gap-2">
                    <Button type="submit" disabled={isSaving || !form.name.trim()}>
                      {isSaving ? <LoaderCircle className="animate-spin" /> : editingSupplierId ? <Save /> : <Plus />}
                      {isSaving ? "Saving..." : editingSupplierId ? "Save changes" : "Add supplier"}
                    </Button>
                    {editingSupplierId ? (
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
                <CardTitle>Supplier directory</CardTitle>
                <CardDescription>
                  {suppliers.length} {suppliers.length === 1 ? "supplier" : "suppliers"}
                </CardDescription>
              </CardHeader>
              <CardContent>
                {isLoadingSuppliers ? (
                  <div className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
                    <LoaderCircle className="size-4 animate-spin" />
                    Loading suppliers...
                  </div>
                ) : suppliers.length === 0 ? (
                  <p className="py-4 text-sm text-muted-foreground">
                    No suppliers have been added for this business.
                  </p>
                ) : (
                  <ul className="divide-y">
                    {suppliers.map((supplier) => (
                      <li key={supplier.id} className="flex flex-col gap-3 py-4 first:pt-0 sm:flex-row sm:items-start sm:justify-between">
                        <div className="min-w-0 space-y-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <h2 className="font-medium">{supplier.name}</h2>
                            <Badge variant={supplier.is_active ? "secondary" : "outline"}>
                              {supplier.is_active ? "Active" : "Inactive"}
                            </Badge>
                          </div>
                          {supplier.contact_person ? (
                            <p className="text-sm text-muted-foreground">Contact: {supplier.contact_person}</p>
                          ) : null}
                          {supplier.phone ? (
                            <p className="text-sm text-muted-foreground">Phone: {supplier.phone}</p>
                          ) : null}
                          {supplier.email ? (
                            <p className="break-all text-sm text-muted-foreground">{supplier.email}</p>
                          ) : null}
                          {supplier.address ? (
                            <p className="text-sm text-muted-foreground">{supplier.address}</p>
                          ) : null}
                          {supplier.tax_id ? (
                            <p className="text-sm text-muted-foreground">Tax ID: {supplier.tax_id}</p>
                          ) : null}
                        </div>
                        {canManageSuppliers ? (
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => editSupplier(supplier)}
                          >
                            <Pencil />
                            Edit
                          </Button>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>
          </div>

          {canManageSuppliers ? (
            <Card>
              <CardContent className="flex items-start gap-3 py-4 text-sm text-muted-foreground">
                <Factory className="mt-0.5 size-4 shrink-0" />
                Purchase history, outstanding balances, payment history, and invoice attachments will be added with the purchasing workflow.
              </CardContent>
            </Card>
          ) : null}
        </>
      )}
    </div>
  );
}
