"use client";

import { useEffect, useState, type FormEvent } from "react";
import { Building2, Download, LoaderCircle } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PageHeader } from "@/components/shared/page-header";
import { businessSettingsApi, type BusinessSettings } from "@/lib/api/business-settings-api";
import { BrandManagementSection } from "./brand-management-section";
import { CategoryManagementSection } from "./category-management-section";
import { UnitManagementSection } from "./unit-management-section";

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function BusinessSetupPage() {
  const [business, setBusiness] = useState<BusinessSettings | null>(null);
  const [canManage, setCanManage] = useState(false);
  const [name, setName] = useState("");
  const [taxId, setTaxId] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    businessSettingsApi.get()
      .then((result) => {
        if (active) {
          setBusiness(result.business);
          setCanManage(result.canManage);
          setName(result.business.name);
          setTaxId(result.business.tax_id ?? "");
        }
      })
      .catch((cause: unknown) => {
        if (active) {
          setError(`Could not load business settings. ${errorMessage(cause)}`);
        }
      })
      .finally(() => {
        if (active) {
          setIsLoading(false);
        }
      });

    return () => {
      active = false;
    };
  }, []);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setNotice(null);
    setIsSaving(true);

    try {
      const updated = await businessSettingsApi.update({
        name: name.trim(),
        taxId: taxId.trim() || null,
      });
      setBusiness(updated);
      setNotice("Business details saved.");
    } catch (cause) {
      setError(`Could not save business details. ${errorMessage(cause)}`);
    } finally {
      setIsSaving(false);
    }
  }

  async function handleExport() {
    setError(null);
    setNotice(null);
    setIsExporting(true);
    try {
      await businessSettingsApi.downloadExport();
      setNotice("Business data export downloaded. It contains sensitive business, customer, supplier, and staff data; store it securely. Password hashes and authentication tokens are excluded. Restore is not supported.");
    } catch (cause) {
      setError(`Could not export business data. ${errorMessage(cause)}`);
    } finally {
      setIsExporting(false);
    }
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <PageHeader
        eyebrow="Workspace settings"
        title="Business configuration"
        description="Manage the business details and product-catalogue settings for your signed-in workspace."
      />

      {error ? (
        <div
          role="alert"
          className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive"
        >
          <p className="font-medium">Business configuration failed</p>
          <p className="mt-1">{error}</p>
        </div>
      ) : null}
      {notice ? (
        <div role="status" className="rounded-lg border border-primary/20 bg-primary/5 p-4 text-sm text-foreground">
          {notice}
        </div>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Business details</CardTitle>
          <CardDescription>
            This business is scoped to your signed-in account. Business records are not created or selected from this page.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
              <LoaderCircle className="h-4 w-4 animate-spin" />
              Loading business settings...
            </div>
          ) : business ? (
            <>
              {canManage ? (
                <form className="grid gap-5 md:grid-cols-2" onSubmit={handleSubmit}>
                  <div className="space-y-2">
                    <Label htmlFor="business-name">Business name</Label>
                    <Input
                      id="business-name"
                      autoComplete="organization"
                      maxLength={120}
                      required
                      value={name}
                      onChange={(event) => setName(event.target.value)}
                      placeholder="e.g. Kigali Hardware"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="business-tax-id">Tax identification number (optional)</Label>
                    <Input
                      id="business-tax-id"
                      maxLength={80}
                      value={taxId}
                      onChange={(event) => setTaxId(event.target.value)}
                      placeholder="TIN"
                    />
                  </div>
                  <div className="flex items-center justify-between gap-4 md:col-span-2">
                    <p className="text-sm text-muted-foreground">
                      {business.currency} · {business.timezone} · {business.date_format} · {business.language}
                    </p>
                    <Button type="submit" disabled={isSaving || !name.trim()}>
                      {isSaving ? <LoaderCircle className="animate-spin" /> : <Building2 />}
                      {isSaving ? "Saving..." : "Save business"}
                    </Button>
                  </div>
                </form>
              ) : (
                <dl className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <dt className="text-sm text-muted-foreground">Business name</dt>
                    <dd className="font-medium">{business.name}</dd>
                  </div>
                  <div>
                    <dt className="text-sm text-muted-foreground">Tax identification number</dt>
                    <dd className="font-medium">{business.tax_id || "Not set"}</dd>
                  </div>
                  <div className="sm:col-span-2">
                    <dt className="text-sm text-muted-foreground">Regional defaults</dt>
                    <dd className="font-medium">
                      {business.currency} · {business.timezone} · {business.date_format} · {business.language}
                    </dd>
                  </div>
                </dl>
              )}
            </>
          ) : (
            <p className="py-4 text-sm text-muted-foreground">
              Business details are unavailable for this account.
            </p>
          )}
        </CardContent>
      </Card>

      {canManage ? (
        <Card>
          <CardHeader>
            <CardTitle>Business data export</CardTitle>
            <CardDescription>
              Download a JSON export of this business&apos;s records. This does not back up or restore the hosted PostgreSQL database.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Password hashes, sign-in sessions, verification links, and password-reset tokens are excluded. The export contains sensitive operational and personal data; keep the file secure.
            </p>
            <Button type="button" variant="outline" onClick={handleExport} disabled={isLoading || isExporting}>
              {isExporting ? <LoaderCircle className="animate-spin" /> : <Download />}
              {isExporting ? "Preparing export..." : "Download business data"}
            </Button>
          </CardContent>
        </Card>
      ) : null}

      <UnitManagementSection />
      <CategoryManagementSection />
      <BrandManagementSection />
    </div>
  );
}
