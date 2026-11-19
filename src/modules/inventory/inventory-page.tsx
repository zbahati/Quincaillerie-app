"use client";

import { useEffect, useState, type FormEvent } from "react";
import { Fragment } from "react";
import { CircleDollarSign, History, LoaderCircle, Package, Search, Tag, TriangleAlert, Warehouse } from "lucide-react";

import { inventoryApi, type InventoryBranch, type InventoryItem, type StockMovement } from "@/lib/api/inventory-api";
import { productsApi } from "@/lib/api/products-api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PageHeader } from "@/components/shared/page-header";
import { SelectField } from "@/components/shared/select-field";
import { useAuthentication } from "@/modules/auth/auth-gate";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

const PAGE_SIZE = 20;
const MOVEMENT_PAGE_SIZE = 20;
const QUANTITY_SCALE = 1000n;
const MONEY_SCALE = 100n;
const MAX_SAFE_INTEGER = BigInt(Number.MAX_SAFE_INTEGER);

function formatQuantity(quantity: number): string {
  if (!Number.isSafeInteger(quantity)) {
    return "Invalid quantity";
  }
  const scaled = BigInt(quantity);
  const whole = scaled / QUANTITY_SCALE;
  const fraction = scaled % QUANTITY_SCALE;
  const formattedWhole = new Intl.NumberFormat("en-RW").format(whole);
  return fraction === 0n
    ? formattedWhole
    : `${formattedWhole}.${fraction.toString().padStart(3, "0").replace(/0+$/, "")}`;
}

function toScaledQuantity(value: string, allowsDecimals: boolean): number {
  const pattern = allowsDecimals ? /^\d+(?:\.\d{1,3})?$/ : /^\d+$/;
  if (!pattern.test(value)) {
    throw new Error(
      allowsDecimals
        ? "Quantity must be non-negative with up to 3 decimal places."
        : "This product only allows whole base units.",
    );
  }
  const [whole, fraction = ""] = value.split(".");
  const scaled = BigInt(whole) * QUANTITY_SCALE + BigInt(fraction.padEnd(3, "0") || "0");
  if (scaled > MAX_SAFE_INTEGER) {
    throw new Error("Quantity is too large.");
  }
  return Number(scaled);
}

function toScaledMoney(value: string): number {
  if (!/^\d+$/.test(value)) {
    throw new Error("Unit cost must be a whole non-negative RWF amount.");
  }
  const scaled = BigInt(value) * MONEY_SCALE;
  if (scaled > MAX_SAFE_INTEGER) {
    throw new Error("Unit cost is too large.");
  }
  return Number(scaled);
}

function toScaledSellingPrice(value: string): number {
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(value);
  if (!match) {
    throw new Error("Selling price must be a non-negative RWF amount with up to 2 decimal places.");
  }
  const fraction = (match[2] ?? "").padEnd(2, "0");
  const scaled = BigInt(match[1]) * MONEY_SCALE + BigInt(fraction || "0");
  if (scaled > MAX_SAFE_INTEGER) {
    throw new Error("Selling price is too large.");
  }
  return Number(scaled);
}

function moneyInputValue(scaledAmount: number): string {
  if (!Number.isSafeInteger(scaledAmount) || scaledAmount < 0) {
    return "";
  }
  const amount = BigInt(scaledAmount);
  const whole = amount / MONEY_SCALE;
  const fraction = amount % MONEY_SCALE;
  return fraction === 0n ? whole.toString() : `${whole}.${fraction.toString().padStart(2, "0")}`;
}

function formatMoney(scaledAmount: number): string {
  if (!Number.isSafeInteger(scaledAmount)) {
    return "Invalid amount";
  }
  const amount = BigInt(scaledAmount);
  const whole = amount / MONEY_SCALE;
  const fraction = amount % MONEY_SCALE;
  return `${new Intl.NumberFormat("en-RW").format(whole)}${
    fraction === 0n ? "" : `.${fraction.toString().padStart(2, "0")}`
  } RWF`;
}

function errorText(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

function movementLabel(value: string): string {
  return value
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function movementCostLabel(value: string): string {
  switch (value) {
    case "purchase_received":
      return "Delivery cost";
    case "sale":
      return "Cost of goods sold";
    case "stock_correction":
      return "Stock adjustment value";
    case "opening_stock":
      return "Opening stock value";
    default:
      return "Movement value";
  }
}

export function InventoryPage() {
  const { user, permissions } = useAuthentication();
  const canManageInventory = user.role === "admin" || permissions.includes("inventory.manage");
  const canManageCatalog = user.role === "admin" || permissions.includes("catalog.manage");
  const [branches, setBranches] = useState<InventoryBranch[]>([]);
  const [branchId, setBranchId] = useState(user.role === "manager" ? user.branch_id ?? "" : "");
  const [inventory, setInventory] = useState<InventoryItem[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [inventorySummary, setInventorySummary] = useState({
    total_stock_value: 0,
    low_stock_count: 0,
    out_of_stock_count: 0,
  });
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const [expandedProductId, setExpandedProductId] = useState<string | null>(null);
  const [movements, setMovements] = useState<StockMovement[]>([]);
  const [openingQuantity, setOpeningQuantity] = useState("");
  const [openingReason, setOpeningReason] = useState("");
  const [correctedQuantity, setCorrectedQuantity] = useState("");
  const [correctionReason, setCorrectionReason] = useState("");
  const [receivedQuantity, setReceivedQuantity] = useState("");
  const [receivedUnitCost, setReceivedUnitCost] = useState("");
  const [newSellingPrice, setNewSellingPrice] = useState("");
  const [sellingPriceDraft, setSellingPriceDraft] = useState("");
  const [receiptReference, setReceiptReference] = useState("");
  const [receiptNotes, setReceiptNotes] = useState("");
  const [isLoadingBranches, setIsLoadingBranches] = useState(true);
  const [isLoadingInventory, setIsLoadingInventory] = useState(false);
  const [isLoadingMovements, setIsLoadingMovements] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pageCount = Math.ceil(totalCount / PAGE_SIZE);
  const firstItem = totalCount === 0 ? 0 : page * PAGE_SIZE + 1;
  const lastItem = Math.min((page + 1) * PAGE_SIZE, totalCount);
  const selectedProduct = inventory.find((item) => item.product_id === expandedProductId);
  const selectedBranch = branches.find((branch) => branch.id === branchId);

  function resetStockDrafts() {
    setOpeningQuantity("");
    setOpeningReason("");
    setCorrectedQuantity("");
    setCorrectionReason("");
    setReceivedQuantity("");
    setReceivedUnitCost("");
    setNewSellingPrice("");
    setSellingPriceDraft("");
    setReceiptReference("");
    setReceiptNotes("");
  }

  useEffect(() => {
    let active = true;
    inventoryApi.branches()
      .then((result) => {
        if (active) {
          setBranches(result);
          setBranchId((current) => {
            if (result.some((branch) => branch.id === current)) {
              return current;
            }
            if (user.role === "manager") {
              return result.find((branch) => branch.id === user.branch_id)?.id ?? "";
            }
            return result.find((branch) => branch.is_active)?.id ?? result[0]?.id ?? "";
          });
        }
      })
      .catch((cause: unknown) => {
        if (active) {
          setError(`Could not load inventory branches. ${errorText(cause)}`);
        }
      })
      .finally(() => {
        if (active) {
          setIsLoadingBranches(false);
        }
      });
    return () => {
      active = false;
    };
  }, [user.branch_id, user.role]);

  useEffect(() => {
    if (!branchId) {
      return;
    }

    let active = true;
    const timer = window.setTimeout(() => {
      setIsLoadingInventory(true);
      inventoryApi.list({
        branchId,
        search: search.trim(),
        offset: page * PAGE_SIZE,
        limit: PAGE_SIZE,
      })
        .then((result) => {
          if (active) {
            setInventory(result.items);
            setTotalCount(result.total_count);
            setInventorySummary({
              total_stock_value: result.total_stock_value,
              low_stock_count: result.low_stock_count,
              out_of_stock_count: result.out_of_stock_count,
            });
            if (expandedProductId && !result.items.some((item) => item.product_id === expandedProductId)) {
              setExpandedProductId(null);
              setMovements([]);
              setIsLoadingMovements(false);
              resetStockDrafts();
            }
          }
        })
        .catch((cause: unknown) => {
          if (active) {
            setError(`Could not load inventory. ${errorText(cause)}`);
          }
        })
        .finally(() => {
          if (active) {
            setIsLoadingInventory(false);
          }
        });
    }, 150);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [branchId, expandedProductId, page, search]);

  useEffect(() => {
    if (!branchId || !expandedProductId) {
      return;
    }

    let active = true;
    inventoryApi.movements({
      branchId,
      productId: expandedProductId,
      offset: 0,
      limit: MOVEMENT_PAGE_SIZE,
    })
      .then((result) => {
        if (active) {
          setMovements(result);
        }
      })
      .catch((cause: unknown) => {
        if (active) {
          setError(`Could not load stock history. ${errorText(cause)}`);
        }
      })
      .finally(() => {
        if (active) {
          setIsLoadingMovements(false);
        }
      });
    return () => {
      active = false;
    };
  }, [branchId, expandedProductId]);

  async function refreshInventory(productId?: string) {
    const result = await inventoryApi.list({
      branchId,
      search: search.trim(),
      offset: page * PAGE_SIZE,
      limit: PAGE_SIZE,
    });
    setInventory(result.items);
    setTotalCount(result.total_count);
    setInventorySummary({
      total_stock_value: result.total_stock_value,
      low_stock_count: result.low_stock_count,
      out_of_stock_count: result.out_of_stock_count,
    });
    if (productId) {
      setMovements(await inventoryApi.movements({
        branchId,
        productId,
        offset: 0,
        limit: MOVEMENT_PAGE_SIZE,
      }));
    }
  }

  async function handleOpeningStock(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!branchId || !selectedProduct || selectedProduct.has_movements) {
      setError("Opening stock is only available before the product has any stock movements.");
      return;
    }

    setError(null);
    setIsSaving(true);
    try {
      await inventoryApi.setOpeningStock(selectedProduct.product_id, {
        branchId,
        quantity: toScaledQuantity(openingQuantity, selectedProduct.base_unit_allows_decimals),
        reason: openingReason.trim() || null,
      });
      setOpeningQuantity("");
      setOpeningReason("");
      await refreshInventory(selectedProduct.product_id);
    } catch (cause) {
      setError(`Could not record opening stock. ${errorText(cause)}`);
    } finally {
      setIsSaving(false);
    }
  }

  async function handleStockCorrection(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!branchId || !selectedProduct) {
      setError("Select a product before correcting its stock.");
      return;
    }

    setError(null);
    setIsSaving(true);
    try {
      await inventoryApi.correctStock(selectedProduct.product_id, {
        branchId,
        targetQuantity: toScaledQuantity(
          correctedQuantity,
          selectedProduct.base_unit_allows_decimals,
        ),
        reason: correctionReason.trim(),
      });
      setCorrectedQuantity("");
      setCorrectionReason("");
      await refreshInventory(selectedProduct.product_id);
    } catch (cause) {
      setError(`Could not correct stock. ${errorText(cause)}`);
    } finally {
      setIsSaving(false);
    }
  }

  async function handleStockReceipt(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!branchId || !selectedProduct) {
      setError("Select a product before receiving stock.");
      return;
    }

    setError(null);
    setIsSaving(true);
    try {
      await inventoryApi.receiveStock(selectedProduct.product_id, {
        branchId,
        quantity: toScaledQuantity(receivedQuantity, selectedProduct.base_unit_allows_decimals),
        receivedUnitCost: toScaledMoney(receivedUnitCost),
        receiptReference: receiptReference.trim(),
        reason: receiptNotes.trim() || null,
        newSellingPrice: newSellingPrice.trim()
          ? toScaledSellingPrice(newSellingPrice)
          : null,
      });
      setReceivedQuantity("");
      setReceivedUnitCost("");
      setNewSellingPrice("");
      setReceiptReference("");
      setReceiptNotes("");
      await refreshInventory(selectedProduct.product_id);
    } catch (cause) {
      setError(`Could not receive stock. ${errorText(cause)}`);
    } finally {
      setIsSaving(false);
    }
  }

  async function handleSellingPriceUpdate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!branchId || !selectedProduct) {
      setError("Select a product before changing its selling price.");
      return;
    }

    setError(null);
    setIsSaving(true);
    try {
      await productsApi.updateSellingPrice(
        selectedProduct.product_id,
        toScaledSellingPrice(sellingPriceDraft),
      );
      setSellingPriceDraft("");
      await refreshInventory();
    } catch (cause) {
      setError(`Could not update the selling price. ${errorText(cause)}`);
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <PageHeader
        eyebrow="Stock control"
        title="Inventory"
        description="Record opening quantities, receive deliveries, correct counted stock, and review stock value."
        actions={user.role === "admin" && branches.length > 0 ? (
          <div className="w-full space-y-1.5 sm:w-56">
            <Label htmlFor="inventory-branch">Branch</Label>
            <SelectField
              id="inventory-branch"
              value={branchId}
              onChange={(event) => {
                setBranchId(event.target.value);
                setPage(0);
                setExpandedProductId(null);
                setInventory([]);
                setTotalCount(0);
                setInventorySummary({ total_stock_value: 0, low_stock_count: 0, out_of_stock_count: 0 });
                setMovements([]);
                setIsLoadingMovements(false);
                resetStockDrafts();
                setError(null);
              }}
            >
              {branches.map((branch) => (
                <option key={branch.id} value={branch.id}>
                  {branch.name}{branch.is_active ? "" : " (inactive)"}
                </option>
              ))}
            </SelectField>
          </div>
        ) : selectedBranch ? (
          <div className="w-full space-y-1.5 sm:w-56">
            <Label>Branch</Label>
            <div className="flex h-10 items-center rounded-md border bg-background px-3 text-sm">
              {selectedBranch.name}
            </div>
          </div>
        ) : undefined}
      />

      {error ? (
        <div role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
          {error}
        </div>
      ) : null}

      {!isLoadingBranches && branches.length === 0 ? (
        <Card>
          <CardContent className="py-6 text-sm text-muted-foreground">
            Create a branch and assign an active Manager before managing branch inventory.
          </CardContent>
        </Card>
      ) : isLoadingBranches ? (
        <Card>
          <CardContent className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
            <LoaderCircle className="size-4 animate-spin" />
            Loading inventory branches...
          </CardContent>
        </Card>
      ) : (
        <>
        <div className="grid gap-4 xl:grid-cols-3">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Inventory value</CardTitle>
              <CircleDollarSign className="size-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-semibold">{formatMoney(inventorySummary.total_stock_value)}</p>
              <p className="text-xs text-muted-foreground">Remaining stock at recorded purchase costs</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Products in results</CardTitle>
              <Package className="size-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-semibold">{totalCount.toLocaleString("en-RW")}</p>
              <p className="text-xs text-muted-foreground">Active products matching the current search</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Stock alerts</CardTitle>
              <TriangleAlert className="size-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-semibold">
                {(inventorySummary.low_stock_count + inventorySummary.out_of_stock_count).toLocaleString("en-RW")}
              </p>
              <p className="text-xs text-muted-foreground">
                {inventorySummary.low_stock_count.toLocaleString("en-RW")} low · {inventorySummary.out_of_stock_count.toLocaleString("en-RW")} out of stock
              </p>
            </CardContent>
          </Card>
        </div>
        <Card>
          <CardHeader>
            <CardTitle>Stock balances</CardTitle>
            <CardDescription>
              {totalCount.toLocaleString("en-RW")} active products · stock value follows remaining FIFO purchase layers
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="relative max-w-md">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                aria-label="Search inventory"
                className="pl-9"
                placeholder="Search product, SKU, barcode, category..."
                value={search}
                onChange={(event) => {
                  setSearch(event.target.value);
                  setPage(0);
                }}
              />
            </div>

            {isLoadingInventory ? (
              <div className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground">
                <LoaderCircle className="size-4 animate-spin" />
                Loading inventory...
              </div>
            ) : inventory.length === 0 ? (
              <div className="py-8 text-center">
                <Warehouse className="mx-auto mb-2 size-8 text-muted-foreground" />
                <p className="text-sm text-muted-foreground">
                  {search.trim() ? "No inventory items match your search." : "No active products found."}
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Product</TableHead>
                    <TableHead>SKU</TableHead>
                    <TableHead>Base unit</TableHead>
                    <TableHead className="text-right">On hand</TableHead>
                    <TableHead className="text-right">Stock value</TableHead>
                    <TableHead className="text-right">Selling price</TableHead>
                    <TableHead className="text-right">Minimum</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {inventory.map((item) => {
                    const isExpanded = expandedProductId === item.product_id;
                    const isLowStock = item.quantity_on_hand <= item.min_stock_quantity;
                    return (
                      <Fragment key={item.product_id}>
                        <TableRow>
                          <TableCell className="font-medium">{item.name}</TableCell>
                          <TableCell>{item.sku}</TableCell>
                          <TableCell>{item.base_unit_name}</TableCell>
                          <TableCell className="text-right">{formatQuantity(item.quantity_on_hand)}</TableCell>
                          <TableCell className="text-right">{formatMoney(item.stock_value)}</TableCell>
                          <TableCell className="text-right">
                            <span>{formatMoney(item.selling_price)}</span>
                            {item.selling_price < item.minimum_selling_price ? (
                              <span className="mt-1 block text-xs text-amber-700">Below highest cost</span>
                            ) : null}
                          </TableCell>
                          <TableCell className="text-right">{formatQuantity(item.min_stock_quantity)}</TableCell>
                          <TableCell>
                            <Badge
                              variant={item.quantity_on_hand === 0 ? "destructive" : isLowStock ? "outline" : "secondary"}
                              className={isLowStock && item.quantity_on_hand > 0
                                ? "border-amber-500/40 bg-amber-500/10 text-amber-800 dark:text-amber-300"
                                : undefined}
                            >
                              {item.quantity_on_hand === 0 ? "Out of stock" : isLowStock ? "Low stock" : "In stock"}
                            </Badge>
                          </TableCell>
                          <TableCell>
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              aria-expanded={isExpanded}
                              onClick={() => {
                                const nextExpandedProductId = isExpanded ? null : item.product_id;
                                setExpandedProductId(nextExpandedProductId);
                                setMovements([]);
                                setIsLoadingMovements(nextExpandedProductId !== null);
                                resetStockDrafts();
                              }}
                            >
                              <History />
                              {isExpanded ? "Hide details" : "Manage stock"}
                            </Button>
                          </TableCell>
                        </TableRow>
                        {isExpanded ? (
                          <TableRow key={`${item.product_id}-details`}>
                            <TableCell colSpan={9} className="bg-muted/20">
                              <div className="space-y-5 p-2">
                                {!canManageInventory ? (
                                  <p className="text-sm text-muted-foreground">
                                    You have read-only access to this branch&apos;s stock.
                                  </p>
                                ) : !item.has_movements ? (
                                  <form className="grid gap-3 rounded-lg border bg-background p-4 md:grid-cols-[1fr_1fr_auto]" onSubmit={handleOpeningStock}>
                                    <div className="space-y-2">
                                      <Label htmlFor={`opening-quantity-${item.product_id}`}>
                                        Opening quantity ({item.base_unit_name})
                                      </Label>
                                      <Input
                                        id={`opening-quantity-${item.product_id}`}
                                        type="number"
                                        min="0"
                                        step={item.base_unit_allows_decimals ? "0.001" : "1"}
                                        required
                                        value={openingQuantity}
                                        onChange={(event) => setOpeningQuantity(event.target.value)}
                                      />
                                    </div>
                                    <div className="space-y-2">
                                      <Label htmlFor={`opening-reason-${item.product_id}`}>Reason (optional)</Label>
                                      <Input
                                        id={`opening-reason-${item.product_id}`}
                                        maxLength={500}
                                        value={openingReason}
                                        onChange={(event) => setOpeningReason(event.target.value)}
                                        placeholder="Initial physical stock count"
                                      />
                                    </div>
                                    <Button type="submit" className="self-end" disabled={isSaving || !openingQuantity}>
                                      {isSaving ? <LoaderCircle className="animate-spin" /> : <Warehouse />}
                                      Record opening stock
                                    </Button>
                                  </form>
                                ) : (
                                  <p className="text-sm text-muted-foreground">
                                    Opening stock can only be recorded before the first stock movement.
                                  </p>
                                )}
                                {canManageInventory && !item.has_movements ? (
                                  <p className="text-xs text-muted-foreground">
                                    Opening stock valuation starts from the product&apos;s saved purchase price of{" "}
                                    {formatMoney(item.purchase_price)} per {item.base_unit_name}.
                                  </p>
                                ) : null}

                                {canManageCatalog ? (
                                  <form
                                    className="grid gap-3 rounded-lg border bg-background p-4 md:grid-cols-[1fr_auto]"
                                    onSubmit={handleSellingPriceUpdate}
                                  >
                                    <div className="space-y-2">
                                      <Label htmlFor={`selling-price-${item.product_id}`}>
                                        Selling price per {item.base_unit_name} (RWF)
                                      </Label>
                                      <Input
                                        id={`selling-price-${item.product_id}`}
                                        type="number"
                                        min={moneyInputValue(item.minimum_selling_price)}
                                        step="0.01"
                                        required
                                        value={sellingPriceDraft}
                                        onChange={(event) => setSellingPriceDraft(event.target.value)}
                                        placeholder={moneyInputValue(item.selling_price)}
                                      />
                                      <p className="text-xs text-muted-foreground">
                                        Must cover the highest purchase cost on hand across this business: {formatMoney(item.minimum_selling_price)}. Approved below-cost sales need a reason at checkout.
                                      </p>
                                    </div>
                                    <Button
                                      type="submit"
                                      className="self-end"
                                      disabled={isSaving || !sellingPriceDraft}
                                    >
                                      {isSaving ? <LoaderCircle className="animate-spin" /> : <Tag />}
                                      Update selling price
                                    </Button>
                                  </form>
                                ) : null}

                                {canManageInventory ? (
                                  <>
                                    <form
                                      className="grid gap-3 rounded-lg border bg-background p-4 md:grid-cols-2 xl:grid-cols-5"
                                      onSubmit={handleStockReceipt}
                                    >
                                      <div className="col-span-full">
                                        <h3 className="font-medium">Receive delivery</h3>
                                        <p className="text-sm text-muted-foreground">
                                          Current selling price: {formatMoney(item.selling_price)} per {item.base_unit_name}.
                                          Enter a new price only if you want to update the price used in POS.
                                        </p>
                                      </div>
                                      <div className="space-y-2">
                                        <Label htmlFor={`receipt-quantity-${item.product_id}`}>
                                          Received quantity ({item.base_unit_name})
                                        </Label>
                                        <Input
                                          id={`receipt-quantity-${item.product_id}`}
                                          type="number"
                                          min={item.base_unit_allows_decimals ? "0.001" : "1"}
                                          step={item.base_unit_allows_decimals ? "0.001" : "1"}
                                          required
                                          value={receivedQuantity}
                                          onChange={(event) => setReceivedQuantity(event.target.value)}
                                        />
                                      </div>
                                      <div className="space-y-2">
                                        <Label htmlFor={`receipt-unit-cost-${item.product_id}`}>
                                          Cost per base unit (RWF)
                                        </Label>
                                        <Input
                                          id={`receipt-unit-cost-${item.product_id}`}
                                          type="number"
                                          min="0"
                                          step="1"
                                          required
                                          value={receivedUnitCost}
                                          onChange={(event) => setReceivedUnitCost(event.target.value)}
                                          placeholder="Cost for one base unit"
                                        />
                                      </div>
                                      <div className="space-y-2">
                                        <Label htmlFor={`receipt-selling-price-${item.product_id}`}>
                                          New selling price per {item.base_unit_name} (optional, RWF)
                                        </Label>
                                        <Input
                                          id={`receipt-selling-price-${item.product_id}`}
                                          type="number"
                                          min={moneyInputValue(item.minimum_selling_price)}
                                          step="0.01"
                                          value={newSellingPrice}
                                          onChange={(event) => setNewSellingPrice(event.target.value)}
                                          placeholder={formatMoney(item.selling_price)}
                                        />
                                      </div>
                                      <div className="space-y-2">
                                        <Label htmlFor={`receipt-reference-${item.product_id}`}>
                                          Delivery / invoice reference
                                        </Label>
                                        <Input
                                          id={`receipt-reference-${item.product_id}`}
                                          maxLength={200}
                                          required
                                          value={receiptReference}
                                          onChange={(event) => setReceiptReference(event.target.value)}
                                          placeholder="Supplier invoice or delivery note"
                                        />
                                      </div>
                                      <div className="space-y-2">
                                        <Label htmlFor={`receipt-notes-${item.product_id}`}>Notes (optional)</Label>
                                        <Input
                                          id={`receipt-notes-${item.product_id}`}
                                          maxLength={500}
                                          value={receiptNotes}
                                          onChange={(event) => setReceiptNotes(event.target.value)}
                                          placeholder="Any receiving details"
                                        />
                                      </div>
                                      <Button
                                        type="submit"
                                        className="self-end xl:col-span-2"
                                        disabled={isSaving || !receivedQuantity || !receivedUnitCost || !receiptReference.trim()}
                                      >
                                        {isSaving ? <LoaderCircle className="animate-spin" /> : <Warehouse />}
                                        Receive stock
                                      </Button>
                                    </form>

                                    <form
                                      className="grid gap-3 rounded-lg border bg-background p-4 md:grid-cols-[1fr_1fr_auto]"
                                      onSubmit={handleStockCorrection}
                                    >
                                      <div className="space-y-2">
                                        <Label htmlFor={`correction-quantity-${item.product_id}`}>
                                          Counted quantity ({item.base_unit_name})
                                        </Label>
                                        <Input
                                          id={`correction-quantity-${item.product_id}`}
                                          type="number"
                                          min="0"
                                          step={item.base_unit_allows_decimals ? "0.001" : "1"}
                                          required
                                          value={correctedQuantity}
                                          onChange={(event) => setCorrectedQuantity(event.target.value)}
                                        />
                                      </div>
                                      <div className="space-y-2">
                                        <Label htmlFor={`correction-reason-${item.product_id}`}>Reason (required)</Label>
                                        <Input
                                          id={`correction-reason-${item.product_id}`}
                                          maxLength={500}
                                          required
                                          value={correctionReason}
                                          onChange={(event) => setCorrectionReason(event.target.value)}
                                          placeholder="Physical count discrepancy"
                                        />
                                      </div>
                                      <Button
                                        type="submit"
                                        className="self-end"
                                        disabled={isSaving || !correctedQuantity || !correctionReason.trim()}
                                      >
                                        {isSaving ? <LoaderCircle className="animate-spin" /> : <Warehouse />}
                                        Correct stock
                                      </Button>
                                    </form>
                                  </>
                                ) : null}

                                <div className="space-y-3">
                                  <h3 className="font-medium">Movement history</h3>
                                  {isLoadingMovements ? (
                                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                                      <LoaderCircle className="size-4 animate-spin" />
                                      Loading movement history...
                                    </div>
                                  ) : movements.length === 0 ? (
                                    <p className="text-sm text-muted-foreground">No stock movements recorded.</p>
                                  ) : (
                                    <div className="space-y-2">
                                      {movements.map((movement) => (
                                        <div key={movement.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-background p-3 text-sm">
                                          <div>
                                            <p className="font-medium">{movementLabel(movement.movement_type)}</p>
                                            <p className="text-muted-foreground">
                                              {movement.reference_id ?? movement.reason ?? "No reference recorded"}
                                              {movement.reason && movement.reference_id ? ` · ${movement.reason}` : ""}
                                              {" · "}{new Date(movement.created_at).toLocaleString()}
                                              {movement.unit_cost !== null
                                                ? ` · ${formatMoney(movement.unit_cost)}/${selectedProduct?.base_unit_name ?? "unit"}`
                                                : ""}
                                              {movement.total_cost !== null
                                                ? ` · ${movementCostLabel(movement.movement_type)}: ${formatMoney(movement.total_cost)}`
                                                : ""}
                                            </p>
                                          </div>
                                          <p className="text-right">
                                            {formatQuantity(movement.previous_quantity)} → {formatQuantity(movement.new_quantity)}
                                            <span className="ml-2 text-muted-foreground">
                                              ({movement.quantity_delta >= 0 ? "+" : ""}
                                              {formatQuantity(movement.quantity_delta)})
                                            </span>
                                          </p>
                                        </div>
                                      ))}
                                    </div>
                                  )}
                                </div>
                              </div>
                            </TableCell>
                          </TableRow>
                        ) : null}
                      </Fragment>
                    );
                  })}
                </TableBody>
              </Table>
              </div>
            )}

            <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-4">
              <p className="text-sm text-muted-foreground">Showing {firstItem}–{lastItem} of {totalCount}</p>
              <div className="flex gap-2">
                <Button variant="outline" disabled={page === 0 || isLoadingInventory} onClick={() => setPage((current) => Math.max(0, current - 1))}>
                  Previous
                </Button>
                <Button variant="outline" disabled={page + 1 >= pageCount || isLoadingInventory} onClick={() => setPage((current) => current + 1)}>
                  Next
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
        </>
      )}
    </div>
  );
}
