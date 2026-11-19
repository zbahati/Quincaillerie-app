import { invalidResponse, isRecord, requestJson } from "@/lib/api/http-client";

export interface DashboardBranch {
  id: string;
  name: string;
  is_active: boolean;
}

export interface DashboardInventoryItem {
  product_id: string;
  name: string;
  sku: string;
  base_unit_name: string;
  quantity_on_hand: number;
  stock_value: number;
  min_stock_quantity: number;
}

export interface DashboardData {
  business: { id: string; name: string };
  branch: DashboardBranch;
  branches: DashboardBranch[];
  inventory: {
    items: DashboardInventoryItem[];
    total_count: number;
    total_stock_value: number;
    low_stock_count: number;
    out_of_stock_count: number;
  };
}

export const dashboardApi = {
  async branches(): Promise<DashboardBranch[]> {
    const value = await requestJson("/api/dashboard/branches");
    if (!isRecord(value) || !Array.isArray(value.branches)) {
      throw invalidResponse("The service returned invalid dashboard branches.");
    }
    return value.branches as unknown as DashboardBranch[];
  },
  async get(branchId: string): Promise<DashboardData> {
    const value = await requestJson(`/api/dashboard?branchId=${encodeURIComponent(branchId)}`);
    if (!isRecord(value) || !isRecord(value.business) || !isRecord(value.branch) || !isRecord(value.inventory) || !Array.isArray(value.branches) || !Array.isArray(value.inventory.items)) {
      throw invalidResponse("The service returned invalid dashboard information.");
    }
    return value as unknown as DashboardData;
  },
};
