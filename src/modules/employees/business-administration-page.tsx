"use client";

import { Building2, KeyRound, LoaderCircle, Plus, UserCog } from "lucide-react";
import { Fragment, useEffect, useState, type FormEvent } from "react";

import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/shared/page-header";
import { SelectField } from "@/components/shared/select-field";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  businessAdministrationApi,
  type AdminBranch,
  type AdminBusiness,
  type AdminManager,
  type ManagerPermissionSetting,
} from "@/lib/api/business-administration-api";
import { useAuthentication } from "@/modules/auth/auth-gate";

const PERMISSION_LABELS: Record<string, string> = {
  "system.read": "View basic application information",
  "business.read": "View business profile",
  "catalog.read": "View products, categories, brands and units",
  "catalog.manage": "Create and update products, categories, brands and units",
  "inventory.read": "View stock and movement history",
  "inventory.manage": "Receive stock and make stock adjustments",
  "suppliers.read": "View supplier records",
  "suppliers.manage": "Add and edit suppliers",
  "customers.read": "View customer records",
  "customers.manage": "Add and edit customers",
  "customer_debts.read": "View customer debts for collection",
  "customer_payments.manage": "Record customer debt repayments",
  "pos.use": "Search products and use the point of sale",
  "sales.read": "View sales history",
  "sales.manage": "Record sales",
  "purchases.read": "View purchases and purchase costs",
  "purchases.manage": "Create purchases, receive deliveries and record supplier payments",
  "expenses.read": "View operating expense records",
  "expenses.manage": "Record operating expenses from verified account balances",
};

interface BranchDraft {
  name: string;
  address: string;
  phone: string;
}

function toBranchDraft(branch: AdminBranch): BranchDraft {
  return {
    name: branch.name,
    address: branch.address ?? "",
    phone: branch.phone ?? "",
  };
}

function errorText(cause: unknown): string {
  return cause instanceof Error ? cause.message : "An unexpected error occurred.";
}

function replaceManager(
  current: AdminManager[],
  updated: AdminManager,
): AdminManager[] {
  return current
    .map((manager) => manager.id === updated.id ? updated : manager)
    .sort((left, right) =>
      Number(right.is_active) - Number(left.is_active) ||
      left.full_name.localeCompare(right.full_name),
    );
}

export function BusinessAdministrationPage() {
  const { user } = useAuthentication();
  const [business, setBusiness] = useState<AdminBusiness | null>(null);
  const [branches, setBranches] = useState<AdminBranch[]>([]);
  const [branchDrafts, setBranchDrafts] = useState<Record<string, BranchDraft>>({});
  const [managers, setManagers] = useState<AdminManager[]>([]);
  const [managerNameDrafts, setManagerNameDrafts] = useState<Record<string, string>>({});
  const [managerPermissions, setManagerPermissions] = useState<ManagerPermissionSetting[]>([]);
  const [businessName, setBusinessName] = useState("");
  const [businessTaxId, setBusinessTaxId] = useState("");
  const [newBranchName, setNewBranchName] = useState("");
  const [newBranchAddress, setNewBranchAddress] = useState("");
  const [newBranchPhone, setNewBranchPhone] = useState("");
  const [username, setUsername] = useState("");
  const [fullName, setFullName] = useState("");
  const [branchId, setBranchId] = useState("");
  const [password, setPassword] = useState("");
  const [passwordConfirmation, setPasswordConfirmation] = useState("");
  const [resetManagerId, setResetManagerId] = useState<string | null>(null);
  const [resetPassword, setResetPassword] = useState("");
  const [resetPasswordConfirmation, setResetPasswordConfirmation] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isSavingBusiness, setIsSavingBusiness] = useState(false);
  const [isSavingPermissions, setIsSavingPermissions] = useState(false);
  const [savingBranchId, setSavingBranchId] = useState<string | null>(null);
  const [savingManagerId, setSavingManagerId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    if (user.role !== "admin") {
      return () => {
        active = false;
      };
    }

    Promise.all([
      businessAdministrationApi.business(),
      businessAdministrationApi.branches(),
      businessAdministrationApi.managers(),
      businessAdministrationApi.managerPermissions(),
    ])
      .then(([businessResult, branchResult, managerResult, permissionResult]) => {
        if (!active) {
          return;
        }
        setBusiness(businessResult);
        setBusinessName(businessResult.name);
        setBusinessTaxId(businessResult.tax_id ?? "");
        setBranches(branchResult);
        setBranchDrafts(Object.fromEntries(branchResult.map((branch) => [
          branch.id,
          toBranchDraft(branch),
        ])));
        setManagers(managerResult);
        setManagerNameDrafts(Object.fromEntries(managerResult.map((manager) => [
          manager.id,
          manager.full_name,
        ])));
        setBranchId(branchResult[0]?.id ?? "");
        setManagerPermissions(permissionResult);
        setError(null);
      })
      .catch((cause: unknown) => {
        if (active) {
          setError(`Could not load business administration. ${errorText(cause)}`);
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
  }, [user.role]);

  async function saveBusiness(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setNotice(null);
    setIsSavingBusiness(true);
    try {
      const updated = await businessAdministrationApi.updateBusiness({
        name: businessName.trim(),
        taxId: businessTaxId.trim() || null,
      });
      setBusiness(updated);
      setBusinessName(updated.name);
      setBusinessTaxId(updated.tax_id ?? "");
      setNotice("Business details saved and recorded in the audit log.");
    } catch (cause) {
      setError(`Could not save business details. ${errorText(cause)}`);
    } finally {
      setIsSavingBusiness(false);
    }
  }

  async function createBranch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setNotice(null);
    setSavingBranchId("new");
    try {
      const created = await businessAdministrationApi.createBranch({
        name: newBranchName.trim(),
        address: newBranchAddress.trim() || null,
        phone: newBranchPhone.trim() || null,
      });
      setBranches((current) =>
        [...current, created].sort((left, right) => left.name.localeCompare(right.name)),
      );
      setBranchDrafts((current) => ({ ...current, [created.id]: toBranchDraft(created) }));
      setBranchId(created.id);
      setNewBranchName("");
      setNewBranchAddress("");
      setNewBranchPhone("");
      setNotice("Branch created inactive. Add an active Manager before activating it.");
    } catch (cause) {
      setError(`Could not create branch. ${errorText(cause)}`);
    } finally {
      setSavingBranchId(null);
    }
  }

  async function saveBranchDetails(branch: AdminBranch) {
    const draft = branchDrafts[branch.id];
    if (!draft) {
      return;
    }
    setError(null);
    setNotice(null);
    setSavingBranchId(branch.id);
    try {
      const updated = await businessAdministrationApi.updateBranch(branch.id, {
        name: draft.name.trim(),
        address: draft.address.trim() || null,
        phone: draft.phone.trim() || null,
      });
      setBranches((current) =>
        current
          .map((item) => item.id === branch.id ? updated : item)
          .sort((left, right) => left.name.localeCompare(right.name)),
      );
      setManagers((current) =>
        current.map((manager) =>
          manager.branch_id === branch.id
            ? { ...manager, branch_name: updated.name }
            : manager,
        ),
      );
      setBranchDrafts((current) => ({ ...current, [branch.id]: toBranchDraft(updated) }));
      setNotice("Branch details saved and recorded in the audit log.");
    } catch (cause) {
      setError(`Could not save branch details. ${errorText(cause)}`);
    } finally {
      setSavingBranchId(null);
    }
  }

  async function setBranchActive(branch: AdminBranch, isActive: boolean) {
    setError(null);
    setNotice(null);
    setSavingBranchId(branch.id);
    try {
      const updated = await businessAdministrationApi.updateBranch(branch.id, { isActive });
      setBranches((current) =>
        current.map((item) => item.id === branch.id ? updated : item),
      );
      setBranchDrafts((current) => ({ ...current, [branch.id]: toBranchDraft(updated) }));
      setNotice(
        isActive
          ? "Branch activated. Managers can sign in only while their assigned branch is active."
          : "Branch deactivated and its Manager sessions revoked.",
      );
    } catch (cause) {
      setError(`Could not ${isActive ? "activate" : "deactivate"} ${branch.name}. ${errorText(cause)}`);
    } finally {
      setSavingBranchId(null);
    }
  }

  async function createManager(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setNotice(null);
    if (password !== passwordConfirmation) {
      setError("Password confirmation does not match.");
      return;
    }
    if (!branchId) {
      setError("Create a branch before creating a Manager.");
      return;
    }

    setIsSaving(true);
    try {
      const created = await businessAdministrationApi.createManager({
        branchId,
        username: username.trim(),
        fullName: fullName.trim(),
        password,
      });
      setManagers((current) =>
        [...current, created].sort((left, right) =>
          Number(right.is_active) - Number(left.is_active) ||
          left.full_name.localeCompare(right.full_name),
        ),
      );
      setManagerNameDrafts((current) => ({ ...current, [created.id]: created.full_name }));
      setBranches((current) =>
        current.map((branch) =>
          branch.id === created.branch_id
            ? { ...branch, active_manager_count: branch.active_manager_count + 1 }
            : branch,
        ),
      );
      setUsername("");
      setFullName("");
      setPassword("");
      setPasswordConfirmation("");
      setNotice(
        "Manager profile created and audited. If the assigned branch is inactive, the Manager cannot sign in until it is activated.",
      );
    } catch (cause) {
      setError(`Could not create Manager profile. ${errorText(cause)}`);
    } finally {
      setIsSaving(false);
    }
  }

  async function updateManager(manager: AdminManager, input: { branchId?: string; isActive?: boolean; fullName?: string }) {
    setError(null);
    setNotice(null);
    setSavingManagerId(manager.id);
    try {
      const updated = await businessAdministrationApi.updateManager(manager.id, input);
      setManagers((current) => replaceManager(current, updated));
      if (input.fullName !== undefined) {
        setManagerNameDrafts((current) => ({ ...current, [manager.id]: updated.full_name }));
      }
      if (input.branchId !== undefined || input.isActive !== undefined) {
        setBranches((current) => current.map((branch) => {
          if (branch.id === manager.branch_id && manager.is_active) {
            return { ...branch, active_manager_count: Math.max(0, branch.active_manager_count - 1) };
          }
          if (branch.id === updated.branch_id && updated.is_active) {
            return { ...branch, active_manager_count: branch.active_manager_count + 1 };
          }
          return branch;
        }));
      }
      setNotice(
        input.fullName !== undefined
          ? `Manager profile name changed from ${manager.full_name} to ${updated.full_name}.`
          : input.branchId !== undefined
          ? `${manager.full_name}'s branch assignment was updated; their existing sessions were revoked.`
          : `${manager.full_name} ${updated.is_active ? "activated" : "deactivated"}.`,
      );
    } catch (cause) {
      setError(`Could not update ${manager.full_name}. ${errorText(cause)}`);
    } finally {
      setSavingManagerId(null);
    }
  }

  async function resetManagerPassword(manager: AdminManager) {
    setError(null);
    setNotice(null);
    if (resetPassword !== resetPasswordConfirmation) {
      setError("Password confirmation does not match.");
      return;
    }
    if (resetPassword.length < 12 || resetPassword.length > 128) {
      setError("Password must be 12-128 characters long.");
      return;
    }
    setSavingManagerId(manager.id);
    try {
      await businessAdministrationApi.resetManagerPassword(manager.id, resetPassword);
      setResetManagerId(null);
      setResetPassword("");
      setResetPasswordConfirmation("");
      setNotice(`${manager.full_name}'s password was reset and all active sessions were revoked.`);
    } catch (cause) {
      setError(`Could not reset ${manager.full_name}'s password. ${errorText(cause)}`);
    } finally {
      setSavingManagerId(null);
    }
  }

  async function saveManagerPermissions() {
    setError(null);
    setNotice(null);
    setIsSavingPermissions(true);
    try {
      setManagerPermissions(
        await businessAdministrationApi.updateManagerPermissions(
          managerPermissions.map(({ permissionId, enabled }) => ({ permissionId, enabled })),
        ),
      );
      setNotice("Manager permissions saved and recorded in the audit log.");
    } catch (cause) {
      setError(`Could not save Manager permissions. ${errorText(cause)}`);
    } finally {
      setIsSavingPermissions(false);
    }
  }

  if (user.role !== "admin") {
    return (
      <Card className="mx-auto max-w-3xl">
        <CardHeader>
          <CardTitle>Admin access required</CardTitle>
          <CardDescription>
            Branch and Manager administration is available only to the business Admin.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
        <LoaderCircle className="size-4 animate-spin" />
        Loading business administration...
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <PageHeader
        eyebrow="People and access"
        title="Employees"
        description="Manage the business, branches and Manager access. Changes are recorded against your Admin account."
      />

      {error ? (
        <div role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
          <p className="font-medium">Administration action failed</p>
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
          <CardTitle>Business profile</CardTitle>
          <CardDescription>Update the business identity shown to signed-in staff.</CardDescription>
        </CardHeader>
        <CardContent>
          <form className="grid gap-5 md:grid-cols-2" onSubmit={(event) => void saveBusiness(event)}>
            <div className="space-y-2">
              <Label htmlFor="business-name">Business name</Label>
              <Input
                id="business-name"
                required
                maxLength={120}
                value={businessName}
                onChange={(event) => setBusinessName(event.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="business-tax-id">Tax identifier</Label>
              <Input
                id="business-tax-id"
                maxLength={80}
                value={businessTaxId}
                onChange={(event) => setBusinessTaxId(event.target.value)}
              />
            </div>
            <div className="flex justify-end md:col-span-2">
              <Button type="submit" disabled={isSavingBusiness}>
                {isSavingBusiness ? <LoaderCircle className="animate-spin" /> : null}
                {isSavingBusiness ? "Saving..." : "Save business details"}
              </Button>
            </div>
          </form>
          {business ? <p className="mt-3 text-xs text-muted-foreground">Business ID: {business.id}</p> : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Branches</CardTitle>
          <CardDescription>
            A new branch starts inactive. It can be activated only after at least one active Manager is assigned.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <form className="grid gap-4 md:grid-cols-2" onSubmit={(event) => void createBranch(event)}>
            <div className="space-y-2">
              <Label htmlFor="new-branch-name">Branch name</Label>
              <Input id="new-branch-name" required maxLength={120} value={newBranchName} onChange={(event) => setNewBranchName(event.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="new-branch-address">Address</Label>
              <Input id="new-branch-address" maxLength={240} value={newBranchAddress} onChange={(event) => setNewBranchAddress(event.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="new-branch-phone">Phone</Label>
              <Input id="new-branch-phone" maxLength={40} value={newBranchPhone} onChange={(event) => setNewBranchPhone(event.target.value)} />
            </div>
            <div className="flex items-end justify-end">
              <Button type="submit" disabled={savingBranchId !== null}>
                {savingBranchId === "new" ? <LoaderCircle className="animate-spin" /> : <Plus />}
                {savingBranchId === "new" ? "Creating..." : "Create inactive branch"}
              </Button>
            </div>
          </form>

          {branches.length === 0 ? (
            <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
              No branches have been created yet.
            </div>
          ) : (
            <div className="divide-y">
              {branches.map((branch) => {
                const draft = branchDrafts[branch.id] ?? toBranchDraft(branch);
                return (
                  <div key={branch.id} className="space-y-4 py-5">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div className="flex items-center gap-3">
                        <Building2 className="size-4 text-muted-foreground" />
                        <span className="font-medium">{branch.name}</span>
                        <Badge variant={branch.is_active ? "default" : "secondary"}>
                          {branch.is_active ? "Active" : "Inactive"}
                        </Badge>
                      </div>
                      <span className="text-sm text-muted-foreground">
                        {branch.active_manager_count} active {branch.active_manager_count === 1 ? "Manager" : "Managers"}
                      </span>
                    </div>
                    <form
                      className="grid gap-3 md:grid-cols-3"
                      onSubmit={(event) => {
                        event.preventDefault();
                        void saveBranchDetails(branch);
                      }}
                    >
                      <div className="space-y-2">
                        <Label htmlFor={`branch-name-${branch.id}`}>Name</Label>
                        <Input
                          id={`branch-name-${branch.id}`}
                          required
                          maxLength={120}
                          value={draft.name}
                          onChange={(event) => setBranchDrafts((current) => ({
                            ...current,
                            [branch.id]: { ...draft, name: event.target.value },
                          }))}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor={`branch-address-${branch.id}`}>Address</Label>
                        <Input
                          id={`branch-address-${branch.id}`}
                          maxLength={240}
                          value={draft.address}
                          onChange={(event) => setBranchDrafts((current) => ({
                            ...current,
                            [branch.id]: { ...draft, address: event.target.value },
                          }))}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor={`branch-phone-${branch.id}`}>Phone</Label>
                        <Input
                          id={`branch-phone-${branch.id}`}
                          maxLength={40}
                          value={draft.phone}
                          onChange={(event) => setBranchDrafts((current) => ({
                            ...current,
                            [branch.id]: { ...draft, phone: event.target.value },
                          }))}
                        />
                      </div>
                      <div className="flex flex-wrap justify-end gap-2 md:col-span-3">
                        <Button type="submit" variant="outline" disabled={savingBranchId !== null}>
                          {savingBranchId === branch.id ? <LoaderCircle className="animate-spin" /> : null}
                          Save branch details
                        </Button>
                        <Button
                          type="button"
                          variant={branch.is_active ? "outline" : "default"}
                          disabled={savingBranchId !== null}
                          onClick={() => void setBranchActive(branch, !branch.is_active)}
                        >
                          {savingBranchId === branch.id ? <LoaderCircle className="animate-spin" /> : null}
                          {branch.is_active ? "Deactivate branch" : "Activate branch"}
                        </Button>
                      </div>
                    </form>
                    {!branch.is_active && branch.active_manager_count === 0 ? (
                      <p className="text-xs text-muted-foreground">
                        Assign an active Manager to this branch before activating it.
                      </p>
                    ) : null}
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Role access</CardTitle>
          <CardDescription>
            Configure the Manager role for this business. Admin always retains full access.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="rounded-lg border bg-muted/30 p-4">
            <p className="font-medium">Admin</p>
            <p className="mt-1 text-sm text-muted-foreground">Full business-wide access. This role cannot be restricted here.</p>
          </div>
          <div>
            <p className="font-medium">Manager permissions</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Each Manager is assigned to exactly one branch. Authorization checks enforce that scope on every protected API request.
            </p>
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            {managerPermissions.map((permission) => (
              <label
                key={permission.permissionId}
                className="flex cursor-pointer items-start gap-3 rounded-md border p-3 text-sm transition-colors hover:bg-muted/40"
              >
                <input
                  type="checkbox"
                  className="mt-0.5 size-4 accent-primary"
                  checked={permission.enabled}
                  disabled={isSavingPermissions}
                  onChange={(event) => {
                    const enabled = event.target.checked;
                    setManagerPermissions((current) =>
                      current.map((item) =>
                        item.permissionId === permission.permissionId ? { ...item, enabled } : item,
                      ),
                    );
                  }}
                />
                <span>
                  <span className="block font-medium">
                    {PERMISSION_LABELS[permission.permissionId] ?? permission.description}
                  </span>
                  <span className="mt-1 block text-xs text-muted-foreground">{permission.description}</span>
                </span>
              </label>
            ))}
          </div>
          <div className="flex justify-end">
            <Button type="button" onClick={() => void saveManagerPermissions()} disabled={isSavingPermissions}>
              {isSavingPermissions ? <LoaderCircle className="animate-spin" /> : null}
              {isSavingPermissions ? "Saving..." : "Save Manager permissions"}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Add a Manager</CardTitle>
          <CardDescription>
            Create a Manager with a unique username, initial password and one assigned branch. Passwords are hashed on the server and never returned.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form className="grid gap-5 md:grid-cols-2" onSubmit={(event) => void createManager(event)}>
            <div className="space-y-2">
              <Label htmlFor="manager-full-name">Full name</Label>
              <Input id="manager-full-name" autoComplete="name" maxLength={120} required value={fullName} onChange={(event) => setFullName(event.target.value)} placeholder="e.g. Jean Niyonzima" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="manager-username">Username</Label>
              <Input id="manager-username" autoComplete="off" minLength={3} maxLength={32} required value={username} onChange={(event) => setUsername(event.target.value)} placeholder="e.g. jean.manager" />
              <p className="text-xs text-muted-foreground">3–32 letters, numbers, dots, underscores or hyphens.</p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="manager-branch">Assigned branch</Label>
              <SelectField id="manager-branch" required value={branchId} disabled={branches.length === 0} onChange={(event) => setBranchId(event.target.value)}>
                {branches.length === 0 ? <option value="">Create a branch first</option> : null}
                {branches.map((branch) => (
                  <option key={branch.id} value={branch.id}>
                    {branch.name}{branch.is_active ? "" : " (inactive)"}
                  </option>
                ))}
              </SelectField>
            </div>
            <div className="space-y-2">
              <Label htmlFor="manager-password">Initial password</Label>
              <Input id="manager-password" type="password" autoComplete="new-password" minLength={12} maxLength={128} required value={password} onChange={(event) => setPassword(event.target.value)} />
              <p className="text-xs text-muted-foreground">Use 12–128 characters.</p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="manager-password-confirmation">Confirm initial password</Label>
              <Input id="manager-password-confirmation" type="password" autoComplete="new-password" minLength={12} maxLength={128} required value={passwordConfirmation} onChange={(event) => setPasswordConfirmation(event.target.value)} />
            </div>
            <div className="flex justify-end md:col-span-2">
              <Button type="submit" disabled={isSaving || branches.length === 0}>
                {isSaving ? <LoaderCircle className="animate-spin" /> : <Plus />}
                {isSaving ? "Saving..." : "Create Manager"}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Manager profiles</CardTitle>
          <CardDescription>Inactive profiles are retained for audit history and can be reactivated when their branch is active.</CardDescription>
        </CardHeader>
        <CardContent>
          {managers.length === 0 ? (
            <div className="flex flex-col items-center gap-3 py-10 text-center">
              <UserCog className="size-8 text-muted-foreground" />
              <p className="font-medium">No Managers added yet</p>
              <p className="text-sm text-muted-foreground">Manager profiles will appear here after you add them.</p>
            </div>
          ) : (
            <div className="divide-y">
              {managers.map((manager) => (
                <Fragment key={manager.id}>
                  <div className="grid gap-4 py-4 lg:grid-cols-[minmax(0,1fr)_minmax(220px,0.7fr)_auto_auto] lg:items-center">
                    <div className="flex min-w-0 items-start gap-3">
                      <UserCog className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                      <div className="min-w-0 space-y-1">
                        <p className="truncate font-medium">{manager.full_name}</p>
                        <p className="text-sm text-muted-foreground">@{manager.username} · {manager.branch_name}</p>
                         <div className="mt-2 flex max-w-sm items-center gap-2">
                           <Label htmlFor={`manager-name-${manager.id}`} className="sr-only">Manager full name</Label>
                           <Input
                             id={`manager-name-${manager.id}`}
                             maxLength={120}
                             value={managerNameDrafts[manager.id] ?? manager.full_name}
                             onChange={(event) => setManagerNameDrafts((current) => ({
                               ...current,
                               [manager.id]: event.target.value,
                             }))}
                           />
                           <Button
                             type="button"
                             size="sm"
                             variant="outline"
                             disabled={
                               savingManagerId !== null ||
                               !(managerNameDrafts[manager.id] ?? "").trim() ||
                               (managerNameDrafts[manager.id] ?? manager.full_name) === manager.full_name
                             }
                             onClick={() => void updateManager(manager, {
                               fullName: (managerNameDrafts[manager.id] ?? "").trim(),
                             })}
                           >
                             Save name
                           </Button>
                         </div>
                      </div>
                      <Badge variant={manager.is_active ? "default" : "secondary"}>
                        {manager.is_active ? "Active" : "Inactive"}
                      </Badge>
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor={`manager-branch-${manager.id}`}>Assigned branch</Label>
                      <SelectField
                        id={`manager-branch-${manager.id}`}
                        value={manager.branch_id}
                        disabled={savingManagerId !== null}
                        onChange={(event) => void updateManager(manager, { branchId: event.target.value })}
                      >
                        {branches.map((branch) => (
                          <option key={branch.id} value={branch.id}>
                            {branch.name}{branch.is_active ? "" : " (inactive)"}
                          </option>
                        ))}
                      </SelectField>
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={savingManagerId !== null}
                      onClick={() => void updateManager(manager, { isActive: !manager.is_active })}
                    >
                      {savingManagerId === manager.id ? <LoaderCircle className="animate-spin" /> : null}
                      {manager.is_active ? "Deactivate" : "Activate"}
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={savingManagerId !== null}
                      onClick={() => {
                        setResetManagerId((current) => current === manager.id ? null : manager.id);
                        setResetPassword("");
                        setResetPasswordConfirmation("");
                      }}
                    >
                      <KeyRound />
                      Reset password
                    </Button>
                  </div>
                  {resetManagerId === manager.id ? (
                    <form
                      className="grid gap-3 rounded-lg border bg-muted/20 p-4 sm:grid-cols-[1fr_1fr_auto]"
                      onSubmit={(event) => {
                        event.preventDefault();
                        void resetManagerPassword(manager);
                      }}
                    >
                      <div className="space-y-2">
                        <Label htmlFor={`reset-password-${manager.id}`}>New password</Label>
                        <Input id={`reset-password-${manager.id}`} type="password" autoComplete="new-password" minLength={12} maxLength={128} required value={resetPassword} onChange={(event) => setResetPassword(event.target.value)} />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor={`reset-password-confirmation-${manager.id}`}>Confirm new password</Label>
                        <Input id={`reset-password-confirmation-${manager.id}`} type="password" autoComplete="new-password" minLength={12} maxLength={128} required value={resetPasswordConfirmation} onChange={(event) => setResetPasswordConfirmation(event.target.value)} />
                      </div>
                      <div className="flex items-end">
                        <Button type="submit" disabled={savingManagerId !== null}>
                          {savingManagerId === manager.id ? <LoaderCircle className="animate-spin" /> : <KeyRound />}
                          {savingManagerId === manager.id ? "Resetting..." : "Save password"}
                        </Button>
                      </div>
                    </form>
                  ) : null}
                </Fragment>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
